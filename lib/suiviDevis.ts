/* ===============================================================
   POLYNOV - SUIVI DES DEVIS (SUIVI_DEVIS)

   Calculs purs de la page Suivi des devis (aucune requête ici), à
   partir de la copie du classeur « Suivi d'affaire BE ».

   - Un DEVIS = un n° de devis (DBE…) : ses lignes DEVIS, BASE ou AVENANT
     sont réunies (lots et échéances exclus). La ligne qui dit le mieux ce
     qu'il est devenu : la commande (base, puis avenant), sinon le devis.
   - Sa catégorie vient du statut du classeur :
       Devis ouvert            -> OUVERT (en rédaction)
       Devis envoyé            -> ENVOYE (en attente de réponse)
       Intention de commande   -> INTENTION
       Commande reçue, Livrée,
       Commande annulée        -> REMPORTE
       Devis perdu             -> PERDU, ou FERME (« fermé sans devis »)
                                  s'il n'a ni montant ni heures chiffrées
   - Un devis d'AVENANT est un devis comme un autre (même statuts, mêmes
     règles) ; on indique seulement l'affaire mère (« avenant de CBE1604 »).
   - À RELANCER : envoyé, sans réponse, et plus de 30 jours depuis l'envoi
     ET depuis la dernière relance notée. Noter une relance le sort de la
     liste pour 30 jours ; il y revient s'il n'a toujours pas de réponse.
================================================================ */

export const DELAI_RELANCE = 30; // jours

export type CategorieDevis = "OUVERT" | "ENVOYE" | "INTENTION" | "REMPORTE" | "PERDU" | "FERME" | "AUTRE";

export const LIBELLE_CATEGORIE: Record<CategorieDevis, string> = {
  OUVERT: "Ouvert",
  ENVOYE: "Envoyé",
  INTENTION: "Intention de commande",
  REMPORTE: "Remporté",
  PERDU: "Perdu",
  FERME: "Fermé sans devis",
  AUTRE: "Statut à vérifier",
};

export type LigneSuiviDevis = {
  id: string;
  genre: string;
  numero_devis: string | null;
  base_devis: string | null;
  numero_affaire: string | null;
  base_affaire: string | null;
  statut: string | null;
  designation: string | null;
  client_id: string | null;
  redacteur: string | null;
  redacteur_id: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  delai: string | null;
  heures_total: number | string | null;
  disparue: boolean;
};

export type Relance = {
  id: string;
  numero_devis: string;
  relance_le: string;
  commentaire: string | null;
  saisi_par: string | null;
  cree_le: string;
};

export type Devis = {
  numero: string; // « 2715 » pour DBE2715
  ligne: LigneSuiviDevis; // la ligne qui dit le mieux ce qu'est devenu le devis
  categorie: CategorieDevis;
  statut: string | null;
  ouverture: string | null;
  envoi: string | null;
  commande: string | null; // n° de commande une fois remporté (ou en intention) : « CBE1604 », « CBE1604R1 »
  avenantDe: string | null; // devis d'avenant : l'affaire mère, « CBE1604 »
  montant: number; // 0 si les montants ne sont pas visibles
  heures: number;
  relances: Relance[]; // la plus récente d'abord
  prochaineRelance: string | null; // date à laquelle il devient (ou est devenu) « à relancer »
  aRelancer: boolean;
};

/* « DBE02715 » -> « 2715 » */
export function numeroDevis(texte: string | null | undefined): string | null {
  const m = String(texte ?? "").replace(/^\D+/, "").match(/^\d+/);
  const n = m ? m[0].replace(/^0+/, "") : "";
  return n || null;
}

export function joursEntre(debut: string, fin: string): number {
  return Math.round((Date.parse(`${fin.slice(0, 10)}T00:00:00Z`) - Date.parse(`${debut.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

export function ajouterJours(jour: string, n: number): string {
  const d = new Date(`${jour.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* exercice de novembre à octobre : 2026 = du 01/11/2026 au 31/10/2027 */
export function debutExercice(jour: string): number {
  const a = Number(jour.slice(0, 4));
  return Number(jour.slice(5, 7)) >= 11 ? a : a - 1;
}

export function categorieDevis(statut: string | null, genre: string, montant: number, heures: number): CategorieDevis {
  switch (statut) {
    case "Devis ouvert":
      return "OUVERT";
    case "Devis envoyé":
      return "ENVOYE";
    case "Intention de commande":
      return "INTENTION";
    case "Devis perdu":
      return montant > 0 || heures > 0 ? "PERDU" : "FERME";
    case "Commande reçue":
    case "Livrée":
    case "Commande annulée":
      return "REMPORTE";
    default:
      return genre === "BASE" || genre === "AVENANT" ? "REMPORTE" : "AUTRE";
  }
}

export function construireDevis(
  lignes: LigneSuiviDevis[],
  montants: Map<string, number>,
  relances: Relance[],
  aujourdhui: string
): Devis[] {
  const parNumero = new Map<string, LigneSuiviDevis[]>();
  for (const l of lignes) {
    if (l.disparue || !(l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT")) continue;
    const num = numeroDevis(l.base_devis) ?? numeroDevis(l.numero_devis);
    if (!num) continue;
    const liste = parNumero.get(num);
    if (liste) liste.push(l);
    else parNumero.set(num, [l]);
  }

  const relancesPar = new Map<string, Relance[]>();
  for (const r of relances) {
    const liste = relancesPar.get(r.numero_devis);
    if (liste) liste.push(r);
    else relancesPar.set(r.numero_devis, [r]);
  }

  const resultat: Devis[] = [];
  for (const [numero, ls] of parNumero) {
    const commande = (g: string) => ls.find((x) => x.genre === g && x.statut !== "Devis perdu");
    const l = commande("BASE") ?? commande("AVENANT") ?? ls.find((x) => x.genre === "DEVIS") ?? ls[0];
    const montant = montants.get(l.id) ?? 0;
    const heures = Number(l.heures_total) || 0;
    const categorie = categorieDevis(l.statut, l.genre, montant, heures);
    const ouvertures = ls.map((x) => x.date_ouverture).filter((d): d is string => Boolean(d)).sort();
    const envois = ls.map((x) => x.date_envoi).filter((d): d is string => Boolean(d)).sort();
    const ouverture = ouvertures[0]?.slice(0, 10) ?? null;
    const envoi = (l.date_envoi ?? envois[0] ?? null)?.slice(0, 10) ?? null;
    const rel = [...(relancesPar.get(numero) ?? [])].sort((a, b) => b.relance_le.localeCompare(a.relance_le) || b.cree_le.localeCompare(a.cree_le));

    let prochaineRelance: string | null = null;
    if (categorie === "ENVOYE") {
      // sans date d'envoi, on part de l'ouverture
      const depart = [envoi ?? ouverture, rel[0]?.relance_le ?? null].filter((d): d is string => Boolean(d)).sort().pop();
      prochaineRelance = depart ? ajouterJours(depart, DELAI_RELANCE + 1) : aujourdhui;
    }

    const numAffaire = (categorie === "REMPORTE" || categorie === "INTENTION") && (l.genre === "BASE" || l.genre === "AVENANT") ? l.numero_affaire : null;
    resultat.push({
      numero,
      ligne: l,
      categorie,
      statut: l.statut,
      ouverture,
      envoi,
      commande: numAffaire ? (/^cbe/i.test(numAffaire) ? numAffaire.toUpperCase() : `CBE${numAffaire}`) : null,
      avenantDe: l.genre === "AVENANT" && l.base_affaire ? `CBE${l.base_affaire}` : null,
      montant,
      heures,
      relances: rel,
      prochaineRelance,
      aRelancer: prochaineRelance !== null && prochaineRelance <= aujourdhui,
    });
  }
  return resultat;
}
