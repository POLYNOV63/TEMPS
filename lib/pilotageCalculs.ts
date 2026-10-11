/* ===============================================================
   PILOTAGE BE - TYPES ET CALCULS (sans dépendance : ni React ni Supabase)

   Définitions
     Chiffré   = somme des heures chiffrées par activité (pilotage_charges)
     Réalisé   = heures réellement imputées dans les feuilles d'heures
                 (feuilles actuelles + historique importé) sur le numéro
                 de l'affaire, plus les heures déjà réalisées avant le
                 début du suivi (realise_initial)
     Reste     = Chiffré - Réalisé (jamais négatif)
     Dépassement = Réalisé - Chiffré, lorsque le chiffré est renseigné
================================================================ */

export type TypeAffaire = "DBE" | "CBE";
export type StatutAffaire = "EN_ATTENTE" | "EN_COURS" | "LIVREE" | "ABANDONNEE";
export type Genre = "ok" | "warn" | "crit" | "info";

export type Affaire = {
  id: string;
  type: TypeAffaire;
  numero: string;
  designation: string;
  responsable_id: string;
  priorite: number | null;
  statut: StatutAffaire;
  echeance: string | null;
  echeance_initiale: string | null;
  dbe_origine_id: string | null;
  date_livraison: string | null;
  imputation: string | null;
  created_at: string;
};

export type Charge = {
  id: string;
  affaire_id: string;
  activite_id: string;
  code: string | null;
  heures: number | string;
  realise_initial: number | string;
};

export type Realise = {
  type_affaire: string;
  numero: string;
  activite_id: string | null;
  code: string | null;
  heures: number | string;
};

export type Collab = {
  id: string;
  trigramme: string | null;
  prenom: string | null;
  nom: string | null;
  inclus_statistiques: boolean;
};

export type Imputation = {
  code: string;
  libelle: string;
  actif: boolean;
  ordre_affichage: number;
  /* false : prestation planifiée par date de fin (ex. PE), les heures chiffrées sont facultatives */
  charge_obligatoire: boolean;
};

export type Activite = {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
  ordre_affichage: number;
};

export const STATUTS: { valeur: StatutAffaire; libelle: string }[] = [
  { valeur: "EN_COURS", libelle: "En cours" },
  { valeur: "EN_ATTENTE", libelle: "En attente" },
  { valeur: "LIVREE", libelle: "Livrée" },
  { valeur: "ABANDONNEE", libelle: "Abandonnée" },
];

export function libelleStatut(statut: string): string {
  return STATUTS.find((s) => s.valeur === statut)?.libelle ?? statut;
}

/* ---------------------------------------------------------------
   OUTILS
--------------------------------------------------------------- */

export function num(valeur: unknown): number {
  const n = Number(valeur);
  return Number.isFinite(n) ? n : 0;
}

export function arrondir(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export function formatHeures(valeur: number): string {
  return `${arrondir(valeur).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} h`;
}

export function formatPourcent(valeur: number): string {
  return `${Math.round(valeur).toLocaleString("fr-FR")} %`;
}

/* AAAA-MM-JJ -> JJ/MM/AAAA */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function aujourdhuiISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function cleAffaire(type: string, numero: string): string {
  return `${String(type).toUpperCase()}-${String(numero).trim()}`;
}

export function nomCollab(c: Collab | undefined): string {
  if (!c) return "—";
  return c.trigramme || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || "—";
}

/* ---------------------------------------------------------------
   TOTAUX D'UNE AFFAIRE
--------------------------------------------------------------- */

export type Totaux = {
  chiffre: number;
  realise: number;
  reste: number;
  depassement: number;
  pourcent: number | null; // réalisé / chiffré, null si pas de chiffrage
};

export function totauxAffaire(charges: Charge[], realiseLignes: Realise[]): Totaux {
  const chiffre = charges.reduce((t, c) => t + num(c.heures), 0);
  const initial = charges.reduce((t, c) => t + num(c.realise_initial), 0);
  const realise = realiseLignes.reduce((t, r) => t + num(r.heures), 0) + initial;

  return {
    chiffre: arrondir(chiffre),
    realise: arrondir(realise),
    reste: arrondir(Math.max(0, chiffre - realise)),
    depassement: chiffre > 0 ? arrondir(Math.max(0, realise - chiffre)) : 0,
    pourcent: chiffre > 0 ? (realise / chiffre) * 100 : null,
  };
}

export function indexParAffaire<T extends { type_affaire: string; numero: string }>(
  lignes: T[]
): Map<string, T[]> {
  const index = new Map<string, T[]>();

  for (const l of lignes) {
    const cle = cleAffaire(l.type_affaire, l.numero);
    if (!index.has(cle)) index.set(cle, []);
    index.get(cle)!.push(l);
  }

  return index;
}

export function chargesParAffaire(charges: Charge[]): Map<string, Charge[]> {
  const index = new Map<string, Charge[]>();

  for (const c of charges) {
    if (!index.has(c.affaire_id)) index.set(c.affaire_id, []);
    index.get(c.affaire_id)!.push(c);
  }

  return index;
}

/* ---------------------------------------------------------------
   ETAT D'UNE AFFAIRE (pastille du portefeuille)
--------------------------------------------------------------- */

export type PlanningAffaire = {
  planifie: number; // heures planifiées à partir d'aujourd'hui
  fin: string | null; // dernier jour planifié
  nb: number; // nombre d'affectations
  chargeObligatoire: boolean; // l'imputation de l'affaire exige des heures chiffrées
  planningActif: boolean; // des affectations existent quelque part : on peut alerter sur le non affecté
};

function joursEntre(debut: string, fin: string): number {
  const d = (iso: string) => {
    const [a, m, j] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, j);
  };

  return Math.round((d(fin) - d(debut)) / 86400000);
}

export function etatAffaire(
  a: Pick<Affaire, "type" | "statut" | "echeance">,
  t: Totaux,
  aujourdhui: string,
  planning?: PlanningAffaire
): { genre: Genre; texte: string } {
  if (a.statut === "ABANDONNEE") return { genre: "info", texte: "Abandonnée" };

  // Contrôle de dépassement : valable aussi pour une affaire livrée
  if (t.chiffre > 0 && t.depassement > 0) {
    return { genre: "crit", texte: `Dépassement de ${formatHeures(t.depassement)}` };
  }

  if (a.statut === "LIVREE") return { genre: "info", texte: "Livrée" };
  if (a.statut === "EN_ATTENTE") return { genre: "info", texte: "En attente" };

  // En cours
  if (a.echeance && a.echeance < aujourdhui) {
    return {
      genre: "crit",
      texte: a.type === "DBE" ? "Remise dépassée" : "Objectif dépassé",
    };
  }

  if (planning && planning.planningActif) {
    // Affectations qui se terminent après la date attendue
    if (a.type === "CBE" && planning.chargeObligatoire && a.echeance && planning.fin && planning.fin > a.echeance) {
      return { genre: "crit", texte: "Affectations finies après l’objectif" };
    }
  }

  if (t.pourcent !== null && t.pourcent >= 90) {
    return { genre: "warn", texte: `Budget consommé à ${formatPourcent(t.pourcent)}` };
  }

  // Remise d'une offre imminente
  if (a.type === "DBE" && a.echeance) {
    const j = joursEntre(aujourdhui, a.echeance);

    if (j >= 0 && j <= 3) {
      return { genre: "warn", texte: j === 0 ? "Remise aujourd’hui" : `Remise dans ${j} j` };
    }
  }

  if (planning && planning.planningActif && a.type === "CBE") {
    if (planning.chargeObligatoire && t.chiffre > 0) {
      const nonAffecte = Math.max(0, t.reste - planning.planifie);

      if (nonAffecte > 0.01) {
        return { genre: "warn", texte: `${formatHeures(nonAffecte)} non affectées` };
      }
    }

    if (!planning.chargeObligatoire) {
      if (planning.nb === 0 || !planning.fin) {
        return { genre: "warn", texte: "Aucune affectation planifiée" };
      }

      if (a.echeance && planning.fin < a.echeance) {
        return { genre: "warn", texte: `Planifiée jusqu’au ${formatDate(planning.fin)}` };
      }

      // Congés et jours fériés repoussent la fin d'une prestation
      if (a.echeance && planning.fin > a.echeance) {
        return { genre: "warn", texte: `Fin repoussée au ${formatDate(planning.fin)}` };
      }
    }
  }

  if (!a.echeance) {
    return { genre: "warn", texte: a.type === "DBE" ? "Sans date de remise" : "Sans date objectif" };
  }

  if (a.type === "CBE" && t.chiffre === 0 && (!planning || planning.chargeObligatoire)) {
    return { genre: "warn", texte: "Pas de charge chiffrée" };
  }

  return { genre: "ok", texte: a.type === "DBE" ? "En cours" : "Dans le budget" };
}

/* ---------------------------------------------------------------
   DETAIL PAR ACTIVITE (fiche d'une affaire)
--------------------------------------------------------------- */

export type LigneActivite = {
  activite_id: string | null;
  nom: string;
  chiffre: number;
  realise: number;
  reste: number;
  depassement: number;
  horsChiffrage: boolean; // des heures sont imputées sans avoir été chiffrées
  codes: { code: string; libelle: string; chiffre: number; realise: number }[];
};

export function detailActivites(
  charges: Charge[],
  realiseLignes: Realise[],
  activites: Activite[],
  libellesCodes: Map<string, string>
): LigneActivite[] {
  const nomActivite = new Map(activites.map((a) => [a.id, a.nom]));
  const ordre = new Map(activites.map((a) => [a.id, a.ordre_affichage]));
  const lignes = new Map<string, LigneActivite>();
  const cle = (id: string | null) => id ?? "__sans_activite__";

  const obtenir = (id: string | null): LigneActivite => {
    const k = cle(id);

    if (!lignes.has(k)) {
      lignes.set(k, {
        activite_id: id,
        nom: id ? nomActivite.get(id) ?? "Activité inconnue" : "Activité non renseignée",
        chiffre: 0,
        realise: 0,
        reste: 0,
        depassement: 0,
        horsChiffrage: false,
        codes: [],
      });
    }

    return lignes.get(k)!;
  };

  const codeChiffre = new Map<string, boolean>(); // activité -> au moins un code chiffré

  for (const c of charges) {
    const l = obtenir(c.activite_id);
    l.chiffre += num(c.heures);
    l.realise += num(c.realise_initial);

    if (c.code) codeChiffre.set(cle(c.activite_id), true);
  }

  for (const r of realiseLignes) {
    obtenir(r.activite_id).realise += num(r.heures);
  }

  // Détail par code : uniquement pour les activités chiffrées avec des codes
  for (const [k, l] of lignes) {
    if (!codeChiffre.get(k)) continue;

    const parCode = new Map<string, { chiffre: number; realise: number }>();
    const ajouter = (code: string | null) => {
      const c = code ?? "";
      if (!parCode.has(c)) parCode.set(c, { chiffre: 0, realise: 0 });
      return parCode.get(c)!;
    };

    for (const c of charges.filter((x) => cle(x.activite_id) === k)) {
      const p = ajouter(c.code);
      p.chiffre += num(c.heures);
      p.realise += num(c.realise_initial);
    }

    for (const r of realiseLignes.filter((x) => cle(x.activite_id) === k)) {
      ajouter(r.code).realise += num(r.heures);
    }

    l.codes = Array.from(parCode.entries())
      .map(([code, p]) => ({
        code: code || "—",
        libelle: code ? libellesCodes.get(code) ?? "" : "Toute l’activité",
        chiffre: arrondir(p.chiffre),
        realise: arrondir(p.realise),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, "fr"));
  }

  const resultat = Array.from(lignes.values()).map((l) => ({
    ...l,
    chiffre: arrondir(l.chiffre),
    realise: arrondir(l.realise),
    reste: arrondir(Math.max(0, l.chiffre - l.realise)),
    depassement: l.chiffre > 0 ? arrondir(Math.max(0, l.realise - l.chiffre)) : 0,
    horsChiffrage: l.chiffre === 0 && l.realise > 0,
  }));

  return resultat.sort((a, b) => {
    const oa = a.activite_id ? ordre.get(a.activite_id) ?? 999 : 9999;
    const ob = b.activite_id ? ordre.get(b.activite_id) ?? 999 : 9999;
    return oa - ob || a.nom.localeCompare(b.nom, "fr");
  });
}

/* ---------------------------------------------------------------
   ERREURS
--------------------------------------------------------------- */

export function traduireErreur(message: string | undefined | null): string {
  const m = String(message ?? "");

  if (/pilotage_affaires_type_numero_unique|duplicate key/i.test(m)) {
    return "Une affaire de ce type avec ce numéro existe déjà.";
  }

  if (/pilotage_charges_unique/i.test(m)) {
    return "La même activité (et le même code) est saisie deux fois.";
  }

  if (/row-level security|permission denied/i.test(m)) {
    return "Vous n’avez pas le droit d’effectuer cette action.";
  }

  return m || "Une erreur est survenue.";
}

/* ---------------------------------------------------------------
   PLANNING PAR AFFAIRE
--------------------------------------------------------------- */

export function planifieParAffaire(
  affectations: { id: string; affaire_id: string | null }[],
  jours: { affectation_id: string; jour: string; heures: number | string }[],
  aujourdhui: string
): Map<string, { planifie: number; fin: string | null; nb: number }> {
  const affaireDe = new Map(affectations.map((a) => [a.id, a.affaire_id]));
  const resultat = new Map<string, { planifie: number; fin: string | null; nb: number }>();
  const vues = new Set<string>();

  for (const j of jours) {
    const affaire = affaireDe.get(j.affectation_id);
    if (!affaire || j.jour < aujourdhui) continue;

    const r = resultat.get(affaire) ?? { planifie: 0, fin: null, nb: 0 };
    r.planifie += num(j.heures);
    if (!r.fin || j.jour > r.fin) r.fin = j.jour;
    if (!vues.has(j.affectation_id)) {
      vues.add(j.affectation_id);
      r.nb += 1;
    }
    resultat.set(affaire, r);
  }

  for (const r of resultat.values()) r.planifie = arrondir(r.planifie);

  return resultat;
}
