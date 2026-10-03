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

type ModeHeuresSupplementaires =
  | "PAYE"
  | "COMPTEUR";

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

type Imputation = {
  id: string;
  typeAffaire: TypeAffaire;
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
  dureeCP: DureeRTT;
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
          ferie
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
    return jour.dureeRTT === "DEMI_JOURNEE"
      ? jour.heuresTheoriques / 2
      : 0;
  }

  if (absenceNecessiteHeures(jour.absence)) {
    return Math.max(
      0,
      jour.heuresTheoriques - convertirHeures(jour.heuresAbsence)
    );
  }

  if (jour.absence === CODE_CP) {
    return jour.dureeCP === "DEMI_JOURNEE"
      ? jour.heuresTheoriques / 2
      : 0;
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

  // Lorsqu'un collaborateur est passé explicitement dans l'URL,
  // la page est ouverte depuis l'administration : l'admin peut donc
  // consulter/modifier une feuille même si elle est verrouillée.
  const modeAdmin = Boolean(collaborateurIdUrl);

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

  const [modeHeuresSupplementaires, setModeHeuresSupplementaires] =
    useState<ModeHeuresSupplementaires | null>(null);

  const [compteurBaseSemaine, setCompteurBaseSemaine] =
    useState<number>(0);

  const [horairesProfil, setHorairesProfil] =
    useState<HorairesSemaine>(HORAIRES_DEFAUT);

  const [choixHeuresSupOuvert, setChoixHeuresSupOuvert] =
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

      setChargement(false);
    }

    chargerCollaborateur();
  }, []);

  const codesAffaire = useMemo(
    () => codesImputation.filter(code => code.autorise_affaire),
    [codesImputation]
  );

  const codesDevis = useMemo(
    () => codesImputation.filter(code => code.autorise_devis),
    [codesImputation]
  );

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

  const getCodesPourType = (type: TypeAffaire) => {
    if (type === "CBE") return codesAffaire;
    if (type === "DBE") return codesDevis;
    return codesDivers;
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
          base -= jour.dureeCP === "DEMI_JOURNEE"
            ? jour.heuresTheoriques / 2
            : jour.heuresTheoriques;
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

  const heuresSupplementaires =
    Math.max(
      0,
      totalHeuresSemaine -
        base35Semaine
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

  const heuresManquantes =
    Math.max(
      0,
      totalHeuresTheoriques -
        totalHeuresSemaine
    );

  const semaineComplete =
    heuresManquantes <= 0.01;

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

    const heuresAbsence = absenceNecessiteHeures(absence)
      ? jour.heuresAbsence
      : "";

    const dureeCP = absence === CODE_CP ? jour.dureeCP : "JOURNEE";

    modifierJour(jour.date, {
      absence,
      presence: estAbsent ? "ABSENT" : jour.presence === "ABSENT" ? "PRESENTIEL" : jour.presence,
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
    }

    setMessage("");
    setMessageType("");
    semaineModifieeRef.current = false;
    setSemaineModifiee(false);
    setSemaineEnregistree(false);
    setSemaineValidee(false);
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

      if (
        jour.absence === CODE_RT &&
        jour.dureeRTT === "DEMI_JOURNEE" &&
        totalImputations(jour) <= 0
      ) {
        setMessage(
          `Le ${jour.jour} ${dateAffichage(
            jour.date
          )} : un RTT d'une demi-journée doit être complété par des heures travaillées.`
        );
        setMessageType("DANGER");
        return false;
      }

      if (imputationsInterdites(jour, codesImputation)) {
        continue;
      }

      for (const ligne of jour.imputations) {
        const heures = convertirHeures(ligne.heures);

        if (
          ligne.typeAffaire !== "Divers" &&
          ligne.numeroAffaire &&
          !/^\d{4}$/.test(ligne.numeroAffaire)
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : le numéro d'affaire doit comporter exactement 4 chiffres.`
          );
          setMessageType("DANGER");
          return false;
        }

        if (
          ligne.heures &&
          ligne.typeAffaire !== "Divers" &&
          (!ligne.code || !/^\d{4}$/.test(ligne.numeroAffaire))
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : impossible de saisir des heures sans code affaire et numéro d'affaire sur 4 chiffres.`
          );
          setMessageType("DANGER");
          return false;
        }

        if (
          ligne.heures &&
          ligne.typeAffaire === "Divers" &&
          !ligne.code
        ) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : impossible de saisir des heures sans sélectionner un code Divers.`
          );
          setMessageType("DANGER");
          return false;
        }

        if (heures < 0) {
          setMessage(
            `Le ${jour.jour} ${dateAffichage(
              jour.date
            )} : le nombre d'heures ne peut pas être négatif.`
          );
          setMessageType("DANGER");
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
        `Saisie valide. Le brouillon peut être enregistré ; il reste ${formatHeures(
          heuresManquantes
        )} h à renseigner.`
      );
    } else {
      setMessage(
        "Semaine complète. Vous pouvez l'enregistrer puis la valider."
      );
    }

    setMessageType("OK");
    return true;
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
        .select("id, statut, mode_heures_supplementaires, compteur_avant, compteur_apres, verrouillee")
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
        setModeHeuresSupplementaires(null);
        setFeuilleVerrouillee(false);

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

      // Pour un brouillon, le choix COMPTEUR/PAYE n'est pas considéré
      // comme validé. On le redemande lors de la validation finale si
      // des heures supplémentaires existent.
      setModeHeuresSupplementaires(
        feuille.statut === "BROUILLON"
          ? null
          : feuille.mode_heures_supplementaires === "PAYE"
            ? "PAYE"
            : feuille.mode_heures_supplementaires === "COMPTEUR"
              ? "COMPTEUR"
              : null
      );

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

        jour.presence =
          jourDB.presence;

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
      const totalHeuresChargees = semaineChargee.reduce(
        (total, jour) => total + totalImputations(jour),
        0
      );

      const totalTheoriqueCharge = semaineChargee.reduce(
        (total, jour) =>
          total + cibleTravailJour(jour, codesImputation),
        0
      );

      const feuilleEstComplete =
        totalHeuresChargees >= totalTheoriqueCharge - 0.01;

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

  async function sauvegarderSemaine(
    validationFinale: boolean,
    modeForce?: ModeHeuresSupplementaires
  ) {
    if (feuilleVerrouillee && !modeAdmin) {
      setMessage(
        "Cette feuille est verrouillée par l'administration. Elle ne peut plus être modifiée."
      );
      setMessageType("DANGER");
      return;
    }

    if (!collaborateur) {
      setMessage("Le collaborateur n'est pas chargé.");
      setMessageType("DANGER");
      return;
    }

    const valide = verifierSemaine(validationFinale);
    if (!valide) {
      return;
    }

    const modeEffectif = modeForce ?? modeHeuresSupplementaires;

    if (
      validationFinale &&
      heuresSupplementaires > 0.01 &&
      modeEffectif === null
    ) {
      setChoixHeuresSupOuvert(true);
      return;
    }

    setEnregistrement(true);
    setMessage(
      validationFinale
        ? "Validation et enregistrement de la semaine..."
        : "Enregistrement du brouillon..."
    );
    setMessageType("OK");

    try {
      const semaineDebut = semaine[0].date;

      const compteurAvantEnregistrement =
        await recupererCompteurAvant(
          collaborateur.id,
          semaineDebut
        );

      setCompteurBaseSemaine(compteurAvantEnregistrement);

      const heuresSupplementairesCompteur =
        validationFinale && modeEffectif === "COMPTEUR"
          ? heuresSupplementaires
          : 0;

      const compteurApresEnregistrement =
        validationFinale
          ? compteurAvantEnregistrement +
            heuresSupplementairesCompteur -
            totalRE
          : compteurAvantEnregistrement;

      if (
        validationFinale &&
        (compteurApresEnregistrement < -30 ||
          compteurApresEnregistrement > 30)
      ) {
        setMessage(
          `Le compteur de récupération serait de ${formatHeures(
            compteurApresEnregistrement
          )} h. La limite autorisée est de -30 h à +30 h.`
        );
        setMessageType("DANGER");
        return;
      }

      const {
        data: feuilleExistante,
        error: erreurRecherche,
      } = await supabase
        .from("feuilles_heures")
        .select("id")
        .eq("collaborateur_id", collaborateur.id)
        .eq("semaine_debut", semaineDebut)
        .maybeSingle();

      if (erreurRecherche) {
        throw erreurRecherche;
      }

      const statut = validationFinale
        ? "A_TRAITER"
        : "BROUILLON";

      const donneesFeuille = {
        statut,
        total_heures: totalHeuresSemaine,
        total_theorique: base35Semaine,
        heures_supplementaires: heuresSupplementaires,
        // Le statut BROUILLON permet de sauvegarder à tout moment.
        // On conserve une valeur technique COMPTEUR pour rester compatible
        // avec une éventuelle contrainte NOT NULL sur cette colonne ;
        // elle est volontairement ignorée au rechargement d'un brouillon.
        mode_heures_supplementaires: validationFinale
          ? modeEffectif
          : "COMPTEUR",
        total_re: totalRE,
        compteur_avant: compteurAvantEnregistrement,
        compteur_apres: validationFinale
          ? compteurApresEnregistrement
          : compteurAvantEnregistrement,
        updated_at: new Date().toISOString(),
      };

      let feuilleId: string;

      if (feuilleExistante) {
        feuilleId = feuilleExistante.id;

        const { error: erreurSuppressionJours } =
          await supabase
            .from("feuilles_heures_jours")
            .delete()
            .eq("feuille_id", feuilleId);

        if (erreurSuppressionJours) {
          throw erreurSuppressionJours;
        }

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

      const joursAInserer = semaine.map(
        jour => ({
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
        numero_affaire: string | null;
        description: string | null;
        code: string;
        heures: number;
      }[] = [];

      for (const jour of semaine) {
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
        const {
          data: feuillesSuivantes,
          error: erreurSuivantes,
        } = await supabase
          .from("feuilles_heures")
          .select(
            "id, semaine_debut, heures_supplementaires, mode_heures_supplementaires, total_re"
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
          const hsCompteur =
            suivante.mode_heures_supplementaires === "COMPTEUR"
              ? Number(suivante.heures_supplementaires ?? 0)
              : 0;

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

      setFeuilleVerrouillee(false);
      setSemaineEnregistree(true);
      setSemaineValidee(validationFinale);
      semaineModifieeRef.current = false;
      setSemaineModifiee(false);

      if (validationFinale) {
        setMessage(
          `Semaine du ${dateAffichage(
            semaineDebut
          )} validée et transmise à POLYNOV.`
        );
      } else if (heuresManquantes > 0.01) {
        setMessage(
          `Brouillon de la semaine du ${dateAffichage(
            semaineDebut
          )} enregistré. Il reste ${formatHeures(
            heuresManquantes
          )} h à renseigner.`
        );
      } else {
        setMessage(
          `Brouillon de la semaine du ${dateAffichage(
            semaineDebut
          )} enregistré. La semaine est complète : vous pouvez maintenant la valider.`
        );
      }

      setMessageType("OK");
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

  async function enregistrerBrouillon() {
    await sauvegarderSemaine(false);
  }

  async function validerSemaine(
    modeForce?: ModeHeuresSupplementaires
  ) {
    await sauvegarderSemaine(true, modeForce);
  }

  /* ============================================================
     CHARGEMENT
  ============================================================ */

  if (chargement || !codesCharges) {
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
          disabled={feuilleVerrouillee && !modeAdmin}
          style={{
            border: 0,
            padding: 0,
            margin: 0,
            minWidth: 0,
          }}
        >
        <div style={styles.cards}>
          {!modeAdmin && feuilleVerrouillee && (
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

            <div style={styles.cardHint}>
              Base normale : 35 h. Les heures au-delà sont comptées en heures sup.
            </div>

            {heuresSupplementaires > 0.01 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#777", letterSpacing: ".5px", marginBottom: 6 }}>
                  QUE FAIRE DE CES HEURES ?
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setModeHeuresSupplementaires("COMPTEUR");
                      semaineModifieeRef.current = true;
                      setSemaineModifiee(true);
                      setSemaineEnregistree(false);
                      setSemaineValidee(false);
                    }}
                    style={{
                      border: modeHeuresSupplementaires === "COMPTEUR" ? "2px solid #c00000" : "1px solid #ddd",
                      background: modeHeuresSupplementaires === "COMPTEUR" ? "#fff5f5" : "#fff",
                      color: modeHeuresSupplementaires === "COMPTEUR" ? "#c00000" : "#555",
                      borderRadius: 8,
                      padding: "8px 6px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontFamily: "Calibri, Arial, sans-serif",
                      fontSize: 11,
                    }}
                  >
                    ↻ Compteur
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModeHeuresSupplementaires("PAYE");
                      semaineModifieeRef.current = true;
                      setSemaineModifiee(true);
                      setSemaineEnregistree(false);
                      setSemaineValidee(false);
                    }}
                    style={{
                      border: modeHeuresSupplementaires === "PAYE" ? "2px solid #138113" : "1px solid #ddd",
                      background: modeHeuresSupplementaires === "PAYE" ? "#f2faf2" : "#fff",
                      color: modeHeuresSupplementaires === "PAYE" ? "#138113" : "#555",
                      borderRadius: 8,
                      padding: "8px 6px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontFamily: "Calibri, Arial, sans-serif",
                      fontSize: 11,
                    }}
                  >
                    € Payées
                  </button>
                </div>
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
                                fontWeight: 700,
                                marginTop: 3,
                              }}
                            >
                              +{formatHeures(heuresJour - cibleTravailJour(jour, codesImputation))} h
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

                      {/* CP : JOURNEE / DEMI-JOURNEE */}

                      {jour.absence === CODE_CP && (
                        <div style={styles.rttBox}>
                          <strong>Congés payés :</strong>
                          <select
                            value={jour.dureeCP}
                            onChange={e => modifierJour(jour.date, {
                              dureeCP: e.target.value as DureeRTT,
                              presence: e.target.value === "JOURNEE" ? "ABSENT" : "PRESENTIEL",
                              ticketRestaurant: e.target.value === "DEMI_JOURNEE" && !jour.estWeekend,
                              imputations: e.target.value === "JOURNEE" ? [] : jour.imputations,
                            })}
                            style={{ ...styles.input, width: 160 }}
                          >
                            <option value="JOURNEE">Journée</option>
                            <option value="DEMI_JOURNEE">1/2 journée</option>
                          </select>
                          <span>
                            {jour.dureeCP === "DEMI_JOURNEE"
                              ? `Il reste ${formatHeures(jour.heuresTheoriques / 2)} h à travailler.`
                              : "Journée non travaillée."}
                          </span>
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
                                        e.target.value === "Divers"
                                          ? ""
                                          : (e.target.value === "CBE"
                                              ? codesAffaire
                                              : codesDevis
                                            ).some(c => c.code === ligne.code)
                                            ? ligne.code
                                            : "",
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
                                      code: e.target.value,
                                    }
                                  )
                                }
                                style={
                                  styles.input
                                }
                              >
                                <option value="">
                                  {getCodesPourType(ligne.typeAffaire).length === 0
                                    ? "Aucun code autorisé dans Gestion-code"
                                    : ligne.typeAffaire === "Divers"
                                      ? "Choisir un code Divers..."
                                      : ligne.typeAffaire === "DBE"
                                        ? "Choisir un code devis..."
                                        : "Choisir un code affaire..."}
                                </option>

                                {getCodesPourType(ligne.typeAffaire).map(code => (
                                  <option key={code.code} value={code.code}>
                                    {code.code} — {code.libelle}
                                  </option>
                                ))}
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

        </fieldset>

        {/* ====================================================
            ETAT / RAPPEL
        ==================================================== */}

        {semaineModifiee && semaineComplete && (
          <div
            style={styles.saveReminder}
          >
            <div
              style={styles.saveReminderIcon}
            >
              ✓
            </div>

            <div
              style={styles.saveReminderText}
            >
              <strong>Votre semaine est complète.</strong>
              <div>
                Toutes les heures prévues sont renseignées.
                <br />
                Enregistrez le brouillon puis cliquez sur
                <strong> « Valider ma semaine »</strong>.
              </div>
            </div>

            <button
              type="button"
              onClick={enregistrerBrouillon}
              disabled={
                enregistrement ||
                (feuilleVerrouillee && !modeAdmin)
              }
              style={styles.saveReminderButton}
            >
              {enregistrement
                ? "Enregistrement..."
                : "Enregistrer"}
            </button>
          </div>
        )}

        {!semaineModifiee &&
          semaineEnregistree &&
          !semaineValidee &&
          semaineComplete && (
            <div
              style={styles.validationReminder}
            >
              <div
                style={styles.validationReminderIcon}
              >
                !
              </div>

              <div
                style={styles.validationReminderText}
              >
                <strong>Votre brouillon est complet.</strong>
                <div>
                  La semaine doit maintenant être validée pour être transmise.
                </div>
              </div>

              <button
                type="button"
                onClick={() => validerSemaine()}
                disabled={
                  enregistrement ||
                  (feuilleVerrouillee && !modeAdmin)
                }
                style={styles.validationReminderButton}
              >
                {enregistrement
                  ? "Validation..."
                  : "✓ Valider ma semaine"}
              </button>
            </div>
          )}

        {/* ====================================================
            ACTIONS
        ==================================================== */}

        <div
          style={
            styles.bottomActions
          }
        >
          <button
            onClick={() => verifierSemaine(true)}
            style={
              styles.buttonSecondary
            }
            disabled={
              enregistrement ||
              (feuilleVerrouillee && !modeAdmin)
            }
          >
            Vérifier ma semaine
          </button>

          <button
            type="button"
            onClick={enregistrerBrouillon}
            disabled={
              enregistrement ||
              (feuilleVerrouillee && !modeAdmin)
            }
            style={styles.buttonDraft}
          >
            {enregistrement
              ? "Enregistrement..."
              : "💾 Enregistrer le brouillon"}
          </button>

          <button
            type="button"
            onClick={() => validerSemaine()}
            disabled={
              enregistrement ||
              !semaineComplete ||
              (semaineValidee && !semaineModifiee) ||
              (feuilleVerrouillee && !modeAdmin)
            }
            style={{
              ...styles.buttonValidate,
              opacity:
                enregistrement ||
                !semaineComplete ||
                (semaineValidee && !semaineModifiee) ||
                (feuilleVerrouillee && !modeAdmin)
                  ? 0.55
                  : 1,
              cursor:
                enregistrement ||
                !semaineComplete ||
                (semaineValidee && !semaineModifiee) ||
                (feuilleVerrouillee && !modeAdmin)
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {semaineValidee && !semaineModifiee
              ? "✓ Semaine validée"
              : !semaineComplete
                ? `⚠ Il reste ${formatHeures(heuresManquantes)} h`
                : "✓ Valider ma semaine"}
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
                h par rapport au
                rythme prévu de la semaine.
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
    
      {choixHeuresSupOuvert && heuresSupplementaires > 0.01 && (
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
              maxWidth: 480,
              background: "#fff",
              borderRadius: 16,
              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
              fontFamily: "Calibri, Arial, sans-serif",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>
              Que souhaitez-vous faire de vos heures supplémentaires ?
            </div>
            <div style={{ color: "#666", lineHeight: 1.5, marginBottom: 20 }}>
              Cette semaine comporte <strong>+{formatHeures(heuresSupplementaires)} h</strong> supplémentaires.
              <br />Choisissez explicitement leur traitement avant l'enregistrement.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setModeHeuresSupplementaires("COMPTEUR");
                  setChoixHeuresSupOuvert(false);
                  void validerSemaine("COMPTEUR");
                }}
                style={{ border: "2px solid #c00000", background: "#fff5f5", color: "#c00000", borderRadius: 10, padding: 16, fontWeight: 800, cursor: "pointer" }}
              >
                ↻ Mettre au compteur
                <span style={{ display: "block", fontSize: 12, fontWeight: 400, marginTop: 5 }}>Les heures alimentent le compteur RE.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setModeHeuresSupplementaires("PAYE");
                  setChoixHeuresSupOuvert(false);
                  void validerSemaine("PAYE");
                }}
                style={{ border: "2px solid #138113", background: "#f2faf2", color: "#138113", borderRadius: 10, padding: 16, fontWeight: 800, cursor: "pointer" }}
              >
                € Heures payées
                <span style={{ display: "block", fontSize: 12, fontWeight: 400, marginTop: 5 }}>Les heures ne alimentent pas le compteur RE.</span>
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
      "repeat(3, 1fr)",
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