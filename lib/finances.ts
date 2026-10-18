/* ===============================================================
   POLYNOV-TEMPS - FINANCES (chiffre d'affaires, négoce, rentabilité)

   Calculs purs, à partir de la copie du classeur « Suivi d'affaire BE »
   (lignes + montants), du relevé des prestations PE / PI et des heures
   réalisées (feuilles d'heures + historique).

   CHIFFRE D'AFFAIRES (date de reconnaissance) :
   - échéance / lot livré : son montant, à SA date de livraison ;
   - commande de base / avenant livré : son montant, moins ce que ses
     échéances / lots livrés ont déjà apporté, à sa date de livraison ;
   - PE / PI suivies dans le relevé des prestations : le montant des mois
     validés du relevé (à la place d'Excel, pour ne rien compter deux fois).
   Lignes perdues, annulées ou retirées du classeur : jamais comptées.

   NÉGOCE : revente = colonne « Montant négoce », coût = « Montant achats »
   (pris sur les échéances si la commande n'en porte pas).

   RENTABILITÉ d'une affaire terminée (toutes ses commandes livrées) :
   coût = heures réalisées × coût de structure (€/h, de l'année de fin)
          + achats ;
   marge = montant (commande + avenants retenus) − coût.
================================================================ */

export type Discipline = "meca" | "calcul" | "elec" | "pneu" | "scan" | "autre";
export type Groupe = "Méca" | "Calcul" | "Elec / Pneu" | "Scan" | "Autre" | "Négoce" | "Non ventilé";
export const GROUPES: Groupe[] = ["Méca", "Calcul", "Elec / Pneu", "Scan", "Autre", "Négoce", "Non ventilé"];

export const GROUPE_DISCIPLINE: Record<Discipline, Groupe> = {
  meca: "Méca",
  calcul: "Calcul",
  elec: "Elec / Pneu",
  pneu: "Elec / Pneu",
  scan: "Scan",
  autre: "Autre",
};

export type Montants = {
  montant: number;
  echeances: number;
  meca: number;
  calcul: number;
  elec_pneu: number;
  scan: number;
  autre: number;
  achats: number;
  negoce: number;
};

export type LigneFin = {
  cle: string;
  genre: "DEVIS" | "BASE" | "AVENANT" | "LOT" | "ECHEANCE";
  parent_cle: string | null;
  base_affaire: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client: string | null;
  date_livraison: string | null;
  disparue: boolean;
  heures: Record<Discipline, number>;
  heures_total: number;
  m: Montants;
};

export type ParGroupe = Record<Groupe, number>;
export const groupesVides = (): ParGroupe => ({ "Méca": 0, Calcul: 0, "Elec / Pneu": 0, Scan: 0, Autre: 0, "Négoce": 0, "Non ventilé": 0 });

/* Un mouvement de chiffre d'affaires : un montant reconnu à une date */
export type MouvementCA = {
  date: string; // AAAA-MM-JJ
  base_affaire: string;
  source: "LIVRAISON" | "ECHEANCE" | "RELEVE";
  montant: number;
  parGroupe: ParGroupe;
  negoce: number;
  achats: number;
  client: string | null;
  imputation: string | null;
};

const INACTIFS = ["Devis perdu", "Commande annulée"];
const active = (l: LigneFin) => !l.disparue && !INACTIFS.includes(l.statut ?? "");
const estCommande = (l: LigneFin) => l.genre === "BASE" || l.genre === "AVENANT";
const estDecoupage = (l: LigneFin) => l.genre === "LOT" || l.genre === "ECHEANCE";
export const estPrestation = (imputation: string | null) => imputation === "PE" || imputation === "PI";

/* Montant d'une ligne réparti par activité (détail du classeur, à l'échelle du montant reconnu) */
function repartir(m: Montants, valeur: number): ParGroupe {
  const g = groupesVides();
  const detail = m.meca + m.calcul + m.elec_pneu + m.scan + m.autre + m.negoce;
  if (detail <= 0 || valeur === 0) {
    g["Non ventilé"] = valeur;
    return g;
  }
  const k = valeur / detail;
  g["Méca"] = m.meca * k;
  g.Calcul = m.calcul * k;
  g["Elec / Pneu"] = m.elec_pneu * k;
  g.Scan = m.scan * k;
  g.Autre = m.autre * k;
  g["Négoce"] = m.negoce * k;
  return g;
}

/* Mouvements de CA issus du classeur. `viaReleve(base)` : PE / PI déjà comptées par le relevé. */
export function mouvementsExcel(lignes: LigneFin[], viaReleve: (base: string) => boolean): MouvementCA[] {
  const parCle = new Map(lignes.map((l) => [l.cle, l]));
  const enfants = new Map<string, LigneFin[]>();
  for (const l of lignes) {
    if (!estDecoupage(l) || !l.parent_cle) continue;
    enfants.set(l.parent_cle, [...(enfants.get(l.parent_cle) ?? []), l]);
  }
  const base = (l: LigneFin) => (l.base_affaire && parCle.get(`CBE${l.base_affaire}`)) || l;

  const res: MouvementCA[] = [];
  for (const l of lignes) {
    if (!l.base_affaire || !active(l) || l.statut !== "Livrée" || !l.date_livraison) continue;
    if (viaReleve(l.base_affaire)) continue;
    const b = base(l);

    if (estDecoupage(l)) {
      const valeur = l.m.echeances || l.m.montant;
      if (valeur === 0 && l.m.achats === 0) continue;
      // détail du découpage, sinon celui de sa commande
      const parent = l.parent_cle ? parCle.get(l.parent_cle) : undefined;
      const detail = l.m.meca + l.m.calcul + l.m.elec_pneu + l.m.scan + l.m.autre + l.m.negoce > 0 ? l.m : parent?.m ?? l.m;
      const part = parent && parent.m.montant > 0 ? valeur / parent.m.montant : 1;
      res.push({
        date: l.date_livraison,
        base_affaire: l.base_affaire,
        source: "ECHEANCE",
        montant: valeur,
        parGroupe: repartir(detail, valeur),
        negoce: detail === l.m ? l.m.negoce : (parent?.m.negoce ?? 0) * part,
        achats: l.m.achats,
        client: b.client,
        imputation: b.imputation,
      });
      continue;
    }

    if (!estCommande(l)) continue;
    const decoupes = (enfants.get(l.cle) ?? []).filter((e) => active(e) && e.statut === "Livrée");
    const dejaFacture = decoupes.reduce((t, e) => t + (e.m.echeances || e.m.montant), 0);
    const reste = Math.max(0, l.m.montant - dejaFacture);
    const part = l.m.montant > 0 ? reste / l.m.montant : 0;
    if (reste < 0.01 && l.m.achats === 0) continue;
    res.push({
      date: l.date_livraison,
      base_affaire: l.base_affaire,
      source: "LIVRAISON",
      montant: reste,
      parGroupe: repartir(l.m, reste),
      negoce: l.m.negoce * part,
      // achats : sur la commande, sinon ceux de ses découpages s'ils ne sont pas déjà comptés avec eux
      achats: l.m.achats * (decoupes.length ? part : 1),
      client: b.client,
      imputation: b.imputation,
    });
  }
  return res;
}

/* Agrégat mois par mois (AAAA-MM) */
export function parMois(mouvements: MouvementCA[], debut: string, fin: string) {
  const m = new Map<string, { montant: number; negoce: number; achats: number }>();
  for (const x of mouvements) {
    if (x.date < debut || x.date > fin) continue;
    const k = x.date.slice(0, 7);
    const v = m.get(k) ?? { montant: 0, negoce: 0, achats: 0 };
    v.montant += x.montant;
    v.negoce += x.negoce;
    v.achats += x.achats;
    m.set(k, v);
  }
  return m;
}

/* ------------------------------ affaires terminées ------------------------------ */

export type AffaireTerminee = {
  base_affaire: string;
  designation: string | null;
  client: string | null;
  imputation: string | null;
  date_fin: string; // dernière livraison
  montant: number; // commande + avenants retenus
  parGroupe: ParGroupe;
  heuresChiffrees: ParGroupe; // heures du classeur par groupe d'activité
  achats: number;
  negoce: number;
};

/* Affaires au forfait dont toutes les commandes retenues sont livrées */
export function affairesTerminees(lignes: LigneFin[]): AffaireTerminee[] {
  const familles = new Map<string, LigneFin[]>();
  for (const l of lignes) if (l.base_affaire) familles.set(l.base_affaire, [...(familles.get(l.base_affaire) ?? []), l]);

  const res: AffaireTerminee[] = [];
  for (const [base, f] of familles) {
    const commandes = f.filter((l) => estCommande(l) && active(l));
    if (commandes.length === 0) continue;
    if (!commandes.every((l) => l.statut === "Livrée" && l.date_livraison)) continue;
    const b = f.find((l) => l.genre === "BASE") ?? commandes[0];
    if (estPrestation(b.imputation)) continue; // PE / PI : rentabilité au mois, pas à la livraison

    const parGroupe = groupesVides();
    const heuresChiffrees = groupesVides();
    let montant = 0;
    let achats = 0;
    let negoce = 0;
    for (const l of commandes) {
      montant += l.m.montant;
      negoce += l.m.negoce;
      const r = repartir(l.m, l.m.montant);
      for (const g of GROUPES) parGroupe[g] += r[g];
      for (const d of Object.keys(GROUPE_DISCIPLINE) as Discipline[]) heuresChiffrees[GROUPE_DISCIPLINE[d]] += l.heures[d];
      // achats : sur la commande, sinon sur ses découpages
      const dec = f.filter((e) => estDecoupage(e) && e.parent_cle === l.cle);
      achats += l.m.achats !== 0 ? l.m.achats : dec.reduce((t, e) => t + e.m.achats, 0);
    }
    res.push({
      base_affaire: base,
      designation: b.designation,
      client: b.client,
      imputation: b.imputation,
      date_fin: commandes.map((l) => l.date_livraison!).sort().slice(-1)[0],
      montant,
      parGroupe,
      heuresChiffrees,
      achats,
      negoce,
    });
  }
  return res;
}

/* Exercice POLYNOV : du 1er novembre au 31 octobre ; désigné par son année de début */
export function exerciceDe(date: string): number {
  const a = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 11 ? a : a - 1;
}

/* Les 12 mois d'un exercice (AAAA-MM), de novembre à octobre */
export function moisExercice(exercice: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((10 + i) % 12) + 1;
    const a = m >= 11 ? exercice : exercice + 1;
    return `${a}-${String(m).padStart(2, "0")}`;
  });
}

/* Coût de structure applicable à une date : celui de son exercice, sinon le plus récent avant */
export function coutHoraire(couts: Map<number, number>, date: string): number | null {
  const ex = exerciceDe(date);
  if (couts.has(ex)) return couts.get(ex)!;
  const anterieurs = [...couts.keys()].filter((a) => a <= ex).sort((x, y) => y - x);
  if (anterieurs.length) return couts.get(anterieurs[0])!;
  const tous = [...couts.keys()].sort((x, y) => x - y);
  return tous.length ? couts.get(tous[0])! : null;
}
