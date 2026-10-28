/* ================================================================
   lib/suiviAffaires.ts  -  LOT B : moteur de lecture du classeur
   « Suivi d'affaire BE » (sans dépendance, utilisable dans le navigateur
   ET dans la fonction Edge Supabase).

   1. extraireColonnesAutorisees : ne garde QUE les colonnes autorisées
      (aucune donnée client autre que le nom abrégé et le N° client,
      aucun commentaire). À appeler AVANT tout envoi hors du poste.
   2. analyserSuivi : nettoie, classe (devis / base / avenant / lot / échéance),
      calcule les totaux par affaire et liste les anomalies (sans bloquer).
   3. comparerAvecExistant : prépare la synchronisation (créer / modifier /
      inchangées / disparues), en reconnaissant un devis devenu commande.

   Règles (confirmées par PLG) :
   - Clé d'une ligne : N°Affaire, sinon Numéro d'offre, sinon N° Devis.
   - Avenant (R) : heures et « Montant » s'ajoutent à la commande de base.
   - Échéance (ECH) et lot (LOT) : DECOUPENT le montant de leur parent,
     ne s'additionnent jamais, 0 heure.
   - Achats = coût d'achat : jamais ajoutés au montant.
   - Ligne « Devis perdu » / « Commande annulée » : inactive (avenant perdu =
     avenant non retenu ; commande de base perdue ou annulée = affaire annulée).
   - Périmètre : devis ouverts à partir du 01/11/2024 ; la famille suit le devis.
   ================================================================ */

/* ---------------------------------------------------------------
   Types
   --------------------------------------------------------------- */
export type ValeurCellule = string | number | boolean | Date | null | undefined;
export type LigneBrute = { [titre: string]: ValeurCellule } & { __ligne?: number };

export type Genre = "DEVIS" | "BASE" | "AVENANT" | "LOT" | "ECHEANCE";
export type Gravite = "ERREUR" | "ATTENTION" | "INFO";

export type Anomalie = {
  gravite: Gravite;      // ERREUR = ligne ignorée ; ATTENTION = à corriger dans Excel ; INFO = pour mémoire
  type: string;          // code court, pour regrouper
  message: string;       // phrase lisible
  ligne_excel?: number;
  cle?: string;
};

export type Discipline = "meca" | "calcul" | "elec" | "pneu" | "scan" | "autre";
export const DISCIPLINES: Discipline[] = ["meca", "calcul", "elec", "pneu", "scan", "autre"];
/** Nom de la colonne d'indicateur (A-F), tel qu'enregistré dans suivi_correspondance_activites. */
export const NOM_DISCIPLINE: Record<Discipline, string> = {
  meca: "Méca", calcul: "Calcul", elec: "Elec", pneu: "Pneu", scan: "Scan", autre: "Autre",
};

export type LigneSuivi = {
  cle: string;
  numero_devis: string | null;
  numero_affaire: string | null;
  numero_offre: string | null;
  base_devis: string | null;
  base_affaire: string | null;
  genre: Genre;
  rang_avenant: number | null;
  rang_lot: number | null;
  rang_echeance: number | null;
  parent_cle: string | null;

  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_cle: string | null;          // "N:123" (N° client) ou "A:nom abrégé"
  redacteur: string | null;
  redacteur_id: string | null;
  livre_par: string | null;
  livre_par_id: string | null;
  format_livraison: string | null;
  numero_arc_louxor: string | null;
  activites_excel: string[];

  date_ouverture: string | null;      // AAAA-MM-JJ
  date_envoi: string | null;
  date_reception_commande: string | null;
  date_livraison_estimee: string | null;
  delai: string | null;
  date_livraison: string | null;

  heures_meca: number; heures_calcul: number; heures_elec: number;
  heures_pneu: number; heures_scan: number; heures_autre: number;
  heures_total: number;

  montants: {
    montant: number; montant_echeances: number;
    montant_meca: number; montant_calcul: number; montant_elec_pneu: number;
    montant_scan: number; montant_autre: number;
    montant_achats: number; montant_negoce: number;
  };

  active: boolean;
  ligne_excel: number | null;
  anomalies: Anomalie[];
  empreinte: string;
};

export type ClientSuivi = {
  cle: string;                 // "N:123" ou "A:nom"
  numero_client: number | null;
  nom_abrege: string;
};

export type StatutAffaire = "ANNULEE" | "LIVREE" | "EN_COURS" | "INTENTION" | "A_VERIFIER";

export type AffaireSuivi = {
  base_affaire: string;               // chiffres : 1417
  numero_affaire: string;             // CBE1417
  numero_devis: string | null;
  designation: string | null;
  imputation: string | null;
  client_cle: string | null;
  redacteur: string | null;
  redacteur_id: string | null;
  numero_arc_louxor: string | null;
  statut_affaire: StatutAffaire;
  nb_avenants: number;
  nb_avenants_actifs: number;
  nb_decoupages: number;
  heures: Record<Discipline, number>;
  heures_total: number;
  montant: number;                    // base + avenants actifs (colonne « Montant »)
  montant_detail: { meca: number; calcul: number; elec_pneu: number; scan: number; autre: number; negoce: number };
  montant_achats: number;
  montant_echeancier: number;         // somme des découpages (pour information)
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  date_livraison_estimee: string | null;
  date_livraison: string | null;
  cles_lignes: string[];
};

export type OptionsAnalyse = {
  dateMin?: string;                   // défaut 2024-11-01
  imputations?: string[];             // défaut BE, PI, PE, Scan, Négoce, IG
  annuaire?: { id: string; prenom: string | null; nom: string | null }[];
};

export type ResultatAnalyse = {
  lignes: LigneSuivi[];
  clients: ClientSuivi[];
  affaires: AffaireSuivi[];
  anomalies: Anomalie[];              // toutes (lignes + générales)
  colonnesManquantes: string[];       // si non vide : classeur refusé
  stats: {
    lignes_lues: number;
    lignes_retenues: number;
    lignes_hors_perimetre: number;
    lignes_ignorees: number;
    par_genre: Record<Genre, number>;
    par_statut: Record<string, number>;
    erreurs: number; attentions: number; infos: number;
    dates_texte_converties: number;    // « jj/mm/aaaa » écrit en texte, converti sans bruit
    nombres_texte_convertis: number;   // « 427,5 » écrit en texte, converti sans bruit
  };
};

/* ---------------------------------------------------------------
   Colonnes autorisées (repérées par leur TITRE, jamais par leur lettre)
   --------------------------------------------------------------- */
type Champ =
  | "ind_meca" | "ind_calcul" | "ind_elec" | "ind_pneu" | "ind_scan" | "ind_autre"
  | "statut" | "imputation" | "numero_devis" | "numero_affaire" | "designation"
  | "client_nom" | "date_ouverture" | "redacteur"
  | "h_meca" | "h_calcul" | "h_elec" | "h_pneu" | "h_scan" | "h_autre" | "h_total"
  | "m_montant" | "m_echeances" | "m_meca" | "m_calcul" | "m_elec_pneu" | "m_scan" | "m_autre"
  | "m_achats" | "m_negoce"
  | "date_livraison_estimee" | "date_envoi" | "numero_offre" | "date_reception_commande"
  | "delai" | "date_livraison" | "livre_par" | "format_livraison" | "numero_client"
  | "numero_arc_louxor";

/** Titre normalisé -> champ. Le titre Excel est comparé sans accents, espaces ni ponctuation. */
const COLONNES: Record<string, Champ> = {
  meca: "ind_meca", calcul: "ind_calcul", elec: "ind_elec", pneu: "ind_pneu",
  scan: "ind_scan", autre: "ind_autre",
  statut: "statut", imputation: "imputation",
  ndevis: "numero_devis", naffaire: "numero_affaire", designation: "designation",
  clientnomabrege: "client_nom", dateouverturedevis: "date_ouverture", redacteurdevis: "redacteur",
  heuresmeca: "h_meca", heurescalcul: "h_calcul", heureselec: "h_elec", heurespneu: "h_pneu",
  heuresscan: "h_scan", heuresautre: "h_autre", totalheures: "h_total",
  montant: "m_montant", montantecheances: "m_echeances", montantmeca: "m_meca",
  montantcalcul: "m_calcul", montantelecpneu: "m_elec_pneu", montantscan: "m_scan",
  montantautre: "m_autre", montantachats: "m_achats", montantnegoce: "m_negoce",
  datedelivraisonestimee: "date_livraison_estimee", dateenvoidevis: "date_envoi",
  numerodoffre: "numero_offre", datereceptioncommande: "date_reception_commande",
  delai: "delai", datedelivraison: "date_livraison", livrepar: "livre_par",
  formatdelivraison: "format_livraison", nclient: "numero_client",
  narclouxor: "numero_arc_louxor",
};

/** Colonnes sans lesquelles on refuse le classeur. */
const OBLIGATOIRES: Champ[] = [
  "numero_devis", "numero_affaire", "statut", "imputation", "designation",
  "date_ouverture", "numero_offre", "h_total", "m_montant", "m_echeances",
];

const TITRE_LISIBLE: Partial<Record<Champ, string>> = {
  numero_devis: "N° Devis", numero_affaire: "N°Affaire", statut: "Statut",
  imputation: "Imputation", designation: "Désignation", date_ouverture: "Date ouverture devis",
  numero_offre: "Numéro d'offre", h_total: "Total heures", m_montant: "Montant",
  m_echeances: "Montant échéances",
};

export function normaliserTitre(t: string): string {
  return String(t)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Ne garde que les colonnes autorisées et les lignes réelles (avec un N° Devis).
 * Les titres sont conservés tels qu'écrits dans Excel. Ajoute __ligne si absent
 * (on suppose alors que la 1re ligne de données est la ligne 3 d'Excel).
 */
export function extraireColonnesAutorisees(lignes: Record<string, unknown>[], premiereLigneExcel = 3): LigneBrute[] {
  const sortie: LigneBrute[] = [];
  lignes.forEach((l, i) => {
    const propre: LigneBrute = {};
    let aUnDevis = false;
    for (const [titre, v] of Object.entries(l)) {
      if (titre === "__ligne") continue;
      const champ = COLONNES[normaliserTitre(titre)];
      if (!champ) continue;
      propre[titre] = v as ValeurCellule;
      if (champ === "numero_devis" && v !== null && v !== undefined && String(v).trim() !== "") aUnDevis = true;
    }
    if (!aUnDevis) return;
    const n = (l as { __ligne?: unknown }).__ligne;
    propre.__ligne = typeof n === "number" ? n : premiereLigneExcel + i;
    sortie.push(propre);
  });
  return sortie;
}

/* ---------------------------------------------------------------
   Conversion des valeurs
   --------------------------------------------------------------- */
function texte(v: ValeurCellule): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return dateIso(v);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

function pad(n: number): string { return n < 10 ? "0" + n : String(n); }

function dateIso(d: Date): string {
  // +12 h : protège des dates Excel décalées de quelques secondes ou d'un fuseau.
  const x = new Date(d.getTime() + 12 * 3600 * 1000);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

function serieExcelVersIso(n: number): string {
  const jours = Math.floor(n + 1e-6);
  const ms = Date.UTC(1899, 11, 30) + jours * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dateValide(a: number, m: number, j: number): boolean {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || j < 1) return false;
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

type Lu<T> = { valeur: T; probleme?: string; texte?: boolean };

/** Accepte : numéro de série Excel, Date, texte jj/mm/aaaa (ou jj-mm-aaaa, jj.mm.aa), texte AAAA-MM-JJ. */
export function lireDate(v: ValeurCellule): Lu<string | null> {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { valeur: null };
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return { valeur: null, probleme: "date illisible" };
    return { valeur: dateIso(v) };
  }
  if (typeof v === "number") {
    if (v < 36526 || v > 73051) return { valeur: null, probleme: `nombre ${v} qui n'est pas une date plausible` };
    return { valeur: serieExcelVersIso(v) };
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) {
    let a = Number(m[3]);
    if (a < 100) a += 2000;
    const mo = Number(m[2]), j = Number(m[1]);
    if (!dateValide(a, mo, j)) return { valeur: null, probleme: `date « ${s} » impossible` };
    return { valeur: `${a}-${pad(mo)}-${pad(j)}`, texte: true };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]);
    if (!dateValide(a, mo, j)) return { valeur: null, probleme: `date « ${s} » impossible` };
    return { valeur: `${a}-${pad(mo)}-${pad(j)}`, texte: true };
  }
  return { valeur: null, probleme: `« ${s} » n'est pas une date` };
}

/** Nombre : accepte 427.5, « 427,5 », « 1 234,50 € ». Vide = 0. Arrondi au centime. */
export function lireNombre(v: ValeurCellule): Lu<number> {
  if (v === null || v === undefined || v === "") return { valeur: 0 };
  if (typeof v === "number") return isFinite(v) ? { valeur: arrondi(v) } : { valeur: 0, probleme: "nombre illisible" };
  if (typeof v === "boolean" || v instanceof Date) return { valeur: 0, probleme: "valeur qui n'est pas un nombre" };
  const s = String(v).replace(/[\s\u00a0€]/g, "").replace(",", ".");
  if (s === "" || s === "-") return { valeur: 0 };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { valeur: 0, probleme: `« ${String(v).trim()} » n'est pas un nombre` };
  return { valeur: arrondi(Number(s)), texte: true };
}

function arrondi(n: number): number { return Math.round(n * 100) / 100; }

function sansAccent(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* ---------------------------------------------------------------
   Empreinte (identique navigateur / Deno, synchrone)
   --------------------------------------------------------------- */
export function empreinteTexte(s: string): string {
  // cyrb53 : hachage rapide 53 bits, suffisant pour détecter un changement.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ---------------------------------------------------------------
   Référentiels
   --------------------------------------------------------------- */
export const STATUTS_CONNUS = [
  "Devis ouvert", "Devis envoyé", "Devis perdu", "Intention de commande",
  "Commande reçue", "Livrée", "Commande annulée",
];
const STATUTS_INACTIFS = ["Devis perdu", "Commande annulée"];
const IMPUTATIONS_DEFAUT = ["BE", "PI", "PE", "Scan", "Négoce", "IG"];

const RE_DEVIS = /^DBE(\d{1,8})$/;
const RE_AFFAIRE = /^CBE(\d{1,8})(?:R(\d{1,3}))?(?:LOT(\d{1,3}))?(?:ECH(\d{1,3}))?$/;

/* ---------------------------------------------------------------
   Analyse
   --------------------------------------------------------------- */
export function analyserSuivi(brutes: LigneBrute[], options: OptionsAnalyse = {}): ResultatAnalyse {
  const dateMin = options.dateMin ?? "2023-11-01"; // PERIMETRE_2023
  const imputations = options.imputations ?? IMPUTATIONS_DEFAUT;
  const anomaliesGenerales: Anomalie[] = [];

  // --- Colonnes présentes
  const presents = new Set<Champ>();
  for (const l of brutes.slice(0, 50)) {
    for (const t of Object.keys(l)) {
      const c = COLONNES[normaliserTitre(t)];
      if (c) presents.add(c);
    }
  }
  const colonnesManquantes = brutes.length === 0
    ? OBLIGATOIRES.map((c) => TITRE_LISIBLE[c] ?? c)
    : OBLIGATOIRES.filter((c) => !presents.has(c)).map((c) => TITRE_LISIBLE[c] ?? c);

  const statsVides = {
    lignes_lues: brutes.length, lignes_retenues: 0, lignes_hors_perimetre: 0, lignes_ignorees: 0,
    par_genre: { DEVIS: 0, BASE: 0, AVENANT: 0, LOT: 0, ECHEANCE: 0 } as Record<Genre, number>,
    par_statut: {} as Record<string, number>, erreurs: 0, attentions: 0, infos: 0,
    dates_texte_converties: 0, nombres_texte_convertis: 0,
  };
  if (colonnesManquantes.length > 0) {
    const a: Anomalie = {
      gravite: "ERREUR", type: "COLONNES_MANQUANTES",
      message: `Colonnes introuvables : ${colonnesManquantes.join(", ")}. Le classeur n'est pas lu.`,
    };
    return { lignes: [], clients: [], affaires: [], anomalies: [a], colonnesManquantes, stats: { ...statsVides, erreurs: 1 } };
  }

  // --- Annuaire (rapprochement « Prénom NOM »)
  const annuaire = new Map<string, string>();
  for (const c of options.annuaire ?? []) {
    const k1 = sansAccent(`${c.prenom ?? ""}${c.nom ?? ""}`);
    const k2 = sansAccent(`${c.nom ?? ""}${c.prenom ?? ""}`);
    if (k1) annuaire.set(k1, c.id);
    if (k2) annuaire.set(k2, c.id);
  }
  const nomsInconnus = new Map<string, number>();
  const rapprocher = (nom: string | null): string | null => {
    if (!nom || !options.annuaire) return null;
    const id = annuaire.get(sansAccent(nom)) ?? null;
    if (!id) nomsInconnus.set(nom, (nomsInconnus.get(nom) ?? 0) + 1);
    return id;
  };

  // --- Lecture ligne par ligne
  type Interne = LigneSuivi & { client_nom: string | null; numero_client: number | null; retenue: boolean };
  const lues: Interne[] = [];
  const clesVues = new Set<string>();
  let ignorees = 0;
  let datesTexte = 0, nombresTexte = 0;

  for (const b of brutes) {
    const v: Partial<Record<Champ, ValeurCellule>> = {};
    for (const [t, val] of Object.entries(b)) {
      const c = COLONNES[normaliserTitre(t)];
      if (c) v[c] = val as ValeurCellule;
    }
    const ligne_excel = typeof b.__ligne === "number" ? b.__ligne : null;
    const an: Anomalie[] = [];
    const ajouter = (gravite: Gravite, type: string, message: string) => an.push({ gravite, type, message, ligne_excel: ligne_excel ?? undefined });

    // Numéros
    const numero_devis = texte(v.numero_devis)?.toUpperCase().replace(/\s/g, "") ?? null;
    const numero_affaire = texte(v.numero_affaire)?.toUpperCase().replace(/\s/g, "") ?? null;
    const numero_offre = texte(v.numero_offre)?.toUpperCase().replace(/\s/g, "") ?? null;
    if (!numero_devis) { ignorees++; continue; }

    const md = numero_devis.match(RE_DEVIS);
    const base_devis = md ? String(Number(md[1])) : null;
    if (!md) ajouter("ATTENTION", "NUMERO_DEVIS", `N° de devis « ${numero_devis} » mal formé (attendu DBE suivi de chiffres).`);

    let genre: Genre = "DEVIS";
    let base_affaire: string | null = null;
    let rang_avenant: number | null = null, rang_lot: number | null = null, rang_echeance: number | null = null;
    let parent_cle: string | null = null;
    if (numero_affaire) {
      const ma = numero_affaire.match(RE_AFFAIRE);
      if (!ma) {
        anomaliesGenerales.push({ gravite: "ERREUR", type: "NUMERO_AFFAIRE", ligne_excel: ligne_excel ?? undefined,
          message: `N° d'affaire « ${numero_affaire} » non reconnu (attendu CBE1234, CBE1234R1, CBE1234LOT1, CBE1234ECH1…) : ligne ignorée.` });
        ignorees++;
        continue;
      }
      base_affaire = String(Number(ma[1]));
      rang_avenant = ma[2] ? Number(ma[2]) : null;
      rang_lot = ma[3] ? Number(ma[3]) : null;
      rang_echeance = ma[4] ? Number(ma[4]) : null;
      const racine = `CBE${ma[1]}`;
      const racineR = rang_avenant !== null ? `${racine}R${ma[2]}` : racine;
      if (rang_echeance !== null) { genre = "ECHEANCE"; parent_cle = rang_lot !== null ? `${racineR}LOT${ma[3]}` : racineR; }
      else if (rang_lot !== null) { genre = "LOT"; parent_cle = racineR; }
      else if (rang_avenant !== null) { genre = "AVENANT"; parent_cle = racine; }
      else genre = "BASE";
    }

    const cle = numero_affaire ?? numero_offre ?? numero_devis;
    if (clesVues.has(cle)) {
      anomaliesGenerales.push({ gravite: "ERREUR", type: "DOUBLON", ligne_excel: ligne_excel ?? undefined, cle,
        message: `« ${cle} » apparaît plusieurs fois : seule la première ligne est prise.` });
      ignorees++;
      continue;
    }
    clesVues.add(cle);

    // Statut, imputation
    const statut = texte(v.statut);
    if (!statut) ajouter("ATTENTION", "STATUT_VIDE", "Statut vide.");
    else if (!STATUTS_CONNUS.includes(statut)) ajouter("ATTENTION", "STATUT_INCONNU", `Statut « ${statut} » inconnu.`);
    const active = !STATUTS_INACTIFS.includes(statut ?? "");

    let imputation = texte(v.imputation);
    if (imputation) {
      const trouve = imputations.find((i) => sansAccent(i) === sansAccent(imputation!));
      if (trouve) imputation = trouve;
      else ajouter("ATTENTION", "IMPUTATION_INCONNUE", `Imputation « ${imputation} » absente de la liste de l'application.`);
    } else if (genre === "BASE" || genre === "DEVIS" || genre === "AVENANT") {
      ajouter(active ? "ATTENTION" : "INFO", "IMPUTATION_VIDE", "Imputation vide.");
    }

    // Dates
    const lireD = (champ: Champ, nom: string): string | null => {
      const r = lireDate(v[champ]);
      if (r.probleme) ajouter("ATTENTION", "DATE", `${nom} : ${r.probleme}.`);
      if (r.texte) datesTexte++;
      return r.valeur;
    };
    const date_ouverture = lireD("date_ouverture", "Date ouverture devis");
    const date_envoi = lireD("date_envoi", "Date envoi devis");
    const date_reception_commande = lireD("date_reception_commande", "Date réception commande");
    const date_livraison_estimee = lireD("date_livraison_estimee", "Date de livraison estimée");
    const delai = lireD("delai", "Délai");
    const date_livraison = lireD("date_livraison", "Date de livraison");
    if (!date_ouverture) ajouter("ATTENTION", "DATE_OUVERTURE_VIDE", "Date d'ouverture du devis vide.");
    if (statut === "Livrée" && !date_livraison && (genre === "BASE" || genre === "AVENANT"))
      ajouter("ATTENTION", "LIVREE_SANS_DATE", "Statut « Livrée » sans date de livraison.");

    // Heures
    const lireN = (champ: Champ, nom: string): number => {
      const r = lireNombre(v[champ]);
      if (r.probleme) ajouter("ATTENTION", "NOMBRE", `${nom} : ${r.probleme} (compté 0).`);
      if (r.texte) nombresTexte++;
      return r.valeur;
    };
    const h = {
      meca: lireN("h_meca", "Heures méca"), calcul: lireN("h_calcul", "Heures calcul"),
      elec: lireN("h_elec", "Heures élec"), pneu: lireN("h_pneu", "Heures pneu"),
      scan: lireN("h_scan", "Heures scan"), autre: lireN("h_autre", "Heures autre"),
    };
    const detailH = arrondi(DISCIPLINES.reduce((s, d) => s + h[d], 0));
    const vTotal = v.h_total;
    let heures_total = lireN("h_total", "Total heures");
    if (vTotal === null || vTotal === undefined || vTotal === "") heures_total = detailH;
    if (genre === "LOT" || genre === "ECHEANCE") {
      if (heures_total > 0 || detailH > 0)
        ajouter("ATTENTION", "HEURES_DECOUPAGE", `${genre === "LOT" ? "Lot" : "Échéance"} avec des heures (${Math.max(heures_total, detailH)} h) : non comptées.`);
    } else if (detailH === 0 && heures_total > 0) {
      ajouter("INFO", "HEURES_NON_VENTILEES", `${heures_total} h sans ventilation par discipline.`);
    } else if (detailH > 0 && Math.abs(detailH - heures_total) > 0.01) {
      ajouter("ATTENTION", "HEURES_TOTAL", `Total heures ${heures_total} h différent de la somme des disciplines ${detailH} h.`);
    }

    // Indicateurs d'activités (A-F)
    const ind: Record<Discipline, Champ> = {
      meca: "ind_meca", calcul: "ind_calcul", elec: "ind_elec", pneu: "ind_pneu", scan: "ind_scan", autre: "ind_autre",
    };
    const activites_excel = DISCIPLINES.filter((d) => texte(v[ind[d]]) !== null).map((d) => NOM_DISCIPLINE[d]);
    if (genre !== "LOT" && genre !== "ECHEANCE") {
      if (activites_excel.length === 0) ajouter("INFO", "AUCUNE_ACTIVITE", "Aucune activité cochée (colonnes Méca à Autre).");
      const sansIndic = DISCIPLINES.filter((d) => h[d] > 0 && !activites_excel.includes(NOM_DISCIPLINE[d]));
      if (sansIndic.length > 0)
        ajouter("INFO", "HEURES_SANS_ACTIVITE", `Heures en ${sansIndic.map((d) => NOM_DISCIPLINE[d]).join(", ")} sans l'activité cochée.`);
    }

    // Montants
    const m = {
      montant: lireN("m_montant", "Montant"), montant_echeances: lireN("m_echeances", "Montant échéances"),
      montant_meca: lireN("m_meca", "Montant méca"), montant_calcul: lireN("m_calcul", "Montant calcul"),
      montant_elec_pneu: lireN("m_elec_pneu", "Montant Elec/pneu"), montant_scan: lireN("m_scan", "Montant Scan"),
      montant_autre: lireN("m_autre", "Montant autre"), montant_achats: lireN("m_achats", "Montant achats"),
      montant_negoce: lireN("m_negoce", "Montant négoce"),
    };

    // Client
    const client_nom = texte(v.client_nom);
    let numero_client: number | null = null;
    const vNc = v.numero_client;
    if (vNc !== null && vNc !== undefined && vNc !== "") {
      const s = String(vNc).trim();
      if (/^\d+(\.0+)?$/.test(s)) numero_client = Number(s);
      else ajouter("ATTENTION", "NUMERO_CLIENT", `N° client « ${s} » non numérique : ignoré.`);
    }
    const client_cle = numero_client !== null ? `N:${numero_client}` : client_nom ? `A:${client_nom}` : null;

    const redacteur = texte(v.redacteur);
    const livre_par = texte(v.livre_par);

    const ligne: Interne = {
      cle, numero_devis, numero_affaire, numero_offre, base_devis, base_affaire, genre,
      rang_avenant, rang_lot, rang_echeance, parent_cle,
      statut, imputation, designation: texte(v.designation), client_cle,
      redacteur, redacteur_id: rapprocher(redacteur),
      livre_par, livre_par_id: rapprocher(livre_par),
      format_livraison: texte(v.format_livraison),
      numero_arc_louxor: texte(v.numero_arc_louxor),
      activites_excel,
      date_ouverture, date_envoi, date_reception_commande, date_livraison_estimee, delai, date_livraison,
      heures_meca: h.meca, heures_calcul: h.calcul, heures_elec: h.elec, heures_pneu: h.pneu,
      heures_scan: h.scan, heures_autre: h.autre, heures_total,
      montants: m,
      active, ligne_excel, anomalies: an, empreinte: "",
      client_nom, numero_client, retenue: true,
    };
    for (const a of an) a.cle = cle;
    lues.push(ligne);
  }

  // --- Périmètre : date d'ouverture la plus ancienne de chaque devis
  //     (les avenants partagent le N° de devis de la commande de base).
  const ouvertureDevis = new Map<string, string>();
  for (const l of lues) {
    if (!l.numero_devis || !l.date_ouverture) continue;
    const d = ouvertureDevis.get(l.numero_devis);
    if (!d || l.date_ouverture < d) ouvertureDevis.set(l.numero_devis, l.date_ouverture);
  }
  // La famille d'une commande suit le devis de sa ligne de base.
  const devisDeLaBase = new Map<string, string>();
  for (const l of lues) if (l.genre === "BASE" && l.base_affaire && l.numero_devis) devisDeLaBase.set(l.base_affaire, l.numero_devis);
  let horsPerimetre = 0;
  for (const l of lues) {
    const devisRef = (l.base_affaire && devisDeLaBase.get(l.base_affaire)) || l.numero_devis;
    const d = devisRef ? ouvertureDevis.get(devisRef) : undefined;
    if (d && d < dateMin) { l.retenue = false; horsPerimetre++; }
  }
  const retenues = lues.filter((l) => l.retenue);

  // --- Contrôles entre lignes : parents, découpages, montants
  const parCle = new Map(retenues.map((l) => [l.cle, l]));
  const enfants = new Map<string, Interne[]>();
  for (const l of retenues) {
    if (l.parent_cle) {
      const t = enfants.get(l.parent_cle) ?? [];
      t.push(l);
      enfants.set(l.parent_cle, t);
      if (!parCle.has(l.parent_cle))
        l.anomalies.push({ gravite: "ATTENTION", type: "PARENT_ABSENT", cle: l.cle, ligne_excel: l.ligne_excel ?? undefined,
          message: `Ligne parente ${l.parent_cle} introuvable dans le classeur.` });
    }
  }

  const valeurDecoupage = (l: Interne) => l.montants.montant_echeances || l.montants.montant;
  const detailMontant = (l: Interne) => arrondi(l.montants.montant_meca + l.montants.montant_calcul +
    l.montants.montant_elec_pneu + l.montants.montant_scan + l.montants.montant_autre + l.montants.montant_negoce);

  for (const l of retenues) {
    const ajouter = (gravite: Gravite, type: string, message: string) =>
      l.anomalies.push({ gravite, type, message, cle: l.cle, ligne_excel: l.ligne_excel ?? undefined });
    const det = detailMontant(l);
    const decoupes = (enfants.get(l.cle) ?? []).filter((e) => e.genre === "LOT" || e.genre === "ECHEANCE");

    if (l.genre === "LOT" || l.genre === "ECHEANCE") {
      if (l.montants.montant > 0 && l.montants.montant_echeances === 0)
        ajouter("ATTENTION", "DECOUPAGE_DANS_MONTANT",
          `${l.genre === "LOT" ? "Lot" : "Échéance"} avec ${fmt(l.montants.montant)} dans la colonne « Montant » au lieu de « Montant échéances » : traité comme un découpage, non additionné.`);
      continue;
    }

    // Lignes propres : devis, base, avenant
    if (decoupes.length > 0) {
      const somme = arrondi(decoupes.reduce((s, e) => s + valeurDecoupage(e), 0));
      if (somme > 0 && Math.abs(somme - l.montants.montant) > 1)
        ajouter("ATTENTION", "ECHEANCIER",
          `Les découpages (${decoupes.map((e) => e.cle).join(", ")}) totalisent ${fmt(somme)} pour un montant de ${fmt(l.montants.montant)} (écart ${fmt(somme - l.montants.montant)}).`);
      if (det === 0) continue; // détail porté par les découpages : normal
    }
    if (l.montants.montant === 0 && det > 0)
      ajouter("ATTENTION", "MONTANT_ZERO", `Montant à 0 alors que le détail fait ${fmt(det)}.`);
    else if (l.montants.montant > 0 && det === 0)
      ajouter("INFO", "MONTANT_SANS_DETAIL", "Montant sans détail par discipline.");
    else if (det > 0 && Math.abs(det - l.montants.montant) > 1)
      ajouter("ATTENTION", "MONTANT_DETAIL",
        `Montant ${fmt(l.montants.montant)} différent de la somme du détail ${fmt(det)} (écart ${fmt(l.montants.montant - det)}).`);
  }

  // --- Clients
  const clientsMap = new Map<string, { numero: number | null; noms: Map<string, number> }>();
  const numerosParNom = new Map<string, Set<number>>();
  for (const l of retenues) {
    if (!l.client_cle) continue;
    const c = clientsMap.get(l.client_cle) ?? { numero: l.numero_client, noms: new Map<string, number>() };
    if (l.client_nom) c.noms.set(l.client_nom, Math.max(c.noms.get(l.client_nom) ?? 0, l.ligne_excel ?? 0));
    clientsMap.set(l.client_cle, c);
    if (l.client_nom && l.numero_client !== null) {
      const k = sansAccent(l.client_nom);
      const s = numerosParNom.get(k) ?? new Set<number>();
      s.add(l.numero_client);
      numerosParNom.set(k, s);
    }
  }
  const clients: ClientSuivi[] = [];
  for (const [cle, c] of clientsMap) {
    const noms = [...c.noms.entries()].sort((a, b) => b[1] - a[1]); // le plus bas dans le classeur = le plus récent
    const nom = noms[0]?.[0] ?? (c.numero !== null ? `Client n° ${c.numero}` : "?");
    if (noms.length === 0 && c.numero !== null)
      anomaliesGenerales.push({ gravite: "INFO", type: "CLIENT_SANS_NOM", message: `N° client ${c.numero} sans nom abrégé : affiché « Client n° ${c.numero} ».` });
    if (noms.length > 1)
      anomaliesGenerales.push({ gravite: "INFO", type: "CLIENT_PLUSIEURS_NOMS",
        message: `N° client ${c.numero} : ${noms.length} noms abrégés différents (${noms.slice(0, 4).map((n) => n[0]).join(", ")}${noms.length > 4 ? "…" : ""}) ; retenu : ${nom}.` });
    clients.push({ cle, numero_client: c.numero, nom_abrege: nom });
  }
  for (const [, nums] of numerosParNom)
    if (nums.size > 1)
      anomaliesGenerales.push({ gravite: "INFO", type: "NOM_PLUSIEURS_CLIENTS",
        message: `Un même nom abrégé est utilisé pour plusieurs N° client (${[...nums].join(", ")}).` });

  // --- Collaborateurs non reconnus (une seule anomalie par nom)
  for (const [nom, n] of nomsInconnus)
    anomaliesGenerales.push({ gravite: "INFO", type: "COLLABORATEUR_INCONNU",
      message: `« ${nom} » (${n} ligne${n > 1 ? "s" : ""}) ne correspond à aucun collaborateur de l'application.` });

  // --- Affaires (une par numéro de commande de base)
  const familles = new Map<string, Interne[]>();
  for (const l of retenues) if (l.base_affaire) {
    const t = familles.get(l.base_affaire) ?? [];
    t.push(l);
    familles.set(l.base_affaire, t);
  }
  const affaires: AffaireSuivi[] = [];
  for (const [base, lignes] of familles) {
    const b = lignes.find((l) => l.genre === "BASE") ?? null;
    if (!b) anomaliesGenerales.push({ gravite: "ATTENTION", type: "BASE_ABSENTE",
      message: `Affaire CBE${base} : avenants, lots ou échéances sans ligne de commande de base.` });
    const comptees = lignes.filter((l) => l.active && (l.genre === "BASE" || l.genre === "AVENANT"));
    const decoupages = lignes.filter((l) => l.genre === "LOT" || l.genre === "ECHEANCE");
    const somme = (f: (l: Interne) => number, ls: Interne[]) => arrondi(ls.reduce((s, l) => s + f(l), 0));
    const heures = {} as Record<Discipline, number>;
    for (const d of DISCIPLINES) heures[d] = somme((l) => (l as unknown as Record<string, number>)[`heures_${d}`], comptees);

    // Détail des montants et achats : sur la ligne elle-même, sinon sur ses découpages.
    const avecRepli = (f: (l: Interne) => number) => arrondi(comptees.reduce((s, l) => {
      const propre = f(l);
      if (propre !== 0) return s + propre;
      const dec = (enfants.get(l.cle) ?? []).filter((e) => e.genre === "LOT" || e.genre === "ECHEANCE");
      return s + dec.reduce((x, e) => x + f(e), 0);
    }, 0));

    let statut_affaire: StatutAffaire;
    const statutBase = b?.statut ?? null;
    if (statutBase === "Commande annulée" || statutBase === "Devis perdu") statut_affaire = "ANNULEE";
    else if (comptees.length > 0 && comptees.every((l) => l.statut === "Livrée")) statut_affaire = "LIVREE";
    else if (comptees.some((l) => l.statut === "Commande reçue" || l.statut === "Livrée")) statut_affaire = "EN_COURS";
    else if (comptees.some((l) => l.statut === "Intention de commande")) statut_affaire = "INTENTION";
    else statut_affaire = "A_VERIFIER";

    const minDate = (f: (l: Interne) => string | null, ls: Interne[]) =>
      ls.map(f).filter((x): x is string => !!x).sort()[0] ?? null;
    const maxDate = (f: (l: Interne) => string | null, ls: Interne[]) =>
      ls.map(f).filter((x): x is string => !!x).sort().reverse()[0] ?? null;

    affaires.push({
      base_affaire: base,
      numero_affaire: `CBE${base}`,
      numero_devis: b?.numero_devis ?? lignes[0].numero_devis,
      designation: b?.designation ?? null,
      imputation: b?.imputation ?? null,
      client_cle: b?.client_cle ?? null,
      redacteur: b?.redacteur ?? null,
      redacteur_id: b?.redacteur_id ?? null,
      numero_arc_louxor: b?.numero_arc_louxor ?? null,
      statut_affaire,
      nb_avenants: lignes.filter((l) => l.genre === "AVENANT").length,
      nb_avenants_actifs: comptees.filter((l) => l.genre === "AVENANT").length,
      nb_decoupages: decoupages.length,
      heures,
      heures_total: somme((l) => l.heures_total, comptees),
      montant: somme((l) => l.montants.montant, comptees),
      montant_detail: {
        meca: avecRepli((l) => l.montants.montant_meca), calcul: avecRepli((l) => l.montants.montant_calcul),
        elec_pneu: avecRepli((l) => l.montants.montant_elec_pneu), scan: avecRepli((l) => l.montants.montant_scan),
        autre: avecRepli((l) => l.montants.montant_autre), negoce: avecRepli((l) => l.montants.montant_negoce),
      },
      montant_achats: avecRepli((l) => l.montants.montant_achats),
      montant_echeancier: somme(valeurDecoupage, decoupages),
      date_ouverture: minDate((l) => l.date_ouverture, lignes),
      date_envoi: b?.date_envoi ?? null,
      date_reception_commande: b?.date_reception_commande ?? null,
      date_livraison_estimee: maxDate((l) => l.date_livraison_estimee, comptees),
      date_livraison: maxDate((l) => l.date_livraison, comptees),
      cles_lignes: lignes.map((l) => l.cle),
    });
  }
  affaires.sort((a, b) => Number(a.base_affaire) - Number(b.base_affaire));

  // --- Empreintes et sortie
  const lignes: LigneSuivi[] = retenues.map((l) => {
    const { client_nom: _cn, numero_client: _nc, retenue: _r, ...propre } = l;
    const pourEmpreinte = { ...propre, anomalies: undefined, empreinte: undefined, ligne_excel: undefined,
      client_nom: _cn, numero_client: _nc };
    propre.empreinte = empreinteTexte(JSON.stringify(pourEmpreinte));
    return propre;
  });

  const anomalies = [...lignes.flatMap((l) => l.anomalies), ...anomaliesGenerales];
  const par_genre: Record<Genre, number> = { DEVIS: 0, BASE: 0, AVENANT: 0, LOT: 0, ECHEANCE: 0 };
  const par_statut: Record<string, number> = {};
  for (const l of lignes) {
    par_genre[l.genre]++;
    const s = l.statut ?? "(vide)";
    par_statut[s] = (par_statut[s] ?? 0) + 1;
  }

  return {
    lignes, clients, affaires, anomalies, colonnesManquantes: [],
    stats: {
      lignes_lues: brutes.length, lignes_retenues: lignes.length, lignes_hors_perimetre: horsPerimetre,
      lignes_ignorees: ignorees, par_genre, par_statut,
      erreurs: anomalies.filter((a) => a.gravite === "ERREUR").length,
      attentions: anomalies.filter((a) => a.gravite === "ATTENTION").length,
      infos: anomalies.filter((a) => a.gravite === "INFO").length,
      dates_texte_converties: datesTexte, nombres_texte_convertis: nombresTexte,
    },
  };
}

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/* ---------------------------------------------------------------
   Préparation de la synchronisation
   --------------------------------------------------------------- */
export type LigneExistante = {
  id: string;
  cle: string;
  genre: Genre;
  numero_offre: string | null;
  empreinte: string | null;
  ligne_excel: number | null;
  disparue: boolean;
};

export type PlanSynchro = {
  creer: LigneSuivi[];
  modifier: { id: string; ancienne_cle: string; ligne: LigneSuivi; raison: "CHANGEE" | "DEVIS_DEVENU_COMMANDE" | "REAPPARUE" }[];
  deplacer: { id: string; ligne_excel: number | null }[];   // seule la position Excel a changé
  inchangees: number;
  disparues: { id: string; cle: string }[];                 // jamais supprimées : marquées « disparue »
};

export function comparerAvecExistant(nouvelles: LigneSuivi[], existantes: LigneExistante[]): PlanSynchro {
  const plan: PlanSynchro = { creer: [], modifier: [], deplacer: [], inchangees: 0, disparues: [] };
  const parCle = new Map(existantes.map((e) => [e.cle, e]));
  const clesNouvelles = new Set(nouvelles.map((n) => n.cle));
  const utilisees = new Set<string>();

  // Devis encore sans commande, qui ne sont plus dans le classeur sous leur clé : candidats « devenu commande ».
  const devisOrphelins = new Map<string, LigneExistante>();
  for (const e of existantes)
    if (e.genre === "DEVIS" && !clesNouvelles.has(e.cle) && e.numero_offre) devisOrphelins.set(e.numero_offre, e);

  for (const n of nouvelles) {
    const e = parCle.get(n.cle);
    if (e) {
      utilisees.add(e.id);
      if (e.disparue) plan.modifier.push({ id: e.id, ancienne_cle: e.cle, ligne: n, raison: "REAPPARUE" });
      else if (e.empreinte !== n.empreinte) plan.modifier.push({ id: e.id, ancienne_cle: e.cle, ligne: n, raison: "CHANGEE" });
      else {
        plan.inchangees++;
        if (e.ligne_excel !== n.ligne_excel) plan.deplacer.push({ id: e.id, ligne_excel: n.ligne_excel });
      }
      continue;
    }
    const o = (n.genre === "BASE" || n.genre === "AVENANT") && n.numero_offre ? devisOrphelins.get(n.numero_offre) : undefined;
    if (o && !utilisees.has(o.id)) {
      utilisees.add(o.id);
      devisOrphelins.delete(n.numero_offre!);
      plan.modifier.push({ id: o.id, ancienne_cle: o.cle, ligne: n, raison: "DEVIS_DEVENU_COMMANDE" });
      continue;
    }
    plan.creer.push(n);
  }
  for (const e of existantes)
    if (!utilisees.has(e.id) && !e.disparue) plan.disparues.push({ id: e.id, cle: e.cle });
  return plan;
}

/* ---------------------------------------------------------------
   Préparation des écritures (sans base de données : testable)
   --------------------------------------------------------------- */
export type ClientExistant = { id: string; numero_client: number | null; nom_abrege: string };

/** Associe chaque client du classeur à une fiche existante (par N° client, sinon par nom) ou à une nouvelle. */
export function preparerClients(
  clients: ClientSuivi[],
  existants: ClientExistant[],
  maintenant: string,
  nouvelId: () => string,
): { lignes: { id: string; numero_client: number | null; nom_abrege: string; derniere_vue_le: string }[]; ids: Map<string, string> } {
  const parNumero = new Map<number, ClientExistant>();
  const parNom = new Map<string, ClientExistant>();
  for (const e of existants) {
    if (e.numero_client !== null) parNumero.set(e.numero_client, e);
    else parNom.set(sansAccent(e.nom_abrege), e);
  }
  const ids = new Map<string, string>();
  const lignes: { id: string; numero_client: number | null; nom_abrege: string; derniere_vue_le: string }[] = [];
  for (const c of clients) {
    const e = c.numero_client !== null ? parNumero.get(c.numero_client) : parNom.get(sansAccent(c.nom_abrege));
    const id = e?.id ?? nouvelId();
    ids.set(c.cle, id);
    lignes.push({ id, numero_client: c.numero_client, nom_abrege: c.nom_abrege, derniere_vue_le: maintenant });
  }
  return { lignes, ids };
}

export type LigneExistanteComplete = LigneExistante & { premiere_vue_le: string | null; modifiee_le: string | null };

/** Lignes et montants à enregistrer (upsert par id) + lignes à marquer « disparue ». */
export function preparerEcritures(
  lignes: LigneSuivi[],
  plan: PlanSynchro,
  existantes: LigneExistanteComplete[],
  clientIds: Map<string, string>,
  synchroId: string,
  maintenant: string,
  nouvelId: () => string,
) {
  const parCle = new Map(existantes.map((e) => [e.cle, e]));
  const parId = new Map(existantes.map((e) => [e.id, e]));
  const modifiees = new Map(plan.modifier.map((m) => [m.ligne.cle, m.id]));
  const lignesBd: Record<string, unknown>[] = [];
  const montantsBd: Record<string, unknown>[] = [];

  for (const l of lignes) {
    const idModif = modifiees.get(l.cle);
    const existante = idModif ? parId.get(idModif) : parCle.get(l.cle);
    const id = existante?.id ?? nouvelId();
    const change = !existante || idModif !== undefined;
    lignesBd.push({
      id, cle: l.cle,
      numero_devis: l.numero_devis, numero_affaire: l.numero_affaire, numero_offre: l.numero_offre,
      base_devis: l.base_devis, base_affaire: l.base_affaire, genre: l.genre,
      rang_avenant: l.rang_avenant, rang_lot: l.rang_lot, rang_echeance: l.rang_echeance, parent_cle: l.parent_cle,
      statut: l.statut, imputation: l.imputation, designation: l.designation,
      client_id: l.client_cle ? clientIds.get(l.client_cle) ?? null : null,
      redacteur: l.redacteur, redacteur_id: l.redacteur_id, livre_par: l.livre_par, livre_par_id: l.livre_par_id,
      format_livraison: l.format_livraison, numero_arc_louxor: l.numero_arc_louxor, activites_excel: l.activites_excel,
      date_ouverture: l.date_ouverture, date_envoi: l.date_envoi, date_reception_commande: l.date_reception_commande,
      date_livraison_estimee: l.date_livraison_estimee, delai: l.delai, date_livraison: l.date_livraison,
      heures_meca: l.heures_meca, heures_calcul: l.heures_calcul, heures_elec: l.heures_elec,
      heures_pneu: l.heures_pneu, heures_scan: l.heures_scan, heures_autre: l.heures_autre, heures_total: l.heures_total,
      ligne_excel: l.ligne_excel, empreinte: l.empreinte, anomalies: l.anomalies,
      premiere_vue_le: existante?.premiere_vue_le ?? maintenant,
      derniere_vue_le: maintenant,
      modifiee_le: change ? maintenant : existante?.modifiee_le ?? maintenant,
      disparue: false, disparue_le: null, derniere_synchro_id: synchroId,
    });
    montantsBd.push({ ligne_id: id, ...l.montants });
  }
  return { lignes: lignesBd, montants: montantsBd, disparues: plan.disparues.map((d) => d.id) };
}
