"use client";

import React, {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Collaborateur = {
  id: string;
  trigramme: string;
  prenom: string;
  nom: string;
  actif: boolean;
  date_entree: string | null;
  date_sortie: string | null;
};

type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  total_heures: number;
  total_theorique: number;
  heures_supplementaires: number;
  updated_at: string;
};

type Statut =
  | "complete"
  | "incomplete"
  | "missing";

/* ========================================================= */
/* ====================== UTILITAIRES ====================== */
/* ========================================================= */

function numeroSemaine(dateString: string) {
  const date = new Date(
    `${dateString}T00:00:00`
  );

  date.setDate(
    date.getDate() +
      3 -
      ((date.getDay() + 6) % 7)
  );

  const semaine1 = new Date(
    date.getFullYear(),
    0,
    4
  );

  return (
    1 +
    Math.round(
      (
        (
          date.getTime() -
          semaine1.getTime()
        ) /
          86400000 -
        3 +
        ((semaine1.getDay() + 6) % 7)
      ) /
        7
    )
  );
}

function libelleSemaine(
  dateDebut: string
) {
  const debut = new Date(
    `${dateDebut}T00:00:00`
  );

  const fin = new Date(debut);

  fin.setDate(
    fin.getDate() + 6
  );

  return {
    numero: numeroSemaine(dateDebut),

    debut: debut.toLocaleDateString(
      "fr-FR",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }
    ),

    fin: fin.toLocaleDateString(
      "fr-FR",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }
    ),
  };
}

function estPresentSemaine(
  collaborateur: Collaborateur,
  semaineDebut: string
) {
  const debutSemaine = new Date(
    `${semaineDebut}T00:00:00`
  );

  const finSemaine = new Date(
    debutSemaine
  );

  finSemaine.setDate(
    finSemaine.getDate() + 6
  );

  const entree =
    collaborateur.date_entree
      ? new Date(
          `${collaborateur.date_entree}T00:00:00`
        )
      : null;

  const sortie =
    collaborateur.date_sortie
      ? new Date(
          `${collaborateur.date_sortie}T00:00:00`
        )
      : null;

  if (
    entree &&
    entree > finSemaine
  ) {
    return false;
  }

  if (
    sortie &&
    sortie < debutSemaine
  ) {
    return false;
  }

  return true;
}

function statutFeuille(
  feuille: Feuille | undefined
): Statut {
  if (!feuille) {
    return "missing";
  }

  if (
    feuille.total_heures >=
    feuille.total_theorique
  ) {
    return "complete";
  }

  return "incomplete";
}

function formatHeures(
  value: number
) {
  if (Number.isInteger(value)) {
    return `${value} h`;
  }

  return `${value.toFixed(1)} h`;
}

function formatDateMaj(
  dateString: string
) {
  const date = new Date(dateString);

  if (
    Number.isNaN(date.getTime())
  ) {
    return "";
  }

  return date.toLocaleDateString(
    "fr-FR",
    {
      day: "2-digit",
      month: "2-digit",
    }
  );
}

/* ========================================================= */
/* ======================== PAGE =========================== */
/* ========================================================= */

export default function FeuillesPage() {
  const router = useRouter();

  const [
    collaborateurs,
    setCollaborateurs,
  ] = useState<Collaborateur[]>([]);

  const [
    feuilles,
    setFeuilles,
  ] = useState<Feuille[]>([]);

  const [
    recherche,
    setRecherche,
  ] = useState("");

  const [
    chargement,
    setChargement,
  ] = useState(true);

  const [
    erreur,
    setErreur,
  ] = useState("");

  /*
   * ID de la feuille actuellement en cours
   * de suppression.
   *
   * Permet de désactiver uniquement le
   * bouton concerné.
   */
  const [
    suppressionEnCours,
    setSuppressionEnCours,
  ] = useState<string | null>(
    null
  );

  /* ======================================================= */
  /* ======================= CHARGEMENT ==================== */
  /* ======================================================= */

  useEffect(() => {
    let actif = true;

    async function charger() {
      setChargement(true);
      setErreur("");

      const [
        collaborateursResult,
        feuillesResult,
      ] = await Promise.all([
        supabase
          .from("collaborateurs")
          .select("*")
          .order("nom", {
            ascending: true,
          })
          .order("prenom", {
            ascending: true,
          }),

        supabase
          .from("feuilles_heures")
          .select("*")
          .order("semaine_debut", {
            ascending: false,
          }),
      ]);

      if (!actif) {
        return;
      }

      if (
        collaborateursResult.error
      ) {
        console.error(
          "Erreur chargement collaborateurs :",
          collaborateursResult.error
        );

        setErreur(
          "Impossible de charger les collaborateurs."
        );
      }

      if (feuillesResult.error) {
        console.error(
          "Erreur chargement feuilles :",
          feuillesResult.error
        );

        setErreur(
          "Impossible de charger les feuilles de temps."
        );
      }

      setCollaborateurs(
        collaborateursResult.data ?? []
      );

      setFeuilles(
        feuillesResult.data ?? []
      );

      setChargement(false);
    }

    charger();

    return () => {
      actif = false;
    };
  }, []);

  /* ======================================================= */
  /* ======================= SUPPRESSION =================== */
  /* ======================================================= */

  async function supprimerFeuille(
    feuille: Feuille,
    collaborateur: Collaborateur
  ) {
    if (
      suppressionEnCours !== null
    ) {
      return;
    }

    const libelle =
      libelleSemaine(
        feuille.semaine_debut
      );

    const confirmation =
      window.confirm(
        `Supprimer définitivement la feuille de ${collaborateur.prenom} ${collaborateur.nom} pour S${libelle.numero} ?\n\n` +
          `${libelle.debut} → ${libelle.fin}\n\n` +
          `La feuille, ses journées et ses imputations seront supprimées.\n\n` +
          `Cette action est irréversible.`
      );

    if (!confirmation) {
      return;
    }

    setSuppressionEnCours(
      feuille.id
    );

    setErreur("");

    try {
      /*
       * -----------------------------------------------------
       * 1. Récupération des journées
       * -----------------------------------------------------
       */

      const {
        data: jours,
        error: erreurJours,
      } = await supabase
        .from("feuilles_heures_jours")
        .select("id")
        .eq(
          "feuille_id",
          feuille.id
        );

      if (erreurJours) {
        throw erreurJours;
      }

      const idsJours =
        (jours ?? []).map(
          (jour) => jour.id
        );

      /*
       * -----------------------------------------------------
       * 2. Suppression des imputations
       * -----------------------------------------------------
       */

      if (
        idsJours.length > 0
      ) {
        const {
          error:
            erreurImputations,
        } = await supabase
          .from(
            "feuilles_heures_imputations"
          )
          .delete()
          .in(
            "jour_id",
            idsJours
          );

        if (erreurImputations) {
          throw erreurImputations;
        }
      }

      /*
       * -----------------------------------------------------
       * 3. Suppression des journées
       * -----------------------------------------------------
       */

      const {
        error:
          erreurSuppressionJours,
      } = await supabase
        .from(
          "feuilles_heures_jours"
        )
        .delete()
        .eq(
          "feuille_id",
          feuille.id
        );

      if (
        erreurSuppressionJours
      ) {
        throw erreurSuppressionJours;
      }

      /*
       * -----------------------------------------------------
       * 4. Suppression de la feuille
       * -----------------------------------------------------
       */

      const {
        error: erreurFeuille,
      } = await supabase
        .from("feuilles_heures")
        .delete()
        .eq(
          "id",
          feuille.id
        );

      if (erreurFeuille) {
        throw erreurFeuille;
      }

      /*
       * -----------------------------------------------------
       * 5. Mise à jour immédiate de l'interface
       * -----------------------------------------------------
       *
       * Pas besoin de recharger toute la page.
       */

      setFeuilles(
        (anciennesFeuilles) =>
          anciennesFeuilles.filter(
            (f) =>
              f.id !== feuille.id
          )
      );
    } catch (error) {
      console.error(
        "Erreur suppression feuille :",
        error
      );

      setErreur(
        `Impossible de supprimer la feuille de ${collaborateur.prenom} ${collaborateur.nom}.`
      );
    } finally {
      setSuppressionEnCours(
        null
      );
    }
  }

  /* ======================================================= */
  /* ======================= RECHERCHE ===================== */
  /* ======================================================= */

  const rechercheNormalisee =
    recherche
      .toLowerCase()
      .trim();

  /* ======================================================= */
  /* ========================= INDEX ======================= */
  /* ======================================================= */

  const feuillesParSemaine =
    useMemo(() => {
      const index: Record<
        string,
        Record<string, Feuille>
      > = {};

      for (const feuille of feuilles) {
        if (
          !index[
            feuille.semaine_debut
          ]
        ) {
          index[
            feuille.semaine_debut
          ] = {};
        }

        index[
          feuille.semaine_debut
        ][
          feuille.collaborateur_id
        ] = feuille;
      }

      return index;
    }, [feuilles]);

  const semainesDisponibles =
    useMemo(() => {
      return Array.from(
        new Set(
          feuilles.map(
            (f) =>
              f.semaine_debut
          )
        )
      ).sort((a, b) =>
        b.localeCompare(a)
      );
    }, [feuilles]);

  /* ======================================================= */
  /* ======================== STATS ======================== */
  /* ======================================================= */

  const collaborateursActifs =
    collaborateurs.filter(
      (c) => c.actif
    ).length;

  const feuillesCompletes =
    feuilles.filter(
      (f) =>
        f.total_heures >=
        f.total_theorique
    ).length;

  const feuillesIncompletes =
    feuilles.filter(
      (f) =>
        f.total_heures <
        f.total_theorique
    ).length;

  /* ======================================================= */
  /* ========================= RENDER ====================== */
  /* ======================================================= */

  return (
    <main style={styles.page}>
      {/* ================================================= */}
      {/* ====================== HEADER ================== */}
      {/* ================================================= */}

      <header style={styles.header}>
        <div
          style={styles.headerInner}
        >
          <button
            type="button"
            onClick={() =>
              router.push(
                "/dashboard"
              )
            }
            style={styles.retour}
            onMouseEnter={(e) => {
              e.currentTarget.style.background =
                "rgba(255,255,255,0.24)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                "rgba(255,255,255,0.14)";
            }}
          >
            ← Tableau de bord
          </button>

          <div
            style={styles.brandLine}
          >
            <div
              style={styles.logo}
            >
              POLYNOV
            </div>

            <div
              style={
                styles.headerSeparator
              }
            >
              /
            </div>

            <div
              style={
                styles.headerSubtitle
              }
            >
              Gestion des temps &
              activités
            </div>
          </div>
        </div>
      </header>

      {/* ================================================= */}
      {/* ===================== CONTENU ================== */}
      {/* ================================================= */}

      <div
        style={styles.container}
      >
        {/* ================= INTRO ================= */}

        <section
          style={styles.pageIntro}
        >
          <div>
            <div
              style={styles.eyebrow}
            >
              ADMINISTRATION
            </div>

            <h1
              style={styles.pageTitle}
            >
              Feuilles collaborateurs
            </h1>

            <p
              style={
                styles.pageDescription
              }
            >
              Suivez l'état des
              feuilles de temps semaine
              par semaine.
            </p>
          </div>

          <div
            style={styles.headerStats}
          >
            <MiniStat
              value={
                collaborateursActifs
              }
              label="actifs"
            />

            <MiniStat
              value={
                feuillesCompletes
              }
              label="complètes"
              tone="green"
            />

            <MiniStat
              value={
                feuillesIncompletes
              }
              label="incomplètes"
              tone="orange"
            />
          </div>
        </section>

        {/* ================= ERREUR ================= */}

        {erreur && (
          <div
            style={
              styles.errorCard
            }
          >
            <div
              style={
                styles.errorIcon
              }
            >
              !
            </div>

            <div
              style={{
                flex: 1,
              }}
            >
              <strong>
                Erreur
              </strong>

              <div
                style={
                  styles.errorText
                }
              >
                {erreur}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setErreur("")
              }
              style={
                styles.errorClose
              }
            >
              ×
            </button>
          </div>
        )}

        {/* ================= RECHERCHE ================= */}

        <section
          style={styles.searchCard}
        >
          <div
            style={
              styles.searchHeader
            }
          >
            <div>
              <div
                style={
                  styles.searchTitle
                }
              >
                Rechercher un
                collaborateur
              </div>

              <div
                style={
                  styles.searchDescription
                }
              >
                Filtrez par trigramme,
                prénom ou nom.
              </div>
            </div>

            {recherche && (
              <div
                style={
                  styles.searchResult
                }
              >
                Filtre actif
              </div>
            )}
          </div>

          <div
            style={
              styles.searchWrapper
            }
          >
            <span
              style={
                styles.searchIcon
              }
            >
              ⌕
            </span>

            <input
              value={recherche}
              onChange={(e) =>
                setRecherche(
                  e.target.value
                )
              }
              placeholder="Ex. PLG, Pierre, Gaufier..."
              style={
                styles.searchInput
              }
              aria-label="Rechercher un collaborateur"
            />

            {recherche && (
              <button
                type="button"
                onClick={() =>
                  setRecherche("")
                }
                style={
                  styles.clearButton
                }
                aria-label="Effacer la recherche"
              >
                ×
              </button>
            )}
          </div>
        </section>

        {/* ================= CHARGEMENT ================= */}

        {chargement && (
          <div
            style={
              styles.loadingCard
            }
          >
            <div
              style={styles.spinner}
            >
              <div
                style={
                  styles.spinnerInner
                }
              />
            </div>

            <div>
              <strong>
                Chargement des feuilles
              </strong>

              <p
                style={
                  styles.loadingText
                }
              >
                Récupération des
                collaborateurs et des
                feuilles de temps...
              </p>
            </div>
          </div>
        )}

        {/* ================= VIDE ================= */}

        {!chargement &&
          semainesDisponibles.length ===
            0 && (
            <div
              style={
                styles.emptyCard
              }
            >
              <div
                style={
                  styles.emptyIcon
                }
              >
                <span>✓</span>
              </div>

              <h2
                style={
                  styles.emptyTitle
                }
              >
                Aucune feuille de
                temps
              </h2>

              <p
                style={
                  styles.emptyText
                }
              >
                Les feuilles de temps
                enregistrées apparaîtront
                ici.
              </p>
            </div>
          )}

        {/* ================= SEMAINES ================= */}

        {!chargement &&
          semainesDisponibles.map(
            (
              semaine,
              index
            ) => {
              const feuillesSemaine =
                feuilles.filter(
                  (f) =>
                    f.semaine_debut ===
                    semaine
                );

              const collaborateursPresents =
                collaborateurs.filter(
                  (collaborateur) =>
                    estPresentSemaine(
                      collaborateur,
                      semaine
                    )
                );

              const collaborateursFiltres =
                collaborateursPresents
                  .filter((c) => {
                    if (
                      !rechercheNormalisee
                    ) {
                      return true;
                    }

                    return `${c.prenom} ${c.nom} ${c.trigramme}`
                      .toLowerCase()
                      .includes(
                        rechercheNormalisee
                      );
                  })
                  .sort((a, b) => {
                    const feuilleA =
                      feuillesParSemaine[
                        semaine
                      ]?.[a.id];

                    const feuilleB =
                      feuillesParSemaine[
                        semaine
                      ]?.[b.id];

                    const scoreA =
                      statutFeuille(
                        feuilleA
                      );

                    const scoreB =
                      statutFeuille(
                        feuilleB
                      );

                    const ordre: Record<
                      Statut,
                      number
                    > = {
                      missing: 0,
                      incomplete: 1,
                      complete: 2,
                    };

                    if (
                      ordre[scoreA] !==
                      ordre[scoreB]
                    ) {
                      return (
                        ordre[scoreA] -
                        ordre[scoreB]
                      );
                    }

                    return `${a.nom}${a.prenom}`.localeCompare(
                      `${b.nom}${b.prenom}`,
                      "fr"
                    );
                  });

              const feuillesMap =
                feuillesParSemaine[
                  semaine
                ] ?? {};

              const complets =
                collaborateursPresents.filter(
                  (c) =>
                    statutFeuille(
                      feuillesMap[
                        c.id
                      ]
                    ) ===
                    "complete"
                ).length;

              const incomplets =
                collaborateursPresents.filter(
                  (c) =>
                    statutFeuille(
                      feuillesMap[
                        c.id
                      ]
                    ) ===
                    "incomplete"
                ).length;

              const aCreer =
                collaborateursPresents.filter(
                  (c) =>
                    statutFeuille(
                      feuillesMap[
                        c.id
                      ]
                    ) ===
                    "missing"
                ).length;

              const libelle =
                libelleSemaine(
                  semaine
                );

              return (
                <SemaineCard
                  key={semaine}
                  semaine={semaine}
                  libelle={libelle}
                  feuillesSemaine={
                    feuillesSemaine
                  }
                  feuillesMap={
                    feuillesMap
                  }
                  collaborateurs={
                    collaborateursFiltres
                  }
                  complets={complets}
                  incomplets={
                    incomplets
                  }
                  aCreer={aCreer}
                  totalPresents={
                    collaborateursPresents.length
                  }
                  router={router}
                  ouverte={
                    index === 0
                  }
                  suppressionEnCours={
                    suppressionEnCours
                  }
                  supprimerFeuille={
                    supprimerFeuille
                  }
                />
              );
            }
          )}
      </div>
    </main>
  );
}

/* ========================================================= */
/* ====================== MINI STAT ======================== */
/* ========================================================= */

function MiniStat({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?:
    | "neutral"
    | "green"
    | "orange";
}) {
  const colors = {
    neutral: {
      number: "#222",
      background: "#ffffff",
    },

    green: {
      number: "#138113",
      background: "#f0f8f1",
    },

    orange: {
      number: "#a07700",
      background: "#fff9e9",
    },
  };

  const color = colors[tone];

  return (
    <div
      style={{
        ...styles.miniStat,
        background:
          color.background,
      }}
    >
      <strong
        style={{
          ...styles.miniStatNumber,
          color: color.number,
        }}
      >
        {value}
      </strong>

      <span
        style={
          styles.miniStatLabel
        }
      >
        {label}
      </span>
    </div>
  );
}

/* ========================================================= */
/* ==================== CARTE SEMAINE ====================== */
/* ========================================================= */

function SemaineCard({
  semaine,
  libelle,
  feuillesSemaine,
  feuillesMap,
  collaborateurs,
  complets,
  incomplets,
  aCreer,
  totalPresents,
  router,
  ouverte,
  suppressionEnCours,
  supprimerFeuille,
}: {
  semaine: string;

  libelle: {
    numero: number;
    debut: string;
    fin: string;
  };

  feuillesSemaine: Feuille[];

  feuillesMap: Record<
    string,
    Feuille
  >;

  collaborateurs: Collaborateur[];

  complets: number;
  incomplets: number;
  aCreer: number;
  totalPresents: number;

  router: ReturnType<
    typeof useRouter
  >;

  ouverte: boolean;

  suppressionEnCours:
    | string
    | null;

  supprimerFeuille: (
    feuille: Feuille,
    collaborateur: Collaborateur
  ) => Promise<void>;
}) {
  const [survol, setSurvol] =
    useState(false);

  const progression =
    totalPresents > 0
      ? Math.round(
          (complets /
            totalPresents) *
            100
        )
      : 0;

  const totalHeures =
    feuillesSemaine.reduce(
      (total, feuille) =>
        total +
        Number(
          feuille.total_heures ||
            0
        ),
      0
    );

  const totalTheorique =
    feuillesSemaine.reduce(
      (total, feuille) =>
        total +
        Number(
          feuille.total_theorique ||
            0
        ),
      0
    );

  return (
    <details
      open={ouverte}
      style={{
        ...styles.weekCard,
        borderColor: survol
          ? "#d30000"
          : "#e2e2e2",
        boxShadow: survol
          ? "0 7px 20px rgba(0,0,0,0.09)"
          : "0 2px 8px rgba(0,0,0,0.055)",
      }}
      onMouseEnter={() =>
        setSurvol(true)
      }
      onMouseLeave={() =>
        setSurvol(false)
      }
    >
      {/* ================= ENTÊTE ================= */}

      <summary
        style={
          styles.weekSummary
        }
      >
        <div
          style={styles.weekLeft}
        >
          <div
            style={styles.weekIcon}
          >
            <span
              style={
                styles.weekIconText
              }
            >
              S
            </span>
          </div>

          <div>
            <div
              style={styles.weekTitle}
            >
              S{libelle.numero}
            </div>

            <div
              style={styles.weekDates}
            >
              {libelle.debut}
              {" → "}
              {libelle.fin}
            </div>
          </div>
        </div>

        <div
          style={styles.weekRight}
        >
          <div
            style={
              styles.weekProgressBlock
            }
          >
            <div
              style={
                styles.weekProgressLabel
              }
            >
              <span>
                Avancement
              </span>

              <strong>
                {progression} %
              </strong>
            </div>

            <div
              style={
                styles.weekProgressTrack
              }
            >
              <div
                style={{
                  ...styles.weekProgressBar,
                  width: `${progression}%`,
                }}
              />
            </div>
          </div>

          <div
            style={
              styles.statusContainer
            }
          >
            <StatusBadge
              type="complete"
              label={`${complets}`}
            />

            <StatusBadge
              type="incomplete"
              label={`${incomplets}`}
            />

            <StatusBadge
              type="missing"
              label={`${aCreer}`}
            />
          </div>

          <span
            style={styles.chevron}
          >
            ▼
          </span>
        </div>
      </summary>

      {/* ================= INFOS SEMAINE ================= */}

      <div
        style={styles.weekMeta}
      >
        <div>
          <span
            style={
              styles.metaLabel
            }
          >
            COLLABORATEURS
          </span>

          <strong>
            {totalPresents}
          </strong>
        </div>

        <div>
          <span
            style={
              styles.metaLabel
            }
          >
            HEURES SAISIES
          </span>

          <strong>
            {formatHeures(
              totalHeures
            )}
          </strong>
        </div>

        {totalTheorique > 0 && (
          <div>
            <span
              style={
                styles.metaLabel
              }
            >
              THÉORIQUE
            </span>

            <strong>
              {formatHeures(
                totalTheorique
              )}
            </strong>
          </div>
        )}
      </div>

      {/* ================= CONTENU ================= */}

      <div
        style={styles.weekContent}
      >
        {collaborateurs.length ===
        0 ? (
          <div
            style={
              styles.noResult
            }
          >
            <div
              style={
                styles.noResultIcon
              }
            >
              ⌕
            </div>

            <div>
              <strong>
                Aucun collaborateur
                trouvé
              </strong>

              <p>
                Aucun collaborateur ne
                correspond à votre
                recherche pour cette
                semaine.
              </p>
            </div>
          </div>
        ) : (
          <div>
            {collaborateurs.map(
              (
                collaborateur,
                index
              ) => {
                const feuille =
                  feuillesMap[
                    collaborateur.id
                  ];

                return (
                  <CollaborateurRow
                    key={
                      collaborateur.id
                    }
                    collaborateur={
                      collaborateur
                    }
                    feuille={feuille}
                    router={router}
                    semaine={semaine}
                    dernier={
                      index ===
                      collaborateurs.length -
                        1
                    }
                    suppressionEnCours={
                      suppressionEnCours
                    }
                    supprimerFeuille={
                      supprimerFeuille
                    }
                  />
                );
              }
            )}
          </div>
        )}
      </div>
    </details>
  );
}

/* ========================================================= */
/* ===================== LIGNE COLLAB ====================== */
/* ========================================================= */

function CollaborateurRow({
  collaborateur,
  feuille,
  router,
  semaine,
  dernier,
  suppressionEnCours,
  supprimerFeuille,
}: {
  collaborateur: Collaborateur;

  feuille:
    | Feuille
    | undefined;

  router: ReturnType<
    typeof useRouter
  >;

  semaine: string;

  dernier: boolean;

  suppressionEnCours:
    | string
    | null;

  supprimerFeuille: (
    feuille: Feuille,
    collaborateur: Collaborateur
  ) => Promise<void>;
}) {
  const [survol, setSurvol] =
    useState(false);

  const status =
    statutFeuille(feuille);

  const total = Number(
    feuille?.total_heures ?? 0
  );

  const theorique = Number(
    feuille?.total_theorique ?? 0
  );

  const heuresSupplementaires =
    Number(
      feuille?.heures_supplementaires ??
        0
    );

  const pourcentage =
    theorique > 0
      ? Math.round(
          (total / theorique) *
            100
        )
      : 0;

  const pourcentageBarre =
    Math.min(
      100,
      Math.max(
        0,
        pourcentage
      )
    );

  const reste =
    theorique > total
      ? theorique - total
      : 0;

  const suppression =
    feuille &&
    suppressionEnCours ===
      feuille.id;

  return (
    <div
      style={{
        ...styles.collaborateurRow,
        borderBottom: dernier
          ? "none"
          : "1px solid #eeeeee",
        background: survol
          ? "#fafafa"
          : "white",
        opacity:
          suppression
            ? 0.55
            : 1,
      }}
      onMouseEnter={() =>
        setSurvol(true)
      }
      onMouseLeave={() =>
        setSurvol(false)
      }
    >
      {/* ================= IDENTITÉ ================= */}

      <div
        style={styles.identity}
      >
        <StatusDot
          status={status}
        />

        <div
          style={
            styles.trigramme
          }
        >
          {collaborateur.trigramme}
        </div>

        <div
          style={
            styles.identityText
          }
        >
          <div
            style={styles.name}
          >
            {collaborateur.prenom}{" "}
            {collaborateur.nom}

            {!collaborateur.actif && (
              <span
                style={
                  styles.inactif
                }
              >
                Inactif
              </span>
            )}
          </div>

          {feuille ? (
            <div
              style={
                styles.hoursLine
              }
            >
              <strong
                style={
                  styles.totalHours
                }
              >
                {formatHeures(total)}
              </strong>

              <span>
                /{" "}
                {formatHeures(
                  theorique
                )}
              </span>

              <span
                style={
                  styles.separator
                }
              >
                •
              </span>

              <span>
                {pourcentage} %
              </span>

              {reste > 0 && (
                <>
                  <span
                    style={
                      styles.separator
                    }
                  >
                    •
                  </span>

                  <span
                    style={
                      styles.remaining
                    }
                  >
                    reste{" "}
                    {formatHeures(
                      reste
                    )}
                  </span>
                </>
              )}

              {heuresSupplementaires >
                0 && (
                <>
                  <span
                    style={
                      styles.separator
                    }
                  >
                    •
                  </span>

                  <span
                    style={
                      styles.overtime
                    }
                  >
                    +{" "}
                    {formatHeures(
                      heuresSupplementaires
                    )}{" "}
                    HS
                  </span>
                </>
              )}
            </div>
          ) : (
            <div
              style={
                styles.missingText
              }
            >
              Aucune feuille de
              temps enregistrée
            </div>
          )}

          {feuille?.updated_at && (
            <div
              style={
                styles.lastUpdate
              }
            >
              Mise à jour le{" "}
              {formatDateMaj(
                feuille.updated_at
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================= PROGRESSION ================= */}

      <div
        style={
          styles.progressArea
        }
      >
        {feuille ? (
          <div>
            <div
              style={
                styles.progressTrack
              }
            >
              <div
                style={{
                  ...styles.progressBar,
                  width: `${pourcentageBarre}%`,
                  background:
                    status ===
                    "complete"
                      ? "#138113"
                      : "#c08a00",
                }}
              />
            </div>
          </div>
        ) : (
          <div
            style={
              styles.progressEmpty
            }
          >
            —
          </div>
        )}
      </div>

      {/* ================= STATUT ================= */}

      <div
        style={styles.statusArea}
      >
        {status ===
          "complete" && (
          <span
            style={
              styles.statusComplete
            }
          >
            ✓ Complète
          </span>
        )}

        {status ===
          "incomplete" && (
          <span
            style={
              styles.statusIncomplete
            }
          >
            ! Incomplète
          </span>
        )}

        {status ===
          "missing" && (
          <span
            style={
              styles.statusMissing
            }
          >
            × À créer
          </span>
        )}
      </div>

      {/* ================= ACTIONS ================= */}

      <div
        style={styles.actions}
      >
        <button
          type="button"
          disabled={suppression}
          style={{
            ...styles.openButton,
            background:
              feuille
                ? survol
                  ? "#a80000"
                  : "#c00000"
                : survol
                ? "#0e6c0e"
                : "#138113",
            opacity:
              suppression
                ? 0.7
                : 1,
          }}
          onClick={() =>
            router.push(
              `/ma-semaine?semaine=${semaine}&collaborateur=${collaborateur.id}`
            )
          }
        >
          {feuille
            ? "Ouvrir"
            : "Créer"}

          <span
            style={
              styles.buttonArrow
            }
          >
            →
          </span>
        </button>

        {feuille && (
          <button
            type="button"
            disabled={suppression}
            title="Supprimer cette feuille"
            onClick={() =>
              supprimerFeuille(
                feuille,
                collaborateur
              )
            }
            style={{
              ...styles.deleteButton,
              background:
                suppression
                  ? "#f5f5f5"
                  : survol
                  ? "#ffe8e8"
                  : "#fff4f4",
              color:
                suppression
                  ? "#999"
                  : "#c00000",
              borderColor:
                suppression
                  ? "#dddddd"
                  : "#efcccc",
              cursor:
                suppression
                  ? "default"
                  : "pointer",
            }}
          >
            {suppression
              ? "…"
              : "🗑"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ========================================================= */
/* ==================== STATUS BADGE ======================= */
/* ========================================================= */

function StatusBadge({
  type,
  label,
}: {
  type:
    | "complete"
    | "incomplete"
    | "missing";

  label: string;
}) {
  const config = {
    complete: {
      background: "#edf8ef",
      color: "#138113",
      border: "#d5ead8",
      icon: "✓",
      text: "complètes",
    },

    incomplete: {
      background: "#fff8e7",
      color: "#9a7000",
      border: "#f0dfaa",
      icon: "!",
      text: "incomplètes",
    },

    missing: {
      background: "#fff0f0",
      color: "#c00000",
      border: "#f0d0d0",
      icon: "×",
      text: "à créer",
    },
  };

  const c = config[type];

  return (
    <span
      title={`${label} ${c.text}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent:
          "center",
        gap: 5,
        minWidth: 31,
        height: 27,
        boxSizing: "border-box",
        background:
          c.background,
        color: c.color,
        border: `1px solid ${c.border}`,
        borderRadius: 7,
        padding: "0 8px",
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        {c.icon}
      </span>

      {label}
    </span>
  );
}

/* ========================================================= */
/* ====================== STATUS DOT ======================= */
/* ========================================================= */

function StatusDot({
  status,
}: {
  status:
    | "complete"
    | "incomplete"
    | "missing";
}) {
  const background =
    status === "complete"
      ? "#138113"
      : status === "incomplete"
      ? "#c08a00"
      : "#c00000";

  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background,
        flexShrink: 0,
        boxShadow: `0 0 0 3px ${
          status ===
          "complete"
            ? "rgba(19,129,19,0.10)"
            : status ===
              "incomplete"
            ? "rgba(192,138,0,0.10)"
            : "rgba(192,0,0,0.10)"
        }`,
      }}
    />
  );
}

/* ========================================================= */
/* ========================= STYLES ========================= */
/* ========================================================= */

const styles: any = {
  page: {
    minHeight: "100vh",
    background: "#f4f4f4",
    fontFamily:
      "Calibri, Arial, sans-serif",
    color: "#222",
  },

  /* ================= HEADER ================= */

  header: {
    background: "#c00000",
    color: "white",
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
    color: "white",
    borderRadius: 7,
    padding:
      "7px 11px",
    cursor: "pointer",
    marginBottom: 16,
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 13,
    fontWeight: 600,
    transition:
      "background 0.15s ease",
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
    letterSpacing: "-0.5px",
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

  /* ================= CONTENEUR ================= */

  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding:
      "30px 30px 60px 30px",
  },

  /* ================= INTRO ================= */

  pageIntro: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "flex-end",
    gap: 25,
    marginBottom: 25,
    flexWrap: "wrap",
  },

  eyebrow: {
    color: "#c00000",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "1.2px",
    marginBottom: 5,
  },

  pageTitle: {
    margin: 0,
    fontSize: 32,
    color: "#222",
    fontWeight: 800,
    letterSpacing: "-0.5px",
  },

  pageDescription: {
    margin:
      "6px 0 0 0",
    color: "#707070",
    fontSize: 15,
  },

  headerStats: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },

  miniStat: {
    minWidth: 80,
    padding:
      "9px 13px",
    border:
      "1px solid #e2e2e2",
    borderRadius: 9,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    boxSizing: "border-box",
  },

  miniStatNumber: {
    fontSize: 19,
    lineHeight: 1,
    fontWeight: 800,
  },

  miniStatLabel: {
    marginTop: 4,
    color: "#777",
    fontSize: 11,
    fontWeight: 600,
  },

  /* ================= ERREUR ================= */

  errorCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#fff1f1",
    border:
      "1px solid #efcaca",
    borderRadius: 10,
    padding:
      "12px 15px",
    marginBottom: 18,
    color: "#9c0000",
  },

  errorIcon: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#c00000",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    flexShrink: 0,
  },

  errorText: {
    marginTop: 2,
    color: "#9c0000",
    fontSize: 13,
  },

  errorClose: {
    border: "none",
    background: "transparent",
    color: "#a00000",
    fontSize: 22,
    cursor: "pointer",
    padding: "2px 6px",
    lineHeight: 1,
  },

  /* ================= RECHERCHE ================= */

  searchCard: {
    background: "white",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    padding:
      "17px 19px",
    marginBottom: 20,
    boxShadow:
      "0 2px 7px rgba(0,0,0,0.045)",
  },

  searchHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent:
      "space-between",
    gap: 15,
    marginBottom: 10,
  },

  searchTitle: {
    color: "#222",
    fontSize: 14,
    fontWeight: 800,
  },

  searchDescription: {
    marginTop: 2,
    color: "#888",
    fontSize: 12,
  },

  searchResult: {
    color: "#c00000",
    background: "#fff1f1",
    border:
      "1px solid #f0d4d4",
    borderRadius: 20,
    padding:
      "4px 9px",
    fontSize: 11,
    fontWeight: 700,
  },

  searchWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },

  searchIcon: {
    position: "absolute",
    left: 13,
    color: "#888",
    fontSize: 21,
    lineHeight: 1,
    pointerEvents: "none",
  },

  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    border:
      "1px solid #d9d9d9",
    borderRadius: 7,
    padding:
      "10px 42px 10px 38px",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 14,
    color: "#222",
    outline: "none",
    background: "#fff",
  },

  clearButton: {
    position: "absolute",
    right: 9,
    width: 25,
    height: 25,
    borderRadius: "50%",
    border: "none",
    background: "#eeeeee",
    color: "#666",
    cursor: "pointer",
    fontSize: 17,
    lineHeight: "20px",
  },

  /* ================= CHARGEMENT ================= */

  loadingCard: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    background: "white",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    padding: 20,
    boxShadow:
      "0 2px 7px rgba(0,0,0,0.045)",
  },

  spinner: {
    width: 28,
    height: 28,
    border:
      "3px solid #eeeeee",
    borderTop:
      "3px solid #c00000",
    borderRadius: "50%",
    animation:
      "polynov-spin 0.8s linear infinite",
    flexShrink: 0,
  },

  spinnerInner: {
    width: 1,
    height: 1,
  },

  loadingText: {
    margin:
      "3px 0 0 0",
    color: "#777",
    fontSize: 12,
  },

  /* ================= VIDE ================= */

  emptyCard: {
    background: "white",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    padding:
      "55px 30px",
    textAlign: "center",
    boxShadow:
      "0 2px 7px rgba(0,0,0,0.045)",
  },

  emptyIcon: {
    width: 55,
    height: 55,
    margin:
      "0 auto 14px auto",
    borderRadius: 11,
    background: "#f8e8e8",
    color: "#c00000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 24,
    fontWeight: 800,
  },

  emptyTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
  },

  emptyText: {
    margin:
      "6px 0 0 0",
    color: "#777",
    fontSize: 13,
  },

  /* ================= SEMAINE ================= */

  weekCard: {
    background: "white",
    borderRadius: 11,
    marginBottom: 13,
    border:
      "1px solid #e3e3e3",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
    overflow: "hidden",
    transition:
      "border-color 0.15s ease, box-shadow 0.15s ease",
  },

  weekSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent:
      "space-between",
    gap: 20,
    padding:
      "14px 17px",
    cursor: "pointer",
    listStyle: "none",
    userSelect: "none",
  },

  weekLeft: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    minWidth: 160,
  },

  weekIcon: {
    width: 39,
    height: 39,
    borderRadius: 8,
    background: "#f8e8e8",
    color: "#c00000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  weekIconText: {
    fontSize: 15,
    fontWeight: 900,
  },

  weekTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: "#222",
  },

  weekDates: {
    marginTop: 2,
    fontSize: 12,
    color: "#777",
  },

  weekRight: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 13,
    flex: 1,
  },

  weekProgressBlock: {
    width: 150,
  },

  weekProgressLabel: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    marginBottom: 5,
    color: "#888",
    fontSize: 10,
  },

  weekProgressTrack: {
    height: 5,
    width: "100%",
    borderRadius: 10,
    background: "#eeeeee",
    overflow: "hidden",
  },

  weekProgressBar: {
    height: "100%",
    borderRadius: 10,
    background: "#138113",
    transition:
      "width 0.2s ease",
  },

  statusContainer: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },

  chevron: {
    color: "#aaa",
    fontSize: 10,
    marginLeft: 3,
  },

  /* ================= META SEMAINE ================= */

  weekMeta: {
    display: "flex",
    alignItems: "center",
    gap: 25,
    padding:
      "9px 18px",
    background: "#fafafa",
    borderTop:
      "1px solid #eeeeee",
    borderBottom:
      "1px solid #eeeeee",
    color: "#444",
  },

  metaLabel: {
    display: "block",
    marginBottom: 2,
    color: "#999",
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: "0.7px",
  },

  /* ================= CONTENU ================= */

  weekContent: {
    padding:
      "2px 17px 5px 17px",
  },

  /* ================= COLLABORATEUR ================= */

  collaborateurRow: {
    display: "grid",
    gridTemplateColumns:
      "minmax(300px, 1fr) minmax(130px, 190px) 100px 120px",
    alignItems: "center",
    gap: 18,
    minHeight: 65,
    padding:
      "9px 3px",
    transition:
      "background 0.12s ease, opacity 0.15s ease",
  },

  identity: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
  },

  trigramme: {
    minWidth: 40,
    boxSizing: "border-box",
    padding:
      "4px 6px",
    borderRadius: 5,
    background: "#f8e8e8",
    color: "#c00000",
    fontSize: 10,
    fontWeight: 900,
    textAlign: "center",
  },

  identityText: {
    minWidth: 0,
  },

  name: {
    color: "#222",
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  inactif: {
    display: "inline-block",
    marginLeft: 6,
    background: "#e8e8e8",
    color: "#666",
    padding:
      "2px 5px",
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    verticalAlign: "middle",
  },

  hoursLine: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
    color: "#777",
    fontSize: 11,
    flexWrap: "wrap",
  },

  totalHours: {
    color: "#333",
  },

  separator: {
    color: "#c2c2c2",
  },

  remaining: {
    color: "#a07700",
    fontWeight: 600,
  },

  overtime: {
    color: "#c00000",
    fontWeight: 700,
  },

  missingText: {
    marginTop: 2,
    color: "#c00000",
    fontSize: 11,
    fontWeight: 600,
  },

  lastUpdate: {
    marginTop: 2,
    color: "#aaa",
    fontSize: 9,
  },

  /* ================= PROGRESSION ================= */

  progressArea: {
    width: "100%",
  },

  progressTrack: {
    width: "100%",
    height: 5,
    borderRadius: 10,
    background: "#eeeeee",
    overflow: "hidden",
  },

  progressBar: {
    height: "100%",
    borderRadius: 10,
    transition:
      "width 0.2s ease",
  },

  progressEmpty: {
    textAlign: "center",
    color: "#ccc",
    fontSize: 15,
  },

  /* ================= STATUT ================= */

  statusArea: {
    display: "flex",
    justifyContent:
      "flex-start",
    alignItems: "center",
    whiteSpace: "nowrap",
  },

  statusComplete: {
    color: "#138113",
    fontSize: 11,
    fontWeight: 700,
  },

  statusIncomplete: {
    color: "#a07700",
    fontSize: 11,
    fontWeight: 700,
  },

  statusMissing: {
    color: "#c00000",
    fontSize: 11,
    fontWeight: 700,
  },

  /* ================= ACTIONS ================= */

  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },

  openButton: {
    border: "none",
    color: "white",
    borderRadius: 6,
    padding:
      "7px 10px",
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
    transition:
      "background 0.15s ease, opacity 0.15s ease",
  },

  buttonArrow: {
    marginLeft: 4,
    fontSize: 12,
  },

  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: "1px solid #efcccc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 14,
    fontWeight: 700,
    transition:
      "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
  },

  /* ================= RESULTAT ================= */

  noResult: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding:
      "20px 4px",
    color: "#666",
  },

  noResultIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    background: "#f5f5f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 19,
    color: "#888",
    flexShrink: 0,
  },
};

/* ========================================================= */
/* ======================== ANIMATION ====================== */
/* ========================================================= */

if (
  typeof document !==
  "undefined"
) {
  const styleId =
    "polynov-feuilles-animations";

  if (
    !document.getElementById(
      styleId
    )
  ) {
    const style =
      document.createElement(
        "style"
      );

    style.id = styleId;

    style.innerHTML = `
      @keyframes polynov-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }

      details > summary::-webkit-details-marker {
        display: none;
      }
    `;

    document.head.appendChild(
      style
    );
  }
}
