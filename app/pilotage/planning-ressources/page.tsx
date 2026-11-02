"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { C, Message, page } from "@/components/pilotage/ui";
import { chargerAffaires, chargerAnnuaire, chargerCapacitesAbsences, chargerPlanifie, type AffaireP } from "@/lib/pilotageDonnees";
import { ajouterJours, construireCapacites, estWeekend, lundiDe, numeroSemaine, type Affectation, type Capacites, type JourRow } from "@/lib/pilotagePlanning";
import { formatDate, formatHeures, nomCollab, num, type Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - PLANNING PAR RESSOURCE (essai, consultation)

   Une ligne par personne ; dans chaque ligne, les barres des affaires sur
   lesquelles elle est affectée (numéro et heures), empilées si elles se
   chevauchent. Sous les barres, sa charge jour par jour :
   vert = libre, jaune = en partie occupé, orange = journée pleine,
   rouge = surchargé, gris = jour non travaillé (congé, férié).
   Un clic sur une barre ouvre l'affaire dans le planning des affaires.
================================================================ */

type Segment = {
  cle: string;
  affaireId: string | null;
  libelle: string;
  detail: string;
  debut: number; // index de colonne
  fin: number;
  heures: number;
  couleur: string;
  encre: string;
  voie: number;
};

const aujourdhuiISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const LARGEUR_NOM = 170;
const HAUTEUR_VOIE = 24;

function couleurs(affaire: AffaireP | undefined): { fond: string; encre: string } {
  if (!affaire) return { fond: "#7b8189", encre: "#ffffff" }; // hors affaire
  if (affaire.imputation === "PE") return { fond: "#6f8fb3", encre: "#ffffff" };
  if (affaire.imputation === "PI") return { fond: "#6b58a8", encre: "#ffffff" };
  if (affaire.type === "DBE") return { fond: "#f2bfd0", encre: "#4a0f28" };
  return { fond: C.rouge, encre: "#ffffff" };
}

function PlanningRessourcesContenu() {
  const aujourdhui = aujourdhuiISO();
  const [lundi, setLundi] = useState(() => ajouterJours(lundiDe(aujourdhui), -7));
  const [nbSemaines, setNbSemaines] = useState(8);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [jours, setJours] = useState<JourRow[]>([]);
  const [capacites, setCapacites] = useState<Capacites>(new Map());
  const [avecEncadrement, setAvecEncadrement] = useState(false);
  const [recherche, setRecherche] = useState("");
  /* RESSOURCES_PREDOMINANCE : chacun rangé sous son activité principale (fiche Collaborateurs) */
  const [predo, setPredo] = useState<Map<string, { nom: string; ordre: number }>>(new Map());
  useEffect(() => {
    Promise.all([
      supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id,niveau"),
      supabase.from("activites").select("id,nom,ordre_affichage"),
    ])
      .then(([p, a]) => {
        if (p.error || a.error) return;
        const acts = new Map(((a.data ?? []) as { id: string; nom: string; ordre_affichage: number | null }[]).map((x) => [x.id, { nom: x.nom, ordre: x.ordre_affichage ?? 999 }]));
        const m = new Map<string, { nom: string; ordre: number }>();
        for (const x of (p.data ?? []) as { collaborateur_id: string; activite_id: string; niveau: string | null }[]) {
          if (x.niveau && x.niveau !== "PRINCIPALE") continue;
          const act = acts.get(x.activite_id);
          if (act && !m.has(x.collaborateur_id)) m.set(x.collaborateur_id, act);
        }
        setPredo(m);
      })
      .catch(() => undefined);
  }, []);

  // colonnes : jours ouvrés de la période
  const colonnes = useMemo(() => {
    const c: string[] = [];
    for (let k = 0; k < nbSemaines * 7; k++) {
      const j = ajouterJours(lundi, k);
      if (!estWeekend(j)) c.push(j);
    }
    return c;
  }, [lundi, nbSemaines]);
  const debut = colonnes[0];
  const fin = colonnes[colonnes.length - 1];

  /* REALISE_PASSE : pour les semaines passées, ce qui a été pointé (feuilles d'heures, historique, SQL 72)
     au lieu de ce qui était prévu ; « prévu » d'un clic */
  const [passe, setPasse] = useState<"REALISE" | "PREVU">("REALISE");
  const lundiActuel = lundiDe(aujourdhui);
  const [realise, setRealise] = useState<{ collaborateur_id: string; jour: string; type_affaire: string; numero: string | null; libelle: string | null; heures: number }[]>([]);
  useEffect(() => {
    const premier = colonnes[0];
    if (passe !== "REALISE" || !premier || premier >= lundiActuel) {
      setRealise([]);
      return;
    }
    const dernier = colonnes[colonnes.length - 1];
    const veille = ajouterJours(lundiActuel, -1);
    let actif = true;
    // CHARGE_SEMAINE : le réalisé est lu par paquets de 1 000 lignes (sinon tronqué quand on recule de plusieurs semaines)
    void (async () => {
      const tout: { collaborateur_id: string; jour: string; type_affaire: string; numero: string | null; libelle: string | null; heures: number | string }[] = [];
      for (let a = 0; a < 100000; a += 1000) {
        const { data, error } = await supabase.rpc("planning_realise", { p_debut: premier, p_fin: dernier < veille ? dernier : veille }).range(a, a + 999);
        if (error || !data) break;
        tout.push(...(data as typeof tout));
        if (data.length < 1000) break;
      }
      if (!actif) return;
      setRealise(tout.map((x) => ({ ...x, heures: Number(x.heures) || 0 })));
    })();
    return () => {
      actif = false;
    };
  }, [colonnes, passe, lundiActuel]);

  useEffect(() => {
    let actif = true;
    setChargement(true);
    Promise.all([chargerAnnuaire(), chargerAffaires({ horsPlanning: true }), chargerPlanifie(debut), chargerCapacitesAbsences(debut, fin)])
      .then(([an, af, pl, cap]) => {
        if (!actif) return;
        setAnnuaire(an);
        setAffaires(af);
        setAffectations(pl.affectations);
        setJours(pl.jours.filter((j) => j.jour >= debut && j.jour <= fin));
        setCapacites(construireCapacites(cap.caps, cap.absences));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [debut, fin]);

  const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);

  /* barres et charge, personne par personne */
  const lignes = useMemo(() => {
    const index = new Map(colonnes.map((j, i) => [j, i]));
    const joursParAffectation = new Map<string, { i: number; h: number }[]>();
    for (const j of jours) {
      const i = index.get(j.jour);
      const h = num(j.heures);
      if (i === undefined || h <= 0) continue;
      if (passe === "REALISE" && j.jour < lundiActuel) continue;
      const l = joursParAffectation.get(j.affectation_id) ?? [];
      l.push({ i, h });
      joursParAffectation.set(j.affectation_id, l);
    }

    const parPersonne = new Map<string, { segments: Segment[]; charge: number[] }>();
    // ACTIVITE_VENDUE : heures sur commandes (CBE : forfaits, PE, PI), par personne et par jour
    const venduPar = new Map<string, number[]>();
    const venduDe = (id: string) => {
      let v = venduPar.get(id);
      if (!v) {
        v = colonnes.map(() => 0);
        venduPar.set(id, v);
      }
      return v;
    };
    // REPARTITION_CBE_DBE_DIVERS : heures sur devis (DBE) et hors affaire (Divers), par personne et par jour
    const dbePar = new Map<string, number[]>();
    const diversPar = new Map<string, number[]>();
    const tableDe = (m: Map<string, number[]>, id: string) => {
      let v = m.get(id);
      if (!v) {
        v = colonnes.map(() => 0);
        m.set(id, v);
      }
      return v;
    };
    for (const a of affectations) {
      const js = (joursParAffectation.get(a.id) ?? []).sort((x, y) => x.i - y.i);
      if (js.length === 0) continue;
      const p = parPersonne.get(a.collaborateur_id) ?? { segments: [], charge: colonnes.map(() => 0) };
      for (const j of js) p.charge[j.i] += j.h;

      const affaire = a.affaire_id ? affairesParId.get(a.affaire_id) : undefined;
      const { fond, encre } = couleurs(affaire);
      // DEVIS_REMIS_RESSOURCES : comme au planning des affaires, un devis envoyé ou perdu n'apparaît plus
      if (affaire && affaire.type === "DBE" && affaire.statut !== "EN_COURS" && affaire.statut !== "EN_ATTENTE") {
        for (const j of js) p.charge[j.i] -= j.h;
        continue;
      }
      if (affaire?.type === "CBE") {
        const v = venduDe(a.collaborateur_id);
        for (const j of js) v[j.i] += j.h;
      } else {
        const v = tableDe(affaire?.type === "DBE" ? dbePar : diversPar, a.collaborateur_id);
        for (const j of js) v[j.i] += j.h;
      }
      const libelle = affaire ? `${affaire.type}${affaire.numero}` : a.libelle ?? "Hors affaire";
      const detail = affaire ? `${affaire.designation}${affaire.imputation ? ` · ${affaire.imputation}` : ""}` : "Hors affaire";

      // une barre par suite de jours consécutifs (les week-ends ne coupent pas une barre)
      let courant: Segment | null = null;
      for (const j of js) {
        if (courant && j.i === courant.fin + 1) {
          courant.fin = j.i;
          courant.heures += j.h;
        } else {
          if (courant) p.segments.push(courant);
          courant = { cle: `${a.id}-${j.i}`, affaireId: a.affaire_id, libelle, detail, debut: j.i, fin: j.i, heures: j.h, couleur: fond, encre, voie: 0 };
        }
      }
      if (courant) p.segments.push(courant);
      parPersonne.set(a.collaborateur_id, p);
    }

    // REALISE_PASSE : barres du réalisé (couleurs foncées), jours consécutifs regroupés
    if (passe === "REALISE" && realise.length > 0) {
      const sombre = (fond: string) =>
        fond === C.rouge ? "#6d0000" : fond === "#6f8fb3" ? "#2f4b6b" : fond === "#6b58a8" ? "#3a2d6b" : fond === "#f2bfd0" ? "#a24f73" : "#3b4046";
      const parBase = new Map<string, AffaireP>();
      for (const a of affaires) {
        const k = `${a.type}|${(a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, "")}`;
        if (/^\d+$/.test(a.numero) || !parBase.has(k)) parBase.set(k, a);
      }
      const groupes = new Map<string, { collab: string; affaire: AffaireP | undefined; libelle: string; jours: { i: number; h: number }[]; divers: Map<string, number> }>();
      for (const x of realise) {
        const i = index.get(x.jour);
        if (i === undefined || x.heures <= 0) continue;
        const affaire = x.numero ? parBase.get(`${x.type_affaire}|${x.numero}`) : undefined;
        // tout ce qui n'est ni CBE ni DBE (formations, réunions…) dans une seule case « Divers »
        const libelle = x.numero ? `${x.type_affaire}${x.numero}` : "Divers";
        const k = `${x.collaborateur_id}|${libelle}`;
        const g = groupes.get(k) ?? { collab: x.collaborateur_id, affaire, libelle, jours: [], divers: new Map<string, number>() };
        g.jours.push({ i, h: x.heures });
        if (!x.numero) g.divers.set(x.libelle ?? "Divers", (g.divers.get(x.libelle ?? "Divers") ?? 0) + x.heures);
        groupes.set(k, g);
      }
      for (const [k, g] of groupes) {
        const p = parPersonne.get(g.collab) ?? { segments: [], charge: colonnes.map(() => 0) };
        const fond = g.affaire ? couleurs(g.affaire).fond : g.libelle.startsWith("DBE") ? "#f2bfd0" : g.libelle.startsWith("CBE") ? C.rouge : "#7b8189";
        const parJour = new Map<number, number>();
        for (const j of g.jours) parJour.set(j.i, (parJour.get(j.i) ?? 0) + j.h);
        const idx = [...parJour.keys()].sort((x, y) => x - y);
        let courant: Segment | null = null;
        for (const i of idx) {
          const h = parJour.get(i) ?? 0;
          p.charge[i] += h;
          if (g.libelle.startsWith("CBE")) venduDe(g.collab)[i] += h;
          else tableDe(g.libelle.startsWith("DBE") ? dbePar : diversPar, g.collab)[i] += h;
          if (courant && i === courant.fin + 1 && i % 5 !== 0) {
            courant.fin = i;
            courant.heures += h;
          } else {
            if (courant) p.segments.push(courant);
            courant = {
              cle: `r-${k}-${i}`,
              affaireId: g.affaire?.id ?? null,
              libelle: g.libelle,
              detail:
                g.divers.size > 0
                  ? `Réalisé : ${[...g.divers].map(([l, h]) => `${l} ${formatHeures(h)}`).join(", ")}`
                  : `Réalisé (pointé)${g.affaire ? ` · ${g.affaire.designation}` : ""}`,
              debut: i,
              fin: i,
              heures: h,
              couleur: sombre(fond),
              encre: "#ffffff",
              voie: 0,
            };
          }
        }
        if (courant) p.segments.push(courant);
        parPersonne.set(g.collab, p);
      }
    }

    // REALISE_COMPACT : le réalisé d'une semaine passée tient en UNE barre par personne (détail au survol)
    for (const p of parPersonne.values()) {
      const reel = p.segments.filter((s) => s.cle.startsWith("r-"));
      if (reel.length === 0) continue;
      const autres = p.segments.filter((s) => !s.cle.startsWith("r-"));
      const parSemaine = new Map<number, Segment[]>();
      for (const s of reel) {
        const w = Math.floor(s.debut / 5);
        parSemaine.set(w, [...(parSemaine.get(w) ?? []), s]);
      }
      for (const [w, ss] of parSemaine) {
        const parLibelle = new Map<string, number>();
        for (const s of ss) parLibelle.set(s.libelle, (parLibelle.get(s.libelle) ?? 0) + s.heures);
        const tri = [...parLibelle.entries()].sort((x, y) => y[1] - x[1]);
        autres.push({
          ...ss[0],
          cle: `rs-${w}-${ss[0].cle}`,
          affaireId: null,
          libelle: `Réalisé : ${tri.map(([l, h]) => `${l.replace(/^CBE/, "")} ${formatHeures(h)}`).join(" · ")}`,
          detail: `Réalisé (pointé) :\n${tri.map(([l, h]) => `${l} : ${formatHeures(h)}`).join("\n")}`,
          debut: Math.min(...ss.map((s) => s.debut)),
          fin: Math.max(...ss.map((s) => s.fin)),
          heures: tri.reduce((t, [, h]) => t + h, 0),
          // REALISE_COULEURS : la barre est colorée en proportion : CBE rose foncé, DBE rose, Divers gris clair
          couleur: (() => {
            const total = tri.reduce((t, [, h]) => t + h, 0) || 1;
            const part = (f: (l: string) => boolean) => (tri.filter(([l]) => f(l)).reduce((t, [, h]) => t + h, 0) / total) * 100;
            const cbe = part((l) => l.startsWith("CBE"));
            const dbe = part((l) => l.startsWith("DBE"));
            return `linear-gradient(90deg, #d9849f 0% ${cbe}%, #f2bfd0 ${cbe}% ${cbe + dbe}%, #e3e5e8 ${cbe + dbe}% 100%)`;
          })(),
          encre: "#2b2f33",
          voie: 0,
        });
      }
      p.segments = autres;
    }

    // voies : deux barres qui se chevauchent sont empilées
    for (const p of parPersonne.values()) {
      p.segments.sort((x, y) => x.debut - y.debut || y.fin - x.fin);
      const finsVoies: number[] = [];
      for (const s of p.segments) {
        let v = finsVoies.findIndex((f) => f < s.debut);
        if (v < 0) {
          v = finsVoies.length;
          finsVoies.push(s.fin);
        } else finsVoies[v] = s.fin;
        s.voie = v;
      }
    }

    const q = recherche.trim().toLowerCase();
    return annuaire
      .filter((c) => avecEncadrement || c.inclus_statistiques !== false)
      .filter((c) => !q || `${c.trigramme ?? ""} ${c.prenom ?? ""} ${c.nom ?? ""}`.toLowerCase().includes(q))
      .map((c) => {
        const p = parPersonne.get(c.id) ?? { segments: [], charge: colonnes.map(() => 0) };
        const cap = capacites.get(c.id);
        const nets = colonnes.map((j) => cap?.get(j)?.net ?? 0);
        const totalAffecte = p.charge.reduce((t, h) => t + h, 0);
        const totalNet = nets.reduce((t, h) => t + h, 0);
        const voies = Math.max(1, ...p.segments.map((s) => s.voie + 1));
        const g = predo.size > 0 ? predo.get(c.id) ?? { nom: "Sans prédominance", ordre: 9999 } : { nom: "", ordre: 0 };
        return { collab: c, ...p, nets, totalAffecte, totalNet, voies, groupe: g.nom, ordreGroupe: g.ordre, vendu: venduPar.get(c.id) ?? colonnes.map(() => 0), dbe: dbePar.get(c.id) ?? colonnes.map(() => 0), divers: diversPar.get(c.id) ?? colonnes.map(() => 0) };
      })
      .sort((x, y) => x.ordreGroupe - y.ordreGroupe || (nomCollab(x.collab) ?? "").localeCompare(nomCollab(y.collab) ?? ""));
  }, [colonnes, jours, affectations, affairesParId, annuaire, capacites, avecEncadrement, recherche, predo, passe, realise, lundiActuel, affaires]);
  // toutes les lignes ont la même hauteur : celle de la personne qui a le plus de barres empilées
  const voiesMax = Math.max(1, ...lignes.map((l) => l.voies));

  /* en-tête : mois, semaines, jours */
  const mois = useMemo(() => {
    const m: { cle: string; debut: number; nb: number }[] = [];
    colonnes.forEach((j, i) => {
      const cle = j.slice(0, 7);
      const d = m[m.length - 1];
      if (d && d.cle === cle) d.nb++;
      else m.push({ cle, debut: i, nb: 1 });
    });
    return m;
  }, [colonnes]);

  const gabarit = `${LARGEUR_NOM}px repeat(${colonnes.length}, minmax(0, 1fr)) 96px`;
  // SEMAINE_ENCADREE : colonnes de la semaine en cours
  const lundiCourant = lundiDe(aujourdhui);
  const idxSemaine = colonnes.map((j, i) => (j >= lundiCourant && j <= ajouterJours(lundiCourant, 4) ? i : -1)).filter((i) => i >= 0);
  const cadreSemaine = (haut: boolean, bas: boolean): CSSProperties | null =>
    idxSemaine.length === 0
      ? null
      : {
          gridColumn: `${idxSemaine[0] + 2} / ${idxSemaine[idxSemaine.length - 1] + 3}`,
          gridRow: "1 / -1",
          borderLeft: `2px solid ${C.rouge}`,
          borderRight: `2px solid ${C.rouge}`,
          borderTop: haut ? `2px solid ${C.rouge}` : undefined,
          borderBottom: bas ? `2px solid ${C.rouge}` : undefined,
          borderRadius: haut ? "6px 6px 0 0" : bas ? "0 0 6px 6px" : undefined,
          background: "rgba(192, 0, 0, 0.035)",
          pointerEvents: "none",
          zIndex: 3,
        };
  const col = (i: number) => i + 2;
  const btn: CSSProperties = { minHeight: 36, minWidth: 36, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: "0 10px" };

  const couleurCharge = (h: number, net: number) => {
    if (net <= 0 && h <= 0) return "#eceef1";
    const r = net > 0 ? h / net : 2;
    return r <= 0.01 ? "#dff3e3" : r < 0.99 ? "#fff1c4" : r <= 1.01 ? "#ffd8a8" : "#f7b4b4";
  };

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="ressources-planning" />
      <div style={{ ...page.contenu, maxWidth: "none" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <h1 style={{ ...page.titre, margin: 0 }}>Planning par ressource</h1>
          <span style={{ fontSize: 13, color: C.gris }}>essai · consultation : on affecte toujours depuis le planning des affaires</span>
        </div>

        <div style={{ ...page.carte, padding: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12, position: "sticky", top: 50, zIndex: 20 }}>
          <button type="button" style={btn} onClick={() => setLundi(ajouterJours(lundi, -7))} aria-label="Semaine précédente">◀</button>
          <strong>
            {formatDate(debut)} → {formatDate(fin)}
          </strong>
          <button type="button" style={btn} onClick={() => setLundi(ajouterJours(lundi, 7))} aria-label="Semaine suivante">▶</button>
          <button type="button" style={btn} onClick={() => setLundi(ajouterJours(lundiDe(aujourdhui), -7))}>Aujourd’hui</button>
          <select value={nbSemaines} onChange={(e) => setNbSemaines(Number(e.target.value))} style={{ minHeight: 36, borderRadius: 8, border: "1.5px solid #b9bec5", fontFamily: "inherit", fontWeight: 700 }} aria-label="Durée affichée">
            <option value={4}>4 semaines</option>
            <option value={8}>8 semaines</option>
            <option value={13}>3 mois</option>
          </select>
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher une personne…" style={{ ...page.entrees, maxWidth: 220, minHeight: 36 }} aria-label="Rechercher une personne" />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={avecEncadrement} onChange={(e) => setAvecEncadrement(e.target.checked)} /> avec l’encadrement
          </label>
          <span
            title="Semaines passées : ce qui a été pointé (feuilles d’heures, et historique avant le 2 novembre 2026, réparti sur la semaine), en barres foncées ; ou ce qui était prévu au planning"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}
          >
            Passé :
            {(["REALISE", "PREVU"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={passe === v}
                onClick={() => setPasse(v)}
                style={{ ...btn, minWidth: 0, background: passe === v ? C.rouge : "#ffffff", color: passe === v ? "#ffffff" : C.rougeFonce, borderColor: passe === v ? C.rouge : "#b9bec5" }}
              >
                {v === "REALISE" ? "réalisé" : "prévu"}
              </button>
            ))}
          </span>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <section style={{ ...page.carte, padding: 10, minWidth: LARGEUR_NOM + 96 + colonnes.length * 22 }}>
            {/* en-tête fixe : mois, semaines, jours */}
            <div style={{ display: "grid", gridTemplateColumns: gabarit, position: "sticky", top: 112, zIndex: 15, background: "#ffffff", boxShadow: "0 4px 6px -5px rgba(0,0,0,.35)" }}>
              <div style={{ position: "sticky", left: 0, zIndex: 4, background: "#ffffff", gridColumn: 1, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: C.gris }}>Personne</div>
              {mois.map((m) => (
                <div key={m.cle} style={{ gridColumn: `${col(m.debut)} / span ${m.nb}`, gridRow: 1, textAlign: "center", fontWeight: 800, fontSize: 13, color: C.rougeFonce, borderLeft: "2px solid #b3b9c0", whiteSpace: "nowrap", overflow: "hidden", textTransform: "capitalize", padding: "3px 0" }}>
                  {m.nb >= 3 ? new Date(`${m.cle}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : ""}
                </div>
              ))}
              {colonnes.map((j, i) =>
                i % 5 === 0 ? (
                  <div key={`s-${j}`} style={{ gridColumn: `${col(i)} / span ${Math.min(5, colonnes.length - i)}`, gridRow: 2, textAlign: "center", fontWeight: 800, fontSize: 12, background: "#f1f2f4", borderLeft: `1px solid ${C.ligne}`, padding: "3px 0" }}>
                    S{numeroSemaine(j)}
                  </div>
                ) : null
              )}
              {colonnes.map((j, i) => (
                <div key={j} style={{ gridColumn: col(i), gridRow: 3, textAlign: "center", fontSize: nbSemaines > 8 ? 9 : 11, fontWeight: 700, color: j === aujourdhui ? C.rougeFonce : C.gris, background: j === aujourdhui ? "#fff4f4" : "#ffffff", padding: "2px 0", borderBottom: `1px solid ${C.ligne}` }}>
                  {Number(j.slice(8))}
                </div>
              ))}
              {cadreSemaine(true, false) && <div aria-hidden="true" title="Semaine en cours" style={{ ...cadreSemaine(true, false)!, gridRow: "2 / span 2" }} />}
              {/* ACTIVITE_VENDUE : % des heures disponibles de l'équipe affichée passées (ou prévues) sur des commandes */}
              <div
                title="Comment se répartit le temps de l’équipe affichée : commandes (CBE), devis (DBE) et interne (Divers), en part du temps disponible. Semaines passées : ce qui a été pointé ; semaines à venir : ce qui est prévu."
                style={{ gridColumn: 1, gridRow: 4, position: "sticky", left: 0, zIndex: 4, background: "#ffffff", display: "flex", alignItems: "center", padding: "3px 4px", fontSize: 12, fontWeight: 800, color: C.gris, borderTop: `1px solid ${C.ligne}` }}
              >
                {/* REPARTITION_NEUTRE */}
                Répartition
              </div>
              {(() => {
                const semaine = (w: number) => {
                  const i = w * 5;
                  const finSem = Math.min(colonnes.length, i + 5);
                  let v = 0;
                  let d = 0;
                  let db = 0;
                  let dv = 0;
                  for (const l of lignes)
                    for (let k = i; k < finSem; k++) {
                      v += l.vendu[k] ?? 0;
                      d += l.nets[k] ?? 0;
                      db += l.dbe[k] ?? 0;
                      dv += l.divers[k] ?? 0;
                    }
                  return { i, finSem, v, d, db, dv };
                };
                const semaines = Array.from({ length: Math.ceil(colonnes.length / 5) }, (_, w) => semaine(w));
                const vTotal = semaines.reduce((t, s) => t + s.v, 0);
                const dTotal = semaines.reduce((t, s) => t + s.d, 0);
                return (
                  <>
                    {semaines.map(({ i, finSem, v, d, db, dv }) => {
                      const pct = d > 0 ? v / d : 0;
                      const passee = colonnes[i] < lundiActuel;
                      return (
                        <div
                          key={`v-${colonnes[i]}`}
                          title={`S${numeroSemaine(colonnes[i])} : ${formatHeures(v)} sur commandes pour ${formatHeures(d)} disponibles (${passee ? "réalisé" : "prévu"})`}
                          style={{
                            gridColumn: `${col(i)} / span ${finSem - i}`,
                            gridRow: 4,
                            textAlign: "center",
                            padding: "3px 0",
                            fontSize: 12,
                            fontWeight: 800,
                            color: "#3b4046",
                            background: passee ? "#f1f2f4" : "#ffffff",
                            borderLeft: `1px solid ${C.ligne}`,
                            borderTop: `1px solid ${C.ligne}`,
                          }}
                        >
                          {d > 0 ? (
                            <div title={`CBE ${formatHeures(v)} · DBE ${formatHeures(db)} · Divers ${formatHeures(dv)} · disponible ${formatHeures(d)}`}>
                              <span style={{ color: "#b03a64" }}>CBE {Math.round(pct * 100)} %</span>
                              <span style={{ color: C.gris, fontWeight: 400 }}> · </span>
                              <span style={{ color: "#c2708f" }}>DBE {Math.round((db / d) * 100)} %</span>
                              <span style={{ color: C.gris, fontWeight: 400 }}> · </span>
                              <span style={{ color: "#6b7178" }}>Div. {Math.round((dv / d) * 100)} %</span>
                            </div>
                          ) : (
                            "—"
                          )}
                          <div style={{ fontWeight: 400, color: C.gris, fontSize: 10 }}>{passee ? "réalisé" : "prévu"}</div>
                        </div>
                      );
                    })}
                    <div
                      title={`Sur la période : ${formatHeures(vTotal)} sur commandes pour ${formatHeures(dTotal)} disponibles`}
                      style={{ gridColumn: colonnes.length + 2, gridRow: 4, textAlign: "right", padding: "3px 6px", fontSize: 12, fontWeight: 800, borderTop: `1px solid ${C.ligne}` }}
                    >
                      {dTotal > 0 ? `CBE ${Math.round((vTotal / dTotal) * 100)} %` : "—"}
                    </div>
                  </>
                );
              })()}
              <div style={{ gridColumn: colonnes.length + 2, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: "0 6px 6px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: C.gris, textAlign: "right" }}>
                Affecté / dispo
              </div>
            </div>

            {lignes.map((l, k) => {
              const ratio = l.totalNet > 0 ? l.totalAffecte / l.totalNet : 0;
              const cadre = cadreSemaine(false, k === lignes.length - 1);
              return (
                <Fragment key={l.collab.id}>
                {l.groupe && (k === 0 || lignes[k - 1].groupe !== l.groupe) && (() => {
                  const du = lignes.filter((x) => x.groupe === l.groupe);
                  const aff = du.reduce((t, x) => t + x.totalAffecte, 0);
                  const net = du.reduce((t, x) => t + x.totalNet, 0);
                  const r = net > 0 ? aff / net : 0;
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 6px 2px", marginTop: k === 0 ? 0 : 8, position: "sticky", left: 0 }}>
                        <strong style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: ".4px", color: C.rougeFonce }}>{l.groupe}</strong>
                        <span style={{ fontSize: 13, color: C.gris }}>
                          {du.length} personne{du.length > 1 ? "s" : ""}
                        </span>
                      </div>
                      {/* CHARGE_SEMAINE : charge de l'activité semaine par semaine (réalisé pour les semaines passées, prévu ensuite) */}
                      <div style={{ display: "grid", gridTemplateColumns: gabarit, borderBottom: `2px solid ${C.ligne}` }}>
                        <div
                          title="Charge de l’activité : heures planifiées (ou pointées, pour les semaines passées en « réalisé ») ÷ heures disponibles, congés et fériés déduits"
                          style={{ position: "sticky", left: 0, zIndex: 4, background: "#ffffff", padding: "2px 6px 4px", fontSize: 12, fontWeight: 800, color: C.gris }}
                        >
                          charge
                        </div>
                        {Array.from({ length: Math.ceil(colonnes.length / 5) }, (_, w) => {
                          const i0 = w * 5;
                          const i1 = Math.min(colonnes.length, i0 + 5);
                          let ch = 0;
                          let dispo = 0;
                          let cb = 0;
                          let db = 0;
                          let dv = 0;
                          for (const x of du)
                            for (let j2 = i0; j2 < i1; j2++) {
                              ch += x.charge[j2] ?? 0;
                              dispo += x.nets[j2] ?? 0;
                              cb += x.vendu[j2] ?? 0;
                              db += x.dbe[j2] ?? 0;
                              dv += x.divers[j2] ?? 0;
                            }
                          const rr = dispo > 0 ? ch / dispo : 0;
                          const passee = colonnes[i0] < lundiActuel;
                          return (
                            <div
                              key={`ch-${colonnes[i0]}`}
                              title={`S${numeroSemaine(colonnes[i0])} : ${formatHeures(ch)} ${passee && passe === "REALISE" ? "pointées" : "planifiées"} pour ${formatHeures(dispo)} disponibles`}
                              style={{
                                gridColumn: `${col(i0)} / span ${i1 - i0}`,
                                textAlign: "center",
                                padding: "2px 0 4px",
                                fontSize: 12,
                                fontWeight: 800,
                                color: "#3b4046",
                                background: passee ? "#f6f7f8" : undefined,
                                borderLeft: `1px solid ${C.ligne}`,
                              }}
                            >
                              {/* TROIS_PARTS : CBE / DBE / Divers en premier ; la charge totale seulement pour les semaines à venir */}
                              {dispo > 0 ? (
                                <>
                                  <div title={`CBE ${formatHeures(cb)} · DBE ${formatHeures(db)} · Divers ${formatHeures(dv)} · disponible ${formatHeures(dispo)}`}>
                                    <span style={{ color: "#b03a64" }}>CBE {Math.round((cb / dispo) * 100)} %</span>
                                    <span style={{ color: C.gris, fontWeight: 400 }}> · </span>
                                    <span style={{ color: "#c2708f" }}>DBE {Math.round((db / dispo) * 100)} %</span>
                                    <span style={{ color: C.gris, fontWeight: 400 }}> · </span>
                                    <span style={{ color: "#6b7178" }}>Div. {Math.round((dv / dispo) * 100)} %</span>
                                  </div>
                                  {!(passee && passe === "REALISE") && (
                                    <div style={{ fontSize: 10, fontWeight: 700 }}>charge prévue {Math.round(rr * 100)} %</div>
                                  )}
                                </>
                              ) : (
                                "—"
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
                <div style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: `repeat(${Math.max(2, l.voies)}, ${HAUTEUR_VOIE}px)` /* HAUTEUR_PAR_PERSONNE */, rowGap: 2, padding: "6px 0", borderBottom: `1px solid ${C.ligne}` }}>
                  <div style={{ position: "sticky", left: 0, zIndex: 4, background: "#ffffff", gridColumn: 1, gridRow: `1 / span ${Math.max(2, l.voies)}`, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 4, boxShadow: "4px 0 6px -5px rgba(0,0,0,.25)" }}>
                    <strong style={{ fontSize: 15 }}>{nomCollab(l.collab)}</strong>
                    <span style={{ fontSize: 11, color: C.gris, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${l.collab.prenom ?? ""} ${l.collab.nom ?? ""}`.trim()}</span>
                  </div>

                  {l.segments.map((s) => {
                    const nb = s.fin - s.debut + 1;
                    return (
                      <a
                        key={s.cle}
                        href={s.affaireId ? `/pilotage/affaires?ouvrir=${s.affaireId}` : undefined}
                        title={`${s.libelle} — ${s.detail}\n${formatDate(colonnes[s.debut])} → ${formatDate(colonnes[s.fin])} · ${formatHeures(s.heures)}`}
                        style={{
                          gridColumn: `${col(s.debut)} / ${col(s.fin) + 1}`,
                          gridRow: s.voie + 1,
                          margin: "0 1px",
                          borderRadius: 5,
                          background: s.couleur,
                          color: s.encre,
                          fontSize: 11,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          padding: "0 6px",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textDecoration: "none",
                          cursor: s.affaireId ? "pointer" : "default",
                        }}
                      >
                        {nb >= 3 ? `${s.libelle} · ${formatHeures(s.heures)}` : nb === 2 ? s.libelle : s.libelle.replace(/^(CBE|DBE)/, "")}
                      </a>
                    );
                  })}


                  {cadre && <div aria-hidden="true" style={{ ...cadre, margin: "-6px 0" }} />}
                  <div style={{ gridColumn: colonnes.length + 2, gridRow: `1 / span ${Math.max(2, l.voies)}`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", paddingRight: 6, fontSize: 12 }}>
                    <strong style={{ color: ratio > 1.01 ? "#b3261e" : ratio > 0.9 ? "#7a3e00" : "#1b5e20" }}>{Math.round(ratio * 100)} %</strong>
                    <span style={{ color: C.gris }}>
                      {formatHeures(l.totalAffecte)} / {formatHeures(l.totalNet)}
                    </span>
                  </div>
                </div>
                </Fragment>
              );
            })}
            {lignes.length === 0 && <p style={{ color: C.gris, padding: 8 }}>Personne à afficher.</p>}
          </section>
        )}
      </div>
    </main>
  );
}

export default function PlanningRessourcesPage() {
  return (
    <GardeAcces droit="chargeRessources">
      <PlanningRessourcesContenu />
    </GardeAcces>
  );
}
