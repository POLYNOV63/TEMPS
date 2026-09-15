"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

/* =========================================================
   TYPES
========================================================= */

type Collaborateur = {
  id: string;
  trigramme: string;
  prenom: string;
  nom: string;
  actif: boolean;
  date_entree?: string | null;
  date_sortie?: string | null;
};

type Ventilation = {
  code: string;
  heures: number;
};

type ImputationDetectee = {
  type: "AFFAIRE" | "DIVERS";
  code: string;

  /*
   * Total affiché dans la colonne D
   */
  totalExcel: number;

  /*
   * Total réellement trouvé dans les
   * colonnes de ventilation
   */
  totalVentile: number;

  /*
   * Différence entre Excel et ventilation
   */
  ecartVentilation: number;

  /*
   * IMPORTANT :
   * heures = heures réellement importables
   * donc totalVentile et PAS totalExcel
   */
  heures: number;

  ventilations: Ventilation[];

  ligneExcel: number;
};

type JourDetecte = {
  date: Date | null;
  jour: string;
  heures: number;
  statut: string;
};

type DonneesFeuille = {
  collaborateur: Collaborateur;
  trigramme?: string;

  totalHeures: number;
  totalTheorique: number;

  jours: JourDetecte[];

  imputations: ImputationDetectee[];

  /*
   * Somme des ventilations réellement détectées
   */
  totalImpute: number;

  /*
   * Différence entre TOTAL Excel
   * et total des ventilations
   */
  ecart: number;

  /*
   * Nombre de lignes d'imputation
   * présentant une incohérence
   */
  anomaliesVentilation: number;
};

type SemaineExcel = {
  nomFeuille: string;
  semaine: number;
  annee: number;
  donnees: DonneesFeuille[];
};

type LigneHistorique = {
  annee: number;
  semaine: number;
  collaborateur_id: string;
  code_imputation: string;
  heures: number;
  source: string;
  affaire_code: string | null;
};

type ResultatImport = {
  feuille: string;
  statut: "OK" | "SKIP" | "ERREUR";
  collaborateurs: number;
  lignes: number;
  heures: number;
  message?: string;
};

/* =========================================================
   CONSTANTES EXCEL
========================================================= */

const COL_TOTAL = 3;

/*
 * E:Y = affaires
 */
const COL_AFFAIRES_DEBUT = 4;
const COL_AFFAIRES_FIN = 24;

/*
 * Z:AO = administratif
 */
const COL_ADMIN_DEBUT = 25;
const COL_ADMIN_FIN = 40;

/*
 * H/Jour, J/Jour, L/Jour, N/Jour, P/Jour
 */
const COL_JOURS = [41, 43, 45, 47, 49];

/* =========================================================
   CONSTANTES IMPORT
========================================================= */

const ANNEE_DEBUT_IMPORT = 2024;
const SEMAINE_DEBUT_IMPORT = 1;

const SOURCE_IMPORT = "IMPORT_EXCEL";

/*
 * Tolérance pour les écarts de calcul.
 */
const TOLERANCE = 0.01;

/* =========================================================
   OUTILS GENERAUX
========================================================= */

function normaliser(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function nombre(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : 0;
  }

  const texte = String(value)
    .replace(/\s/g, "")
    .replace(",", ".");

  const n = Number(texte);

  return Number.isFinite(n) ? n : 0;
}

function arrondir(
  value: number,
  decimals = 2
): number {
  const puissance = Math.pow(
    10,
    decimals
  );

  return (
    Math.round(
      (value + Number.EPSILON) *
        puissance
    ) / puissance
  );
}

function formatHeures(
  value: number
): string {
  return `${arrondir(value, 2)
    .toFixed(2)
    .replace(".", ",")} h`;
}

/*
 * Retourne une chaîne normalisée utilisable
 * pour un code d'imputation.
 */
function normaliserCode(
  value: unknown
): string {
  return normaliser(value)
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   SEMAINE / ANNEE
========================================================= */

function extraireSemaineAnnee(
  nomFeuille: string
): {
  semaine: number;
  annee: number;
} | null {
  const match =
    normaliser(nomFeuille).match(
      /^S\s*(\d{1,2})[-_](\d{4})$/
    );

  if (!match) {
    return null;
  }

  const semaine = Number(match[1]);
  const annee = Number(match[2]);

  if (
    !Number.isInteger(semaine) ||
    semaine < 1 ||
    semaine > 53 ||
    !Number.isInteger(annee)
  ) {
    return null;
  }

  return {
    semaine,
    annee,
  };
}

function comparerSemaines(
  a: {
    semaine: number;
    annee: number;
  },
  b: {
    semaine: number;
    annee: number;
  }
): number {
  if (a.annee !== b.annee) {
    return a.annee - b.annee;
  }

  return a.semaine - b.semaine;
}

function obtenirFeuillesImportables(
  sheetNames: string[]
): string[] {
  const debut = {
    semaine: SEMAINE_DEBUT_IMPORT,
    annee: ANNEE_DEBUT_IMPORT,
  };

  return sheetNames
    .map((nom) => {
      const info =
        extraireSemaineAnnee(nom);

      if (!info) {
        return null;
      }

      return {
        nom,
        semaine: info.semaine,
        annee: info.annee,
      };
    })
    .filter(
      (
        feuille
      ): feuille is {
        nom: string;
        semaine: number;
        annee: number;
      } => feuille !== null
    )
    .filter(
      (feuille) =>
        comparerSemaines(
          feuille,
          debut
        ) >= 0
    )
    .sort((a, b) =>
      comparerSemaines(a, b)
    )
    .map(
      (feuille) => feuille.nom
    );
}

/* =========================================================
   COLLABORATEURS
========================================================= */

function trouverCollaborateur(
  ligne: unknown[],
  collaborateurs: Collaborateur[]
): Collaborateur | null {
  const valeurA = normaliser(
    ligne[0]
  );

  if (!valeurA) {
    return null;
  }

  for (const collaborateur of collaborateurs) {
    const nomPrenom = normaliser(
      `${collaborateur.nom} ${collaborateur.prenom}`
    );

    const prenomNom = normaliser(
      `${collaborateur.prenom} ${collaborateur.nom}`
    );

    if (
      valeurA === nomPrenom ||
      valeurA === prenomNom
    ) {
      return collaborateur;
    }
  }

  return null;
}

function trouverBlocsCollaborateurs(
  rows: unknown[][],
  collaborateurs: Collaborateur[]
): {
  collaborateur: Collaborateur;
  debut: number;
  fin: number;
}[] {
  const blocs: {
    collaborateur: Collaborateur;
    debut: number;
    fin: number;
  }[] = [];

  let blocCourant:
    | {
        collaborateur: Collaborateur;
        debut: number;
      }
    | null = null;

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {
    const collaborateur =
      trouverCollaborateur(
        rows[i],
        collaborateurs
      );

    if (collaborateur) {
      if (blocCourant) {
        blocs.push({
          collaborateur:
            blocCourant.collaborateur,
          debut:
            blocCourant.debut,
          fin: i - 1,
        });
      }

      blocCourant = {
        collaborateur,
        debut: i,
      };
    }
  }

  if (blocCourant) {
    blocs.push({
      collaborateur:
        blocCourant.collaborateur,
      debut:
        blocCourant.debut,
      fin:
        rows.length - 1,
    });
  }

  return blocs;
}

/* =========================================================
   AFFAIRES / DIVERS
========================================================= */

/*
 * On cherche dans les premières colonnes,
 * mais pas uniquement dans A:D.
 *
 * Cela permet de résister à quelques variations
 * de cellules fusionnées / décalées dans Excel.
 */
function texteDebutLigne(
  ligne: unknown[]
): string {
  return ligne
    .slice(0, 10)
    .map((v) =>
      String(v ?? "")
    )
    .join(" ");
}

function detecterAffaire(
  ligne: unknown[]
): boolean {
  const texte =
    texteDebutLigne(ligne);

  return /\b(CBE|DBE)\s*[-:]?\s*\d+\b/i.test(
    texte
  );
}

function extraireCodeAffaire(
  ligne: unknown[]
): string | null {
  const texte =
    texteDebutLigne(ligne);

  const match = texte.match(
    /\b(CBE|DBE)\s*[-:]?\s*(\d+)\b/i
  );

  if (!match) {
    return null;
  }

  return `${match[1].toUpperCase()} ${match[2]}`;
}

function detecterDivers(
  ligne: unknown[]
): boolean {
  const texte =
    texteDebutLigne(ligne);

  const normal =
    normaliser(texte);

  return (
    /\bDIVERS\b/i.test(
      normal
    )
  );
}

/* =========================================================
   ENTETES
========================================================= */

function lireCodesEntete(
  rows: unknown[][],
  debut: number,
  fin: number
): string[] {
  const entete = rows[1] ?? [];

  const codes: string[] = [];

  for (
    let col = debut;
    col <= fin;
    col++
  ) {
    const code =
      normaliserCode(
        entete[col]
      );

    codes.push(code);
  }

  return codes;
}

/* =========================================================
   VENTILATION
========================================================= */

function extraireVentilation(
  ligne: unknown[],
  codes: string[],
  debutCol: number
): Ventilation[] {
  const ventilations: Ventilation[] =
    [];

  for (
    let i = 0;
    i < codes.length;
    i++
  ) {
    const code =
      normaliserCode(
        codes[i]
      );

    if (!code) {
      continue;
    }

    const heures =
      nombre(
        ligne[
          debutCol + i
        ]
      );

    if (
      Math.abs(heures) <=
      TOLERANCE
    ) {
      continue;
    }

    ventilations.push({
      code,
      heures: arrondir(
        heures
      ),
    });
  }

  return ventilations;
}

/* =========================================================
   DATE DU LUNDI
========================================================= */

function trouverDateLundi(
  rows: unknown[][]
): Date | null {
  for (
    let i = 0;
    i <
    Math.min(
      rows.length,
      20
    );
    i++
  ) {
    for (const valeur of
      rows[i] ?? []) {
      if (
        valeur instanceof Date
      ) {
        const date =
          new Date(valeur);

        const jour =
          date.getDay();

        const decalage =
          jour === 0
            ? -6
            : 1 - jour;

        date.setDate(
          date.getDate() +
            decalage
        );

        return date;
      }
    }
  }

  return null;
}

/* =========================================================
   JOURS
========================================================= */

function extraireJours(
  ligne: unknown[],
  lundi: Date | null
): JourDetecte[] {
  const noms = [
    "Lundi",
    "Mardi",
    "Mercredi",
    "Jeudi",
    "Vendredi",
  ];

  return COL_JOURS.map(
    (col, index) => {
      let date: Date | null =
        null;

      if (lundi) {
        date =
          new Date(lundi);

        date.setDate(
          lundi.getDate() +
            index
        );
      }

      const heures =
        nombre(ligne[col]);

      const statut =
        String(
          ligne[col + 1] ??
            ""
        ).trim();

      return {
        date,
        jour: noms[index],
        heures,
        statut,
      };
    }
  );
}

/* =========================================================
   IMPUTATIONS
========================================================= */

function extraireImputations(
  rows: unknown[][],
  debut: number,
  fin: number
): ImputationDetectee[] {
  const imputations: ImputationDetectee[] =
    [];

  const codesAffaires =
    lireCodesEntete(
      rows,
      COL_AFFAIRES_DEBUT,
      COL_AFFAIRES_FIN
    );

  const codesAdmin =
    lireCodesEntete(
      rows,
      COL_ADMIN_DEBUT,
      COL_ADMIN_FIN
    );

  for (
    let i = debut;
    i <= fin;
    i++
  ) {
    const ligne =
      rows[i] ?? [];

    let type:
      | "AFFAIRE"
      | "DIVERS"
      | null = null;

    let code =
      "";

    let ventilations: Ventilation[] =
      [];

    /* =====================================================
       AFFAIRE
    ===================================================== */

    if (
      detecterAffaire(
        ligne
      )
    ) {
      const codeAffaire =
        extraireCodeAffaire(
          ligne
        );

      if (!codeAffaire) {
        continue;
      }

      type = "AFFAIRE";
      code = codeAffaire;

      ventilations =
        extraireVentilation(
          ligne,
          codesAffaires,
          COL_AFFAIRES_DEBUT
        );
    }

    /* =====================================================
       DIVERS
    ===================================================== */

    else if (
      detecterDivers(
        ligne
      )
    ) {
      type = "DIVERS";
      code = "DIVERS";

      ventilations =
        extraireVentilation(
          ligne,
          codesAdmin,
          COL_ADMIN_DEBUT
        );
    }

    /*
     * Ce n'est ni une affaire ni Divers.
     */
    if (!type) {
      continue;
    }

    /* =====================================================
       CALCUL DES TOTAUX
    ===================================================== */

    const totalExcel =
      arrondir(
        nombre(
          ligne[COL_TOTAL]
        )
      );

    const totalVentile =
      arrondir(
        ventilations.reduce(
          (somme, ventilation) =>
            somme +
            ventilation.heures,
          0
        )
      );

    const ecartVentilation =
      arrondir(
        totalExcel -
          totalVentile
      );

    /*
     * IMPORTANT :
     *
     * Les heures réellement importables
     * sont les heures ventilées.
     *
     * On ne prend JAMAIS automatiquement
     * le total de la colonne D.
     */
    const heures =
      totalVentile;

    /*
     * Cas totalement vide :
     *
     * Divers avec D vide et aucune ventilation
     * CBE sans heures et sans ventilation
     *
     * => on ignore proprement.
     */
    if (
      Math.abs(totalExcel) <=
        TOLERANCE &&
      Math.abs(totalVentile) <=
        TOLERANCE
    ) {
      continue;
    }

    /*
     * Cas dangereux :
     *
     * Excel dit 30 h
     * mais on ne trouve que 25 h
     *
     * On conserve la ligne pour diagnostic,
     * mais on n'invente PAS les 5 h manquantes.
     */
    if (
      Math.abs(
        ecartVentilation
      ) > TOLERANCE
    ) {
      console.warn(
        `[IMPORT] Écart ventilation ${code} ligne ${
          i + 1
        }`,
        {
          totalExcel,
          totalVentile,
          ecartVentilation,
          ventilations,
        }
      );
    }

    /*
     * On ne crée une imputation que si
     * des heures sont réellement ventilées.
     *
     * Cela empêche d'importer une fausse ligne
     * avec un total Excel mais aucune ventilation.
     */
    if (
      totalVentile <=
      TOLERANCE
    ) {
      continue;
    }

    imputations.push({
      type,
      code,
      totalExcel,
      totalVentile,
      ecartVentilation,
      heures,
      ventilations,
      ligneExcel: i + 1,
    });
  }

  return imputations;
}

/* =========================================================
   ANALYSE D'UNE FEUILLE
========================================================= */

function analyserFeuille(
  rows: unknown[][],
  nomFeuille: string,
  collaborateurs: Collaborateur[]
): SemaineExcel {
  const info =
    extraireSemaineAnnee(
      nomFeuille
    );

  if (!info) {
    throw new Error(
      `Nom de feuille invalide : ${nomFeuille}`
    );
  }

  const blocs =
    trouverBlocsCollaborateurs(
      rows,
      collaborateurs
    );

  const lundi =
    trouverDateLundi(rows);

  const donnees: DonneesFeuille[] =
    [];

  for (const bloc of blocs) {
    let ligneHJour = -1;

    /*
     * Recherche de H/Jour
     * dans les premières lignes du bloc.
     */
    for (
      let i = bloc.debut;
      i <=
      Math.min(
        bloc.fin,
        bloc.debut + 10
      );
      i++
    ) {
      const ligne =
        rows[i] ?? [];

      const texte =
        ligne
          .slice(0, 10)
          .map((v) =>
            normaliser(v)
          )
          .join(" ");

      if (
        texte.includes(
          "H/JOUR"
        ) ||
        texte.includes(
          "H / JOUR"
        )
      ) {
        ligneHJour = i;
        break;
      }
    }

    if (
      ligneHJour === -1
    ) {
      console.warn(
        `H/Jour introuvable pour ${bloc.collaborateur.nom} ${bloc.collaborateur.prenom}`
      );

      continue;
    }

    const ligneHeures =
      rows[ligneHJour] ??
      [];

    let ligneTotal = -1;

    /*
     * Recherche de la ligne TOTAL.
     */
    for (
      let i = ligneHJour;
      i <= bloc.fin;
      i++
    ) {
      const ligne =
        rows[i] ?? [];

      const texte =
        ligne
          .slice(0, 10)
          .map((v) =>
            normaliser(v)
          )
          .join(" ");

      if (
        texte.includes(
          "TOTAL"
        ) &&
        nombre(
          ligne[COL_TOTAL]
        ) >= 0 &&
        nombre(
          ligne[COL_TOTAL]
        ) <= 60
      ) {
        ligneTotal = i;
        break;
      }
    }

    const totalHeures =
      ligneTotal >= 0
        ? arrondir(
            nombre(
              rows[
                ligneTotal
              ]?.[
                COL_TOTAL
              ]
            )
          )
        : arrondir(
            COL_JOURS.reduce(
              (
                somme,
                col
              ) =>
                somme +
                nombre(
                  ligneHeures[
                    col
                  ]
                ),
              0
            )
          );

    const jours =
      extraireJours(
        ligneHeures,
        lundi
      );

    /*
     * IMPORTANT :
     *
     * On analyse TOUT le bloc
     * du collaborateur.
     *
     * PAS seulement à partir de H/Jour.
     */
    const imputations =
      extraireImputations(
        rows,
        bloc.debut,
        bloc.fin
      );

    /*
     * Total des heures réellement ventilées.
     */
    const totalImpute =
      arrondir(
        imputations.reduce(
          (
            somme,
            imputation
          ) =>
            somme +
            imputation.totalVentile,
          0
        )
      );

    /*
     * Nombre d'imputations présentant
     * un écart entre D et les ventilations.
     */
    const anomaliesVentilation =
      imputations.filter(
        (imputation) =>
          Math.abs(
            imputation.ecartVentilation
          ) > TOLERANCE
      ).length;

    /*
     * Ecart global :
     *
     * TOTAL Excel
     * -
     * somme des ventilations
     */
    const ecart =
      arrondir(
        totalHeures -
          totalImpute
      );

    console.log(
      `[${nomFeuille}] ${bloc.collaborateur.nom} ${bloc.collaborateur.prenom}`,
      {
        bloc: `${bloc.debut + 1} → ${
          bloc.fin + 1
        }`,
        totalExcel:
          totalHeures,
        totalVentile:
          totalImpute,
        ecart,
        imputations:
          imputations.length,
        anomaliesVentilation,
      }
    );

    donnees.push({
      collaborateur:
        bloc.collaborateur,

      trigramme:
        bloc.collaborateur
          .trigramme,

      totalHeures,

      /*
       * On conserve 35 pour le moment,
       * comme dans la version précédente.
       *
       * Ce champ n'est pas utilisé pour
       * déterminer les heures historiques.
       */
      totalTheorique: 35,

      jours,

      imputations,

      totalImpute,

      ecart,

      anomaliesVentilation,
    });
  }

  return {
    nomFeuille,
    semaine: info.semaine,
    annee: info.annee,
    donnees,
  };
}

/* =========================================================
   CONSTRUCTION HISTORIQUE
========================================================= */

function construireLignesHistorique(
  semaine: SemaineExcel
): LigneHistorique[] {
  const lignes: LigneHistorique[] =
    [];

  for (const donnees of
    semaine.donnees) {
    for (const imputation of
      donnees.imputations) {
      /*
       * On importe UNIQUEMENT les ventilations.
       *
       * Exemple :
       *
       * CBE 1631
       * EE = 30
       *
       * devient :
       *
       * EE / 30 / CBE 1631
       */

      for (const ventilation of
        imputation.ventilations) {
        if (
          ventilation.heures <=
          TOLERANCE
        ) {
          continue;
        }

        lignes.push({
          annee:
            semaine.annee,

          semaine:
            semaine.semaine,

          collaborateur_id:
            donnees
              .collaborateur
              .id,

          code_imputation:
            ventilation.code,

          heures:
            arrondir(
              ventilation.heures
            ),

          source:
            SOURCE_IMPORT,

          affaire_code:
            imputation.type ===
            "AFFAIRE"
              ? imputation.code
              : null,
        });
      }
    }
  }

  return lignes;
}

/* =========================================================
   PAGE
========================================================= */

export default function ImportHistoriqueV2() {
  const [
    collaborateurs,
    setCollaborateurs,
  ] = useState<Collaborateur[]>([]);

  const [
    fichier,
    setFichier,
  ] = useState<File | null>(
    null
  );

  const [
    nomFichier,
    setNomFichier,
  ] = useState("");

  const [
    feuillesDisponibles,
    setFeuillesDisponibles,
  ] = useState<string[]>([]);

  const [
    semainesAnalysees,
    setSemainesAnalysees,
  ] = useState<SemaineExcel[]>([]);

  const [
    chargement,
    setChargement,
  ] = useState(false);

  const [
    importEnCours,
    setImportEnCours,
  ] = useState(false);

  const [
    progression,
    setProgression,
  ] = useState(0);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    erreur,
    setErreur,
  ] = useState("");

  const [
    resultatsImport,
    setResultatsImport,
  ] = useState<
    ResultatImport[]
  >([]);

/* =======================================================
   CHARGEMENT COLLABORATEURS
======================================================= */

  useEffect(() => {
    chargerCollaborateurs();
  }, []);

  async function chargerCollaborateurs() {
    setChargement(true);
    setErreur("");

    const { data, error } =
      await supabase
        .from("collaborateurs")
        .select(
          `
          id,
          trigramme,
          prenom,
          nom,
          actif,
          date_entree,
          date_sortie
        `
        )
        .order("nom")
        .order("prenom");

    if (error) {
      setErreur(
        `Impossible de charger les collaborateurs : ${error.message}`
      );

      setChargement(false);
      return;
    }

    setCollaborateurs(
      (data ??
        []) as Collaborateur[]
    );

    setChargement(false);
  }

/* =======================================================
   SELECTION FICHIER
======================================================= */

  async function handleFichier(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selected =
      event.target.files?.[0];

    if (!selected) {
      return;
    }

    setFichier(selected);

    setNomFichier(
      selected.name
    );

    setSemainesAnalysees([]);

    setResultatsImport([]);

    setErreur("");

    setMessage("");

    setProgression(0);

    try {
      const buffer =
        await selected.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",
          cellDates: true,
        });

      const feuilles =
        obtenirFeuillesImportables(
          workbook.SheetNames
        );

      if (
        feuilles.length ===
        0
      ) {
        throw new Error(
          "Aucune feuille comprise entre S01-2024 et une feuille récente n'a été trouvée."
        );
      }

      setFeuillesDisponibles(
        feuilles
      );

      const premiere =
        feuilles[0];

      const derniere =
        feuilles[
          feuilles.length - 1
        ];

      setMessage(
        `${feuilles.length} feuilles importables détectées : ${premiere} → ${derniere}.`
      );
    } catch (e) {
      setErreur(
        e instanceof Error
          ? e.message
          : "Erreur lors de la lecture du fichier."
      );
    }
  }

/* =======================================================
   ANALYSE TOUT LE CLASSEUR
======================================================= */

  async function analyserToutLeClasseur() {
    if (!fichier) {
      setErreur(
        "Sélectionne d'abord le fichier Excel."
      );
      return;
    }

    if (
      collaborateurs.length ===
      0
    ) {
      setErreur(
        "Aucun collaborateur n'est chargé depuis Supabase."
      );
      return;
    }

    setChargement(true);
    setErreur("");
    setMessage("");
    setSemainesAnalysees([]);
    setResultatsImport([]);
    setProgression(0);

    try {
      const buffer =
        await fichier.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",
          cellDates: true,
        });

      const feuilles =
        obtenirFeuillesImportables(
          workbook.SheetNames
        );

      const resultats: SemaineExcel[] =
        [];

      for (
        let index = 0;
        index <
        feuilles.length;
        index++
      ) {
        const nomFeuille =
          feuilles[index];

        const sheet =
          workbook.Sheets[
            nomFeuille
          ];

        if (!sheet) {
          continue;
        }

        const rows =
          XLSX.utils.sheet_to_json(
            sheet,
            {
              header: 1,
              defval: "",
              raw: true,
            }
          ) as unknown[][];

        try {
          const analyse =
            analyserFeuille(
              rows,
              nomFeuille,
              collaborateurs
            );

          resultats.push(
            analyse
          );
        } catch (e) {
          console.error(
            `Erreur analyse ${nomFeuille}`,
            e
          );
        }

        setProgression(
          Math.round(
            ((index + 1) /
              feuilles.length) *
              100
          )
        );

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              0
            )
        );
      }

      setSemainesAnalysees(
        resultats
      );

      const nbCollaborateurs =
        resultats.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees
              .length,
          0
        );

      const nbImputations =
        resultats.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.reduce(
              (
                somme,
                d
              ) =>
                somme +
                d.imputations
                  .length,
              0
            ),
          0
        );

      /*
       * IMPORTANT :
       * heures = heures réellement ventilées.
       */
      const heures =
        resultats.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.reduce(
              (
                somme,
                d
              ) =>
                somme +
                d.totalImpute,
              0
            ),
          0
        );

      const anomalies =
        resultats.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.reduce(
              (
                somme,
                d
              ) =>
                somme +
                d.anomaliesVentilation,
              0
            ),
          0
        );

      setMessage(
        `Analyse terminée : ${resultats.length} semaines, ${nbCollaborateurs} feuilles collaborateurs, ${nbImputations} imputations, ${formatHeures(
          heures
        )} ventilées${
          anomalies > 0
            ? `, ${anomalies} anomalie(s) de ventilation.`
            : "."
        }`
      );
    } catch (e) {
      setErreur(
        e instanceof Error
          ? e.message
          : "Erreur pendant l'analyse."
      );
    }

    setChargement(false);
  }

/* =======================================================
   STATISTIQUES
======================================================= */

  const statistiques =
    useMemo(() => {
      const collaborateurs =
        semainesAnalysees.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees
              .length,
          0
        );

      const heuresExcel =
        semainesAnalysees.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.reduce(
              (
                somme,
                d
              ) =>
                somme +
                d.totalHeures,
              0
            ),
          0
        );

      const heuresImputees =
        semainesAnalysees.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.reduce(
              (
                somme,
                d
              ) =>
                somme +
                d.totalImpute,
              0
            ),
          0
        );

      const lignes =
        semainesAnalysees.reduce(
          (
            total,
            semaine
          ) =>
            total +
            construireLignesHistorique(
              semaine
            ).length,
          0
        );

      const ecarts =
        semainesAnalysees.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.filter(
              (d) =>
                Math.abs(
                  d.ecart
                ) > TOLERANCE
            ).length,
          0
        );

      const anomalies =
        semainesAnalysees.reduce(
          (
            total,
            semaine
          ) =>
            total +
            semaine.donnees.reduce(
              (
                somme,
                d
              ) =>
                somme +
                d.anomaliesVentilation,
              0
            ),
          0
        );

      return {
        semaines:
          semainesAnalysees.length,

        collaborateurs,

        heuresExcel,

        heuresImputees,

        lignes,

        ecarts,

        anomalies,
      };
    }, [
      semainesAnalysees,
    ]);

/* =======================================================
   VERIFICATION DES CODES
======================================================= */

  async function verifierCodes(
    lignes: LigneHistorique[]
  ) {
    const codesUniques =
      Array.from(
        new Set(
          lignes.map(
            (ligne) =>
              ligne.code_imputation
          )
        )
      );

    if (
      codesUniques.length ===
      0
    ) {
      return {
        ok: false,
        codesManquants: [],
      };
    }

    const { data, error } =
      await supabase
        .from(
          "codes_imputation"
        )
        .select("code")
        .in(
          "code",
          codesUniques
        );

    if (error) {
      throw new Error(
        `Impossible de vérifier les codes d'imputation : ${error.message}`
      );
    }

    const codesExistants =
      new Set(
        (data ?? []).map(
          (ligne) =>
            normaliserCode(
              ligne.code
            )
        )
      );

    const codesManquants =
      codesUniques.filter(
        (code) =>
          !codesExistants.has(
            normaliserCode(
              code
            )
          )
      );

    return {
      ok:
        codesManquants.length ===
        0,

      codesManquants,
    };
  }

/* =======================================================
   IMPORT D'UNE SEMAINE
======================================================= */

  async function importerSemaine(
    semaine: SemaineExcel
  ): Promise<ResultatImport> {
    const lignes =
      construireLignesHistorique(
        semaine
      );

    if (
      lignes.length ===
      0
    ) {
      return {
        feuille:
          semaine.nomFeuille,

        statut: "SKIP",

        collaborateurs:
          semaine.donnees
            .length,

        lignes: 0,

        heures: 0,

        message:
          "Aucune ventilation importable.",
      };
    }

    /*
     * Vérification des codes
     * AVANT toute suppression.
     */
    const verification =
      await verifierCodes(
        lignes
      );

    if (!verification.ok) {
      return {
        feuille:
          semaine.nomFeuille,

        statut: "ERREUR",

        collaborateurs:
          semaine.donnees
            .length,

        lignes: 0,

        heures: 0,

        message:
          `Codes inconnus : ${verification.codesManquants.join(
            ", "
          )}`,
      };
    }

    const collaborateursIds =
      Array.from(
        new Set(
          lignes.map(
            (ligne) =>
              ligne.collaborateur_id
          )
        )
      );

    /*
     * Recherche de données déjà importées.
     */
    const {
      data: existantes,
      error: errorExistantes,
    } = await supabase
      .from(
        "historique_imputations"
      )
      .select(
        "id, collaborateur_id"
      )
      .eq(
        "annee",
        semaine.annee
      )
      .eq(
        "semaine",
        semaine.semaine
      )
      .eq(
        "source",
        SOURCE_IMPORT
      )
      .in(
        "collaborateur_id",
        collaborateursIds
      );

    if (errorExistantes) {
      return {
        feuille:
          semaine.nomFeuille,

        statut: "ERREUR",

        collaborateurs:
          semaine.donnees
            .length,

        lignes: 0,

        heures: 0,

        message:
          `Erreur lors du contrôle des doublons : ${errorExistantes.message}`,
      };
    }

    /*
     * Si la semaine existe déjà,
     * on la remplace.
     */
    if (
      existantes &&
      existantes.length > 0
    ) {
      const {
        error: errorDelete,
      } = await supabase
        .from(
          "historique_imputations"
        )
        .delete()
        .eq(
          "annee",
          semaine.annee
        )
        .eq(
          "semaine",
          semaine.semaine
        )
        .eq(
          "source",
          SOURCE_IMPORT
        )
        .in(
          "collaborateur_id",
          collaborateursIds
        );

      if (errorDelete) {
        return {
          feuille:
            semaine.nomFeuille,

          statut: "ERREUR",

          collaborateurs:
            semaine.donnees
              .length,

          lignes: 0,

          heures: 0,

          message:
            `Impossible de remplacer les anciennes données : ${errorDelete.message}`,
        };
      }
    }

    /*
     * Insertion par lots.
     */
    const TAILLE_LOT =
      500;

    for (
      let i = 0;
      i < lignes.length;
      i +=
        TAILLE_LOT
    ) {
      const lot =
        lignes.slice(
          i,
          i +
            TAILLE_LOT
        );

      const { error } =
        await supabase
          .from(
            "historique_imputations"
          )
          .insert(lot);

      if (error) {
        /*
         * Nettoyage de sécurité.
         */
        await supabase
          .from(
            "historique_imputations"
          )
          .delete()
          .eq(
            "annee",
            semaine.annee
          )
          .eq(
            "semaine",
            semaine.semaine
          )
          .eq(
            "source",
            SOURCE_IMPORT
          )
          .in(
            "collaborateur_id",
            collaborateursIds
          );

        return {
          feuille:
            semaine.nomFeuille,

          statut: "ERREUR",

          collaborateurs:
            semaine.donnees
              .length,

          lignes: 0,

          heures: 0,

          message:
            `Erreur Supabase : ${error.message}`,
        };
      }
    }

    const heures =
      lignes.reduce(
        (
          total,
          ligne
        ) =>
          total +
          ligne.heures,
        0
      );

    return {
      feuille:
        semaine.nomFeuille,

      statut: "OK",

      collaborateurs:
        semaine.donnees
          .length,

      lignes:
        lignes.length,

      heures:
        arrondir(
          heures
        ),

      message:
        existantes &&
        existantes.length > 0
          ? "Semaine remplacée"
          : "Importée",
    };
  }

/* =======================================================
   IMPORT GLOBAL
======================================================= */

  async function importerTout() {
    if (
      semainesAnalysees.length ===
      0
    ) {
      setErreur(
        "Il faut d'abord analyser le classeur."
      );
      return;
    }

    /*
     * On bloque l'import si l'analyse
     * présente encore des écarts.
     *
     * Pourquoi ?
     *
     * Parce qu'on ne veut surtout pas
     * mettre en base un historique incomplet
     * sans que l'utilisateur le sache.
     */
    if (
      statistiques.ecarts >
      0
    ) {
      const continuer =
        window.confirm(
          `ATTENTION\n\n${statistiques.ecarts} feuille(s) présentent un écart entre le TOTAL Excel et les heures ventilées.\n\nLes heures non ventilées ne seront PAS inventées et ne seront PAS importées.\n\nVeux-tu malgré tout continuer ?`
        );

      if (!continuer) {
        return;
      }
    }

    const premiere =
      semainesAnalysees[0];

    const derniere =
      semainesAnalysees[
        semainesAnalysees.length -
          1
      ];

    const confirmation =
      window.confirm(
        `IMPORT MASSIF\n\n${semainesAnalysees.length} semaines vont être importées.\n\nPériode : ${premiere.nomFeuille} → ${derniere.nomFeuille}\n\nLes données IMPORT_EXCEL déjà présentes pour ces semaines seront remplacées.\n\nOn fonce ?`
      );

    if (!confirmation) {
      return;
    }

    setImportEnCours(true);

    setErreur("");

    setMessage("");

    setResultatsImport([]);

    setProgression(0);

    const resultats: ResultatImport[] =
      [];

    for (
      let i = 0;
      i <
      semainesAnalysees.length;
      i++
    ) {
      const semaine =
        semainesAnalysees[i];

      try {
        const resultat =
          await importerSemaine(
            semaine
          );

        resultats.push(
          resultat
        );
      } catch (e) {
        resultats.push({
          feuille:
            semaine.nomFeuille,

          statut:
            "ERREUR",

          collaborateurs:
            semaine.donnees
              .length,

          lignes: 0,

          heures: 0,

          message:
            e instanceof Error
              ? e.message
              : "Erreur inconnue",
        });
      }

      setResultatsImport([
        ...resultats,
      ]);

      setProgression(
        Math.round(
          ((i + 1) /
            semainesAnalysees.length) *
            100
        )
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            0
          )
      );
    }

    const ok =
      resultats.filter(
        (r) =>
          r.statut ===
          "OK"
      );

    const erreurs =
      resultats.filter(
        (r) =>
          r.statut ===
          "ERREUR"
      );

    const ignores =
      resultats.filter(
        (r) =>
          r.statut ===
          "SKIP"
      );

    const lignes =
      ok.reduce(
        (
          total,
          r
        ) =>
          total +
          r.lignes,
        0
      );

    const heures =
      ok.reduce(
        (
          total,
          r
        ) =>
          total +
          r.heures,
        0
      );

    if (
      erreurs.length ===
      0
    ) {
      setMessage(
        `🎉 IMPORT TERMINÉ : ${ok.length} semaines importées, ${ignores.length} ignorées, ${lignes.toLocaleString(
          "fr-FR"
        )} lignes et ${formatHeures(
          heures
        )} importées dans historique_imputations.`
      );
    } else {
      setErreur(
        `Import terminé avec ${erreurs.length} erreur(s). ${ok.length} semaine(s) importée(s) correctement.`
      );
    }

    setImportEnCours(false);
  }

/* =======================================================
   RESET
======================================================= */

  function reset() {
    setFichier(null);
    setNomFichier("");
    setFeuillesDisponibles([]);
    setSemainesAnalysees([]);
    setResultatsImport([]);
    setMessage("");
    setErreur("");
    setProgression(0);
  }

/* =======================================================
   RENDU
======================================================= */

  return (
    <div
      style={{
        minHeight:
          "100vh",

        background:
          "#f4f5f7",

        fontFamily:
          "Calibri, Arial, sans-serif",

        color:
          "#222",
      }}
    >
      {/* =================================================
          HEADER
      ================================================= */}

      <div
        style={{
          background:
            "#c00000",

          color:
            "white",

          padding:
            "24px 32px",

          boxShadow:
            "0 3px 10px rgba(0,0,0,0.12)",
        }}
      >
        <div
          style={{
            maxWidth:
              1400,

            margin:
              "0 auto",
          }}
        >
          <div
            style={{
              fontSize:
                30,

              fontWeight:
                700,
            }}
          >
            Import historique
          </div>

          <div
            style={{
              marginTop:
                5,

              fontSize:
                16,

              opacity:
                0.92,
            }}
          >
            Import massif des
            feuilles Excel vers
            l'historique POLYNOV
          </div>
        </div>
      </div>

      {/* =================================================
          CONTENU
      ================================================= */}

      <div
        style={{
          maxWidth:
            1400,

          margin:
            "30px auto",

          padding:
            "0 24px 50px",
        }}
      >
        {/* =================================================
            CHARGEMENT
        ================================================= */}

        {chargement && (
          <div
            style={{
              background:
                "white",

              borderRadius:
                12,

              padding:
                18,

              marginBottom:
                20,

              border:
                "1px solid #ddd",

              fontWeight:
                600,
            }}
          >
            ⏳ Analyse en cours…
          </div>
        )}

        {/* =================================================
            1 - FICHIER
        ================================================= */}

        <div
          style={{
            background:
              "white",

            borderRadius:
              14,

            padding:
              24,

            boxShadow:
              "0 2px 10px rgba(0,0,0,0.06)",

            marginBottom:
              24,
          }}
        >
          <div
            style={{
              display:
                "flex",

              justifyContent:
                "space-between",

              alignItems:
                "center",

              gap:
                20,

              flexWrap:
                "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize:
                    21,

                  fontWeight:
                    700,

                  marginBottom:
                    5,
                }}
              >
                1. Sélectionner le
                fichier Excel
              </div>

              <div
                style={{
                  color:
                    "#666",
                }}
              >
                L'import démarre à{" "}
                <strong>
                  S01-2024
                </strong>{" "}
                et va jusqu'à la
                feuille la plus
                récente trouvée.
              </div>
            </div>

            <label
              style={{
                display:
                  "inline-flex",

                alignItems:
                  "center",

                justifyContent:
                  "center",

                padding:
                  "12px 20px",

                background:
                  "#c00000",

                color:
                  "white",

                borderRadius:
                  8,

                cursor:
                  "pointer",

                fontWeight:
                  700,

                boxShadow:
                  "0 2px 5px rgba(192,0,0,0.25)",
              }}
            >
              📁 Choisir le fichier

              <input
                type="file"
                accept=".xls,.xlsx,.xlsm"
                onChange={
                  handleFichier
                }
                style={{
                  display:
                    "none",
                }}
              />
            </label>
          </div>

          {nomFichier && (
            <div
              style={{
                marginTop:
                  18,

                padding:
                  14,

                background:
                  "#f7f7f7",

                borderRadius:
                  8,

                border:
                  "1px solid #e2e2e2",
              }}
            >
              <strong>
                Fichier :
              </strong>{" "}
              {nomFichier}

              {feuillesDisponibles.length >
                0 && (
                <div
                  style={{
                    marginTop:
                      8,

                    color:
                      "#555",
                  }}
                >
                  <strong>
                    Période détectée :
                  </strong>{" "}
                  {
                    feuillesDisponibles[0]
                  }{" "}
                  →{" "}
                  {
                    feuillesDisponibles[
                      feuillesDisponibles.length -
                        1
                    ]
                  }{" "}
                  (
                  {
                    feuillesDisponibles.length
                  }{" "}
                  feuilles)
                </div>
              )}
            </div>
          )}
        </div>

        {/* =================================================
            2 - ANALYSE
        ================================================= */}

        {fichier && (
          <div
            style={{
              background:
                "white",

              borderRadius:
                14,

              padding:
                24,

              marginBottom:
                24,

              boxShadow:
                "0 2px 10px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                fontSize:
                  21,

                fontWeight:
                  700,

                marginBottom:
                  5,
              }}
            >
              2. Analyser tout le
              classeur
            </div>

            <div
              style={{
                color:
                  "#666",

                marginBottom:
                  18,
              }}
            >
              Les feuilles avant{" "}
              <strong>
                S01-2024
              </strong>{" "}
              seront ignorées.
            </div>

            <div
              style={{
                display:
                  "flex",

                gap:
                  12,

                flexWrap:
                  "wrap",
              }}
            >
              <button
                onClick={
                  analyserToutLeClasseur
                }
                disabled={
                  chargement ||
                  importEnCours
                }
                style={{
                  border:
                    "none",

                  borderRadius:
                    8,

                  padding:
                    "13px 22px",

                  background:
                    chargement
                      ? "#aaa"
                      : "#333",

                  color:
                    "white",

                  fontWeight:
                    700,

                  fontSize:
                    15,

                  cursor:
                    chargement
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                🔎 Analyser tout le
                classeur
              </button>

              <button
                onClick={
                  reset
                }
                disabled={
                  chargement ||
                  importEnCours
                }
                style={{
                  border:
                    "1px solid #ccc",

                  borderRadius:
                    8,

                  padding:
                    "13px 22px",

                  background:
                    "white",

                  color:
                    "#555",

                  fontWeight:
                    700,

                  fontSize:
                    15,

                  cursor:
                    "pointer",
                }}
              >
                ↺ Réinitialiser
              </button>
            </div>
          </div>
        )}

        {/* =================================================
            3 - STATISTIQUES
        ================================================= */}

        {semainesAnalysees.length >
          0 && (
          <>
            <div
              style={{
                fontSize:
                  21,

                fontWeight:
                  700,

                marginBottom:
                  14,
              }}
            >
              3. Résultat de
              l'analyse
            </div>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fit, minmax(180px, 1fr))",

                gap:
                  14,

                marginBottom:
                  24,
              }}
            >
              <StatCard
                titre="Semaines"
                valeur={String(
                  statistiques.semaines
                )}
              />

              <StatCard
                titre="Feuilles collaborateurs"
                valeur={String(
                  statistiques.collaborateurs
                )}
              />

              <StatCard
                titre="Heures Excel"
                valeur={formatHeures(
                  statistiques.heuresExcel
                )}
              />

              <StatCard
                titre="Heures réellement ventilées"
                valeur={formatHeures(
                  statistiques.heuresImputees
                )}
              />

              <StatCard
                titre="Lignes à importer"
                valeur={statistiques.lignes.toLocaleString(
                  "fr-FR"
                )}
              />

              <StatCard
                titre="Écarts détectés"
                valeur={String(
                  statistiques.ecarts
                )}
                danger={
                  statistiques.ecarts >
                  0
                }
              />
            </div>

            {statistiques.anomalies >
              0 && (
              <div
                style={{
                  background:
                    "#fff8e8",

                  border:
                    "1px solid #efd28a",

                  color:
                    "#7a5a00",

                  borderRadius:
                    10,

                  padding:
                    15,

                  marginBottom:
                    24,

                  fontWeight:
                    600,
                }}
              >
                ⚠️{" "}
                {
                  statistiques.anomalies
                }{" "}
                ligne(s)
                d'imputation
                présentent une
                différence entre
                leur total Excel et
                leur ventilation.
                <br />
                <span
                  style={{
                    fontWeight:
                      400,

                    fontSize:
                      14,
                  }}
                >
                  Les heures
                  manquantes ne sont
                  pas inventées : seules
                  les heures réellement
                  ventilées seront
                  importées.
                </span>
              </div>
            )}

            {/* =================================================
                4 - IMPORT
            ================================================= */}

            <div
              style={{
                background:
                  "linear-gradient(135deg, #ffffff 0%, #fafafa 100%)",

                borderRadius:
                  14,

                padding:
                  28,

                marginBottom:
                  24,

                border:
                  "2px solid #c00000",

                boxShadow:
                  "0 4px 15px rgba(192,0,0,0.10)",
              }}
            >
              <div
                style={{
                  fontSize:
                    23,

                  fontWeight:
                    700,

                  marginBottom:
                    6,
                }}
              >
                4. Import massif
              </div>

              <div
                style={{
                  color:
                    "#666",

                  marginBottom:
                    20,
                }}
              >
                <strong>
                  {
                    statistiques.semaines
                  }{" "}
                  semaines
                </strong>{" "}
                vont être importées
                dans{" "}
                <strong>
                  historique_imputations
                </strong>
                .
              </div>

              {progression >
                0 &&
                (importEnCours ||
                  progression ===
                    100) && (
                  <div
                    style={{
                      marginBottom:
                        20,
                    }}
                  >
                    <div
                      style={{
                        display:
                          "flex",

                        justifyContent:
                          "space-between",

                        marginBottom:
                          7,

                        fontWeight:
                          700,
                      }}
                    >
                      <span>
                        Progression
                      </span>

                      <span>
                        {
                          progression
                        }{" "}
                        %
                      </span>
                    </div>

                    <div
                      style={{
                        height:
                          12,

                        background:
                          "#e5e5e5",

                        borderRadius:
                          20,

                        overflow:
                          "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progression}%`,

                          height:
                            "100%",

                          background:
                            "#c00000",

                          transition:
                            "width 0.2s ease",
                        }}
                      />
                    </div>
                  </div>
                )}

              <button
                onClick={
                  importerTout
                }
                disabled={
                  importEnCours
                }
                style={{
                  width:
                    "100%",

                  border:
                    "none",

                  borderRadius:
                    10,

                  padding:
                    "17px 24px",

                  background:
                    importEnCours
                      ? "#999"
                      : "#c00000",

                  color:
                    "white",

                  fontWeight:
                    800,

                  fontSize:
                    18,

                  cursor:
                    importEnCours
                      ? "not-allowed"
                      : "pointer",

                  boxShadow:
                    importEnCours
                      ? "none"
                      : "0 4px 10px rgba(192,0,0,0.25)",
                }}
              >
                {importEnCours
                  ? "⏳ IMPORT EN COURS…"
                  : "🚀 IMPORTER TOUT L'HISTORIQUE"}
              </button>
            </div>
          </>
        )}

        {/* =================================================
            MESSAGES
        ================================================= */}

        {message && (
          <div
            style={{
              background:
                "#eaf7ee",

              color:
                "#176b35",

              border:
                "1px solid #b7dfc2",

              borderRadius:
                10,

              padding:
                16,

              marginBottom:
                18,

              fontWeight:
                600,
            }}
          >
            {message}
          </div>
        )}

        {erreur && (
          <div
            style={{
              background:
                "#fff1f1",

              color:
                "#a00000",

              border:
                "1px solid #efb5b5",

              borderRadius:
                10,

              padding:
                16,

              marginBottom:
                18,

              fontWeight:
                600,

              whiteSpace:
                "pre-wrap",
            }}
          >
            ❌ {erreur}
          </div>
        )}

        {/* =================================================
            RESULTATS IMPORT
        ================================================= */}

        {resultatsImport.length >
          0 && (
          <div
            style={{
              background:
                "white",

              borderRadius:
                14,

              padding:
                24,

              boxShadow:
                "0 2px 10px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                fontSize:
                  21,

                fontWeight:
                  700,

                marginBottom:
                  16,
              }}
            >
              Suivi de l'import
            </div>

            <div
              style={{
                display:
                  "flex",

                flexDirection:
                  "column",

                gap:
                  7,

                maxHeight:
                  600,

                overflowY:
                  "auto",
              }}
            >
              {resultatsImport.map(
                (
                  resultat
                ) => (
                  <div
                    key={
                      resultat.feuille
                    }
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "100px 1fr 120px 130px 1fr",

                      gap:
                        12,

                      alignItems:
                        "center",

                      padding:
                        "10px 12px",

                      borderRadius:
                        7,

                      background:
                        resultat.statut ===
                        "OK"
                          ? "#f2faf4"
                          : resultat.statut ===
                            "SKIP"
                          ? "#f7f7f7"
                          : "#fff2f2",

                      border:
                        "1px solid #e5e5e5",
                    }}
                  >
                    <strong>
                      {
                        resultat.feuille
                      }
                    </strong>

                    <span>
                      {resultat.statut ===
                      "OK"
                        ? "✓ Importée"
                        : resultat.statut ===
                          "SKIP"
                        ? "— Ignorée"
                        : "✕ Erreur"}
                    </span>

                    <span>
                      {
                        resultat.lignes
                      }{" "}
                      lignes
                    </span>

                    <span>
                      {formatHeures(
                        resultat.heures
                      )}
                    </span>

                    <span
                      style={{
                        color:
                          resultat.statut ===
                          "ERREUR"
                            ? "#a00000"
                            : "#666",
                      }}
                    >
                      {
                        resultat.message
                      }
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* =================================================
            APERCU DES SEMAINES
        ================================================= */}

        {semainesAnalysees.length >
          0 && (
          <div
            style={{
              marginTop:
                24,

              background:
                "white",

              borderRadius:
                14,

              padding:
                24,

              boxShadow:
                "0 2px 10px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                fontSize:
                  21,

                fontWeight:
                  700,

                marginBottom:
                  16,
              }}
            >
              Semaines analysées
            </div>

            <div
              style={{
                display:
                  "grid",

                gridTemplateColumns:
                  "repeat(auto-fill, minmax(150px, 1fr))",

                gap:
                  8,
              }}
            >
              {semainesAnalysees.map(
                (
                  semaine
                ) => (
                  <div
                    key={
                      semaine.nomFeuille
                    }
                    style={{
                      padding:
                        12,

                      borderRadius:
                        8,

                      background:
                        "#f7f7f7",

                      border:
                        "1px solid #e4e4e4",
                    }}
                  >
                    <strong>
                      {
                        semaine.nomFeuille
                      }
                    </strong>

                    <div
                      style={{
                        marginTop:
                          5,

                        fontSize:
                          13,

                        color:
                          "#666",
                      }}
                    >
                      {
                        semaine
                          .donnees
                          .length
                      }{" "}
                      collaborateurs
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  titre,
  valeur,
  danger = false,
}: {
  titre: string;
  valeur: string;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        background:
          "white",

        borderRadius:
          12,

        padding:
          18,

        border: danger
          ? "1px solid #e7aaaa"
          : "1px solid #e4e4e4",

        boxShadow:
          "0 2px 7px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          color:
            "#777",

          fontSize:
            14,

          marginBottom:
            7,
        }}
      >
        {titre}
      </div>

      <div
        style={{
          fontSize:
            25,

          fontWeight:
            800,

          color: danger
            ? "#c00000"
            : "#222",
        }}
      >
        {valeur}
      </div>
    </div>
  );
}
