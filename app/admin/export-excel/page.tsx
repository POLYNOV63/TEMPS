"use client";

import { useState } from "react";
import * as XLSX from "xlsx-js-style";
import { supabase } from "@/lib/supabase";

type Collaborateur = {
  id: string;
  prenom: string;
  nom: string;
  trigramme: string | null;
  actif: boolean;
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

type CodeMetier = {
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

/*
 * E:Y = production
 */
const COL_PROD_DEBUT = 4;
const COL_PROD_FIN = 24;

/*
 * Z:AO = administratif
 */
const COL_ADMIN_DEBUT = 25;
const COL_ADMIN_FIN = 40;

/*
 * AP:AQ lundi
 * AR:AS mardi
 * AT:AU mercredi
 * AV:AW jeudi
 * AX:AY vendredi
 * AZ:BA samedi
 * BB:BC dimanche
 */
const COL_JOUR_DEBUT = 41;

function col(c: number) {
  return XLSX.utils.encode_col(c);
}

function adresse(c: number, ligne: number) {
  return `${col(c)}${ligne}`;
}

function arrondi(n: number) {
  return Math.round(n * 100) / 100;
}

function ecrire(
  feuille: XLSX.WorkSheet,
  adresseCellule: string,
  valeur: any
) {
  if (typeof valeur === "number") {
    feuille[adresseCellule] = {
      ...(feuille[adresseCellule] || {}),
      t: "n",
      v: arrondi(valeur),
    };
  } else {
    feuille[adresseCellule] = {
      ...(feuille[adresseCellule] || {}),
      t: "s",
      v: valeur ?? "",
    };
  }
}

function typeAffaire(type: string | null) {
  const t = (type || "").trim().toUpperCase();

  if (t.includes("DBE")) return "DBE";
  if (t.includes("CBE")) return "CBE";
  if (t.includes("DIVERS")) return "DIVERS";

  return t;
}

function lundiISO(
  annee: number,
  semaine: number
) {
  const jan4 = new Date(
    Date.UTC(annee, 0, 4)
  );

  const jour =
    jan4.getUTCDay() || 7;

  const lundi1 =
    new Date(jan4);

  lundi1.setUTCDate(
    jan4.getUTCDate() -
      jour +
      1
  );

  const lundi =
    new Date(lundi1);

  lundi.setUTCDate(
    lundi.getUTCDate() +
      (semaine - 1) * 7
  );

  return lundi
    .toISOString()
    .slice(0, 10);
}

/*
 * Copie la mise en forme d'une ligne du Gabarit
 * sans copier son contenu.
 *
 * Avec xlsx-js-style, la propriété "s" est réellement
 * réécrite dans le fichier Excel.
 */
function copierMEFLigne(
  source: XLSX.WorkSheet,
  destination: XLSX.WorkSheet,
  ligneSource: number,
  ligneDestination: number
) {
  for (
    let c = 0;
    c < NB_COLONNES;
    c++
  ) {
    const src =
      source[
        adresse(c, ligneSource)
      ];

    const dstAdresse =
      adresse(c, ligneDestination);

    if (!src) continue;

    const valeur =
      destination[dstAdresse]?.v;

    const formule =
      destination[dstAdresse]?.f;

    const type =
      destination[dstAdresse]?.t;

    const lien =
      destination[dstAdresse]?.l;

    destination[dstAdresse] = {
      ...src,

      /*
       * On garde la valeur que notre génération
       * vient éventuellement d'écrire.
       */
      v: valeur,
      f: formule,
      t: type,

      /*
       * On garde également le lien généré.
       */
      l: lien,

      /*
       * IMPORTANT :
       * c'est la mise en forme du Gabarit.
       */
      s: src.s,
    };
  }
}

/*
 * Copie également les hauteurs de lignes.
 */
function copierHauteurLigne(
  source: XLSX.WorkSheet,
  destination: XLSX.WorkSheet,
  ligneSource: number,
  ligneDestination: number
) {
  if (!source["!rows"]) return;

  const sourceRow =
    source["!rows"][ligneSource - 1];

  if (!sourceRow) return;

  destination["!rows"] =
    destination["!rows"] || [];

  destination["!rows"][
    ligneDestination - 1
  ] = {
    ...sourceRow,
  };
}

/*
 * Fusion d'un statut sur deux colonnes.
 */
function fusionnerJour(
  feuille: XLSX.WorkSheet,
  ligne: number,
  colonne: number
) {
  feuille["!merges"] =
    feuille["!merges"] || [];

  const existe =
    feuille["!merges"].some(
      (m: any) =>
        m.s.r === ligne - 1 &&
        m.s.c === colonne &&
        m.e.r === ligne - 1 &&
        m.e.c === colonne + 1
    );

  if (!existe) {
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
  }

  ecrire(
    feuille,
    adresse(
      colonne + 1,
      ligne
    ),
    ""
  );
}

export default function ExportExcelPage() {
  const [semaine, setSemaine] =
    useState("39");

  const [annee, setAnnee] =
    useState("2026");

  const [chargement, setChargement] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function exporter() {
    try {
      setChargement(true);
      setMessage("");

      /*
       * ==========================================================
       * 1. CONTROLE ADMIN
       * ==========================================================
       */

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error(
          "Vous devez être connecté."
        );
      }

      const {
        data: profil,
        error: erreurProfil,
      } = await supabase
        .from("collaborateurs")
        .select("role")
        .eq("auth_user_id", user.id)
        .single();

      if (erreurProfil) {
        throw erreurProfil;
      }

      if (profil?.role !== "ADMIN") {
        throw new Error(
          "Vous n'avez pas les droits administrateur."
        );
      }

      /*
       * ==========================================================
       * 2. CHARGEMENT DU GABARIT
       * ==========================================================
       */

      const response =
        await fetch(
          "/Recuperation heures pour export.xlsx"
        );

      if (!response.ok) {
        throw new Error(
          "Impossible de charger le fichier Gabarit."
        );
      }

      const buffer =
        await response.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",

          /*
           * IMPORTANT POUR LA MEF
           */
          cellStyles: true,

          cellFormula: true,

          /*
           * On conserve le VBA du fichier source.
           */
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
       * ==========================================================
       * 3. NOUVEL ONGLET
       *
       * On construit uniquement S39-2026.
       * ==========================================================
       */

      const nomOnglet =
        `S${semaine}-${annee}`;

      /*
       * On repart d'une feuille vierge.
       */
      const feuilleExcel: XLSX.WorkSheet =
        {};

      /*
       * ==========================================================
       * 4. COPIE DU GABARIT
       *
       * On copie :
       * - contenu initial utile
       * - styles
       * - largeurs
       * - hauteurs
       * - fusions
       *
       * Mais le fichier final ne contiendra PAS Gabarit.
       * ==========================================================
       */

      const rangeGabarit =
        gabarit["!ref"]
          ? XLSX.utils.decode_range(
              gabarit["!ref"]
            )
          : {
              s: { r: 0, c: 0 },
              e: {
                r: 1,
                c: 54,
              },
            };

      for (
        let r =
          rangeGabarit.s.r;
        r <=
          rangeGabarit.e.r;
        r++
      ) {
        for (
          let c =
            rangeGabarit.s.c;
          c <=
            rangeGabarit.e.c;
          c++
        ) {
          const a =
            adresse(
              c,
              r + 1
            );

          const source =
            gabarit[a];

          if (!source) continue;

          feuilleExcel[a] =
            {
              ...source,

              /*
               * On reprend bien le style.
               */
              s: source.s,
            };
        }
      }

      /*
       * Largeurs de colonnes
       */
      if (gabarit["!cols"]) {
        feuilleExcel["!cols"] =
          gabarit[
            "!cols"
          ].map(
            (c: any) => ({
              ...c,
            })
          );
      }

      /*
       * Hauteurs
       */
      if (gabarit["!rows"]) {
        feuilleExcel["!rows"] =
          gabarit[
            "!rows"
          ].map(
            (r: any) => ({
              ...r,
            })
          );
      }

      /*
       * Fusions initiales
       */
      if (gabarit["!merges"]) {
        feuilleExcel[
          "!merges"
        ] =
          gabarit[
            "!merges"
          ].map(
            (m: any) => ({
              ...m,
            })
          );
      }

      /*
       * ==========================================================
       * 5. SUPPRESSION DES AUTRES ONGLETS
       *
       * LE FICHIER FINAL N'AURA QUE S39-2026
       * ==========================================================
       */

      workbook.Sheets = {
        [nomOnglet]:
          feuilleExcel,
      };

      workbook.SheetNames = [
        nomOnglet,
      ];

      /*
       * ==========================================================
       * 6. ANNEE / SEMAINE
       * ==========================================================
       */

      ecrire(
        feuilleExcel,
        "B1",
        Number(annee)
      );

      ecrire(
        feuilleExcel,
        "B2",
        Number(semaine)
      );

      /*
       * ==========================================================
       * 7. COLLABORATEURS
       * ==========================================================
       */

      const {
        data: collaborateurs,
        error:
          erreurCollaborateurs,
      } = await supabase
        .from("collaborateurs")
        .select(
          "id, prenom, nom, trigramme, actif"
        )
        .eq("actif", true)
        .order("nom");

      if (erreurCollaborateurs) {
        throw erreurCollaborateurs;
      }

      /*
       * ==========================================================
       * 8. FEUILLES
       * ==========================================================
       */

      const debut =
        lundiISO(
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
          debut
        );

      if (erreurFeuilles) {
        throw erreurFeuilles;
      }

      /*
       * ==========================================================
       * 9. JOURS
       * ==========================================================
       */

      const idsFeuilles =
        (feuilles || []).map(
          (f: Feuille) =>
            f.id
        );

      let jours: Jour[] =
        [];

      if (
        idsFeuilles.length
      ) {
        const {
          data,
          error,
        } = await supabase
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
            idsFeuilles
          );

        if (error) throw error;

        jours = data || [];
      }

      /*
       * ==========================================================
       * 10. IMPUTATIONS
       * ==========================================================
       */

      const idsJours =
        jours.map(
          (j) => j.id
        );

      let imputations:
        Imputation[] =
        [];

      if (idsJours.length) {
        const {
          data,
          error,
        } = await supabase
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

        imputations =
          data || [];
      }

      /*
       * ==========================================================
       * 11. CODES
       * ==========================================================
       */

      const {
        data: codes,
        error: erreurCodes,
      } = await supabase
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
            ordre_affichage
          `
        )
        .eq(
          "actif",
          true
        )
        .order(
          "ordre_affichage",
          {
            ascending:
              true,
          }
        );

      if (erreurCodes) {
        throw erreurCodes;
      }

      const codesMetier =
        (codes ||
          []) as CodeMetier[];

      /*
       * ==========================================================
       * 12. INDEX
       * ==========================================================
       */

      const feuilleParCollaborateur =
        new Map<
          string,
          Feuille
        >();

      (feuilles ||
        []).forEach(
        (f: Feuille) => {
          feuilleParCollaborateur.set(
            f.collaborateur_id,
            f
          );
        }
      );

      /*
       * ==========================================================
       * 13. CODES UTILISES
       * ==========================================================
       */

      const production =
        new Set<string>();

      const administratif =
        new Set<string>();

      imputations.forEach(
        (imp) => {
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
                  .toUpperCase() ===
                code
            );

          if (
            info?.autorise_affaire ||
            info?.autorise_devis
          ) {
            production.add(
              code
            );
          } else if (
            info?.autorise_divers
          ) {
            administratif.add(
              code
            );
          }
        }
      );

      function trierCodes(
        set: Set<string>
      ) {
        return Array.from(
          set
        ).sort(
          (a, b) => {
            const ca =
              codesMetier.find(
                (c) =>
                  c.code
                    .trim()
                    .toUpperCase() ===
                  a
              );

            const cb =
              codesMetier.find(
                (c) =>
                  c.code
                    .trim()
                    .toUpperCase() ===
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
              return oa - ob;
            }

            return a.localeCompare(
              b
            );
          }
        );
      }

      const codesProduction =
        trierCodes(
          production
        );

      const codesAdministratifs =
        trierCodes(
          administratif
        );

      /*
       * ==========================================================
       * 14. NETTOYAGE DES CODES DU GABARIT
       * ==========================================================
       */

      for (
        let c =
          COL_PROD_DEBUT;
        c <=
          COL_PROD_FIN;
        c++
      ) {
        ecrire(
          feuilleExcel,
          adresse(c, 2),
          ""
        );
      }

      for (
        let c =
          COL_ADMIN_DEBUT;
        c <=
          COL_ADMIN_FIN;
        c++
      ) {
        ecrire(
          feuilleExcel,
          adresse(c, 2),
          ""
        );
      }

      /*
       * ==========================================================
       * 15. CODES PRODUCTION
       * ==========================================================
       */

      codesProduction.forEach(
        (
          code,
          index
        ) => {
          const c =
            COL_PROD_DEBUT +
            index;

          if (
            c >
            COL_PROD_FIN
          )
            return;

          ecrire(
            feuilleExcel,
            adresse(c, 2),
            code
          );
        }
      );

      /*
       * ==========================================================
       * 16. CODES ADMINISTRATIFS
       * ==========================================================
       */

      codesAdministratifs.forEach(
        (
          code,
          index
        ) => {
          const c =
            COL_ADMIN_DEBUT +
            index;

          if (
            c >
            COL_ADMIN_FIN
          )
            return;

          ecrire(
            feuilleExcel,
            adresse(c, 2),
            code
          );
        }
      );

      /*
       * ==========================================================
       * 17. EXPORT DES COLLABORATEURS
       * ==========================================================
       */

      const collaborateursExport =
        (
          collaborateurs ||
          []
        ).filter(
          (
            c: Collaborateur
          ) =>
            feuilleParCollaborateur.has(
              c.id
            )
        );

      let ligne = 3;

      for (
        const collaborateur of collaborateursExport
      ) {
        const feuille =
          feuilleParCollaborateur.get(
            collaborateur.id
          );

        if (!feuille)
          continue;

        const joursCollab =
          jours.filter(
            (j) =>
              j.feuille_id ===
              feuille.id
          );

        const ids =
          new Set(
            joursCollab.map(
              (j) => j.id
            )
          );

        const imps =
          imputations.filter(
            (i) =>
              ids.has(
                i.jour_id
              )
          );

        /*
         * ========================================================
         * LIGNE NOM
         * ========================================================
         */

        copierMEFLigne(
          gabarit,
          feuilleExcel,
          2,
          ligne
        );

        copierHauteurLigne(
          gabarit,
          feuilleExcel,
          2,
          ligne
        );

        ecrire(
          feuilleExcel,
          `A${ligne}`,
          `${collaborateur.nom.toUpperCase()} ${collaborateur.prenom}`
        );

        feuilleExcel[
          `A${ligne}`
        ].l = {
          Target:
            `/ma-semaine?semaine=${semaine}&collaborateur=${collaborateur.id}`,
        };

        /*
         * TR
         */

        const tr =
          joursCollab.filter(
            (j) =>
              j.ticket_restaurant
          ).length;

        ecrire(
          feuilleExcel,
          `A${ligne + 1}`,
          `${tr} TR`
        );

        /*
         * TT
         */

        const tt =
          joursCollab.filter(
            (j) =>
              (
                j.presence ||
                ""
              )
                .trim()
                .toUpperCase() ===
              "TELETRAVAIL"
          ).length;

        ecrire(
          feuilleExcel,
          `A${ligne + 2}`,
          `${tt} jour(s) TT`
        );

        /*
         * ========================================================
         * AFFAIRES
         * ========================================================
         */

        const affaires =
          new Map<
            string,
            Affaire
          >();

        imps.forEach(
          (imp) => {
            const heures =
              Number(
                imp.heures ||
                  0
              );

            if (!heures)
              return;

            const type =
              typeAffaire(
                imp.type_affaire
              );

            if (
              type !==
                "CBE" &&
              type !==
                "DBE"
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

            const cle =
              [
                type,
                numero,
                description,
              ].join(
                "|"
              );

            if (
              !affaires.has(
                cle
              )
            ) {
              affaires.set(
                cle,
                {
                  type,
                  numero,
                  description,
                  heuresParCode:
                    {},
                  total: 0,
                }
              );
            }

            const affaire =
              affaires.get(
                cle
              )!;

            affaire.heuresParCode[
              code
            ] =
              (
                affaire
                  .heuresParCode[
                    code
                  ] ||
                0
              ) + heures;

            affaire.total +=
              heures;
          }
        );

        for (
          const affaire of affaires.values()
        ) {
          copierMEFLigne(
            gabarit,
            feuilleExcel,
            2,
            ligne
          );

          copierHauteurLigne(
            gabarit,
            feuilleExcel,
            2,
            ligne
          );

          ecrire(
            feuilleExcel,
            `C${ligne}`,
            `${affaire.type} ${affaire.numero}`
          );

          ecrire(
            feuilleExcel,
            `D${ligne}`,
            affaire.total
          );

          codesProduction.forEach(
            (
              code,
              index
            ) => {
              const heures =
                affaire
                  .heuresParCode[
                    code
                  ] || 0;

              if (!heures)
                return;

              ecrire(
                feuilleExcel,
                adresse(
                  COL_PROD_DEBUT +
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
         * ========================================================
         * DIVERS
         * ========================================================
         */

        const divers:
          Record<
            string,
            number
          > = {};

        let totalDivers = 0;

        imps.forEach(
          (imp) => {
            const type =
              typeAffaire(
                imp.type_affaire
              );

            if (
              type !==
                "DIVERS" &&
              type !== ""
            ) {
              return;
            }

            const heures =
              Number(
                imp.heures ||
                  0
              );

            if (!heures)
              return;

            const code =
              (
                imp.code ||
                ""
              )
                .trim()
                .toUpperCase();

            if (!code)
              return;

            divers[code] =
              (
                divers[code] ||
                0
              ) + heures;

            totalDivers +=
              heures;
          }
        );

        if (
          totalDivers >
          0
        ) {
          copierMEFLigne(
            gabarit,
            feuilleExcel,
            2,
            ligne
          );

          copierHauteurLigne(
            gabarit,
            feuilleExcel,
            2,
            ligne
          );

          ecrire(
            feuilleExcel,
            `C${ligne}`,
            "Divers"
          );

          ecrire(
            feuilleExcel,
            `D${ligne}`,
            totalDivers
          );

          codesAdministratifs.forEach(
            (
              code,
              index
            ) => {
              const heures =
                divers[
                  code
                ] || 0;

              if (!heures)
                return;

              ecrire(
                feuilleExcel,
                adresse(
                  COL_ADMIN_DEBUT +
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
         * ========================================================
         * H/JOUR
         * ========================================================
         */

        const ligneHjour =
          ligne;

        copierMEFLigne(
          gabarit,
          feuilleExcel,
          2,
          ligneHjour
        );

        ecrire(
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

            const indexJour =
              js === 0
                ? 6
                : js - 1;

            if (
              indexJour <
                0 ||
              indexJour >
                6
            )
              return;

            const c =
              COL_JOUR_DEBUT +
              indexJour *
                2;

            ecrire(
              feuilleExcel,
              adresse(
                c,
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
         * ========================================================
         * HEURES SUP
         * ========================================================
         */

        const ligneHS =
          ligne;

        copierMEFLigne(
          gabarit,
          feuilleExcel,
          2,
          ligneHS
        );

        ecrire(
          feuilleExcel,
          `C${ligneHS}`,
          "HEURES SUP"
        );

        ecrire(
          feuilleExcel,
          `D${ligneHS}`,
          Number(
            feuille.heures_supplementaires ||
              0
          )
        );

        ligne++;

        /*
         * ========================================================
         * TOTAL
         * ========================================================
         */

        const ligneTotal =
          ligne;

        copierMEFLigne(
          gabarit,
          feuilleExcel,
          2,
          ligneTotal
        );

        ecrire(
          feuilleExcel,
          `C${ligneTotal}`,
          "TOTAL"
        );

        ecrire(
          feuilleExcel,
          `D${ligneTotal}`,
          Number(
            feuille.total_heures ||
              0
          )
        );

        /*
         * ========================================================
         * STATUTS
         * ========================================================
         */

        joursCollab.forEach(
          (jour) => {
            const date =
              new Date(
                `${jour.date_jour}T12:00:00`
              );

            const js =
              date.getDay();

            const indexJour =
              js === 0
                ? 6
                : js - 1;

            /*
             * WE VIDE
             */
            if (
              indexJour >=
              5
            ) {
              return;
            }

            let statut =
              "";

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

            if (
              absence
            ) {
              statut =
                "Absent";
            } else if (
              presence ===
              "TELETRAVAIL"
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
            }

            if (!statut)
              return;

            const c =
              COL_JOUR_DEBUT +
              indexJour *
                2;

            /*
             * AP:AQ
             * AR:AS
             * etc.
             */
            ecrire(
              feuilleExcel,
              adresse(
                c,
                ligneTotal
              ),
              statut
            );

            fusionnerJour(
              feuilleExcel,
              ligneTotal,
              c
            );
          }
        );

        /*
         * Ligne suivante
         */
        ligne =
          ligneTotal + 2;
      }

      /*
       * ==========================================================
       * REF
       * ==========================================================
       */

      feuilleExcel["!ref"] =
        `A1:BC${Math.max(
          ligne,
          3
        )}`;

      /*
       * ==========================================================
       * EXPORT
       *
       * Il n'y a qu'un seul onglet :
       * S39-2026
       * ==========================================================
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
        `${nomOnglet} généré avec succès. ` +
          `Production : ${
            codesProduction.join(
              ", "
            ) ||
            "aucun"
          }. ` +
          `Administratif : ${
            codesAdministratifs.join(
              ", "
            ) ||
            "aucun"
          }.`
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

  return (
    <main
      style={{
        padding: 30,
        fontFamily:
          "Calibri, Arial, sans-serif",
      }}
    >
      <h1>
        Export Excel
      </h1>

      <div
        style={{
          display: "flex",
          gap: 15,
          alignItems:
            "center",
          marginTop: 20,
        }}
      >
        <label>
          Semaine :
          <input
            type="number"
            min={1}
            max={53}
            value={semaine}
            onChange={(e) =>
              setSemaine(
                e.target.value
              )
            }
            style={{
              marginLeft: 8,
              width: 70,
            }}
          />
        </label>

        <label>
          Année :
          <input
            type="number"
            value={annee}
            onChange={(e) =>
              setAnnee(
                e.target.value
              )
            }
            style={{
              marginLeft: 8,
              width: 90,
            }}
          />
        </label>

        <button
          onClick={exporter}
          disabled={
            chargement
          }
          style={{
            background:
              "#c00000",
            color: "white",
            border: "none",
            padding:
              "10px 18px",
            borderRadius: 4,
            cursor:
              chargement
                ? "default"
                : "pointer",
            fontWeight:
              "bold",
          }}
        >
          {chargement
            ? "Génération..."
            : "Exporter la semaine"}
        </button>
      </div>

      {message && (
        <div
          style={{
            marginTop: 25,
            padding: 15,
            background:
              "#f5f5f5",
            border:
              "1px solid #ddd",
          }}
        >
          {message}
        </div>
      )}
    </main>
  );
}