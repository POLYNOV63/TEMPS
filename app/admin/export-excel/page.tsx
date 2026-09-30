"use client";

import { useState } from "react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/lib/supabase";

// ============================================================
// TYPES
// ============================================================

type Collaborateur = {
  id: string;
  prenom: string;
  nom: string;
  email?: string | null;
  role?: string | null;
  trigramme?: string | null;
  actif?: boolean | null;
};

type CodeImputation = {
  code: string;
  libelle: string | null;
  categorie: string | null;
  actif: boolean | null;
  autorise_affaire: boolean | null;
  autorise_devis: boolean | null;
  autorise_divers: boolean | null;
  historique_uniquement: boolean | null;
  ordre_affichage?: number | null;
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
  duree_cp: number | null;
  ticket_restaurant:
    | boolean
    | number
    | string
    | null;
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

// ============================================================
// COLONNES
// ============================================================

const COL = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,

  E: 4,
  Y: 24,

  Z: 25,
  AO: 40,

  AP: 41,
  AQ: 42,

  AR: 43,
  AS: 44,

  AT: 45,
  AU: 46,

  AV: 47,
  AW: 48,

  AX: 49,
  AY: 50,

  AZ: 51,
  BA: 52,

  BB: 53,
  BC: 54,
};

const DAY_PAIRS = [
  { first: COL.AP, second: COL.AQ },
  { first: COL.AR, second: COL.AS },
  { first: COL.AT, second: COL.AU },
  { first: COL.AV, second: COL.AW },
  { first: COL.AX, second: COL.AY },
  { first: COL.AZ, second: COL.BA },
  { first: COL.BB, second: COL.BC },
];

// ============================================================
// COULEURS
// ============================================================

const COLORS = {
  A: "D9D9D9",
  B: "F8CBAD",
  C: "9BC2E6",
  D: "FFE699",

  PRODUCTION: "FFF2CC",
  ADMIN: "E2EFDA",

  ABSENT: "FF6600",
  TELETRAVAIL: "FFFF00",
  PRESENTIEL: "00B050",

  BLACK: "000000",
};

// ============================================================
// UTILITAIRES
// ============================================================

function excelColumn(index: number): string {
  let n = index + 1;
  let result = "";

  while (n > 0) {
    const modulo = (n - 1) % 26;

    result =
      String.fromCharCode(
        65 + modulo
      ) + result;

    n = Math.floor(
      (n - modulo) / 26
    );
  }

  return result;
}

function address(
  row: number,
  col: number
) {
  return `${excelColumn(col)}${
    row + 1
  }`;
}

function getCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number
): XLSX.CellObject {
  const ref =
    address(row, col);

  if (!ws[ref]) {
    ws[ref] = {
      t: "s",
      v: "",
    };
  }

  return ws[ref];
}

function setCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  value: string | number
) {
  const ref =
    address(row, col);

  if (typeof value === "number") {
    ws[ref] = {
      t: "n",
      v: value,
    };
  } else {
    ws[ref] = {
      t: "s",
      v: value,
    };
  }
}

function setFormula(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  formula: string
) {
  const ref =
    address(row, col);

  ws[ref] = {
    t: "n",
    v: 0,
    f: formula,
  };
}

function clearCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number
) {
  setCell(
    ws,
    row,
    col,
    ""
  );
}

function formatNumber(
  value:
    | number
    | null
    | undefined
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n) ||
    n === 0
  ) {
    return 0;
  }

  return Math.round(
    n * 100
  ) / 100;
}

// ============================================================
// TESTS
// ============================================================

function estVrai(
  value:
    | boolean
    | number
    | string
    | null
    | undefined
) {
  if (value === true) {
    return true;
  }

  if (value === 1) {
    return true;
  }

  if (
    typeof value === "string"
  ) {
    return [
      "true",
      "1",
      "oui",
      "yes",
      "y",
      "o",
      "vrai",
    ].includes(
      value
        .trim()
        .toLowerCase()
    );
  }

  return false;
}

function estTeletravail(
  presence:
    | string
    | null
    | undefined
) {
  const value =
    (
      presence || ""
    )
      .trim()
      .toUpperCase();

  return (
    value === "TT" ||
    value.includes(
      "TELETRAVAIL"
    ) ||
    value.includes(
      "TÉLÉTRAVAIL"
    )
  );
}

function estAbsent(
  jour: Jour
) {
  return (
    !!jour.absence ||
    formatNumber(
      jour.duree_cp
    ) > 0 ||
    formatNumber(
      jour.heures_absence
    ) > 0 ||
    formatNumber(
      jour.duree_rtt
    ) > 0
  );
}

// ============================================================
// STYLE GENERIQUE
// ============================================================

function styleCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  style: any
) {
  const cell =
    getCell(
      ws,
      row,
      col
    );

  cell.s = {
    ...(cell.s || {}),
    ...style,
  };
}

// ============================================================
// COULEURS DE COLONNES
// ============================================================

function applyColumnColors(
  ws: XLSX.WorkSheet,
  maxRows: number
) {
  for (
    let row = 0;
    row < maxRows;
    row++
  ) {
    for (
      let col = COL.A;
      col <= COL.BC;
      col++
    ) {
      getCell(
        ws,
        row,
        col
      );
    }
  }

  for (
    let row = 0;
    row < maxRows;
    row++
  ) {
    applyFill(
      ws,
      row,
      COL.A,
      COLORS.A
    );

    applyFill(
      ws,
      row,
      COL.B,
      COLORS.B
    );

    applyFill(
      ws,
      row,
      COL.C,
      COLORS.C
    );

    applyFill(
      ws,
      row,
      COL.D,
      COLORS.D
    );

    for (
      let col = COL.E;
      col <= COL.Y;
      col++
    ) {
      applyFill(
        ws,
        row,
        col,
        COLORS.PRODUCTION
      );
    }

    for (
      let col = COL.Z;
      col <= COL.AO;
      col++
    ) {
      applyFill(
        ws,
        row,
        col,
        COLORS.ADMIN
      );
    }

    // AP:AQ
    applyFill(
      ws,
      row,
      COL.AP,
      COLORS.ADMIN
    );

    applyFill(
      ws,
      row,
      COL.AQ,
      COLORS.ADMIN
    );

    // AT:AU
    applyFill(
      ws,
      row,
      COL.AT,
      COLORS.ADMIN
    );

    applyFill(
      ws,
      row,
      COL.AU,
      COLORS.ADMIN
    );

    // AX:AY
    applyFill(
      ws,
      row,
      COL.AX,
      COLORS.ADMIN
    );

    applyFill(
      ws,
      row,
      COL.AY,
      COLORS.ADMIN
    );
  }
}

function applyFill(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  color: string
) {
  styleCell(
    ws,
    row,
    col,
    {
      fill: {
        patternType:
          "solid",
        fgColor: {
          rgb: color,
        },
      },
    }
  );
}

// ============================================================
// BORDURES LATERALES
// ============================================================

function applySideBorders(
  ws: XLSX.WorkSheet,
  maxRows: number
) {
  for (
    let row = 0;
    row < maxRows;
    row++
  ) {
    for (
      let col = COL.A;
      col <= COL.BC;
      col++
    ) {
      const cell =
        getCell(
          ws,
          row,
          col
        );

      styleCell(
        ws,
        row,
        col,
        {
          border: {
            ...(cell.s?.border ||
              {}),
            left: {
              style:
                "thin",
              color: {
                rgb:
                  COLORS.BLACK,
              },
            },
            right: {
              style:
                "thin",
              color: {
                rgb:
                  COLORS.BLACK,
              },
            },
          },
        }
      );
    }
  }
}

// ============================================================
// BORDURE HAUTE COLLABORATEUR
// ============================================================

function addTopBorder(
  ws: XLSX.WorkSheet,
  row: number
) {
  for (
    let col = COL.A;
    col <= COL.BC;
    col++
  ) {
    const cell =
      getCell(
        ws,
        row,
        col
      );

    styleCell(
      ws,
      row,
      col,
      {
        border: {
          ...(cell.s?.border ||
            {}),
          top: {
            style:
              "thin",
            color: {
              rgb:
                COLORS.BLACK,
            },
          },
        },
      }
    );
  }
}

// ============================================================
// CENTRAGE GLOBAL
// ============================================================

function centerAllCells(
  ws: XLSX.WorkSheet,
  maxRows: number
) {
  for (
    let row = 0;
    row < maxRows;
    row++
  ) {
    for (
      let col = COL.A;
      col <= COL.BC;
      col++
    ) {
      const cell =
        getCell(
          ws,
          row,
          col
        );

      styleCell(
        ws,
        row,
        col,
        {
          alignment: {
            ...(cell.s?.alignment ||
              {}),
            horizontal:
              "center",
            vertical:
              "center",
          },
        }
      );
    }
  }
}

// ============================================================
// D1
// ============================================================

function styleD1(
  ws: XLSX.WorkSheet
) {
  const cell =
    getCell(
      ws,
      0,
      COL.D
    );

  styleCell(
    ws,
    0,
    COL.D,
    {
      alignment: {
        ...(cell.s?.alignment ||
          {}),
        horizontal:
          "center",
        vertical:
          "center",
        wrapText:
          true,
      },
    }
  );
}

// ============================================================
// A1 / C1 / E1 / Z1
// ============================================================

function styleMainHeaders(
  ws: XLSX.WorkSheet
) {
  for (
    const col of [
      COL.A,
      COL.C,
    ]
  ) {
    const cell =
      getCell(
        ws,
        0,
        col
      );

    styleCell(
      ws,
      0,
      col,
      {
        font: {
          ...(cell.s?.font ||
            {}),
          sz: 20,
        },
        alignment: {
          ...(cell.s?.alignment ||
            {}),
          horizontal:
            "center",
          vertical:
            "center",
        },
      }
    );
  }

  for (
    const col of [
      COL.E,
      COL.Z,
    ]
  ) {
    const cell =
      getCell(
        ws,
        0,
        col
      );

    styleCell(
      ws,
      0,
      col,
      {
        font: {
          ...(cell.s?.font ||
            {}),
          sz: 20,
        },
        alignment: {
          ...(cell.s?.alignment ||
            {}),
          horizontal:
            "center",
          vertical:
            "center",
        },
      }
    );
  }
}

// ============================================================
// STATUT
// ============================================================

function mergeStatus(
  ws: XLSX.WorkSheet,
  row: number,
  firstCol: number,
  text: string,
  color: string
) {
  const secondCol =
    firstCol + 1;

  clearCell(
    ws,
    row,
    firstCol
  );

  clearCell(
    ws,
    row,
    secondCol
  );

  setCell(
    ws,
    row,
    firstCol,
    text
  );

  // PRIORITAIRE :
  // on réapplique la couleur APRES
  // toutes les couleurs de colonnes.
  styleCell(
    ws,
    row,
    firstCol,
    {
      fill: {
        patternType:
          "solid",
        fgColor: {
          rgb: color,
        },
      },
      font: {
        bold: true,
      },
      alignment: {
        horizontal:
          "center",
        vertical:
          "center",
      },
    }
  );

  styleCell(
    ws,
    row,
    secondCol,
    {
      fill: {
        patternType:
          "solid",
        fgColor: {
          rgb: color,
        },
      },
      alignment: {
        horizontal:
          "center",
        vertical:
          "center",
      },
    }
  );

  if (
    !ws["!merges"]
  ) {
    ws["!merges"] = [];
  }

  ws["!merges"] =
    ws["!merges"].filter(
      (merge: any) =>
        !(
          merge.s.r === row &&
          merge.s.c ===
            firstCol &&
          merge.e.r === row &&
          merge.e.c ===
            secondCol
        )
    );

  ws["!merges"].push({
    s: {
      r: row,
      c: firstCol,
    },
    e: {
      r: row,
      c: secondCol,
    },
  });
}

// ============================================================
// TYPE AFFAIRE
// ============================================================

function normaliserTypeAffaire(
  value:
    | string
    | null
    | undefined
) {
  return (
    value || ""
  )
    .trim()
    .toUpperCase()
    .replace(
      /\s+/g,
      ""
    );
}

function estProduction(
  value:
    | string
    | null
    | undefined
) {
  const type =
    normaliserTypeAffaire(
      value
    );

  return (
    type === "CBE" ||
    type === "DBE" ||
    type === "AFFAIRE" ||
    type === "DEVIS"
  );
}

// ============================================================
// DATE ISO
// ============================================================

function getMondayOfISOWeek(
  year: number,
  week: number
) {
  const date =
    new Date(
      Date.UTC(
        year,
        0,
        4
      )
    );

  const day =
    date.getUTCDay() || 7;

  date.setUTCDate(
    date.getUTCDate() -
      day +
      1 +
      (week - 1) * 7
  );

  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function getDayIndex(
  dateString: string,
  semaineDebut: Date
) {
  const date =
    new Date(
      `${dateString}T00:00:00`
    );

  return Math.round(
    (
      date.getTime() -
      semaineDebut.getTime()
    ) /
      (
        1000 *
        60 *
        60 *
        24
      )
  );
}

// ============================================================
// COPIE DU GABARIT
// ============================================================

function copyGabarit(
  source: XLSX.WorkSheet,
  target: XLSX.WorkSheet
) {
  let maxRows = 150;

  if (
    source["!ref"]
  ) {
    const range =
      XLSX.utils.decode_range(
        source["!ref"]
      );

    maxRows =
      Math.max(
        150,
        range.e.r + 1
      );
  }

  for (
    let row = 0;
    row < maxRows;
    row++
  ) {
    for (
      let col = COL.A;
      col <= COL.BC;
      col++
    ) {
      const ref =
        address(
          row,
          col
        );

      const sourceCell =
        source[ref];

      const targetCell =
        getCell(
          target,
          row,
          col
        );

      if (!sourceCell) {
        continue;
      }

      if (
        sourceCell.s
      ) {
        targetCell.s =
          JSON.parse(
            JSON.stringify(
              sourceCell.s
            )
          );
      }

      if (
        sourceCell.z !==
        undefined
      ) {
        targetCell.z =
          sourceCell.z;
      }
    }
  }

  if (
    source["!cols"]
  ) {
    target["!cols"] =
      source["!cols"].map(
        (col: any) => ({
          ...col,
        })
      );
  }

  if (
    source["!rows"]
  ) {
    target["!rows"] =
      source["!rows"].map(
        (row: any) => ({
          ...row,
        })
      );
  }

  if (
    source["!merges"]
  ) {
    target["!merges"] =
      source["!merges"].map(
        (merge: any) => ({
          s: {
            ...merge.s,
          },
          e: {
            ...merge.e,
          },
        })
      );
  }
}

// ============================================================
// PAGE
// ============================================================

export default function ExportExcelPage() {
  const maintenant =
    new Date();

  const [annee, setAnnee] =
    useState(
      maintenant.getFullYear()
    );

  const [semaine, setSemaine] =
    useState(1);

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  // ==========================================================
  // EXPORT
  // ==========================================================

  async function exporter() {
    try {
      setLoading(true);
      setMessage("");

      // ------------------------------------------------------
      // UTILISATEUR
      // ------------------------------------------------------

      const {
        data: {
          user,
        },
        error: authError,
      } =
        await supabase.auth.getUser();

      if (
        authError ||
        !user
      ) {
        throw new Error(
          "Vous devez être connecté."
        );
      }

      // ------------------------------------------------------
      // DROITS
      // ------------------------------------------------------

      const {
        data: profil,
        error: profilError,
      } =
        await supabase
          .from(
            "collaborateurs"
          )
          .select(
            "role"
          )
          .eq(
            "auth_user_id",
            user.id
          )
          .maybeSingle();

      if (
        profilError
      ) {
        throw profilError;
      }

      if (
        profil?.role?.toUpperCase() !==
        "ADMIN"
      ) {
        throw new Error(
          "Cette page est réservée aux administrateurs."
        );
      }

      // ------------------------------------------------------
      // NOM DE L'ONGLET
      // ------------------------------------------------------

      const nomOnglet =
        `S${String(
          semaine
        ).padStart(
          2,
          "0"
        )}-${annee}`;

      // ------------------------------------------------------
      // GABARIT
      // ------------------------------------------------------

      const response =
        await fetch(
          "/Recuperation heures pour export.xlsx"
        );

      if (!response.ok) {
        throw new Error(
          "Impossible de charger le gabarit Excel."
        );
      }

      const buffer =
        await response.arrayBuffer();

      const workbook =
        XLSX.read(
          buffer,
          {
            type: "array",
            cellStyles: true,
          }
        );

      const gabarit =
        workbook.Sheets[
          "Gabarit"
        ];

      if (!gabarit) {
        throw new Error(
          "L'onglet Gabarit est introuvable."
        );
      }

      // Nouvelle feuille
      const ws =
        XLSX.utils.aoa_to_sheet(
          []
        );

      // IMPORTANT :
      // on copie d'abord la structure
      // et la mise en forme du Gabarit.
      copyGabarit(
        gabarit,
        ws
      );

      // Le fichier final ne contient
      // qu'une seule feuille.
      workbook.SheetNames = [
        nomOnglet,
      ];

      workbook.Sheets = {
        [nomOnglet]:
          ws,
      };

      // ------------------------------------------------------
      // B1 / B2
      // ------------------------------------------------------

      setCell(
        ws,
        0,
        COL.B,
        annee
      );

      setCell(
        ws,
        1,
        COL.B,
        semaine
      );

      // ------------------------------------------------------
      // DATE SEMAINE
      // ------------------------------------------------------

      const dateDebut =
        getMondayOfISOWeek(
          annee,
          semaine
        );

      const dateFin =
        new Date(
          dateDebut
        );

      dateFin.setDate(
        dateFin.getDate() +
          6
      );

      const debutISO =
        `${dateDebut.getFullYear()}-${String(
          dateDebut.getMonth() + 1
        ).padStart(
          2,
          "0"
        )}-${String(
          dateDebut.getDate()
        ).padStart(
          2,
          "0"
        )}`;

      const finISO =
        `${dateFin.getFullYear()}-${String(
          dateFin.getMonth() + 1
        ).padStart(
          2,
          "0"
        )}-${String(
          dateFin.getDate()
        ).padStart(
          2,
          "0"
        )}`;

      // ======================================================
      // COLLABORATEURS
      // ======================================================

      const {
        data: collaborateurs,
        error:
          collaborateursError,
      } =
        await supabase
          .from(
            "collaborateurs"
          )
          .select(
            `
              id,
              prenom,
              nom,
              email,
              role,
              trigramme,
              actif
            `
          )
          .eq(
            "actif",
            true
          )
          .order(
            "nom",
            {
              ascending:
                true,
            }
          );

      if (
        collaborateursError
      ) {
        throw collaborateursError;
      }

      // ======================================================
      // FEUILLES
      // ======================================================

      const {
        data: feuilles,
        error:
          feuillesError,
      } =
        await supabase
          .from(
            "feuilles_heures"
          )
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
          .gte(
            "semaine_debut",
            debutISO
          )
          .lte(
            "semaine_debut",
            finISO
          );

      if (
        feuillesError
      ) {
        throw feuillesError;
      }

      // ======================================================
      // UNIQUEMENT LES COLLABORATEURS AVEC UNE FEUILLE
      // ======================================================

      const feuillesParCollaborateur =
        new Map<
          string,
          Feuille
        >();

      (
        feuilles || []
      ).forEach(
        (
          feuille
        ) => {
          feuillesParCollaborateur.set(
            feuille.collaborateur_id,
            feuille
          );
        }
      );

      const collaborateursAvecFeuille =
        (
          collaborateurs ||
          []
        ).filter(
          (
            collaborateur
          ) =>
            feuillesParCollaborateur.has(
              collaborateur.id
            )
        );

      if (
        collaborateursAvecFeuille.length ===
        0
      ) {
        throw new Error(
          `Aucune feuille trouvée pour ${nomOnglet}.`
        );
      }

      // ======================================================
      // JOURS
      // ======================================================

      const feuilleIds =
        (
          feuilles || []
        ).map(
          (
            feuille
          ) =>
            feuille.id
        );

      let jours: Jour[] =
        [];

      if (
        feuilleIds.length
      ) {
        const {
          data,
          error,
        } =
          await supabase
            .from(
              "feuilles_heures_jours"
            )
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
              feuilleIds
            );

        if (error) {
          throw error;
        }

        jours =
          data || [];
      }

      // ======================================================
      // IMPUTATIONS
      // ======================================================

      const jourIds =
        jours.map(
          (
            jour
          ) =>
            jour.id
        );

      let imputations:
        Imputation[] =
        [];

      if (
        jourIds.length
      ) {
        const {
          data,
          error,
        } =
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
              jourIds
            );

        if (error) {
          throw error;
        }

        imputations =
          data || [];
      }

      // ======================================================
      // CODES
      // ======================================================

      const {
        data: codes,
        error: codesError,
      } =
        await supabase
          .from(
            "codes_imputation"
          )
          .select(
            `
              code,
              libelle,
              categorie,
              actif,
              autorise_affaire,
              autorise_devis,
              autorise_divers,
              historique_uniquement,
              ordre_affichage
            `
          );

      if (codesError) {
        throw codesError;
      }

      const codesMap =
        new Map<
          string,
          CodeImputation
        >();

      (
        codes || []
      ).forEach(
        (
          code
        ) => {
          codesMap.set(
            code.code
              .trim()
              .toUpperCase(),
            code
          );
        }
      );

      // ======================================================
      // MAPS
      // ======================================================

      const joursParFeuille =
        new Map<
          string,
          Jour[]
        >();

      jours.forEach(
        (
          jour
        ) => {
          const liste =
            joursParFeuille.get(
              jour.feuille_id
            ) || [];

          liste.push(
            jour
          );

          joursParFeuille.set(
            jour.feuille_id,
            liste
          );
        }
      );

      const imputationsParJour =
        new Map<
          string,
          Imputation[]
        >();

      imputations.forEach(
        (
          imputation
        ) => {
          const liste =
            imputationsParJour.get(
              imputation.jour_id
            ) || [];

          liste.push(
            imputation
          );

          imputationsParJour.set(
            imputation.jour_id,
            liste
          );
        }
      );

      // ======================================================
      // CODES UTILISES
      // ======================================================

      const productionCodes =
        new Set<string>();

      const adminCodes =
        new Set<string>();

      for (
        const imputation of
          imputations
      ) {
        if (
          !imputation.code
        ) {
          continue;
        }

        const code =
          imputation.code
            .trim()
            .toUpperCase();

        if (
          estProduction(
            imputation.type_affaire
          )
        ) {
          productionCodes.add(
            code
          );
        } else {
          adminCodes.add(
            code
          );
        }
      }

      // Absences
      for (
        const jour of
          jours
      ) {
        if (
          jour.absence
        ) {
          adminCodes.add(
            jour.absence
              .trim()
              .toUpperCase()
          );
        }

        if (
          formatNumber(
            jour.duree_cp
          ) > 0
        ) {
          adminCodes.add(
            "CP"
          );
        }

        if (
          formatNumber(
            jour.duree_rtt
          ) > 0
        ) {
          adminCodes.add(
            "RTT"
          );
        }

        if (
          formatNumber(
            jour.heures_re
          ) > 0
        ) {
          adminCodes.add(
            "RE"
          );
        }
      }

      const trierCodes =
        (
          set: Set<string>
        ) =>
          Array.from(
            set
          ).sort(
            (
              a,
              b
            ) => {
              const ca =
                codesMap.get(
                  a
                );

              const cb =
                codesMap.get(
                  b
                );

              const oa =
                ca?.ordre_affichage ??
                9999;

              const ob =
                cb?.ordre_affichage ??
                9999;

              if (
                oa !== ob
              ) {
                return (
                  oa - ob
                );
              }

              return a.localeCompare(
                b
              );
            }
          );

      const productionCodesTries =
        trierCodes(
          productionCodes
        );

      const adminCodesTries =
        trierCodes(
          adminCodes
        );

      // ======================================================
      // COLONNES CODES
      // ======================================================

      const productionColumnMap =
        new Map<
          string,
          number
        >();

      productionCodesTries
        .slice(
          0,
          COL.Y -
            COL.E +
            1
        )
        .forEach(
          (
            code,
            index
          ) => {
            productionColumnMap.set(
              code,
              COL.E +
                index
            );
          }
        );

      const adminColumnMap =
        new Map<
          string,
          number
        >();

      adminCodesTries
        .slice(
          0,
          COL.AO -
            COL.Z +
            1
        )
        .forEach(
          (
            code,
            index
          ) => {
            adminColumnMap.set(
              code,
              COL.Z +
                index
            );
          }
        );

      // ======================================================
      // ENTETES CODES
      // ======================================================

      productionColumnMap.forEach(
        (
          col,
          code
        ) => {
          setCell(
            ws,
            1,
            col,
            code
          );
        }
      );

      adminColumnMap.forEach(
        (
          col,
          code
        ) => {
          setCell(
            ws,
            1,
            col,
            code
          );
        }
      );

      // ======================================================
      // REMPLISSAGE
      // ======================================================

      let currentRow = 2;

      for (
        const collaborateur of
          collaborateursAvecFeuille
      ) {
        const feuille =
          feuillesParCollaborateur.get(
            collaborateur.id
          );

        if (!feuille) {
          continue;
        }

        const joursCollaborateur =
          joursParFeuille.get(
            feuille.id
          ) || [];

        const joursMap =
          new Map<
            number,
            Jour
          >();

        joursCollaborateur.forEach(
          (
            jour
          ) => {
            const index =
              getDayIndex(
                jour.date_jour,
                dateDebut
              );

            if (
              index >= 0 &&
              index <= 6
            ) {
              joursMap.set(
                index,
                jour
              );
            }
          }
        );

        // ====================================================
        // TR / TT
        // ====================================================

        const nombreTR =
          joursCollaborateur.filter(
            (
              jour
            ) =>
              estVrai(
                jour.ticket_restaurant
              )
          ).length;

        const nombreTT =
          joursCollaborateur.filter(
            (
              jour
            ) =>
              estTeletravail(
                jour.presence
              )
          ).length;

        // ====================================================
        // NOM
        // ====================================================

        const nomRow =
          currentRow;

        setCell(
          ws,
          nomRow,
          COL.A,
          `${(
            collaborateur.nom ||
            ""
          ).toUpperCase()} ${
            collaborateur.prenom ||
            ""
          }`
        );

        addTopBorder(
          ws,
          nomRow
        );

        // TR
        setCell(
          ws,
          nomRow + 1,
          COL.A,
          `${nombreTR} TR`
        );

        // TT
        setCell(
          ws,
          nomRow + 2,
          COL.A,
          `${nombreTT} TT`
        );

        // COMPTEUR
        const heuresSup =
          formatNumber(
            feuille.heures_supplementaires
          );

        if (
          heuresSup > 0
        ) {
          setCell(
            ws,
            nomRow + 3,
            COL.A,
            `${heuresSup} H sur compteur`
          );
        }

        // ====================================================
        // AFFAIRES
        // ====================================================

        type LigneAffaire = {
          type: string;
          numero: string;
          description: string;
          code: string;
          heures: number[];
        };

        const affaires =
          new Map<
            string,
            LigneAffaire
          >();

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex++
        ) {
          const jour =
            joursMap.get(
              dayIndex
            );

          if (!jour) {
            continue;
          }

          const imps =
            imputationsParJour.get(
              jour.id
            ) || [];

          for (
            const imputation of
              imps
          ) {
            if (
              !estProduction(
                imputation.type_affaire
              )
            ) {
              continue;
            }

            const type =
              normaliserTypeAffaire(
                imputation.type_affaire
              );

            const numero =
              (
                imputation.numero_affaire ||
                ""
              ).trim();

            const description =
              (
                imputation.description ||
                ""
              ).trim();

            const code =
              (
                imputation.code ||
                ""
              )
                .trim()
                .toUpperCase();

            const key =
              [
                type,
                numero,
                description,
                code,
              ].join(
                "|"
              );

            if (
              !affaires.has(
                key
              )
            ) {
              affaires.set(
                key,
                {
                  type,
                  numero,
                  description,
                  code,
                  heures: [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                  ],
                }
              );
            }

            const affaire =
              affaires.get(
                key
              )!;

            affaire.heures[
              dayIndex
            ] +=
              formatNumber(
                imputation.heures
              );
          }
        }

        let row =
          nomRow;

        const affairesListe =
          Array.from(
            affaires.values()
          ).sort(
            (
              a,
              b
            ) => {
              const t =
                a.type.localeCompare(
                  b.type
                );

              if (
                t !== 0
              ) {
                return t;
              }

              return a.numero.localeCompare(
                b.numero
              );
            }
          );

        // ====================================================
        // LIGNES CBE / DBE
        // ====================================================

        for (
          const affaire of
            affairesListe
        ) {
          row++;

          // C = CBE 1234 / DBE 5678
          setCell(
            ws,
            row,
            COL.C,
            affaire.numero
              ? `${affaire.type} ${affaire.numero}`
              : affaire.type
          );

          // D = FORMULE TOTAL
          setFormula(
            ws,
            row,
            COL.D,
            `=SUM(E${row + 1}:AO${
              row + 1
            })`
          );

          // Désignation dans E si disponible
          // uniquement si elle ne correspond pas
          // à une colonne de code utilisée.
          if (
            affaire.description
          ) {
            const codeCol =
              productionColumnMap.get(
                affaire.code
              );

            if (
              codeCol !==
              undefined &&
              codeCol >
                COL.E
            ) {
              // On conserve les codes à partir de E.
              // La désignation reste dans C
              // uniquement lorsque le gabarit le prévoit.
            }
          }

          // Ventilation par code
          const productionCol =
            productionColumnMap.get(
              affaire.code
            );

          if (
            productionCol !==
            undefined
          ) {
            const total =
              affaire.heures.reduce(
                (
                  s,
                  h
                ) =>
                  s +
                  formatNumber(
                    h
                  ),
                0
              );

            setCell(
              ws,
              row,
              productionCol,
              formatNumber(
                total
              )
            );
          }
        }

        // ====================================================
        // DIVERS
        // ====================================================

        row++;

        const diversRow =
          row;

        setCell(
          ws,
          diversRow,
          COL.C,
          "Divers"
        );

        // ----------------------------------------------------
        // FORMULE DIVERS
        // ----------------------------------------------------

        setFormula(
          ws,
          diversRow,
          COL.D,
          `=SUM(E${diversRow + 1}:AO${
            diversRow + 1
          })`
        );

        const diversParCode =
          new Map<
            string,
            {
              total: number;
              jours: number[];
            }
          >();

        // ----------------------------------------------------
        // IMPUTATIONS DIVERS
        // ----------------------------------------------------

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex++
        ) {
          const jour =
            joursMap.get(
              dayIndex
            );

          if (!jour) {
            continue;
          }

          const imps =
            imputationsParJour.get(
              jour.id
            ) || [];

          for (
            const imputation of
              imps
          ) {
            if (
              estProduction(
                imputation.type_affaire
              )
            ) {
              continue;
            }

            const code =
              (
                imputation.code ||
                ""
              )
                .trim()
                .toUpperCase();

            if (!code) {
              continue;
            }

            if (
              !diversParCode.has(
                code
              )
            ) {
              diversParCode.set(
                code,
                {
                  total: 0,
                  jours: [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                  ],
                }
              );
            }

            const entry =
              diversParCode.get(
                code
              )!;

            const heures =
              formatNumber(
                imputation.heures
              );

            entry.total +=
              heures;

            entry.jours[
              dayIndex
            ] +=
              heures;
          }
        }

        // ----------------------------------------------------
        // ABSENCES
        // ----------------------------------------------------

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex++
        ) {
          const jour =
            joursMap.get(
              dayIndex
            );

          if (!jour) {
            continue;
          }

          // CP
          if (
            formatNumber(
              jour.duree_cp
            ) > 0
          ) {
            if (
              !diversParCode.has(
                "CP"
              )
            ) {
              diversParCode.set(
                "CP",
                {
                  total: 0,
                  jours: [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                  ],
                }
              );
            }

            const entry =
              diversParCode.get(
                "CP"
              )!;

            const heures =
              formatNumber(
                jour.duree_cp
              );

            entry.total +=
              heures;

            entry.jours[
              dayIndex
            ] +=
              heures;
          }

          // RTT
          if (
            formatNumber(
              jour.duree_rtt
            ) > 0
          ) {
            if (
              !diversParCode.has(
                "RTT"
              )
            ) {
              diversParCode.set(
                "RTT",
                {
                  total: 0,
                  jours: [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                  ],
                }
              );
            }

            const entry =
              diversParCode.get(
                "RTT"
              )!;

            const heures =
              formatNumber(
                jour.duree_rtt
              );

            entry.total +=
              heures;

            entry.jours[
              dayIndex
            ] +=
              heures;
          }

          // RE
          if (
            formatNumber(
              jour.heures_re
            ) > 0
          ) {
            if (
              !diversParCode.has(
                "RE"
              )
            ) {
              diversParCode.set(
                "RE",
                {
                  total: 0,
                  jours: [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                  ],
                }
              );
            }

            const entry =
              diversParCode.get(
                "RE"
              )!;

            const heures =
              formatNumber(
                jour.heures_re
              );

            entry.total +=
              heures;

            entry.jours[
              dayIndex
            ] +=
              heures;
          }

          // Absence
          if (
            jour.absence &&
            formatNumber(
              jour.duree_cp
            ) === 0
          ) {
            const code =
              jour.absence
                .trim()
                .toUpperCase();

            if (
              !diversParCode.has(
                code
              )
            ) {
              diversParCode.set(
                code,
                {
                  total: 0,
                  jours: [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                  ],
                }
              );
            }

            const entry =
              diversParCode.get(
                code
              )!;

            const heures =
              formatNumber(
                jour.heures_absence
              ) ||
              formatNumber(
                jour.heures_theoriques
              );

            entry.total +=
              heures;

            entry.jours[
              dayIndex
            ] +=
              heures;
          }
        }

        // ----------------------------------------------------
        // ECRITURE DIVERS
        // ----------------------------------------------------

        diversParCode.forEach(
          (
            data,
            code
          ) => {
            const adminCol =
              adminColumnMap.get(
                code
              );

            if (
              adminCol ===
              undefined
            ) {
              return;
            }

            setCell(
              ws,
              diversRow,
              adminCol,
              formatNumber(
                data.total
              )
            );

            data.jours.forEach(
              (
                heures,
                dayIndex
              ) => {
                if (
                  heures <= 0
                ) {
                  return;
                }

                const pair =
                  DAY_PAIRS[
                    dayIndex
                  ];

                setCell(
                  ws,
                  diversRow,
                  pair.first,
                  formatNumber(
                    heures
                  )
                );

                if (
                  [
                    "CP",
                    "RTT",
                    "RE",
                    "AI",
                    "AA",
                    "ML",
                    "AT",
                    "VM",
                  ].includes(
                    code
                  )
                ) {
                  setCell(
                    ws,
                    diversRow,
                    pair.second,
                    code
                  );
                }
              }
            );
          }
        );

        // ====================================================
        // H/JOUR
        // ====================================================

        row++;

        const hJourRow =
          row;

        setCell(
          ws,
          hJourRow,
          COL.C,
          "H/Jour"
        );

        // D = formule de somme
        setFormula(
          ws,
          hJourRow,
          COL.D,
          `=SUM(AP${hJourRow + 1},AR${
            hJourRow + 1
          },AT${hJourRow + 1},AV${
            hJourRow + 1
          },AX${hJourRow + 1},AZ${
            hJourRow + 1
          },BB${hJourRow + 1})`
        );

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex++
        ) {
          const jour =
            joursMap.get(
              dayIndex
            );

          const objectif =
            jour
              ? formatNumber(
                  jour.heures_theoriques
                )
              : 0;

          const pair =
            DAY_PAIRS[
              dayIndex
            ];

          setCell(
            ws,
            hJourRow,
            pair.first,
            objectif
          );
        }

        // ====================================================
        // HEURES SUP
        // ====================================================

        row++;

        const heuresSupRow =
          row;

        setCell(
          ws,
          heuresSupRow,
          COL.C,
          "HEURES SUP"
        );

        setFormula(
          ws,
          heuresSupRow,
          COL.D,
          `=SUM(AP${heuresSupRow + 1},AR${
            heuresSupRow + 1
          },AT${heuresSupRow + 1},AV${
            heuresSupRow + 1
          },AX${heuresSupRow + 1},AZ${
            heuresSupRow + 1
          },BB${heuresSupRow + 1})`
        );

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex++
        ) {
          const jour =
            joursMap.get(
              dayIndex
            );

          let hs = 0;

          if (jour) {
            const total =
              formatNumber(
                jour.total_heures
              );

            const theorique =
              formatNumber(
                jour.heures_theoriques
              );

            hs =
              Math.max(
                0,
                total -
                  theorique
              );
          }

          const pair =
            DAY_PAIRS[
              dayIndex
            ];

          setCell(
            ws,
            heuresSupRow,
            pair.first,
            formatNumber(
              hs
            )
          );
        }

        // ====================================================
        // TOTAL
        // ====================================================

        row++;

        const totalRow =
          row;

        setCell(
          ws,
          totalRow,
          COL.C,
          "TOTAL"
        );

        setFormula(
          ws,
          totalRow,
          COL.D,
          `=SUM(AP${totalRow + 1},AR${
            totalRow + 1
          },AT${totalRow + 1},AV${
            totalRow + 1
          },AX${totalRow + 1},AZ${
            totalRow + 1
          },BB${totalRow + 1})`
        );

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex++
        ) {
          const jour =
            joursMap.get(
              dayIndex
            );

          if (!jour) {
            continue;
          }

          const total =
            formatNumber(
              jour.total_heures
            );

          const pair =
            DAY_PAIRS[
              dayIndex
            ];

          // On met d'abord les heures
          // dans la première cellule.
          setCell(
            ws,
            totalRow,
            pair.first,
            total
          );

          // Puis le statut :
          // la couleur du statut est prioritaire.
          if (
            estAbsent(
              jour
            )
          ) {
            mergeStatus(
              ws,
              totalRow,
              pair.first,
              "Absent",
              COLORS.ABSENT
            );
          } else if (
            estTeletravail(
              jour.presence
            )
          ) {
            mergeStatus(
              ws,
              totalRow,
              pair.first,
              "Télétravail",
              COLORS.TELETRAVAIL
            );
          } else {
            mergeStatus(
              ws,
              totalRow,
              pair.first,
              "Présentiel",
              COLORS.PRESENTIEL
            );
          }
        }

        // ====================================================
        // PROCHAIN COLLABORATEUR
        // ====================================================

        currentRow =
          totalRow + 2;
      }

      // ======================================================
      // MISE EN FORME FINALE
      // ======================================================

      const maxRows =
        Math.max(
          currentRow + 5,
          150
        );

      // ------------------------------------------------------
      // COULEURS
      // ------------------------------------------------------

      applyColumnColors(
        ws,
        maxRows
      );

      // ------------------------------------------------------
      // BORDURES LATERALES
      // ------------------------------------------------------

      applySideBorders(
        ws,
        maxRows
      );

      // ------------------------------------------------------
      // CENTRAGE
      // ------------------------------------------------------

      centerAllCells(
        ws,
        maxRows
      );

      // ------------------------------------------------------
      // STATUTS A NOUVEAU
      // ------------------------------------------------------
      //
      // IMPORTANT :
      // les couleurs de statut sont appliquées
      // APRES les couleurs de colonnes.
      //
      // Elles sont donc prioritaires.
      //

      // Les cellules de statut sont déjà colorées
      // lors de leur création, mais on ne les réécrit
      // pas ici pour éviter de perdre leur couleur.

      // ------------------------------------------------------
      // ENTETES
      // ------------------------------------------------------

      styleMainHeaders(
        ws
      );

      styleD1(
        ws
      );

      // ------------------------------------------------------
      // LARGEUR A = 20
      // ------------------------------------------------------

      if (
        !ws["!cols"]
      ) {
        ws["!cols"] = [];
      }

      ws["!cols"][
        COL.A
      ] = {
        ...(ws["!cols"][
          COL.A
        ] || {}),
        wch: 20,
      };

      // ------------------------------------------------------
      // AUTRES LARGEURS
      // ------------------------------------------------------

      for (
        let col = COL.B;
        col <= COL.BC;
        col++
      ) {
        if (
          !ws["!cols"][
            col
          ]
        ) {
          ws["!cols"][
            col
          ] = {
            wch: 11,
          };
        }
      }

      // ------------------------------------------------------
      // HAUTEUR D1
      // ------------------------------------------------------

      if (
        !ws["!rows"]
      ) {
        ws["!rows"] = [];
      }

      ws["!rows"][0] = {
        ...(ws["!rows"][0] ||
          {}),
        hpt: 35,
      };

      // ------------------------------------------------------
      // REF
      // ------------------------------------------------------

      ws["!ref"] =
        `A1:${excelColumn(
          COL.BC
        )}${maxRows}`;

      // ======================================================
      // EXPORT
      // ======================================================

      const output =
        XLSX.write(
          workbook,
          {
            bookType:
              "xlsx",
            type:
              "array",
            cellStyles:
              true,
          }
        );

      const blob =
        new Blob(
          [output],
          {
            type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }
        );

      const url =
        window.URL.createObjectURL(
          blob
        );

      const link =
        document.createElement(
          "a"
        );

      link.href =
        url;

      link.download =
        `${nomOnglet}.xlsx`;

      document.body.appendChild(
        link
      );

      link.click();

      link.remove();

      window.URL.revokeObjectURL(
        url
      );

      setMessage(
        `Export ${nomOnglet} terminé : ${collaborateursAvecFeuille.length} collaborateur(s).`
      );
    } catch (
      error: any
    ) {
      console.error(
        "Erreur export Excel :",
        error
      );

      setMessage(
        `Erreur : ${
          error?.message ||
          "une erreur est survenue."
        }`
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  // ==========================================================
  // INTERFACE
  // ==========================================================

  return (
    <main
      style={{
        padding:
          "30px",
        fontFamily:
          "Calibri, Arial, sans-serif",
      }}
    >
      <h1
        style={{
          marginBottom:
            "25px",
        }}
      >
        Export Excel des feuilles d'heures
      </h1>

      <div
        style={{
          display:
            "flex",
          gap:
            "15px",
          alignItems:
            "flex-end",
          flexWrap:
            "wrap",
        }}
      >
        <div>
          <label
            style={{
              display:
                "block",
              marginBottom:
                "6px",
              fontWeight:
                700,
            }}
          >
            Année
          </label>

          <input
            type="number"
            value={
              annee
            }
            onChange={(
              e
            ) =>
              setAnnee(
                Number(
                  e.target.value
                )
              )
            }
            style={{
              width:
                "110px",
              padding:
                "10px",
              border:
                "1px solid #ccc",
              borderRadius:
                "5px",
            }}
          />
        </div>

        <div>
          <label
            style={{
              display:
                "block",
              marginBottom:
                "6px",
              fontWeight:
                700,
            }}
          >
            Semaine
          </label>

          <input
            type="number"
            min={1}
            max={53}
            value={
              semaine
            }
            onChange={(
              e
            ) =>
              setSemaine(
                Number(
                  e.target.value
                )
              )
            }
            style={{
              width:
                "110px",
              padding:
                "10px",
              border:
                "1px solid #ccc",
              borderRadius:
                "5px",
            }}
          />
        </div>

        <button
          type="button"
          onClick={
            exporter
          }
          disabled={
            loading
          }
          style={{
            padding:
              "11px 20px",
            background:
              "#c00000",
            color:
              "#fff",
            border:
              "none",
            borderRadius:
              "5px",
            cursor:
              loading
                ? "wait"
                : "pointer",
            fontWeight:
              700,
          }}
        >
          {loading
            ? "Export en cours..."
            : "Exporter la semaine"}
        </button>
      </div>

      {message && (
        <div
          style={{
            marginTop:
              "20px",
            padding:
              "12px 15px",
            background:
              message.startsWith(
                "Erreur"
              )
                ? "#f8d7da"
                : "#d4edda",
            color:
              message.startsWith(
                "Erreur"
              )
                ? "#721c24"
                : "#155724",
            borderRadius:
              "5px",
          }}
        >
          {message}
        </div>
      )}

      <div
        style={{
          marginTop:
            "30px",
          padding:
            "15px",
          background:
            "#f5f5f5",
          borderRadius:
            "6px",
          maxWidth:
            "850px",
        }}
      >
        <strong>
          Export :
        </strong>{" "}
        un seul onglet{" "}
        <strong>
          S
          {String(
            semaine
          ).padStart(
            2,
            "0"
          )}
          -
          {annee}
        </strong>
        , construit depuis le{" "}
        <strong>
          Gabarit
        </strong>
        et alimenté uniquement avec les
        collaborateurs ayant une feuille
        pour cette semaine.
      </div>
    </main>
  );
}