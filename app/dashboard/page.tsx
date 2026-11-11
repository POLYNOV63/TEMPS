"use client";

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { normaliserRole, peut } from "@/lib/droits";
import { useRouter } from "next/navigation";
import FeuilleDeRouteDashboard from "@/components/FeuilleDeRouteDashboard";
import VignetteFacturation from "@/components/dashboard/VignetteFacturation";
import GraphiquesDisponibilites from "@/components/analyse/GraphiquesDisponibilites";
import { useDisponibilitesActivites } from "@/lib/disponibilitesActivites";
import { aISO, lundiDe } from "@/lib/pilotagePlanning";
import { rappelBilanRH } from "@/lib/clotureMensuelle";

/* ===============================================================
   TABLEAU DE BORD (DASHBOARD_SIMPLIFIE)

   ADMIN : Mon espace, vignette « À facturer » (mois en cours et suivant),
   quatre tuiles (Pilotage, RH, Finance, Exports : un clic ouvre la
   première page, le bandeau de la page donne le reste), ma feuille de
   route (relances de devis comprises), paramétrage replié.
   DIRECTION : vignette « À facturer », tuiles Pilotage et Finance, les
   3 graphiques de disponibilité par activité. Pas de feuille de route.
   RESPONSABLE : Mon espace, tuiles Pilotage (et RH, Exports selon ses
   droits), sa feuille de route. COLLABORATEUR : Mon espace, sa feuille
   de route.
   APERCU_ROLE : l'ADMIN peut voir le tableau de bord de n'importe qui.
================================================================ */

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

type EtatFeuille = "complete" | "incomplete" | "manquante";

/* FEUILLES_A_RELANCER_V2 : état des feuilles de la semaine */
type BilanRelance = { semaine: string; transmises: number; completes: number; incompletes: number; nonSaisies: number };

type LigneSurveillance = {
  collaborateur: Collaborateur;
  feuille?: Feuille;
  etat: EtatFeuille;
};

const COLONNES_FEUILLE = "id, collaborateur_id, semaine_debut, total_heures, total_theorique, heures_supplementaires, statut";

/* ===============================================================
   PAGE
================================================================ */

export default function DashboardPage() {
  const router = useRouter();

  const [prenom, setPrenom] = useState("");
  const [role, setRole] = useState("");

  const [chargement, setChargement] = useState(true);
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  /* APERCU_ROLE : toutes les fiches (actives ou non), pour le menu « Voir comme… » */
  const [fichesApercu, setFichesApercu] = useState<Collaborateur[]>([]);
  const [feuilles, setFeuilles] = useState<Feuille[]>([]);
  const [nombreDemandesRH, setNombreDemandesRH] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [semaineCourante, setSemaineCourante] = useState("");
  const [monCollaborateurId, setMonCollaborateurId] = useState<string | null>(null);

  /* APERCU_ROLE : l'ADMIN voit le tableau de bord d'un collaborateur (« 👁 Voir comme… »),
     choix gardé dans l'adresse (/dashboard?voir=<id>). Seul le tableau de bord change :
     les liens s'ouvrent toujours avec les droits de l'ADMIN. */
  const [voirId, setVoirId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setVoirId(new URLSearchParams(window.location.search).get("voir"));
    } catch {
      /* sans adresse lisible : pas d'aperçu */
    }
  }, []);
  function choisirApercu(id: string) {
    setVoirId(id || null);
    router.replace(id ? `/dashboard?voir=${encodeURIComponent(id)}` : "/dashboard");
  }

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

  // Cloche : demandes RH en attente de validation (ADMIN) et relances de devis (NOTIF_RELANCES, tous sauf la
  // Direction), actualisées chaque minute et au retour sur l'onglet
  const [demandesCloche, setDemandesCloche] = useState<DemandeCloche[]>([]);
  const [notifsRelances, setNotifsRelances] = useState<NotifRelance[]>([]);
  /* BILAN_RH_RAPPEL : bilan RH du mois à envoyer aux services RH (ADMIN) */
  const [rappelBilan, setRappelBilan] = useState<RappelBilan | null>(null);

  useEffect(() => {
    if (!role || role === "DIRECTION") return;

    let actif = true;

    async function rafraichir() {
      try {
        if (role === "ADMIN") {
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

          // sans le SQL 95 : pas de rappel
          const { data: envois, error: eEnv } = await supabase.from("rh_bilans_envoyes").select("mois").order("mois", { ascending: false }).limit(6);
          if (!actif) return;
          const r = eEnv ? null : rappelBilanRH(new Set(((envois ?? []) as { mois: string }[]).map((x) => String(x.mois).slice(0, 7))));
          setRappelBilan(
            r
              ? {
                  texte: `Bilan RH de ${r.periode.libelle.split(" ")[0]} à envoyer aux RH`,
                  detail: r.enRetard
                    ? `mois clôturé le ${new Date(`${r.periode.dateCloture}T00:00:00`).toLocaleDateString("fr-FR")}`
                    : `clôture le vendredi ${new Date(`${r.periode.dateCloture}T00:00:00`).toLocaleDateString("fr-FR")}`,
                  enRetard: r.enRetard,
                }
              : null
          );
        }

        // sans le SQL 94 : pas de notification de relance
        const { data: rl, error: erl } = await supabase.rpc("mes_notifications_relances");
        if (actif) setNotifsRelances(erl ? [] : ((rl ?? []) as NotifRelance[]));
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

  /* NOTIF_RELANCES : une notification vue (clic) ou toutes */
  async function relanceVue(n: NotifRelance) {
    setNotifsRelances((l) => l.filter((x) => !(x.relance_id === n.relance_id && x.evenement === n.evenement)));
    await supabase.rpc("marquer_notification_relance_vue", { p_relance_id: n.relance_id, p_evenement: n.evenement });
  }
  async function toutesRelancesVues() {
    setNotifsRelances([]);
    await supabase.rpc("marquer_notifications_relances_vues");
  }

  /* =============================================================
     CHARGEMENT
  ============================================================= */

  useEffect(() => {
    async function chargerDashboard() {
      try {
        setChargement(true);
        setErreur(null);

        const {
          data: { user },
          error: erreurUtilisateur,
        } = await supabase.auth.getUser();

        /* SESSION_EXPIREE : pas (ou plus) de session -> page de connexion, sans message d'erreur */
        if (!user || (erreurUtilisateur && /session|jwt|token/i.test(erreurUtilisateur.message ?? ""))) {
          router.push("/login");
          return;
        }

        if (erreurUtilisateur) throw erreurUtilisateur;

        /* Collaborateur connecté */
        const { data: collaborateur, error: erreurCollaborateur } = await supabase
          .from("collaborateurs")
          .select("id, prenom, nom, actif, role, trigramme")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (erreurCollaborateur) throw erreurCollaborateur;
        if (!collaborateur) throw new Error("Aucun collaborateur associé à votre compte.");

        setPrenom(collaborateur.prenom ?? "");
        setMonCollaborateurId(collaborateur.id);

        const roleUtilisateur = String(collaborateur.role ?? "").toUpperCase();
        setRole(roleUtilisateur);

        /* Semaine courante */
        const lundiString = formatDateSQL(obtenirLundi(new Date()));
        setSemaineCourante(lundiString);

        if (roleUtilisateur === "ADMIN") {
          /* ADMIN : feuilles de toute l'équipe */
          const { data: collaborateursActifs, error: erreurCollaborateurs } = await supabase
            .from("collaborateurs")
            .select("id, prenom, nom, actif, role, trigramme")
            .eq("actif", true)
            .order("nom", { ascending: true });

          if (erreurCollaborateurs) throw erreurCollaborateurs;

          const { data: feuillesCourantes, error: erreurFeuilles } = await supabase
            .from("feuilles_heures")
            .select(COLONNES_FEUILLE)
            .eq("semaine_debut", lundiString);

          if (erreurFeuilles) throw erreurFeuilles;

          const { count: demandesEnAttente } = await supabase
            .from("rh_demandes")
            .select("id", { count: "exact", head: true })
            .eq("statut", "EN_ATTENTE");

          setNombreDemandesRH(demandesEnAttente ?? 0);
          setCollaborateurs(collaborateursActifs ?? []);

          // APERCU_ROLE : toutes les fiches, même inactives ; sans réponse, on se contente des actifs.
          // ACCES_DIRECTION_INVISIBLE : les fiches Direction sont masquées par la base (SQL 56) ;
          // comme la page Collaborateurs, on les relit par la fonction réservée aux administrateurs.
          const [{ data: toutes }, { data: direction }] = await Promise.all([
            supabase.from("collaborateurs").select("id, prenom, nom, actif, role, trigramme").order("nom", { ascending: true }),
            supabase.rpc("polynov_acces_direction"),
          ]);
          const equipeLue = ((toutes ?? collaborateursActifs ?? []) as Collaborateur[]);
          const dejaLus = new Set(equipeLue.map((c) => c.id));
          const directionLue = ((direction ?? []) as Collaborateur[]).filter((c) => !dejaLus.has(c.id));
          setFichesApercu([...equipeLue, ...directionLue]);
          setFeuilles(feuillesCourantes ?? []);
        } else if (roleUtilisateur !== "DIRECTION") {
          /* Autres rôles (sauf Direction, sans feuille d'heures) : sa propre feuille */
          const { data: maFeuille, error: erreurMaFeuille } = await supabase
            .from("feuilles_heures")
            .select(COLONNES_FEUILLE)
            .eq("collaborateur_id", collaborateur.id)
            .eq("semaine_debut", lundiString)
            .maybeSingle();

          if (erreurMaFeuille) throw erreurMaFeuille;

          setFeuilles(maFeuille ? [maFeuille] : []);
        }
      } catch (err) {
        console.error("Erreur chargement dashboard :", err);
        setErreur(err instanceof Error ? err.message : "Une erreur est survenue lors du chargement du tableau de bord.");
      } finally {
        setChargement(false);
      }
    }

    chargerDashboard();
  }, [router]);

  /* =============================================================
     FEUILLE PERSONNELLE
  ============================================================= */

  /* APERCU_ROLE : la personne dont on affiche le tableau de bord (soi-même, hors aperçu) */
  /* « role:DIRECTION » : le tableau de bord type d'un rôle, sans personne (pas de feuille de route) */
  const apercu = useMemo((): { id: string | null; prenom: string | null; nom: string | null; trigramme: string | null; role: string } | null => {
    if (role !== "ADMIN" || !voirId) return null;
    if (voirId.startsWith("role:")) return { id: null, prenom: null, nom: null, trigramme: null, role: voirId.slice(5).toUpperCase() };
    const c = fichesApercu.find((x) => x.id === voirId && x.id !== monCollaborateurId);
    return c ? { id: c.id, prenom: c.prenom, nom: c.nom, trigramme: c.trigramme ?? null, role: normaliserRole(c.role) } : null;
  }, [role, voirId, fichesApercu, monCollaborateurId]);
  const roleVu = apercu ? apercu.role : role;
  const idVu = apercu ? apercu.id : monCollaborateurId;

  const maFeuille = useMemo(
    () => feuilles.find((f) => f.semaine_debut === semaineCourante && f.collaborateur_id === idVu) ?? null,
    [feuilles, semaineCourante, idVu]
  );

  /* =============================================================
     STATISTIQUES ADMIN (feuilles des collaborateurs actifs, semaine courante)
  ============================================================= */

  const statistiques = useMemo(() => {
    if (role !== "ADMIN") {
      return { collaborateurs: 0, feuillesCompletes: 0, feuillesTotal: 0, heures: 0, heuresSupplementaires: 0 };
    }

    const actifs = new Set(collaborateurs.map((c) => c.id));
    const feuillesActifs = feuilles.filter((f) => actifs.has(f.collaborateur_id));

    return {
      collaborateurs: collaborateurs.length,
      feuillesCompletes: feuillesActifs.filter(estFeuilleComplete).length,
      feuillesTotal: collaborateurs.length,
      heures: feuillesActifs.reduce((t, f) => t + Number(f.total_heures ?? 0), 0),
      heuresSupplementaires: feuillesActifs.reduce((t, f) => t + Number(f.heures_supplementaires ?? 0), 0),
    };
  }, [role, collaborateurs, feuilles]);

  /* =============================================================
     FEUILLES À RELANCER (semaine en cours non transmise)
  ============================================================= */

  const surveillance = useMemo<LigneSurveillance[]>(() => {
    if (role !== "ADMIN") return [];

    return collaborateurs
      .map((collaborateur): LigneSurveillance | null => {
        // semaine EN COURS (mêmes chiffres que la page Feuilles collaborateurs)
        const feuille = feuilles.find((f) => f.collaborateur_id === collaborateur.id && f.semaine_debut === semaineCourante);

        if (!feuille) return { collaborateur, feuille: undefined, etat: "manquante" };
        if (feuille.statut === "A_TRAITER") return null;

        // remplie (toutes les heures) mais pas encore validée / transmise
        return { collaborateur, feuille, etat: estFeuilleComplete(feuille) ? "complete" : "incomplete" };
      })
      .filter((ligne): ligne is LigneSurveillance => ligne !== null);
  }, [role, collaborateurs, feuilles, semaineCourante]);

  const bilanRelance = useMemo<BilanRelance>(() => {
    const ids = new Set(collaborateurs.map((c) => c.id));
    return {
      semaine: `S${numeroSemaine(semaineCourante)}`,
      transmises: feuilles.filter((f) => ids.has(f.collaborateur_id) && f.semaine_debut === semaineCourante && f.statut === "A_TRAITER").length,
      completes: surveillance.filter((l) => l.etat === "complete").length,
      incompletes: surveillance.filter((l) => l.etat === "incomplete").length,
      nonSaisies: surveillance.filter((l) => l.etat === "manquante").length,
    };
  }, [collaborateurs, feuilles, surveillance, semaineCourante]);

  /* =============================================================
     CHARGEMENT / ERREUR
  ============================================================= */

  if (chargement) {
    return (
      <main style={styles.page}>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingSpinner} />
          <p>Chargement du tableau de bord…</p>
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

  if (erreur) {
    return (
      <main style={styles.page}>
        <EnTete role={role} />

        <div style={styles.container}>
          <div style={styles.errorCard}>
            <div style={styles.errorIcon}>!</div>

            <div>
              <div style={styles.errorTitle}>Impossible de charger le tableau de bord</div>
              <div style={styles.errorText}>{erreur}</div>

              <button type="button" style={styles.primaryButton} onClick={() => window.location.reload()}>
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

  const aller = (url: string) => router.push(url);
  const statutMaFeuille = maFeuille ? (estFeuilleComplete(maFeuille) ? "complete" : "incomplete") : "absente";
  const libelleMaFeuille = maFeuille ? `Semaine du ${formaterDateLongue(semaineCourante)}` : "Ma feuille de la semaine courante";

  return (
    <main style={styles.page}>
      <EnTete
        role={role}
        cloche={
          role && role !== "DIRECTION" ? (
            <ClocheNotifications
              admin={role === "ADMIN"}
              nombre={nombreDemandesRH}
              demandes={demandesCloche}
              relances={notifsRelances}
              rappelBilan={rappelBilan}
              onAller={aller}
              onRelanceVue={(n) => void relanceVue(n)}
              onToutVu={() => void toutesRelancesVues()}
            />
          ) : null
        }
      />

      <div className="db-contenu" style={{ ...styles.container, padding: "14px 30px 32px 30px" }}>
        <div style={stylesV2.accueil}>
          <div>
            <h1 style={stylesV2.bonjour}>
              Bonjour {(apercu ? apercu.prenom ?? LIBELLE_ROLE[apercu.role] ?? "" : prenom) || ""}
              {" 👋"}
            </h1>

            <div style={stylesV2.semaine}>
              {semaineCourante ? `Semaine S${numeroSemaine(semaineCourante)} · ${formaterSemaine(semaineCourante)}` : "—"}
            </div>
          </div>

          {/* APERCU_ROLE : le choix de la personne */}
          {role === "ADMIN" && (
            <label style={stylesV2.apercuChoix}>
              <span aria-hidden="true">👁</span>
              <select value={apercu ? voirId ?? "" : ""} onChange={(e) => choisirApercu(e.target.value)} aria-label="Voir le tableau de bord de" style={stylesV2.apercuSelect}>
                <option value="">Voir comme… (mon tableau de bord)</option>
                <optgroup label="Un rôle (tableau de bord type)">
                  <option value="role:DIRECTION">Rôle Direction</option>
                  <option value="role:RESPONSABLE">Rôle Responsable</option>
                  <option value="role:COLLABORATEUR">Rôle Collaborateur</option>
                </optgroup>
                {(["DIRECTION", "ADMIN", "RESPONSABLE", "COLLABORATEUR", "INACTIF"] as const).map((r) => {
                  // le rôle est lu comme partout ailleurs (espaces et majuscules ignorés : lib/droits.ts)
                  const gens = fichesApercu
                    .filter((c) => c.id !== monCollaborateurId && (r === "INACTIF" ? c.actif === false : c.actif !== false && normaliserRole(c.role) === r))
                    .sort((a, b) => (a.trigramme ?? a.nom ?? "").localeCompare(b.trigramme ?? b.nom ?? "", "fr"));
                  if (gens.length === 0) return null;
                  return (
                    <optgroup key={r} label={r === "INACTIF" ? "Fiches inactives" : LIBELLES_ROLE[r]}>
                      {gens.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.trigramme ? `${c.trigramme} — ` : ""}
                          {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                          {r === "INACTIF" ? ` (${LIBELLE_ROLE[normaliserRole(c.role)]})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
          )}

          {role === "ADMIN" && !apercu && (
            <div className="db-chips" style={stylesV2.chips} title={`Feuilles de la semaine du ${formaterDateLongue(semaineCourante)}`}>
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

        {/* APERCU_ROLE : rappel bien visible que l'on regarde le tableau de bord de quelqu'un d'autre */}
        {apercu && (
          <div role="status" style={stylesV2.apercuBandeau}>
            <span>
              👁 <strong>Aperçu</strong> :{" "}
              {apercu.id ? (
                <>
                  le tableau de bord de{" "}
                  <strong>
                    {`${apercu.prenom ?? ""} ${apercu.nom ?? ""}`.trim()}
                    {apercu.trigramme ? ` (${apercu.trigramme})` : ""}
                  </strong>
                  , {(LIBELLE_ROLE[roleVu] ?? roleVu).toLowerCase()}.
                </>
              ) : (
                <>
                  le tableau de bord type du rôle <strong>{LIBELLE_ROLE[roleVu] ?? roleVu}</strong> (sans feuille de route : choisissez une personne pour la voir).
                </>
              )}{" "}
              Les liens s’ouvrent avec vos droits d’administrateur.
            </span>
            <button type="button" onClick={() => choisirApercu("")} style={stylesV2.apercuQuitter}>
              Quitter l’aperçu
            </button>
          </div>
        )}

        {roleVu === "ADMIN" ? (
          <>
            {/* DASHBOARD_4_TUILES : moi, ce qu'il y a à facturer, quatre tuiles, ma feuille de route, le paramétrage */}
            <BandeauMonEspace aller={aller} statut={statutMaFeuille} libelle={libelleMaFeuille} />

            <VignetteFacturation onOuvrir={() => aller("/analyse/facturation")} />

            <TuilesDomaines aller={aller} role="ADMIN" rh={apercu ? undefined : { demandes: nombreDemandesRH, aRelancer: surveillance.length }} />

            {(!apercu || apercu.id) && <FeuilleDeRouteDashboard key={idVu ?? "moi"} collaborateurId={apercu?.id} />}

            {!apercu && <BlocParametrageCompact aller={aller} ouvert={parametrageOuvert} onBasculer={basculerParametrage} />}
          </>
        ) : roleVu === "DIRECTION" ? (
          <BlocDirection aller={aller} />
        ) : peut(roleVu, "piloterBE") ? (
          <>
            {/* RESPONSABLE : mon espace, ses tuiles (Pilotage, RH et Exports selon ses droits), sa feuille de route */}
            <BandeauMonEspace aller={aller} statut={statutMaFeuille} libelle={libelleMaFeuille} />

            <TuilesDomaines aller={aller} role={roleVu} />

            {(!apercu || apercu.id) && <FeuilleDeRouteDashboard key={idVu ?? "moi"} collaborateurId={apercu?.id} />}
          </>
        ) : (
          <>
            <BlocMonEspace aller={aller} statut={statutMaFeuille} libelle={libelleMaFeuille} avecBilanAffaire avecPlanning />

            {(!apercu || apercu.id) && <FeuilleDeRouteDashboard key={idVu ?? "moi"} collaborateurId={apercu?.id} />}
          </>
        )}
      </div>
    </main>
  );
}

/* MOBILE_NIVEAU_2 : tableau de bord sur téléphone */
const CSS_TELEPHONE = `
@media (max-width: 640px) {
  .db-entete { padding: 14px 14px 16px !important; }
  .db-logo { font-size: 24px !important; }
  .db-contenu { padding: 10px 12px 28px !important; }
  .db-chips { flex-wrap: nowrap !important; overflow-x: auto; width: 100%; padding-bottom: 4px; }
  .db-chips > * { flex: 0 0 auto; }
  .db-bandeau > button { flex: 1 1 45%; justify-content: center; min-height: 46px !important; }
  .db-bandeau > span { width: 100%; }
  .db-cloche-panneau { position: fixed !important; left: 8px !important; right: 8px !important; top: 72px !important; width: auto !important; max-width: none !important; }
  .db-cloche-ligne { min-height: 52px; justify-content: center; }
}
`;

/* ===============================================================
   EN-TÊTE ROUGE
================================================================ */

function EnTete({ role, cloche }: { role: string; cloche?: ReactNode }) {
  return (
    <header className="db-entete" style={styles.header}>
      <style>{CSS_TELEPHONE}</style>
      <div style={styles.headerInner}>
        <div>
          <div className="db-logo" style={styles.logo}>POLYNOV</div>
          <div style={styles.headerSubtitle}>Tableau de bord</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {cloche}
          {role && <div style={styles.headerRole}>{role}</div>}
        </div>
      </div>
    </header>
  );
}

/* ===============================================================
   COMPOSANTS DU TABLEAU DE BORD
================================================================ */

type Ton = "neutre" | "alerte" | "ok";

function Pastille({ texte, ton = "neutre" }: { texte: string; ton?: Ton }) {
  return <span style={{ ...stylesV2.pastille, ...stylesV2[`pastille_${ton}`] }}>{texte}</span>;
}

function ChipSuivi({ icone, valeur, label, ton = "neutre" }: { icone: string; valeur: string; label: string; ton?: Ton }) {
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
  extra,
}: {
  icone: string;
  titre: string;
  description: string;
  onClick: () => void;
  badge?: string | null;
  ton?: Ton;
  principale?: boolean;
  /* contenu ajouté sous la description (ex. compteurs de feuilles) */
  extra?: ReactNode;
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
        {extra}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   DASHBOARD_4_TUILES : une tuile = un domaine ; un clic ouvre sa première
   page, et le bandeau de navigation de cette page donne accès au reste
--------------------------------------------------------------- */

function TuileDomaine({
  icone,
  titre,
  description,
  url,
  aller,
  badges,
  raccourcis,
}: {
  icone: string;
  titre: string;
  description: string;
  url: string;
  aller: (url: string) => void;
  badges?: { texte: string; ton: Ton }[];
  /* PILOTAGE_RACCOURCIS : liens directs sous la tuile (sans passer par sa première page) */
  raccourcis?: { libelle: string; url: string }[];
}) {
  const [survol, setSurvol] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={titre}
      onClick={() => aller(url)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          aller(url);
        }
      }}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        ...stylesV2.tuileDomaine,
        boxShadow: survol ? "0 8px 20px rgba(0,0,0,0.14)" : "0 1px 5px rgba(0,0,0,0.08)",
        transform: survol ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      <div style={stylesV2.tuileIcone}>{icone}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#222222" }}>{titre}</div>
      <div style={{ fontSize: 13, color: "#666666", lineHeight: 1.35 }}>{description}</div>
      {badges && badges.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {badges.map((b) => (
            <Pastille key={b.texte} texte={b.texte} ton={b.ton} />
          ))}
        </div>
      )}
      {raccourcis && raccourcis.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "auto", paddingTop: 6 }}>
          {raccourcis.map((r) => (
            <button
              key={r.url}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                aller(r.url);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              style={stylesV2.raccourci}
            >
              {r.libelle} →
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Les tuiles de chaque rôle (DASHBOARD_4_TUILES) :
   ADMIN : Pilotage, RH, Finance, Exports ; DIRECTION : Pilotage, Finance ;
   RESPONSABLE : Pilotage, et RH / Exports selon ses droits */
function TuilesDomaines({
  aller,
  role,
  rh,
}: {
  aller: (url: string) => void;
  role: string;
  /* compteurs RH, pour l'ADMIN seulement */
  rh?: { demandes: number; aRelancer: number };
}) {
  const tuiles: ReactNode[] = [
    <TuileDomaine
      key="pilotage"
      icone="🏗️"
      titre="Pilotage"
      description="Affaires, devis, planning, charge et analyses"
      url="/pilotage"
      aller={aller}
      raccourcis={
        peut(role, "administration")
          ? [
              { libelle: "Planning des affaires", url: "/pilotage/affaires" },
              { libelle: "Relevé PE / PI", url: "/pilotage/prestations" },
            ]
          : undefined
      }
    />,
  ];
  if (peut(role, "voirFeuillesEquipe"))
    tuiles.push(
      <TuileDomaine
        key="rh"
        icone="🧑‍💼"
        titre="RH"
        description={peut(role, "administration") ? "Feuilles d’heures, validations, absences et compteurs, notes de frais" : "Feuilles d’heures des collaborateurs"}
        url="/admin/feuilles"
        aller={aller}
        badges={
          rh
            ? [
                ...(rh.aRelancer > 0 ? [{ texte: `${rh.aRelancer} feuille${rh.aRelancer > 1 ? "s" : ""} à relancer`, ton: "alerte" as Ton }] : [{ texte: "✓ feuilles à jour", ton: "ok" as Ton }]),
                ...(rh.demandes > 0 ? [{ texte: `${rh.demandes} demande${rh.demandes > 1 ? "s" : ""} à valider`, ton: "alerte" as Ton }] : []),
              ]
            : undefined
        }
      />
    );
  if (peut(role, "indicateurs"))
    tuiles.push(
      <TuileDomaine key="finance" icone="💶" titre="Finance" description="CA de l’exercice, attendu, atterrissage face au prévisionnel" url="/analyse/finances" aller={aller} />
    );
  if (peut(role, "bilanRH") || peut(role, "exporterExcel"))
    tuiles.push(
      <TuileDomaine key="exports" icone="📤" titre="Exports" description="Fin de mois : bilan RH, récapitulatif d’heures, facturation" url="/admin/export-excel" aller={aller} />
    );
  return <div style={stylesV2.grilleTuiles}>{tuiles}</div>;
}

/* Direction (Président, adjoint) : consultation seule — ce qu'il y a à facturer, Pilotage et Finance, les disponibilités */
function BlocDirection({ aller }: { aller: (url: string) => void }) {
  return (
    <>
      <VignetteFacturation onOuvrir={() => aller("/analyse/facturation")} />
      <TuilesDomaines aller={aller} role="DIRECTION" />
      <DisponibilitesDirection aller={aller} />
    </>
  );
}

/* les 3 graphiques de disponibilité par activité, sur 12 semaines (même calcul que la page) */
function DisponibilitesDirection({ aller }: { aller: (url: string) => void }) {
  const lundi = useMemo(() => lundiDe(aISO(new Date())), []);
  const { donnees, semaines, chargement, erreur } = useDisponibilitesActivites(lundi, 12);
  return (
    <section aria-label="Disponibilités par activité" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <h2 style={stylesV2.groupeTitre}>🧭 Disponibilités par activité</h2>
        <span style={stylesV2.groupeDescription}>capacité, occupé et disponible sur les 12 semaines à venir</span>
        <button type="button" onClick={() => aller("/analyse/charge-activites")} style={{ ...stylesV2.lienTexte, marginLeft: "auto" }}>
          Le détail →
        </button>
      </div>
      {erreur && <p style={{ color: "#b3261e", margin: 0 }}>{erreur}</p>}
      {chargement && !erreur ? (
        <p style={{ color: "#777777", margin: 0 }}>Chargement des disponibilités…</p>
      ) : (
        !erreur && (
          <GraphiquesDisponibilites
            donnees={donnees}
            semaines={semaines}
            lundiActuel={lundi}
            hauteur={120}
            onBarre={() => aller("/analyse/charge-activites")}
            aide="Cliquez sur une barre pour le détail par personne."
          />
        )
      )}
    </section>
  );
}

const LIBELLES_ROLE: Record<string, string> = {
  DIRECTION: "Direction",
  ADMIN: "Administrateurs",
  RESPONSABLE: "Responsables",
  COLLABORATEUR: "Collaborateurs",
};

const LIBELLE_ROLE: Record<string, string> = {
  DIRECTION: "Direction",
  ADMIN: "Administrateur",
  RESPONSABLE: "Responsable",
  COLLABORATEUR: "Collaborateur",
};

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

/* BILAN_RH_RAPPEL : rappel d'envoi du bilan RH (SQL 95) */
type RappelBilan = { texte: string; detail: string; enRetard: boolean };

/* NOTIF_RELANCES : notifications de relances de devis (SQL 94) */
type NotifRelance = {
  relance_id: string;
  evenement: "AFFECTEE" | "FAITE";
  numero_devis: string;
  quand: string;
  jour: string | null;
  par: string | null;
  reponse: string | null;
  commentaire: string | null;
  designation: string | null;
  client: string | null;
};

function ClocheNotifications({
  admin,
  nombre,
  demandes,
  relances,
  rappelBilan,
  onAller,
  onRelanceVue,
  onToutVu,
}: {
  admin: boolean;
  nombre: number;
  demandes: DemandeCloche[];
  relances: NotifRelance[];
  rappelBilan?: RappelBilan | null;
  onAller: (url: string) => void;
  onRelanceVue: (n: NotifRelance) => void;
  onToutVu: () => void;
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

  const dateFR = (valeur: string | null) => (valeur ? new Date(`${valeur.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR") : "");
  const nombreRH = admin ? nombre : 0;
  const bilan = admin && rappelBilan ? rappelBilan : null;
  const total = nombreRH + relances.length + (bilan ? 1 : 0);
  const resume = [
    bilan ? bilan.texte : "",
    nombreRH > 0 ? `${nombreRH} demande${nombreRH > 1 ? "s" : ""} RH à valider` : "",
    relances.length > 0 ? `${relances.length} relance${relances.length > 1 ? "s" : ""} de devis` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div data-cloche style={stylesV2.clocheZone}>
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        aria-label={total > 0 ? `Notifications : ${resume}` : "Notifications : rien de nouveau"}
        title={total > 0 ? resume : "Rien de nouveau"}
        style={stylesV2.cloche}
      >
        <span aria-hidden="true" style={{ fontSize: 20 }}>🔔</span>
        {total > 0 && <span style={stylesV2.clocheBadge}>{total > 99 ? "99+" : total}</span>}
      </button>

      {ouverte && (
        <div className="db-cloche-panneau" role="dialog" aria-label="Notifications" style={{ ...stylesV2.clochePanneau, maxHeight: "75vh", overflowY: "auto" }}>
          {/* ---------- BILAN_RH_RAPPEL : le bilan RH du mois à envoyer ---------- */}
          {bilan && (
            <div
              className="db-cloche-ligne"
              role="button"
              tabIndex={0}
              title="Ouvrir les feuilles d’heures et le bilan RH"
              onClick={() => {
                setOuverte(false);
                onAller("/admin/feuilles");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setOuverte(false);
                  onAller("/admin/feuilles");
                }
              }}
              style={{ ...stylesV2.clocheLigne, cursor: "pointer", background: bilan.enRetard ? "#fdecec" : "#fff7e6", borderLeft: `4px solid ${bilan.enRetard ? "#b3261e" : "#d99a00"}` }}
            >
              <strong style={{ color: bilan.enRetard ? "#b3261e" : "#7a4b00" }}>📊 {bilan.texte}</strong>
              <span style={{ color: "#666666", fontSize: 12.5 }}>{bilan.detail} · à marquer « envoyé » une fois fait</span>
            </div>
          )}

          {/* ---------- demandes RH à valider (ADMIN) ---------- */}
          {admin && (
            <>
              <div style={stylesV2.clocheTitre}>{nombre > 0 ? `Demandes RH à valider (${nombre})` : "Aucune demande RH en attente ✓"}</div>

              {demandes.map((d) => (
                <div
                  key={d.id}
                  className="db-cloche-ligne"
                  role="button"
                  tabIndex={0}
                  title="Ouvrir cette demande"
                  onClick={() => {
                    setOuverte(false);
                    onAller(`/admin/Valid_RH?demande=${d.id}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setOuverte(false);
                      onAller(`/admin/Valid_RH?demande=${d.id}`);
                    }
                  }}
                  style={{ ...stylesV2.clocheLigne, cursor: "pointer" }}
                >
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
            </>
          )}

          {/* ---------- NOTIF_RELANCES : relances de devis ---------- */}
          <div style={stylesV2.clocheTitre}>{relances.length > 0 ? `Relances de devis (${relances.length})` : "Relances de devis : rien de nouveau ✓"}</div>
          {relances.map((n) => {
            const affectee = n.evenement === "AFFECTEE";
            const ouvrir = () => {
              setOuverte(false);
              onRelanceVue(n);
              onAller(affectee ? "/ma-feuille-de-route" : `/pilotage/devis?devis=${encodeURIComponent(n.numero_devis)}`);
            };
            return (
              <div
                key={`${n.relance_id}-${n.evenement}`}
                className="db-cloche-ligne"
                role="button"
                tabIndex={0}
                title={affectee ? "Ouvrir ma feuille de route (« ✓ faite » une fois le client relancé)" : "Ouvrir le devis et son historique"}
                onClick={ouvrir}
                onKeyDown={(e) => {
                  if (e.key === "Enter") ouvrir();
                }}
                style={{ ...stylesV2.clocheLigne, cursor: "pointer", borderLeft: `4px solid ${affectee ? "#1f4e8c" : "#1b5e20"}` }}
              >
                <strong style={{ color: affectee ? "#1f4e8c" : "#1b5e20" }}>
                  {affectee ? `📞 À relancer : DBE${n.numero_devis}` : `✓ DBE${n.numero_devis} relancé par ${n.par ?? "—"}`}
                </strong>
                {(n.client || n.designation) && <span style={{ color: "#666666", fontSize: 12.5 }}>{[n.client, n.designation].filter(Boolean).join(" · ")}</span>}
                <span style={{ color: "#444444", fontSize: 12.5 }}>
                  {affectee
                    ? `le ${dateFR(n.jour)}, demandé par ${n.par ?? "—"}${n.commentaire ? ` · « ${n.commentaire} »` : ""}`
                    : `le ${dateFR(n.jour)}${n.reponse ? ` · réponse : « ${n.reponse.length > 120 ? `${n.reponse.slice(0, 120)}…` : n.reponse} »` : " · sans réponse notée"}`}
                </span>
              </div>
            );
          })}
          {relances.length > 0 && (
            <button type="button" onClick={onToutVu} style={{ ...stylesV2.clocheBouton, background: "#ffffff", color: "#333333", borderTop: "1px solid #eeeeee" }}>
              Tout marquer comme vu
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BlocMonEspace({
  aller,
  statut,
  libelle,
  avecBilanAffaire,
  avecPlanning = false,
}: {
  aller: (url: string) => void;
  statut: "complete" | "incomplete" | "absente";
  libelle: string;
  avecBilanAffaire: boolean;
  avecPlanning?: boolean;
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
          icone="🗺️"
          titre="Ma feuille de route"
          description="Ce qui est prévu pour moi au planning, semaine par semaine"
          onClick={() => aller("/ma-feuille-de-route")}
        />
        <CarteCompacte
          icone="📄"
          titre="Mes feuilles"
          description="Mes feuilles de temps enregistrées"
          onClick={() => aller("/mes-feuilles")}
        />
        {/* SUIVI_OUVERT : l'avancement des affaires, en heures, pour tous */}
        {avecPlanning && (
          <CarteCompacte icone="🗂️" titre="Suivi des affaires" description="Chiffré, réalisé et planifié de chaque affaire, en heures" onClick={() => aller("/pilotage")} />
        )}
        {avecPlanning && (
          <CarteCompacte
            icone="🗓️"
            titre="Planning des affaires"
            description="Qui travaille sur quoi, semaine par semaine (lecture)"
            onClick={() => aller("/pilotage/affaires")}
          />
        )}
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
        {/* GUIDE_RESPONSABLES : le guide est réservé aux responsables (avecBilanAffaire = faux pour eux) */}
        {!avecBilanAffaire && (
          <CarteCompacte
            icone="📘"
            titre="Guide"
            description="Comment fonctionne l’Espace POLYNOV, pour les responsables"
            onClick={() => aller("/guide")}
          />
        )}
      </div>
    </Groupe>
  );
}

/* Mon espace en bandeau compact : la saisie de sa semaine reste à portée de clic */
function BandeauMonEspace({ aller, statut, libelle }: { aller: (url: string) => void; statut: "complete" | "incomplete" | "absente"; libelle: string }) {
  const bouton: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    padding: "0 14px",
    borderRadius: 999,
    border: "1.5px solid #d5d9de",
    background: "#ffffff",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    color: "#252525",
    cursor: "pointer",
  };
  const ok = statut === "complete";
  return (
    <section className="db-bandeau" aria-label="Mon espace" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "4px 0 14px" }}>
      <span style={{ fontWeight: 800, fontSize: 13, color: "#6b7076", textTransform: "uppercase", letterSpacing: ".4px", marginRight: 4 }}>Mon espace</span>
      <button type="button" title={libelle} onClick={() => aller("/ma-semaine")} style={{ ...bouton, borderColor: ok ? "#9fd4a7" : "#e9b877", background: ok ? "#f2faf3" : "#fff7ea" }}>
        📅 Ma semaine
        <span style={{ fontSize: 12, fontWeight: 800, color: ok ? "#18713b" : "#7a3e00" }}>
          {ok ? "✓ complète" : statut === "incomplete" ? "⚠ à compléter" : "⚠ non saisie"}
        </span>
      </button>
      <button type="button" onClick={() => aller("/mes-feuilles")} style={bouton}>📄 Mes feuilles</button>
      <button type="button" onClick={() => aller("/RH")} style={bouton}>🧑‍💼 Mes demandes RH</button>
      <button type="button" onClick={() => aller("/guide")} style={bouton}>📘 Guide</button>
    </section>
  );
}

/* Paramétrage replié, en liste compacte rangée en trois colonnes */
function BlocParametrageCompact({ aller, ouvert, onBasculer }: { aller: (url: string) => void; ouvert: boolean; onBasculer: () => void }) {
  const colonnes: { titre: string; liens: [string, string, string][] }[] = [
    {
      titre: "Référentiels",
      liens: [
        ["👥", "Collaborateurs", "/admin/collaborateurs"],
        ["🏷️", "Codes d'imputation", "/admin/Gestion-codes"],
        ["🧩", "Activités", "/admin/Gestion-activites"],
        ["🏷️", "Imputations des affaires", "/admin/imputations-pilotage"],
        ["⏰", "Rythmes horaires", "/admin/profils-horaires"],
      ],
    },
    {
      titre: "Données et imports",
      liens: [["🔄", "Synchronisation Suivi d'affaire", "/admin/synchro-suivi-affaires"]],
    },
    {
      titre: "Maintenance",
      liens: [
        ["🩺", "Cohérence", "/admin/coherence"],
        ["💾", "Sauvegarde", "/admin/sauvegarde"],
        ["🧠", "Export IA", "/admin/Export-IA"],
        ["🧹", "Remise à zéro", "/admin/reinitialisation"],
      ],
    },
  ];
  return (
    <Groupe
      titre="⚙️ Paramétrage"
      description="Référentiels, imports, maintenance"
      surClic={onBasculer}
      deplie={ouvert}
      droite={<span style={stylesV2.boutonGroupe}>{ouvert ? "Replier ▴" : "Afficher ▾"}</span>}
    >
      {ouvert && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {colonnes.map((c) => (
            <div key={c.titre} style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7076", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>{c.titre}</div>
              {c.liens.map(([icone, libelle, url]) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => aller(url)}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 38, padding: "0 6px", border: "none", borderRadius: 8, background: "transparent", fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: "#252525", textAlign: "left", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f5f7")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span aria-hidden="true">{icone}</span> {libelle}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Groupe>
  );
}

/* ===============================================================
   UTILITAIRES
================================================================ */

function obtenirLundi(date: Date) {
  const resultat = new Date(date);
  const jour = resultat.getDay();
  resultat.setDate(resultat.getDate() + (jour === 0 ? -6 : 1 - jour));
  resultat.setHours(0, 0, 0, 0);
  return resultat;
}

function formatDateSQL(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formaterSemaine(dateSQL: string) {
  if (!dateSQL) return "";
  const date = new Date(`${dateSQL}T00:00:00`);
  return `${date.getDate()} ${date.toLocaleDateString("fr-FR", { month: "short" })}`;
}

function formaterDateLongue(dateSQL: string) {
  if (!dateSQL) return "";
  return new Date(`${dateSQL}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* Numéro de semaine ISO */
function numeroSemaine(dateSQL: string) {
  if (!dateSQL) return "";
  const date = new Date(`${dateSQL}T00:00:00`);
  const jeudi = new Date(date);
  jeudi.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const debutAnnee = new Date(jeudi.getFullYear(), 0, 1);
  return String(Math.ceil(((jeudi.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7)).padStart(2, "0");
}

function formatHeures(valeur: number | null | undefined) {
  return Number(valeur ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function estFeuilleComplete(feuille: Feuille) {
  const heures = Number(feuille.total_heures ?? 0);
  const theorique = Number(feuille.total_theorique ?? 0);
  // aucune heure attendue (semaine de congés, feuille simplifiée) : rien à compléter
  if (theorique <= 0) return true;
  return heures >= theorique - 0.01;
}

/* ===============================================================
   STYLES
================================================================ */

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#f5f5f5", fontFamily: "Calibri, Arial, sans-serif", color: "#222" },
  header: { background: "#c00000", color: "white", padding: "24px 30px 26px 30px", boxShadow: "0 2px 10px rgba(0,0,0,0.12)" },
  headerInner: { maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 },
  logo: { fontSize: 34, fontWeight: 800, letterSpacing: "-0.5px" },
  headerSubtitle: { marginTop: 4, fontSize: 16, opacity: 0.9 },
  headerRole: { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, padding: "8px 14px", fontSize: 13, fontWeight: 700 },
  container: { maxWidth: 1200, margin: "0 auto", padding: "30px 30px 60px 30px" },
  loadingContainer: { maxWidth: 1200, margin: "0 auto", padding: 40, textAlign: "center", color: "#666" },
  loadingSpinner: { width: 28, height: 28, margin: "0 auto", border: "3px solid #eeeeee", borderTop: "3px solid #c00000", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  errorCard: { background: "white", borderRadius: 12, padding: 25, display: "flex", gap: 18, alignItems: "flex-start", borderLeft: "5px solid #c00000", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" },
  errorIcon: { width: 40, height: 40, borderRadius: "50%", background: "#fdeaea", color: "#c00000", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, flexShrink: 0 },
  errorTitle: { fontWeight: 800, fontSize: 18, marginBottom: 5 },
  errorText: { color: "#666", fontSize: 14, marginBottom: 15 },
  primaryButton: { background: "#c00000", color: "white", border: "none", borderRadius: 7, padding: "9px 15px", fontWeight: 700, cursor: "pointer" },
};

/* ===============================================================
   STYLES DES CARTES ET DES TUILES
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
  grilleTuiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 16 },
  tuileDomaine: { background: "#ffffff", borderRadius: 14, borderTop: "5px solid #c00000", padding: "16px 18px", minHeight: 150, display: "flex", flexDirection: "column", gap: 6, cursor: "pointer", transition: "all 0.15s ease", outline: "none" },
  tuileIcone: { width: 46, height: 46, borderRadius: 12, background: "#c00000", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 2 },
  raccourci: { border: "1.5px solid #e3b7b7", background: "#fff6f6", color: "#a30000", borderRadius: 999, padding: "4px 10px", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" },
  apercuChoix: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 18 },
  apercuSelect: { minHeight: 38, border: "1.5px solid #d5d9de", borderRadius: 8, padding: "0 8px", fontFamily: "inherit", fontSize: 14, fontWeight: 700, background: "#ffffff", maxWidth: 300 },
  apercuBandeau: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#fff4c2", border: "1.5px solid #e5c100", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 14 },
  apercuQuitter: { border: "none", background: "#333333", color: "#ffffff", borderRadius: 8, minHeight: 36, padding: "0 14px", fontWeight: 800, fontSize: 14, fontFamily: "inherit", cursor: "pointer" },
  lienTexte: { border: "none", background: "transparent", fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: "#a30000", cursor: "pointer", padding: 0 },
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
