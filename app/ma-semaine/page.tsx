"use client";

import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { supabase } from "@/lib/supabase";

/* ============================================================
   TYPES
============================================================ */

type Presence =
  | "PRESENTIEL"
  | "TELETRAVAIL"
  | "ABSENT";

type TypeAffaire =
  | "CBE"
  | "DBE"
  | "Divers";

type CodeAffaire =
  | "EM"
  | "EE"
  | "CM"
  | "SC"
  | "MP"
  | "DT"
  | "RN"
  | "RL"
  | "RS"
  | "IF"
  | "IM"
  | "HA"
  | "DM"
  | "SU"
  | "HT"
  | "LI"
  | "EP"
  | "CO"
  | "BD"
  | "ET"
  | "TQ"
  | "NC";

type CodeDivers =
  | "FO"
  | "FI"
  | "NI"
  | "RN"
  | "IF";

type CodeAbsence =
  | ""
  | "CP"
  | "RE"
  | "ML"
  | "RTT"
  | "FE"
  | "AUTRE";

type DureeRTT =
  | "JOURNEE"
  | "DEMI_JOURNEE";

type Imputation = {
  id: string;
  typeAffaire: TypeAffaire;
  numeroAffaire: string;
  description: string;
  code:
    | CodeAffaire
    | CodeDivers
    | "";
  heures: string;
};

type JourSemaine = {
  date: string;
  jour: string;
  numeroJour: number;
  estWeekend: boolean;
  estFerie: boolean;
  heuresTheoriques: number;
  presence: Presence;
  absence: CodeAbsence;
  dureeRTT: DureeRTT;
  heuresRE: string;
  ticketRestaurant: boolean;
  imputations: Imputation[];
};

type Collaborateur = {
  id: string;
  trigramme: string;
  prenom: string;
  nom: string;
  email: string;
  actif: boolean;
  auth_user_id: string | null;
  compteur_recuperation: number;
};

/* ============================================================
   CODES AFFAIRES
============================================================ */

const CODES_AFFAIRES: {
  code: CodeAffaire;
  libelle: string;
}[] = [
  { code: "EM", libelle: "Etudes Mécaniques" },
  { code: "EE", libelle: "Etude électrique" },
  { code: "CM", libelle: "Calcul Mécanique" },
  { code: "SC", libelle: "Scan" },
  { code: "MP", libelle: "Mise en plan" },
  { code: "DT", libelle: "Devis technique" },
  { code: "RN", libelle: "Réunion" },
  { code: "RL", libelle: "Réalisation / Montage" },
  { code: "RS", libelle: "Relevé sur site" },
  { code: "IF", libelle: "Informatique" },
  { code: "IM", libelle: "Impression 3D" },
  { code: "HA", libelle: "Achat" },
  { code: "DM", libelle: "Dossier mécanique" },
  { code: "SU", libelle: "Suivi d'affaires" },
  { code: "HT", libelle: "Heure trajet" },
  { code: "LI", libelle: "Livraison" },
  { code: "EP", libelle: "Etude pneumatique" },
  { code: "CO", libelle: "Contrôle" },
  { code: "BD", libelle: "Base de donnée" },
  { code: "ET", libelle: "Expertise / Faisabilité" },
  { code: "TQ", libelle: "Tel Que Construit" },
  { code: "NC", libelle: "Non-conformité" },
];

const CODES_DIVERS: {
  code: CodeDivers;
  libelle: string;
}[] = [
  { code: "FO", libelle: "Formation externe" },
  { code: "FI", libelle: "Formation interne / accueil" },
  { code: "NI", libelle: "Non imputable" },
  { code: "RN", libelle: "Réunion hebdomadaire BE" },
  { code: "IF", libelle: "Informatique / développement" },
];

/* ============================================================
   OUTILS
============================================================ */

function formatHeures(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function convertirHeures(value: string) {
  if (!value.trim()) {
    return 0;
  }

  const nombre = Number(
    value.replace(",", ".")
  );

  if (!Number.isFinite(nombre)) {
    return 0;
  }

  return nombre;
}

function dateISO(date: Date) {
  const annee = date.getFullYear();

  const mois = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const jour = String(
    date.getDate()
  ).padStart(2, "0");

  return `${annee}-${mois}-${jour}`;
}

function dateAffichage(date: string) {
  const morceaux =
    date.split("-").map(Number);

  const annee = morceaux[0];
  const mois = morceaux[1];
  const jour = morceaux[2];

  return new Date(
    annee,
    mois - 1,
    jour
  ).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function numeroSemaine(date: Date) {
  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  d.setDate(
    d.getDate() +
      3 -
      ((d.getDay() + 6) % 7)
  );

  const semaine1 = new Date(
    d.getFullYear(),
    0,
    4
  );

  return (
    1 +
    Math.round(
      (
        (
          d.getTime() -
          semaine1.getTime()
        ) /
          86400000 -
        3 +
        ((semaine1.getDay() + 6) % 7)
      ) / 7
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

  return `Semaine du ${debut.toLocaleDateString(
    "fr-FR"
  )} au ${fin.toLocaleDateString(
    "fr-FR"
  )} - S${String(
    numeroSemaine(debut)
  ).padStart(2, "0")}`;
}

function nomJour(date: Date) {
  const texte =
    date.toLocaleDateString(
      "fr-FR",
      {
        weekday: "long",
      }
    );

  return (
    texte.charAt(0).toUpperCase() +
    texte.slice(1)
  );
}

function estWeekend(date: Date) {
  const jour = date.getDay();

  return (
    jour === 0 ||
    jour === 6
  );
}

/* ============================================================
   PAQUES / JOURS FERIES
============================================================ */

function calculerPaques(
  annee: number
) {
  const a = annee % 19;

  const b = Math.floor(
    annee / 100
  );

  const c = annee % 100;

  const d = Math.floor(
    b / 4
  );

  const e = b % 4;

  const f = Math.floor(
    (b + 8) / 25
  );

  const g = Math.floor(
    (b - f + 1) / 3
  );

  const h =
    (19 * a +
      b -
      d -
      g +
      15) %
    30;

  const i = Math.floor(
    c / 4
  );

  const k = c % 4;

  const l =
    (32 +
      2 * e +
      2 * i -
      h -
      k) %
    7;

  const m = Math.floor(
    (a +
      11 * h +
      22 * l) /
      451
  );

  const mois = Math.floor(
    (h +
      l -
      7 * m +
      114) /
      31
  );

  const jour =
    ((h +
      l -
      7 * m +
      114) %
      31) +
    1;

  return new Date(
    annee,
    mois - 1,
    jour
  );
}

function ajouterJours(
  date: Date,
  nombre: number
) {
  const resultat =
    new Date(date);

  resultat.setDate(
    resultat.getDate() +
      nombre
  );

  return resultat;
}

function joursFeriesFrancais(
  annee: number
) {
  const paques =
    calculerPaques(annee);

  const dates = [
    new Date(annee, 0, 1),
    ajouterJours(paques, 1),
    new Date(annee, 4, 1),
    new Date(annee, 4, 8),
    ajouterJours(paques, 39),
    ajouterJours(paques, 50),
    new Date(annee, 6, 14),
    new Date(annee, 7, 15),
    new Date(annee, 10, 1),
    new Date(annee, 10, 11),
    new Date(annee, 11, 25),
  ];

  return new Set(
    dates.map(dateISO)
  );
}

/* ============================================================
   CREATION SEMAINE
============================================================ */

function creerSemaine(
  dateReference: Date
): JourSemaine[] {
  const debut = new Date(
    dateReference.getFullYear(),
    dateReference.getMonth(),
    dateReference.getDate()
  );

  const jour = debut.getDay();

  const decalage =
    jour === 0
      ? -6
      : 1 - jour;

  debut.setDate(
    debut.getDate() +
      decalage
  );

  const joursFeries =
    joursFeriesFrancais(
      debut.getFullYear()
    );

  return Array.from(
    { length: 7 },
    (_, index) => {
      const date =
        new Date(debut);

      date.setDate(
        debut.getDate() +
          index
      );

      const iso =
        dateISO(date);

      const weekend =
        estWeekend(date);

      const ferie =
        joursFeries.has(iso);

      return {
        date: iso,

        jour: nomJour(date),

        numeroJour: index,

        estWeekend: weekend,

        estFerie: ferie,

        heuresTheoriques:
          index < 4
            ? 7.5
            : index === 4
              ? 5
              : 0,

        presence:
          ferie
            ? "ABSENT"
            : "PRESENTIEL",

        absence:
          ferie
            ? "FE"
            : "",

        dureeRTT:
          "JOURNEE",

        heuresRE: "",

        ticketRestaurant:
          !weekend &&
          !ferie,

        imputations: [],
      };
    }
  );
}

/* ============================================================
   ABSENCES
============================================================ */

function absenceTotale(
  absence: CodeAbsence,
  dureeRTT?: DureeRTT
) {
  return (
    absence === "CP" ||
    absence === "ML" ||
    absence === "FE" ||
    absence === "AUTRE" ||
    (
      absence === "RTT" &&
      dureeRTT === "JOURNEE"
    )
  );
}

function imputationsInterdites(
  jour: JourSemaine
) {
  return absenceTotale(
    jour.absence,
    jour.dureeRTT
  );
}

function libelleAbsence(
  absence: CodeAbsence
) {
  switch (absence) {
    case "CP":
      return "CP — Congés payés";

    case "RE":
      return "RE — Récupération";

    case "ML":
      return "ML — Maladie";

    case "RTT":
      return "RTT";

    case "FE":
      return "FE — Jour férié";

    case "AUTRE":
      return "AUTRE";

    default:
      return "Aucune absence";
  }
}

/* ============================================================
   CALCUL HEURES
============================================================ */

function totalImputations(
  jour: JourSemaine
) {
  return jour.imputations.reduce(
    (
      total,
      ligne
    ) =>
      total +
      convertirHeures(
        ligne.heures
      ),
    0
  );
}

function cibleTravailJour(
  jour: JourSemaine
) {
  if (jour.estWeekend) {
    return 0;
  }

  if (
    jour.absence === "CP" ||
    jour.absence === "ML" ||
    jour.absence === "FE" ||
    jour.absence === "AUTRE"
  ) {
    return 0;
  }

  if (jour.absence === "RE") {
    return Math.max(
      0,
      jour.heuresTheoriques -
        convertirHeures(
          jour.heuresRE
        )
    );
  }

  if (jour.absence === "RTT") {
    if (
      jour.dureeRTT ===
      "DEMI_JOURNEE"
    ) {
      return (
        jour.heuresTheoriques /
        2
      );
    }

    return 0;
  }

  return jour.heuresTheoriques;
}

/* ============================================================
   PAGE
============================================================ */

export default function MaSemainePage() {
  const searchParams =
    useSearchParams();

  const collaborateurIdUrl =
    searchParams.get(
      "collaborateur"
    );

  const semaineUrl =
    searchParams.get(
      "semaine"
    );

  const [
    semaine,
    setSemaine,
  ] = useState<JourSemaine[]>(
    () =>
      creerSemaine(
        new Date()
      )
  );

  const [
    collaborateur,
    setCollaborateur,
  ] =
    useState<Collaborateur | null>(
      null
    );

  const [
    chargement,
    setChargement,
  ] = useState(true);

  const [
    enregistrement,
    setEnregistrement,
  ] = useState(false);

  const [
    semaineEnregistree,
    setSemaineEnregistree,
  ] = useState(false);

  const [
    weekendOuvert,
    setWeekendOuvert,
  ] = useState(false);

  const [
    aideOuverte,
    setAideOuverte,
  ] = useState(true);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    messageType,
    setMessageType,
  ] = useState<
    "OK" | "DANGER" | ""
  >("");

  /* ============================================================
     CHARGER COLLABORATEUR
  ============================================================ */

  useEffect(() => {
    async function chargerCollaborateur() {
      setChargement(true);

      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      if (!user) {
        setMessage(
          "Aucun utilisateur connecté."
        );

        setMessageType("DANGER");
        setChargement(false);

        return;
      }

      const requete = supabase
        .from("collaborateurs")
        .select("*");

      const {
        data,
        error,
      } = collaborateurIdUrl
        ? await requete
            .eq(
              "id",
              collaborateurIdUrl
            )
            .single()
        : await requete
            .eq(
              "auth_user_id",
              user.id
            )
            .single();

      if (error) {
        setMessage(
          `Impossible de charger le collaborateur connecté : ${error.message}`
        );

        setMessageType("DANGER");
        setChargement(false);

        return;
      }

      if (!data) {
        setMessage(
          "Aucun collaborateur associé à l'utilisateur connecté."
        );

        setMessageType("DANGER");
        setChargement(false);

        return;
      }

      const collaborateurCharge =
        data as Collaborateur;

      setCollaborateur(
        collaborateurCharge
      );

      const semaineACharger =
        semaineUrl ??
        semaine[0].date;

      if (semaineUrl) {
        setSemaine(
          creerSemaine(
            new Date(
              `${semaineACharger}T00:00:00`
            )
          )
        );
      }

      await chargerSemaineExistante(
        collaborateurCharge.id,
        semaineACharger
      );

      setChargement(false);
    }

    chargerCollaborateur();
  }, []);

  /* ============================================================
     TOTAUX
  ============================================================ */

  const totalHeuresSemaine =
    useMemo(() => {
      return semaine.reduce(
        (
          total,
          jour
        ) =>
          total +
          totalImputations(
            jour
          ),
        0
      );
    }, [semaine]);

  const totalHeuresTheoriques =
    useMemo(() => {
      return semaine.reduce(
        (
          total,
          jour
        ) =>
          total +
          cibleTravailJour(
            jour
          ),
        0
      );
    }, [semaine]);

  const heuresSupplementaires =
    totalHeuresSemaine -
    totalHeuresTheoriques;

  const totalRE =
    useMemo(() => {
      return semaine.reduce(
        (
          total,
          jour
        ) =>
          total +
          convertirHeures(
            jour.heuresRE
          ),
        0
      );
    }, [semaine]);

  const compteurInitial =
    collaborateur
      ?.compteur_recuperation ??
    0;

  const compteurFinal =
    compteurInitial -
    totalRE;

  const compteurDepasse =
    compteurFinal < -30 ||
    compteurFinal > 30;

  const heuresManquantes =
    Math.max(
      0,
      totalHeuresTheoriques -
        totalHeuresSemaine
    );

  const totalTickets =
    semaine.filter(
      jour =>
        jour.ticketRestaurant
    ).length;

  /* ============================================================
     MODIFIER JOUR
  ============================================================ */

  function modifierJour(
    date: string,
    modification: Partial<JourSemaine>
  ) {
    setSemaine(
      ancienne =>
        ancienne.map(
          jour =>
            jour.date === date
              ? {
                  ...jour,
                  ...modification,
                }
              : jour
        )
    );

    setSemaineEnregistree(
      false
    );
  }

  /* ============================================================
     PRESENCE
  ============================================================ */

  function changerPresence(
    date: string,
    presence: Presence
  ) {
    modifierJour(
      date,
      {
        presence,
      }
    );
  }

  /* ============================================================
     ABSENCE
  ============================================================ */

  function changerAbsence(
    jour: JourSemaine,
    absence: CodeAbsence
  ) {
    if (
      absence === "FE" &&
      !jour.estFerie
    ) {
      return;
    }

    const estAbsent =
      absenceTotale(
        absence,
        jour.dureeRTT
      );

    let ticket =
      jour.ticketRestaurant;

    if (estAbsent) {
      ticket = false;
    }

    if (absence === "RTT") {
      ticket =
        jour.dureeRTT ===
        "DEMI_JOURNEE";
    }

    if (absence === "RE") {
      ticket =
        !jour.estWeekend;
    }

    if (absence === "") {
      ticket =
        !jour.estWeekend;
    }

    modifierJour(
      jour.date,
      {
        absence,

        presence:
          estAbsent
            ? "ABSENT"
            : jour.presence ===
                "ABSENT"
              ? "PRESENTIEL"
              : jour.presence,

        ticketRestaurant:
          ticket,

        heuresRE:
          absence === "RE"
            ? jour.heuresRE
            : "",

        dureeRTT:
          absence === "RTT"
            ? jour.dureeRTT
            : "JOURNEE",

        imputations:
          absenceTotale(
            absence,
            jour.dureeRTT
          )
            ? []
            : jour.imputations,
      }
    );
  }

  /* ============================================================
     JOUR FERIE
  ============================================================ */

  function basculerJourFerie(
    jour: JourSemaine
  ) {
    if (!jour.estFerie) {
      return;
    }

    if (
      jour.absence === "FE"
    ) {
      modifierJour(
        jour.date,
        {
          absence: "",
          presence: "PRESENTIEL",
          ticketRestaurant: true,
        }
      );

      return;
    }

    modifierJour(
      jour.date,
      {
        absence: "FE",
        presence: "ABSENT",
        ticketRestaurant: false,
        imputations: [],
        heuresRE: "",
      }
    );
  }

  /* ============================================================
     IMPUTATIONS
  ============================================================ */

  function ajouterImputation(
    jour: JourSemaine
  ) {
    if (
      imputationsInterdites(
        jour
      )
    ) {
      return;
    }

    const nouvelleLigne: Imputation =
      {
        id:
          `${Date.now()}-` +
          Math.random()
            .toString(36)
            .slice(2),

        typeAffaire: "CBE",

        numeroAffaire: "",

        description: "",

        code: "",

        heures: "",
      };

    modifierJour(
      jour.date,
      {
        imputations: [
          ...jour.imputations,
          nouvelleLigne,
        ],
      }
    );
  }

  function supprimerImputation(
    jour: JourSemaine,
    id: string
  ) {
    modifierJour(
      jour.date,
      {
        imputations:
          jour.imputations.filter(
            ligne =>
              ligne.id !== id
          ),
      }
    );
  }

  function modifierImputation(
    jour: JourSemaine,
    id: string,
    modification: Partial<Imputation>
  ) {
    modifierJour(
      jour.date,
      {
        imputations:
          jour.imputations.map(
            ligne =>
              ligne.id === id
                ? {
                    ...ligne,
                    ...modification,
                  }
                : ligne
          ),
      }
    );
  }

  /* ============================================================
     RTT
  ============================================================ */

  function changerDureeRTT(
    jour: JourSemaine,
    duree: DureeRTT
  ) {
    modifierJour(
      jour.date,
      {
        dureeRTT: duree,

        presence:
          duree === "JOURNEE"
            ? "ABSENT"
            : "PRESENTIEL",

        ticketRestaurant:
          duree ===
            "DEMI_JOURNEE" &&
          !jour.estWeekend,
      }
    );
  }

  /* ============================================================
     NAVIGATION
  ============================================================ */

  function semainePrecedente() {
    const date =
      new Date(
        `${semaine[0].date}T00:00:00`
      );

    date.setDate(
      date.getDate() - 7
    );

    const nouvelleSemaine =
      creerSemaine(date);

    setSemaine(
      nouvelleSemaine
    );

    if (collaborateur) {
      chargerSemaineExistante(
        collaborateur.id,
        nouvelleSemaine[0].date
      );
    }

    setMessage("");
    setMessageType("");
    setSemaineEnregistree(false);
  }

  function semaineSuivante() {
    const date =
      new Date(
        `${semaine[0].date}T00:00:00`
      );

    date.setDate(
      date.getDate() + 7
    );

    const nouvelleSemaine =
      creerSemaine(date);

    setSemaine(
      nouvelleSemaine
    );

    if (collaborateur) {
      chargerSemaineExistante(
        collaborateur.id,
        nouvelleSemaine[0].date
      );
    }

    setMessage("");
    setMessageType("");
    setSemaineEnregistree(false);
  }

  /* ============================================================
     VALIDATION
  ============================================================ */

  function verifierSemaine(): boolean {
    setMessage("");
    setMessageType("");

    for (const jour of semaine) {
      if (
        jour.absence === "RE"
      ) {
        const heuresRE =
          convertirHeures(
            jour.heuresRE
          );

        if (heuresRE <= 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : une récupération (RE) doit obligatoirement être renseignée en heures.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }

        if (
          heuresRE >
          jour.heuresTheoriques
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : la récupération ne peut pas dépasser ${formatHeures(
              jour.heuresTheoriques
            )} h.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }
      }

      if (
        jour.absence ===
          "RTT" &&
        jour.dureeRTT ===
          "DEMI_JOURNEE"
      ) {
        if (
          totalImputations(
            jour
          ) <= 0
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : un RTT d'une demi-journée doit être complété par des heures travaillées.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }
      }

      if (
        imputationsInterdites(
          jour
        )
      ) {
        continue;
      }

      for (const ligne of jour.imputations) {
        const heures =
          convertirHeures(
            ligne.heures
          );

        if (
          ligne.typeAffaire !==
            "Divers" &&
          ligne.numeroAffaire &&
          !/^\d{4}$/.test(
            ligne.numeroAffaire
          )
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : le numéro d'affaire doit comporter exactement 4 chiffres.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }

        if (
          ligne.heures &&
          ligne.typeAffaire !==
            "Divers" &&
          (
            !ligne.code ||
            !/^\d{4}$/.test(
              ligne.numeroAffaire
            )
          )
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : impossible de saisir des heures sans code affaire et numéro d'affaire sur 4 chiffres.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }

        if (
          ligne.heures &&
          ligne.typeAffaire ===
            "Divers" &&
          !ligne.code
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : impossible de saisir des heures sans sélectionner un code Divers.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }

        if (heures < 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : le nombre d'heures ne peut pas être négatif.`
          );

          setMessageType(
            "DANGER"
          );

          return false;
        }
      }
    }

    if (compteurDepasse) {
      setMessage(
        `Attention : le compteur de récupération serait de ${formatHeures(
          compteurFinal
        )} h. La limite autorisée est de -30 h à +30 h.`
      );

      setMessageType(
        "DANGER"
      );

      return false;
    }

    if (
      heuresManquantes >
      0.01
    ) {
      setMessage(
        `Attention : il manque ${formatHeures(
          heuresManquantes
        )} h par rapport aux heures théoriques de la semaine.`
      );

      setMessageType(
        "DANGER"
      );
    } else {
      setMessage(
        "La semaine est correctement renseignée. Vous pouvez maintenant l'enregistrer."
      );

      setMessageType(
        "OK"
      );
    }

    return true;
  }

  /* ============================================================
     CHARGEMENT SEMAINE EXISTANTE
  ============================================================ */

  async function chargerSemaineExistante(
    collaborateurId: string,
    semaineDebut: string
  ) {
    if (!supabase) {
      return;
    }

    try {
      const {
        data: feuille,
        error: erreurFeuille,
      } = await supabase
        .from("feuilles_heures")
        .select("id")
        .eq(
          "collaborateur_id",
          collaborateurId
        )
        .eq(
          "semaine_debut",
          semaineDebut
        )
        .maybeSingle();

      if (erreurFeuille) {
        throw erreurFeuille;
      }

      if (!feuille) {
        setSemaine(
          creerSemaine(
            new Date(
              `${semaineDebut}T00:00:00`
            )
          )
        );

        setSemaineEnregistree(
          false
        );

        return;
      }

      const {
        data: jours,
        error: erreurJours,
      } = await supabase
        .from(
          "feuilles_heures_jours"
        )
        .select("*")
        .eq(
          "feuille_id",
          feuille.id
        );

      if (erreurJours) {
        throw erreurJours;
      }

      const jourIds =
        (jours ?? []).map(
          j => j.id
        );

      const {
        data: imputations,
        error:
          erreurImputations,
      } = await supabase
        .from(
          "feuilles_heures_imputations"
        )
        .select("*")
        .in(
          "jour_id",
          jourIds
        );

      if (erreurImputations) {
        throw erreurImputations;
      }

      const semaineChargee =
        creerSemaine(
          new Date(
            `${semaineDebut}T00:00:00`
          )
        );

      for (
        const jour of semaineChargee
      ) {
        const jourDB =
          jours?.find(
            j =>
              j.date_jour ===
              jour.date
          );

        if (!jourDB) {
          continue;
        }

        jour.presence =
          jourDB.presence;

        jour.absence =
          jourDB.absence ?? "";

        jour.dureeRTT =
          jourDB.duree_rtt ??
          "JOURNEE";

        jour.heuresRE =
          jourDB.heures_re?.toString() ??
          "";

        jour.ticketRestaurant =
          jourDB.ticket_restaurant;

        jour.imputations =
          (imputations ?? [])
            .filter(
              i =>
                i.jour_id ===
                jourDB.id
            )
            .map(i => ({
              id:
                crypto.randomUUID(),

              typeAffaire:
                i.type_affaire,

              numeroAffaire:
                i.numero_affaire ??
                "",

              description:
                i.description ??
                "",

              code:
                i.code ?? "",

              heures:
                i.heures?.toString() ??
                "",
            }));
      }

      setSemaine(
        semaineChargee
      );

      setSemaineEnregistree(
        true
      );
    } catch (error) {
      console.error(
        "Erreur chargement semaine",
        error
      );
    }
  }

  /* ============================================================
     ENREGISTREMENT SUPABASE
  ============================================================ */

  async function enregistrerSemaine() {
    if (!collaborateur) {
      setMessage(
        "Le collaborateur n'est pas chargé."
      );

      setMessageType(
        "DANGER"
      );

      return;
    }

    const valide =
      verifierSemaine();

    if (!valide) {
      return;
    }

    setEnregistrement(true);

    setMessage(
      "Enregistrement de la semaine..."
    );

    setMessageType("OK");

    try {
      const semaineDebut =
        semaine[0].date;

      const {
        data:
          feuilleExistante,
        error:
          erreurRecherche,
      } = await supabase
        .from(
          "feuilles_heures"
        )
        .select("id")
        .eq(
          "collaborateur_id",
          collaborateur.id
        )
        .eq(
          "semaine_debut",
          semaineDebut
        )
        .maybeSingle();

      if (erreurRecherche) {
        throw erreurRecherche;
      }

      let feuilleId: string;

      if (feuilleExistante) {
        feuilleId =
          feuilleExistante.id;

        const {
          error:
            erreurSuppressionJours,
        } =
          await supabase
            .from(
              "feuilles_heures_jours"
            )
            .delete()
            .eq(
              "feuille_id",
              feuilleId
            );

        if (
          erreurSuppressionJours
        ) {
          throw erreurSuppressionJours;
        }

        const {
          error:
            erreurUpdate,
        } =
          await supabase
            .from(
              "feuilles_heures"
            )
            .update({
              statut:
                "A_TRAITER",

              total_heures:
                totalHeuresSemaine,

              total_theorique:
                totalHeuresTheoriques,

              heures_supplementaires:
                heuresSupplementaires,

              total_re:
                totalRE,

              compteur_avant:
                compteurInitial,

              compteur_apres:
                compteurFinal,

              updated_at:
                new Date().toISOString(),
            })
            .eq(
              "id",
              feuilleId
            );

        if (erreurUpdate) {
          throw erreurUpdate;
        }
      } else {
        const {
          data:
            nouvelleFeuille,
          error:
            erreurCreation,
        } =
          await supabase
            .from(
              "feuilles_heures"
            )
            .insert({
              collaborateur_id:
                collaborateur.id,

              semaine_debut:
                semaineDebut,

              date_debut_semaine:
                semaineDebut,

              statut:
                "A_TRAITER",

              total_heures:
                totalHeuresSemaine,

              total_theorique:
                totalHeuresTheoriques,

              heures_supplementaires:
                heuresSupplementaires,

              total_re:
                totalRE,

              compteur_avant:
                compteurInitial,

              compteur_apres:
                compteurFinal,
            })
            .select("id")
            .single();

        if (erreurCreation) {
          throw erreurCreation;
        }

        if (!nouvelleFeuille) {
          throw new Error(
            "La feuille n'a pas pu être créée."
          );
        }

        feuilleId =
          nouvelleFeuille.id;
      }

      /* --------------------------------------------------------
         JOURNEES
      -------------------------------------------------------- */

      const joursAInserer =
        semaine.map(
          jour => ({
            feuille_id:
              feuilleId,

            date_jour:
              jour.date,

            heures_theoriques:
              jour.heuresTheoriques,

            presence:
              jour.presence,

            absence:
              jour.absence,

            duree_rtt:
              jour.dureeRTT,

            heures_re:
              convertirHeures(
                jour.heuresRE
              ),

            ticket_restaurant:
              jour.ticketRestaurant,

            total_heures:
              totalImputations(
                jour
              ),
          })
        );

      const {
        data:
          joursCrees,
        error:
          erreurJours,
      } =
        await supabase
          .from(
            "feuilles_heures_jours"
          )
          .insert(
            joursAInserer
          )
          .select(
            "id,date_jour"
          );

      if (erreurJours) {
        throw erreurJours;
      }

      if (!joursCrees) {
        throw new Error(
          "Les journées n'ont pas pu être enregistrées."
        );
      }

      /* --------------------------------------------------------
         IMPUTATIONS
      -------------------------------------------------------- */

      const imputationsAInserer: {
        jour_id: string;

        type_affaire:
          | TypeAffaire;

        numero_affaire:
          | string
          | null;

        description:
          | string
          | null;

        code: string;

        heures: number;
      }[] = [];

      for (
        const jour of semaine
      ) {
        const jourDB =
          joursCrees.find(
            j =>
              j.date_jour ===
              jour.date
          );

        if (!jourDB) {
          throw new Error(
            `Impossible de retrouver le jour ${jour.date}.`
          );
        }

        for (
          const ligne of
            jour.imputations
        ) {
          if (
            !ligne.code &&
            !ligne.heures &&
            !ligne.numeroAffaire &&
            !ligne.description
          ) {
            continue;
          }

          imputationsAInserer.push({
            jour_id:
              jourDB.id,

            type_affaire:
              ligne.typeAffaire,

            numero_affaire:
              ligne.typeAffaire ===
              "Divers"
                ? null
                : ligne.numeroAffaire ||
                  null,

            description:
              ligne.description ||
              null,

            code:
              ligne.code,

            heures:
              convertirHeures(
                ligne.heures
              ),
          });
        }
      }

      if (
        imputationsAInserer.length >
        0
      ) {
        const {
          error:
            erreurImputations,
        } =
          await supabase
            .from(
              "feuilles_heures_imputations"
            )
            .insert(
              imputationsAInserer
            );

        if (
          erreurImputations
        ) {
          throw erreurImputations;
        }
      }

      /*
       * Le compteur collaborateur
       * n'est pas encore modifié ici.
       */

      setSemaineEnregistree(
        true
      );

      setMessage(
        `Semaine du ${dateAffichage(
          semaineDebut
        )} enregistrée avec succès.`
      );

      setMessageType("OK");
    } catch (error) {
      console.error(error);

      const texte =
        error instanceof Error
          ? error.message
          : "Erreur inconnue";

      setMessage(
        `Impossible d'enregistrer la semaine : ${texte}`
      );

      setMessageType(
        "DANGER"
      );

      setSemaineEnregistree(
        false
      );
    } finally {
      setEnregistrement(
        false
      );
    }
  }

  /* ============================================================
     CHARGEMENT
  ============================================================ */

  if (chargement) {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <div style={styles.headerInner}>
            <div>
              <div style={styles.logo}>
                POLYNOV
              </div>

              <div
                style={styles.subtitle}
              >
                Gestion des temps &
                activités
              </div>
            </div>
          </div>
        </header>

        <div style={styles.loadingCard}>
          <div style={styles.spinner} />
          <div>
            Chargement de votre
            semaine...
          </div>
        </div>
      </main>
    );
  }

  /* ============================================================
     RENDER
  ============================================================ */

  return (
    <main style={styles.page}>
      {/* ======================================================
          HEADER
      ====================================================== */}

      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <button
              onClick={() =>
                window.location.href =
                  "/dashboard"
              }
              style={
                styles.headerBackButton
              }
            >
              ← Retour au tableau de
              bord
            </button>

            <div style={styles.logo}>
              POLYNOV
            </div>

            <div
              style={styles.subtitle}
            >
              Gestion des temps &
              activités
            </div>
          </div>

          {collaborateur && (
            <div
              style={
                styles.collaborateurHeader
              }
            >
              <div
                style={
                  styles.collaborateurTrigramme
                }
              >
                {collaborateur.trigramme}
              </div>

              <div>
                {collaborateur.prenom}{" "}
                {collaborateur.nom}
              </div>
            </div>
          )}
        </div>
      </header>

      <div style={styles.container}>
        {/* ====================================================
            INTRODUCTION
        ==================================================== */}

        <div style={styles.intro}>
          <div
            style={styles.eyebrow}
          >
            FEUILLE D'HEURES
          </div>

          <h1 style={styles.pageTitle}>
            Ma semaine
          </h1>

          <p style={styles.pageDescription}>
            Saisissez vos heures,
            vos absences et vos
            imputations d'affaires
            pour la semaine.
          </p>
        </div>

        {/* ====================================================
            NAVIGATION
        ==================================================== */}

        <div
          style={styles.navigation}
        >
          <button
            onClick={
              semainePrecedente
            }
            style={
              styles.buttonSecondary
            }
          >
            ← Semaine précédente
          </button>

          <div
            style={
              styles.navigationCenter
            }
          >
            <div
              style={
                styles.weekBadge
              }
            >
              S
              {String(
                numeroSemaine(
                  new Date(
                    `${semaine[0].date}T00:00:00`
                  )
                )
              ).padStart(2, "0")}
            </div>

            <div
              style={
                styles.navigationDates
              }
            >
              Du{" "}
              {new Date(
                `${semaine[0].date}T00:00:00`
              ).toLocaleDateString(
                "fr-FR"
              )}{" "}
              au{" "}
              {new Date(
                `${semaine[6].date}T00:00:00`
              ).toLocaleDateString(
                "fr-FR"
              )}
            </div>

            <div
              style={
                styles.navigationSummary
              }
            >
              {formatHeures(
                totalHeuresSemaine
              )}{" "}
              h saisies{" "}
              <span>/</span>{" "}
              {formatHeures(
                totalHeuresTheoriques
              )}{" "}
              h à travailler
            </div>
          </div>

          <button
            onClick={
              semaineSuivante
            }
            style={
              styles.buttonSecondary
            }
          >
            Semaine suivante →
          </button>
        </div>

        {/* ====================================================
            COMPTEURS
        ==================================================== */}

        <div style={styles.cards}>
          {/* HEURES SAISIES */}

          <div style={styles.card}>
            <div
              style={styles.cardLabel}
            >
              HEURES SAISIES
            </div>

            <div
              style={styles.cardValue}
            >
              {formatHeures(
                totalHeuresSemaine
              )}{" "}
              h
            </div>

            <div
              style={styles.cardHint}
            >
              Total des heures
              imputées sur la semaine.
            </div>
          </div>

          {/* HEURES SUPPLEMENTAIRES */}

          <div style={styles.card}>
            <div
              style={styles.cardLabel}
            >
              HEURES SUPPLÉMENTAIRES
            </div>

            <div
              style={{
                ...styles.cardValue,
                color:
                  heuresSupplementaires >
                  0
                    ? "#138113"
                    : heuresSupplementaires <
                        0
                      ? "#c00000"
                      : "#333",
              }}
            >
              {heuresSupplementaires >
              0
                ? "+"
                : ""}
              {formatHeures(
                heuresSupplementaires
              )}{" "}
              h
            </div>

            <div
              style={styles.cardHint}
            >
              Écart entre les heures
              saisies et la cible
              théorique.
            </div>
          </div>

          {/* COMPTEUR */}

          <div
            style={{
              ...styles.card,
              border:
                compteurDepasse
                  ? "1px solid #d88"
                  : "1px solid #e3e3e3",
            }}
          >
            <div
              style={styles.cardLabel}
            >
              COMPTEUR RÉCUPÉRATION
            </div>

            <div
              style={{
                ...styles.cardValue,
                color:
                  compteurDepasse
                    ? "#c00000"
                    : "#333",
              }}
            >
              {compteurFinal > 0
                ? "+"
                : ""}
              {formatHeures(
                compteurFinal
              )}{" "}
              h
            </div>

            <div
              style={styles.gauge}
            >
              <div
                style={
                  styles.gaugeTrack
                }
              />

              <div
                style={{
                  ...styles.gaugeMarker,
                  left: `${Math.min(
                    100,
                    Math.max(
                      0,
                      ((compteurFinal +
                        30) /
                        60) *
                        100
                    )
                  )}%`,
                }}
              />
            </div>

            <div
              style={
                styles.gaugeLabels
              }
            >
              <span>-30 h</span>
              <span>0</span>
              <span>+30 h</span>
            </div>

            {compteurDepasse && (
              <div
                style={styles.warning}
              >
                ⚠ Limite de ±30 h
                dépassée
              </div>
            )}
          </div>

          {/* TICKETS */}

          <div style={styles.card}>
            <div
              style={styles.cardLabel}
            >
              TICKETS RESTAURANT
            </div>

            <div
              style={{
                ...styles.cardValue,
                fontSize: 32,
                color: "#222",
              }}
            >
              {totalTickets}
            </div>

            <div
              style={styles.cardHint}
            >
              Nombre de tickets
              prévus pour la semaine.
            </div>
          </div>
        </div>

        {/* ====================================================
            TABLEAU
        ==================================================== */}

        <div style={styles.table}>
          <div
            style={styles.tableHeader}
          >
            <div
              style={styles.dayHeader}
            >
              Jour
            </div>

            <div
              style={
                styles.imputationHeader
              }
            >
              Imputations / absences
            </div>

            <div
              style={
                styles.presenceHeader
              }
            >
              Présence
            </div>

            <div
              style={
                styles.ticketHeader
              }
            >
              Ticket restaurant
            </div>
          </div>

          {semaine
            .filter(
              jour =>
                !jour.estWeekend ||
                weekendOuvert
            )
            .map(jour => {
              const verrouille =
                imputationsInterdites(
                  jour
                );

              const heuresJour =
                totalImputations(
                  jour
                );

              const absent =
                jour.presence ===
                "ABSENT";

              const lignePaire =
                jour.numeroJour %
                  2 ===
                0;

              return (
                <div
                  key={jour.date}
                  style={{
                    ...styles.dayBlock,
                    background:
                      jour.estFerie &&
                      jour.absence ===
                        "FE"
                        ? "#eeeeee"
                        : lignePaire
                          ? "#ffffff"
                          : "#fcfcfc",
                  }}
                >
                  <div
                    style={
                      styles.dayGrid
                    }
                  >
                    {/* JOUR */}

                    <div
                      style={{
                        ...styles.dayCell,
                        background:
                          jour.estFerie &&
                          jour.absence ===
                            "FE"
                            ? "#e7e7e7"
                            : lignePaire
                              ? "#fafafa"
                              : "#f5f5f5",
                      }}
                    >
                      <div
                        style={
                          styles.dayName
                        }
                      >
                        {jour.jour}
                      </div>

                      <div
                        style={
                          styles.dayDate
                        }
                      >
                        {dateAffichage(
                          jour.date
                        )}
                      </div>

                      <div
                        style={
                          styles.dayHours
                        }
                      >
                        <strong
                          style={
                            styles.dayHoursStrong
                          }
                        >
                          {formatHeures(
                            heuresJour
                          )}{" "}
                          h
                        </strong>
                      </div>
                    </div>

                    {/* IMPUTATIONS */}

                    <div
                      style={
                        styles.imputationCell
                      }
                    >
                      <div
                        style={
                          styles.absenceBar
                        }
                      >
                        <div
                          style={
                            styles.sectionLabel
                          }
                        >
                          Absence
                        </div>

                        <select
                          value={
                            jour.absence
                          }
                          disabled={
                            jour.estFerie &&
                            jour.absence !==
                              "FE"
                          }
                          onChange={e =>
                            changerAbsence(
                              jour,
                              e.target
                                .value as CodeAbsence
                            )
                          }
                          style={{
                            ...styles.input,
                            maxWidth: 250,
                            background:
                              jour.absence ===
                              "FE"
                                ? "#e9e9e9"
                                : "#fff",
                          }}
                        >
                          <option value="">
                            Aucune absence
                          </option>

                          <option value="CP">
                            CP — Congés payés
                          </option>

                          <option value="RE">
                            RE — Récupération
                          </option>

                          <option value="ML">
                            ML — Maladie
                          </option>

                          <option value="RTT">
                            RTT
                          </option>

                          <option value="AUTRE">
                            AUTRE
                          </option>
                        </select>

                        {jour.estFerie && (
                          <label
                            style={
                              styles.ferieToggle
                            }
                          >
                            <input
                              type="checkbox"
                              checked={
                                jour.absence ===
                                "FE"
                              }
                              onChange={() =>
                                basculerJourFerie(
                                  jour
                                )
                              }
                            />

                            Jour férié
                            (FE)
                          </label>
                        )}
                      </div>

                      {/* RE */}

                      {jour.absence ===
                        "RE" && (
                        <div
                          style={
                            styles.reBox
                          }
                        >
                          <strong>
                            Récupération :
                          </strong>

                          <input
                            value={
                              jour.heuresRE
                            }
                            inputMode="decimal"
                            placeholder="ex. 2,0"
                            onChange={e =>
                              modifierJour(
                                jour.date,
                                {
                                  heuresRE:
                                    e.target.value.replace(
                                      /[^0-9.,]/g,
                                      ""
                                    ),
                                }
                              )
                            }
                            style={{
                              ...styles.input,
                              width: 100,
                            }}
                          />

                          <span>
                            h à débiter du
                            compteur
                          </span>
                        </div>
                      )}

                      {/* RTT */}

                      {jour.absence ===
                        "RTT" && (
                        <div
                          style={
                            styles.rttBox
                          }
                        >
                          <strong>
                            RTT :
                          </strong>

                          <select
                            value={
                              jour.dureeRTT
                            }
                            onChange={e =>
                              changerDureeRTT(
                                jour,
                                e.target
                                  .value as DureeRTT
                              )
                            }
                            style={{
                              ...styles.input,
                              width: 160,
                            }}
                          >
                            <option value="JOURNEE">
                              Journée
                            </option>

                            <option value="DEMI_JOURNEE">
                              1/2 journée
                            </option>
                          </select>

                          <span>
                            {jour.dureeRTT ===
                            "DEMI_JOURNEE"
                              ? `Il reste ${formatHeures(
                                  jour.heuresTheoriques /
                                    2
                                )} h à travailler.`
                              : "Journée non travaillée."}
                          </span>
                        </div>
                      )}

                      {/* ABSENCE TOTALE */}

                      {jour.absence &&
                        jour.absence !==
                          "RE" &&
                        jour.absence !==
                          "RTT" && (
                          <div
                            style={
                              styles.absenceInfo
                            }
                          >
                            <strong>
                              {libelleAbsence(
                                jour.absence
                              )}
                            </strong>

                            {" — "}

                            aucune imputation
                            d'heures sur
                            cette journée.
                          </div>
                        )}

                      {/* LIGNES */}

                      {!verrouille &&
                        jour.imputations.map(
                          ligne => (
                            <div
                              key={
                                ligne.id
                              }
                              style={
                                styles.imputationRow
                              }
                            >
                              {/* TYPE */}

                              <select
                                value={
                                  ligne.typeAffaire
                                }
                                onChange={e =>
                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      typeAffaire:
                                        e.target
                                          .value as TypeAffaire,

                                      numeroAffaire:
                                        e.target
                                          .value ===
                                        "Divers"
                                          ? ""
                                          : ligne.numeroAffaire,

                                      code:
                                        e.target
                                          .value ===
                                        "Divers"
                                          ? ""
                                          : ligne.code,
                                    }
                                  )
                                }
                                style={
                                  styles.input
                                }
                              >
                                <option value="CBE">
                                  CBE
                                </option>

                                <option value="DBE">
                                  DBE
                                </option>

                                <option value="Divers">
                                  Divers
                                </option>
                              </select>

                              {/* NUMERO */}

                              <input
                                value={
                                  ligne.numeroAffaire
                                }
                                maxLength={4}
                                disabled={
                                  ligne.typeAffaire ===
                                  "Divers"
                                }
                                inputMode="numeric"
                                placeholder={
                                  ligne.typeAffaire ===
                                  "Divers"
                                    ? "—"
                                    : "0000"
                                }
                                onChange={e =>
                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      numeroAffaire:
                                        e.target.value
                                          .replace(
                                            /\D/g,
                                            ""
                                          )
                                          .slice(
                                            0,
                                            4
                                          ),
                                    }
                                  )
                                }
                                style={
                                  styles.input
                                }
                              />

                              {/* DESCRIPTION */}

                              <input
                                value={
                                  ligne.description
                                }
                                placeholder="Description de l'affaire"
                                onChange={e =>
                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      description:
                                        e.target
                                          .value,
                                    }
                                  )
                                }
                                style={
                                  styles.input
                                }
                              />

                              {/* CODE */}

                              <select
                                value={
                                  ligne.code
                                }
                                onChange={e =>
                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      code:
                                        e.target
                                          .value as
                                          | CodeAffaire
                                          | CodeDivers
                                          | "",
                                    }
                                  )
                                }
                                style={
                                  styles.input
                                }
                              >
                                <option value="">
                                  Code affaire...
                                </option>

                                {ligne.typeAffaire ===
                                "Divers"
                                  ? CODES_DIVERS.map(
                                      code => (
                                        <option
                                          key={
                                            code.code
                                          }
                                          value={
                                            code.code
                                          }
                                        >
                                          {
                                            code.code
                                          }{" "}
                                          —{" "}
                                          {
                                            code.libelle
                                          }
                                        </option>
                                      )
                                    )
                                  : CODES_AFFAIRES.map(
                                      code => (
                                        <option
                                          key={
                                            code.code
                                          }
                                          value={
                                            code.code
                                          }
                                        >
                                          {
                                            code.code
                                          }{" "}
                                          —{" "}
                                          {
                                            code.libelle
                                          }
                                        </option>
                                      )
                                    )}
                              </select>

                              {/* HEURES */}

                              <input
                                value={
                                  ligne.heures
                                }
                                inputMode="decimal"
                                placeholder="0,0"
                                onChange={e =>
                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      heures:
                                        e.target.value.replace(
                                          /[^0-9.,]/g,
                                          ""
                                        ),
                                    }
                                  )
                                }
                                style={
                                  styles.input
                                }
                              />

                              {/* SUPPRESSION */}

                              <button
                                onClick={() =>
                                  supprimerImputation(
                                    jour,
                                    ligne.id
                                  )
                                }
                                title="Supprimer l'imputation"
                                style={
                                  styles.deleteButton
                                }
                              >
                                ×
                              </button>
                            </div>
                          )
                        )}

                      {!verrouille && (
                        <button
                          onClick={() =>
                            ajouterImputation(
                              jour
                            )
                          }
                          style={
                            styles.addButton
                          }
                        >
                          + Ajouter une
                          imputation
                        </button>
                      )}
                    </div>

                    {/* PRESENCE */}

                    <div
                      style={
                        styles.presenceCell
                      }
                    >
                      <select
                        value={
                          jour.presence
                        }
                        disabled={absent}
                        onChange={e =>
                          changerPresence(
                            jour.date,
                            e.target
                              .value as Presence
                          )
                        }
                        style={{
                          ...styles.input,
                          background:
                            absent
                              ? "#fff0f0"
                              : jour.presence ===
                                  "TELETRAVAIL"
                                ? "#fff8e7"
                                : "#edf8ef",

                          borderColor:
                            absent
                              ? "#e0aaaa"
                              : jour.presence ===
                                  "TELETRAVAIL"
                                ? "#dfc777"
                                : "#acd2b0",

                          color:
                            absent
                              ? "#c00000"
                              : jour.presence ===
                                  "TELETRAVAIL"
                                ? "#806400"
                                : "#138113",

                          fontWeight: 700,
                        }}
                      >
                        <option value="PRESENTIEL">
                          Présentiel
                        </option>

                        <option value="TELETRAVAIL">
                          Télétravail
                        </option>

                        <option value="ABSENT">
                          Absent
                        </option>
                      </select>

                      <div
                        style={{
                          ...styles.presenceBand,
                          background:
                            absent
                              ? "#d98b8b"
                              : jour.presence ===
                                  "TELETRAVAIL"
                                ? "#d5b62e"
                                : "#70ad70",
                        }}
                      />
                    </div>

                    {/* TICKET */}

                    <div
                      style={
                        styles.ticketCell
                      }
                    >
                      <label
                        style={{
                          ...styles.ticketLabel,
                          color:
                            jour.ticketRestaurant
                              ? "#333"
                              : "#999",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            jour.ticketRestaurant
                          }
                          disabled={absent}
                          onChange={e =>
                            modifierJour(
                              jour.date,
                              {
                                ticketRestaurant:
                                  e.target
                                    .checked,
                              }
                            )
                          }
                        />

                        Ticket
                      </label>

                      {!absent && (
                        <div
                          style={
                            styles.ticketHint
                          }
                        >
                          Décochez si invité
                          par le client ou
                          payé avec la CB
                          POLYNOV.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

          {/* WEEK-END */}

          <div
            style={
              styles.weekendToggle
            }
          >
            <button
              onClick={() =>
                setWeekendOuvert(
                  value => !value
                )
              }
              style={
                styles.buttonSecondary
              }
            >
              {weekendOuvert
                ? "Masquer le week-end"
                : "Afficher le week-end"}
            </button>
          </div>
        </div>

        {/* ====================================================
            ACTIONS
        ==================================================== */}

        <div
          style={
            styles.bottomActions
          }
        >
          <button
            onClick={
              verifierSemaine
            }
            style={
              styles.buttonSecondary
            }
          >
            Vérifier ma semaine
          </button>

          <button
            onClick={
              enregistrerSemaine
            }
            disabled={
              enregistrement
            }
            style={{
              ...styles.buttonPrimary,
              opacity:
                enregistrement
                  ? 0.6
                  : 1,
            }}
          >
            {enregistrement
              ? "Enregistrement..."
              : semaineEnregistree
                ? "✓ Semaine enregistrée"
                : "Enregistrer ma semaine"}
          </button>
        </div>

        {/* ====================================================
            ALERTE HEURES MANQUANTES
        ==================================================== */}

        {heuresManquantes >
          0.01 && (
          <div
            style={
              styles.missingHoursAlert
            }
          >
            <div
              style={
                styles.alertIcon
              }
            >
              !
            </div>

            <div>
              <strong>
                Heures manquantes
              </strong>

              <div>
                Il manque{" "}
                {formatHeures(
                  heuresManquantes
                )}{" "}
                h par rapport aux
                heures théoriques de
                la semaine.
              </div>
            </div>
          </div>
        )}

        {/* ====================================================
            MESSAGE
        ==================================================== */}

        {message && (
          <div
            style={{
              ...styles.message,
              ...(messageType ===
              "DANGER"
                ? styles.messageDanger
                : styles.messageOk),
            }}
          >
            <div
              style={
                styles.messageIcon
              }
            >
              {messageType ===
              "DANGER"
                ? "!"
                : "✓"}
            </div>

            <div>{message}</div>
          </div>
        )}

        {/* ====================================================
            AIDE
        ==================================================== */}

        {aideOuverte && (
          <aside
            style={styles.help}
          >
            <div
              style={
                styles.helpHeader
              }
            >
              <div>
                <div
                  style={
                    styles.helpTitle
                  }
                >
                  Aide à la saisie
                </div>

                <div
                  style={
                    styles.helpSubtitle
                  }
                >
                  Quelques rappels pour
                  renseigner correctement
                  votre feuille.
                </div>
              </div>

              <button
                onClick={() =>
                  setAideOuverte(
                    false
                  )
                }
                style={
                  styles.helpClose
                }
              >
                ×
              </button>
            </div>

            <div
              style={
                styles.helpGrid
              }
            >
              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Affaire
                </strong>

                <p>
                  Choisissez CBE ou
                  DBE, puis saisissez le
                  numéro à 4 chiffres et
                  la description de
                  l'affaire.
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Divers
                </strong>

                <p>
                  Utilisez Divers pour
                  les heures FO, FI, NI,
                  RN ou IF qui ne sont
                  pas imputées sur une
                  affaire.
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Récupération RE
                </strong>

                <p>
                  Indiquez le nombre
                  d'heures à débiter du
                  compteur. Les heures
                  réellement travaillées
                  restent imputables sur
                  les affaires.
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  RTT
                </strong>

                <p>
                  Un RTT peut être pris
                  à la journée ou en
                  demi-journée. Pour un
                  demi-RTT, saisissez les
                  heures travaillées pour
                  compléter la journée.
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Présence
                </strong>

                <p>
                  Présentiel en vert,
                  télétravail en jaune,
                  absence en rouge. CP,
                  ML, FE et AUTRE passent
                  automatiquement en
                  « Absent ».
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Ticket restaurant
                </strong>

                <p>
                  Le ticket est proposé
                  automatiquement lorsqu'il
                  y a du travail. Décochez-le
                  si vous avez été invité
                  par le client ou si vous
                  avez payé avec la carte
                  bleue POLYNOV.
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Heures
                </strong>

                <p>
                  Vous pouvez saisir
                  7,5 ou 7.5. Vous pouvez
                  créer autant de lignes
                  d'imputation que
                  nécessaire.
                </p>
              </div>

              <div
                style={
                  styles.helpItem
                }
              >
                <strong>
                  Jour férié
                </strong>

                <p>
                  Un jour férié est
                  automatiquement marqué
                  FE et verrouillé.
                  Décochez FE si vous avez
                  réellement travaillé ce
                  jour-là.
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

/* ============================================================
   STYLES
============================================================ */

const styles: Record<
  string,
  CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#f4f4f4",
    fontFamily:
      "Calibri, Arial, sans-serif",
    color: "#222",
  },

  /* ----------------------------------------------------------
     HEADER
  ---------------------------------------------------------- */

  header: {
    background: "#c00000",
    color: "white",
    boxShadow:
      "0 2px 8px rgba(0,0,0,.12)",
  },

  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
    minHeight: 100,
    padding: "14px 30px",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    position: "relative",
  },

  headerBackButton: {
    background:
      "rgba(255,255,255,.14)",
    border:
      "1px solid rgba(255,255,255,.35)",
    color: "white",
    borderRadius: 7,
    padding: "7px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily:
      "Calibri, Arial, sans-serif",
    marginBottom: 8,
  },

  logo: {
    fontSize: 32,
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: "-.5px",
  },

  subtitle: {
    fontSize: 14,
    marginTop: 4,
    opacity: 0.92,
  },

  collaborateurHeader: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform:
      "translate(-50%, -50%)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 25,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  collaborateurTrigramme: {
    background:
      "rgba(255,255,255,.18)",
    border:
      "1px solid rgba(255,255,255,.32)",
    borderRadius: 7,
    padding: "5px 8px",
    fontSize: 12,
    letterSpacing: ".5px",
  },

  /* ----------------------------------------------------------
     CONTENU
  ---------------------------------------------------------- */

  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding:
      "26px 30px 60px",
  },

  intro: {
    marginBottom: 20,
  },

  eyebrow: {
    color: "#c00000",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "1px",
    marginBottom: 4,
  },

  pageTitle: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.1,
    fontWeight: 800,
    color: "#222",
  },

  pageDescription: {
    margin:
      "7px 0 0",
    color: "#666",
    fontSize: 14,
    lineHeight: 1.45,
  },

  /* ----------------------------------------------------------
     CHARGEMENT
  ---------------------------------------------------------- */

  loadingCard: {
    maxWidth: 600,
    margin: "50px auto",
    padding: 28,
    background: "#fff",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    boxShadow:
      "0 2px 8px rgba(0,0,0,.06)",
    textAlign: "center",
    fontSize: 16,
    color: "#555",
  },

  spinner: {
    width: 28,
    height: 28,
    border:
      "3px solid #eee",
    borderTop:
      "3px solid #c00000",
    borderRadius: "50%",
    margin:
      "0 auto 12px",
    animation:
      "polynovSpin .8s linear infinite",
  },

  /* ----------------------------------------------------------
     NAVIGATION
  ---------------------------------------------------------- */

  navigation: {
    background: "#fff",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    padding: "14px 16px",
    marginBottom: 16,
    boxShadow:
      "0 2px 7px rgba(0,0,0,.05)",
    display: "grid",
    gridTemplateColumns:
      "1fr auto 1fr",
    alignItems: "center",
    gap: 20,
  },

  navigationCenter: {
    textAlign: "center",
    minWidth: 300,
  },

  weekBadge: {
    display: "inline-block",
    color: "#c00000",
    fontSize: 30,
    fontWeight: 800,
    lineHeight: 1,
  },

  navigationDates: {
    color: "#555",
    fontSize: 13,
    fontWeight: 700,
    marginTop: 5,
  },

  navigationSummary: {
    color: "#888",
    fontSize: 12,
    marginTop: 4,
  },

  /* ----------------------------------------------------------
     BOUTONS
  ---------------------------------------------------------- */

  buttonPrimary: {
    background: "#c00000",
    color: "white",
    border: "none",
    borderRadius: 7,
    padding: "10px 17px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 14,
    boxShadow:
      "0 2px 4px rgba(192,0,0,.15)",
  },

  buttonSecondary: {
    background: "#fff",
    color: "#333",
    border:
      "1px solid #d2d2d2",
    borderRadius: 7,
    padding: "9px 13px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily:
      "Calibri, Arial, sans-serif",
    fontSize: 13,
  },

  /* ----------------------------------------------------------
     COMPTEURS
  ---------------------------------------------------------- */

  cards: {
    display: "grid",
    gridTemplateColumns:
      "repeat(4, 1fr)",
    gap: 14,
    marginBottom: 16,
  },

  card: {
    background: "#fff",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    padding: 16,
    minHeight: 105,
    boxShadow:
      "0 2px 7px rgba(0,0,0,.045)",
  },

  cardLabel: {
    color: "#777",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: ".6px",
    marginBottom: 7,
  },

  cardValue: {
    fontSize: 25,
    fontWeight: 800,
    lineHeight: 1.1,
  },

  cardHint: {
    color: "#888",
    fontSize: 11,
    lineHeight: 1.3,
    marginTop: 6,
  },

  /* ----------------------------------------------------------
     JAUGE
  ---------------------------------------------------------- */

  gauge: {
    position: "relative",
    height: 8,
    marginTop: 12,
  },

  gaugeTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 8,
    background: "#ededed",
    borderRadius: 20,
  },

  gaugeMarker: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#c00000",
    transform:
      "translateX(-50%)",
    boxShadow:
      "0 1px 4px rgba(0,0,0,.2)",
  },

  gaugeLabels: {
    display: "flex",
    justifyContent:
      "space-between",
    color: "#888",
    fontSize: 10,
    marginTop: 5,
  },

  warning: {
    color: "#c00000",
    fontSize: 11,
    fontWeight: 700,
    marginTop: 6,
  },

  /* ----------------------------------------------------------
     TABLEAU
  ---------------------------------------------------------- */

  table: {
    background: "#fff",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    overflowX: "auto",
    boxShadow:
      "0 2px 8px rgba(0,0,0,.06)",
  },

  tableHeader: {
    display: "grid",
    gridTemplateColumns:
      "145px minmax(560px, 1fr) 150px 150px",
    minWidth: 1005,
    borderBottom:
      "1px solid #ddd",
    background: "#f7f7f7",
    fontWeight: 800,
    fontSize: 11,
    textTransform:
      "uppercase",
    letterSpacing: ".5px",
    color: "#666",
  },

  dayHeader: {
    padding: 13,
    textAlign: "center",
  },

  imputationHeader: {
    padding: 13,
  },

  presenceHeader: {
    padding: 13,
  },

  ticketHeader: {
    padding: 13,
  },

  dayBlock: {
    minWidth: 1005,
    borderBottom:
      "1px solid #e2e2e2",
  },

  dayGrid: {
    display: "grid",
    gridTemplateColumns:
      "145px minmax(560px, 1fr) 150px 150px",
    minHeight: 120,
  },

  /* ----------------------------------------------------------
     JOUR
  ---------------------------------------------------------- */

  dayCell: {
    padding: 13,
    borderRight:
      "1px solid #ddd",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },

  dayName: {
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.1,
  },

  dayDate: {
    fontSize: 12,
    color: "#777",
    marginTop: 4,
  },

  dayHours: {
    marginTop: "auto",
    paddingTop: 10,
  },

  dayHoursStrong: {
    display: "inline-block",
    minWidth: 82,
    padding: "7px 10px",
    borderRadius: 7,
    background: "#c00000",
    color: "#fff",
    fontSize: 19,
    fontWeight: 800,
    boxShadow:
      "0 2px 5px rgba(0,0,0,.13)",
  },

  /* ----------------------------------------------------------
     IMPUTATIONS
  ---------------------------------------------------------- */

  imputationCell: {
    padding: 11,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: 800,
    color: "#777",
  },

  absenceBar: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
    paddingBottom: 9,
    marginBottom: 9,
    borderBottom:
      "1px solid #eee",
  },

  ferieToggle: {
    fontSize: 12,
    color: "#666",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 9px",
    border:
      "1px solid #ccc",
    borderRadius: 6,
    fontSize: 13,
    fontFamily:
      "Calibri, Arial, sans-serif",
    minWidth: 0,
    background: "#fff",
    color: "#222",
    outline: "none",
  },

  imputationRow: {
    display: "grid",
    gridTemplateColumns:
      "72px 68px minmax(140px, 1fr) 185px 72px 34px",
    gap: 6,
    alignItems: "center",
    marginBottom: 7,
    padding: "7px 7px 7px 8px",
    background: "#fafafa",
    border:
      "1px solid #ededed",
    borderLeft:
      "3px solid #c00000",
    borderRadius: 6,
  },

  deleteButton: {
    width: 32,
    height: 32,
    border:
      "1px solid #ddd",
    background: "#fff",
    borderRadius: 6,
    cursor: "pointer",
    color: "#c00000",
    fontWeight: 800,
    fontSize: 18,
    lineHeight: 1,
  },

  addButton: {
    border:
      "1px dashed #bbb",
    background: "#fff",
    borderRadius: 6,
    padding: "7px 12px",
    cursor: "pointer",
    fontSize: 12,
    color: "#555",
    marginTop: 2,
    fontWeight: 600,
  },

  absenceInfo: {
    background: "#fff0f0",
    border:
      "1px solid #efc0c0",
    borderLeft:
      "4px solid #c00000",
    borderRadius: 6,
    padding: "8px 10px",
    color: "#a00000",
    fontSize: 12,
    marginBottom: 9,
  },

  reBox: {
    background: "#fff8e7",
    border:
      "1px solid #ead7a0",
    borderLeft:
      "4px solid #c8a63b",
    borderRadius: 6,
    padding: 8,
    marginBottom: 9,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  rttBox: {
    background: "#f7f3ff",
    border:
      "1px solid #ddd3f2",
    borderLeft:
      "4px solid #8b70b9",
    borderRadius: 6,
    padding: 8,
    marginBottom: 9,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  /* ----------------------------------------------------------
     PRESENCE
  ---------------------------------------------------------- */

  presenceCell: {
    padding: 11,
    borderLeft:
      "1px solid #eee",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },

  presenceBand: {
    marginTop: 7,
    height: 5,
    borderRadius: 10,
  },

  /* ----------------------------------------------------------
     TICKET
  ---------------------------------------------------------- */

  ticketCell: {
    padding: 11,
    borderLeft:
      "1px solid #eee",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },

  ticketLabel: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: 600,
  },

  ticketHint: {
    color: "#888",
    fontSize: 10,
    marginTop: 6,
    lineHeight: 1.25,
  },

  /* ----------------------------------------------------------
     WEEK-END
  ---------------------------------------------------------- */

  weekendToggle: {
    padding: 12,
    borderTop:
      "1px solid #ddd",
    textAlign: "center",
    background: "#fafafa",
  },

  /* ----------------------------------------------------------
     ACTIONS
  ---------------------------------------------------------- */

  bottomActions: {
    display: "flex",
    justifyContent:
      "flex-end",
    gap: 10,
    marginTop: 16,
  },

  /* ----------------------------------------------------------
     ALERTES
  ---------------------------------------------------------- */

  missingHoursAlert: {
    background: "#fff8e7",
    border:
      "1px solid #ead7a0",
    borderLeft:
      "5px solid #c00000",
    color: "#6b5600",
    borderRadius: 8,
    padding: "11px 14px",
    marginTop: 16,
    display: "flex",
    gap: 11,
    alignItems: "center",
    fontSize: 13,
    lineHeight: 1.35,
  },

  alertIcon: {
    width: 25,
    height: 25,
    borderRadius: "50%",
    background: "#c00000",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    flexShrink: 0,
  },

  message: {
    borderRadius: 8,
    padding: "11px 14px",
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    lineHeight: 1.35,
  },

  messageIcon: {
    width: 25,
    height: 25,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 800,
    flexShrink: 0,
  },

  messageDanger: {
    background: "#fff8e7",
    border:
      "1px solid #ead7a0",
    color: "#6b5600",
  },

  messageOk: {
    background: "#edf8ef",
    border:
      "1px solid #b9dfbf",
    color: "#176b22",
  },

  /* ----------------------------------------------------------
     AIDE
  ---------------------------------------------------------- */

  help: {
    background: "#fff",
    border:
      "1px solid #e3e3e3",
    borderTop:
      "4px solid #c00000",
    borderRadius: 10,
    padding: 18,
    marginTop: 20,
    boxShadow:
      "0 2px 7px rgba(0,0,0,.045)",
  },

  helpHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  helpTitle: {
    fontWeight: 800,
    fontSize: 16,
    color: "#333",
  },

  helpSubtitle: {
    color: "#888",
    fontSize: 12,
    marginTop: 3,
  },

  helpClose: {
    width: 28,
    height: 28,
    border:
      "1px solid #d5d5d5",
    background: "#fff",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 18,
    color: "#666",
    lineHeight: 1,
  },

  helpGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(4, 1fr)",
    gap: 12,
    fontSize: 12,
  },

  helpItem: {
    background: "#fafafa",
    border:
      "1px solid #ededed",
    borderRadius: 7,
    padding: 12,
  },
};

/* ============================================================
   ANIMATION
============================================================ */

if (
  typeof document !== "undefined" &&
  !document.getElementById(
    "polynov-ma-semaine-styles"
  )
) {
  const style =
    document.createElement(
      "style"
    );

  style.id =
    "polynov-ma-semaine-styles";

  style.innerHTML = `
    @keyframes polynovSpin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    button:hover {
      filter: brightness(0.97);
    }

    input:focus,
    select:focus {
      border-color: #c00000 !important;
      box-shadow: 0 0 0 2px rgba(192,0,0,.08);
      outline: none;
    }
  `;

  document.head.appendChild(
    style
  );
}