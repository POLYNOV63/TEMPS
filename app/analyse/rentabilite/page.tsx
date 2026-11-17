"use client";
import { estTrajet } from "@/lib/trajets";
import { COULEURS_METIERS } from "@/lib/couleurs";

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerMoi, chargerRealise, chargerTout } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";
import {
  GROUPES,
  GROUPE_DISCIPLINE,
  affairesTerminees,
  coutHoraire,
  groupesVides,
  mouvementsExcel,
  type Discipline,
  type Groupe,
  type LigneFin,
  type ParGroupe,
} from "@/lib/finances";

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
const sansAccents = (t: string | null | undefined) => (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const venteAuMontant = (imp: string | null | undefined) => /^(negoce|scan)/.test(sansAccents(imp));

function exerciceCourant() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}

type LigneRenta = {
  cle: string;
  libelle: string;
  ca: number;
  achats: number;
  hc: number;
  hr: number;
  cout: number | null;
  auMontant: boolean;
  trajets?: number; // TRAJETS_A_PART : heures de trajet (code HT), dans le coût mais pas dans « heures passées »
  cumul?: Cumul; // MARGES_POS_NEG : parts d'affaires gagnantes / perdantes (lignes « par activité »)
};
/* MARGES_POS_NEG (PLG, 17/11/2026) : dans « Par activité », chaque affaire est répartie entre ses activités ; chaque part
   (la part Méca d'une affaire, sa part Calcul…) a sa propre marge, positive ou négative. On cumule séparément les gains
   et les pertes, pour voir qu'une activité positive au total perd sur certaines affaires. */
type Cumul = { pos: number; neg: number; caPos: number; caNeg: number; nPos: number; nNeg: number };
const cumulVide = (): Cumul => ({ pos: 0, neg: 0, caPos: 0, caNeg: 0, nPos: 0, nNeg: 0 });
const keuros = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n));
/* AFFAIRES_EXCLUABLES (PLG, 17/11/2026) : affaires qu'on peut retirer de l'analyse d'un exercice par une coche
   (affaire hors norme qui fausse la lecture). Pour en ajouter une : une ligne ici. */
const AFFAIRES_EXCLUABLES: { exercice: number; base: string }[] = [{ exercice: 2025, base: "1678" }];
const BLEU_GAIN = "#2f6db5"; // validés daltonisme (dataviz) : bleu = gains, orange = pertes
const ORANGE_PERTE = "#c4501b";
type Affaire = LigneRenta & { base: string; designation: string | null; client: string | null; fin: string; imputation: string | null; nonVentile: "CHIFFRE" | "PASSE" | "AUCUN" | null; activite: string };
/* RENTABILITE_ACTIVITE : couleurs des activités (celles des Indicateurs commerciaux) */
const COULEUR_ACTIVITE: Record<string, string> = { "Méca": COULEURS_METIERS.meca, Calcul: COULEURS_METIERS.calcul, "Elec / Pneu": COULEURS_METIERS.elec, Scan: COULEURS_METIERS.scan, "Négoce": COULEURS_METIERS.negoce, Autre: COULEURS_METIERS.autre, "Non ventilé": COULEURS_METIERS.autre };
type Prestation = { base: string; imputation: string; designation: string | null; ca: number; hFact: number; mois: Set<string> };

const tauxVendu = (l: LigneRenta) => (!l.auMontant && l.hc > 0 ? (l.ca - l.achats) / l.hc : null);
const tauxObtenu = (l: LigneRenta) => (l.hr > 0 ? (l.ca - l.achats) / l.hr : null);
const marge = (l: LigneRenta) => (l.cout === null ? null : l.ca - l.cout);

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
  const [pilotageCBE, setPilotageCBE] = useState<{ numero: string; statut: string; date_livraison: string | null; imputation: string | null; designation: string | null }[]>([]);
  /* RENTABILITE_V2 : prestations PE / PI facturées (par affaire, par mois) et heures pointées sur l'exercice */
  const [prestations, setPrestations] = useState<{ base: string; imputation: string; designation: string | null; mois: string; ca: number; hFact: number }[]>([]);
  // RENTABILITE_V5 : heures pointées par affaire et par mois (pour ne compter que les mois facturés des PE / PI)
  const [pointeExercice, setPointeExercice] = useState<Map<string, Map<string, number>>>(new Map());
  const [triF, setTriF] = useState<{ col: string; sens: 1 | -1 }>({ col: "mpct", sens: 1 });
  const [triP, setTriP] = useState<{ col: string; sens: 1 | -1 }>({ col: "mpct", sens: 1 });

  useEffect(() => {
    let actif = true;
    (async () => {
      const n = (v: number | string | null | undefined) => Number(v) || 0;
      const [brutes, montants, clients, realise, corr, acts, co, moi] = await Promise.all([
        chargerTout<{
          id: string; cle: string; parent_cle: string | null; genre: LigneFin["genre"]; base_affaire: string | null; statut: string | null;
          imputation: string | null; designation: string | null; client_id: string | null; date_livraison: string | null;
          date_livraison_estimee: string | null; disparue: boolean;
          heures_meca: number | string; heures_calcul: number | string; heures_elec: number | string; heures_pneu: number | string;
          heures_scan: number | string; heures_autre: number | string; heures_total: number | string;
        }>((a, b) =>
          supabase
            .from("suivi_lignes")
            .select("id,cle,parent_cle,genre,base_affaire,statut,imputation,designation,client_id,date_livraison,date_livraison_estimee,disparue,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre,heures_total")
            .order("cle")
            .range(a, b)
        ),
        chargerTout<Record<string, number | string> & { ligne_id: string }>((a, b) =>
          supabase
            .from("suivi_lignes_montants")
            .select("ligne_id,montant,montant_echeances,montant_meca,montant_calcul,montant_elec_pneu,montant_scan,montant_autre,montant_achats,montant_negoce")
            .order("ligne_id")
            .range(a, b)
        ),
        chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
        chargerRealise(),
        supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
        supabase.from("activites").select("id,nom"),
        supabase.from("indicateurs_couts").select("annee,cout_horaire"),
        chargerMoi().catch(() => null),
      ]);
      if (!actif) return;

      const noms = new Map(clients.map((c) => [c.id, c.nom_abrege]));
      const detail = new Map(montants.map((m) => [m.ligne_id, m]));
      setLignesFin(
        brutes.map((l) => {
          const m = detail.get(l.id);
          return {
            cle: l.cle,
            genre: l.genre,
            parent_cle: l.parent_cle,
            base_affaire: l.base_affaire,
            statut: l.statut,
            imputation: l.imputation,
            designation: l.designation,
            client: l.client_id ? noms.get(l.client_id) ?? null : null,
            date_livraison: l.date_livraison,
            date_estimee: l.date_livraison_estimee,
            disparue: l.disparue,
            heures: { meca: n(l.heures_meca), calcul: n(l.heures_calcul), elec: n(l.heures_elec), pneu: n(l.heures_pneu), scan: n(l.heures_scan), autre: n(l.heures_autre) },
            heures_total: n(l.heures_total),
            m: {
              montant: n(m?.montant),
              echeances: n(m?.montant_echeances),
              meca: n(m?.montant_meca),
              calcul: n(m?.montant_calcul),
              elec_pneu: n(m?.montant_elec_pneu),
              scan: n(m?.montant_scan),
              autre: n(m?.montant_autre),
              achats: n(m?.montant_achats),
              negoce: n(m?.montant_negoce),
            },
          };
        })
      );

      // heures passées par affaire (famille) et par groupe d'activité
      const versDiscipline: Record<string, Discipline> = { "Méca": "meca", Calcul: "calcul", Elec: "elec", Pneu: "pneu", Scan: "scan", Autre: "autre" };
      const groupeActivite = new Map<string, Groupe>();
      for (const c of (corr.data ?? []) as { colonne_excel: string; activite_id: string | null }[]) {
        const d = versDiscipline[c.colonne_excel];
        if (c.activite_id && d) groupeActivite.set(c.activite_id, GROUPE_DISCIPLINE[d]);
      }
      for (const a of (acts.data ?? []) as { id: string; nom: string }[]) if (/^negoce/.test(sansAccents(a.nom))) groupeActivite.set(a.id, "Négoce");
      const rb = new Map<string, ParGroupe>();
      const tb = new Map<string, number>();
      for (const x of realise) {
        if (x.type_affaire !== "CBE") continue;
        const k = String(x.numero).replace(/^0+/, "");
        // TRAJETS_A_PART : les trajets (code HT) sur une ligne à part, comptés dans le coût
        if (estTrajet(x.code)) {
          tb.set(k, (tb.get(k) ?? 0) + (Number(x.heures) || 0));
          continue;
        }
        const g = rb.get(k) ?? groupesVides();
        g[(x.activite_id && groupeActivite.get(x.activite_id)) || "Autre"] += Number(x.heures) || 0;
        rb.set(k, g);
      }
      setRealiseParBase(rb);
      setTrajetsParBase(tb);
      setCouts(new Map(((co.data ?? []) as { annee: number; cout_horaire: number | string }[]).map((c) => [c.annee, Number(c.cout_horaire)])));
      setEstAdmin(Boolean(moi?.estAdmin));

      // RENTABILITE_V2 : mois facturés des PE / PI (relevé validé) et historique importé
      const [pl, pm, af, hi] = await Promise.all([
        supabase.from("prestation_lignes").select("id,affaire_id"),
        chargerTout<{ ligne_id: string; mois: string; montant_fige: number | string | null; heures_fige: number | string | null }>((a, b) =>
          supabase.from("prestation_mois").select("ligne_id,mois,montant_fige,heures_fige").eq("valide", true).order("ligne_id").range(a, b)
        ),
        supabase.from("pilotage_affaires").select("id,numero,imputation,designation,statut,date_livraison").eq("type", "CBE"),
        chargerTout<{ mois: string; type: string; numero: string; heures: number | string; montant: number | string }>((a, b) =>
          supabase.from("prestation_historique").select("mois,type,numero,heures,montant").order("id").range(a, b)
        ).catch(() => []),
      ]);
      if (!actif) return;
      const affaires = new Map(((af.data ?? []) as { id: string; numero: string; imputation: string | null; designation: string | null }[]).map((a) => [a.id, a]));
      setPilotageCBE((af.data ?? []) as { numero: string; statut: string; date_livraison: string | null; imputation: string | null; designation: string | null }[]);
      const ligneAffaire = new Map(((pl.data ?? []) as { id: string; affaire_id: string }[]).map((l) => [l.id, l.affaire_id]));
      const prest: { base: string; imputation: string; designation: string | null; mois: string; ca: number; hFact: number }[] = [];
      const moisReleve = new Set<string>();
      for (const m of pm) {
        const a = affaires.get(ligneAffaire.get(m.ligne_id) ?? "");
        if (!a || (a.imputation !== "PE" && a.imputation !== "PI")) continue;
        const mois = String(m.mois).slice(0, 7);
        moisReleve.add(mois);
        prest.push({ base: (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, ""), imputation: a.imputation, designation: a.designation, mois, ca: n(m.montant_fige), hFact: n(m.heures_fige) });
      }
      // l'historique ne sert que pour les mois sans relevé validé (pas de double compte)
      const designations = new Map([...affaires.values()].map((a) => [(a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, ""), a.designation]));
      for (const h of hi) {
        const mois = String(h.mois).slice(0, 7);
        const type = String(h.type ?? "").toUpperCase();
        if (moisReleve.has(mois) || (type !== "PE" && type !== "PI")) continue;
        const base = (String(h.numero ?? "").match(/\d+/)?.[0] ?? "").replace(/^0+/, "");
        if (!base) continue;
        prest.push({ base, imputation: type, designation: designations.get(base) ?? null, mois, ca: n(h.montant), hFact: n(h.heures) });
      }
      setPrestations(prest);
    })()
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger la rentabilité."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  useEffect(() => {
    let actif = true;
    void (async () => {
      const m = new Map<string, Map<string, number>>();
      for (let a = 0; a < 300000; a += 1000) {
        const r = await supabase.rpc("realise_par_mois").range(a, a + 999);
        if (r.error || !r.data) break;
        for (const x of r.data as { type_affaire: string; numero: string; mois: string; heures: number | string }[]) {
          if (x.type_affaire !== "CBE") continue;
          const k = (String(x.numero ?? "").match(/\d+/)?.[0] ?? "").replace(/^0+/, "");
          const mm = m.get(k) ?? new Map<string, number>();
          const mois = String(x.mois).slice(0, 7);
          mm.set(mois, (mm.get(mois) ?? 0) + (Number(x.heures) || 0));
          m.set(k, mm);
        }
        if ((r.data as unknown[]).length < 1000) break;
      }
      if (actif) setPointeExercice(m);
    })();
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

  const vue = useMemo(() => {
    const exclues = new Set(AFFAIRES_EXCLUABLES.filter((x) => x.exercice === exercice && retirees.has(`${exercice}:${x.base}`)).map((x) => x.base));
    const debut = `${exercice}-11-01`;
    const fin = `${exercice + 1}-10-31`;
    const affaires: Affaire[] = [];
    const parGroupe = new Map<string, LigneRenta>();
    const ajouter = (cle: string, ca: number, achats: number, hc: number, hr: number, cout: number | null, auMontant: boolean) => {
      const l = parGroupe.get(cle) ?? { cle, libelle: cle, ca: 0, achats: 0, hc: 0, hr: 0, cout: 0, auMontant, cumul: cumulVide() };
      l.ca += ca;
      l.achats += achats;
      l.hc += hc;
      l.hr += hr;
      l.cout = l.cout === null || cout === null ? null : l.cout + cout;
      // MARGES_POS_NEG : la marge de cette part d'affaire
      if (cout !== null && (Math.abs(ca) > 0.5 || Math.abs(cout) > 0.5)) {
        const c = l.cumul ?? (l.cumul = cumulVide());
        const m = ca - cout;
        if (m >= 0) {
          c.pos += m;
          c.caPos += ca;
          c.nPos++;
        } else {
          c.neg += m;
          c.caNeg += ca;
          c.nNeg++;
        }
      }
      parGroupe.set(cle, l);
    };

    for (const a of affairesTerminees(lignesFin)) {
      if (a.date_fin < debut || a.date_fin > fin) continue;
      const base = a.base_affaire.replace(/^0+/, "");
      if (exclues.has(base)) continue; // AFFAIRES_EXCLUABLES
      // HEURES_SANS_GROUPE : heures sans activité reconnue, réparties sur les activités de l'affaire
      // (au prorata de ses autres heures passées, à défaut de ses heures chiffrées)
      const rg: ParGroupe = { ...(realiseParBase.get(base) ?? groupesVides()) };
      if (rg["Autre"] > 0.01) {
        const cibles = GROUPES.filter((g) => g !== "Autre" && g !== "Non ventilé");
        let poids = cibles.map((g) => [g, rg[g]] as const);
        if (poids.reduce((s, [, x]) => s + x, 0) <= 0.01) poids = cibles.map((g) => [g, a.heuresChiffrees[g]] as const);
        const tot = poids.reduce((s, [, x]) => s + x, 0);
        if (tot > 0.01) {
          for (const [g, x] of poids) rg[g] += rg["Autre"] * (x / tot);
          rg["Autre"] = 0;
        }
      }
      const hr = GROUPES.reduce((t, g) => t + rg[g], 0);
      const hc = GROUPES.reduce((t, g) => t + a.heuresChiffrees[g], 0);
      const c = coutHoraire(couts, a.date_fin);
      const tr = trajetsParBase.get(base) ?? 0;
      // RENTABILITE_NEGOCE : une affaire de négoce / scan qui a des heures chiffrées se compare comme les autres
      const montant = venteAuMontant(a.imputation) && hc <= 0.01;
      const hcNegoce = a.heuresChiffrees["Négoce"];
      const cleNegoce = hcNegoce > 0.01 ? "Négoce" : "Négoce au montant";
      /* RENTABILITE_V3 : montant non détaillé par activité dans le Suivi d'affaire : réparti au prorata des heures chiffrées
         (à défaut, des heures passées), pour ne pas laisser le CA d'un côté et le coût des heures de l'autre */
      const pg: ParGroupe = { ...a.parGroupe };
      let nonVentile: Affaire["nonVentile"] = null;
      if (!montant && pg["Non ventilé"] > 0.01) {
        const poids = (src: ParGroupe) => GROUPES.filter((g) => g !== "Non ventilé" && g !== "Négoce").map((g) => [g, src[g]] as const);
        let w = poids(a.heuresChiffrees);
        nonVentile = "CHIFFRE";
        if (w.reduce((t, [, x]) => t + x, 0) <= 0) {
          w = poids(rg);
          nonVentile = "PASSE";
        }
        const tot = w.reduce((t, [, x]) => t + x, 0);
        if (tot > 0) {
          for (const [g, x] of w) pg[g] += pg["Non ventilé"] * (x / tot);
          pg["Non ventilé"] = 0;
        } else nonVentile = "AUCUN";
      }
      const activite = (() => {
        if (montant) return /^scan/.test(sansAccents(a.imputation)) ? "Scan" : "Négoce";
        let meilleure = "Non ventilé";
        let plus = 0;
        for (const g of GROUPES) if (g !== "Non ventilé" && (pg[g] ?? 0) > plus) [meilleure, plus] = [g, pg[g]];
        if (plus <= 0) for (const g of GROUPES) if ((rg[g] ?? 0) > plus) [meilleure, plus] = [g, rg[g]];
        return meilleure;
      })();
      affaires.push({
        activite,
        cle: base,
        libelle: `CBE ${base}`,
        base,
        designation: a.designation,
        client: a.client,
        fin: a.date_fin,
        imputation: a.imputation,
        ca: a.montant,
        achats: a.achats,
        hc,
        hr,
        cout: c === null ? null : a.achats + (hr + tr) * c,
        auMontant: montant,
        nonVentile,
        trajets: tr,
      });
      if (tr > 0.01) ajouter("Trajets", 0, 0, 0, tr, c === null ? null : tr * c, false);
      if (montant) {
        // négoce / scan pur : l'affaire entière dans sa ligne, heures passées comprises
        ajouter(/^scan/.test(sansAccents(a.imputation)) ? "Scan" : "Négoce au montant", a.montant, a.achats, 0, hr, c === null ? null : a.achats + hr * c, true);
        continue;
      }
      for (const g of GROUPES) {
        if (g === "Négoce") continue;
        if (pg[g] === 0 && rg[g] === 0 && a.heuresChiffrees[g] === 0) continue;
        ajouter(g, pg[g], 0, a.heuresChiffrees[g], rg[g], c === null ? null : rg[g] * c, false);
      }
      if (pg["Négoce"] > 0 || a.achats > 0 || rg["Négoce"] > 0)
        ajouter(cleNegoce, pg["Négoce"], a.achats, hcNegoce > 0.01 ? hcNegoce : 0, rg["Négoce"], c === null ? null : a.achats + rg["Négoce"] * c, hcNegoce <= 0.01);
    }

    // RENTABILITE_V2 : PE / PI, mois facturés de l'exercice
    const moisEx = new Set(Array.from({ length: 12 }, (_, k) => new Date(Date.UTC(exercice, 10 + k, 1)).toISOString().slice(0, 7)));
    const parPrest = new Map<string, Prestation>();
    for (const p of prestations) {
      if (!moisEx.has(p.mois) || exclues.has(p.base)) continue;
      const x = parPrest.get(p.base) ?? { base: p.base, imputation: p.imputation, designation: p.designation, ca: 0, hFact: 0, mois: new Set<string>() };
      x.ca += p.ca;
      x.hFact += p.hFact;
      x.mois.add(p.mois);
      parPrest.set(p.base, x);
    }
    const cEx = coutHoraire(couts, debut);
    const prestationsEx: (LigneRenta & { base: string; designation: string | null; imputation: string; nbMois: number })[] = [...parPrest.values()].map((p) => {
      // seulement les heures pointées des mois facturés (pas celles d'un mois pas encore validé)
      const pm = pointeExercice.get(p.base);
      const hr = [...p.mois].reduce((t, m) => t + (pm?.get(m) ?? 0), 0);
      return { cle: p.base, libelle: `CBE ${p.base}`, base: p.base, designation: p.designation, imputation: p.imputation, nbMois: p.mois.size, ca: p.ca, achats: 0, hc: p.hFact, hr, cout: cEx === null ? null : hr * cEx, auMontant: false };
    });
    for (const p of prestationsEx) ajouter(p.imputation, p.ca, 0, p.hc, p.hr, p.cout, false);
    prestationsEx.sort((x, y) => {
      const mx = marge(x);
      const my = marge(y);
      if (mx === null || my === null) return 0;
      return mx / (x.ca || 1) - my / (y.ca || 1);
    });

    const ordre = [...GROUPES, "Négoce au montant", "Scan", "PE", "PI", "Trajets"];
    const groupes = [...parGroupe.values()].sort((x, y) => ordre.indexOf(x.cle) - ordre.indexOf(y.cle));
    const tout: LigneRenta[] = [...affaires, ...prestationsEx];
    const total: LigneRenta = {
      cle: "Total",
      libelle: "Total",
      ca: tout.reduce((t, a) => t + a.ca, 0),
      achats: tout.reduce((t, a) => t + a.achats, 0),
      hc: tout.filter((a) => !a.auMontant).reduce((t, a) => t + a.hc, 0),
      hr: tout.reduce((t, a) => t + a.hr, 0),
      trajets: tout.reduce((t, a) => t + (a.trajets ?? 0), 0),
      cout: tout.some((a) => a.cout === null) ? null : tout.reduce((t, a) => t + (a.cout ?? 0), 0),
      auMontant: false,
      cumul: groupes.reduce((c, g) => {
        const x = g.cumul ?? cumulVide();
        return { pos: c.pos + x.pos, neg: c.neg + x.neg, caPos: c.caPos + x.caPos, caNeg: c.caNeg + x.caNeg, nPos: c.nPos + x.nPos, nNeg: c.nNeg + x.nNeg };
      }, cumulVide()),
    };
    affaires.sort((x, y) => {
      const mx = marge(x);
      const my = marge(y);
      if (mx === null || my === null) return 0;
      return mx / (x.ca || 1) - my / (y.ca || 1);
    });
    /* RENTABILITE_V4 : livrées au Pilotage dans l'exercice, mais pas (encore) livrées dans le Suivi d'affaire */
    const analysees = new Set(affaires.map((a) => a.base));
    const famillesPilotage = new Map<string, typeof pilotageCBE>();
    for (const a of pilotageCBE) {
      if (a.statut === "ABANDONNEE" || a.imputation === "PE" || a.imputation === "PI") continue;
      const b = (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, "");
      famillesPilotage.set(b, [...(famillesPilotage.get(b) ?? []), a]);
    }
    const enAttente: { base: string; designation: string | null; livree: string; raison: string }[] = [];
    for (const [b, membres] of famillesPilotage) {
      if (analysees.has(b) || exclues.has(b) || !membres.every((m) => m.statut === "LIVREE")) continue;
      const livree = membres.map((m) => m.date_livraison ?? "").sort().slice(-1)[0];
      if (!livree || livree < debut || livree > fin) continue;
      const lignes = lignesFin.filter((l) => (l.base_affaire ?? "").replace(/^0+/, "") === b && (l.genre === "BASE" || l.genre === "AVENANT") && !l.disparue);
      const pasLivree = lignes.find((l) => l.statut !== "Livrée" && l.statut !== "Devis perdu" && l.statut !== "Commande annulée");
      const raison =
        lignes.length === 0
          ? "absente du Suivi d’affaire"
          : pasLivree
            ? `encore « ${pasLivree.statut ?? "sans statut"} » dans le Suivi d’affaire (${pasLivree.cle})`
            : lignes.some((l) => l.statut === "Livrée" && !l.date_livraison)
              ? "livrée dans le Suivi d’affaire, mais sans date de livraison"
              : "à vérifier dans le Suivi d’affaire";
      const laBase = membres.find((m) => /^\d+$/.test(m.numero)) ?? membres[0];
      enAttente.push({ base: b, designation: laBase.designation, livree, raison });
    }

    /* RENTABILITE_V6 : rapprochement avec le CA de l'exercice (Finances), qui compte chaque livraison ou échéance à sa date */
    const sz = (b: string) => b.replace(/^0+/, "");
    const mvts = mouvementsExcel(lignesFin, () => false).filter((m) => m.date >= debut && m.date <= fin && !exclues.has(sz(m.base_affaire)));
    const caForfaits = mvts.reduce((t, m) => t + m.montant, 0);
    const caSurAnalysees = mvts.filter((m) => analysees.has(sz(m.base_affaire))).reduce((t, m) => t + m.montant, 0);
    const basesEnCours = new Set(mvts.filter((m) => !analysees.has(sz(m.base_affaire))).map((m) => sz(m.base_affaire)));
    const prixForfaits = affaires.reduce((t, a) => t + a.ca, 0);
    const rapprochement = {
      caForfaits,
      caSurAnalysees,
      caEnCours: caForfaits - caSurAnalysees,
      nbEnCours: basesEnCours.size,
      factureAvant: prixForfaits - caSurAnalysees,
      prixForfaits,
      caPrestations: prestationsEx.reduce((t, p) => t + p.ca, 0),
    };

    return { affaires, groupes, total, prestationsEx, enAttente, rapprochement };
  }, [lignesFin, realiseParBase, trajetsParBase, couts, exercice, prestations, pointeExercice, pilotageCBE, retirees]);

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
          {(l.trajets ?? 0) > 0.01 && l.cle !== "Trajets" && <div style={{ fontSize: 11, color: C.gris }}>+ {formatHeures(l.trajets ?? 0)} de trajet</div>}
        </td>
        <td style={{ ...td, color: C.gris }}>{l.cle === "Trajets" ? <span style={{ fontSize: 11 }}>code HT</span> : l.auMontant ? <span style={{ fontSize: 11 }}>au montant</span> : parHeure(tauxVendu(l))}</td>
        <td style={{ ...td, fontWeight: 800, color: l.cle === "Trajets" ? undefined : couleurObtenu(l, coutRef) }}>{l.cle === "Trajets" ? "—" : parHeure(tauxObtenu(l))}</td>
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
