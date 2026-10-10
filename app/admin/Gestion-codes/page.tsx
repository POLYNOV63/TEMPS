"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";

/* ============================================================
   TYPES
============================================================ */

type Categorie =
  | "PRODUCTION"
  | "COMMERCIAL"
  | "FORMATION"
  | "ABSENCE"
  | "NI"
  | "HORS_BILAN";

type CodeImputation = {
  code: string;
  libelle: string;
  categorie: Categorie;
  autorise_affaire: boolean;
  autorise_devis: boolean;
  autorise_divers: boolean;
  actif: boolean;
};

type CodeNouveau = CodeImputation & {
  nouveau?: boolean;
};

/* ============================================================
   CONSTANTES
============================================================ */

const CATEGORIES: Categorie[] = [
  "PRODUCTION",
  "COMMERCIAL",
  "FORMATION",
  "ABSENCE",
  "NI",
  "HORS_BILAN",
];

/* ============================================================
   RÈGLES MÉTIER DES CATÉGORIES
============================================================ */

function categorieSansImputationDirecte(categorie: Categorie) {
  return categorie === "ABSENCE" || categorie === "HORS_BILAN";
}

function appliquerReglesCategorie(
  categorie: Categorie,
  valeurs: Partial<Pick<CodeImputation, "autorise_affaire" | "autorise_devis" | "autorise_divers">>
) {
  if (categorie === "NI") {
    return {
      autorise_affaire: false,
      autorise_devis: false,
      autorise_divers: true,
    };
  }

  if (categorieSansImputationDirecte(categorie)) {
    return {
      autorise_affaire: false,
      autorise_devis: false,
      autorise_divers: false,
    };
  }

  return {
    autorise_affaire: Boolean(valeurs.autorise_affaire),
    autorise_devis: Boolean(valeurs.autorise_devis),
    autorise_divers: Boolean(valeurs.autorise_divers),
  };
}

/* ============================================================
   OUTILS
============================================================ */

function normaliserCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function creerCodeVide(): CodeNouveau {
  return {
    code: "",
    libelle: "",
    categorie: "PRODUCTION",
    autorise_affaire: false,
    autorise_devis: false,
    autorise_divers: false,
    actif: true,
    nouveau: true,
  };
}

/* ============================================================
   PAGE
============================================================ */

function GestionCodesPageContenu() {
  const [codes, setCodes] = useState<CodeNouveau[]>([]);

  const [chargement, setChargement] =
    useState(true);

  const [enregistrement, setEnregistrement] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [erreur, setErreur] =
    useState("");

  const [recherche, setRecherche] =
    useState("");

  const [nouvelleLigne, setNouvelleLigne] =
    useState<CodeNouveau>(creerCodeVide());

  const [codesInactifsOuverts, setCodesInactifsOuverts] =
    useState(false);

  /* ==========================================================
     MODIFICATIONS NON ENREGISTREES
  ========================================================== */

  // Photo des codes tels qu'ils sont en base au dernier chargement.
  const codesInitiauxRef = useRef("");

  const modificationsEnAttente = useMemo(
    () =>
      !chargement &&
      (JSON.stringify(codes) !== codesInitiauxRef.current ||
        nouvelleLigne.code.trim() !== "" ||
        nouvelleLigne.libelle.trim() !== ""),
    [codes, nouvelleLigne, chargement]
  );

  // Avertit avant de fermer ou de recharger la page avec une saisie non enregistrée.
  useEffect(() => {
    function avertir(event: BeforeUnloadEvent) {
      if (!modificationsEnAttente) return;

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", avertir);

    return () => window.removeEventListener("beforeunload", avertir);
  }, [modificationsEnAttente]);

  function confirmerAvantQuitter() {
    return (
      !modificationsEnAttente ||
      window.confirm(
        "Des modifications n'ont pas été enregistrées.\n\nQuitter cette page sans enregistrer ?"
      )
    );
  }

  /* ==========================================================
     CHARGEMENT
  ========================================================== */

  const chargerCodes = useCallback(async () => {
    setChargement(true);
    setErreur("");

    try {
      const {
        data,
        error,
      } = await supabase
        .from("codes_imputation")
        .select(
          `
          code,
          libelle,
          categorie,
          autorise_affaire,
          autorise_devis,
          autorise_divers,
          actif
        `
        )
        .order("actif", {
          ascending: false,
        })
        .order("code", {
          ascending: true,
        });

      if (error) {
        throw new Error(
          `Lecture des codes impossible : ${error.message}`
        );
      }

const codesCharges: CodeNouveau[] =
  (data ?? []).map((code) => {
    const categorie =
      (code.categorie as Categorie) ??
      "PRODUCTION";

    const autorisations =
      appliquerReglesCategorie(
        categorie,
        {
          autorise_affaire:
            code.autorise_affaire === true,

          autorise_devis:
            code.autorise_devis === true,

          autorise_divers:
            code.autorise_divers === true,
        }
      );

    return {
      code: String(code.code ?? ""),

      libelle:
        String(code.libelle ?? ""),

      categorie,

      ...autorisations,

      actif:
        code.actif !== false,

      nouveau: false,
    };
  });

      codesInitiauxRef.current = JSON.stringify(codesCharges);
      setCodes(codesCharges);
    } catch (e) {
      console.error(e);

      setErreur(
        e instanceof Error
          ? e.message
          : "Erreur lors du chargement des codes."
      );
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    chargerCodes();
  }, [chargerCodes]);

  /* ==========================================================
     MODIFICATION D'UNE LIGNE
  ========================================================== */

  function modifierCode(
    codeRecherche: string,
    modifications: Partial<CodeNouveau>
  ) {
    setCodes((anciens) =>
      anciens.map((code) => {
        if (code.code !== codeRecherche) {
          return code;
        }

        const categorie =
          (modifications.categorie ?? code.categorie) as Categorie;

        const autorisations = appliquerReglesCategorie(
          categorie,
          {
            autorise_affaire:
              modifications.autorise_affaire ?? code.autorise_affaire,
            autorise_devis:
              modifications.autorise_devis ?? code.autorise_devis,
            autorise_divers:
              modifications.autorise_divers ?? code.autorise_divers,
          }
        );

        return {
          ...code,
          ...modifications,
          categorie,
          ...autorisations,
        };
      })
    );
  }

  /* ==========================================================
     FILTRE
  ========================================================== */

  const codesActifs = useMemo(() => {
    const rechercheNormalisee =
      recherche
        .trim()
        .toLowerCase();

    return codes.filter((code) => {
      if (!code.actif) {
        return false;
      }

      if (!rechercheNormalisee) {
        return true;
      }

      return (
        code.code
          .toLowerCase()
          .includes(
            rechercheNormalisee
          ) ||
        code.libelle
          .toLowerCase()
          .includes(
            rechercheNormalisee
          ) ||
        code.categorie
          .toLowerCase()
          .includes(
            rechercheNormalisee
          )
      );
    });
  }, [codes, recherche]);

  const codesInactifs = useMemo(() => {
    const rechercheNormalisee =
      recherche
        .trim()
        .toLowerCase();

    return codes.filter((code) => {
      if (code.actif) {
        return false;
      }

      if (!rechercheNormalisee) {
        return true;
      }

      return (
        code.code
          .toLowerCase()
          .includes(
            rechercheNormalisee
          ) ||
        code.libelle
          .toLowerCase()
          .includes(
            rechercheNormalisee
          ) ||
        code.categorie
          .toLowerCase()
          .includes(
            rechercheNormalisee
          )
      );
    });
  }, [codes, recherche]);

  /* ==========================================================
     VALIDATION D'UNE LIGNE
  ========================================================== */

  function validerCode(
    code: CodeNouveau
  ) {
    const codeNormalise =
      normaliserCode(code.code);

    if (!codeNormalise) {
      return "Le code est obligatoire.";
    }

    if (!code.libelle.trim()) {
      return `Le code ${codeNormalise} doit avoir une désignation.`;
    }

    if (
      !CATEGORIES.includes(
        code.categorie
      )
    ) {
      return `Catégorie invalide pour ${codeNormalise}.`;
    }

    return null;
  }

  /* ==========================================================
     SAUVEGARDE D'UNE LIGNE EXISTANTE
  ========================================================== */

  async function sauvegarderCode(
    code: CodeNouveau
  ) {
    const codeNormalise =
      normaliserCode(code.code);

    const erreurValidation =
      validerCode(code);

    if (erreurValidation) {
      throw new Error(
        erreurValidation
      );
    }

    /*
     * IMPORTANT :
     * Pour une ligne existante, on ne modifie
     * JAMAIS la clé "code".
     *
     * On modifie uniquement les propriétés
     * administratives de la ligne.
     */

    const {
      data: lignesModifiees,
      error,
    } = await supabase
      .from("codes_imputation")
      .update({
        libelle:
          code.libelle.trim(),

        categorie:
          code.categorie,

        ...appliquerReglesCategorie(
          code.categorie,
          {
            autorise_affaire: code.autorise_affaire,
            autorise_devis: code.autorise_devis,
            autorise_divers: code.autorise_divers,
          }
        ),

        actif:
          Boolean(code.actif),
      })
      .eq(
        "code",
        codeNormalise
      )
      .select("code, autorise_affaire, autorise_devis, autorise_divers, actif")

    if (error) {
      throw new Error(
        `Code ${codeNormalise} : ${error.message}`
      );
    }

    if (!lignesModifiees || lignesModifiees.length !== 1) {
      throw new Error(
        `Code ${codeNormalise} : aucune ligne n'a été modifiée. Vérifie les droits UPDATE/RLS sur codes_imputation.`
      );
    }

    const attendu = appliquerReglesCategorie(
      code.categorie,
      {
        autorise_affaire: code.autorise_affaire,
        autorise_devis: code.autorise_devis,
        autorise_divers: code.autorise_divers,
      }
    );

    const ligne = lignesModifiees[0];
    if (
      Boolean(ligne.autorise_affaire) !== attendu.autorise_affaire ||
      Boolean(ligne.autorise_devis) !== attendu.autorise_devis ||
      Boolean(ligne.autorise_divers) !== attendu.autorise_divers ||
      Boolean(ligne.actif) !== Boolean(code.actif)
    ) {
      throw new Error(
        `Code ${codeNormalise} : Supabase n'a pas enregistré les autorisations demandées.`
      );
    }
  }

  /* ==========================================================
     CREATION D'UN NOUVEAU CODE
  ========================================================== */

  async function creerNouveauCode() {
    const codeNormalise =
      normaliserCode(
        nouvelleLigne.code
      );

    const erreurValidation =
      validerCode(
        nouvelleLigne
      );

    if (erreurValidation) {
      throw new Error(
        erreurValidation
      );
    }

    /*
     * Vérification supplémentaire :
     * on refuse de créer deux fois le même code.
     */

    const {
      data: existant,
      error: erreurRecherche,
    } = await supabase
      .from("codes_imputation")
      .select("code")
      .eq(
        "code",
        codeNormalise
      )
      .maybeSingle();

    if (erreurRecherche) {
      throw new Error(
        `Vérification du code ${codeNormalise} impossible : ${erreurRecherche.message}`
      );
    }

    if (existant) {
      throw new Error(
        `Le code ${codeNormalise} existe déjà.`
      );
    }

    const {
      data: lignesCreees,
      error,
    } = await supabase
      .from("codes_imputation")
      .insert({
        code: codeNormalise,

        libelle:
          nouvelleLigne.libelle.trim(),

        categorie:
          nouvelleLigne.categorie,

        autorise_affaire:
          Boolean(
            nouvelleLigne.autorise_affaire
          ),

        autorise_devis:
          Boolean(
            nouvelleLigne.autorise_devis
          ),

        autorise_divers:
          Boolean(
            nouvelleLigne.autorise_divers
          ),

        actif:
          Boolean(
            nouvelleLigne.actif
          ),
      })
      .select("code");

    if (error) {
      throw new Error(
        `Création du code ${codeNormalise} impossible : ${error.message}`
      );
    }

    if (!lignesCreees || lignesCreees.length !== 1) {
      throw new Error(
        `Création du code ${codeNormalise} : aucune ligne n'a été créée.`
      );
    }
  }

  /* ==========================================================
     ENREGISTREMENT GLOBAL
  ========================================================== */

  async function enregistrerModifications() {
    if (enregistrement) {
      return;
    }

    setEnregistrement(true);
    setMessage("");
    setErreur("");

    try {
      /*
       * ------------------------------------------------------
       * 1. VALIDATION DES CODES MODIFIÉS
       * ------------------------------------------------------
       */

      const codesAEnregistrer =
        codes.filter(
          (code) =>
            !code.nouveau
        );

      for (const code of codesAEnregistrer) {
        const erreurValidation =
          validerCode(code);

        if (erreurValidation) {
          throw new Error(
            erreurValidation
          );
        }
      }

      /*
       * ------------------------------------------------------
       * 2. DÉTECTION DES DOUBLONS
       * ------------------------------------------------------
       */

      const codesNormalises =
        new Set<string>();

      for (const code of [
        ...codesAEnregistrer,
        nouvelleLigne,
      ]) {
        if (!code.code.trim()) {
          continue;
        }

        const codeNormalise =
          normaliserCode(
            code.code
          );

        if (
          codesNormalises.has(
            codeNormalise
          )
        ) {
          throw new Error(
            `Le code ${codeNormalise} apparaît plusieurs fois.`
          );
        }

        codesNormalises.add(
          codeNormalise
        );
      }

      /*
       * ------------------------------------------------------
       * 3. SAUVEGARDE DES CODES EXISTANTS
       * ------------------------------------------------------
       *
       * On les sauvegarde UN PAR UN.
       *
       * C'est volontaire :
       * si un code plante, on sait exactement lequel.
       */

      let nombreModifies = 0;

      for (
        const code
        of codesAEnregistrer
      ) {
        await sauvegarderCode(
          code
        );

        nombreModifies++;
      }

      /*
       * ------------------------------------------------------
       * 4. CRÉATION DU NOUVEAU CODE
       * ------------------------------------------------------
       */

      const nouveauCodeEstRempli =
        nouvelleLigne.code.trim() ||
        nouvelleLigne.libelle.trim();

      let nombreCrees = 0;

      if (nouveauCodeEstRempli) {
        await creerNouveauCode();

        nombreCrees++;

        setNouvelleLigne(
          creerCodeVide()
        );
      }

      /*
       * ------------------------------------------------------
       * 5. SEULEMENT MAINTENANT :
       *    RECHARGEMENT DEPUIS SUPABASE
       * ------------------------------------------------------
       *
       * Très important :
       * on ne remplace PAS l'affichage avant
       * que toutes les opérations soient terminées.
       */

      await chargerCodes();

      /*
       * ------------------------------------------------------
       * 6. MESSAGE DE SUCCÈS
       * ------------------------------------------------------
       */

      const total =
        nombreModifies +
        nombreCrees;

      if (total === 0) {
        setMessage(
          "Aucune modification à enregistrer."
        );
      } else {
        setMessage(
          `${total} code${
            total > 1 ? "s" : ""
          } enregistré${
            total > 1 ? "s" : ""
          } avec succès.`
        );
      }
    } catch (e) {
      console.error(
        "ERREUR ENREGISTREMENT CODES",
        e
      );

      setErreur(
        e instanceof Error
          ? e.message
          : "Erreur inconnue pendant l'enregistrement."
      );

      /*
       * IMPORTANT :
       * on NE recharge PAS les données
       * si une sauvegarde a échoué.
       *
       * Comme ça, ce qui est affiché reste
       * exactement ce que l'utilisateur avait saisi.
       */
    } finally {
      setEnregistrement(
        false
      );
    }
  }

  /* ==========================================================
     RENDU D'UNE LIGNE
  ========================================================== */

  function LigneCode({
    code,
    index,
  }: {
    code: CodeNouveau;
    index: number;
  }) {
    return (
      <tr
        key={code.code}
        style={{
          ...styles.tr,
          backgroundColor:
            index % 2 === 0
              ? "#ffffff"
              : "#f5f6f7",
        }}
      >
        {/* CODE */}
        <td style={styles.td}>
          <input
            type="text"
            value={code.code}
            disabled
            style={{
              ...styles.input,
              ...styles.inputCode,
            }}
          />
        </td>

        {/* DESIGNATION */}
        <td style={styles.td}>
          <input
            type="text"
            value={code.libelle}
            onChange={(e) =>
              modifierCode(
                code.code,
                {
                  libelle:
                    e.target.value,
                }
              )
            }
            style={styles.input}
          />
        </td>

        {/* CATEGORIE */}
        <td style={styles.td}>
          <select
            value={code.categorie}
            onChange={(e) =>
              modifierCode(
                code.code,
                {
                  categorie:
                    e.target
                      .value as Categorie,
                }
              )
            }
            style={styles.select}
          >
            {CATEGORIES.map(
              (categorie) => (
                <option
                  key={categorie}
                  value={categorie}
                >
                  {categorie}
                </option>
              )
            )}
          </select>
        </td>

        {/* AFFAIRE */}
        <td
          style={
            styles.tdCenter
          }
        >
          <input
            type="checkbox"
            checked={
              code.autorise_affaire
            }
            disabled={
              code.categorie === "NI" ||
              categorieSansImputationDirecte(code.categorie)
            }
            onChange={(e) =>
              modifierCode(
                code.code,
                {
                  autorise_affaire:
                    e.target.checked,
                }
              )
            }
            style={styles.checkbox}
          />
        </td>

        {/* DEVIS */}
        <td
          style={
            styles.tdCenter
          }
        >
          <input
            type="checkbox"
            checked={
              code.autorise_devis
            }
            disabled={
              code.categorie === "NI" ||
              categorieSansImputationDirecte(code.categorie)
            }
            onChange={(e) =>
              modifierCode(
                code.code,
                {
                  autorise_devis:
                    e.target.checked,
                }
              )
            }
            style={styles.checkbox}
          />
        </td>

        {/* DIVERS */}
        <td
          style={
            styles.tdCenter
          }
        >
          <input
            type="checkbox"
            checked={
              code.autorise_divers
            }
            disabled={
              code.categorie === "NI" ||
              categorieSansImputationDirecte(code.categorie)
            }
            onChange={(e) =>
              modifierCode(
                code.code,
                {
                  autorise_divers:
                    e.target.checked,
                }
              )
            }
            style={styles.checkbox}
          />
        </td>

        {/* STATUT */}
        <td
          style={
            styles.tdCenter
          }
        >
          <button
            type="button"
            onClick={() =>
              modifierCode(
                code.code,
                {
                  actif:
                    !code.actif,
                }
              )
            }
            style={{
              ...styles.statusButton,
              ...(code.actif
                ? styles.statusActif
                : styles.statusInactif),
            }}
          >
            {code.actif
              ? "Actif"
              : "Inactif"}
          </button>
        </td>
      </tr>
    );
  }

  /* ==========================================================
     CHARGEMENT
  ========================================================== */

  if (chargement) {
    return (
      <main style={styles.page}>
        <div style={styles.loading}>
          Chargement des codes...
        </div>
      </main>
    );
  }

  /* ==========================================================
     PAGE
  ========================================================== */

  return (
    <main style={styles.page}>
      {/* ======================================================
          HEADER
      ====================================================== */}

      <EnTetePage
        section="Gestion des codes"
        avantNavigation={confirmerAvantQuitter}
      />

      {/* ======================================================
          CONTENU
      ====================================================== */}

      <div style={styles.container}>
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <h1 style={styles.title}>
                Gestion des codes
              </h1>

              <p
                style={
                  styles.subtitle
                }
              >
                Gestion des codes d'imputation
                utilisés dans les affaires,
                devis et activités diverses.
              </p>
            </div>
          </div>

          {/* ==================================================
              MESSAGES
          ================================================== */}

          {message && (
            <div
              style={
                styles.successMessage
              }
            >
              ✓ {message}
            </div>
          )}

          {erreur && (
            <div
              style={
                styles.errorMessage
              }
            >
              ✕ {erreur}
            </div>
          )}

          {/* ==================================================
              RECHERCHE
          ================================================== */}

          <div
            style={
              styles.toolbar
            }
          >
            <input
              type="text"
              placeholder="Rechercher un code ou une désignation..."
              value={recherche}
              onChange={(e) =>
                setRecherche(
                  e.target.value
                )
              }
              style={
                styles.searchInput
              }
            />

            <div
              style={
                styles.counter
              }
            >
              {codesActifs.length} code
              {codesActifs.length > 1
                ? "s"
                : ""} actif
              {codesActifs.length > 1
                ? "s"
                : ""}
            </div>
          </div>

          {/* ==================================================
              TABLEAU ACTIFS
          ================================================== */}

          <div
            style={
              styles.tableWrap
            }
          >
            <table
              style={
                styles.table
              }
            >
              <colgroup>
                <col
                  style={{
                    width: "90px",
                  }}
                />

                <col
                  style={{
                    width: "30%",
                  }}
                />

                <col
                  style={{
                    width: "17%",
                  }}
                />

                <col
                  style={{
                    width: "90px",
                  }}
                />

                <col
                  style={{
                    width: "90px",
                  }}
                />

                <col
                  style={{
                    width: "90px",
                  }}
                />

                <col
                  style={{
                    width: "110px",
                  }}
                />
              </colgroup>

              <thead>
                <tr>
                  <th style={styles.th}>
                    Code
                  </th>

                  <th style={styles.th}>
                    Désignation
                  </th>

                  <th style={styles.th}>
                    Catégorie
                  </th>

                  <th
                    style={
                      styles.thCenter
                    }
                  >
                    Affaire
                  </th>

                  <th
                    style={
                      styles.thCenter
                    }
                  >
                    Devis
                  </th>

                  <th
                    style={
                      styles.thCenter
                    }
                  >
                    Divers
                  </th>

                  <th
                    style={
                      styles.thCenter
                    }
                  >
                    Statut
                  </th>
                </tr>
              </thead>

              <tbody>
                {codesActifs.map(
                  (code, index) => (
                    LigneCode({ code, index })
                  )
                )}

                {codesActifs.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={
                        styles.emptyCell
                      }
                    >
                      Aucun code actif trouvé.
                    </td>
                  </tr>
                )}

                {/* ==================================================
                    NOUVEAU CODE
                ================================================== */}

                <tr
                  style={{
                    backgroundColor:
                      "#fff8e6",
                  }}
                >
                  <td style={styles.td}>
                    <input
                      type="text"
                      placeholder="Nouveau"
                      value={
                        nouvelleLigne.code
                      }
                      onChange={(e) =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            code: e.target
                              .value
                              .toUpperCase(),
                          })
                        )
                      }
                      style={{
                        ...styles.input,
                        ...styles.inputCode,
                        fontWeight: 700,
                      }}
                    />
                  </td>

                  <td style={styles.td}>
                    <input
                      type="text"
                      placeholder="Désignation"
                      value={
                        nouvelleLigne.libelle
                      }
                      onChange={(e) =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            libelle:
                              e.target.value,
                          })
                        )
                      }
                      style={styles.input}
                    />
                  </td>

                  <td style={styles.td}>
                    <select
                      value={
                        nouvelleLigne.categorie
                      }
                      onChange={(e) =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            categorie:
                              e.target.value as Categorie,
                            ...appliquerReglesCategorie(
                              e.target.value as Categorie,
                              ancien
                            ),
                          })
                        )
                      }
                      style={
                        styles.select
                      }
                    >
                      {CATEGORIES.map(
                        (categorie) => (
                          <option
                            key={
                              categorie
                            }
                            value={
                              categorie
                            }
                          >
                            {categorie}
                          </option>
                        )
                      )}
                    </select>
                  </td>

                  <td
                    style={
                      styles.tdCenter
                    }
                  >
                    <input
                      type="checkbox"
                      checked={
                        nouvelleLigne.autorise_affaire
                      }
                      disabled={
                        nouvelleLigne.categorie === "NI" ||
                        categorieSansImputationDirecte(nouvelleLigne.categorie)
                      }
                      onChange={(e) =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            autorise_affaire:
                              e.target
                                .checked,
                          })
                        )
                      }
                      style={
                        styles.checkbox
                      }
                    />
                  </td>

                  <td
                    style={
                      styles.tdCenter
                    }
                  >
                    <input
                      type="checkbox"
                      checked={
                        nouvelleLigne.autorise_devis
                      }
                      disabled={
                        nouvelleLigne.categorie === "NI" ||
                        categorieSansImputationDirecte(nouvelleLigne.categorie)
                      }
                      onChange={(e) =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            autorise_devis:
                              e.target
                                .checked,
                          })
                        )
                      }
                      style={
                        styles.checkbox
                      }
                    />
                  </td>

                  <td
                    style={
                      styles.tdCenter
                    }
                  >
                    <input
                      type="checkbox"
                      checked={
                        nouvelleLigne.autorise_divers
                      }
                      disabled={
                        nouvelleLigne.categorie === "NI" ||
                        categorieSansImputationDirecte(nouvelleLigne.categorie)
                      }
                      onChange={(e) =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            autorise_divers:
                              e.target
                                .checked,
                          })
                        )
                      }
                      style={
                        styles.checkbox
                      }
                    />
                  </td>

                  <td
                    style={
                      styles.tdCenter
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setNouvelleLigne(
                          (ancien) => ({
                            ...ancien,
                            actif:
                              !ancien.actif,
                          })
                        )
                      }
                      style={{
                        ...styles.statusButton,
                        ...(nouvelleLigne.actif
                          ? styles.statusActif
                          : styles.statusInactif),
                      }}
                    >
                      {nouvelleLigne.actif
                        ? "Actif"
                        : "Inactif"}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ==================================================
              CODES INACTIFS
          ================================================== */}

          <div
            style={
              styles.inactiveSection
            }
          >
            <button
              type="button"
              onClick={() =>
                setCodesInactifsOuverts(
                  (ouvert) =>
                    !ouvert
                )
              }
              style={
                styles.inactiveHeader
              }
            >
              <span>
                {codesInactifsOuverts
                  ? "▾"
                  : "▸"}{" "}
                Codes inactifs
              </span>

              <span
                style={
                  styles.inactiveCount
                }
              >
                {codesInactifs.length}
              </span>
            </button>

            {codesInactifsOuverts && (
              <div
                style={
                  styles.tableWrap
                }
              >
                <table
                  style={
                    styles.table
                  }
                >
                  <colgroup>
                    <col
                      style={{
                        width: "90px",
                      }}
                    />

                    <col
                      style={{
                        width: "30%",
                      }}
                    />

                    <col
                      style={{
                        width: "17%",
                      }}
                    />

                    <col
                      style={{
                        width: "90px",
                      }}
                    />

                    <col
                      style={{
                        width: "90px",
                      }}
                    />

                    <col
                      style={{
                        width: "90px",
                      }}
                    />

                    <col
                      style={{
                        width: "110px",
                      }}
                    />
                  </colgroup>

                  <thead>
                    <tr>
                      <th style={styles.th}>
                        Code
                      </th>

                      <th style={styles.th}>
                        Désignation
                      </th>

                      <th style={styles.th}>
                        Catégorie
                      </th>

                      <th
                        style={
                          styles.thCenter
                        }
                      >
                        Affaire
                      </th>

                      <th
                        style={
                          styles.thCenter
                        }
                      >
                        Devis
                      </th>

                      <th
                        style={
                          styles.thCenter
                        }
                      >
                        Divers
                      </th>

                      <th
                        style={
                          styles.thCenter
                        }
                      >
                        Statut
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {codesInactifs.map(
                      (code, index) => (
                        LigneCode({ code, index })
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ==================================================
              ACTIONS
          ================================================== */}

          <div
            style={
              styles.actions
            }
          >
            <button
              type="button"
              onClick={
                enregistrerModifications
              }
              disabled={
                enregistrement
              }
              style={{
                ...styles.saveButton,
                opacity:
                  enregistrement
                    ? 0.6
                    : 1,
              }}
            >
              {enregistrement
                ? "Enregistrement en cours..."
                : "Enregistrer les modifications"}
            </button>
          </div>
        </section>
      </div>
      {modificationsEnAttente && (
        <>
          <div style={{ height: 84 }} />

          <div
            role="status"
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 50,
              background: "#fff8e7",
              borderTop: "3px solid #c8a63b",
              padding: "12px 24px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
              boxShadow: "0 -4px 14px rgba(0,0,0,.12)",
              fontFamily: "Calibri, Arial, sans-serif",
              color: "#6b5100",
              fontWeight: 700,
            }}
          >
            <span>● Modifications non enregistrées</span>

            <button
              type="button"
              onClick={enregistrerModifications}
              disabled={enregistrement}
              style={{
                ...styles.saveButton,
                opacity: enregistrement ? 0.6 : 1,
              }}
            >
              {enregistrement ? "Enregistrement en cours..." : "Enregistrer"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Annuler toutes les modifications non enregistrées ?"
                  )
                ) {
                  setNouvelleLigne(creerCodeVide());
                  chargerCodes();
                }
              }}
              style={{
                background: "#fff",
                color: "#6b5100",
                border: "1px solid #c8a63b",
                borderRadius: 7,
                padding: "10px 16px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Annuler les modifications
            </button>
          </div>
        </>
      )}
    </main>
  );
}

/* ============================================================
   STYLES
============================================================ */

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f3f4f6",
    fontFamily: "Calibri, Arial, sans-serif",
    color: "#222",
  },

  header: {
    backgroundColor: "#c00000",
    color: "#fff",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.15)",
  },

  headerInner: {
    maxWidth: "1500px",
    margin: "0 auto",
    padding: "18px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent:
      "space-between",
  },

  logo: {
    fontSize: "28px",
    fontWeight: 800,
    letterSpacing: "1px",
  },

  headerSubtitle: {
    marginTop: "2px",
    fontSize: "14px",
    opacity: 0.9,
  },

  backButton: {
    border: "none",
    background: "transparent",
    color: "#fff",
    padding: 0,
    marginBottom: "12px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
  },

  container: {
    maxWidth: "1500px",
    margin: "0 auto",
    padding: "28px",
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: "10px",
    boxShadow:
      "0 2px 10px rgba(0,0,0,0.07)",
    padding: "26px",
  },

  cardHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    marginBottom: "22px",
  },

  title: {
    margin: 0,
    fontSize: "28px",
    color: "#222",
  },

  subtitle: {
    margin:
      "6px 0 0 0",
    color: "#666",
    fontSize: "15px",
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent:
      "space-between",
    gap: "20px",
    marginBottom: "18px",
  },

  searchInput: {
    width: "420px",
    maxWidth: "100%",
    padding:
      "11px 14px",
    border:
      "1px solid #d2d5d8",
    borderRadius: "6px",
    fontSize: "14px",
    outline: "none",
  },

  counter: {
    color: "#666",
    fontSize: "14px",
    fontWeight: 600,
  },

  successMessage: {
    backgroundColor: "#eaf7ed",
    border:
      "1px solid #b9dfc0",
    color: "#1d6b2b",
    borderRadius: "6px",
    padding:
      "11px 14px",
    marginBottom: "16px",
    fontWeight: 600,
  },

  errorMessage: {
    backgroundColor: "#fdecec",
    border:
      "1px solid #efb6b6",
    color: "#a50000",
    borderRadius: "6px",
    padding:
      "11px 14px",
    marginBottom: "16px",
    fontWeight: 600,
    whiteSpace: "pre-wrap",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
    border:
      "1px solid #dfe2e5",
    borderRadius: "7px",
  },

  table: {
    width: "100%",
    borderCollapse:
      "collapse",
    tableLayout: "fixed",
  },

  th: {
    backgroundColor: "#e9eaec",
    color: "#333",
    fontWeight: 700,
    fontSize: "14px",
    padding:
      "12px 10px",
    textAlign: "left",
    borderBottom:
      "2px solid #d2d4d7",
  },

  thCenter: {
    backgroundColor: "#e9eaec",
    color: "#333",
    fontWeight: 700,
    fontSize: "14px",
    padding:
      "12px 10px",
    textAlign: "center",
    borderBottom:
      "2px solid #d2d4d7",
  },

  tr: {
    transition:
      "background-color 0.15s ease",
  },

  td: {
    padding:
      "8px 10px",
    borderBottom:
      "1px solid #e2e4e7",
    verticalAlign:
      "middle",
  },

  tdCenter: {
    padding:
      "8px 10px",
    borderBottom:
      "1px solid #e2e4e7",
    verticalAlign:
      "middle",
    textAlign: "center",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d4d7da",
    borderRadius: "5px",
    padding:
      "8px 9px",
    fontSize: "14px",
    backgroundColor:
      "#fff",
    fontFamily:
      "Calibri, Arial, sans-serif",
  },

  inputCode: {
    fontWeight: 700,
    textTransform:
      "uppercase",
    textAlign: "center",
  },

  select: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d4d7da",
    borderRadius: "5px",
    padding:
      "8px 9px",
    fontSize: "14px",
    backgroundColor:
      "#fff",
    fontFamily:
      "Calibri, Arial, sans-serif",
  },

  checkbox: {
    width: "18px",
    height: "18px",
    cursor: "pointer",
    accentColor: "#c00000",
    verticalAlign:
      "middle",
  },

  statusButton: {
    minWidth: "78px",
    borderRadius: "20px",
    padding:
      "6px 12px",
    border: "1px solid",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px",
  },

  statusActif: {
    backgroundColor: "#e9f7ed",
    borderColor: "#9bd0a5",
    color: "#267238",
  },

  statusInactif: {
    backgroundColor: "#eeeeee",
    borderColor: "#c8c8c8",
    color: "#666",
  },

  inactiveSection: {
    marginTop: "22px",
  },

  inactiveHeader: {
    width: "100%",
    border:
      "1px solid #d9dadd",
    backgroundColor:
      "#eeeeef",
    borderRadius: "7px",
    padding:
      "12px 15px",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 700,
    color: "#555",
  },

  inactiveCount: {
    minWidth: "26px",
    height: "26px",
    borderRadius: "50%",
    backgroundColor:
      "#d8d9dc",
    display: "inline-flex",
    alignItems: "center",
    justifyContent:
      "center",
    fontSize: "12px",
    color: "#555",
  },

  actions: {
    marginTop: "22px",
    display: "flex",
    justifyContent:
      "flex-end",
  },

  saveButton: {
    backgroundColor:
      "#c00000",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding:
      "12px 22px",
    fontSize: "15px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow:
      "0 2px 5px rgba(192,0,0,0.25)",
  },

  emptyCell: {
    padding: "25px",
    textAlign: "center",
    color: "#888",
    fontStyle: "italic",
  },

  loading: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent:
      "center",
    fontSize: "18px",
    color: "#666",
  },
};

export default function GestionCodesPage() {
  return (
    <GardeAcces droit={"administration"}>
      <GestionCodesPageContenu />
    </GardeAcces>
  );
}
