/* ===============================================================
   PILOTAGE BE - MOTEUR DE PLANNING (sans dépendance)

   - capacité réelle par personne et par jour : horaire du profil,
     moins les jours fériés, moins les absences validées par les RH ;
   - répartition d'une affectation sur les jours :
       PLAGE  : « jusqu'à une date » - la personne y consacre un % de sa
                disponibilité (cas des prestations externes) ;
       HEURES : un nombre d'heures réparti sur la période (petites
                affaires) ;
       PAR_JOUR : un nombre fixe d'heures par jour (événement libre) ;
   - charge par semaine, segments et voies pour la frise, déplacement
     d'heures d'une semaine à l'autre.

   Principe : le planning calcule et avertit, il ne bloque jamais.
================================================================ */

export type JourISO = string; // AAAA-MM-JJ

/* ---------------------------------------------------------------
   DATES
--------------------------------------------------------------- */

export function aISO(d: Date): JourISO {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function deISO(iso: JourISO): Date {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j, 12, 0, 0);
}

export function ajouterJours(iso: JourISO, n: number): JourISO {
  const d = deISO(iso);
  d.setDate(d.getDate() + n);
  return aISO(d);
}

/* 1 = lundi ... 7 = dimanche */
export function jourSemaine(iso: JourISO): number {
  return deISO(iso).getDay() || 7;
}

export function lundiDe(iso: JourISO): JourISO {
  return ajouterJours(iso, 1 - jourSemaine(iso));
}

export function estWeekend(iso: JourISO): boolean {
  return jourSemaine(iso) >= 6;
}

export function listeJours(debut: JourISO, fin: JourISO): JourISO[] {
  const jours: JourISO[] = [];

  for (let j = debut; j <= fin; j = ajouterJours(j, 1)) {
    jours.push(j);
    if (jours.length > 800) break;
  }

  return jours;
}

/* Numéro de semaine ISO (S43...) */
export function numeroSemaine(iso: JourISO): number {
  const d = deISO(iso);
  const jour = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - jour);
  const debutAnnee = new Date(d.getFullYear(), 0, 1, 12);
  return Math.ceil(((d.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7);
}

/* ---------------------------------------------------------------
   JOURS FERIES (France métropolitaine)
--------------------------------------------------------------- */

function paques(annee: number): Date {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(annee, mois - 1, jour, 12, 0, 0);
}

const cacheFeries = new Map<number, Map<JourISO, string>>();

export function joursFeries(annee: number): Map<JourISO, string> {
  const connu = cacheFeries.get(annee);
  if (connu) return connu;

  const p = paques(annee);
  const plus = (n: number) => {
    const d = new Date(p);
    d.setDate(d.getDate() + n);
    return aISO(d);
  };
  const fixe = (m: number, j: number) => aISO(new Date(annee, m - 1, j, 12));

  const feries = new Map<JourISO, string>([
    [fixe(1, 1), "Jour de l'an"],
    [plus(1), "Lundi de Pâques"],
    [fixe(5, 1), "Fête du travail"],
    [fixe(5, 8), "Victoire 1945"],
    [plus(39), "Ascension"],
    [plus(50), "Lundi de Pentecôte"],
    [fixe(7, 14), "Fête nationale"],
    [fixe(8, 15), "Assomption"],
    [fixe(11, 1), "Toussaint"],
    [fixe(11, 11), "Armistice"],
    [fixe(12, 25), "Noël"],
  ]);

  cacheFeries.set(annee, feries);

  return feries;
}

export function estFerie(iso: JourISO): boolean {
  return joursFeries(Number(iso.slice(0, 4))).has(iso);
}

export function nomFerie(iso: JourISO): string | null {
  return joursFeries(Number(iso.slice(0, 4))).get(iso) ?? null;
}

/* ---------------------------------------------------------------
   TYPES DES DONNEES DE PLANNING
--------------------------------------------------------------- */

export type Affectation = {
  id: string;
  groupe_id: string | null;
  affaire_id: string | null; // vide : événement libre
  activite_id: string | null;
  code: string | null;
  libelle: string | null; // événement libre
  collaborateur_id: string;
  date_debut: JourISO;
  date_fin: JourISO;
  commentaire: string | null;
};

export type JourRow = {
  affectation_id: string;
  jour: JourISO;
  heures: number | string;
};

/* ---------------------------------------------------------------
   CAPACITES
--------------------------------------------------------------- */

export type CapaciteRow = {
  collaborateur_id: string;
  jour: JourISO;
  heures: number | string;
};

export type AbsenceRow = {
  collaborateur_id: string;
  date_debut: JourISO;
  date_fin: JourISO;
  duree_jours: number | string | null;
  heures_re: number | string | null;
  genre: "JOURS" | "HEURES" | string;
};

export type JourCapacite = {
  theorique: number; // heures du profil horaire
  ferie: boolean;
  absence: number; // heures d'absence (hors jours fériés)
  net: number; // capacité réellement disponible
};

const nombre = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const arrondi025 = (x: number): number => Math.round(x * 4) / 4;
export const arrondi2 = (x: number): number => Math.round(x * 100) / 100;

export type Capacites = Map<string, Map<JourISO, JourCapacite>>;

export function construireCapacites(caps: CapaciteRow[], absences: AbsenceRow[]): Capacites {
  const resultat: Capacites = new Map();

  for (const c of caps) {
    if (!resultat.has(c.collaborateur_id)) resultat.set(c.collaborateur_id, new Map());

    const theorique = Math.max(0, nombre(c.heures));
    const ferie = estFerie(c.jour);

    resultat.get(c.collaborateur_id)!.set(c.jour, {
      theorique,
      ferie,
      absence: 0,
      net: ferie ? 0 : theorique,
    });
  }

  for (const a of absences) {
    const jours = resultat.get(a.collaborateur_id);
    if (!jours) continue;

    const concernes = listeJours(a.date_debut, a.date_fin).filter((j) => {
      const c = jours.get(j);
      return c && c.theorique > 0 && !c.ferie;
    });

    if (concernes.length === 0) continue;

    if (a.genre === "HEURES") {
      let reste = Math.max(0, nombre(a.heures_re));

      for (const j of concernes) {
        if (reste <= 0) break;
        const c = jours.get(j)!;
        const pris = Math.min(reste, c.net);
        c.absence += pris;
        c.net = Math.max(0, c.net - pris);
        reste -= pris;
      }
    } else {
      const duree = nombre(a.duree_jours);
      let reste = duree > 0 ? duree : concernes.length;

      for (const j of concernes) {
        if (reste <= 0) break;
        const part = Math.min(1, reste);
        const c = jours.get(j)!;
        const heures = Math.min(c.net, c.theorique * part);
        c.absence += heures;
        c.net = Math.max(0, c.net - heures);
        reste -= part;
      }
    }
  }

  return resultat;
}

/* ---------------------------------------------------------------
   REPARTITION D'UNE AFFECTATION SUR LES JOURS
--------------------------------------------------------------- */

export type ModeAffectation = "PLAGE" | "HEURES" | "PAR_JOUR";

export type JourHeures = { jour: JourISO; heures: number };

export type ResultatRepartition = {
  jours: JourHeures[];
  total: number;
  joursDisponibles: number;
};

export function genererJours(options: {
  mode: ModeAffectation;
  debut: JourISO;
  fin: JourISO;
  capaciteJour: (jour: JourISO) => number; // capacité nette de la personne ce jour-là
  pourcent?: number; // PLAGE : part de la disponibilité (100 = tout)
  total?: number; // HEURES : nombre d'heures à répartir
  heuresParJour?: number; // PAR_JOUR : si absent, journée entière
}): ResultatRepartition {
  const { mode, debut, fin, capaciteJour } = options;

  if (!debut || !fin || fin < debut) return { jours: [], total: 0, joursDisponibles: 0 };

  const dispo = listeJours(debut, fin)
    .map((jour) => ({ jour, cap: capaciteJour(jour) }))
    .filter((j) => j.cap > 0);

  if (dispo.length === 0) return { jours: [], total: 0, joursDisponibles: 0 };

  let jours: JourHeures[] = [];

  if (mode === "PLAGE") {
    const p = Math.min(100, Math.max(1, options.pourcent ?? 100)) / 100;
    jours = dispo.map((j) => ({ jour: j.jour, heures: Math.max(0.25, arrondi025(j.cap * p)) }));
  } else if (mode === "PAR_JOUR") {
    jours = dispo.map((j) => ({
      jour: j.jour,
      heures: options.heuresParJour && options.heuresParJour > 0 ? Math.min(24, options.heuresParJour) : j.cap,
    }));
  } else {
    const total = Math.max(0, options.total ?? 0);
    const cible = Math.round(total * 4); // en quarts d'heure
    const somme = dispo.reduce((t, j) => t + j.cap, 0);

    if (cible === 0) return { jours: [], total: 0, joursDisponibles: dispo.length };

    // Plus grand reste : la somme est exactement égale au total demandé
    const parts = dispo.map((j) => {
      const brut = (cible * j.cap) / somme;
      return { jour: j.jour, entier: Math.floor(brut), reste: brut - Math.floor(brut) };
    });
    let manque = cible - parts.reduce((t, p) => t + p.entier, 0);

    for (const p of [...parts].sort((a, b) => b.reste - a.reste)) {
      if (manque <= 0) break;
      p.entier += 1;
      manque -= 1;
    }

    jours = parts.filter((p) => p.entier > 0).map((p) => ({ jour: p.jour, heures: p.entier / 4 }));
  }

  return {
    jours,
    total: arrondi2(jours.reduce((t, j) => t + j.heures, 0)),
    joursDisponibles: dispo.length,
  };
}

/* ---------------------------------------------------------------
   PRESTATIONS (PE / PI) : REMPLISSAGE JUSQU'A UNE FIN
   La personne est affectée à l'affaire, au même code, jour après jour :
     - jusqu'à une date donnée,
     - pour un nombre de jours donné,
     - ou pour un nombre d'heures donné.
   Les jours fériés et les absences (congés...) ne sont pas travaillés :
   la date de fin est repoussée d'autant.
--------------------------------------------------------------- */

export type ResultatRemplissage = ResultatRepartition & {
  fin: JourISO | null; // dernier jour affecté
  epuise: boolean; // toute la quantité a pu être placée avant l'horizon
  finCalendrier?: JourISO | null; // durée COMPRISE : dernier jour de la durée, même s'il est chômé
};

/* Heures à placer pour « jusqu'à une date » : ce que la personne ferait entre les deux dates
   si elle n'avait aucune absence (les jours fériés ne comptent pas). */
export function quantiteJusquaDate(options: {
  debut: JourISO;
  fin: JourISO;
  capaciteHorsAbsence: (jour: JourISO) => number; // horaire du profil, 0 un jour férié
  pourcent?: number;
}): number {
  if (!options.debut || !options.fin || options.fin < options.debut) return 0;

  const p = Math.min(100, Math.max(1, options.pourcent ?? 100)) / 100;

  return arrondi2(
    listeJours(options.debut, options.fin).reduce((t, j) => {
      const cap = options.capaciteHorsAbsence(j);
      return cap > 0 ? t + Math.max(0.25, arrondi025(cap * p)) : t;
    }, 0)
  );
}

/* Place `quantiteHeures` jour après jour à partir du début, en sautant les jours sans capacité. */
export function remplirHeures(options: {
  debut: JourISO;
  quantiteHeures: number;
  capaciteJour: (jour: JourISO) => number; // capacité nette (absences déduites)
  pourcent?: number;
  horizon: JourISO; // dernier jour examiné
}): ResultatRemplissage {
  const p = Math.min(100, Math.max(1, options.pourcent ?? 100)) / 100;
  const jours: JourHeures[] = [];
  let reste = Math.max(0, arrondi025(options.quantiteHeures));
  let disponibles = 0;

  if (!options.debut || reste <= 0) return { jours, total: 0, joursDisponibles: 0, fin: null, epuise: reste <= 0 };

  for (let j = options.debut, n = 0; j <= options.horizon && n < 800; j = ajouterJours(j, 1), n++) {
    const cap = options.capaciteJour(j);
    if (cap <= 0) continue;

    disponibles += 1;
    const heures = Math.min(reste, Math.max(0.25, arrondi025(cap * p)));

    jours.push({ jour: j, heures });
    reste = arrondi2(reste - heures);

    if (reste <= 0.001) break;
  }

  return {
    jours,
    total: arrondi2(jours.reduce((t, x) => t + x.heures, 0)),
    joursDisponibles: disponibles,
    fin: jours.length ? jours[jours.length - 1].jour : null,
    epuise: reste <= 0.001,
  };
}

/* Place `nbJours` journées de travail : une demi-journée d'absence ne compte que pour une demi-journée. */
export function remplirJours(options: {
  debut: JourISO;
  nbJours: number;
  capaciteJour: (jour: JourISO) => number; // capacité nette
  theoriqueJour: (jour: JourISO) => number; // horaire du profil ce jour-là (0 un jour férié)
  pourcent?: number;
  horizon: JourISO;
}): ResultatRemplissage {
  const p = Math.min(100, Math.max(1, options.pourcent ?? 100)) / 100;
  const jours: JourHeures[] = [];
  let reste = Math.max(0, options.nbJours);
  let disponibles = 0;

  if (!options.debut || reste <= 0) return { jours, total: 0, joursDisponibles: 0, fin: null, epuise: reste <= 0 };

  for (let j = options.debut, n = 0; j <= options.horizon && n < 800; j = ajouterJours(j, 1), n++) {
    const cap = options.capaciteJour(j);
    const theo = options.theoriqueJour(j);
    if (cap <= 0 || theo <= 0) continue;

    disponibles += 1;

    const fraction = (cap / theo) * p; // part de journée réellement travaillée
    const utilise = Math.min(reste, fraction);
    const heures = Math.max(0.25, arrondi025(theo * utilise));

    jours.push({ jour: j, heures });
    reste = arrondi2(reste - utilise);

    if (reste <= 0.001) break;
  }

  return {
    jours,
    total: arrondi2(jours.reduce((t, x) => t + x.heures, 0)),
    joursDisponibles: disponibles,
    fin: jours.length ? jours[jours.length - 1].jour : null,
    epuise: reste <= 0.001,
  };
}

/* ---------------------------------------------------------------
   CHARGE PAR SEMAINE
--------------------------------------------------------------- */

export type JourAffecte = { collaborateur_id: string; jour: JourISO; heures: number };

export type SemainePersonne = {
  lundi: JourISO;
  theorique: number;
  ferie: number; // heures de fériés (déduites)
  absence: number;
  net: number; // capacité disponible
  affecte: number;
  ecart: number; // affecté - capacité (positif = surcharge)
};

export function chargeParSemaine(
  capacites: Capacites,
  jours: JourAffecte[],
  collaborateurId: string,
  lundi: JourISO
): SemainePersonne {
  const cap = capacites.get(collaborateurId);
  let theorique = 0;
  let ferie = 0;
  let absence = 0;
  let net = 0;

  for (let i = 0; i < 7; i++) {
    const j = cap?.get(ajouterJours(lundi, i));
    if (!j) continue;
    theorique += j.theorique;
    if (j.ferie) ferie += j.theorique;
    absence += j.absence;
    net += j.net;
  }

  const fin = ajouterJours(lundi, 6);
  const affecte = jours
    .filter((x) => x.collaborateur_id === collaborateurId && x.jour >= lundi && x.jour <= fin)
    .reduce((t, x) => t + x.heures, 0);

  return {
    lundi,
    theorique: arrondi2(theorique),
    ferie: arrondi2(ferie),
    absence: arrondi2(absence),
    net: arrondi2(net),
    affecte: arrondi2(affecte),
    ecart: arrondi2(affecte - net),
  };
}

/* ---------------------------------------------------------------
   FRISE : segments et voies
--------------------------------------------------------------- */

export type Segment = { debutIdx: number; finIdx: number; heures: number };

/* colonnes : les jours affichés (lundi à vendredi). Un segment = une suite de colonnes consécutives avec des heures. */
export function segmentsAffectation(jours: JourHeures[], colonnes: JourISO[]): Segment[] {
  const parJour = new Map(jours.map((j) => [j.jour, j.heures]));
  const segments: Segment[] = [];
  let courant: Segment | null = null;

  colonnes.forEach((jour, i) => {
    const h = parJour.get(jour) ?? 0;

    if (h > 0) {
      if (courant) {
        courant.finIdx = i;
        courant.heures += h;
      } else {
        courant = { debutIdx: i, finIdx: i, heures: h };
        segments.push(courant);
      }
    } else {
      courant = null;
    }
  });

  return segments.map((s) => ({ ...s, heures: arrondi2(s.heures) }));
}

/* Attribue une voie (ligne) à chaque segment pour que les segments qui se chevauchent soient superposés. */
export function attribuerVoies(segments: { debutIdx: number; finIdx: number }[]): number[] {
  const ordre = segments.map((s, i) => ({ s, i })).sort((a, b) => a.s.debutIdx - b.s.debutIdx || b.s.finIdx - a.s.finIdx); // à début égal, la plus longue en premier (voie du haut)
  const finsVoies: number[] = [];
  const voies = new Array<number>(segments.length).fill(0);

  for (const { s, i } of ordre) {
    let voie = finsVoies.findIndex((fin) => fin < s.debutIdx);

    if (voie < 0) {
      voie = finsVoies.length;
      finsVoies.push(s.finIdx);
    } else {
      finsVoies[voie] = s.finIdx;
    }

    voies[i] = voie;
  }

  return voies;
}

/* ---------------------------------------------------------------
   DEPLACER DES HEURES D'UNE SEMAINE A UNE AUTRE
--------------------------------------------------------------- */

export function deplacerHeures(options: {
  jours: JourHeures[];
  semaineSource: JourISO; // lundi
  semaineCible: JourISO; // lundi
  heures: number;
  capaciteJour: (jour: JourISO) => number;
}): { jours: JourHeures[]; deplace: number } {
  const { semaineSource, semaineCible, capaciteJour } = options;
  const parJour = new Map(options.jours.map((j) => [j.jour, j.heures]));
  const finSource = ajouterJours(semaineSource, 6);

  // 1) retrait en fin de semaine source
  let reste = Math.max(0, arrondi025(options.heures));
  const joursSource = [...parJour.keys()].filter((j) => j >= semaineSource && j <= finSource).sort().reverse();

  for (const j of joursSource) {
    if (reste <= 0) break;
    const h = parJour.get(j)!;
    const pris = Math.min(h, reste);
    reste -= pris;
    if (h - pris <= 0) parJour.delete(j);
    else parJour.set(j, h - pris);
  }

  const aDeposer = arrondi025(options.heures) - reste;

  // 2) dépôt dans la semaine cible, proportionnel à la capacité
  const rep = genererJours({
    mode: "HEURES",
    debut: semaineCible,
    fin: ajouterJours(semaineCible, 6),
    capaciteJour,
    total: aDeposer,
  });

  for (const j of rep.jours) parJour.set(j.jour, arrondi025((parJour.get(j.jour) ?? 0) + j.heures));

  const jours = [...parJour.entries()]
    .map(([jour, heures]) => ({ jour, heures }))
    .filter((j) => j.heures > 0)
    .sort((a, b) => a.jour.localeCompare(b.jour));

  return { jours, deplace: rep.total };
}

/* Durée COMPRISE : les congés et jours fériés comptent dans la durée (« 30 jours » = 30 jours ouvrés du
   calendrier, chômés ou non). La fin ne bouge donc pas ; les heures ne sont placées que sur les jours travaillés. */
export function remplirCalendrier(options: {
  debut: JourISO;
  nbJours: number;
  capaciteJour: (jour: JourISO) => number; // capacité nette (absences déduites)
  pourcent?: number;
  horizon: JourISO;
}): ResultatRemplissage {
  const p = Math.min(100, Math.max(1, options.pourcent ?? 100)) / 100;
  const jours: JourHeures[] = [];
  let reste = Math.max(0, options.nbJours);
  let disponibles = 0;
  let finCalendrier: JourISO | null = null;

  if (!options.debut || reste <= 0) {
    return { jours, total: 0, joursDisponibles: 0, fin: null, epuise: reste <= 0, finCalendrier: null };
  }

  for (let j = options.debut, n = 0; j <= options.horizon && n < 800; j = ajouterJours(j, 1), n++) {
    if (estWeekend(j)) continue;

    const part = Math.min(1, reste);
    const cap = options.capaciteJour(j);

    if (cap > 0) {
      disponibles += 1;
      jours.push({ jour: j, heures: Math.max(0.25, arrondi025(cap * p * part)) });
    }

    finCalendrier = j;
    reste = arrondi2(reste - part);

    if (reste <= 0.001) break;
  }

  return {
    jours,
    total: arrondi2(jours.reduce((t, x) => t + x.heures, 0)),
    joursDisponibles: disponibles,
    fin: jours.length ? jours[jours.length - 1].jour : null,
    epuise: reste <= 0.001,
    finCalendrier,
  };
}

/* Fin THEORIQUE d'une prestation, sans personne (jours fériés seulement) :
   - durée qui exclut les congés et fériés : les fériés ne comptent pas ;
   - durée qui les comprend : tous les jours ouvrés comptent.
   Une quantité en heures est convertie en jours (7,5 h par jour par défaut). */
export function finTheoriquePrestation(options: {
  debut: JourISO;
  quantite: number;
  unite: "JOURS" | "HEURES";
  comprendConges: boolean;
  heuresParJour?: number;
}): JourISO | null {
  const parJour = options.heuresParJour && options.heuresParJour > 0 ? options.heuresParJour : 7.5;
  let reste = options.unite === "HEURES" ? options.quantite / parJour : options.quantite;

  if (!options.debut || !(reste > 0)) return null;

  let fin: JourISO | null = null;

  for (let j = options.debut, n = 0; n < 800; j = ajouterJours(j, 1), n++) {
    if (estWeekend(j)) continue;
    if (!options.comprendConges && estFerie(j)) continue;

    fin = j;
    reste = arrondi2(reste - Math.min(1, reste));

    if (reste <= 0.001) break;
  }

  return fin;
}

/* Barre dans la grille des jours ouvrés (une colonne = un jour ouvré) */
export type ModeGlisse = "move" | "debut" | "fin";

export type PositionPiste = {
  debutIdx: number;
  finIdx: number;
  coupeGauche: boolean; // commence avant la période affichée
  coupeDroite: boolean; // finit après la période affichée
};

/* Place des bornes (dates) sur les colonnes affichées. Un début de week-end tombe sur le lundi
   suivant, une fin de week-end sur le vendredi précédent. Hors période : null. */
export function positionPiste(debut: JourISO, fin: JourISO, colonnes: JourISO[]): PositionPiste | null {
  if (!debut || !fin || fin < debut || colonnes.length === 0) return null;
  if (fin < colonnes[0] || debut > colonnes[colonnes.length - 1]) return null;

  const debutIdx = colonnes.findIndex((j) => j >= debut);
  let finIdx = -1;

  for (let i = colonnes.length - 1; i >= 0; i--) {
    if (colonnes[i] <= fin) {
      finIdx = i;
      break;
    }
  }

  if (debutIdx < 0 || finIdx < 0 || finIdx < debutIdx) return null;

  return { debutIdx, finIdx, coupeGauche: debut < colonnes[0], coupeDroite: fin > colonnes[colonnes.length - 1] };
}

/* Nouvelles colonnes après un glisser de `delta` colonnes : déplacer, changer le début ou la fin.
   Une barre ne sort pas de la grille et son début ne dépasse pas sa fin. */
export function bornesApresGlisse(
  p: { debutIdx: number; finIdx: number },
  mode: ModeGlisse,
  delta: number,
  nbColonnes: number
): { i: number; f: number } {
  let i = p.debutIdx;
  let f = p.finIdx;

  if (mode === "move") {
    const d = Math.min(Math.max(delta, -p.debutIdx), nbColonnes - 1 - p.finIdx);
    i += d;
    f += d;
  } else if (mode === "debut") {
    i = Math.min(Math.max(0, p.debutIdx + delta), p.finIdx);
  } else {
    f = Math.max(Math.min(nbColonnes - 1, p.finIdx + delta), p.debutIdx);
  }

  return { i, f };
}

/* Une ressource dépasse-t-elle les bornes de la prestation ? */
export function depasseBornes(
  premierJour: JourISO,
  dernierJour: JourISO,
  bornes: { debut: JourISO | null; fin: JourISO | null }
): { avant: boolean; apres: boolean } {
  return {
    avant: Boolean(bornes.debut && premierJour < bornes.debut),
    apres: Boolean(bornes.fin && dernierJour > bornes.fin),
  };
}

/* ---------------------------------------------------------------
   PLANNING PAR AFFAIRE : BLOCS A GLISSER ET ETIRER
--------------------------------------------------------------- */

/* Jours du lundi au vendredi entre deux dates (colonnes de la frise). */
export function joursOuvres(debut: JourISO, fin: JourISO): JourISO[] {
  return listeJours(debut, fin).filter((j) => !estWeekend(j));
}

/* Part de temps de la personne sur un bloc : heures affectées ÷ capacité nette des mêmes jours.
   1 = toute sa disponibilité ; 0,25 = un quart de son temps. */
export function ratioDuBloc(jours: JourHeures[], capaciteJour: (jour: JourISO) => number): number {
  const cap = jours.reduce((t, j) => t + Math.max(0, capaciteJour(j.jour)), 0);
  const heures = jours.reduce((t, j) => t + j.heures, 0);

  if (cap <= 0 || heures <= 0) return 1;

  return Math.min(1, Math.max(0.05, heures / cap));
}

/* Recalcule un bloc entre deux dates (incluses) en gardant la même part de temps. */
export function recalculerBloc(options: {
  debut: JourISO;
  fin: JourISO;
  capaciteJour: (jour: JourISO) => number;
  ratio: number;
}): ResultatRepartition {
  return genererJours({
    mode: "PLAGE",
    debut: options.debut,
    fin: options.fin,
    capaciteJour: options.capaciteJour,
    pourcent: Math.round(options.ratio * 100),
  });
}

/* Jours d'une période où la personne ne peut pas travailler alors qu'elle devrait : congé ou jour férié. */
export type JourManquant = { jour: JourISO; motif: "ferie" | "absence" };

export function joursSansCapacite(
  debut: JourISO,
  fin: JourISO,
  capacites: Map<JourISO, JourCapacite> | undefined
): JourManquant[] {
  const resultat: JourManquant[] = [];

  for (const j of joursOuvres(debut, fin)) {
    const c = capacites?.get(j);
    if (!c) continue;

    if (c.ferie && c.theorique > 0) resultat.push({ jour: j, motif: "ferie" });
    else if (c.theorique > 0 && c.net < c.theorique * 0.5) resultat.push({ jour: j, motif: "absence" });
  }

  return resultat;
}

/* « Me contenir » : plus grande date de fin ≤ fin telle que le bloc ne dépasse pas `heuresMax`. */
export function finMaxPourHeures(options: {
  debut: JourISO;
  fin: JourISO;
  capaciteJour: (jour: JourISO) => number;
  ratio: number;
  heuresMax: number;
}): JourISO {
  const p = Math.min(1, Math.max(0.05, options.ratio));
  let cumul = 0;
  let derniere = options.debut;

  for (const j of listeJours(options.debut, options.fin)) {
    const cap = options.capaciteJour(j);
    if (cap <= 0) continue;

    const h = Math.max(0.25, arrondi025(cap * p));
    if (cumul + h > options.heuresMax + 0.001) break;

    cumul += h;
    derniere = j;
  }

  return derniere;
}

/* Jours où une personne est chez le client (affectée à une prestation externe) : non affectable ailleurs. */
export function joursChezLeClient(
  affectations: Pick<Affectation, "id" | "affaire_id" | "collaborateur_id">[],
  jours: JourRow[],
  estPrestationExterne: (affaireId: string) => boolean
): Map<string, Set<JourISO>> {
  const concernees = new Map<string, string>();

  for (const a of affectations) {
    if (a.affaire_id && estPrestationExterne(a.affaire_id)) concernees.set(a.id, a.collaborateur_id);
  }

  const resultat = new Map<string, Set<JourISO>>();

  for (const j of jours) {
    const c = concernees.get(j.affectation_id);
    if (!c) continue;
    if (!resultat.has(c)) resultat.set(c, new Set());
    resultat.get(c)!.add(j.jour);
  }

  return resultat;
}

/* Taux de service de l'équipe : heures affectées ÷ capacité nette, sur les semaines données. */
export function tauxServiceEquipe(
  capacites: Capacites,
  jours: JourAffecte[],
  collaborateurs: string[],
  semaines: JourISO[]
): { taux: number; net: number; affecte: number } {
  let net = 0;
  let affecte = 0;

  for (const id of collaborateurs) {
    for (const lundi of semaines) {
      const s = chargeParSemaine(capacites, jours, id, lundi);
      net += s.net;
      affecte += s.affecte;
    }
  }

  return { taux: net > 0 ? (affecte / net) * 100 : 0, net: arrondi2(net), affecte: arrondi2(affecte) };
}
