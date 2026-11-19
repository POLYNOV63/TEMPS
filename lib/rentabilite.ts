import { supabase } from "@/lib/supabase";
import { chargerMoi, chargerRealise, chargerTout } from "@/lib/pilotageDonnees";
import { estTrajet } from "@/lib/trajets";
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
   RENTABILITÉ : CHARGEMENT ET CALCUL (RENTABILITE_LIB, 17/11/2026)
   Déplacés tels quels depuis app/analyse/rentabilite/page.tsx, pour que
   la page Rentabilité et le Simulateur de rentabilité utilisent EXACTEMENT
   le même calcul. Les règles sont décrites dans la page Rentabilité
   (RENTABILITE_V1 à V6, TRAJETS_PARTOUT, MARGES_POS_NEG…).
================================================================ */

export const sansAccents = (t: string | null | undefined) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const venteAuMontant = (imp: string | null | undefined) => /^(negoce|scan)/.test(sansAccents(imp));

export type LigneRenta = {
  cle: string;
  libelle: string;
  ca: number;
  achats: number;
  hc: number;
  hr: number;
  cout: number | null;
  auMontant: boolean;
  trajets?: number; // TRAJETS_PARTOUT : dont heures de trajet (code HT), comprises dans « heures passées »
  cumul?: Cumul; // MARGES_POS_NEG : parts d'affaires gagnantes / perdantes (lignes « par activité »)
};
/* MARGES_POS_NEG (PLG, 17/11/2026) : dans « Par activité », chaque affaire est répartie entre ses activités ; chaque part
   (la part Méca d'une affaire, sa part Calcul…) a sa propre marge, positive ou négative. On cumule séparément les gains
   et les pertes, pour voir qu'une activité positive au total perd sur certaines affaires. */
export type Cumul = { pos: number; neg: number; caPos: number; caNeg: number; nPos: number; nNeg: number };
export const cumulVide = (): Cumul => ({ pos: 0, neg: 0, caPos: 0, caNeg: 0, nPos: 0, nNeg: 0 });
/* AFFAIRES_EXCLUABLES (PLG, 17/11/2026) : affaires qu'on peut retirer de l'analyse d'un exercice par une coche
   (affaire hors norme qui fausse la lecture). Pour en ajouter une : une ligne ici. */
/* HEURES_HISTORIQUE (PLG, 19/11/2026) : prestations suivies seulement dans l'historique du Suivi des prestations, dont le
   pointé n'est pas en phase avec le facturé (c'est normal) : leur vendu ET leurs heures viennent de l'historique, avec la
   nature indiquée (CBE1487, TMUA : intergroupe, compté en PI, chiffré à 33,11 €/h). Pour en ajouter une : une ligne ici. */
export const PRESTATIONS_HISTORIQUE: Record<string, "PE" | "PI"> = { "1487": "PI" };

export const AFFAIRES_EXCLUABLES: { exercice: number; base: string }[] = [{ exercice: 2025, base: "1678" }];
export type AffaireRenta = LigneRenta & { base: string; designation: string | null; client: string | null; fin: string; imputation: string | null; nonVentile: "CHIFFRE" | "PASSE" | "AUCUN" | null; activite: string };
type Prestation = { base: string; imputation: string; designation: string | null; ca: number; hFact: number; mois: Set<string>; heuresHistorique?: boolean };
export type PrestationRenta = LigneRenta & { base: string; designation: string | null; imputation: string; nbMois: number };

export const tauxVendu = (l: LigneRenta) => (!l.auMontant && l.hc > 0 ? (l.ca - l.achats) / l.hc : null);
export const tauxObtenu = (l: LigneRenta) => (l.hr > 0 ? (l.ca - l.achats) / l.hr : null);
export const marge = (l: LigneRenta) => (l.cout === null ? null : l.ca - l.cout);

export type PilotageCBE = { numero: string; statut: string; date_livraison: string | null; imputation: string | null; designation: string | null };
export type PrestationMois = { base: string; imputation: string; designation: string | null; mois: string; ca: number; hFact: number; heuresHistorique?: boolean };

export type DonneesRentabilite = {
  lignesFin: LigneFin[];
  realiseParBase: Map<string, ParGroupe>;
  trajetsParBase: Map<string, number>;
  couts: Map<number, number>;
  estAdmin: boolean;
  pilotageCBE: PilotageCBE[];
  prestations: PrestationMois[];
  pointeExercice: Map<string, Map<string, number>>;
};

/* Tout ce que lit la page Rentabilité (lecture par paquets de 1 000 lignes) */
export async function chargerDonneesRentabilite(): Promise<DonneesRentabilite> {
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

  const noms = new Map(clients.map((c) => [c.id, c.nom_abrege]));
  const detail = new Map(montants.map((m) => [m.ligne_id, m]));
  const lignesFin: LigneFin[] = brutes.map((l) => {
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
  });

  // heures passées par affaire (famille) et par groupe d'activité
  const versDiscipline: Record<string, Discipline> = { "Méca": "meca", Calcul: "calcul", Elec: "elec", Pneu: "pneu", Scan: "scan", Autre: "autre" };
  const groupeActivite = new Map<string, Groupe>();
  for (const c of (corr.data ?? []) as { colonne_excel: string; activite_id: string | null }[]) {
    const d = versDiscipline[c.colonne_excel];
    if (c.activite_id && d) groupeActivite.set(c.activite_id, GROUPE_DISCIPLINE[d]);
  }
  for (const a of (acts.data ?? []) as { id: string; nom: string }[]) if (/^negoce/.test(sansAccents(a.nom))) groupeActivite.set(a.id, "Négoce");
  const realiseParBase = new Map<string, ParGroupe>();
  const trajetsParBase = new Map<string, number>();
  for (const x of realise) {
    if (x.type_affaire !== "CBE") continue;
    const k = String(x.numero).replace(/^0+/, "");
    // TRAJETS_PARTOUT : les trajets (code HT) comptent dans les heures de leur activité ; total gardé pour information
    if (estTrajet(x.code)) trajetsParBase.set(k, (trajetsParBase.get(k) ?? 0) + (Number(x.heures) || 0));
    const g = realiseParBase.get(k) ?? groupesVides();
    g[(x.activite_id && groupeActivite.get(x.activite_id)) || "Autre"] += Number(x.heures) || 0;
    realiseParBase.set(k, g);
  }
  const couts = new Map(((co.data ?? []) as { annee: number; cout_horaire: number | string }[]).map((c) => [c.annee, Number(c.cout_horaire)]));

  // RENTABILITE_V2 : mois facturés des PE / PI (relevé validé) et historique importé
  const [pl, pm, af, hi, pointeExercice] = await Promise.all([
    supabase.from("prestation_lignes").select("id,affaire_id"),
    chargerTout<{ ligne_id: string; mois: string; montant_fige: number | string | null; heures_fige: number | string | null }>((a, b) =>
      supabase.from("prestation_mois").select("ligne_id,mois,montant_fige,heures_fige").eq("valide", true).order("ligne_id").range(a, b)
    ),
    supabase.from("pilotage_affaires").select("id,numero,imputation,designation,statut,date_livraison").eq("type", "CBE"),
    chargerTout<{ mois: string; type: string; categorie: string | null; numero: string; heures: number | string; montant: number | string }>((a, b) =>
      supabase.from("prestation_historique").select("mois,type,categorie,numero,heures,montant").order("id").range(a, b)
    ).catch(() => []),
    chargerPointeParMois(),
  ]);
  const affaires = new Map(((af.data ?? []) as { id: string; numero: string; imputation: string | null; designation: string | null }[]).map((a) => [a.id, a]));
  const pilotageCBE = (af.data ?? []) as PilotageCBE[];
  const ligneAffaire = new Map(((pl.data ?? []) as { id: string; affaire_id: string }[]).map((l) => [l.id, l.affaire_id]));
  const prestations: PrestationMois[] = [];
  // HISTO_PAR_COMMANDE : les (commande, mois) déjà au relevé validé
  const cleCmd = (numero: string) => String(numero ?? "").toUpperCase().replace(/^CBE/, "").replace(/\s/g, "").replace(/^0+/, "");
  const moisReleve = new Set<string>();
  for (const m of pm) {
    const a = affaires.get(ligneAffaire.get(m.ligne_id) ?? "");
    if (!a || (a.imputation !== "PE" && a.imputation !== "PI")) continue;
    const mois = String(m.mois).slice(0, 7);
    moisReleve.add(`${cleCmd(a.numero)}|${mois}`);
    prestations.push({ base: (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, ""), imputation: a.imputation, designation: a.designation, mois, ca: n(m.montant_fige), hFact: n(m.heures_fige) });
  }
  /* HISTO_PAR_COMMANDE (18/11/2026) : l'historique, ce sont les lignes du Suivi des prestations que l'import n'a pas pu
     rattacher au relevé (commande absente du Suivi d'affaire, ex. CBE1624R5 de mars à juin 2026). Comme dans Finances, elles
     comptent ; on ne saute que le mois d'une commande déjà au relevé validé. Avant : un mois couvert par le relevé pour
     n'importe quelle affaire faisait disparaître tout l'historique de ce mois. */
  const designations = new Map([...affaires.values()].map((a) => [(a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, ""), a.designation]));
  for (const h of hi) {
    const mois = String(h.mois).slice(0, 7);
    // HISTO_CATEGORIE : « type » est CBE / CAS, la nature PE / PI / IG est dans « categorie »
    const base = (String(h.numero ?? "").match(/\d+/)?.[0] ?? "").replace(/^0+/, "");
    const force = PRESTATIONS_HISTORIQUE[base]; // HEURES_HISTORIQUE
    const type = force ?? String(h.categorie ?? "").toUpperCase();
    if (String(h.type ?? "").toUpperCase() !== "CBE" || (type !== "PE" && type !== "PI")) continue;
    if (!base || moisReleve.has(`${cleCmd(String(h.numero ?? ""))}|${mois}`)) continue;
    prestations.push({ base, imputation: type, designation: designations.get(base) ?? null, mois, ca: n(h.montant), hFact: n(h.heures), heuresHistorique: Boolean(force) });
  }

  return { lignesFin, realiseParBase, trajetsParBase, couts, estAdmin: Boolean(moi?.estAdmin), pilotageCBE, prestations, pointeExercice };
}

/* RENTABILITE_V5 : heures pointées par affaire et par mois (pour ne compter que les mois facturés des PE / PI) */
export async function chargerPointeParMois(): Promise<Map<string, Map<string, number>>> {
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
  return m;
}

export type ResultatRentabilite = ReturnType<typeof calculerRentabilite>;

/* Le calcul de la page Rentabilité pour un exercice (affaires « exclues » : n° de base sans zéros) */
export function calculerRentabilite(d: DonneesRentabilite, exercice: number, exclues: Set<string>) {
  const { lignesFin, realiseParBase, trajetsParBase, couts, prestations, pointeExercice, pilotageCBE } = d;
  const debut = `${exercice}-11-01`;
  const fin = `${exercice + 1}-10-31`;
  const affaires: AffaireRenta[] = [];
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
    let nonVentile: AffaireRenta["nonVentile"] = null;
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
      cout: c === null ? null : a.achats + hr * c,
      auMontant: montant,
      nonVentile,
      trajets: tr,
    });
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
    const x = parPrest.get(p.base) ?? { base: p.base, imputation: p.imputation, designation: p.designation, ca: 0, hFact: 0, mois: new Set<string>(), heuresHistorique: p.heuresHistorique };
    x.ca += p.ca;
    x.hFact += p.hFact;
    x.mois.add(p.mois);
    parPrest.set(p.base, x);
  }
  const cEx = coutHoraire(couts, debut);
  const prestationsEx: PrestationRenta[] = [...parPrest.values()].map((p) => {
    // seulement les heures pointées des mois facturés (pas celles d'un mois pas encore validé)
    const pm = pointeExercice.get(p.base);
    // HEURES_HISTORIQUE : les heures de l'historique, pas celles des feuilles
    const hr = p.heuresHistorique ? p.hFact : [...p.mois].reduce((t, m) => t + (pm?.get(m) ?? 0), 0);
    return { cle: p.base, libelle: `CBE ${p.base}`, base: p.base, designation: p.designation, imputation: p.imputation, nbMois: p.mois.size, ca: p.ca, achats: 0, hc: p.hFact, hr, cout: cEx === null ? null : hr * cEx, auMontant: false };
  });
  for (const p of prestationsEx) ajouter(p.imputation, p.ca, 0, p.hc, p.hr, p.cout, false);
  prestationsEx.sort((x, y) => {
    const mx = marge(x);
    const my = marge(y);
    if (mx === null || my === null) return 0;
    return mx / (x.ca || 1) - my / (y.ca || 1);
  });

  const ordre = [...GROUPES, "Négoce au montant", "Scan", "PE", "PI"];
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
  const famillesPilotage = new Map<string, PilotageCBE[]>();
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
}
