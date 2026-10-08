"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { supabase } from "@/lib/supabase";
export const dynamic = "force-dynamic";

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

type CodeAbsence = string;

type Activite = {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
  ordre_affichage: number;
};

type ActiviteCode = {
  activite_id: string;
  code: string;
};

type CodeImputation = {
  code: string;
  libelle: string;
  categorie: string;
  type_affaire_autorise: string | null;
  vendable: boolean;
  actif: boolean;
  autorise_affaire: boolean;
  autorise_devis: boolean;
  autorise_divers: boolean;
  historique_uniquement: boolean;
  remarques_metier: string | null;
  type_code: string | null;
  ordre_affichage: number | null;
  historique: boolean;
};

type DureeRTT =
  | "JOURNEE"
  | "DEMI_JOURNEE";

type DureeCP =
  | "JOURNEE"
  | "DEMI_JOURNEE";

type Imputation = {
  id: string;
  typeAffaire: TypeAffaire;
  activiteId: string | null;
  numeroAffaire: string;
  description: string;
  code: string;
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
  heuresAbsence: string;
  dureeCP: DureeCP;
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
  profil_horaire_id: string | null;
  rythme: string | null;
  compteur_recuperation: number | null;
};

type HorairesSemaine = {
  lundi: number;
  mardi: number;
  mercredi: number;
  jeudi: number;
  vendredi: number;
};

const HORAIRES_DEFAUT: HorairesSemaine = {
  lundi: 7.5,
  mardi: 7.5,
  mercredi: 7.5,
  jeudi: 7.5,
  vendredi: 5,
};

/* ============================================================
   CODES D'IMPUTATION
============================================================ */

const CODE_RE = "RE";
const CODE_RT = "RT";
const CODE_FE = "FE";
const CODE_CP = "CP";
const ABSENCES_AVEC_HEURES = new Set(["VM", "AI", "AA"]);

function normaliserCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function libelleAbsence(
  absence: CodeAbsence,
  codes: CodeImputation[]
) {
  if (!absence) return "Aucune absence";

  const config = codes.find(
    item => normaliserCode(item.code) === normaliserCode(absence)
  );

  if (config) return `${config.code} — ${config.libelle}`;
  return absence === "AUTRE" ? "AUTRE" : absence;
}

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


/* ============================================================
   CALENDRIER / CLÔTURE MENSUELLE
============================================================ */

function ajouterJoursISO(date: string, nombre: number) {
  const [annee, mois, jour] = date.split("-").map(Number);
  const d = new Date(annee, mois - 1, jour);
  d.setDate(d.getDate() + nombre);
  return dateISO(d);
}

function dernierJourDuMois(annee: number, moisZeroBase: number) {
  return new Date(annee, moisZeroBase + 1, 0);
}

/**
 * Vendredi de clôture du mois :
 * - lundi à jeudi : vendredi suivant
 * - vendredi : le jour même
 * - samedi/dimanche : vendredi précédent
 *
 * Ainsi, si le 31 tombe un jeudi, la clôture est bien le vendredi suivant.
 */
function dateClotureMensuelle(annee: number, moisZeroBase: number) {
  const dernier = dernierJourDuMois(annee, moisZeroBase);
  const jourSemaine = dernier.getDay(); // 0 = dimanche ... 6 = samedi
  const vendredi = new Date(dernier);

  if (jourSemaine >= 1 && jourSemaine <= 4) {
    vendredi.setDate(dernier.getDate() + (5 - jourSemaine));
  } else if (jourSemaine === 5) {
    vendredi.setDate(dernier.getDate());
  } else {
    vendredi.setDate(dernier.getDate() - (jourSemaine === 6 ? 1 : 2));
  }

  return dateISO(vendredi);
}

function debutSemaineISO(dateISOValue: string) {
  const [annee, mois, jour] = dateISOValue.split("-").map(Number);
  const date = new Date(annee, mois - 1, jour);
  const jourSemaine = date.getDay();

  const decalage =
    jourSemaine === 0
      ? -6
      : 1 - jourSemaine;

  date.setDate(date.getDate() + decalage);

  return dateISO(date);
}

function trouverPeriodeClotureMensuelle(vendrediISO: string) {
  const [anneeBase, moisBase, jourBase] = vendrediISO.split("-").map(Number);
  const dateVendredi = new Date(anneeBase, moisBase - 1, jourBase);

  let meilleurePeriode: {
    annee: number;
    moisZeroBase: number;
    dateCloture: string;
    dateCloturePrecedente: string;
    libelleMois: string;
  } | null = null;

  /*
   * Cette fonction sert à déterminer la période mensuelle à laquelle
   * appartient la semaine affichée.
   *
   * IMPORTANT :
   * elle NE dit PAS que la semaine affichée est la semaine de clôture.
   * Une semaine comme S41 peut très bien être rattachée à octobre alors
   * que sa clôture n'interviendra qu'en S44.
   */
  for (let decalage = -1; decalage <= 2; decalage += 1) {
    const candidat = new Date(
      dateVendredi.getFullYear(),
      dateVendredi.getMonth() + decalage,
      1
    );

    const annee = candidat.getFullYear();
    const moisZeroBase = candidat.getMonth();
    const cloture = dateClotureMensuelle(annee, moisZeroBase);

    if (cloture < vendrediISO) continue;

    if (
      !meilleurePeriode ||
      cloture < meilleurePeriode.dateCloture
    ) {
      const moisCourant = new Date(annee, moisZeroBase, 1);
      const moisPrecedent = new Date(annee, moisZeroBase - 1, 1);
      const cloturePrecedente = dateClotureMensuelle(
        moisPrecedent.getFullYear(),
        moisPrecedent.getMonth()
      );

      meilleurePeriode = {
        annee,
        moisZeroBase,
        dateCloture: cloture,
        dateCloturePrecedente: cloturePrecedente,
        libelleMois: moisCourant.toLocaleDateString("fr-FR", {
          month: "long",
          year: "numeric",
        }),
      };
    }
  }

  return meilleurePeriode;
}

/**
 * La fenêtre de répartition ne doit apparaître QUE sur la semaine
 * qui contient le vendredi de clôture.
 *
 * Exemple octobre 2026 :
 * - fin de mois : samedi 31/10
 * - vendredi de clôture : vendredi 30/10
 * - semaine de clôture : lundi 26/10 -> S44
 *
 * Donc S41, S42 et S43 : aucune fenêtre de répartition.
 *
 * Exemple si le 31 tombe un jeudi :
 * - le vendredi suivant devient la date de clôture ;
 * - la semaine qui contient ce vendredi devient la semaine de clôture.
 */
function estSemaineClotureMensuelle(
  semaineDebut: string,
  periode: {
    dateCloture: string;
  } | null
) {
  if (!periode) return false;

  return debutSemaineISO(periode.dateCloture) === semaineDebut;
}

function exercicePOLYNOV(dateISOString: string) {
  const d = new Date(`${dateISOString}T00:00:00`);
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
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
  dateReference: Date,
  horaires: HorairesSemaine = HORAIRES_DEFAUT
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
          weekend
            ? 0
            : index === 0
              ? Number(horaires.lundi) || 0
              : index === 1
                ? Number(horaires.mardi) || 0
                : index === 2
                  ? Number(horaires.mercredi) || 0
                  : index === 3
                    ? Number(horaires.jeudi) || 0
                    : Number(horaires.vendredi) || 0,

        presence:
          ferie || weekend
            ? "ABSENT"
            : "PRESENTIEL",

        // Le jour férié est déterminé par la date, pas par un code saisi.
        // Le code FE est généré uniquement lors de l'enregistrement pour le hors-bilan.
        absence: "",

        dureeRTT:
          "JOURNEE",

        heuresRE: "",

        heuresAbsence: "",

        dureeCP: "JOURNEE",

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

function absenceNecessiteHeures(absence: CodeAbsence) {
  return ABSENCES_AVEC_HEURES.has(normaliserCode(absence));
}

function absenceNecessiteDuree(absence: CodeAbsence) {
  return normaliserCode(absence) === CODE_CP;
}

/**
 * Le profil horaire ne contient que le nombre total d'heures de la
 * journée. Pour un CP d'une demi-journée, on demande donc explicitement
 * les heures réellement posées en CP : cela évite de supposer que les
 * deux demi-journées ont toujours la même durée.
 */
function heuresCP(jour: JourSemaine) {
  if (jour.absence !== CODE_CP) return 0;
  if (jour.dureeCP === "JOURNEE") return jour.heuresTheoriques;
  return convertirHeures(jour.heuresAbsence);
}

function absenceTotale(
  absence: CodeAbsence,
  dureeRTT: DureeRTT | undefined,
  dureeCP: DureeRTT | undefined,
  codes: CodeImputation[]
) {
  if (!absence) return false;
  if (absence === CODE_RE) return false;
  if (absence === CODE_RT) return dureeRTT === "JOURNEE";
  if (absenceNecessiteHeures(absence)) return false;
  if (absenceNecessiteDuree(absence)) return dureeCP === "JOURNEE";

  const config = codes.find(
    code => normaliserCode(code.code) === normaliserCode(absence)
  );

  return (
    config?.categorie === "ABSENCE" ||
    config?.categorie === "HORS_BILAN"
  );
}

function imputationsInterdites(
  jour: JourSemaine,
  codes: CodeImputation[]
) {
  if (jour.estFerie) return true;

  return absenceTotale(
    jour.absence,
    jour.dureeRTT,
    jour.dureeCP,
    codes
  );
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
  jour: JourSemaine,
  codes: CodeImputation[]
) {
  if (jour.estWeekend || jour.estFerie) return 0;

  if (jour.absence === CODE_RE) {
    return Math.max(
      0,
      jour.heuresTheoriques - convertirHeures(jour.heuresRE)
    );
  }

  if (jour.absence === CODE_RT) {
    if (jour.dureeRTT === "JOURNEE") {
      return 0;
    }

    const heuresRTT = convertirHeures(jour.heuresAbsence);

    // En demi-journée, on demande les heures réellement posées en RTT,
    // car le matin et l'après-midi n'ont pas nécessairement la même durée.
    // Avant la saisie, on conserve une estimation provisoire à 50 %.
    return heuresRTT > 0
      ? Math.max(0, jour.heuresTheoriques - heuresRTT)
      : jour.heuresTheoriques / 2;
  }

  if (absenceNecessiteHeures(jour.absence)) {
    return Math.max(
      0,
      jour.heuresTheoriques - convertirHeures(jour.heuresAbsence)
    );
  }

  if (jour.absence === CODE_CP) {
    return Math.max(
      0,
      jour.heuresTheoriques - heuresCP(jour)
    );
  }

  if (absenceTotale(jour.absence, jour.dureeRTT, jour.dureeCP, codes)) return 0;
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

  // Les accès à une autre feuille que la sienne sont réservés aux
  // gestionnaires de feuilles : ADMIN = modification, MMO/FVI = consultation.
  const [niveauGestionFeuilles, setNiveauGestionFeuilles] =
    useState<"AUCUN" | "CONSULTATION" | "ADMIN">("AUCUN");

  const modeAdmin =
    Boolean(collaborateurIdUrl) && niveauGestionFeuilles === "ADMIN";

  const modeConsultationGestionnaire =
    Boolean(collaborateurIdUrl) &&
    niveauGestionFeuilles === "CONSULTATION";

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

  const [codesImputation, setCodesImputation] =
    useState<CodeImputation[]>([]);

  const [codesCharges, setCodesCharges] =
    useState(false);

  const [activites, setActivites] =
    useState<Activite[]>([]);

  const [activitesCodes, setActivitesCodes] =
    useState<ActiviteCode[]>([]);

  const [activitesCharges, setActivitesCharges] =
    useState(false);

  const [compteurBaseSemaine, setCompteurBaseSemaine] =
    useState<number>(0);

  const [horairesProfil, setHorairesProfil] =
    useState<HorairesSemaine>(HORAIRES_DEFAUT);

  const [semaineEstClotureMensuelle, setSemaineEstClotureMensuelle] =
    useState(false);

  const [libellePeriodeMensuelle, setLibellePeriodeMensuelle] =
    useState<string>("");

  const [heuresSupMensuellesAvantSemaine, setHeuresSupMensuellesAvantSemaine] =
    useState<number>(0);

  const [repartitionCompteurMensuelle, setRepartitionCompteurMensuelle] =
    useState<number | null>(null);

  const [repartitionPayeeMensuelle, setRepartitionPayeeMensuelle] =
    useState<number | null>(null);

  const [choixHeuresSupOuvert, setChoixHeuresSupOuvert] =
    useState(false);

  const [confirmationValidationOuverte, setConfirmationValidationOuverte] =
    useState(false);

  const [feuilleVerrouillee, setFeuilleVerrouillee] =
    useState(false);

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

  // Une semaine peut être sauvegardée à tout moment sous forme de brouillon.
  // La validation finale est une étape séparée.
  const [
    semaineValidee,
    setSemaineValidee,
  ] = useState(false);

  // Indique qu'une modification locale n'a pas encore été enregistrée.
  const [
    semaineModifiee,
    setSemaineModifiee,
  ] = useState(false);

  // Référence synchrone utilisée par les confirmations de navigation
  // et par l'avertissement du navigateur avant fermeture/rechargement.
  const semaineModifieeRef =
    useRef(false);

  // Sauvegarde automatique du brouillon : on attend une courte pause
  // après la dernière modification afin d'éviter un enregistrement réseau
  // à chaque frappe de clavier.
  const autoSaveTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoSaveEnCoursRef =
    useRef(false);

  const [autoSaveEtat, setAutoSaveEtat] =
    useState<"IDLE" | "ATTENTE" | "COURS" | "OK">("IDLE");

  const [heureDernierAutoSave, setHeureDernierAutoSave] =
    useState("");

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
     PROTECTION CONTRE LA PERTE DE SAISIE
  ============================================================ */

  useEffect(() => {
    semaineModifieeRef.current =
      semaineModifiee;
  }, [semaineModifiee]);

  useEffect(() => {
    function avertirAvantFermeture(
      event: BeforeUnloadEvent
    ) {
      if (
        !semaineModifieeRef.current ||
        feuilleVerrouillee ||
        modeAdmin
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener(
      "beforeunload",
      avertirAvantFermeture
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        avertirAvantFermeture
      );
    };
  }, [feuilleVerrouillee, modeAdmin]);

  /* ============================================================
     AUTO-SAVE BROUILLON
  ============================================================ */

  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // L'auto-save concerne la saisie du collaborateur.
    // ADMIN et gestionnaires travaillent volontairement sans ce mécanisme.
    if (
      !semaineModifiee ||
      chargement ||
      !codesCharges ||
      !activitesCharges ||
      modeAdmin ||
      modeConsultationGestionnaire ||
      feuilleVerrouillee ||
      semaineValidee
    ) {
      if (!semaineModifiee) {
        setAutoSaveEtat("IDLE");
      }
      return;
    }

    setAutoSaveEtat("ATTENTE");

    autoSaveTimerRef.current = setTimeout(() => {
      if (autoSaveEnCoursRef.current || !semaineModifieeRef.current) {
        return;
      }

      autoSaveEnCoursRef.current = true;
      setAutoSaveEtat("COURS");

      void sauvegarderSemaine(false, { automatique: true })
        .then(() => {
          setHeureDernierAutoSave(
            new Date().toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
          setAutoSaveEtat("OK");
        })
        .catch((error) => {
          console.error("Erreur sauvegarde automatique", error);
          setAutoSaveEtat("IDLE");
        })
        .finally(() => {
          autoSaveEnCoursRef.current = false;
          autoSaveTimerRef.current = null;
        });
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    semaineModifiee,
    chargement,
    codesCharges,
    activitesCharges,
    modeAdmin,
    modeConsultationGestionnaire,
    feuilleVerrouillee,
    semaineValidee,
  ]);

  function annulerAutoSaveProgramme() {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setAutoSaveEtat("IDLE");
  }

  function confirmerAvantQuitter() {
    if (
      semaineModifieeRef.current &&
      !modeAdmin
    ) {
      return window.confirm(
        "Votre semaine contient des modifications non enregistrées.\n\nVoulez-vous vraiment quitter cette page sans enregistrer ?"
      );
    }

    return true;
  }

  /* ============================================================
     CHARGER CODES D'IMPUTATION
  ============================================================ */

  useEffect(() => {
    async function chargerCodesImputation() {
      const { data, error } = await supabase
        .from("codes_imputation")
        .select(`
          code, libelle, categorie, type_affaire_autorise, vendable, actif,
          autorise_affaire, autorise_devis, autorise_divers,
          historique_uniquement, remarques_metier, type_code, ordre_affichage, historique
        `)
        .eq("actif", true)
        .eq("historique_uniquement", false)
        .order("ordre_affichage", { ascending: true, nullsFirst: false })
        .order("code", { ascending: true });

      if (error) {
        setMessage(`Impossible de charger les codes d'imputation : ${error.message}`);
        setMessageType("DANGER");
        setCodesCharges(true);
        return;
      }

      setCodesImputation((data ?? []) as CodeImputation[]);
      setCodesCharges(true);
    }

    chargerCodesImputation();
  }, []);

  /* ============================================================
     CHARGER ACTIVITÉS ET ASSOCIATIONS ACTIVITÉ/CODE
  ============================================================ */

  useEffect(() => {
    async function chargerActivites() {
      const [resultatActivites, resultatAssociations] =
        await Promise.all([
          supabase
            .from("activites")
            .select("id, code, nom, actif, ordre_affichage")
            .order("ordre_affichage", { ascending: true })
            .order("nom", { ascending: true }),
          supabase
            .from("activites_codes")
            .select("activite_id, code"),
        ]);

      if (resultatActivites.error) {
        setMessage(
          `Impossible de charger les activités : ${resultatActivites.error.message}`
        );
        setMessageType("DANGER");
        setActivitesCharges(true);
        return;
      }

      if (resultatAssociations.error) {
        setMessage(
          `Impossible de charger les associations activité/code : ${resultatAssociations.error.message}`
        );
        setMessageType("DANGER");
        setActivitesCharges(true);
        return;
      }

      setActivites((resultatActivites.data ?? []) as Activite[]);
      setActivitesCodes(
        (resultatAssociations.data ?? []) as ActiviteCode[]
      );
      setActivitesCharges(true);
    }

    chargerActivites();
  }, []);

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

      const { data: utilisateurConnecte, error: erreurUtilisateurConnecte } =
        await supabase
          .from("collaborateurs")
          .select("role, trigramme")
          .eq("auth_user_id", user.id)
          .maybeSingle();

      if (erreurUtilisateurConnecte) {
        setMessage(
          `Impossible de vérifier vos droits : ${erreurUtilisateurConnecte.message}`
        );
        setMessageType("DANGER");
        setChargement(false);
        return;
      }

      const roleUtilisateur = String(
        utilisateurConnecte?.role ?? ""
      ).trim().toUpperCase();

      const trigrammeUtilisateur = String(
        utilisateurConnecte?.trigramme ?? ""
      ).trim().toUpperCase();

      const estAdminConnecte = roleUtilisateur === "ADMIN";
      const estGestionnaire =
        estAdminConnecte ||
        trigrammeUtilisateur === "MMO" ||
        trigrammeUtilisateur === "FVI";

      setNiveauGestionFeuilles(
        estAdminConnecte
          ? "ADMIN"
          : estGestionnaire
            ? "CONSULTATION"
            : "AUCUN"
      );

      if (collaborateurIdUrl && !estGestionnaire) {
        setMessage(
          "Vous n'avez pas accès à la consultation des feuilles des autres collaborateurs."
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

      const semaineACharger =
        semaineUrl ??
        semaine[0].date;

      // Le rythme applicable est celui en vigueur pour la semaine affichée.
      // On consulte donc l'historique avant de retomber sur le profil courant.
      let horaires: HorairesSemaine = HORAIRES_DEFAUT;
      let profilHoraireId = collaborateurCharge.profil_horaire_id;

      const {
        data: historiqueRythme,
        error: erreurHistoriqueRythme,
      } = await supabase
        .from("historique_profils_horaires")
        .select("profil_horaire_id,date_debut,date_fin")
        .eq("collaborateur_id", collaborateurCharge.id)
        .lte("date_debut", semaineACharger)
        .or(`date_fin.is.null,date_fin.gte.${semaineACharger}`)
        .order("date_debut", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Si l'historique n'est pas disponible ou ne contient pas de ligne,
      // le profil actuellement affecté reste la source de repli.
      if (!erreurHistoriqueRythme && historiqueRythme?.profil_horaire_id) {
        profilHoraireId = historiqueRythme.profil_horaire_id;
      }

      if (profilHoraireId) {
        const { data: profil, error: erreurProfil } = await supabase
          .from("profils_horaires")
          .select("id,nom,lundi,mardi,mercredi,jeudi,vendredi")
          .eq("id", profilHoraireId)
          .maybeSingle();

        if (erreurProfil) {
          throw erreurProfil;
        }

        if (profil) {
          horaires = {
            lundi: Number(profil.lundi) || 0,
            mardi: Number(profil.mardi) || 0,
            mercredi: Number(profil.mercredi) || 0,
            jeudi: Number(profil.jeudi) || 0,
            vendredi: Number(profil.vendredi) || 0,
          };
        }
      }

      setHorairesProfil(horaires);
      setCollaborateur(collaborateurCharge);

      setSemaine(
        creerSemaine(
          new Date(`${semaineACharger}T00:00:00`),
          horaires
        )
      );

      await chargerSemaineExistante(
        collaborateurCharge.id,
        semaineACharger,
        horaires
      );

      await chargerCumulHeuresSupplementaires(
        collaborateurCharge.id,
        semaineACharger
      );

      setChargement(false);
    }

    chargerCollaborateur();
  }, []);

  const codesDivers = useMemo(
    () => codesImputation.filter(code => code.autorise_divers),
    [codesImputation]
  );

  const codesAbsence = useMemo(
    () => codesImputation.filter(code =>
      code.categorie === "ABSENCE" || code.categorie === "HORS_BILAN"
    ),
    [codesImputation]
  );

  const activitesActives = useMemo(
    () => activites.filter(activite => activite.actif),
    [activites]
  );

  const codesParActivite = useMemo(() => {
    const map = new Map<string, Set<string>>();

    for (const association of activitesCodes) {
      if (!map.has(association.activite_id)) {
        map.set(association.activite_id, new Set());
      }

      map.get(association.activite_id)!.add(
        normaliserCode(association.code)
      );
    }

    return map;
  }, [activitesCodes]);

  const getCodesPourLigne = (ligne: Imputation) => {
    /*
     * Divers : aucun lien avec les activités.
     */
    if (ligne.typeAffaire === "Divers") {
      return codesDivers;
    }

    /*
     * DBE : dans POLYNOV, le code d'imputation est toujours DT.
     * L'activité reste obligatoire pour l'analyse, mais elle ne
     * modifie pas la liste du code affaire/devis.
     */
    if (ligne.typeAffaire === "DBE") {
      return codesImputation.filter(code =>
        code.actif === true &&
        code.historique_uniquement !== true &&
        normaliserCode(code.code) === "DT"
      );
    }

    /*
     * CBE : l'activité filtre les codes, puis Gestion-codes conserve
     * la règle d'autorisation propre aux affaires.
     */
    if (!ligne.activiteId) {
      return [];
    }

    const codesAutorises =
      codesParActivite.get(ligne.activiteId) ??
      new Set<string>();

    return codesImputation.filter(code =>
      code.actif === true &&
      code.historique_uniquement !== true &&
      code.autorise_affaire === true &&
      codesAutorises.has(normaliserCode(code.code))
    );
  };


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

  /*
   * Le rythme affiché dans la feuille peut dépasser 35 h
   * (ex. BIB PE à 37,5 h ou BIB PI à 37,5 h).
   *
   * Les 2,5 h supplémentaires ne deviennent PAS de la capacité
   * normale : elles restent des heures supplémentaires par rapport
   * à la base POLYNOV de 35 h.
   *
   * On conserve donc deux notions :
   * - totalHeuresTheoriques : rythme quotidien attendu pour remplir la feuille ;
   * - base35Semaine : référence normale de 35 h, utilisée pour les HS.
   */
  const totalHeuresTheoriques =
    useMemo(() => {
      return semaine.reduce(
        (
          total,
          jour
        ) =>
          total +
          cibleTravailJour(
            jour,
            codesImputation
          ),
        0
      );
    }, [semaine]);

  const base35Semaine =
    useMemo(() => {
      let base = 35;

      for (const jour of semaine) {
        if (jour.estWeekend) continue;

        if (jour.estFerie) {
          base -= jour.heuresTheoriques;
          continue;
        }

        if (jour.absence === CODE_CP) {
          base -= heuresCP(jour);
          continue;
        }

        if (jour.absence === CODE_RE) {
          base -= convertirHeures(jour.heuresRE);
          continue;
        }

        if (absenceNecessiteHeures(jour.absence)) {
          base -= convertirHeures(jour.heuresAbsence);
          continue;
        }

        if (absenceTotale(jour.absence, jour.dureeRTT, jour.dureeCP, codesImputation)) {
          base -= jour.heuresTheoriques;
        }
      }

      return Math.max(0, base);
    }, [semaine]);

  /*
   * IMPORTANT : les heures supplémentaires et les heures manquantes
   * sont désormais calculées JOUR PAR JOUR.
   *
   * Ainsi, une heure faite en plus mardi ne peut jamais masquer une
   * heure manquante vendredi. C'est le comportement métier attendu :
   * chaque journée doit être justifiée séparément.
   *
   * On conserve également la règle POLYNOV des profils à 37,5 h :
   * leur écart par rapport à la base de 35 h reste considéré comme HS.
   */
  const detailsJours = useMemo(() => {
    return semaine.map(jour => {
      const cible = cibleTravailJour(jour, codesImputation);
      const heures = totalImputations(jour);

      return {
        jour,
        cible,
        heures,
        manquantes: Math.max(0, cible - heures),
        supplementaires: Math.max(0, heures - cible),
      };
    });
  }, [semaine, codesImputation]);

  const heuresSupplementairesJour = useMemo(() => {
    return detailsJours.reduce(
      (total, detail) => total + detail.supplementaires,
      0
    );
  }, [detailsJours]);

  const heuresSupplementairesBase35 = Math.max(
    0,
    totalHeuresSemaine - base35Semaine
  );

  const heuresSupplementaires = Math.max(
    heuresSupplementairesJour,
    heuresSupplementairesBase35
  );

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

  /*
   * Les heures supplémentaires ne sont plus arbitrées semaine par semaine.
   * Elles alimentent un cumul mensuel jusqu'à la semaine de clôture.
   */
  const compteurApresRE =
    compteurBaseSemaine - totalRE;

  const repartitionCompteurEffective =
    semaineEstClotureMensuelle && repartitionCompteurMensuelle !== null
      ? repartitionCompteurMensuelle
      : 0;

  const totalCompteurChoisi =
    compteurApresRE + repartitionCompteurEffective;

  const totalHeuresSupMensuelles =
    heuresSupMensuellesAvantSemaine + heuresSupplementaires;

  const compteurAllocationMinimum = Math.max(
    0,
    -30 - compteurApresRE
  );

  const compteurAllocationMaximum = Math.max(
    0,
    Math.min(
      totalHeuresSupMensuelles,
      30 - compteurApresRE
    )
  );

  const repartitionValide =
    !semaineEstClotureMensuelle ||
    totalHeuresSupMensuelles <= 0.01 ||
    (repartitionCompteurMensuelle !== null &&
      repartitionCompteurMensuelle >= compteurAllocationMinimum - 0.01 &&
      repartitionCompteurMensuelle <= compteurAllocationMaximum + 0.01 &&
      repartitionCompteurMensuelle <= totalHeuresSupMensuelles + 0.01);

  const heuresManquantes = useMemo(() => {
    return detailsJours.reduce(
      (total, detail) => total + detail.manquantes,
      0
    );
  }, [detailsJours]);

  const joursEnDeficit = useMemo(() => {
    return detailsJours.filter(detail => detail.manquantes > 0.01);
  }, [detailsJours]);

  const semaineComplete =
    joursEnDeficit.length === 0;

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
    if (modeConsultationGestionnaire) {
      return;
    }

    if (feuilleVerrouillee && !modeAdmin) {
      return;
    }

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

    setSemaineEnregistree(false);
    setSemaineValidee(false);

    // Si la semaine est la semaine de clôture mensuelle, une modification
    // change potentiellement le total d'HS à répartir : on invalide donc
    // la répartition précédente afin d'éviter tout décalage avec les heures.
    if (semaineEstClotureMensuelle) {
      setRepartitionCompteurMensuelle(null);
      setRepartitionPayeeMensuelle(null);
    }

    semaineModifieeRef.current =
      true;
    setSemaineModifiee(true);

    // Une nouvelle modification rend obsolète l'ancien message.
    setMessage("");
    setMessageType("");
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
    // Un jour férié est déterminé automatiquement par la date.
    // Il ne peut pas être choisi comme une absence classique.
    if (jour.estFerie) return;

    const estAbsent = absenceTotale(
      absence,
      jour.dureeRTT,
      jour.dureeCP,
      codesImputation
    );

    let ticket = jour.ticketRestaurant;
    if (estAbsent) ticket = false;
    if (absence === CODE_RT) ticket = jour.dureeRTT === "DEMI_JOURNEE";
    if (absence === CODE_RE) ticket = !jour.estWeekend;
    if (absence === "") ticket = !jour.estWeekend;

    const heuresAbsence =
      absence === CODE_CP
        ? (jour.absence === CODE_CP ? jour.heuresAbsence : "")
        : absenceNecessiteHeures(absence)
          ? jour.heuresAbsence
          : "";

    const dureeCP = absence === CODE_CP ? jour.dureeCP : "JOURNEE";

    const presence = jour.estWeekend
      ? (estAbsent ? "ABSENT" : jour.presence)
      : estAbsent
        ? "ABSENT"
        : jour.presence === "ABSENT"
          ? "PRESENTIEL"
          : jour.presence;

    modifierJour(jour.date, {
      absence,
      presence,
      ticketRestaurant: ticket,
      heuresRE: absence === CODE_RE ? jour.heuresRE : "",
      heuresAbsence,
      dureeCP,
      dureeRTT: absence === CODE_RT ? jour.dureeRTT : "JOURNEE",
      imputations: estAbsent ? [] : jour.imputations,
    });
  }

  /* ============================================================
     IMPUTATIONS
  ============================================================ */

  function ajouterImputation(
    jour: JourSemaine
  ) {
    if (
      imputationsInterdites(
        jour,
        codesImputation
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

        activiteId: null,

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
          duree === "DEMI_JOURNEE" &&
          !jour.estWeekend,

        heuresAbsence:
          duree === "JOURNEE"
            ? ""
            : jour.heuresAbsence,

        imputations:
          duree === "JOURNEE"
            ? []
            : jour.imputations,
      }
    );
  }

  /* ============================================================
     NAVIGATION
  ============================================================ */

  function semainePrecedente() {
    if (!confirmerAvantQuitter()) {
      return;
    }

    const date =
      new Date(
        `${semaine[0].date}T00:00:00`
      );

    date.setDate(
      date.getDate() - 7
    );

    const nouvelleSemaine =
      creerSemaine(date, horairesProfil);

    setSemaine(
      nouvelleSemaine
    );

    if (collaborateur) {
      chargerSemaineExistante(
        collaborateur.id,
        nouvelleSemaine[0].date,
        horairesProfil
      );

      chargerCumulHeuresSupplementaires(
        collaborateur.id,
        nouvelleSemaine[0].date
      );
    }

    setMessage("");
    setMessageType("");
    semaineModifieeRef.current = false;
    setSemaineModifiee(false);
    setSemaineEnregistree(false);
    setSemaineValidee(false);
  }

  function semaineSuivante() {
    if (!confirmerAvantQuitter()) {
      return;
    }

    const date =
      new Date(
        `${semaine[0].date}T00:00:00`
      );

    date.setDate(
      date.getDate() + 7
    );

    const nouvelleSemaine =
      creerSemaine(date, horairesProfil);

    setSemaine(
      nouvelleSemaine
    );

    if (collaborateur) {
      chargerSemaineExistante(
        collaborateur.id,
        nouvelleSemaine[0].date,
        horairesProfil
      );

      chargerCumulHeuresSupplementaires(
        collaborateur.id,
        nouvelleSemaine[0].date
      );
    }

    setMessage("");
    setMessageType("");
    semaineModifieeRef.current = false;
    setSemaineModifiee(false);
    setSemaineEnregistree(false);
    setSemaineValidee(false);
  }

  /* ============================================================
     VALIDATION DES IMPUTATIONS
  ============================================================ */

  function ligneImputationCommencee(ligne: Imputation) {
    return Boolean(
      ligne.activiteId ||
      ligne.code ||
      ligne.heures ||
      ligne.numeroAffaire ||
      ligne.description
    );
  }

  function afficherErreurImputation(
    jour: JourSemaine,
    numeroLigne: number,
    message: string
  ) {
    setMessage(
      `Le ${jour.jour} ${dateAffichage(jour.date)} — imputation ${numeroLigne} : ${message}`
    );
    setMessageType("DANGER");
  }

  /* ============================================================
     VALIDATION
  ============================================================ */

  function verifierSemaine(
    validationFinale = false
  ): boolean {
    setMessage("");
    setMessageType("");

    for (const jour of semaine) {
      if (jour.absence === CODE_RE) {
        const heuresRE = convertirHeures(jour.heuresRE);

        if (heuresRE <= 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : une récupération (RE) doit obligatoirement être renseignée en heures.`
          );
          setMessageType("DANGER");
          return false;
        }

        if (heuresRE > jour.heuresTheoriques) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : la récupération ne peut pas dépasser ${formatHeures(
              jour.heuresTheoriques
            )} h.`
          );
          setMessageType("DANGER");
          return false;
        }
      }

      if (absenceNecessiteHeures(jour.absence)) {
        const heuresAbsence = convertirHeures(jour.heuresAbsence);

        if (heuresAbsence <= 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : l'absence ${jour.absence} doit obligatoirement être renseignée en heures.`
          );
          setMessageType("DANGER");
          return false;
        }

        if (heuresAbsence > jour.heuresTheoriques) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : l'absence ${jour.absence} ne peut pas dépasser ${formatHeures(
              jour.heuresTheoriques
            )} h.`
          );
          setMessageType("DANGER");
          return false;
        }
      }

      if (jour.absence === CODE_CP && !jour.dureeCP) {
        setMessage(
          `Le ${jour.jour} ${dateAffichage(
            jour.date
          )} : choisissez journée ou demi-journée pour les congés payés.`
        );
        setMessageType("DANGER");
        return false;
      }

      if (jour.absence === CODE_CP && jour.dureeCP === "DEMI_JOURNEE") {
        const cpHeures = convertirHeures(jour.heuresAbsence);

        if (cpHeures <= 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : renseignez les heures réellement posées en CP pour la demi-journée (ex. 4 h le matin ou 3,5 h l'après-midi).`
          );
          setMessageType("DANGER");
          return false;
        }

        if (cpHeures > jour.heuresTheoriques) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : les heures de CP ne peuvent pas dépasser ${formatHeures(
              jour.heuresTheoriques
            )} h.`
          );
          setMessageType("DANGER");
          return false;
        }
      }

      if (
        jour.absence === CODE_RT &&
        jour.dureeRTT === "DEMI_JOURNEE"
      ) {
        const heuresRTT = convertirHeures(jour.heuresAbsence);

        if (heuresRTT <= 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : renseignez les heures réellement posées en RTT pour la demi-journée.`
          );
          setMessageType("DANGER");
          return false;
        }

        if (heuresRTT >= jour.heuresTheoriques) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : un RTT d'une demi-journée doit laisser des heures à travailler.`
          );
          setMessageType("DANGER");
          return false;
        }

        const heuresTravailleesAttendue =
          Math.max(0, jour.heuresTheoriques - heuresRTT);

        if (
          Math.abs(totalImputations(jour) - heuresTravailleesAttendue) >
          0.01
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : il faut imputer ${formatHeures(
              heuresTravailleesAttendue
            )} h de travail pour compléter ce RTT d'une demi-journée (actuellement ${formatHeures(
              totalImputations(jour)
            )} h).`
          );
          setMessageType("DANGER");
          return false;
        }
      }

      if (imputationsInterdites(jour, codesImputation)) {
        continue;
      }

      for (const [index, ligne] of jour.imputations.entries()) {
        if (!ligneImputationCommencee(ligne)) {
          continue;
        }

        const numeroLigne = index + 1;
        const estDivers = ligne.typeAffaire === "Divers";
        const heuresRenseignees = ligne.heures.trim() !== "";
        const heures = convertirHeures(ligne.heures);

        /*
         * La description reste totalement optionnelle.
         * Pour une affaire (CBE/DBE), les champs indispensables sont :
         *   - activité
         *   - code
         *   - numéro d'affaire sur 4 chiffres
         *   - heures > 0
         *
         * Pour Divers :
         *   - code
         *   - heures > 0
         */
        if (!estDivers) {
          if (!ligne.activiteId) {
            afficherErreurImputation(
              jour,
              numeroLigne,
              "choisissez une activité. La description de l'affaire est facultative."
            );
            return false;
          }

          if (!ligne.code) {
            afficherErreurImputation(
              jour,
              numeroLigne,
              "sélectionnez un code d'imputation."
            );
            return false;
          }

          if (!ligne.numeroAffaire || !/^\d{4}$/.test(ligne.numeroAffaire)) {
            afficherErreurImputation(
              jour,
              numeroLigne,
              "renseignez un numéro d'affaire composé exactement de 4 chiffres."
            );
            return false;
          }

          if (!heuresRenseignees) {
            afficherErreurImputation(
              jour,
              numeroLigne,
              "renseignez le nombre d'heures."
            );
            return false;
          }
        } else {
          if (!ligne.code) {
            afficherErreurImputation(
              jour,
              numeroLigne,
              "sélectionnez un code Divers."
            );
            return false;
          }

          if (!heuresRenseignees) {
            afficherErreurImputation(
              jour,
              numeroLigne,
              "renseignez le nombre d'heures."
            );
            return false;
          }
        }

        if (heuresRenseignees && heures <= 0) {
          afficherErreurImputation(
            jour,
            numeroLigne,
            "le nombre d'heures doit être supérieur à 0."
          );
          return false;
        }

        if (
          !estDivers &&
          ligne.activiteId &&
          ligne.code &&
          !getCodesPourLigne(ligne).some(
            code => normaliserCode(code.code) === normaliserCode(ligne.code)
          )
        ) {
          afficherErreurImputation(
            jour,
            numeroLigne,
            `le code ${ligne.code} n'est pas autorisé pour l'activité sélectionnée.`
          );
          return false;
        }

        if (heures < 0) {
          afficherErreurImputation(
            jour,
            numeroLigne,
            "le nombre d'heures ne peut pas être négatif."
          );
          return false;
        }
      }
    }

    if (validationFinale) {
      if (heuresManquantes > 0.01) {
        setMessage(
          `Impossible de valider : il manque ${formatHeures(
            heuresManquantes
          )} h par rapport au rythme prévu de la semaine.`
        );
        setMessageType("DANGER");
        return false;
      }

      setMessage(
        "La semaine est complète et prête à être validée."
      );
      setMessageType("OK");
      return true;
    }

    if (heuresManquantes > 0.01) {
      setMessage(
        `Saisie valide. Il reste ${formatHeures(
          heuresManquantes
        )} h à renseigner.`
      );
    } else {
      setMessage(
        "Semaine complète."
      );
    }

    setMessageType("OK");
    return true;
  }

  async function chargerCumulHeuresSupplementaires(
    collaborateurId: string,
    semaineDebut: string
  ) {
    // Réinitialisation immédiate à chaque changement de semaine.
    // Une semaine précédente ne doit jamais laisser sa fenêtre active.
    setSemaineEstClotureMensuelle(false);
    setLibellePeriodeMensuelle("");
    setHeuresSupMensuellesAvantSemaine(0);
    setRepartitionCompteurMensuelle(null);
    setRepartitionPayeeMensuelle(null);
    setChoixHeuresSupOuvert(false);

    const vendrediSemaine = ajouterJoursISO(semaineDebut, 4);
    const periode = trouverPeriodeClotureMensuelle(vendrediSemaine);

    /*
     * On distingue bien deux notions :
     * 1. la période mensuelle à laquelle appartient la semaine ;
     * 2. la semaine précise sur laquelle la répartition doit être demandée.
     *
     * La simple existence d'une clôture future ne doit donc PLUS ouvrir
     * la fenêtre de répartition.
     */
    const semaineDeCloture = estSemaineClotureMensuelle(
      semaineDebut,
      periode
    );

    setSemaineEstClotureMensuelle(semaineDeCloture);
    setLibellePeriodeMensuelle(periode?.libelleMois ?? "");

    if (!periode) return;

    const semaineCourante = semaineDebut;
    const semaineCloturePrecedente = periode.dateCloturePrecedente;

    // On exclut entièrement la semaine de la précédente clôture.
    // Le nouveau cycle commence le lundi suivant.
    const debutCycle = ajouterJoursISO(semaineCloturePrecedente, 3);

    const { data: feuilles, error: erreurFeuilles } = await supabase
      .from("feuilles_heures")
      .select("semaine_debut, heures_supplementaires, statut")
      .eq("collaborateur_id", collaborateurId)
      .eq("statut", "A_TRAITER")
      .gte("semaine_debut", debutCycle)
      .lt("semaine_debut", semaineCourante)
      .order("semaine_debut", { ascending: true });

    if (erreurFeuilles) {
      console.error("Erreur cumul HS mensuel", erreurFeuilles);
      throw erreurFeuilles;
    }

    const cumulAvant = (feuilles ?? []).reduce(
      (total, feuille) =>
        total + Number(feuille.heures_supplementaires ?? 0),
      0
    );

    setHeuresSupMensuellesAvantSemaine(cumulAvant);

    // Si la feuille courante est déjà une clôture enregistrée,
    // on recharge sa répartition précédente pour permettre une consultation
    // ou une correction administrative cohérente.
    const { data: feuilleCourante, error: erreurCourante } = await supabase
      .from("feuilles_heures")
      .select(
        "cloture_mensuelle, heures_supplementaires_a_repartir, heures_supplementaires_compteur, heures_supplementaires_payees"
      )
      .eq("collaborateur_id", collaborateurId)
      .eq("semaine_debut", semaineCourante)
      .maybeSingle();

    if (erreurCourante) {
      // Compatibilité temporaire : la migration SQL devra ajouter les colonnes.
      console.warn("Colonnes de clôture mensuelle non disponibles", erreurCourante);
      return;
    }

    if (Boolean(feuilleCourante?.cloture_mensuelle)) {
      const compteur = Number(feuilleCourante?.heures_supplementaires_compteur ?? 0);
      const payees = Number(feuilleCourante?.heures_supplementaires_payees ?? 0);

        setRepartitionCompteurMensuelle(compteur);
      setRepartitionPayeeMensuelle(payees);
    }
  }

  /* ============================================================
     CHARGEMENT SEMAINE EXISTANTE
  ============================================================ */

  async function chargerSemaineExistante(
    collaborateurId: string,
    semaineDebut: string,
    horairesPourSemaine: HorairesSemaine = horairesProfil
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
        .select("id, statut, mode_heures_supplementaires, compteur_avant, compteur_apres, verrouillee, cloture_mensuelle, heures_supplementaires_a_repartir, heures_supplementaires_compteur, heures_supplementaires_payees")
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
        setFeuilleVerrouillee(false);
            setRepartitionCompteurMensuelle(null);
        setRepartitionPayeeMensuelle(null);

        // Une nouvelle feuille prend comme base le compteur de la
        // dernière feuille chronologique précédente. S'il n'y en a
        // pas, on utilise la valeur initiale paramétrée en RH.
        const { data: precedente, error: erreurPrecedente } = await supabase
          .from("feuilles_heures")
          .select("semaine_debut, compteur_apres")
          .eq("collaborateur_id", collaborateurId)
          .eq("statut", "A_TRAITER")
          .lt("semaine_debut", semaineDebut)
          .order("semaine_debut", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (erreurPrecedente) throw erreurPrecedente;

        if (precedente?.compteur_apres !== null && precedente?.compteur_apres !== undefined) {
          setCompteurBaseSemaine(Number(precedente.compteur_apres) || 0);
        } else {
          const exercice = exercicePOLYNOV(semaineDebut);
          const { data: droit, error: erreurDroit } = await supabase
            .from("rh_droits")
            .select("compteur_recuperation_initial")
            .eq("collaborateur_id", collaborateurId)
            .eq("exercice", exercice)
            .maybeSingle();

          if (erreurDroit) throw erreurDroit;

          setCompteurBaseSemaine(
            droit?.compteur_recuperation_initial !== null && droit?.compteur_recuperation_initial !== undefined
              ? Number(droit.compteur_recuperation_initial) || 0
              : Number(collaborateur?.compteur_recuperation ?? 0) || 0
          );
        }

        setSemaine(
          creerSemaine(
            new Date(
              `${semaineDebut}T00:00:00`
            ),
            horairesPourSemaine
          )
        );

        semaineModifieeRef.current = false;
        setSemaineModifiee(false);
        setSemaineEnregistree(false);
        setSemaineValidee(false);
        return;
      }

      setFeuilleVerrouillee(Boolean(feuille.verrouillee));
      setCompteurBaseSemaine(
        feuille.compteur_avant !== null && feuille.compteur_avant !== undefined
          ? Number(feuille.compteur_avant) || 0
          : 0
      );

      if (Boolean(feuille.cloture_mensuelle)) {
        setRepartitionCompteurMensuelle(
          Number(feuille.heures_supplementaires_compteur ?? 0)
        );
        setRepartitionPayeeMensuelle(
          Number(feuille.heures_supplementaires_payees ?? 0)
        );
      } else {
            setRepartitionCompteurMensuelle(null);
        setRepartitionPayeeMensuelle(null);
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
          ),
          horairesPourSemaine
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

        const imputationsJour = (imputations ?? []).filter(
          i => i.jour_id === jourDB.id
        );

        const weekendAvecActivite =
          jour.estWeekend &&
          (Boolean(jourDB.absence) ||
            Number(jourDB.heures_re ?? 0) > 0 ||
            Number(jourDB.heures_absence ?? 0) > 0 ||
            imputationsJour.some(i => Number(i.heures ?? 0) > 0));

        jour.presence =
          jour.estWeekend && !weekendAvecActivite
            ? "ABSENT"
            : jour.estWeekend
              ? (jourDB.presence === "TELETRAVAIL" ? "TELETRAVAIL" : "ABSENT")
              : jourDB.presence;

        const absenceChargee = normaliserCode(jourDB.absence ?? "");
        // FE est un code technique de hors-bilan : dans Ma semaine,
        // le jour férié est déterminé automatiquement par la date.
        // Compatibilité avec l'ancien code RTT : la table utilise RT.
        jour.absence = absenceChargee === CODE_FE
          ? ""
          : absenceChargee === "RTT"
            ? CODE_RT
            : absenceChargee;

        jour.dureeRTT =
          jourDB.duree_rtt ??
          "JOURNEE";

        jour.heuresRE =
          jourDB.heures_re?.toString() ??
          "";

        jour.heuresAbsence =
          jourDB.heures_absence?.toString() ??
          "";

        jour.dureeCP =
          jourDB.duree_cp ??
          "JOURNEE";

        jour.ticketRestaurant =
          jour.estWeekend
            ? false
            : Boolean(jourDB.ticket_restaurant);

        jour.imputations =
          imputationsJour
            .map(i => ({
              id:
                crypto.randomUUID(),

              typeAffaire:
                i.type_affaire,

              activiteId:
                i.activite_id ??
                null,

              numeroAffaire:
                i.numero_affaire ??
                "",

              description:
                i.description ??
                "",

              code: normaliserCode(i.code ?? ""),

              heures:
                i.heures?.toString() ??
                "",
            }));
      }

      setSemaine(
        semaineChargee
      );

      // Une feuille peut exister en base tout en étant incomplète.
      // Le badge « Semaine enregistrée » ne doit apparaître que si
      // la semaine chargée atteint bien son objectif d'heures.
      const semaineChargeeAvecDeficit = semaineChargee.some(
        jour =>
          totalImputations(jour) <
          cibleTravailJour(jour, codesImputation) -
            0.01
      );

      const feuilleEstComplete = !semaineChargeeAvecDeficit;

      const feuilleEstValidee =
        feuille.statut === "A_TRAITER" && feuilleEstComplete;

      semaineModifieeRef.current = false;
      setSemaineModifiee(false);
      setSemaineEnregistree(true);
      setSemaineValidee(feuilleEstValidee);

      setMessage("");
      setMessageType("");
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

  async function recupererCompteurAvant(
    collaborateurId: string,
    semaineDebut: string
  ) {
    const { data: precedente, error: erreurPrecedente } =
      await supabase
        .from("feuilles_heures")
        .select("semaine_debut, compteur_apres")
        .eq("collaborateur_id", collaborateurId)
        .eq("statut", "A_TRAITER")
        .lt("semaine_debut", semaineDebut)
        .order("semaine_debut", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (erreurPrecedente) {
      throw erreurPrecedente;
    }

    if (
      precedente?.compteur_apres !== null &&
      precedente?.compteur_apres !== undefined
    ) {
      return Number(precedente.compteur_apres) || 0;
    }

    const exercice = exercicePOLYNOV(semaineDebut);

    const { data: droit, error: erreurDroit } =
      await supabase
        .from("rh_droits")
        .select("compteur_recuperation_initial")
        .eq("collaborateur_id", collaborateurId)
        .eq("exercice", exercice)
        .maybeSingle();

    if (erreurDroit) {
      throw erreurDroit;
    }

    return (
      droit?.compteur_recuperation_initial !== null &&
      droit?.compteur_recuperation_initial !== undefined
        ? Number(droit.compteur_recuperation_initial) || 0
        : Number(collaborateur?.compteur_recuperation ?? 0) || 0
    );
  }

  function jourDoitEtreEnregistre(jour: JourSemaine) {
    /*
     * Les week-ends sont affichés par défaut comme ABSENT, mais on ne
     * crée aucun enregistrement SQL pour eux tant qu'ils restent dans
     * cet état neutre. Cela évite de remplir inutilement les tables.
     *
     * Dès qu'un week-end est réellement travaillé ou renseigné, il est
     * sauvegardé normalement.
     */
    if (!jour.estWeekend) {
      return true;
    }

    return (
      jour.presence !== "ABSENT" ||
      Boolean(jour.absence) ||
      jour.ticketRestaurant === true ||
      convertirHeures(jour.heuresRE) > 0 ||
      convertirHeures(jour.heuresAbsence) > 0 ||
      jour.imputations.length > 0
    );
  }

  async function sauvegarderSemaine(
    validationFinale: boolean,
    options?: { automatique?: boolean }
  ) {
    const automatique = options?.automatique === true;

    if (!automatique) {
      annulerAutoSaveProgramme();
    }
    if (modeConsultationGestionnaire) {
      setMessage(
        "Cette feuille est consultable uniquement depuis le suivi des feuilles. Seul un administrateur peut la modifier."
      );
      setMessageType("DANGER");
      return;
    }

    if (feuilleVerrouillee && !modeAdmin) {
      setMessage(
        "Cette feuille est verrouillée par l'administration. Elle ne peut plus être modifiée."
      );
      setMessageType("DANGER");
      return;
    }

    if (semaineValidee && !modeAdmin) {
      setMessage(
        "Cette semaine est déjà validée. Elle n'est plus modifiable."
      );
      setMessageType("DANGER");
      return;
    }

    if (!collaborateur) {
      setMessage("Le collaborateur n'est pas chargé.");
      setMessageType("DANGER");
      return;
    }

    // L'auto-save doit accepter un brouillon partiellement renseigné :
    // c'est précisément ce qui permet de récupérer une saisie après un
    // plantage du navigateur. La validation métier complète reste réservée
    // à l'enregistrement manuel / à la validation finale.
    const valide = automatique
      ? true
      : verifierSemaine(validationFinale);
    if (!valide) {
      return;
    }

    if (
      validationFinale &&
      semaineEstClotureMensuelle &&
      totalHeuresSupMensuelles > 0.01 &&
      !repartitionValide
    ) {
      setChoixHeuresSupOuvert(true);
      return;
    }

    setEnregistrement(true);
    if (!automatique) {
      setMessage(
        validationFinale
          ? "Validation et enregistrement de la semaine..."
          : "Enregistrement du brouillon..."
      );
      setMessageType("OK");
    }

    try {
      const semaineDebut = semaine[0].date;

      const compteurAvantEnregistrement =
        await recupererCompteurAvant(
          collaborateur.id,
          semaineDebut
        );

      setCompteurBaseSemaine(compteurAvantEnregistrement);

      const repartitionCompteur =
        validationFinale && semaineEstClotureMensuelle
          ? Number(repartitionCompteurMensuelle ?? 0)
          : 0;

      const repartitionPayee =
        validationFinale && semaineEstClotureMensuelle
          ? Math.max(
              0,
              totalHeuresSupMensuelles - repartitionCompteur
            )
          : 0;

      const compteurApresEnregistrement =
        validationFinale
          ? compteurAvantEnregistrement +
            repartitionCompteur -
            totalRE
          : compteurAvantEnregistrement;

      /*
       * La borne supérieure du compteur est +30 h.
       * On conserve également la borne basse historique de -30 h.
       */
      if (
        validationFinale &&
        compteurApresEnregistrement > 30.01
      ) {
        setMessage(
          `Le compteur de récupération atteindrait ${formatHeures(
            compteurApresEnregistrement
          )} h. Il ne peut pas dépasser +30 h.`
        );
        setMessageType("DANGER");
        return;
      }

      if (
        validationFinale &&
        compteurApresEnregistrement < -30
      ) {
        setMessage(
          `Le compteur de récupération atteindrait ${formatHeures(
            compteurApresEnregistrement
          )} h. La limite basse autorisée est de -30 h.`
        );
        setMessageType("DANGER");
        return;
      }

      const {
        data: feuilleExistante,
        error: erreurRecherche,
      } = await supabase
        .from("feuilles_heures")
        .select("id, statut, verrouillee, mode_heures_supplementaires")
        .eq("collaborateur_id", collaborateur.id)
        .eq("semaine_debut", semaineDebut)
        .maybeSingle();

      if (erreurRecherche) {
        throw erreurRecherche;
      }

      if (
        feuilleExistante &&
        feuilleExistante.statut === "A_TRAITER" &&
        !modeAdmin
      ) {
        setMessage(
          "Cette semaine est déjà validée. Elle n'est plus modifiable."
        );
        setMessageType("DANGER");
        return;
      }

      const feuilleEtaitVerrouillee = Boolean(
        feuilleExistante?.verrouillee
      );

      /*
       * Pendant une saisie collaborateur, la feuille reste en
       * BROUILLON pendant toute la reconstruction.
       *
       * Exception importante : lorsqu'un ADMIN corrige une feuille
       * déjà envoyée (A_TRAITER), elle doit rester envoyée.
       * Cela évite qu'une simple correction administrative ne rende
       * la feuille à nouveau modifiable par le collaborateur.
       */
      const statutApresSauvegarde =
        modeAdmin && feuilleExistante?.statut === "A_TRAITER"
          ? "A_TRAITER"
          : "BROUILLON";

      const donneesFeuille = {
        statut: statutApresSauvegarde,
        total_heures: totalHeuresSemaine,
        total_theorique: base35Semaine,
        heures_supplementaires: heuresSupplementaires,
        // Compatibilité avec l'ancien champ hebdomadaire.
        // Le nouveau fonctionnement mensuel utilise les quatre champs
        // cloture_mensuelle / heures_supplementaires_* comme source de vérité.
        mode_heures_supplementaires:
          feuilleExistante?.mode_heures_supplementaires ?? "PAYE",
        total_re: totalRE,
        compteur_avant: compteurAvantEnregistrement,
        compteur_apres: validationFinale
          ? compteurApresEnregistrement
          : compteurAvantEnregistrement,
        cloture_mensuelle: validationFinale && semaineEstClotureMensuelle,
        heures_supplementaires_a_repartir:
          validationFinale && semaineEstClotureMensuelle
            ? totalHeuresSupMensuelles
            : 0,
        heures_supplementaires_compteur:
          validationFinale && semaineEstClotureMensuelle
            ? repartitionCompteur
            : 0,
        heures_supplementaires_payees:
          validationFinale && semaineEstClotureMensuelle
            ? repartitionPayee
            : 0,
        updated_at: new Date().toISOString(),
      };

      let feuilleId: string;

      if (feuilleExistante) {
        feuilleId = feuilleExistante.id;

        /* ------------------------------------------------------
           AVANT DE RECREER LES JOURNEES

           Les imputations sont liées aux journées via jour_id.
           On les supprime donc explicitement avant de supprimer
           les journées. Cela évite de dépendre d'une éventuelle
           contrainte SQL ON DELETE CASCADE.
        ------------------------------------------------------ */

        const {
          data: joursExistants,
          error: erreurLectureJoursExistants,
        } = await supabase
          .from("feuilles_heures_jours")
          .select("id")
          .eq("feuille_id", feuilleId);

        if (erreurLectureJoursExistants) {
          throw erreurLectureJoursExistants;
        }

        const idsJoursExistants = (joursExistants ?? []).map(
          jour => jour.id
        );

        if (idsJoursExistants.length > 0) {
          const { error: erreurSuppressionImputations } =
            await supabase
              .from("feuilles_heures_imputations")
              .delete()
              .in("jour_id", idsJoursExistants);

          if (erreurSuppressionImputations) {
            throw erreurSuppressionImputations;
          }
        }

        /* ------------------------------------------------------
           SUPPRESSION DES ANCIENNES JOURNEES
        ------------------------------------------------------ */

        const { error: erreurSuppressionJours } =
          await supabase
            .from("feuilles_heures_jours")
            .delete()
            .eq("feuille_id", feuilleId);

        if (erreurSuppressionJours) {
          throw erreurSuppressionJours;
        }

        /* ------------------------------------------------------
           MISE A JOUR DE LA FEUILLE
        ------------------------------------------------------ */

        const { error: erreurUpdate } =
          await supabase
            .from("feuilles_heures")
            .update(donneesFeuille)
            .eq("id", feuilleId);

        if (erreurUpdate) {
          throw erreurUpdate;
        }
      } else {
        const {
          data: nouvelleFeuille,
          error: erreurCreation,
        } = await supabase
          .from("feuilles_heures")
          .insert({
            collaborateur_id: collaborateur.id,
            semaine_debut: semaineDebut,
            date_debut_semaine: semaineDebut,
            ...donneesFeuille,
            verrouillee: false,
            verrouillee_le: null,
            verrouillee_par: null,
          })
          .select("id")
          .single();

        if (erreurCreation) {
          throw erreurCreation;
        }

        if (!nouvelleFeuille) {
          throw new Error("La feuille n'a pas pu être créée.");
        }

        feuilleId = nouvelleFeuille.id;
      }

      const joursAInserer = semaine
        .filter(jourDoitEtreEnregistre)
        .map(jour => ({
          feuille_id: feuilleId,
          date_jour: jour.date,
          heures_theoriques: jour.heuresTheoriques,
          presence: jour.presence,
          absence: jour.estFerie ? CODE_FE : jour.absence,
          duree_rtt: jour.dureeRTT,
          heures_re: convertirHeures(jour.heuresRE),
          heures_absence: convertirHeures(jour.heuresAbsence),
          duree_cp: jour.dureeCP,
          ticket_restaurant: jour.ticketRestaurant,
          total_heures: totalImputations(jour),
        })
      );

      const { data: joursCrees, error: erreurJours } =
        await supabase
          .from("feuilles_heures_jours")
          .insert(joursAInserer)
          .select("id,date_jour");

      if (erreurJours) {
        throw erreurJours;
      }

      if (!joursCrees) {
        throw new Error("Les journées n'ont pas pu être enregistrées.");
      }

      const imputationsAInserer: {
        jour_id: string;
        type_affaire: TypeAffaire;
        activite_id: string | null;
        numero_affaire: string | null;
        description: string | null;
        code: string;
        heures: number;
      }[] = [];

      for (const jour of semaine.filter(jourDoitEtreEnregistre)) {
        const jourDB = joursCrees.find(
          j => j.date_jour === jour.date
        );

        if (!jourDB) {
          throw new Error(
            `Impossible de retrouver le jour ${jour.date}.`
          );
        }

        for (const ligne of jour.imputations) {
          if (
            !ligne.code &&
            !ligne.heures &&
            !ligne.numeroAffaire &&
            !ligne.description
          ) {
            continue;
          }

          imputationsAInserer.push({
            jour_id: jourDB.id,
            type_affaire: ligne.typeAffaire,
            activite_id:
              ligne.typeAffaire === "Divers"
                ? null
                : ligne.activiteId || null,
            numero_affaire:
              ligne.typeAffaire === "Divers"
                ? null
                : ligne.numeroAffaire || null,
            description: ligne.description || null,
            code: ligne.code,
            heures: convertirHeures(ligne.heures),
          });
        }
      }

      if (imputationsAInserer.length > 0) {
        const { error: erreurImputations } =
          await supabase
            .from("feuilles_heures_imputations")
            .insert(imputationsAInserer);

        if (erreurImputations) {
          throw erreurImputations;
        }
      }

      if (validationFinale) {
        const { error: erreurValidation } = await supabase.rpc(
          "valider_feuille_heures",
          {
            p_feuille_id: feuilleId,
          }
        );

        if (erreurValidation) {
          throw erreurValidation;
        }
      }

      if (validationFinale) {
        const {
          data: feuillesSuivantes,
          error: erreurSuivantes,
        } = await supabase
          .from("feuilles_heures")
          .select(
            "id, semaine_debut, heures_supplementaires, mode_heures_supplementaires, total_re, cloture_mensuelle, heures_supplementaires_compteur"
          )
          .eq("collaborateur_id", collaborateur.id)
          .eq("statut", "A_TRAITER")
          .gt("semaine_debut", semaineDebut)
          .order("semaine_debut", { ascending: true });

        if (erreurSuivantes) {
          throw erreurSuivantes;
        }

        let compteurCourant = compteurApresEnregistrement;

        for (const suivante of feuillesSuivantes ?? []) {
          const hsCompteur = Boolean(suivante.cloture_mensuelle)
            ? Number(suivante.heures_supplementaires_compteur ?? 0)
            : Number(
                suivante.heures_supplementaires_compteur ??
                  (suivante.mode_heures_supplementaires === "COMPTEUR"
                    ? suivante.heures_supplementaires
                    : 0)
              );

          const re = Number(suivante.total_re ?? 0);
          const apres = compteurCourant + hsCompteur - re;

          if (apres < -30 || apres > 30) {
            throw new Error(
              `Le recalcul de la feuille ${suivante.semaine_debut} dépasse la limite du compteur (${formatHeures(apres)} h).`
            );
          }

          const { error: erreurMajSuivante } =
            await supabase
              .from("feuilles_heures")
              .update({
                compteur_avant: compteurCourant,
                compteur_apres: apres,
                updated_at: new Date().toISOString(),
              })
              .eq("id", suivante.id);

          if (erreurMajSuivante) {
            throw erreurMajSuivante;
          }

          compteurCourant = apres;
        }
      }

      setFeuilleVerrouillee(
        feuilleEtaitVerrouillee
      );
      setSemaineEnregistree(true);
      setSemaineValidee(
        validationFinale || statutApresSauvegarde === "A_TRAITER"
      );
      semaineModifieeRef.current = false;
      setSemaineModifiee(false);

      if (!automatique && validationFinale) {
        setMessage(
          `Semaine du ${dateAffichage(
            semaineDebut
          )} validée et transmise à POLYNOV.`
        );
      } else if (
        !automatique &&
        modeAdmin &&
        feuilleExistante?.statut === "A_TRAITER"
      ) {
        setMessage(
          `Correction enregistrée par l'administration. La semaine reste envoyée et n'est pas modifiable par le collaborateur.`
        );
      } else if (!automatique && heuresManquantes > 0.01) {
        setMessage(
          `Brouillon de la semaine du ${dateAffichage(
            semaineDebut
          )} enregistré. Il reste ${formatHeures(
            heuresManquantes
          )} h à renseigner.`
        );
      } else if (!automatique) {
        setMessage(
          `Brouillon de la semaine du ${dateAffichage(
            semaineDebut
          )} enregistré. La semaine est complète : vous pouvez maintenant la valider.`
        );
      }

      setMessageType(automatique ? "" : "OK");
    } catch (error) {
      console.error("Erreur sauvegarde semaine", error);

      const erreurSupabase = error as {
        message?: string;
        details?: string;
        hint?: string;
        code?: string;
      };

      const texte = [
        erreurSupabase?.message,
        erreurSupabase?.details,
        erreurSupabase?.hint,
        erreurSupabase?.code
          ? `Code ${erreurSupabase.code}`
          : "",
      ]
        .filter(Boolean)
        .join(" — ");

      if (automatique) {
        throw error;
      }

      setMessage(
        `Impossible de sauvegarder la semaine : ${
          texte || "Erreur inconnue"
        }`
      );
      setMessageType("DANGER");
    } finally {
      setEnregistrement(false);
    }
  }

  function ouvrirRepartitionHeuresSup() {
    const valeurInitiale =
      repartitionCompteurMensuelle !== null
        ? repartitionCompteurMensuelle
        : compteurAllocationMinimum > 0
          ? compteurAllocationMinimum
          : null;

    setRepartitionCompteurMensuelle(valeurInitiale);
    setRepartitionPayeeMensuelle(
      valeurInitiale === null
        ? null
        : Math.max(0, totalHeuresSupMensuelles - valeurInitiale)
    );
    setChoixHeuresSupOuvert(true);
  }

  function changerRepartitionCompteur(value: string) {
    const normalisee = value.replace(",", ".").replace(/[^0-9.]/g, "");
    if (!normalisee) {
      setRepartitionCompteurMensuelle(null);
      setRepartitionPayeeMensuelle(null);
      return;
    }

    const nombre = Number(normalisee);
    if (!Number.isFinite(nombre)) return;

    const borne = Math.min(
      Math.max(nombre, compteurAllocationMinimum),
      compteurAllocationMaximum
    );

    setRepartitionCompteurMensuelle(borne);
    setRepartitionPayeeMensuelle(
      Math.max(0, totalHeuresSupMensuelles - borne)
    );
  }

  function confirmerRepartitionHeuresSup() {
    if (!semaineEstClotureMensuelle) return;

    if (repartitionCompteurMensuelle === null) {
      setMessage(
        "Saisissez le nombre d'heures que vous souhaitez mettre au compteur. Le reste sera automatiquement placé en heures payées."
      );
      setMessageType("DANGER");
      return;
    }

    const compteur = Number(repartitionCompteurMensuelle);
    if (
      compteur < compteurAllocationMinimum - 0.01 ||
      compteur > compteurAllocationMaximum + 0.01 ||
      compteur > totalHeuresSupMensuelles + 0.01
    ) {
      setMessage(
        `Répartition impossible : choisissez entre ${formatHeures(
          compteurAllocationMinimum
        )} h et ${formatHeures(compteurAllocationMaximum)} h au compteur.`
      );
      setMessageType("DANGER");
      return;
    }

    setRepartitionCompteurMensuelle(compteur);
    setRepartitionPayeeMensuelle(
      Math.max(0, totalHeuresSupMensuelles - compteur)
    );
    setChoixHeuresSupOuvert(false);
    setConfirmationValidationOuverte(true);
  }

  function demanderValidationFinale() {
    if (enregistrement) return;

    const valide = verifierSemaine(true);
    if (!valide) {
      return;
    }

    if (
      semaineEstClotureMensuelle &&
      totalHeuresSupMensuelles > 0.01 &&
      !repartitionValide
    ) {
      ouvrirRepartitionHeuresSup();
      return;
    }

    setConfirmationValidationOuverte(true);
  }

  async function confirmerValidationFinale() {
    setConfirmationValidationOuverte(false);
    await sauvegarderSemaine(true);
  }

  async function enregistrerBrouillon() {
    await sauvegarderSemaine(false);
  }

  async function validerSemaine() {
    await sauvegarderSemaine(true);
  }

  function blocActionsFeuille() {
    const boutonsBloques =
      enregistrement ||
      modeConsultationGestionnaire ||
      (!modeAdmin && (feuilleVerrouillee || semaineValidee));

    const validationBloquee =
      boutonsBloques ||
      !semaineComplete ||
      (semaineValidee && !semaineModifiee);

    return (
      <div style={styles.actionZone}>
        <div style={styles.actionExplanation}>
          <strong>Enregistrer</strong> garde votre saisie en brouillon.
          <span> · </span>
          <strong>Valider ma semaine</strong> contrôle chaque journée puis transmet la feuille à POLYNOV.
          <span> · </span>
          <strong>Attention :</strong> la validation est définitive et verrouille la semaine pour le collaborateur.
        </div>

        {!modeConsultationGestionnaire && !modeAdmin && (
          <div
            style={{
              marginTop: 10,
              marginBottom: 10,
              fontSize: 12,
              color: autoSaveEtat === "OK" ? "#267338" : "#777",
              minHeight: 18,
            }}
          >
            {autoSaveEtat === "ATTENTE" && "⏳ Sauvegarde automatique du brouillon…"}
            {autoSaveEtat === "COURS" && "💾 Sauvegarde automatique en cours…"}
            {autoSaveEtat === "OK" &&
              `✓ Brouillon sauvegardé automatiquement${
                heureDernierAutoSave ? ` à ${heureDernierAutoSave}` : ""
              }.`}
          </div>
        )}

        <div style={styles.bottomActions}>
          <button
            type="button"
            onClick={enregistrerBrouillon}
            disabled={boutonsBloques}
            style={{
              ...styles.buttonDraft,
              opacity: boutonsBloques ? 0.55 : 1,
              cursor: boutonsBloques ? "not-allowed" : "pointer",
            }}
          >
            {enregistrement ? "Enregistrement..." : "💾 Enregistrer"}
          </button>

          <button
            type="button"
            onClick={demanderValidationFinale}
            disabled={validationBloquee}
            style={{
              ...styles.buttonValidate,
              opacity: validationBloquee ? 0.55 : 1,
              cursor: validationBloquee ? "not-allowed" : "pointer",
            }}
          >
            {semaineValidee && !semaineModifiee
              ? "✓ Semaine validée"
              : "✓ Valider ma semaine"}
          </button>
        </div>
      </div>
    );
  }

  /* ============================================================
     CHARGEMENT
  ============================================================ */

  if (chargement || !codesCharges || !activitesCharges) {
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
              onClick={() => {
                if (confirmerAvantQuitter()) {
                  window.location.href = "/dashboard";
                }
              }}
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

          {semaineEstClotureMensuelle && (
            <div
              style={{
                marginTop: 12,
                padding: "11px 14px",
                borderRadius: 9,
                border: "1px solid #d9b45f",
                background: "#fff9e9",
                color: "#6b5100",
                lineHeight: 1.45,
                fontSize: 13,
              }}
            >
              <strong>Clôture mensuelle — {libellePeriodeMensuelle}</strong>
              <br />
              Cette semaine permet de répartir les heures supplémentaires cumulées sur la période entre le compteur de récupération et les heures payées.
            </div>
          )}
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
              h prévues
              {heuresSupplementaires > 0.01 && (
                <>
                  {" "}·{" "}
                  <strong style={{ color: "#138113" }}>
                    +{formatHeures(heuresSupplementaires)} h sup
                  </strong>
                </>
              )}
            </div>

            <div
              style={
                semaineModifiee
                  ? styles.unsavedStatus
                  : semaineValidee
                    ? styles.validatedStatus
                    : semaineEnregistree
                      ? styles.savedStatus
                      : styles.notSavedStatus
              }
            >
              {semaineModifiee
                ? "● Modifications non enregistrées"
                : semaineValidee
                  ? "✓ Semaine validée — transmise"
                  : semaineEnregistree
                    ? "✓ Brouillon enregistré"
                    : "○ Semaine non enregistrée"}
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

        <fieldset
          disabled={
            modeConsultationGestionnaire ||
            (!modeAdmin &&
              (feuilleVerrouillee || semaineValidee))
          }
          style={{
            border: 0,
            padding: 0,
            margin: 0,
            minWidth: 0,
          }}
        >
        <div style={styles.cards}>
          {modeConsultationGestionnaire && (
            <div
              style={{
                ...styles.message,
                ...styles.messageOk,
                marginBottom: 16,
              }}
            >
              <div style={styles.messageIcon}>👁</div>
              <div>Cette feuille est affichée en <strong>consultation</strong>. Seul un administrateur peut la modifier.</div>
            </div>
          )}

          {!modeAdmin && semaineValidee && !modeConsultationGestionnaire && (
            <div
              style={{
                ...styles.message,
                ...styles.messageDanger,
                marginBottom: 16,
              }}
            >
              <div style={styles.messageIcon}>✓</div>
              <div>
                Cette semaine est <strong>validée</strong>.
                Vous pouvez la consulter, mais elle n'est plus modifiable.
              </div>
            </div>
          )}

          {!modeAdmin && feuilleVerrouillee && !semaineValidee && (
            <div style={{...styles.message, ...styles.messageDanger, marginBottom: 16}}>
              <div style={styles.messageIcon}>🔒</div>
              <div>Cette feuille est <strong>verrouillée par l'administration</strong>. Vous pouvez la consulter, mais elle n'est plus modifiable.</div>
            </div>
          )}

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
            <div style={styles.cardLabel}>
              HEURES SUPPLÉMENTAIRES
            </div>

            <div
              style={{
                ...styles.cardValue,
                color: heuresSupplementaires > 0 ? "#138113" : "#333",
              }}
            >
              {heuresSupplementaires > 0 ? "+" : ""}
              {formatHeures(heuresSupplementaires)} h
            </div>

            <div style={styles.cardHint}>
              Heures supplémentaires de la semaine, calculées jour par jour.
              Elles sont conservées dans le cumul mensuel jusqu'à la clôture.
            </div>

            {totalHeuresSupMensuelles > 0.01 && semaineEstClotureMensuelle ? (
              <div
                style={{
                  marginTop: 12,
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #d8b56a",
                  background: "#fffaf0",
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                <strong>
                  ⚠ Clôture mensuelle — {libellePeriodeMensuelle}
                </strong>
                <div style={{ marginTop: 4 }}>
                  Total à répartir : <strong>+{formatHeures(totalHeuresSupMensuelles)} h</strong>
                </div>
                <div style={{ marginTop: 3, color: "#666" }}>
                  {repartitionCompteurMensuelle !== null
                    ? `${formatHeures(repartitionCompteurMensuelle)} h au compteur · ${formatHeures(repartitionPayeeMensuelle ?? 0)} h payées`
                    : "La répartition compteur / heures payées doit être choisie avant la validation."}
                </div>
              </div>
            ) : totalHeuresSupMensuelles > 0.01 ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "9px 11px",
                  borderRadius: 8,
                  border: "1px solid #d7d7d7",
                  background: "#fafafa",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                Cumul provisoire sur la période mensuelle :
                <strong> +{formatHeures(totalHeuresSupMensuelles)} h</strong>.
                <br />La répartition compteur / heures payées sera demandée lors de la semaine de clôture.
              </div>
            ) : null}
          </div>

          {/* COMPTEUR DE RÉCUPÉRATION */}

          <div style={styles.card}>
            <div style={styles.cardLabel}>
              COMPTEUR DE RÉCUPÉRATION
            </div>

            <div
              style={{
                ...styles.cardValue,
                color:
                  totalCompteurChoisi > 30.01 || totalCompteurChoisi < -30
                    ? "#c00000"
                    : "#333",
              }}
            >
              {formatHeures(totalCompteurChoisi)} h
            </div>

            <div style={styles.cardHint}>
              Début de semaine : <strong>{formatHeures(compteurBaseSemaine)} h</strong>
              {totalRE > 0.01 && (
                <>
                  <br />− {formatHeures(totalRE)} h de récupération saisie
                </>
              )}
              {semaineEstClotureMensuelle && repartitionCompteurMensuelle !== null && (
                <>
                  <br />+ {formatHeures(repartitionCompteurMensuelle)} h affectées au compteur ce mois-ci
                </>
              )}
              {!semaineEstClotureMensuelle && totalHeuresSupMensuelles > 0.01 && (
                <>
                  <br />+ {formatHeures(totalHeuresSupMensuelles)} h en cours d'accumulation mensuelle
                </>
              )}
            </div>
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
                fontSize: 28,
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
            ACTIONS — juste au-dessus de l'en-tête du tableau
        ==================================================== */}

        {blocActionsFeuille()}

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
              style={styles.sideHeader}
            >
              <div
                style={styles.presenceHeader}
              >
                Présence
              </div>

              <div
                style={styles.ticketHeader}
              >
                Présence / ticket
              </div>
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
                  jour,
                  codesImputation
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

                      <div style={styles.dayHours}>
                        <strong style={styles.dayHoursStrong}>
                          {formatHeures(heuresJour)} h
                        </strong>

                        {!jour.estWeekend && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#c00000",
                              fontWeight: 800,
                              marginTop: 4,
                              paddingTop: 3,
                              borderTop: "1px solid #e8caca",
                            }}
                          >
                            Objectif : {formatHeures(cibleTravailJour(jour, codesImputation))} h
                          </div>
                        )}

                        {!jour.estWeekend &&
                          !jour.estFerie &&
                          heuresJour > cibleTravailJour(jour, codesImputation) + 0.01 && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#138113",
                                fontWeight: 800,
                                marginTop: 3,
                              }}
                            >
                              +{formatHeures(heuresJour - cibleTravailJour(jour, codesImputation))} h supplémentaire(s)
                            </div>
                          )}

                        {!jour.estWeekend &&
                          !jour.estFerie &&
                          heuresJour < cibleTravailJour(jour, codesImputation) - 0.01 && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#c00000",
                                fontWeight: 800,
                                marginTop: 3,
                              }}
                            >
                              Il manque {formatHeures(cibleTravailJour(jour, codesImputation) - heuresJour)} h
                            </div>
                          )}
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

                        {jour.estFerie ? (
                          <div
                            style={{
                              ...styles.input,
                              maxWidth: 250,
                              background: "#eeeeee",
                              color: "#666",
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            Jour férié — automatique
                          </div>
                        ) : (
                          <select
                            value={jour.absence}
                            onChange={e =>
                              changerAbsence(
                                jour,
                                e.target.value as CodeAbsence
                              )
                            }
                            style={{
                              ...styles.input,
                              maxWidth: 250,
                            }}
                          >
                            <option value="">Aucune absence</option>
                            {codesAbsence
                              .filter(code => normaliserCode(code.code) !== CODE_FE)
                              .map(code => (
                                <option key={code.code} value={code.code}>
                                  {code.code} — {code.libelle}
                                </option>
                              ))}
                          </select>
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

                          {jour.dureeRTT === "DEMI_JOURNEE" ? (
                            <>
                              <label style={styles.cpHoursLabel}>
                                Heures de RTT
                                <input
                                  value={jour.heuresAbsence}
                                  inputMode="decimal"
                                  placeholder="ex. 4 ou 3,5"
                                  onChange={e =>
                                    modifierJour(jour.date, {
                                      heuresAbsence: e.target.value.replace(/[^0-9.,]/g, ""),
                                    })
                                  }
                                  style={{ ...styles.input, width: 115 }}
                                />
                              </label>
                              <span>
                                Saisissez les heures réellement posées en RTT.
                              </span>
                              <span style={styles.cpRemaining}>
                                {jour.heuresAbsence
                                  ? `Il reste ${formatHeures(cibleTravailJour(jour, codesImputation))} h à travailler.`
                                  : "Renseignez les heures de RTT pour calculer le temps restant."}
                              </span>
                            </>
                          ) : (
                            <span>Journée non travaillée.</span>
                          )}
                        </div>
                      )}

                      {/* CP : JOURNEE / DEMI-JOURNEE */}

                      {jour.absence === CODE_CP && (
                        <div style={styles.rttBox}>
                          <strong>Congés payés :</strong>
                          <select
                            value={jour.dureeCP}
                            onChange={e => {
                              const duree = e.target.value as DureeCP;
                              modifierJour(jour.date, {
                                dureeCP: duree,
                                presence: duree === "JOURNEE" ? "ABSENT" : "PRESENTIEL",
                                ticketRestaurant: duree === "DEMI_JOURNEE" && !jour.estWeekend,
                                heuresAbsence: duree === "JOURNEE" ? "" : jour.heuresAbsence,
                                imputations: duree === "JOURNEE" ? [] : jour.imputations,
                              });
                            }}
                            style={{ ...styles.input, width: 160 }}
                          >
                            <option value="JOURNEE">Journée</option>
                            <option value="DEMI_JOURNEE">1/2 journée</option>
                          </select>

                          {jour.dureeCP === "DEMI_JOURNEE" ? (
                            <>
                              <label style={styles.cpHoursLabel}>
                                Heures de CP
                                <input
                                  value={jour.heuresAbsence}
                                  inputMode="decimal"
                                  placeholder="ex. 4 ou 3,5"
                                  onChange={e =>
                                    modifierJour(jour.date, {
                                      heuresAbsence: e.target.value.replace(/[^0-9.,]/g, ""),
                                    })
                                  }
                                  style={{ ...styles.input, width: 115 }}
                                />
                              </label>
                              <span>
                                Saisissez les heures réellement posées en CP : 4 h le matin, 3,5 h l'après-midi, par exemple.
                              </span>
                              <span style={styles.cpRemaining}>
                                {jour.heuresAbsence
                                  ? `Il reste ${formatHeures(cibleTravailJour(jour, codesImputation))} h à travailler.`
                                  : "Renseignez les heures de CP pour calculer le temps restant."}
                              </span>
                            </>
                          ) : (
                            <span>Journée non travaillée.</span>
                          )}
                        </div>
                      )}

                      {/* ABSENCES EN HEURES : VM / AI / AA */}

                      {absenceNecessiteHeures(jour.absence) && (
                        <div style={styles.reBox}>
                          <strong>{libelleAbsence(jour.absence, codesImputation)} :</strong>
                          <input
                            value={jour.heuresAbsence}
                            inputMode="decimal"
                            placeholder="ex. 2,0"
                            onChange={e => modifierJour(jour.date, {
                              heuresAbsence: e.target.value.replace(/[^0-9.,]/g, ""),
                            })}
                            style={{ ...styles.input, width: 100 }}
                          />
                          <span>h d'absence</span>
                        </div>
                      )}

                      {/* ABSENCE TOTALE */}

                      {jour.absence &&
                        jour.absence !== CODE_RE &&
                        jour.absence !== CODE_RT &&
                        jour.absence !== CODE_CP &&
                        !absenceNecessiteHeures(jour.absence) &&
                        absenceTotale(jour.absence, jour.dureeRTT, jour.dureeCP, codesImputation) && (
                          <div style={styles.absenceInfo}>
                            <strong>{libelleAbsence(jour.absence, codesImputation)}</strong>
                            {" — aucune imputation d'heures sur cette journée."}
                          </div>
                        )}

                      {!modeAdmin &&
                        !modeConsultationGestionnaire &&
                        jour.absence &&
                        normaliserCode(jour.absence) !== CODE_FE && (
                          <div
                            style={{
                              marginTop: 10,
                              marginBottom: 8,
                              padding: "10px 12px",
                              borderRadius: 8,
                              border: "1px solid #e2b94d",
                              background: "#fff9e8",
                              color: "#6d5200",
                              fontSize: 12,
                              lineHeight: 1.45,
                            }}
                          >
                            <strong>⚠ Justificatif RH :</strong> cette absence doit être justifiée via vos outils RH habituels.
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
                                onChange={e => {
                                  const nouveauType =
                                    e.target.value as TypeAffaire;

                                  const nouvelleActiviteId =
                                    nouveauType === "Divers"
                                      ? null
                                      : ligne.activiteId;

                                  const lignePourNouveauType: Imputation = {
                                    ...ligne,
                                    typeAffaire: nouveauType,
                                    activiteId: nouvelleActiviteId,
                                  };

                                  const codePeutRester =
                                    nouveauType !== "Divers" &&
                                    nouvelleActiviteId &&
                                    ligne.code
                                      ? getCodesPourLigne(lignePourNouveauType).some(
                                          code =>
                                            normaliserCode(code.code) ===
                                            normaliserCode(ligne.code)
                                        )
                                      : false;

                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      typeAffaire: nouveauType,
                                      activiteId: nouvelleActiviteId,
                                      numeroAffaire:
                                        nouveauType === "Divers"
                                          ? ""
                                          : ligne.numeroAffaire,
                                      code:
                                        nouveauType === "Divers"
                                          ? ""
                                          : codePeutRester
                                            ? ligne.code
                                            : "",
                                    }
                                  );
                                }}
                                style={{ ...styles.input, gridColumn: "1", gridRow: "1" }}
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

                              {/* ACTIVITÉ */}

                              {ligne.typeAffaire === "Divers" ? (
                                <div
                                  style={{
                                    ...styles.input,
                                    gridColumn: "2",
                                    gridRow: "1",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "#f3f3f3",
                                    color: "#777",
                                  }}
                                >
                                  —
                                </div>
                              ) : (
                                <select
                                  value={ligne.activiteId ?? ""}
                                  onChange={e => {
                                    const activiteId = e.target.value || null;
                                    const codesPourActivite = activiteId
                                      ? getCodesPourLigne({
                                          ...ligne,
                                          activiteId,
                                        })
                                      : [];

                                    modifierImputation(
                                      jour,
                                      ligne.id,
                                      {
                                        activiteId,
                                        code: codesPourActivite.some(
                                          code =>
                                            normaliserCode(code.code) ===
                                            normaliserCode(ligne.code)
                                        )
                                          ? ligne.code
                                          : "",
                                      }
                                    );
                                  }}
                                  style={{ ...styles.input, gridColumn: "2", gridRow: "1" }}
                                >
                                  <option value="">
                                    Choisir une activité...
                                  </option>

                                  {activitesActives.map(activite => (
                                    <option
                                      key={activite.id}
                                      value={activite.id}
                                    >
                                      {activite.nom}
                                    </option>
                                  ))}
                                </select>
                              )}

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
                                style={{
                                  ...styles.input,
                                  gridColumn: "3",
                                  gridRow: "1",
                                }}
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
                                style={{
                                  ...styles.input,
                                  gridColumn: "1 / 4",
                                  gridRow: "2",
                                }}
                              />

                              {/* CODE */}

                              <select
                                value={
                                  ligne.code
                                }
                                disabled={
                                  ligne.typeAffaire !== "Divers" &&
                                  !ligne.activiteId
                                }
                                onChange={e =>
                                  modifierImputation(
                                    jour,
                                    ligne.id,
                                    {
                                      code: e.target.value,
                                    }
                                  )
                                }
                                style={{
                                  ...styles.input,
                                  gridColumn: "4",
                                  gridRow: "1",
                                  background:
                                    ligne.typeAffaire !== "Divers" &&
                                    !ligne.activiteId
                                      ? "#f3f3f3"
                                      : "#fff",
                                }}
                              >
                                <option value="">
                                  {ligne.typeAffaire !== "Divers" && !ligne.activiteId
                                    ? "Choisir une activité d'abord..."
                                    : getCodesPourLigne(ligne).length === 0
                                      ? "Aucun code autorisé pour cette sélection"
                                      : ligne.typeAffaire === "Divers"
                                        ? "Choisir un code Divers..."
                                        : "Choisir un code..."}
                                </option>

                                {getCodesPourLigne(ligne).map(code => (
                                  <option key={code.code} value={code.code}>
                                    {code.code} — {code.libelle}
                                  </option>
                                ))}
                              </select>

                              {ligne.typeAffaire !== "Divers" &&
                                ligne.activiteId &&
                                getCodesPourLigne(ligne).length === 0 && (
                                  <div style={{ ...styles.codeHelp, gridRow: "3" }}>
                                    Aucun code n'est associé à cette activité dans Gestion-activites.
                                  </div>
                                )}

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
                                style={{
                                  ...styles.input,
                                  gridColumn: "4",
                                  gridRow: "2",
                                }}
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
                                style={{
                                  ...styles.deleteButton,
                                  gridColumn: "5",
                                  gridRow: "1 / 3",
                                }}
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

        </fieldset>

        {/* ====================================================
            ACTIONS
        ==================================================== */}

        {!modeAdmin && !semaineValidee && (
          <div style={styles.finalValidationWarning}>
            <div style={styles.finalValidationWarningIcon}>🔒</div>
            <div>
              <strong>La validation est définitive.</strong>
              <div>
                Une fois votre semaine validée, vous ne pourrez plus la modifier. Vérifiez bien chaque journée, vos absences, vos RE et vos heures supplémentaires. Lors de la clôture mensuelle, vérifiez également la répartition entre compteur et heures payées.
              </div>
            </div>
          </div>
        )}

        {blocActionsFeuille()}

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

            <div style={{ flex: 1 }}>
              <strong>
                Des heures manquent sur une ou plusieurs journées
              </strong>

              <div style={{ marginTop: 4 }}>
                Il manque au total {formatHeures(heuresManquantes)} h.
              </div>

              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {joursEnDeficit.map(detail => (
                  <span
                    key={detail.jour.date}
                    style={{
                      background: "#fff",
                      border: "1px solid #e1b5b5",
                      borderRadius: 5,
                      padding: "4px 7px",
                      fontWeight: 700,
                      color: "#8d0000",
                    }}
                  >
                    {detail.jour.jour} : −{formatHeures(detail.manquantes)} h
                  </span>
                ))}
              </div>

              <div
                style={{
                  marginTop: 7,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Une heure supplémentaire réalisée un autre jour ne compense pas cette absence d'heures.
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
                  les absences de journée complète passent
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

              <div style={styles.helpItem}>
                <strong>Rythme & heures sup</strong>
                <p>
                  Le rythme affiché indique les heures à réaliser chaque jour.
                  La base normale reste 35 h par semaine. Les heures réalisées
                  au-delà de cette base sont comptées séparément en heures sup.
                </p>
              </div>

              <div style={styles.helpItem}>
                <strong>PE / PI</strong>
                <p>
                  En PE, le rythme peut être 7 h par jour avec des heures sup
                  quotidiennes. En PI, le rythme peut être 8 / 8 / 8 / 8 / 5,5 h
                  pour conserver le vendredi après-midi.
                </p>
              </div>

              <div style={styles.helpItem}>
                <strong>Heures</strong>
                <p>
                  Saisissez les heures réellement passées sur chaque activité.
                  Le système calcule automatiquement les heures sup ; inutile
                  de les saisir séparément.
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
                  Un jour férié est détecté
                  automatiquement à partir de la date.
                  Il est enregistré en FE en arrière-plan
                  pour le hors-bilan.
                </p>
              </div>
            </div>
          </aside>
        )}

      </div>
    
      {confirmationValidationOuverte && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              background: "#fff",
              borderRadius: 16,
              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,.28)",
              fontFamily: "Calibri, Arial, sans-serif",
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                marginBottom: 10,
                color: "#8d0000",
              }}
            >
              Valider définitivement la semaine ?
            </div>

            <div
              style={{
                background: "#fff4f4",
                border: "1px solid #e6b5b5",
                borderLeft: "5px solid #c00000",
                borderRadius: 9,
                padding: "12px 14px",
                marginBottom: 18,
                lineHeight: 1.45,
                color: "#5d1b1b",
              }}
            >
              <strong>Attention : cette validation est définitive.</strong>
              <br />
              Après validation, vous ne pourrez plus modifier cette semaine. Toute correction devra passer par l'administration.
            </div>

            <div style={{ lineHeight: 1.6, color: "#444", marginBottom: 18 }}>
              {semaineEstClotureMensuelle && totalHeuresSupMensuelles > 0.01 ? (
                <>
                  <div>Période clôturée : <strong>{libellePeriodeMensuelle}</strong></div>
                  <div>Heures supplémentaires à répartir : <strong>+{formatHeures(totalHeuresSupMensuelles)} h</strong></div>
                  <div>Au compteur : <strong>{formatHeures(repartitionCompteurMensuelle ?? 0)} h</strong></div>
                  <div>Payées : <strong>{formatHeures(repartitionPayeeMensuelle ?? 0)} h</strong></div>
                  <div>Compteur après validation : <strong>{formatHeures(totalCompteurChoisi)} h</strong></div>
                </>
              ) : heuresSupplementaires > 0.01 ? (
                <>
                  <div>Heures supplémentaires cette semaine : <strong>+{formatHeures(heuresSupplementaires)} h</strong></div>
                  <div>Ces heures restent dans le cumul mensuel jusqu'à la clôture.</div>
                  <div>Compteur après validation : <strong>{formatHeures(totalCompteurChoisi)} h</strong></div>
                </>
              ) : (
                <div>Aucune heure supplémentaire cette semaine.</div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {semaineEstClotureMensuelle && totalHeuresSupMensuelles > 0.01 && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmationValidationOuverte(false);
                    ouvrirRepartitionHeuresSup();
                  }}
                  style={{
                    border: "1px solid #ccc",
                    background: "#fff",
                    color: "#444",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Modifier la répartition
                </button>
              )}

              <button
                type="button"
                onClick={() => setConfirmationValidationOuverte(false)}
                style={{
                  border: "1px solid #ccc",
                  background: "#fff",
                  color: "#444",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={() => void confirmerValidationFinale()}
                style={{
                  border: "none",
                  background: "#c00000",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "10px 18px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🔒 Valider définitivement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* La répartition mensuelle ne peut être ouverte que sur la
          semaine exacte de clôture, jamais sur les semaines précédentes. */}
      {choixHeuresSupOuvert &&
        semaineEstClotureMensuelle &&
        totalHeuresSupMensuelles > 0.01 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#fff",
              borderRadius: 16,
              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
              fontFamily: "Calibri, Arial, sans-serif",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
              Clôture mensuelle des heures supplémentaires
            </div>

            <div style={{ color: "#555", lineHeight: 1.55, marginBottom: 18 }}>
              Nous sommes sur la semaine de clôture de <strong>{libellePeriodeMensuelle}</strong>.
              <br />
              Vous avez cumulé <strong>+{formatHeures(totalHeuresSupMensuelles)} h</strong> d'heures supplémentaires sur la période.
              <br />
              Répartissez vous-même ces heures entre le compteur de récupération et les heures payées.
            </div>

            <div
              style={{
                marginBottom: 18,
                padding: "12px 14px",
                borderRadius: 9,
                background: "#fff7f7",
                border: "1px solid #e5b7b7",
                color: "#5e2020",
                lineHeight: 1.45,
                fontSize: 13,
              }}
            >
              Le compteur après prise en compte des récupérations de la semaine est de <strong>{formatHeures(compteurApresRE)} h</strong>.
              <br />
              Vous pouvez affecter au compteur entre <strong>{formatHeures(compteurAllocationMinimum)} h</strong> et <strong>{formatHeures(compteurAllocationMaximum)} h</strong>.
            </div>

            <label style={{ display: "block", fontWeight: 800, marginBottom: 7 }}>
              Heures à mettre au compteur
            </label>
            <input
              autoFocus
              type="number"
              min={compteurAllocationMinimum}
              max={compteurAllocationMaximum}
              step="0.5"
              value={repartitionCompteurMensuelle ?? ""}
              onChange={e => changerRepartitionCompteur(e.target.value)}
              style={{
                ...styles.input,
                width: "100%",
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 12,
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#f3f8f3",
                  border: "1px solid #b9d2bb",
                }}
              >
                <div style={{ fontSize: 11, color: "#666" }}>COMPTEUR</div>
                <strong style={{ fontSize: 18 }}>
                  {formatHeures(repartitionCompteurMensuelle ?? 0)} h
                </strong>
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#f8f8f8",
                  border: "1px solid #d2d2d2",
                }}
              >
                <div style={{ fontSize: 11, color: "#666" }}>HEURES PAYÉES</div>
                <strong style={{ fontSize: 18 }}>
                  {formatHeures(repartitionPayeeMensuelle ?? 0)} h
                </strong>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => setChoixHeuresSupOuvert(false)}
                style={{
                  border: "1px solid #ccc",
                  background: "#fff",
                  color: "#444",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmerRepartitionHeuresSup}
                style={{
                  border: "none",
                  background: "#c00000",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "10px 18px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Confirmer la répartition
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
      "repeat(4, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 16,
    minWidth: 0,
  },

  card: {
    background: "#fff",
    border:
      "1px solid #e3e3e3",
    borderRadius: 11,
    padding: 13,
    minHeight: 105,
    minWidth: 0,
    boxShadow:
      "0 2px 7px rgba(0,0,0,.045)",
  },

  cardLabel: {
    color: "#777",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: ".45px",
    marginBottom: 6,
    lineHeight: 1.2,
  },

  cardValue: {
    fontSize: 23,
    fontWeight: 800,
    lineHeight: 1.1,
  },

  cardHint: {
    color: "#888",
    fontSize: 10.5,
    lineHeight: 1.28,
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
    overflowX: "hidden",
    boxShadow:
      "0 2px 8px rgba(0,0,0,.06)",
  },

  tableHeader: {
    display: "grid",
    gridTemplateColumns:
      "120px minmax(0, 1fr) 205px",
    minWidth: 0,
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

  sideHeader: {
    display: "grid",
    gridTemplateRows: "1fr 1fr",
    minWidth: 0,
  },

  presenceHeader: {
    padding: 10,
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "1px solid #ddd",
  },

  ticketHeader: {
    padding: 10,
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  dayBlock: {
    minWidth: 0,
    borderBottom:
      "1px solid #e2e2e2",
  },

  dayGrid: {
    display: "grid",
    gridTemplateColumns:
      "120px minmax(0, 1fr) 205px",
    gridTemplateRows: "auto auto",
    minWidth: 0,
    minHeight: 120,
  },

  /* ----------------------------------------------------------
     JOUR
  ---------------------------------------------------------- */

  dayCell: {
    gridColumn: "1",
    gridRow: "1 / span 2",
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
    gridColumn: "2",
    gridRow: "1 / span 2",
    padding: 11,
    minWidth: 0,
    overflowX: "hidden",
    overflowY: "visible",
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
      "70px minmax(115px, 1.1fr) 70px minmax(135px, 1.3fr) 36px",
    minWidth: 0,
    gap: 6,
    alignItems: "center",
    marginBottom: 9,
    padding: "8px 8px 8px 9px",
    background: "#ffffff",
    border: "1px solid #d8d8d8",
    borderLeft: "4px solid #c00000",
    borderRadius: 7,
    boxShadow: "0 1px 3px rgba(0,0,0,.04)",
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
    gridColumn: "3",
    gridRow: "1",
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
    gridColumn: "3",
    gridRow: "2",
    padding: "11px 13px",
    minWidth: 0,
    borderLeft:
      "1px solid #eee",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },

  ticketLabel: {
    display: "flex",
    whiteSpace: "nowrap",
    alignItems: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: 600,
  },

  ticketHint: {
    color: "#888",
    maxWidth: 170,
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

  cpHoursLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },

  cpRemaining: {
    fontWeight: 700,
    color: "#138113",
  },

  /* ----------------------------------------------------------
     ACTIONS
  ---------------------------------------------------------- */

  codeHelp: {
    gridColumn: "1 / -1",
    fontSize: 11,
    lineHeight: 1.35,
    color: "#9a5b00",
    background: "#fff7e8",
    border: "1px solid #efd5a3",
    borderRadius: 5,
    padding: "6px 8px",
  },

  actionZone: {
    marginTop: 18,
    padding: "14px 16px",
    background: "#fff",
    border: "1px solid #e3e3e3",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },

  actionExplanation: {
    color: "#666",
    fontSize: 12,
    lineHeight: 1.45,
    flex: 1,
    minWidth: 260,
  },

  bottomActions: {
    display: "flex",
    justifyContent:
      "flex-end",
    gap: 10,
    marginTop: 16,
  },

  savedStatus: {
    marginTop: 5,
    color: "#555",
    fontSize: 12,
    fontWeight: 700,
  },

  validatedStatus: {
    marginTop: 5,
    color: "#138113",
    fontSize: 12,
    fontWeight: 800,
  },

  notSavedStatus: {
    marginTop: 5,
    color: "#888",
    fontSize: 12,
    fontWeight: 700,
  },

  unsavedStatus: {
    marginTop: 5,
    color: "#a05a00",
    fontSize: 12,
    fontWeight: 800,
  },

  buttonDraft: {
    background: "#ffffff",
    color: "#444",
    border: "1px solid #cfcfcf",
    borderRadius: 7,
    padding: "10px 15px",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "Calibri, Arial, sans-serif",
    fontSize: 14,
  },

  buttonValidate: {
    background: "#138113",
    color: "#ffffff",
    border: "none",
    borderRadius: 7,
    padding: "10px 17px",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "Calibri, Arial, sans-serif",
    fontSize: 14,
    boxShadow: "0 2px 4px rgba(19,129,19,.15)",
  },

  finalValidationWarning: {
    marginTop: 16,
    background: "#fff4f4",
    border: "1px solid #e1b6b6",
    borderLeft: "5px solid #c00000",
    borderRadius: 10,
    padding: "12px 15px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    color: "#6d2020",
    fontSize: 13,
    lineHeight: 1.4,
  },

  finalValidationWarningIcon: {
    width: 31,
    height: 31,
    borderRadius: "50%",
    background: "#c00000",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  saveReminder: {
    marginTop: 16,
    background: "#edf8ef",
    border: "1px solid #b9dfbf",
    borderLeft: "5px solid #138113",
    borderRadius: 10,
    padding: "13px 15px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 2px 7px rgba(0,0,0,.04)",
  },

  saveReminderIcon: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#138113",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    flexShrink: 0,
  },

  saveReminderText: {
    flex: 1,
    color: "#176b22",
    fontSize: 13,
    lineHeight: 1.4,
  },

  saveReminderButton: {
    background: "#138113",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "9px 13px",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "Calibri, Arial, sans-serif",
    fontSize: 13,
    whiteSpace: "nowrap",
  },

  validationReminder: {
    marginTop: 16,
    background: "#fff8e7",
    border: "1px solid #ead7a0",
    borderLeft: "5px solid #c00000",
    borderRadius: 10,
    padding: "13px 15px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 2px 7px rgba(0,0,0,.04)",
  },

  validationReminderIcon: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#c00000",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    flexShrink: 0,
  },

  validationReminderText: {
    flex: 1,
    color: "#6b5600",
    fontSize: 13,
    lineHeight: 1.4,
  },

  validationReminderButton: {
    background: "#c00000",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "9px 13px",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "Calibri, Arial, sans-serif",
    fontSize: 13,
    whiteSpace: "nowrap",
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
