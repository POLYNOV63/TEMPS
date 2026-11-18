import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { coutHoraire } from "@/lib/finances";
import {
  consoliderMonBilan,
  normaliserTexte,
  type CodeRef,
  type FeuilleNouvelle,
  type ImputationNouvelle,
  type JourNouveau,
  type LigneHistorique,
} from "@/lib/categoriesBilan";
import { calculerRentabilite, type DonneesRentabilite } from "@/lib/rentabilite";

/* ===============================================================
   SIMULATEUR DE RENTABILITÉ (SIMULATEUR_RENTA, PLG, 17/11/2026)
   Maquette validée : docs/maquettes/console-rentabilite.html.
   - calcul() : la formule de la console, reprise à l'identique ;
   - valeurs de départ d'un exercice (novembre → octobre), d'après NOS
     chiffres, avec les calculs existants :
       effectifs ........ collaborateurs actifs (Direction exclue ; ADMIN =
                          structure ; productifs = inclus dans les statistiques)
       occupation ....... « CBE produit » ÷ capacité des productifs, avec la
                          consolidation de Mon bilan (mêmes définitions que
                          l'Analyse de capacité ; feuilles en brouillon exclues)
       efficience ....... heures chiffrées ÷ heures passées des forfaits livrés
                          (lib/rentabilite.ts, comme la page Rentabilité)
       taux de vente .... DEUX TAUX (PLG) face aux compétences principales :
                          Calcul et « autres ». Mesurés : prix ÷ heures chiffrées de
                          la part Calcul des forfaits ; le reste (forfaits hors Calcul
                          et PE / PI) pour « autres » ; sans négoce ni scan.
                          Chaque taux a un PLAFOND marché : au-delà, le CA est écrêté
                          (voyant CLIP) : le client ne suit pas.
       négoce ........... lignes Négoce de la Rentabilité (vendu, achats)
       salaire, fees, location, autres frais : table simulateur_parametres
                          (SQL 101), sinon les valeurs d'exemple de la maquette.
================================================================ */

export type Cle = "calc" | "prod" | "struct" | "sal" | "heures" | "occ" | "eff" | "tcalc" | "taux" | "neg" | "mneg" | "scan" | "hscan" | "fees" | "loyer" | "autres" | "ptc" | "pt";
/* DEUX_TAUX : « calc » = productifs dont la compétence principale est le Calcul, « prod » = les autres productifs ;
   « tcalc » / « taux » = leurs taux de vente ; « ptc » / « pt » = les plafonds marché (pas des faders : réglés dans
   l'afficheur « plafond » de la tranche du taux). */
export const PLAFONDS: Partial<Record<Cle, Cle>> = { tcalc: "ptc", taux: "pt" };
export type Leviers = Record<Cle, number>;

export type Levier = { k: Cle; nom: string; u: string; min: number; max: number; pas: number; dec: number; aide?: string };
export type Bus = { nom: string; c: string; leviers: Levier[] };

export const BUS: Bus[] = [
  {
    nom: "Équipe",
    c: "var(--bus-equipe)",
    leviers: [
      { k: "calc", nom: "Calcul", u: "productifs", min: 0, max: 15, pas: 1, dec: 0, aide: "Productifs dont la compétence principale est le Calcul (fiche collaborateur) : vendus au taux Calcul" },
      { k: "prod", nom: "Autres", u: "productifs", min: 0, max: 40, pas: 1, dec: 0, aide: "Les autres productifs (Méca, Elec…) : vendus au taux « autres »" },
      { k: "struct", nom: "Structure", u: "pers.", min: 0, max: 10, pas: 1, dec: 0, aide: "Encadrement, administratif : payés mais pas sur les affaires" },
      { k: "sal", nom: "Salaire chargé", u: "k€ / an", min: 35, max: 90, pas: 0.5, dec: 1 },
      { k: "heures", nom: "Heures payées", u: "h / an", min: 1450, max: 1800, pas: 7, dec: 0 },
    ],
  },
  {
    nom: "Production",
    c: "var(--bus-prod)",
    leviers: [
      { k: "occ", nom: "Occupation", u: "% sur affaires", min: 20, max: 100, pas: 1, dec: 0 },
      { k: "eff", nom: "Efficience", u: "% vendu / passé", min: 40, max: 160, pas: 1, dec: 0 },
      { k: "tcalc", nom: "Taux Calcul", u: "€ / h", min: 30, max: 150, pas: 0.5, dec: 1, aide: "Taux de vente des heures des productifs Calcul. Au-delà du plafond, le CA est écrêté (CLIP)" },
      { k: "taux", nom: "Taux autres", u: "€ / h", min: 30, max: 150, pas: 0.5, dec: 1, aide: "Taux de vente des heures des autres productifs. Au-delà du plafond, le CA est écrêté (CLIP)" },
    ],
  },
  {
    nom: "Négoce",
    c: "var(--bus-negoce)",
    leviers: [
      { k: "neg", nom: "CA négoce", u: "k€ / an", min: 0, max: 1000, pas: 5, dec: 0 },
      { k: "mneg", nom: "Marge négoce", u: "% du négoce", min: 0, max: 60, pas: 1, dec: 0 },
    ],
  },
  /* SCAN_TOUT (PLG, 18/11/2026, remplace SCAN_PUR du 17/11) : TOUT le scan des affaires livrées (ligne Scan de la
     Rentabilité : montants Scan et Presta Scan des forfaits, et scan vendu au montant), net de ses achats.
     Son CA s'ajoute tel quel ; ses heures pointées sont prises sur les heures passées sur affaires (elles ne
     produisent pas de CA à l'heure) et sortent du taux de vente « autres ». */
  {
    nom: "Scan",
    c: "var(--bus-scan)",
    leviers: [
      { k: "scan", nom: "CA scan", u: "k€ / an, net d’achats", min: 0, max: 500, pas: 1, dec: 0, aide: "Tout le scan des affaires livrées (Montant Scan et Presta Scan, scan vendu au montant), moins ses achats" },
      { k: "hscan", nom: "Heures scan", u: "h / an pointées", min: 0, max: 4000, pas: 10, dec: 0, aide: "Heures pointées sur le scan : elles sont retirées des heures de production vendues à l’heure" },
    ],
  },
  {
    nom: "Structure",
    c: "var(--bus-structure)",
    leviers: [
      { k: "fees", nom: "Mgmt fees", u: "% du CA", min: 0, max: 15, pas: 0.5, dec: 1 },
      { k: "loyer", nom: "Location", u: "k€ / an", min: 0, max: 250, pas: 1, dec: 0 },
      { k: "autres", nom: "Autres frais", u: "k€ / an", min: 0, max: 500, pas: 5, dec: 0, aide: "Tous les frais fixes de l’année hors salaires, location et management fees : logiciels et informatique, véhicules et carburant, assurances, honoraires (expert-comptable, avocat…), télécoms, fournitures, déplacements, formation externe, frais bancaires…" },
    ],
  },
];
export const LEVIERS: (Levier & { c: string })[] = BUS.flatMap((b) => b.leviers.map((l) => ({ ...l, c: b.c })));
export const PAR_CLE = Object.fromEntries(LEVIERS.map((l) => [l.k, l])) as Record<Cle, Levier & { c: string }>;

/* Valeurs d'exemple de la maquette : ce qui ne vient pas de nos chiffres tant que rien n'est saisi */
export const EXEMPLE: Leviers = { calc: 3, prod: 11, tcalc: 80, ptc: 95, pt: 85, struct: 3, sal: 52, heures: 1607, occ: 78, eff: 92, taux: 72, neg: 150, mneg: 20, scan: 0, hscan: 0, fees: 4, loyer: 72, autres: 140 };
export const HEURES_PAYEES = 1607;

/* ---------------- la formule de la console (identique à la maquette) ---------------- */
export function calcul(x: Leviers) {
  const hPayees = (x.calc + x.prod) * x.heures;
  const hAffCalc = (x.calc * x.heures * x.occ) / 100;
  const hAffAutres = (x.prod * x.heures * x.occ) / 100;
  const hAffaires = hAffCalc + hAffAutres;
  // SCAN_TOUT : les heures de scan ne se vendent pas à l'heure (prises sur les « autres »)
  const hProdAutres = Math.max(0, hAffAutres - x.hscan);
  const hProduction = hAffCalc + hProdAutres;
  const hvCalc = (hAffCalc * x.eff) / 100;
  const hvAutres = (hProdAutres * x.eff) / 100;
  const hVendues = hvCalc + hvAutres;
  // DEUX_TAUX + CLIP : au-delà du plafond marché, l'euro de plus ne se vend pas (écrêtage)
  const tEffCalc = Math.min(x.tcalc, x.ptc);
  const tEffAutres = Math.min(x.taux, x.pt);
  const clipCalc = x.tcalc > x.ptc + 1e-9;
  const clipAutres = x.taux > x.pt + 1e-9;
  const caProd = hvCalc * tEffCalc + hvAutres * tEffAutres;
  const caEcrete = hvCalc * (x.tcalc - tEffCalc) + hvAutres * (x.taux - tEffAutres);
  const tauxMoyen = hVendues > 0 ? caProd / hVendues : 0;
  const caNeg = x.neg * 1000;
  const caScan = x.scan * 1000;
  const ca = caProd + caNeg + caScan;
  const achats = caNeg * (1 - x.mneg / 100);
  const salaires = (x.calc + x.prod + x.struct) * x.sal * 1000;
  const fees = (ca * x.fees) / 100;
  const loyer = x.loyer * 1000;
  const autres = x.autres * 1000;
  const resultat = ca - achats - salaires - fees - loyer - autres;
  const fixes = salaires + loyer + autres;
  const f = x.fees / 100;
  const coutHeure = hVendues > 0 ? fixes / hVendues + tauxMoyen * f : 0;
  const tauxPM = hVendues > 0 && f < 1 ? (fixes + f * (caNeg + caScan) - (caNeg * x.mneg) / 100 - caScan) / (hVendues * (1 - f)) : NaN;
  const margeVar = ca > 0 ? (ca - achats - fees) / ca : 0;
  const caPM = margeVar > 0 ? fixes / margeVar : NaN;
  const parProductif = ((((x.heures * x.occ) / 100) * x.eff) / 100) * tEffAutres * (1 - f) - x.sal * 1000; // un productif « autres » de plus
  return {
    hPayees, hAffaires, hProduction, hVendues, hvCalc, hvAutres, tauxMoyen, clipCalc, clipAutres, caEcrete, caProd, caNeg, caScan, ca, achats, salaires, fees, loyer, autres, resultat, coutHeure, tauxPM, caPM, parProductif,
    marge: ca > 0 ? resultat / ca : 0,
    masseCA: ca > 0 ? salaires / ca : 0,
    caParPers: ca / Math.max(1, x.calc + x.prod + x.struct),
  };
}

/* ---------------- valeurs de départ ---------------- */

export type Source = { texte: string; reel: boolean }; // reel = vient de nos chiffres
export type Parametres = {
  salaire_charge_k: number;
  fees_pct: number;
  location_k: number;
  autres_frais_k: number;
  plafond_taux_calcul: number | null; // SQL 102
  plafond_taux_autres: number | null;
  modifie_le: string | null;
};
export type Depart = { valeurs: Leviers; sources: Record<Cle, Source>; coutStructure: number | null; parametres: Parametres | null };

type Personne = { id: string; nom: string };
type Effectifs = { productifs: Personne[]; calcul: Personne[]; autres: Personne[]; structure: Personne[] };

export async function chargerEffectifs(): Promise<Effectifs> {
  const lignes = await chargerTout<{ id: string; prenom: string | null; nom: string | null; trigramme: string | null; role: string | null; actif: boolean | null; inclus_statistiques: boolean | null }>((a, b) =>
    supabase.from("collaborateurs").select("id,prenom,nom,trigramme,role,actif,inclus_statistiques").order("id").range(a, b)
  );
  const res: Effectifs = { productifs: [], calcul: [], autres: [], structure: [] };
  // DEUX_TAUX : compétence(s) principale(s) de chacun (fiche collaborateur) ; Calcul si l'une d'elles est le Calcul
  const [pred, acts] = await Promise.all([
    chargerTout<{ collaborateur_id: string; activite_id: string }>((a, b) =>
      supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id").eq("niveau", "PRINCIPALE").order("collaborateur_id").range(a, b)
    ).catch(() => []),
    supabase.from("activites").select("id,nom"),
  ]);
  const idsCalcul = new Set(((acts.data ?? []) as { id: string; nom: string }[]).filter((x) => /^calcul/i.test(x.nom.trim())).map((x) => x.id));
  const estCalcul = new Set(pred.filter((p) => idsCalcul.has(p.activite_id)).map((p) => p.collaborateur_id));
  for (const c of lignes) {
    const role = String(c.role ?? "").toUpperCase();
    if (c.actif === false || role === "DIRECTION") continue; // la Direction ne compte pas (visiteurs de l'application)
    const nom = c.trigramme || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim();
    if (c.inclus_statistiques === true && role !== "ADMIN") {
      res.productifs.push({ id: c.id, nom });
      (estCalcul.has(c.id) ? res.calcul : res.autres).push({ id: c.id, nom });
    }
    else res.structure.push({ id: c.id, nom }); // ADMIN et non inclus dans les statistiques : non productifs
  }
  return res;
}

/* Occupation des productifs sur l'exercice : « CBE produit » ÷ capacité, personne par personne (Mon bilan) */
export async function chargerOccupation(exercice: number, ids: string[]): Promise<{ cbe: number; capacite: number } | null> {
  if (ids.length === 0) return null;
  const debut = `${exercice}-11-01`;
  const fin = `${exercice + 1}-11-01`;
  const paquets = <T,>(liste: T[], taille: number) => Array.from({ length: Math.ceil(liste.length / taille) }, (_, i) => liste.slice(i * taille, i * taille + taille));

  const { data: lignesCodes, error: ec } = await supabase.from("codes_imputation").select("code,libelle,categorie");
  if (ec) throw new Error(ec.message);
  const codes = new Map<string, CodeRef>();
  for (const c of (lignesCodes ?? []) as CodeRef[]) codes.set(normaliserTexte(c.code), c);

  type Hist = LigneHistorique & { collaborateur_id: string };
  type Feuille = FeuilleNouvelle & { collaborateur_id: string; statut: string | null };
  const historique: Hist[] = [];
  const feuilles: Feuille[] = [];
  for (const lot of paquets(ids, 150)) {
    historique.push(
      ...(await chargerTout<Hist>((a, b) =>
        supabase
          .from("historique_imputations")
          .select("id,collaborateur_id,annee,semaine,affaire_code,code_imputation,heures,groupe_code")
          .in("collaborateur_id", lot)
          .gte("annee", exercice - 1)
          .lte("annee", exercice + 2)
          .order("id", { ascending: true })
          .range(a, b)
      ))
    );
    feuilles.push(
      ...(await chargerTout<Feuille>((a, b) =>
        supabase
          .from("feuilles_heures")
          .select("id,collaborateur_id,semaine_debut,total_theorique,statut")
          .in("collaborateur_id", lot)
          .gte("semaine_debut", debut)
          .lt("semaine_debut", fin)
          .order("id", { ascending: true })
          .range(a, b)
      ))
    );
  }
  // comme l'Analyse de capacité : les feuilles en brouillon ne comptent pas
  const envoyees = feuilles.filter((f) => String(f.statut ?? "").toUpperCase() !== "BROUILLON");
  const jours: JourNouveau[] = [];
  for (const lot of paquets(envoyees.map((f) => f.id), 100))
    jours.push(...(await chargerTout<JourNouveau>((a, b) => supabase.from("feuilles_heures_jours").select("id,feuille_id").in("feuille_id", lot).order("id").range(a, b))));
  const imputations: (ImputationNouvelle & { id?: string })[] = [];
  for (const lot of paquets(jours.map((j) => j.id), 100))
    imputations.push(
      ...(await chargerTout<ImputationNouvelle & { id: string }>((a, b) =>
        supabase.from("feuilles_heures_imputations").select("id,jour_id,type_affaire,numero_affaire,code,heures").in("jour_id", lot).order("id").range(a, b)
      ))
    );

  // une consolidation par personne (la capacité se compte par personne et par semaine)
  const jourVersFeuille = new Map(jours.map((j) => [j.id, j.feuille_id]));
  const feuilleVersCollab = new Map(envoyees.map((f) => [f.id, f.collaborateur_id]));
  let cbe = 0;
  let capacite = 0;
  for (const id of ids) {
    const sesFeuilles = envoyees.filter((f) => f.collaborateur_id === id);
    const sesFeuillesIds = new Set(sesFeuilles.map((f) => f.id));
    const sesJours = jours.filter((j) => sesFeuillesIds.has(j.feuille_id));
    const sesImputations = imputations.filter((i) => feuilleVersCollab.get(jourVersFeuille.get(i.jour_id) ?? "") === id);
    const r = consoliderMonBilan({
      historique: historique.filter((h) => h.collaborateur_id === id),
      feuilles: sesFeuilles,
      jours: sesJours,
      imputations: sesImputations,
      codes,
      debut,
      fin,
    });
    cbe += r.total.CBE;
    capacite += r.capacite;
  }
  return capacite > 0 ? { cbe, capacite } : null;
}

export async function chargerParametres(exercice: number): Promise<Parametres | null> {
  const base = "salaire_charge_k,fees_pct,location_k,autres_frais_k,modifie_le";
  let r = await supabase.from("simulateur_parametres").select(`${base},plafond_taux_calcul,plafond_taux_autres`).eq("exercice", exercice).maybeSingle();
  if (r.error) r = await supabase.from("simulateur_parametres").select(base).eq("exercice", exercice).maybeSingle(); // SQL 102 pas encore lancé
  const data = r.data as Record<string, unknown> | null;
  if (r.error || !data) return null; // table pas encore créée (SQL 101) ou rien d'enregistré
  const n = (v: unknown) => Number(v) || 0;
  const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    salaire_charge_k: n(data.salaire_charge_k),
    fees_pct: n(data.fees_pct),
    location_k: n(data.location_k),
    autres_frais_k: n(data.autres_frais_k),
    plafond_taux_calcul: nn(data.plafond_taux_calcul),
    plafond_taux_autres: nn(data.plafond_taux_autres),
    modifie_le: (data.modifie_le as string | null) ?? null,
  };
}

export async function enregistrerParametres(exercice: number, v: Leviers, moiId: string | null): Promise<string | null> {
  const ligne = { exercice, salaire_charge_k: v.sal, fees_pct: v.fees, location_k: v.loyer, autres_frais_k: v.autres, modifie_le: new Date().toISOString(), modifie_par: moiId };
  const { error } = await supabase.from("simulateur_parametres").upsert({ ...ligne, plafond_taux_calcul: v.ptc, plafond_taux_autres: v.pt }, { onConflict: "exercice" });
  if (!error) return null;
  if (/plafond_taux/.test(error.message)) {
    // SQL 102 pas encore lancé : on enregistre au moins le reste
    const r = await supabase.from("simulateur_parametres").upsert(ligne, { onConflict: "exercice" });
    return r.error ? r.error.message : "Salaire, fees, location et autres frais enregistrés ; les plafonds de taux non (lancer le script SQL 102).";
  }
  return error.message;
}

/* Les chiffres que donne la Rentabilité pour l'exercice : efficience, taux de vente, négoce */
export function chiffresRentabilite(d: DonneesRentabilite, exercice: number, exclues: Set<string>) {
  const r = calculerRentabilite(d, exercice, exclues);
  const forfaits = r.affaires.filter((a) => !a.auMontant);
  // SCAN_TOUT : la ligne Scan de la Rentabilité (part Scan des forfaits + scan vendu au montant)
  const lScan = r.groupes.find((g) => g.cle === "Scan");
  const scanAuMontant = r.affaires.filter((a) => a.auMontant && a.activite === "Scan");
  const hrScanAuMontant = scanAuMontant.reduce((t, a) => t + a.hr, 0);
  // efficience sans le scan (il ne se vend plus à l'heure dans la console)
  const hc = forfaits.reduce((t, a) => t + a.hc, 0) - (lScan?.hc ?? 0);
  const hr = forfaits.reduce((t, a) => t + a.hr, 0) - Math.max(0, (lScan?.hr ?? 0) - hrScanAuMontant);
  // EFFICIENCE_PEPI (PLG, 17/11/2026) : les PE / PI comptent aussi (heures facturées ÷ heures pointées des mois facturés),
  // puisque la console applique l'efficience à toutes les heures passées sur affaires
  const hcPrest = r.prestationsEx.reduce((t, p) => t + p.hc, 0);
  const hrPrest = r.prestationsEx.reduce((t, p) => t + p.hr, 0);
  const NEGOCE = new Set(["Négoce", "Négoce au montant"]);
  const lignesNegoce = r.groupes.filter((g) => NEGOCE.has(g.cle));
  const caNegoce = lignesNegoce.reduce((t, g) => t + g.ca, 0);
  const achatsNegoce = lignesNegoce.reduce((t, g) => t + g.achats, 0);
  // SCAN_TOUT : CA net d'achats et heures pointées de tout le scan
  const caScan = lScan?.ca ?? 0;
  const achatsScan = lScan?.achats ?? 0;
  const heuresScan = lScan?.hr ?? 0;
  const nbScan = (lScan?.cumul?.nPos ?? 0) + (lScan?.cumul?.nNeg ?? 0); // affaires qui ont une part de scan
  // production : tout sauf le négoce et le scan ; trajets compris (TRAJETS_PARTOUT)
  const lignesProd = r.groupes.filter((g) => !NEGOCE.has(g.cle) && g.cle !== "Scan");
  const caProd = lignesProd.reduce((t, g) => t + g.ca, 0);
  const hcProd = lignesProd.reduce((t, g) => t + g.hc, 0);
  // DEUX_TAUX : la part Calcul des forfaits d'un côté, tout le reste (dont PE / PI) de l'autre
  const lCalcul = r.groupes.find((g) => g.cle === "Calcul");
  const caCalcul = lCalcul?.ca ?? 0;
  const hcCalcul = lCalcul?.hc ?? 0;
  return {
    nbForfaits: forfaits.length,
    nbPrestations: r.prestationsEx.length,
    efficience: hr + hrPrest > 0 ? ((hc + hcPrest) / (hr + hrPrest)) * 100 : null,
    hc,
    hr,
    hcPrest,
    hrPrest,
    taux: hcProd > 0 ? caProd / hcProd : null,
    caProd,
    hcProd,
    tauxCalcul: hcCalcul > 0 ? caCalcul / hcCalcul : null,
    caCalcul,
    hcCalcul,
    tauxAutres: hcProd - hcCalcul > 0 ? (caProd - caCalcul) / (hcProd - hcCalcul) : null,
    caNegoce,
    caScan,
    achatsScan,
    heuresScan,
    nbScan,
    margeNegoce: caNegoce > 0 ? ((caNegoce - achatsNegoce) / caNegoce) * 100 : null,
  };
}

const fr = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function construireDepart(
  exercice: number,
  effectifs: Effectifs,
  occupation: { cbe: number; capacite: number } | null,
  renta: ReturnType<typeof chiffresRentabilite>,
  parametres: Parametres | null,
  couts: Map<number, number>
): Depart {
  const v: Leviers = { ...EXEMPLE };
  const s = {} as Record<Cle, Source>;
  const ex = `${exercice}-${exercice + 1}`;

  v.calc = effectifs.calcul.length;
  s.calc = { reel: true, texte: `Productifs (actifs inclus dans les statistiques, hors ADMIN et Direction) de compétence principale Calcul : ${effectifs.calcul.map((p) => p.nom).join(", ") || "aucun"}` };
  v.prod = effectifs.autres.length;
  s.prod = { reel: true, texte: `Les autres productifs : ${effectifs.autres.map((p) => p.nom).join(", ") || "aucun"}` };
  v.struct = effectifs.structure.length;
  s.struct = { reel: true, texte: `Autres actifs hors Direction (dont les ADMIN) : ${effectifs.structure.map((p) => p.nom).join(", ") || "aucun"}` };
  v.heures = HEURES_PAYEES;
  s.heures = { reel: true, texte: "1 607 h par an (35 h)" };

  if (occupation) {
    v.occ = Math.round((occupation.cbe / occupation.capacite) * 100);
    s.occ = { reel: true, texte: `CBE produit ${fr(occupation.cbe)} h ÷ capacité ${fr(occupation.capacite)} h des productifs, exercice ${ex}` };
  } else s.occ = { reel: false, texte: "Feuilles d’heures de l’exercice non lisibles : valeur d’exemple" };

  if (renta.efficience !== null) {
    v.eff = Math.round(renta.efficience);
    const part = (num: number, den: number) => (den > 0 ? `${fr((num / den) * 100)} %` : "—");
    s.eff = {
      reel: true,
      texte:
        `(heures vendues ÷ heures passées) : forfaits ${part(renta.hc, renta.hr)} sur ${fr(renta.hr)} h (${renta.nbForfaits} livrés, ${fr(renta.hc)} h chiffrées)` +
        ` · PE / PI ${part(renta.hcPrest, renta.hrPrest)} sur ${fr(renta.hrPrest)} h (${renta.nbPrestations}, ${fr(renta.hcPrest)} h facturées) → ${fr(renta.efficience)} %`,
    };
  } else s.eff = { reel: false, texte: `Aucun forfait livré ni mois de PE / PI facturé en ${ex} : valeur d’exemple` };

  if (renta.tauxCalcul !== null) {
    v.tcalc = Math.round(renta.tauxCalcul * 2) / 2;
    s.tcalc = { reel: true, texte: `Part Calcul des forfaits livrés en ${ex} : ${fr(renta.caCalcul)} € ÷ ${fr(renta.hcCalcul)} h chiffrées` };
  } else s.tcalc = { reel: false, texte: "Pas de Calcul vendu sur l’exercice : valeur d’exemple" };
  if (renta.tauxAutres !== null) {
    v.taux = Math.round(renta.tauxAutres * 2) / 2;
    s.taux = {
      reel: true,
      texte: `Le reste : ${fr(renta.caProd - renta.caCalcul)} € ÷ ${fr(renta.hcProd - renta.hcCalcul)} h vendues (forfaits hors Calcul et ${renta.nbPrestations} PE / PI), sans négoce ni scan`,
    };
  } else s.taux = { reel: false, texte: "Pas d’heures vendues sur l’exercice : valeur d’exemple" };

  v.neg = Math.round(renta.caNegoce / 1000 / 5) * 5;
  s.neg = { reel: true, texte: `Négoce des forfaits livrés en ${ex} : ${fr(renta.caNegoce)} €` };
  const nbScan = `Scan de ${renta.nbScan} affaire${renta.nbScan > 1 ? "s" : ""} livrée${renta.nbScan > 1 ? "s" : ""} en ${ex}`;
  v.scan = Math.round((renta.caScan - renta.achatsScan) / 1000);
  s.scan = { reel: true, texte: `${nbScan} : vendu ${fr(renta.caScan)} € − achats ${fr(renta.achatsScan)} €` };
  v.hscan = Math.round(renta.heuresScan / 10) * 10;
  s.hscan = { reel: true, texte: `${nbScan} : ${fr(renta.heuresScan)} h pointées (trajets compris)` };
  if (renta.margeNegoce !== null) {
    v.mneg = Math.round(renta.margeNegoce);
    s.mneg = { reel: true, texte: "(vendu − achats) ÷ vendu, lignes Négoce de la Rentabilité" };
  } else s.mneg = { reel: false, texte: "Pas de négoce sur l’exercice : valeur d’exemple" };

  const saisi = parametres ? `enregistré le ${parametres.modifie_le ? new Date(parametres.modifie_le).toLocaleDateString("fr-FR") : "?"}` : null;
  if (parametres) {
    v.sal = parametres.salaire_charge_k;
    v.fees = parametres.fees_pct;
    v.loyer = parametres.location_k;
    v.autres = parametres.autres_frais_k;
  }
  // plafonds marché des deux taux : enregistrés (SQL 102), sinon taux de départ + 10 €/h, à régler
  const plafondDefaut = (t: number) => Math.ceil((t + 10) / 5) * 5;
  v.ptc = parametres?.plafond_taux_calcul ?? plafondDefaut(v.tcalc);
  v.pt = parametres?.plafond_taux_autres ?? plafondDefaut(v.taux);
  s.ptc = parametres?.plafond_taux_calcul != null ? { reel: true, texte: `Plafond marché ${saisi}` } : { reel: false, texte: "À régler (par défaut : taux Calcul + 10 €/h) dans l’afficheur « plafond » de la tranche" };
  s.pt = parametres?.plafond_taux_autres != null ? { reel: true, texte: `Plafond marché ${saisi}` } : { reel: false, texte: "À régler (par défaut : taux autres + 10 €/h) dans l’afficheur « plafond » de la tranche" };
  for (const k of ["sal", "fees", "loyer", "autres"] as Cle[])
    s[k] = parametres ? { reel: true, texte: `Valeur de départ ${saisi}` } : { reel: false, texte: "À saisir (valeur d’exemple) : tapez la valeur dans l’afficheur, puis « Enregistrer comme valeurs de départ »" };

  // bornes : une valeur réelle hors des bornes de la maquette reste atteignable
  for (const l of LEVIERS) {
    const borne = Math.max(l.min, Math.min(l.max, v[l.k]));
    if (borne !== v[l.k]) s[l.k] = { ...s[l.k], texte: `${s[l.k].texte} — ${fr(v[l.k], l.dec)} hors de l’échelle de la console, ramené à ${fr(borne, l.dec)}` };
    v[l.k] = borne;
  }
  return { valeurs: v, sources: s, coutStructure: coutHoraire(couts, `${exercice}-11-01`), parametres };
}
