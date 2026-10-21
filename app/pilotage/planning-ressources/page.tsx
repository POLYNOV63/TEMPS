"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
      const l = joursParAffectation.get(j.affectation_id) ?? [];
      l.push({ i, h });
      joursParAffectation.set(j.affectation_id, l);
    }

    const parPersonne = new Map<string, { segments: Segment[]; charge: number[] }>();
    for (const a of affectations) {
      const js = (joursParAffectation.get(a.id) ?? []).sort((x, y) => x.i - y.i);
      if (js.length === 0) continue;
      const p = parPersonne.get(a.collaborateur_id) ?? { segments: [], charge: colonnes.map(() => 0) };
      for (const j of js) p.charge[j.i] += j.h;

      const affaire = a.affaire_id ? affairesParId.get(a.affaire_id) : undefined;
      const { fond, encre } = couleurs(affaire);
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
        return { collab: c, ...p, nets, totalAffecte, totalNet, voies };
      })
      .sort((x, y) => (nomCollab(x.collab) ?? "").localeCompare(nomCollab(y.collab) ?? ""));
  }, [colonnes, jours, affectations, affairesParId, annuaire, capacites, avecEncadrement, recherche]);

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
          <span style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: C.gris }}>
            {[
              ["#dff3e3", "libre"],
              ["#fff1c4", "en partie"],
              ["#ffd8a8", "plein"],
              ["#f7b4b4", "surchargé"],
              ["#eceef1", "non travaillé"],
            ].map(([c, l]) => (
              <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <i style={{ display: "inline-block", width: 14, height: 10, background: c, borderRadius: 2 }} /> {l}
              </span>
            ))}
          </span>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <section style={{ ...page.carte, padding: 10 }}>
            {/* en-tête fixe : mois, semaines, jours */}
            <div style={{ display: "grid", gridTemplateColumns: gabarit, position: "sticky", top: 112, zIndex: 15, background: "#ffffff", boxShadow: "0 4px 6px -5px rgba(0,0,0,.35)" }}>
              <div style={{ gridColumn: 1, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: C.gris }}>Personne</div>
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
              <div style={{ gridColumn: colonnes.length + 2, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: "0 6px 6px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: C.gris, textAlign: "right" }}>
                Affecté / dispo
              </div>
            </div>

            {lignes.map((l) => {
              const ratio = l.totalNet > 0 ? l.totalAffecte / l.totalNet : 0;
              return (
                <div key={l.collab.id} style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: `repeat(${l.voies}, ${HAUTEUR_VOIE}px) 12px`, rowGap: 2, padding: "6px 0", borderBottom: `1px solid ${C.ligne}` }}>
                  <div style={{ gridColumn: 1, gridRow: `1 / span ${l.voies + 1}`, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 4 }}>
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

                  {colonnes.map((j, i) => (
                    <div
                      key={`c-${j}`}
                      title={`${formatDate(j)} — ${formatHeures(l.charge[i])} / ${formatHeures(l.nets[i])} disponibles`}
                      style={{ gridColumn: col(i), gridRow: l.voies + 1, margin: "0 1px", borderRadius: 2, background: couleurCharge(l.charge[i], l.nets[i]), border: l.nets[i] > 0 && l.charge[i] > l.nets[i] + 0.01 ? "1px solid #b3261e" : "none", boxSizing: "border-box" }}
                    />
                  ))}

                  <div style={{ gridColumn: colonnes.length + 2, gridRow: `1 / span ${l.voies + 1}`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", paddingRight: 6, fontSize: 12 }}>
                    <strong style={{ color: ratio > 1.01 ? "#b3261e" : ratio > 0.9 ? "#7a3e00" : "#1b5e20" }}>{Math.round(ratio * 100)} %</strong>
                    <span style={{ color: C.gris }}>
                      {formatHeures(l.totalAffecte)} / {formatHeures(l.totalNet)}
                    </span>
                  </div>
                </div>
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
