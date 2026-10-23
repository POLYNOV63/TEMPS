"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
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
const libMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const keuros = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n));
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`);

type Releve = { base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null };
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

  const [lignesFin, setLignesFin] = useState<LigneFin[]>([]);
  const [releve, setReleve] = useState<Releve[]>([]);
  const [historique, setHistorique] = useState<Historique[]>([]);
  // PE / PI : montants prévus des mois non validés du relevé
  const [prevusReleve, setPrevusReleve] = useState<{ base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null }[]>([]);
  const [realiseGroupes, setRealiseGroupes] = useState<Map<string, ParGroupe>>(new Map());
  const [realiseMensuel, setRealiseMensuel] = useState<Map<string, { mois: string; heures: number }[]>>(new Map());
  const [couts, setCouts] = useState<Map<number, number>>(new Map());
  const [previsionnel, setPrevisionnel] = useState<Map<string, number>>(new Map()); // AAAA-MM -> €

  const [coutSaisi, setCoutSaisi] = useState("");
  const [totalAnnuel, setTotalAnnuel] = useState("");
  const [evolution, setEvolution] = useState("0");
  const [voirAffaires, setVoirAffaires] = useState(false);
  // montant cliqué dans le tableau mois par mois (activité ou imputation)
  const [detail, setDetail] = useState<{ mois: string; groupe?: Groupe; imputation?: string } | null>(null);
  // la Direction consulte : prévisionnel et coût de structure restent saisis par l'administration
  const [estAdmin, setEstAdmin] = useState(false);

  useEffect(() => {
    chargerMoi()
      .then((m) => setEstAdmin(Boolean(m?.estAdmin)))
      .catch(() => setEstAdmin(false));
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
          supabase.from("prestation_lignes").select("id,affaire_id,activite_id"),
          supabase.from("prestation_mois").select("ligne_id,mois,montant_fige").eq("valide", true),
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
        const lignesPrest = new Map(((pl.data ?? []) as { id: string; affaire_id: string; activite_id: string | null }[]).map((x) => [x.id, x]));
        const clientDeBase = new Map<string, string | null>();
        for (const l of brutes) if (l.genre === "BASE" && l.base_affaire) clientDeBase.set(l.base_affaire, l.client_id ? noms.get(l.client_id) ?? null : null);
        const rel: Releve[] = [];
        for (const x of (pm.data ?? []) as { ligne_id: string; mois: string; montant_fige: number | string | null }[]) {
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
    return [...mvExcel, ...mvReleve, ...mvHisto];
  }, [lignesFin, releve, historique]);

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
    return { mouvements: [...forfaits.mouvements, ...pepi], aDater: forfaits.aDater, enRetard: forfaits.mouvements.filter((m) => m.retard) };
  }, [lignesFin, releve, prevusReleve, historique]);

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
    for (const a of terminees) {
      const c = coutHoraire(couts, a.date_fin);
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

  function exporter() {
    const wb = XLSX.utils.book_new();
    const entete = ["", ...mois.map(libMois), "Total"];
    const ligne = (libelle: string, valeurs: number[]) => [libelle, ...valeurs.map((v) => Math.round(v)), Math.round(valeurs.reduce((t, v) => t + v, 0))];
    const ecarts = vue.realise.map((v, i) => v - vue.prevu[i]);
    let cR = 0;
    let cP = 0;
    const cumulR = vue.realise.map((v) => (cR += v));
    const cumulP = vue.prevu.map((v) => (cP += v));
    const feuille1 = [
      [`Finances — exercice ${exercice}-${exercice + 1}`],
      [],
      entete,
      ligne("Prévisionnel", vue.prevu),
      ligne("Réalisé", vue.realise),
      ligne("Attendu (non livré / non facturé)", vue.attendu),
      ligne("Atterrissage (réalisé + attendu)", vue.realise.map((v, i) => v + vue.attendu[i])),
      ligne("Écart", ecarts),
      ["Cumul prévu", ...cumulP.map(Math.round), ""],
      ["Cumul réalisé", ...cumulR.map(Math.round), ""],
      ligne(`Réalisé ${exercice - 1}-${exercice}`, vue.realiseN1),
      [],
      ["Par imputation"],
      entete,
      ...vue.parImputation.map((r) => ligne(r.cle, r.valeurs)),
      [],
      ["Par activité"],
      entete,
      ...vue.parActivite.map((r) => ligne(r.cle, r.valeurs)),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(feuille1);
    ws1["!cols"] = [{ wch: 22 }, ...mois.map(() => ({ wch: 11 })), { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Mois par mois");

    const croisement: (string | number)[][] = [["Activité", ...vue.imputations, "Total"]];
    for (const g of GROUPES) {
      const valeurs = vue.imputations.map((imp) => Math.round(vue.croisement.get(`${g}|${imp}`) ?? 0));
      if (valeurs.every((v) => v === 0)) continue;
      croisement.push([g, ...valeurs, valeurs.reduce((t, v) => t + v, 0)]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(croisement), "Activités x imputations");

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        vue.parGroupeRenta.map(([g, v]) => ({
          Activité: g,
          "CA (€)": Math.round(v.ca),
          "Heures chiffrées": Math.round(v.heuresChiffrees),
          "Heures réalisées": Math.round(v.heuresRealisees),
          "Prix vendu (€/h)": v.heuresChiffrees > 0 ? Math.round(v.ca / v.heuresChiffrees) : "",
          "Prix obtenu (€/h)": v.heuresRealisees > 0 ? Math.round(v.ca / v.heuresRealisees) : "",
          "Coût (€)": v.cout === null ? "" : Math.round(v.cout),
          "Marge (€)": v.cout === null ? "" : Math.round(v.ca - v.cout),
        }))
      ),
      "Rentabilité par activité"
    );
    XLSX.writeFile(wb, `Finances_${exercice}-${exercice + 1}.xlsx`);
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
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Finances</h1>
            <p style={page.sousTitre}>
              Exercice du 1er novembre {exercice} au 31 octobre {exercice + 1} : chiffre d’affaires réalisé face au prévisionnel, par
              imputation et par activité, et rentabilité.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 120, textAlign: "center" }}>{exercice}-{exercice + 1}</strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">▶</button>
            <button type="button" style={page.btnPrimaire} onClick={exporter} disabled={chargement}>Exporter en Excel</button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Réalisé" valeur={keuros(vue.total)} sous={`N-1 : ${keuros(vue.totalN1)} (${pct(vue.totalN1 > 0 ? vue.total / vue.totalN1 - 1 : null)})`} />
              <Tuile libelle="Attendu" valeur={keuros(vue.totalAttendu)} sous="pas encore livré ou facturé, sur l’exercice" />
              <Tuile
                libelle="Atterrissage"
                valeur={keuros(totalAtterrissage)}
                sous={vue.totalPrevu > 0 ? `${Math.round((totalAtterrissage / vue.totalPrevu) * 100)} % du prévisionnel (${keuros(vue.totalPrevu)})` : "réalisé + attendu"}
                accent={vue.totalPrevu > 0 && totalAtterrissage < vue.totalPrevu}
              />
              <Tuile
                libelle="Marge (affaires terminées + PE / PI)"
                valeur={vue.margeTotale === null ? "—" : keuros(vue.margeTotale)}
                sous={vue.margeTotale === null || vue.caRenta === 0 ? "coût de structure à saisir" : `${Math.round((vue.margeTotale / vue.caRenta) * 100)} % du CA concerné`}
                accent={vue.margeTotale !== null && vue.margeTotale < 0}
              />
              <Tuile libelle="Prix de vente obtenu" valeur={vue.prixObtenu === null ? "—" : `${Math.round(vue.prixObtenu)} €/h`} sous={coutEx !== null ? `coût ${coutEx.toLocaleString("fr-FR")} €/h` : "CA hors négoce ÷ heures passées"} />
              <Tuile libelle="Marge du négoce" valeur={vue.negoce > 0 ? `${Math.round(((vue.negoce - vue.achats) / vue.negoce) * 100)} %` : "—"} sous={`revente ${keuros(vue.negoce)} · achats ${keuros(vue.achats)}`} />
            </div>

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

            {/* ---------- tableau 12 mois ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Les 12 mois de l’exercice</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG} />
                    {mois.map((m) => (
                      <th key={m} style={{ ...th, background: m === moisCourant ? "#fff4f4" : undefined }}>{libMois(m)}</th>
                    ))}
                    <th style={th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tdG}>Prévisionnel</td>
                    {mois.map((m, i) => (
                      <td key={m} style={{ ...td, padding: 2 }}>
                        <input
                          key={`${m}-${vue.prevu[i]}`}
                          disabled={!estAdmin}
                          defaultValue={vue.prevu[i] ? String(Math.round(vue.prevu[i])) : ""}
                          inputMode="decimal"
                          aria-label={`Prévisionnel ${libMois(m)}`}
                          onBlur={(e) => {
                            const v = Number(e.target.value.replace(/\s/g, "").replace(",", ".")) || 0;
                            if (v !== vue.prevu[i]) void enregistrerPrevus(new Map([[m, v]]));
                          }}
                          style={{ width: 76, textAlign: "right", border: "1px solid #c9cdd2", borderRadius: 4, padding: "4px", fontFamily: "inherit", fontSize: 13 }}
                        />
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 800 }}>{keuros(vue.totalPrevu)}</td>
                  </tr>
                  {ligneValeurs("Réalisé", vue.realise, { fontWeight: 800 })}
                  {ligneValeurs("Attendu", vue.attendu, { color: "#a33a3a", fontStyle: "italic" })}
                  {ligneValeurs("Atterrissage", atterrissage, { fontWeight: 800, background: "#fff4f4" })}
                  <tr>
                    <td style={tdG} title="Atterrissage (réalisé + attendu) moins prévisionnel">Écart</td>
                    {mois.map((m, i) => {
                      const e = atterrissage[i] - vue.prevu[i];
                      const visible = vue.prevu[i] > 0;
                      return (
                        <td key={m} style={{ ...td, color: !visible ? C.gris : e < 0 ? C.rougeTexte : "#1b5e20", fontWeight: 700 }}>
                          {visible ? `${e > 0 ? "+" : ""}${keuros(e)}` : "—"}
                          {visible && <div style={{ fontSize: 11, fontWeight: 400 }}>{pct(vue.prevu[i] > 0 ? e / vue.prevu[i] : null)}</div>}
                        </td>
                      );
                    })}
                    <td style={{ ...td, fontWeight: 800, color: totalAtterrissage - vue.totalPrevu < 0 ? C.rougeTexte : "#1b5e20" }}>
                      {vue.totalPrevu > 0 ? `${totalAtterrissage - vue.totalPrevu > 0 ? "+" : ""}${keuros(totalAtterrissage - vue.totalPrevu)}` : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td style={tdG}>Cumul atterrissage / prévu</td>
                    {mois.map((m, i) => {
                      cumR += atterrissage[i];
                      cumP += vue.prevu[i];
                      return (
                        <td key={m} style={{ ...td, fontSize: 12 }}>
                          {keuros(cumR)}
                          <div style={{ color: C.gris }}>{cumP > 0 ? keuros(cumP) : "—"}</div>
                        </td>
                      );
                    })}
                    <td style={td} />
                  </tr>
                  {ligneValeurs(`Réalisé ${exercice - 1}-${exercice}`, vue.realiseN1, { color: C.gris, fontWeight: 400 })}

                  <tr><td colSpan={14} style={{ ...tdG, background: "#eef0f3", fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>Réalisé par imputation</td></tr>
                  {vue.parImputation.map((r) => ligneValeurs(r.cle, r.valeurs, undefined, (i) => setDetail({ mois: mois[i], imputation: r.cle })))}

                  <tr><td colSpan={14} style={{ ...tdG, background: "#eef0f3", fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>Réalisé par activité</td></tr>
                  {vue.parActivite.map((r) => ligneValeurs(r.cle, r.valeurs, undefined, (i) => setDetail({ mois: mois[i], groupe: r.cle })))}
                </tbody>
              </table>

              {/* DETAIL_CLIQUABLE : ce qui compose le montant cliqué */}
              {detail && (() => {
                const lignesDetail = mouvements
                  .filter((x) => x.date.startsWith(detail.mois))
                  .map((x) => ({ x, part: detail.groupe ? x.parGroupe[detail.groupe] : (x.imputation ?? "—") === detail.imputation ? x.montant : 0 }))
                  .filter((l) => Math.abs(l.part) > 0.5)
                  .sort((a, b) => Math.abs(b.part) - Math.abs(a.part));
                const total = lignesDetail.reduce((t, l) => t + l.part, 0);
                const sources: Record<string, string> = { LIVRAISON: "Forfait livré", ECHEANCE: "Échéance / lot livré", RELEVE: "Relevé PE / PI", HISTORIQUE: "Historique (ancien classeur)" };
                const raison: Record<string, string> = {
                  LIVRAISON: "Suivi d’affaire BE : aucune colonne « Montant Méca / Calcul / Elec-Pneu / Scan / Autre / Négoce » remplie pour cette ligne (ni pour ses échéances) : à compléter dans le classeur.",
                  ECHEANCE: "Suivi d’affaire BE : l’échéance (ou le lot) n’a pas de montant par discipline : à compléter dans le classeur.",
                  RELEVE: "Relevé PE / PI : la ligne n’a pas d’activité, ou son activité n’est rattachée à aucune colonne du Suivi d’affaire (correspondance des activités).",
                  HISTORIQUE: "Ancien classeur : le total ne correspond pas à Méca + Calcul + Elec.",
                };
                const moisLong = new Date(`${detail.mois}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
                return (
                  <div style={{ marginTop: 14, padding: 14, border: `2px solid ${C.rouge}`, borderRadius: 10, background: "#fffafa" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <strong style={{ fontSize: 16 }}>
                        {detail.groupe ?? detail.imputation} — {moisLong} : {total.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
                      </strong>
                      <span style={{ flex: 1 }} />
                      <button type="button" onClick={() => setDetail(null)} style={page.btnSecondaire}>Fermer ✕</button>
                    </div>
                    {lignesDetail.length === 0 ? (
                      <p style={{ margin: 0, color: C.gris }}>Aucune ligne.</p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                          <thead>
                            <tr>
                              <th style={thG}>Affaire</th>
                              <th style={thG}>Source</th>
                              <th style={thG}>Client</th>
                              <th style={thG}>Imputation</th>
                              <th style={th}>Montant du mouvement</th>
                              <th style={th}>{detail.groupe ? `Dont ${detail.groupe}` : "Montant"}</th>
                              {detail.groupe === "Non ventilé" && <th style={thG}>Pourquoi / où corriger</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {lignesDetail.map(({ x, part }, i) => (
                              <tr key={i}>
                                <td style={{ ...tdG, fontWeight: 800 }}>{x.base_affaire}</td>
                                <td style={tdG}>{sources[x.source] ?? x.source}</td>
                                <td style={tdG}>{x.client ?? "—"}</td>
                                <td style={tdG}>{x.imputation ?? "—"}</td>
                                <td style={td}>{x.montant.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                                <td style={{ ...td, fontWeight: 800 }}>{part.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                                {detail.groupe === "Non ventilé" && <td style={{ ...tdG, fontSize: 12, color: "#7a3e00", whiteSpace: "normal", minWidth: 260 }}>{raison[x.source] ?? ""}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {estAdmin && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.ligne}` }}>
                <strong>Remplir le prévisionnel :</strong>
                <input value={totalAnnuel} onChange={(e) => setTotalAnnuel(e.target.value)} placeholder="total annuel €" inputMode="decimal" style={{ ...page.entrees, width: 140 }} aria-label="Total annuel prévu" />
                <button type="button" style={page.btnSecondaire} onClick={() => repartir("EGAL")}>Répartir en 12 parts égales</button>
                <button type="button" style={page.btnSecondaire} onClick={() => repartir("N1")}>Répartir comme l’exercice précédent</button>
                <span style={{ width: 12 }} />
                <span>ou</span>
                <button type="button" style={page.btnSecondaire} onClick={reprendreN1}>Reprendre le réalisé N-1</button>
                <input value={evolution} onChange={(e) => setEvolution(e.target.value)} inputMode="decimal" style={{ ...page.entrees, width: 64 }} aria-label="Évolution en pourcentage" />
                <span>%</span>
              </div>
              )}
            </section>

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

            {/* ---------- rentabilité ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 17 }}>Rentabilité de l’exercice</h2>
                <span style={{ flex: 1 }} />
                <span>
                  Coût de structure {exercice}-{exercice + 1} :{" "}
                  <strong>{couts.has(exercice) ? `${couts.get(exercice)!.toLocaleString("fr-FR")} €/h` : coutEx !== null ? `${coutEx.toLocaleString("fr-FR")} €/h (autre exercice)` : "non saisi"}</strong>
                </span>
                {estAdmin && (
                  <>
                    <input value={coutSaisi} onChange={(e) => setCoutSaisi(e.target.value)} placeholder="€/h" inputMode="decimal" style={{ ...page.entrees, width: 80 }} aria-label="Coût de structure horaire" />
                    <button type="button" style={page.btnSecondaire} disabled={!coutSaisi} onClick={() => void enregistrerCout()}>Enregistrer</button>
                  </>
                )}
              </div>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {["Activité", "CA", "H. chiffrées", "H. réalisées", "Prix vendu", "Prix obtenu", "Coût", "Marge", "Marge %"].map((t, i) => (
                      <th key={t} style={i === 0 ? thG : th}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vue.parGroupeRenta.map(([g, v]) => {
                    const marge = v.cout === null ? null : v.ca - v.cout;
                    return (
                      <tr key={g}>
                        <td style={tdG}>{g}</td>
                        <td style={td}>{euros(v.ca)}</td>
                        <td style={td}>{v.heuresChiffrees > 0 ? formatHeures(v.heuresChiffrees) : "—"}</td>
                        <td style={td}>{v.heuresRealisees > 0 ? formatHeures(v.heuresRealisees) : "—"}</td>
                        <td style={td}>{v.heuresChiffrees > 0 ? `${Math.round(v.ca / v.heuresChiffrees)} €/h` : "—"}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{v.heuresRealisees > 0 ? `${Math.round(v.ca / v.heuresRealisees)} €/h` : "—"}</td>
                        <td style={td}>{v.cout === null ? "—" : euros(v.cout)}</td>
                        <td style={{ ...td, fontWeight: 800, color: marge !== null && marge < 0 ? C.rougeTexte : undefined }}>{marge === null ? "—" : euros(marge)}</td>
                        <td style={td}>{marge === null || v.ca === 0 ? "—" : `${Math.round((marge / v.ca) * 100)} %`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button
                type="button"
                aria-expanded={voirAffaires}
                onClick={() => setVoirAffaires((x) => !x)}
                style={{ all: "unset", cursor: "pointer", fontWeight: 800, marginTop: 12, display: "inline-flex", gap: 8, minHeight: 36, alignItems: "center" }}
              >
                <span aria-hidden="true">{voirAffaires ? "▾" : "▸"}</span> Affaire par affaire ({vue.terminees.length + vue.prestations.length}) — les moins rentables d’abord
              </button>
              {voirAffaires && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      {["Affaire", "Désignation", "Client", "Terminée", "Montant", "H. chiffrées", "H. réalisées", "Achats", "Coût", "Marge", "%"].map((t, i) => (
                        <th key={t} style={i < 4 ? thG : th}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vue.terminees.map((a) => (
                      <tr key={a.base_affaire}>
                        <td style={tdG}>CBE{a.base_affaire}</td>
                        <td style={{ ...tdG, fontWeight: 400, whiteSpace: "normal" }}>{a.designation ?? "—"}</td>
                        <td style={{ ...tdG, fontWeight: 400 }}>{a.client ?? "—"}</td>
                        <td style={{ ...tdG, fontWeight: 400 }}>{formatDate(a.date_fin)}</td>
                        <td style={td}>{euros(a.montant)}</td>
                        <td style={td}>{formatHeures(a.heuresChiffreesTotal)}</td>
                        <td style={{ ...td, color: a.heuresRealisees > a.heuresChiffreesTotal ? C.rougeTexte : undefined }}>{formatHeures(a.heuresRealisees)}</td>
                        <td style={td}>{a.achats ? euros(a.achats) : "—"}</td>
                        <td style={td}>{a.coutTotal === null ? "—" : euros(a.coutTotal)}</td>
                        <td style={{ ...td, fontWeight: 800, color: a.marge !== null && a.marge < 0 ? C.rougeTexte : undefined }}>{a.marge === null ? "—" : euros(a.marge)}</td>
                        <td style={td}>{a.marge === null || a.montant === 0 ? "—" : `${Math.round((a.marge / a.montant) * 100)} %`}</td>
                      </tr>
                    ))}
                    {vue.prestations.map((p) => (
                      <tr key={`p-${p.base}`}>
                        <td style={tdG}>CBE{p.base}</td>
                        <td style={{ ...tdG, fontWeight: 400 }}>{p.imputation} — relevé validé</td>
                        <td style={{ ...tdG, fontWeight: 400 }}>{p.client ?? "—"}</td>
                        <td style={{ ...tdG, fontWeight: 400 }}>—</td>
                        <td style={td}>{euros(p.montant)}</td>
                        <td style={td}>—</td>
                        <td style={td}>{formatHeures(p.heures)}</td>
                        <td style={td}>—</td>
                        <td style={td}>{p.cout === null ? "—" : euros(p.cout)}</td>
                        <td style={{ ...td, fontWeight: 800, color: p.cout !== null && p.montant - p.cout < 0 ? C.rougeTexte : undefined }}>{p.cout === null ? "—" : euros(p.montant - p.cout)}</td>
                        <td style={td}>{p.cout === null || p.montant === 0 ? "—" : `${Math.round(((p.montant - p.cout) / p.montant) * 100)} %`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li><strong>Exercice</strong> : du 1er novembre au 31 octobre.</li>
                <li><strong>Attendu</strong> : forfaits « Commande reçue » ou « Intention de commande » non livrés, au mois de leur « Délai estimé » (déjà dépassé : mois en cours ; sans délai : non comptés, listés à dater) ; PE / PI : mois non validés du relevé (heures × taux), sinon onglets futurs du Suivi des prestations. <strong>Atterrissage</strong> = réalisé + attendu, comparé au prévisionnel.</li>
                <li><strong>Chiffre d’affaires</strong> : une commande ou un avenant compte au mois de sa livraison ; une échéance ou un lot au mois de sa propre livraison (la commande ne compte alors que pour le reste) ; une PE / PI suivie dans le relevé, pour le montant de ses mois validés.</li>
                <li><strong>PE / PI / IG</strong> : uniquement le relevé des prestations (mois validés) ; pour les mois qu’il ne couvre pas, l’historique importé de l’ancien classeur « Suivi des prestations ».</li>
                <li><strong>Activités</strong> : d’après le détail des montants du classeur (Méca, Calcul, Elec / Pneu, Scan, Autre, Négoce) ; une PE / PI, d’après l’activité de la ligne du relevé.</li>
                <li><strong>Rentabilité</strong> : affaires au forfait dont toutes les commandes sont livrées dans l’exercice, et mois validés des PE / PI. Coût = heures réellement passées × coût de structure de l’exercice + achats.</li>
                <li><strong>Prévisionnel</strong> : un montant par mois, saisi ici (ADMIN).</li>
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
