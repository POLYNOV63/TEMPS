/* ===============================================================
   POLYNOV - SUIVI DES DEVIS (SUIVI_DEVIS, RELANCES_PLANIFIEES)

   Calculs purs de la page Suivi des devis (aucune requête ici), à
   partir de la copie du classeur « Suivi d'affaire BE ».

   - Un DEVIS = un n° de devis (DBE…) : ses lignes DEVIS, BASE ou AVENANT
     sont réunies (lots et échéances exclus). La ligne qui dit le mieux ce
     qu'il est devenu : la commande (base, puis avenant), sinon le devis.
     Un devis d'AVENANT est un devis comme un autre ; on indique seulement
     l'affaire mère (« avenant de CBE1604 »).
   - Sa catégorie vient du statut du classeur :
       Devis ouvert            -> OUVERT (en rédaction)
       Devis envoyé            -> ENVOYE (en attente de réponse)
       Intention de commande   -> INTENTION (hors de cette page)
       Commande reçue, Livrée,
       Commande annulée        -> REMPORTE
       Devis perdu             -> PERDU s'il a été envoyé,
                                  ANNULE sans date d'envoi (jamais envoyé)
   - RELANCES d'un devis envoyé : une relance se PRÉVOIT (qui, quand :
     elle apparaît dans sa feuille de route) puis se NOTE comme faite.
     Un devis envoyé est « à relancer » quand il a une relance prévue, ou
     quand plus de 30 jours ont passé depuis l'envoi ET depuis la dernière
     relance faite (il faut alors en prévoir une).
================================================================ */

export const DELAI_RELANCE = 30; // jours

export type CategorieDevis = "OUVERT" | "ENVOYE" | "INTENTION" | "REMPORTE" | "PERDU" | "ANNULE" | "AUTRE";

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

/* une relance : PRÉVUE (relance_le vide) ou FAITE (relance_le rempli) — RELANCES_HISTORIQUE (SQL 93) :
   prévue le (prevue_le) pour (responsable_id) par (saisi_par), consigne (commentaire) ;
   faite le (relance_le) par (faite_par), réponse du client (reponse) */
export type Relance = {
  id: string;
  numero_devis: string;
  prevue_le: string | null;
  responsable_id: string | null;
  relance_le: string | null;
  commentaire: string | null;
  saisi_par: string | null;
  cree_le: string;
  faite_par?: string | null;
  reponse?: string | null;
};

/* AUCUNE : rien à faire pour l'instant ; A_PLANIFIER : 30 jours passés, personne n'est désigné ;
   PREVUE : quelqu'un relance à une date ; EN_RETARD : la date prévue est passée */
export type EtatRelance = "AUCUNE" | "A_PLANIFIER" | "PREVUE" | "EN_RETARD";

export type Devis = {
  numero: string; // « 2715 » pour DBE2715
  ligne: LigneSuiviDevis; // la ligne qui dit le mieux ce qu'est devenu le devis
  categorie: CategorieDevis;
  statut: string | null;
  ouverture: string | null;
  envoi: string | null;
  commande: string | null; // n° de commande une fois remporté : « CBE1604 », « CBE1604R1 »
  avenantDe: string | null; // devis d'avenant : l'affaire mère, « CBE1604 »
  montant: number; // 0 si les montants ne sont pas visibles
  heures: number;
  faites: Relance[]; // relances faites, la plus récente d'abord
  prevue: Relance | null; // relance prévue, pas encore faite
  prochaineRelance: string | null; // devis envoyé : date à partir de laquelle il faut le relancer
  etatRelance: EtatRelance;
  aRelancer: boolean; // dans la liste « À relancer » (relance prévue, ou à prévoir)
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

export function categorieDevis(statut: string | null, genre: string, envoye: boolean): CategorieDevis {
  switch (statut) {
    case "Devis ouvert":
      return "OUVERT";
    case "Devis envoyé":
      return "ENVOYE";
    case "Intention de commande":
      return "INTENTION";
    case "Devis perdu":
      return envoye ? "PERDU" : "ANNULE";
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
    const ouvertures = ls.map((x) => x.date_ouverture).filter((d): d is string => Boolean(d)).sort();
    const envois = ls.map((x) => x.date_envoi).filter((d): d is string => Boolean(d)).sort();
    const ouverture = ouvertures[0]?.slice(0, 10) ?? null;
    const envoi = (l.date_envoi ?? envois[0] ?? null)?.slice(0, 10) ?? null;
    const categorie = categorieDevis(l.statut, l.genre, Boolean(envoi));

    const toutes = relancesPar.get(numero) ?? [];
    const faites = toutes
      .filter((r) => Boolean(r.relance_le))
      .sort((a, b) => (b.relance_le ?? "").localeCompare(a.relance_le ?? "") || b.cree_le.localeCompare(a.cree_le));
    const prevue = toutes.find((r) => !r.relance_le) ?? null;

    let prochaineRelance: string | null = null;
    let etatRelance: EtatRelance = "AUCUNE";
    if (categorie === "ENVOYE") {
      // sans date d'envoi, on part de l'ouverture
      const depart = [envoi ?? ouverture, faites[0]?.relance_le ?? null].filter((d): d is string => Boolean(d)).sort().pop();
      prochaineRelance = depart ? ajouterJours(depart, DELAI_RELANCE + 1) : aujourdhui;
      if (prevue) etatRelance = prevue.prevue_le && prevue.prevue_le < aujourdhui ? "EN_RETARD" : "PREVUE";
      else if (prochaineRelance <= aujourdhui) etatRelance = "A_PLANIFIER";
    }

    const numAffaire = categorie === "REMPORTE" && (l.genre === "BASE" || l.genre === "AVENANT") ? l.numero_affaire : null;
    resultat.push({
      numero,
      ligne: l,
      categorie,
      statut: l.statut,
      ouverture,
      envoi,
      commande: numAffaire ? (/^cbe/i.test(numAffaire) ? numAffaire.toUpperCase() : `CBE${numAffaire}`) : null,
      avenantDe: l.genre === "AVENANT" && l.base_affaire ? `CBE${l.base_affaire}` : null,
      montant: montants.get(l.id) ?? 0,
      heures: Number(l.heures_total) || 0,
      faites,
      prevue,
      prochaineRelance,
      etatRelance,
      aRelancer: etatRelance !== "AUCUNE",
    });
  }
  return resultat;
}
