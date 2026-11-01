"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsCharge from "@/components/analyse/OngletsCharge";
import { BadgeType, C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerActivites, chargerAffaires, chargerAnnuaire, chargerCharges, chargerRealise, chargerTout, type AffaireP, type ReferentielActivites } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, nomCollab, num, type Charge, type Collab, type Realise } from "@/lib/pilotageCalculs";
import { chargerDormantes, libelleDormance, type Dormance } from "@/lib/dormantes";

/* ===============================================================
   ANALYSE TECHNIQUE - CHARGE & POINTAGE (ADMIN)

   « Les gars ont-ils pointé ce que j'avais chiffré ? »
   Pour chaque affaire (famille : commande de base + avenants, puisque
   les feuilles d'heures sont pointées sur la base) :
   - chiffré par activité (Suivi d'affaire BE) face au pointé par activité
     (feuilles d'heures + historique importé) ;
   - les DÉPASSEMENTS (pointé au-delà du chiffré, par activité ou au total) ;
   - le pointé sur une activité NON CHIFFRÉE ;
   - le détail par CODE d'imputation et par PERSONNE (qui a pointé quoi).
   Les PE / PI sont exclues par défaut (elles se suivent dans le relevé).
================================================================ */

type Detail = { activite: string; nom: string; chiffre: number; pointe: number };
type Famille = {
  base: string;
  type: AffaireP["type"];
  numeros: string[];
  designation: string;
  imputation: string | null;
  statut: string;
  responsable: string | null;
  echeance: string | null;
  chiffre: number;
  pointe: number;
  activites: Detail[];
  horsChiffrage: number; // pointé sur des activités non chiffrées
  codes: { code: string; heures: number }[];
};

type Ventilation = { type_affaire: string; numero: string; collaborateur_id: string; activite_id: string | null; code: string | null; heures: number };

const pct = (x: number) => `${Math.round(x * 100)} %`;

function PointageContenu() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [parPersonne, setParPersonne] = useState<Ventilation[]>([]);

  const [vue, setVue] = useState<"EN_COURS" | "LIVREES" | "TOUTES">("EN_COURS");
  const [perimetre, setPerimetre] = useState<"FORFAITS" | "PEPI" | "TOUT">("FORFAITS");
  // POINTAGE_CBE : les commandes (CBE) par défaut ; les devis (DBE) d'un clic
  const [typeAff, setTypeAff] = useState<"CBE" | "DBE" | "TOUS">("CBE");
  // activité dépliée dans « Par activité » : les affaires qui la composent
  const [activiteOuverte, setActiviteOuverte] = useState<string | null>(null);
  const [seulementAlertes, setSeulementAlertes] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  /* POINTE_PERIODE : ce qui a été pointé sur une période (SQL 73), en plus du cumul depuis l'ouverture */
  const exerciceCourant = new Date().getMonth() >= 10 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const [periode, setPeriode] = useState<{ mode: "TOUT" | "EXERCICE" | "MOIS" | "LIBRE"; exercice: number; mois: string; du: string; au: string }>({
    mode: "TOUT",
    exercice: exerciceCourant,
    mois: new Date().toISOString().slice(0, 7),
    du: "",
    au: "",
  });
  const bornes = (() => {
    if (periode.mode === "EXERCICE") return { du: `${periode.exercice}-11-01`, au: `${periode.exercice + 1}-10-31` };
    if (periode.mode === "MOIS" && periode.mois) {
      const [a, m] = periode.mois.split("-").map(Number);
      return { du: `${periode.mois}-01`, au: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) };
    }
    if (periode.mode === "LIBRE" && periode.du && periode.au && periode.du <= periode.au) return { du: periode.du, au: periode.au };
    return null;
  })();
  const periodeActive = bornes !== null;
  const frDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR");
  const libellePeriode = bornes ? `du ${frDate(bornes.du)} au ${frDate(bornes.au)}` : "";
  const [lignesPeriode, setLignesPeriode] = useState<{ type_affaire: string; numero: string; collaborateur_id: string; activite_id: string | null; heures: number }[]>([]);
  useEffect(() => {
    if (!bornes) {
      setLignesPeriode([]);
      return;
    }
    let actif = true;
    void supabase.rpc("pointage_periode", { p_debut: bornes.du, p_fin: bornes.au }).then(({ data, error }) => {
      if (!actif) return;
      setLignesPeriode(error ? [] : ((data ?? []) as { type_affaire: string; numero: string; collaborateur_id: string; activite_id: string | null; heures: number | string }[]).map((x) => ({ ...x, heures: Number(x.heures) || 0 })));
    });
    return () => {
      actif = false;
    };
  }, [bornes?.du, bornes?.au]);
  const periodeParFamille = useMemo(() => {
    const m = new Map<string, { heures: number; parPersonne: Map<string, number> }>();
    for (const x of lignesPeriode) {
      const k = `${x.type_affaire}|${x.numero}`;
      const v = m.get(k) ?? { heures: 0, parPersonne: new Map<string, number>() };
      v.heures += x.heures;
      v.parPersonne.set(x.collaborateur_id, (v.parPersonne.get(x.collaborateur_id) ?? 0) + x.heures);
      m.set(k, v);
    }
    return m;
  }, [lignesPeriode]);
  // AFFAIRES_A_CHEVAL : ce qui a été pointé du début de la période à aujourd'hui, pour retrouver « avant » et « à la fin »
  const aujourdhuiPointage = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [lignesDepuis, setLignesDepuis] = useState<{ type_affaire: string; numero: string; heures: number }[]>([]);
  useEffect(() => {
    if (!bornes || bornes.au >= aujourdhuiPointage) {
      setLignesDepuis([]);
      return;
    }
    let actif = true;
    void supabase.rpc("pointage_periode", { p_debut: bornes.du, p_fin: aujourdhuiPointage }).then(({ data, error }) => {
      if (!actif) return;
      setLignesDepuis(error ? [] : ((data ?? []) as { type_affaire: string; numero: string; heures: number | string }[]).map((x) => ({ ...x, heures: Number(x.heures) || 0 })));
    });
    return () => {
      actif = false;
    };
  }, [bornes?.du, bornes?.au, aujourdhuiPointage]);
  const depuisParFamille = useMemo(() => {
    if (!bornes || bornes.au >= aujourdhuiPointage) return null;
    const m = new Map<string, number>();
    for (const x of lignesDepuis) m.set(`${x.type_affaire}|${x.numero}`, (m.get(`${x.type_affaire}|${x.numero}`) ?? 0) + x.heures);
    return m;
  }, [lignesDepuis, bornes?.du, bornes?.au, aujourdhuiPointage]);

  const devisPeriode = useMemo(() => {
    let n = 0;
    let h = 0;
    for (const [k, v] of periodeParFamille) if (k.startsWith("DBE|") && v.heures > 0.01) {
      n++;
      h += v.heures;
    }
    return { n, h };
  }, [periodeParFamille]);
  /* CLIENT_POINTAGE : client (nom abrégé du Suivi d'affaire) par affaire, « CBE|1750 » ; PE / PI dormantes */
  const [clientsParBase, setClientsParBase] = useState<Map<string, string>>(new Map());
  const [dormantes, setDormantes] = useState<Map<string, Dormance>>(new Map());
  useEffect(() => {
    Promise.all([
      chargerTout<{ base_affaire: string | null; base_devis: string | null; genre: string; client_id: string | null }>((a, b) =>
        supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id").not("client_id", "is", null).order("cle").range(a, b)
      ),
      chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
    ])
      .then(([sl, sc]) => {
        const noms = new Map(sc.map((c) => [c.id, c.nom_abrege]));
        const m = new Map<string, string>();
        for (const l of sl) {
          const nom = l.client_id ? noms.get(l.client_id) : undefined;
          if (!nom) continue;
          if (l.base_affaire) {
            const k = `CBE|${l.base_affaire.replace(/^0+/, "")}`;
            if (l.genre === "BASE" || !m.has(k)) m.set(k, nom);
          }
          if (l.base_devis) {
            const k = `DBE|${l.base_devis.replace(/^0+/, "")}`;
            if (!m.has(k)) m.set(k, nom);
          }
        }
        setClientsParBase(m);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (affaires.length === 0) return;
    void chargerDormantes(affaires).then(setDormantes);
  }, [affaires]);
  const clientDe = (f: { type: string; base: string }) => clientsParBase.get(`${f.type}|${f.base.replace(/^0+/, "")}`) ?? "";
  // une famille est dormante si l'une de ses commandes en cours l'est
  const dormanceDe = (f: { type: string; base: string }) => {
    for (const a of affaires) {
      if (a.type !== f.type || (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, "") !== f.base.replace(/^0+/, "")) continue;
      const d = dormantes.get(a.id);
      if (d) return d;
    }
    return null;
  };

  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerAffaires({ horsPlanning: true }),
      chargerCharges(),
      chargerRealise(),
      chargerAnnuaire(),
      chargerActivites(),
      chargerTout<Ventilation>((a, b) => supabase.rpc("pointage_par_personne").range(a, b)).catch(() => [] as Ventilation[]),
    ])
      .then(([af, ch, re, an, ref, pp]) => {
        if (!actif) return;
        setAffaires(af);
        setCharges(ch);
        setRealise(re);
        setAnnuaire(an);
        setReferentiel(ref);
        setParPersonne(pp);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const nomActivite = useMemo(() => new Map((referentiel?.activites ?? []).map((a) => [a.id, a.nom])), [referentiel]);
  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);

  /* ---------- familles (base + avenants) ---------- */
  const familles = useMemo(() => {
    const groupes = new Map<string, AffaireP[]>();
    for (const a of affaires) {
      const base = a.numero.match(/^\d+/)?.[0] ?? a.numero;
      const k = `${a.type}|${base.replace(/^0+/, "")}`;
      groupes.set(k, [...(groupes.get(k) ?? []), a]);
    }
    const realiseParCle = new Map<string, Realise[]>();
    for (const r of realise) {
      const k = `${r.type_affaire}|${String(r.numero).replace(/^0+/, "")}`;
      realiseParCle.set(k, [...(realiseParCle.get(k) ?? []), r]);
    }

    const res: Famille[] = [];
    for (const [k, membres] of groupes) {
      const retenus = membres.filter((m) => m.statut !== "ABANDONNEE");
      if (retenus.length === 0) continue;
      membres.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      const base = membres.find((m) => /^\d+$/.test(m.numero)) ?? membres[0];
      const enCours = retenus.some((m) => m.statut === "EN_COURS" || m.statut === "EN_ATTENTE");

      const parActivite = new Map<string, Detail>();
      const ligne = (id: string) => {
        if (!parActivite.has(id)) parActivite.set(id, { activite: id, nom: id === "?" ? "Sans activité" : nomActivite.get(id) ?? "Activité", chiffre: 0, pointe: 0 });
        return parActivite.get(id)!;
      };
      const ids = new Set(retenus.map((m) => m.id));
      for (const c of charges) {
        if (!ids.has(c.affaire_id)) continue;
        const d = ligne(c.activite_id);
        d.chiffre += num(c.heures);
        d.pointe += num(c.realise_initial);
      }
      const codes = new Map<string, number>();
      for (const r of realiseParCle.get(k) ?? []) {
        ligne(r.activite_id ?? "?").pointe += num(r.heures);
        const code = (r.code ?? "—").toUpperCase();
        codes.set(code, (codes.get(code) ?? 0) + num(r.heures));
      }
      const activites = [...parActivite.values()].sort((x, y) => y.chiffre - x.chiffre || y.pointe - x.pointe);
      const chiffre = activites.reduce((t, d) => t + d.chiffre, 0);
      const pointe = activites.reduce((t, d) => t + d.pointe, 0);
      if (chiffre === 0 && pointe === 0) continue;

      res.push({
        base: base.numero.match(/^\d+/)?.[0] ?? base.numero,
        type: base.type,
        numeros: membres.map((m) => m.numero),
        designation: base.designation,
        imputation: base.imputation,
        statut: enCours ? "EN_COURS" : "LIVREE",
        responsable: base.responsable_id,
        echeance: retenus.map((m) => m.echeance).filter(Boolean).sort().slice(-1)[0] ?? null,
        chiffre,
        pointe,
        activites,
        horsChiffrage: activites.filter((d) => d.chiffre === 0).reduce((t, d) => t + d.pointe, 0),
        codes: [...codes.entries()].map(([code, heures]) => ({ code, heures })).sort((x, y) => y.heures - x.heures),
      });
    }
    return res;
  }, [affaires, charges, realise, nomActivite]);

  const affichees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return familles
      .filter((f) => {
        const pepi = f.imputation === "PE" || f.imputation === "PI";
        return perimetre === "TOUT" || (perimetre === "PEPI" ? pepi : !pepi);
      })
      .filter((f) => typeAff === "TOUS" || f.type === typeAff)
      .filter((f) => !periodeActive || (periodeParFamille.get(`${f.type}|${f.base.replace(/^0+/, "")}`)?.heures ?? 0) > 0.01)
      .filter((f) => vue === "TOUTES" || (vue === "EN_COURS" ? f.statut === "EN_COURS" : f.statut === "LIVREE"))
      .filter((f) => !seulementAlertes || f.pointe > f.chiffre + 0.5 || f.horsChiffrage > 0.5 || f.activites.some((d) => d.chiffre > 0 && d.pointe > d.chiffre + 0.5))
      .filter((f) => !q || `${f.type}${f.base} ${f.designation} ${clientDe(f)}`.toLowerCase().includes(q))
      // POINTAGE_LISIBLE : les plus récentes (n° le plus grand) en haut
      .sort((x, y) => Number(y.base) - Number(x.base) || y.base.localeCompare(x.base, "fr", { numeric: true }));
  }, [familles, perimetre, vue, seulementAlertes, recherche, typeAff, periodeActive, periodeParFamille]);

  const totaux = useMemo(() => {
    const chiffre = affichees.reduce((t, f) => t + f.chiffre, 0);
    const pointe = affichees.reduce((t, f) => t + f.pointe, 0);
    const depassees = affichees.filter((f) => f.chiffre > 0 && f.pointe > f.chiffre + 0.5).length;
    const hors = affichees.reduce((t, f) => t + f.horsChiffrage, 0);
    // par activité, toutes affaires affichées
    const parAct = new Map<string, { nom: string; chiffre: number; pointe: number }>();
    for (const f of affichees)
      for (const d of f.activites) {
        const v = parAct.get(d.nom) ?? { nom: d.nom, chiffre: 0, pointe: 0 };
        v.chiffre += d.chiffre;
        v.pointe += d.pointe;
        parAct.set(d.nom, v);
      }
    return { chiffre, pointe, depassees, hors, parAct: [...parAct.values()].sort((x, y) => y.chiffre - x.chiffre) };
  }, [affichees]);

  function exporter() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        affichees.flatMap((f) =>
          f.activites.map((d) => ({
            Affaire: `${f.type}${f.base}`,
            Commandes: f.numeros.join(", "),
            Désignation: f.designation,
            Imputation: f.imputation ?? "",
            Statut: f.statut === "EN_COURS" ? "En cours" : "Livrée",
            Activité: d.nom,
            "Chiffré (h)": Math.round(d.chiffre * 10) / 10,
            "Pointé (h)": Math.round(d.pointe * 10) / 10,
            "Écart (h)": Math.round((d.pointe - d.chiffre) * 10) / 10,
            "Consommé (%)": d.chiffre > 0 ? Math.round((d.pointe / d.chiffre) * 100) : "",
          }))
        )
      ),
      "Pointé vs chiffré"
    );
    XLSX.writeFile(wb, `Pointage_vs_chiffre_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const th: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap" };
  const thG: CSSProperties = { ...th, textAlign: "left" };
  const td: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap" };
  const tdG: CSSProperties = { ...page.td, textAlign: "left" };

  const jauge = (chiffre: number, pointe: number) => {
    const ratio = chiffre > 0 ? pointe / chiffre : pointe > 0 ? 2 : 0;
    const couleur = ratio > 1.0001 ? "#c62828" : ratio > 0.9 ? "#e08a00" : "#2e7d32";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        <div style={{ width: 90, height: 8, background: "#eceef1", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", background: couleur }} />
        </div>
        <span style={{ minWidth: 42, fontWeight: 800, color: ratio > 1.0001 ? C.rougeTexte : undefined }}>{chiffre > 0 ? pct(ratio) : "—"}</span>
      </div>
    );
  };

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse technique" />
      
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={page.titre}>Pointé / chiffré</h1>
            <p style={page.sousTitre}>
              Ce qui a été pointé (feuilles d’heures et historique) face à ce qui a été chiffré, affaire par affaire et activité par activité. Une
              affaire regroupe sa commande de base et ses avenants : les heures sont pointées sur la base.
            </p>
          </div>
          <button type="button" style={page.btnSecondaire} onClick={exporter} disabled={chargement}>
            Exporter en Excel
          </button>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ ...page.carte, padding: 12, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {(
                  [
                    ["EN_COURS", "En cours"],
                    ["LIVREES", "Livrées"],
                    ["TOUTES", "Toutes"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setVue(v)} style={vue === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={seulementAlertes} onChange={(e) => setSeulementAlertes(e.target.checked)} style={{ width: 18, height: 18 }} />
                Seulement les dépassements et le hors chiffrage
              </label>
              <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Affaires montrées">
                {(
                  [
                    ["FORFAITS", "Forfaits"],
                    ["PEPI", "PE / PI"],
                    ["TOUT", "Tout"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={perimetre === v} onClick={() => setPerimetre(v)} style={perimetre === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Commandes ou devis">
                {(
                  [
                    ["CBE", "CBE"],
                    ["DBE", "DBE"],
                    ["TOUS", "CBE + DBE"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={typeAff === v} onClick={() => setTypeAff(v)} style={typeAff === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} role="group" aria-label="Période">
                <strong style={{ fontSize: 14 }}>Période :</strong>
                {(
                  [
                    ["TOUT", "Depuis l’ouverture"],
                    ["EXERCICE", "Exercice"],
                    ["MOIS", "Mois"],
                    ["LIBRE", "Dates libres"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={periode.mode === v} onClick={() => {
                      setPeriode({ ...periode, mode: v });
                      // un devis envoyé ou une commande livrée ont pu être travaillés sur la période
                      if (v !== "TOUT") setVue("TOUTES");
                    }} style={periode.mode === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
                {periode.mode === "EXERCICE" && (
                  <select value={periode.exercice} onChange={(e) => setPeriode({ ...periode, exercice: Number(e.target.value) })} style={{ ...page.entrees, width: "auto" }} aria-label="Exercice">
                    {[0, 1, 2, 3].map((k) => (
                      <option key={k} value={exerciceCourant - k}>
                        {exerciceCourant - k}-{exerciceCourant - k + 1}
                      </option>
                    ))}
                  </select>
                )}
                {periode.mode === "MOIS" && (
                  <input type="month" value={periode.mois} onChange={(e) => setPeriode({ ...periode, mois: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Mois" />
                )}
                {periode.mode === "LIBRE" && (
                  <>
                    <input type="date" value={periode.du} onChange={(e) => setPeriode({ ...periode, du: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Du" />
                    <input type="date" value={periode.au} onChange={(e) => setPeriode({ ...periode, au: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Au" />
                  </>
                )}
              </div>
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher une affaire…" style={{ ...page.entrees, maxWidth: 240 }} aria-label="Rechercher" />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Affaires" valeur={String(affichees.length)} sous={`${formatHeures(totaux.chiffre)} chiffrées`} />
              <Tuile libelle="Pointé" valeur={formatHeures(totaux.pointe)} sous={totaux.chiffre > 0 ? `${pct(totaux.pointe / totaux.chiffre)} du chiffré` : ""} />
              <Tuile libelle="Au-delà du chiffré" valeur={String(totaux.depassees)} sous="affaires dont le pointé dépasse le chiffré" accent={totaux.depassees > 0} />
              {periodeActive && (
                <Tuile
                  libelle="Pointé sur la période"
                  valeur={formatHeures(affichees.reduce((t, f) => t + (periodeParFamille.get(`${f.type}|${f.base.replace(/^0+/, "")}`)?.heures ?? 0), 0))}
                  sous={`${affichees.length} affaire${affichees.length > 1 ? "s" : ""} · ${libellePeriode}`}
                />
              )}
              {periodeActive && (
                (() => {
                  // DEVIS_COHERENTS : les devis de la liste (mêmes filtres), et le total de tous les devis pointés pour comparaison
                  const dbe = affichees.filter((f) => f.type === "DBE");
                  const h = dbe.reduce((t, f) => t + (periodeParFamille.get(`DBE|${f.base.replace(/^0+/, "")}`)?.heures ?? 0), 0);
                  return (
                    <Tuile
                      libelle="Devis travaillés"
                      valeur={String(dbe.length)}
                      sous={`${formatHeures(h)} passées · ${libellePeriode}${devisPeriode.n !== dbe.length ? ` · ${devisPeriode.n} devis pointés en tout (${formatHeures(devisPeriode.h)}), tous filtres confondus` : ""}`}
                    />
                  );
                })()
              )}
            </div>

            {(() => {
              const types = new Set(affichees.map((f) => f.type));
              const quoi = types.size === 1 ? (types.has("DBE") ? "les devis (DBE)" : "les commandes (CBE)") : "les commandes (CBE) et les devis (DBE)";
              const etat = vue === "EN_COURS" ? "en cours" : vue === "LIVREES" ? "livrées" : "en cours et livrées";
              const genre = perimetre === "FORFAITS" ? " au forfait" : perimetre === "PEPI" ? " en PE / PI" : "";
              return (
                <Message genre="info">
                  <strong>Ce que vous regardez :</strong> {quoi}
                  {genre} {etat} ({affichees.length}). {periodeActive ? (
                    <>
                      Pour chaque affaire pointée {libellePeriode} : <strong>« Avant »</strong> ce qui l’avait été avant la période, <strong>« Sur la période »</strong>
                      ce qui l’a été pendant, <strong>« À la fin »</strong> le cumul à la fin de la période, que la jauge compare au chiffré. Une affaire à cheval
                      sur la période y est donc comptée pour sa seule part. Sans période, on voit
                    </>
                  ) : (
                    "Pour chacune,"
                  )}{" "}
                  <strong>tout ce qui a été pointé depuis son ouverture</strong>, jusqu’au{" "}
                  {new Date().toLocaleDateString("fr-FR")} (feuilles d’heures, et historique avant le 2 novembre 2026), face à ses heures chiffrées. Une affaire
                  regroupe sa commande de base et ses avenants.
                </Message>
              );
            })()}

            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Par activité (affaires affichées)</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Activité</th>
                    <th style={th}>Chiffré</th>
                    <th style={th}>Pointé</th>
                    <th style={th}>Écart</th>
                    <th style={th}>Consommé</th>
                  </tr>
                </thead>
                <tbody>
                  {totaux.parAct.map((a) => {
                    const ouverte = activiteOuverte === a.nom;
                    const composition = ouverte
                      ? affichees
                          .map((f) => ({ f, d: f.activites.find((x) => x.nom === a.nom) }))
                          .filter((x): x is { f: Famille; d: Detail } => Boolean(x.d) && (x.d!.chiffre > 0 || x.d!.pointe > 0))
                          .sort((x, y) => y.d.pointe - x.d.pointe)
                      : [];
                    return (
                      <Fragment key={a.nom}>
                        <tr>
                          <td style={{ ...tdG, fontWeight: 800 }}>
                            <button
                              type="button"
                              aria-expanded={ouverte}
                              onClick={() => setActiviteOuverte(ouverte ? null : a.nom)}
                              title="Voir les affaires qui composent cette activité"
                              style={{ all: "unset", cursor: "pointer", fontWeight: 800 }}
                            >
                              <span style={{ color: C.gris, display: "inline-block", width: 16 }}>{ouverte ? "▾" : "▸"}</span>
                              {a.nom}
                            </button>
                          </td>
                          <td style={td}>{formatHeures(a.chiffre)}</td>
                          <td style={td}>{formatHeures(a.pointe)}</td>
                          <td style={{ ...td, color: a.pointe > a.chiffre ? C.rougeTexte : undefined, fontWeight: 700 }}>
                            {a.pointe - a.chiffre > 0 ? "+" : ""}
                            {formatHeures(a.pointe - a.chiffre)}
                          </td>
                          <td style={td}>{jauge(a.chiffre, a.pointe)}</td>
                        </tr>
                        {ouverte &&
                          composition.map(({ f, d }) => (
                            <tr key={`${a.nom}-${f.type}${f.base}`} style={{ background: "#fafbfc" }}>
                              <td style={{ ...tdG, paddingLeft: 30, fontSize: 13 }}>
                                <Link href={`/affaires/bilan?affaire=${f.type}${f.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                                  {f.type}
                                  {f.base}
                                </Link>{" "}
                                <span style={{ color: C.gris }}>{f.designation}</span>
                              </td>
                              <td style={{ ...td, fontSize: 13 }}>{d.chiffre > 0 ? formatHeures(d.chiffre) : "—"}</td>
                              <td style={{ ...td, fontSize: 13 }}>{formatHeures(d.pointe)}</td>
                              <td style={{ ...td, fontSize: 13, color: d.pointe > d.chiffre + 0.5 ? C.rougeTexte : undefined }}>
                                {d.chiffre > 0 ? `${d.pointe - d.chiffre > 0 ? "+" : ""}${formatHeures(d.pointe - d.chiffre)}` : "hors chiffrage"}
                              </td>
                              <td style={td}>{d.chiffre > 0 ? jauge(d.chiffre, d.pointe) : null}</td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Affaire par affaire — les plus récentes d’abord</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Affaire</th>
                    <th style={thG}>Client</th>
                    <th style={thG}>Désignation</th>
                    <th style={thG}>Resp.</th>
                    <th style={thG}>Échéance</th>
                    <th style={th}>Chiffré</th>
                    {periodeActive ? (
                      <>
                        <th style={th} title="Pointé avant le début de la période">Avant</th>
                        <th style={{ ...th, color: C.rougeFonce }}>Sur la période</th>
                        <th style={th} title="Cumul à la fin de la période (avant + sur la période)">À la fin</th>
                      </>
                    ) : (
                      <th style={th}>Pointé</th>
                    )}
                    <th style={th}>{affichees.every((f) => f.type === "DBE") ? "Passées par" : "Consommé"}</th>
                    <th style={thG}>Alerte</th>
                  </tr>
                </thead>
                <tbody>
                  {affichees.map((f) => {
                    const cle = `${f.type}${f.base}`;
                    const ouverte = ouvertes.has(cle);
                    const actDepassees = f.activites.filter((d) => d.chiffre > 0 && d.pointe > d.chiffre + 0.5);
                    const personnes = parPersonne
                      .filter((p) => p.type_affaire === f.type && String(p.numero).replace(/^0+/, "") === f.base.replace(/^0+/, ""))
                      .reduce((m, p) => m.set(p.collaborateur_id, (m.get(p.collaborateur_id) ?? 0) + num(p.heures)), new Map<string, number>());
                    const surPeriode = periodeParFamille.get(`${f.type}|${f.base.replace(/^0+/, "")}`);
                    const depuisDebut = depuisParFamille ? depuisParFamille.get(`${f.type}|${f.base.replace(/^0+/, "")}`) ?? 0 : surPeriode?.heures ?? 0;
                    const avantPeriode = Math.max(0, f.pointe - depuisDebut);
                    const finPeriode = avantPeriode + (surPeriode?.heures ?? 0);
                    return (
                      <Fragment key={cle}>
                        <tr>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              aria-expanded={ouverte}
                              onClick={() =>
                                setOuvertes((s) => {
                                  const n = new Set(s);
                                  if (n.has(cle)) n.delete(cle);
                                  else n.add(cle);
                                  return n;
                                })
                              }
                              style={{ all: "unset", cursor: "pointer", width: 18, color: C.gris }}
                            >
                              {ouverte ? "▾" : "▸"}
                            </button>{" "}
                            <BadgeType type={f.type} />{" "}
                            <Link href={`/affaires/bilan?affaire=${cle}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                              {f.base}
                            </Link>
                            {f.numeros.length > 1 && <div style={{ fontSize: 11, color: C.gris, paddingLeft: 22 }}>{f.numeros.join(", ")}</div>}
                          </td>
                          <td style={{ ...tdG, fontWeight: 700 }}>{clientDe(f) || "—"}</td>
                          <td style={tdG}>
                            {f.designation}
                            <div style={{ fontSize: 11, color: C.gris }}>{f.imputation}</div>
                          </td>
                          <td style={tdG}>{nomCollab(collabs.get(f.responsable ?? ""))}</td>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>{formatDate(f.echeance)}</td>
                          <td style={td}>{formatHeures(f.chiffre)}</td>
                          {periodeActive ? (
                            <>
                              <td style={{ ...td, color: C.gris }}>{formatHeures(avantPeriode)}</td>
                              <td style={{ ...td, fontWeight: 800, color: C.rougeFonce }}>{formatHeures(surPeriode?.heures ?? 0)}</td>
                              <td style={{ ...td, fontWeight: 800 }}>{formatHeures(finPeriode)}</td>
                            </>
                          ) : (
                            <td style={{ ...td, fontWeight: 800 }}>{formatHeures(f.pointe)}</td>
                          )}
                          {f.type === "DBE" ? (
                            <td style={{ ...tdG, fontSize: 13 }} title="Heures pointées sur le devis, par personne">
                              {[...(periodeActive ? surPeriode?.parPersonne ?? new Map<string, number>() : personnes).entries()]
                                .sort((x, y) => y[1] - x[1])
                                .map(([id, h]) => `${nomCollab(collabs.get(id))} ${formatHeures(h)}`)
                                .join(" · ") || "—"}
                            </td>
                          ) : (
                            <td style={td}>{jauge(f.chiffre, periodeActive ? finPeriode : f.pointe)}</td>
                          )}
                          <td style={tdG}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {f.chiffre > 0 && f.pointe > f.chiffre + 0.5 && <Pastille genre="crit">+{formatHeures(f.pointe - f.chiffre)}</Pastille>}
                              {actDepassees.length > 0 && <Pastille genre="warn">{actDepassees.map((d) => d.nom).join(", ")} au-delà</Pastille>}
                              {f.horsChiffrage > 0.5 && <Pastille genre="warn">{formatHeures(f.horsChiffrage)} hors chiffrage</Pastille>}
                              {f.chiffre === 0 && <Pastille genre="info">non chiffrée</Pastille>}
                              {(() => {
                                const d = dormanceDe(f);
                                return d ? <Pastille genre="info">💤 {libelleDormance(d)}</Pastille> : null;
                              })()}
                            </div>
                          </td>
                        </tr>
                        {ouverte && (
                          <tr>
                            <td colSpan={periodeActive ? 11 : 9} style={{ ...tdG, background: "#fafbfc", padding: "10px 16px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                                <div style={{ flex: "1 1 360px" }}>
                                  <strong>Par activité</strong>
                                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                    <tbody>
                                      {f.activites.map((d) => (
                                        <tr key={d.activite}>
                                          <td style={{ ...tdG, padding: "4px 6px" }}>{d.nom}</td>
                                          <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(d.chiffre)} chiffrées</td>
                                          <td style={{ ...td, padding: "4px 6px", fontWeight: 700, color: d.pointe > d.chiffre + 0.5 ? C.rougeTexte : undefined }}>{formatHeures(d.pointe)} pointées</td>
                                          <td style={{ ...td, padding: "4px 6px" }}>{d.chiffre > 0 ? jauge(d.chiffre, d.pointe) : <Pastille genre="warn">hors chiffrage</Pastille>}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {/* FAMILLE_POINTAGE : chiffré de chaque commande (base, avenants), total, consommé de la famille */}
                                {(() => {
                                  const membres = affaires
                                    .filter((a) => a.type === f.type && a.statut !== "ABANDONNEE" && (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, "") === f.base.replace(/^0+/, ""))
                                    .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }))
                                    .map((a) => ({ a, chiffre: charges.filter((c) => c.affaire_id === a.id).reduce((t, c) => t + num(c.heures), 0) }));
                                  if (membres.length < 2) return null;
                                  const libStatut = (s: string) => (s === "EN_COURS" ? "en cours" : s === "EN_ATTENTE" ? "intention" : s === "LIVREE" ? "livrée" : s.toLowerCase());
                                  return (
                                    <div style={{ flex: "1 1 240px" }}>
                                      <strong>Par commande</strong>
                                      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                        <tbody>
                                          {membres.map(({ a, chiffre }) => (
                                            <tr key={a.id}>
                                              <td style={{ ...tdG, padding: "4px 6px", fontWeight: 700 }}>{a.numero}</td>
                                              <td style={{ ...tdG, padding: "4px 6px", color: C.gris, fontSize: 12 }}>{libStatut(a.statut)}</td>
                                              <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(chiffre)}</td>
                                            </tr>
                                          ))}
                                          <tr>
                                            <td style={{ ...tdG, padding: "4px 6px", fontWeight: 800, borderTop: `2px solid ${C.ligne}` }} colSpan={2}>
                                              Total famille
                                            </td>
                                            <td style={{ ...td, padding: "4px 6px", fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(f.chiffre)}</td>
                                          </tr>
                                          <tr>
                                            <td style={{ ...tdG, padding: "4px 6px" }} colSpan={2}>
                                              Pointé sur la famille
                                            </td>
                                            <td style={{ ...td, padding: "4px 6px", fontWeight: 800, color: f.pointe > f.chiffre + 0.5 ? C.rougeTexte : undefined }}>
                                              {formatHeures(f.pointe)}
                                              {f.chiffre > 0 ? ` · ${pct(f.pointe / f.chiffre)}` : ""}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })()}
                                <div style={{ flex: "1 1 200px" }}>
                                  <strong>Par code</strong>
                                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                    <tbody>
                                      {f.codes.map((c) => (
                                        <tr key={c.code}>
                                          <td style={{ ...tdG, padding: "4px 6px", fontWeight: 700 }}>{c.code}</td>
                                          <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(c.heures)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {personnes.size > 0 && (
                                  <div style={{ flex: "1 1 200px" }}>
                                    <strong>Par personne</strong>
                                    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                      <tbody>
                                        {[...personnes.entries()]
                                          .sort((x, y) => y[1] - x[1])
                                          .map(([id, h]) => (
                                            <tr key={id}>
                                              <td style={{ ...tdG, padding: "4px 6px", fontWeight: 700 }}>{nomCollab(collabs.get(id))}</td>
                                              <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(h)}</td>
                                            </tr>
                                          ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function PointagePage() {
  return (
    <GardeAcces droit="indicateurs">
      <PointageContenu />
    </GardeAcces>
  );
}
