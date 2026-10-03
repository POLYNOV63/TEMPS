"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/lib/supabase";

type Collaborateur = {
  id: string;
  prenom: string;
  nom: string;
  trigramme: string | null;
  actif: boolean;
  profil_horaire_id: string | null;
};

type ProfilHoraire = {
  id: string;
  nom: string | null;
  lundi: number | null;
  mardi: number | null;
  mercredi: number | null;
  jeudi: number | null;
  vendredi: number | null;
};

type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  total_heures: number | null;
  total_theorique: number | null;
  heures_supplementaires: number | null;
  mode_heures_supplementaires: string | null;
};

type Jour = {
  id: string;
  feuille_id: string;
  date_jour: string;
  heures_theoriques: number | null;
  presence: string | null;
  absence: string | null;
  duree_rtt: number | null;
  heures_re: number | null;
  heures_absence: number | null;
  duree_cp: string | null;
  ticket_restaurant: boolean | null;
  total_heures: number | null;
};

type Imputation = {
  id: string;
  jour_id: string;
  type_affaire: string | null;
  numero_affaire: string | null;
  description: string | null;
  code: string | null;
  heures: number | null;
};

type CodeImputation = {
  code: string;
  libelle: string | null;
  categorie: string | null;
  actif: boolean;
  autorise_affaire: boolean | null;
  autorise_devis: boolean | null;
  autorise_divers: boolean | null;
  ordre_affichage: number | null;
};

type Affaire = {
  type: string;
  numero: string;
  description: string;
  heuresParCode: Record<string, number>;
  total: number;
};

const NB_COLONNES = 55;

// Production : E:Y
const COL_PRODUCTION_DEBUT = 4;
const COL_PRODUCTION_FIN = 24;

// Administratif : Z:AO
const COL_ADMIN_DEBUT = 25;
const COL_ADMIN_FIN = 40;

// Jours :
// Lundi    AP:AQ
// Mardi    AR:AS
// Mercredi AT:AU
// Jeudi    AV:AW
// Vendredi AX:AY
// Samedi   AZ:BA
// Dimanche BB:BC
const COL_JOURS_DEBUT = 41;

function arrondi(value: number) {
  return Math.round(value * 100) / 100;
}

function normaliserType(type: string | null) {
  if (!type) return "";

  const valeur = type.trim().toUpperCase();

  if (valeur.includes("DBE")) return "DBE";
  if (valeur.includes("CBE")) return "CBE";
  if (valeur.includes("DIVERS")) return "DIVERS";

  return valeur;
}

function lundiISO(annee: number, semaine: number) {
  const jan4 = new Date(
    Date.UTC(annee, 0, 4)
  );

  const jour = jan4.getUTCDay() || 7;

  const lundiSemaine1 = new Date(jan4);

  lundiSemaine1.setUTCDate(
    jan4.getUTCDate() - jour + 1
  );

  const lundi = new Date(lundiSemaine1);

  lundi.setUTCDate(
    lundi.getUTCDate() + (semaine - 1) * 7
  );

  return lundi.toISOString().slice(0, 10);
}

function infoSemaineISO(date = new Date()) {
  const d = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const jour = d.getUTCDay() || 7;

  // On se place sur le jeudi de la semaine ISO.
  d.setUTCDate(d.getUTCDate() + 4 - jour);

  const anneeISO = d.getUTCFullYear();
  const debutAnnee = new Date(
    Date.UTC(anneeISO, 0, 1)
  );

  const semaineISO = Math.ceil(
    (((d.getTime() - debutAnnee.getTime()) / 86400000) + 1) / 7
  );

  return {
    annee: anneeISO,
    semaine: semaineISO,
  };
}

/**
 * Retourne l'index du jour dans la semaine ISO :
 * lundi = 0 ... dimanche = 6.
 */
function indexJourSemaine(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return -1;
  }

  const js = date.getDay();

  return js === 0 ? 6 : js - 1;
}

function col(indexZeroBased: number) {
  return XLSX.utils.encode_col(indexZeroBased);
}

function cell(colonne: number, ligne: number) {
  return `${col(colonne)}${ligne}`;
}

function valeurCellule(
  feuille: XLSX.WorkSheet,
  adresse: string,
  valeur: any
) {
  const ancienne = feuille[adresse] || {};

  feuille[adresse] = {
    ...ancienne,
    v:
      typeof valeur === "number"
        ? arrondi(valeur)
        : valeur ?? "",
    t:
      typeof valeur === "number"
        ? "n"
        : "s",
  };

  delete feuille[adresse].f;
  delete feuille[adresse].w;
}

function appliquerRemplissage(
  feuille: XLSX.WorkSheet,
  adresse: string,
  couleur: string
) {
  const ancienne = feuille[adresse] || {
    t: "s",
    v: "",
  };

  feuille[adresse] = {
    ...ancienne,
    s: {
      ...(ancienne.s || {}),
      fill: {
        patternType: "solid",
        fgColor: {
          rgb: couleur,
        },
      },
    },
  };
}

function appliquerStyleCellule(
  feuille: XLSX.WorkSheet,
  adresse: string,
  options: any
) {
  const ancienne = feuille[adresse] || {
    t: "s",
    v: "",
  };

  feuille[adresse] = {
    ...ancienne,
    s: {
      ...(ancienne.s || {}),
      ...options,
    },
  };
}

function appliquerToutesLesBordures(
  feuille: XLSX.WorkSheet,
  derniereLigne: number
) {
  const bordure = {
    style: "thin",
    color: {
      rgb: "000000",
    },
  };

  /*
   * Pas de quadrillage horizontal généralisé.
   *
   * Bordures verticales :
   * - A:AO : séparation de toutes les colonnes ;
   * - AP, AR, AT, AV, AX, AZ, BB : début de chaque paire
   *   journalière ;
   * - pas de séparation verticale entre les deux cellules d'une
   *   paire de statut ;
   * - BC : bordure droite extérieure.
   */
  const colonnesBordureGauche = new Set<number>();

  for (let colonne = 0; colonne <= COL_ADMIN_FIN; colonne++) {
    colonnesBordureGauche.add(colonne);
  }

  [
    COL_JOURS_DEBUT,
    COL_JOURS_DEBUT + 2,
    COL_JOURS_DEBUT + 4,
    COL_JOURS_DEBUT + 6,
    COL_JOURS_DEBUT + 8,
    COL_JOURS_DEBUT + 10,
    COL_JOURS_DEBUT + 12,
  ].forEach((colonne) => {
    colonnesBordureGauche.add(colonne);
  });

  for (let ligne = 1; ligne <= derniereLigne; ligne++) {
    for (let colonne = 0; colonne < NB_COLONNES; colonne++) {
      const adresse = cell(colonne, ligne);

      const ancienne = feuille[adresse] || {
        t: "s",
        v: "",
      };

      const borduresExistantes = {
        ...(ancienne.s?.border || {}),
      };

      if (colonnesBordureGauche.has(colonne)) {
        borduresExistantes.left = bordure;
      }

      if (colonne === NB_COLONNES - 1) {
        borduresExistantes.right = bordure;
      }

      /*
       * Très important :
       * on ne définit NI top NI bottom ici.
       * Les seules bordures horizontales seront ajoutées
       * explicitement au début des blocs collaborateurs.
       */
      feuille[adresse] = {
        ...ancienne,
        s: {
          ...(ancienne.s || {}),
          border: borduresExistantes,
        },
      };
    }
  }
}

function appliquerCentrageToutesLesCellules(
  feuille: XLSX.WorkSheet,
  derniereLigne: number
) {
  for (let ligne = 1; ligne <= derniereLigne; ligne++) {
    for (let colonne = 0; colonne < NB_COLONNES; colonne++) {
      const adresse = cell(colonne, ligne);
      const ancienne = feuille[adresse] || {
        t: "s",
        v: "",
      };

      feuille[adresse] = {
        ...ancienne,
        s: {
          ...(ancienne.s || {}),
          alignment: {
            ...(ancienne.s?.alignment || {}),
            horizontal: "center",
            vertical: "center",
          },
        },
      };
    }
  }
}

function appliquerStyleEntete(
  feuille: XLSX.WorkSheet,
  gabarit: XLSX.WorkSheet
) {
  const style20 = {
    font: {
      name: "Calibri",
      sz: 20,
    },
    alignment: {
      horizontal: "center",
      vertical: "center",
      wrapText: true,
    },
  };

  const style11 = {
    font: {
      name: "Calibri",
      sz: 11,
    },
    alignment: {
      horizontal: "center",
      vertical: "center",
      wrapText: true,
    },
  };

  const style14 = {
    font: {
      name: "Calibri",
      sz: 14,
    },
    alignment: {
      horizontal: "center",
      vertical: "center",
      wrapText: true,
      // Texte vertical dans B1.
      // 90 = rotation verticale du contenu.
      textRotation: 90,
    },
  };

  ["A1", "C1", "E1", "Z1"].forEach((adresse) => {
    appliquerStyleCellule(
      feuille,
      adresse,
      style20
    );
  });

  appliquerStyleCellule(
    feuille,
    "D1",
    style11
  );

  appliquerStyleCellule(
    feuille,
    "B1",
    style14
  );

  appliquerStyleCellule(
    feuille,
    "B2",
    style11
  );

  // On reprend les formules de dates EXACTEMENT depuis le Gabarit.
  const cellulesDate = [
    "AP1",
    "AR1",
    "AT1",
    "AV1",
    "AX1",
    "AZ1",
    "BB1",
  ];

  cellulesDate.forEach((adresse) => {
    const source = gabarit[adresse];

    if (source?.f) {
      const ancienne = feuille[adresse] || {
        t: "s",
        v: "",
      };

      feuille[adresse] = {
        ...ancienne,
        f: source.f,
        t: "s",
      };
    }

    appliquerStyleCellule(
      feuille,
      adresse,
      style11
    );
  });

  // Codes dynamiques ligne 2 : Calibri 11 centré.
  for (let c = COL_PRODUCTION_DEBUT; c <= COL_ADMIN_FIN; c++) {
    appliquerStyleCellule(
      feuille,
      cell(c, 2),
      style11
    );
  }

  // Couleurs des colonnes A à D sur les deux lignes d'en-tête.
  const couleursColonnes = [
    [0, "D9D9D9"],
    [1, "F8CBAD"],
    [2, "9BC2E6"],
    [3, "FFE699"],
  ];

  couleursColonnes.forEach(([colonne, couleur]) => {
    appliquerRemplissage(
      feuille,
      cell(Number(colonne), 1),
      String(couleur)
    );
    appliquerRemplissage(
      feuille,
      cell(Number(colonne), 2),
      String(couleur)
    );
  });

  // Couleurs d'en-tête demandées.
  for (let c = COL_PRODUCTION_DEBUT; c <= COL_PRODUCTION_FIN; c++) {
    appliquerRemplissage(
      feuille,
      cell(c, 1),
      "FFF2CC"
    );
    appliquerRemplissage(
      feuille,
      cell(c, 2),
      "FFF2CC"
    );
  }

  for (let c = COL_ADMIN_DEBUT; c <= COL_ADMIN_FIN; c++) {
    appliquerRemplissage(
      feuille,
      cell(c, 1),
      "E2EFDA"
    );
    appliquerRemplissage(
      feuille,
      cell(c, 2),
      "E2EFDA"
    );
  }

  [[41, 42], [45, 46], [49, 50]].forEach(([c1, c2]) => {
    for (const c of [c1, c2]) {
      appliquerRemplissage(
        feuille,
        cell(c, 1),
        "E2EFDA"
      );
      appliquerRemplissage(
        feuille,
        cell(c, 2),
        "E2EFDA"
      );
    }
  });
}

/**
 * Copie UNIQUEMENT la mise en forme d'une ligne.
 * Les valeurs/formules/liens de la ligne source ne sont jamais copiés.
 */
function copierMiseEnFormeLigne(
  source: XLSX.WorkSheet,
  destination: XLSX.WorkSheet,
  ligneSource: number,
  ligneDestination: number
) {
  for (let c = 0; c < NB_COLONNES; c++) {
    const sourceAddress = cell(c, ligneSource);
    const destinationAddress = cell(c, ligneDestination);
    const sourceCell = source[sourceAddress];

    if (sourceCell) {
      destination[destinationAddress] = {
        ...sourceCell,
        v: "",
        t: "s",
      };

      delete destination[destinationAddress].f;
      delete destination[destinationAddress].l;
      delete destination[destinationAddress].w;
    } else {
      destination[destinationAddress] = {
        t: "s",
        v: "",
      };
    }
  }

  for (let c = 0; c < NB_COLONNES; c++) {
    const address = cell(c, ligneDestination);

    let couleur: string | null = null;

    if (c === 0) couleur = "D9D9D9";
    else if (c === 1) couleur = "F8CBAD";
    else if (c === 2) couleur = "9BC2E6";
    else if (c === 3) couleur = "FFE699";
    else if (c >= COL_PRODUCTION_DEBUT && c <= COL_PRODUCTION_FIN) couleur = "FFF2CC";
    else if (c >= COL_ADMIN_DEBUT && c <= COL_ADMIN_FIN) couleur = "E2EFDA";
    else if ([41, 42, 45, 46, 49, 50].includes(c)) couleur = "E2EFDA";

    if (couleur) {
      appliquerRemplissage(
        destination,
        address,
        couleur
      );
    }
  }
}

/**
 * Le gabarit actuel contient la ligne 1 et la ligne 2.
 *
 * Pour les lignes métier, on utilise les lignes du gabarit
 * comme base de mise en forme et on les répète.
 *
 * Cela permet de changer ultérieurement le gabarit sans
 * toucher à la logique métier.
 */
function appliquerMiseEnForme(
  gabarit: XLSX.WorkSheet,
  feuille: XLSX.WorkSheet,
  ligne: number,
  typeLigne: "AFFAIRE" | "DIVERS" | "HJOUR" | "HS" | "TOTAL"
) {
  /*
   * Pour l'instant le gabarit principal est constitué de
   * ses deux premières lignes.
   *
   * On privilégie la ligne 2 comme ligne métier.
   *
   * Le jour où tu ajoutes dans Gabarit des lignes modèles
   * spécifiques, il suffira d'adapter ce mapping.
   */
  let ligneModele = 2;

  if (typeLigne === "AFFAIRE") {
    ligneModele = 2;
  }

  if (typeLigne === "DIVERS") {
    ligneModele = 2;
  }

  if (typeLigne === "HJOUR") {
    ligneModele = 2;
  }

  if (typeLigne === "HS") {
    ligneModele = 2;
  }

  if (typeLigne === "TOTAL") {
    ligneModele = 2;
  }

  copierMiseEnFormeLigne(
    gabarit,
    feuille,
    ligneModele,
    ligne
  );
}

function viderLigne(
  feuille: XLSX.WorkSheet,
  ligne: number
) {
  for (let c = 0; c < NB_COLONNES; c++) {
    const adresse = cell(c, ligne);

    if (feuille[adresse]) {
      delete feuille[adresse].v;
      delete feuille[adresse].f;
      delete feuille[adresse].l;

      feuille[adresse].t = "s";
      feuille[adresse].v = "";
    }
  }
}

function fusionnerJour(
  feuille: XLSX.WorkSheet,
  ligne: number,
  colonne: number,
  statut: string
) {
  const debut = cell(colonne, ligne);
  const fin = cell(colonne + 1, ligne);

  feuille["!merges"] = feuille["!merges"] || [];

  feuille["!merges"] = feuille["!merges"].filter(
    (m: any) =>
      !(
        m.s.r === ligne - 1 &&
        m.s.c === colonne &&
        m.e.r === ligne - 1 &&
        m.e.c === colonne + 1
      )
  );

  feuille["!merges"].push({
    s: {
      r: ligne - 1,
      c: colonne,
    },
    e: {
      r: ligne - 1,
      c: colonne + 1,
    },
  });

  let couleur = "00B050";

  if (statut === "Absent") couleur = "FF6600";
  if (statut === "Télétravail") couleur = "FFFF00";

  valeurCellule(
    feuille,
    debut,
    statut
  );

  valeurCellule(
    feuille,
    fin,
    ""
  );

  appliquerRemplissage(
    feuille,
    debut,
    couleur
  );

  appliquerRemplissage(
    feuille,
    fin,
    couleur
  );

  appliquerStyleCellule(
    feuille,
    debut,
    {
      font: {
        name: "Calibri",
        sz: 11,
      },
      alignment: {
        horizontal: "center",
        vertical: "center",
      },
    }
  );
}

function estCodeProduction(
  code: string,
  codeInfo?: CodeImputation
) {
  if (!codeInfo) return false;

  return (
    codeInfo.autorise_affaire === true ||
    codeInfo.autorise_devis === true
  );
}

function estCodeAdministratif(
  code: string,
  codeInfo?: CodeImputation
) {
  if (!codeInfo) return false;

  return (
    codeInfo.autorise_divers === true &&
    !estCodeProduction(code, codeInfo)
  );
}

/**
 * Un code administratif n'est pas forcément un code d'absence.
 *
 * Exemple important : NI est un code administratif/Divers, mais ce
 * n'est PAS un code d'absence journalier. Il doit donc rester dans
 * Z:AO et ne doit jamais être exporté dans AP:AQ / AR:AS / etc.
 *
 * La source de vérité est la catégorie gérée dans Gestion-code.
 */
function estCodeAbsenceJournalier(
  codeInfo?: CodeImputation
) {
  return (
    codeInfo?.categorie || ""
  ).trim().toUpperCase() === "ABSENCE";
}

function appliquerBordureSuperieure(
  feuille: XLSX.WorkSheet,
  adresse: string
) {
  const ancienne = feuille[adresse] || {
    t: "s",
    v: "",
  };

  feuille[adresse] = {
    ...ancienne,
    s: {
      ...(ancienne.s || {}),
      border: {
        ...(ancienne.s?.border || {}),
        top: {
          style: "thin",
          color: {
            rgb: "000000",
          },
        },
      },
    },
  };
}

export default function ExportExcelPage() {
  const router = useRouter();
  const semaineActuelle = infoSemaineISO();

  const [semaine, setSemaine] = useState(
    String(semaineActuelle.semaine)
  );
  const [annee, setAnnee] = useState(
    String(semaineActuelle.annee)
  );
  const [chargement, setChargement] = useState(false);
  const [message, setMessage] = useState("");

  // Les administrateurs, ainsi que Mathieu MONTBRIZON (MMO) et
  // Fabien VILLENEUVE (FVI), sont autorisés à lancer l'export.
  async function verifierDroitExport() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error(
        "Vous devez être connecté."
      );
    }

    const { data: collaborateur, error } =
      await supabase
        .from("collaborateurs")
        .select("role, prenom, nom, trigramme")
        .eq("auth_user_id", user.id)
        .single();

    if (error) {
      throw error;
    }

    const roleUtilisateur =
      String(collaborateur?.role || "")
        .trim()
        .toUpperCase();

    const trigramme =
      String(collaborateur?.trigramme || "")
        .trim()
        .toUpperCase();

    const nomComplet = `${
      String(collaborateur?.prenom || "")
        .trim()
    } ${
      String(collaborateur?.nom || "")
        .trim()
    }`
      .trim()
      .toUpperCase();

    const autoriseParNom =
      nomComplet === "MATHIEU MONTBRIZON" ||
      nomComplet === "FABIEN VILLENEUVE";

    const autorise =
      roleUtilisateur === "ADMIN" ||
      trigramme === "MMO" ||
      trigramme === "FVI" ||
      autoriseParNom;

    if (!autorise) {
      throw new Error(
        "Vous n'avez pas les droits pour lancer l'export Excel."
      );
    }
  }

  async function exporter() {
    try {
      setChargement(true);
      setMessage("");

      /*
       * ============================================================
       * 1. CONTROLE DES DROITS D'EXPORT
       * ============================================================
       */

      await verifierDroitExport();

      /*
       * ============================================================
       * 2. CHARGEMENT DU FICHIER GABARIT
       * ============================================================
       */

      const response = await fetch(
        "/Recuperation heures pour export.xlsx"
      );

      if (!response.ok) {
        throw new Error(
          "Impossible de charger le fichier Excel dans /public."
        );
      }

      const buffer =
        await response.arrayBuffer();

      const workbook = XLSX.read(buffer, {
        type: "array",
        cellStyles: true,
        cellFormula: true,
        bookVBA: true,
      });

      const gabarit =
        workbook.Sheets["Gabarit"];

      if (!gabarit) {
        throw new Error(
          'L\'onglet "Gabarit" est introuvable.'
        );
      }

      /*
       * ============================================================
       * 3. CREATION DU NOUVEL ONGLET
       *
       * Aucun contenu du S39 existant n'est utilisé.
       * ============================================================
       */

      const nomOnglet =
        `S${semaine}-${annee}`;

      /*
       * On supprime les anciens onglets de test.
       */
      workbook.SheetNames =
        workbook.SheetNames.filter(
          (nom) => nom === "Gabarit"
        );

      delete workbook.Sheets[
        nomOnglet
      ];

      /*
       * Copie initiale du Gabarit.
       */
      const feuilleExcel: XLSX.WorkSheet =
        {};

      const rangeGabarit =
        gabarit["!ref"]
          ? XLSX.utils.decode_range(
              gabarit["!ref"]
            )
          : {
              s: { r: 0, c: 0 },
              e: { r: 1, c: 54 },
            };

      for (
        let r = rangeGabarit.s.r;
        r <= rangeGabarit.e.r;
        r++
      ) {
        for (
          let c = rangeGabarit.s.c;
          c <= rangeGabarit.e.c;
          c++
        ) {
          const a = cell(c, r + 1);

          if (!gabarit[a]) continue;

          feuilleExcel[a] = {
            ...gabarit[a],
          };
        }
      }

      if (gabarit["!cols"]) {
        feuilleExcel["!cols"] =
          gabarit["!cols"].map(
            (c: any) => ({ ...c })
          );
      }

      if (gabarit["!rows"]) {
        feuilleExcel["!rows"] =
          gabarit["!rows"].map(
            (r: any) => ({ ...r })
          );
      }

      if (gabarit["!merges"]) {
        feuilleExcel["!merges"] =
          gabarit["!merges"].map(
            (m: any) => ({ ...m })
          );
      }

      workbook.Sheets[nomOnglet] =
        feuilleExcel;

      // Le Gabarit sert uniquement de modèle :
      // il ne doit jamais rester dans le fichier final.
      delete workbook.Sheets["Gabarit"];
      workbook.SheetNames = [
        nomOnglet,
      ];

      /*
       * ============================================================
       * 4. ANNEE / SEMAINE
       * ============================================================
       */

      valeurCellule(
        feuilleExcel,
        "B1",
        Number(annee)
      );

      valeurCellule(
        feuilleExcel,
        "B2",
        Number(semaine)
      );

      appliquerStyleEntete(
        feuilleExcel,
        gabarit
      );

      /*
       * ============================================================
       * 5. RECUPERATION COLLABORATEURS
       * ============================================================
       */

      const {
        data: collaborateurs,
        error: erreurCollaborateurs,
      } = await supabase
        .from("collaborateurs")
        .select(
          "id, prenom, nom, trigramme, actif, profil_horaire_id"
        )
        .eq("actif", true)
        .order("nom");

      if (erreurCollaborateurs) {
        throw erreurCollaborateurs;
      }

      /*
       * ============================================================
       * 5 BIS. PROFILS HORAIRES
       *
       * Pour les CP/ML en journée complète, heures_theoriques
       * est volontairement à 0 dans la nouvelle application.
       * L'export doit donc retrouver l'objectif normal du jour
       * via le profil horaire du collaborateur.
       * ============================================================
       */

      const profilsIds =
        Array.from(
          new Set(
            (collaborateurs || [])
              .map(
                (c: Collaborateur) =>
                  c.profil_horaire_id
              )
              .filter(Boolean)
          )
        );

      let profilsHoraires: ProfilHoraire[] = [];

      if (profilsIds.length) {
        const {
          data: profils,
          error: erreurProfils,
        } = await supabase
          .from("profils_horaires")
          .select(
            `
              id,
              nom,
              lundi,
              mardi,
              mercredi,
              jeudi,
              vendredi
            `
          )
          .in("id", profilsIds);

        if (erreurProfils) {
          throw erreurProfils;
        }

        profilsHoraires =
          (profils || []) as ProfilHoraire[];
      }

      const profilParId =
        new Map<string, ProfilHoraire>();

      profilsHoraires.forEach(
        (profil) => {
          profilParId.set(
            profil.id,
            profil
          );
        }
      );

      function objectifNormalDuJour(
        collaborateur: Collaborateur,
        jourSemaine: number
      ): number {
        if (jourSemaine < 0 || jourSemaine > 6) {
          return 0;
        }

        const profil = collaborateur.profil_horaire_id
          ? profilParId.get(
              collaborateur.profil_horaire_id
            )
          : undefined;

        if (!profil) {
          return 0;
        }

        const objectifs = [
          Number(profil.lundi || 0),
          Number(profil.mardi || 0),
          Number(profil.mercredi || 0),
          Number(profil.jeudi || 0),
          Number(profil.vendredi || 0),
          0,
          0,
        ];

        return objectifs[jourSemaine];
      }

      /*
       * ============================================================
       * 6. FEUILLES
       * ============================================================
       */

      const debutSemaine = lundiISO(
        Number(annee),
        Number(semaine)
      );

      const {
        data: feuilles,
        error: erreurFeuilles,
      } = await supabase
        .from("feuilles_heures")
        .select(
          `
            id,
            collaborateur_id,
            semaine_debut,
            total_heures,
            total_theorique,
            heures_supplementaires,
            mode_heures_supplementaires
          `
        )
        .eq(
          "semaine_debut",
          debutSemaine
        );

      if (erreurFeuilles) {
        throw erreurFeuilles;
      }

      /*
       * ============================================================
       * 7. JOURS
       * ============================================================
       */

      const idsFeuilles =
        (feuilles || []).map(
          (f: Feuille) => f.id
        );

      let jours: Jour[] = [];

      if (idsFeuilles.length) {
        const { data, error } =
          await supabase
            .from("feuilles_heures_jours")
            .select(
              `
                id,
                feuille_id,
                date_jour,
                heures_theoriques,
                presence,
                absence,
                duree_rtt,
                heures_re,
                heures_absence,
                duree_cp,
                ticket_restaurant,
                total_heures
              `
            )
            .in(
              "feuille_id",
              idsFeuilles
            );

        if (error) throw error;

        jours = data || [];
      }

      /*
       * ============================================================
       * 8. IMPUTATIONS
       * ============================================================
       */

      const idsJours =
        jours.map((j) => j.id);

      let imputations: Imputation[] =
        [];

      if (idsJours.length) {
        const { data, error } =
          await supabase
            .from(
              "feuilles_heures_imputations"
            )
            .select(
              `
                id,
                jour_id,
                type_affaire,
                numero_affaire,
                description,
                code,
                heures
              `
            )
            .in(
              "jour_id",
              idsJours
            );

        if (error) throw error;

        imputations = data || [];
      }

      /*
       * ============================================================
       * 9. CODES
       * ============================================================
       */

      const {
        data: codes,
        error: erreurCodes,
      } = await supabase
        .from("codes_imputation")
        .select(
          `
            code,
            libelle,
            categorie,
            actif,
            autorise_affaire,
            autorise_devis,
            autorise_divers,
            ordre_affichage
          `
        )
        .eq("actif", true)
        .order(
          "ordre_affichage",
          {
            ascending: true,
          }
        );

      if (erreurCodes) {
        throw erreurCodes;
      }

      const codesMetier =
        (codes || []) as CodeImputation[];

      /*
       * ============================================================
       * 10. INDEX
       * ============================================================
       */

      const feuilleParCollaborateur =
        new Map<string, Feuille>();

      (feuilles || []).forEach(
        (f: Feuille) => {
          feuilleParCollaborateur.set(
            f.collaborateur_id,
            f
          );
        }
      );

      const jourParId =
        new Map<string, Jour>();

      jours.forEach((j) => {
        jourParId.set(j.id, j);
      });

      /*
       * ============================================================
       * 11. CODES UTILISES
       * ============================================================
       */

      const productionSet =
        new Set<string>();

      const adminSet =
        new Set<string>();

      imputations.forEach((imp) => {
        if (!imp.code) return;

        const code =
          imp.code
            .trim()
            .toUpperCase();

        if (!code) return;

        const info =
          codesMetier.find(
            (c) =>
              c.code
                .trim()
                .toUpperCase() === code
          );

        if (
          estCodeProduction(
            code,
            info
          )
        ) {
          productionSet.add(code);
        } else if (
          estCodeAdministratif(
            code,
            info
          )
        ) {
          adminSet.add(code);
        } else {
          // Secours si le code existe dans une imputation mais
          // n'est pas encore présent dans codes_imputation.
          const type = normaliserType(
            imp.type_affaire
          );

          if (type === "CBE" || type === "DBE") {
            productionSet.add(code);
          } else {
            adminSet.add(code);
          }
        }
      });

      // Les codes d'absence stockés dans feuilles_heures_jours
      // sont eux aussi considérés comme des codes administratifs utilisés.
      jours.forEach((jour) => {
        const code =
          (jour.absence || "")
            .trim()
            .toUpperCase();

        if (!code || code === "AUTRE") return;

        adminSet.add(code);
      });

      // Les heures de récupération (RE) sont stockées directement
      // dans feuilles_heures_jours.heures_re et doivent donc
      // également faire apparaître le code RE dans l'en-tête.
      jours.forEach((jour) => {
        if (Number(jour.heures_re || 0) > 0) {
          adminSet.add("RE");
        }
      });

      // Les codes d'absence stockés directement dans les jours
      // doivent également apparaître parmi les codes administratifs
      // utilisés pendant la semaine.
      jours.forEach((jour) => {
        const code =
          (jour.absence || "")
            .trim()
            .toUpperCase();

        if (!code || code === "AUTRE") return;

        const info =
          codesMetier.find(
            (c) =>
              c.code
                .trim()
                .toUpperCase() === code
          );

        if (!info || info.actif !== true) return;

        adminSet.add(code);
      });

      function ordreCodes(
        codesA: Set<string>
      ) {
        return Array.from(codesA).sort(
          (a, b) => {
            const ca =
              codesMetier.find(
                (c) =>
                  c.code
                    .trim()
                    .toUpperCase() === a
              );

            const cb =
              codesMetier.find(
                (c) =>
                  c.code
                    .trim()
                    .toUpperCase() === b
              );

            const oa =
              ca?.ordre_affichage ??
              9999;

            const ob =
              cb?.ordre_affichage ??
              9999;

            if (oa !== ob) {
              return oa - ob;
            }

            return a.localeCompare(b);
          }
        );
      }

      const codesProduction =
        ordreCodes(productionSet);

      const codesAdministratifs =
        ordreCodes(adminSet);

      /*
       * ============================================================
       * 12. NETTOYAGE DES COLONNES CODES
       * ============================================================
       */

      for (
        let c = COL_PRODUCTION_DEBUT;
        c <= COL_PRODUCTION_FIN;
        c++
      ) {
        valeurCellule(
          feuilleExcel,
          cell(c, 2),
          ""
        );
      }

      for (
        let c = COL_ADMIN_DEBUT;
        c <= COL_ADMIN_FIN;
        c++
      ) {
        valeurCellule(
          feuilleExcel,
          cell(c, 2),
          ""
        );
      }

      /*
       * ============================================================
       * 13. CODES PRODUCTION EN E:Y
       * ============================================================
       */

      codesProduction.forEach(
        (code, index) => {
          const colonne =
            COL_PRODUCTION_DEBUT +
            index;

          if (
            colonne >
            COL_PRODUCTION_FIN
          ) {
            return;
          }

          valeurCellule(
            feuilleExcel,
            cell(colonne, 2),
            code
          );
        }
      );

      /*
       * ============================================================
       * 14. CODES ADMIN EN Z:AO
       * ============================================================
       */

      codesAdministratifs.forEach(
        (code, index) => {
          const colonne =
            COL_ADMIN_DEBUT +
            index;

          if (
            colonne >
            COL_ADMIN_FIN
          ) {
            return;
          }

          valeurCellule(
            feuilleExcel,
            cell(colonne, 2),
            code
          );
        }
      );

      /*
       * Présentation finale des deux lignes d'en-tête après
       * l'injection des codes dynamiques.
       */
      appliquerStyleEntete(
        feuilleExcel,
        gabarit
      );

      /*
       * ============================================================
       * 15. COLLABORATEURS
       * ============================================================
       */

      const collaborateursExport =
        (collaborateurs || []).filter(
          (c: Collaborateur) =>
            feuilleParCollaborateur.has(
              c.id
            )
        );

      let ligne = 3;

      // Lignes exactes où commence chaque bloc collaborateur.
      // On s'en sert uniquement pour poser la bordure supérieure.
      const lignesDebutBlocs: number[] = [];

      for (const collaborateur of collaborateursExport) {
        lignesDebutBlocs.push(ligne);
        const collaborateurLigne = ligne;

        const feuille =
          feuilleParCollaborateur.get(
            collaborateur.id
          );

        if (!feuille) continue;

        const joursCollab =
          jours.filter(
            (j) =>
              j.feuille_id ===
              feuille.id
          );

        const idsJoursCollab =
          new Set(
            joursCollab.map(
              (j) => j.id
            )
          );

        const imputationsCollab =
          imputations.filter(
            (i) =>
              idsJoursCollab.has(
                i.jour_id
              )
          );

        /*
         * ----------------------------------------------------------
         * MEF LIGNE COLLABORATEUR
         * ----------------------------------------------------------
         */

        appliquerMiseEnForme(
          gabarit,
          feuilleExcel,
          ligne,
          "AFFAIRE"
        );

        // Bordure supérieure de séparation du bloc collaborateur,
        // sur toute la largeur A:BC.
        for (let c = 0; c < NB_COLONNES; c++) {
          appliquerBordureSuperieure(
            feuilleExcel,
            cell(c, ligne)
          );
        }

        /*
         * NOM
         */

        valeurCellule(
          feuilleExcel,
          `A${ligne}`,
          `${collaborateur.nom.toUpperCase()} ${collaborateur.prenom}`
        );

        // Bordure supérieure de A à BC dès qu'un nouveau
        // collaborateur est inséré.
        for (let c = 0; c < NB_COLONNES; c++) {
          appliquerBordureSuperieure(
            feuilleExcel,
            cell(c, ligne)
          );
        }

        /*
         * Lien vers la feuille
         */

        feuilleExcel[
          `A${ligne}`
        ].l = {
          Target:
            `/ma-semaine?semaine=${semaine}&collaborateur=${collaborateur.id}`,
        };

        /*
         * ----------------------------------------------------------
         * AFFAIRES
         * ----------------------------------------------------------
         */

        const affaires =
          new Map<
            string,
            Affaire
          >();

        imputationsCollab.forEach(
          (imp) => {
            const heures =
              Number(
                imp.heures || 0
              );

            if (!heures) return;

            const type =
              normaliserType(
                imp.type_affaire
              );

            /*
             * Les lignes CBE / DBE uniquement
             */
            if (
              type !== "CBE" &&
              type !== "DBE"
            ) {
              return;
            }

            const numero =
              (
                imp.numero_affaire ||
                ""
              ).trim();

            const description =
              (
                imp.description ||
                ""
              ).trim();

            const code =
              (
                imp.code ||
                ""
              )
                .trim()
                .toUpperCase();

            const cle = [
              type,
              numero,
              description,
            ].join("|");

            if (
              !affaires.has(cle)
            ) {
              affaires.set(cle, {
                type,
                numero,
                description,
                heuresParCode: {},
                total: 0,
              });
            }

            const affaire =
              affaires.get(cle)!;

            affaire.heuresParCode[
              code
            ] =
              (
                affaire
                  .heuresParCode[
                    code
                  ] || 0
              ) + heures;

            affaire.total +=
              heures;
          }
        );

        // La ligne du nom reste intacte.
        // Les affaires commencent toujours à la ligne suivante.
        ligne++;

        for (const affaire of affaires.values()) {
          appliquerMiseEnForme(
            gabarit,
            feuilleExcel,
            ligne,
            "AFFAIRE"
          );

          valeurCellule(
            feuilleExcel,
            `C${ligne}`,
            `${affaire.type} ${affaire.numero}`
          );

          valeurCellule(
            feuilleExcel,
            `D${ligne}`,
            affaire.total
          );

          /*
           * Production
           */

          codesProduction.forEach(
            (code, index) => {
              const heures =
                affaire
                  .heuresParCode[
                    code
                  ] || 0;

              if (!heures) return;

              valeurCellule(
                feuilleExcel,
                cell(
                  COL_PRODUCTION_DEBUT +
                    index,
                  ligne
                ),
                heures
              );
            }
          );

          ligne++;
        }

        /*
         * ----------------------------------------------------------
         * DIVERS
         *
         * IMPERATIVEMENT après les CBE/DBE
         * et avant H/Jour.
         * ----------------------------------------------------------
         */

        const diversParCode: Record<
          string,
          number
        > = {};

        let totalDivers = 0;

        imputationsCollab.forEach(
          (imp) => {
            const type =
              normaliserType(
                imp.type_affaire
              );

            if (
              type !== "DIVERS" &&
              type !== ""
            ) {
              return;
            }

            const heures =
              Number(
                imp.heures || 0
              );

            if (!heures) return;

            const code =
              (
                imp.code ||
                ""
              )
                .trim()
                .toUpperCase();

            if (!code) return;

            diversParCode[code] =
              (
                diversParCode[code] ||
                0
              ) + heures;

            totalDivers +=
              heures;
          }
        );

        /*
         * ----------------------------------------------------------
         * ABSENCES / RE STOCKES DIRECTEMENT DANS LES JOURS
         * ----------------------------------------------------------
         *
         * Exemple CP toute la semaine :
         *   AP = 7,5   AQ = CP
         *   AR = 7,5   AS = CP
         *   etc.
         *
         * Pour RE :
         *   la valeur est prise dans heures_re et le code RE
         *   est placé dans la cellule de droite de la paire.
         *
         * On ajoute ces heures à Divers si elles n'existent pas
         * déjà dans les imputations Divers, afin d'éviter un double
         * comptage.
         */

        const absencesJournalieres: Array<{
          jour: Jour;
          code: string;
          heures: number;
        }> = [];

        /*
         * Pour chaque journée, on récupère les codes administratifs
         * réellement présents dans les données.
         *
         * Sources possibles :
         *  - imputation Divers pour un code dont la catégorie
         *    Gestion-code est ABSENCE (ex. ML, CP, VM...)
         *  - colonne absence de feuilles_heures_jours, uniquement
         *    pour un code de catégorie ABSENCE
         *  - heures_re pour RE
         *
         * IMPORTANT :
         * RE est traité indépendamment de absence.
         * Cela évite qu'un ancien code CP/ML dans absence empêche
         * le RE du jour d'être exporté.
         */
        joursCollab.forEach((jour) => {
          const imputationsDiversJour =
            imputationsCollab.filter((imp) => {
              if (imp.jour_id !== jour.id) {
                return false;
              }

              const type =
                normaliserType(
                  imp.type_affaire
                );

              return (
                type === "DIVERS" ||
                type === ""
              );
            });

          /*
           * --------------------------------------------------------
           * 1. RE
           * --------------------------------------------------------
           *
           * On aura toujours un nombre d'heures à exporter en face
           * de RE. La source principale est heures_re.
           * Une éventuelle imputation Divers RE est utilisée
           * comme secours.
           */
          const imputationRE =
            imputationsDiversJour.find(
              (imp) =>
                (
                  imp.code || ""
                )
                  .trim()
                  .toUpperCase() ===
                "RE"
            );

          const heuresRE =
            Number(
              jour.heures_re ||
                imputationRE?.heures ||
                0
            );

          if (heuresRE > 0) {
            absencesJournalieres.push({
              jour,
              code: "RE",
              heures: heuresRE,
            });
          }

          /*
           * --------------------------------------------------------
           * 2. AUTRES CODES ADMINISTRATIFS DE LA JOURNEE
           * --------------------------------------------------------
           */

          const codesDiversDuJour =
            new Map<
              string,
              number
            >();

          imputationsDiversJour.forEach(
            (imp) => {
              const code =
                (
                  imp.code || ""
                )
                  .trim()
                  .toUpperCase();

              if (
                !code ||
                code === "AUTRE" ||
                code === "RE"
              ) {
                return;
              }

              const info =
                codesMetier.find(
                  (c) =>
                    c.code
                      .trim()
                      .toUpperCase() ===
                    code
                );

              /*
               * IMPORTANT : ici on ne veut PAS tous les codes
               * administratifs.
               *
               * La paire journalière AP:AQ / AR:AS / ... est réservée
               * aux vrais codes d'absence définis dans Gestion-code.
               *
               * NI, FO, FI, RN, etc. restent des codes Divers/Admin
               * et doivent uniquement apparaître dans Z:AO.
               */
              if (!estCodeAbsenceJournalier(info)) {
                return;
              }

              const heures =
                Number(
                  imp.heures || 0
                );

              if (heures <= 0) {
                return;
              }

              codesDiversDuJour.set(
                code,
                (
                  codesDiversDuJour.get(
                    code
                  ) || 0
                ) + heures
              );
            }
          );

          for (
            const [
              code,
              heures,
            ] of codesDiversDuJour.entries()
          ) {
            absencesJournalieres.push({
              jour,
              code,
              heures,
            });
          }

          /*
           * --------------------------------------------------------
           * 3. CODE DIRECTEMENT DANS absence
           * --------------------------------------------------------
           *
           * On ne force pas "Absent" en fonction de ce champ si
           * présence est explicitement PRESENTIEL ou TELETRAVAIL.
           * C'est précisément ce qui permet de ne pas transformer
           * le vendredi RE + affaires en "Absent".
           *
           * Pour un CP/ML de journée complète, le code reste
           * exploitable même si heures_theoriques vaut 0 :
           * on utilise alors l'objectif normal du profil.
           */
          const absenceCode =
            (
              jour.absence || ""
            )
              .trim()
              .toUpperCase();

          const presence =
            (
              jour.presence || ""
            )
              .trim()
              .toUpperCase();

          const cpDemiJournee =
            absenceCode === "CP" &&
            (
              jour.duree_cp || ""
            ) ===
              "DEMI_JOURNEE";

          const absenceInfo =
            codesMetier.find(
              (c) =>
                c.code
                  .trim()
                  .toUpperCase() ===
                absenceCode
            );

          const absenceDirecteValide =
            absenceCode &&
            absenceCode !== "AUTRE" &&
            absenceCode !== "RE" &&
            estCodeAbsenceJournalier(
              absenceInfo
            ) &&
            (
              presence !== "PRESENTIEL" ||
              cpDemiJournee
            ) &&
            !Array.from(
              codesDiversDuJour.keys()
            ).includes(
              absenceCode
            );

          if (
            absenceDirecteValide
          ) {
            const jourSemaine =
              indexJourSemaine(
                jour.date_jour
              );

            const objectifNormal =
              objectifNormalDuJour(
                collaborateur,
                jourSemaine
              );

            let heuresAbsence =
              Number(
                jour.heures_absence ||
                  0
              );

            /*
             * CP :
             * - journée complète : objectif normal
             * - demi-journée : moitié de l'objectif normal
             */
            if (
              absenceCode === "CP"
            ) {
              if (
                (
                  jour.duree_cp || ""
                ) ===
                "DEMI_JOURNEE"
              ) {
                heuresAbsence =
                  objectifNormal / 2;
              } else {
                heuresAbsence =
                  objectifNormal;
              }
            }

            /*
             * ML / absences journée :
             * si aucune valeur spécifique n'existe, on prend
             * l'objectif normal du profil.
             */
            if (
              heuresAbsence <= 0 &&
              objectifNormal > 0
            ) {
              heuresAbsence =
                objectifNormal;
            }

            if (
              heuresAbsence > 0
            ) {
              absencesJournalieres.push({
                jour,
                code: absenceCode,
                heures: heuresAbsence,
              });
            }
          }
        });

        /*
         * On reconstruit les montants Divers à partir des journées.
         *
         * RE est ajouté avec ses vraies heures.
         * CP/ML/etc utilisent les heures journalières calculées.
         *
         * Si une imputation Divers existe déjà pour le même code,
         * on ne double pas les heures.
         */
        const heuresJournalieresParCode:
          Record<
            string,
            number
          > = {};

        absencesJournalieres.forEach(
          (item) => {
            heuresJournalieresParCode[
              item.code
            ] =
              (
                heuresJournalieresParCode[
                  item.code
                ] || 0
              ) +
              item.heures;
          }
        );

        Object.entries(
          heuresJournalieresParCode
        ).forEach(
          ([
            code,
            heures,
          ]) => {
            const dejaDansDivers =
              diversParCode[
                code
              ] || 0;

            if (
              dejaDansDivers <
              heures
            ) {
              diversParCode[
                code
              ] = heures;

              totalDivers +=
                heures -
                dejaDansDivers;
            }
          }
        );

        if (
          totalDivers > 0 ||
          absencesJournalieres.length > 0
        ) {
          appliquerMiseEnForme(
            gabarit,
            feuilleExcel,
            ligne,
            "DIVERS"
          );

          valeurCellule(
            feuilleExcel,
            `C${ligne}`,
            "Divers"
          );

          valeurCellule(
            feuilleExcel,
            `D${ligne}`,
            totalDivers
          );

          /*
           * Codes administratifs
           */
          codesAdministratifs.forEach(
            (code, index) => {
              const heures =
                diversParCode[
                  code
                ] || 0;

              if (!heures) {
                return;
              }

              valeurCellule(
                feuilleExcel,
                cell(
                  COL_ADMIN_DEBUT +
                    index,
                  ligne
                ),
                heures
              );
            }
          );

          /*
           * Pour chaque code d'ABSENCE journalier :
           *
           * AP = heures, AQ = code
           * AR = heures, AS = code
           * etc.
           */
          absencesJournalieres.forEach(
            (item) => {
              const jourSemaine =
                indexJourSemaine(
                  item.jour.date_jour
                );

              if (
                jourSemaine < 0 ||
                jourSemaine > 6
              ) {
                return;
              }

              const colonne =
                COL_JOURS_DEBUT +
                jourSemaine * 2;

              /*
               * S'il y avait plusieurs codes administratifs
               * sur la même journée, on additionne les heures
               * dans la première cellule et on conserve le code
               * dans la seconde quand une seule paire est utilisée.
               *
               * Dans le cas normal POLYNOV (un code administratif
               * journalier), le résultat est exactement :
               *   7 | CP
               *   7 | ML
               *   2 | RE
               */
              const celluleHeures =
                cell(
                  colonne,
                  ligne
                );

              const celluleCode =
                cell(
                  colonne + 1,
                  ligne
                );

              const heuresExistantes =
                Number(
                  feuilleExcel[
                    celluleHeures
                  ]?.v || 0
                );

              if (
                heuresExistantes > 0
              ) {
                valeurCellule(
                  feuilleExcel,
                  celluleHeures,
                  heuresExistantes +
                    item.heures
                );

                /*
                 * En cas de plusieurs codes sur une même journée,
                 * on sépare les codes par "/" plutôt que d'en perdre
                 * un silencieusement.
                 */
                const codeExistant =
                  String(
                    feuilleExcel[
                      celluleCode
                    ]?.v || ""
                  ).trim();

                const nouveauCode =
                  codeExistant &&
                  codeExistant !==
                    item.code
                    ? `${codeExistant}/${item.code}`
                    : item.code;

                valeurCellule(
                  feuilleExcel,
                  celluleCode,
                  nouveauCode
                );
              } else {
                valeurCellule(
                  feuilleExcel,
                  celluleHeures,
                  item.heures
                );

                valeurCellule(
                  feuilleExcel,
                  celluleCode,
                  item.code
                );
              }
            }
          );

          ligne++;
        }

        /*
         * ----------------------------------------------------------
         * H/JOUR
         * ----------------------------------------------------------
         */

        const ligneHjour = ligne;

        appliquerMiseEnForme(
          gabarit,
          feuilleExcel,
          ligneHjour,
          "HJOUR"
        );

        valeurCellule(
          feuilleExcel,
          `C${ligneHjour}`,
          "H/Jour"
        );

        joursCollab.forEach(
          (jour) => {
            const date =
              new Date(
                `${jour.date_jour}T12:00:00`
              );

            const js =
              date.getDay();

            const jourSemaine =
              js === 0
                ? 6
                : js - 1;

            if (
              jourSemaine < 0 ||
              jourSemaine > 6
            ) {
              return;
            }

            const colonne =
              COL_JOURS_DEBUT +
              jourSemaine * 2;

            valeurCellule(
              feuilleExcel,
              cell(
                colonne,
                ligneHjour
              ),
              Number(
                jour.total_heures ||
                  0
              )
            );
          }
        );

        ligne++;

        /*
         * ----------------------------------------------------------
         * HEURES SUP
         * ----------------------------------------------------------
         */

        const ligneHS = ligne;

        appliquerMiseEnForme(
          gabarit,
          feuilleExcel,
          ligneHS,
          "HS"
        );

        valeurCellule(
          feuilleExcel,
          `C${ligneHS}`,
          "HEURES SUP"
        );

        const heuresSupplementaires = Number(
          feuille.heures_supplementaires ||
            0
        );

        valeurCellule(
          feuilleExcel,
          `D${ligneHS}`,
          heuresSupplementaires
        );

        if (heuresSupplementaires > 0) {
          appliquerStyleCellule(
            feuilleExcel,
            `D${ligneHS}`,
            {
              font: {
                ...(feuilleExcel[`D${ligneHS}`]?.s?.font || {}),
                color: {
                  rgb: "FF0000",
                },
              },
            }
          );
        }

        ligne++;

        /*
         * ----------------------------------------------------------
         * TOTAL
         * ----------------------------------------------------------
         */

        const ligneTotal =
          ligne;

        appliquerMiseEnForme(
          gabarit,
          feuilleExcel,
          ligneTotal,
          "TOTAL"
        );

        valeurCellule(
          feuilleExcel,
          `C${ligneTotal}`,
          "TOTAL"
        );

        valeurCellule(
          feuilleExcel,
          `D${ligneTotal}`,
          Number(
            feuille.total_heures ||
              0
          )
        );

        /*
         * ----------------------------------------------------------
         * STATUTS
         *
         * AP:AQ = lundi
         * AR:AS = mardi
         * etc.
         *
         * IMPORTANT :
         * on ne met RIEN le week-end par défaut.
         * ----------------------------------------------------------
         */

        joursCollab.forEach(
          (jour) => {
            const date =
              new Date(
                `${jour.date_jour}T12:00:00`
              );

            const js =
              date.getDay();

            const jourSemaine =
              js === 0
                ? 6
                : js - 1;

            if (
              jourSemaine < 0 ||
              jourSemaine > 6
            ) {
              return;
            }

            /*
             * Samedi / dimanche :
             * rien par défaut.
             */

            if (
              jourSemaine >= 5
            ) {
              return;
            }

            let statut = "";

            const absence =
              (
                jour.absence ||
                ""
              ).trim();

            const presence =
              (
                jour.presence ||
                ""
              )
                .trim()
                .toUpperCase();

            /*
             * La présence explicite est prioritaire.
             *
             * Cela évite qu'un ancien code d'absence resté dans
             * la colonne absence transforme un jour "PRESENTIEL"
             * (par exemple vendredi avec 2 h de RE) en "Absent".
             */
            if (
              presence ===
                "TELETRAVAIL" ||
              presence ===
                "TÉLÉTRAVAIL"
            ) {
              statut =
                "Télétravail";
            } else if (
              presence ===
                "PRESENTIEL" ||
              presence ===
                "PRÉSENTIEL"
            ) {
              statut =
                "Présentiel";
            } else if (
              absence
            ) {
              statut = "Absent";
            }

            if (!statut) return;

            const colonne =
              COL_JOURS_DEBUT +
              jourSemaine * 2;

            valeurCellule(
              feuilleExcel,
              cell(
                colonne,
                ligneTotal
              ),
              statut
            );

            /*
             * AP:AQ
             * AR:AS
             * ...
             */

            fusionnerJour(
              feuilleExcel,
              ligneTotal,
              colonne,
              statut
            );
          }
        );

        /*
         * ----------------------------------------------------------
         * INFORMATIONS COLLABORATEUR
         *
         * On écrit TR / TT APRES avoir appliqué la mise en forme
         * des lignes, afin que les copies de style ne les effacent pas.
         * ----------------------------------------------------------
         */

        const nbTR =
          joursCollab.filter(
            (j) =>
              j.ticket_restaurant === true
          ).length;

        const nbTT =
          joursCollab.filter((j) => {
            const presence =
              (j.presence || "")
                .trim()
                .toUpperCase();

            return (
              presence === "TELETRAVAIL" ||
              presence === "TÉLÉTRAVAIL"
            );
          }).length;

        valeurCellule(
          feuilleExcel,
          `A${collaborateurLigne + 1}`,
          `${nbTR} TR`
        );

        valeurCellule(
          feuilleExcel,
          `A${collaborateurLigne + 2}`,
          `${nbTT} jour(s) TT`
        );

        /*
         * Nombre d'heures effectivement placées sur le compteur.
         * Rien n'est affiché lorsque les HS sont payées.
         */
        if (
          Number(feuille.heures_supplementaires || 0) !== 0 &&
          (feuille.mode_heures_supplementaires || "")
            .trim()
            .toUpperCase() === "COMPTEUR"
        ) {
          valeurCellule(
            feuilleExcel,
            `A${ligneHS}`,
            `${String(
              arrondi(
                Number(
                  feuille.heures_supplementaires || 0
                )
              )
            ).replace(".", ",")} H sur compteur`
          );
        }

        /*
         * Ligne suivante
         */

        ligne =
          ligneTotal + 1;
      }

      /*
       * ============================================================
       * 16. BORDURES COMPLETES
       * ============================================================
       *
       * Toutes les cellules de A1 à BC sont dessinées, y compris
       * les cellules vides. Cela garantit les bordures verticales
       * et horizontales sur toute la zone exportée.
       */

      const derniereLigne = Math.max(
        ligne,
        3
      );

      /*
       * Toutes les cellules exportées sont centrées
       * horizontalement et verticalement.
       */
      appliquerCentrageToutesLesCellules(
        feuilleExcel,
        derniereLigne
      );

      appliquerToutesLesBordures(
        feuilleExcel,
        derniereLigne
      );

      /*
       * Bordure horizontale UNIQUEMENT au-dessus de chaque
       * bloc collaborateur.
       *
       * Aucune ligne vide n'est créée entre deux collaborateurs.
       */
      for (const ligneBloc of lignesDebutBlocs) {
        for (let colonne = 0; colonne < NB_COLONNES; colonne++) {
          appliquerBordureSuperieure(
            feuilleExcel,
            cell(colonne, ligneBloc)
          );
        }
      }

      /*
       * Bordure supérieure sur toute la ligne 2.
       */
      for (let colonne = 0; colonne < NB_COLONNES; colonne++) {
        appliquerBordureSuperieure(
          feuilleExcel,
          cell(colonne, 2)
        );
      }

      /*
       * ============================================================
       * 17. REF FINAL
       * ============================================================
       */

      feuilleExcel["!ref"] =
        `A1:BC${Math.max(
          ligne,
          3
        )}`;

      /*
       * Largeurs imposées pour rester conformes à l'ancien système.
       * A = 25 ; C = 16 ; D = 10.
       */
      feuilleExcel["!cols"] =
        feuilleExcel["!cols"] || [];

      feuilleExcel["!cols"][0] = {
        ...(feuilleExcel["!cols"][0] || {}),
        wch: 25,
      };

      feuilleExcel["!cols"][2] = {
        ...(feuilleExcel["!cols"][2] || {}),
        wch: 16,
      };

      feuilleExcel["!cols"][3] = {
        ...(feuilleExcel["!cols"][3] || {}),
        wch: 10,
      };

      /*
       * Le fichier final ne contient que SXX-XXXX.
       */
      workbook.SheetNames = [nomOnglet];

      /*
       * ============================================================
       * 17. EXPORT
       * ============================================================
       */

      XLSX.writeFile(
        workbook,
        `${nomOnglet}.xlsx`,
        {
          bookType: "xlsx",
          bookVBA: true,
          compression: true,
        }
      );

      setMessage(
        `Export ${nomOnglet} généré. ` +
          `${codesProduction.length} code(s) production : ` +
          `${codesProduction.join(", ") || "aucun"}. ` +
          `${codesAdministratifs.length} code(s) administratif(s) : ` +
          `${codesAdministratifs.join(", ") || "aucun"}.`
      );
    } catch (error: any) {
      console.error(error);

      setMessage(
        `Erreur : ${
          error?.message ||
          "Une erreur est survenue."
        }`
      );
    } finally {
      setChargement(false);
    }
  }

  const apercuLundi = lundiISO(
    Number(annee),
    Number(semaine)
  );

  const apercuDimanche = new Date(
    `${apercuLundi}T12:00:00`
  );

  apercuDimanche.setDate(
    apercuDimanche.getDate() + 6
  );

  const formatApercuDate = (date: Date) =>
    date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "50px 30px",
        background: "#f5f5f5",
        fontFamily: "Calibri, Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            background: "#c00000",
            color: "white",
            borderRadius: "12px 12px 0 0",
            padding: "22px 26px",
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            Export Excel
          </div>
          <div
            style={{
              marginTop: 5,
              opacity: 0.9,
              fontSize: 14,
            }}
          >
            Sélectionnez la semaine à extraire
          </div>
        </div>

        <div
          style={{
            background: "white",
            borderRadius: "0 0 12px 12px",
            padding: 30,
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
          }}
        >
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 24,
              padding: "10px 14px",
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              background: "white",
              color: "#333",
              cursor: "pointer",
              fontFamily: "Calibri, Arial, sans-serif",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            ← Retour au dashboard
          </button>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontWeight: 700,
              }}
            >
              Semaine
              <select
                value={semaine}
                onChange={(e) =>
                  setSemaine(e.target.value)
                }
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: "1px solid #d9d9d9",
                  borderRadius: 7,
                  fontSize: 16,
                  background: "white",
                }}
              >
                {Array.from({ length: 53 }, (_, index) => {
                  const numero = index + 1;
                  return (
                    <option key={numero} value={numero}>
                      Semaine {String(numero).padStart(2, "0")}
                    </option>
                  );
                })}
              </select>
            </label>

            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontWeight: 700,
              }}
            >
              Année
              <select
                value={annee}
                onChange={(e) =>
                  setAnnee(e.target.value)
                }
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: "1px solid #d9d9d9",
                  borderRadius: 7,
                  fontSize: 16,
                  background: "white",
                }}
              >
                {[2025, 2026, 2027, 2028].map((valeur) => (
                  <option key={valeur} value={valeur}>
                    {valeur}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            style={{
              marginTop: 24,
              padding: "15px 18px",
              background: "#f8f8f8",
              border: "1px solid #e6e6e6",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#888",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Semaine sélectionnée
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 22,
                fontWeight: 800,
                color: "#c00000",
              }}
            >
              S{String(semaine).padStart(2, "0")}-{annee}
            </div>
            <div
              style={{
                marginTop: 4,
                color: "#666",
                fontSize: 14,
              }}
            >
              Du {formatApercuDate(new Date(`${apercuLundi}T12:00:00`))}
              {" au "}
              {formatApercuDate(apercuDimanche)}
            </div>
          </div>

          <button
            type="button"
            onClick={exporter}
            disabled={chargement}
            style={{
              width: "100%",
              marginTop: 24,
              background: chargement ? "#999" : "#c00000",
              color: "white",
              border: "none",
              padding: "14px 18px",
              borderRadius: 8,
              cursor: chargement ? "default" : "pointer",
              fontWeight: 800,
              fontSize: 16,
            }}
          >
            {chargement
              ? "Génération du fichier…"
              : `Exporter S${String(semaine).padStart(2, "0")}-${annee}`}
          </button>

          {message && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                background: "#f5f5f5",
                border: "1px solid #ddd",
                borderRadius: 7,
                color: "#555",
                fontSize: 14,
              }}
            >
              {message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}