"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Activite = {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
  ordre_affichage: number;
  created_at: string;
  updated_at: string;
};

type CodeImputation = {
  code: string;
  libelle: string;
  categorie: string;
  actif: boolean;
  autorise_affaire: boolean;
  autorise_devis: boolean;
  autorise_divers: boolean;
  historique_uniquement: boolean;
  ordre_affichage: number | null;
};

function normaliserCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function codeEligiblePourActivite(
  code: CodeImputation
) {
  /*
   * Gestion-codes reste la source de vérité.
   * On ne présente ici que les codes actifs pouvant servir
   * à une affaire / un devis du nouveau système.
   */
  return (
    code.actif === true &&
    code.historique_uniquement !== true &&
    (
      code.autorise_affaire === true ||
      code.autorise_devis === true
    )
  );
}

export default function GestionActivitesPage() {
  const router = useRouter();

  const [activites, setActivites] =
    useState<Activite[]>([]);

  const [codes, setCodes] =
    useState<CodeImputation[]>([]);

  const [activiteSelectionnee, setActiviteSelectionnee] =
    useState("");

  const [codesAssocies, setCodesAssocies] =
    useState<Set<string>>(new Set());

  const [rechercheCode, setRechercheCode] =
    useState("");

  const [nouveauCode, setNouveauCode] =
    useState("");

  const [nouveauNom, setNouveauNom] =
    useState("");

  const [chargement, setChargement] =
    useState(true);

  const [chargementAssociations, setChargementAssociations] =
    useState(false);

  const [enregistrement, setEnregistrement] =
    useState(false);

  const [erreur, setErreur] =
    useState("");

  const [message, setMessage] =
    useState("");

  /* ========================================================= */
  /* ======================= CHARGEMENT ====================== */
  /* ========================================================= */

  const chargerDonnees = useCallback(
    async (selectionActuelle: string) => {
      setChargement(true);
      setErreur("");

      try {
        const [activitesResult, codesResult] =
          await Promise.all([
            supabase
              .from("activites")
              .select(
                "id, code, nom, actif, ordre_affichage, created_at, updated_at"
              )
              .order("ordre_affichage", {
                ascending: true,
              })
              .order("nom", {
                ascending: true,
              }),

            /*
             * C'est ici que Gestion-activites est alimentée
             * par Gestion-codes : la source est directement
             * codes_imputation.
             */
            supabase
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
                  historique_uniquement,
                  ordre_affichage
                `
              )
              .order("ordre_affichage", {
                ascending: true,
              })
              .order("code", {
                ascending: true,
              }),
          ]);

        if (activitesResult.error) {
          throw new Error(
            `Chargement des activités : ${activitesResult.error.message}`
          );
        }

        if (codesResult.error) {
          throw new Error(
            `Chargement des codes : ${codesResult.error.message}`
          );
        }

        const activitesChargees =
          (activitesResult.data || []) as Activite[];

        setActivites(activitesChargees);
        setCodes(
          (codesResult.data || []) as CodeImputation[]
        );

        if (
          selectionActuelle &&
          activitesChargees.some(
            (a) => a.id === selectionActuelle
          )
        ) {
          setActiviteSelectionnee(
            selectionActuelle
          );
          return;
        }

        const premiere =
          activitesChargees.find(
            (a) => a.actif
          ) || activitesChargees[0];

        setActiviteSelectionnee(
          premiere?.id || ""
        );
      } catch (e: any) {
        console.error(e);
        setErreur(
          e?.message ||
            "Impossible de charger les activités et les codes."
        );
      } finally {
        setChargement(false);
      }
    },
    []
  );

  useEffect(() => {
    chargerDonnees("");
  }, [chargerDonnees]);

  /* ========================================================= */
  /* ==================== ASSOCIATIONS ======================= */
  /* ========================================================= */

  const chargerAssociations = useCallback(
    async (activiteId: string) => {
      if (!activiteId) {
        setCodesAssocies(new Set());
        return;
      }

      setChargementAssociations(true);
      setErreur("");

      try {
        const { data, error } =
          await supabase
            .from("activites_codes")
            .select("code")
            .eq("activite_id", activiteId);

        if (error) {
          throw error;
        }

        setCodesAssocies(
          new Set(
            (data || []).map((ligne) =>
              normaliserCode(ligne.code)
            )
          )
        );
      } catch (e: any) {
        console.error(e);
        setErreur(
          e?.message ||
            "Impossible de charger les codes associés."
        );
        setCodesAssocies(new Set());
      } finally {
        setChargementAssociations(false);
      }
    },
    []
  );

  useEffect(() => {
    chargerAssociations(activiteSelectionnee);
    setRechercheCode("");
    setMessage("");
  }, [
    activiteSelectionnee,
    chargerAssociations,
  ]);

  /* ========================================================= */
  /* ========================== LISTES ======================= */
  /* ========================================================= */

  const activiteCourante = useMemo(
    () =>
      activites.find(
        (a) => a.id === activiteSelectionnee
      ) || null,
    [
      activites,
      activiteSelectionnee,
    ]
  );

  const codesDisponibles = useMemo(
    () =>
      codes
        .filter(codeEligiblePourActivite)
        .sort(
          (a, b) =>
            (a.ordre_affichage ?? 999999) -
              (b.ordre_affichage ?? 999999) ||
            a.code.localeCompare(b.code, "fr")
        ),
    [codes]
  );

  const rechercheNormalisee =
    rechercheCode.trim().toLowerCase();

  const codesFiltres = useMemo(() => {
    if (!rechercheNormalisee) {
      return codesDisponibles;
    }

    return codesDisponibles.filter(
      (code) =>
        `${code.code} ${code.libelle} ${code.categorie}`
          .toLowerCase()
          .includes(rechercheNormalisee)
    );
  }, [
    codesDisponibles,
    rechercheNormalisee,
  ]);

  /* ========================================================= */
  /* ==================== CREATION ACTIVITE ================= */
  /* ========================================================= */

  async function creerActivite() {
    setErreur("");
    setMessage("");

    const code = normaliserCode(nouveauCode);
    const nom = nouveauNom.trim();

    if (!code) {
      setErreur(
        "Le code activité est obligatoire."
      );
      return;
    }

    if (!nom) {
      setErreur(
        "Le nom de l'activité est obligatoire."
      );
      return;
    }

    if (
      activites.some(
        (a) => normaliserCode(a.code) === code
      )
    ) {
      setErreur(
        `L'activité ${code} existe déjà.`
      );
      return;
    }

    setEnregistrement(true);

    try {
      const ordreMax = activites.reduce(
        (max, activite) =>
          Math.max(
            max,
            Number(activite.ordre_affichage || 0)
          ),
        0
      );

      const { data, error } =
        await supabase
          .from("activites")
          .insert({
            code,
            nom,
            actif: true,
            ordre_affichage: ordreMax + 10,
          })
          .select(
            "id, code, nom, actif, ordre_affichage, created_at, updated_at"
          )
          .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error(
          "L'activité n'a pas été créée."
        );
      }

      const nouvelleActivite =
        data as Activite;

      setActivites((anciennes) =>
        [...anciennes, nouvelleActivite].sort(
          (a, b) =>
            a.ordre_affichage -
              b.ordre_affichage ||
            a.nom.localeCompare(b.nom, "fr")
        )
      );

      setNouveauCode("");
      setNouveauNom("");
      setActiviteSelectionnee(
        nouvelleActivite.id
      );

      setMessage(
        `Activité ${nouvelleActivite.nom} créée.`
      );
    } catch (e: any) {
      console.error(e);
      setErreur(
        e?.message ||
          "Impossible de créer l'activité."
      );
    } finally {
      setEnregistrement(false);
    }
  }

  /* ========================================================= */
  /* ================= ACTIVATION / DESACTIVATION ============ */
  /* ========================================================= */

  async function basculerActivite(
    activite: Activite
  ) {
    const nouvelleValeur =
      !activite.actif;

    setErreur("");
    setMessage("");

    try {
      const { error } =
        await supabase
          .from("activites")
          .update({
            actif: nouvelleValeur,
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", activite.id);

      if (error) {
        throw error;
      }

      const maintenant =
        new Date().toISOString();

      setActivites((anciennes) =>
        anciennes.map((a) =>
          a.id === activite.id
            ? {
                ...a,
                actif: nouvelleValeur,
                updated_at: maintenant,
              }
            : a
        )
      );

      setMessage(
        nouvelleValeur
          ? `Activité ${activite.nom} réactivée.`
          : `Activité ${activite.nom} désactivée.`
      );
    } catch (e: any) {
      console.error(e);
      setErreur(
        e?.message ||
          "Impossible de modifier l'activité."
      );
    }
  }

  /* ========================================================= */
  /* ===================== ASSOCIATION CODE ================== */
  /* ========================================================= */

  async function basculerCode(
    code: string
  ) {
    if (!activiteCourante) {
      return;
    }

    const codeNormalise =
      normaliserCode(code);

    const dejaAssocie =
      codesAssocies.has(codeNormalise);

    setErreur("");
    setMessage("");

    try {
      if (dejaAssocie) {
        const { error } =
          await supabase
            .from("activites_codes")
            .delete()
            .eq(
              "activite_id",
              activiteCourante.id
            )
            .eq("code", codeNormalise);

        if (error) {
          throw error;
        }

        setCodesAssocies((ancienne) => {
          const nouvelle = new Set(ancienne);
          nouvelle.delete(codeNormalise);
          return nouvelle;
        });

        setMessage(
          `${codeNormalise} retiré de ${activiteCourante.nom}.`
        );
      } else {
        const { error } =
          await supabase
            .from("activites_codes")
            .insert({
              activite_id:
                activiteCourante.id,
              code: codeNormalise,
            });

        if (error) {
          throw error;
        }

        setCodesAssocies((ancienne) => {
          const nouvelle = new Set(ancienne);
          nouvelle.add(codeNormalise);
          return nouvelle;
        });

        setMessage(
          `${codeNormalise} associé à ${activiteCourante.nom}.`
        );
      }
    } catch (e: any) {
      console.error(e);
      setErreur(
        e?.message ||
          `Impossible de modifier l'association du code ${codeNormalise}.`
      );
    }
  }

  /* ========================================================= */
  /* ============================ RENDER ===================== */
  /* ========================================================= */

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <button
            type="button"
            onClick={() =>
              router.push("/dashboard")
            }
            style={styles.retour}
          >
            ← Tableau de bord
          </button>

          <div style={styles.brandLine}>
            <div style={styles.logo}>
              POLYNOV
            </div>

            <div
              style={styles.headerSeparator}
            >
              /
            </div>

            <div
              style={styles.headerSubtitle}
            >
              Gestion des activités
            </div>
          </div>
        </div>
      </header>

      <div style={styles.container}>
        <section style={styles.pageIntro}>
          <div>
            <div style={styles.eyebrow}>
              ADMINISTRATION
            </div>

            <h1 style={styles.pageTitle}>
              Gestion des activités
            </h1>

            <p style={styles.pageDescription}>
              Les codes restent gérés dans
              « Gestion des codes ». Ici, tu
              définis les activités et les codes
              qui peuvent être utilisés ensemble.
            </p>
          </div>

          <div style={styles.infoBadge}>
            {codesDisponibles.length} codes disponibles
          </div>
        </section>

        {erreur && (
          <div style={styles.errorCard}>
            <strong>Erreur</strong>
            <span style={{ flex: 1 }}>
              {erreur}
            </span>
            <button
              type="button"
              onClick={() => setErreur("")}
              style={styles.closeButton}
            >
              ×
            </button>
          </div>
        )}

        {message && (
          <div style={styles.successCard}>
            <strong>✓</strong>
            <span style={{ flex: 1 }}>
              {message}
            </span>
            <button
              type="button"
              onClick={() => setMessage("")}
              style={styles.closeButton}
            >
              ×
            </button>
          </div>
        )}

        {chargement ? (
          <div style={styles.loadingCard}>
            Chargement des activités et des codes…
          </div>
        ) : (
          <>
            <section style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <h2 style={styles.cardTitle}>
                    Activités
                  </h2>
                  <p style={styles.cardDescription}>
                    Les activités sont indépendantes
                    des codes. Une activité peut utiliser
                    plusieurs codes, et un code peut être
                    utilisé dans plusieurs activités.
                  </p>
                </div>
              </div>

              <div style={styles.newActivityBox}>
                <div style={styles.sectionTitle}>
                  + Nouvelle activité
                </div>

                <div style={styles.formGrid}>
                  <input
                    value={nouveauCode}
                    onChange={(e) =>
                      setNouveauCode(e.target.value)
                    }
                    placeholder="Code ex. ROBOT"
                    maxLength={20}
                    style={styles.input}
                  />

                  <input
                    value={nouveauNom}
                    onChange={(e) =>
                      setNouveauNom(e.target.value)
                    }
                    placeholder="Nom ex. Robotique"
                    style={styles.input}
                  />

                  <button
                    type="button"
                    disabled={enregistrement}
                    onClick={creerActivite}
                    style={styles.primaryButton}
                  >
                    {enregistrement
                      ? "Création…"
                      : "Créer l'activité"}
                  </button>
                </div>
              </div>

              <div style={styles.activityGrid}>
                {activites.map((activite) => {
                  const selected =
                    activite.id ===
                    activiteSelectionnee;

                  return (
                    <div
                      key={activite.id}
                      style={{
                        ...styles.activityCard,
                        borderColor: selected
                          ? "#c00000"
                          : "#e2e2e2",
                        boxShadow: selected
                          ? "0 4px 14px rgba(192,0,0,0.10)"
                          : "0 2px 8px rgba(0,0,0,0.04)",
                        opacity: activite.actif
                          ? 1
                          : 0.6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setActiviteSelectionnee(
                            activite.id
                          )
                        }
                        style={styles.activitySelectButton}
                      >
                        <span style={styles.activityCode}>
                          {activite.code}
                        </span>

                        <span style={styles.activityName}>
                          {activite.nom}
                        </span>
                      </button>

                      <div style={styles.activityFooter}>
                        <span style={styles.activityState}>
                          {activite.actif
                            ? "Active"
                            : "Inactive"}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            basculerActivite(activite)
                          }
                          style={
                            activite.actif
                              ? styles.secondaryButton
                              : styles.activateButton
                          }
                        >
                          {activite.actif
                            ? "Désactiver"
                            : "Réactiver"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section style={styles.card}>
              <div style={styles.detailHeader}>
                <div>
                  <div style={styles.eyebrowSmall}>
                    CONFIGURATION
                  </div>

                  <h2 style={styles.detailTitle}>
                    {activiteCourante
                      ? `${activiteCourante.code} — ${activiteCourante.nom}`
                      : "Aucune activité sélectionnée"}
                  </h2>

                  <p style={styles.cardDescription}>
                    Les codes affichés proviennent
                    directement de « Gestion des codes ».
                    Coche ceux qui doivent être imputables
                    à cette activité.
                  </p>
                </div>

                {activiteCourante && (
                  <div style={styles.associationBadge}>
                    {codesAssocies.size} associé
                    {codesAssocies.size > 1
                      ? "s"
                      : ""}
                  </div>
                )}
              </div>

              {!activiteCourante ? (
                <div style={styles.noSelection}>
                  Sélectionne une activité ci-dessus.
                </div>
              ) : activiteCourante.actif === false ? (
                <div style={styles.warningCard}>
                  <strong>
                    Activité inactive
                  </strong>
                  <span>
                    Les associations sont conservées,
                    mais cette activité ne devra plus être
                    proposée dans Ma-semaine.
                  </span>
                </div>
              ) : (
                <>
                  <div style={styles.searchBar}>
                    <span style={styles.searchIcon}>
                      ⌕
                    </span>

                    <input
                      value={rechercheCode}
                      onChange={(e) =>
                        setRechercheCode(e.target.value)
                      }
                      placeholder="Rechercher un code ou son libellé…"
                      style={styles.searchInput}
                    />

                    {rechercheCode && (
                      <button
                        type="button"
                        onClick={() =>
                          setRechercheCode("")
                        }
                        style={styles.clearButton}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div style={styles.legend}>
                    <span>
                      Un nouveau code créé dans
                      Gestion-codes apparaîtra ici après
                      actualisation.
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        chargerDonnees(
                          activiteSelectionnee
                        )
                      }
                      style={styles.refreshButton}
                    >
                      ↻ Actualiser
                    </button>
                  </div>

                  {chargementAssociations ? (
                    <div style={styles.loadingInline}>
                      Chargement des associations…
                    </div>
                  ) : (
                    <div style={styles.codeGrid}>
                      {codesFiltres.map((code) => {
                        const codeNormalise =
                          normaliserCode(
                            code.code
                          );
                        const associe =
                          codesAssocies.has(
                            codeNormalise
                          );

                        return (
                          <button
                            key={code.code}
                            type="button"
                            onClick={() =>
                              basculerCode(
                                code.code
                              )
                            }
                            style={{
                              ...styles.codeItem,
                              borderColor: associe
                                ? "#c00000"
                                : "#e1e1e1",
                              background: associe
                                ? "#fff5f5"
                                : "#fff",
                            }}
                          >
                            <span
                              style={{
                                ...styles.checkbox,
                                background: associe
                                  ? "#c00000"
                                  : "#fff",
                                color: associe
                                  ? "#fff"
                                  : "transparent",
                                borderColor: associe
                                  ? "#c00000"
                                  : "#cfcfcf",
                              }}
                            >
                              ✓
                            </span>

                            <span style={styles.codeItemText}>
                              <strong>
                                {code.code}
                              </strong>
                              <span style={styles.codeLibelle}>
                                {code.libelle}
                              </span>
                            </span>

                            <span style={styles.codeCategorie}>
                              {code.categorie}
                            </span>
                          </button>
                        );
                      })}

                      {codesFiltres.length === 0 && (
                        <div style={styles.noResult}>
                          Aucun code disponible ne
                          correspond à la recherche.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#f4f4f4",
    fontFamily:
      "Calibri, Arial, sans-serif",
    color: "#222",
  },

  header: {
    background: "#c00000",
    color: "#fff",
    padding:
      "20px 30px 23px 30px",
    boxShadow:
      "0 2px 10px rgba(0,0,0,0.12)",
  },

  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
  },

  retour: {
    background:
      "rgba(255,255,255,0.14)",
    border:
      "1px solid rgba(255,255,255,0.25)",
    color: "#fff",
    borderRadius: 7,
    padding: "7px 11px",
    cursor: "pointer",
    marginBottom: 16,
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 13,
    fontWeight: 600,
  },

  brandLine: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },

  logo: {
    fontSize: 32,
    fontWeight: 900,
    lineHeight: 1,
  },

  headerSeparator: {
    opacity: 0.45,
    fontSize: 20,
  },

  headerSubtitle: {
    fontSize: 15,
    opacity: 0.9,
  },

  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding:
      "30px 30px 60px 30px",
  },

  pageIntro: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-end",
    gap: 20,
    marginBottom: 22,
    flexWrap: "wrap",
  },

  eyebrow: {
    color: "#c00000",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "1.2px",
    marginBottom: 5,
  },

  eyebrowSmall: {
    color: "#c00000",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "1px",
    marginBottom: 5,
  },

  pageTitle: {
    margin: 0,
    fontSize: 32,
    fontWeight: 800,
    letterSpacing: "-0.5px",
  },

  detailTitle: {
    margin: 0,
    fontSize: 23,
    fontWeight: 800,
  },

  pageDescription: {
    margin:
      "6px 0 0 0",
    color: "#6e6e6e",
    fontSize: 14,
    maxWidth: 780,
    lineHeight: 1.45,
  },

  infoBadge: {
    background: "#fff",
    border:
      "1px solid #e1e1e1",
    borderRadius: 9,
    padding:
      "10px 14px",
    color: "#555",
    fontSize: 12,
    fontWeight: 700,
  },

  errorCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#fff0f0",
    border:
      "1px solid #efcccc",
    borderRadius: 9,
    padding:
      "11px 14px",
    marginBottom: 16,
    color: "#a00000",
  },

  successCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#eff9f1",
    border:
      "1px solid #d1e8d4",
    borderRadius: 9,
    padding:
      "11px 14px",
    marginBottom: 16,
    color: "#19712a",
  },

  closeButton: {
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 21,
    lineHeight: 1,
  },

  loadingCard: {
    background: "#fff",
    border:
      "1px solid #e1e1e1",
    borderRadius: 10,
    padding: 22,
    color: "#666",
  },

  card: {
    background: "#fff",
    border:
      "1px solid #e1e1e1",
    borderRadius: 11,
    padding: 20,
    marginBottom: 16,
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.045)",
  },

  cardHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: 15,
    marginBottom: 18,
  },

  cardTitle: {
    margin: 0,
    fontSize: 19,
    fontWeight: 800,
  },

  cardDescription: {
    margin:
      "4px 0 0 0",
    color: "#777",
    fontSize: 12,
    lineHeight: 1.4,
  },

  newActivityBox: {
    background: "#fafafa",
    border:
      "1px solid #ebebeb",
    borderRadius: 9,
    padding: 14,
    marginBottom: 16,
  },

  sectionTitle: {
    fontSize: 13,
    fontWeight: 800,
    marginBottom: 10,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "150px 1fr 170px",
    gap: 8,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d8d8d8",
    borderRadius: 7,
    padding:
      "9px 11px",
    background: "#fff",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 13,
    color: "#222",
    outline: "none",
  },

  primaryButton: {
    border: "none",
    borderRadius: 7,
    background: "#c00000",
    color: "#fff",
    padding:
      "9px 12px",
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 12,
    fontWeight: 800,
  },

  activityGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },

  activityCard: {
    border:
      "1px solid #e2e2e2",
    borderRadius: 9,
    padding: 12,
    background: "#fff",
    transition:
      "border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease",
  },

  activitySelectButton: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  activityCode: {
    display: "inline-block",
    color: "#c00000",
    background: "#f8e8e8",
    borderRadius: 5,
    padding: "4px 6px",
    fontSize: 10,
    fontWeight: 900,
    alignSelf: "flex-start",
  },

  activityName: {
    fontSize: 14,
    fontWeight: 800,
  },

  activityFooter: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 13,
  },

  activityState: {
    color: "#777",
    fontSize: 10,
    fontWeight: 700,
  },

  secondaryButton: {
    border:
      "1px solid #ddd",
    borderRadius: 6,
    background: "#f7f7f7",
    color: "#666",
    padding:
      "5px 7px",
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 10,
    fontWeight: 700,
  },

  activateButton: {
    border:
      "1px solid #cfe2d2",
    borderRadius: 6,
    background: "#eff8f1",
    color: "#18722b",
    padding:
      "5px 7px",
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 10,
    fontWeight: 700,
  },

  detailHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    gap: 15,
    marginBottom: 15,
  },

  associationBadge: {
    background: "#f8e8e8",
    color: "#c00000",
    border:
      "1px solid #efd0d0",
    borderRadius: 20,
    padding:
      "5px 10px",
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  warningCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    background: "#fff8e8",
    border:
      "1px solid #efdca6",
    borderRadius: 8,
    padding: 13,
    color: "#7f6000",
    fontSize: 12,
  },

  noSelection: {
    padding: 28,
    textAlign: "center",
    color: "#777",
  },

  searchBar: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    marginBottom: 9,
  },

  searchIcon: {
    position: "absolute",
    left: 12,
    color: "#888",
    fontSize: 20,
    lineHeight: 1,
    pointerEvents: "none",
  },

  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d8d8d8",
    borderRadius: 7,
    padding:
      "10px 40px 10px 35px",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 13,
    color: "#222",
    outline: "none",
  },

  clearButton: {
    position: "absolute",
    right: 8,
    width: 24,
    height: 24,
    border: "none",
    borderRadius: "50%",
    background: "#ededed",
    color: "#666",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: "20px",
  },

  legend: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
    color: "#888",
    fontSize: 11,
  },

  refreshButton: {
    border:
      "1px solid #ddd",
    borderRadius: 6,
    background: "#fff",
    color: "#555",
    padding:
      "5px 8px",
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 10,
    fontWeight: 700,
  },

  codeGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(2, minmax(0, 1fr))",
    gap: 7,
  },

  codeItem: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    border:
      "1px solid #e1e1e1",
    borderRadius: 8,
    padding:
      "9px 10px",
    cursor: "pointer",
    textAlign: "left",
    fontFamily:
      "Calibri, Arial, sans-serif",
    transition:
      "border-color 0.12s ease, background 0.12s ease",
  },

  checkbox: {
    width: 21,
    height: 21,
    border:
      "1px solid #cfcfcf",
    borderRadius: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 900,
  },

  codeItemText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
    gap: 1,
  },

  codeLibelle: {
    color: "#777",
    fontSize: 11,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },

  codeCategorie: {
    color: "#999",
    fontSize: 9,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },

  loadingInline: {
    padding: 25,
    textAlign: "center",
    color: "#666",
  },

  noResult: {
    gridColumn: "1 / -1",
    padding: 25,
    textAlign: "center",
    color: "#777",
    background: "#fafafa",
    border:
      "1px solid #eeeeee",
    borderRadius: 8,
  },
};
