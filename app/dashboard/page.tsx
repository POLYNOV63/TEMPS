
"use client";

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import { useRouter } from "next/navigation";

/* ===============================================================
   TYPES
================================================================ */

type Collaborateur = {
  id: string;
  prenom: string | null;
  nom: string | null;
  actif: boolean;
  role: string | null;
  trigramme?: string | null;
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

type EtatFeuille =
  | "complete"
  | "incomplete"
  | "manquante";

type LigneSurveillance = {
  collaborateur: Collaborateur;
  feuille?: Feuille;
  etat: EtatFeuille;
};

/* ===============================================================
   PAGE
================================================================ */

export default function DashboardPage() {
  const router = useRouter();

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [trigramme, setTrigramme] = useState("");
  const [role, setRole] = useState("");

  // Droits liés au rôle (ADMIN / RESPONSABLE) : voir lib/droits.ts
  const accesFeuilles = peut(role, "voirFeuillesEquipe");
  const accesBilanRH = peut(role, "bilanRH");
  const accesExportExcel = peut(role, "exporterExcel");

  const [chargement, setChargement] =
    useState(true);

  const [collaborateurs, setCollaborateurs] =
    useState<Collaborateur[]>([]);

  const [feuilles, setFeuilles] =
    useState<Feuille[]>([]);

  const [feuillesPrecedentes, setFeuillesPrecedentes] =
    useState<Feuille[]>([]);

  const [nombreDemandesRH, setNombreDemandesRH] =
    useState(0);

  const [erreur, setErreur] =
    useState<string | null>(null);

  const [semaineCourante, setSemaineCourante] =
    useState("");

  const [monCollaborateurId, setMonCollaborateurId] =
    useState<string | null>(null);

  // Groupe « Paramétrage de l'application » : replié par défaut, choix mémorisé dans le navigateur
  const [parametrageOuvert, setParametrageOuvert] = useState(false);

  useEffect(() => {
    try {
      setParametrageOuvert(window.localStorage.getItem("polynov_dashboard_parametrage") === "1");
    } catch {
      /* navigateur sans stockage : on garde la valeur par défaut */
    }
  }, []);

  function basculerParametrage() {
    setParametrageOuvert((valeur) => {
      const suivant = !valeur;

      try {
        window.localStorage.setItem("polynov_dashboard_parametrage", suivant ? "1" : "0");
      } catch {
        /* sans stockage : le choix ne sera pas mémorisé */
      }

      return suivant;
    });
  }

  // Cloche : demandes RH en attente de validation (ADMIN), actualisées chaque minute et au retour sur l'onglet
  const [demandesCloche, setDemandesCloche] = useState<DemandeCloche[]>([]);

  useEffect(() => {
    if (role !== "ADMIN") return;

    let actif = true;

    async function rafraichir() {
      try {
        const { count } = await supabase
          .from("rh_demandes")
          .select("id", { count: "exact", head: true })
          .eq("statut", "EN_ATTENTE");

        const { data } = await supabase
          .from("rh_demandes_admin")
          .select("id, prenom, nom, trigramme, type_demande, date_debut, date_fin")
          .eq("statut", "EN_ATTENTE")
          .order("date_debut", { ascending: true })
          .limit(5);

        if (!actif) return;

        if (typeof count === "number") setNombreDemandesRH(count);
        setDemandesCloche((data ?? []) as DemandeCloche[]);
      } catch {
        /* la cloche garde sa dernière valeur : on réessaiera à la prochaine actualisation */
      }
    }

    void rafraichir();

    const minuteur = window.setInterval(rafraichir, 60000);
    const auRetour = () => {
      if (document.visibilityState === "visible") void rafraichir();
    };

    document.addEventListener("visibilitychange", auRetour);

    return () => {
      actif = false;
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [role]);

  /* =============================================================
     CHARGEMENT
  ============================================================= */

  useEffect(() => {
    async function chargerDashboard() {
      try {
        setChargement(true);
        setErreur(null);

        const {
          data: {
            user,
          },
          error: erreurUtilisateur,
        } = await supabase.auth.getUser();


        if (erreurUtilisateur) {
          throw erreurUtilisateur;
        }

        if (!user) {
          router.push("/login");
          return;
        }

        /* -------------------------------------------------------
           Collaborateur connecté
        ------------------------------------------------------- */

        const {
          data: collaborateur,
          error: erreurCollaborateur,
        } = await supabase
          .from("collaborateurs")
          .select(
            "id, prenom, nom, actif, role, trigramme"
          )
          .eq("auth_user_id", user.id)
          .maybeSingle();


        if (erreurCollaborateur) {
          throw erreurCollaborateur;
        }

if (!collaborateur) {

  throw new Error(
    "Aucun collaborateur associé à votre compte."
  );
}

        setPrenom(
          collaborateur.prenom ?? ""
        );

        setNom(
          collaborateur.nom ?? ""
        );

        setTrigramme(
          collaborateur.trigramme ?? ""
        );

        setMonCollaborateurId(collaborateur.id);

        const roleUtilisateur =
          String(
            collaborateur.role ?? ""
          ).toUpperCase();

        setRole(roleUtilisateur);

        /* -------------------------------------------------------
           Semaine courante
        ------------------------------------------------------- */

        const lundi =
          obtenirLundi(new Date());

        const lundiString =
          formatDateSQL(lundi);

        setSemaineCourante(
          lundiString
        );

        /* -------------------------------------------------------
           ADMIN
        ------------------------------------------------------- */

        if (
          roleUtilisateur ===
          "ADMIN"
        ) {
          const {
            data: collaborateursActifs,
            error:
              erreurCollaborateurs,
          } = await supabase
            .from("collaborateurs")
            .select(
              "id, prenom, nom, actif, role"
            )
            .eq("actif", true)
            .order("nom", {
              ascending: true,
            });

          if (erreurCollaborateurs) {
            throw erreurCollaborateurs;
          }

          const {
            data: feuillesCourantes,
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
                statut
              `
            )
            .eq(
              "semaine_debut",
              lundiString
            );

          if (erreurFeuilles) {
            throw erreurFeuilles;
          }

          // A traiter : feuilles de la semaine dernière non validées
          // et demandes RH en attente de validation.
          const [anneeLundi, moisLundi, jourLundi] = lundiString
            .split("-")
            .map(Number);

          const precedent = new Date(anneeLundi, moisLundi - 1, jourLundi - 7);

          const lundiPrecedentString = `${precedent.getFullYear()}-${String(
            precedent.getMonth() + 1
          ).padStart(2, "0")}-${String(precedent.getDate()).padStart(2, "0")}`;

          const { data: feuillesPrecedentesData } = await supabase
            .from("feuilles_heures")
            .select(
              "id, collaborateur_id, semaine_debut, total_heures, total_theorique, heures_supplementaires, statut"
            )
            .eq("semaine_debut", lundiPrecedentString);

          setFeuillesPrecedentes(feuillesPrecedentesData ?? []);

          const { count: demandesEnAttente } = await supabase
            .from("rh_demandes")
            .select("id", { count: "exact", head: true })
            .eq("statut", "EN_ATTENTE");

          setNombreDemandesRH(demandesEnAttente ?? 0);

          setCollaborateurs(
            collaborateursActifs ?? []
          );

          setFeuilles(
            feuillesCourantes ?? []
          );
        } else {
          /* -----------------------------------------------------
             COLLABORATEUR
          ----------------------------------------------------- */

          const {
            data: maFeuille,
            error: erreurMaFeuille,
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
                statut
              `
            )
            .eq(
              "collaborateur_id",
              collaborateur.id
            )
            .eq(
              "semaine_debut",
              lundiString
            )
            .maybeSingle();

          if (erreurMaFeuille) {
            throw erreurMaFeuille;
          }

          setFeuilles(
            maFeuille
              ? [maFeuille]
              : []
          );
        }
      } catch (err) {
        console.error(
          "Erreur chargement dashboard :",
          err
        );

        setErreur(
          err instanceof Error
            ? err.message
            : "Une erreur est survenue lors du chargement du tableau de bord."
        );
      } finally {
        setChargement(false);
      }
    }

    chargerDashboard();
  }, [router]);

  /* =============================================================
     FEUILLE PERSONNELLE
  ============================================================= */

  const maFeuille =
    useMemo(() => {
      return (
        feuilles.find(
          (feuille) =>
            feuille.semaine_debut ===
            semaineCourante &&
            feuille.collaborateur_id ===
            monCollaborateurId
        ) ?? null
      );
    }, [
      feuilles,
      semaineCourante,
      role,
      monCollaborateurId,
    ]);

  /* =============================================================
     STATISTIQUES ADMIN
  ============================================================= */

  const statistiques =
    useMemo(() => {
      if (role !== "ADMIN") {
        return {
          collaborateurs: 0,
          feuillesCompletes: 0,
          feuillesTotal: 0,
          heures: 0,
          heuresSupplementaires: 0,
        };
      }

      /*
       * On compte uniquement les feuilles correspondant
       * aux collaborateurs actifs actuellement affichés.
       *
       * Une feuille absente = feuille manquante.
       */

      const feuillesDesCollaborateursActifs =
        feuilles.filter((feuille) =>
          collaborateurs.some(
            (collaborateur) =>
              collaborateur.id ===
              feuille.collaborateur_id
          )
        );

      const feuillesCompletes =
        feuillesDesCollaborateursActifs.filter(
          (feuille) =>
            estFeuilleComplete(
              feuille
            )
        ).length;

      const heures =
        feuillesDesCollaborateursActifs.reduce(
          (
            total,
            feuille
          ) =>
            total +
            Number(
              feuille.total_heures ?? 0
            ),
          0
        );

      const heuresSupplementaires =
        feuillesDesCollaborateursActifs.reduce(
          (
            total,
            feuille
          ) =>
            total +
            Number(
              feuille.heures_supplementaires ??
                0
            ),
          0
        );

      return {
        collaborateurs:
          collaborateurs.length,

        feuillesCompletes,

        feuillesTotal:
          collaborateurs.length,

        heures,

        heuresSupplementaires,
      };
    }, [
      role,
      collaborateurs,
      feuilles,
    ]);

  /* =============================================================
     SURVEILLANCE
  ============================================================= */

  const surveillance =
    useMemo<LigneSurveillance[]>(() => {
      if (role !== "ADMIN") {
        return [];
      }

      // Une feuille de la semaine dernière qui n'est pas validée est en retard.
      return collaborateurs
        .map((collaborateur): LigneSurveillance | null => {
          const feuille = feuillesPrecedentes.find(
            (f) => f.collaborateur_id === collaborateur.id
          );

          if (!feuille) {
            return { collaborateur, feuille: undefined, etat: "manquante" };
          }

          if (feuille.statut === "A_TRAITER") {
            return null;
          }

          return { collaborateur, feuille, etat: "incomplete" };
        })
        .filter((ligne): ligne is LigneSurveillance => ligne !== null);
    }, [role, collaborateurs, feuillesPrecedentes]);

  /* =============================================================
     CHARGEMENT
  ============================================================= */

  if (chargement) {
    return (
      <main
        style={
          styles.page
        }
      >
        <div
          style={
            styles.loadingContainer
          }
        >
          <div
            style={
              styles.loadingSpinner
            }
          />

          <p>
            Chargement du
            tableau de bord…
          </p>
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
        `}</style>
      </main>
    );
  }

  /* =============================================================
     ERREUR
  ============================================================= */

  if (erreur) {
    return (
      <main
        style={
          styles.page
        }
      >
        <header
          style={
            styles.header
          }
        >
          <div
            style={
              styles.headerInner
            }
          >
            <div>
              <div
                style={
                  styles.logo
                }
              >
                POLYNOV
              </div>

              <div
                style={
                  styles.headerSubtitle
                }
              >
                Tableau de bord
              </div>
            </div>

            {role && (
              <div
                style={
                  styles.headerRole
                }
              >
                {role}
              </div>
            )}
          </div>
        </header>

        <div
          style={
            styles.container
          }
        >
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

            <div>
              <div
                style={
                  styles.errorTitle
                }
              >
                Impossible de charger
                le tableau de bord
              </div>

              <div
                style={
                  styles.errorText
                }
              >
                {erreur}
              </div>

              <button
                type="button"
                style={
                  styles.primaryButton
                }
                onClick={() =>
                  window.location.reload()
                }
              >
                Réessayer
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* =============================================================
     RENDU
  ============================================================= */

  return (
    <main
      style={
        styles.page
      }
    >
      {/* =======================================================
          HEADER
      ======================================================= */}

      <header
        style={
          styles.header
        }
      >
        <div
          style={
            styles.headerInner
          }
        >
          <div>
            <div
              style={
                styles.logo
              }
            >
              POLYNOV
            </div>

            <div
              style={
                styles.headerSubtitle
              }
            >
              Tableau de bord
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {role === "ADMIN" && (
              <ClocheDemandesRH nombre={nombreDemandesRH} demandes={demandesCloche} onAller={(url) => router.push(url)} />
            )}

            {role && <div style={styles.headerRole}>{role}</div>}
          </div>
        </div>
      </header>

      {/* MA_DASHBOARD_PRIORITES_V2 : cartes par priorité et plus petites (ADMIN : Pilotage BE, Validations RH, Mon espace, Analyse, Paramétrage replié) */}
      <div style={{ ...styles.container, padding: "14px 30px 32px 30px" }}>
        <div style={stylesV2.accueil}>
          <div>
            <h1 style={stylesV2.bonjour}>
              Bonjour {prenom || ""}
              {" 👋"}
            </h1>

            <div style={stylesV2.semaine}>
              {semaineCourante
                ? `Semaine S${numeroSemaine(semaineCourante)} · ${formaterSemaine(semaineCourante)}`
                : "—"}
            </div>
          </div>

          {role === "ADMIN" && (
            <div style={stylesV2.chips} title={`Feuilles de la semaine du ${formaterDateLongue(semaineCourante)}`}>
              <ChipSuivi icone="👥" valeur={String(statistiques.collaborateurs)} label="actifs" />
              <ChipSuivi
                icone="✓"
                valeur={`${statistiques.feuillesCompletes} / ${statistiques.feuillesTotal}`}
                label="feuilles complètes"
                ton={statistiques.feuillesCompletes >= statistiques.feuillesTotal ? "ok" : "neutre"}
              />
              <ChipSuivi icone="⏱️" valeur={`${formatHeures(statistiques.heures)} h`} label="saisies" />
              <ChipSuivi icone="＋" valeur={`${formatHeures(statistiques.heuresSupplementaires)} h`} label="heures sup" ton="alerte" />
            </div>
          )}
        </div>

        {role === "ADMIN" ? (
          <>
            <BlocPilotage aller={(url) => router.push(url)} />

            <BlocValidationsRH
              aller={(url) => router.push(url)}
              nombreDemandesRH={nombreDemandesRH}
              aRelancer={surveillance}
            />

            <BlocMonEspace
              aller={(url) => router.push(url)}
              statut={maFeuille ? (estFeuilleComplete(maFeuille) ? "complete" : "incomplete") : "absente"}
              libelle={maFeuille ? `Semaine du ${formaterDateLongue(semaineCourante)}` : "Ma feuille de la semaine courante"}
              avecBilanAffaire={false}
            />

            <BlocAnalyse
              aller={(url) => router.push(url)}
              admin
              accesFeuilles={accesFeuilles}
              accesBilanRH={accesBilanRH}
              accesExportExcel={accesExportExcel}
            />

            <BlocParametrage
              aller={(url) => router.push(url)}
              ouvert={parametrageOuvert}
              onBasculer={basculerParametrage}
            />
          </>
        ) : (
          <>
            <BlocMonEspace
              aller={(url) => router.push(url)}
              statut={maFeuille ? (estFeuilleComplete(maFeuille) ? "complete" : "incomplete") : "absente"}
              libelle={maFeuille ? `Semaine du ${formaterDateLongue(semaineCourante)}` : "Ma feuille de la semaine courante"}
              avecBilanAffaire={!peut(role, "piloterBE")}
            />

            {peut(role, "piloterBE") && <BlocPilotage aller={(url) => router.push(url)} />}

            <BlocAnalyse
              aller={(url) => router.push(url)}
              admin={false}
              accesFeuilles={accesFeuilles}
              accesBilanRH={accesBilanRH}
              accesExportExcel={accesExportExcel}
            />
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
   COMPOSANTS DU TABLEAU DE BORD (cartes compactes, par priorité)
================================================================ */

type Ton = "neutre" | "alerte" | "ok";

function Pastille({ texte, ton = "neutre" }: { texte: string; ton?: Ton }) {
  return <span style={{ ...stylesV2.pastille, ...stylesV2[`pastille_${ton}`] }}>{texte}</span>;
}

function ChipSuivi({
  icone,
  valeur,
  label,
  ton = "neutre",
}: {
  icone: string;
  valeur: string;
  label: string;
  ton?: Ton;
}) {
  return (
    <div style={stylesV2.chip}>
      <span aria-hidden="true">{icone}</span>
      <strong style={{ color: ton === "ok" ? "#26712b" : ton === "alerte" ? "#c76500" : "#222222" }}>{valeur}</strong>
      <span style={{ color: "#777777" }}>{label}</span>
    </div>
  );
}

function Groupe({
  titre,
  description,
  children,
  droite,
  surClic,
  deplie,
}: {
  titre: string;
  description?: string;
  children?: ReactNode;
  droite?: ReactNode;
  /* groupe repliable : toute la ligne de titre est cliquable */
  surClic?: () => void;
  deplie?: boolean;
}) {
  const cliquable = Boolean(surClic);

  return (
    <section style={stylesV2.groupe} aria-label={titre}>
      <div
        style={{ ...stylesV2.groupeEntete, ...(cliquable ? stylesV2.groupeEnteteCliquable : {}) }}
        {...(cliquable
          ? {
              role: "button",
              tabIndex: 0,
              "aria-expanded": deplie,
              onClick: surClic,
              onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  surClic?.();
                }
              },
            }
          : {})}
      >
        <h2 style={stylesV2.groupeTitre}>{titre}</h2>
        {description && <span style={stylesV2.groupeDescription}>{description}</span>}
        {droite}
      </div>

      {children}
    </section>
  );
}

function CarteCompacte({
  icone,
  titre,
  description,
  onClick,
  badge,
  ton = "neutre",
  principale = false,
}: {
  icone: string;
  titre: string;
  description: string;
  onClick: () => void;
  badge?: string | null;
  ton?: Ton;
  principale?: boolean;
}) {
  const [survol, setSurvol] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={titre}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        ...stylesV2.carte,
        ...(principale ? stylesV2.cartePrincipale : {}),
        boxShadow: survol ? "0 6px 16px rgba(0,0,0,0.14)" : "0 1px 5px rgba(0,0,0,0.08)",
        transform: survol ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <div style={{ ...stylesV2.carteIcone, ...(principale ? stylesV2.carteIconePrincipale : {}) }}>{icone}</div>

      <div style={stylesV2.carteTexte}>
        <div style={stylesV2.carteTitreLigne}>
          <h3 style={stylesV2.carteTitre}>{titre}</h3>
          {badge && <Pastille texte={badge} ton={ton} />}
        </div>

        <p style={stylesV2.carteDescription}>{description}</p>
      </div>
    </div>
  );
}

type DemandeCloche = {
  id: string;
  prenom: string | null;
  nom: string | null;
  trigramme: string | null;
  type_demande: string | null;
  date_debut: string | null;
  date_fin: string | null;
};

const LIBELLES_DEMANDE: Record<string, string> = {
  RE: "Récupération",
  CP: "Congés payés",
  RTT: "RTT",
};

function ClocheDemandesRH({
  nombre,
  demandes,
  onAller,
}: {
  nombre: number;
  demandes: DemandeCloche[];
  onAller: (url: string) => void;
}) {
  const [ouverte, setOuverte] = useState(false);

  useEffect(() => {
    if (!ouverte) return;

    const fermerClavier = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOuverte(false);
    };
    const fermerClic = (e: MouseEvent) => {
      const cible = e.target as HTMLElement | null;
      if (!cible?.closest("[data-cloche]")) setOuverte(false);
    };

    document.addEventListener("keydown", fermerClavier);
    document.addEventListener("mousedown", fermerClic);

    return () => {
      document.removeEventListener("keydown", fermerClavier);
      document.removeEventListener("mousedown", fermerClic);
    };
  }, [ouverte]);

  const dateFR = (valeur: string | null) => (valeur ? new Date(`${valeur}T00:00:00`).toLocaleDateString("fr-FR") : "");

  return (
    <div data-cloche style={stylesV2.clocheZone}>
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        aria-label={
          nombre > 0
            ? `Notifications : ${nombre} demande${nombre > 1 ? "s" : ""} RH à valider`
            : "Notifications : aucune demande RH à valider"
        }
        title={nombre > 0 ? `${nombre} demande${nombre > 1 ? "s" : ""} RH à valider` : "Aucune demande RH à valider"}
        style={stylesV2.cloche}
      >
        <span aria-hidden="true" style={{ fontSize: 20 }}>🔔</span>
        {nombre > 0 && <span style={stylesV2.clocheBadge}>{nombre > 99 ? "99+" : nombre}</span>}
      </button>

      {ouverte && (
        <div role="dialog" aria-label="Demandes RH à valider" style={stylesV2.clochePanneau}>
          <div style={stylesV2.clocheTitre}>
            {nombre > 0 ? `Demandes RH à valider (${nombre})` : "Aucune demande RH en attente ✓"}
          </div>

          {demandes.map((d) => (
            <div key={d.id} style={stylesV2.clocheLigne}>
              <strong>{[d.prenom, d.nom].filter(Boolean).join(" ") || d.trigramme || "—"}</strong>
              <span style={{ color: "#666666", fontSize: 12.5 }}>
                {LIBELLES_DEMANDE[String(d.type_demande ?? "")] ?? d.type_demande ?? "Demande"}
                {d.date_debut ? ` · ${dateFR(d.date_debut)}` : ""}
                {d.date_fin && d.date_fin !== d.date_debut ? ` → ${dateFR(d.date_fin)}` : ""}
              </span>
            </div>
          ))}

          {nombre > demandes.length && demandes.length > 0 && (
            <div style={{ color: "#666666", fontSize: 12.5, padding: "6px 14px" }}>… et {nombre - demandes.length} autre(s)</div>
          )}

          <button
            type="button"
            onClick={() => {
              setOuverte(false);
              onAller("/admin/Valid_RH");
            }}
            style={stylesV2.clocheBouton}
          >
            Ouvrir la validation RH →
          </button>
        </div>
      )}
    </div>
  );
}

function BlocPilotage({ aller }: { aller: (url: string) => void }) {
  return (
    <Groupe titre="Pilotage BE" description="Portefeuille et charge : onglets en haut du planning">
      <div style={stylesV2.grille}>
        <CarteCompacte
          principale
          icone="📅"
          titre="Planning des affaires"
          description="Affecter les ressources en glissant et en étirant, comparer au chiffré"
          onClick={() => aller("/pilotage/affaires")}
        />
        <CarteCompacte
          principale
          icone="＋"
          titre="Nouvelle affaire"
          description="Déclarer un DBE, un CBE, une PE ou une PI"
          onClick={() => aller("/pilotage/nouvelle")}
        />
        <CarteCompacte
          icone="📊"
          titre="Bilan affaire"
          description="Heures imputées par affaire et bilans d'affaires"
          onClick={() => aller("/affaires/bilan")}
        />
      </div>
    </Groupe>
  );
}

function BlocValidationsRH({
  aller,
  nombreDemandesRH,
  aRelancer,
}: {
  aller: (url: string) => void;
  nombreDemandesRH: number;
  aRelancer: LigneSurveillance[];
}) {
  const noms = aRelancer.map((ligne) => ligne.collaborateur.prenom || ligne.collaborateur.nom || "—");

  return (
    <Groupe titre="Validations RH" description="Demandes, compteurs et feuilles à relancer">
      <div style={stylesV2.grille}>
        <CarteCompacte
          icone="🧑‍💼"
          titre="Validation RH"
          description="Valider les demandes nécessitant la double validation PLG / AMA"
          badge={nombreDemandesRH > 0 ? `${nombreDemandesRH} en attente` : null}
          ton="alerte"
          onClick={() => aller("/admin/Valid_RH")}
        />
        <CarteCompacte
          icone="⏱️"
          titre="Compteurs de récupération"
          description="Ajuster un compteur, avec motif et historique"
          onClick={() => aller("/admin/compteurs")}
        />
        <CarteCompacte
          icone="📋"
          titre="Feuilles à relancer"
          description={
            aRelancer.length === 0
              ? "Toutes les feuilles de la semaine dernière sont validées"
              : `${noms.slice(0, 4).join(", ")}${noms.length > 4 ? ` +${noms.length - 4}` : ""} : feuille non validée`
          }
          badge={aRelancer.length === 0 ? "✓" : String(aRelancer.length)}
          ton={aRelancer.length === 0 ? "ok" : "alerte"}
          onClick={() => aller("/admin/feuilles")}
        />
      </div>
    </Groupe>
  );
}

function BlocMonEspace({
  aller,
  statut,
  libelle,
  avecBilanAffaire,
}: {
  aller: (url: string) => void;
  statut: "complete" | "incomplete" | "absente";
  libelle: string;
  avecBilanAffaire: boolean;
}) {
  return (
    <Groupe titre="Mon espace" description="Mes feuilles, mes affaires et mes demandes RH">
      <div style={stylesV2.grille}>
        <CarteCompacte
          icone="📅"
          titre="Ma semaine"
          description={libelle}
          badge={statut === "complete" ? "✓ Complète" : statut === "incomplete" ? "⚠ À compléter" : "⚠ Non saisie"}
          ton={statut === "complete" ? "ok" : "alerte"}
          onClick={() => aller("/ma-semaine")}
        />
        <CarteCompacte
          icone="📄"
          titre="Mes feuilles"
          description="Mes feuilles de temps enregistrées"
          onClick={() => aller("/mes-feuilles")}
        />
        {avecBilanAffaire && (
          <CarteCompacte
            icone="📊"
            titre="Bilan affaire"
            description="Mes imputations et mes bilans d'affaires"
            onClick={() => aller("/affaires/bilan")}
          />
        )}
        <CarteCompacte
          icone="🧑‍💼"
          titre="RH"
          description="Mes demandes de congés, RTT et récupération"
          onClick={() => aller("/RH")}
        />
      </div>
    </Groupe>
  );
}

function BlocAnalyse({
  aller,
  admin,
  accesFeuilles,
  accesBilanRH,
  accesExportExcel,
}: {
  aller: (url: string) => void;
  admin: boolean;
  accesFeuilles: boolean;
  accesBilanRH: boolean;
  accesExportExcel: boolean;
}) {
  if (!admin && !accesFeuilles && !accesBilanRH && !accesExportExcel) return null;

  return (
    <Groupe
      titre={admin ? "Analyse" : "Suivi des équipes"}
      description={
        admin
          ? "Charge, activités, bilan RH mensuel, exports et feuilles des collaborateurs"
          : "Feuilles de temps, bilan RH mensuel et export Excel"
      }
    >
      <div style={stylesV2.grille}>
        {admin && (
          <CarteCompacte
            icone="📈"
            titre="Analyse de charge"
            description="Heures, activité et taux d'occupation de chaque collaborateur"
            onClick={() => aller("/admin/bilans")}
          />
        )}
        {admin && (
          <CarteCompacte
            icone="🧩"
            titre="Bilan activités"
            description="Heures CBE / DBE réparties par activité"
            onClick={() => aller("/admin/bilan-activites")}
          />
        )}
        {accesBilanRH && (
          <CarteCompacte
            icone="🧑‍💼"
            titre="Bilan RH mensuel"
            description="TR, télétravail, heures supplémentaires et compteur"
            onClick={() => aller("/admin/bilan-rh")}
          />
        )}
        {accesExportExcel && (
          <CarteCompacte
            icone="📊"
            titre="Export Excel"
            description="Fichier hebdomadaire compatible avec l'ancien système"
            onClick={() => aller("/admin/export-excel")}
          />
        )}
        {accesFeuilles && (
          <CarteCompacte
            icone="📋"
            titre="Feuilles collaborateurs"
            description="Consulter les feuilles de temps de tous les collaborateurs"
            onClick={() => aller("/admin/feuilles")}
          />
        )}
      </div>
    </Groupe>
  );
}

function BlocParametrage({
  aller,
  ouvert,
  onBasculer,
}: {
  aller: (url: string) => void;
  ouvert: boolean;
  onBasculer: () => void;
}) {
  return (
    <Groupe
      titre="⚙️ Paramétrage de l'application"
      description="Codes, activités, collaborateurs, rythmes, imputations, export IA, import"
      surClic={onBasculer}
      deplie={ouvert}
      droite={
        <span style={stylesV2.boutonGroupe}>{ouvert ? "Replier ▴" : "Afficher les 7 réglages ▾"}</span>
      }
    >
      {ouvert && (
        <div style={stylesV2.grille}>
          <CarteCompacte icone="🏷️" titre="Gestion des codes" description="Codes, contextes d'utilisation et classement dans les bilans" onClick={() => aller("/admin/Gestion-codes")} />
          <CarteCompacte icone="🧩" titre="Gestion des activités" description="Activités du BE et codes d'imputation associés" onClick={() => aller("/admin/Gestion-activites")} />
          <CarteCompacte icone="👥" titre="Collaborateurs" description="Créer, modifier et gérer les collaborateurs" onClick={() => aller("/admin/collaborateurs")} />
          <CarteCompacte icone="⏰" titre="Rythmes horaires" description="Profils, rythmes et bases horaires" onClick={() => aller("/admin/profils-horaires")} />
          <CarteCompacte icone="🏷️" titre="Imputations des affaires" description="Liste BE, PE, PI, Scan, Négoce, IG… du Pilotage BE" onClick={() => aller("/admin/imputations-pilotage")} />
          <CarteCompacte icone="🧠" titre="Export IA" description="Contexte complet du projet : code, base, droits, fonctions SQL" onClick={() => aller("/admin/Export-IA")} />
          <CarteCompacte icone="📥" titre="Import historique" description="Importer les anciennes imputations depuis un fichier" onClick={() => aller("/import-historique-v2")} />
        </div>
      )}
    </Groupe>
  );
}

/* ===============================================================
   UTILITAIRES
================================================================ */

function obtenirLundi(
  date: Date
) {
  const resultat =
    new Date(date);

  const jour =
    resultat.getDay();

  const difference =
    jour === 0
      ? -6
      : 1 - jour;

  resultat.setDate(
    resultat.getDate() +
      difference
  );

  resultat.setHours(
    0,
    0,
    0,
    0
  );

  return resultat;
}

function formatDateSQL(
  date: Date
) {
  const annee =
    date.getFullYear();

  const mois = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const jour = String(
    date.getDate()
  ).padStart(2, "0");

  return `${annee}-${mois}-${jour}`;
}

function formaterSemaine(
  dateSQL: string
) {
  if (!dateSQL) {
    return "";
  }

  const date =
    new Date(
      `${dateSQL}T00:00:00`
    );

  const jour =
    date.getDate();

  const mois =
    date.toLocaleDateString(
      "fr-FR",
      {
        month: "short",
      }
    );

  return `${jour} ${mois}`;
}

function formaterDateLongue(
  dateSQL: string
) {
  if (!dateSQL) {
    return "";
  }

  const date =
    new Date(
      `${dateSQL}T00:00:00`
    );

  return date.toLocaleDateString(
    "fr-FR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

function numeroSemaine(
  dateSQL: string
) {
  if (!dateSQL) {
    return "";
  }

  const date =
    new Date(
      `${dateSQL}T00:00:00`
    );

  /*
   * Calcul ISO de la semaine.
   */
  const jeudi =
    new Date(date);

  jeudi.setDate(
    date.getDate() +
      4 -
      (date.getDay() || 7)
  );

  const debutAnnee =
    new Date(
      jeudi.getFullYear(),
      0,
      1
    );

  return String(
    Math.ceil(
      (((jeudi.getTime() -
        debutAnnee.getTime()) /
        86400000) +
        1) /
        7
    )
  ).padStart(2, "0");
}

function formatHeures(
  valeur:
    | number
    | null
    | undefined
) {
  const nombre =
    Number(valeur ?? 0);

  return nombre.toLocaleString(
    "fr-FR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }
  );
}

function estFeuilleComplete(
  feuille: Feuille
) {
  const heures =
    Number(
      feuille.total_heures ?? 0
    );

  const theorique =
    Number(
      feuille.total_theorique ?? 0
    );

  if (theorique <= 0) {
    return heures > 0;
  }

  return (
    heures >=
    theorique - 0.01
  );
}

/* ===============================================================
   STYLES
================================================================ */

const styles: Record<
  string,
  CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    fontFamily:
      "Calibri, Arial, sans-serif",
    color: "#222",
  },

  header: {
    background: "#c00000",
    color: "white",
    padding:
      "24px 30px 26px 30px",
    boxShadow:
      "0 2px 10px rgba(0,0,0,0.12)",
  },

  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 20,
  },

  logo: {
    fontSize: 34,
    fontWeight: 800,
    letterSpacing:
      "-0.5px",
  },

  headerSubtitle: {
    marginTop: 4,
    fontSize: 16,
    opacity: 0.9,
  },

  headerRole: {
    background:
      "rgba(255,255,255,0.15)",
    border:
      "1px solid rgba(255,255,255,0.3)",
    borderRadius: 20,
    padding:
      "8px 14px",
    fontSize: 13,
    fontWeight: 700,
  },

  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding:
      "30px 30px 60px 30px",
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
    border:
      "3px solid #eeeeee",
    borderTop:
      "3px solid #c00000",
    borderRadius: "50%",
    animation:
      "spin 0.8s linear infinite",
  },

  welcome: {
    display: "flex",
    justifyContent:
      "space-between",
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
    letterSpacing:
      "-0.5px",
  },

  welcomeText: {
    margin:
      "8px 0 0 0",
    color: "#666",
    fontSize: 16,
  },

  weekBadge: {
    background: "white",
    border:
      "1px solid #e5e5e5",
    borderRadius: 10,
    padding:
      "11px 16px",
    boxShadow:
      "0 2px 6px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection:
      "column",
    gap: 3,
    minWidth: 135,
  },

  weekBadgeLabel: {
    color: "#888",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing:
      "0.5px",
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
    margin:
      "4px 0 0 0",
    color: "#777",
    fontSize: 14,
  },

  personalStatus: {
    background: "white",
    borderRadius: 12,
    borderLeft:
      "5px solid #c00000",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.08)",
    padding:
      "18px 20px",
    marginBottom: 20,
    display: "flex",
    justifyContent:
      "space-between",
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
    padding:
      "6px 10px",
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
    padding:
      "6px 10px",
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
    padding:
      "8px 13px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
  },

  cardGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 20,
    marginBottom: 38,
  },

  card: {
    background: "white",
    borderRadius: 12,
    padding: 24,
    cursor: "pointer",
    borderLeft:
      "5px solid #c00000",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.07)",
    transition:
      "all 0.15s ease",
    minHeight: 150,
    display: "flex",
    flexDirection:
      "column",
    justifyContent:
      "space-between",
    outline: "none",
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
    margin:
      "8px 0 0 0",
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
    gridTemplateColumns:
      "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    marginBottom: 25,
  },

  kpi: {
    background: "white",
    borderRadius: 11,
    padding:
      "18px 20px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.07)",
  },

  kpiTop: {
    display: "flex",
    justifyContent:
      "space-between",
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
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.07)",
    marginBottom: 38,
    overflow: "hidden",
  },

  monitorHeader: {
    padding:
      "18px 20px",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 15,
    borderBottom:
      "1px solid #eeeeee",
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
    padding: 20,
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
    padding:
      "14px 20px",
    borderBottom:
      "1px solid #f0f0f0",
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
    flexDirection:
      "column",
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
    padding:
      "7px 4px",
  },

  seeAllButton: {
    width: "100%",
    background: "#fafafa",
    border: "none",
    borderTop:
      "1px solid #eeeeee",
    color: "#c00000",
    padding: 13,
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
    alignItems:
      "flex-start",
    borderLeft:
      "5px solid #c00000",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.08)",
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
    padding:
      "9px 15px",
    fontWeight: 700,
    cursor: "pointer",
  },
};

/* ===============================================================
   STYLES DES CARTES COMPACTES
================================================================ */

const stylesV2: Record<string, CSSProperties> = {
  accueil: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", margin: "0 0 10px" },
  bonjour: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.3px", color: "#222222" },
  semaine: { color: "#777777", fontSize: 13, marginTop: 2 },
  chips: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: { background: "#ffffff", border: "1px solid #e5e5e5", borderRadius: 10, padding: "6px 12px", display: "flex", alignItems: "center", gap: 7, fontSize: 13, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  groupe: { marginBottom: 12 },
  groupeEntete: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 },
  groupeEnteteCliquable: { cursor: "pointer", background: "#ffffff", border: "1px solid #dddddd", borderRadius: 10, padding: "8px 12px", boxShadow: "0 1px 5px rgba(0,0,0,0.08)" },
  groupeTitre: { margin: 0, fontSize: 18, fontWeight: 800, color: "#222222" },
  groupeDescription: { color: "#777777", fontSize: 13 },
  boutonGroupe: { marginLeft: "auto", background: "#333333", color: "#ffffff", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" },
  clocheZone: { position: "relative" },
  cloche: { position: "relative", width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", color: "#ffffff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "inherit" },
  clocheBadge: { position: "absolute", top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 999, background: "#ffffff", color: "#c00000", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #c00000", boxSizing: "border-box" },
  clochePanneau: { position: "absolute", top: 54, right: 0, width: 340, maxWidth: "90vw", background: "#ffffff", color: "#222222", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", zIndex: 60, overflow: "hidden", textAlign: "left" },
  clocheTitre: { padding: "12px 14px", fontWeight: 800, fontSize: 15, borderBottom: "1px solid #eeeeee" },
  clocheLigne: { display: "flex", flexDirection: "column", gap: 1, padding: "9px 14px", borderBottom: "1px solid #f3f3f3", fontSize: 14 },
  clocheBouton: { width: "100%", border: "none", background: "#c00000", color: "#ffffff", padding: "12px 14px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  grille: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 },
  carte: { background: "#ffffff", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", borderLeft: "4px solid #c00000", minHeight: 62, transition: "all 0.15s ease", outline: "none" },
  cartePrincipale: { background: "#fff6f6" },
  carteIcone: { width: 38, height: 38, borderRadius: 9, background: "#f8e8e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  carteIconePrincipale: { background: "#c00000", color: "#ffffff" },
  carteTexte: { flex: 1, minWidth: 0 },
  carteTitreLigne: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  carteTitre: { margin: 0, fontSize: 16, fontWeight: 800, color: "#222222" },
  carteDescription: { margin: "2px 0 0", color: "#666666", fontSize: 12.5, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  pastille: { borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap" },
  pastille_neutre: { background: "#f0f0f0", color: "#555555" },
  pastille_alerte: { background: "#fff1df", color: "#c76500" },
  pastille_ok: { background: "#e9f6eb", color: "#26712b" },
};
