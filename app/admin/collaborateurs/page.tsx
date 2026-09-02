"use client";

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
  profil?: ProfilHoraire | null;
  historique?: Historique[];
};

const JOURS = [
  { key: "lundi", label: "Lundi" },
  { key: "mardi", label: "Mardi" },
  { key: "mercredi", label: "Mercredi" },
  { key: "jeudi", label: "Jeudi" },
  { key: "vendredi", label: "Vendredi" },
  { key: "samedi", label: "Samedi" },
  { key: "dimanche", label: "Dimanche" },
] as const;

type JourKey = (typeof JOURS)[number]["key"];

/*
 * Ce sont les seuls rythmes qui doivent être proposés
 * dans les listes de sélection.
 */
const RYTHMES_AUTORISES = [
  "POLYNOV ETAM/Cadre",
  "POLYNOV Cadre forfait",
  "BIB PE",
  "BIB PI",
  "Personnalisé",
];

/* ============================================================
   OUTILS
   ============================================================ */

function formatHeures(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";

  return Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/*
 * IMPORTANT :
 * On ne fait volontairement PAS :
 *
 * new Date("2026-09-01")
 *
 * car cela peut provoquer des décalages de date selon le fuseau.
 *
 * On traite ici la date SQL comme une simple date calendaire.
 */
function formatDate(date: string | null | undefined) {
  if (!date) return "—";

  const morceaux = date.split("-");

  if (morceaux.length !== 3) return date;

  return `${morceaux[2]}/${morceaux[1]}/${morceaux[0]}`;
}

function dateInputToday() {
  const maintenant = new Date();

  const annee = maintenant.getFullYear();
  const mois = String(maintenant.getMonth() + 1).padStart(2, "0");
  const jour = String(maintenant.getDate()).padStart(2, "0");

  return `${annee}-${mois}-${jour}`;
}

function normaliserTexte(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function genererEmail(prenom: string, nom: string) {
  const p = normaliserTexte(prenom)
    .replace(/[^a-zA-Z-]/g, "")
    .toLowerCase();

  const n = normaliserTexte(nom)
    .replace(/[^a-zA-Z-]/g, "")
    .replace(/-/g, "")
    .toLowerCase();

  if (!p || !n) return "";

  const prenomCompose = p.includes("-");

  const prefixe = prenomCompose
    ? p
        .split("-")
        .filter(Boolean)
        .map((partie) => partie.substring(0, 1))
        .join("")
    : p.substring(0, 1);

  return `${prefixe}${n}@polynov.fr`;
}

function estPersonnalise(nom: string) {
  return nom === "Personnalisé" || nom.startsWith("Personnalisé -");
}

function estRythmeAutorise(nom: string) {
  return (
    RYTHMES_AUTORISES.includes(nom) ||
    nom.startsWith("Personnalisé -")
  );
}

function nomAfficheProfil(profil: ProfilHoraire | null | undefined) {
  if (!profil) return "Aucun rythme";

  if (estPersonnalise(profil.nom)) {
    return "Personnalisé";
  }

  return profil.nom;
}

function totalHeuresProfil(profil: Partial<ProfilHoraire>) {
  return JOURS.reduce((total, jour) => {
    return total + Number(profil[jour.key] ?? 0);
  }, 0);
}

/*
 * Retourne le rythme réellement applicable aujourd'hui.
 *
 * On ne se base volontairement pas sur collaborateurs.profil_horaire_id
 * car celui-ci peut correspondre à un rythme futur.
 */
function trouverRythmeActuel(
  historique: Historique[] | undefined
) {
  if (!historique || historique.length === 0) return null;

  const aujourdHui = dateInputToday();

  return (
    historique.find((item) => {
      const apresDebut = item.date_debut <= aujourdHui;
      const avantFin =
        !item.date_fin || aujourdHui <= item.date_fin;

      return apresDebut && avantFin;
    }) ?? null
  );
}

/*
 * Retourne le prochain rythme programmé.
 */
function trouverProchainRythme(
  historique: Historique[] | undefined
) {
  if (!historique || historique.length === 0) return null;

  const aujourdHui = dateInputToday();

  const futurs = historique
    .filter((item) => item.date_debut > aujourdHui)
    .sort((a, b) =>
      a.date_debut.localeCompare(b.date_debut)
    );

  return futurs[0] ?? null;
}

/* ============================================================
   COMPOSANT
   ============================================================ */

export default function CollaborateursPage() {
const router = useRouter();
  const [collaborateurs, setCollaborateurs] = useState<
    Collaborateur[]
  >([]);

  const [profils, setProfils] = useState<ProfilHoraire[]>([]);

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [formOuvert, setFormOuvert] = useState(false);

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [trigramme, setTrigramme] = useState("");
  const [role, setRole] = useState("COLLABORATEUR");

  const [
  compteurRecuperation,
  setCompteurRecuperation,
] = useState("0");

  const [profilSelectionne, setProfilSelectionne] =
    useState("");

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

  const [dateDebut, setDateDebut] =
    useState(dateInputToday());

  const [recherche, setRecherche] = useState("");

  const [
    collaborateurSelectionne,
    setCollaborateurSelectionne,
  ] = useState<Collaborateur | null>(null);

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

  /* ============================================================
     CHARGEMENT
     ============================================================ */

  async function chargerDonnees() {
    setChargement(true);
    setErreur("");

    const [
      { data: collaborateursData, error: collaborateursError },
      { data: profilsData, error: profilsError },
      { data: historiqueData, error: historiqueError },
    ] = await Promise.all([
      supabase
        .from("collaborateurs")
        .select("*")
        .order("actif", { ascending: false })
        .order("nom", { ascending: true }),

      supabase
        .from("profils_horaires")
        .select("*")
        .eq("actif", true)
        .order("nom", { ascending: true }),

      supabase
        .from("historique_profils_horaires")
        .select("*")
        .order("date_debut", { ascending: false }),
    ]);

    if (collaborateursError) {
      console.error(collaborateursError);
      setErreur(
        "Impossible de charger les collaborateurs."
      );
      setChargement(false);
      return;
    }

    if (profilsError) {
      console.error(profilsError);
      setErreur(
        "Impossible de charger les rythmes horaires."
      );
      setChargement(false);
      return;
    }

    if (historiqueError) {
      console.error(historiqueError);
      setErreur(
        "Impossible de charger l'historique des rythmes."
      );
      setChargement(false);
      return;
    }

    /*
     * On conserve tous les profils existants pour que
     * l'historique puisse être affiché correctement.
     *
     * Mais les listes de sélection seront filtrées plus bas.
     */
    const profilsMap = new Map<string, ProfilHoraire>();

    (profilsData ?? []).forEach((profil) => {
      profilsMap.set(profil.id, profil);
    });

    const historiqueParCollaborateur =
      new Map<string, Historique[]>();

    (historiqueData ?? []).forEach((item) => {
      const liste =
        historiqueParCollaborateur.get(
          item.collaborateur_id
        ) ?? [];

      liste.push({
        ...item,
        profil:
          profilsMap.get(item.profil_horaire_id) ??
          null,
      });

      historiqueParCollaborateur.set(
        item.collaborateur_id,
        liste
      );
    });

    /*
     * Tri chronologique décroissant :
     * le plus récent en premier.
     */
    historiqueParCollaborateur.forEach((liste) => {
      liste.sort((a, b) =>
        b.date_debut.localeCompare(a.date_debut)
      );
    });

    const collaborateursFinal =
      (collaborateursData ?? []).map((collab) => {
        const historique =
          historiqueParCollaborateur.get(collab.id) ?? [];

        const rythmeActuel =
          trouverRythmeActuel(historique);

        return {
          ...collab,
          profil: rythmeActuel?.profil ?? null,
          historique,
        };
      });

    setProfils(profilsData ?? []);
    setCollaborateurs(collaborateursFinal);
    setChargement(false);
  }

  useEffect(() => {
    chargerDonnees();
  }, []);

  /* ============================================================
     EMAIL AUTOMATIQUE
     ============================================================ */

  useEffect(() => {
    setEmail(genererEmail(prenom, nom));
  }, [prenom, nom]);

  /* ============================================================
     PROFILS DISPONIBLES DANS LES LISTES
     ============================================================ */

  /*
   * Les anciens profils :
   * - Bureau
   * - Client 37.5h
   * - Base POLYNOV
   * - Bureau 35h
   * etc.
   *
   * ne doivent plus apparaître.
   *
   * Pour Personnalisé, on prend le premier profil
   * "Personnalisé" disponible.
   */
  const profilsDisponibles = profils.filter((profil) =>
    estRythmeAutorise(profil.nom)
  );

  const profilsSelection = [
    ...profilsDisponibles
      .filter((profil) => !estPersonnalise(profil.nom)),
    ...profilsDisponibles
      .filter((profil) => estPersonnalise(profil.nom))
      .slice(0, 1),
  ];

  /* ============================================================
     RESET FORMULAIRE
     ============================================================ */

  function resetFormulaire() {
    setPrenom("");
    setNom("");
    setEmail("");
    setTrigramme("");
    setRole("COLLABORATEUR");
    setCompteurRecuperation("0");
    setProfilSelectionne("");
    setDateDebut(dateInputToday());

    setHoraires({
      lundi: 7.5,
      mardi: 7.5,
      mercredi: 7.5,
      jeudi: 7.5,
      vendredi: 5,
      samedi: 0,
      dimanche: 0,
    });

    setErreur("");
  }

  /* ============================================================
     SELECTION PROFIL
     ============================================================ */

  function selectionnerProfil(id: string) {
    setProfilSelectionne(id);

    const profil = profils.find(
      (p) => p.id === id
    );

    if (!profil) return;

    setHoraires({
      lundi: Number(profil.lundi),
      mardi: Number(profil.mardi),
      mercredi: Number(profil.mercredi),
      jeudi: Number(profil.jeudi),
      vendredi: Number(profil.vendredi),
      samedi: Number(profil.samedi),
      dimanche: Number(profil.dimanche),
    });
  }

  const profilFormulaire = profils.find(
    (profil) =>
      profil.id === profilSelectionne
  );

  const formulairePersonnalise =
    profilFormulaire
      ? estPersonnalise(profilFormulaire.nom)
      : false;

  /* ============================================================
     NOM INTERNE PROFIL PERSONNALISE
     ============================================================ */

  function genererNomInternePersonnalise(
    trig: string,
    date: string
  ) {
    /*
     * Permet plusieurs profils "Personnalisé"
     * malgré la contrainte UNIQUE sur profils_horaires.nom.
     *
     * L'utilisateur verra toujours "Personnalisé".
     */
    return `Personnalisé - ${trig} - ${date}-${Date.now()}`;
  }

  /* ============================================================
     AJOUT COLLABORATEUR
     ============================================================ */

  async function ajouterCollaborateur() {
    setErreur("");

    const trig = trigramme
      .trim()
      .toUpperCase();

    if (!prenom.trim()) {
      setErreur("Veuillez saisir le prénom.");
      return;
    }

    if (!nom.trim()) {
      setErreur("Veuillez saisir le nom.");
      return;
    }

    if (!/^[A-Z0-9]{3}$/.test(trig)) {
      setErreur(
        "Le trigramme doit contenir exactement 3 caractères."
      );
      return;
    }

    if (!email.trim()) {
      setErreur(
        "Impossible de générer l'adresse e-mail."
      );
      return;
    }

    if (!profilSelectionne) {
      setErreur(
        "Veuillez sélectionner un rythme horaire."
      );
      return;
    }

    if (!dateDebut) {
      setErreur(
        "Veuillez sélectionner une date de début."
      );
      return;
    }

    const profil = profils.find(
      (p) => p.id === profilSelectionne
    );

    if (!profil) {
      setErreur(
        "Le rythme sélectionné est introuvable."
      );
      return;
    }

    let profilId = profil.id;

    /*
     * Personnalisé :
     * création d'un profil indépendant.
     */
    if (estPersonnalise(profil.nom)) {
      const { data: profilCree, error: erreurProfil } =
        await supabase
          .from("profils_horaires")
          .insert({
            nom: genererNomInternePersonnalise(
              trig,
              dateDebut
            ),
            lundi: horaires.lundi,
            mardi: horaires.mardi,
            mercredi: horaires.mercredi,
            jeudi: horaires.jeudi,
            vendredi: horaires.vendredi,
            samedi: horaires.samedi,
            dimanche: horaires.dimanche,
            forfait: false,
            actif: true,
          })
          .select()
          .single();

      if (erreurProfil || !profilCree) {
        console.error(erreurProfil);

        setErreur(
          erreurProfil?.message ||
            "Impossible de créer le profil horaire personnalisé."
        );

        return;
      }

      profilId = profilCree.id;
    }

    const {
      data: collaborateur,
      error: erreurCollaborateur,
    } = await supabase
      .from("collaborateurs")
.insert({
  prenom: prenom.trim(),
  nom: nom.trim(),
  email: email.trim().toLowerCase(),
  trigramme: trig,
  role,
  profil_horaire_id: profilId,

  compteur_recuperation: Number(
    compteurRecuperation || 0
  ),

  actif: true,
})
      .select()
      .single();

    if (
      erreurCollaborateur ||
      !collaborateur
    ) {
      console.error(erreurCollaborateur);

      setErreur(
        erreurCollaborateur?.message ||
          "Impossible de créer le collaborateur."
      );

      return;
    }

    const {
      error: erreurHistorique,
    } = await supabase
      .from("historique_profils_horaires")
      .insert({
        collaborateur_id: collaborateur.id,
        profil_horaire_id: profilId,
        date_debut: dateDebut,
        date_fin: null,
      });

    if (erreurHistorique) {
      console.error(erreurHistorique);

      setErreur(
        "Collaborateur créé, mais impossible de créer son historique horaire : " +
          (erreurHistorique.message ||
            "erreur inconnue")
      );

      await chargerDonnees();
      return;
    }

    resetFormulaire();
    setFormOuvert(false);

    await chargerDonnees();
  }

  /* ============================================================
     ACTIVER / DESACTIVER
     ============================================================ */

  async function changerEtatCollaborateur(
    collaborateur: Collaborateur
  ) {
    setErreur("");

    const { error } = await supabase
      .from("collaborateurs")
      .update({
        actif: !collaborateur.actif,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", collaborateur.id);

    if (error) {
      console.error(error);

      setErreur(
        error.message ||
          "Impossible de modifier l'état du collaborateur."
      );

      return;
    }

    await chargerDonnees();
  }

  /* ============================================================
     OUVERTURE PROGRAMMATION
     ============================================================ */

  function ouvrirProgrammation(
    collaborateur: Collaborateur
  ) {
    setCollaborateurSelectionne(
      collaborateur
    );

    setRythmeOuvert(true);

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
  }

  /* ============================================================
     SELECTION NOUVEAU RYTHME
     ============================================================ */

  function selectionnerNouveauProfil(
    id: string
  ) {
    setNouveauProfil(id);

    const profil = profils.find(
      (p) => p.id === id
    );

    if (!profil) return;

    setNouveauxHoraires({
      lundi: Number(profil.lundi),
      mardi: Number(profil.mardi),
      mercredi: Number(profil.mercredi),
      jeudi: Number(profil.jeudi),
      vendredi: Number(profil.vendredi),
      samedi: Number(profil.samedi),
      dimanche: Number(profil.dimanche),
    });
  }

  const nouveauProfilObjet =
    profils.find(
      (profil) =>
        profil.id === nouveauProfil
    );

  const nouveauProfilPersonnalise =
    nouveauProfilObjet
      ? estPersonnalise(
          nouveauProfilObjet.nom
        )
      : false;

  /* ============================================================
     PROGRAMMER NOUVEAU RYTHME
     ============================================================ */

  async function programmerNouveauRythme() {
    if (!collaborateurSelectionne)
      return;

    setErreur("");

    if (!nouveauProfil) {
      setErreur(
        "Veuillez sélectionner un rythme."
      );
      return;
    }

    if (!nouvelleDateDebut) {
      setErreur(
        "Veuillez sélectionner une date de début."
      );
      return;
    }

    const profil = profils.find(
      (p) => p.id === nouveauProfil
    );

    if (!profil) {
      setErreur(
        "Rythme introuvable."
      );
      return;
    }

    const historique =
      collaborateurSelectionne.historique ?? [];

    /*
     * On cherche la période qui contient
     * la nouvelle date.
     */
    const periodeActuelle =
      historique.find((item) => {
        const debut = item.date_debut;
        const fin = item.date_fin;

        if (nouvelleDateDebut < debut)
          return false;

        if (!fin) return true;

        return nouvelleDateDebut <= fin;
      });

    let profilId = profil.id;

    /*
     * Personnalisé = nouveau profil réel.
     */
    if (estPersonnalise(profil.nom)) {
      const { data: profilCree, error: erreurProfil } =
        await supabase
          .from("profils_horaires")
          .insert({
            nom: genererNomInternePersonnalise(
              collaborateurSelectionne.trigramme ||
                "COL",
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
            forfait: false,
            actif: true,
          })
          .select()
          .single();

      if (
        erreurProfil ||
        !profilCree
      ) {
        console.error(erreurProfil);

        setErreur(
          erreurProfil?.message ||
            "Impossible de créer le rythme personnalisé."
        );

        return;
      }

      profilId = profilCree.id;
    }

    /*
     * CAS 1 :
     * une période existe déjà à cette date.
     */
    if (periodeActuelle) {
      /*
       * On remplace directement si la nouvelle date
       * est exactement le début de la période existante.
       */
      if (
        nouvelleDateDebut ===
        periodeActuelle.date_debut
      ) {
        const { error } =
          await supabase
            .from(
              "historique_profils_horaires"
            )
            .update({
              profil_horaire_id: profilId,
            })
            .eq(
              "id",
              periodeActuelle.id
            );

        if (error) {
          console.error(error);

          setErreur(
            error.message ||
              "Impossible de modifier le rythme existant."
          );

          return;
        }
      } else {
        /*
         * On termine l'ancien rythme la veille
         * du nouveau.
         *
         * Calcul sans Date() pour éviter tout problème
         * de fuseau horaire.
         */
        const dateVeille =
          calculerDatePrecedente(
            nouvelleDateDebut
          );

        const {
          error: erreurFin,
        } = await supabase
          .from(
            "historique_profils_horaires"
          )
          .update({
            date_fin: dateVeille,
          })
          .eq(
            "id",
            periodeActuelle.id
          );

        if (erreurFin) {
          console.error(erreurFin);

          setErreur(
            erreurFin.message ||
              "Impossible de clôturer l'ancien rythme."
          );

          return;
        }

        const {
          error:
            erreurNouvellePeriode,
        } = await supabase
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
              periodeActuelle.date_fin,
          });

        if (erreurNouvellePeriode) {
          console.error(
            erreurNouvellePeriode
          );

          /*
           * Restauration de l'ancien rythme.
           */
          await supabase
            .from(
              "historique_profils_horaires"
            )
            .update({
              date_fin:
                periodeActuelle.date_fin,
            })
            .eq(
              "id",
              periodeActuelle.id
            );

          setErreur(
            erreurNouvellePeriode.message ||
              "Impossible de programmer le nouveau rythme."
          );

          return;
        }
      }
    } else {
      /*
       * CAS 2 :
       * aucune période n'existe à cette date.
       */
      const {
        error,
      } = await supabase
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
          date_fin: null,
        });

      if (error) {
        console.error(error);

        setErreur(
          error.message ||
            "Impossible de créer la nouvelle période horaire."
        );

        return;
      }
    }

    /*
     * IMPORTANT :
     *
     * Si le nouveau rythme commence dans le futur,
     * on NE modifie PAS le profil courant du collaborateur.
     *
     * Sinon le tableau principal afficherait le futur rythme
     * comme s'il était déjà actif.
     */
    const aujourdHui =
      dateInputToday();

    if (
      nouvelleDateDebut <=
      aujourdHui
    ) {
      const {
        error: erreurCollaborateur,
      } = await supabase
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

      if (erreurCollaborateur) {
        console.error(
          erreurCollaborateur
        );

        setErreur(
          erreurCollaborateur.message ||
            "Le rythme a été créé mais le collaborateur n'a pas pu être mis à jour."
        );

        return;
      }
    }

    setRythmeOuvert(false);
    setCollaborateurSelectionne(null);

    await chargerDonnees();
  }

  /* ============================================================
     CALCUL DATE VEILLE
     ============================================================ */

  function calculerDatePrecedente(
    date: string
  ) {
    const morceaux =
      date.split("-");

    if (morceaux.length !== 3)
      return date;

    let annee =
      Number(morceaux[0]);

    let mois =
      Number(morceaux[1]);

    let jour =
      Number(morceaux[2]);

    jour--;

    if (jour >= 1) {
      return [
        annee,
        String(mois).padStart(2, "0"),
        String(jour).padStart(2, "0"),
      ].join("-");
    }

    mois--;

    if (mois < 1) {
      mois = 12;
      annee--;
    }

    const joursDansMois =
      new Date(
        annee,
        mois,
        0
      ).getDate();

    return [
      annee,
      String(mois).padStart(2, "0"),
      String(joursDansMois).padStart(
        2,
        "0"
      ),
    ].join("-");
  }

  /* ============================================================
     SUPPRESSION PROGRAMMATION
     ============================================================ */

  async function supprimerProgrammation(
    historique: Historique
  ) {
    if (!collaborateurSelectionne)
      return;

    const confirmation =
      window.confirm(
        `Supprimer la programmation du ${formatDate(
          historique.date_debut
        )} ?\n\nCette action modifiera l'historique du collaborateur.`
      );

    if (!confirmation) return;

    setErreur("");

    const historiqueCollaborateur =
      collaborateurSelectionne.historique ??
      [];

    const index =
      historiqueCollaborateur.findIndex(
        (item) =>
          item.id === historique.id
      );

    const periodePrecedente =
      index >= 0
        ? historiqueCollaborateur[
            index + 1
          ]
        : undefined;

    const periodeSuivante =
      index > 0
        ? historiqueCollaborateur[
            index - 1
          ]
        : undefined;

    /*
     * Si on supprime une période intermédiaire,
     * on fusionne la période précédente et la suivante.
     */
    if (
      periodePrecedente &&
      periodeSuivante
    ) {
      const {
        error: erreurMaj,
      } = await supabase
        .from(
          "historique_profils_horaires"
        )
        .update({
          date_fin:
            periodeSuivante.date_fin,
        })
        .eq(
          "id",
          periodePrecedente.id
        );

      if (erreurMaj) {
        console.error(
          erreurMaj
        );

        setErreur(
          erreurMaj.message ||
            "Impossible de rétablir l'ancien rythme."
        );

        return;
      }
    }

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
        error.message ||
          "Impossible de supprimer la programmation."
      );

      return;
    }

    /*
     * On recharge depuis la base.
     * Cela évite les incohérences d'état local.
     */
    setRythmeOuvert(false);
    setCollaborateurSelectionne(null);

    await chargerDonnees();
  }

  /* ============================================================
     FILTRAGE
     ============================================================ */

  const actifs =
    collaborateurs.filter(
      (c) => c.actif
    );

  const inactifs =
    collaborateurs.filter(
      (c) => !c.actif
    );

  function filtrer(
    liste: Collaborateur[]
  ) {
    const rechercheNormalisee =
      recherche
        .trim()
        .toLowerCase();

    if (!rechercheNormalisee)
      return liste;

    return liste.filter(
      (collab) =>
        collab.prenom
          ?.toLowerCase()
          .includes(
            rechercheNormalisee
          ) ||
        collab.nom
          ?.toLowerCase()
          .includes(
            rechercheNormalisee
          ) ||
        collab.trigramme
          ?.toLowerCase()
          .includes(
            rechercheNormalisee
          )
    );
  }

  const actifsFiltres =
    filtrer(actifs);

  const inactifsFiltres =
    filtrer(inactifs);

  /* ============================================================
     RENDER
     ============================================================ */

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily:
          "Calibri, Arial, sans-serif",
        color: "#222",
      }}
    >
      {/* ======================================================
          HEADER
      ====================================================== */}

      <header
        style={{
          background: "#c00000",
          color: "white",
          padding: "22px 32px",
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
        }}
      >
<div>
  <button
    onClick={() =>
      router.push("/dashboard")
    }
    style={{
      background:
        "rgba(255,255,255,.15)",
      border:
        "1px solid rgba(255,255,255,.3)",
      color: "white",
      borderRadius: 8,
      padding: "8px 14px",
      cursor: "pointer",
      fontWeight: 700,
      marginBottom: 10,
    }}
  >
    🏠 Retour au tableau de bord
  </button>

  <div
    style={{
      fontSize: 27,
      fontWeight: 700,
      letterSpacing: 0.3,
    }}
  >
    POLYNOV
  </div>

  <div
    style={{
      fontSize: 16,
      marginTop: 3,
      opacity: 0.95,
    }}
  >
    Gestion des collaborateurs
  </div>
</div>

        <button
          onClick={() => {
            resetFormulaire();
            setFormOuvert(true);
          }}
          style={{
            background: "white",
            color: "#c00000",
            border: "none",
            borderRadius: 7,
            padding:
              "11px 18px",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Nouveau collaborateur
        </button>
      </header>

      {/* ======================================================
          CONTENU
      ====================================================== */}

      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: 30,
        }}
      >
        {erreur && (
          <div
            style={{
              background: "#ffe7e7",
              border:
                "1px solid #e0a0a0",
              color: "#a00000",
              borderRadius: 7,
              padding:
                "12px 15px",
              marginBottom: 20,
            }}
          >
            {erreur}
          </div>
        )}

        {/* RECHERCHE */}

        <div
          style={{
            background: "white",
            borderRadius: 10,
            padding: 16,
            marginBottom: 24,
            boxShadow:
              "0 1px 4px rgba(0,0,0,0.08)",
          }}
        >
          <input
            value={recherche}
            onChange={(e) =>
              setRecherche(
                e.target.value
              )
            }
            placeholder="Rechercher un collaborateur..."
            style={{
              width: "100%",
              boxSizing:
                "border-box",
              padding:
                "11px 13px",
              border:
                "1px solid #ccc",
              borderRadius: 6,
              fontSize: 15,
            }}
          />
        </div>

        {/* ====================================================
            ACTIFS
        ==================================================== */}

        <section
          style={{
            background: "white",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow:
              "0 1px 4px rgba(0,0,0,0.08)",
            marginBottom: 28,
          }}
        >
          <div
            style={{
              padding:
                "17px 20px",
              borderBottom:
                "1px solid #e5e5e5",
              display: "flex",
              justifyContent:
                "space-between",
              alignItems:
                "center",
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                }}
              >
                Collaborateurs actifs
              </h2>

              <div
                style={{
                  color: "#777",
                  fontSize: 13,
                  marginTop: 3,
                }}
              >
                {actifsFiltres.length}{" "}
                collaborateur
                {actifsFiltres.length >
                1
                  ? "s"
                  : ""}
              </div>
            </div>
          </div>

          {chargement ? (
            <div
              style={{
                padding: 30,
              }}
            >
              Chargement des
              collaborateurs...
            </div>
          ) : actifsFiltres.length ===
            0 ? (
            <div
              style={{
                padding: 35,
                textAlign:
                  "center",
                color: "#777",
              }}
            >
              Aucun collaborateur
              actif.
            </div>
          ) : (
            <div
              style={{
                overflowX:
                  "auto",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse:
                    "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:
                        "#f7f7f7",
                      textAlign:
                        "left",
                    }}
                  >
                    <th
                      style={
                        thStyle
                      }
                    >
                      Trigramme
                    </th>

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
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {actifsFiltres.map(
                    (collab) => {
                      const historique =
                        collab.historique ??
                        [];

                      const rythmeActuel =
                        trouverRythmeActuel(
                          historique
                        );

                      const prochainRythme =
                        trouverProchainRythme(
                          historique
                        );

                      return (
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
                            <strong>
                              {collab.trigramme ||
                                "—"}
                            </strong>
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            <strong>
                              {
                                collab.prenom
                              }{" "}
                              {
                                collab.nom
                              }
                            </strong>
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {rythmeActuel
                              ?.profil ? (
                              <div>
                                <strong>
                                  {nomAfficheProfil(
                                    rythmeActuel.profil
                                  )}
                                </strong>

                                <div
                                  style={{
                                    fontSize: 12,
                                    color:
                                      "#777",
                                    marginTop:
                                      4,
                                  }}
                                >
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .lundi
                                  )}{" "}
                                  /{" "}
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .mardi
                                  )}{" "}
                                  /{" "}
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .mercredi
                                  )}{" "}
                                  /{" "}
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .jeudi
                                  )}{" "}
                                  /{" "}
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .vendredi
                                  )}{" "}
                                  /{" "}
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .samedi
                                  )}{" "}
                                  /{" "}
                                  {formatHeures(
                                    rythmeActuel
                                      .profil
                                      .dimanche
                                  )}
                                </div>

                                {prochainRythme && (
                                  <div
                                    style={{
                                      marginTop:
                                        8,
                                      padding:
                                        "7px 9px",
                                      background:
                                        "#fff5e5",
                                      border:
                                        "1px solid #f0d39a",
                                      borderRadius:
                                        6,
                                      fontSize:
                                        12,
                                    }}
                                  >
                                    <strong>
                                      Programmé :
                                    </strong>{" "}
                                    {nomAfficheProfil(
                                      prochainRythme.profil
                                    )}{" "}
                                    à partir
                                    du{" "}
                                    <strong>
                                      {formatDate(
                                        prochainRythme.date_debut
                                      )}
                                    </strong>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color:
                                    "#999",
                                }}
                              >
                                Aucun rythme
                              </span>
                            )}
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            <div
                              style={{
                                display:
                                  "flex",
                                gap: 7,
                                flexWrap:
                                  "wrap",
                              }}
                            >
                              <button
                                onClick={() =>
                                  ouvrirProgrammation(
                                    collab
                                  )
                                }
                                style={
                                  buttonSecondary
                                }
                              >
                                Rythme
                              </button>

                              <button
                                onClick={() =>
                                  changerEtatCollaborateur(
                                    collab
                                  )
                                }
                                title="Désactiver le collaborateur"
                                style={{
                                  ...buttonSecondary,
                                  color:
                                    "#b00000",
                                  fontSize:
                                    17,
                                  padding:
                                    "5px 10px",
                                  fontWeight:
                                    700,
                                }}
                              >
                                ✕
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

        {/* ====================================================
            INACTIFS
        ==================================================== */}

        <details
          style={{
            background: "white",
            borderRadius: 10,
            boxShadow:
              "0 1px 4px rgba(0,0,0,0.08)",
            overflow: "hidden",
          }}
        >
          <summary
            style={{
              padding:
                "17px 20px",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            📁 Inactifs (
            {inactifsFiltres.length})
          </summary>

          {inactifsFiltres.length ===
          0 ? (
            <div
              style={{
                padding: 30,
                color: "#777",
              }}
            >
              Aucun collaborateur
              inactif.
            </div>
          ) : (
            <div
              style={{
                overflowX:
                  "auto",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse:
                    "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:
                        "#f7f7f7",
                      textAlign:
                        "left",
                    }}
                  >
                    <th
                      style={
                        thStyle
                      }
                    >
                      Trigramme
                    </th>

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
                      style={
                        thStyle
                      }
                    >
                      Actions
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
                          {collab.trigramme ||
                            "—"}
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          {
                            collab.prenom
                          }{" "}
                          {
                            collab.nom
                          }
                        </td>

                        <td
                          style={
                            tdStyle
                          }
                        >
                          {collab.profil
                            ? nomAfficheProfil(
                                collab.profil
                              )
                            : "—"}
                        </td>

                        <td
                          style={
                            tdStyle
                          }
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
      </div>

      {/* ======================================================
          MODALE NOUVEAU COLLABORATEUR
      ====================================================== */}

      {formOuvert && (
        <div
          style={
            overlayStyle
          }
        >
          <div
            style={
              modalStyle
            }
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
                  }}
                >
                  Nouveau collaborateur
                </h2>

                <div
                  style={{
                    color:
                      "#777",
                    fontSize:
                      13,
                    marginTop:
                      4,
                  }}
                >
                  Création du
                  collaborateur
                  et de son
                  premier
                  rythme
                  horaire
                </div>
              </div>

              <button
                onClick={() =>
                  setFormOuvert(
                    false
                  )
                }
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
              <div
                style={
                  formGrid
                }
              >
                <div>
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Prénom *
                  </label>

                  <input
                    value={
                      prenom
                    }
                    onChange={(
                      e
                    ) =>
                      setPrenom(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                    placeholder="Pierre-Laurent"
                  />
                </div>

                <div>
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Nom *
                  </label>

                  <input
                    value={nom}
                    onChange={(
                      e
                    ) =>
                      setNom(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                    placeholder="GAUFIER"
                  />
                </div>

                <div>
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Trigramme *
                  </label>

                  <input
                    value={
                      trigramme
                    }
                    maxLength={
                      3
                    }
                    onChange={(
                      e
                    ) =>
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
                      textTransform:
                        "uppercase",
                      fontWeight:
                        700,
                      letterSpacing:
                        2,
                    }}
                    placeholder="PLG"
                  />

                  <div
                    style={{
                      color:
                        "#777",
                      fontSize:
                        11,
                      marginTop:
                        4,
                    }}
                  >
                    3 caractères
                    obligatoires
                  </div>
                </div>

                <div>
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Rôle *
                  </label>

                  <select
                    value={
                      role
                    }
                    onChange={(
                      e
                    ) =>
                      setRole(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                  >
                    <option value="COLLABORATEUR">
                      Collaborateur
                    </option>

                    <option value="ADMIN">
                      Administrateur
                    </option>
                  </select>
                </div>

<div>
  <label
    style={labelStyle}
  >
    Compteur récupération initial
  </label>

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
    style={
      inputStyle
    }
    placeholder="0"
  />
</div>




                <div
                  style={{
                    gridColumn:
                      "1 / -1",
                  }}
                >
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Adresse
                    e-mail *
                  </label>

                  <input
                    value={
                      email
                    }
                    onChange={(
                      e
                    ) =>
                      setEmail(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                  />

                  <div
                    style={{
                      color:
                        "#777",
                      fontSize:
                        11,
                      marginTop:
                        4,
                    }}
                  >
                    Générée
                    automatiquement
                    à partir du
                    prénom et du
                    nom.
                  </div>
                </div>

                <div>
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Rythme horaire *
                  </label>

                  <select
                    value={
                      profilSelectionne
                    }
                    onChange={(
                      e
                    ) =>
                      selectionnerProfil(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                  >
                    <option value="">
                      Sélectionner
                      un rythme...
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
                </div>

                <div>
                  <label
                    style={
                      labelStyle
                    }
                  >
                    Date de
                    début *
                  </label>

                  <input
                    type="date"
                    value={
                      dateDebut
                    }
                    onChange={(
                      e
                    ) =>
                      setDateDebut(
                        e.target
                          .value
                      )
                    }
                    style={
                      inputStyle
                    }
                  />
                </div>
              </div>

              {/* HORAIRES */}

              {profilFormulaire && (
                <div
                  style={{
                    marginTop:
                      24,
                    border:
                      "1px solid #ddd",
                    borderRadius:
                      8,
                    overflow:
                      "hidden",
                  }}
                >
                  <div
                    style={{
                      background:
                        "#f7f7f7",
                      padding:
                        "12px 15px",
                      fontWeight:
                        700,
                    }}
                  >
                    Répartition
                    hebdomadaire
                  </div>

                  <div
                    style={{
                      display:
                        "grid",
                      gridTemplateColumns:
                        "repeat(7, minmax(80px, 1fr))",
                      gap: 1,
                      background:
                        "#ddd",
                    }}
                  >
                    {JOURS.map(
                      (
                        jour
                      ) => (
                        <div
                          key={
                            jour.key
                          }
                          style={{
                            background:
                              "white",
                            padding:
                              10,
                          }}
                        >
                          <div
                            style={{
                              fontSize:
                                12,
                              color:
                                "#666",
                              marginBottom:
                                5,
                            }}
                          >
                            {
                              jour.label
                            }
                          </div>

                          <input
                            type="number"
                            min={
                              0
                            }
                            max={
                              24
                            }
                            step={
                              0.5
                            }
                            value={
                              horaires[
                                jour.key
                              ]
                            }
                            disabled={
                              !formulairePersonnalise
                            }
                            onChange={(
                              e
                            ) =>
                              setHoraires(
                                (
                                  ancien
                                ) => ({
                                  ...ancien,
                                  [jour.key]:
                                    Number(
                                      e
                                        .target
                                        .value
                                    ),
                                })
                              )
                            }
                            style={{
                              ...inputStyle,
                              background:
                                formulairePersonnalise
                                  ? "white"
                                  : "#f2f2f2",
                            }}
                          />
                        </div>
                      )
                    )}
                  </div>

                  <div
                    style={{
                      padding:
                        "10px 15px",
                      background:
                        "#fafafa",
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      fontSize:
                        13,
                    }}
                  >
                    <span>
                      Total
                      hebdomadaire
                    </span>

                    <strong>
                      {formatHeures(
                        totalHeuresProfil(
                          horaires
                        )
                      )}{" "}
                      h
                    </strong>
                  </div>

                  {!formulairePersonnalise && (
                    <div
                      style={{
                        padding:
                          "9px 15px",
                        color:
                          "#777",
                        fontSize:
                          12,
                        borderTop:
                          "1px solid #eee",
                      }}
                    >
                      Ce rythme
                      est
                      prédéfini.
                      Les
                      horaires
                      ne sont
                      pas
                      modifiables
                      ici.
                      Sélectionnez
                      «
                      Personnalisé
                      » pour
                      définir
                      un rythme
                      spécifique.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              style={
                modalFooterStyle
              }
            >
              <button
                onClick={() =>
                  setFormOuvert(
                    false
                  )
                }
                style={
                  buttonSecondary
                }
              >
                Annuler
              </button>

              <button
                onClick={
                  ajouterCollaborateur
                }
                style={
                  buttonPrimary
                }
              >
                Créer le
                collaborateur
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================
          MODALE PROGRAMMATION
      ====================================================== */}

      {rythmeOuvert &&
        collaborateurSelectionne && (
          <div
            style={
              overlayStyle
            }
          >
            <div
              style={{
                ...modalStyle,
                maxWidth: 950,
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
                    }}
                  >
                    Programmation
                    du rythme
                  </h2>

                  <div
                    style={{
                      color:
                        "#777",
                      fontSize:
                        13,
                      marginTop:
                        4,
                    }}
                  >
                    {
                      collaborateurSelectionne.trigramme
                    }{" "}
                    —{" "}
                    {
                      collaborateurSelectionne.prenom
                    }{" "}
                    {
                      collaborateurSelectionne.nom
                    }
                  </div>
                </div>

                <button
                  onClick={() => {
                    setRythmeOuvert(
                      false
                    );
                    setCollaborateurSelectionne(
                      null
                    );
                  }}
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
                {/* RYTHME ACTUEL */}

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
                      <div
                        style={{
                          background:
                            "#f7f7f7",
                          borderRadius:
                            8,
                          padding:
                            15,
                          marginBottom:
                            22,
                        }}
                      >
                        <div
                          style={{
                            fontSize:
                              12,
                            color:
                              "#777",
                            marginBottom:
                              4,
                          }}
                        >
                          Rythme actuellement
                          appliqué
                        </div>

                        <strong
                          style={{
                            fontSize:
                              17,
                          }}
                        >
                          {nomAfficheProfil(
                            actuel?.profil
                          )}
                        </strong>

                        {actuel?.profil && (
                          <div
                            style={{
                              fontSize:
                                13,
                              color:
                                "#666",
                              marginTop:
                                5,
                            }}
                          >
                            {formatHeures(
                              actuel
                                .profil
                                .lundi
                            )}{" "}
                            /{" "}
                            {formatHeures(
                              actuel
                                .profil
                                .mardi
                            )}{" "}
                            /{" "}
                            {formatHeures(
                              actuel
                                .profil
                                .mercredi
                            )}{" "}
                            /{" "}
                            {formatHeures(
                              actuel
                                .profil
                                .jeudi
                            )}{" "}
                            /{" "}
                            {formatHeures(
                              actuel
                                .profil
                                .vendredi
                            )}{" "}
                            /{" "}
                            {formatHeures(
                              actuel
                                .profil
                                .samedi
                            )}{" "}
                            /{" "}
                            {formatHeures(
                              actuel
                                .profil
                                .dimanche
                            )}
                          </div>
                        )}

                        {futur && (
                          <div
                            style={{
                              marginTop:
                                12,
                              padding:
                                "9px 11px",
                              background:
                                "#fff5e5",
                              border:
                                "1px solid #f0d39a",
                              borderRadius:
                                6,
                              fontSize:
                                13,
                            }}
                          >
                            <strong>
                              Prochain rythme
                            </strong>

                            <div
                              style={{
                                marginTop:
                                  3,
                              }}
                            >
                              {nomAfficheProfil(
                                futur.profil
                              )}{" "}
                              à partir du{" "}
                              <strong>
                                {formatDate(
                                  futur.date_debut
                                )}
                              </strong>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}

                <h3
                  style={{
                    margin:
                      "0 0 12px",
                    fontSize:
                      16,
                  }}
                >
                  Programmer un
                  nouveau rythme
                </h3>

                <div
                  style={
                    formGrid
                  }
                >
                  <div>
                    <label
                      style={
                        labelStyle
                      }
                    >
                      Nouveau
                      rythme
                    </label>

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
                  </div>

                  <div>
                    <label
                      style={
                        labelStyle
                      }
                    >
                      Applicable
                      à partir
                      du
                    </label>

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
                  </div>
                </div>

                {nouveauProfilObjet && (
                  <div
                    style={{
                      marginTop:
                        20,
                      border:
                        "1px solid #ddd",
                      borderRadius:
                        8,
                      overflow:
                        "hidden",
                    }}
                  >
                    <div
                      style={{
                        background:
                          "#f7f7f7",
                        padding:
                          "12px 15px",
                        fontWeight:
                          700,
                      }}
                    >
                      Nouveau rythme
                    </div>

                    <div
                      style={{
                        display:
                          "grid",
                        gridTemplateColumns:
                          "repeat(7, minmax(80px, 1fr))",
                        gap: 1,
                        background:
                          "#ddd",
                      }}
                    >
                      {JOURS.map(
                        (
                          jour
                        ) => (
                          <div
                            key={
                              jour.key
                            }
                            style={{
                              background:
                                "white",
                              padding:
                                10,
                            }}
                          >
                            <div
                              style={{
                                fontSize:
                                  12,
                                color:
                                  "#666",
                                marginBottom:
                                  5,
                              }}
                            >
                              {
                                jour.label
                              }
                            </div>

                            <input
                              type="number"
                              min={
                                0
                              }
                              max={
                                24
                              }
                              step={
                                0.5
                              }
                              value={
                                nouveauxHoraires[
                                  jour.key
                                ]
                              }
                              disabled={
                                !nouveauProfilPersonnalise
                              }
                              onChange={(
                                e
                              ) =>
                                setNouveauxHoraires(
                                  (
                                    ancien
                                  ) => ({
                                    ...ancien,
                                    [jour.key]:
                                      Number(
                                        e
                                          .target
                                          .value
                                      ),
                                  })
                                )
                              }
                              style={{
                                ...inputStyle,
                                background:
                                  nouveauProfilPersonnalise
                                    ? "white"
                                    : "#f2f2f2",
                              }}
                            />
                          </div>
                        )
                      )}
                    </div>

                    <div
                      style={{
                        padding:
                          "10px 15px",
                        background:
                          "#fafafa",
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        fontSize:
                          13,
                      }}
                    >
                      <span>
                        Total
                        hebdomadaire
                      </span>

                      <strong>
                        {formatHeures(
                          totalHeuresProfil(
                            nouveauxHoraires
                          )
                        )}{" "}
                        h
                      </strong>
                    </div>

                    {!nouveauProfilPersonnalise && (
                      <div
                        style={{
                          padding:
                            "9px 15px",
                          color:
                            "#777",
                          fontSize:
                            12,
                          borderTop:
                            "1px solid #eee",
                        }}
                      >
                        Ce rythme
                        est
                        prédéfini.
                        Les
                        horaires
                        ne sont
                        pas
                        modifiables.
                        Sélectionnez
                        «
                        Personnalisé
                        » pour
                        modifier
                        les jours.
                      </div>
                    )}
                  </div>
                )}

                {/* HISTORIQUE */}

                <div
                  style={{
                    marginTop:
                      30,
                  }}
                >
                  <h3
                    style={{
                      margin:
                        "0 0 12px",
                      fontSize:
                        16,
                    }}
                  >
                    Historique des
                    rythmes
                  </h3>

                  {(
                    collaborateurSelectionne.historique ??
                    []
                  ).length ===
                  0 ? (
                    <div
                      style={{
                        color:
                          "#777",
                        fontSize:
                          13,
                      }}
                    >
                      Aucun historique.
                    </div>
                  ) : (
                    <div
                      style={{
                        border:
                          "1px solid #ddd",
                        borderRadius:
                          7,
                        overflow:
                          "hidden",
                      }}
                    >
                      {(
                        collaborateurSelectionne.historique ??
                        []
                      ).map(
                        (
                          item,
                          index
                        ) => {
                          const aujourdHui =
                            dateInputToday();

                          const estFutur =
                            item.date_debut >
                            aujourdHui;

                          return (
                            <div
                              key={
                                item.id
                              }
                              style={{
                                padding:
                                  "12px 14px",
                                borderBottom:
                                  index <
                                  (collaborateurSelectionne
                                    .historique
                                    ?.length ??
                                    1) -
                                    1
                                    ? "1px solid #eee"
                                    : "none",
                                display:
                                  "flex",
                                alignItems:
                                  "center",
                                justifyContent:
                                  "space-between",
                                gap: 15,
                                background:
                                  estFutur
                                    ? "#fffaf0"
                                    : "white",
                              }}
                            >
                              <div>
                                <div
                                  style={{
                                    display:
                                      "flex",
                                    alignItems:
                                      "center",
                                    gap: 8,
                                  }}
                                >
                                  <strong>
                                    {nomAfficheProfil(
                                      item.profil
                                    )}
                                  </strong>

                                  {estFutur && (
                                    <span
                                      style={{
                                        background:
                                          "#fff0c9",
                                        color:
                                          "#8a6200",
                                        borderRadius:
                                          12,
                                        padding:
                                          "3px 8px",
                                        fontSize:
                                          11,
                                        fontWeight:
                                          700,
                                      }}
                                    >
                                      PROGRAMMÉ
                                    </span>
                                  )}
                                </div>

                                <div
                                  style={{
                                    color:
                                      "#777",
                                    fontSize:
                                      12,
                                    marginTop:
                                      3,
                                  }}
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
                                    style={{
                                      color:
                                        "#888",
                                      fontSize:
                                        11,
                                      marginTop:
                                        3,
                                    }}
                                  >
                                    {formatHeures(
                                      item
                                        .profil
                                        .lundi
                                    )}{" "}
                                    /{" "}
                                    {formatHeures(
                                      item
                                        .profil
                                        .mardi
                                    )}{" "}
                                    /{" "}
                                    {formatHeures(
                                      item
                                        .profil
                                        .mercredi
                                    )}{" "}
                                    /{" "}
                                    {formatHeures(
                                      item
                                        .profil
                                        .jeudi
                                    )}{" "}
                                    /{" "}
                                    {formatHeures(
                                      item
                                        .profil
                                        .vendredi
                                    )}{" "}
                                    /{" "}
                                    {formatHeures(
                                      item
                                        .profil
                                        .samedi
                                    )}{" "}
                                    /{" "}
                                    {formatHeures(
                                      item
                                        .profil
                                        .dimanche
                                    )}
                                  </div>
                                )}
                              </div>

                              <button
                                onClick={() =>
                                  supprimerProgrammation(
                                    item
                                  )
                                }
                                title="Supprimer cette programmation"
                                style={{
                                  border:
                                    "1px solid #ddd",
                                  background:
                                    "white",
                                  borderRadius:
                                    6,
                                  padding:
                                    "7px 10px",
                                  cursor:
                                    "pointer",
                                  fontSize:
                                    16,
                                }}
                              >
                                🗑️
                              </button>
                            </div>
                          );
                        }
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={
                  modalFooterStyle
                }
              >
                <button
                  onClick={() => {
                    setRythmeOuvert(
                      false
                    );
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
                  Programmer le
                  rythme
                </button>
              </div>
            </div>
          </div>
        )}
    </main>
  );
}

/* ============================================================
   STYLES
   ============================================================ */

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 12,
  color: "#666",
  fontWeight: 700,
  borderBottom:
    "1px solid #ddd",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "13px 14px",
  borderBottom:
    "1px solid #eee",
  fontSize: 14,
  verticalAlign:
    "middle",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing:
    "border-box",
  padding:
    "9px 10px",
  border:
    "1px solid #ccc",
  borderRadius: 6,
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

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(2, minmax(0, 1fr))",
  gap: 16,
};

const buttonPrimary: React.CSSProperties = {
  background: "#c00000",
  color: "white",
  border: "none",
  borderRadius: 6,
  padding:
    "10px 16px",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily:
    "Calibri, Arial, sans-serif",
};

const buttonSecondary: React.CSSProperties = {
  background: "white",
  color: "#333",
  border:
    "1px solid #ccc",
  borderRadius: 6,
  padding:
    "7px 11px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily:
    "Calibri, Arial, sans-serif",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background:
    "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems:
    "center",
  justifyContent:
    "center",
  padding: 20,
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 900,
  maxHeight: "92vh",
  background: "white",
  borderRadius: 10,
  overflow: "hidden",
  display: "flex",
  flexDirection:
    "column",
  boxShadow:
    "0 10px 40px rgba(0,0,0,0.25)",
};

const modalHeaderStyle: React.CSSProperties = {
  padding:
    "18px 22px",
  borderBottom:
    "1px solid #e5e5e5",
  display: "flex",
  justifyContent:
    "space-between",
  alignItems:
    "center",
};

const modalContentStyle: React.CSSProperties = {
  padding: 22,
  overflowY:
    "auto",
};

const modalFooterStyle: React.CSSProperties = {
  padding:
    "14px 22px",
  borderTop:
    "1px solid #e5e5e5",
  display: "flex",
  justifyContent:
    "flex-end",
  gap: 10,
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background:
    "transparent",
  fontSize: 28,
  lineHeight: 1,
  cursor: "pointer",
  color: "#666",
};