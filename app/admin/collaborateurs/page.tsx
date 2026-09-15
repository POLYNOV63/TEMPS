"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/* ============================================================
   TYPES
============================================================ */

type JourKey =
  | "lundi"
  | "mardi"
  | "mercredi"
  | "jeudi"
  | "vendredi"
  | "samedi"
  | "dimanche";

type ProfilHoraire = {
  id: string;
  nom: string;
  lundi: number;
  mardi: number;
  mercredi: number;
  jeudi: number;
  vendredi: number;
  samedi: number;
  dimanche: number;
  total_hebdomadaire: number | null;
  forfait: boolean;
  actif: boolean;
};

type Historique = {
  id: string;
  collaborateur_id: string;
  profil_horaire_id: string;
  date_debut: string;
  date_fin: string | null;
  profil?: ProfilHoraire | null;
};

type Collaborateur = {
  id: string;
  auth_user_id: string | null;
  prenom: string | null;
  nom: string | null;
  email: string;
  role: string;
  profil_horaire_id: string | null;
  actif: boolean;
  created_at: string;
  updated_at: string;
  trigramme: string | null;
  compteur_recuperation?: number | null;
  profil?: ProfilHoraire | null;
  historique?: Historique[];
  date_entree: string | null;
  date_sortie: string | null;
};

/* ============================================================
   CONSTANTES
============================================================ */

const JOURS: {
  key: JourKey;
  label: string;
  court: string;
}[] = [
  { key: "lundi", label: "Lundi", court: "Lun." },
  { key: "mardi", label: "Mardi", court: "Mar." },
  { key: "mercredi", label: "Mercredi", court: "Mer." },
  { key: "jeudi", label: "Jeudi", court: "Jeu." },
  { key: "vendredi", label: "Vendredi", court: "Ven." },
  { key: "samedi", label: "Samedi", court: "Sam." },
  { key: "dimanche", label: "Dimanche", court: "Dim." },
];

const RYTHMES_AUTORISES = [
  "POLYNOV ETAM/Cadre",
  "POLYNOV Cadre forfait",
  "BIB PE",
  "BIB PI",
  "Personnalisé",
];

/* ============================================================
   HELPERS
============================================================ */

function formatHeures(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: string | null | undefined) {
  if (!date) return "—";

  const [annee, mois, jour] = date.split("-");

  if (!annee || !mois || !jour) return date;

  return `${jour}/${mois}/${annee}`;
}

function dateInputToday() {
  const d = new Date();

  const annee = d.getFullYear();
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");

  return `${annee}-${mois}-${jour}`;
}

function ajouterUnJour(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function retirerUnJour(date: string) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normaliserTexte(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function genererEmail(prenom: string, nom: string) {
  const p = normaliserTexte(prenom).replace(/[^a-z0-9-]/g, "");
  const n = normaliserTexte(nom).replace(/[^a-z0-9-]/g, "");

  if (!p || !n) return "";

  const morceauxPrenom = p.split("-").filter(Boolean);

  let initiales = morceauxPrenom
    .map((morceau) => morceau.charAt(0))
    .join("");

  if (!initiales) {
    initiales = p.charAt(0);
  }

  return `${initiales}${n.replace(/-/g, "")}@polynov.fr`;
}

function estPersonnalise(nom: string | null | undefined) {
  if (!nom) return false;

  return (
    nom === "Personnalisé" ||
    nom.startsWith("Personnalisé -")
  );
}

function estRythmeAutorise(nom: string) {
  return (
    RYTHMES_AUTORISES.includes(nom) ||
    nom.startsWith("Personnalisé -")
  );
}

function nomAfficheProfil(
  profil: ProfilHoraire | null | undefined
) {
  if (!profil) return "Aucun rythme";

  if (estPersonnalise(profil.nom)) {
    return "Personnalisé";
  }

  return profil.nom;
}

function totalHeuresProfil(
  profil:
    | ProfilHoraire
    | Record<JourKey, number>
    | null
    | undefined
) {
  if (!profil) return 0;

  return JOURS.reduce((total, jour) => {
    return total + Number(profil[jour.key] || 0);
  }, 0);
}

function trouverRythmeActuel(
  historique: Historique[] | undefined
) {
  if (!historique?.length) return null;

  const aujourdHui = dateInputToday();

  return (
    historique.find(
      (item) =>
        item.date_debut <= aujourdHui &&
        (!item.date_fin ||
          item.date_fin >= aujourdHui)
    ) ?? null
  );
}

function trouverProchainRythme(
  historique: Historique[] | undefined
) {
  if (!historique?.length) return null;

  const aujourdHui = dateInputToday();

  return (
    historique
      .filter(
        (item) => item.date_debut > aujourdHui
      )
      .sort((a, b) =>
        a.date_debut.localeCompare(b.date_debut)
      )[0] ?? null
  );
}

/* ============================================================
   COMPOSANT PRINCIPAL
============================================================ */

export default function CollaborateursPage() {
  const router = useRouter();

  /* ----------------------------------------------------------
     DONNÉES
  ---------------------------------------------------------- */

  const [collaborateurs, setCollaborateurs] = useState<
    Collaborateur[]
  >([]);

  const [profils, setProfils] = useState<
    ProfilHoraire[]
  >([]);

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  /* ----------------------------------------------------------
     RECHERCHE
  ---------------------------------------------------------- */

  const [recherche, setRecherche] = useState("");

  /* ----------------------------------------------------------
     MODALE COLLABORATEUR
  ---------------------------------------------------------- */

  const [formOuvert, setFormOuvert] = useState(false);
  const [editionOuverte, setEditionOuverte] = useState(false);

  const [
    collaborateurSelectionne,
    setCollaborateurSelectionne,
  ] = useState<Collaborateur | null>(null);

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [emailManuel, setEmailManuel] = useState(false);

  const [trigramme, setTrigramme] = useState("");
  const [role, setRole] = useState("COLLABORATEUR");

  const [compteurRecuperation, setCompteurRecuperation] =
    useState("0");

  const [profilSelectionne, setProfilSelectionne] =
    useState("");

  const [dateDebut, setDateDebut] =
    useState(dateInputToday());

  const [dateEntree, setDateEntree] =
    useState(dateInputToday());

  const [dateSortie, setDateSortie] = useState("");

  const [horaires, setHoraires] =
    useState<Record<JourKey, number>>({
      lundi: 7.5,
      mardi: 7.5,
      mercredi: 7.5,
      jeudi: 7.5,
      vendredi: 5,
      samedi: 0,
      dimanche: 0,
    });

  /* ----------------------------------------------------------
     MODALE RYTHME
  ---------------------------------------------------------- */

  const [rythmeOuvert, setRythmeOuvert] =
    useState(false);

  const [nouveauProfil, setNouveauProfil] =
    useState("");

  const [nouvelleDateDebut, setNouvelleDateDebut] =
    useState(dateInputToday());

  const [nouveauxHoraires, setNouveauxHoraires] =
    useState<Record<JourKey, number>>({
      lundi: 7.5,
      mardi: 7.5,
      mercredi: 7.5,
      jeudi: 7.5,
      vendredi: 5,
      samedi: 0,
      dimanche: 0,
    });

  /* ----------------------------------------------------------
     CHARGEMENT
  ---------------------------------------------------------- */

  async function chargerDonnees() {
    setChargement(true);
    setErreur("");

    const [
      collaborateursResult,
      profilsResult,
      historiqueResult,
    ] = await Promise.all([
      supabase
        .from("collaborateurs")
        .select("*")
        .order("actif", { ascending: false })
        .order("nom", { ascending: true }),

      // IMPORTANT :
      // On charge TOUS les profils pour que l'historique
      // continue de fonctionner même si un ancien profil
      // est devenu inactif.
      supabase
        .from("profils_horaires")
        .select("*")
        .order("nom", { ascending: true }),

      supabase
        .from("historique_profils_horaires")
        .select("*")
        .order("date_debut", {
          ascending: false,
        }),
    ]);

    if (collaborateursResult.error) {
      console.error(
        collaborateursResult.error
      );
      setErreur(
        "Impossible de charger les collaborateurs."
      );
      setChargement(false);
      return;
    }

    if (profilsResult.error) {
      console.error(profilsResult.error);
      setErreur(
        "Impossible de charger les rythmes horaires."
      );
      setChargement(false);
      return;
    }

    if (historiqueResult.error) {
      console.error(
        historiqueResult.error
      );
      setErreur(
        "Impossible de charger l'historique des rythmes."
      );
      setChargement(false);
      return;
    }

    const profilsData =
      (profilsResult.data ?? []) as ProfilHoraire[];

    const historiquesData =
      (historiqueResult.data ??
        []) as Historique[];

    const profilsMap = new Map<
      string,
      ProfilHoraire
    >();

    profilsData.forEach((profil) => {
      profilsMap.set(profil.id, profil);
    });

    const historiqueParCollaborateur =
      new Map<string, Historique[]>();

    historiquesData.forEach((item) => {
      const liste =
        historiqueParCollaborateur.get(
          item.collaborateur_id
        ) ?? [];

      liste.push({
        ...item,
        profil:
          profilsMap.get(
            item.profil_horaire_id
          ) ?? null,
      });

      historiqueParCollaborateur.set(
        item.collaborateur_id,
        liste
      );
    });

    const collaborateursData =
      (collaborateursResult.data ??
        []) as Collaborateur[];

    const enrichis =
      collaborateursData.map((collab) => {
        const historique =
          historiqueParCollaborateur.get(
            collab.id
          ) ?? [];

        historique.sort((a, b) =>
          b.date_debut.localeCompare(
            a.date_debut
          )
        );

        const rythmeActuel =
          trouverRythmeActuel(
            historique
          );

        return {
          ...collab,
          historique,
          profil:
            rythmeActuel?.profil ??
            profilsMap.get(
              collab.profil_horaire_id ?? ""
            ) ??
            null,
        };
      });

    setProfils(profilsData);
    setCollaborateurs(enrichis);
    setChargement(false);
  }

  useEffect(() => {
    chargerDonnees();
  }, []);

  /* ----------------------------------------------------------
     EMAIL AUTOMATIQUE
  ---------------------------------------------------------- */

  useEffect(() => {
    if (
      !editionOuverte &&
      !emailManuel
    ) {
      setEmail(
        genererEmail(prenom, nom)
      );
    }
  }, [
    prenom,
    nom,
    editionOuverte,
    emailManuel,
  ]);

  /* ----------------------------------------------------------
     PROFILS DISPONIBLES
  ---------------------------------------------------------- */

  const profilsDisponibles = useMemo(
    () =>
      profils.filter(
        (profil) =>
          profil.actif &&
          estRythmeAutorise(
            profil.nom
          )
      ),
    [profils]
  );

  const profilsSelection = useMemo(
    () => {
      const standards =
        profilsDisponibles.filter(
          (profil) =>
            !estPersonnalise(
              profil.nom
            )
        );

      const personnalise =
        profilsDisponibles.find(
          (profil) =>
            profil.nom ===
            "Personnalisé"
        );

      return personnalise
        ? [...standards, personnalise]
        : standards;
    },
    [profilsDisponibles]
  );

  const profilFormulaire =
    profils.find(
      (profil) =>
        profil.id ===
        profilSelectionne
    ) ?? null;

  const formulairePersonnalise =
    profilFormulaire
      ? estPersonnalise(
          profilFormulaire.nom
        )
      : false;

  const nouveauProfilObjet =
    profils.find(
      (profil) =>
        profil.id ===
        nouveauProfil
    ) ?? null;

  const nouveauProfilPersonnalise =
    nouveauProfilObjet
      ? estPersonnalise(
          nouveauProfilObjet.nom
        )
      : false;

  /* ----------------------------------------------------------
     RESET FORMULAIRE
  ---------------------------------------------------------- */

  function resetFormulaire() {
    setPrenom("");
    setNom("");
    setEmail("");
    setEmailManuel(false);
    setTrigramme("");
    setRole("COLLABORATEUR");
    setCompteurRecuperation("0");

    setProfilSelectionne("");

    setDateDebut(
      dateInputToday()
    );

    setDateEntree(
      dateInputToday()
    );

    setDateSortie("");

    setHoraires({
      lundi: 7.5,
      mardi: 7.5,
      mercredi: 7.5,
      jeudi: 7.5,
      vendredi: 5,
      samedi: 0,
      dimanche: 0,
    });

    setEditionOuverte(false);
    setCollaborateurSelectionne(null);
  }

  function ouvrirNouveauCollaborateur() {
    resetFormulaire();
    setFormOuvert(true);
  }

  /* ----------------------------------------------------------
     SÉLECTION PROFIL
  ---------------------------------------------------------- */

  function selectionnerProfil(id: string) {
    setProfilSelectionne(id);

    const profil = profils.find(
      (item) => item.id === id
    );

    if (!profil) return;

    setHoraires({
      lundi: Number(profil.lundi || 0),
      mardi: Number(profil.mardi || 0),
      mercredi: Number(
        profil.mercredi || 0
      ),
      jeudi: Number(
        profil.jeudi || 0
      ),
      vendredi: Number(
        profil.vendredi || 0
      ),
      samedi: Number(
        profil.samedi || 0
      ),
      dimanche: Number(
        profil.dimanche || 0
      ),
    });
  }

  /* ----------------------------------------------------------
     CRÉATION PROFIL PERSONNALISÉ
  ---------------------------------------------------------- */

  function genererNomInternePersonnalise(
    trig: string,
    date: string
  ) {
    const suffixe =
      date.replace(/-/g, "");

    return `Personnalisé - ${trig.toUpperCase()} - ${suffixe} - ${Date.now()}`;
  }

  /* ----------------------------------------------------------
     AJOUT COLLABORATEUR
  ---------------------------------------------------------- */

  async function ajouterCollaborateur() {
    setErreur("");

    const prenomPropre =
      prenom.trim();

    const nomPropre =
      nom.trim();

    const trigPropre =
      trigramme
        .trim()
        .toUpperCase();

    const emailPropre =
      email
        .trim()
        .toLowerCase();

    if (!prenomPropre) {
      setErreur(
        "Le prénom est obligatoire."
      );
      return;
    }

    if (!nomPropre) {
      setErreur(
        "Le nom est obligatoire."
      );
      return;
    }

    if (!/^[A-Z0-9]{3}$/.test(
      trigPropre
    )) {
      setErreur(
        "Le trigramme doit comporter exactement 3 caractères."
      );
      return;
    }

    if (!emailPropre) {
      setErreur(
        "L'adresse e-mail est obligatoire."
      );
      return;
    }

    if (!profilSelectionne) {
      setErreur(
        "Sélectionnez un rythme horaire."
      );
      return;
    }

    if (!dateDebut) {
      setErreur(
        "La date de début du rythme est obligatoire."
      );
      return;
    }

    /* Vérification trigramme */

    const { data: trigrammeExistant } =
      await supabase
        .from("collaborateurs")
        .select("id")
        .eq(
          "trigramme",
          trigPropre
        )
        .maybeSingle();

    if (trigrammeExistant) {
      setErreur(
        `Le trigramme ${trigPropre} est déjà utilisé.`
      );
      return;
    }

    /* Profil */

    let profilId =
      profilSelectionne;

    if (
      formulairePersonnalise
    ) {
      const { data, error } =
        await supabase
          .from("profils_horaires")
          .insert({
            nom:
              genererNomInternePersonnalise(
                trigPropre,
                dateDebut
              ),
            lundi:
              horaires.lundi,
            mardi:
              horaires.mardi,
            mercredi:
              horaires.mercredi,
            jeudi:
              horaires.jeudi,
            vendredi:
              horaires.vendredi,
            samedi:
              horaires.samedi,
            dimanche:
              horaires.dimanche,
            total_hebdomadaire:
              totalHeuresProfil(
                horaires
              ),
            forfait: false,
            actif: true,
          })
          .select()
          .single();

      if (error || !data) {
        console.error(error);
        setErreur(
          "Impossible de créer le rythme personnalisé."
        );
        return;
      }

      profilId = data.id;
    }

    /* Collaborateur */

    const dateDebutEstAujourdhuiOuAvant =
      dateDebut <=
      dateInputToday();

    const { data: collaborateur, error } =
      await supabase
        .from("collaborateurs")
        .insert({
          prenom: prenomPropre,
          nom: nomPropre,
          email: emailPropre,
          trigramme: trigPropre,
          role,
          date_entree:
            dateEntree || null,
          date_sortie:
            dateSortie || null,
          profil_horaire_id:
            dateDebutEstAujourdhuiOuAvant
              ? profilId
              : null,
          compteur_recuperation:
            Number(
              compteurRecuperation || 0
            ),
          actif: true,
        })
        .select()
        .single();

    if (error || !collaborateur) {
      console.error(error);
      setErreur(
        "Impossible de créer le collaborateur."
      );
      return;
    }

    /* Historique */

    const { error: historiqueError } =
      await supabase
        .from(
          "historique_profils_horaires"
        )
        .insert({
          collaborateur_id:
            collaborateur.id,
          profil_horaire_id:
            profilId,
          date_debut:
            dateDebut,
          date_fin: null,
        });

    if (historiqueError) {
      console.error(
        historiqueError
      );

      // On évite de laisser un collaborateur
      // sans historique exploitable.
      await supabase
        .from("collaborateurs")
        .delete()
        .eq(
          "id",
          collaborateur.id
        );

      setErreur(
        "Le collaborateur n'a pas pu être finalisé : impossible de créer son historique de rythme."
      );
      return;
    }

    resetFormulaire();
    setFormOuvert(false);

    await chargerDonnees();
  }

  /* ----------------------------------------------------------
     MODIFICATION
  ---------------------------------------------------------- */

  async function modifierCollaborateur() {
    if (
      !collaborateurSelectionne
    )
      return;

    setErreur("");

    const trigPropre =
      trigramme
        .trim()
        .toUpperCase();

    if (!/^[A-Z0-9]{3}$/.test(
      trigPropre
    )) {
      setErreur(
        "Le trigramme doit comporter exactement 3 caractères."
      );
      return;
    }

    const { error } =
      await supabase
        .from("collaborateurs")
        .update({
          prenom: prenom.trim(),
          nom: nom.trim(),
          email: email
            .trim()
            .toLowerCase(),
          trigramme: trigPropre,
          role,
          date_entree:
            dateEntree || null,
          date_sortie:
            dateSortie || null,
          compteur_recuperation:
            Number(
              compteurRecuperation ||
                0
            ),
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          collaborateurSelectionne.id
        );

    if (error) {
      console.error(error);
      setErreur(
        "Impossible de modifier le collaborateur."
      );
      return;
    }

    setFormOuvert(false);
    setEditionOuverte(false);
    setCollaborateurSelectionne(
      null
    );

    await chargerDonnees();
  }

  /* ----------------------------------------------------------
     OUVRIR MODIFICATION
  ---------------------------------------------------------- */

  function ouvrirEditionCollaborateur(
    collaborateur: Collaborateur
  ) {
    setCollaborateurSelectionne(
      collaborateur
    );

    setPrenom(
      collaborateur.prenom ?? ""
    );

    setNom(
      collaborateur.nom ?? ""
    );

    setEmail(
      collaborateur.email ?? ""
    );

    setEmailManuel(true);

    setTrigramme(
      collaborateur.trigramme ??
        ""
    );

    setRole(
      collaborateur.role ??
        "COLLABORATEUR"
    );

    setCompteurRecuperation(
      String(
        collaborateur.compteur_recuperation ??
          0
      )
    );

    setDateEntree(
      collaborateur.date_entree ??
        ""
    );

    setDateSortie(
      collaborateur.date_sortie ??
        ""
    );

    setEditionOuverte(true);
    setFormOuvert(true);
  }

  /* ----------------------------------------------------------
     ACTIVER / DÉSACTIVER
  ---------------------------------------------------------- */

  async function changerEtatCollaborateur(
    collaborateur: Collaborateur
  ) {
    const nouvelEtat =
      !collaborateur.actif;

    const action =
      nouvelEtat
        ? "réactiver"
        : "désactiver";

    const confirme =
      window.confirm(
        `Voulez-vous vraiment ${action} ${collaborateur.prenom} ${collaborateur.nom} ?`
      );

    if (!confirme) return;

    const { error } =
      await supabase
        .from("collaborateurs")
        .update({
          actif: nouvelEtat,
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          collaborateur.id
        );

    if (error) {
      console.error(error);
      setErreur(
        "Impossible de modifier l'état du collaborateur."
      );
      return;
    }

    await chargerDonnees();
  }

  /* ----------------------------------------------------------
     PROGRAMMATION RYTHME
  ---------------------------------------------------------- */

  function ouvrirProgrammation(
    collaborateur: Collaborateur
  ) {
    setCollaborateurSelectionne(
      collaborateur
    );

    setNouveauProfil("");

    setNouvelleDateDebut(
      dateInputToday()
    );

    setNouveauxHoraires({
      lundi: 7.5,
      mardi: 7.5,
      mercredi: 7.5,
      jeudi: 7.5,
      vendredi: 5,
      samedi: 0,
      dimanche: 0,
    });

    setRythmeOuvert(true);
  }

  function selectionnerNouveauProfil(
    id: string
  ) {
    setNouveauProfil(id);

    const profil = profils.find(
      (item) => item.id === id
    );

    if (!profil) return;

    setNouveauxHoraires({
      lundi: Number(
        profil.lundi || 0
      ),
      mardi: Number(
        profil.mardi || 0
      ),
      mercredi: Number(
        profil.mercredi || 0
      ),
      jeudi: Number(
        profil.jeudi || 0
      ),
      vendredi: Number(
        profil.vendredi || 0
      ),
      samedi: Number(
        profil.samedi || 0
      ),
      dimanche: Number(
        profil.dimanche || 0
      ),
    });
  }

  /* ----------------------------------------------------------
     PROGRAMMER NOUVEAU RYTHME
  ---------------------------------------------------------- */

  async function programmerNouveauRythme() {
    if (
      !collaborateurSelectionne
    )
      return;

    setErreur("");

    if (!nouveauProfil) {
      setErreur(
        "Sélectionnez un rythme."
      );
      return;
    }

    if (!nouvelleDateDebut) {
      setErreur(
        "Sélectionnez une date de début."
      );
      return;
    }

    const historique = [
      ...(collaborateurSelectionne.historique ??
        []),
    ].sort((a, b) =>
      a.date_debut.localeCompare(
        b.date_debut
      )
    );

    /*
     * Si une programmation existe exactement
     * à cette date, on la remplace.
     */

    const periodeMemeDate =
      historique.find(
        (item) =>
          item.date_debut ===
          nouvelleDateDebut
      );

    let profilId =
      nouveauProfil;

    /*
     * Création du profil personnalisé
     */

    if (
      nouveauProfilPersonnalise
    ) {
      const { data, error } =
        await supabase
          .from("profils_horaires")
          .insert({
            nom:
              genererNomInternePersonnalise(
                collaborateurSelectionne.trigramme ??
                  "XXX",
                nouvelleDateDebut
              ),
            lundi:
              nouveauxHoraires.lundi,
            mardi:
              nouveauxHoraires.mardi,
            mercredi:
              nouveauxHoraires.mercredi,
            jeudi:
              nouveauxHoraires.jeudi,
            vendredi:
              nouveauxHoraires.vendredi,
            samedi:
              nouveauxHoraires.samedi,
            dimanche:
              nouveauxHoraires.dimanche,
            total_hebdomadaire:
              totalHeuresProfil(
                nouveauxHoraires
              ),
            forfait: false,
            actif: true,
          })
          .select()
          .single();

      if (error || !data) {
        console.error(error);
        setErreur(
          "Impossible de créer le rythme personnalisé."
        );
        return;
      }

      profilId = data.id;
    }

    /*
     * CAS 1 :
     * même date => on remplace le profil
     */

    if (periodeMemeDate) {
      const { error } =
        await supabase
          .from(
            "historique_profils_horaires"
          )
          .update({
            profil_horaire_id:
              profilId,
          })
          .eq(
            "id",
            periodeMemeDate.id
          );

      if (error) {
        console.error(error);
        setErreur(
          "Impossible de modifier la programmation existante."
        );
        return;
      }
    } else {
      /*
       * CAS 2 :
       * insertion dans l'historique
       */

      const periodeAvant =
        [...historique]
          .reverse()
          .find(
            (item) =>
              item.date_debut <
              nouvelleDateDebut
          );

      const periodeApres =
        historique.find(
          (item) =>
            item.date_debut >
            nouvelleDateDebut
        );

      /*
       * On ferme la période précédente.
       */

      if (periodeAvant) {
        const nouvelleFin =
          retirerUnJour(
            nouvelleDateDebut
          );

        const { error } =
          await supabase
            .from(
              "historique_profils_horaires"
            )
            .update({
              date_fin:
                nouvelleFin,
            })
            .eq(
              "id",
              periodeAvant.id
            );

        if (error) {
          console.error(error);
          setErreur(
            "Impossible de clôturer l'ancien rythme."
          );
          return;
        }
      }

      /*
       * Nouvelle période.
       */

      const nouvelleFin =
        periodeApres
          ? retirerUnJour(
              periodeApres.date_debut
            )
          : null;

      const { error } =
        await supabase
          .from(
            "historique_profils_horaires"
          )
          .insert({
            collaborateur_id:
              collaborateurSelectionne.id,
            profil_horaire_id:
              profilId,
            date_debut:
              nouvelleDateDebut,
            date_fin:
              nouvelleFin,
          });

      if (error) {
        console.error(error);
        setErreur(
          "Impossible de programmer le nouveau rythme."
        );
        return;
      }
    }

    /*
     * Le profil courant du collaborateur
     * doit correspondre au rythme actuel.
     */

    if (
      nouvelleDateDebut <=
      dateInputToday()
    ) {
      await supabase
        .from("collaborateurs")
        .update({
          profil_horaire_id:
            profilId,
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          collaborateurSelectionne.id
        );
    }

    setRythmeOuvert(false);
    setCollaborateurSelectionne(
      null
    );

    await chargerDonnees();
  }

  /* ----------------------------------------------------------
     SUPPRESSION PROGRAMMATION
  ---------------------------------------------------------- */

  async function supprimerProgrammation(
    historique: Historique
  ) {
    if (
      !collaborateurSelectionne
    )
      return;

    const confirme =
      window.confirm(
        `Supprimer la programmation du ${formatDate(
          historique.date_debut
        )} ?`
      );

    if (!confirme) return;

    const liste = [
      ...(collaborateurSelectionne.historique ??
        []),
    ].sort((a, b) =>
      a.date_debut.localeCompare(
        b.date_debut
      )
    );

    const index =
      liste.findIndex(
        (item) =>
          item.id === historique.id
      );

    if (index === -1) return;

    const precedent =
      index > 0
        ? liste[index - 1]
        : null;

    const suivant =
      index <
      liste.length - 1
        ? liste[index + 1]
        : null;

    /*
     * Si on supprime une période au milieu,
     * la précédente récupère la date de fin
     * de la suivante.
     */

    if (
      precedent &&
      suivant
    ) {
      const { error } =
        await supabase
          .from(
            "historique_profils_horaires"
          )
          .update({
            date_fin:
              suivant.date_fin,
          })
          .eq(
            "id",
            precedent.id
          );

      if (error) {
        console.error(error);
        setErreur(
          "Impossible de reconstruire l'historique."
        );
        return;
      }
    }

    /*
     * Si on supprime le premier élément,
     * la période suivante devient la première.
     */

    const { error } =
      await supabase
        .from(
          "historique_profils_horaires"
        )
        .delete()
        .eq(
          "id",
          historique.id
        );

    if (error) {
      console.error(error);
      setErreur(
        "Impossible de supprimer la programmation."
      );
      return;
    }

    /*
     * Recharger permet également de recalculer
     * automatiquement le profil courant.
     */

    await chargerDonnees();

    const { data: nouveauCollab } =
      await supabase
        .from("collaborateurs")
        .select("*")
        .eq(
          "id",
          collaborateurSelectionne.id
        )
        .single();

    if (
      nouveauCollab
    ) {
      const collabMisAJour =
        collaborateurs.find(
          (item) =>
            item.id ===
            nouveauCollab.id
        );

      if (collabMisAJour) {
        setCollaborateurSelectionne(
          collabMisAJour
        );
      }
    }
  }

  /* ----------------------------------------------------------
     FILTRES
  ---------------------------------------------------------- */

  const termeRecherche =
    normaliserTexte(recherche);

  function filtrer(
    liste: Collaborateur[]
  ) {
    if (!termeRecherche) {
      return liste;
    }

    return liste.filter(
      (collab) => {
        const texte =
          normaliserTexte(
            [
              collab.prenom,
              collab.nom,
              collab.trigramme,
              collab.email,
            ]
              .filter(Boolean)
              .join(" ")
          );

        return texte.includes(
          termeRecherche
        );
      }
    );
  }

  const actifs = collaborateurs.filter(
    (c) => c.actif
  );

  const inactifs =
    collaborateurs.filter(
      (c) => !c.actif
    );

  const actifsFiltres =
    filtrer(actifs);

  const inactifsFiltres =
    filtrer(inactifs);

  const rythmesProgrammes =
    actifs.filter((collab) =>
      (collab.historique ?? []).some(
        (item) =>
          item.date_debut >
          dateInputToday()
      )
    ).length;

  /* ----------------------------------------------------------
     RENDU
  ---------------------------------------------------------- */

  return (
    <main style={pageStyle}>
      {/* ======================================================
          HEADER
      ====================================================== */}

      <header style={headerStyle}>
        <div>
          <div style={brandStyle}>
            POLYNOV
          </div>

          <h1 style={titleStyle}>
            Gestion des collaborateurs
          </h1>

          <div style={subtitleStyle}>
            Collaborateurs, rythmes horaires
            et historique
          </div>
        </div>

        <div style={headerActionsStyle}>
          <button
            onClick={() =>
              router.push("/dashboard")
            }
            style={buttonSecondary}
          >
            🏠 Tableau de bord
          </button>

          <button
            onClick={
              ouvrirNouveauCollaborateur
            }
            style={buttonPrimary}
          >
            ＋ Nouveau collaborateur
          </button>
        </div>
      </header>

      {/* ======================================================
          ERREUR
      ====================================================== */}

      {erreur && (
        <div style={errorBoxStyle}>
          <strong>Attention</strong>
          <span>{erreur}</span>

          <button
            onClick={() =>
              setErreur("")
            }
            style={errorCloseStyle}
          >
            ×
          </button>
        </div>
      )}

      {/* ======================================================
          KPIs
      ====================================================== */}

      <section style={kpiGridStyle}>
        <KpiCard
          label="Collaborateurs actifs"
          value={actifs.length}
          icon="👥"
          accent="#c00000"
        />

        <KpiCard
          label="Collaborateurs inactifs"
          value={inactifs.length}
          icon="📁"
          accent="#777"
        />

        <KpiCard
          label="Rythmes programmés"
          value={rythmesProgrammes}
          icon="🗓️"
          accent="#e08a00"
        />

        <KpiCard
          label="Effectif total"
          value={
            collaborateurs.length
          }
          icon="📊"
          accent="#333"
        />
      </section>

      {/* ======================================================
          RECHERCHE
      ====================================================== */}

      <section style={searchCardStyle}>
        <div style={searchIconStyle}>
          🔎
        </div>

        <input
          value={recherche}
          onChange={(e) =>
            setRecherche(
              e.target.value
            )
          }
          placeholder="Rechercher un collaborateur, un trigramme ou une adresse e-mail..."
          style={searchInputStyle}
        />

        {recherche && (
          <button
            onClick={() =>
              setRecherche("")
            }
            style={searchClearStyle}
          >
            ×
          </button>
        )}
      </section>

      {/* ======================================================
          CHARGEMENT
      ====================================================== */}

      {chargement ? (
        <div style={loadingStyle}>
          <div style={spinnerStyle}>
            ⟳
          </div>

          Chargement des collaborateurs...
        </div>
      ) : (
        <>
          {/* ==================================================
              ACTIFS
          ================================================== */}

          <section style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <div style={sectionTitleStyle}>
                  Collaborateurs actifs
                </div>

                <div style={sectionSubtitleStyle}>
                  {actifsFiltres.length}{" "}
                  collaborateur
                  {actifsFiltres.length >
                  1
                    ? "s"
                    : ""}
                  {recherche
                    ? " trouvé(s)"
                    : ""}
                </div>
              </div>

              <div style={sectionBadgeStyle}>
                {actifs.length}
              </div>
            </div>

            {actifsFiltres.length ===
            0 ? (
              <EmptyState
                icon="👤"
                text={
                  recherche
                    ? "Aucun collaborateur ne correspond à la recherche."
                    : "Aucun collaborateur actif."
                }
              />
            ) : (
              <div
                style={
                  tableWrapperStyle
                }
              >
                <table
                  style={tableStyle}
                >
                  <thead>
                    <tr>
                      <th
                        style={
                          thStyle
                        }
                      >
                        Collaborateur
                      </th>

                      <th
                        style={
                          thStyle
                        }
                      >
                        Rythme actuel
                      </th>

                      <th
                        style={
                          thStyle
                        }
                      >
                        Semaine
                      </th>

                      <th
                        style={
                          thStyle
                        }
                      >
                        Prochaine évolution
                      </th>

                      <th
                        style={{
                          ...thStyle,
                          textAlign:
                            "right",
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {actifsFiltres.map(
                      (collab) => {
                        const actuel =
                          trouverRythmeActuel(
                            collab.historique
                          );

                        const futur =
                          trouverProchainRythme(
                            collab.historique
                          );

                        const total =
                          actuel?.profil
                            ? totalHeuresProfil(
                                actuel.profil
                              )
                            : 0;

                        return (
                          <tr
                            key={
                              collab.id
                            }
                            style={
                              tableRowStyle
                            }
                          >
                            <td
                              style={
                                tdStyle
                              }
                            >
                              <div
                                style={
                                  collaboratorCellStyle
                                }
                              >
                                <div
                                  style={
                                    trigrammeStyle
                                  }
                                >
                                  {collab.trigramme ||
                                    "—"}
                                </div>

                                <div>
                                  <div
                                    style={
                                      collaboratorNameStyle
                                    }
                                  >
                                    {
                                      collab.prenom
                                    }{" "}
                                    {
                                      collab.nom
                                    }
                                  </div>

                                  <div
                                    style={
                                      collaboratorEmailStyle
                                    }
                                  >
                                    {
                                      collab.email
                                    }
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              <div
                                style={
                                  rhythmNameStyle
                                }
                              >
                                {nomAfficheProfil(
                                  actuel?.profil
                                )}
                              </div>

                              {actuel?.profil && (
                                <div
                                  style={
                                    rhythmDetailsStyle
                                  }
                                >
                                  {JOURS.slice(
                                    0,
                                    5
                                  ).map(
                                    (
                                      jour
                                    ) => (
                                      <span
                                        key={
                                          jour.key
                                        }
                                      >
                                        {
                                          jour.court
                                        }{" "}
                                        {formatHeures(
                                          actuel
                                            .profil?.[
                                            jour.key
                                          ]
                                        )}
                                      </span>
                                    )
                                  )}
                                </div>
                              )}
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              <span
                                style={
                                  hoursBadgeStyle
                                }
                              >
                                {formatHeures(
                                  total
                                )}{" "}
                                h
                              </span>
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {futur ? (
                                <div
                                  style={
                                    futureRhythmStyle
                                  }
                                >
                                  <div
                                    style={
                                      futureBadgeStyle
                                    }
                                  >
                                    PROGRAMMÉ
                                  </div>

                                  <strong>
                                    {nomAfficheProfil(
                                      futur.profil
                                    )}
                                  </strong>

                                  <div>
                                    à partir du{" "}
                                    {formatDate(
                                      futur.date_debut
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span
                                  style={{
                                    color:
                                      "#aaa",
                                    fontSize:
                                      13,
                                  }}
                                >
                                  Aucun changement
                                  programmé
                                </span>
                              )}
                            </td>

                            <td
                              style={{
                                ...tdStyle,
                                textAlign:
                                  "right",
                              }}
                            >
                              <div
                                style={
                                  actionsStyle
                                }
                              >
                                <button
                                  onClick={() =>
                                    ouvrirProgrammation(
                                      collab
                                    )
                                  }
                                  style={
                                    actionButtonStyle
                                  }
                                  title="Gérer le rythme"
                                >
                                  🗓️
                                </button>

                                <button
                                  onClick={() =>
                                    ouvrirEditionCollaborateur(
                                      collab
                                    )
                                  }
                                  style={
                                    actionButtonStyle
                                  }
                                  title="Modifier"
                                >
                                  ✏️
                                </button>

                                <button
                                  onClick={() =>
                                    changerEtatCollaborateur(
                                      collab
                                    )
                                  }
                                  style={{
                                    ...actionButtonStyle,
                                    color:
                                      "#b00000",
                                  }}
                                  title="Désactiver"
                                >
                                  ⏻
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ==================================================
              INACTIFS
          ================================================== */}

          <details
            style={
              inactiveSectionStyle
            }
          >
            <summary
              style={
                inactiveSummaryStyle
              }
            >
              <div>
                <strong>
                  📁 Collaborateurs inactifs
                </strong>

                <span
                  style={{
                    marginLeft: 8,
                    color: "#777",
                    fontWeight: 400,
                  }}
                >
                  {inactifsFiltres.length}
                </span>
              </div>

              <span
                style={
                  summaryArrowStyle
                }
              >
                ▼
              </span>
            </summary>

            {inactifsFiltres.length ===
            0 ? (
              <EmptyState
                icon="📁"
                text={
                  recherche
                    ? "Aucun collaborateur inactif ne correspond à la recherche."
                    : "Aucun collaborateur inactif."
                }
              />
            ) : (
              <div
                style={
                  tableWrapperStyle
                }
              >
                <table
                  style={tableStyle}
                >
                  <thead>
                    <tr>
                      <th
                        style={
                          thStyle
                        }
                      >
                        Collaborateur
                      </th>

                      <th
                        style={
                          thStyle
                        }
                      >
                        Dernier rythme
                      </th>

                      <th
                        style={{
                          ...thStyle,
                          textAlign:
                            "right",
                        }}
                      >
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {inactifsFiltres.map(
                      (collab) => (
                        <tr
                          key={
                            collab.id
                          }
                        >
                          <td
                            style={
                              tdStyle
                            }
                          >
                            <div
                              style={
                                collaboratorCellStyle
                              }
                            >
                              <div
                                style={{
                                  ...trigrammeStyle,
                                  background:
                                    "#eee",
                                  color:
                                    "#777",
                                }}
                              >
                                {collab.trigramme ||
                                  "—"}
                              </div>

                              <div>
                                <div
                                  style={
                                    collaboratorNameStyle
                                  }
                                >
                                  {
                                    collab.prenom
                                  }{" "}
                                  {
                                    collab.nom
                                  }
                                </div>

                                <div
                                  style={
                                    collaboratorEmailStyle
                                  }
                                >
                                  {
                                    collab.email
                                  }
                                </div>
                              </div>
                            </div>
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {nomAfficheProfil(
                              collab.profil
                            )}
                          </td>

                          <td
                            style={{
                              ...tdStyle,
                              textAlign:
                                "right",
                            }}
                          >
                            <button
                              onClick={() =>
                                changerEtatCollaborateur(
                                  collab
                                )
                              }
                              style={
                                buttonSecondary
                              }
                            >
                              Réactiver
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </>
      )}

      {/* ======================================================
          MODALE COLLABORATEUR
      ====================================================== */}

      {formOuvert && (
        <Modal
          title={
            editionOuverte
              ? "Modifier le collaborateur"
              : "Nouveau collaborateur"
          }
          subtitle={
            editionOuverte
              ? "Informations administratives et paramètres du collaborateur."
              : "Création du collaborateur et de son premier rythme horaire."
          }
          onClose={() => {
            setFormOuvert(false);
            setEditionOuverte(false);
            setCollaborateurSelectionne(
              null
            );
          }}
        >
          <div
            style={
              modalSectionStyle
            }
          >
            <div
              style={
                modalSectionTitleStyle
              }
            >
              👤 Identité
            </div>

            <div style={formGrid}>
              <FormField label="Prénom *">
                <input
                  value={prenom}
                  onChange={(e) =>
                    setPrenom(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                  placeholder="Pierre-Laurent"
                />
              </FormField>

              <FormField label="Nom *">
                <input
                  value={nom}
                  onChange={(e) =>
                    setNom(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                  placeholder="GAUFIER"
                />
              </FormField>

              <FormField label="Trigramme *">
                <input
                  value={trigramme}
                  maxLength={3}
                  onChange={(e) =>
                    setTrigramme(
                      e.target.value
                        .replace(
                          /[^a-zA-Z0-9]/g,
                          ""
                        )
                        .toUpperCase()
                        .slice(
                          0,
                          3
                        )
                    )
                  }
                  style={{
                    ...inputStyle,
                    fontWeight: 700,
                    letterSpacing: 3,
                    textTransform:
                      "uppercase",
                  }}
                  placeholder="PLG"
                />

                <FieldHint>
                  3 caractères obligatoires
                </FieldHint>
              </FormField>

              <FormField label="Rôle *">
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                >
                  <option value="COLLABORATEUR">
                    Collaborateur
                  </option>

                  <option value="ADMIN">
                    Administrateur
                  </option>
                </select>
              </FormField>

              <FormField label="Compteur récupération initial">
                <input
                  type="number"
                  step="0.5"
                  value={
                    compteurRecuperation
                  }
                  onChange={(e) =>
                    setCompteurRecuperation(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                />
              </FormField>

              <FormField label="Adresse e-mail *">
                <input
                  value={email}
                  onChange={(e) => {
                    setEmailManuel(
                      true
                    );
                    setEmail(
                      e.target.value
                    );
                  }}
                  style={inputStyle}
                />

                <FieldHint>
                  Générée automatiquement,
                  mais modifiable si nécessaire.
                </FieldHint>
              </FormField>
            </div>
          </div>

          <div
            style={
              modalSectionStyle
            }
          >
            <div
              style={
                modalSectionTitleStyle
              }
            >
              📅 Dates
            </div>

            <div style={formGrid}>
              <FormField label="Date d'entrée">
                <input
                  type="date"
                  value={dateEntree}
                  onChange={(e) =>
                    setDateEntree(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                />
              </FormField>

              <FormField label="Date de sortie">
                <input
                  type="date"
                  value={dateSortie}
                  onChange={(e) =>
                    setDateSortie(
                      e.target.value
                    )
                  }
                  style={inputStyle}
                />
              </FormField>
            </div>
          </div>

          {!editionOuverte && (
            <div
              style={
                modalSectionStyle
              }
            >
              <div
                style={
                  modalSectionTitleStyle
                }
              >
                ⏱️ Premier rythme horaire
              </div>

              <div style={formGrid}>
                <FormField label="Rythme horaire *">
                  <select
                    value={
                      profilSelectionne
                    }
                    onChange={(e) =>
                      selectionnerProfil(
                        e.target.value
                      )
                    }
                    style={inputStyle}
                  >
                    <option value="">
                      Sélectionner un rythme...
                    </option>

                    {profilsSelection.map(
                      (profil) => (
                        <option
                          key={
                            profil.id
                          }
                          value={
                            profil.id
                          }
                        >
                          {nomAfficheProfil(
                            profil
                          )}
                          {profil.forfait
                            ? " — forfait"
                            : ""}
                        </option>
                      )
                    )}
                  </select>
                </FormField>

                <FormField label="Applicable à partir du *">
                  <input
                    type="date"
                    value={dateDebut}
                    onChange={(e) =>
                      setDateDebut(
                        e.target.value
                      )
                    }
                    style={inputStyle}
                  />
                </FormField>
              </div>

              {profilFormulaire && (
                <WeeklyHours
                  horaires={horaires}
                  editable={
                    formulairePersonnalise
                  }
                  onChange={(
                    key,
                    value
                  ) =>
                    setHoraires(
                      (ancien) => ({
                        ...ancien,
                        [key]: value,
                      })
                    )
                  }
                  personalised={
                    formulairePersonnalise
                  }
                />
              )}
            </div>
          )}

          <div
            style={
              modalFooterStyle
            }
          >
            <button
              onClick={() => {
                setFormOuvert(false);
                setEditionOuverte(false);
                setCollaborateurSelectionne(
                  null
                );
              }}
              style={
                buttonSecondary
              }
            >
              Annuler
            </button>

            <button
              onClick={
                editionOuverte
                  ? modifierCollaborateur
                  : ajouterCollaborateur
              }
              style={
                buttonPrimary
              }
            >
              {editionOuverte
                ? "Enregistrer les modifications"
                : "Créer le collaborateur"}
            </button>
          </div>
        </Modal>
      )}

      {/* ======================================================
          MODALE RYTHME
      ====================================================== */}

      {rythmeOuvert &&
        collaborateurSelectionne && (
          <Modal
            maxWidth={980}
            title="Gestion du rythme horaire"
            subtitle={`${collaborateurSelectionne.trigramme ?? ""} — ${
              collaborateurSelectionne.prenom ?? ""
            } ${
              collaborateurSelectionne.nom ?? ""
            }`}
            onClose={() => {
              setRythmeOuvert(false);
              setCollaborateurSelectionne(
                null
              );
            }}
          >
            {(() => {
              const historique =
                collaborateurSelectionne.historique ??
                [];

              const actuel =
                trouverRythmeActuel(
                  historique
                );

              const futur =
                trouverProchainRythme(
                  historique
                );

              return (
                <>
                  {/* RYTHME ACTUEL */}

                  <div
                    style={
                      currentRhythmCardStyle
                    }
                  >
                    <div>
                      <div
                        style={
                          smallLabelStyle
                        }
                      >
                        RYTHME ACTUEL
                      </div>

                      <div
                        style={
                          currentRhythmNameStyle
                        }
                      >
                        {nomAfficheProfil(
                          actuel?.profil
                        )}
                      </div>

                      {actuel?.profil && (
                        <div
                          style={
                            weeklySummaryStyle
                          }
                        >
                          {formatHeures(
                            totalHeuresProfil(
                              actuel.profil
                            )
                          )}{" "}
                          h / semaine
                        </div>
                      )}
                    </div>

                    {futur && (
                      <div
                        style={
                          nextRhythmCardStyle
                        }
                      >
                        <div
                          style={
                            smallLabelStyle
                          }
                        >
                          PROCHAIN RYTHME
                        </div>

                        <strong>
                          {nomAfficheProfil(
                            futur.profil
                          )}
                        </strong>

                        <div
                          style={{
                            marginTop: 3,
                          }}
                        >
                          À partir du{" "}
                          <strong>
                            {formatDate(
                              futur.date_debut
                            )}
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* NOUVELLE PROGRAMMATION */}

                  <div
                    style={
                      modalSectionStyle
                    }
                  >
                    <div
                      style={
                        modalSectionTitleStyle
                      }
                    >
                      ＋ Programmer un nouveau rythme
                    </div>

                    <div
                      style={
                        formGrid
                      }
                    >
                      <FormField label="Nouveau rythme">
                        <select
                          value={
                            nouveauProfil
                          }
                          onChange={(
                            e
                          ) =>
                            selectionnerNouveauProfil(
                              e.target
                                .value
                            )
                          }
                          style={
                            inputStyle
                          }
                        >
                          <option value="">
                            Sélectionner...
                          </option>

                          {profilsSelection.map(
                            (
                              profil
                            ) => (
                              <option
                                key={
                                  profil.id
                                }
                                value={
                                  profil.id
                                }
                              >
                                {nomAfficheProfil(
                                  profil
                                )}
                                {profil.forfait
                                  ? " — forfait"
                                  : ""}
                              </option>
                            )
                          )}
                        </select>
                      </FormField>

                      <FormField label="Applicable à partir du">
                        <input
                          type="date"
                          value={
                            nouvelleDateDebut
                          }
                          onChange={(
                            e
                          ) =>
                            setNouvelleDateDebut(
                              e.target
                                .value
                            )
                          }
                          style={
                            inputStyle
                          }
                        />
                      </FormField>
                    </div>

                    {nouveauProfilObjet && (
                      <WeeklyHours
                        horaires={
                          nouveauxHoraires
                        }
                        editable={
                          nouveauProfilPersonnalise
                        }
                        personalised={
                          nouveauProfilPersonnalise
                        }
                        onChange={(
                          key,
                          value
                        ) =>
                          setNouveauxHoraires(
                            (
                              ancien
                            ) => ({
                              ...ancien,
                              [key]:
                                value,
                            })
                          )
                        }
                      />
                    )}
                  </div>

                  {/* HISTORIQUE */}

                  <div
                    style={
                      modalSectionStyle
                    }
                  >
                    <div
                      style={
                        modalSectionTitleStyle
                      }
                    >
                      🕘 Historique des rythmes
                    </div>

                    {historique.length ===
                    0 ? (
                      <EmptyState
                        icon="🕘"
                        text="Aucun historique de rythme."
                      />
                    ) : (
                      <div
                        style={
                          timelineStyle
                        }
                      >
                        {historique.map(
                          (
                            item,
                            index
                          ) => {
                            const estFutur =
                              item.date_debut >
                              dateInputToday();

                            const estActuel =
                              trouverRythmeActuel(
                                historique
                              )?.id ===
                              item.id;

                            return (
                              <div
                                key={
                                  item.id
                                }
                                style={
                                  timelineItemStyle
                                }
                              >
                                <div
                                  style={
                                    timelineDotStyle
                                  }
                                />

                                <div
                                  style={
                                    timelineContentStyle
                                  }
                                >
                                  <div
                                    style={
                                      timelineTopStyle
                                    }
                                  >
                                    <div>
                                      <strong
                                        style={{
                                          fontSize:
                                            15,
                                        }}
                                      >
                                        {nomAfficheProfil(
                                          item.profil
                                        )}
                                      </strong>

                                      {estActuel && (
                                        <span
                                          style={
                                            currentBadgeStyle
                                          }
                                        >
                                          ACTUEL
                                        </span>
                                      )}

                                      {estFutur && (
                                        <span
                                          style={
                                            futureBadgeStyle
                                          }
                                        >
                                          PROGRAMMÉ
                                        </span>
                                      )}
                                    </div>

                                    <button
                                      onClick={() =>
                                        supprimerProgrammation(
                                          item
                                        )
                                      }
                                      style={
                                        deleteButtonStyle
                                      }
                                      title="Supprimer"
                                    >
                                      🗑️
                                    </button>
                                  </div>

                                  <div
                                    style={
                                      timelineDateStyle
                                    }
                                  >
                                    Du{" "}
                                    {formatDate(
                                      item.date_debut
                                    )}{" "}
                                    au{" "}
                                    {item.date_fin
                                      ? formatDate(
                                          item.date_fin
                                        )
                                      : "aujourd'hui"}
                                  </div>

 {item.profil && (
  <div
    style={
      timelineHoursStyle
    }
  >
    {JOURS.map(
      (jour) => (
        <span
          key={
            jour.key
          }
        >
          <b>
            {
              jour.court
            }
          </b>
          :{" "}
          {formatHeures(
            item.profil?.[
              jour.key
            ]
          )}
        </span>
      )
    )}
  </div>
)}
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            <div
              style={
                modalFooterStyle
              }
            >
              <button
                onClick={() => {
                  setRythmeOuvert(false);
                  setCollaborateurSelectionne(
                    null
                  );
                }}
                style={
                  buttonSecondary
                }
              >
                Fermer
              </button>

              <button
                onClick={
                  programmerNouveauRythme
                }
                style={
                  buttonPrimary
                }
              >
                Programmer le rythme
              </button>
            </div>
          </Modal>
        )}
    </main>
  );
}

/* ============================================================
   PETITS COMPOSANTS D'AFFICHAGE
============================================================ */

function KpiCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: string;
  accent: string;
}) {
  return (
    <div style={kpiCardStyle}>
      <div
        style={{
          ...kpiIconStyle,
          borderColor: accent,
        }}
      >
        {icon}
      </div>

      <div>
        <div style={kpiLabelStyle}>
          {label}
        </div>

        <div style={kpiValueStyle}>
          {value}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  text,
}: {
  icon: string;
  text: string;
}) {
  return (
    <div style={emptyStateStyle}>
      <div
        style={{
          fontSize: 28,
          marginBottom: 8,
        }}
      >
        {icon}
      </div>

      <div>{text}</div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
      </label>

      {children}
    </div>
  );
}

function FieldHint({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={fieldHintStyle}>
      {children}
    </div>
  );
}

function WeeklyHours({
  horaires,
  editable,
  personalised,
  onChange,
}: {
  horaires: Record<
    JourKey,
    number
  >;
  editable: boolean;
  personalised: boolean;
  onChange: (
    key: JourKey,
    value: number
  ) => void;
}) {
  return (
    <div
      style={
        weeklyHoursContainerStyle
      }
    >
      <div
        style={
          weeklyHoursHeaderStyle
        }
      >
        <div>
          <strong>
            Répartition hebdomadaire
          </strong>

          <div
            style={{
              fontSize: 12,
              color: "#777",
              marginTop: 2,
            }}
          >
            {editable
              ? "Vous pouvez modifier les horaires."
              : "Rythme prédéfini."}
          </div>
        </div>

        <strong>
          {formatHeures(
            totalHeuresProfil(
              horaires
            )
          )}{" "}
          h / semaine
        </strong>
      </div>

      <div
        style={
          weeklyHoursGridStyle
        }
      >
        {JOURS.map((jour) => (
          <div
            key={jour.key}
            style={
              weeklyDayStyle
            }
          >
            <div
              style={
                weeklyDayLabelStyle
              }
            >
              {jour.court}
            </div>

            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={
                horaires[jour.key]
              }
              disabled={!editable}
              onChange={(e) =>
                onChange(
                  jour.key,
                  Number(
                    e.target.value
                  )
                )
              }
              style={{
                ...inputStyle,
                textAlign: "center",
                background:
                  editable
                    ? "white"
                    : "#f2f2f2",
              }}
            />
          </div>
        ))}
      </div>

      {!personalised && (
        <div
          style={
            weeklyHoursHintStyle
          }
        >
          Ce rythme est prédéfini.
          Pour modifier la répartition,
          sélectionnez « Personnalisé ».
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
  maxWidth = 900,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: number;
}) {
  return (
    <div style={overlayStyle}>
      <div
        style={{
          ...modalStyle,
          maxWidth,
        }}
      >
        <div
          style={
            modalHeaderStyle
          }
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 21,
              }}
            >
              {title}
            </h2>

            {subtitle && (
              <div
                style={
                  modalSubtitleStyle
                }
              >
                {subtitle}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            style={
              closeButtonStyle
            }
          >
            ×
          </button>
        </div>

        <div
          style={
            modalContentStyle
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STYLES
============================================================ */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f4f5f7",
  fontFamily:
    "Calibri, Arial, sans-serif",
  color: "#222",
  paddingBottom: 50,
};

const headerStyle: React.CSSProperties = {
  background: "#c00000",
  color: "white",
  padding: "22px 30px",
  display: "flex",
  justifyContent:
    "space-between",
  alignItems: "center",
  gap: 20,
};

const brandStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 2,
  opacity: 0.9,
};

const titleStyle: React.CSSProperties = {
  margin: "3px 0 0",
  fontSize: 25,
  fontWeight: 700,
};

const subtitleStyle: React.CSSProperties = {
  marginTop: 4,
  opacity: 0.85,
  fontSize: 14,
};

const headerActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const errorBoxStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "18px auto 0",
  padding: "12px 15px",
  background: "#fff0f0",
  border: "1px solid #e5aaaa",
  borderRadius: 8,
  color: "#9c0000",
  display: "flex",
  gap: 10,
  alignItems: "center",
};

const errorCloseStyle: React.CSSProperties = {
  marginLeft: "auto",
  border: "none",
  background: "transparent",
  fontSize: 20,
  cursor: "pointer",
  color: "#900",
};

const kpiGridStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "22px auto 0",
  padding: "0 20px",
  display: "grid",
  gridTemplateColumns:
    "repeat(4, minmax(0, 1fr))",
  gap: 15,
};

const kpiCardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  padding: "17px 18px",
  boxShadow:
    "0 1px 5px rgba(0,0,0,0.07)",
  display: "flex",
  alignItems: "center",
  gap: 14,
};

const kpiIconStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 9,
  border: "2px solid",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 20,
};

const kpiLabelStyle: React.CSSProperties = {
  color: "#777",
  fontSize: 12,
};

const kpiValueStyle: React.CSSProperties = {
  fontSize: 25,
  fontWeight: 800,
  marginTop: 1,
};

const searchCardStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "18px auto",
  padding: "0 20px",
  position: "relative",
};

const searchIconStyle: React.CSSProperties = {
  position: "absolute",
  left: 35,
  top: 10,
  fontSize: 18,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 9,
  padding: "12px 42px",
  fontSize: 15,
  fontFamily:
    "Calibri, Arial, sans-serif",
  outline: "none",
  boxShadow:
    "0 1px 4px rgba(0,0,0,0.04)",
};

const searchClearStyle: React.CSSProperties = {
  position: "absolute",
  right: 35,
  top: 8,
  border: "none",
  background: "transparent",
  fontSize: 24,
  color: "#888",
  cursor: "pointer",
};

const sectionStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "0 auto 20px",
  padding: "0 20px",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent:
    "space-between",
  marginBottom: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 800,
};

const sectionSubtitleStyle: React.CSSProperties = {
  color: "#777",
  fontSize: 13,
  marginTop: 2,
};

const sectionBadgeStyle: React.CSSProperties = {
  minWidth: 30,
  height: 30,
  borderRadius: 15,
  background: "#c00000",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: 13,
};

const tableWrapperStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  overflowX: "auto",
  boxShadow:
    "0 1px 5px rgba(0,0,0,0.07)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 950,
};

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 11,
  color: "#777",
  fontWeight: 800,
  borderBottom:
    "1px solid #ddd",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  whiteSpace: "nowrap",
  textAlign: "left",
};

const tdStyle: React.CSSProperties = {
  padding: "14px",
  borderBottom:
    "1px solid #eee",
  fontSize: 14,
  verticalAlign: "middle",
};

const tableRowStyle: React.CSSProperties = {
  transition:
    "background 0.15s ease",
};

const collaboratorCellStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
};

const trigrammeStyle: React.CSSProperties = {
  minWidth: 39,
  height: 39,
  borderRadius: 8,
  background: "#c00000",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: 1,
};

const collaboratorNameStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
};

const collaboratorEmailStyle: React.CSSProperties = {
  color: "#999",
  fontSize: 11,
  marginTop: 2,
};

const rhythmNameStyle: React.CSSProperties = {
  fontWeight: 700,
};

const rhythmDetailsStyle: React.CSSProperties = {
  marginTop: 5,
  display: "flex",
  gap: 7,
  flexWrap: "wrap",
  color: "#888",
  fontSize: 10,
};

const hoursBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#f2f2f2",
  borderRadius: 6,
  padding: "6px 9px",
  fontWeight: 800,
  fontSize: 13,
};

const futureRhythmStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#765400",
  background: "#fff9e8",
  border: "1px solid #f0d58d",
  borderRadius: 7,
  padding: "7px 9px",
  display: "inline-block",
};

const futureBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  marginRight: 6,
  background: "#ffe8a3",
  color: "#765400",
  borderRadius: 9,
  padding: "2px 6px",
  fontSize: 9,
  fontWeight: 800,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 5,
  justifyContent: "flex-end",
};

const actionButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 6,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontSize: 15,
};

const inactiveSectionStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "0 auto",
  padding: "0 20px",
};

const inactiveSummaryStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  padding: "15px 18px",
  cursor: "pointer",
  boxShadow:
    "0 1px 5px rgba(0,0,0,0.06)",
  listStyle: "none",
  display: "flex",
  justifyContent:
    "space-between",
  alignItems: "center",
};

const summaryArrowStyle: React.CSSProperties = {
  color: "#999",
  fontSize: 12,
};

const buttonPrimary: React.CSSProperties = {
  background: "#c00000",
  color: "white",
  border: "none",
  borderRadius: 7,
  padding: "10px 15px",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily:
    "Calibri, Arial, sans-serif",
};

const buttonSecondary: React.CSSProperties = {
  background: "white",
  color: "#333",
  border: "1px solid #ccc",
  borderRadius: 7,
  padding: "9px 13px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily:
    "Calibri, Arial, sans-serif",
};

const emptyStateStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 10,
  padding: 35,
  textAlign: "center",
  color: "#888",
  boxShadow:
    "0 1px 5px rgba(0,0,0,0.05)",
};

const loadingStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "50px auto",
  textAlign: "center",
  color: "#777",
  fontSize: 14,
};

const spinnerStyle: React.CSSProperties = {
  fontSize: 28,
  marginBottom: 8,
};

const modalSectionStyle: React.CSSProperties = {
  marginBottom: 24,
};

const modalSectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  marginBottom: 13,
  paddingBottom: 8,
  borderBottom:
    "1px solid #eee",
};

const modalSubtitleStyle: React.CSSProperties = {
  color: "#777",
  fontSize: 13,
  marginTop: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 11px",
  border: "1px solid #ccc",
  borderRadius: 7,
  fontSize: 14,
  fontFamily:
    "Calibri, Arial, sans-serif",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 6,
};

const fieldHintStyle: React.CSSProperties = {
  color: "#888",
  fontSize: 11,
  marginTop: 4,
};

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(2, minmax(0, 1fr))",
  gap: 16,
};

const weeklyHoursContainerStyle: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid #ddd",
  borderRadius: 9,
  overflow: "hidden",
};

const weeklyHoursHeaderStyle: React.CSSProperties = {
  background: "#f7f7f7",
  padding: "12px 15px",
  display: "flex",
  justifyContent:
    "space-between",
  alignItems: "center",
  gap: 15,
};

const weeklyHoursGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(7, minmax(70px, 1fr))",
  gap: 1,
  background: "#ddd",
};

const weeklyDayStyle: React.CSSProperties = {
  background: "white",
  padding: 9,
};

const weeklyDayLabelStyle: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11,
  fontWeight: 700,
  color: "#777",
  marginBottom: 5,
};

const weeklyHoursHintStyle: React.CSSProperties = {
  padding: "9px 14px",
  background: "#fafafa",
  color: "#777",
  fontSize: 11,
  borderTop:
    "1px solid #eee",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background:
    "rgba(0,0,0,0.48)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: "92vh",
  background: "white",
  borderRadius: 11,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  boxShadow:
    "0 15px 50px rgba(0,0,0,0.28)",
};

const modalHeaderStyle: React.CSSProperties = {
  padding: "18px 22px",
  borderBottom:
    "1px solid #e5e5e5",
  display: "flex",
  justifyContent:
    "space-between",
  alignItems: "center",
  gap: 20,
};

const modalContentStyle: React.CSSProperties = {
  padding: 22,
  overflowY: "auto",
};

const modalFooterStyle: React.CSSProperties = {
  padding: "14px 22px",
  borderTop:
    "1px solid #e5e5e5",
  display: "flex",
  justifyContent:
    "flex-end",
  gap: 10,
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 29,
  lineHeight: 1,
  cursor: "pointer",
  color: "#777",
};

const currentRhythmCardStyle: React.CSSProperties = {
  background: "#f7f8fa",
  border: "1px solid #e5e5e5",
  borderRadius: 9,
  padding: 16,
  display: "flex",
  justifyContent:
    "space-between",
  gap: 20,
  alignItems: "stretch",
};

const smallLabelStyle: React.CSSProperties = {
  color: "#888",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.6,
  marginBottom: 4,
};

const currentRhythmNameStyle: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 800,
};

const weeklySummaryStyle: React.CSSProperties = {
  color: "#777",
  fontSize: 12,
  marginTop: 4,
};

const nextRhythmCardStyle: React.CSSProperties = {
  background: "#fff7df",
  border: "1px solid #efd38d",
  borderRadius: 7,
  padding: "10px 13px",
  color: "#765400",
  minWidth: 230,
};

const timelineStyle: React.CSSProperties = {
  borderLeft:
    "2px solid #ddd",
  marginLeft: 7,
  paddingLeft: 18,
};

const timelineItemStyle: React.CSSProperties = {
  position: "relative",
  marginBottom: 13,
};

const timelineDotStyle: React.CSSProperties = {
  position: "absolute",
  left: -25,
  top: 15,
  width: 10,
  height: 10,
  borderRadius: "50%",
  background: "#c00000",
  border: "2px solid white",
  boxShadow:
    "0 0 0 1px #c00000",
};

const timelineContentStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "12px 13px",
};

const timelineTopStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent:
    "space-between",
  gap: 10,
};

const currentBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 7,
  background: "#e6f5e8",
  color: "#26733b",
  borderRadius: 10,
  padding: "2px 7px",
  fontSize: 9,
  fontWeight: 800,
};

const timelineDateStyle: React.CSSProperties = {
  color: "#777",
  fontSize: 11,
  marginTop: 4,
};

const timelineHoursStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
  color: "#888",
  fontSize: 10,
};

const deleteButtonStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  background: "white",
  borderRadius: 6,
  width: 31,
  height: 31,
  cursor: "pointer",
};

const weeklyDayStyleMobileFix =
  weeklyDayStyle;