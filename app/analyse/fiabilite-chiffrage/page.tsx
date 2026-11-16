"use client";
import { estTrajet } from "@/lib/trajets";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerAffaires, chargerCharges, chargerRealise, type AffaireP } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, type Charge, type Realise } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE - FIABILITÉ DU CHIFFRAGE (FIABILITE_CHIFFRAGE)
   ADMIN et DIRECTION (droit « indicateurs »)

   Sur les forfaits LIVRÉS de l'exercice (novembre → octobre), activité par
   activité : heures chiffrées face aux heures réellement passées.
   - une affaire = une famille (commande de base + avenants), comptée quand
     toutes ses commandes sont livrées, à la date de la dernière livraison ;
   - chiffré : pilotage_charges de la famille ; réalisé : heures pointées
     (feuilles d'heures, historique) + réalisé initial importé du classeur ;
   - « juste » : réalisé à ±10 % du chiffré dans l'activité ;
   - « non chiffré » : heures passées dans une activité qui n'avait pas été
     chiffrée sur l'affaire.
   PE et PI (temps passé) sont exclues. Aucune donnée nominative.
   NEGOCE_A_PART : les affaires de négoce pur (imputation « Négoce ») ne
   sont pas comptées par activité (leurs heures, non chiffrées, sont dans
   la marge) : elles sont résumées à part, heures passées comprises.
================================================================ */

const SEUIL = 0.1;
const SANS = "__sans__";
/* NEGOCE_ROBUSTE : « Négoce », « NEGOCE », « Negoce »… (accents et majuscules ignorés) */
// SCAN_A_PART : le scan, vendu au montant, est traité comme le négoce
const estNegoceImp = (imp: string | null | undefined) => /^(negoce|scan)/.test((imp ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());

type Activite = { id: string; nom: string; ordre: number };
type LigneAffaire = { base: string; designation: string; fin: string; chiffre: number; realise: number };
type StatAct = {
  id: string;
  nom: string;
  ordre: number;
  chiffre: number;
  realise: number;
  nonChiffre: number;
  nb: number;
  sous: number;
  juste: number;
  dessus: number;
  affaires: LigneAffaire[];
};

function exerciceCourant() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}
const baseDe = (numero: string) => (numero.match(/^\d+/)?.[0] ?? numero).replace(/^0+/, "");
const pctSigne = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`;
const couleurEcart = (x: number) => (x > SEUIL ? "#c62828" : x < -SEUIL ? "#1f6feb" : "#2e7d32");

/* barre centrée : à droite au-delà du chiffré, à gauche en deçà */
function BarreEcart({ ecart }: { ecart: number }) {
  const largeur = Math.min(50, Math.abs(ecart) * 50);
  return (
    <span style={{ display: "inline-block", position: "relative", width: 160, height: 12, background: "#eef0f3", borderRadius: 6, verticalAlign: "middle" }}>
      <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 2, background: "#6b7178" }} />
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: ecart >= 0 ? "50%" : `${50 - largeur}%`,
          width: `${largeur}%`,
          background: couleurEcart(ecart),
          borderRadius: ecart >= 0 ? "0 6px 6px 0" : "6px 0 0 6px",
        }}
      />
    </span>
  );
}

/* TRI_COLONNES : un clic sur un titre de colonne trie ; un second clic inverse le sens */
type Tri = { cle: string; sens: 1 | -1 };
function enTeteTri(libelle: string, cle: string, tri: Tri, setTri: (t: Tri) => void, style: CSSProperties, sensDefaut: 1 | -1 = 1, title?: string) {
  const actif = tri.cle === cle;
  return (
    <th
      style={{ ...style, cursor: "pointer", userSelect: "none", color: actif ? C.rougeFonce : style.color }}
      title={title ?? "Cliquer pour trier"}
      aria-sort={actif ? (tri.sens === 1 ? "ascending" : "descending") : undefined}
      onClick={() => setTri(actif ? { cle, sens: tri.sens === 1 ? -1 : 1 } : { cle, sens: sensDefaut })}
    >
      {libelle} <span style={{ fontSize: 11, opacity: actif ? 1 : 0.35 }}>{actif ? (tri.sens === 1 ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}
const comparer = (a: string | number, b: string | number) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "fr", { numeric: true }));

function TableauAffaires({ lignes, clients, negoce = false }: { lignes: LigneAffaire[]; clients: Map<string, string>; negoce?: boolean }) {
  const [tri, setTri] = useState<Tri>(negoce ? { cle: "realise", sens: -1 } : { cle: "ecart", sens: -1 });
  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px", textAlign: "center" };
  const td: CSSProperties = { ...page.td, padding: "8px", fontSize: 13 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const ecartDe = (a: LigneAffaire) => (a.chiffre > 0 ? (a.realise - a.chiffre) / a.chiffre : 0);
  const valeur = (a: LigneAffaire): string | number =>
    tri.cle === "affaire" ? a.base : tri.cle === "client" ? clients.get(a.base) ?? "" : tri.cle === "descriptif" ? a.designation : tri.cle === "fin" ? a.fin : tri.cle === "chiffre" ? a.chiffre : tri.cle === "realise" ? a.realise : tri.cle === "heures" ? a.realise - a.chiffre : ecartDe(a);
  const triees = [...lignes].sort((x, y) => comparer(valeur(x), valeur(y)) * tri.sens);
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead>
        <tr>
          {enTeteTri("Affaire", "affaire", tri, setTri, { ...th, textAlign: "left" })}
          {enTeteTri("Client", "client", tri, setTri, { ...th, textAlign: "left" })}
          {enTeteTri("Descriptif", "descriptif", tri, setTri, { ...th, textAlign: "left" })}
          {enTeteTri("Livrée le", "fin", tri, setTri, th, -1)}
          {enTeteTri("Chiffré", "chiffre", tri, setTri, th, -1)}
          {enTeteTri(negoce ? "Heures passées" : "Réalisé", "realise", tri, setTri, th, -1)}
          {!negoce && enTeteTri("Écart", "ecart", tri, setTri, th, -1, "Trier par écart en % (un second clic : l’autre sens)")}
          {!negoce && enTeteTri("en heures", "heures", tri, setTri, th, -1, "Trier par écart en heures")}
        </tr>
      </thead>
      <tbody>
        {triees.map((a) => {
          const e = ecartDe(a);
          return (
            <tr key={a.base}>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                  CBE {a.base}
                </Link>
              </td>
              <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>{clients.get(a.base) ?? "—"}</td>
              <td style={td}>{a.designation}</td>
              <td style={{ ...tdN, textAlign: "center" }}>{formatDate(a.fin)}</td>
              <td style={tdN}>{a.chiffre > 0 ? formatHeures(a.chiffre) : "—"}</td>
              <td style={{ ...tdN, fontWeight: negoce ? 800 : 400 }}>{a.realise > 0 ? formatHeures(a.realise) : "—"}</td>
              {!negoce && <td style={{ ...tdN, fontWeight: 800, color: couleurEcart(e) }}>{pctSigne(e)}</td>}
              {!negoce && (
                <td style={{ ...tdN, fontWeight: 600, color: C.gris }}>
                  {a.realise >= a.chiffre ? "+" : "−"}
                  {formatHeures(Math.abs(a.realise - a.chiffre))}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FiabiliteContenu() {
  const [exercice, setExercice] = useState(exerciceCourant);
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [activites, setActivites] = useState<Activite[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [clients, setClients] = useState<Map<string, string>>(new Map());
  const [triAct, setTriAct] = useState<Tri>({ cle: "ordre", sens: 1 });

  // CLIENTS_FIABILITE : le client de chaque affaire, d'après la ligne de base du Suivi d'affaire BE
  useEffect(() => {
    let actif = true;
    (async () => {
      const { data: cl } = await supabase.from("suivi_clients").select("id,nom_abrege");
      const nomClient = new Map(((cl ?? []) as { id: string; nom_abrege: string }[]).map((c) => [c.id, c.nom_abrege]));
      const m = new Map<string, string>();
      for (let debut = 0; ; debut += 1000) {
        const { data, error } = await supabase
          .from("suivi_lignes")
          .select("id,base_affaire,client_id")
          .eq("genre", "BASE")
          .not("client_id", "is", null)
          .order("id", { ascending: true })
          .range(debut, debut + 999);
        if (error) break;
        for (const l of (data ?? []) as { base_affaire: string | null; client_id: string }[]) {
          const b = String(l.base_affaire ?? "").replace(/^0+/, "");
          const n = nomClient.get(l.client_id);
          if (b && n) m.set(b, n);
        }
        if ((data ?? []).length < 1000) break;
      }
      if (actif) setClients(m);
    })();
    return () => {
      actif = false;
    };
  }, []);

  useEffect(() => {
    let actif = true;
    Promise.all([chargerAffaires({ horsPlanning: true }), chargerCharges(), chargerRealise(), supabase.from("activites").select("id,nom,ordre_affichage")])
      .then(([af, ch, re, ac]) => {
        if (!actif) return;
        if (ac.error) throw new Error(ac.error.message);
        setAffaires(af);
        setCharges(ch);
        setRealise(re);
        setActivites(((ac.data ?? []) as { id: string; nom: string; ordre_affichage: number | null }[]).map((a) => ({ id: a.id, nom: a.nom, ordre: a.ordre_affichage ?? 999 })));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger l’analyse."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const vue = useMemo(() => {
    const debut = `${exercice}-11-01`;
    const fin = `${exercice + 1}-10-31`;
    const nomAct = new Map(activites.map((a) => [a.id, a]));

    // familles de forfaits (hors PE / PI) entièrement livrées dans l'exercice ; le négoce pur à part
    const familles = new Map<string, AffaireP[]>();
    const imputationBase = new Map<string, string | null>();
    for (const a of affaires) if (a.type === "CBE" && /^\d+$/.test(a.numero)) imputationBase.set(baseDe(a.numero), a.imputation);
    for (const a of affaires) {
      if (a.type !== "CBE" || a.statut === "ABANDONNEE") continue;
      const b = baseDe(a.numero);
      // FAMILLE_PEPI : la nature de la famille est celle de sa commande de base
      const impFamille = imputationBase.get(b) ?? a.imputation;
      if (impFamille === "PE" || impFamille === "PI" || a.imputation === "PE" || a.imputation === "PI") continue;
      familles.set(b, [...(familles.get(b) ?? []), a]);
    }
    const negoce: LigneAffaire[] = [];
    const chargesParAffaire = new Map<string, Charge[]>();
    for (const c of charges) chargesParAffaire.set(c.affaire_id, [...(chargesParAffaire.get(c.affaire_id) ?? []), c]);
    const realiseParBase = new Map<string, Map<string, number>>();
    for (const r of realise) {
      if (r.type_affaire !== "CBE") continue;
      if (estTrajet(r.code)) continue; // TRAJETS_A_PART : le trajet n'est pas de l'étude, hors comparaison au chiffré
      const b = baseDe(String(r.numero));
      const m = realiseParBase.get(b) ?? new Map<string, number>();
      const k = r.activite_id ?? SANS;
      m.set(k, (m.get(k) ?? 0) + (Number(r.heures) || 0));
      realiseParBase.set(b, m);
    }

    const stats = new Map<string, StatAct>();
    const stat = (id: string) => {
      let s = stats.get(id);
      if (!s) {
        const a = nomAct.get(id);
        s = { id, nom: id === SANS ? "Sans activité" : a?.nom ?? "Activité", ordre: a?.ordre ?? 9999, chiffre: 0, realise: 0, nonChiffre: 0, nb: 0, sous: 0, juste: 0, dessus: 0, affaires: [] };
        stats.set(id, s);
      }
      return s;
    };
    const parAffaire: { base: string; designation: string; fin: string; chiffre: number; realise: number }[] = [];

    for (const [base, membres] of familles) {
      if (!membres.every((m) => m.statut === "LIVREE")) continue;
      const dateFin = membres.map((m) => m.date_livraison ?? "").sort().slice(-1)[0];
      if (!dateFin || dateFin < debut || dateFin > fin) continue;
      const laBase = membres.find((m) => /^\d+$/.test(m.numero)) ?? membres[0];

      const ch = new Map<string, number>();
      const re = new Map<string, number>(realiseParBase.get(base) ?? []);
      for (const m of membres)
        for (const c of chargesParAffaire.get(m.id) ?? []) {
          ch.set(c.activite_id, (ch.get(c.activite_id) ?? 0) + (Number(c.heures) || 0));
          re.set(c.activite_id, (re.get(c.activite_id) ?? 0) + (Number(c.realise_initial) || 0));
        }
      const totalCh = [...ch.values()].reduce((t, x) => t + x, 0);
      const totalRe = [...re.values()].reduce((t, x) => t + x, 0);
      // NEGOCE_A_PART : négoce pur (imputation de la commande de base), résumé à part
      if (estNegoceImp(imputationBase.get(base) ?? laBase.imputation)) {
        negoce.push({ base, designation: laBase.designation, fin: dateFin, chiffre: totalCh, realise: totalRe });
        continue;
      }
      if (totalCh <= 0) continue; // sans chiffré, rien à comparer
      // MONTANT_HORS_COMPARAISON : scan / négoce pointés sans chiffré : hors comparaison
      const totalReCompare = [...re.entries()].filter(([id]) => (ch.get(id) ?? 0) > 0 || !estNegoceImp(nomAct.get(id)?.nom)).reduce((t, [, x]) => t + x, 0);
      parAffaire.push({ base, designation: laBase.designation, fin: dateFin, chiffre: totalCh, realise: totalReCompare });

      for (const id of new Set([...ch.keys(), ...re.keys()])) {
        const c = ch.get(id) ?? 0;
        const r = re.get(id) ?? 0;
        if (c > 0.01) {
          const s = stat(id);
          s.chiffre += c;
          s.realise += r;
          s.nb++;
          const e = (r - c) / c;
          if (e > SEUIL) s.dessus++;
          else if (e < -SEUIL) s.sous++;
          else s.juste++;
          s.affaires.push({ base, designation: laBase.designation, fin: dateFin, chiffre: c, realise: r });
        } else if (r > 0.01) {
          stat(id).nonChiffre += r;
        }
      }
    }

    const liste = [...stats.values()].sort((x, y) => x.ordre - y.ordre || x.nom.localeCompare(y.nom, "fr"));
    for (const s of liste) s.affaires.sort((x, y) => (y.realise - y.chiffre) / y.chiffre - (x.realise - x.chiffre) / x.chiffre);
    const totalCh = parAffaire.reduce((t, a) => t + a.chiffre, 0);
    const totalRe = parAffaire.reduce((t, a) => t + a.realise, 0);
    const justes = parAffaire.filter((a) => Math.abs((a.realise - a.chiffre) / a.chiffre) <= SEUIL).length;
    negoce.sort((x, y) => y.realise - x.realise);
    return { negoce, liste, parAffaire: parAffaire.sort((x, y) => (y.realise - y.chiffre) / y.chiffre - (x.realise - x.chiffre) / x.chiffre), totalCh, totalRe, justes };
  }, [affaires, charges, realise, activites, exercice]);

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px", textAlign: "center" };
  const td: CSSProperties = { ...page.td, padding: "8px", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const ecartGlobal = vue.totalCh > 0 ? (vue.totalRe - vue.totalCh) / vue.totalCh : 0;

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <OngletsPilotage actif="fiabilite" />
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Fiabilité du chiffrage</h1>
            <p style={page.sousTitre}>
              Sur les forfaits livrés de l’exercice, activité par activité : les heures chiffrées face aux heures réellement passées. De quoi corriger
              les prochains devis.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 110, textAlign: "center" }}>
              {exercice}-{exercice + 1}
            </strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">▶</button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && !erreur && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Forfaits livrés analysés" valeur={String(vue.parAffaire.length)} sous={`du 1er novembre ${exercice} au 31 octobre ${exercice + 1}`} />
              <Tuile libelle="Chiffré" valeur={formatHeures(vue.totalCh)} sous="heures vendues sur ces affaires" />
              <Tuile
                libelle="Réalisé"
                valeur={formatHeures(vue.totalRe)}
                sous={vue.totalCh > 0 ? `${pctSigne(ecartGlobal)} par rapport au chiffré` : "—"}
                accent={ecartGlobal > SEUIL}
              />
              <Tuile
                libelle="Chiffrage juste"
                valeur={vue.parAffaire.length ? `${Math.round((vue.justes / vue.parAffaire.length) * 100)} %` : "—"}
                sous="des affaires livrées à ±10 % du chiffré"
              />
            </div>

            {vue.parAffaire.length === 0 ? (
              <Message genre="info">Aucun forfait livré avec des heures chiffrées sur cet exercice.</Message>
            ) : (
              <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par activité</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  <span style={{ color: "#c62828", fontWeight: 800 }}>Rouge</span> : plus de 10 % au-delà du chiffré (chiffrage trop court) ·{" "}
                  <span style={{ color: "#2e7d32", fontWeight: 800 }}>vert</span> : à ±10 % · <span style={{ color: "#1f6feb", fontWeight: 800 }}>bleu</span> :
                  plus de 10 % en deçà (chiffrage large). Cliquez sur une activité pour voir ses affaires ; cliquez sur un titre de colonne pour trier. Les heures de trajet (code HT) ne sont pas comptées : ce n’est pas de l’étude.
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        {enTeteTri("Activité", "ordre", triAct, setTriAct, { ...th, textAlign: "left" })}
                        {enTeteTri("Affaires", "nb", triAct, setTriAct, th, -1)}
                        {enTeteTri("Chiffré", "chiffre", triAct, setTriAct, th, -1)}
                        {enTeteTri("Réalisé", "realise", triAct, setTriAct, th, -1)}
                        {enTeteTri("Écart", "ecart", triAct, setTriAct, th, -1)}
                        <th style={th}>Affaires : en deçà · justes · au-delà</th>
                        {enTeteTri("Réalisé non chiffré", "nonChiffre", triAct, setTriAct, th, -1, "Heures passées dans cette activité sur des affaires où elle n’avait pas été chiffrée")}
                      </tr>
                    </thead>
                    <tbody>
                      {[...vue.liste]
                        .sort((x, y) => {
                          const v = (a: StatAct): number => (triAct.cle === "nb" ? a.nb : triAct.cle === "chiffre" ? a.chiffre : triAct.cle === "realise" ? a.realise : triAct.cle === "ecart" ? (a.chiffre > 0 ? (a.realise - a.chiffre) / a.chiffre : -Infinity) : triAct.cle === "nonChiffre" ? a.nonChiffre : a.ordre);
                          return (v(x) - v(y) || x.nom.localeCompare(y.nom, "fr")) * triAct.sens;
                        })
                        .map((s) => {
                        const e = s.chiffre > 0 ? (s.realise - s.chiffre) / s.chiffre : 0;
                        const ouv = ouverte === s.id;
                        return (
                          <Fragment key={s.id}>
                            <tr onClick={() => setOuverte(ouv ? null : s.id)} style={{ cursor: s.nb > 0 ? "pointer" : "default", background: ouv ? "#f6f8fb" : undefined }}>
                              <td style={{ ...td, fontWeight: 800 }}>
                                {s.nb > 0 && <span style={{ color: C.rougeFonce, marginRight: 6 }}>{ouv ? "▾" : "▸"}</span>}
                                {s.nom}
                              </td>
                              <td style={{ ...tdN, textAlign: "center" }}>{s.nb || "—"}</td>
                              <td style={tdN}>{s.chiffre > 0 ? formatHeures(s.chiffre) : "—"}</td>
                              <td style={tdN}>{s.chiffre > 0 ? formatHeures(s.realise) : "—"}</td>
                              <td style={{ ...tdN, textAlign: "left" }}>
                                {s.chiffre > 0 ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    <BarreEcart ecart={e} />
                                    <strong style={{ color: couleurEcart(e), minWidth: 52, textAlign: "right" }}>{pctSigne(e)}</strong>
                                    <span style={{ fontSize: 12, color: C.gris }}>
                                      ({s.realise >= s.chiffre ? "+" : "−"}
                                      {formatHeures(Math.abs(s.realise - s.chiffre))})
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={{ ...tdN, textAlign: "center" }}>
                                {s.nb > 0 ? (
                                  <>
                                    <span style={{ color: "#1f6feb", fontWeight: 800 }}>{s.sous}</span> ·{" "}
                                    <span style={{ color: "#2e7d32", fontWeight: 800 }}>{s.juste}</span> ·{" "}
                                    <span style={{ color: "#c62828", fontWeight: 800 }}>{s.dessus}</span>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={{ ...tdN, color: s.nonChiffre > 0.5 ? "#b35c00" : C.gris, fontWeight: s.nonChiffre > 0.5 ? 800 : 400 }}>
                                {s.nonChiffre > 0.5 ? formatHeures(s.nonChiffre) : "—"}
                              </td>
                            </tr>
                            {ouv && s.nb > 0 && (
                              <tr>
                                <td colSpan={7} style={{ ...td, background: "#fafbfc", padding: "8px 16px 14px 30px" }}>
                                  <TableauAffaires lignes={s.affaires} clients={clients} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* NEGOCE_A_PART : le négoce pur, résumé à part */}
            {vue.negoce.length > 0 &&
              (() => {
                const heures = vue.negoce.reduce((t, a) => t + a.realise, 0);
                const chiffre = vue.negoce.reduce((t, a) => t + a.chiffre, 0);
                return (
                  <details style={{ ...page.carte, padding: 16, marginBottom: 14, borderLeft: "5px solid #b35c00" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 16 }}>
                      Négoce et Scan, à part : {vue.negoce.length} affaire{vue.negoce.length > 1 ? "s" : ""} livrée{vue.negoce.length > 1 ? "s" : ""} ·{" "}
                      <span style={{ color: "#b35c00" }}>{formatHeures(heures)} passées</span>
                      {chiffre > 0 ? ` pour ${formatHeures(chiffre)} chiffrées` : ", non chiffrées"}
                    </summary>
                    <p style={{ margin: "8px 0 10px", fontSize: 13, color: C.gris }}>
                      Les affaires de négoce et de scan, vendues au montant, ne comptent pas dans le tableau par activité : leurs heures ne sont en général
                      pas chiffrées, elles sont couvertes par le prix. Les voici, pour mesurer ce qu’elles coûtent vraiment.
                    </p>
                    <div style={{ overflowX: "auto" }}>
                      <TableauAffaires lignes={vue.negoce} clients={clients} negoce />
                    </div>
                  </details>
                );
              })()}

            {vue.parAffaire.length > 0 && (
              <details style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 16 }}>Toutes les affaires analysées ({vue.parAffaire.length}), toutes activités</summary>
                <div style={{ marginTop: 10, overflowX: "auto" }}>
                  <TableauAffaires lignes={vue.parAffaire} clients={clients} />
                </div>
              </details>
            )}

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Affaires analysées</strong> : les forfaits (commandes hors PE / PI) dont toutes les commandes de la famille (base et avenants)
                  sont livrées, à la date de la dernière livraison, dans l’exercice ; une affaire sans heures chiffrées est ignorée.
                </li>
                <li>
                  <strong>Chiffré</strong> : les heures chiffrées par activité de toute la famille. <strong>Réalisé</strong> : les heures pointées sur
                  l’affaire (feuilles d’heures et historique) et le réalisé initial repris du classeur, dans la même activité.
                </li>
                <li>
                  <strong>Négoce et Scan</strong> (vendus au montant) : à part, avec leurs heures passées ; ils ne pèsent pas sur la Mécanique.
                </li>
                <li>
                  <strong>Juste</strong> : réalisé à ±10 % du chiffré. <strong>Réalisé non chiffré</strong> : heures passées dans une activité qui
                  n’avait pas été chiffrée sur l’affaire (souvent un oubli au chiffrage, ou une heure pointée sur la mauvaise activité).
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function FiabiliteChiffragePage() {
  return (
    <GardeAcces droit="indicateurs">
      <FiabiliteContenu />
    </GardeAcces>
  );
}
