"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import DetailMontant, { type DetailDemande } from "@/components/finances/DetailMontant";
import TrameCA from "@/components/finances/TrameCA"; // TRAME_CA_V1
import { chargerMoi, chargerRealise, chargerTout } from "@/lib/pilotageDonnees";
import { exporterExcelPolynov, type ColonneExcel, type FeuilleExcel } from "@/lib/excelPolynov";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";
import {
  GROUPES,
  GROUPE_DISCIPLINE,
  affairesTerminees,
  coutHoraire,

  groupesVides,
  moisExercice,
  mouvementsAttendus,
  mouvementsExcel,
  type Discipline,
  type Groupe,
  type LigneFin,
  type MouvementCA,
  type ParGroupe,
} from "@/lib/finances";

/* ===============================================================
   ANALYSE - FINANCES (ADMIN seulement)

   Sur un EXERCICE (novembre → octobre), les 12 mois d'un coup :
   - chiffre d'affaires réalisé face au PRÉVISIONNEL saisi mois par mois,
     écarts et cumuls, et N-1 ;
   - le CA ATTENDU (pas encore livré / facturé) et l'ATTERRISSAGE
     (réalisé + attendu) : forfaits non livrés au mois de leur « Délai
     estimé » (en retard : mois en cours ; sans délai : non comptés, listés
     « à dater ») ; PE / PI d'après le relevé non validé, sinon les onglets
     futurs du Suivi des prestations importé ;
   - le réalisé par imputation et par activité ;
   - le croisement activités × imputations ;
   - la rentabilité (coût de structure saisi par exercice) : marge, prix de
     vente obtenu, marge du négoce, affaire par affaire.

   Règles de calcul : lib/finances.ts (CA à la livraison, échéances à leur
   date, PE / PI par le relevé des prestations validé ; pour les mois que
   le relevé ne couvre pas, l'historique importé de l'ancien classeur
   « Suivi des prestations »).
================================================================ */

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/* NEGOCE_ROBUSTE : « Négoce », « NEGOCE », « Negoce »… (accents et majuscules ignorés) */
const estNegoceImp = (imp: string | null | undefined) => /^negoce/.test((imp ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const keuros = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n));
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`);

type Releve = { base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null; heures?: number; jours?: number };
type Historique = {
  mois: string;
  categorie: string;
  type: string;
  numero: string;
  client: string | null;
  montant_meca: number;
  montant_calcul: number;
  montant_elec: number;
  montant: number;
};

function exerciceCourant(): number {
  const d = new Date();
  return d.getMonth() + 1 >= 11 ? d.getFullYear() : d.getFullYear() - 1;
}

function FinancesContenu() {
  const [exercice, setExercice] = useState(exerciceCourant);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [onglet, setOnglet] = useState<"CA" | "ACTIVITES">("CA"); // FINANCES_ONGLETS

  const [lignesFin, setLignesFin] = useState<LigneFin[]>([]);
  const [releve, setReleve] = useState<Releve[]>([]);
  const [historique, setHistorique] = useState<Historique[]>([]);
  // PE / PI : montants prévus des mois non validés du relevé
  const [prevusReleve, setPrevusReleve] = useState<{ base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null }[]>([]);
  const [realiseGroupes, setRealiseGroupes] = useState<Map<string, ParGroupe>>(new Map());
  const [realiseMensuel, setRealiseMensuel] = useState<Map<string, { mois: string; heures: number }[]>>(new Map());
  const [couts, setCouts] = useState<Map<number, number>>(new Map());
  const [previsionnel, setPrevisionnel] = useState<Map<string, number>>(new Map()); // AAAA-MM -> €

  // DETAIL_FAIT_PLUS_TARD : fenêtre du détail (un mois « AAAA-MM », ou « EXERCICE » pour tout ce qui reste à facturer)
  const [detailReport, setDetailReport] = useState<string | null>(null);

  /* FAIT_PLUS_TARD : mois de PE / PI reportés (travail fait, facturé plus tard) */
  const [donneesReport, setDonneesReport] = useState<{
    lignes: { id: string; affaire_id: string; taux: number | null; unite: string; base_horaire: number }[];
    affaires: Map<string, { numero: string; statut: string; imputation: string | null }>;
    moisLignes: Map<string, { reporte: boolean; valide: boolean }>;
    heures: Map<string, number>;
  } | null>(null);
  useEffect(() => {
    (async () => {
      const [pl, pa, pmAll] = await Promise.all([
        supabase.from("prestation_lignes").select("id,affaire_id,taux,unite,base_horaire"),
        supabase.from("pilotage_affaires").select("id,numero,statut,imputation"),
        chargerTout<{ ligne_id: string; mois: string; reporte: boolean | null; valide: boolean | null }>((a, b) =>
          supabase.from("prestation_mois").select("ligne_id,mois,reporte,valide").order("ligne_id").range(a, b)
        ),
      ]);
      const affaires = new Map(((pa.data ?? []) as { id: string; numero: string; statut: string; imputation: string | null }[]).map((a) => [a.id, a]));
      const lignes = ((pl.data ?? []) as { id: string; affaire_id: string; taux: number | string | null; unite: string; base_horaire: number | string | null }[]).map((l) => ({
        id: l.id,
        affaire_id: l.affaire_id,
        taux: l.taux === null ? null : Number(l.taux),
        unite: l.unite,
        base_horaire: Number(l.base_horaire) || 7,
      }));
      const moisLignes = new Map(pmAll.map((x) => [`${x.ligne_id}|${String(x.mois).slice(0, 7)}`, { reporte: Boolean(x.reporte), valide: Boolean(x.valide) }]));
      // seules les lignes qui ont (ou ont pu avoir) un mois reporté
      const candidates = lignes.filter((l) => affaires.get(l.affaire_id)?.statut === "EN_ATTENTE" || pmAll.some((x) => x.ligne_id === l.id && x.reporte)).map((l) => l.id);
      const heures = new Map<string, number>();
      if (candidates.length > 0) {
        const sa = await chargerTout<{ ligne_id: string; jour: string; heures: number | string | null }>((a, b) =>
          supabase.from("prestation_saisies").select("ligne_id,jour,heures").in("ligne_id", candidates).order("ligne_id").range(a, b)
        );
        for (const s of sa) {
          const k = `${s.ligne_id}|${s.jour.slice(0, 7)}`;
          heures.set(k, (heures.get(k) ?? 0) + (Number(s.heures) || 0));
        }
      }
      setDonneesReport({ lignes, affaires, moisLignes, heures });
    })().catch(() => setDonneesReport(null));
  }, []);

  /* Chaque mois reporté d'une ligne : son montant (heures × taux), et le mois où il se facture
     (premier mois suivant non reporté ; null si pas encore connu) */
  const reportsPEPI = useMemo(() => {
    if (!donneesReport) return [];
    const { lignes, affaires, moisLignes, heures } = donneesReport;
    const suivant = (m: string) => {
      const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1));
      return d.toISOString().slice(0, 7);
    };
    const res: { m: string; montant: number; facture: string | null; factureValide: boolean; auto: boolean; numero: string; imputation: string | null; heures: number }[] = [];
    for (const l of lignes) {
      const a = affaires.get(l.affaire_id);
      if (!a || l.taux === null) continue;
      const tauxH = l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux;
      const reporteEn = (m: string) => {
        const row = moisLignes.get(`${l.id}|${m}`);
        return row ? row.reporte : a.statut === "EN_ATTENTE";
      };
      for (const [cle, h] of heures) {
        if (!cle.startsWith(`${l.id}|`) || h <= 0) continue;
        const m = cle.slice(l.id.length + 1);
        if (!reporteEn(m)) continue;
        const row = moisLignes.get(`${l.id}|${m}`);
        let facture: string | null = null;
        let x = suivant(m);
        for (let k = 0; k < 24; k++, x = suivant(x)) {
          if (!reporteEn(x)) {
            facture = x;
            break;
          }
        }
        res.push({
          m,
          montant: Math.round(h * tauxH * 100) / 100,
          facture,
          factureValide: facture ? Boolean(moisLignes.get(`${l.id}|${facture}`)?.valide) : false,
          auto: !row,
          heures: h,
          numero: (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, ""),
          imputation: a.imputation,
        });
      }
    }
    return res;
  }, [donneesReport]);

  const [coutSaisi, setCoutSaisi] = useState("");
  const [totalAnnuel, setTotalAnnuel] = useState("");
  const [evolution, setEvolution] = useState("0");
  const [voirAffaires, setVoirAffaires] = useState(false);
  // EN_COURS_A_DATE : date à laquelle on calcule les en-cours (aujourd'hui par défaut)
  const [dateEnCours, setDateEnCours] = useState(() => new Date().toISOString().slice(0, 10));
  // montant cliqué dans le tableau mois par mois (activité ou imputation)
  const [detail, setDetail] = useState<DetailDemande | null>(null);
  // la Direction consulte : prévisionnel et coût de structure restent saisis par l'administration
  const [estAdmin, setEstAdmin] = useState(false);

  useEffect(() => {
    chargerMoi()
      .then((m) => setEstAdmin(Boolean(m?.estAdmin)))
      .catch(() => setEstAdmin(false));
  }, []);

  /* AJUSTEMENTS_CA : montants ajoutés à la main au réalisé d'un mois (écart avec la compta), SQL 70 */
  const [ajustements, setAjustements] = useState<{ mois: string; montant: number; motif: string }[]>([]);
  useEffect(() => {
    supabase
      .from("finances_ajustements")
      .select("mois,montant,motif")
      .then(({ data }) =>
        setAjustements(((data ?? []) as { mois: string; montant: number | string; motif: string }[]).map((a) => ({ mois: String(a.mois).slice(0, 10), montant: Number(a.montant) || 0, motif: a.motif })))
      );
  }, []);

  /* ------------------------------ chargement ------------------------------ */

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const n = (v: number | string | null | undefined) => Number(v) || 0;
        const [brutes, montants, clients, realise, mensuel, corr, pl, pm, pa, co, pr, hi, mp] = await Promise.all([
          chargerTout<{
            id: string;
            cle: string;
            parent_cle: string | null;
            genre: LigneFin["genre"];
            base_affaire: string | null;
            statut: string | null;
            imputation: string | null;
            designation: string | null;
            client_id: string | null;
            date_livraison: string | null;
            date_livraison_estimee: string | null;
            disparue: boolean;
            heures_meca: number | string;
            heures_calcul: number | string;
            heures_elec: number | string;
            heures_pneu: number | string;
            heures_scan: number | string;
            heures_autre: number | string;
            heures_total: number | string;
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
          chargerRealise().catch(() => []),
          supabase.rpc("realise_par_mois"),
          supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
          supabase.from("prestation_lignes").select("id,affaire_id,activite_id,base_horaire"),
          supabase.from("prestation_mois").select("ligne_id,mois,montant_fige,heures_fige").eq("valide", true),
          supabase.from("pilotage_affaires").select("id,numero,imputation").eq("type", "CBE"),
          supabase.from("indicateurs_couts").select("annee,cout_horaire"),
          supabase.from("finances_previsionnel").select("mois,montant"),
          chargerTout<Historique>((a, b) =>
            supabase
              .from("prestation_historique")
              .select("mois,categorie,type,numero,client,montant_meca,montant_calcul,montant_elec,montant")
              .order("id")
              .range(a, b)
          ).catch(() => [] as Historique[]),
          supabase.rpc("prestation_montants_prevus"),
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

        const colonneVersDiscipline: Record<string, Discipline> = { "Méca": "meca", Calcul: "calcul", Elec: "elec", Pneu: "pneu", Scan: "scan", Autre: "autre" };
        const groupeActivite = new Map<string, Groupe>();
        for (const c of ((corr.data ?? []) as { colonne_excel: string; activite_id: string | null }[])) {
          const d = colonneVersDiscipline[c.colonne_excel];
          if (c.activite_id && d) groupeActivite.set(c.activite_id, GROUPE_DISCIPLINE[d]);
        }
        const rg = new Map<string, ParGroupe>();
        for (const x of realise) {
          if (x.type_affaire !== "CBE") continue;
          const k = String(x.numero).replace(/^0+/, "");
          const g = rg.get(k) ?? groupesVides();
          g[(x.activite_id && groupeActivite.get(x.activite_id)) || "Autre"] += Number(x.heures) || 0;
          rg.set(k, g);
        }
        setRealiseGroupes(rg);

        const mm = new Map<string, { mois: string; heures: number }[]>();
        for (const x of ((mensuel.data ?? []) as { type_affaire: string; numero: string; mois: string; heures: number | string }[])) {
          if (x.type_affaire !== "CBE") continue;
          const k = String(x.numero).replace(/^0+/, "");
          mm.set(k, [...(mm.get(k) ?? []), { mois: String(x.mois).slice(0, 7), heures: Number(x.heures) || 0 }]);
        }
        setRealiseMensuel(mm);

        const affairesPil = new Map(((pa.data ?? []) as { id: string; numero: string; imputation: string | null }[]).map((a) => [a.id, a]));
        const lignesPrest = new Map(((pl.data ?? []) as { id: string; affaire_id: string; activite_id: string | null; base_horaire: number | string | null }[]).map((x) => [x.id, x]));
        const clientDeBase = new Map<string, string | null>();
        for (const l of brutes) if (l.genre === "BASE" && l.base_affaire) clientDeBase.set(l.base_affaire, l.client_id ? noms.get(l.client_id) ?? null : null);
        const rel: Releve[] = [];
        for (const x of (pm.data ?? []) as { ligne_id: string; mois: string; montant_fige: number | string | null; heures_fige: number | string | null }[]) {
          const lp = lignesPrest.get(x.ligne_id);
          const a = lp ? affairesPil.get(lp.affaire_id) : undefined;
          if (!lp || !a) continue;
          // famille de l'affaire = numéro de base (1604R2 -> 1604) : réalisé et client y sont rattachés
          const base = (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, "");
          rel.push({
            base,
            mois: String(x.mois).slice(0, 10),
            montant: Number(x.montant_fige) || 0,
            groupe: (lp.activite_id && groupeActivite.get(lp.activite_id)) || "Non ventilé",
            imputation: a.imputation,
            client: clientDeBase.get(base) ?? null,
            heures: Number(x.heures_fige) || 0,
            jours: (Number(x.heures_fige) || 0) / (Number(lp.base_horaire) || 7),
          });
        }
        setReleve(rel);
        setPrevusReleve(
          ((mp.data ?? []) as { numero: string; imputation: string | null; activite_id: string | null; mois: string; montant: number | string }[]).map((x) => {
            const base = (x.numero.match(/^\d+/)?.[0] ?? x.numero).replace(/^0+/, "");
            return {
              base,
              mois: String(x.mois).slice(0, 10),
              montant: Number(x.montant) || 0,
              groupe: (x.activite_id && groupeActivite.get(x.activite_id)) || "Non ventilé",
              imputation: x.imputation,
              client: clientDeBase.get(base) ?? null,
            };
          })
        );
        setHistorique(
          hi.map((h) => ({
            ...h,
            mois: String(h.mois).slice(0, 10),
            montant_meca: Number(h.montant_meca) || 0,
            montant_calcul: Number(h.montant_calcul) || 0,
            montant_elec: Number(h.montant_elec) || 0,
            montant: Number(h.montant) || 0,
          }))
        );
        setCouts(new Map(((co.data ?? []) as { annee: number; cout_horaire: number | string }[]).map((c) => [c.annee, Number(c.cout_horaire)])));
        setPrevisionnel(new Map(((pr.data ?? []) as { mois: string; montant: number | string }[]).map((p) => [String(p.mois).slice(0, 7), Number(p.montant) || 0])));
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger les finances.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, []);

  /* ------------------------------ calculs ------------------------------ */

  const mouvements = useMemo(() => {
    const viaReleve = new Set(releve.map((r) => r.base));
    const mvExcel = mouvementsExcel(lignesFin, (b) => viaReleve.has(b.replace(/^0+/, "")));
    const mvReleve: MouvementCA[] = releve.map((r) => {
      const g = groupesVides();
      g[r.groupe] = r.montant;
      return { date: r.mois, base_affaire: r.base, source: "RELEVE", montant: r.montant, parGroupe: g, negoce: 0, achats: 0, client: r.client, imputation: r.imputation };
    });
    // Historique de l'ancien classeur : seulement les mois que le relevé validé ne couvre pas
    const moisCourantIso = new Date().toISOString().slice(0, 7);
    // historique : lignes du Suivi des prestations NON rattachées au relevé (l'import les range à part) ;
    // mois passés = réalisé, mois en cours et futurs = attendu
    const mvHisto: MouvementCA[] = historique
      .filter((h) => h.mois.slice(0, 7) < moisCourantIso)
      .map((h) => {
        const g = groupesVides();
        g["Méca"] = h.montant_meca;
        g.Calcul = h.montant_calcul;
        g["Elec / Pneu"] = h.montant_elec;
        const ecart = h.montant - (h.montant_meca + h.montant_calcul + h.montant_elec);
        if (Math.abs(ecart) > 0.5) g["Non ventilé"] = ecart;
        return {
          date: h.mois,
          base_affaire: `${h.type}${h.numero}`,
          source: "HISTORIQUE",
          montant: h.montant,
          parGroupe: g,
          negoce: 0,
          achats: 0,
          client: h.client,
          imputation: h.categorie,
        };
      });
    const mvAjust: MouvementCA[] = ajustements.map((a) => {
      const g = groupesVides();
      g["Non ventilé"] = a.montant;
      return { date: a.mois, base_affaire: "Ajustement", source: "HISTORIQUE", montant: a.montant, parGroupe: g, negoce: 0, achats: 0, client: a.motif, imputation: "Ajustement" };
    });
    return [...mvExcel, ...mvReleve, ...mvHisto, ...mvAjust];
  }, [lignesFin, releve, historique, ajustements]);

  /* CA ATTENDU : forfaits non livrés (délai estimé) + PE / PI prévues */
  const attendus = useMemo(() => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const moisCourantIso = aujourdhui.slice(0, 7);
    const forfaits = mouvementsAttendus(lignesFin, aujourdhui);

    // PE / PI : le relevé non validé d'abord ; pour les mois qu'il ne couvre pas (ni validé ni prévu),
    // les onglets futurs du Suivi des prestations importé
    const pepi: MouvementCA[] = [
      ...prevusReleve
        .filter((p) => p.montant > 0)
        .map((p) => {
          const g = groupesVides();
          g[p.groupe] = p.montant;
          return { date: p.mois, base_affaire: p.base, source: "ATTENDU" as const, montant: p.montant, parGroupe: g, negoce: 0, achats: 0, client: p.client, imputation: p.imputation };
        }),
      ...historique
        .filter((h) => h.mois.slice(0, 7) >= moisCourantIso)
        .map((h) => {
          const g = groupesVides();
          g["Méca"] = h.montant_meca;
          g.Calcul = h.montant_calcul;
          g["Elec / Pneu"] = h.montant_elec;
          return { date: h.mois, base_affaire: `${h.type}${h.numero}`, source: "ATTENDU" as const, montant: h.montant, parGroupe: g, negoce: 0, achats: 0, client: h.client, imputation: h.categorie };
        }),
    ];
    // FAIT_PLUS_TARD : un mois reporté se compte dans l'attendu du mois où il sera facturé (pas encore clôturé),
    // et sort de son propre mois quand le report vient de la commande pas encore reçue
    const correctifs: MouvementCA[] = [];
    const moisApres = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);
    for (const r of reportsPEPI) {
      const g = (v: number) => {
        const x = groupesVides();
        x["Non ventilé"] = v;
        return x;
      };
      if (r.auto) {
        correctifs.push({ date: `${r.m}-01`, base_affaire: r.numero, source: "ATTENDU", montant: -r.montant, parGroupe: g(-r.montant), negoce: 0, achats: 0, client: null, imputation: r.imputation });
      }
      // HORS_ATTERRISSAGE : le travail facturé plus tard n'entre dans l'attendu d'aucun mois ; il ne compte qu'une fois facturé (mois clôturé)
      void moisApres;
    }
    return { mouvements: [...forfaits.mouvements, ...pepi, ...correctifs], aDater: forfaits.aDater, enRetard: forfaits.mouvements.filter((m) => m.retard) };
  }, [lignesFin, releve, prevusReleve, historique, reportsPEPI]);

  const mois = useMemo(() => moisExercice(exercice), [exercice]);
  const moisN1 = useMemo(() => moisExercice(exercice - 1), [exercice]);

  const vue = useMemo(() => {
    const parMois = (liste: string[], f: (x: MouvementCA) => number = (x) => x.montant) =>
      liste.map((m) => mouvements.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + f(x), 0));

    const realise = parMois(mois);
    const realiseN1 = parMois(moisN1);
    const attendu = mois.map((m) => attendus.mouvements.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + x.montant, 0));
    const prevu = mois.map((m) => previsionnel.get(m) ?? 0);
    const debut = `${mois[0]}-01`;
    const fin = `${mois[11]}-31`;
    const dansEx = mouvements.filter((x) => x.date >= debut && x.date <= fin);

    // imputations présentes
    const imputations = [...new Set(dansEx.map((x) => x.imputation ?? "—"))].sort();
    const parImputation = imputations.map((imp) => ({
      cle: imp,
      valeurs: mois.map((m) => dansEx.filter((x) => (x.imputation ?? "—") === imp && x.date.startsWith(m)).reduce((t, x) => t + x.montant, 0)),
    }));
    const parActivite = GROUPES.map((g) => ({
      cle: g,
      valeurs: mois.map((m) => dansEx.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + x.parGroupe[g], 0)),
    })).filter((r) => r.valeurs.some((v) => Math.abs(v) > 0.5));

    // croisement activités × imputations
    const croisement = new Map<string, number>();
    for (const x of dansEx) for (const g of GROUPES) {
      const k = `${g}|${x.imputation ?? "—"}`;
      croisement.set(k, (croisement.get(k) ?? 0) + x.parGroupe[g]);
    }

    // rentabilité de l'exercice
    const terminees = affairesTerminees(lignesFin)
      .filter((a) => a.date_fin >= debut && a.date_fin <= fin)
      .map((a) => {
        const realiseG = realiseGroupes.get(a.base_affaire.replace(/^0+/, "")) ?? groupesVides();
        const heuresRealisees = GROUPES.reduce((t, g) => t + realiseG[g], 0);
        const cout = coutHoraire(couts, a.date_fin);
        const coutTotal = cout === null ? null : heuresRealisees * cout + a.achats;
        return { ...a, realiseG, heuresRealisees, heuresChiffreesTotal: GROUPES.reduce((t, g) => t + a.heuresChiffrees[g], 0), coutTotal, marge: coutTotal === null ? null : a.montant - coutTotal };
      })
      .sort((x, y) => (x.marge === null || y.marge === null ? 0 : x.marge / (x.montant || 1) - y.marge / (y.montant || 1)));

    const prestations = new Map<string, { base: string; client: string | null; imputation: string | null; montant: number; heures: number; cout: number | null; groupe: Groupe }>();
    for (const r of releve) {
      if (r.mois < debut || r.mois > fin) continue;
      const p = prestations.get(r.base) ?? { base: r.base, client: r.client, imputation: r.imputation, montant: 0, heures: 0, cout: 0, groupe: r.groupe };
      p.montant += r.montant;
      prestations.set(r.base, p);
    }
    for (const p of prestations.values()) {
      const moisRel = new Set(releve.filter((r) => r.base === p.base && r.mois >= debut && r.mois <= fin).map((r) => r.mois.slice(0, 7)));
      for (const m of realiseMensuel.get(p.base) ?? []) {
        if (!moisRel.has(m.mois)) continue;
        p.heures += m.heures;
        const c = coutHoraire(couts, `${m.mois}-01`);
        p.cout = c === null || p.cout === null ? null : p.cout + m.heures * c;
      }
    }

    const parGroupeRenta = new Map<Groupe, { ca: number; heuresChiffrees: number; heuresRealisees: number; cout: number | null }>();
    const ajouter = (g: Groupe, ca: number, hc: number, hr: number, cout: number | null) => {
      const v = parGroupeRenta.get(g) ?? { ca: 0, heuresChiffrees: 0, heuresRealisees: 0, cout: 0 };
      v.ca += ca;
      v.heuresChiffrees += hc;
      v.heuresRealisees += hr;
      v.cout = v.cout === null || cout === null ? null : v.cout + cout;
      parGroupeRenta.set(g, v);
    };
    // NEGOCE_A_PART : une affaire de négoce pur compte entière dans « Négoce », avec le coût de ses heures
    const basesNegoce = new Set(
      lignesFin.filter((l) => l.genre === "BASE" && estNegoceImp(l.imputation) && l.base_affaire).map((l) => String(l.base_affaire).replace(/^0+/, ""))
    );
    // SCAN_A_PART : une affaire de scan compte entière dans « Scan », avec le coût de ses heures
    const basesScan = new Set(
      lignesFin.filter((l) => l.genre === "BASE" && /^scan/i.test(l.imputation ?? "") && l.base_affaire).map((l) => String(l.base_affaire).replace(/^0+/, ""))
    );
    for (const a of terminees) {
      const c = coutHoraire(couts, a.date_fin);
      if (basesScan.has(a.base_affaire.replace(/^0+/, ""))) {
        const hs = GROUPES.reduce((t, g) => t + a.realiseG[g], 0);
        ajouter("Scan", a.montant, 0, hs, c === null ? null : a.achats + hs * c);
        continue;
      }
      if (basesNegoce.has(a.base_affaire.replace(/^0+/, ""))) {
        const h = GROUPES.reduce((t, g) => t + a.realiseG[g], 0);
        ajouter("Négoce", a.montant, 0, h, c === null ? null : a.achats + h * c);
        continue;
      }
      for (const g of GROUPES) {
        if (g === "Négoce") continue;
        if (a.parGroupe[g] === 0 && a.realiseG[g] === 0 && a.heuresChiffrees[g] === 0) continue;
        ajouter(g, a.parGroupe[g], a.heuresChiffrees[g], a.realiseG[g], c === null ? null : a.realiseG[g] * c);
      }
      if (a.parGroupe["Négoce"] > 0 || a.achats > 0) ajouter("Négoce", a.parGroupe["Négoce"], 0, 0, a.achats);
    }
    for (const p of prestations.values()) ajouter(p.groupe, p.montant, 0, p.heures, p.cout);

    const listePrest = [...prestations.values()];
    const caRenta = terminees.reduce((t, a) => t + a.montant, 0) + listePrest.reduce((t, p) => t + p.montant, 0);
    const margeTotale =
      terminees.every((a) => a.marge !== null) && listePrest.every((p) => p.cout !== null)
        ? terminees.reduce((t, a) => t + (a.marge ?? 0), 0) + listePrest.reduce((t, p) => t + p.montant - (p.cout ?? 0), 0)
        : null;
    const heuresRenta = terminees.reduce((t, a) => t + a.heuresRealisees, 0) + listePrest.reduce((t, p) => t + p.heures, 0);
    const caHorsNegoce = caRenta - terminees.reduce((t, a) => t + a.parGroupe["Négoce"], 0);
    // TAUX_PEPI : taux de vente moyen des PE et des PI = montant facturé ÷ heures (ou jours) facturés, mois clôturés
    const tauxPEPI = (["PE", "PI"] as const).map((imp) => {
      const somme = (liste: Releve[]) => ({
        montant: liste.reduce((t, r) => t + r.montant, 0),
        heures: liste.reduce((t, r) => t + (r.heures ?? 0), 0),
        jours: liste.reduce((t, r) => t + (r.jours ?? 0), 0),
      });
      const duType = releve.filter((r) => r.imputation === imp && (r.heures ?? 0) > 0);
      return {
        imp,
        parMois: mois.map((m) => somme(duType.filter((r) => r.mois.startsWith(m)))),
        exercice: somme(duType.filter((r) => r.mois >= debut && r.mois <= fin)),
        n1: somme(duType.filter((r) => r.mois >= `${moisN1[0]}-01` && r.mois <= `${moisN1[11]}-31`)),
      };
    });

    const negoce = dansEx.reduce((t, x) => t + x.negoce, 0);
    const achats = dansEx.reduce((t, x) => t + x.achats, 0);

    return {
      realise,
      attendu,
      totalAttendu: attendu.reduce((t, v) => t + v, 0),
      realiseN1,
      prevu,
      imputations,
      parImputation,
      parActivite,
      croisement,
      total: realise.reduce((t, v) => t + v, 0),
      totalN1: realiseN1.reduce((t, v) => t + v, 0),
      totalPrevu: prevu.reduce((t, v) => t + v, 0),
      terminees,
      prestations: listePrest.sort((x, y) => y.montant - x.montant),
      parGroupeRenta: [...parGroupeRenta.entries()].filter(([, v]) => v.ca !== 0 || v.heuresRealisees !== 0),
      margeTotale,
      caRenta,
      prixObtenu: heuresRenta > 0 ? caHorsNegoce / heuresRenta : null,
      negoce,
      achats,
      tauxPEPI,
    };
  }, [mouvements, attendus, mois, moisN1, previsionnel, lignesFin, realiseGroupes, couts, releve, realiseMensuel]);

  /* ------------------------------ prévisionnel ------------------------------ */

  const enregistrerPrevus = useCallback(async (valeurs: Map<string, number>) => {
    setErreur("");
    const lignes = [...valeurs.entries()].map(([m, montant]) => ({ mois: `${m}-01`, montant: Math.max(0, Math.round(montant * 100) / 100) }));
    const { error } = await supabase.from("finances_previsionnel").upsert(lignes, { onConflict: "mois" });
    if (error) return setErreur(error.message);
    setPrevisionnel((p) => {
      const n = new Map(p);
      for (const [m, v] of valeurs) n.set(m, Math.max(0, v));
      return n;
    });
  }, []);

  function repartir(mode: "EGAL" | "N1") {
    const total = Number(totalAnnuel.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(total) || total <= 0) return setErreur("Saisissez un total annuel.");
    const base = vue.realiseN1.reduce((t, v) => t + v, 0);
    if (mode === "N1" && base <= 0) return setErreur("Pas de chiffre d’affaires sur l’exercice précédent pour répartir au prorata.");
    const valeurs = new Map(mois.map((m, i) => [m, mode === "EGAL" ? total / 12 : (total * vue.realiseN1[i]) / base]));
    void enregistrerPrevus(valeurs).then(() => setInfo(`Prévisionnel ${exercice}-${exercice + 1} réparti : ${euros(total)}.`));
  }

  function reprendreN1() {
    const k = 1 + (Number(evolution.replace(",", ".")) || 0) / 100;
    void enregistrerPrevus(new Map(mois.map((m, i) => [m, vue.realiseN1[i] * k]))).then(() =>
      setInfo(`Prévisionnel = réalisé ${exercice - 1}-${exercice} ${k === 1 ? "" : `${evolution} %`}.`)
    );
  }

  async function enregistrerCout() {
    const v = Number(coutSaisi.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return setErreur("Coût de structure invalide.");
    const { error } = await supabase.from("indicateurs_couts").upsert({ annee: exercice, cout_horaire: v }, { onConflict: "annee" });
    if (error) return setErreur(error.message);
    setCouts((m) => new Map(m).set(exercice, v));
    setCoutSaisi("");
  }

  /* ------------------------------ export ------------------------------ */

  /* EXPORT_FINANCES_V2 : classeur mis en page (titres, euros, totaux, en-têtes figés) */
  async function exporter() {
    type L = Record<string, string | number | null | undefined>;
    const moisEnCours = new Date().toISOString().slice(0, 7);
    const sous = `Exercice du 1er novembre ${exercice} au 31 octobre ${exercice + 1} · exporté le ${new Date().toLocaleDateString("fr-FR")}`;
    const colsMois = (somme: boolean): ColonneExcel[] => [
      { titre: "", cle: "poste", largeur: 40 },
      ...mois.map((m, i) => ({ titre: libMois(m), cle: `m${i}`, format: "euros" as const, largeur: 12, total: somme })),
      { titre: "Total", cle: "total", format: "euros" as const, largeur: 14, total: somme },
    ];
    const ligne = (poste: string, valeurs: (number | null)[], avecTotal = true): L => {
      const o: L = { poste, total: avecTotal ? Math.round(valeurs.reduce((t: number, v) => t + (v ?? 0), 0)) : null };
      valeurs.forEach((v, i) => (o[`m${i}`] = v === null ? null : Math.round(v)));
      return o;
    };
    let cR = 0;
    let cP = 0;
    const cumulR = vue.realise.map((v) => (cR += v));
    const cumulP = vue.prevu.map((v) => (cP += v));
    const atter = vue.realise.map((v, i) => v + vue.attendu[i]);
    const ecoule = mois.map((m) => m <= moisEnCours);
    const plusTard = mois.map((m) => reportsPEPI.filter((r) => r.m === m).reduce((t, r) => t + r.montant, 0));
    const nb = ecoule.filter(Boolean).length || 12;
    const rN = vue.realise.slice(0, nb).reduce((t, v) => t + v, 0);
    const rN1 = vue.realiseN1.slice(0, nb).reduce((t, v) => t + v, 0);

    const feuilles: FeuilleExcel[] = [
      {
        nom: "Mois par mois",
        titre: `Finances ${exercice}-${exercice + 1} — mois par mois`,
        sousTitre: sous,
        colonnes: colsMois(false),
        lignes: [
          ligne("Prévisionnel", vue.prevu),
          ligne("Réalisé (facturé)", vue.realise),
          ligne("Attendu (pas encore livré ou facturé)", vue.attendu),
          ligne("Atterrissage (réalisé + attendu)", atter),
          ligne("Écart atterrissage − prévisionnel", atter.map((v, i) => v - vue.prevu[i])),
          ligne("Cumul réalisé", cumulR.map((v, i) => (ecoule[i] ? v : null)), false),
          ligne("Cumul prévisionnel", cumulP, false),
          ligne("Écart cumulé réalisé − prévu", cumulR.map((v, i) => (ecoule[i] ? v - cumulP[i] : null)), false),
          ligne("Fait, facturé plus tard (hors atterrissage)", plusTard),
          ligne(`Réalisé ${exercice - 1}-${exercice} (N-1)`, vue.realiseN1),
        ],
        alerte: (l) => String(l.poste).startsWith("Écart") && Number(l.total ?? l[`m${nb - 1}`] ?? 0) < 0,
        notes: [
          `Réalisé face à N-1, à même date (${nb} mois) : ${Math.round(rN).toLocaleString("fr-FR")} € contre ${Math.round(rN1).toLocaleString("fr-FR")} €${rN1 > 0 ? ` (${rN >= rN1 ? "+" : ""}${Math.round((rN / rN1 - 1) * 100)} %)` : ""}.`,
          "Réalisé = facturé (forfaits livrés, PE / PI des mois clôturés). L’atterrissage n’inclut pas le travail facturé plus tard.",
        ],
      },
      {
        nom: "Par imputation",
        titre: `Réalisé par imputation — ${exercice}-${exercice + 1}`,
        sousTitre: sous,
        colonnes: colsMois(true),
        lignes: vue.parImputation.map((r) => ligne(r.cle, r.valeurs)),
        libelleTotal: "Total",
      },
      {
        nom: "Par activité",
        titre: `Réalisé par activité — ${exercice}-${exercice + 1}`,
        sousTitre: sous,
        colonnes: colsMois(true),
        lignes: vue.parActivite.map((r) => ligne(r.cle, r.valeurs)),
        libelleTotal: "Total",
      },
      {
        nom: "Activités x imputations",
        titre: `Activités × imputations — ${exercice}-${exercice + 1}`,
        sousTitre: sous,
        colonnes: [
          { titre: "Activité", cle: "activite", largeur: 22 },
          ...vue.imputations.map((imp) => ({ titre: imp, cle: `i_${imp}`, format: "euros" as const, largeur: 13, total: true })),
          { titre: "Total", cle: "total", format: "euros" as const, largeur: 14, total: true },
        ],
        lignes: GROUPES.map((g) => {
          const o: L = { activite: g };
          let t = 0;
          for (const imp of vue.imputations) {
            const v = Math.round(vue.croisement.get(`${g}|${imp}`) ?? 0);
            o[`i_${imp}`] = v || null;
            t += v;
          }
          o.total = t;
          return o;
        }).filter((o) => Number(o.total) !== 0),
        libelleTotal: "Total",
      },
      {
        nom: "Rentabilité",
        titre: `Rentabilité par activité — ${exercice}-${exercice + 1}`,
        sousTitre: `${sous} · affaires au forfait terminées dans l’exercice et mois clôturés des PE / PI`,
        colonnes: [
          { titre: "Activité", cle: "activite", largeur: 22 },
          { titre: "CA", cle: "ca", format: "euros", largeur: 14, total: true },
          { titre: "H. chiffrées", cle: "hc", format: "nombre", largeur: 12, total: true },
          { titre: "H. réalisées", cle: "hr", format: "nombre", largeur: 12, total: true },
          { titre: "Prix vendu (€/h)", cle: "pv", format: "euros", largeur: 14 },
          { titre: "Prix obtenu (€/h)", cle: "po", format: "euros", largeur: 14 },
          { titre: "Coût", cle: "cout", format: "euros", largeur: 14, total: true },
          { titre: "Marge", cle: "marge", format: "euros", largeur: 14, total: true },
          { titre: "Marge %", cle: "pct", largeur: 9 },
        ],
        lignes: vue.parGroupeRenta.map(([g, v]) => ({
          activite: g,
          ca: Math.round(v.ca),
          hc: Math.round(v.heuresChiffrees) || null,
          hr: Math.round(v.heuresRealisees) || null,
          pv: v.heuresChiffrees > 0 ? Math.round(v.ca / v.heuresChiffrees) : null,
          po: v.heuresRealisees > 0 ? Math.round(v.ca / v.heuresRealisees) : null,
          cout: v.cout === null ? null : Math.round(v.cout),
          marge: v.cout === null ? null : Math.round(v.ca - v.cout),
          pct: v.cout === null || v.ca === 0 ? "" : `${Math.round(((v.ca - v.cout) / v.ca) * 100)} %`,
        })),
        alerte: (l) => Number(l.marge ?? 0) < 0,
        libelleTotal: "Total",
      },
      {
        nom: "Facturé plus tard",
        titre: `Fait, facturé plus tard — ${exercice}-${exercice + 1}`,
        sousTitre: `${sous} · PE / PI dont le mois est reporté (montant estimé = heures × taux)`,
        colonnes: [
          { titre: "Commande", cle: "commande", largeur: 14 },
          { titre: "Imputation", cle: "imp", largeur: 11 },
          { titre: "Travail de", cle: "mois", largeur: 12 },
          { titre: "Heures", cle: "heures", format: "nombre", largeur: 10, total: true },
          { titre: "Montant estimé", cle: "montant", format: "euros", largeur: 15, total: true },
          { titre: "Pourquoi", cle: "pourquoi", largeur: 28 },
          { titre: "Facturé", cle: "facture", largeur: 18 },
        ],
        lignes: reportsPEPI
          .filter((r) => r.m >= mois[0] && r.m <= mois[11])
          .sort((x, y) => x.m.localeCompare(y.m) || x.numero.localeCompare(y.numero, "fr", { numeric: true }))
          .map((r) => ({
            commande: `CBE${r.numero}`,
            imp: r.imputation ?? "",
            mois: libMois(r.m),
            heures: Math.round(r.heures * 100) / 100,
            montant: Math.round(r.montant * 100) / 100,
            pourquoi: r.auto ? "commande pas encore reçue" : "reporté à la main",
            facture: r.facture && r.factureValide ? `en ${libMois(r.facture)}` : r.facture ? `prévu en ${libMois(r.facture)}` : "pas encore",
          })),
        alerte: (l) => l.facture === "pas encore",
        libelleTotal: "Total",
      },
      {
        nom: "Taux PE PI",
        titre: `Taux de vente moyen des PE / PI — ${exercice}-${exercice + 1}`,
        sousTitre: `${sous} · montant facturé ÷ heures facturées, mois clôturés`,
        colonnes: [
          { titre: "", cle: "poste", largeur: 16 },
          ...mois.map((m, i) => ({ titre: libMois(m), cle: `m${i}`, format: "euros" as const, largeur: 11 })),
          { titre: "Exercice", cle: "ex", format: "euros" as const, largeur: 12 },
          { titre: "N-1", cle: "n1", format: "euros" as const, largeur: 12 },
        ],
        lignes: vue.tauxPEPI.flatMap((t) =>
          (["h", "j"] as const).map((u) => {
            const taux = (s: { montant: number; heures: number; jours: number }) => {
              const q = u === "h" ? s.heures : s.jours;
              return q > 0 ? Math.round(s.montant / q) : null;
            };
            const o: L = { poste: `${t.imp} · € / ${u === "h" ? "heure" : "jour"}`, ex: taux(t.exercice), n1: taux(t.n1) };
            t.parMois.forEach((s, i) => (o[`m${i}`] = taux(s)));
            return o;
          })
        ),
      },
    ];
    await exporterExcelPolynov(`Finances_${exercice}-${exercice + 1}`, feuilles);
  }

  /* EN_COURS_V4 : une seule table, forfaits et PE / PI ensemble. Pour chaque famille (commande, avenants, échéances,
     lots, acomptes) : une ligne « famille » calculée par formules Excel, suivie de chacune de ses lignes avec ses
     montants, ses dates et son n° ARC Louxor. Seules entrent dans les en-cours les commandes dont la commande est
     REÇUE à la date (date de réception renseignée, au plus tard ce jour-là) et pas encore livrée. Le reste (commande
     reçue après la date, intention, PE / PI sans commande) est listé pour mémoire. */
  async function exporterEnCours(dateRef: string) {
    type L = Record<string, string | number | null | undefined>;
    const moisRef = dateRef.slice(0, 7);
    const date = new Date(`${dateRef}T00:00:00`).toLocaleDateString("fr-FR");
    const passe = dateRef < new Date().toISOString().slice(0, 10);
    const fr = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR") : "");
    const baseDe = (n: string | null | undefined) => (String(n ?? "").toUpperCase().replace(/^\s*CBE\s*/, "").match(/^\d+/)?.[0] ?? "").replace(/^0+/, "");

    // le Suivi d'affaire : dates et n° ARC Louxor de chaque ligne
    type Suivi = {
      cle: string;
      numero_affaire: string | null;
      base_devis: string | null;
      numero_arc_louxor: string | null;
      date_ouverture: string | null;
      date_reception_commande: string | null;
      delai: string | null;
      date_livraison_estimee: string | null;
      date_livraison: string | null;
    };
    const suivi = new Map(
      (
        await chargerTout<Suivi>((a, b) =>
          supabase
            .from("suivi_lignes")
            .select("cle,numero_affaire,base_devis,numero_arc_louxor,date_ouverture,date_reception_commande,delai,date_livraison_estimee,date_livraison")
            .order("cle")
            .range(a, b)
        )
      ).map((x) => [x.cle, x])
    );
    const livreeLe = (l: LigneFin) => (suivi.get(l.cle)?.date_livraison ?? l.date_livraison ?? null)?.slice(0, 10) ?? null;
    const recueLe = (l: LigneFin) => suivi.get(l.cle)?.date_reception_commande?.slice(0, 10) ?? null;
    const recueA = (l: LigneFin) => Boolean(recueLe(l) && (recueLe(l) ?? "") <= dateRef);
    const livreeA = (l: LigneFin) => Boolean(livreeLe(l) && (livreeLe(l) ?? "") <= dateRef);
    const numeroDe = (l: LigneFin) => suivi.get(l.cle)?.numero_affaire ?? l.cle;
    const louxorDe = (l: LigneFin) => suivi.get(l.cle)?.numero_arc_louxor?.trim() ?? "";
    const libelleGenre = (g: string) => (g === "BASE" ? "Commande" : g === "AVENANT" ? "Avenant" : g === "ECHEANCE" ? "Échéance" : g === "LOT" ? "Lot" : g);
    const valeurLigne = (d: LigneFin) => d.m.echeances || d.m.montant || d.m.meca + d.m.calcul + d.m.elec_pneu + d.m.scan + d.m.autre + d.m.negoce;

    // heures pointées jusqu'à la date (SQL 73) ; aujourd'hui : le réalisé complet
    const pointeA = new Map<string, ParGroupe>();
    if (passe) {
      const [corr, lignesP] = await Promise.all([
        supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
        (async () => {
          const tout: { type_affaire: string; numero: string; activite_id: string | null; heures: number | string }[] = [];
          for (let a = 0; a < 500000; a += 1000) {
            const { data, error } = await supabase.rpc("pointage_periode", { p_debut: "2000-01-01", p_fin: dateRef }).range(a, a + 999);
            if (error || !data) break;
            tout.push(...(data as typeof tout));
            if (data.length < 1000) break;
          }
          return tout;
        })(),
      ]);
      const versDiscipline: Record<string, Discipline> = { "Méca": "meca", Calcul: "calcul", Elec: "elec", Pneu: "pneu", Scan: "scan", Autre: "autre" };
      const groupeAct = new Map<string, Groupe>();
      for (const c of (corr.data ?? []) as { colonne_excel: string; activite_id: string | null }[]) {
        const d = versDiscipline[c.colonne_excel];
        if (c.activite_id && d) groupeAct.set(c.activite_id, GROUPE_DISCIPLINE[d]);
      }
      for (const x of lignesP) {
        if (x.type_affaire !== "CBE") continue;
        const k = String(x.numero).replace(/^0+/, "");
        const g = pointeA.get(k) ?? groupesVides();
        g[(x.activite_id && groupeAct.get(x.activite_id)) || "Autre"] += Number(x.heures) || 0;
        pointeA.set(k, g);
      }
    }
    const pointeDe = (base: string) => (passe ? pointeA.get(base) : realiseGroupes.get(base));

    // saisies : avancement estimé (SQL 79) et achats reçus (SQL 80), sur la commande de base
    const { data: saisiesData } = await supabase
      .from("pilotage_affaires")
      .select("numero,avancement_pct,avancement_le,achats_recus")
      .eq("type", "CBE")
      .or("avancement_pct.not.is.null,achats_recus.not.is.null");
    const saisies = new Map(
      ((saisiesData ?? []) as { numero: string; avancement_pct: number | string | null; avancement_le: string | null; achats_recus: number | string | null }[])
        .filter((x) => /^\d+$/.test(x.numero))
        .map((x) => [
          x.numero.replace(/^0+/, ""),
          { pct: x.avancement_pct === null ? null : Number(x.avancement_pct), le: x.avancement_le, recus: x.achats_recus === null ? null : Number(x.achats_recus) },
        ])
    );

    // familles du Suivi d'affaire
    const familles = new Map<string, LigneFin[]>();
    for (const l of lignesFin) {
      if (l.disparue || !l.base_affaire || ["Devis perdu", "Commande annulée"].includes(l.statut ?? "")) continue;
      const k = l.base_affaire.replace(/^0+/, "");
      familles.set(k, [...(familles.get(k) ?? []), l]);
    }

    const lignes: L[] = [];
    const memoire: L[] = [];
    let numFamille = 0;
    const totaux = { forfaits: 0, pepi: 0, avance: 0, negoceAVenir: 0, acomptes: 0 };

    /* ---------- FORFAITS ---------- */
    for (const [base, membres] of [...familles].sort((x, y) => Number(y[0]) - Number(x[0]))) {
      const tousCommandes = membres.filter((l) => l.genre === "BASE" || l.genre === "AVENANT");
      const laBase = tousCommandes.find((l) => l.genre === "BASE") ?? tousCommandes[0];
      if (!laBase || ["PE", "PI"].includes(laBase.imputation ?? "")) continue;
      // commandes reçues à la date (seules elles comptent) ; en cours si l'une d'elles n'est pas livrée à la date
      const commandes = tousCommandes.filter(recueA);
      const ouvertes = commandes.filter((l) => !livreeA(l));
      const enAttente = tousCommandes.filter((l) => !recueA(l) && !livreeA(l) && (l.statut === "Commande reçue" || l.statut === "Intention de commande"));
      for (const l of enAttente)
        memoire.push({
          commande: `CBE${base}`,
          numero: numeroDe(l),
          louxor: louxorDe(l),
          client: laBase.client ?? "",
          designation: l.designation ?? laBase.designation ?? "",
          statut: l.statut ?? "",
          raison: l.statut === "Intention de commande" ? "intention de commande (pas une commande)" : recueLe(l) ? `commande reçue le ${fr(recueLe(l))}, après la date` : "date de réception de commande non renseignée",
          montant: Math.round(l.m.montant) || null,
        });
      if (ouvertes.length === 0) continue;

      const enfants = (cle: string) => membres.filter((d) => (d.genre === "ECHEANCE" || d.genre === "LOT") && d.parent_cle === cle);
      const negoceCmd = (c: LigneFin) => (c.m.negoce > 0 ? c.m.negoce : enfants(c.cle).reduce((t, d) => t + d.m.negoce, 0));
      const achatsCmd = (c: LigneFin) => (c.m.achats > 0 ? c.m.achats : enfants(c.cle).reduce((t, d) => t + d.m.achats, 0));
      const montant = commandes.reduce((t, l) => t + l.m.montant, 0);
      const negoce = commandes.reduce((t, l) => t + negoceCmd(l), 0);
      const achats = commandes.reduce((t, l) => t + achatsCmd(l), 0);
      const chiffre = commandes.reduce((t, l) => t + l.heures_total, 0);
      const g = pointeDe(base);
      const pointe = g ? GROUPES.reduce((t, x) => t + g[x], 0) : 0;
      const decoupe = (cle: string) => enfants(cle).reduce((t, d) => t + valeurLigne(d), 0);
      const membresRecus = membres.filter((l) => {
        if (l.genre === "BASE" || l.genre === "AVENANT") return recueA(l);
        const parent = membres.find((p) => p.cle === l.parent_cle);
        return parent ? recueA(parent) : true;
      });
      const factureDe = (l: LigneFin) => (!livreeA(l) ? 0 : l.genre === "ECHEANCE" || l.genre === "LOT" ? valeurLigne(l) : Math.max(0, l.m.montant - decoupe(l.cle)));
      // ACOMPTE_ECH1 : une échéance 1 (ECH1) est un acompte : il n'est pas déduit du travail fait (colonne à part)
      const estAcompte = (l: LigneFin) => l.genre === "ECHEANCE" && /ECH0*1$/i.test(l.cle);
      const facture = membresRecus.filter((l) => !estAcompte(l)).reduce((t, l) => t + factureDe(l), 0);
      const acomptes = membresRecus.filter(estAcompte).reduce((t, l) => t + factureDe(l), 0);
      const s = saisies.get(base);
      const avEstime = s?.pct !== null && s?.pct !== undefined ? Math.min(1, s.pct / 100) : null;
      const avRetenu = avEstime ?? (chiffre > 0 ? Math.min(1, pointe / chiffre) : 0);
      const etudes = Math.max(0, montant - negoce);
      const recus = s?.recus ?? null;
      const negoceRecu = negoce > 0 && recus ? Math.min(negoce, achats > 0 ? recus * (negoce / achats) : recus) : 0;
      const valeurFaite = etudes * avRetenu + negoceRecu;
      const enCours = Math.max(0, valeurFaite - facture);
      const avance = Math.max(0, facture - valeurFaite);
      if (enCours < 0.5 && avance < 0.5) continue;
      numFamille++;
      totaux.forfaits += enCours;
      totaux.avance += avance;
      totaux.acomptes += acomptes;
      totaux.negoceAVenir += negoce - negoceRecu;
      const dBase = suivi.get(laBase.cle);
      lignes.push({
        _style: "groupe",
        niveau: "Famille",
        type: laBase.imputation ?? "Forfait",
        commande: `CBE${base}`,
        numero: numeroDe(laBase),
        nature: "Famille",
        louxor: [...new Set(membresRecus.map(louxorDe).filter(Boolean))].join(", "),
        devis: dBase?.base_devis ? `DBE${String(dBase.base_devis).replace(/^DBE/i, "")}` : "",
        client: laBase.client ?? "",
        designation: laBase.designation ?? "",
        statut: [...new Set(ouvertes.map((l) => l.statut))].join(", "),
        recue: fr(recueLe(laBase)),
        delai: fr(dBase?.delai),
        livree: "",
        montant: Math.round(montant),
        negoce: Math.round(negoce) || null,
        achats: Math.round(achats) || null,
        etudes: Math.round(etudes),
        chiffre: Math.round(chiffre * 10) / 10 || null,
        pointe: Math.round(pointe * 10) / 10 || null,
        avEstime,
        avRetenu,
        mesure: avEstime !== null ? `estimé${s?.le ? ` le ${fr(s.le)}` : ""}` : "aux heures",
        etudesFaites: Math.round(etudes * avRetenu),
        achatsRecus: recus,
        negoceRecu: Math.round(negoceRecu),
        valeurFaite: Math.round(valeurFaite),
        facture: Math.round(facture) || null,
        acomptes: Math.round(acomptes) || null,
        enCours: Math.round(enCours),
        avance: Math.round(avance) || null,
        negoceAVenir: Math.round(negoce - negoceRecu) || null,
        _alerte: avEstime === null && chiffre > 0 && pointe >= chiffre ? "oui" : "",
      });
      // les lignes de la famille, avec leurs montants
      for (const l of [...membresRecus].sort((x, y) => numeroDe(x).localeCompare(numeroDe(y), "fr", { numeric: true }))) {
        const d = suivi.get(l.cle);
        const estDecoupe = l.genre === "ECHEANCE" || l.genre === "LOT";
        lignes.push({
          _style: "detail",
          _sansFormule: "*",
          niveau: "Détail",
          type: "",
          commande: `CBE${base}`,
          numero: numeroDe(l),
          nature: libelleGenre(l.genre),
          louxor: louxorDe(l),
          client: "",
          devis: d?.base_devis ? `DBE${String(d.base_devis).replace(/^DBE/i, "")}` : "",
          designation: l.designation ?? "",
          statut: l.statut ?? "",
          recue: fr(d?.date_reception_commande),
          delai: fr(d?.delai ?? d?.date_livraison_estimee),
          livree: fr(livreeLe(l)),
          montant: Math.round(estDecoupe ? valeurLigne(l) : l.m.montant) || null,
          negoce: Math.round(l.m.negoce) || null,
          achats: Math.round(l.m.achats) || null,
          chiffre: estDecoupe ? null : Math.round(l.heures_total * 10) / 10 || null,
          facture: estAcompte(l) ? null : Math.round(factureDe(l)) || null,
          acomptes: estAcompte(l) ? Math.round(factureDe(l)) || null : null,
        });
      }
    }

    /* ---------- PE / PI : travail fait jusqu'à la date et pas encore facturé, commandes reçues ---------- */
    type MoisPE = { numero: string; imputation: string | null; m: string; heures: number; montant: number; pourquoi: string };
    const parBasePE = new Map<string, MoisPE[]>();
    const ajouterPE = (x: MoisPE) => {
      const b = baseDe(x.numero);
      parBasePE.set(b, [...(parBasePE.get(b) ?? []), x]);
    };
    // la ligne du Suivi d'une commande PE / PI (« 1604R2 »)
    const ligneDeCommande = new Map<string, LigneFin>();
    for (const l of lignesFin) {
      const n = suivi.get(l.cle)?.numero_affaire;
      if (n && (l.genre === "BASE" || l.genre === "AVENANT")) ligneDeCommande.set(n.toUpperCase().replace(/^\s*CBE\s*/, "").replace(/^0+/, ""), l);
    }
    const commandeRecue = (numero: string) => {
      const l = ligneDeCommande.get(numero.toUpperCase().replace(/^0+/, ""));
      return l ? recueA(l) : false;
    };
    for (const r of reportsPEPI) {
      if (r.m > moisRef || (r.facture && r.factureValide && r.facture <= moisRef)) continue;
      if (r.auto || !commandeRecue(r.numero)) {
        memoire.push({ commande: `CBE${r.numero}`, numero: libMois(r.m), louxor: "", client: "", designation: "", statut: "", raison: "PE / PI faite sans commande reçue", montant: Math.round(r.montant) });
        continue;
      }
      ajouterPE({ numero: r.numero, imputation: r.imputation, m: r.m, heures: r.heures, montant: r.montant, pourquoi: "mois reporté à la main" });
    }
    if (donneesReport) {
      const debutFenetre = new Date(Date.UTC(Number(moisRef.slice(0, 4)), Number(moisRef.slice(5, 7)) - 13, 1)).toISOString().slice(0, 10);
      const [pmD, saD] = await Promise.all([
        chargerTout<{ ligne_id: string; mois: string; valide: boolean | null; valide_le: string | null; reporte: boolean | null }>((a, b) =>
          supabase.from("prestation_mois").select("ligne_id,mois,valide,valide_le,reporte").gte("mois", debutFenetre).order("ligne_id").range(a, b)
        ),
        chargerTout<{ ligne_id: string; jour: string; heures: number | string | null }>((a, b) =>
          supabase.from("prestation_saisies").select("ligne_id,jour,heures").gte("jour", debutFenetre).lte("jour", dateRef).order("jour").range(a, b)
        ),
      ]);
      const etat = new Map(pmD.map((x) => [`${x.ligne_id}|${String(x.mois).slice(0, 7)}`, x]));
      const parLigneMois = new Map<string, number>();
      for (const x of saD) {
        const h = Number(x.heures) || 0;
        if (h <= 0) continue;
        const k = `${x.ligne_id}|${x.jour.slice(0, 7)}`;
        parLigneMois.set(k, (parLigneMois.get(k) ?? 0) + h);
      }
      const lignesP = new Map(donneesReport.lignes.map((l) => [l.id, l]));
      for (const [k, h] of parLigneMois) {
        const [lid, m] = k.split("|");
        const l = lignesP.get(lid);
        const a = l ? donneesReport.affaires.get(l.affaire_id) : undefined;
        if (!l || !a || l.taux === null) continue;
        const e = etat.get(k);
        if (e ? Boolean(e.reporte) : a.statut === "EN_ATTENTE") continue; // reports : ci-dessus
        if (e?.valide && (!e.valide_le || String(e.valide_le).slice(0, 10) <= dateRef)) continue; // facturé à la date
        const tauxH = l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux;
        const x = { numero: a.numero, imputation: a.imputation, m, heures: h, montant: Math.round(h * tauxH * 100) / 100, pourquoi: m === moisRef ? "mois en cours, facturé en fin de mois" : "mois terminé, pas encore clôturé à la date" };
        if (!commandeRecue(a.numero)) {
          memoire.push({ commande: `CBE${a.numero}`, numero: libMois(m), louxor: "", client: "", designation: "", statut: "", raison: "PE / PI faite sans commande reçue", montant: Math.round(x.montant) });
          continue;
        }
        ajouterPE(x);
      }
    }
    for (const [base, mois] of [...parBasePE].sort((x, y) => Number(y[0]) - Number(x[0]))) {
      const membres = familles.get(base) ?? [];
      const laBase = membres.find((l) => l.genre === "BASE") ?? membres[0];
      const valeur = mois.reduce((t, x) => t + x.montant, 0);
      numFamille++;
      totaux.pepi += valeur;
      lignes.push({
        _style: "groupe",
        _sansFormule: "etudes,avRetenu,etudesFaites,negoceRecu,valeurFaite,negoceAVenir",
        niveau: "Famille",
        type: mois[0]?.imputation ?? "PE / PI",
        commande: `CBE${base}`,
        numero: laBase ? numeroDe(laBase) : base,
        nature: "Famille",
        louxor: [...new Set(membres.map(louxorDe).filter(Boolean))].join(", "),
        // PEPI_DATES : n° de devis, statut et dates de la commande de base, comme pour les forfaits
        devis: laBase && suivi.get(laBase.cle)?.base_devis ? `DBE${String(suivi.get(laBase.cle)?.base_devis).replace(/^DBE/i, "")}` : "",
        client: laBase?.client ?? "",
        designation: laBase?.designation ?? "",
        statut: [...new Set(membres.filter((l) => (l.genre === "BASE" || l.genre === "AVENANT") && recueA(l) && !livreeA(l)).map((l) => l.statut))].join(", "),
        recue: laBase ? fr(recueLe(laBase)) : "",
        delai: laBase ? fr(suivi.get(laBase.cle)?.delai ?? suivi.get(laBase.cle)?.date_livraison_estimee) : "",
        montant: laBase ? Math.round(membres.filter((l) => l.genre === "BASE" || l.genre === "AVENANT").reduce((t, l) => t + l.m.montant, 0)) : null,
        pointe: Math.round(mois.reduce((t, x) => t + x.heures, 0) * 10) / 10,
        mesure: "au temps passé",
        valeurFaite: Math.round(valeur),
        enCours: Math.round(valeur),
      });
      for (const x of mois.sort((a, b) => a.m.localeCompare(b.m) || a.numero.localeCompare(b.numero, "fr", { numeric: true }))) {
        const l = ligneDeCommande.get(x.numero.toUpperCase().replace(/^0+/, ""));
        lignes.push({
          _style: "detail",
          _sansFormule: "*",
          niveau: "Détail",
          commande: `CBE${base}`,
          numero: x.numero,
          nature: `Travail de ${libMois(x.m)}`,
          louxor: l ? louxorDe(l) : "",
          designation: x.pourquoi,
          devis: l && suivi.get(l.cle)?.base_devis ? `DBE${String(suivi.get(l.cle)?.base_devis).replace(/^DBE/i, "")}` : "",
          statut: l?.statut ?? "",
          recue: l ? fr(recueLe(l)) : "",
          delai: l ? fr(suivi.get(l.cle)?.delai ?? suivi.get(l.cle)?.date_livraison_estimee) : "",
          livree: l ? fr(livreeLe(l)) : "",
          pointe: Math.round(x.heures * 100) / 100,
          valeurFaite: Math.round(x.montant),
        });
      }
    }

    const colonnes: ColonneExcel[] = [
      { titre: "Niveau", cle: "niveau", largeur: 9 },
      { titre: "Type", cle: "type", largeur: 8 },
      { titre: "Famille", cle: "commande", largeur: 10 },
      { titre: "N°", cle: "numero", largeur: 16 },
      { titre: "Nature", cle: "nature", largeur: 14 },
      { titre: "N° ARC Louxor", cle: "louxor", largeur: 14 },
      { titre: "N° DBE", cle: "devis", largeur: 10 },
      { titre: "Client", cle: "client", largeur: 14 },
      { titre: "Désignation", cle: "designation", largeur: 28 },
      { titre: "Statut", cle: "statut", largeur: 14 },
      { titre: "Commande reçue le", cle: "recue", largeur: 11 },
      { titre: "Délai", cle: "delai", largeur: 11 },
      { titre: "Livrée le", cle: "livree", largeur: 11 },
      { titre: "Montant", cle: "montant", format: "euros", largeur: 13, total: true },
      { titre: "dont négoce", cle: "negoce", format: "euros", largeur: 12, total: true },
      { titre: "Achats", cle: "achats", format: "euros", largeur: 12, total: true },
      { titre: "Études", cle: "etudes", format: "euros", largeur: 12, total: true, formule: "[montant]-[negoce]" },
      { titre: "H. chiffrées", cle: "chiffre", format: "nombre", largeur: 10, total: true },
      { titre: "H. pointées", cle: "pointe", format: "nombre", largeur: 10, total: true },
      { titre: "Avancement estimé (saisi)", cle: "avEstime", format: "pourcent", largeur: 10 },
      { titre: "Avancement retenu", cle: "avRetenu", format: "pourcent", largeur: 10, formule: 'IF([avEstime]<>"",[avEstime],IF([chiffre]>0,MIN(1,[pointe]/[chiffre]),0))' },
      { titre: "Mesuré", cle: "mesure", largeur: 14 },
      { titre: "Études faites", cle: "etudesFaites", format: "euros", largeur: 13, total: true, formule: "[etudes]*[avRetenu]" },
      { titre: "Achats reçus (saisis)", cle: "achatsRecus", format: "euros", largeur: 12, total: true },
      { titre: "Négoce reçu", cle: "negoceRecu", format: "euros", largeur: 12, total: true, formule: "IF([achats]>0,MIN([negoce],[achatsRecus]*[negoce]/[achats]),MIN([negoce],[achatsRecus]))" },
      { titre: "Valeur du travail fait", cle: "valeurFaite", format: "euros", largeur: 13, total: true, formule: "[etudesFaites]+[negoceRecu]" },
      { titre: "Déjà facturé (hors acompte)", cle: "facture", format: "euros", largeur: 13, total: true },
      { titre: "Acompte ECH1 (non déduit)", cle: "acomptes", format: "euros", largeur: 13, total: true },
      { titre: "En-cours", cle: "enCours", format: "euros", largeur: 13, total: true, formule: "MAX(0,[valeurFaite]-[facture])" },
      { titre: "Facturé au-delà du travail fait", cle: "avance", format: "euros", largeur: 12, total: true, formule: "MAX(0,[facture]-[valeurFaite])" },
      { titre: "Négoce à venir", cle: "negoceAVenir", format: "euros", largeur: 12, total: true, formule: "[negoce]-[negoceRecu]" },
    ];

    await exporterExcelPolynov(`En-cours_${dateRef}`, [
      {
        nom: "Synthèse",
        titre: `En-cours au ${date}`,
        sousTitre: "Travail fait et pas encore facturé, sur les seules commandes reçues à cette date",
        colonnes: [
          { titre: "Poste", cle: "poste", largeur: 70 },
          { titre: "Montant", cle: "montant", format: "euros", largeur: 16 },
        ],
        lignes: [
          { poste: "Forfaits : valeur du travail fait − déjà facturé", montant: Math.round(totaux.forfaits) },
          { poste: "PE / PI : travail fait, pas encore facturé", montant: Math.round(totaux.pepi) },
          { poste: "TOTAL DES EN-COURS", montant: Math.round(totaux.forfaits + totaux.pepi) },
          { poste: "Pour mémoire : acomptes (échéances 1), facturés et non déduits des en-cours", montant: Math.round(totaux.acomptes) },
          { poste: "Pour mémoire : facturé au-delà du travail fait (hors acompte)", montant: Math.round(totaux.avance) },
          { poste: "Pour mémoire : négoce à venir, matériel pas encore arrivé (non compté)", montant: Math.round(totaux.negoceAVenir) },
          { poste: "Pour mémoire : hors en-cours (commande pas reçue à la date, intention, PE / PI sans commande)", montant: Math.round(memoire.reduce((t, l) => t + Number(l.montant ?? 0), 0)) },
        ],
        notes: [
          "Seules comptent les commandes REÇUES à la date (date de réception de commande renseignée et antérieure ou égale), pas encore livrées à cette date.",
          "Forfaits, sur toute la famille (commande, avenants, échéances, acomptes) : valeur du travail fait = études × avancement + négoce reçu ; en-cours = valeur du travail fait − ce qui est déjà facturé, HORS ACOMPTE : une échéance 1 (ECH1) est considérée comme un acompte, elle n’est pas déduite (colonne à part, et ligne pour mémoire). Si le facturé dépasse le travail fait, l’en-cours est nul et l’excédent est donné à part.",
          "Avancement = avancement estimé (saisi dans l’Analyse du chiffré) s’il existe, sinon heures pointées ÷ heures chiffrées, plafonné à 100 %.",
          "PE / PI : le travail fait jusqu’à la date et pas encore facturé (mois en cours, mois non clôturés, mois reportés), au taux de la ligne.",
          "Onglet « En-cours » : chaque famille (en gras, calculée par formules ƒ), puis ses lignes (en gris) avec leurs montants et n° ARC Louxor. Les totaux ne comptent que les lignes « Famille ».",
        ],
      },
      {
        nom: "En-cours",
        titre: `En-cours au ${date}, forfaits et PE / PI`,
        sousTitre: "Une ligne par famille (gras, formules en bleu), suivie de ses commandes, avenants, échéances et lots (gris)",
        colonnes,
        lignes,
        totalSi: { cle: "niveau", valeur: "Famille" },
        alerte: (l) => l._alerte === "oui",
        libelleTotal: "Total des familles",
        notes: [
          `${numFamille} famille(s). En jaune : toutes les heures chiffrées sont consommées alors que la commande n’est pas livrée (comptée terminée) ; saisissez son avancement estimé si ce n’est pas le cas.`,
          "Colonnes ƒ (chiffres en bleu) : calculées par formule Excel ; modifiez un avancement estimé ou des achats reçus, la ligne et les totaux se recalculent.",
        ],
      },
      {
        nom: "Hors en-cours (mémoire)",
        titre: `Hors en-cours au ${date} — pour mémoire`,
        sousTitre: "Commandes pas encore reçues à la date, intentions de commande, PE / PI faites sans commande",
        colonnes: [
          { titre: "Famille", cle: "commande", largeur: 11 },
          { titre: "N° / mois", cle: "numero", largeur: 16 },
          { titre: "N° ARC Louxor", cle: "louxor", largeur: 14 },
          { titre: "Client", cle: "client", largeur: 14 },
          { titre: "Désignation", cle: "designation", largeur: 30 },
          { titre: "Statut", cle: "statut", largeur: 16 },
          { titre: "Pourquoi hors en-cours", cle: "raison", largeur: 36 },
          { titre: "Montant", cle: "montant", format: "euros", largeur: 13, total: true },
        ],
        lignes: memoire,
        libelleTotal: "Total",
      },
    ]);
  }

  /* ------------------------------ rendu ------------------------------ */

  const th: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap", padding: "8px 6px", fontSize: 12 };
  const thG: CSSProperties = { ...th, textAlign: "left" };
  const td: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap", padding: "6px", fontSize: 13 };
  const tdG: CSSProperties = { ...td, textAlign: "left", fontWeight: 700 };
  const atterrissage = vue.realise.map((v, i) => v + vue.attendu[i]);
  const totalAtterrissage = vue.total + vue.totalAttendu;
  const maxBarre = Math.max(1, ...atterrissage, ...vue.realiseN1, ...vue.prevu);
  const moisCourant = new Date().toISOString().slice(0, 7);
  const coutEx = coutHoraire(couts, `${mois[0]}-01`);
  // FAIT_PLUS_TARD : travail des PE / PI reporté, au mois où il a été fait (hors réalisé et atterrissage)
  const faitPlusTard = mois.map((m) => reportsPEPI.filter((r) => r.m === m).reduce((t, r) => t + r.montant, 0));
  // à rapprocher : fait dans l'exercice, facturé après sa fin (ou date de facture pas encore connue)
  const aRapprocher = reportsPEPI.filter((r) => r.m >= mois[0] && r.m <= mois[11] && !(r.facture && r.factureValide)).reduce((t, r) => t + r.montant, 0);

  let cumR = 0;
  let cumP = 0;

  const ligneValeurs = (libelle: string, valeurs: number[], style?: CSSProperties, surClic?: (i: number) => void) => (
    <tr key={libelle}>
      <td style={{ ...tdG, ...style }}>{libelle}</td>
      {valeurs.map((v, i) => (
        <td key={i} style={{ ...td, ...style }}>
          {Math.abs(v) > 0.5 && surClic ? (
            <button
              type="button"
              title="Voir le détail de ce montant"
              onClick={() => surClic(i)}
              style={{ all: "unset", cursor: "pointer", textDecoration: "underline dotted", color: libelle === "Non ventilé" ? "#7a3e00" : undefined, fontWeight: libelle === "Non ventilé" ? 800 : undefined }}
            >
              {keuros(v)}
            </button>
          ) : Math.abs(v) > 0.5 ? (
            keuros(v)
          ) : (
            "—"
          )}
        </td>
      ))}
      <td style={{ ...td, fontWeight: 800, ...style }}>{keuros(valeurs.reduce((t, v) => t + v, 0))}</td>
    </tr>
  );

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      {/* NAVIGATION_AXES */}<OngletsPilotage actif="finances" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Finances</h1>
            <p style={page.sousTitre}>
              Exercice du 1er novembre {exercice} au 31 octobre {exercice + 1} : où en est le chiffre d’affaires, et d’où il vient.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* LIEN_FACTURATION */}
            <Link href="/analyse/facturation" title="Le point de fin de mois avec la comptabilité" style={{ ...page.btnSecondaire, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Facturation du mois →
            </Link>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 120, textAlign: "center" }}>{exercice}-{exercice + 1}</strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">▶</button>
            <button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input
                type="date"
                value={dateEnCours}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDateEnCours(e.target.value || new Date().toISOString().slice(0, 10))}
                aria-label="Date des en-cours"
                title="Date à laquelle calculer les en-cours (fin de mois, clôture…)"
                style={{ ...page.entrees, width: "auto", minHeight: 40 }}
              />
              <button
                type="button"
                style={page.btnSecondaire}
                onClick={() => void exporterEnCours(dateEnCours)}
                disabled={chargement}
                title="Travail fait et pas encore facturé, à la date choisie : forfaits à l’avancement des heures pointées jusqu’à cette date, PE / PI faites et pas encore facturées"
              >
                Exporter les en-cours au {new Date(`${dateEnCours}T00:00:00`).toLocaleDateString("fr-FR")}
              </button>
            </span>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {/* FINANCES_ONGLETS : deux onglets */}
        {!chargement && (
          <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: `2px solid ${C.ligne}` }}>
            {(
              [
                ["CA", "💶 CA de l’exercice", "Où en est-on : réalisé, attendu, atterrissage, mois par mois"],
                ["ACTIVITES", "🧩 Par activité", "D’où vient le CA : activités, imputations, négoce, PE / PI"],
              ] as const
            ).map(([cle, libelle, aide]) => (
              <button
                key={cle}
                type="button"
                role="tab"
                aria-selected={onglet === cle}
                title={aide}
                onClick={() => setOnglet(cle)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "10px 16px",
                  fontWeight: 800,
                  fontSize: 15,
                  color: onglet === cle ? C.rougeFonce : "#3b4046",
                  borderBottom: `3px solid ${onglet === cle ? C.rouge : "transparent"}`,
                  marginBottom: -2,
                }}
              >
                {libelle}
              </button>
            ))}
          </div>
        )}

        {!chargement && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              {/* FINANCES_MOIS : vignettes du CA retirées (voir le mois en cours) */}
              {/* VIGNETTES_ALLEGEES : le détail du travail facturé plus tard reste dans le tableau (ligne cliquable) */}
              {onglet === "ACTIVITES" && (() => {
                // NEGOCE_A_PART : marge brute (revente − achats) et nette (après les heures passées × coût de structure)
                const ng = vue.parGroupeRenta.find(([g]) => g === "Négoce")?.[1];
                const brute = vue.negoce > 0 ? (vue.negoce - vue.achats) / vue.negoce : null;
                const nette = ng && ng.cout !== null && ng.ca > 0 ? (ng.ca - ng.cout) / ng.ca : null;
                return (
                  <Tuile
                    libelle="Marge du négoce"
                    valeur={brute === null ? "—" : `${Math.round(brute * 100)} %`}
                    sous={`revente ${keuros(vue.negoce)} · achats ${keuros(vue.achats)}${nette !== null ? ` · nette ${Math.round(nette * 100)} % après ${formatHeures(ng?.heuresRealisees ?? 0)} passées` : ""}`}
                    accent={nette !== null && nette < 0}
                  />
                );
              })()}
            </div>

            {onglet === "CA" && (
              <>
            {(attendus.aDater.length > 0 || attendus.enRetard.length > 0) && (
              <Message genre="info">
                {attendus.enRetard.length > 0 && (
                  <div>
                    <strong>{attendus.enRetard.length} forfait(s) en retard</strong> (délai estimé dépassé, pas encore livrés) comptés sur le mois en cours :{" "}
                    {attendus.enRetard.map((m) => `CBE${m.base_affaire}`).filter((v, i, t) => t.indexOf(v) === i).join(", ")}.
                  </div>
                )}
                {attendus.aDater.length > 0 && (
                  <div>
                    <strong>{attendus.aDater.length} forfait(s) sans délai estimé</strong>, non comptés ({keuros(attendus.aDater.reduce((t, x) => t + x.montant, 0))}) : à dater dans
                    Excel — {attendus.aDater.map((x) => x.numero).join(", ")}.
                  </div>
                )}
              </Message>
            )}


            {/* FINANCES_MOIS_V3 : vignettes du mois, puis la barre, juste au-dessus du tableau */}
            {(() => {
              const k = mois.indexOf(moisCourant);
              const i = k >= 0 ? k : mois[11] < moisCourant ? 11 : 0;
              const duMois = mouvements.filter((x) => x.date.startsWith(mois[i]));
              const attMois = attendus.mouvements.filter((x) => x.date.startsWith(mois[i]));
              const fait = duMois.reduce((s, x) => s + x.montant, 0);
              const achatsFait = duMois.reduce((s, x) => s + x.achats, 0);
              const attenduM = attMois.reduce((s, x) => s + x.montant, 0);
              const achatsAtt = attMois.reduce((s, x) => s + x.achats, 0);
              const objectif = vue.prevu[i];
              const parAct = GROUPES.map((g) => ({ g, v: duMois.reduce((s, x) => s + x.parGroupe[g], 0) })).filter((x) => x.v > 0.5);
              const echelle = Math.max(objectif, fait + Math.max(0, attenduM), 1);
              const ROUGES: Record<string, string> = {
                "Méca": "#8e0000",
                Calcul: "#b3261e",
                "Elec / Pneu": "#d9534f",
                Scan: "#e57f7a",
                "Négoce": "#efa29d",
                Autre: "#f4c3bf",
                "Non ventilé": "#f6d6d3",
              };
              const nomMois = new Date(`${mois[i]}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
              const etiquette: CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris };
              const vignette: CSSProperties = { ...page.carte, padding: "12px 16px", minWidth: 0 };
              const pastille = (fond: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: fond, marginRight: 5, verticalAlign: "middle" }} />;
              return (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
                    <div style={{ ...vignette, flex: "2 1 360px", borderTop: `4px solid ${C.rouge}` }}>
                      <div style={etiquette}>
                        CA facturé · <span style={{ textTransform: "capitalize" }}>{nomMois}</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 28px", marginTop: 6 }}>
                        <span>
                          <strong style={{ fontSize: 26, color: "#b3261e" }}>{euros(fait)}</strong> <span style={{ fontSize: 13, color: C.gris }}>avec achats</span>
                        </span>
                        <span title="CA facturé moins les achats revendus (négoce, sous-traitance)">
                          <strong style={{ fontSize: 26, color: "#5d6b78" }}>{euros(fait - achatsFait)}</strong> <span style={{ fontSize: 13, color: C.gris }}>hors achats</span>
                        </span>
                      </div>
                    </div>
                    <div style={{ ...vignette, flex: "1 1 200px" }}>
                      <div style={etiquette}>Encore attendu</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{euros(attenduM)}</div>
                      {achatsAtt > 0.5 && <div style={{ fontSize: 12, color: C.gris }}>{euros(attenduM - achatsAtt)} hors achats</div>}
                    </div>
                    <div style={{ ...vignette, flex: "1 1 200px" }}>
                      <div style={etiquette}>Objectif</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{objectif > 0 ? euros(objectif) : "—"}</div>
                      {objectif > 0 && (
                        <div style={{ fontSize: 12, color: C.gris }}>
                          facturé + attendu : {Math.round(((fait + attenduM) / objectif) * 100)} %
                        </div>
                      )}
                    </div>
                  </div>
                  <section style={{ ...page.carte, padding: "12px 16px", marginBottom: 12 }}>
                    <div style={{ position: "relative", height: 28, background: "#f3f4f6", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                      {parAct.map(({ g, v }) => (
                        <div key={g} title={`${g} : ${euros(v)}`} style={{ width: `${(v / echelle) * 100}%`, background: ROUGES[g] ?? "#d9534f", borderRight: "1px solid #ffffff" }} />
                      ))}
                      {attenduM > 0.5 && (
                        <div
                          title={`Encore attendu : ${euros(attenduM)}`}
                          style={{ width: `${(attenduM / echelle) * 100}%`, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 5px,#fbe6e6 5px,#fbe6e6 10px)" }}
                        />
                      )}
                      {objectif > 0 && (
                        <div title={`Objectif : ${euros(objectif)}`} style={{ position: "absolute", left: `calc(${(objectif / echelle) * 100}% - 1.5px)`, top: 0, bottom: 0, width: 3, background: "#1f2328" }} />
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5, marginTop: 8, color: "#3b4046" }}>
                      {parAct.map(({ g, v }) => (
                        <span key={g}>
                          {pastille(ROUGES[g] ?? "#d9534f")}
                          {g} <strong>{keuros(v)}</strong>
                        </span>
                      ))}
                      {attenduM > 0.5 && (
                        <span>
                          {pastille("repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 3px,#fbe6e6 3px,#fbe6e6 6px)")}
                          attendu <strong>{keuros(attenduM)}</strong>
                        </span>
                      )}
                      {objectif > 0 && (
                        <span>
                          <i style={{ display: "inline-block", width: 3, height: 12, background: "#1f2328", marginRight: 6, verticalAlign: "middle" }} />
                          objectif
                        </span>
                      )}
                    </div>
                  </section>
                </>
              );
            })()}

            {/* ---------- TRAME_CA_V2 : la trame CA remplace le tableau des 12 mois ---------- */}
            <div>
              <TrameCA
                exercice={exercice}
                mois={mois}
                moisN1={moisN1}
                mouvements={mouvements}
                prevu={vue.prevu}
                attendu={vue.attendu}
                attendus={attendus.mouvements}
                faitPlusTard={faitPlusTard}
                estAdmin={estAdmin}
                onPrevu={(m, v) => void enregistrerPrevus(new Map([[m, v]]))}
                onDetail={(i, ligne) => setDetail({ mois: mois[i], ligne })}
                onDetailReport={(i) => setDetailReport(mois[i])}
                onPrevuTous={(valeurs) => enregistrerPrevus(valeurs)}
                onAjustementsModifies={setAjustements}
              />

              {/* DETAIL_MONTANT_V3 : ce qui compose le montant cliqué */}
              {detail && <DetailMontant detail={detail} mouvements={mouvements} attendus={attendus.mouvements} onFermer={() => setDetail(null)} />}

              {detailReport &&
                (() => {
                  const exerciceEntier = detailReport === "EXERCICE";
                  const liste = reportsPEPI
                    .filter((r) => (exerciceEntier ? r.m >= mois[0] && r.m <= mois[11] && !(r.facture && r.factureValide) : r.m === detailReport))
                    .sort((x, y) => x.m.localeCompare(y.m) || x.numero.localeCompare(y.numero, "fr", { numeric: true }));
                  const totalListe = liste.reduce((t, r) => t + r.montant, 0);
                  const thD: CSSProperties = { ...th, textAlign: "left" };
                  return (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="Fait, facturé plus tard"
                      onClick={() => setDetailReport(null)}
                      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
                    >
                      <div onClick={(e) => e.stopPropagation()} style={{ ...page.carte, padding: 20, width: 780, maxWidth: "94vw", maxHeight: "85vh", overflowY: "auto" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <h2 style={{ margin: 0, fontSize: 19 }}>
                            Fait, facturé plus tard — {exerciceEntier ? `exercice ${exercice}-${exercice + 1}, pas encore facturé` : libMois(detailReport)}
                          </h2>
                          <span style={{ flex: 1 }} />
                          <button type="button" onClick={() => setDetailReport(null)} aria-label="Fermer" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                            ×
                          </button>
                        </div>
                        <p style={{ margin: "4px 0 12px", fontSize: 13, color: C.gris }}>
                          PE / PI dont le mois est reporté : travail fait, facturé plus tard. Montant estimé = heures × taux. Hors réalisé et hors atterrissage tant qu’il
                          n’est pas facturé.
                        </p>
                        {liste.length === 0 ? (
                          <p style={{ color: C.gris }}>Rien à afficher.</p>
                        ) : (
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={thD}>Commande</th>
                                <th style={thD}>Travail de</th>
                                <th style={th}>Heures</th>
                                <th style={th}>Montant estimé</th>
                                <th style={thD}>Pourquoi</th>
                                <th style={thD}>Facturé</th>
                              </tr>
                            </thead>
                            <tbody>
                              {liste.map((r, i) => (
                                <tr key={`${r.numero}-${r.m}-${i}`}>
                                  <td style={tdG}>
                                    CBE{r.numero} <span style={{ fontWeight: 400, color: C.gris }}>{r.imputation ?? ""}</span>
                                  </td>
                                  <td style={{ ...tdG, fontWeight: 400 }}>{libMois(r.m)}</td>
                                  <td style={td}>{formatHeures(r.heures)}</td>
                                  <td style={{ ...td, fontWeight: 800 }}>{euros(r.montant)}</td>
                                  <td style={{ ...tdG, fontWeight: 400, color: "#7a3e00" }}>{r.auto ? "commande pas encore reçue" : "reporté à la main"}</td>
                                  <td style={{ ...tdG, fontWeight: 400 }}>
                                    {r.facture && r.factureValide ? `en ${libMois(r.facture)} ✓` : r.facture ? `prévu en ${libMois(r.facture)}` : "pas encore"}
                                  </td>
                                </tr>
                              ))}
                              <tr>
                                <td style={{ ...tdG, borderTop: `2px solid ${C.ligne}` }} colSpan={2}>
                                  Total
                                </td>
                                <td style={{ ...td, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(liste.reduce((t, r) => t + r.heures, 0))}</td>
                                <td style={{ ...td, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{euros(totalListe)}</td>
                                <td style={{ ...td, borderTop: `2px solid ${C.ligne}` }} colSpan={2} />
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* TRAME_CA_V3 : « Remplir le prévisionnel » est dans la trame */}
            </div>

            {/* ---------- graphique 12 mois ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Chiffre d’affaires mois par mois</h2>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 200, borderBottom: `1px solid ${C.ligne}` }}>
                {mois.map((m, i) => (
                  <div key={m} style={{ flex: 1, height: "100%", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2 }}>
                    <div title={`${libMois(moisN1[i])} : ${euros(vue.realiseN1[i])}`} style={{ width: "30%", height: `${(vue.realiseN1[i] / maxBarre) * 100}%`, background: "#c9cdd2", borderRadius: "3px 3px 0 0" }} />
                    <div
                      title={`${libMois(m)} : réalisé ${euros(vue.realise[i])}${vue.attendu[i] > 0 ? ` + attendu ${euros(vue.attendu[i])}` : ""}`}
                      style={{ width: "40%", height: `${(atterrissage[i] / maxBarre) * 100}%`, display: "flex", flexDirection: "column-reverse" }}
                    >
                      <div style={{ height: `${atterrissage[i] > 0 ? (vue.realise[i] / atterrissage[i]) * 100 : 0}%`, background: vue.prevu[i] > 0 && atterrissage[i] < vue.prevu[i] && m < moisCourant ? "#e57373" : C.rouge }} />
                      <div
                        style={{
                          height: `${atterrissage[i] > 0 ? (vue.attendu[i] / atterrissage[i]) * 100 : 0}%`,
                          background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 4px,#fbe3e3 4px,#fbe3e3 8px)",
                          borderRadius: "3px 3px 0 0",
                          border: vue.attendu[i] > 0 ? `1px dashed ${C.rouge}` : undefined,
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    {vue.prevu[i] > 0 && (
                      <div title={`Prévu ${libMois(m)} : ${euros(vue.prevu[i])}`} style={{ position: "absolute", left: "8%", right: "8%", bottom: `${(vue.prevu[i] / maxBarre) * 100}%`, borderTop: "3px solid #1f2328" }} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {mois.map((m) => (
                  <div key={m} style={{ flex: 1, textAlign: "center", fontSize: 11, color: C.gris }}>{libMois(m)}</div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, marginTop: 6, flexWrap: "wrap" }}>
                <span><i style={{ display: "inline-block", width: 12, height: 12, background: C.rouge }} /> réalisé</span>
                <span><i style={{ display: "inline-block", width: 12, height: 12, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 3px,#fbe3e3 3px,#fbe3e3 6px)", border: `1px dashed ${C.rouge}` }} /> attendu (pas encore livré / facturé)</span>
                <span><i style={{ display: "inline-block", width: 12, height: 12, background: "#e57373" }} /> mois passé sous le prévu</span>
                <span><i style={{ display: "inline-block", width: 14, borderTop: "3px solid #1f2328", verticalAlign: "middle" }} /> prévisionnel</span>
                <span><i style={{ display: "inline-block", width: 12, height: 12, background: "#c9cdd2" }} /> exercice précédent</span>
              </div>
            </section>

              </>
            )}

            {onglet === "ACTIVITES" && (
              <>
            {/* ---------- taux de vente moyen des PE / PI ---------- */}
            {vue.tauxPEPI.some((t) => t.exercice.heures > 0 || t.n1.heures > 0) && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>Taux de vente moyen des PE / PI</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  Montant facturé ÷ heures (ou jours) facturées, sur les mois clôturés du relevé des prestations. Le jour se compte avec la base horaire de chaque ligne (7 h ou 7,5 h).
                </p>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={thG} />
                      {mois.map((m) => (
                        <th key={m} style={th}>{libMois(m)}</th>
                      ))}
                      <th style={th}>Exercice</th>
                      <th style={th}>N-1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vue.tauxPEPI.flatMap((t) =>
                      (["h", "j"] as const).map((u) => {
                        const taux = (s: { montant: number; heures: number; jours: number }) => {
                          const q = u === "h" ? s.heures : s.jours;
                          return q > 0 ? `${Math.round(s.montant / q).toLocaleString("fr-FR")} €` : "—";
                        };
                        return (
                          <tr key={`${t.imp}-${u}`} style={u === "h" ? { borderTop: `2px solid ${C.ligne}` } : undefined}>
                            <td style={tdG}>{u === "h" ? `${t.imp} · € / h` : <span style={{ fontWeight: 400, paddingLeft: 12 }}>€ / jour</span>}</td>
                            {t.parMois.map((s, i) => (
                              <td key={i} style={{ ...td, fontWeight: u === "h" ? 700 : 400, color: u === "j" ? C.gris : undefined }} title={s.heures > 0 ? `${euros(s.montant)} pour ${formatHeures(s.heures)}` : undefined}>
                                {taux(s)}
                              </td>
                            ))}
                            <td style={{ ...td, fontWeight: 800 }} title={t.exercice.heures > 0 ? `${euros(t.exercice.montant)} pour ${formatHeures(t.exercice.heures)}` : undefined}>
                              {taux(t.exercice)}
                            </td>
                            <td style={{ ...td, color: C.gris }}>{taux(t.n1)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </section>
            )}

            {/* ---------- activités × imputations ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Activités × imputations (CA de l’exercice)</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Activité</th>
                    {vue.imputations.map((imp) => (
                      <th key={imp} style={th}>{imp}</th>
                    ))}
                    <th style={th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {GROUPES.map((g) => {
                    const valeurs = vue.imputations.map((imp) => vue.croisement.get(`${g}|${imp}`) ?? 0);
                    const totalLigne = valeurs.reduce((t, v) => t + v, 0);
                    if (Math.abs(totalLigne) < 0.5) return null;
                    return (
                      <tr key={g}>
                        <td style={tdG}>{g}</td>
                        {valeurs.map((v, i) => (
                          <td key={i} style={{ ...td, background: v > 0 && vue.total > 0 ? `rgba(192,0,0,${Math.min(0.35, (v / vue.total) * 2)})` : undefined }}>
                            {Math.abs(v) > 0.5 ? keuros(v) : "—"}
                            {Math.abs(v) > 0.5 && totalLigne > 0 && <div style={{ fontSize: 11, color: C.gris }}>{Math.round((v / totalLigne) * 100)} %</div>}
                          </td>
                        ))}
                        <td style={{ ...td, fontWeight: 800 }}>
                          {keuros(totalLigne)}
                          {vue.total > 0 && <div style={{ fontSize: 11, color: C.gris, fontWeight: 400 }}>{Math.round((totalLigne / vue.total) * 100)} % du CA</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ fontSize: 12, color: C.gris, margin: "8px 0 0" }}>Le % sous chaque montant est la part de l’activité vendue sous cette imputation ; la couleur indique son poids dans le CA de l’exercice.</p>
            </section>

            {/* TABLEAU_PAR_AXES : la rentabilité a sa propre page */}
            <section style={{ ...page.carte, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <strong>Rentabilité</strong>
              <span style={{ color: C.gris, fontSize: 14 }}>taux vendu, taux obtenu, coût de structure et marge, par activité et par affaire :</span>
              <Link href="/analyse/rentabilite" style={{ fontWeight: 800, color: C.rougeFonce }}>
                ouvrir la page Rentabilité →
              </Link>
            </section>

              </>
            )}

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li><strong>Exercice</strong> : du 1er novembre au 31 octobre.</li>
                <li><strong>Attendu</strong> : forfaits « Commande reçue » ou « Intention de commande » non livrés, au mois de leur « Délai estimé » (déjà dépassé : mois en cours ; sans délai : non comptés, listés à dater) ; PE / PI : mois non validés du relevé (heures × taux), sinon onglets futurs du Suivi des prestations. <strong>Atterrissage</strong> = réalisé + attendu, comparé au prévisionnel.</li>
                <li><strong>Chiffre d’affaires</strong> : une commande ou un avenant compte au mois de sa livraison ; une échéance ou un lot au mois de sa propre livraison (la commande ne compte alors que pour le reste) ; une PE / PI suivie dans le relevé, pour le montant de ses mois validés.</li>
                <li><strong>PE / PI / IG</strong> : uniquement le relevé des prestations (mois validés) ; pour les mois qu’il ne couvre pas, l’historique importé de l’ancien classeur « Suivi des prestations ».</li>
                <li><strong>Activités</strong> : d’après le détail des montants du classeur (Méca, Calcul, Elec / Pneu, Scan, Négoce, celui-ci avec le « Montant heures négoce ») ; une PE / PI, d’après l’activité de la ligne du relevé.</li>
                <li><strong>Rentabilité</strong> : affaires au forfait dont toutes les commandes sont livrées dans l’exercice, et mois validés des PE / PI. Coût = heures réellement passées × coût de structure de l’exercice + achats.</li>
                <li><strong>Prévisionnel</strong> : un montant par mois, saisi ici (ADMIN).</li>
                <li>
                  <strong>Fait, facturé plus tard</strong> : PE / PI d’un mois reporté (commande pas encore reçue, ou report du relevé), au mois où le
                  travail a été fait. Il n’entre ni dans le réalisé, ni dans l’attendu, ni dans l’atterrissage : il n’y compte qu’une fois facturé (mois
                  clôturé). La tuile « Fait, facturé plus tard » en donne le total, pour le rapprochement avec la comptabilité.
                </li>
                <li>
                  <strong>Ajustements</strong> : montants ajoutés à la main au réalisé d’un mois pour coller à la comptabilité, sous l’imputation « Ajustement »
                  {ajustements.length > 0 ? ` (${ajustements.map((a) => `${libMois(a.mois.slice(0, 7))} ${a.montant > 0 ? "+" : ""}${keuros(a.montant)}`).join(", ")})` : ""}.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function FinancesPage() {
  return (
    <GardeAcces droit="indicateurs">
      <FinancesContenu />
    </GardeAcces>
  );
}
