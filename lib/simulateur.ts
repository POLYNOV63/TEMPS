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
       taux de vente .... prix ÷ heures chiffrées (forfaits) et facturées (PE / PI),
                          sans le négoce ni le scan pur au montant
       négoce ........... lignes Négoce de la Rentabilité (vendu, achats)
       salaire, fees, location, autres frais : table simulateur_parametres
                          (SQL 101), sinon les valeurs d'exemple de la maquette.
================================================================ */

export type Cle = "prod" | "struct" | "sal" | "heures" | "occ" | "eff" | "taux" | "neg" | "mneg" | "scan" | "hscan" | "fees" | "loyer" | "autres";
export type Leviers = Record<Cle, number>;

export type Levier = { k: Cle; nom: string; u: string; min: number; max: number; pas: number; dec: number; aide?: string };
export type Bus = { nom: string; c: string; leviers: Levier[] };

export const BUS: Bus[] = [
  {
    nom: "Équipe",
    c: "var(--bus-equipe)",
    leviers: [
      { k: "prod", nom: "Productifs", u: "pers.", min: 0, max: 40, pas: 1, dec: 0 },
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
      { k: "taux", nom: "Taux de vente", u: "€ / h", min: 30, max: 130, pas: 0.5, dec: 1 },
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
  /* SCAN_PUR (PLG, 17/11/2026) : le scan vendu au montant (affaires imputées Scan, sans heures chiffrées).
     Son CA s'ajoute tel quel ; ses heures sont prises sur les heures passées sur affaires (elles ne produisent
     pas de CA à l'heure). */
  {
    nom: "Scan",
    c: "var(--bus-scan)",
    leviers: [
      { k: "scan", nom: "CA scan", u: "k€ / an, net d’achats", min: 0, max: 500, pas: 5, dec: 0, aide: "Scan vendu au montant (affaires imputées Scan, sans heures chiffrées), moins ses achats" },
      { k: "hscan", nom: "Heures scan", u: "h / an pointées", min: 0, max: 4000, pas: 10, dec: 0, aide: "Heures passées sur le scan vendu au montant : elles sont retirées des heures de production" },
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
export const EXEMPLE: Leviers = { prod: 14, struct: 3, sal: 52, heures: 1607, occ: 78, eff: 92, taux: 72, neg: 150, mneg: 20, scan: 0, hscan: 0, fees: 4, loyer: 72, autres: 140 };
export const HEURES_PAYEES = 1607;

/* ---------------- la formule de la console (identique à la maquette) ---------------- */
export function calcul(x: Leviers) {
  const hPayees = x.prod * x.heures;
  const hAffaires = (hPayees * x.occ) / 100;
  // SCAN_PUR : les heures de scan au montant ne se vendent pas à l'heure
  const hProduction = Math.max(0, hAffaires - x.hscan);
  const hVendues = (hProduction * x.eff) / 100;
  const caProd = hVendues * x.taux;
  const caNeg = x.neg * 1000;
  const caScan = x.scan * 1000;
  const ca = caProd + caNeg + caScan;
  const achats = caNeg * (1 - x.mneg / 100);
  const salaires = (x.prod + x.struct) * x.sal * 1000;
  const fees = (ca * x.fees) / 100;
  const loyer = x.loyer * 1000;
  const autres = x.autres * 1000;
  const resultat = ca - achats - salaires - fees - loyer - autres;
  const fixes = salaires + loyer + autres;
  const f = x.fees / 100;
  const coutHeure = hVendues > 0 ? fixes / hVendues + x.taux * f : 0;
  const tauxPM = hVendues > 0 && f < 1 ? (fixes + f * (caNeg + caScan) - (caNeg * x.mneg) / 100 - caScan) / (hVendues * (1 - f)) : NaN;
  const margeVar = ca > 0 ? (ca - achats - fees) / ca : 0;
  const caPM = margeVar > 0 ? fixes / margeVar : NaN;
  const parProductif = ((((x.heures * x.occ) / 100) * x.eff) / 100) * x.taux * (1 - f) - x.sal * 1000;
  return {
    hPayees, hAffaires, hProduction, hVendues, caProd, caNeg, caScan, ca, achats, salaires, fees, loyer, autres, resultat, coutHeure, tauxPM, caPM, parProductif,
    marge: ca > 0 ? resultat / ca : 0,
    masseCA: ca > 0 ? salaires / ca : 0,
    caParPers: ca / Math.max(1, x.prod + x.struct),
  };
}

/* ---------------- valeurs de départ ---------------- */

export type Source = { texte: string; reel: boolean }; // reel = vient de nos chiffres
export type Parametres = { salaire_charge_k: number; fees_pct: number; location_k: number; autres_frais_k: number; modifie_le: string | null };
export type Depart = { valeurs: Leviers; sources: Record<Cle, Source>; coutStructure: number | null; parametres: Parametres | null };

type Effectifs = { productifs: { id: string; nom: string }[]; structure: { id: string; nom: string }[] };

export async function chargerEffectifs(): Promise<Effectifs> {
  const lignes = await chargerTout<{ id: string; prenom: string | null; nom: string | null; trigramme: string | null; role: string | null; actif: boolean | null; inclus_statistiques: boolean | null }>((a, b) =>
    supabase.from("collaborateurs").select("id,prenom,nom,trigramme,role,actif,inclus_statistiques").order("id").range(a, b)
  );
  const res: Effectifs = { productifs: [], structure: [] };
  for (const c of lignes) {
    const role = String(c.role ?? "").toUpperCase();
    if (c.actif === false || role === "DIRECTION") continue; // la Direction ne compte pas (visiteurs de l'application)
    const nom = c.trigramme || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim();
    if (c.inclus_statistiques === true && role !== "ADMIN") res.productifs.push({ id: c.id, nom });
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
  const { data, error } = await supabase.from("simulateur_parametres").select("salaire_charge_k,fees_pct,location_k,autres_frais_k,modifie_le").eq("exercice", exercice).maybeSingle();
  if (error || !data) return null; // table pas encore créée (SQL 101) ou rien d'enregistré
  const n = (v: unknown) => Number(v) || 0;
  return { salaire_charge_k: n(data.salaire_charge_k), fees_pct: n(data.fees_pct), location_k: n(data.location_k), autres_frais_k: n(data.autres_frais_k), modifie_le: data.modifie_le ?? null };
}

export async function enregistrerParametres(exercice: number, v: Leviers, moiId: string | null): Promise<string | null> {
  const { error } = await supabase.from("simulateur_parametres").upsert(
    { exercice, salaire_charge_k: v.sal, fees_pct: v.fees, location_k: v.loyer, autres_frais_k: v.autres, modifie_le: new Date().toISOString(), modifie_par: moiId },
    { onConflict: "exercice" }
  );
  return error ? error.message : null;
}

/* Les chiffres que donne la Rentabilité pour l'exercice : efficience, taux de vente, négoce */
export function chiffresRentabilite(d: DonneesRentabilite, exercice: number, exclues: Set<string>) {
  const r = calculerRentabilite(d, exercice, exclues);
  const forfaits = r.affaires.filter((a) => !a.auMontant);
  const hc = forfaits.reduce((t, a) => t + a.hc, 0);
  const hr = forfaits.reduce((t, a) => t + a.hr, 0);
  // EFFICIENCE_PEPI (PLG, 17/11/2026) : les PE / PI comptent aussi (heures facturées ÷ heures pointées des mois facturés),
  // puisque la console applique l'efficience à toutes les heures passées sur affaires
  const hcPrest = r.prestationsEx.reduce((t, p) => t + p.hc, 0);
  const hrPrest = r.prestationsEx.reduce((t, p) => t + p.hr, 0);
  const NEGOCE = new Set(["Négoce", "Négoce au montant"]);
  const lignesNegoce = r.groupes.filter((g) => NEGOCE.has(g.cle));
  const caNegoce = lignesNegoce.reduce((t, g) => t + g.ca, 0);
  const achatsNegoce = lignesNegoce.reduce((t, g) => t + g.achats, 0);
  // SCAN_PUR : le scan vendu au montant (imputé Scan, sans heures chiffrées) : CA net d'achats et heures passées
  const scanPurAff = r.affaires.filter((a) => a.auMontant && a.activite === "Scan");
  const caScanPur = scanPurAff.reduce((t, a) => t + a.ca, 0);
  const achatsScanPur = scanPurAff.reduce((t, a) => t + a.achats, 0);
  const heuresScanPur = scanPurAff.reduce((t, a) => t + a.hr, 0);
  // production : tout sauf le négoce et les trajets, moins le scan pur vendu au montant (pas d'heures chiffrées)
  const lignesProd = r.groupes.filter((g) => !NEGOCE.has(g.cle) && g.cle !== "Trajets");
  const scanPur = r.affaires.filter((a) => a.auMontant && a.activite === "Scan").reduce((t, a) => t + a.ca, 0);
  const caProd = lignesProd.reduce((t, g) => t + g.ca, 0) - scanPur;
  const hcProd = lignesProd.reduce((t, g) => t + g.hc, 0);
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
    caNegoce,
    caScanPur,
    achatsScanPur,
    heuresScanPur,
    nbScanPur: scanPurAff.length,
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

  v.prod = effectifs.productifs.length;
  s.prod = { reel: true, texte: `Actifs inclus dans les statistiques, hors ADMIN et Direction : ${effectifs.productifs.map((p) => p.nom).join(", ") || "aucun"}` };
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

  if (renta.taux !== null) {
    v.taux = Math.round(renta.taux * 2) / 2;
    s.taux = { reel: true, texte: `${fr(renta.caProd)} € ÷ ${fr(renta.hcProd)} h vendues (forfaits et ${renta.nbPrestations} PE / PI), sans négoce ni scan pur` };
  } else s.taux = { reel: false, texte: "Pas d’heures vendues sur l’exercice : valeur d’exemple" };

  v.neg = Math.round(renta.caNegoce / 1000 / 5) * 5;
  s.neg = { reel: true, texte: `Négoce des forfaits livrés en ${ex} : ${fr(renta.caNegoce)} €` };
  const nbScan = `${renta.nbScanPur} affaire${renta.nbScanPur > 1 ? "s" : ""} de scan pur livrée${renta.nbScanPur > 1 ? "s" : ""} en ${ex}`;
  v.scan = Math.round((renta.caScanPur - renta.achatsScanPur) / 1000 / 5) * 5;
  s.scan = { reel: true, texte: `${nbScan} : vendu ${fr(renta.caScanPur)} € − achats ${fr(renta.achatsScanPur)} €` };
  v.hscan = Math.round(renta.heuresScanPur / 10) * 10;
  s.hscan = { reel: true, texte: `${nbScan} : ${fr(renta.heuresScanPur)} h pointées (hors trajets)` };
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
