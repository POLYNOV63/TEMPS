/* ===============================================================
   LECTURE DU CLASSEUR « SUIVI DES PRESTATIONS » (historique)

   Le classeur a un onglet par mois (« septembre 2024 », « Janvier 2026 »…).
   Chaque onglet :
   - ligne 1 : en-têtes (leur ordre a changé dans le temps, on les repère
     par leur intitulé : Nom Client, Nom, Activité, Tx Jour, Taux Horaire,
     Heure contrat, Total Heures, Equiv Jours, HS à refacturer, Montant 125 %,
     Méca, Calcul, Elec) ;
   - des blocs repérés par les titres de la colonne A : prestations externes
     (PE, par défaut), « PRESTATION INTERNE AU BE » (PI), « PRESTATION EN
     INTERGROUPE » (IG), chacun en « TARIF JOURNALIER » / « TARIF HORAIRE » ;
   - une ligne par prestation facturée : colonne A = CAS (ancienne
     désignation) ou CBE, colonne B = numéro.
   Montant facturé de la ligne = Méca + Calcul + Elec (selon l'activité) ;
   il comprend déjà les heures sup à 125 % (colonne « Montant 125 % »,
   gardée à part pour information).

   Reclassements connus (RECLASSEMENTS) : une ligne posée dans le mauvais
   bloc est rangée dans sa vraie catégorie, et sortie du contrôle des
   totaux de son onglet. Ex. CBE1487 : intergroupe, mais saisie dans les PI
   (hors de la formule de total) de février à mai 2025, avant que le bloc
   IG n'existe.

   Fonction pure : reçoit les onglets sous forme de tableaux de lignes.
================================================================ */

export type CategorieHisto = "PE" | "PI" | "IG";

/* « TYPE+NUMERO » (numéro de base) -> catégorie imposée */
export const RECLASSEMENTS: Record<string, CategorieHisto> = {
  CBE1487: "IG",
};

export type LigneHisto = {
  mois: string; // AAAA-MM-01
  feuille: string;
  ligne_excel: number;
  categorie: CategorieHisto;
  unite: "JOUR" | "HEURE";
  type: string; // CAS / CBE
  numero: string; // 652, 1604R2…
  client: string | null;
  personne: string | null;
  activite: string | null;
  taux_jour: number | null;
  taux_horaire: number | null;
  base_horaire: number | null;
  heures: number;
  equiv_jours: number | null;
  hs_heures: number;
  hs_montant: number;
  montant_meca: number;
  montant_calcul: number;
  montant_elec: number;
  montant: number; // total facturé de la ligne = Méca + Calcul + Elec (heures sup comprises)
  reclassee: boolean; // rangée d'office dans une autre catégorie que son bloc
  jours: (number | string | null)[]; // heures (ou code CP, ML…) du 1er au dernier jour du mois
};

export type ResultatHisto = {
  lignes: LigneHisto[];
  mois: string[];
  ignores: string[]; // onglets non reconnus
  controles: { feuille: string; lignes: number; total: number; totalFeuille: number | null; ecart: number | null; reclasse: number }[];
};

const MOIS: Record<string, number> = {
  janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12,
};

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function moisDeFeuille(nom: string): string | null {
  const m = nom.trim().toLowerCase().match(/^([a-zéûè]+)\s+(\d{4})$/);
  if (!m || !MOIS[m[1]]) return null;
  return `${m[2]}-${String(MOIS[m[1]]).padStart(2, "0")}-01`;
}

/* Colonnes d'après les en-têtes de la ligne 1 */
function colonnes(entete: unknown[]) {
  const c: Record<string, number> = {};
  entete.forEach((v, i) => {
    const t = norm(v);
    if (!t) return;
    if (t.startsWith("nom client")) c.client = i;
    else if (t === "nom" || t.startsWith("nom collab")) c.personne = i;
    else if (t.startsWith("activite")) c.activite = i;
    else if (t.startsWith("tx jour")) c.tauxJour = i;
    else if (t.startsWith("taux horaire")) c.tauxHoraire = i;
    else if (t.startsWith("heure contrat")) c.base = i;
    else if (t.startsWith("total heures")) c.heures = i;
    else if (t.startsWith("equiv")) c.equiv = i;
    else if (t.startsWith("hs a refacturer")) c.hs = i;
    else if (t.startsWith("montant 125")) c.hsMontant = i;
    else if (t === "meca" && c.meca === undefined) c.meca = i;
    else if (t === "calcul" && c.calcul === undefined) c.calcul = i;
    else if (t === "elec" && c.elec === undefined) c.elec = i;
  });
  return c;
}

export function lireSuiviPrestations(feuilles: Record<string, unknown[][]>): ResultatHisto {
  const lignes: LigneHisto[] = [];
  const ignores: string[] = [];
  const controles: ResultatHisto["controles"] = [];

  for (const [nom, rows] of Object.entries(feuilles)) {
    const mois = moisDeFeuille(nom);
    if (!mois) {
      ignores.push(nom);
      continue;
    }
    const iEntete = rows.findIndex((r) => norm(r?.[0]) === "n°" || norm(r?.[0]) === "no" || norm(r?.[0]) === "n");
    if (iEntete < 0) {
      ignores.push(nom);
      continue;
    }
    const c = colonnes(rows[iEntete]);
    if (c.meca === undefined || c.heures === undefined) {
      ignores.push(nom);
      continue;
    }

    // colonne du 1er jour : un « 1 » suivi d'un « 2 » dans les premières lignes, après les montants
    const apresMontants = Math.max(c.meca ?? 0, c.calcul ?? 0, c.elec ?? 0) + 1;
    let colJour1 = -1;
    for (let i = 0; i <= Math.min(4, rows.length - 1) && colJour1 < 0; i++) {
      const r = rows[i] ?? [];
      for (let k = apresMontants; k < r.length - 1; k++) {
        if (nombre(r[k]) === 1 && nombre(r[k + 1]) === 2) {
          colJour1 = k;
          break;
        }
      }
    }
    const [anneeMois, numMois] = [Number(mois.slice(0, 4)), Number(mois.slice(5, 7))];
    const nbJours = new Date(Date.UTC(anneeMois, numMois, 0)).getUTCDate();

    let categorie: CategorieHisto = "PE";
    let unite: "JOUR" | "HEURE" = "JOUR";
    let totalLignes = 0;
    let totalFeuille = 0;
    let totauxTrouves = false;
    let nb = 0;
    let reclasse = 0;
    const v = (r: unknown[], k: string) => (c[k] === undefined ? null : nombre(r[c[k]]));
    const t = (r: unknown[], k: string) => {
      if (c[k] === undefined) return null;
      const x = r[c[k]];
      return x === null || x === undefined || String(x).trim() === "" ? null : String(x).trim();
    };

    for (let i = iEntete + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const a = norm(r[0]);

      // titres de blocs
      if (a && a !== "cas" && a !== "cbe") {
        if (a.includes("intergroupe")) categorie = "IG";
        else if (a.includes("interne")) categorie = "PI";
        else if (a.includes("externe")) categorie = "PE";
        if (a.includes("horaire")) unite = "HEURE";
        else if (a.includes("journalier")) unite = "JOUR";
        continue;
      }

      // ligne de totaux d'un bloc (colonne A vide, montants renseignés)
      if (!a) {
        const s = (v(r, "meca") ?? 0) + (v(r, "calcul") ?? 0) + (v(r, "elec") ?? 0);
        if (s !== 0 && !r[1]) {
          totalFeuille += s;
          totauxTrouves = true;
        }
        continue;
      }

      // ligne de prestation
      const numero = String(r[1] ?? "").trim();
      if (!numero) continue;
      const meca = v(r, "meca") ?? 0;
      const calcul = v(r, "calcul") ?? 0;
      const elec = v(r, "elec") ?? 0;
      const hsMontant = v(r, "hsMontant") ?? 0;
      const heures = v(r, "heures") ?? 0;
      if (meca + calcul + elec + hsMontant === 0 && heures === 0) continue;

      const tauxJour = v(r, "tauxJour");
      const base = v(r, "base");
      let tauxHoraire = v(r, "tauxHoraire");
      if (tauxHoraire === null && tauxJour !== null && base) tauxHoraire = tauxJour / base;

      const numeroPropre = numero.replace(/\.0+$/, "");
      const impose = RECLASSEMENTS[`${a.toUpperCase()}${numeroPropre.match(/^\d+/)?.[0] ?? numeroPropre}`];
      const reclassee = Boolean(impose && impose !== categorie);

      lignes.push({
        mois,
        feuille: nom,
        ligne_excel: i + 1,
        categorie: impose ?? categorie,
        unite,
        type: a.toUpperCase(),
        numero: numero.replace(/\.0+$/, ""),
        client: t(r, "client"),
        personne: t(r, "personne"),
        activite: t(r, "activite"),
        taux_jour: tauxJour,
        taux_horaire: tauxHoraire,
        base_horaire: base,
        heures,
        equiv_jours: v(r, "equiv"),
        hs_heures: v(r, "hs") ?? 0,
        hs_montant: hsMontant,
        montant_meca: meca,
        montant_calcul: calcul,
        montant_elec: elec,
        montant: meca + calcul + elec,
        reclassee,
        jours: Array.from({ length: nbJours }, (_, j) => {
          if (colJour1 < 0) return null;
          const v = r[colJour1 + j];
          if (v === null || v === undefined || String(v).trim() === "") return null;
          const n = nombre(v);
          if (n !== null) return n === 0 ? null : n;
          const code = String(v).trim().toUpperCase();
          return code.startsWith("#") ? null : code.slice(0, 6);
        }),
      });
      // une ligne rangée d'office ailleurs n'est pas dans les totaux de son bloc
      if (reclassee) reclasse += meca + calcul + elec;
      else totalLignes += meca + calcul + elec;
      nb++;
    }

    controles.push({
      feuille: nom,
      lignes: nb,
      total: Math.round(totalLignes * 100) / 100,
      totalFeuille: totauxTrouves ? Math.round(totalFeuille * 100) / 100 : null,
      ecart: totauxTrouves ? Math.round((totalLignes - totalFeuille) * 100) / 100 : null,
      reclasse: Math.round(reclasse * 100) / 100,
    });
  }

  const mois = [...new Set(lignes.map((l) => l.mois))].sort();
  return { lignes, mois, ignores, controles };
}
