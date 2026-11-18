/* ===============================================================
   HEURES DE TRAJET (TRAJETS_PARTOUT) - décision de PLG du 18/11/2026
   Les trajets se pointent SUR L'AFFAIRE, avec le code HT, et comptent
   PARTOUT comme les autres heures : fiche affaire, Fiabilité du chiffrage,
   Suivi des affaires, Rentabilité (dans les heures passées de l'activité),
   Analyse de capacité, heures sup, compteur, paie.
   Seule exception : l'onglet Financier de la fiche affaire a une coche
   « Compter les trajets » (cochée au départ) pour voir la marge sans eux.
   (Remplace TRAJETS_A_PART du 16/11/2026, qui les mettait à part.)
   Pour ajouter un code de trajet, l'ajouter à CODES_TRAJET.
================================================================ */

export const CODES_TRAJET = ["HT"];

export function estTrajet(code: string | null | undefined): boolean {
  return CODES_TRAJET.includes(String(code ?? "").trim().toUpperCase());
}
