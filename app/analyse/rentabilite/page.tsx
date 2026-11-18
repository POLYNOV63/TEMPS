"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";
import { COULEURS_METIERS } from "@/lib/couleurs";
import { coutHoraire, type LigneFin, type ParGroupe } from "@/lib/finances";
import {
  AFFAIRES_EXCLUABLES,
  calculerRentabilite,
  chargerDonneesRentabilite,
  marge,
  tauxObtenu,
  tauxVendu,
  type Cumul,
  type LigneRenta,
  type PilotageCBE,
  type PrestationMois,
} from "@/lib/rentabilite";

/* ===============================================================
   ANALYSE - RENTABILITÉ (RENTABILITE_V1)
   ADMIN (saisie du coût horaire) et Direction (lecture), droit « indicateurs »

   Sur les affaires au forfait LIVRÉES de l'exercice (toutes les commandes
   de la famille livrées), trois taux horaires :
   - COÛT HORAIRE DE STRUCTURE : saisi ici (calculé dans le classeur
     « Point mort », onglet Indicateurs) ;
   - TAUX VENDU    = (prix − achats) ÷ heures chiffrées ;
   - TAUX OBTENU   = (prix − achats) ÷ heures réellement passées.
   Coût d'une affaire = achats + heures passées × coût horaire ;
   marge = prix − coût.
   Négoce et scan (imputation NEGOCE / SCAN) sont vendus au montant : pas
   de taux vendu, ils comptent entiers dans leur ligne « Négoce » / « Scan ».
   RENTABILITE_V2 - PE / PI (au temps passé) : sur l'exercice, mois facturés
   (relevé validé, et historique importé pour les mois d'avant le relevé) ;
   taux vendu = CA ÷ heures facturées, taux obtenu = CA ÷ heures pointées sur
   l'exercice, coût = heures pointées × coût horaire.
================================================================ */

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const parHeure = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${Math.round(n).toLocaleString("fr-FR")} €/h`);
const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${Math.round(n * 100)} %`);
function exerciceCourant() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}

const keuros = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n));
const BLEU_GAIN = "#2f6db5"; // validés daltonisme (dataviz) : bleu = gains, orange = pertes
const ORANGE_PERTE = "#c4501b";
/* RENTABILITE_ACTIVITE : couleurs des activités (celles des Indicateurs commerciaux) */
const COULEUR_ACTIVITE: Record<string, string> = { "Méca": COULEURS_METIERS.meca, Calcul: COULEURS_METIERS.calcul, "Elec / Pneu": COULEURS_METIERS.elec, Scan: COULEURS_METIERS.scan, "Négoce": COULEURS_METIERS.negoce, Autre: COULEURS_METIERS.autre, "Non ventilé": COULEURS_METIERS.autre };
/* RENTABILITE_LIB : chargement et calcul dans lib/rentabilite.ts (partagés avec le Simulateur de rentabilité) */

function RentabiliteContenu() {
  const [exercice, setExercice] = useState(exerciceCourant);
  const [lignesFin, setLignesFin] = useState<LigneFin[]>([]);
  const [realiseParBase, setRealiseParBase] = useState<Map<string, ParGroupe>>(new Map());
  const [trajetsParBase, setTrajetsParBase] = useState<Map<string, number>>(new Map());
  const [couts, setCouts] = useState<Map<number, number>>(new Map());
  const [estAdmin, setEstAdmin] = useState(false);
  const [coutSaisi, setCoutSaisi] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [seulementNonVentile, setSeulementNonVentile] = useState(false); // RENTABILITE_V3
  const [retirees, setRetirees] = useState<Set<string>>(new Set()); // AFFAIRES_EXCLUABLES : « exercice:base » décochées
  const excluablesEx = AFFAIRES_EXCLUABLES.filter((x) => x.exercice === exercice);
  /* RENTABILITE_V4 : affaires livrées au Pilotage, pour signaler celles que le Suivi d'affaire ne donne pas encore livrées */
  const [pilotageCBE, setPilotageCBE] = useState<PilotageCBE[]>([]);
  /* RENTABILITE_V2 : prestations PE / PI facturées (par affaire, par mois) et heures pointées sur l'exercice */
  const [prestations, setPrestations] = useState<PrestationMois[]>([]);
  // RENTABILITE_V5 : heures pointées par affaire et par mois (pour ne compter que les mois facturés des PE / PI)
  const [pointeExercice, setPointeExercice] = useState<Map<string, Map<string, number>>>(new Map());
  const [triF, setTriF] = useState<{ col: string; sens: 1 | -1 }>({ col: "mpct", sens: 1 });
  const [triP, setTriP] = useState<{ col: string; sens: 1 | -1 }>({ col: "mpct", sens: 1 });

  useEffect(() => {
    let actif = true;
    chargerDonneesRentabilite()
      .then((d) => {
        if (!actif) return;
        setLignesFin(d.lignesFin);
        setRealiseParBase(d.realiseParBase);
        setTrajetsParBase(d.trajetsParBase);
        setCouts(d.couts);
        setEstAdmin(d.estAdmin);
        setPilotageCBE(d.pilotageCBE);
        setPrestations(d.prestations);
        setPointeExercice(d.pointeExercice);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger la rentabilité."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const coutExercice = coutHoraire(couts, `${exercice}-11-01`);
  const coutPropre = couts.has(exercice);

  async function enregistrerCout() {
    setErreur("");
    setInfo("");
    const v = Number(coutSaisi.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return setErreur("Coût horaire invalide.");
    const { error } = await supabase.from("indicateurs_couts").upsert({ annee: exercice, cout_horaire: v }, { onConflict: "annee" });
    if (error) return setErreur(error.message);
    setCouts((m) => new Map(m).set(exercice, v));
    setCoutSaisi("");
    setInfo(`Coût horaire de structure ${exercice}-${exercice + 1} : ${v.toLocaleString("fr-FR")} €/h.`);
  }

  const vue = useMemo(
    () =>
      calculerRentabilite(
        { lignesFin, realiseParBase, trajetsParBase, couts, estAdmin: false, pilotageCBE, prestations, pointeExercice },
        exercice,
        new Set(AFFAIRES_EXCLUABLES.filter((x) => x.exercice === exercice && retirees.has(`${exercice}:${x.base}`)).map((x) => x.base))
      ),
    [lignesFin, realiseParBase, trajetsParBase, couts, exercice, prestations, pointeExercice, pilotageCBE, retirees]
  );

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px 6px", textAlign: "center" };
  const td: CSSProperties = { ...page.td, padding: "7px 6px", fontSize: 13, textAlign: "right", whiteSpace: "nowrap" };
  const tdG: CSSProperties = { ...td, textAlign: "left" };

  /* couleur du taux obtenu : sous le coût de structure (perte), sous le taux vendu (dérive), ou bon */
  const couleurObtenu = (l: LigneRenta, coutRef: number | null) => {
    const o = tauxObtenu(l);
    const v = tauxVendu(l);
    if (o === null) return undefined;
    if (coutRef !== null && o < coutRef) return "#b3261e";
    if (v !== null && o < v * 0.95) return "#b35c00";
    return "#1b5e20";
  };

  const ligneTableau = (l: LigneRenta, gras = false, coutRef: number | null = coutExercice) => {
    const m = marge(l);
    return (
      <>
        <td style={{ ...td, fontWeight: gras ? 800 : 400 }}>{euros(l.ca)}</td>
        <td style={td}>{l.achats ? euros(l.achats) : "—"}</td>
        <td style={td}>{l.hc > 0 ? formatHeures(l.hc) : "—"}</td>
        <td style={td}>
          {l.hr > 0 ? formatHeures(l.hr) : "—"}
          {(l.trajets ?? 0) > 0.01 && <div style={{ fontSize: 11, color: C.gris }}>dont {formatHeures(l.trajets ?? 0)} de trajet</div>}
        </td>
        <td style={{ ...td, color: C.gris }}>{l.auMontant ? <span style={{ fontSize: 11 }}>au montant</span> : parHeure(tauxVendu(l))}</td>
        <td style={{ ...td, fontWeight: 800, color: couleurObtenu(l, coutRef) }}>{parHeure(tauxObtenu(l))}</td>
        <td style={td}>{l.cout === null ? "—" : euros(l.cout)}</td>
        <td style={{ ...td, fontWeight: 800, color: m !== null && m < 0 ? C.rougeTexte : undefined }}>{m === null ? "—" : euros(m)}</td>
        <td style={td}>{m === null || l.ca === 0 ? "—" : pct(m / l.ca)}</td>
      </>
    );
  };
  /* RENTABILITE_V5 : tri des tableaux d'affaires */
  type Tri = { col: string; sens: 1 | -1 };
  type LigneTri = LigneRenta & { base?: string; client?: string | null; fin?: string; imputation?: string | null; nbMois?: number; activite?: string };
  const valeurTri = (l: LigneTri, col: string): number | string => {
    const bas = -1e12;
    switch (col) {
      case "numero": return Number(l.base) || 0;
      case "client": return (l.client ?? "~").toLowerCase();
      case "activite": return l.activite ?? "~";
      case "fin": return l.fin ?? "";
      case "type": return l.imputation ?? "";
      case "nbMois": return l.nbMois ?? 0;
      case "ca": return l.ca;
      case "achats": return l.achats;
      case "hc": return l.hc;
      case "hr": return l.hr;
      case "tv": return tauxVendu(l) ?? bas;
      case "to": return tauxObtenu(l) ?? bas;
      case "cout": return l.cout ?? bas;
      case "marge": return marge(l) ?? bas;
      default: {
        const m = marge(l);
        return m === null || !l.ca ? bas : m / l.ca;
      }
    }
  };
  const trier = <T extends LigneTri>(liste: T[], tri: Tri) =>
    [...liste].sort((x, y) => {
      const a = valeurTri(x, tri.col);
      const b = valeurTri(y, tri.col);
      const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "fr");
      return c * tri.sens;
    });
  const changerTri = (set: (f: (t: Tri) => Tri) => void) => (col: string) =>
    set((t) => ({ col, sens: t.col === col ? (t.sens === 1 ? -1 : 1) : col === "numero" || col === "client" || col === "type" || col === "activite" ? 1 : -1 }));

  const enTetes = (premiere: string, autres: string[] = [], tri?: { etat: Tri; changer: (c: string) => void }, libelleHc = "H. chiffrées", enPlus?: ReactNode) => {
    const cles: Record<string, string> = { Affaire: "numero", "Activité": "activite", Client: "client", "Livrée le": "fin", Type: "type", "Mois facturés": "nbMois" };
    const cellule = (libelle: string, col: string | null, style: CSSProperties, title?: string) => (
      <th key={libelle} style={style} title={title}>
        {tri && col ? (
          <button type="button" onClick={() => tri.changer(col)} style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap" }}>
            {libelle} {tri.etat.col === col ? (tri.etat.sens === 1 ? "▲" : "▼") : <span style={{ color: "#b9bec5" }}>↕</span>}
          </button>
        ) : (
          libelle
        )}
      </th>
    );
    return (
      <tr>
        {cellule(premiere, cles[premiere] ?? null, { ...th, textAlign: "left" })}
        {autres.map((x) => cellule(x, cles[x] ?? null, { ...th, textAlign: "left" }))}
        {cellule("Prix", "ca", th)}
        {cellule("Achats", "achats", th)}
        {cellule(libelleHc, "hc", th, libelleHc === "H. facturées" ? "Heures facturées au relevé" : "Heures chiffrées au devis")}
        {cellule("H. passées", "hr", th, "Heures réellement passées (feuilles d’heures et historique)")}
        {cellule(libelleHc === "H. facturées" ? "Taux facturé" : "Taux vendu", "tv", th, libelleHc === "H. facturées" ? "CA ÷ heures facturées : le taux du contrat" : "(prix − achats) ÷ heures chiffrées")}
        {cellule("Taux obtenu", "to", th, "(prix − achats) ÷ heures passées")}
        {cellule("Coût", "cout", th, "achats + heures passées × coût horaire de structure")}
        {cellule("Marge", "marge", th)}
        {cellule("Marge %", "mpct", th)}
        {enPlus}
      </tr>
    );
  };

  const t = vue.total;
  const mTotal = marge(t);

  /* MARGES_POS_NEG : les deux colonnes « Gains cumulés » / « Pertes cumulées » */
  const cellulesCumul = (c: Cumul | undefined, gras = false) => {
    const bord: CSSProperties = gras ? { borderTop: `2px solid ${C.ligne}` } : {};
    if (coutExercice === null || !c || (c.nPos === 0 && c.nNeg === 0))
      return (
        <>
          <td style={{ ...td, ...bord, borderLeft: `2px solid ${C.ligne}`, color: C.gris }}>—</td>
          <td style={{ ...td, ...bord, color: C.gris }}>—</td>
        </>
      );
    return (
      <>
        <td style={{ ...td, ...bord, borderLeft: `2px solid ${C.ligne}`, fontWeight: gras ? 800 : 700 }}>
          {c.nPos > 0 ? <>+ {euros(c.pos)}</> : "—"}
          {c.nPos > 0 && (
            <div style={{ fontSize: 11, fontWeight: 400, color: C.gris }}>
              {c.caPos > 0 ? `${pct(c.pos / c.caPos)} · ` : ""}
              {c.nPos} part{c.nPos > 1 ? "s" : ""}
            </div>
          )}
        </td>
        <td style={{ ...td, ...bord, fontWeight: gras ? 800 : 700, color: c.nNeg > 0 ? C.rougeTexte : undefined }}>
          {c.nNeg > 0 ? <>− {euros(-c.neg)}</> : "—"}
          {c.nNeg > 0 && (
            <div style={{ fontSize: 11, fontWeight: 400, color: C.gris }}>
              {c.caNeg > 0 ? `${pct(c.neg / c.caNeg)} · ` : ""}
              {c.nNeg} part{c.nNeg > 1 ? "s" : ""}
            </div>
          )}
        </td>
      </>
    );
  };

  /* MARGES_POS_NEG : graphique gains / pertes par activité (barres de part et d'autre d'un axe, point = net) */
  const lignesGraphique = vue.groupes.filter((g) => g.cumul && (g.cumul.nPos > 0 || g.cumul.nNeg > 0));
  const echelleGraphique = Math.max(1, ...lignesGraphique.map((g) => Math.max(g.cumul!.pos, -g.cumul!.neg)));
  const graphiqueGainsPertes =
    coutExercice === null || lignesGraphique.length === 0 ? null : (
      <figure style={{ margin: "18px 0 0" }} aria-label="Gains et pertes cumulés par activité">
        <figcaption style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", alignItems: "center", fontSize: 13, color: "#3b4046", marginBottom: 10 }}>
          <strong style={{ fontSize: 15, color: C.encre }}>Gains et pertes, par activité</strong>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 14, height: 10, borderRadius: 2, background: ORANGE_PERTE, display: "inline-block" }} />
            pertes (parts d’affaires à perte)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 14, height: 10, borderRadius: 2, background: BLEU_GAIN, display: "inline-block" }} />
            gains (parts d’affaires rentables)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 10, height: 10, borderRadius: 999, background: C.encre, boxShadow: "0 0 0 2px #ffffff", display: "inline-block" }} />
            net
          </span>
        </figcaption>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 150px) minmax(0, 1fr) minmax(120px, 190px)", rowGap: 8, columnGap: 12, alignItems: "center" }}>
          {lignesGraphique.map((g) => {
            const c = g.cumul!;
            const net = c.pos + c.neg;
            const lPerte = (-c.neg / echelleGraphique) * 50;
            const lGain = (c.pos / echelleGraphique) * 50;
            const xNet = 50 + (net / echelleGraphique) * 50;
            const caNet = c.caPos + c.caNeg;
            return (
              <Fragment key={g.cle}>
                <span style={{ fontWeight: 800, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: COULEUR_ACTIVITE[g.cle] ?? "#9aa0a6", display: "inline-block", flex: "none" }} />
                  {g.libelle}
                </span>
                <div style={{ position: "relative", height: 22 }}>
                  <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: -4, bottom: -4, width: 1, background: "#c9cdd2" }} />
                  {c.nNeg > 0 && (
                    <div
                      title={`${g.libelle} : pertes ${euros(c.neg)} sur ${c.nNeg} part(s) d’affaire${c.caNeg > 0 ? ` (${pct(c.neg / c.caNeg)} de leur prix)` : ""}`}
                      style={{ position: "absolute", right: "calc(50% + 1px)", top: 2, bottom: 2, width: `${lPerte}%`, minWidth: 2, background: ORANGE_PERTE, borderRadius: "4px 0 0 4px" }}
                    />
                  )}
                  {c.nPos > 0 && (
                    <div
                      title={`${g.libelle} : gains + ${euros(c.pos)} sur ${c.nPos} part(s) d’affaire${c.caPos > 0 ? ` (${pct(c.pos / c.caPos)} de leur prix)` : ""}`}
                      style={{ position: "absolute", left: "calc(50% + 1px)", top: 2, bottom: 2, width: `${lGain}%`, minWidth: 2, background: BLEU_GAIN, borderRadius: "0 4px 4px 0" }}
                    />
                  )}
                  <div
                    title={`${g.libelle} : net ${euros(net)}${caNet > 0 ? ` (${pct(net / caNet)})` : ""}`}
                    style={{ position: "absolute", left: `calc(${xNet}% - 6px)`, top: 5, width: 12, height: 12, borderRadius: 999, background: C.encre, boxShadow: "0 0 0 2px #ffffff" }}
                  />
                </div>
                <span style={{ fontSize: 13, color: "#3b4046", whiteSpace: "nowrap" }}>
                  net <strong style={{ color: net < 0 ? C.rougeTexte : C.encre }}>{keuros(net)}</strong>
                  {caNet > 0 && <span style={{ color: C.gris }}> · {pct(net / caNet)}</span>}
                </span>
              </Fragment>
            );
          })}
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: C.gris }}>
          Chaque affaire est répartie entre ses activités (comme le tableau) : la part d’une activité dans une affaire gagne ou perd de l’argent.
          Une activité positive au total peut perdre sur certaines affaires : c’est la barre orange. Survolez une barre pour le détail.
        </p>
      </figure>
    );

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      {/* NAVIGATION_AXES */}<OngletsPilotage actif="rentabilite" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Rentabilité</h1>
            <p style={page.sousTitre}>
              Les affaires au forfait livrées de l’exercice : ce qu’on pensait gagner par heure (taux vendu), ce qu’on a gagné (taux obtenu), face au coût
              d’une heure (coût de structure).
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 110, textAlign: "center" }}>
              {exercice}-{exercice + 1}
            </strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">▶</button>
            {/* AFFAIRES_EXCLUABLES : une coche par affaire qu'on peut retirer de cet exercice */}
            {excluablesEx.map((x) => {
              const cle = `${exercice}:${x.base}`;
              const prise = !retirees.has(cle);
              return (
                <label key={cle} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8, minHeight: 44, fontSize: 14, cursor: "pointer", color: prise ? undefined : "#7a3e00", fontWeight: prise ? 400 : 700 }}>
                  <input
                    type="checkbox"
                    checked={prise}
                    onChange={() =>
                      setRetirees((r) => {
                        const n = new Set(r);
                        if (n.has(cle)) n.delete(cle);
                        else n.add(cle);
                        return n;
                      })
                    }
                    style={{ width: 18, height: 18 }}
                  />
                  Prendre en compte la CBE {x.base}
                </label>
              );
            })}
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}
        {excluablesEx.some((x) => retirees.has(`${exercice}:${x.base}`)) && (
          <Message genre="info">
            Analyse sans la CBE {excluablesEx.filter((x) => retirees.has(`${exercice}:${x.base}`)).map((x) => x.base).join(", CBE ")} : tous les tableaux, le
            graphique et les totaux de la page l’ignorent. Recochez la case pour la réintégrer.
          </Message>
        )}

        {!chargement && (
          <>
            {/* ---------- coût horaire de structure ---------- */}
            <section style={{ ...page.carte, padding: 14, marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, borderLeft: `5px solid ${C.rouge}` }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>
                  Coût horaire de structure {exercice}-{exercice + 1}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>
                  {coutExercice === null ? "non saisi" : `${coutExercice.toLocaleString("fr-FR")} €/h`}
                  {coutExercice !== null && !coutPropre && <span style={{ fontSize: 13, fontWeight: 600, color: "#b35c00" }}> (celui d’un autre exercice)</span>}
                </div>
                <div style={{ fontSize: 12, color: C.gris }}>Calculé dans le classeur « Point mort » (onglet Indicateurs) : ce que coûte une heure vendue.</div>
              </div>
              {estAdmin && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <input
                    value={coutSaisi}
                    onChange={(e) => setCoutSaisi(e.target.value)}
                    placeholder="€/h"
                    inputMode="decimal"
                    aria-label="Coût horaire de structure"
                    style={{ ...page.entrees, width: 110 }}
                  />
                  <button type="button" style={page.btnPrimaire} disabled={!coutSaisi} onClick={() => void enregistrerCout()}>
                    Enregistrer
                  </button>
                </span>
              )}
            </section>

            {/* RENTABILITE_V6 : pourquoi le total des prix n'est pas le CA de l'exercice */}
            {(() => {
              const r = vue.rapprochement;
              const ligne = (libelle: string, valeur: number, signe = "", gras = false) => (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "3px 0", fontWeight: gras ? 800 : 400, borderTop: gras ? `1px solid ${C.ligne}` : undefined }}>
                  <span>{libelle}</span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {signe}
                    {euros(valeur)}
                  </span>
                </div>
              );
              return (
                <details style={{ ...page.carte, padding: "10px 16px", marginBottom: 14, fontSize: 14 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 800 }}>
                    Pourquoi le total des prix n’est pas le chiffre d’affaires de l’exercice ?
                  </summary>
                  <p style={{ margin: "8px 0", color: C.gris, fontSize: 13 }}>
                    Le chiffre d’affaires (page Finances) compte chaque livraison ou échéance <strong>à sa date</strong>. La rentabilité, elle, ne regarde une
                    affaire qu’une fois <strong>toute livrée</strong>, et alors pour son prix entier, même si une partie a été facturée un exercice précédent.
                  </p>
                  <div style={{ maxWidth: 620 }}>
                    {ligne("CA des forfaits de l’exercice (livraisons et échéances, comme Finances)", r.caForfaits, "", true)}
                    {ligne(`− CA d’affaires pas encore toutes livrées (${r.nbEnCours} affaire${r.nbEnCours > 1 ? "s" : ""} : échéances, lots, commandes livrées d’une famille encore ouverte)`, r.caEnCours, "− ")}
                    {ligne("+ part des affaires analysées déjà facturée avant l’exercice (échéances antérieures)", r.factureAvant, r.factureAvant >= 0 ? "+ " : "")}
                    {ligne("= Prix des forfaits livrés analysés ici", r.prixForfaits, "", true)}
                    {ligne("+ PE / PI : mois facturés et validés au relevé", r.caPrestations, "+ ")}
                    {ligne("= Total des prix de la page", r.prixForfaits + r.caPrestations, "", true)}
                  </div>
                  <p style={{ margin: "8px 0 0", color: C.gris, fontSize: 12 }}>
                    Finances peut aussi compter des frais annexes saisis à la main et, pour les PE / PI, des mois pas encore validés : ils ne sont pas dans
                    cette page.
                  </p>
                </details>
              );
            })()}

            {/* RENTABILITE_V4 : livrées au Pilotage mais pas encore dans le Suivi d'affaire */}
            {vue.enAttente.length > 0 && (
              <Message genre="info">
                <strong>
                  {vue.enAttente.length} affaire{vue.enAttente.length > 1 ? "s" : ""} livrée{vue.enAttente.length > 1 ? "s" : ""} au Pilotage, pas encore comptée
                  {vue.enAttente.length > 1 ? "s" : ""} ici
                </strong>{" "}
                : le prix et les achats viennent du Suivi d’affaire BE, qui doit lui aussi la donner « Livrée », avec sa date de livraison (puis la synchronisation).
                <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  {vue.enAttente.map((a) => (
                    <li key={a.base}>
                      <strong>CBE {a.base}</strong> {a.designation ? `· ${a.designation} ` : ""}· livrée le {formatDate(a.livree)} au Pilotage · {a.raison}
                    </li>
                  ))}
                </ul>
              </Message>
            )}

            {coutExercice === null && (
              <Message genre="info">Saisissez le coût horaire de structure pour calculer les coûts et les marges. Les taux vendus et obtenus s’affichent déjà.</Message>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile
                libelle="Affaires analysées"
                valeur={String(vue.affaires.length + vue.prestationsEx.length)}
                sous={`${vue.affaires.length} forfaits livrés (dont ${vue.affaires.filter((a) => a.auMontant).length} négoce / scan) · ${vue.prestationsEx.length} PE / PI · ${euros(t.ca)}`}
              />
              <Tuile
                libelle="Taux horaire obtenu"
                valeur={parHeure(tauxObtenu(t))}
                sous={coutExercice !== null ? `coût de structure ${coutExercice.toLocaleString("fr-FR")} €/h` : "coût de structure non saisi"}
                accent={coutExercice !== null && (tauxObtenu(t) ?? 0) < coutExercice}
              />
              <Tuile
                libelle="Marge"
                valeur={mTotal === null ? "—" : euros(mTotal)}
                sous={mTotal === null ? "coût de structure à saisir" : `${pct(mTotal / (t.ca || 1))} du prix · ${formatHeures(t.hr)} passées`}
                accent={mTotal !== null && mTotal < 0}
              />
              <Tuile
                libelle="Affaires à perte"
                valeur={coutExercice === null ? "—" : String(vue.affaires.filter((a) => (marge(a) ?? 0) < 0).length)}
                sous="marge négative après coût de structure"
                accent={vue.affaires.some((a) => (marge(a) ?? 0) < 0)}
              />
            </div>

            {vue.affaires.length === 0 && vue.prestationsEx.length === 0 ? (
              <Message genre="info">Aucune affaire au forfait livrée ni aucun mois de PE / PI facturé sur cet exercice.</Message>
            ) : (
              <>
                <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par activité</h2>
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                    Taux obtenu <span style={{ color: "#1b5e20", fontWeight: 800 }}>vert</span> : au niveau du taux vendu ·{" "}
                    <span style={{ color: "#b35c00", fontWeight: 800 }}>orange</span> : plus bas (heures en plus) ·{" "}
                    <span style={{ color: "#b3261e", fontWeight: 800 }}>rouge</span> : sous le coût de structure (perte). Les achats sont portés par la ligne
                    Négoce ; le négoce sans heures chiffrées est à part (« Négoce au montant »), comme le scan pur.
                  </p>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      {enTetes(
                        "Activité",
                        [],
                        undefined,
                        "H. chiffrées",
                        <>
                          <th style={{ ...th, borderLeft: `2px solid ${C.ligne}` }} title="Cumul des parts d’affaires qui gagnent de l’argent dans cette activité, et leur marge en % de leur prix">
                            Gains cumulés
                          </th>
                          <th style={th} title="Cumul des parts d’affaires qui perdent de l’argent dans cette activité, et leur perte en % de leur prix">
                            Pertes cumulées
                          </th>
                        </>
                      )}
                    </thead>
                    <tbody>
                      {vue.groupes.map((g) => (
                        <tr key={g.cle}>
                          <td style={{ ...tdG, fontWeight: 800 }}>{g.libelle}</td>
                          {ligneTableau(g)}
                          {cellulesCumul(g.cumul)}
                        </tr>
                      ))}
                      <tr style={{ background: "#f8f9fa" }}>
                        <td style={{ ...tdG, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>Total</td>
                        {ligneTableau(t, true)}
                        {cellulesCumul(t.cumul, true)}
                      </tr>
                    </tbody>
                  </table>
                  {graphiqueGainsPertes}
                  {/* RENTABILITE_V3 : les affaires dont le montant n'est pas détaillé par activité */}
                  {vue.affaires.some((a) => a.nonVentile) && (
                    <p style={{ margin: "10px 0 0", fontSize: 13, color: "#7a3e00", background: "#fff4e5", borderRadius: 8, padding: "8px 10px" }}>
                      ⚠ <strong>{vue.affaires.filter((a) => a.nonVentile).length} affaire(s)</strong> n’ont pas leur montant détaillé par activité dans le Suivi
                      d’affaire (colonnes Méca, Calcul, Elec…). Leur prix a été réparti au prorata des heures chiffrées, à défaut des heures passées
                      {vue.affaires.some((a) => a.nonVentile === "AUCUN") ? " ; sans aucune heure, il reste en « Non ventilé »" : ""}.{" "}
                      <button
                        type="button"
                        onClick={() => setSeulementNonVentile((v) => !v)}
                        style={{ all: "unset", cursor: "pointer", fontWeight: 800, color: C.rougeFonce, textDecoration: "underline" }}
                      >
                        {seulementNonVentile ? "revoir toutes les affaires" : "voir lesquelles"}
                      </button>
                      {" "}— à compléter dans le classeur pour un résultat exact.
                    </p>
                  )}
                </section>

                <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>
                    Forfaits livrés, affaire par affaire{seulementNonVentile ? " — montant non détaillé par activité" : ""}
                  </h2>
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                    Les moins rentables d’abord ; cliquez sur un titre de colonne pour trier (par activité principale, client…), sur une affaire pour ouvrir son bilan.
                  </p>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>{enTetes("Affaire", ["Activité", "Client", "Livrée le"], { etat: triF, changer: changerTri(setTriF) })}</thead>
                    <tbody>
                      {trier(vue.affaires.filter((a) => !seulementNonVentile || a.nonVentile), triF).map((a) => (
                        <tr key={a.base}>
                          <td style={{ ...tdG, whiteSpace: "normal", minWidth: 180 }}>
                            <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                              CBE {a.base}
                            </Link>{" "}
                            {a.auMontant && <span style={{ fontSize: 11, fontWeight: 700, color: "#b35c00" }}>{a.imputation}</span>}
                            {a.nonVentile && (
                              <span
                                title={
                                  a.nonVentile === "AUCUN"
                                    ? "Montant non détaillé par activité dans le Suivi d’affaire, et aucune heure : il reste en « Non ventilé »"
                                    : `Montant non détaillé par activité dans le Suivi d’affaire : réparti au prorata des heures ${a.nonVentile === "CHIFFRE" ? "chiffrées" : "passées"}`
                                }
                                style={{ fontSize: 11, fontWeight: 700, color: "#7a3e00", background: "#fff4e5", borderRadius: 999, padding: "0 6px" }}
                              >
                                ⚠ non ventilé
                              </span>
                            )}
                            <div style={{ fontSize: 12, color: C.gris }}>{a.designation}</div>
                          </td>
                          <td style={{ ...tdG, fontWeight: 700, whiteSpace: "nowrap" }}>
                            <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: COULEUR_ACTIVITE[a.activite] ?? "#9aa0a6", marginRight: 6 }} />
                            {a.activite}
                          </td>
                          <td style={{ ...tdG, fontWeight: 400 }}>{a.client ?? "—"}</td>
                          <td style={{ ...tdG, fontWeight: 400 }}>{formatDate(a.fin)}</td>
                          {ligneTableau(a, false, coutHoraire(couts, a.fin))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* RAPPROCHEMENT : les forfaits de cette liste = le tableau « Par activité » sans ses lignes PE / PI */}
                  {!seulementNonVentile &&
                    (() => {
                      const ca = vue.affaires.reduce((x, a) => x + a.ca, 0);
                      const sansCout = vue.affaires.some((a) => marge(a) === null);
                      const m = vue.affaires.reduce((x, a) => x + (marge(a) ?? 0), 0);
                      const horsPrest = vue.groupes.filter((g) => g.cle !== "PE" && g.cle !== "PI");
                      const caHaut = horsPrest.reduce((x, g) => x + g.ca, 0);
                      const mHaut = horsPrest.reduce((x, g) => x + (marge(g) ?? 0), 0);
                      const egal = Math.abs(ca - caHaut) < 1 && Math.abs(m - mHaut) < 1;
                      return (
                        <p style={{ margin: "10px 0 0", fontSize: 13, color: egal ? C.gris : "#7a3e00", background: egal ? undefined : "#fff4e5", borderRadius: 8, padding: egal ? 0 : "8px 10px" }}>
                          {vue.affaires.length} forfaits : prix <strong>{euros(ca)}</strong>
                          {!sansCout && (
                            <>
                              , marge <strong>{euros(m)}</strong> ({pct(m / (ca || 1))})
                            </>
                          )}
                          {egal ? " = tableau « Par activité » sans les lignes PE / PI ✓" : ` ≠ tableau « Par activité » sans les lignes PE / PI (${euros(caHaut)}, marge ${euros(mHaut)}) : écart à signaler.`}
                        </p>
                      );
                    })()}
                </section>

                {/* RENTABILITE_V2 : prestations au temps passé */}
                {vue.prestationsEx.length > 0 && (
                  <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                    <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>PE / PI, sur l’exercice</h2>
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                      Ici, rien n’est chiffré à l’avance : on part de ce qui a été fait. <strong>Taux facturé</strong> = CA ÷ heures facturées, c’est le taux du
                      contrat ; <strong>taux obtenu</strong> = CA ÷ heures pointées <strong>pendant ces mêmes mois</strong> (relevé validé, historique avant le
                      relevé). Un écart entre les deux, c’est la différence entre heures pointées et
                      heures facturées : heures passées non facturées (trajets, temps interne, heures au-delà d’un forfait jour…), ou au contraire heures
                      facturées au-delà du pointé (heures sup refacturées à 125 %, journée facturée plus longue que celle pointée).
                    </p>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>{enTetes("Affaire", ["Type", "Mois facturés"], { etat: triP, changer: changerTri(setTriP) }, "H. facturées")}</thead>
                      <tbody>
                        {trier(vue.prestationsEx, triP).map((a) => (
                          <tr key={a.base}>
                            <td style={{ ...tdG, whiteSpace: "normal", minWidth: 180 }}>
                              <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                                CBE {a.base}
                              </Link>
                              <div style={{ fontSize: 12, color: C.gris }}>{a.designation}</div>
                            </td>
                            <td style={{ ...tdG, fontWeight: 800 }}>{a.imputation}</td>
                            <td style={{ ...td, textAlign: "center" }}>{a.nbMois}</td>
                            {ligneTableau(a)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </>
            )}

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Affaires analysées</strong> : les forfaits dont toutes les commandes (base et avenants) sont livrées, à la date de la dernière
                  livraison, dans l’exercice. <strong>PE / PI</strong> : les mois facturés de l’exercice, avec les heures pointées sur l’exercice.
                </li>
                <li>
                  <strong>Prix</strong> : montant des commandes et avenants retenus (Suivi d’affaire BE). <strong>Achats</strong> : achats des commandes et de
                  leurs découpages.
                </li>
                <li>
                  <strong>Taux vendu</strong> = (prix − achats) ÷ heures chiffrées. <strong>Taux obtenu</strong> = (prix − achats) ÷ heures réellement passées
                  (feuilles d’heures et historique, toutes activités).
                </li>
                <li>
                  <strong>Coût</strong> = achats + heures passées × coût horaire de structure de l’exercice de livraison. <strong>Marge</strong> = prix − coût.
                </li>
                <li>
                  <strong>Non ventilé</strong> : une affaire dont le montant n’est pas détaillé par activité dans le Suivi d’affaire voit son prix réparti au
                  prorata de ses heures chiffrées (à défaut, passées). Ne reste en « Non ventilé » que le prix d’une affaire sans aucune heure.
                </li>
                <li>
                  <strong>Négoce</strong> : avec des heures de négoce chiffrées (colonne « Heures négoce » du Suivi d’affaire), il a un taux vendu et un taux obtenu comme les autres activités ; sans heures chiffrées (anciennes affaires), il est sur la ligne « Négoce au montant », sans taux vendu. <strong>Scan</strong> pur (imputation SCAN, sans heures chiffrées) : au montant, de même. Leurs heures passées comptent toujours dans leur coût.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function RentabilitePage() {
  return (
    <GardeAcces droit="indicateurs">
      <RentabiliteContenu />
    </GardeAcces>
  );
}
