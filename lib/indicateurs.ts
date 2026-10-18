/* ===============================================================
   POLYNOV-TEMPS - INDICATEURS (activité commerciale, carnet de commandes)

   Calculs purs à partir de la copie du classeur « Suivi d'affaire BE »
   (tables suivi_lignes et suivi_lignes_montants). Aucune requête ici.

   Définitions :
   - Une OFFRE = une ligne du classeur de genre DEVIS, BASE ou AVENANT
     (chacune a son numéro d'offre). Les lots et échéances ne sont que
     des découpages : jamais comptés.
   - Devis ÉMIS sur la période : date d'envoi dans la période (à défaut,
     date d'ouverture), sauf s'il est encore « Devis ouvert ».
   - Issue d'un devis émis : GAGNÉ (devenu commande : il porte un N°CBE et
     n'est pas perdu), PERDU (« Devis perdu »), INTENTION (« Intention de
     commande »), EN ATTENTE (le reste).
   - Taux de transformation = gagnés ÷ (gagnés + perdus) : on ne compte
     que les devis dont l'issue est connue.
   - Délai de réponse = jours calendaires entre ouverture et envoi.
   - PRISE DE COMMANDE : commande de base ou avenant reçu dans la période
     (date de réception de commande), hors annulé ou perdu.
   - CARNET DE COMMANDES à une date : commandes reçues à cette date et pas
     encore livrées (hors annulées) = travail vendu restant à produire.
     PE et PI (prestations au temps passé) : l'affaire est une ENVELOPPE
     d'heures (commande + avenants) consommée au fil de l'eau. Elle ne
     compte au carnet que pour la part de l'enveloppe non consommée :
     montant × (1 − heures réalisées ÷ heures commandées), à la date voulue.
     Enveloppe entièrement consommée : plus au carnet.
================================================================ */

export type Discipline = "meca" | "calcul" | "elec" | "pneu" | "scan" | "autre";
export const DISCIPLINES: Discipline[] = ["meca", "calcul", "elec", "pneu", "scan", "autre"];

export type LigneInd = {
  id: string;
  cle: string;
  genre: "DEVIS" | "BASE" | "AVENANT" | "LOT" | "ECHEANCE";
  numero_devis: string | null;
  numero_affaire: string | null;
  base_affaire: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  date_livraison: string | null;
  delai: string | null;
  date_livraison_estimee: string | null;
  heures: Record<Discipline, number>;
  heures_total: number;
  montant: number; // 0 si les montants ne sont pas visibles
  disparue: boolean;
  /* renseignés dans le carnet pour les PE / PI : part restante et valeurs d'origine */
  part_restante?: number;
  montant_commande?: number;
  heures_commande?: number;
};

export type Agregat = { nb: number; heures: number; montant: number };

const vide = (): Agregat => ({ nb: 0, heures: 0, montant: 0 });

function ajouter(a: Agregat, l: LigneInd): Agregat {
  a.nb += 1;
  a.heures += l.heures_total;
  a.montant += l.montant;
  return a;
}

const dans = (d: string | null, debut: string, fin: string) => Boolean(d && d >= debut && d <= fin);

const estOffre = (l: LigneInd) => !l.disparue && (l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT");
const estCommande = (l: LigneInd) => !l.disparue && (l.genre === "BASE" || l.genre === "AVENANT");
const INACTIFS = ["Devis perdu", "Commande annulée"];

/* ------------------------------ activité commerciale ------------------------------ */

export type Issue = "GAGNE" | "PERDU" | "INTENTION" | "ATTENTE";

export function issueDevis(l: LigneInd): Issue {
  if (l.statut === "Devis perdu") return "PERDU";
  if (estCommande(l) && l.statut !== "Devis perdu") return "GAGNE";
  if (l.statut === "Intention de commande") return "INTENTION";
  return "ATTENTE";
}

export function dateEmission(l: LigneInd): string | null {
  return l.date_envoi ?? l.date_ouverture;
}

export function devisEmis(lignes: LigneInd[], debut: string, fin: string): LigneInd[] {
  return lignes.filter((l) => estOffre(l) && l.statut !== "Devis ouvert" && dans(dateEmission(l), debut, fin));
}

function joursEntre(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function mediane(v: number[]): number | null {
  if (v.length === 0) return null;
  const t = [...v].sort((x, y) => x - y);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

export type SyntheseDevis = {
  emis: Agregat;
  parIssue: Record<Issue, Agregat>;
  tauxNombre: number | null; // 0..1
  tauxMontant: number | null;
  delaiMedian: number | null; // jours
  delaiMoyen: number | null;
};

export function syntheseDevis(emis: LigneInd[]): SyntheseDevis {
  const parIssue: Record<Issue, Agregat> = { GAGNE: vide(), PERDU: vide(), INTENTION: vide(), ATTENTE: vide() };
  const total = vide();
  const delais: number[] = [];

  for (const l of emis) {
    ajouter(total, l);
    ajouter(parIssue[issueDevis(l)], l);
    if (l.date_ouverture && l.date_envoi) {
      const d = joursEntre(l.date_ouverture, l.date_envoi);
      if (d >= 0 && d < 730) delais.push(d);
    }
  }

  const g = parIssue.GAGNE;
  const p = parIssue.PERDU;

  return {
    emis: total,
    parIssue,
    tauxNombre: g.nb + p.nb > 0 ? g.nb / (g.nb + p.nb) : null,
    tauxMontant: g.montant + p.montant > 0 ? g.montant / (g.montant + p.montant) : null,
    delaiMedian: mediane(delais),
    delaiMoyen: delais.length ? delais.reduce((t, x) => t + x, 0) / delais.length : null,
  };
}

/* Devis encore en attente de réponse aujourd'hui (tous, quelle que soit leur date) */
export function devisEnAttente(lignes: LigneInd[]): { attente: Agregat; intention: Agregat } {
  const attente = vide();
  const intention = vide();
  for (const l of lignes) {
    if (!estOffre(l) || estCommande(l)) continue;
    if (l.statut === "Devis envoyé") ajouter(attente, l);
    else if (l.statut === "Intention de commande") ajouter(intention, l);
  }
  return { attente, intention };
}

/* ------------------------------ prises de commande ------------------------------ */

export function prisesDeCommande(lignes: LigneInd[], debut: string, fin: string): LigneInd[] {
  return lignes.filter(
    (l) => estCommande(l) && !INACTIFS.includes(l.statut ?? "") && dans(l.date_reception_commande, debut, fin)
  );
}

export function total(lignes: LigneInd[]): Agregat {
  return lignes.reduce((a, l) => ajouter(a, l), vide());
}

/* ------------------------------ carnet de commandes ------------------------------ */

export type AffaireCarnet = {
  base_affaire: string;
  numero: string;
  designation: string | null;
  client: string | null;
  imputation: string | null;
  date_reception: string | null;
  montant: number; // en carnet (PE / PI : part restante)
  heures: number; // en carnet (PE / PI : part restante)
  heures_commande: number; // heures chiffrées de la commande entière
  prestation: boolean;
  heures_par_discipline: Record<Discipline, number>;
  nb_lignes: number;
};

export const estPrestation = (l: { imputation: string | null }) => l.imputation === "PE" || l.imputation === "PI";

/* Heures réalisées (consommées) sur une affaire jusqu'à une date : fournie par la page */
export type Consomme = (baseAffaire: string, jour: string) => number;

/* Lignes de commande en carnet à la date `jour`.
   Forfait : commandes reçues et pas encore livrées.
   PE / PI : toute l'enveloppe reçue (commande + avenants), ramenée à sa part non consommée. */
export function lignesEnCarnet(lignes: LigneInd[], jour: string, consomme?: Consomme): LigneInd[] {
  const recues = lignes.filter(
    (l) =>
      estCommande(l) &&
      !INACTIFS.includes(l.statut ?? "") &&
      Boolean(l.date_reception_commande && l.date_reception_commande <= jour)
  );

  const livree = (l: LigneInd) => Boolean(l.date_livraison && l.date_livraison <= jour);

  // Forfait : pas encore livré (une ligne « Livrée » sans date reste au carnet)
  const resultat: LigneInd[] = recues.filter((l) => !estPrestation(l) && !livree(l));

  // Prestations : par affaire (enveloppe)
  const familles = new Map<string, LigneInd[]>();
  for (const l of recues) {
    if (!estPrestation(l) || !l.base_affaire) continue;
    const f = familles.get(l.base_affaire) ?? [];
    f.push(l);
    familles.set(l.base_affaire, f);
  }

  for (const [base, f] of familles) {
    if (f.every(livree)) continue; // toute la prestation est terminée

    const commande = f.reduce((t, l) => t + l.heures_total, 0);
    const conso = consomme ? consomme(base, jour) : 0;
    const part = commande > 0 ? Math.max(0, Math.min(1, 1 - conso / commande)) : 1;
    if (part <= 0) continue; // enveloppe consommée

    for (const l of f) {
      const heures = { ...l.heures };
      for (const d of DISCIPLINES) heures[d] = l.heures[d] * part;
      resultat.push({
        ...l,
        montant: l.montant * part,
        heures_total: l.heures_total * part,
        heures,
        part_restante: part,
        montant_commande: l.montant,
        heures_commande: l.heures_total,
      });
    }
  }

  return resultat;
}

export function carnetParAffaire(enCarnet: LigneInd[], toutes: LigneInd[]): AffaireCarnet[] {
  const base = new Map(toutes.filter((l) => l.genre === "BASE" && l.base_affaire).map((l) => [l.base_affaire!, l]));
  const m = new Map<string, AffaireCarnet>();

  for (const l of enCarnet) {
    if (!l.base_affaire) continue;
    const b = base.get(l.base_affaire) ?? l;
    const a =
      m.get(l.base_affaire) ??
      ({
        base_affaire: l.base_affaire,
        numero: `CBE${l.base_affaire}`,
        designation: b.designation,
        client: b.client,
        imputation: b.imputation,
        date_reception: b.date_reception_commande,
        montant: 0,
        heures: 0,
        heures_commande: 0,
        prestation: estPrestation(b),
        heures_par_discipline: { meca: 0, calcul: 0, elec: 0, pneu: 0, scan: 0, autre: 0 },
        nb_lignes: 0,
      } as AffaireCarnet);
    a.montant += l.montant;
    a.heures += l.heures_total;
    a.heures_commande += l.heures_commande ?? l.heures_total;
    for (const d of DISCIPLINES) a.heures_par_discipline[d] += l.heures[d];
    a.nb_lignes += 1;
    m.set(l.base_affaire, a);
  }

  return [...m.values()].sort((x, y) => y.montant - x.montant || y.heures - x.heures);
}

/* ------------------------------ mois par mois ------------------------------ */

export function finDeMois(annee: number, mois: number): string {
  const d = new Date(Date.UTC(annee, mois, 0));
  return d.toISOString().slice(0, 10);
}

export type Mois = {
  cle: string; // AAAA-MM
  devis: Agregat;
  commandes: Agregat;
  carnet: Agregat; // à la fin du mois
};

export function parMois(lignes: LigneInd[], annee: number, jusquau: string, consomme?: Consomme): Mois[] {
  const res: Mois[] = [];
  for (let m = 1; m <= 12; m++) {
    const debut = `${annee}-${String(m).padStart(2, "0")}-01`;
    if (debut > jusquau) break;
    const fin = finDeMois(annee, m);
    const finEffective = fin < jusquau ? fin : jusquau;
    res.push({
      cle: debut.slice(0, 7),
      devis: total(devisEmis(lignes, debut, finEffective)),
      commandes: total(prisesDeCommande(lignes, debut, finEffective)),
      carnet: total(lignesEnCarnet(lignes, finEffective, consomme)),
    });
  }
  return res;
}

/* ------------------------------ répartitions ------------------------------ */

export type Part = { cle: string; nb: number; heures: number; montant: number };

export function repartir(lignes: LigneInd[], cle: (l: LigneInd) => string): Part[] {
  const m = new Map<string, Part>();
  for (const l of lignes) {
    const k = cle(l);
    const p = m.get(k) ?? { cle: k, nb: 0, heures: 0, montant: 0 };
    p.nb += 1;
    p.heures += l.heures_total;
    p.montant += l.montant;
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => b.montant - a.montant || b.heures - a.heures);
}

/* Heures par discipline (Méca, Calcul…) */
export function heuresParDiscipline(lignes: LigneInd[]): Record<Discipline, number> {
  const r: Record<Discipline, number> = { meca: 0, calcul: 0, elec: 0, pneu: 0, scan: 0, autre: 0 };
  for (const l of lignes) for (const d of DISCIPLINES) r[d] += l.heures[d];
  return r;
}

/* ------------------------------ périodes ------------------------------ */

export function decalerAnnee(jour: string, n: number): string {
  const a = Number(jour.slice(0, 4)) + n;
  const reste = jour.slice(4);
  // 29 février -> 28 février les années non bissextiles
  if (reste === "-02-29" && !(a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0))) return `${a}-02-28`;
  return `${a}${reste}`;
}
