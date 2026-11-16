/* ===============================================================
   HEURES DE TRAJET (TRAJETS_A_PART) - décision de PLG du 16/11/2026
   Les trajets se pointent SUR L'AFFAIRE, avec le code HT : c'est un vrai
   coût de l'affaire, utile pour chiffrer les suivantes. Mais ce n'est pas
   de l'étude :
   - Fiche affaire, Fiabilité du chiffrage : hors comparaison au chiffré
     (affichés à part, « dont trajets ») ;
   - Rentabilité, onglet Financier : comptés dans la marge, sur une ligne
     à part ;
   - Analyse de capacité, heures sup, compteur, paie : rien ne change.
   Pour ajouter un code de trajet, l'ajouter à CODES_TRAJET.
================================================================ */

export const CODES_TRAJET = ["HT"];

export function estTrajet(code: string | null | undefined): boolean {
  return CODES_TRAJET.includes(String(code ?? "").trim().toUpperCase());
}
