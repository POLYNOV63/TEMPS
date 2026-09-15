"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Collaborateur = {
  id: string;
  prenom: string | null;
  nom: string | null;
  actif: boolean;
  role: string | null;
};

type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  total_heures: number | null;
  total_theorique: number | null;
  heures_supplementaires: number | null;
  statut: string | null;
};

type EtatFeuille = "complete" | "incomplete" | "manquante";

type LigneSurveillance = {
  collaborateur: Collaborateur;
  feuille?: Feuille;
  etat: EtatFeuille;
};

export default function DashboardPage() {
  const router = useRouter();

  const [prenom, setPrenom] = useState("");
  const [role, setRole] = useState("");
  const [chargement, setChargement] = useState(true);

  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>(
    []
  );

  const [feuilles, setFeuilles] = useState<Feuille[]>([]);

  const [erreur, setErreur] = useState("");

  const [semaineCourante, setSemaineCourante] = useState("");

  useEffect(() => {
    async function chargerDashboard() {
      setChargement(true);
      setErreur("");

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        // ---------------------------------------------------------
        // 1. Collaborateur connecté
        // ---------------------------------------------------------

        const {
          data: collaborateur,
          error: collaborateurError,
        } = await supabase
          .from("collaborateurs")
          .select("id, prenom, nom, actif, role")
          .eq("auth_user_id", user.id)
          .single();

        if (collaborateurError || !collaborateur) {
          console.error(
            "Erreur collaborateur connecté :",
            collaborateurError
          );

          setErreur(
            "Impossible de récupérer les informations du collaborateur."
          );

          setChargement(false);
          return;
        }

        setPrenom(collaborateur.prenom ?? "");
        setRole(collaborateur.role ?? "");

        // ---------------------------------------------------------
        // 2. Calcul de la semaine courante
        // ---------------------------------------------------------

        const lundi = obtenirLundi(new Date());
        const lundiString = formatDateSQL(lundi);

        setSemaineCourante(lundiString);

        // ---------------------------------------------------------
        // 3. Données ADMIN
        // ---------------------------------------------------------

        if (collaborateur.role === "ADMIN") {
          const { data: collaborateursData, error: collaborateursError } =
            await supabase
              .from("collaborateurs")
              .select("id, prenom, nom, actif, role")
              .eq("actif", true)
              .order("nom", { ascending: true });

          if (collaborateursError) {
            throw collaborateursError;
          }

          const { data: feuillesData, error: feuillesError } =
            await supabase
              .from("feuilles_heures")
              .select(
                `
                id,
                collaborateur_id,
                semaine_debut,
                total_heures,
                total_theorique,
                heures_supplementaires,
                statut
              `
              )
              .eq("semaine_debut", lundiString);

          if (feuillesError) {
            throw feuillesError;
          }

          setCollaborateurs(collaborateursData ?? []);
          setFeuilles(feuillesData ?? []);
        }

        // ---------------------------------------------------------
        // 4. Données personnelles pour tout le monde
        // ---------------------------------------------------------

        if (collaborateur.role !== "ADMIN") {
          const { data: maFeuille } = await supabase
            .from("feuilles_heures")
            .select(
              `
              id,
              collaborateur_id,
              semaine_debut,
              total_heures,
              total_theorique,
              heures_supplementaires,
              statut
            `
            )
            .eq("collaborateur_id", collaborateur.id)
            .eq("semaine_debut", lundiString)
            .maybeSingle();

          if (maFeuille) {
            setFeuilles([maFeuille]);
          }
        }
      } catch (error) {
        console.error("Erreur dashboard :", error);

        setErreur(
          "Une erreur est survenue lors du chargement du tableau de bord."
        );
      } finally {
        setChargement(false);
      }
    }

    chargerDashboard();
  }, [router]);

  // ---------------------------------------------------------------
  // Ma feuille de la semaine
  // ---------------------------------------------------------------

  const maFeuille = useMemo(() => {
    if (!feuilles.length) return null;

    if (role === "ADMIN") return null;

    return feuilles.find(
      (feuille) => feuille.semaine_debut === semaineCourante
    );
  }, [feuilles, role, semaineCourante]);

  // ---------------------------------------------------------------
  // Statistiques ADMIN
  // ---------------------------------------------------------------

  const statistiques = useMemo(() => {
    if (role !== "ADMIN") {
      return {
        collaborateurs: 0,
        feuillesCompletes: 0,
        feuillesTotal: 0,
        heures: 0,
        heuresSupplementaires: 0,
      };
    }

    const feuillesCompletes = feuilles.filter(
      (feuille) => estFeuilleComplete(feuille)
    ).length;

    const heures = feuilles.reduce(
      (total, feuille) => total + Number(feuille.total_heures ?? 0),
      0
    );

    const heuresSupplementaires = feuilles.reduce(
      (total, feuille) =>
        total + Number(feuille.heures_supplementaires ?? 0),
      0
    );

    return {
      collaborateurs: collaborateurs.length,
      feuillesCompletes,
      feuillesTotal: collaborateurs.length,
      heures,
      heuresSupplementaires,
    };
  }, [role, collaborateurs, feuilles]);

  // ---------------------------------------------------------------
  // Feuilles à surveiller
  // ---------------------------------------------------------------

  const surveillance = useMemo<LigneSurveillance[]>(() => {
    if (role !== "ADMIN") return [];

    return collaborateurs
      .map((collaborateur) => {
        const feuille = feuilles.find(
          (item) => item.collaborateur_id === collaborateur.id
        );

        if (!feuille) {
          return {
            collaborateur,
            etat: "manquante" as EtatFeuille,
          };
        }

        if (!estFeuilleComplete(feuille)) {
          return {
            collaborateur,
            feuille,
            etat: "incomplete" as EtatFeuille,
          };
        }

        return null;
      })
      .filter(Boolean)
      .slice(0, 5) as LigneSurveillance[];
  }, [role, collaborateurs, feuilles]);

  // ---------------------------------------------------------------
  // Chargement
  // ---------------------------------------------------------------

  if (chargement) {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div style={styles.logo}>POLYNOV</div>

            <div style={styles.headerSubtitle}>
              Gestion des temps & activités
            </div>
          </div>
        </header>

        <div style={styles.loadingContainer}>
          <div style={styles.loadingSpinner} />
          <div style={{ marginTop: 14 }}>Chargement du tableau de bord...</div>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Erreur
  // ---------------------------------------------------------------

  if (erreur) {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div style={styles.logo}>POLYNOV</div>

            <div style={styles.headerSubtitle}>
              Gestion des temps & activités
            </div>
          </div>
        </header>

        <div style={styles.container}>
          <div style={styles.errorCard}>
            <div style={styles.errorIcon}>!</div>

            <div>
              <div style={styles.errorTitle}>Impossible de charger le tableau de bord</div>

              <div style={styles.errorText}>{erreur}</div>

              <button
                style={styles.primaryButton}
                onClick={() => window.location.reload()}
              >
                Réessayer
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------
  // AFFICHAGE
  // ---------------------------------------------------------------

  return (
    <main style={styles.page}>
      {/* =========================================================
          HEADER
      ========================================================= */}

      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <div style={styles.logo}>POLYNOV</div>

            <div style={styles.headerSubtitle}>
              Gestion des temps & activités
            </div>
          </div>

          {role && (
            <div style={styles.headerRole}>
              {role}
            </div>
          )}
        </div>
      </header>

      {/* =========================================================
          CONTENU
      ========================================================= */}

      <div style={styles.container}>
        {/* -------------------------------------------------------
            BIENVENUE
        ------------------------------------------------------- */}

        <div style={styles.welcome}>
          <div>
            <h1 style={styles.welcomeTitle}>
              Bonjour {prenom || "à vous"} 👋
            </h1>

            <p style={styles.welcomeText}>
              Voici l'état de votre activité et de vos feuilles de temps.
            </p>
          </div>

          <div style={styles.weekBadge}>
            <span style={styles.weekBadgeLabel}>SEMAINE EN COURS</span>
            <strong>{formaterSemaine(semaineCourante)}</strong>
          </div>
        </div>

        {/* =======================================================
            ESPACE PERSONNEL
        ======================================================= */}

        <SectionTitre
          titre="Mon espace"
          description="Accéder rapidement à vos feuilles et à votre activité"
        />

        {/* -------------------------------------------------------
            STATUT DE MA SEMAINE
        ------------------------------------------------------- */}

        <div style={styles.personalStatus}>
          <div style={styles.personalStatusLeft}>
            <div style={styles.personalIcon}>📅</div>

            <div>
              <div style={styles.personalTitle}>
                Ma semaine
              </div>

              <div style={styles.personalDescription}>
                {maFeuille
                  ? estFeuilleComplete(maFeuille)
                    ? "Votre feuille est complète."
                    : "Votre feuille doit encore être complétée."
                  : "Votre feuille de la semaine n'a pas encore été créée."}
              </div>
            </div>
          </div>

          <div style={styles.personalStatusRight}>
            {maFeuille ? (
              <>
                <div
                  style={{
                    ...styles.statusBadge,
                    ...(estFeuilleComplete(maFeuille)
                      ? styles.statusComplete
                      : styles.statusIncomplete),
                  }}
                >
                  {estFeuilleComplete(maFeuille)
                    ? "✓ Complète"
                    : "⚠ À compléter"}
                </div>

                <div style={styles.hoursValue}>
                  {formatHeures(maFeuille.total_heures)} h
                  <span style={styles.hoursTheoretical}>
                    {" "}
                    / {formatHeures(maFeuille.total_theorique)} h
                  </span>
                </div>
              </>
            ) : (
              <div style={styles.statusMissing}>
                Non saisie
              </div>
            )}

            <button
              style={styles.smallPrimaryButton}
              onClick={() => router.push("/ma-semaine")}
            >
              Ouvrir →
            </button>
          </div>
        </div>

        {/* -------------------------------------------------------
            CARTES PERSONNELLES
        ------------------------------------------------------- */}

        <div style={styles.cardGrid}>
          <Carte
            icone="📅"
            titre="Ma semaine"
            description="Saisir et consulter votre feuille hebdomadaire"
            onClick={() => router.push("/ma-semaine")}
          />

          <Carte
            icone="🗂️"
            titre="Mes feuilles"
            description="Retrouver l'historique de vos feuilles de temps"
            onClick={() => router.push("/mes-feuilles")}
          />

          <Carte
            icone="📊"
            titre="Bilan affaire"
            description="Consulter les historiques et imputations par affaire"
            onClick={() => router.push("/affaires/bilan")}
          />
        </div>

        {/* =======================================================
            ADMINISTRATION
        ======================================================= */}

        {role === "ADMIN" && (
          <>
            <SectionTitre
              titre="Pilotage"
              description="Une vue rapide de l'activité de la semaine"
            />

            {/* ---------------------------------------------------
                KPI
            --------------------------------------------------- */}

            <div style={styles.kpiGrid}>
              <Kpi
                icone="👥"
                valeur={statistiques.collaborateurs}
                label="Collaborateurs actifs"
              />

              <Kpi
                icone="📋"
                valeur={`${statistiques.feuillesCompletes}/${statistiques.feuillesTotal}`}
                label="Feuilles complètes"
                accent={
                  statistiques.feuillesCompletes ===
                  statistiques.feuillesTotal
                    ? "green"
                    : "orange"
                }
              />

              <Kpi
                icone="⏱️"
                valeur={`${formatHeures(statistiques.heures)} h`}
                label="Heures saisies"
              />

              <Kpi
                icone="↗"
                valeur={`${formatHeures(
                  statistiques.heuresSupplementaires
                )} h`}
                label="Heures supplémentaires"
                accent={
                  statistiques.heuresSupplementaires > 0
                    ? "orange"
                    : "green"
                }
              />
            </div>

            {/* ---------------------------------------------------
                À SURVEILLER
            --------------------------------------------------- */}

            <div style={styles.monitorCard}>
              <div style={styles.monitorHeader}>
                <div>
                  <div style={styles.monitorTitle}>
                    À surveiller
                  </div>

                  <div style={styles.monitorSubtitle}>
                    Feuilles de la semaine du{" "}
                    {formaterDateLongue(semaineCourante)}
                  </div>
                </div>

                <div
                  style={{
                    ...styles.monitorCount,
                    ...(surveillance.length === 0
                      ? styles.monitorCountGreen
                      : styles.monitorCountOrange),
                  }}
                >
                  {surveillance.length}
                </div>
              </div>

              {surveillance.length === 0 ? (
                <div style={styles.noAlert}>
                  <div style={styles.noAlertIcon}>✓</div>

                  <div>
                    <strong>Tout est en ordre</strong>
                    <div>
                      Toutes les feuilles de la semaine sont complètes.
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  {surveillance.map((ligne) => (
                    <div
                      key={ligne.collaborateur.id}
                      style={styles.monitorRow}
                    >
                      <div
                        style={{
                          ...styles.monitorStatus,
                          ...(ligne.etat === "manquante"
                            ? styles.monitorStatusMissing
                            : styles.monitorStatusIncomplete),
                        }}
                      >
                        {ligne.etat === "manquante" ? "!" : "⚠"}
                      </div>

                      <div style={styles.monitorPerson}>
                        <strong>
                          {ligne.collaborateur.prenom}{" "}
                          {ligne.collaborateur.nom}
                        </strong>

                        <span>
                          {ligne.etat === "manquante"
                            ? "Feuille non saisie"
                            : `${formatHeures(
                                ligne.feuille?.total_heures
                              )} h / ${formatHeures(
                                ligne.feuille?.total_theorique
                              )} h`}
                        </span>
                      </div>

                      <button
                        style={styles.monitorButton}
                        onClick={() =>
                          router.push(
                            `/admin/feuilles?collaborateur=${ligne.collaborateur.id}`
                          )
                        }
                      >
                        Voir →
                      </button>
                    </div>
                  ))}

                  {(collaborateurs.length > 5 ||
                    surveillance.length > 0) && (
                    <button
                      style={styles.seeAllButton}
                      onClick={() => router.push("/admin/feuilles")}
                    >
                      Voir toutes les feuilles →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ===================================================
                GESTION
            =================================================== */}

            <SectionTitre
              titre="Gestion"
              description="Paramétrer les collaborateurs et suivre les feuilles"
            />

            <div style={styles.cardGrid}>
              <Carte
                icone="👥"
                titre="Collaborateurs"
                description="Créer, modifier et gérer les collaborateurs"
                onClick={() =>
                  router.push("/admin/collaborateurs")
                }
              />

              <Carte
                icone="⏰"
                titre="Profils horaires"
                description="Gérer les profils, rythmes et bases horaires"
                onClick={() =>
                  router.push("/admin/profils-horaires")
                }
              />

              <Carte
                icone="📄"
                titre="Feuilles collaborateurs"
                description="Consulter les feuilles de temps de tous les collaborateurs"
                onClick={() =>
                  router.push("/admin/feuilles")
                }
              />
            </div>

            {/* ===================================================
                ANALYSE
            =================================================== */}

            <SectionTitre
              titre="Analyse"
              description="Analyser l'activité et les imputations"
            />

            <div style={styles.cardGrid}>
              <Carte
                icone="📈"
                titre="Bilans par personne"
                description="Analyser les heures, activités et imputations de chaque collaborateur"
                onClick={() =>
                  router.push("/admin/bilans")
                }
              />

              <Carte
                icone="📊"
                titre="Bilan affaire"
                description="Analyser les heures et imputations par affaire"
                onClick={() =>
                  router.push("/affaires/bilan")
                }
              />
            </div>

            {/* ===================================================
                DONNÉES
            =================================================== */}

            <SectionTitre
              titre="Données"
              description="Importer et alimenter les données historiques"
            />

            <div style={styles.cardGrid}>
              <Carte
                icone="📥"
                titre="Import historique"
                description="Importer les anciennes imputations depuis un fichier"
                onClick={() =>
                  router.push("/import-historique-v2")
                }
              />
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 800px) {
          .dashboard-header {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </main>
  );
}

/* ===============================================================
   SECTION TITRE
================================================================ */

function SectionTitre({
  titre,
  description,
}: {
  titre: string;
  description: string;
}) {
  return (
    <div style={styles.sectionHeader}>
      <h2 style={styles.sectionTitle}>{titre}</h2>

      <p style={styles.sectionDescription}>{description}</p>
    </div>
  );
}

/* ===============================================================
   CARTE
================================================================ */

function Carte({
  icone,
  titre,
  description,
  onClick,
}: {
  icone: string;
  titre: string;
  description: string;
  onClick: () => void;
}) {
  const [survol, setSurvol] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        ...styles.card,
        border: survol
          ? "1px solid #c00000"
          : "1px solid #eeeeee",
        boxShadow: survol
          ? "0 8px 20px rgba(0,0,0,0.12)"
          : "0 2px 8px rgba(0,0,0,0.07)",
        transform: survol
          ? "translateY(-2px)"
          : "translateY(0)",
      }}
    >
      <div>
        <div style={styles.cardIcon}>{icone}</div>

        <h3 style={styles.cardTitle}>{titre}</h3>

        <p style={styles.cardDescription}>{description}</p>
      </div>

      <div
        style={{
          ...styles.cardLink,
          opacity: survol ? 1 : 0.8,
        }}
      >
        Ouvrir →
      </div>
    </div>
  );
}

/* ===============================================================
   KPI
================================================================ */

function Kpi({
  icone,
  valeur,
  label,
  accent = "red",
}: {
  icone: string;
  valeur: string | number;
  label: string;
  accent?: "red" | "green" | "orange";
}) {
  const accentStyles = {
    red: {
      border: "#c00000",
      background: "#fdf0f0",
      value: "#c00000",
    },
    green: {
      border: "#2e7d32",
      background: "#edf7ee",
      value: "#2e7d32",
    },
    orange: {
      border: "#e67e22",
      background: "#fff5e9",
      value: "#d96b00",
    },
  };

  const couleur = accentStyles[accent];

  return (
    <div
      style={{
        ...styles.kpi,
        borderTop: `4px solid ${couleur.border}`,
      }}
    >
      <div style={styles.kpiTop}>
        <div
          style={{
            ...styles.kpiIcon,
            background: couleur.background,
          }}
        >
          {icone}
        </div>
      </div>

      <div
        style={{
          ...styles.kpiValue,
          color: couleur.value,
        }}
      >
        {valeur}
      </div>

      <div style={styles.kpiLabel}>{label}</div>
    </div>
  );
}

/* ===============================================================
   UTILITAIRES
================================================================ */

function obtenirLundi(date: Date) {
  const resultat = new Date(date);

  const jour = resultat.getDay();

  const difference = jour === 0 ? -6 : 1 - jour;

  resultat.setDate(resultat.getDate() + difference);

  resultat.setHours(0, 0, 0, 0);

  return resultat;
}

function formatDateSQL(date: Date) {
  const annee = date.getFullYear();

  const mois = String(date.getMonth() + 1).padStart(2, "0");

  const jour = String(date.getDate()).padStart(2, "0");

  return `${annee}-${mois}-${jour}`;
}

function formaterSemaine(dateSQL: string) {
  if (!dateSQL) return "";

  const date = new Date(`${dateSQL}T00:00:00`);

  const jour = date.getDate();

  const mois = date.toLocaleDateString("fr-FR", {
    month: "short",
  });

  return `${jour} ${mois}`;
}

function formaterDateLongue(dateSQL: string) {
  if (!dateSQL) return "";

  const date = new Date(`${dateSQL}T00:00:00`);

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatHeures(valeur: number | null | undefined) {
  const nombre = Number(valeur ?? 0);

  return nombre.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function estFeuilleComplete(feuille: Feuille) {
  const heures = Number(feuille.total_heures ?? 0);

  const theorique = Number(feuille.total_theorique ?? 0);

  if (theorique <= 0) {
    return heures > 0;
  }

  return heures >= theorique - 0.01;
}

/* ===============================================================
   STYLES
================================================================ */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    fontFamily: "Calibri, Arial, sans-serif",
    color: "#222",
  },

  header: {
    background: "#c00000",
    color: "white",
    padding: "24px 30px 26px 30px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
  },

  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
  },

  logo: {
    fontSize: 34,
    fontWeight: 800,
    letterSpacing: "-0.5px",
  },

  headerSubtitle: {
    marginTop: 4,
    fontSize: 16,
    opacity: 0.9,
  },

  headerRole: {
    background: "rgba(255,255,255,0.15)",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 20,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 700,
  },

  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "30px 30px 60px 30px",
  },

  loadingContainer: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: 40,
    textAlign: "center",
    color: "#666",
  },

  loadingSpinner: {
    width: 28,
    height: 28,
    margin: "0 auto",
    border: "3px solid #eeeeee",
    borderTop: "3px solid #c00000",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },

  welcome: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 30,
  },

  welcomeTitle: {
    margin: 0,
    fontSize: 34,
    color: "#222",
    fontWeight: 800,
    letterSpacing: "-0.5px",
  },

  welcomeText: {
    margin: "8px 0 0 0",
    color: "#666",
    fontSize: 16,
  },

  weekBadge: {
    background: "white",
    border: "1px solid #e5e5e5",
    borderRadius: 10,
    padding: "11px 16px",
    boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 135,
  },

  weekBadgeLabel: {
    color: "#888",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.5px",
  },

  sectionHeader: {
    marginBottom: 18,
    marginTop: 8,
  },

  sectionTitle: {
    margin: 0,
    fontSize: 23,
    color: "#222",
    fontWeight: 800,
  },

  sectionDescription: {
    margin: "4px 0 0 0",
    color: "#777",
    fontSize: 14,
  },

  personalStatus: {
    background: "white",
    borderRadius: 12,
    borderLeft: "5px solid #c00000",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    padding: "18px 20px",
    marginBottom: 20,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
  },

  personalStatusLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },

  personalIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    background: "#f8e8e8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 23,
  },

  personalTitle: {
    fontSize: 18,
    fontWeight: 800,
  },

  personalDescription: {
    color: "#666",
    fontSize: 14,
    marginTop: 3,
  },

  personalStatusRight: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },

  statusBadge: {
    borderRadius: 20,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
  },

  statusComplete: {
    background: "#e9f6eb",
    color: "#26712b",
  },

  statusIncomplete: {
    background: "#fff2e5",
    color: "#c76500",
  },

  statusMissing: {
    background: "#fdeaea",
    color: "#c00000",
    borderRadius: 20,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
  },

  hoursValue: {
    fontWeight: 800,
    fontSize: 16,
  },

  hoursTheoretical: {
    color: "#999",
    fontWeight: 400,
  },

  smallPrimaryButton: {
    border: "none",
    background: "#c00000",
    color: "white",
    borderRadius: 7,
    padding: "8px 13px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
  },

  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 20,
    marginBottom: 38,
  },

  card: {
    background: "white",
    borderRadius: 12,
    padding: 24,
    cursor: "pointer",
    borderLeft: "5px solid #c00000",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
    transition: "all 0.15s ease",
    minHeight: 150,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },

  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    background: "#f8e8e8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 24,
    marginBottom: 16,
  },

  cardTitle: {
    margin: 0,
    color: "#222",
    fontSize: 20,
    fontWeight: 800,
  },

  cardDescription: {
    margin: "8px 0 0 0",
    color: "#666",
    fontSize: 14,
    lineHeight: 1.5,
  },

  cardLink: {
    marginTop: 18,
    color: "#c00000",
    fontSize: 13,
    fontWeight: 700,
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    marginBottom: 25,
  },

  kpi: {
    background: "white",
    borderRadius: 11,
    padding: "18px 20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
  },

  kpiTop: {
    display: "flex",
    justifyContent: "space-between",
  },

  kpiIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
  },

  kpiValue: {
    fontSize: 27,
    fontWeight: 800,
    marginTop: 12,
  },

  kpiLabel: {
    color: "#777",
    fontSize: 13,
    marginTop: 2,
  },

  monitorCard: {
    background: "white",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
    marginBottom: 38,
    overflow: "hidden",
  },

  monitorHeader: {
    padding: "18px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    borderBottom: "1px solid #eeeeee",
  },

  monitorTitle: {
    fontSize: 19,
    fontWeight: 800,
  },

  monitorSubtitle: {
    color: "#888",
    fontSize: 13,
    marginTop: 3,
  },

  monitorCount: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 14,
  },

  monitorCountGreen: {
    background: "#e9f6eb",
    color: "#26712b",
  },

  monitorCountOrange: {
    background: "#fff1df",
    color: "#c76500",
  },

  noAlert: {
    padding: "20px",
    display: "flex",
    alignItems: "center",
    gap: 13,
    color: "#555",
    fontSize: 14,
  },

  noAlertIcon: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#e9f6eb",
    color: "#26712b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
  },

  monitorRow: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    padding: "14px 20px",
    borderBottom: "1px solid #f0f0f0",
  },

  monitorStatus: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 14,
  },

  monitorStatusMissing: {
    background: "#fdeaea",
    color: "#c00000",
  },

  monitorStatusIncomplete: {
    background: "#fff1df",
    color: "#c76500",
  },

  monitorPerson: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },

  monitorButton: {
    border: "none",
    background: "transparent",
    color: "#c00000",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    padding: "7px 4px",
  },

  seeAllButton: {
    width: "100%",
    background: "#fafafa",
    border: "none",
    borderTop: "1px solid #eeeeee",
    color: "#c00000",
    padding: "13px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },

  errorCard: {
    background: "white",
    borderRadius: 12,
    padding: 25,
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    borderLeft: "5px solid #c00000",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },

  errorIcon: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "#fdeaea",
    color: "#c00000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 20,
    flexShrink: 0,
  },

  errorTitle: {
    fontWeight: 800,
    fontSize: 18,
    marginBottom: 5,
  },

  errorText: {
    color: "#666",
    fontSize: 14,
    marginBottom: 15,
  },

  primaryButton: {
    background: "#c00000",
    color: "white",
    border: "none",
    borderRadius: 7,
    padding: "9px 15px",
    fontWeight: 700,
    cursor: "pointer",
  },
};