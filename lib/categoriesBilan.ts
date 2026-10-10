/* ===============================================================
   CATEGORIES DE BILAN ET CONSOLIDATION PERSONNELLE ("Mon bilan")

   Mêmes définitions que la page Bilans de l'équipe :
     - CBE        : heures imputées sur une affaire CBE (vendu)
     - DBE        : heures imputées sur une affaire DBE (devis / chiffrage)
     - CN         : commercial
     - PRODUCTION : "Divers de production" (ligne Divers + code de production)
     - NI         : non imputable (pas de charge)
     - FORMATION  : formation (FI interne, FO externe)
     - ABSENCE    : absences et congés (déjà déduits de la capacité)
     - IGNORE     : hors bilan (fériés...)
     - AUTRES     : heures non classées

   La catégorie d'un code dans Gestion des codes fait foi.
   Capacité NETTE = 35 h moins congés, fériés et absences (historique), ou
   total_theorique de la feuille (nouveau système).

   Fichier sans dépendance : utilisable aussi bien dans la page que dans
   des tests.
=============================================================== */

export type CategorieBilan =
  | "CBE"
  | "DBE"
  | "CN"
  | "PRODUCTION"
  | "NI"
  | "FORMATION"
  | "ABSENCE"
  | "IGNORE"
  | "AUTRES";

export type Totaux = Record<CategorieBilan, number>;

export type CodeRef = {
  code: string;
  libelle: string | null;
  categorie: string | null;
};

export type LigneHistorique = {
  annee: number;
  semaine: number;
  affaire_code: string | null;
  code_imputation: string | null;
  heures: number | string | null;
  groupe_code?: string | null;
};

export type FeuilleNouvelle = {
  id: string;
  semaine_debut: string;
  total_theorique: number | string | null;
};

export type JourNouveau = {
  id: string;
  feuille_id: string;
};

export type ImputationNouvelle = {
  jour_id: string;
  type_affaire: string | null;
  numero_affaire: string | null;
  code: string | null;
  heures: number | string | null;
};

export type SemaineBilan = {
  cle: string;
  lundi: string;
  source: "HISTORIQUE" | "NOUVEAU";
  capacite: number;
  cat: Totaux;
  nonExplique: number;
};

export type AffaireBilan = {
  libelle: string;
  type: "CBE" | "DBE";
  heures: number;
};

export type ResultatBilan = {
  semaines: SemaineBilan[];
  total: Totaux;
  capacite: number;
  nonExplique: number;
  affaires: AffaireBilan[];
  formationParCode: Record<string, number>;
};

const CODES_ABSENCE_LEGACY = ["RE", "ML", "VM", "AA", "AT", "AI", "RTT", "ABS", "ABSENCE"];
const CODES_HORS_BILAN_LEGACY = ["FE", "CP", "AC", "AP"];

export const CAPACITE_LEGALE = 35;

export function normaliserTexte(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function nombre(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function totauxVides(): Totaux {
  return {
    CBE: 0,
    DBE: 0,
    CN: 0,
    PRODUCTION: 0,
    NI: 0,
    FORMATION: 0,
    ABSENCE: 0,
    IGNORE: 0,
    AUTRES: 0,
  };
}

/* ---------------------------------------------------------------
   CLASSEMENT
--------------------------------------------------------------- */

export function categorieDuCode(
  code: string,
  codes: Map<string, CodeRef>
): CategorieBilan | null {
  const c = normaliserTexte(code);
  const reference = codes.get(c);
  const categorie = reference?.categorie ? normaliserTexte(reference.categorie) : null;

  if (categorie === "NI") return "NI";
  if (categorie === "COMMERCIAL") return "CN";
  if (categorie === "FORMATION") return "FORMATION";
  if (categorie === "ABSENCE") return "ABSENCE";
  if (categorie === "HORS_BILAN") return "IGNORE";
  if (categorie === "PRODUCTION") return "PRODUCTION";

  // Anciens codes absents du référentiel
  if (CODES_ABSENCE_LEGACY.includes(c)) return "ABSENCE";
  if (CODES_HORS_BILAN_LEGACY.includes(c)) return "IGNORE";
  if (c === "NI") return "NI";
  if (c === "CN") return "CN";

  return null;
}

export function estLigneDivers(affaire: string | null): boolean {
  const a = normaliserTexte(affaire);

  return (
    a === "DIVERS" ||
    a.startsWith("DIVERS ") ||
    a.startsWith("DIVERS-") ||
    a.startsWith("DIVERS:")
  );
}

export function typeAffaireHistorique(affaire: string | null): "CBE" | "DBE" | null {
  const a = normaliserTexte(affaire);

  if (!a) return null;

  if (/\bDBE\s*[-:]?\s*\d+\b/.test(a) || /^DBE\d+$/.test(a)) return "DBE";
  if (/\b(?:CBE|CAS)\s*[-:]?\s*\d+\b/.test(a) || /^(?:CBE|CAS)\d+$/.test(a)) return "CBE";

  return null;
}

export function numeroAffaireHistorique(affaire: string | null): string {
  return String(affaire ?? "")
    .trim()
    .replace(/^(?:CBE|CAS|DBE)\s*[-:]?\s*/i, "")
    .trim();
}

/* Ligne de l'historique importé (ancien système) */
export function classerLigneHistorique(
  ligne: LigneHistorique,
  codes: Map<string, CodeRef>
): CategorieBilan {
  const code = normaliserTexte(ligne.code_imputation);
  const categorie = categorieDuCode(code, codes);

  // Les absences sont reconnues par leur code, avant tout autre classement.
  if (categorie === "ABSENCE") return "ABSENCE";

  const type = typeAffaireHistorique(ligne.affaire_code);
  if (type) return type;

  if (categorie) return categorie;

  // Ligne Divers avec un code inconnu : le bloc du classeur Excel décide.
  if (estLigneDivers(ligne.affaire_code)) {
    return String(ligne.groupe_code ?? "").toUpperCase() === "ADMIN" ? "AUTRES" : "PRODUCTION";
  }

  return "AUTRES";
}

/* Ligne d'une feuille du nouveau système */
export function classerLigneNouvelle(
  imputation: ImputationNouvelle,
  codes: Map<string, CodeRef>
): CategorieBilan {
  const code = normaliserTexte(imputation.code);
  const type = normaliserTexte(imputation.type_affaire);
  const numero = String(imputation.numero_affaire ?? "").trim();

  if (type === "CBE" || /^CBE/i.test(numero)) return "CBE";
  if (type === "DBE" || /^DBE/i.test(numero)) return "DBE";

  const categorie = categorieDuCode(code, codes);

  // Divers de production : production ou code encore inconnu.
  return categorie ?? "PRODUCTION";
}

/* ---------------------------------------------------------------
   DATES
--------------------------------------------------------------- */

function formaterJourUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

/* Lundi (AAAA-MM-JJ) d'une semaine ISO */
export function lundiDeSemaineIso(annee: number, semaine: number): string {
  const d = new Date(Date.UTC(annee, 0, 4));
  const jour = d.getUTCDay() || 7;

  d.setUTCDate(d.getUTCDate() - jour + 1 + (semaine - 1) * 7);

  return formaterJourUtc(d);
}

/* ---------------------------------------------------------------
   CONSOLIDATION
--------------------------------------------------------------- */

export function consoliderMonBilan(options: {
  historique: LigneHistorique[];
  feuilles: FeuilleNouvelle[];
  jours: JourNouveau[];
  imputations: ImputationNouvelle[];
  codes: Map<string, CodeRef>;
  debut: string; // inclus  (lundi de la semaine >= debut)
  fin: string; // exclu    (lundi de la semaine < fin)
}): ResultatBilan {
  const { historique, feuilles, jours, imputations, codes, debut, fin } = options;

  const semaines = new Map<string, SemaineBilan>();
  const affaires = new Map<string, AffaireBilan>();
  const formationParCode: Record<string, number> = {};

  const dansPlage = (lundi: string) => lundi >= debut && lundi < fin;

  const noter = (
    semaine: SemaineBilan,
    categorie: CategorieBilan,
    heures: number,
    code: string,
    affaire?: { type: "CBE" | "DBE"; numero: string }
  ) => {
    semaine.cat[categorie] += heures;

    if (categorie === "FORMATION" && code) {
      formationParCode[code] = (formationParCode[code] ?? 0) + heures;
    }

    if (affaire && affaire.numero) {
      const libelle = `${affaire.type} ${affaire.numero}`;
      const existante = affaires.get(libelle) ?? { libelle, type: affaire.type, heures: 0 };

      existante.heures += heures;
      affaires.set(libelle, existante);
    }
  };

  /* --- nouveau système : c'est la référence pour les semaines qu'il couvre --- */

  const lundisNouveaux = new Set<string>();
  const feuillesRetenues = feuilles.filter((f) => dansPlage(f.semaine_debut));

  feuillesRetenues.forEach((feuille) => {
    lundisNouveaux.add(feuille.semaine_debut);

    const cle = `N-${feuille.semaine_debut}`;
    const semaine =
      semaines.get(cle) ??
      ({
        cle,
        lundi: feuille.semaine_debut,
        source: "NOUVEAU",
        capacite: 0,
        cat: totauxVides(),
        nonExplique: 0,
      } as SemaineBilan);

    semaine.capacite += nombre(feuille.total_theorique);
    semaines.set(cle, semaine);
  });

  const feuilleParJour = new Map<string, string>();
  jours.forEach((jour) => feuilleParJour.set(jour.id, jour.feuille_id));

  const feuilleParId = new Map(feuillesRetenues.map((f) => [f.id, f]));

  imputations.forEach((imputation) => {
    const feuille = feuilleParId.get(feuilleParJour.get(imputation.jour_id) ?? "");
    if (!feuille) return;

    const heures = nombre(imputation.heures);
    if (heures <= 0) return;

    const semaine = semaines.get(`N-${feuille.semaine_debut}`);
    if (!semaine) return;

    const categorie = classerLigneNouvelle(imputation, codes);
    const type = categorie === "CBE" || categorie === "DBE" ? categorie : null;

    noter(
      semaine,
      categorie,
      heures,
      normaliserTexte(imputation.code),
      type ? { type, numero: String(imputation.numero_affaire ?? "").trim() } : undefined
    );
  });

  /* --- historique : uniquement les semaines absentes du nouveau système --- */

  historique.forEach((ligne) => {
    const lundi = lundiDeSemaineIso(ligne.annee, ligne.semaine);

    if (!dansPlage(lundi) || lundisNouveaux.has(lundi)) return;

    const heures = nombre(ligne.heures);
    if (heures <= 0) return;

    const cle = `H-${lundi}`;
    const semaine =
      semaines.get(cle) ??
      ({
        cle,
        lundi,
        source: "HISTORIQUE",
        capacite: CAPACITE_LEGALE,
        cat: totauxVides(),
        nonExplique: 0,
      } as SemaineBilan);

    semaines.set(cle, semaine);

    const categorie = classerLigneHistorique(ligne, codes);
    const type = categorie === "CBE" || categorie === "DBE" ? categorie : null;

    noter(
      semaine,
      categorie,
      heures,
      normaliserTexte(ligne.code_imputation),
      type
        ? { type, numero: numeroAffaireHistorique(ligne.affaire_code) }
        : undefined
    );
  });

  /* --- capacité nette et non expliqué --- */

  const liste = Array.from(semaines.values()).sort((a, b) => a.lundi.localeCompare(b.lundi));

  const total = totauxVides();
  let capacite = 0;
  let nonExplique = 0;

  liste.forEach((semaine) => {
    if (semaine.source === "HISTORIQUE") {
      semaine.capacite = Math.max(
        0,
        semaine.capacite - semaine.cat.ABSENCE - semaine.cat.IGNORE
      );
    }

    const travaille =
      semaine.cat.CBE +
      semaine.cat.DBE +
      semaine.cat.CN +
      semaine.cat.PRODUCTION +
      semaine.cat.NI +
      semaine.cat.FORMATION +
      semaine.cat.AUTRES;

    semaine.nonExplique = Math.max(0, semaine.capacite - travaille);

    (Object.keys(total) as CategorieBilan[]).forEach((categorie) => {
      total[categorie] += semaine.cat[categorie];
    });

    capacite += semaine.capacite;
    nonExplique += semaine.nonExplique;
  });

  return {
    semaines: liste,
    total,
    capacite,
    nonExplique,
    affaires: Array.from(affaires.values()).sort((a, b) => b.heures - a.heures),
    formationParCode,
  };
}
