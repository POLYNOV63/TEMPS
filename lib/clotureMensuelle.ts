/* ===============================================================
   CLÔTURE MENSUELLE RH (BILAN_RH_RAPPEL)

   Mêmes règles que Ma semaine et le Bilan RH mensuel : le mois se
   clôt le vendredi de sa dernière semaine (dernier jour du mois un
   lundi-jeudi : le vendredi suivant ; un vendredi : le jour même ;
   un samedi ou un dimanche : le vendredi précédent).
================================================================ */

export type PeriodeRH = {
  annee: number;
  moisZeroBase: number;
  cle: string; // « 2026-11 »
  libelle: string; // « novembre 2026 »
  dateCloture: string; // vendredi de clôture
  semaineCloture: string; // lundi de la semaine de clôture
};

export function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function debutSemaineISO(jour: string) {
  const [a, m, j] = jour.split("-").map(Number);
  const d = new Date(a, m - 1, j);
  const js = d.getDay();
  d.setDate(d.getDate() + (js === 0 ? -6 : 1 - js));
  return isoLocal(d);
}

export function dateClotureMensuelle(annee: number, moisZeroBase: number) {
  const dernier = new Date(annee, moisZeroBase + 1, 0);
  const js = dernier.getDay();
  const v = new Date(dernier);
  if (js >= 1 && js <= 4) v.setDate(dernier.getDate() + (5 - js));
  else if (js === 6) v.setDate(dernier.getDate() - 1);
  else if (js === 0) v.setDate(dernier.getDate() - 2);
  return isoLocal(v);
}

export function periodeRH(annee: number, moisZeroBase: number): PeriodeRH {
  const d = new Date(annee, moisZeroBase, 1);
  const dateCloture = dateClotureMensuelle(d.getFullYear(), d.getMonth());
  return {
    annee: d.getFullYear(),
    moisZeroBase: d.getMonth(),
    cle: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    libelle: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    dateCloture,
    semaineCloture: debutSemaineISO(dateCloture),
  };
}

/* le mois dont la clôture est la prochaine (ou aujourd'hui), et le précédent */
export function periodesAutour(aujourdhui = isoLocal(new Date())) {
  const [a, m] = aujourdhui.split("-").map(Number);
  // le mois précédent n'est peut-être pas encore clôturé (ex. 30 novembre un lundi : clôture le vendredi 4 décembre)
  let courante = periodeRH(a, m - 2);
  while (aujourdhui > courante.dateCloture) courante = periodeRH(courante.annee, courante.moisZeroBase + 1);
  const precedente = periodeRH(courante.annee, courante.moisZeroBase - 1);
  return { courante, precedente };
}

/* Rappel d'envoi du bilan RH : le mois précédent pas encore envoyé (dans les 45 jours après sa clôture),
   sinon le mois courant dès le lundi de sa semaine de clôture */
export function rappelBilanRH(envoyes: Set<string>, aujourdhui = isoLocal(new Date())) {
  const { courante, precedente } = periodesAutour(aujourdhui);
  const limite = new Date(`${precedente.dateCloture}T00:00:00`);
  limite.setDate(limite.getDate() + 45);
  if (!envoyes.has(precedente.cle) && aujourdhui <= isoLocal(limite)) return { periode: precedente, enRetard: true };
  if (!envoyes.has(courante.cle) && aujourdhui >= courante.semaineCloture) return { periode: courante, enRetard: aujourdhui > courante.dateCloture };
  return null;
}
