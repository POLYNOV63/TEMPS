/* ===============================================================
   MA SEMAINE - SAISIE EN GRILLE : LOGIQUE PURE (sans React, testable)

   La grille montre une AFFAIRE par ligne et un JOUR par colonne. Dans chaque case :
   une ou plusieurs imputations, chacune avec son ACTIVITÉ, son CODE et ses HEURES
   (comme sur la feuille classique, mais sur la même ligne d'affaire d'un jour à l'autre).

   Le modèle de données ne change pas : une imputation = une ligne (type, n° d'affaire,
   activité, code, heures) rattachée à un jour. La grille ne fait que REGROUPER ces
   imputations par affaire pour l'affichage.
================================================================ */

export type LigneGrille = {
  id: string;
  typeAffaire: string;
  activiteId: string | null;
  numeroAffaire: string;
  description: string;
  code: string;
  heures: string; // saisie telle quelle (« 3,5 »)
};

export type EtatJour = "COMPLET" | "MANQUE" | "ABSENT" | "FERIE";
export type PresenceGrille = "PRESENTIEL" | "TELETRAVAIL" | "ABSENT";

export type JourGrille = {
  date: string; // AAAA-MM-JJ
  libelle: string; // « Lun 19 »
  libelleLong: string; // « Lundi 19 octobre »
  estWeekend: boolean;
  estFerie: boolean;
  fige: boolean; // aucune imputation possible (férié, absence sur la journée)
  objectif: number; // heures à imputer ce jour-là
  saisi: number; // heures déjà imputées
  etat: EtatJour;
  note: string; // « Congé payé », « férié »…
  absence: string; // code d'absence ("" si aucune)
  presence: PresenceGrille;
  presenceModifiable: boolean;
  ticket: boolean;
  ticketModifiable: boolean;
  imputations: LigneGrille[];
};

export type AffaireGrille = {
  typeAffaire: string;
  numeroAffaire: string;
  description: string;
};

export type CodeGrille = { code: string; libelle: string };

/* Une activité et les codes qu'elle autorise (activité null = Divers, sans activité) */
export type GroupeActiviteGrille = {
  activiteId: string | null;
  nom: string;
  codes: CodeGrille[];
};

export type RangeeAffaire = AffaireGrille & {
  cle: string;
  total: number;
  lignesParDate: Map<string, LigneGrille[]>;
};

export const cleAffaire = (a: { typeAffaire: string; numeroAffaire: string }) =>
  `${a.typeAffaire}|${a.numeroAffaire.trim()}`;

export const normaliserCodeGrille = (code: string) => String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");

export const estDiversType = (type: string) => type.toUpperCase() === "DIVERS";

/* « 3,5 », « 3.5 », « 3h30 », « 3h », « 0,25 » → nombre d'heures. Tout le reste → 0. */
export function lireHeures(texte: string): number {
  const t = String(texte ?? "").trim().toLowerCase().replace(",", ".");
  if (t === "") return 0;

  const hm = /^(\d+)\s*h\s*(\d{1,2})?$/.exec(t);
  if (hm) return Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);

  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* 7.5 → « 7,5 » ; 8 → « 8 » ; 0.25 → « 0,25 » */
export function formaterHeures(valeur: number): string {
  const arrondi = Math.round(valeur * 100) / 100;
  return String(arrondi).replace(".", ",");
}

export function totalLignes(lignes: LigneGrille[]): number {
  return lignes.reduce((t, l) => t + lireHeures(l.heures), 0);
}

/* Regroupe les imputations de la semaine par affaire, dans l'ordre d'apparition (jour par jour),
   puis ajoute les affaires choisies mais pas encore imputées. */
export function regrouperParAffaire(jours: JourGrille[], ajoutees: AffaireGrille[] = []): RangeeAffaire[] {
  const rangees = new Map<string, RangeeAffaire>();

  const obtenir = (a: AffaireGrille): RangeeAffaire => {
    const cle = cleAffaire(a);
    let r = rangees.get(cle);

    if (!r) {
      r = {
        typeAffaire: a.typeAffaire,
        numeroAffaire: a.numeroAffaire,
        description: a.description,
        cle,
        total: 0,
        lignesParDate: new Map(),
      };
      rangees.set(cle, r);
    }

    if (!r.description && a.description) r.description = a.description;

    return r;
  };

  for (const jour of [...jours].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const ligne of jour.imputations) {
      const vide =
        ligne.typeAffaire === "" &&
        !ligne.numeroAffaire.trim() &&
        !ligne.code &&
        !ligne.heures.trim() &&
        !ligne.activiteId &&
        !ligne.description.trim();

      if (vide) continue;

      const r = obtenir(ligne);
      const liste = r.lignesParDate.get(jour.date) ?? [];
      liste.push(ligne);
      r.lignesParDate.set(jour.date, liste);
      r.total += lireHeures(ligne.heures);
    }
  }

  for (const a of ajoutees) obtenir(a);

  return [...rangees.values()];
}

/* Activité la plus récemment utilisée sur l'affaire (dernier jour, dernière ligne) : sert à
   pré-remplir l'activité des nouvelles lignes, pour ne la choisir qu'une fois. */
export function activiteRecente(rangee: RangeeAffaire): string | null {
  const dates = [...rangee.lignesParDate.keys()].sort();

  for (let i = dates.length - 1; i >= 0; i--) {
    const lignes = rangee.lignesParDate.get(dates[i]) ?? [];

    for (let j = lignes.length - 1; j >= 0; j--) {
      if (lignes[j].activiteId) return lignes[j].activiteId;
    }
  }

  return null;
}

/* Valeurs proposées pour une nouvelle ligne : activité de la ligne précédente (ou de l'affaire),
   et code d'office quand l'activité n'en autorise qu'un. */
export function valeursParDefaut(
  typeAffaire: string,
  activitePrecedente: string | null,
  groupes: GroupeActiviteGrille[]
): { activiteId: string | null; code: string } {
  if (estDiversType(typeAffaire)) return { activiteId: null, code: "" };

  let activiteId = activitePrecedente;

  if (!activiteId && groupes.length === 1) activiteId = groupes[0].activiteId;

  const groupe = groupes.find((g) => g.activiteId === activiteId);

  return { activiteId, code: groupe && groupe.codes.length === 1 ? groupe.codes[0].code : "" };
}

/* Changement d'activité sur une ligne : le code est conservé s'il reste autorisé, choisi d'office
   s'il n'y en a qu'un, vidé sinon. */
export function codeApresChangementActivite(
  codeActuel: string,
  activiteId: string | null,
  groupes: GroupeActiviteGrille[]
): string {
  const groupe = groupes.find((g) => g.activiteId === activiteId);

  if (!groupe) return "";
  if (groupe.codes.some((c) => normaliserCodeGrille(c.code) === normaliserCodeGrille(codeActuel))) return codeActuel;
  if (groupe.codes.length === 1) return groupe.codes[0].code;

  return "";
}

/* Données manquantes d'une imputation (mêmes règles que la validation de la feuille). */
export function problemesLigne(l: LigneGrille, groupes: GroupeActiviteGrille[] = []): string[] {
  const divers = estDiversType(l.typeAffaire);
  const p: string[] = [];

  if (!divers && !/^\d{4}$/.test(l.numeroAffaire.trim())) p.push("numéro d'affaire à 4 chiffres");
  if (!divers && !l.activiteId) p.push("activité manquante");
  if (!l.code) p.push("code manquant");

  if (l.heures.trim() === "") p.push("heures manquantes");
  else if (lireHeures(l.heures) <= 0) p.push("heures à renseigner (supérieures à 0)");

  if (l.code && (divers || l.activiteId) && groupes.length > 0) {
    const groupe = groupes.find((g) => g.activiteId === (divers ? null : l.activiteId));
    const autorise = groupe?.codes.some((c) => normaliserCodeGrille(c.code) === normaliserCodeGrille(l.code));

    if (!autorise) p.push("code non autorisé pour cette activité");
  }

  return p;
}

export type AlerteGrille = { affaire: string; message: string; dates: string[] };

/* Alertes de la semaine, regroupées par affaire et par message. */
export function alertesSemaine(
  jours: JourGrille[],
  groupesParType: (typeAffaire: string) => GroupeActiviteGrille[]
): AlerteGrille[] {
  const regroupees = new Map<string, AlerteGrille>();

  for (const jour of [...jours].sort((a, b) => a.date.localeCompare(b.date))) {
    if (jour.fige) continue;

    for (const ligne of jour.imputations) {
      const commencee = Boolean(
        ligne.activiteId || ligne.code || ligne.heures || ligne.numeroAffaire || ligne.description
      );
      if (!commencee) continue;

      const nom = estDiversType(ligne.typeAffaire) ? "Divers" : `${ligne.typeAffaire} ${ligne.numeroAffaire || "(sans numéro)"}`;

      for (const message of problemesLigne(ligne, groupesParType(ligne.typeAffaire))) {
        const cle = `${nom}|${message}`;
        const existante = regroupees.get(cle) ?? { affaire: nom, message, dates: [] };
        if (!existante.dates.includes(jour.date)) existante.dates.push(jour.date);
        regroupees.set(cle, existante);
      }
    }
  }

  return [...regroupees.values()];
}

/* Jour complet quand l'objectif est atteint ou dépassé (heures en plus = heures supplémentaires). */
export function etatDuJour(objectif: number, saisi: number, fige: boolean, ferie: boolean): EtatJour {
  if (ferie) return "FERIE";
  if (fige) return "ABSENT";
  return saisi + 0.01 >= objectif ? "COMPLET" : "MANQUE";
}

export function ecartJour(j: Pick<JourGrille, "objectif" | "saisi">): { manque: number; supplementaires: number } {
  return {
    manque: Math.max(0, Math.round((j.objectif - j.saisi) * 100) / 100),
    supplementaires: Math.max(0, Math.round((j.saisi - j.objectif) * 100) / 100),
  };
}
