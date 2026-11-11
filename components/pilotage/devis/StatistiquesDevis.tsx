"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { aujourdhuiISO, formatDate, formatHeures } from "@/lib/pilotageCalculs";
import { type Issue, type LigneInd } from "@/lib/indicateurs";
import { categorieDevis } from "@/lib/suiviDevis";

/* ===============================================================
   SUIVI DES DEVIS - ONGLET STATISTIQUES (SUIVI_DEVIS)
   Reprise à l'identique des anciens « Indicateurs commerciaux »
   (INDICATEURS_V2, ACTIVITES_NEGOCE, NEGOCE_INTERGROUPE, DEVIS_FERMES,
   DETAIL_AUTRE, NAVIGATION_AXES), sans l'en-tête de page.

   Une CONSULTATION = un n° de devis (DBE…) du Suivi d'affaire BE, compté
   UNE fois, au mois de son OUVERTURE (la date d'envoi n'est pas fiable :
   les devis classés « perdus » en masse reçoivent une date d'envoi le jour
   du classement). Avenants chiffrés compris (ils ont leur n° de devis).
   - Issue : d'après le statut du classeur, comme l'onglet Liste (lib/suiviDevis.ts) :
     remporté (Commande reçue, Livrée, Commande annulée), perdu, sans réponse.
     Un devis d'avenant est traité comme un autre (AVENANT_COMME_DEVIS).
   - Taux de transformation = remportés ÷ (remportés + perdus).
   - Activité d'une consultation : celle qui a le plus d'heures chiffrées ;
     son montant est réparti entre ses activités au prorata des heures.
   Montants : visibles des profils qui y ont droit ; sinon, en heures.
================================================================ */

/* ACTIVITES_NEGOCE : les activités du Suivi d'affaire, négoce compris (il n'a pas d'heures, mais un montant) */
type Discipline = "meca" | "calcul" | "elec" | "scan" | "negoce" | "autre";
const DISCIPLINES: Discipline[] = ["meca", "calcul", "elec", "scan", "negoce", "autre"];
const ACTIVITES: Record<Discipline, { nom: string; couleur: string }> = {
  meca: { nom: "Méca", couleur: "#c00000" },
  calcul: { nom: "Calcul", couleur: "#6b58a8" },
  elec: { nom: "Elec / Pneu", couleur: "#34506b" },
  scan: { nom: "Scan", couleur: "#e08a1e" },
  negoce: { nom: "Négoce", couleur: "#8d6e63" },
  autre: { nom: "Non ventilé", couleur: "#9aa0a6" }, // NEGOCE_INTERGROUPE
};
type Detail = Record<Discipline, number>;
const sansAccents = (t: string | null) => (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const debutExercice = (jour: string) => {
  const a = Number(jour.slice(0, 4));
  return Number(jour.slice(5, 7)) >= 11 ? a : a - 1;
};
const keuros = (n: number) =>
  Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const taux = (g: number, p: number) => (g + p > 0 ? `${Math.round((g / (g + p)) * 100)} %` : "—");

type Consultation = {
  numero: string;
  l: LigneInd;
  ouverture: string;
  issue: Issue | "FERME"; // DEVIS_FERMES, DEVIS_ANNULES : « Devis perdu » sans date d'envoi = annulé (jamais envoyé)
  principale: Discipline;
  parts: Record<Discipline, number>; // part de chaque activité (somme = 1)
  source: "MONTANT" | "HEURES" | "IMPUTATION" | "AUCUNE"; // DETAIL_AUTRE : d'où vient l'activité
};
type Stat = { n: number; g: number; p: number; a: number; f: number; v: number; vg: number; vp: number };
const vide = (): Stat => ({ n: 0, g: 0, p: 0, a: 0, f: 0, v: 0, vg: 0, vp: 0 });

type LigneBrute = {
  id: string;
  cle: string;
  genre: LigneInd["genre"];
  numero_devis: string | null;
  numero_affaire: string | null;
  base_affaire: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_id: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  heures_meca: number | string;
  heures_calcul: number | string;
  heures_elec: number | string;
  heures_pneu: number | string;
  heures_scan: number | string;
  heures_autre: number | string;
  heures_total: number | string;
  disparue: boolean;
};

export default function StatistiquesDevis() {
  const aujourdhui = aujourdhuiISO();
  const exerciceCourant = debutExercice(aujourdhui);
  const [exercice, setExercice] = useState(exerciceCourant);
  const [libre, setLibre] = useState<{ du: string; au: string } | null>(null);
  const [lignes, setLignes] = useState<LigneInd[]>([]);
  const [montantsVisibles, setMontantsVisibles] = useState(false);
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [tousClients, setTousClients] = useState(false);
  const [detailMontants, setDetailMontants] = useState<Map<string, Detail>>(new Map()); // ACTIVITES_NEGOCE
  const [voirAutre, setVoirAutre] = useState(false); // DETAIL_AUTRE

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [brutes, montants, clients, synchro] = await Promise.all([
          chargerTout<LigneBrute>((a, b) =>
            supabase
              .from("suivi_lignes")
              .select(
                "id,cle,genre,numero_devis,numero_affaire,base_affaire,statut,imputation,designation,client_id,date_ouverture,date_envoi,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre,heures_total,disparue"
              )
              .order("cle")
              .range(a, b)
          ),
          chargerTout<Record<string, number | string> & { ligne_id: string }>((a, b) =>
            supabase
              .from("suivi_lignes_montants")
              .select("ligne_id,montant,montant_meca,montant_calcul,montant_elec_pneu,montant_scan,montant_autre,montant_negoce")
              .order("ligne_id")
              .range(a, b)
          ),
          chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
          supabase.from("suivi_synchronisations").select("terminee_le").eq("statut", "APPLIQUEE").order("terminee_le", { ascending: false }).limit(1),
        ]);
        if (!actif) return;
        const noms = new Map(clients.map((c) => [c.id, c.nom_abrege]));
        const parLigne = new Map(montants.map((m) => [m.ligne_id, Number(m.montant) || 0]));
        const n = (v: number | string) => Number(v) || 0;
        setLignes(
          brutes.map((l) => ({
            id: l.id,
            cle: l.cle,
            genre: l.genre,
            numero_devis: l.numero_devis,
            numero_affaire: l.numero_affaire,
            base_affaire: l.base_affaire,
            statut: l.statut,
            imputation: l.imputation,
            designation: l.designation,
            client: l.client_id ? noms.get(l.client_id) ?? null : null,
            date_ouverture: l.date_ouverture,
            date_envoi: l.date_envoi,
            date_reception_commande: null,
            date_livraison: null,
            delai: null,
            date_livraison_estimee: null,
            heures: { meca: n(l.heures_meca), calcul: n(l.heures_calcul), elec: n(l.heures_elec), pneu: n(l.heures_pneu), scan: n(l.heures_scan), autre: n(l.heures_autre) },
            heures_total: n(l.heures_total),
            montant: parLigne.get(l.id) ?? 0,
            disparue: l.disparue,
          }))
        );
        setMontantsVisibles(montants.length > 0);
        setDetailMontants(
          new Map(
            montants.map((m) => [
              m.ligne_id,
              { meca: n(m.montant_meca), calcul: n(m.montant_calcul), elec: n(m.montant_elec_pneu), scan: n(m.montant_scan), negoce: n(m.montant_negoce) + n(m.montant_autre), autre: 0 },
            ])
          )
        );
        setDerniereSynchro(synchro.data?.[0]?.terminee_le ?? null);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger les statistiques.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, []);

  /* toutes les consultations : un n° de devis = une consultation, à la date de sa première ouverture */
  const consultations = useMemo(() => {
    const parNumero = new Map<string, LigneInd[]>();
    for (const l of lignes) {
      if (l.disparue || !(l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT") || !l.date_ouverture) continue;
      const num = (l.numero_devis ?? "").replace(/^\D+/, "").match(/^\d+/)?.[0]?.replace(/^0+/, "");
      if (!num) continue;
      parNumero.set(num, [...(parNumero.get(num) ?? []), l]);
    }
    const res: Consultation[] = [];
    for (const [numero, ls] of parNumero) {
      // la ligne qui dit le mieux ce qu'est devenu le devis : une commande, sinon la ligne de devis
      const l = ls.find((x) => (x.genre === "BASE" || x.genre === "AVENANT") && x.statut !== "Devis perdu") ?? ls[0];
      const ouverture = ls.map((x) => x.date_ouverture ?? "").sort()[0];
      /* ACTIVITES_NEGOCE : répartition par activité, d'après le détail du MONTANT (qui contient le négoce) ; à défaut, les heures
         chiffrées ; à défaut, l'imputation (NEGOCE, SCAN) ; sinon « Non ventilé » */
      const dm = detailMontants.get(l.id);
      const parHeures: Detail = { meca: l.heures.meca, calcul: l.heures.calcul, elec: l.heures.elec + l.heures.pneu, scan: l.heures.scan, negoce: l.heures.autre, autre: 0 };
      const sommeD = (d: Detail) => DISCIPLINES.reduce((t, k) => t + d[k], 0);
      const imp = sansAccents(l.imputation);
      const base: Detail =
        dm && sommeD(dm) > 0
          ? dm
          : sommeD(parHeures) > 0
            ? parHeures
            : { meca: 0, calcul: 0, elec: 0, scan: imp.startsWith("scan") ? 1 : 0, negoce: imp.startsWith("negoce") ? 1 : 0, autre: imp.startsWith("scan") || imp.startsWith("negoce") ? 0 : 1 };
      const source: Consultation["source"] =
        dm && sommeD(dm) > 0 ? "MONTANT" : sommeD(parHeures) > 0 ? "HEURES" : imp.startsWith("scan") || imp.startsWith("negoce") ? "IMPUTATION" : "AUCUNE";
      const tot = sommeD(base);
      const parts = Object.fromEntries(DISCIPLINES.map((d) => [d, base[d] / tot])) as Record<Discipline, number>;
      const principale: Discipline = DISCIPLINES.reduce((a, d) => (base[d] > base[a] ? d : a), DISCIPLINES[0]);
      // AVENANT_COMME_DEVIS : même règle que l'onglet Liste (le statut du classeur), avenants compris
      const envoye = ls.some((x) => Boolean(x.date_envoi)); // DEVIS_ANNULES : perdu sans date d'envoi = annulé
      const cat = categorieDevis(l.statut, l.genre, envoye);
      const issue: Consultation["issue"] =
        cat === "REMPORTE" ? "GAGNE" : cat === "PERDU" ? "PERDU" : cat === "ANNULE" ? "FERME" : cat === "INTENTION" ? "INTENTION" : "ATTENTE";
      res.push({ numero, l, ouverture, issue, principale, parts, source });
    }
    return res;
  }, [lignes, detailMontants]);

  const bornes = libre ?? { du: `${exercice}-11-01`, au: `${exercice + 1}-10-31` < aujourdhui ? `${exercice + 1}-10-31` : aujourdhui };
  const decaler = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  const val = (c: Consultation) => (montantsVisibles ? c.l.montant : c.l.heures_total);
  const fmt = (n: number) => (montantsVisibles ? keuros(n) : formatHeures(n));

  const vue = useMemo(() => {
    const dans = (c: Consultation, du: string, au: string) => c.ouverture >= du && c.ouverture <= au;
    const periode = consultations.filter((c) => dans(c, bornes.du, bornes.au));
    const n1 = consultations.filter((c) => dans(c, decaler(bornes.du), decaler(bornes.au)));
    const ajouter = (s: Stat, c: Consultation, part = 1, compter = true) => {
      if (compter) {
        s.n++;
        if (c.issue === "GAGNE") s.g++;
        else if (c.issue === "PERDU") s.p++;
        else if (c.issue === "FERME") s.f++;
        else s.a++;
      }
      s.v += val(c) * part;
      if (c.issue === "GAGNE") s.vg += val(c) * part;
      if (c.issue === "PERDU") s.vp += val(c) * part;
    };
    const stat = (liste: Consultation[]) => liste.reduce((s, c) => (ajouter(s, c), s), vide());
    const total = stat(periode);
    const totalN1 = stat(n1);

    const parAct = new Map<Discipline, Stat>();
    for (const c of periode.filter((x) => x.issue !== "FERME"))
      for (const d of DISCIPLINES) {
        if (c.parts[d] <= 0 && d !== c.principale) continue;
        const s = parAct.get(d) ?? vide();
        ajouter(s, c, c.parts[d], d === c.principale);
        parAct.set(d, s);
      }

    const parClient = new Map<string, Stat>();
    for (const c of periode) {
      const k = c.l.client ?? "Client non renseigné";
      const s = parClient.get(k) ?? vide();
      ajouter(s, c);
      parClient.set(k, s);
    }
    const clients = [...parClient.entries()].sort((x, y) => y[1].v - x[1].v || y[1].n - x[1].n);

    // mois de la période (au plus 24), consultations par activité principale
    const mois: { cle: string; label: string; parAct: Record<Discipline, number>; n: number; fermes: number }[] = [];
    for (let d = new Date(`${bornes.du.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= bornes.au.slice(0, 7) && mois.length < 24; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const cle = d.toISOString().slice(0, 7);
      mois.push({ cle, label: `${MOIS_COURTS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, parAct: Object.fromEntries(DISCIPLINES.map((x) => [x, 0])) as Record<Discipline, number>, n: 0, fermes: 0 });
    }
    for (const c of periode) {
      const m = mois.find((x) => x.cle === c.ouverture.slice(0, 7));
      if (!m) continue;
      if (c.issue === "FERME") m.fermes++;
      else m.parAct[c.principale]++;
      m.n++;
    }

    // trois exercices, mois par mois (novembre → octobre), terminant par l'exercice de la fin de période
    const exFin = debutExercice(bornes.au);
    const exAuj = debutExercice(aujourdhui);
    const idxMois = (d: string) => (Number(d.slice(5, 7)) + 1) % 12;
    const series = [0, 1, 2].map((k) => {
      const an = exFin - k;
      const nb = Array.from({ length: 12 }, () => 0);
      const mt = Array.from({ length: 12 }, () => 0);
      for (const c of consultations)
        if (c.ouverture >= `${an}-11-01` && c.ouverture <= `${an + 1}-10-31`) {
          nb[idxMois(c.ouverture)]++;
          mt[idxMois(c.ouverture)] += val(c);
        }
      return { an, nb, mt, jusqua: an === exAuj ? idxMois(aujourdhui) : 11 };
    });

    return { periode, total, totalN1, parAct, clients, mois, series };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultations, bornes.du, bornes.au, montantsVisibles]);

  function exporter() {
    const wb = XLSX.utils.book_new();
    const issueTexte = { GAGNE: "Remporté", PERDU: "Perdu", INTENTION: "Intention de commande", ATTENTE: "Sans réponse", FERME: "Annulé (jamais envoyé)" } as const;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        [...vue.periode]
          .sort((a, b) => a.ouverture.localeCompare(b.ouverture))
          .map((c) => ({
            Devis: `DBE${c.numero}`,
            Commande: c.issue === "GAGNE" || c.issue === "INTENTION" ? c.l.numero_affaire ?? "" : "",
            "Avenant de": c.l.genre === "AVENANT" && c.l.base_affaire ? `CBE${c.l.base_affaire}` : "",
            Client: c.l.client ?? "",
            Désignation: c.l.designation ?? "",
            Activité: ACTIVITES[c.principale].nom,
            "Ouvert le": c.ouverture,
            Statut: c.l.statut ?? "",
            Issue: issueTexte[c.issue],
            "Heures chiffrées": c.l.heures_total,
            ...(montantsVisibles ? { "Montant (€)": c.l.montant } : {}),
          }))
      ),
      "Consultations"
    );
    XLSX.writeFile(wb, `Consultations_${bornes.du}_${bornes.au}.xlsx`);
  }

  const t = vue.total;
  const tN1 = vue.totalN1;
  const evol = (a: number, b: number) => (b <= 0 ? (a > 0 ? "nouveau" : "—") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)} % vs N-1`);
  const thD: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap" };
  const tdD: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap" };
  const rangee: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 };
  const carte: CSSProperties = { ...page.carte, padding: 16, marginBottom: 14 };
  const pastille = (couleur: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: couleur, marginRight: 6, verticalAlign: "middle" }} />;

  const entete = (premiere: string) => (
    <thead>
      <tr>
        <th style={page.th}>{premiere}</th>
        <th style={thD}>Consultations</th>
        <th style={thD}>Remportées</th>
        <th style={thD}>Perdues</th>
        <th style={thD}>Sans réponse</th>
        <th style={thD} title="Classées « Devis perdu » sans date d’envoi : jamais envoyées">Annulées</th>
        <th style={thD} title="Taux de transformation en nombre : remportées ÷ (remportées + perdues). Les consultations sans réponse ne comptent pas.">Transformées</th>
        <th style={thD}>{montantsVisibles ? "Chiffré" : "Heures chiffrées"}</th>
        <th style={thD}>{montantsVisibles ? "Remporté" : "Heures remportées"}</th>
        <th style={thD} title="Taux de transformation en montant : remporté ÷ (remporté + perdu)">Transformé en {montantsVisibles ? "€" : "heures"}</th>
      </tr>
    </thead>
  );
  const ligne = (cle: string, s: Stat, debutCellule?: ReactNode, gras = false) => (
    <tr key={cle} style={gras ? { background: "#f6f7f8" } : undefined}>
      <td style={{ ...page.td, fontWeight: 800 }}>
        {debutCellule}
        {cle}
      </td>
      <td style={{ ...tdD, fontWeight: 800 }}>{s.n}</td>
      <td style={{ ...tdD, color: "#1b5e20", fontWeight: 700 }}>{s.g}</td>
      <td style={tdD}>{s.p}</td>
      <td style={{ ...tdD, color: C.gris }}>{s.a}</td>
      <td style={{ ...tdD, color: C.gris }}>{s.f || "—"}</td>
      <td style={tdD} title={`${s.g} remportée(s) sur ${s.g + s.p} consultation(s) dont on connaît l’issue`}>
        <strong>{taux(s.g, s.p)}</strong>
        {s.g + s.p > 0 && (
          <span style={{ color: C.gris, fontSize: 12 }}>
            {" "}
            ({s.g}/{s.g + s.p})
          </span>
        )}
      </td>
      <td style={tdD}>{fmt(s.v)}</td>
      <td style={{ ...tdD, color: "#1b5e20", fontWeight: 700 }}>{fmt(s.vg)}</td>
      <td style={{ ...tdD, fontWeight: 800 }}>{taux(s.vg, s.vp)}</td>
    </tr>
  );

  /* graphique 3 ans */
  const [mesure3, setMesure3] = useState<"nb" | "mt">("nb");
  const L = 900;
  const H = 260;
  const mg = { g: 52, d: 16, h: 14, b: 34 };
  const max3 = Math.max(1, ...vue.series.flatMap((s) => (mesure3 === "nb" ? s.nb : s.mt)));
  const x3 = (i: number) => mg.g + (i * (L - mg.g - mg.d)) / 11;
  const y3 = (v: number) => mg.h + (H - mg.h - mg.b) * (1 - v / max3);
  const couleurs3 = [C.rouge, "#5b6168", "#b9bec5"];
  const moisEx = Array.from({ length: 12 }, (_, i) => MOIS_COURTS[(i + 10) % 12]);
  const maxMois = Math.max(1, ...vue.mois.map((m) => m.n));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Statistiques</h2>
          <p style={page.sousTitre}>
            Les consultations reçues (devis ouverts) du {formatDate(bornes.du)} au {formatDate(bornes.au)}, et ce qu’elles sont devenues. Source : Suivi
            d’affaire BE{derniereSynchro ? `, synchronisé le ${formatDate(derniereSynchro)}` : ""}.
          </p>
        </div>
        <button type="button" onClick={exporter} disabled={vue.periode.length === 0} style={page.btnSecondaire}>
          Exporter en Excel
        </button>
      </div>

      <div style={{ ...page.carte, padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <strong style={{ fontSize: 14 }}>Période :</strong>
        <select
          value={libre ? "" : exercice}
          onChange={(e) => {
            setLibre(null);
            setExercice(Number(e.target.value));
          }}
          aria-label="Exercice"
          style={{ ...page.entrees, width: "auto", minHeight: 38, fontWeight: 700, borderColor: libre ? undefined : C.rouge }}
        >
          {libre && <option value="">Dates libres</option>}
          {[0, 1, 2, 3].map((k) => (
            <option key={k} value={exerciceCourant - k}>
              Exercice {exerciceCourant - k}-{exerciceCourant - k + 1}
              {k === 0 ? " (en cours)" : ""}
            </option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          ou du
          <input type="date" value={bornes.du} onChange={(e) => e.target.value && setLibre({ du: e.target.value, au: bornes.au })} style={{ ...page.entrees, width: "auto" }} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          au
          <input type="date" value={bornes.au} onChange={(e) => e.target.value && setLibre({ du: bornes.du, au: e.target.value })} style={{ ...page.entrees, width: "auto" }} />
        </label>
      </div>

      {erreur && <Message genre="erreur">{erreur}</Message>}
      {chargement && <Message genre="info">Chargement…</Message>}
      {!chargement && !montantsVisibles && lignes.length > 0 && <Message genre="info">Les montants ne sont pas visibles avec votre profil : les indicateurs sont donnés en heures chiffrées.</Message>}

      {!chargement && lignes.length > 0 && (
        <>
          {/* ---------- vignettes ---------- */}
          <div style={rangee}>
            <Tuile libelle="Consultations" valeur={String(t.n)} sous={`devis ouverts${t.f ? ` · dont ${t.f} annulées` : ""} · ${evol(t.n, tN1.n)}`} />
            <Tuile libelle={montantsVisibles ? "Montant chiffré" : "Heures chiffrées"} valeur={fmt(t.v)} sous={evol(t.v, tN1.v)} />
            <Tuile libelle={montantsVisibles ? "Montant remporté" : "Heures remportées"} valeur={fmt(t.vg)} sous={`${t.g} consultation${t.g > 1 ? "s" : ""} devenue${t.g > 1 ? "s" : ""} commande · ${evol(t.vg, tN1.vg)}`} />
            <Tuile
              libelle="Taux de transformation"
              valeur={taux(t.g, t.p)}
              sous={
                t.g + t.p < 5
                  ? `seulement ${t.g + t.p} consultation${t.g + t.p > 1 ? "s" : ""} dont l’issue est connue (${t.a} sans réponse) : taux peu significatif`
                  : `${t.g} remportées sur ${t.g + t.p} dont l’issue est connue (${t.a} sans réponse) · ${montantsVisibles ? "en montant" : "en heures"} ${taux(t.vg, t.vp)} · N-1 ${taux(tN1.g, tN1.p)}`
              }
            />
          </div>

          {/* ---------- consultations par mois, par activité ---------- */}
          <section style={carte}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Consultations par mois</h2>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>Devis ouverts chaque mois, colorés par activité principale (les couleurs des autres pages).</p>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 190, borderBottom: `1px solid ${C.ligne}` }}>
              {vue.mois.map((m) => (
                <div key={m.cle} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                  <strong style={{ fontSize: 12, marginBottom: 2 }}>{m.n || ""}</strong>
                  <div style={{ width: "70%", height: `${(m.n / maxMois) * 86}%`, display: "flex", flexDirection: "column-reverse", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
                    {DISCIPLINES.map((d) =>
                      m.parAct[d] > 0 ? (
                        <div key={d} title={`${m.label} · ${ACTIVITES[d].nom} : ${m.parAct[d]}`} style={{ flex: m.parAct[d], background: ACTIVITES[d].couleur }} />
                      ) : null
                    )}
                    {m.fermes > 0 && <div title={`${m.label} · annulées : ${m.fermes}`} style={{ flex: m.fermes, background: "#dfe2e6" }} />}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
              {vue.mois.map((m) => (
                <div key={m.cle} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 11, color: C.gris, overflow: "hidden" }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginTop: 8 }}>
              {DISCIPLINES.filter((d) => vue.parAct.has(d)).map((d) => (
                <span key={d}>
                  {pastille(ACTIVITES[d].couleur)}
                  {ACTIVITES[d].nom}
                </span>
              ))}
              {vue.mois.some((m) => m.fermes > 0) && (
                <span>
                  {pastille("#dfe2e6")}
                  annulées (jamais envoyées)
                </span>
              )}
            </div>
          </section>

          {/* ---------- par activité ---------- */}
          <section style={{ ...carte, overflowX: "auto" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par activité</h2>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
              Une consultation qui mêle plusieurs activités compte une fois, dans son activité principale ; son {montantsVisibles ? "montant" : "chiffrage"} est
              réparti entre ses activités d’après le détail du montant dans le Suivi d’affaire (qui contient le négoce), à défaut des heures chiffrées, à
              défaut de son imputation (NEGOCE, SCAN). « Non ventilé » : les consultations sans aucun détail par activité (ni montants, ni heures, ni imputation parlante).
            </p>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              {entete("Activité")}
              <tbody>
                {DISCIPLINES.filter((d) => vue.parAct.has(d)).map((d) => ligne(ACTIVITES[d].nom, vue.parAct.get(d)!, pastille(ACTIVITES[d].couleur)))}
                {ligne("Total", t, undefined, true)}
              </tbody>
            </table>
            {/* DETAIL_AUTRE : de quoi est fait « Autre / non ventilé » */}
            {(() => {
              const autres = vue.periode.filter((c) => c.principale === "autre" && c.issue !== "FERME").sort((a, b) => a.ouverture.localeCompare(b.ouverture));
              if (autres.length === 0) return null;
              const sansRien = autres.filter((c) => c.source === "AUCUNE");
              const parStatut = new Map<string, number>();
              for (const c of sansRien) parStatut.set(c.l.statut ?? "sans statut", (parStatut.get(c.l.statut ?? "sans statut") ?? 0) + 1);
              return (
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => setVoirAutre((v) => !v)} style={{ all: "unset", cursor: "pointer", fontWeight: 800, color: C.rougeFonce }}>
                    {voirAutre ? "▾" : "▸"} De quoi sont faites les {autres.length} consultations « Non ventilé » ?
                  </button>
                  {voirAutre && (
                    <>
                      <p style={{ margin: "6px 0", fontSize: 13, color: "#3b4046" }}>
                        <strong>{sansRien.length}</strong> n’ont <strong>ni montant détaillé par activité, ni heures chiffrées</strong> dans le Suivi d’affaire (et
                        une imputation qui ne dit pas l’activité) :{" "}
                        {[...parStatut.entries()].sort((a, b) => b[1] - a[1]).map(([st, n]) => `${n} « ${st} »`).join(", ")}.{" "}
                        {autres.length - sansRien.length > 0 && (
                          <>
                            Les <strong>{autres.length - sansRien.length}</strong> autres ont surtout de la colonne « Autre » du classeur.
                          </>
                        )}
                      </p>
                      <div style={{ maxHeight: 360, overflow: "auto", border: `1px solid ${C.ligne}`, borderRadius: 8 }}>
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                          <thead>
                            <tr>
                              {["Devis", "Client", "Désignation", "Ouvert le", "Statut", "Imputation", montantsVisibles ? "Montant" : "", "Heures", "Pourquoi « Autre »"]
                                .filter(Boolean)
                                .map((h) => (
                                  <th key={h} style={{ ...page.th, position: "sticky", top: 0, background: "#f4f5f7", textAlign: "left" }}>
                                    {h}
                                  </th>
                                ))}
                            </tr>
                          </thead>
                          <tbody>
                            {autres.map((c) => (
                              <tr key={c.numero}>
                                <td style={{ ...page.td, fontWeight: 800, whiteSpace: "nowrap" }}>DBE{c.numero}</td>
                                <td style={page.td}>{c.l.client ?? "—"}</td>
                                <td style={page.td}>{c.l.designation ?? "—"}</td>
                                <td style={{ ...page.td, whiteSpace: "nowrap" }}>{formatDate(c.ouverture)}</td>
                                <td style={page.td}>{c.l.statut ?? "—"}</td>
                                <td style={page.td}>{c.l.imputation ?? "—"}</td>
                                {montantsVisibles && <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>{c.l.montant ? keuros(c.l.montant) : "0"}</td>}
                                <td style={{ ...page.td, textAlign: "right" }}>{c.l.heures_total ? formatHeures(c.l.heures_total) : "0"}</td>
                                <td style={{ ...page.td, color: C.gris }}>
                                  {c.source === "AUCUNE" ? "ni montant détaillé, ni heures chiffrées" : "chiffré surtout dans la colonne « Autre »"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </section>

          {/* ---------- clients ---------- */}
          <section style={{ ...carte, overflowX: "auto" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{tousClients ? `Tous les clients (${vue.clients.length})` : "Top 10 clients"}</h2>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>Classés par {montantsVisibles ? "montant chiffré" : "heures chiffrées"} des consultations de la période.</p>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              {entete("Client")}
              <tbody>
                {(tousClients ? vue.clients : vue.clients.slice(0, 10)).map(([c, s], i) => ligne(c, s, <span style={{ color: i < 3 ? C.rougeFonce : C.gris, marginRight: 8 }}>{i + 1}</span>))}
                {ligne("Total", t, undefined, true)}
              </tbody>
            </table>
            {vue.clients.length > 10 && (
              <button type="button" onClick={() => setTousClients((v) => !v)} style={{ ...page.btnSecondaire, minHeight: 34, marginTop: 10 }}>
                {tousClients ? "Revenir au top 10" : `Voir les ${vue.clients.length} clients`}
              </button>
            )}
          </section>

          {/* ---------- comparatif sur 3 exercices ---------- */}
          <section style={carte}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Comparatif sur trois exercices</h2>
              <span style={{ flex: 1 }} />
              {(
                [
                  ["nb", "Nombre"],
                  ["mt", montantsVisibles ? "Montant chiffré" : "Heures chiffrées"],
                ] as const
              ).map(([v, lib]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={mesure3 === v}
                  onClick={() => setMesure3(v)}
                  style={{ ...page.btnSecondaire, minHeight: 32, padding: "0 10px", background: mesure3 === v ? C.rouge : "#ffffff", color: mesure3 === v ? "#ffffff" : C.rougeFonce, borderColor: mesure3 === v ? C.rouge : undefined }}
                >
                  {lib}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 6 }}>
              {vue.series.map((s, k) => {
                const cumul = (mesure3 === "nb" ? s.nb : s.mt).slice(0, s.jusqua + 1).reduce((a, b) => a + b, 0);
                return (
                  <span key={s.an} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <i style={{ width: 18, height: 3, background: couleurs3[k], display: "inline-block" }} />
                    {s.an}-{s.an + 1} : <strong>{mesure3 === "nb" ? `${cumul} consultations` : fmt(cumul)}</strong>
                    {s.jusqua < 11 ? " (en cours)" : ""}
                  </span>
                );
              })}
            </div>
            <svg viewBox={`0 0 ${L} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Consultations par mois sur trois exercices">
              {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                <g key={p}>
                  <line x1={mg.g} x2={L - mg.d} y1={y3(p * max3)} y2={y3(p * max3)} stroke="#e5e7ea" />
                  <text x={mg.g - 6} y={y3(p * max3) + 4} textAnchor="end" fontSize={11} fill="#777">
                    {mesure3 === "nb" ? Math.round(p * max3) : fmt(p * max3)}
                  </text>
                </g>
              ))}
              {moisEx.map((l, i) => (
                <text key={l} x={x3(i)} y={H - 12} textAnchor="middle" fontSize={11} fill="#777">
                  {l}
                </text>
              ))}
              {[...vue.series].reverse().map((s) => {
                const k = vue.series.indexOf(s);
                const v = (mesure3 === "nb" ? s.nb : s.mt).slice(0, s.jusqua + 1);
                return (
                  <g key={s.an}>
                    <polyline points={v.map((y, i) => `${x3(i).toFixed(1)},${y3(y).toFixed(1)}`).join(" ")} fill="none" stroke={couleurs3[k]} strokeWidth={k === 0 ? 3 : 2} strokeLinejoin="round" />
                    {v.map((y, i) => (
                      <circle key={i} cx={x3(i)} cy={y3(y)} r={k === 0 ? 4 : 3} fill={couleurs3[k]}>
                        <title>{`${moisEx[i]} (exercice ${s.an}-${s.an + 1}) : ${mesure3 === "nb" ? `${y} consultations` : fmt(y)}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
            </svg>
            <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>De novembre à octobre ; l’exercice de la fin de la période en rouge, les deux précédents en gris.</div>
          </section>

          <details style={{ fontSize: 13, color: "#3b4046" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont comptées les consultations ?</summary>
            <ul style={{ lineHeight: 1.6 }}>
              <li>
                Une <strong>consultation</strong> = un n° de devis (DBE) du Suivi d’affaire, compté <strong>une seule fois</strong>, au mois de son{" "}
                <strong>ouverture</strong>. La date d’envoi n’est pas utilisée : elle est remplie aussi quand on classe un devis « perdu », ce qui faussait
                les comptes.
              </li>
              <li>
                <strong>Remportée</strong> : statut « Commande reçue », « Livrée » ou « Commande annulée ». <strong>Perdue</strong> : « Devis perdu » après envoi.{" "}
                <strong>Sans réponse</strong> : tout le reste (en rédaction, envoyé, intention de commande). Un devis d’<strong>avenant</strong> est compté
                comme un devis à part entière, avec son propre statut.
              </li>
              <li>
                <strong>Annulée</strong> : classée « Devis perdu » sans date d’envoi (le devis n’a jamais été envoyé) ; elle compte dans les consultations,
                mais pas dans le taux de transformation.
              </li>
              <li>
                <strong>Taux de transformation</strong> = remportées ÷ (remportées + perdues), en nombre (« 3/4 » = 3 remportées sur 4 dont l’issue est
                connue) et en montant. Les consultations <strong>sans réponse</strong> ne comptent pas : en début d’exercice, ou si les devis perdus ne sont
                pas classés « Devis perdu » dans le Suivi d’affaire, le taux peut monter à 100 % alors que beaucoup de devis n’ont jamais abouti.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
