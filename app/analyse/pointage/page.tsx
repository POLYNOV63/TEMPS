"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerActivites, chargerAffaires, chargerAnnuaire, chargerCharges, chargerRealise, chargerTout, type AffaireP, type ReferentielActivites } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, nomCollab, num, type Charge, type Collab, type Realise } from "@/lib/pilotageCalculs";
import { chargerDormantes, libelleDormance, type Dormance } from "@/lib/dormantes";

/* ===============================================================
   ANALYSE DU CHIFFRÉ (commandes CBE : forfaits, PE / PI)

   « Où en est-on des heures produites face aux heures chiffrées ? »
   Une ligne par FAMILLE (commande de base + avenants : les heures sont
   pointées sur la base). Sur une période (exercice, mois, dates libres) :
   - Avant : pointé avant le début de la période ;
   - Sur la période : pointé pendant ;
   - À la fin : cumul à la fin de la période, comparé au chiffré (jauge).
   Filtre par activité : chiffré et pointé de cette seule activité.
   Pointé : feuilles d'heures et historique importé (SQL 73 pour la période).
================================================================ */

type Detail = { activite: string; nom: string; chiffre: number; pointe: number };
type Famille = {
  base: string;
  numeros: string[];
  membres: { id: string; numero: string; statut: string; chiffre: number }[];
  designation: string;
  imputation: string | null;
  statut: "EN_COURS" | "LIVREE";
  responsable: string | null;
  echeance: string | null;
  chiffre: number;
  pointe: number;
  activites: Detail[];
  codes: { code: string; heures: number }[];
  ids: string[];
};
type Agregat = { total: number; parAct: Map<string, number>; parPersonne: Map<string, number> };

const pct = (x: number) => `${Math.round(x * 100)} %`;
const sansZeros = (n: string) => String(n ?? "").replace(/^0+/, "");

function agreger(lignes: { numero: string; collaborateur_id: string; activite_id: string | null; heures: number }[]) {
  const m = new Map<string, Agregat>();
  for (const x of lignes) {
    const v = m.get(x.numero) ?? { total: 0, parAct: new Map<string, number>(), parPersonne: new Map<string, number>() };
    v.total += x.heures;
    const a = x.activite_id ?? "?";
    v.parAct.set(a, (v.parAct.get(a) ?? 0) + x.heures);
    v.parPersonne.set(x.collaborateur_id, (v.parPersonne.get(x.collaborateur_id) ?? 0) + x.heures);
    m.set(x.numero, v);
  }
  return m;
}

async function chargerPeriode(du: string, au: string) {
  // POINTE_PAGINE : lu par paquets de 1 000 lignes (un exercice entier en dépasse largement)
  const data: unknown[] = [];
  for (let a = 0; a < 200000; a += 1000) {
    const r = await supabase.rpc("pointage_periode", { p_debut: du, p_fin: au }).range(a, a + 999);
    if (r.error || !r.data) break;
    data.push(...(r.data as unknown[]));
    if (r.data.length < 1000) break;
  }
  return (data as { type_affaire: string; numero: string; collaborateur_id: string; activite_id: string | null; heures: number | string }[])
    .filter((x) => x.type_affaire === "CBE")
    .map((x) => ({ numero: sansZeros(x.numero), collaborateur_id: x.collaborateur_id, activite_id: x.activite_id, heures: Number(x.heures) || 0 }));
}

function AnalyseChiffreContenu() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [clients, setClients] = useState<Map<string, string>>(new Map());
  const [dormantes, setDormantes] = useState<Map<string, Dormance>>(new Map());

  const [vue, setVue] = useState<"EN_COURS" | "TOUTES">("EN_COURS");
  const [perimetre, setPerimetre] = useState<"FORFAITS" | "PEPI" | "TOUT">("FORFAITS");
  const [activite, setActivite] = useState("");
  const [seulementAlertes, setSeulementAlertes] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  /* AVANCEMENT_SAISI : % accompli estimé par le responsable (SQL 79), sur la commande de base de la famille */
  const [avancements, setAvancements] = useState<Map<string, { pct: number; le: string | null }>>(new Map());
  useEffect(() => {
    void supabase
      .from("pilotage_affaires")
      .select("id,avancement_pct,avancement_le")
      .not("avancement_pct", "is", null)
      .then(({ data }) =>
        setAvancements(new Map(((data ?? []) as { id: string; avancement_pct: number | string; avancement_le: string | null }[]).map((x) => [x.id, { pct: Number(x.avancement_pct) || 0, le: x.avancement_le }])))
      );
  }, []);
  /* ACHATS_RECUS : montant des achats reçus ou montés (SQL 80), sur la commande de base */
  const [achatsRecus, setAchatsRecus] = useState<Map<string, { montant: number; le: string | null }>>(new Map());
  useEffect(() => {
    void supabase
      .from("pilotage_affaires")
      .select("id,achats_recus,achats_recus_le")
      .not("achats_recus", "is", null)
      .then(({ data }) =>
        setAchatsRecus(new Map(((data ?? []) as { id: string; achats_recus: number | string; achats_recus_le: string | null }[]).map((x) => [x.id, { montant: Number(x.achats_recus) || 0, le: x.achats_recus_le }])))
      );
  }, []);
  async function enregistrerAchatsRecus(id: string, texte: string) {
    const v = texte.trim() === "" ? null : Number(texte.replace(/\s/g, "").replace(",", "."));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return setErreur("Montant des achats reçus invalide.");
    const { error } = await supabase.rpc("pilotage_maj_achats_recus", { p_affaire_id: id, p_montant: v });
    if (error) return setErreur(error.message);
    setAchatsRecus((m) => {
      const n = new Map(m);
      if (v === null) n.delete(id);
      else n.set(id, { montant: v, le: new Date().toISOString().slice(0, 10) });
      return n;
    });
  }
  async function enregistrerAvancement(id: string, texte: string) {
    const v = texte.trim() === "" ? null : Number(texte.replace(",", "."));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) return setErreur("L’avancement se donne entre 0 et 100 %.");
    const { error } = await supabase.rpc("pilotage_maj_avancement", { p_affaire_id: id, p_pct: v });
    if (error) return setErreur(error.message);
    setAvancements((m) => {
      const n = new Map(m);
      if (v === null) n.delete(id);
      else n.set(id, { pct: v, le: new Date().toISOString().slice(0, 10) });
      return n;
    });
  }

  /* ---------- période ---------- */
  const aujourdhui = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const exerciceCourant = Number(aujourdhui.slice(5, 7)) >= 11 ? Number(aujourdhui.slice(0, 4)) : Number(aujourdhui.slice(0, 4)) - 1;
  const [periode, setPeriode] = useState<{ mode: "EXERCICE" | "MOIS" | "LIBRE"; exercice: number; mois: string; du: string; au: string }>({
    mode: "EXERCICE",
    exercice: exerciceCourant,
    mois: aujourdhui.slice(0, 7),
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
  const frDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR");
  const libellePeriode = bornes ? `du ${frDate(bornes.du)} au ${frDate(bornes.au)}` : "";

  /* ---------- chargement ---------- */
  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerAffaires({ horsPlanning: true }),
      chargerCharges(),
      chargerRealise(),
      chargerAnnuaire(),
      chargerActivites(),
      chargerTout<{ base_affaire: string | null; genre: string; client_id: string | null }>((a, b) =>
        supabase.from("suivi_lignes").select("base_affaire,genre,client_id").not("client_id", "is", null).order("cle").range(a, b)
      ).catch(() => []),
      chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)).catch(() => []),
    ])
      .then(([af, ch, re, an, ref, sl, sc]) => {
        if (!actif) return;
        const cbe = af.filter((a) => a.type === "CBE");
        setAffaires(cbe);
        setCharges(ch);
        setRealise(re.filter((r) => r.type_affaire === "CBE"));
        setAnnuaire(an);
        setReferentiel(ref);
        const noms = new Map(sc.map((c) => [c.id, c.nom_abrege]));
        const m = new Map<string, string>();
        for (const l of sl) {
          const nom = l.client_id ? noms.get(l.client_id) : undefined;
          if (!nom || !l.base_affaire) continue;
          const k = sansZeros(l.base_affaire);
          if (l.genre === "BASE" || !m.has(k)) m.set(k, nom);
        }
        setClients(m);
        void chargerDormantes(cbe).then((d) => actif && setDormantes(d));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  /* ---------- pointé sur la période, et du début de la période à aujourd'hui (affaires à cheval) ---------- */
  const [surPeriode, setSurPeriode] = useState<Map<string, Agregat>>(new Map());
  const [depuisDebut, setDepuisDebut] = useState<Map<string, Agregat> | null>(null);
  useEffect(() => {
    if (!bornes) {
      setSurPeriode(new Map());
      setDepuisDebut(null);
      return;
    }
    let actif = true;
    void chargerPeriode(bornes.du, bornes.au).then((l) => actif && setSurPeriode(agreger(l)));
    if (bornes.au < aujourdhui) void chargerPeriode(bornes.du, aujourdhui).then((l) => actif && setDepuisDebut(agreger(l)));
    else setDepuisDebut(null);
    return () => {
      actif = false;
    };
  }, [bornes?.du, bornes?.au, aujourdhui]);

  const nomActivite = useMemo(() => new Map((referentiel?.activites ?? []).map((a) => [a.id, a.nom])), [referentiel]);
  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);

  /* ---------- familles (base + avenants) ---------- */
  const familles = useMemo(() => {
    const groupes = new Map<string, AffaireP[]>();
    for (const a of affaires) {
      const k = sansZeros(a.numero.match(/^\d+/)?.[0] ?? a.numero);
      groupes.set(k, [...(groupes.get(k) ?? []), a]);
    }
    const realiseParBase = new Map<string, Realise[]>();
    for (const r of realise) {
      const k = sansZeros(String(r.numero));
      realiseParBase.set(k, [...(realiseParBase.get(k) ?? []), r]);
    }
    const res: Famille[] = [];
    for (const [base, membres] of groupes) {
      const retenus = membres.filter((m) => m.statut !== "ABANDONNEE");
      if (retenus.length === 0) continue;
      retenus.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      const laBase = retenus.find((m) => /^\d+$/.test(m.numero)) ?? retenus[0];
      const parActivite = new Map<string, Detail>();
      const ligne = (id: string) => {
        if (!parActivite.has(id)) parActivite.set(id, { activite: id, nom: id === "?" ? "Sans activité" : nomActivite.get(id) ?? "Activité", chiffre: 0, pointe: 0 });
        return parActivite.get(id)!;
      };
      const ids = new Set(retenus.map((m) => m.id));
      const chiffreMembre = new Map<string, number>();
      for (const c of charges) {
        if (!ids.has(c.affaire_id)) continue;
        const d = ligne(c.activite_id);
        d.chiffre += num(c.heures);
        d.pointe += num(c.realise_initial);
        chiffreMembre.set(c.affaire_id, (chiffreMembre.get(c.affaire_id) ?? 0) + num(c.heures));
      }
      const codes = new Map<string, number>();
      for (const r of realiseParBase.get(base) ?? []) {
        ligne(r.activite_id ?? "?").pointe += num(r.heures);
        const code = (r.code ?? "—").toUpperCase();
        codes.set(code, (codes.get(code) ?? 0) + num(r.heures));
      }
      const activites = [...parActivite.values()].sort((x, y) => y.chiffre - x.chiffre || y.pointe - x.pointe);
      const chiffre = activites.reduce((t, d) => t + d.chiffre, 0);
      const pointe = activites.reduce((t, d) => t + d.pointe, 0);
      res.push({
        base,
        numeros: retenus.map((m) => m.numero),
        membres: retenus.map((m) => ({ id: m.id, numero: m.numero, statut: m.statut, chiffre: chiffreMembre.get(m.id) ?? 0 })),
        designation: laBase.designation,
        imputation: laBase.imputation,
        statut: retenus.some((m) => m.statut === "EN_COURS" || m.statut === "EN_ATTENTE") ? "EN_COURS" : "LIVREE",
        responsable: laBase.responsable_id,
        echeance: retenus.map((m) => m.echeance).filter(Boolean).sort().slice(-1)[0] ?? null,
        chiffre,
        pointe,
        activites,
        codes: [...codes.entries()].map(([code, heures]) => ({ code, heures })).sort((x, y) => y.heures - x.heures),
        ids: retenus.map((m) => m.id),
      });
    }
    return res;
  }, [affaires, charges, realise, nomActivite]);

  /* valeurs d'une famille, pour toutes les activités ou une seule */
  const valeurs = (f: Famille, act: string) => {
    const d = act ? f.activites.find((x) => x.activite === act) : undefined;
    const chiffre = act ? d?.chiffre ?? 0 : f.chiffre;
    const pointe = act ? d?.pointe ?? 0 : f.pointe;
    const p = surPeriode.get(f.base);
    const periodeH = act ? p?.parAct.get(act) ?? 0 : p?.total ?? 0;
    const dep = depuisDebut ? depuisDebut.get(f.base) : p;
    const depuisH = act ? dep?.parAct.get(act) ?? 0 : dep?.total ?? 0;
    const avant = Math.max(0, pointe - depuisH);
    return { chiffre, pointe, periode: periodeH, avant, fin: avant + periodeH };
  };

  const lignes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return familles
      .filter((f) => {
        const pepi = f.imputation === "PE" || f.imputation === "PI";
        return perimetre === "TOUT" || (perimetre === "PEPI" ? pepi : !pepi);
      })
      .map((f) => ({ f, v: valeurs(f, activite) }))
      .filter(({ f, v }) => (vue === "EN_COURS" ? f.statut === "EN_COURS" : f.statut === "EN_COURS" || v.periode > 0.01))
      .filter(({ v }) => !activite || v.chiffre > 0 || v.pointe > 0 || v.periode > 0)
      .filter(({ v }) => !seulementAlertes || (v.chiffre > 0 ? v.fin > v.chiffre + 0.5 : v.fin > 0.5))
      .filter(({ f }) => !q || `${f.numeros.join(" ")} ${f.designation} ${clients.get(f.base) ?? ""}`.toLowerCase().includes(q))
      .sort((x, y) => Number(y.f.base) - Number(x.f.base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familles, perimetre, vue, activite, seulementAlertes, recherche, clients, surPeriode, depuisDebut]);

  const totaux = useMemo(() => {
    const t = { chiffre: 0, periode: 0, fin: 0, depassees: 0 };
    for (const { v } of lignes) {
      t.chiffre += v.chiffre;
      t.periode += v.periode;
      t.fin += v.fin;
      if (v.chiffre > 0 && v.fin > v.chiffre + 0.5) t.depassees++;
    }
    // par activité, sur les affaires affichées
    const parAct = new Map<string, { nom: string; chiffre: number; periode: number; fin: number }>();
    for (const { f } of lignes)
      for (const d of f.activites) {
        if (activite && d.activite !== activite) continue;
        const v = valeurs(f, d.activite);
        const x = parAct.get(d.activite) ?? { nom: d.nom, chiffre: 0, periode: 0, fin: 0 };
        x.chiffre += v.chiffre;
        x.periode += v.periode;
        x.fin += v.fin;
        parAct.set(d.activite, x);
      }
    return { ...t, parAct: [...parAct.values()].filter((x) => x.chiffre > 0 || x.fin > 0).sort((x, y) => y.chiffre - x.chiffre) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, activite]);

  const activitesProposees = useMemo(
    () => (referentiel?.activites ?? []).filter((a) => familles.some((f) => f.activites.some((d) => d.activite === a.id))),
    [referentiel, familles]
  );

  function exporter() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        lignes.map(({ f, v }) => ({
          Affaire: `CBE${f.base}`,
          Commandes: f.numeros.join(", "),
          Client: clients.get(f.base) ?? "",
          Désignation: f.designation,
          Imputation: f.imputation ?? "",
          Activité: activite ? nomActivite.get(activite) ?? "" : "Toutes",
          "Chiffré (h)": Math.round(v.chiffre * 10) / 10,
          "Avant la période (h)": Math.round(v.avant * 10) / 10,
          "Sur la période (h)": Math.round(v.periode * 10) / 10,
          "À la fin (h)": Math.round(v.fin * 10) / 10,
          "Consommé à la fin (%)": v.chiffre > 0 ? Math.round((v.fin / v.chiffre) * 100) : "",
        }))
      ),
      "Analyse du chiffré"
    );
    XLSX.writeFile(wb, `Analyse_chiffre_${bornes?.du ?? ""}_${bornes?.au ?? ""}.xlsx`);
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
        <div style={{ width: 80, height: 8, background: "#eceef1", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", background: couleur }} />
        </div>
        <span style={{ minWidth: 40, fontWeight: 800, color: ratio > 1.0001 ? C.rougeTexte : undefined }}>{chiffre > 0 ? pct(ratio) : "—"}</span>
      </div>
    );
  };
  const libStatut = (s: string) => (s === "EN_COURS" ? "en cours" : s === "EN_ATTENTE" ? "intention" : s === "LIVREE" ? "livrée" : s.toLowerCase());

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse des affaires" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={page.titre}>Analyse du chiffré</h1>
            <p style={page.sousTitre}>Les heures produites face aux heures chiffrées, commande par commande (avenants compris).</p>
          </div>
          <button type="button" style={page.btnSecondaire} onClick={exporter} disabled={chargement}>
            Exporter en Excel
          </button>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ ...page.carte, padding: 12, display: "grid", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <strong style={{ fontSize: 14, minWidth: 80 }}>Période :</strong>
                {(
                  [
                    ["EXERCICE", "Exercice"],
                    ["MOIS", "Mois"],
                    ["LIBRE", "Dates libres"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={periode.mode === v} onClick={() => setPeriode({ ...periode, mode: v })} style={periode.mode === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
                {periode.mode === "EXERCICE" && (
                  <select value={periode.exercice} onChange={(e) => setPeriode({ ...periode, exercice: Number(e.target.value) })} style={{ ...page.entrees, width: "auto" }} aria-label="Exercice">
                    {[0, 1, 2, 3].map((k) => (
                      <option key={k} value={exerciceCourant - k}>
                        {exerciceCourant - k}-{exerciceCourant - k + 1}
                        {k === 0 ? " (en cours)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {periode.mode === "MOIS" && <input type="month" value={periode.mois} onChange={(e) => setPeriode({ ...periode, mois: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Mois" />}
                {periode.mode === "LIBRE" && (
                  <>
                    <input type="date" value={periode.du} onChange={(e) => setPeriode({ ...periode, du: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Du" />
                    <input type="date" value={periode.au} onChange={(e) => setPeriode({ ...periode, au: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Au" />
                  </>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <strong style={{ fontSize: 14, minWidth: 80 }}>Affaires :</strong>
                {(
                  [
                    ["EN_COURS", "En cours"],
                    ["TOUTES", "Toutes"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={vue === v} onClick={() => setVue(v)} style={vue === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
                <span style={{ width: 10 }} />
                {(
                  [
                    ["FORFAITS", "Forfaits"],
                    ["PEPI", "PE / PI"],
                    ["TOUT", "Forfaits + PE / PI"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={perimetre === v} onClick={() => setPerimetre(v)} style={perimetre === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
                <span style={{ width: 10 }} />
                <select value={activite} onChange={(e) => setActivite(e.target.value)} style={{ ...page.entrees, width: "auto", borderColor: activite ? C.rouge : undefined }} aria-label="Activité">
                  <option value="">Toutes les activités</option>
                  {activitesProposees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nom}
                    </option>
                  ))}
                </select>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={seulementAlertes} onChange={(e) => setSeulementAlertes(e.target.checked)} style={{ width: 18, height: 18 }} />
                  Seulement au-delà du chiffré
                </label>
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher : n°, client, désignation…" style={{ ...page.entrees, maxWidth: 260 }} aria-label="Rechercher" />
              </div>
            </div>

            {!bornes ? (
              <Message genre="info">Choisissez les deux dates de la période.</Message>
            ) : (
              <Message genre="info">
                <strong>Ce que vous regardez :</strong> les commandes {perimetre === "FORFAITS" ? "au forfait" : perimetre === "PEPI" ? "en PE / PI" : "au forfait et en PE / PI"}{" "}
                {vue === "EN_COURS" ? "en cours" : "en cours, et celles pointées sur la période"}
                {activite ? `, activité ${nomActivite.get(activite) ?? ""} seulement` : ""} ({lignes.length}), avenants regroupés avec leur commande. Pour chacune :{" "}
                <strong>Avant</strong> ce qui était pointé avant le {frDate(bornes.du)}, <strong>Sur la période</strong> ce qui l’a été {libellePeriode},{" "}
                <strong>À la fin</strong> le cumul au {frDate(bornes.au < aujourdhui ? bornes.au : aujourdhui)}, que la jauge compare au chiffré.
              </Message>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, margin: "14px 0" }}>
              <Tuile libelle="Affaires" valeur={String(lignes.length)} sous={`${formatHeures(totaux.chiffre)} chiffrées`} />
              <Tuile libelle="Sur la période" valeur={formatHeures(totaux.periode)} sous={libellePeriode || "—"} />
              <Tuile libelle="Produit à la fin" valeur={formatHeures(totaux.fin)} sous={totaux.chiffre > 0 ? `${pct(totaux.fin / totaux.chiffre)} du chiffré` : ""} />
              <Tuile libelle="Au-delà du chiffré" valeur={String(totaux.depassees)} sous="affaires dont le cumul dépasse le chiffré" accent={totaux.depassees > 0} />
            </div>

            {/* HORS_APPLICATION : heures de la période pointées sur des n° CBE que l'application ne suit pas */}
            {(() => {
              const connues = new Set(familles.map((f) => f.base));
              const inconnues = [...surPeriode.entries()].filter(([n, v]) => !connues.has(n) && v.total > 0.05).sort((x, y) => y[1].total - x[1].total);
              if (inconnues.length === 0) return null;
              const total = inconnues.reduce((t, [, v]) => t + v.total, 0);
              return (
                <p
                  style={{ margin: "-4px 0 14px", fontSize: 13, color: C.gris }}
                  title="Ces heures sont comptées dans l’Analyse de capacité (temps passé sur des commandes), mais pas ici, faute de commande connue à comparer au chiffré."
                >
                  ⓘ En plus : <strong>{formatHeures(total)}</strong> pointées sur la période sur des commandes que l’application ne suit pas (anciennes commandes, CAS,
                  commandes abandonnées ou n° mal saisis) :{" "}
                  {inconnues
                    .slice(0, 8)
                    .map(([n, v]) => `${n} (${formatHeures(v.total)})`)
                    .join(", ")}
                  {inconnues.length > 8 ? `… (+${inconnues.length - 8})` : ""}.
                </p>
              );
            })()}

            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Par activité (affaires affichées)</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Activité</th>
                    <th style={th}>Chiffré</th>
                    <th style={th}>Sur la période</th>
                    <th style={th}>À la fin</th>
                    <th style={th}>Consommé à la fin</th>
                  </tr>
                </thead>
                <tbody>
                  {totaux.parAct.map((a) => (
                    <tr key={a.nom}>
                      <td style={{ ...tdG, fontWeight: 800 }}>{a.nom}</td>
                      <td style={td}>{formatHeures(a.chiffre)}</td>
                      <td style={{ ...td, color: C.rougeFonce, fontWeight: 700 }}>{formatHeures(a.periode)}</td>
                      <td style={td}>{formatHeures(a.fin)}</td>
                      <td style={td}>{jauge(a.chiffre, a.fin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Commande par commande — les plus récentes d’abord</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Affaire</th>
                    <th style={thG}>Client</th>
                    <th style={thG}>Désignation</th>
                    <th style={thG}>Resp.</th>
                    <th style={thG}>Délai</th>
                    <th style={th}>Chiffré</th>
                    <th style={th} title="Pointé avant le début de la période">Avant</th>
                    <th style={{ ...th, color: C.rougeFonce }}>Sur la période</th>
                    <th style={th} title="Cumul à la fin de la période">À la fin</th>
                    <th style={th}>Consommé</th>
                    <th style={thG}>Alerte</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map(({ f, v }) => {
                    const ouverte = ouvertes.has(f.base);
                    const dormance = f.ids.map((id) => dormantes.get(id)).find(Boolean);
                    const p = surPeriode.get(f.base);
                    return (
                      <Fragment key={f.base}>
                        <tr>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              aria-expanded={ouverte}
                              onClick={() =>
                                setOuvertes((s) => {
                                  const n = new Set(s);
                                  if (n.has(f.base)) n.delete(f.base);
                                  else n.add(f.base);
                                  return n;
                                })
                              }
                              style={{ all: "unset", cursor: "pointer", width: 16, color: C.gris }}
                            >
                              {ouverte ? "▾" : "▸"}
                            </button>{" "}
                            <Link href={`/affaires/bilan?affaire=CBE${f.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                              {f.base}
                            </Link>
                            {f.numeros.length > 1 && (
                              <span title={f.numeros.join(", ")} style={{ marginLeft: 4, fontSize: 11, color: C.gris, fontWeight: 700 }}>
                                +{f.numeros.length - 1} av.
                              </span>
                            )}
                          </td>
                          <td style={{ ...tdG, fontWeight: 700, minWidth: 110, maxWidth: 190, overflowWrap: "anywhere" }}>{clients.get(f.base) || "—"}</td>
                          <td style={{ ...tdG, fontSize: 13, minWidth: 160, overflowWrap: "anywhere" }}>
                            {f.designation}
                            <div style={{ fontSize: 11, color: C.gris }}>{f.imputation}</div>
                          </td>
                          <td style={tdG}>{nomCollab(collabs.get(f.responsable ?? ""))}</td>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>{formatDate(f.echeance)}</td>
                          <td style={td}>{v.chiffre > 0 ? formatHeures(v.chiffre) : "—"}</td>
                          <td style={{ ...td, color: C.gris }}>{formatHeures(v.avant)}</td>
                          <td style={{ ...td, fontWeight: 800, color: C.rougeFonce }}>{formatHeures(v.periode)}</td>
                          <td style={{ ...td, fontWeight: 800 }}>{formatHeures(v.fin)}</td>
                          <td style={td}>{jauge(v.chiffre, v.fin)}</td>
                          <td style={tdG}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {v.chiffre > 0 && v.fin > v.chiffre + 0.5 && <Pastille genre="crit">+{formatHeures(v.fin - v.chiffre)}</Pastille>}
                              {v.chiffre === 0 && v.fin > 0.5 && <Pastille genre="warn">non chiffré</Pastille>}
                              {dormance && <Pastille genre="info">💤 {libelleDormance(dormance)}</Pastille>}
                              {(() => {
                                const baseId = (f.membres.find((m) => /^\d+$/.test(m.numero)) ?? f.membres[0])?.id;
                                const av = baseId ? avancements.get(baseId) : undefined;
                                return av ? <Pastille genre="info">accompli {Math.round(av.pct)} %</Pastille> : null;
                              })()}
                            </div>
                          </td>
                        </tr>
                        {ouverte && (
                          <tr>
                            <td colSpan={11} style={{ ...tdG, background: "#fafbfc", padding: "10px 16px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                                <div style={{ flex: "1 1 340px" }}>
                                  <strong>Par activité</strong>
                                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                    <tbody>
                                      {f.activites.map((d) => {
                                        const va = valeurs(f, d.activite);
                                        return (
                                          <tr key={d.activite}>
                                            <td style={{ ...tdG, padding: "4px 6px" }}>{d.nom}</td>
                                            <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(va.chiffre)} chiffrées</td>
                                            <td style={{ ...td, padding: "4px 6px", color: C.rougeFonce }}>{formatHeures(va.periode)} sur la période</td>
                                            <td style={{ ...td, padding: "4px 6px" }}>{va.chiffre > 0 ? jauge(va.chiffre, va.fin) : <Pastille genre="warn">non chiffré</Pastille>}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                {(() => {
                                  const baseId = (f.membres.find((m) => /^\d+$/.test(m.numero)) ?? f.membres[0])?.id;
                                  if (!baseId) return null;
                                  const av = avancements.get(baseId);
                                  const auxHeures = f.chiffre > 0 ? Math.min(100, Math.round((f.pointe / f.chiffre) * 100)) : null;
                                  return (
                                    <div style={{ flex: "1 1 220px" }}>
                                      <strong>Avancement accompli (estimé)</strong>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                                        <input
                                          key={`${baseId}-${av?.pct ?? ""}`}
                                          defaultValue={av ? String(av.pct) : ""}
                                          inputMode="decimal"
                                          placeholder={auxHeures !== null ? String(auxHeures) : "—"}
                                          aria-label="Avancement accompli en pourcentage"
                                          onBlur={(e) => {
                                            if (e.target.value.trim() !== (av ? String(av.pct) : "")) void enregistrerAvancement(baseId, e.target.value);
                                          }}
                                          style={{ ...page.entrees, width: 80, textAlign: "right" }}
                                        />
                                        <span>%</span>
                                      </div>
                                      <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>
                                        {av ? `Saisi le ${av.le ? formatDate(av.le) : "—"} · ` : "Non saisi : les en-cours se calculent aux heures · "}
                                        aux heures : {auxHeures !== null ? `${auxHeures} %` : "chiffré inconnu"}. Vider le champ pour revenir aux heures.
                                      </div>
                                      <strong style={{ display: "block", marginTop: 10 }}>Achats reçus ou montés</strong>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                                        <input
                                          key={`ar-${baseId}-${achatsRecus.get(baseId)?.montant ?? ""}`}
                                          defaultValue={achatsRecus.get(baseId) ? String(achatsRecus.get(baseId)?.montant) : ""}
                                          inputMode="decimal"
                                          placeholder="0"
                                          aria-label="Achats reçus ou montés, en euros"
                                          onBlur={(e) => {
                                            const actuel = achatsRecus.get(baseId) ? String(achatsRecus.get(baseId)?.montant) : "";
                                            if (e.target.value.trim() !== actuel) void enregistrerAchatsRecus(baseId, e.target.value);
                                          }}
                                          style={{ ...page.entrees, width: 110, textAlign: "right" }}
                                        />
                                        <span>€</span>
                                      </div>
                                      <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>
                                        {achatsRecus.get(baseId)?.le ? `Saisi le ${formatDate(achatsRecus.get(baseId)?.le ?? null)} · ` : ""}
                                        au prix d’achat ; seule cette part du négoce compte dans les en-cours.
                                      </div>
                                    </div>
                                  );
                                })()}
                                {f.membres.length > 1 && (
                                  <div style={{ flex: "1 1 220px" }}>
                                    <strong>Par commande</strong>
                                    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                      <tbody>
                                        {f.membres.map((m) => (
                                          <tr key={m.id}>
                                            <td style={{ ...tdG, padding: "4px 6px", fontWeight: 700 }}>{m.numero}</td>
                                            <td style={{ ...tdG, padding: "4px 6px", color: C.gris, fontSize: 12 }}>{libStatut(m.statut)}</td>
                                            <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(m.chiffre)}</td>
                                          </tr>
                                        ))}
                                        <tr>
                                          <td colSpan={2} style={{ ...tdG, padding: "4px 6px", fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>
                                            Total famille
                                          </td>
                                          <td style={{ ...td, padding: "4px 6px", fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(f.chiffre)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {p && p.parPersonne.size > 0 && (
                                  <div style={{ flex: "1 1 200px" }}>
                                    <strong>Par personne, sur la période</strong>
                                    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                      <tbody>
                                        {[...p.parPersonne.entries()]
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
                                <div style={{ flex: "1 1 160px" }}>
                                  <strong>Par code, depuis l’ouverture</strong>
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
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {lignes.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ ...tdG, color: C.gris }}>
                        Aucune commande ne correspond à ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function AnalyseChiffrePage() {
  return (
    <GardeAcces droit="indicateurs">
      <AnalyseChiffreContenu />
    </GardeAcces>
  );
}
