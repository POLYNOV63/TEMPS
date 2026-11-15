/* ===============================================================
   COULEURS COMMUNES DE L'APPLICATION (COULEURS_COMMUNES)

   Une couleur = un sens, la même sur toutes les pages. Pour changer une
   couleur, on la change ICI : toutes les pages suivent.

   - Métiers (activités) : Méca rouge, Elec bleu ardoise, Calcul violet,
     Scan orange, Négoce marron. Le violet est RÉSERVÉ au Calcul.
   - Prestations : PE bleu marine, PI bleu ciel (des bleus : ce sont des
     prestations ; jamais de violet, jamais de vert, qui sert déjà à
     « entièrement planifié » dans le planning).
   - Type de travail (bilans) : commandes CBE rouge, devis DBE rose, CN vert
     foncé, divers de production gris, formation bleu, autres ambre,
     NI gris foncé, non expliqué gris clair ; absences turquoise.
================================================================ */

/* ---------------- Métiers (activités) ---------------- */

export const COULEURS_METIERS = {
  meca: "#c00000",
  elec: "#34506b",
  calcul: "#6b58a8",
  scan: "#e08a1e",
  negoce: "#8d6e63",
  autre: "#9aa0a6", // autre / non ventilé
} as const;

export type Metier = keyof typeof COULEURS_METIERS;

const sansAccents = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();

/* reconnaît un métier d'après son nom ou son code (« Méca », « Mécanique », « Elec / Pneu », « ELEC »…) */
export function metierDe(nom: string | null | undefined): Metier | null {
  const n = sansAccents(nom ?? "");
  if (/^meca/.test(n)) return "meca";
  if (/^elec|electri|pneu/.test(n)) return "elec";
  if (/^calcul/.test(n)) return "calcul";
  if (/^scan/.test(n)) return "scan";
  if (/^negoce/.test(n)) return "negoce";
  return null;
}

/* la couleur d'un métier d'après son nom ; un nom inconnu reçoit `defaut` (gris) */
export function couleurMetier(nom: string | null | undefined, defaut: string = COULEURS_METIERS.autre): string {
  const m = metierDe(nom);
  return m ? COULEURS_METIERS[m] : defaut;
}

/* ---------------- Prestations PE / PI ---------------- */

export const COULEURS_PE = {
  fond: "#1f4e99", // barre pleine, pastille
  bord: "#163a73",
  sombre: "#0f2a57", // réalisé (semaines passées)
  pale: "#e9eff9", // fond de barre (enveloppe)
  rempli: "#bdcdea", // partie planifiée
  consomme: "#8ba5d8", // partie déjà pointée
} as const;

export const COULEURS_PI = {
  fond: "#1d7aa3",
  bord: "#155b7a",
  sombre: "#0d4058",
  pale: "#e6f3f8",
  rempli: "#b5dcec",
  consomme: "#7cbdd9",
} as const;

/* ---------------- Type de travail (bilans) ---------------- */

export const COULEURS_TRAVAIL = {
  CBE: "#c00000", // commandes
  DBE: "#f2bfd0", // devis : surfaces (barres, cases)
  DBE_TRAIT: "#c2477a", // devis : traits, points, liserés (le même rose, plus soutenu)
  CN: "#2e7d32", // commercial
  PRODUCTION: "#8a939c", // divers de production
  FORMATION: "#3f8fc6",
  AUTRES: "#d59b2a",
  NI: "#414040", // non imputable
  NON_EXPLIQUE: "#e3e5e8",
  ABSENCE: "#1f9d8b",
} as const;
