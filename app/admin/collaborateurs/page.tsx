"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";
import { ROLES, libelleRole, normaliserRole } from "@/lib/droits";

/* ===============================================================
   ADMINISTRATION - COLLABORATEURS

   La FICHE de chaque personne : identité, rôle, rythme horaire. Les droits
   RH (CP, RTT, compteur) se saisissent et se suivent dans la page Suivi RH.
   L'équipe et, à part,
   les ACCÈS DIRECTION : Président, adjoint… en lecture seule (Finances,
   Indicateurs, Charge). Une fiche Direction n'a ni rythme, ni droits RH,
   ni feuille d'heures, et n'entre pas dans les statistiques. Elle est
   INVISIBLE partout ailleurs (la base la masque, SQL 56) : cette page la
   lit et la modifie par polynov_acces_direction / polynov_gerer_direction.
   Une adresse hors @polynov.fr doit être invitée comme « utilisateur
   externe » dans Microsoft Entra pour pouvoir se connecter.
================================================================ */

type Collaborateur = {
  id: string;
  auth_user_id?: string | null;
  prenom: string | null;
  nom: string | null;
  email: string;
  role: string;
  trigramme: string | null;
  profil_horaire_id: string | null;
  rythme?: string | null;
  actif: boolean;
  compteur_recuperation?: number | null;
  inclus_statistiques?: boolean | null;
};

type ProfilHoraire = {
  id: string;
  nom: string;
  lundi: number;
  mardi: number;
  mercredi: number;
  jeudi: number;
  vendredi: number;
  total_hebdomadaire: number | null;
  actif: boolean;
  compteur_recuperation?: number | null;
};

type BaseHoraire = {
  id: string;
  code: string;
  nom: string;
  lundi: number;
  mardi: number;
  mercredi: number;
  jeudi: number;
  vendredi: number;
  actif: boolean;
  compteur_recuperation?: number | null;
};

type DroitsRH = {
  id?: string;
  collaborateur_id: string;
  exercice: number;
  cp_reportes: number;
  cp_acquis: number;
  cp_anciennete: number;
  cp_exceptionnels_avec_justificatif: number;
  cp_exceptionnels_sans_justificatif: number;
  rtt_acquis: number;
  compteur_recuperation_initial: number;
  cp_periode_debut: string | null;
  cp_periode_fin: string | null;
};

type Historique = {
  id: string;
  collaborateur_id: string;
  profil_horaire_id: string;
  date_debut: string;
  date_fin: string | null;
  profil?: ProfilHoraire;
};

/* Fiche Direction : consultation seule, sans rythme ni RH */
const estDirection = (role?: string | null) => normaliserRole(role) === "DIRECTION";
/* Adresse hors domaine POLYNOV : à inviter dans Microsoft Entra */
const estExterne = (email?: string | null) => !/@polynov\.fr$/i.test(String(email ?? "").trim());

export default function CollaborateursPage() {
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [profils, setProfils] = useState<ProfilHoraire[]>([]);
  const [bases, setBases] = useState<BaseHoraire[]>([]);
  const [historique, setHistorique] = useState<Historique[]>([]);

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [modalAjout, setModalAjout] = useState(false);
  const [modalRythme, setModalRythme] = useState(false);
  const [actionDesactivation, setActionDesactivation] = useState<string | null>(null);
  const [actionReactivation, setActionReactivation] = useState<string | null>(null);

  const [collaborateurSelectionne, setCollaborateurSelectionne] =
    useState<Collaborateur | null>(null);

  // Modification d'un collaborateur (identité + rôle)
  const [moiId, setMoiId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<Collaborateur | null>(null);
  const [editForm, setEditForm] = useState({
    prenom: "",
    nom: "",
    trigramme: "",
    role: "COLLABORATEUR",
    inclusStatistiques: true,
  });
  const [editEnCours, setEditEnCours] = useState(false);

  /* PREDOMINANCES : activités dominantes de chacun (Analyse des effectifs). La liste vient de
     « Gestion des activités » : une nouvelle activité y apparaît d'elle-même. */
  const [activitesDispo, setActivitesDispo] = useState<{ id: string; nom: string; actif: boolean }[]>([]);
  const [predominances, setPredominances] = useState<Map<string, string[]>>(new Map());
  const [editPredo, setEditPredo] = useState<Set<string>>(new Set());
  // COMPETENCES_APPOINT : ce que la personne sait aussi faire (Scan…), sans que ce soit sa prédominance
  const [competences, setCompetences] = useState<Map<string, string[]>>(new Map());
  const [editCompet, setEditCompet] = useState<Set<string>>(new Set());

  // Formulaire collaborateur
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [trigramme, setTrigramme] = useState("");
  const [role, setRole] = useState("COLLABORATEUR");
  const [dateEntree, setDateEntree] = useState("");
  const [actionSuppression, setActionSuppression] = useState<string | null>(null);

  const [baseSelectionnee, setBaseSelectionnee] = useState("");
  const [personnalise, setPersonnalise] = useState(false);

  const [lundi, setLundi] = useState("7.5");
  const [mardi, setMardi] = useState("7.5");
  const [mercredi, setMercredi] = useState("7.5");
  const [jeudi, setJeudi] = useState("7.5");
  const [vendredi, setVendredi] = useState("5");

  // Changement de rythme
  const [nouveauProfil, setNouveauProfil] = useState("");
  const [dateDebut, setDateDebut] = useState("");

  useEffect(() => {
    chargerDonnees();
  }, []);

  // Lundi de la semaine contenant la date (format AAAA-MM-JJ)
  function lundiDeLaSemaine(dateISO: string) {
    const d = new Date(`${dateISO}T12:00:00`);
    const jour = d.getDay(); // 0 = dimanche
    d.setDate(d.getDate() + (jour === 0 ? -6 : 1 - jour));

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }


  async function chargerDonnees() {
    setChargement(true);
    setErreur("");

    const [
      collaborateursResult,
      profilsResult,
      basesResult,
      historiqueResult,
      directionResult,
    ] = await Promise.all([
      supabase
        .from("collaborateurs")
        .select("*")
        .order("nom", { ascending: true }),

      supabase
        .from("profils_horaires")
        .select("*")
        .eq("actif", true)
        .order("nom", { ascending: true }),

      supabase
        .from("bases_horaires")
        .select("*")
        .eq("actif", true)
        .order("nom", { ascending: true }),

      supabase
        .from("historique_profils_horaires")
        .select("*")
        .order("date_debut", { ascending: false }),

      // ACCES_DIRECTION_INVISIBLE : les fiches Direction sont masquées partout par la base ;
      // seule cette page les relit, par une fonction réservée aux administrateurs
      supabase.rpc("polynov_acces_direction"),
    ]);

    /* -----------------------------------------------------------
       Accès réservé aux administrateurs
    ----------------------------------------------------------- */

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/login";
      return;
    }

    const moi = (collaborateursResult.data || []).find(
      (c: Collaborateur) => c.auth_user_id === user.id
    );

    if (!moi || normaliserRole(moi.role) !== "ADMIN") {
      window.location.href = "/dashboard";
      return;
    }

    setMoiId(moi.id);

    if (collaborateursResult.error) {
      console.error(collaborateursResult.error);
      setErreur("Impossible de charger les collaborateurs.");
    }

    if (profilsResult.error) {
      console.error(profilsResult.error);
      setErreur("Impossible de charger les profils horaires.");
    }

    if (basesResult.error) {
      console.error(basesResult.error);
      setErreur("Impossible de charger les bases horaires.");
    }


    if (historiqueResult.error) {
      console.error(historiqueResult.error);
      setErreur("Impossible de charger l'historique des rythmes.");
    }

    {
      // l'équipe (lue normalement) + les accès Direction (fonction réservée aux administrateurs)
      const equipeLue = (collaborateursResult.data || []) as Collaborateur[];
      const directionLue = ((directionResult as { data: Collaborateur[] | null }).data || []) as Collaborateur[];
      const ids = new Set(equipeLue.map((c) => c.id));
      setCollaborateurs([...equipeLue, ...directionLue.filter((c) => !ids.has(c.id))]);
    }
    setProfils(profilsResult.data || []);
    setBases(basesResult.data || []);
    setHistorique(historiqueResult.data || []);

    {
      const [actRes, preRes] = await Promise.all([
        supabase.from("activites").select("id,nom,actif,ordre_affichage").order("ordre_affichage", { ascending: true }),
        supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id,niveau"),
      ]);
      setActivitesDispo(((actRes.data ?? []) as { id: string; nom: string; actif: boolean }[]).map((a) => ({ id: a.id, nom: a.nom, actif: a.actif })));
      const m = new Map<string, string[]>();
      const mc = new Map<string, string[]>();
      for (const p of (preRes.data ?? []) as { collaborateur_id: string; activite_id: string; niveau?: string | null }[]) {
        const cible = p.niveau === "COMPETENCE" ? mc : m;
        cible.set(p.collaborateur_id, [...(cible.get(p.collaborateur_id) ?? []), p.activite_id]);
      }
      setPredominances(m);
      setCompetences(mc);
    }

    setChargement(false);
  }

  function appliquerBase(baseId: string) {
    setBaseSelectionnee(baseId);

    const base = bases.find((b) => b.id === baseId);

    if (!base) return;

    setPersonnalise(false);
    setLundi(String(base.lundi));
    setMardi(String(base.mardi));
    setMercredi(String(base.mercredi));
    setJeudi(String(base.jeudi));
    setVendredi(String(base.vendredi));
  }

  function activerPersonnalise() {
    setPersonnalise(true);
    setBaseSelectionnee("");
  }

  function totalHebdomadaire() {
    return (
      Number(lundi || 0) +
      Number(mardi || 0) +
      Number(mercredi || 0) +
      Number(jeudi || 0) +
      Number(vendredi || 0)
    );
  }

  async function ajouterCollaborateur() {
    setErreur("");

    if (!prenom || !nom || !email || !trigramme) {
      setErreur("Veuillez renseigner le prénom, le nom, l'email et le trigramme.");
      return;
    }

    const emailNormalise = email.trim().toLowerCase();
    const trigrammeNormalise = trigramme.trim().toUpperCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalise)) {
      setErreur("L'adresse email n'est pas valide.");
      return;
    }

    if (collaborateurs.some((c) => (c.email || "").trim().toLowerCase() === emailNormalise)) {
      setErreur("Un collaborateur existe déjà avec cette adresse email.");
      return;
    }

    if (collaborateurs.some((c) => (c.trigramme || "").trim().toUpperCase() === trigrammeNormalise)) {
      setErreur("Ce trigramme est déjà utilisé par un autre collaborateur.");
      return;
    }

    /* ---------- Accès Direction : ni rythme, ni droits RH, ni statistiques ---------- */
    if (estDirection(role)) {
      const { error: erreurDirection } = await supabase.from("collaborateurs").insert({
        prenom,
        nom,
        email: emailNormalise,
        trigramme: trigrammeNormalise,
        role: "DIRECTION",
        profil_horaire_id: null,
        date_entree: dateEntree || new Date().toISOString().split("T")[0],
        actif: true,
        inclus_statistiques: false,
      });

      if (erreurDirection) {
        console.error(erreurDirection);
        setErreur(`Impossible de créer l'accès Direction : ${erreurDirection.message}`);
        return;
      }

      fermerModalAjout();
      await chargerDonnees();
      return;
    }

    if (!dateEntree) {
      setErreur("Veuillez renseigner la date d'entrée.");
      return;
    }

    if (!personnalise && !baseSelectionnee) {
      setErreur("Veuillez sélectionner une base horaire.");
      return;
    }

    const nomProfil = personnalise
      ? `Personnalisé - ${prenom} ${nom}`
      : bases.find((b) => b.id === baseSelectionnee)?.nom || "Profil horaire";

const { data: profil, error: erreurProfil } = await supabase
  .from("profils_horaires")
  .insert({
    nom: nomProfil,
    lundi: Number(lundi),
    mardi: Number(mardi),
    mercredi: Number(mercredi),
    jeudi: Number(jeudi),
    vendredi: Number(vendredi),
    // PROFILS_HORAIRES_V2 : colonnes obligatoires explicites
    samedi: 0,
    dimanche: 0,
    forfait: false,
    actif: true,
  })
  .select()
  .single();

    if (erreurProfil || !profil) {
      console.error(erreurProfil);
      setErreur(
        erreurProfil?.message
          ? `Impossible de créer le profil horaire. Cause : ${erreurProfil.message}`
          : "Impossible de créer le profil horaire."
      );
      return;
    }

    const { data: collaborateur, error: erreurCollaborateur } =
      await supabase
        .from("collaborateurs")
        .insert({
          prenom,
          nom,
          email: emailNormalise,
          trigramme: trigrammeNormalise,
          role,
          profil_horaire_id: profil.id,
          date_entree: dateEntree,
          actif: true,
        })
        .select()
        .single();

    if (erreurCollaborateur || !collaborateur) {
      console.error(erreurCollaborateur);

      // On ne laisse pas de profil horaire orphelin.
      await supabase.from("profils_horaires").delete().eq("id", profil.id);

      setErreur("Impossible de créer le collaborateur.");
      return;
    }

    // Création du premier historique : il commence le lundi de la semaine
    // d'entrée pour que la première feuille de temps soit entièrement couverte.
    const premierJour = lundiDeLaSemaine(dateEntree);

    const { error: erreurHistorique } = await supabase
      .from("historique_profils_horaires")
      .insert({
        collaborateur_id: collaborateur.id,
        profil_horaire_id: profil.id,
        date_debut: premierJour,
        date_fin: null,
      });

    if (erreurHistorique) {
      console.error(erreurHistorique);
      setErreur(
        "Collaborateur créé, mais impossible de créer son historique horaire."
      );
      return;
    }

    fermerModalAjout();
    await chargerDonnees();

    // Son espace est activé à sa première connexion Microsoft. On enchaîne sur
    // ses droits RH (congés, RTT, compteur), à saisir dans le Suivi RH.
    window.location.href = `/admin/suivi-rh?collaborateur=${(collaborateur as Collaborateur).id}`;
  }

  async function changerRythme() {
    setErreur("");

    if (!collaborateurSelectionne) {
      setErreur("Aucun collaborateur sélectionné.");
      return;
    }

    if (!nouveauProfil) {
      setErreur("Veuillez sélectionner un profil horaire.");
      return;
    }

    if (!dateDebut) {
      setErreur("Veuillez choisir une date de début.");
      return;
    }

    const profil = profils.find((p) => p.id === nouveauProfil);

    if (!profil) {
      setErreur("Le profil horaire sélectionné est introuvable.");
      return;
    }

    try {
      /*
       * On ne passe plus par une RPC opaque.
       * Le changement de rythme doit être visible immédiatement dans :
       * - collaborateurs.profil_horaire_id
       * - collaborateurs.rythme
       * - historique_profils_horaires
       */

      const { data: historiqueActif, error: erreurHistorique } = await supabase
        .from("historique_profils_horaires")
        .select("id,profil_horaire_id,date_debut,date_fin")
        .eq("collaborateur_id", collaborateurSelectionne.id)
        .is("date_fin", null)
        .order("date_debut", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (erreurHistorique) throw erreurHistorique;

      if (historiqueActif && historiqueActif.date_debut === dateDebut) {
        const { error } = await supabase
          .from("historique_profils_horaires")
          .update({
            profil_horaire_id: nouveauProfil,
            date_fin: null,
          })
          .eq("id", historiqueActif.id);

        if (error) throw error;
      } else {
        if (historiqueActif) {
          const fin = new Date(`${dateDebut}T00:00:00`);
          fin.setDate(fin.getDate() - 1);
          const dateFinHistorique = fin.toISOString().slice(0, 10);

          if (dateFinHistorique < historiqueActif.date_debut) {
            throw new Error("La date de début du nouveau rythme est antérieure au rythme actuel.");
          }

          const { error: erreurFermeture } = await supabase
            .from("historique_profils_horaires")
            .update({ date_fin: dateFinHistorique })
            .eq("id", historiqueActif.id);

          if (erreurFermeture) throw erreurFermeture;
        }

        const { error: erreurInsertion } = await supabase
          .from("historique_profils_horaires")
          .insert({
            collaborateur_id: collaborateurSelectionne.id,
            profil_horaire_id: nouveauProfil,
            date_debut: dateDebut,
            date_fin: null,
          });

        if (erreurInsertion) throw erreurInsertion;
      }

      const { error: erreurCollaborateur } = await supabase
        .from("collaborateurs")
        .update({
          profil_horaire_id: nouveauProfil,
          rythme: profil.nom,
          updated_at: new Date().toISOString(),
        })
        .eq("id", collaborateurSelectionne.id);

      if (erreurCollaborateur) throw erreurCollaborateur;

      fermerModalRythme();
      await chargerDonnees();
    } catch (error: any) {
      console.error(error);
      setErreur(`Impossible de changer le rythme : ${error?.message || "erreur inconnue"}`);
    }
  }

  async function desactiverCollaborateur(c: Collaborateur) {
    if (!c.actif) return;

    if (c.id === moiId) {
      setErreur("Vous ne pouvez pas désactiver votre propre compte.");
      return;
    }

    if (normaliserRole(c.role) === "ADMIN") {
      const autresAdminsActifs = collaborateurs.filter(
        (x) => x.actif && x.id !== c.id && normaliserRole(x.role) === "ADMIN"
      ).length;

      if (autresAdminsActifs === 0) {
        setErreur("Il doit rester au moins un administrateur actif.");
        return;
      }
    }

    const nom = nomCollaborateur(c);
    if (!window.confirm(`Désactiver ${nom} ?\n\nLe collaborateur restera dans l'historique, mais ne sera plus considéré comme actif et ne pourra plus se connecter.`)) {
      return;
    }

    setActionDesactivation(c.id);
    setErreur("");

    const { error } = estDirection(c.role)
      ? await supabase.rpc("polynov_gerer_direction", { p_id: c.id, p_action: "COUPER" })
      : await supabase
          .from("collaborateurs")
          .update({ actif: false, updated_at: new Date().toISOString() })
          .eq("id", c.id);

    if (error) {
      console.error(error);
      setErreur(`Impossible de désactiver ${nom} : ${error.message}`);
      setActionDesactivation(null);
      return;
    }

    setActionDesactivation(null);
    await chargerDonnees();
  }

  async function supprimerCollaborateur(c: Collaborateur) {
    const nomComplet = nomCollaborateur(c);

    if (c.id === moiId) {
      setErreur("Vous ne pouvez pas supprimer votre propre fiche.");
      return;
    }

    if (
      !window.confirm(
        `Supprimer définitivement ${nomComplet} ?\n\nCette action est irréversible. Elle n'est possible que si le collaborateur n'a encore aucune donnée (feuille de temps, historique, demande RH). Dans le cas contraire, désactivez-le pour conserver son historique.`
      )
    ) {
      return;
    }

    setActionSuppression(c.id);
    setErreur("");

    const { error } = estDirection(c.role)
      ? await supabase.rpc("polynov_gerer_direction", { p_id: c.id, p_action: "SUPPRIMER" })
      : await supabase.rpc("supprimer_collaborateur", {
          p_collaborateur_id: c.id,
        });

    setActionSuppression(null);

    if (error) {
      console.error(error);
      setErreur(`Impossible de supprimer ${nomComplet} : ${error.message}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    await chargerDonnees();
  }

  async function reactiverCollaborateur(c: Collaborateur) {
    if (c.actif) return;
    const nom = nomCollaborateur(c);
    if (!window.confirm(`Réactiver ${nom} ?\n\nLe collaborateur réapparaîtra dans la liste des collaborateurs actifs.`)) return;
    setActionReactivation(c.id);
    setErreur("");
    const { error } = estDirection(c.role)
      ? await supabase.rpc("polynov_gerer_direction", { p_id: c.id, p_action: "RETABLIR" })
      : await supabase.from("collaborateurs").update({ actif: true, updated_at: new Date().toISOString() }).eq("id", c.id);
    if (error) {
      console.error(error);
      setErreur(`Impossible de réactiver ${nom} : ${error.message}`);
      setActionReactivation(null);
      return;
    }
    setActionReactivation(null);
    await chargerDonnees();
  }

  function ouvrirEdition(c: Collaborateur) {
    setErreur("");

    setEditForm({
      prenom: c.prenom || "",
      nom: c.nom || "",
      trigramme: c.trigramme || "",
      role: normaliserRole(c.role),
      inclusStatistiques: c.inclus_statistiques !== false,
    });

    setEditPredo(new Set(predominances.get(c.id) ?? []));
    setEditCompet(new Set(competences.get(c.id) ?? []));
    setEditModal(c);
  }

  function fermerEdition() {
    setEditModal(null);
    setErreur("");
  }

  async function enregistrerEdition() {
    if (!editModal) return;

    setErreur("");

    const prenomSaisi = editForm.prenom.trim();
    const nomSaisi = editForm.nom.trim();
    const trigrammeSaisi = editForm.trigramme.trim().toUpperCase();

    if (!prenomSaisi || !nomSaisi || !trigrammeSaisi) {
      setErreur("Le prénom, le nom et le trigramme sont obligatoires.");
      return;
    }

    const trigrammeDejaPris = collaborateurs.some(
      (c) =>
        c.id !== editModal.id &&
        (c.trigramme || "").trim().toUpperCase() === trigrammeSaisi
    );

    if (trigrammeDejaPris) {
      setErreur("Ce trigramme est déjà utilisé par un autre collaborateur.");
      return;
    }

    // Garde-fous : on ne se retire pas son propre rôle ADMIN et il doit
    // toujours rester au moins un administrateur actif.
    const etaitAdmin = normaliserRole(editModal.role) === "ADMIN";

    if (etaitAdmin && editForm.role !== "ADMIN") {
      if (editModal.id === moiId) {
        setErreur("Vous ne pouvez pas retirer votre propre rôle Administrateur.");
        return;
      }

      const autresAdminsActifs = collaborateurs.filter(
        (c) =>
          c.actif &&
          c.id !== editModal.id &&
          normaliserRole(c.role) === "ADMIN"
      ).length;

      if (autresAdminsActifs === 0) {
        setErreur("Il doit rester au moins un administrateur actif.");
        return;
      }
    }

    setEditEnCours(true);

    const { error } = estDirection(editModal.role)
      ? await supabase.rpc("polynov_gerer_direction", {
          p_id: editModal.id,
          p_action: "MODIFIER",
          p_prenom: prenomSaisi,
          p_nom: nomSaisi,
          p_trigramme: trigrammeSaisi,
          p_role: editForm.role,
        })
      : await supabase
      .from("collaborateurs")
      .update({
        prenom: prenomSaisi,
        nom: nomSaisi,
        trigramme: trigrammeSaisi,
        role: editForm.role,
        // une fiche Direction n'entre jamais dans les statistiques de l'équipe
        inclus_statistiques: estDirection(editForm.role) ? false : editForm.inclusStatistiques,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editModal.id);

    setEditEnCours(false);

    if (error) {
      console.error(error);
      setErreur(`Impossible d'enregistrer les modifications : ${error.message}`);
      return;
    }

    // PREDOMINANCES : on remplace la liste de la personne par celle cochée
    if (!estDirection(editForm.role)) {
      const { error: ed } = await supabase.from("collaborateurs_predominances").delete().eq("collaborateur_id", editModal.id);
      if (ed) {
        setErreur(`Fiche enregistrée, mais prédominance non enregistrée : ${ed.message}`);
        return;
      }
      const lignesPredo = [
        ...[...editPredo].map((activite_id) => ({ collaborateur_id: editModal.id, activite_id, niveau: "PRINCIPALE" })),
        ...[...editCompet].filter((a) => !editPredo.has(a)).map((activite_id) => ({ collaborateur_id: editModal.id, activite_id, niveau: "COMPETENCE" })),
      ];
      if (lignesPredo.length > 0) {
        const { error: ei } = await supabase
          .from("collaborateurs_predominances")
          .insert(lignesPredo);
        if (ei) {
          setErreur(`Fiche enregistrée, mais prédominance non enregistrée : ${ei.message}`);
          return;
        }
      }
    }

    setEditModal(null);
    await chargerDonnees();
  }

  function ouvrirAjout(roleInitial: string = "COLLABORATEUR") {
    setErreur("");

    setPrenom("");
    setNom("");
    setEmail("");
    setTrigramme("");
    setRole(roleInitial);
    setDateEntree(new Date().toISOString().split("T")[0]);

    setBaseSelectionnee("");
    setPersonnalise(false);

    setLundi("7.5");
    setMardi("7.5");
    setMercredi("7.5");
    setJeudi("7.5");
    setVendredi("5");

    setModalAjout(true);
  }

  function fermerModalAjout() {
    setModalAjout(false);
  }

  function ouvrirRythme(collaborateur: Collaborateur) {
    setErreur("");
    setCollaborateurSelectionne(collaborateur);

    setNouveauProfil("");

    const aujourdHui = new Date();
    const date = aujourdHui.toISOString().split("T")[0];

    setDateDebut(date);
    setModalRythme(true);
  }

  function fermerModalRythme() {
    setModalRythme(false);
    setCollaborateurSelectionne(null);
  }

  function nomCollaborateur(c: Collaborateur) {
    return `${c.prenom || ""} ${c.nom || ""}`.trim();
  }

  function profilCourant(c: Collaborateur) {
    return profils.find((p) => p.id === c.profil_horaire_id);
  }

  function historiqueCollaborateur(collaborateurId: string) {
    return historique
      .filter((h) => h.collaborateur_id === collaborateurId)
      .sort((a, b) => b.date_debut.localeCompare(a.date_debut));
  }

  function formatDate(date: string | null) {
    if (!date) return "Aujourd'hui";

    return new Date(date + "T00:00:00").toLocaleDateString("fr-FR");
  }

  if (chargement) {
    return (
      <main
        style={{
          padding: 40,
          fontFamily: "Calibri, Arial, sans-serif",
        }}
      >
        Chargement des collaborateurs...
      </main>
    );
  }

  const equipe = collaborateurs.filter((c) => c.actif && !estDirection(c.role));
  const direction = collaborateurs.filter((c) => estDirection(c.role));

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily: "Calibri, Arial, sans-serif",
        color: "#222",
      }}
    >
      {/* EN-TÊTE */}
      <EnTetePage section="Gestion des collaborateurs">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => ouvrirAjout()}
            style={{
              background: "white",
              color: "#c00000",
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            + Nouveau collaborateur
          </button>
          <button
            onClick={() => ouvrirAjout("DIRECTION")}
            style={{
              background: "rgba(255,255,255,.14)",
              color: "white",
              border: "1px solid rgba(255,255,255,.6)",
              borderRadius: 8,
              padding: "9px 16px",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            + Accès Direction
          </button>
        </div>
      </EnTetePage>

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: 32,
        }}
      >
        {erreur && (
          <div
            style={{
              background: "#ffe5e5",
              color: "#a00000",
              border: "1px solid #ffb5b5",
              borderRadius: 6,
              padding: 14,
              marginBottom: 20,
            }}
          >
            {erreur}
          </div>
        )}

        <h1
          style={{
            marginTop: 0,
            marginBottom: 24,
            fontSize: 28,
          }}
        >
          Collaborateurs
        </h1>

        {equipe.length === 0 && collaborateurs.filter(c => !c.actif).length === 0 ? (
          <div style={{background:"white",borderRadius:10,padding:40,textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
            <div style={{fontSize:20,fontWeight:700}}>Aucun collaborateur</div>
            <div style={{marginTop:8,color:"#777"}}>Crée ton premier collaborateur pour commencer.</div>
          </div>
        ) : (
          <>
            <div style={{display:"grid",gap:16}}>
              {equipe.map((c) => {
                const profil = profilCourant(c);
                const historiqueC = historiqueCollaborateur(c.id);
                return (
                <div
                  key={c.id}
                  style={{
                    background: "white",
                    borderRadius: 10,
                    padding: 22,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 20,
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 21,
                            fontWeight: 700,
                          }}
                        >
                          {nomCollaborateur(c)}
                        </span>

                        <span
                          style={{
                            background: "#eee",
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          {c.trigramme || "—"}
                        </span>

                        {normaliserRole(c.role) !== "COLLABORATEUR" && (
                          <span
                            style={{
                              background:
                                normaliserRole(c.role) === "ADMIN"
                                  ? "#c00000"
                                  : "#1f4e79",
                              color: "white",
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            {libelleRole(c.role)}
                          </span>
                        )}

                        {(predominances.get(c.id) ?? []).map((id) => {
                          const a = activitesDispo.find((x) => x.id === id);
                          return a ? (
                            <span key={id} title="Prédominance" style={{ background: "#eef4fb", color: "#1f4e79", border: "1px solid #c9d9ec", padding: "3px 8px", borderRadius: 4, fontSize: 13, fontWeight: 700 }}>
                              {a.nom}
                            </span>
                          ) : null;
                        })}

                        {(competences.get(c.id) ?? []).map((id) => {
                          const a = activitesDispo.find((x) => x.id === id);
                          return a ? (
                            <span key={`c-${id}`} title="Sait aussi faire, en appoint" style={{ background: "#f3f4f6", color: "#5b6168", border: "1px dashed #b9bec5", padding: "3px 8px", borderRadius: 4, fontSize: 13, fontWeight: 700 }}>
                              + {a.nom}
                            </span>
                          ) : null;
                        })}

                        {c.inclus_statistiques === false && (
                          <span
                            title="Exclu des statistiques de productivité de l'équipe"
                            style={{
                              background: "#6b6b6b",
                              color: "white",
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            Encadrement
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          color: "#777",
                          marginTop: 5,
                        }}
                      >
                        {c.email}
                      </div>
                    </div>

                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button
                      onClick={() => ouvrirEdition(c)}
                      style={{border:"1px solid #333",color:"#333",background:"white",borderRadius:6,padding:"9px 14px",cursor:"pointer",fontWeight:700}}
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => { window.location.href = `/admin/suivi-rh?collaborateur=${c.id}`; }}
                      title="Congés, RTT et compteur : dans le Suivi RH"
                      style={{border:"1px solid #333",color:"#333",background:"white",borderRadius:6,padding:"9px 14px",cursor:"pointer",fontWeight:700}}
                    >
                      Suivi RH →
                    </button>
                    <button
                      onClick={() => ouvrirRythme(c)}
                      style={{
                        border: "1px solid #c00000",
                        color: "#c00000",
                        background: "white",
                        borderRadius: 6,
                        padding: "9px 14px",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Changer le rythme
                    </button>
                    {c.actif && (
                      <button
                        onClick={() => desactiverCollaborateur(c)}
                        disabled={actionDesactivation === c.id}
                        style={{
                          border: "1px solid #999",
                          color: "#555",
                          background: "white",
                          borderRadius: 6,
                          padding: "9px 14px",
                          cursor: actionDesactivation === c.id ? "wait" : "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {actionDesactivation === c.id ? "Désactivation…" : "Désactiver"}
                      </button>
                    )}
                    {c.id !== moiId && (
                      <button
                        onClick={() => supprimerCollaborateur(c)}
                        disabled={actionSuppression === c.id}
                        style={{
                          border: "1px solid #c00000",
                          color: "white",
                          background: "#c00000",
                          borderRadius: 6,
                          padding: "9px 14px",
                          cursor: actionSuppression === c.id ? "wait" : "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {actionSuppression === c.id ? "Suppression…" : "Supprimer"}
                      </button>
                    )}
                    {!c.actif && (
                      <span style={{ padding: "9px 14px", borderRadius: 6, background: "#eee", color: "#666", fontWeight: 700 }}>
                        Collaborateur désactivé
                      </span>
                    )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 20,
                      padding: 16,
                      background: "#fafafa",
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: "#777",
                        textTransform: "uppercase",
                        marginBottom: 6,
                      }}
                    >
                      Rythme actuel
                    </div>

                    {profil ? (
                      <>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 17,
                          }}
                        >
                          {profil.nom}
                        </div>

                        <div
                          style={{
                            marginTop: 8,
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          {[
                            ["Lun", profil.lundi],
                            ["Mar", profil.mardi],
                            ["Mer", profil.mercredi],
                            ["Jeu", profil.jeudi],
                            ["Ven", profil.vendredi],
                          ].map(([jour, valeur]) => (
                            <span
                              key={String(jour)}
                              style={{
                                background: "white",
                                border: "1px solid #ddd",
                                borderRadius: 5,
                                padding: "5px 9px",
                                fontSize: 13,
                              }}
                            >
                              <strong>{jour}</strong>{" "}
                              {Number(valeur).toFixed(2).replace(".", ",")} h
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ color: "#a00000" }}>
                        Aucun profil horaire affecté.
                      </div>
                    )}
                  </div>

                  {historiqueC.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          marginBottom: 8,
                        }}
                      >
                        Historique des rythmes
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        {historiqueC.map((h) => {
                          const p = profils.find(
                            (profil) => profil.id === h.profil_horaire_id
                          );

                          return (
                            <div
                              key={h.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                borderTop: "1px solid #eee",
                                padding: "9px 0",
                                fontSize: 14,
                              }}
                            >
                              <strong>{p?.nom || "Profil supprimé"}</strong>

                              <span style={{ color: "#666" }}>
                                {formatDate(h.date_debut)} →{" "}
                                {formatDate(h.date_fin)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
              })}
            </div>

            {collaborateurs.some(c => !c.actif && !estDirection(c.role)) && (
              <details style={{marginTop:24,background:"white",border:"1px solid #ddd",borderRadius:12,boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}>
                <summary style={{cursor:"pointer",padding:"16px 20px",fontWeight:800,fontSize:17,listStyle:"none"}}>📁 Inactifs ({collaborateurs.filter(c => !c.actif && !estDirection(c.role)).length})</summary>
                <div style={{padding:"0 20px 20px",display:"grid",gap:10}}>
                  {collaborateurs.filter(c => !c.actif && !estDirection(c.role)).map(c => (
                    <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:15,padding:14,borderTop:"1px solid #eee",background:"#fafafa",borderRadius:8}}>
                      <div><strong>{nomCollaborateur(c)}</strong> <span style={{color:"#777",marginLeft:8}}>{c.trigramme || "—"}</span><div style={{fontSize:13,color:"#777",marginTop:3}}>{c.email}</div></div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={()=>ouvrirEdition(c)} style={{border:"1px solid #333",color:"#333",background:"white",borderRadius:6,padding:"8px 12px",cursor:"pointer",fontWeight:700}}>Modifier</button>
                        <button onClick={()=>reactiverCollaborateur(c)} disabled={actionReactivation===c.id} style={{border:"1px solid #198754",color:"#198754",background:"white",borderRadius:6,padding:"8px 12px",cursor:actionReactivation===c.id?"wait":"pointer",fontWeight:700}}>{actionReactivation===c.id?"Réactivation…":"Réactiver"}</button>
                        <button onClick={()=>supprimerCollaborateur(c)} disabled={actionSuppression===c.id} style={{border:"1px solid #c00000",color:"white",background:"#c00000",borderRadius:6,padding:"8px 12px",cursor:actionSuppression===c.id?"wait":"pointer",fontWeight:700}}>{actionSuppression===c.id?"Suppression…":"Supprimer"}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {/* ---------- ACCÈS DIRECTION ---------- */}
        <section style={{ marginTop: 32, background: "white", borderRadius: 10, padding: 22, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", borderLeft: "5px solid #5b3e96" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22 }}>Accès Direction</h2>
              <div style={{ color: "#666", fontSize: 14, marginTop: 4 }}>
                Consultation seule : Finances, Indicateurs commerciaux, Charge &amp; pointage, Charge par ressource, planning. Ni feuille d’heures,
                ni droits RH, ni rythme.
              </div>
            </div>
            <button onClick={() => ouvrirAjout("DIRECTION")} style={primaryButtonStyle}>
              + Accès Direction
            </button>
          </div>

          {direction.length === 0 ? (
            <div style={{ marginTop: 14, color: "#777" }}>Aucun accès Direction pour l’instant.</div>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              {direction.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 15, padding: 14, border: "1px solid #eee", borderRadius: 8, background: c.actif ? "#fff" : "#f3f3f3" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 18 }}>{nomCollaborateur(c)}</strong>
                      <span style={{ background: "#eee", padding: "2px 7px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>{c.trigramme || "—"}</span>
                      <span style={{ background: "#5b3e96", color: "white", padding: "2px 7px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>Direction</span>
                      {estExterne(c.email) && (
                        <span title="Adresse hors @polynov.fr : à inviter comme utilisateur externe dans Microsoft Entra" style={{ background: "#fff4e5", color: "#7a3e00", border: "1px solid #e9b877", padding: "2px 7px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                          Externe
                        </span>
                      )}
                      {!c.actif && <span style={{ background: "#999", color: "white", padding: "2px 7px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>Accès coupé</span>}
                      {c.actif && !c.auth_user_id && (
                        <span title="La personne ne s'est encore jamais connectée" style={{ color: "#777", fontSize: 12 }}>
                          · jamais connecté
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "#777", marginTop: 3 }}>{c.email}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => ouvrirEdition(c)} style={{ border: "1px solid #333", color: "#333", background: "white", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>
                      Modifier
                    </button>
                    {c.actif ? (
                      <button onClick={() => desactiverCollaborateur(c)} disabled={actionDesactivation === c.id} style={{ border: "1px solid #999", color: "#555", background: "white", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>
                        {actionDesactivation === c.id ? "…" : "Couper l’accès"}
                      </button>
                    ) : (
                      <button onClick={() => reactiverCollaborateur(c)} disabled={actionReactivation === c.id} style={{ border: "1px solid #198754", color: "#198754", background: "white", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>
                        {actionReactivation === c.id ? "…" : "Rétablir l’accès"}
                      </button>
                    )}
                    <button onClick={() => supprimerCollaborateur(c)} disabled={actionSuppression === c.id} style={{ border: "1px solid #c00000", color: "white", background: "#c00000", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>
                      {actionSuppression === c.id ? "…" : "Supprimer"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 14, padding: 12, background: "#f6f3fb", borderRadius: 7, fontSize: 13, color: "#3d2b66", lineHeight: 1.5 }}>
            <strong>Adresse hors @polynov.fr :</strong> invitez d’abord la personne dans <strong>Microsoft Entra</strong> (Utilisateurs → Nouvel
            utilisateur → Inviter un utilisateur externe), avec la même adresse. Elle se connecte ensuite par le bouton Microsoft ; si elle n’a pas
            de compte Microsoft, un code lui est envoyé par e-mail. Supprimer l’invité dans Entra coupe aussi son accès.
          </div>
        </section>
      </div>

      {/* MODAL MODIFICATION */}
      {editModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ marginTop: 0 }}>
              Modifier — {nomCollaborateur(editModal)}
            </h2>

            <div style={gridStyle}>
              <Champ
                label="Prénom"
                value={editForm.prenom}
                onChange={(v) => setEditForm((f) => ({ ...f, prenom: v }))}
              />

              <Champ
                label="Nom"
                value={editForm.nom}
                onChange={(v) => setEditForm((f) => ({ ...f, nom: v }))}
              />

              <Champ
                label="Trigramme"
                value={editForm.trigramme}
                onChange={(v) =>
                  setEditForm((f) => ({ ...f, trigramme: v.toUpperCase() }))
                }
              />

              <div>
                <label style={labelStyle}>Email</label>
                <input
                  value={editModal.email}
                  disabled
                  style={{ ...inputStyle, background: "#f3f3f3", color: "#777" }}
                />
              </div>
            </div>

            <label style={labelStyle}>Rôle</label>

            <select
              value={editForm.role}
              onChange={(e) =>
                setEditForm((f) => ({
                  ...f,
                  role: e.target.value,
                  inclusStatistiques: estDirection(e.target.value) ? false : f.inclusStatistiques,
                }))
              }
              style={inputStyle}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            {!estDirection(editForm.role) && activitesDispo.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Prédominance : son activité principale (une, parfois deux)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {activitesDispo
                    .filter((a) => a.actif || editPredo.has(a.id))
                    .map((a) => {
                      const coche = editPredo.has(a.id);
                      return (
                        <label
                          key={a.id}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 6, cursor: "pointer", border: `1.5px solid ${coche ? "#1f4e79" : "#ccc"}`, background: coche ? "#eef4fb" : "white", fontSize: 14, fontWeight: 700 }}
                        >
                          <input
                            type="checkbox"
                            checked={coche}
                            onChange={(e) =>
                              setEditPredo((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(a.id);
                                else n.delete(a.id);
                                return n;
                              })
                            }
                          />
                          {a.nom}
                        </label>
                      );
                    })}
                </div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                  Sert à l’Analyse des effectifs. La liste suit « Gestion des activités ».
                </div>

                <label style={{ ...labelStyle, marginTop: 12 }}>Sait aussi faire, en appoint (facultatif)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {activitesDispo
                    .filter((a) => (a.actif || editCompet.has(a.id)) && !editPredo.has(a.id))
                    .map((a) => {
                      const coche = editCompet.has(a.id);
                      return (
                        <label
                          key={a.id}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 6, cursor: "pointer", border: `1.5px dashed ${coche ? "#5b6168" : "#ccc"}`, background: coche ? "#f3f4f6" : "white", fontSize: 14, fontWeight: 700 }}
                        >
                          <input
                            type="checkbox"
                            checked={coche}
                            onChange={(e) =>
                              setEditCompet((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(a.id);
                                else n.delete(a.id);
                                return n;
                              })
                            }
                          />
                          {a.nom}
                        </label>
                      );
                    })}
                </div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                  Ce qu’il sait faire sans que ce soit son métier principal (le Scan, par exemple) : affiché à part, ne compte pas dans la composition.
                </div>
              </div>
            )}

            {!estDirection(editForm.role) && (
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginTop: 16,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={editForm.inclusStatistiques}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    inclusStatistiques: e.target.checked,
                  }))
                }
                style={{ marginTop: 3 }}
              />

              <span>
                <strong>Inclus dans les statistiques de productivité</strong>
                <br />
                <span style={{ fontSize: 13, color: "#666" }}>
                  À décocher pour l'encadrement : ses heures sont alors
                  présentées à part dans Bilans (bloc « Encadrement ») et ne
                  comptent ni dans la capacité ni dans les taux de l'équipe.
                </span>
              </span>
            </label>
            )}

            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "#f6f6f6",
                borderRadius: 7,
                fontSize: 13,
                color: "#555",
              }}
            >
              {estDirection(editForm.role)
                ? "Direction (lecture seule) : Finances, Indicateurs commerciaux, Charge & pointage, Charge par ressource et planning, en consultation. Pas de feuille d'heures ni de droits RH ; exclu des statistiques."
                : "Responsable (niveau 1) : suivi des feuilles en consultation, bilan RH mensuel et export Excel. Le changement s'applique à la prochaine ouverture de page du collaborateur."}
            </div>

            {erreur && (
              <div style={{ marginTop: 12, color: "#c00000", fontWeight: 700 }}>
                {erreur}
              </div>
            )}

            <div style={buttonRowStyle}>
              <button onClick={fermerEdition} style={secondaryButtonStyle}>
                Annuler
              </button>

              <button
                onClick={enregistrerEdition}
                disabled={editEnCours}
                style={primaryButtonStyle}
              >
                {editEnCours ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AJOUT */}
      {modalAjout && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ marginTop: 0 }}>{estDirection(role) ? "Nouvel accès Direction" : "Nouveau collaborateur"}</h2>

            <div style={gridStyle}>
              <Champ
                label="Prénom"
                value={prenom}
                onChange={setPrenom}
              />

              <Champ
                label="Nom"
                value={nom}
                onChange={setNom}
              />

              <Champ
                label="Trigramme"
                value={trigramme}
                onChange={(v) => setTrigramme(v.toUpperCase())}
              />

              <Champ
                label="Email"
                value={email}
                onChange={setEmail}
                type="email"
              />

              {!estDirection(role) && (
                <Champ
                  label="Date d'entrée"
                  value={dateEntree}
                  onChange={setDateEntree}
                  type="date"
                />
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 13, color: "#666", lineHeight: 1.45 }}>
              {estDirection(role) ? (
                <>
                  L’adresse est celle avec laquelle la personne se connectera par le bouton Microsoft.
                  {email && estExterne(email) && (
                    <span style={{ display: "block", marginTop: 6, color: "#7a3e00", fontWeight: 700 }}>
                      Adresse hors @polynov.fr : invitez-la aussi comme utilisateur externe dans Microsoft Entra, avec cette même adresse.
                    </span>
                  )}
                </>
              ) : (
                <>
                  L'adresse email doit être celle du compte Microsoft 365 avec lequel
                  la personne se connectera. Son espace (feuilles de temps, espace RH)
                  est activé automatiquement à sa première connexion.
                </>
              )}
            </div>

            <label style={labelStyle}>Rôle</label>

            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={inputStyle}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            {estDirection(role) ? (
              <div style={{ marginTop: 16, padding: 14, background: "#f6f3fb", borderRadius: 8, fontSize: 14, color: "#3d2b66", lineHeight: 1.5 }}>
                <strong>Consultation seule.</strong> Pas de base horaire, pas de feuille d’heures, pas de droits RH : la fiche n’entre dans aucune
                statistique ni dans la charge de l’équipe.
              </div>
            ) : (
            <>
            <label style={labelStyle}>Base horaire</label>

            <select
              value={personnalise ? "PERSONNALISE" : baseSelectionnee}
              onChange={(e) => {
                if (e.target.value === "PERSONNALISE") {
                  activerPersonnalise();
                } else {
                  appliquerBase(e.target.value);
                }
              }}
              style={inputStyle}
            >
              <option value="">Sélectionner une base...</option>

              {bases.map((base) => (
                <option key={base.id} value={base.id}>
                  {base.code} — {base.nom}
                </option>
              ))}

              <option value="PERSONNALISE">
                Personnalisé
              </option>
            </select>

            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f7f7f7",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                Rythme hebdomadaire
              </div>

              <div style={weekGridStyle}>
                <HeureInput label="Lundi" value={lundi} onChange={setLundi} />
                <HeureInput label="Mardi" value={mardi} onChange={setMardi} />
                <HeureInput
                  label="Mercredi"
                  value={mercredi}
                  onChange={setMercredi}
                />
                <HeureInput
                  label="Jeudi"
                  value={jeudi}
                  onChange={setJeudi}
                />
                <HeureInput
                  label="Vendredi"
                  value={vendredi}
                  onChange={setVendredi}
                />
              </div>

              <div
                style={{
                  marginTop: 14,
                  fontWeight: 700,
                }}
              >
                Total : {totalHebdomadaire().toFixed(2).replace(".", ",")} h
              </div>
            </div>
            </>
            )}

            {erreur && (
              <div style={{ marginTop: 12, color: "#c00000", fontWeight: 700 }}>
                {erreur}
              </div>
            )}

            <div style={buttonRowStyle}>
              <button
                onClick={fermerModalAjout}
                style={secondaryButtonStyle}
              >
                Annuler
              </button>

              <button
                onClick={ajouterCollaborateur}
                style={primaryButtonStyle}
              >
                {estDirection(role) ? "Créer l’accès Direction" : "Créer le collaborateur"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CHANGEMENT RYTHME */}
      {modalRythme && collaborateurSelectionne && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ marginTop: 0 }}>Changer le rythme</h2>

            <div
              style={{
                marginBottom: 20,
                color: "#666",
              }}
            >
              {nomCollaborateur(collaborateurSelectionne)}{" "}
              <strong>({collaborateurSelectionne.trigramme})</strong>
            </div>

            <label style={labelStyle}>Nouveau rythme</label>

            <select
              value={nouveauProfil}
              onChange={(e) => setNouveauProfil(e.target.value)}
              style={inputStyle}
            >
              <option value="">Sélectionner un profil...</option>

              {profils.map((profil) => (
                <option key={profil.id} value={profil.id}>
                  {profil.nom}
                </option>
              ))}
            </select>

            <label style={labelStyle}>
              Applicable à partir du
            </label>

            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              style={inputStyle}
            />

            {nouveauProfil && (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: "#f7f7f7",
                  borderRadius: 8,
                }}
              >
                {(() => {
                  const profil = profils.find(
                    (p) => p.id === nouveauProfil
                  );

                  if (!profil) return null;

                  return (
                    <>
                      <div
                        style={{
                          fontWeight: 700,
                          marginBottom: 10,
                        }}
                      >
                        {profil.nom}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {[
                          ["Lun", profil.lundi],
                          ["Mar", profil.mardi],
                          ["Mer", profil.mercredi],
                          ["Jeu", profil.jeudi],
                          ["Ven", profil.vendredi],
                        ].map(([jour, valeur]) => (
                          <span
                            key={String(jour)}
                            style={{
                              background: "white",
                              border: "1px solid #ddd",
                              borderRadius: 5,
                              padding: "5px 9px",
                            }}
                          >
                            <strong>{jour}</strong>{" "}
                            {Number(valeur)
                              .toFixed(2)
                              .replace(".", ",")} h
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {dateDebut && (
              <div
                style={{
                  marginTop: 15,
                  padding: 12,
                  background: "#fff8e1",
                  border: "1px solid #f0d98c",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                Le rythme actuel sera automatiquement arrêté la veille
                du <strong>{formatDate(dateDebut)}</strong>.
                <br />
                Si cette date tombe en milieu de semaine, les deux
                rythmes pourront coexister dans la même semaine.
              </div>
            )}

            <div style={buttonRowStyle}>
              <button
                onClick={fermerModalRythme}
                style={secondaryButtonStyle}
              >
                Annuler
              </button>

              <button
                onClick={changerRythme}
                style={primaryButtonStyle}
              >
                Enregistrer le changement
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Champ({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>

      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function HeureInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "#666",
          marginBottom: 5,
        }}
      >
        {label}
      </label>

      <input
        type="number"
        step="0.25"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputStyle,
          marginTop: 0,
        }}
      />
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  padding: 28,
  width: "100%",
  maxWidth: 720,
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginTop: 15,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 11px",
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "white",
  fontSize: 14,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "0 16px",
};

const weekGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: 8,
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 24,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#c00000",
  color: "white",
  border: "none",
  borderRadius: 6,
  padding: "10px 16px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "white",
  color: "#444",
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: "10px 16px",
  cursor: "pointer",
};
