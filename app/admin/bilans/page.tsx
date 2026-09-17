"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/* =========================================================
   TYPES
========================================================= */

type Collaborateur = {
  id: string;
  trigramme: string | null;
  prenom: string | null;
  nom: string | null;
  email?: string | null;
  actif?: boolean | null;
  role?: string | null;
  profil_horaire_id?: string | null;
};

type ProfilHoraire = {
  id: string;
  nom: string | null;
  lundi: number | null;
  mardi: number | null;
  mercredi: number | null;
  jeudi: number | null;
  vendredi: number | null;
  samedi?: number | null;
  dimanche?: number | null;
};

type HistoriqueImputation = {
  id: string;
  collaborateur_id: string;
  annee: number;
  semaine: number;
  affaire_code: string | null;
  code_imputation: string | null;
  heures: number | null;
};

type HistoriquePresence = {
  id: string;
  collaborateur_id: string;
  annee: number;
  semaine: number;
  tickets_restaurant?: number | null;
  jours_teletravail?: number | null;
  jours_presentiel?: number | null;
  jours_absent?: number | null;
  heures_sup?: number | null;
};

type FeuilleHeures = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  total_heures: number | null;
  total_theorique: number | null;
  heures_supplementaires: number | null;
  statut?: string | null;
};

type FeuilleJour = {
  id: string;
  feuille_id: string;
  date_jour: string;
  presence: string | null;
  absence: string | null;
  ticket_restaurant?: boolean | null;
  total_heures: number | null;
};

type FeuilleImputation = {
  id: string;
  jour_id: string;
  type_affaire: string | null;
  numero_affaire: string | null;
  description: string | null;
  code: string | null;
  heures: number | null;
};

type ModePeriode = "EXERCICE" | "ANNEE" | "MOIS" | "LIBRE";

type Categorie =
  | "CBE"
  | "DBE"
  | "NI"
  | "CN"
  | "FORMATION"
  | "AUTRES"
  | "AFFAIRES_SANS_TYPE"
  | "DIVERS_ABSENCES"
  | "IGNORE";

type SemaineConsolidee = {
  annee: number;
  semaine: number;

  debut: string;
  fin: string;

  capacite: number;

  cbe: number;
  dbe: number;
  ni: number;
  cn: number;
  formation: number;
  autres: number;
  ignorees: number;

  affairesSansType: number;

  heuresAbsence: number;

  totalTravaille: number;

  nonExplique: number;

  source: "HISTORIQUE" | "NOUVEAU";
  collaborateurs: Record<string, CollaborateurSemaine>;
};

type CollaborateurSemaine = {
  collaborateurId: string;
  trigramme: string;
  nom: string;

  capacite: number;

  cbe: number;
  dbe: number;
  ni: number;
  cn: number;
  formation: number;
  autres: number;
  ignorees: number;

  affairesSansType: number;

  absence: number;

  travaille: number;
  nonExplique: number;

  source: "HISTORIQUE" | "NOUVEAU";
};

type BilanCollaborateur = {
  collaborateurId: string;

  capacite: number;
  cbe: number;
  dbe: number;
  ni: number;
  cn: number;
  formation: number;
  autres: number;
  ignorees: number;

  affairesSansType: number;

  absence: number;
  travaille: number;
  nonExplique: number;
};

type LigneNonExpliquee = {
  id: string;

  annee: number;
  semaine: number;

  collaborateurId: string;
  trigramme: string;
  nom: string;

  capacite: number;

  cbe: number;
  dbe: number;
  ni: number;
  cn: number;
  formation: number;
  autres: number;
  ignorees: number;

  affairesSansType: number;

  nonExplique: number;

  source: "HISTORIQUE" | "NOUVEAU";
};

/* =========================================================
   CONSTANTES
========================================================= */

const CODE_NI = "NI";

const CODES_FORMATION = ["FO", "FI"];

// Divers de production : codes présents dans les lignes "Divers"
// de l'ancien Excel mais qui correspondent bien à de l'activité de production.
// Cette liste pourra être enrichie sans toucher au reste du bilan.
const CODES_DIVERS_PRODUCTION = [
  "EM",
  "EI",
  "IF",
  "IM",
  "MP",
  "RN",
  "DT",
  "SC",
  "DM",
  "SU",
  "LI",
  "EE",
  "EP",
  "CO",
  "CM",
  "ET",
  "HT",
  "BD",
  "RS",
  "NC",
  "TQ",
];

// Divers d'absences : on remonte volontairement uniquement ces codes.
const CODES_DIVERS_ABSENCES = [
  "RE",
  "ML",
  "VM",
  "AA",
  "AT",
  "AI",
];

// Ces codes existent dans l'historique mais ne doivent ni apparaître
// comme "Autres" ni gonfler le "Non expliqué".
const CODES_A_IGNORER = [
  "FE",
  "CP",
  "GI",
  "AC",
  "AP",
];

const CODE_CN = "CN";

// Codes d'absence utilisés par le nouveau système lorsqu'une journée
// ne possède pas d'imputation détaillée.
const CODES_ABSENCE = [
  ...CODES_DIVERS_ABSENCES,
  "RTT",
  "ABS",
  "ABSENCE",
];

const COULEURS = {
  rouge: "#c00000",
  orange: "#e58a00",
  gris: "#8a8a8a",
  violet: "#8b6bb1",
  grisClair: "#cfcfcf",
  blanc: "#ffffff",
  fond: "#f5f6f8",
  bordure: "#e2e5e9",
  texte: "#252525",
  texteSecondaire: "#6d737a",
  vert: "#238636",
  rougeClair: "#fbe9e9",
  orangeClair: "#fff2df",
  grisTresClair: "#f0f0f0",
};

const MOIS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/* =========================================================
   HELPERS
========================================================= */

function normaliserTexte(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function nombre(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function arrondir(value: number, decimals = 1): number {
  const puissance = Math.pow(10, decimals);
  return Math.round(value * puissance) / puissance;
}

function heures(value: number): string {
  const n = Math.abs(value);

  if (n < 0.01) return "0h";

  const h = Math.floor(n);
  const minutes = Math.round((n - h) * 60);

  if (minutes === 0) {
    return `${h}h`;
  }

  if (h === 0) {
    return `${minutes}min`;
  }

  return `${h}h${String(minutes).padStart(2, "0")}`;
}

function pourcentage(value: number): string {
  return `${Math.round(value)} %`;
}

function taux(value: number, capacite: number): number {
  if (capacite <= 0) return 0;
  return (value / capacite) * 100;
}

function lundiSemaine(
  annee: number,
  semaine: number
): Date {
  const d = new Date(Date.UTC(annee, 0, 4));

  const jour = d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() -
    jour +
    1 +
    (semaine - 1) * 7
  );

  return d;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function debutFinSemaine(
  annee: number,
  semaine: number
) {
  const debut = lundiSemaine(annee, semaine);

  const fin = new Date(debut);
  fin.setUTCDate(fin.getUTCDate() + 6);

  return {
    debut: formatDate(debut),
    fin: formatDate(fin),
  };
}

function isoSemaine(date: Date) {
  const d = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const jour = d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() + 4 - jour
  );

  const annee = d.getUTCFullYear();

  const debut = new Date(
    Date.UTC(annee, 0, 1)
  );

  const semaine = Math.ceil(
    ((d.getTime() - debut.getTime()) / 86400000 + 1) /
    7
  );

  return {
    annee,
    semaine,
  };
}

function estCodeAbsence(code: string): boolean {
  return CODES_ABSENCE.includes(
    normaliserTexte(code)
  );
}

function estFormation(code: string): boolean {
  return CODES_FORMATION.includes(
    normaliserTexte(code)
  );
}

function estNI(code: string): boolean {
  return normaliserTexte(code) === CODE_NI;
}

function estCN(code: string): boolean {
  return normaliserTexte(code) === CODE_CN;
}

function estDiversProduction(code: string): boolean {
  return CODES_DIVERS_PRODUCTION.includes(
    normaliserTexte(code)
  );
}

function estDiversAbsence(code: string): boolean {
  return CODES_DIVERS_ABSENCES.includes(
    normaliserTexte(code)
  );
}

function estCodeIgnore(code: string): boolean {
  return CODES_A_IGNORER.includes(
    normaliserTexte(code)
  );
}

/* =========================================================
   CBE / DBE HISTORIQUE
========================================================= */

/*
  IMPORTANT :

  ImportV2 stocke normalement :

      CBE 1487
      DBE 2835
      DBE 2923

  On ne doit donc surtout PAS faire :

      "tout ce qui n'est pas DBE = CBE"

  sinon un ancien enregistrement sans préfixe
  devient artificiellement un CBE.
*/

function typeAffaireHistorique(
  affaire: string | null
): "CBE" | "DBE" | null {
  const a = normaliserTexte(affaire);

  if (!a) return null;

  if (
    /\bDBE\s*[-:]?\s*\d+\b/.test(a) ||
    /^DBE\d+$/.test(a)
  ) {
    return "DBE";
  }

  if (
    /\bCBE\s*[-:]?\s*\d+\b/.test(a) ||
    /^CBE\d+$/.test(a)
  ) {
    return "CBE";
  }

  return null;
}

function numeroAffaireHistorique(
  affaire: string | null
): string {
  const a = String(affaire ?? "").trim();

  return a
    .replace(
      /^(?:CBE|DBE)\s*[-:]?\s*/i,
      ""
    )
    .trim();
}

/* =========================================================
   CLASSIFICATION
========================================================= */

function classifierHistorique(
  ligne: HistoriqueImputation
): Categorie | null {
  const code = normaliserTexte(
    ligne.code_imputation
  );

  const affaire = ligne.affaire_code;

  /*
    NI / CN / codes ignorés / formation.
    Puis seulement on regarde le type d'affaire.

    IMPORTANT :
    si une ligne porte par exemple :
      code = RN
      affaire = DBE 2901

    c'est bien une heure DBE.
    RN ne doit devenir "Divers de production"
    que lorsqu'il n'y a pas d'affaire CBE/DBE.
  */
  if (estNI(code)) {
    return "NI";
  }

  if (estCN(code)) {
    return "CN";
  }

  if (estCodeIgnore(code)) {
    return "IGNORE";
  }

  if (estFormation(code)) {
    return "FORMATION";
  }

  const typeAffaire =
    typeAffaireHistorique(affaire);

  if (typeAffaire === "CBE") {
    return "CBE";
  }

  if (typeAffaire === "DBE") {
    return "DBE";
  }

  if (estDiversAbsence(code)) {
    return "DIVERS_ABSENCES";
  }

  if (estDiversProduction(code)) {
    return "AFFAIRES_SANS_TYPE";
  }

  /*
    Les autres codes d'absence restent hors
    du bilan : ils ne doivent ni produire du
    "non expliqué" ni devenir de la production.
  */
  if (estCodeAbsence(code)) {
    return null;
  }

  /*
    Une affaire existe mais son type est inconnu.
    On ne fabrique pas un CBE.
  */
  if (
    String(affaire ?? "").trim() !== ""
  ) {
    return "AFFAIRES_SANS_TYPE";
  }

  return "AUTRES";
}

/* =========================================================
   PROFIL / CAPACITE
========================================================= */

function capaciteProfil(
  profil: ProfilHoraire | null | undefined
): number {
  if (!profil) {
    return 35;
  }

  return (
    nombre(profil.lundi) +
    nombre(profil.mardi) +
    nombre(profil.mercredi) +
    nombre(profil.jeudi) +
    nombre(profil.vendredi)
  );
}

function estCadreForfait(
  collaborateur: Collaborateur,
  profil?: ProfilHoraire | null
): boolean {
  const texte = normaliserTexte(
    `${collaborateur.role ?? ""} ${profil?.nom ?? ""
    }`
  );

  return (
    texte.includes("FORFAIT") &&
    texte.includes("CADRE")
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function BilansPage() {
  const router = useRouter();

  const maintenant = new Date();

  const semaineActuelle =
    isoSemaine(maintenant);

  const [collaborateurs, setCollaborateurs] =
    useState<Collaborateur[]>([]);

  const [profils, setProfils] =
    useState<ProfilHoraire[]>([]);

  const [historique, setHistorique] =
    useState<HistoriqueImputation[]>([]);

  const [presencesHistorique, setPresencesHistorique] =
    useState<HistoriquePresence[]>([]);

  const [feuilles, setFeuilles] =
    useState<FeuilleHeures[]>([]);

  const [jours, setJours] =
    useState<FeuilleJour[]>([]);

  const [imputations, setImputations] =
    useState<FeuilleImputation[]>([]);

  const [chargement, setChargement] =
    useState(true);

  const [erreur, setErreur] =
    useState("");

  /* -----------------------------------------------
     FILTRES
  ------------------------------------------------ */

  const [modePeriode, setModePeriode] =
    useState<ModePeriode>("EXERCICE");

  // Exercice POLYNOV : du 1er novembre au 31 octobre.
  // En septembre 2026, l'exercice en cours est donc 2025-2026.
  const exerciceParDefaut =
    maintenant.getMonth() >= 10
      ? maintenant.getFullYear()
      : maintenant.getFullYear() - 1;

  const [annee, setAnnee] =
    useState(exerciceParDefaut);

  const [mois, setMois] =
    useState(maintenant.getMonth());

  const [dateDebutLibre, setDateDebutLibre] =
    useState("");

  const [dateFinLibre, setDateFinLibre] =
    useState("");

  const [collaborateurFiltre, setCollaborateurFiltre] =
    useState("TOUS");

  const [recherche, setRecherche] =
    useState("");

  const [onglet, setOnglet] =
    useState<
      "PILOTAGE" | "NON_EXPLIQUE" | "COLLABORATEURS"
    >("PILOTAGE");

  /* -----------------------------------------------
     CHARGEMENT
  ------------------------------------------------ */

  async function chargerDonnees() {
    setChargement(true);
    setErreur("");

    try {
      /*
        Supabase limite souvent les résultats PostgREST à 1000 lignes.
        Pour les historiques, on charge donc les lignes par paquets de 1000.
      */
      async function chargerToutesLesLignes<T>(
        requeteBase: any
      ): Promise<T[]> {
        const taillePage = 1000;
        const toutes: T[] = [];
        let debut = 0;

        while (true) {
          const { data, error } = await requeteBase
            .range(debut, debut + taillePage - 1);

          if (error) {
            throw error;
          }

          const lignes = (data ?? []) as T[];
          toutes.push(...lignes);

          if (lignes.length < taillePage) {
            break;
          }

          debut += taillePage;
        }

        return toutes;
      }

      const [
        collaborateursRes,
        profilsRes,
        historiqueToutes,
        presenceToutes,
        feuillesRes,
      ] = await Promise.all([
        /*
          IMPORTANT : on charge aussi les anciens collaborateurs inactifs.
          Un historique 2024/2025 peut appartenir à quelqu'un qui n'est plus
          actif aujourd'hui. Le filtre actif=true supprimait alors ses données.
        */
        supabase
          .from("collaborateurs")
          .select(
            "id,trigramme,prenom,nom,email,actif,role,profil_horaire_id"
          )
          .order("nom"),

        supabase
          .from("profils_horaires")
          .select(
            "id,nom,lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche"
          ),

        chargerToutesLesLignes<HistoriqueImputation>(
          supabase
            .from("historique_imputations")
            .select(
              "id,collaborateur_id,annee,semaine,affaire_code,code_imputation,heures"
            )
            .order("annee", { ascending: true })
            .order("semaine", { ascending: true })
        ),

        chargerToutesLesLignes<HistoriquePresence>(
          supabase
            .from("historique_presence")
            .select(
              "id,collaborateur_id,annee,semaine,tickets_restaurant,jours_teletravail,jours_presentiel,jours_absent,heures_sup"
            )
            .order("annee", { ascending: true })
            .order("semaine", { ascending: true })
        ),

        supabase
          .from("feuilles_heures")
          .select(
            "id,collaborateur_id,semaine_debut,total_heures,total_theorique,heures_supplementaires,statut"
          ),
      ]);

      if (collaborateursRes.error) {
        throw collaborateursRes.error;
      }

      if (profilsRes.error) {
        throw profilsRes.error;
      }

      // Les historiques ont déjà été chargés intégralement ci-dessus.

      if (feuillesRes.error) {
        throw feuillesRes.error;
      }

      const feuillesChargees =
        (feuillesRes.data ??
          []) as FeuilleHeures[];

      setCollaborateurs(
        (collaborateursRes.data ??
          []) as Collaborateur[]
      );

      setProfils(
        (profilsRes.data ??
          []) as ProfilHoraire[]
      );

      setHistorique(historiqueToutes);

      setPresencesHistorique(presenceToutes);

      console.log(
        "Historique imputations :",
        historiqueToutes.length
      );

      console.log(
        "Historique présence :",
        presenceToutes.length
      );
      ``






      setFeuilles(feuillesChargees);

      const idsCollaborateurs = new Set(
        (collaborateursRes.data ?? []).map(
          (c: any) => c.id
        )
      );

      console.log(
        "BILAN DEBUG correspondance collaborateurs",
        {
          collaborateurs: collaborateursRes.data?.length ?? 0,
          historiquesImputations: historiqueToutes.length,
          historiquesPresences: presenceToutes.length,
          imputationsSansCollaborateur: historiqueToutes.filter(
            (h) => !idsCollaborateurs.has(h.collaborateur_id)
          ).length,
          presencesSansCollaborateur: presenceToutes.filter(
            (p) => !idsCollaborateurs.has(p.collaborateur_id)
          ).length,
        }
      );

      /*
        Les jours / imputations du nouveau système
        sont chargés uniquement pour les feuilles
        existantes.
      */

      if (feuillesChargees.length > 0) {
        const idsFeuilles =
          feuillesChargees.map((f) => f.id);

        const joursRes = await supabase
          .from("feuilles_heures_jours")
          .select(
            "id,feuille_id,date_jour,presence,absence,ticket_restaurant,total_heures"
          )
          .in("feuille_id", idsFeuilles);

        if (joursRes.error) {
          throw joursRes.error;
        }

        const joursCharges =
          (joursRes.data ??
            []) as FeuilleJour[];

        setJours(joursCharges);

        if (joursCharges.length > 0) {
          const idsJours =
            joursCharges.map((j) => j.id);

          const imputationsRes =
            await supabase
              .from("feuilles_heures_imputations")
              .select(
                "id,jour_id,type_affaire,numero_affaire,description,code,heures"
              )
              .in("jour_id", idsJours);

          if (imputationsRes.error) {
            throw imputationsRes.error;
          }

          setImputations(
            (imputationsRes.data ??
              []) as FeuilleImputation[]
          );
        } else {
          setImputations([]);
        }
      } else {
        setJours([]);
        setImputations([]);
      }
    } catch (e: any) {
      console.error(e);

      setErreur(
        e?.message ??
        "Impossible de charger les données."
      );
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    chargerDonnees();
  }, []);

  /* =====================================================
     MAPS
  ===================================================== */

  const collaborateursMap =
    useMemo(() => {
      const map = new Map<
        string,
        Collaborateur
      >();

      collaborateurs.forEach((c) =>
        map.set(c.id, c)
      );

      return map;
    }, [collaborateurs]);

  const profilsMap =
    useMemo(() => {
      const map = new Map<
        string,
        ProfilHoraire
      >();

      profils.forEach((p) =>
        map.set(p.id, p)
      );

      return map;
    }, [profils]);

  const feuillesMap =
    useMemo(() => {
      const map = new Map<
        string,
        FeuilleHeures
      >();

      feuilles.forEach((f) =>
        map.set(f.id, f)
      );

      return map;
    }, [feuilles]);

  /* =====================================================
     CAPACITE HISTORIQUE
  ===================================================== */

  function capaciteCollaborateurHistorique(
    collaborateur: Collaborateur
  ): number {
    /*
      AMA est cadre forfait :
      elle n'est pas ramenée artificiellement
      à 35h de capacité productive.
    */

    const profil =
      collaborateur.profil_horaire_id
        ? profilsMap.get(
          collaborateur.profil_horaire_id
        )
        : null;

    if (
      estCadreForfait(
        collaborateur,
        profil
      )
    ) {
      return 0;
    }

    return capaciteProfil(profil);
  }

  /* =====================================================
     SEMAINES DISPONIBLES
  ===================================================== */

  const semainesDisponibles =
    useMemo(() => {
      const set = new Set<string>();

      historique.forEach((h) => {
        set.add(
          `${h.annee}-${h.semaine}`
        );
      });

      presencesHistorique.forEach((p) => {
        set.add(
          `${p.annee}-${p.semaine}`
        );
      });

      feuilles.forEach((f) => {
        if (!f.semaine_debut) return;

        const date = new Date(
          `${f.semaine_debut}T00:00:00`
        );

        if (Number.isNaN(date.getTime())) return;

        const { annee, semaine } = isoSemaine(date);

        set.add(
          `${annee}-${semaine}`
        );
      });

      return Array.from(set)
        .map((value) => {
          const [a, s] =
            value.split("-").map(Number);

          return {
            annee: a,
            semaine: s,
          };
        })
        .sort((a, b) => {
          if (a.annee !== b.annee) {
            return a.annee - b.annee;
          }

          return a.semaine - b.semaine;
        });
    }, [
      historique,
      presencesHistorique,
      feuilles,
    ]);

  /* =====================================================
     PERIODE
  ===================================================== */

  const periodeActive =
    useMemo(() => {
      if (modePeriode === "LIBRE") {
        if (
          !dateDebutLibre ||
          !dateFinLibre
        ) {
          return null;
        }

        const debut =
          new Date(
            `${dateDebutLibre}T00:00:00`
          );

        const fin =
          new Date(
            `${dateFinLibre}T23:59:59`
          );

        return {
          debut,
          fin,
        };
      }

      if (modePeriode === "ANNEE") {
        return {
          debut: new Date(
            annee,
            0,
            1
          ),
          fin: new Date(
            annee,
            11,
            31,
            23,
            59,
            59
          ),
        };
      }

      if (modePeriode === "MOIS") {
        return {
          debut: new Date(
            annee,
            mois,
            1
          ),
          fin: new Date(
            annee,
            mois + 1,
            0,
            23,
            59,
            59
          ),
        };
      }

      /*
        EXERCICE :
        1er novembre -> 31 octobre
      */

      return {
        debut: new Date(
          annee,
          10,
          1
        ),
        fin: new Date(
          annee + 1,
          9,
          31,
          23,
          59,
          59
        ),
      };
    }, [
      modePeriode,
      annee,
      mois,
      dateDebutLibre,
      dateFinLibre,
    ]);

  function semaineDansPeriode(
    anneeSemaine: number,
    semaine: number
  ): boolean {
    if (!periodeActive) {
      return false;
    }

    const lundi =
      lundiSemaine(
        anneeSemaine,
        semaine
      );

    const dimanche =
      new Date(lundi);

    dimanche.setUTCDate(
      dimanche.getUTCDate() + 6
    );

    return (
      dimanche >=
      new Date(
        periodeActive.debut.getFullYear(),
        periodeActive.debut.getMonth(),
        periodeActive.debut.getDate()
      ) &&
      lundi <=
      periodeActive.fin
    );
  }

  /* =====================================================
     CONSOLIDATION HISTORIQUE
  ===================================================== */

  const semainesConsolidees =
    useMemo(() => {
      const map = new Map<
        string,
        SemaineConsolidee
      >();

      console.log("BILAN DEBUG consolidation", {
        modePeriode,
        annee,
        historique: historique.length,
        presences: presencesHistorique.length,
        feuilles: feuilles.length,
        jours: jours.length,
        imputations: imputations.length,
        periodeActive,
      });

      function creerSemaine(
        anneeSemaine: number,
        semaine: number,
        source: "HISTORIQUE" | "NOUVEAU"
      ): SemaineConsolidee {
        const dates =
          debutFinSemaine(
            anneeSemaine,
            semaine
          );

        return {
          annee: anneeSemaine,
          semaine,
          debut: dates.debut,
          fin: dates.fin,

          capacite: 0,

          cbe: 0,
          dbe: 0,
          ni: 0,
          cn: 0,
          formation: 0,
          autres: 0,
          ignorees: 0,

          affairesSansType: 0,

          heuresAbsence: 0,

          totalTravaille: 0,

          nonExplique: 0,

          source,

          collaborateurs: {},
        };
      }

      function getSemaine(
        anneeSemaine: number,
        semaine: number,
        source: "HISTORIQUE" | "NOUVEAU"
      ) {
        const key =
          `${anneeSemaine}-${semaine}`;

        if (!map.has(key)) {
          map.set(
            key,
            creerSemaine(
              anneeSemaine,
              semaine,
              source
            )
          );
        }

        return map.get(key)!;
      }

      function getCollaborateurSemaine(
        semaineData: SemaineConsolidee,
        collaborateurId: string
      ) {
        if (
          !semaineData.collaborateurs[
          collaborateurId
          ]
        ) {
          const c =
            collaborateursMap.get(
              collaborateurId
            );

          const profil =
            c?.profil_horaire_id
              ? profilsMap.get(
                c.profil_horaire_id
              )
              : null;

          semaineData.collaborateurs[
            collaborateurId
          ] = {
            collaborateurId,

            trigramme:
              c?.trigramme ??
              "???",

            nom:
              `${c?.prenom ?? ""} ${c?.nom ?? ""
                }`.trim() ||
              "Inconnu",

            capacite: 0,

            cbe: 0,
            dbe: 0,
            ni: 0,
            cn: 0,
            formation: 0,
            autres: 0,
            ignorees: 0,

            affairesSansType: 0,

            absence: 0,

            travaille: 0,
            nonExplique: 0,

            source:
              semaineData.source,
          };
        }

        return semaineData.collaborateurs[
          collaborateurId
        ];
      }

      /*
        ----------------------------------------------
        HISTORIQUE IMPUTATIONS
        ----------------------------------------------
      */

      const nouvellesSemainesCollaborateurs =
        new Set<string>();

      feuilles.forEach((feuille) => {
        const dateDebut = new Date(`${feuille.semaine_debut}T00:00:00`);
        const semaineFeuille = isoSemaine(dateDebut);

        nouvellesSemainesCollaborateurs.add(
          `${feuille.collaborateur_id}-${semaineFeuille.annee}-${semaineFeuille.semaine}`
        );
      });

      historique.forEach((ligne) => {
        if (
          !semaineDansPeriode(
            ligne.annee,
            ligne.semaine
          )
        ) {
          return;
        }

        if (
          nouvellesSemainesCollaborateurs.has(
            `${ligne.collaborateur_id}-${ligne.annee}-${ligne.semaine}`
          )
        ) {
          return;
        }

        const heuresLigne =
          nombre(ligne.heures);

        if (heuresLigne <= 0) {
          return;
        }

        const semaine =
          getSemaine(
            ligne.annee,
            ligne.semaine,
            "HISTORIQUE"
          );

        const collaborateur =
          collaborateursMap.get(
            ligne.collaborateur_id
          );

        if (!collaborateur) {
          return;
        }

        const cs =
          getCollaborateurSemaine(
            semaine,
            ligne.collaborateur_id
          );

        const categorie =
          classifierHistorique(
            ligne
          );




        /*
          ABSENCES HISTORIQUES

          On les traite AVANT AUTRES.
        */
        const code =
          normaliserTexte(
            ligne.code_imputation
          );

        if (estCodeAbsence(code)) {
          cs.absence += heuresLigne;
          semaine.heuresAbsence +=
            heuresLigne;
          return;
        }

        switch (categorie) {
          case "CBE":
            cs.cbe += heuresLigne;
            semaine.cbe += heuresLigne;
            break;

          case "DBE":
            cs.dbe += heuresLigne;
            semaine.dbe += heuresLigne;
            break;

          case "NI":
            cs.ni += heuresLigne;
            semaine.ni += heuresLigne;
            break;

          case "CN":
            cs.cn += heuresLigne;
            break;

          case "FORMATION":
            cs.formation += heuresLigne;
            semaine.formation +=
              heuresLigne;
            break;

          case "AFFAIRES_SANS_TYPE":
            cs.affairesSansType +=
              heuresLigne;

            semaine.affairesSansType +=
              heuresLigne;
            break;

          case "DIVERS_ABSENCES":
            cs.absence += heuresLigne;
            semaine.heuresAbsence += heuresLigne;
            break;

          case "IGNORE":
            cs.ignorees += heuresLigne;
            break;

          case "AUTRES":
          default:
            cs.autres += heuresLigne;
            semaine.autres +=
              heuresLigne;
            break;
        }
      });

      /*
        ----------------------------------------------
        PRESENCES HISTORIQUES
        ----------------------------------------------
      */

      presencesHistorique.forEach(
        (presence) => {
          if (
            !semaineDansPeriode(
              presence.annee,
              presence.semaine
            )
          ) {
            return;
          }

          if (
            nouvellesSemainesCollaborateurs.has(
              `${presence.collaborateur_id}-${presence.annee}-${presence.semaine}`
            )
          ) {
            return;
          }

          const collaborateur =
            collaborateursMap.get(
              presence.collaborateur_id
            );

          if (!collaborateur) {
            return;
          }

          const semaine =
            getSemaine(
              presence.annee,
              presence.semaine,
              "HISTORIQUE"
            );

          const cs =
            getCollaborateurSemaine(
              semaine,
              presence.collaborateur_id
            );

          const capacite =
            capaciteCollaborateurHistorique(
              collaborateur
            );

          cs.capacite =
            Math.max(
              cs.capacite,
              capacite
            );

          semaine.capacite +=
            capacite;
        }
      );

      /*
        Si un collaborateur a des imputations
        historiques mais pas de ligne presence,
        on reconstruit sa capacité.
      */

      map.forEach((semaine) => {
        semaine.collaborateurs &&
          Object.values(
            semaine.collaborateurs
          ).forEach((cs) => {
            if (
              cs.capacite <= 0 &&
              !nouvellesSemainesCollaborateurs.has(
                `${cs.collaborateurId}-${semaine.annee}-${semaine.semaine}`
              )
            ) {
              const collaborateur =
                collaborateursMap.get(
                  cs.collaborateurId
                );

              if (
                collaborateur &&
                !estCadreForfait(
                  collaborateur,
                  collaborateur.profil_horaire_id
                    ? profilsMap.get(
                      collaborateur.profil_horaire_id
                    )
                    : null
                )
              ) {
                const capacite =
                  capaciteCollaborateurHistorique(
                    collaborateur
                  );

                cs.capacite =
                  capacite;

                /*
                  Cette capacité doit également
                  être ajoutée au total si elle
                  n'avait pas déjà été comptée.
                */
              }
            }
          });

        /*
          Recalcul global à partir des collaborateurs.
        */

        semaine.capacite =
          Object.values(
            semaine.collaborateurs
          ).reduce(
            (total, cs) =>
              total + cs.capacite,
            0
          );
      });

      /*
        ----------------------------------------------
        NOUVEAU SYSTEME
        ----------------------------------------------
      */

      const feuillesParSemaine =
        new Map<string, FeuilleHeures[]>();

      /*
        Une semaine peut exister dans l'historique ET dans le nouveau
        système. Dans ce cas, on ne mélange pas les données du même
        collaborateur : la feuille du nouveau système devient la source
        de référence pour ce collaborateur/semaine.
      */
      feuilles.forEach((feuille) => {
        const dateDebut = new Date(`${feuille.semaine_debut}T00:00:00`);
        const semaineFeuille = isoSemaine(dateDebut);
        if (
          !semaineDansPeriode(
            semaineFeuille.annee,
            semaineFeuille.semaine
          )
        ) {
          return;
        }

        const key =
          `${semaineFeuille.annee}-${semaineFeuille.semaine}`;

        if (
          !feuillesParSemaine.has(key)
        ) {
          feuillesParSemaine.set(
            key,
            []
          );
        }

        feuillesParSemaine
          .get(key)!
          .push(feuille);
      });

      feuillesParSemaine.forEach(
        (listeFeuilles) => {
          listeFeuilles.forEach(
            (feuille) => {
              const collaborateur =
                collaborateursMap.get(
                  feuille.collaborateur_id
                );

              if (!collaborateur) {
                return;
              }

              const dateDebut = new Date(`${feuille.semaine_debut}T00:00:00`);
              const semaineFeuille = isoSemaine(dateDebut);

              const semaine =
                getSemaine(
                  semaineFeuille.annee,
                  semaineFeuille.semaine,
                  "NOUVEAU"
                );

              const cs =
                getCollaborateurSemaine(
                  semaine,
                  feuille.collaborateur_id
                );

              const profil =
                collaborateur.profil_horaire_id
                  ? profilsMap.get(
                    collaborateur.profil_horaire_id
                  )
                  : null;

              const capaciteCadreForfait =
                estCadreForfait(
                  collaborateur,
                  profil
                );

              const capacite =
                capaciteCadreForfait
                  ? 0
                  : nombre(
                    feuille.total_theorique
                  );

              /*
                Pour le nouveau système,
                total_theorique est la meilleure
                source de capacité réelle.
                Exception : un cadre au forfait n'est
                pas transformé en capacité productive.
              */

              cs.capacite =
                Math.max(
                  cs.capacite,
                  capacite
                );

              const joursFeuille =
                jours.filter(
                  (j) =>
                    j.feuille_id ===
                    feuille.id
                );

              const idsJours =
                new Set(
                  joursFeuille.map(
                    (j) => j.id
                  )
                );

              const imps =
                imputations.filter(
                  (i) =>
                    idsJours.has(
                      i.jour_id
                    )
                );

              /*
                Les imputations du nouveau système
                sont traitées une par une.
              */

              imps.forEach((imp) => {
                const h =
                  nombre(imp.heures);

                if (h <= 0) {
                  return;
                }

                const code =
                  normaliserTexte(
                    imp.code
                  );

                /*
                  FO / FI = FORMATION
                */
                if (
                  estFormation(code)
                ) {
                  cs.formation += h;
                  semaine.formation += h;
                  return;
                }

                /*
                  NI = NI
                */
                if (estNI(code)) {
                  cs.ni += h;
                  semaine.ni += h;
                  return;
                }

                /*
                  CN = vignette dédiée.
                  CN est normalement pointé dans Divers.
                */
                if (estCN(code)) {
                  cs.cn += h;
                  return;
                }

                if (estCodeIgnore(code)) {
                  cs.ignorees += h;
                  return;
                }

                const type =
                  normaliserTexte(
                    imp.type_affaire
                  );

                const numero =
                  String(
                    imp.numero_affaire ??
                    ""
                  ).trim();

                /*
                  IMPORTANT :
                  le type CBE/DBE passe AVANT RN/IF.
                  Ainsi :
                    DBE + RN = DBE
                  et non Divers de production.

                  RN / IF deviennent Divers de production
                  uniquement lorsqu'il n'y a pas de CBE/DBE.
                */

                if (
                  type === "CBE"
                ) {
                  cs.cbe += h;
                  semaine.cbe += h;
                  return;
                }

                if (
                  type === "DBE"
                ) {
                  cs.dbe += h;
                  semaine.dbe += h;
                  return;
                }

                if (
                  /^CBE/i.test(numero)
                ) {
                  cs.cbe += h;
                  semaine.cbe += h;
                  return;
                }

                if (
                  /^DBE/i.test(numero)
                ) {
                  cs.dbe += h;
                  semaine.dbe += h;
                  return;
                }

                if (type === "DIVERS" && estDiversAbsence(code)) {
                  cs.absence += h;
                  semaine.heuresAbsence += h;
                  return;
                }

                if (type === "DIVERS" && estDiversProduction(code)) {
                  cs.affairesSansType += h;
                  semaine.affairesSansType += h;
                  return;
                }

                /*
                  Une absence n'est pas une heure
                  travaillée.
                */
                if (
                  estCodeAbsence(code)
                ) {
                  cs.absence += h;
                  semaine.heuresAbsence += h;
                  return;
                }

                /*
                  Sécurité :
                  si le numéro ressemble à
                  CBE/DBE, on peut le lire.
                */

                if (
                  /^CBE/i.test(
                    numero
                  )
                ) {
                  cs.cbe += h;
                  semaine.cbe += h;
                  return;
                }

                if (
                  /^DBE/i.test(
                    numero
                  )
                ) {
                  cs.dbe += h;
                  semaine.dbe += h;
                  return;
                }

                cs.autres += h;
                semaine.autres += h;
              });

              /*
                Les jours absents sont également
                pris en compte lorsqu'aucune
                imputation n'existe.
              */

              joursFeuille.forEach(
                (jour) => {
                  const absence =
                    normaliserTexte(
                      jour.absence
                    );

                  if (!absence) {
                    return;
                  }

                  // FE / CP / CN / GI / AC / AP ne doivent
                  // ni alimenter les absences ni le non expliqué.
                  if (estCodeIgnore(absence)) {
                    return;
                  }

                  const totalJour =
                    nombre(
                      jour.total_heures
                    );

                  /*
                    Si la journée a déjà des
                    imputations d'absence,
                    elles ont été comptées plus haut.
                    On ne les double pas.

                    Si elle n'a aucune imputation,
                    on considère la journée comme
                    absence complète.
                  */

                  const aImputation =
                    imps.some(
                      (imp) =>
                        imp.jour_id ===
                        jour.id
                    );

                  if (
                    !aImputation &&
                    totalJour <= 0
                  ) {
                    const c =
                      collaborateur
                        .profil_horaire_id
                        ? profilsMap.get(
                          collaborateur.profil_horaire_id
                        )
                        : null;

                    let hJour = 0;

                    const date =
                      new Date(
                        `${jour.date_jour}T12:00:00`
                      );

                    const jourSemaine =
                      date.getDay();

                    if (
                      c &&
                      jourSemaine === 1
                    )
                      hJour =
                        nombre(c.lundi);

                    if (
                      c &&
                      jourSemaine === 2
                    )
                      hJour =
                        nombre(c.mardi);

                    if (
                      c &&
                      jourSemaine === 3
                    )
                      hJour =
                        nombre(c.mercredi);

                    if (
                      c &&
                      jourSemaine === 4
                    )
                      hJour =
                        nombre(c.jeudi);

                    if (
                      c &&
                      jourSemaine === 5
                    )
                      hJour =
                        nombre(c.vendredi);

                    cs.absence += hJour;
                    semaine.heuresAbsence +=
                      hJour;
                  }
                }
              );

              /*
                Une feuille peut fournir une
                capacité plus fiable que le profil.
              */

              if (
                capacite >
                0
              ) {
                cs.capacite =
                  capacite;
              }
            }
          );
        }
      );

      /*
        ----------------------------------------------
        CALCULS FINAUX
        ----------------------------------------------
      */

      map.forEach((semaine) => {
        semaine.capacite =
          Object.values(
            semaine.collaborateurs
          ).reduce(
            (total, cs) =>
              total + cs.capacite,
            0
          );

        Object.values(
          semaine.collaborateurs
        ).forEach((cs) => {
          cs.travaille =
            cs.cbe +
            cs.dbe +
            cs.ni +
            cs.cn +
            cs.formation +
            cs.autres +
            cs.affairesSansType;

          /*
            Le "non expliqué" est le temps
            disponible qui n'entre dans aucune
            catégorie connue.

            IMPORTANT :
            une affaire sans type reste du temps
            expliqué — simplement mal typé.
          */

          cs.nonExplique =
            Math.max(
              0,
              cs.capacite -
              cs.travaille -
              cs.absence -
              cs.ignorees
            );
        });

        semaine.cbe = 0;
        semaine.dbe = 0;
        semaine.ni = 0;
        semaine.cn = 0;
        semaine.formation = 0;
        semaine.autres = 0;
        semaine.ignorees = 0;
        semaine.affairesSansType = 0;
        semaine.heuresAbsence = 0;

        Object.values(
          semaine.collaborateurs
        ).forEach((cs) => {
          semaine.cbe += cs.cbe;
          semaine.dbe += cs.dbe;
          semaine.ni += cs.ni;
          semaine.cn += cs.cn;
          semaine.formation +=
            cs.formation;
          semaine.autres += cs.autres;
          semaine.ignorees += cs.ignorees;
          semaine.affairesSansType +=
            cs.affairesSansType;
          semaine.heuresAbsence +=
            cs.absence;
        });

        semaine.totalTravaille =
          semaine.cbe +
          semaine.dbe +
          semaine.ni +
          semaine.formation +
          semaine.autres +
          semaine.affairesSansType;

        semaine.nonExplique =
          Object.values(
            semaine.collaborateurs
          ).reduce(
            (total, cs) =>
              total + cs.nonExplique,
            0
          );
      });





      console.log(
        "Semaines consolidées :",
        map.size
      );





      return Array.from(map.values()).sort(
        (a, b) => {
          if (
            a.annee !==
            b.annee
          ) {
            return (
              a.annee - b.annee
            );
          }

          return (
            a.semaine -
            b.semaine
          );
        }
      );
    }, [
      historique,
      presencesHistorique,
      feuilles,
      jours,
      imputations,
      collaborateursMap,
      profilsMap,
      periodeActive,
    ]);

  /* =====================================================
     FILTRE COLLABORATEUR
  ===================================================== */

  const semainesFiltrees =
    useMemo(() => {
      if (
        collaborateurFiltre ===
        "TOUS"
      ) {
        return semainesConsolidees;
      }

      return semainesConsolidees
        .map((s) => {
          const cs =
            s.collaborateurs[
            collaborateurFiltre
            ];

          if (!cs) {
            return {
              ...s,
              capacite: 0,
              cbe: 0,
              dbe: 0,
              ni: 0,
              cn: 0,
              formation: 0,
              autres: 0,
              ignorees: 0,
              affairesSansType: 0,
              heuresAbsence: 0,
              totalTravaille: 0,
              nonExplique: 0,
            };
          }

          return {
            ...s,
            capacite: cs.capacite,
            cbe: cs.cbe,
            dbe: cs.dbe,
            ni: cs.ni,
            cn: cs.cn,
            formation: cs.formation,
            autres: cs.autres,
            ignorees: cs.ignorees,
            affairesSansType:
              cs.affairesSansType,
            heuresAbsence: cs.absence,
            totalTravaille:
              cs.travaille,
            nonExplique:
              cs.nonExplique,
          };
        })
        .filter(
          (s) =>
            s.capacite > 0 ||
            s.totalTravaille > 0 ||
            s.heuresAbsence > 0 ||
            s.cbe > 0 ||
            s.dbe > 0 ||
            s.ni > 0 ||
            s.cn > 0 ||
            s.formation > 0 ||
            s.autres > 0 ||
            s.affairesSansType > 0
        );
    }, [
      semainesConsolidees,
      collaborateurFiltre,
    ]);

  /* =====================================================
     KPI GLOBAUX
  ===================================================== */

  const global = useMemo(() => {
    return semainesFiltrees.reduce(
      (g, s) => {
        g.capacite += s.capacite;
        g.cbe += s.cbe;
        g.dbe += s.dbe;
        g.ni += s.ni;
        g.cn += s.cn;
        g.formation +=
          s.formation;
        g.autres += s.autres;
        g.affairesSansType +=
          s.affairesSansType;
        g.absence +=
          s.heuresAbsence;
        g.nonExplique +=
          s.nonExplique;

        return g;
      },
      {
        capacite: 0,
        cbe: 0,
        dbe: 0,
        ni: 0,
        cn: 0,
        formation: 0,
        autres: 0,
        affairesSansType: 0,
        absence: 0,
        nonExplique: 0,
      }
    );
  }, [semainesFiltrees]);



  /* =====================================================
     LIGNES NON EXPLIQUEES
  ===================================================== */

  const lignesNonExpliquees =
    useMemo(() => {
      const lignes: LigneNonExpliquee[] =
        [];

      semainesConsolidees.forEach(
        (s) => {
          Object.values(
            s.collaborateurs
          ).forEach((cs) => {
            if (
              collaborateurFiltre !==
              "TOUS" &&
              cs.collaborateurId !==
              collaborateurFiltre
            ) {
              return;
            }

            if (
              cs.nonExplique <=
              0.01 &&
              cs.affairesSansType <=
              0.01
            ) {
              return;
            }

            lignes.push({
              id:
                `${s.annee}-${s.semaine}-${cs.collaborateurId}`,

              annee: s.annee,
              semaine: s.semaine,

              collaborateurId:
                cs.collaborateurId,

              trigramme:
                cs.trigramme,

              nom: cs.nom,

              capacite:
                cs.capacite,

              cbe: cs.cbe,
              dbe: cs.dbe,
              ni: cs.ni,
              cn: cs.cn,
              
              formation:
                cs.formation,
              autres: cs.autres,
              ignorees: cs.ignorees,

              affairesSansType:
                cs.affairesSansType,

              nonExplique:
                cs.nonExplique,

              source: cs.source,
            });
          });
        }
      );

      return lignes.sort(
        (a, b) => {
          if (
            a.annee !==
            b.annee
          ) {
            return (
              b.annee -
              a.annee
            );
          }

          if (
            a.semaine !==
            b.semaine
          ) {
            return (
              b.semaine -
              a.semaine
            );
          }

          return (
            b.nonExplique -
            a.nonExplique
          );
        }
      );
    }, [
      semainesConsolidees,
      collaborateurFiltre,
    ]);

  /* =====================================================
     COLLABORATEURS
  ===================================================== */

  const bilansCollaborateurs =
    useMemo(() => {
      const map =
        new Map<
          string,
          BilanCollaborateur
        >();

      semainesConsolidees.forEach(
        (s) => {
          Object.values(
            s.collaborateurs
          ).forEach((cs) => {
            if (
              !map.has(
                cs.collaborateurId
              )
            ) {
              map.set(
                cs.collaborateurId,
                {
                  collaborateurId:
                    cs.collaborateurId,

                  capacite: 0,
                  cbe: 0,
                  dbe: 0,
                  ni: 0,
                  cn: 0,
                  formation: 0,
                  autres: 0,
                  ignorees: 0,

                  affairesSansType: 0,

                  absence: 0,
                  travaille: 0,
                  nonExplique: 0,
                }
              );
            }

            const b =
              map.get(
                cs.collaborateurId
              )!;

            b.capacite +=
              cs.capacite;
            b.cbe += cs.cbe;
            b.dbe += cs.dbe;
            b.ni += cs.ni;
            b.cn += cs.cn;
            b.formation +=
              cs.formation;
            b.autres +=
              cs.autres;
            b.ignorees +=
              cs.ignorees;
            b.affairesSansType +=
              cs.affairesSansType;
            b.absence +=
              cs.absence;
            b.travaille +=
              cs.travaille;
            b.nonExplique +=
              cs.nonExplique;
          });
        }
      );

      return Array.from(
        map.values()
      )
        .filter((b) => {
          if (
            collaborateurFiltre !==
            "TOUS"
          ) {
            return (
              b.collaborateurId ===
              collaborateurFiltre
            );
          }

          return true;
        })
        .filter((b) => {
          if (!recherche.trim()) {
            return true;
          }

          const c =
            collaborateursMap.get(
              b.collaborateurId
            );

          const texte =
            normaliserTexte(
              `${c?.prenom ?? ""} ${c?.nom ?? ""
              } ${c?.trigramme ?? ""
              }`
            );

          return texte.includes(
            normaliserTexte(
              recherche
            )
          );
        })
        .sort(
          (a, b) => {
            const ca =
              collaborateursMap.get(
                a.collaborateurId
              );

            const cb =
              collaborateursMap.get(
                b.collaborateurId
              );

            // Actifs d'abord, puis anciens/inactifs.
            if (
              Boolean(ca?.actif) !==
              Boolean(cb?.actif)
            ) {
              return ca?.actif ? -1 : 1;
            }

            return (
              `${ca?.nom ?? ""}`.localeCompare(
                `${cb?.nom ?? ""}`
              )
            );
          }
        );
    }, [
      semainesConsolidees,
      collaborateursMap,
      collaborateurFiltre,
      recherche,
    ]);

  /* =====================================================
     RENDER
  ===================================================== */

  if (chargement) {
    return (
      <div style={styles.page}>
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <div>
            <strong>
              Chargement du bilan…
            </strong>
            <div
              style={{
                color:
                  COULEURS.texteSecondaire,
                marginTop: 4,
              }}
            >
              Je rassemble les heures
              historiques et les nouvelles
              feuilles.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (erreur) {
    return (
      <div style={styles.page}>
        <header style={styles.header}>
          <div>
            <div style={styles.logo}>
              POLYNOV
            </div>
            <div
              style={
                styles.headerTitle
              }
            >
              Bilans & pilotage
            </div>
          </div>

          <button
            style={
              styles.dashboardButton
            }
            onClick={() =>
              router.push(
                "/dashboard"
              )
            }
          >
            ← Dashboard
          </button>
        </header>

        <div
          style={{
            ...styles.errorBox,
            margin: 24,
          }}
        >
          <strong>
            Impossible de charger le
            bilan
          </strong>

          <div
            style={{
              marginTop: 8,
            }}
          >
            {erreur}
          </div>

          <button
            style={
              styles.primaryButton
            }
            onClick={
              chargerDonnees
            }
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* =================================================
          HEADER
      ================================================= */}

      <header style={styles.header}>
        <div>
          <div style={styles.logo}>
            POLYNOV
          </div>

          <div
            style={
              styles.headerTitle
            }
          >
            Bilans & pilotage
          </div>
        </div>

        <button
          style={
            styles.dashboardButton
          }
          onClick={() =>
            router.push(
              "/dashboard"
            )
          }
        >
          ← Dashboard
        </button>
      </header>

      <main style={styles.main}>
        {/* =================================================
            INTRO
        ================================================= */}

        <section
          style={
            styles.hero
          }
        >
          <div>
            <h1
              style={
                styles.heroTitle
              }
            >
              Pilotage de la charge
            </h1>

            <p
              style={
                styles.heroSubtitle
              }
            >
              Une vision simple de ce qui
              est vendu, préparé, imputable,
              improductif… et de ce qui reste
              à expliquer.
            </p>
          </div>

          <div
            style={
              styles.heroPeriod
            }
          >
            <div
              style={
                styles.heroPeriodLabel
              }
            >
              Période analysée
            </div>

            <strong>
              {periodeActive
                ? `${formatDate(
                  periodeActive.debut
                )} → ${formatDate(
                  periodeActive.fin
                )}`
                : "À définir"}
            </strong>
          </div>
        </section>

        {/* =================================================
            FILTRES
        ================================================= */}

        <section
          style={
            styles.filtersCard
          }
        >
          <div
            style={
              styles.filtersHeader
            }
          >
            <div>
              <div
                style={
                  styles.sectionEyebrow
                }
              >
                Période
              </div>

              <div
                style={
                  styles.sectionTitle
                }
              >
                Choisir la fenêtre
              </div>
            </div>
          </div>

          <div
            style={
              styles.periodButtons
            }
          >
            {(
              [
                "EXERCICE",
                "ANNEE",
                "MOIS",
                "LIBRE",
              ] as ModePeriode[]
            ).map((mode) => (
              <button
                key={mode}
                onClick={() =>
                  setModePeriode(
                    mode
                  )
                }
                style={{
                  ...styles.periodButton,
                  ...(modePeriode ===
                    mode
                    ? styles.periodButtonActive
                    : {}),
                }}
              >
                {mode ===
                  "EXERCICE"
                  ? "Exercice"
                  : mode === "ANNEE"
                    ? "Année"
                    : mode === "MOIS"
                      ? "Mois"
                      : "Libre"}
              </button>
            ))}
          </div>

          <div
            style={
              styles.filtersGrid
            }
          >
            {(modePeriode ===
              "EXERCICE" ||
              modePeriode ===
              "ANNEE" ||
              modePeriode ===
              "MOIS") && (
                <label
                  style={
                    styles.field
                  }
                >
                  <span>
                    {modePeriode ===
                      "EXERCICE"
                      ? "Exercice"
                      : "Année"}
                  </span>

                  <select
                    value={annee}
                    onChange={(e) =>
                      setAnnee(
                        Number(
                          e.target.value
                        )
                      )
                    }
                    style={
                      styles.select
                    }
                  >
                    {Array.from(
                      {
                        length: 5,
                      },
                      (_, i) =>
                        maintenant.getFullYear() -
                        2 +
                        i
                    ).map((a) => (
                      <option
                        key={a}
                        value={a}
                      >
                        {modePeriode ===
                          "EXERCICE"
                          ? `${a} / ${a + 1
                          }`
                          : a}
                      </option>
                    ))}
                  </select>
                </label>
              )}

            {modePeriode ===
              "MOIS" && (
                <label
                  style={
                    styles.field
                  }
                >
                  <span>
                    Mois
                  </span>

                  <select
                    value={mois}
                    onChange={(e) =>
                      setMois(
                        Number(
                          e.target.value
                        )
                      )
                    }
                    style={
                      styles.select
                    }
                  >
                    {MOIS.map(
                      (
                        libelle,
                        index
                      ) => (
                        <option
                          key={
                            libelle
                          }
                          value={
                            index
                          }
                        >
                          {libelle}
                        </option>
                      )
                    )}
                  </select>
                </label>
              )}

            {modePeriode ===
              "LIBRE" && (
                <>
                  <label
                    style={
                      styles.field
                    }
                  >
                    <span>
                      Du
                    </span>

                    <input
                      type="date"
                      value={
                        dateDebutLibre
                      }
                      onChange={(
                        e
                      ) =>
                        setDateDebutLibre(
                          e.target.value
                        )
                      }
                      style={
                        styles.input
                      }
                    />
                  </label>

                  <label
                    style={
                      styles.field
                    }
                  >
                    <span>
                      Au
                    </span>

                    <input
                      type="date"
                      value={
                        dateFinLibre
                      }
                      onChange={(
                        e
                      ) =>
                        setDateFinLibre(
                          e.target.value
                        )
                      }
                      style={
                        styles.input
                      }
                    />
                  </label>
                </>
              )}

            <label
              style={
                styles.field
              }
            >
              <span>
                Collaborateur
              </span>

              <select
                value={
                  collaborateurFiltre
                }
                onChange={(e) =>
                  setCollaborateurFiltre(
                    e.target.value
                  )
                }
                style={
                  styles.select
                }
              >
                <option value="TOUS">
                  Toute l'équipe
                </option>

                {collaborateurs
                  .slice()
                  .sort(
                    (a, b) => {
                      if (
                        Boolean(a.actif) !==
                        Boolean(b.actif)
                      ) {
                        return a.actif ? -1 : 1;
                      }

                      return `${a.nom ?? ""}`.localeCompare(
                        `${b.nom ?? ""}`
                      );
                    }
                  )
                  .map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                    >
                      {c.trigramme} —{" "}
                      {c.prenom}{" "}
                      {c.nom}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </section>

        {/* =================================================
            KPI
        ================================================= */}

        <section
          style={
            styles.kpiGrid
          }
        >
          <Kpi
            label="Capacité"
            value={heures(
              global.capacite
            )}
            sub="100 % disponible"
          />

          <Kpi
            label="CBE vendus"
            value={heures(
              global.cbe
            )}
            sub={`${pourcentage(
              taux(
                global.cbe,
                global.capacite
              )
            )} de la capacité`}
            color={
              COULEURS.rouge
            }
          />

          <Kpi
            label="Devis / DBE"
            value={heures(
              global.dbe
            )}
            sub={`${pourcentage(
              taux(
                global.dbe,
                global.capacite
              )
            )} de la capacité`}
            color={
              COULEURS.orange
            }
          />

          <Kpi
            label="NI"
            value={heures(
              global.ni
            )}
            sub="Non imputable"
            color={
              COULEURS.gris
            }
          />

          <Kpi
            label="CN"
            value={heures(
              global.cn
            )}
            sub="Code CN — Divers"
            color={
              COULEURS.gris
            }
          />

          <Kpi
            label="Formation"
            value={heures(
              global.formation
            )}
            sub="FO / FI"
            color={
              COULEURS.violet
            }
          />

          <Kpi
            label="Divers d'absences"
            value={heures(
              global.absence
            )}
            sub="RE / ML / VM / AA / AT / AI"
            color={
              COULEURS.orange
            }
          />

          <Kpi
            label="Divers de production"
            value={heures(
              global.affairesSansType
            )}
            sub="Tout code affaire pointé en Divers"
            color={
              COULEURS.texteSecondaire
            }
          />

          <Kpi
            label="Non expliqué"
            value={heures(
              global.nonExplique
            )}
            sub={`${pourcentage(
              taux(
                global.nonExplique,
                global.capacite
              )
            )} de la capacité`}
            color={
              COULEURS.gris
            }
          />
        </section>

        {/* =================================================
            ONGLETS
        ================================================= */}

        <div
          style={
            styles.tabs
          }
        >
          <button
            style={{
              ...styles.tab,
              ...(onglet ===
                "PILOTAGE"
                ? styles.tabActive
                : {}),
            }}
            onClick={() =>
              setOnglet(
                "PILOTAGE"
              )
            }
          >
            📊 Pilotage
          </button>

          <button
            style={{
              ...styles.tab,
              ...(onglet ===
                "NON_EXPLIQUE"
                ? styles.tabActive
                : {}),
            }}
            onClick={() =>
              setOnglet(
                "NON_EXPLIQUE"
              )
            }
          >
            🔎 Non expliqué
            {lignesNonExpliquees.length >
              0 && (
                <span
                  style={
                    styles.tabBadge
                  }
                >
                  {
                    lignesNonExpliquees.length
                  }
                </span>
              )}
          </button>

          <button
            style={{
              ...styles.tab,
              ...(onglet ===
                "COLLABORATEURS"
                ? styles.tabActive
                : {}),
            }}
            onClick={() =>
              setOnglet(
                "COLLABORATEURS"
              )
            }
          >
            👥 Collaborateurs
          </button>
        </div>

        {/* =================================================
            PILOTAGE
        ================================================= */}

        {onglet ===
          "PILOTAGE" && (
            <>
              <ChargeTimeline
                semaines={
                  semainesFiltrees
                }
              />

              <section
                style={
                  styles.card
                }
              >
                <div
                  style={
                    styles.cardHeader
                  }
                >
                  <div>
                    <div
                      style={
                        styles.sectionEyebrow
                      }
                    >
                      Détail hebdomadaire
                    </div>

                    <h2
                      style={
                        styles.cardTitle
                      }
                    >
                      Où part la capacité ?
                    </h2>
                  </div>
                </div>

                <div
                  style={
                    styles.tableWrap
                  }
                >
                  <table
                    style={
                      styles.table
                    }
                  >
                    <thead>
                      <tr>
                        <th>
                          Semaine
                        </th>
                        <th>
                          Source
                        </th>
                        <th>
                          Capacité
                        </th>
                        <th>
                          CBE
                        </th>
                        <th>
                          DBE
                        </th>
                        <th>
                          NI
                        </th>
                        <th>
                          CN
                        </th>
                        <th>
                          Formation
                        </th>
                        <th>
                          Autres
                        </th>
                        <th>
                          Divers de production
                        </th>
                        <th>
                          Non expliqué
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {semainesFiltrees
                        .slice()
                        .reverse()
                        .map(
                          (s) => (
                            <tr
                              key={`${s.annee}-${s.semaine}`}
                            >
                              <td>
                                <strong>
                                  S
                                  {
                                    s.semaine
                                  }
                                </strong>

                                <div
                                  style={
                                    styles.smallText
                                  }
                                >
                                  {
                                    s.debut
                                  }{" "}
                                  →{" "}
                                  {
                                    s.fin
                                  }
                                </div>
                              </td>

                              <td>
                                <SourceBadge
                                  source={
                                    s.source
                                  }
                                />
                              </td>

                              <td style={styles.diagnosticNumberCell}>
                                <strong>
                                  {heures(
                                    s.capacite
                                  )}
                                </strong>
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  color:
                                    COULEURS.rouge,
                                  fontWeight: 700,
                                }}
                              >
                                {heures(
                                  s.cbe
                                )}
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  color:
                                    COULEURS.orange,
                                  fontWeight: 700,
                                }}
                              >
                                {heures(
                                  s.dbe
                                )}
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  color:
                                    COULEURS.gris,
                                }}
                              >
                                {heures(
                                  s.ni
                                )}
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  color:
                                    COULEURS.gris,
                                  fontWeight: 700,
                                }}
                              >
                                {heures(
                                  s.cn
                                )}
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  color:
                                    COULEURS.violet,
                                }}
                              >
                                {heures(
                                  s.formation
                                )}
                              </td>

                              <td style={styles.diagnosticNumberCell}>
                                {heures(
                                  s.autres
                                )}
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  color:
                                    s.affairesSansType >
                                      0
                                      ? COULEURS.orange
                                      : COULEURS.texteSecondaire,
                                  fontWeight:
                                    s.affairesSansType >
                                      0
                                      ? 700
                                      : 400,
                                }}
                              >
                                {heures(
                                  s.affairesSansType
                                )}
                              </td>

                              <td
                                style={{
                                  ...styles.diagnosticNumberCell,
                                  fontWeight: 800,
                                  color:
                                    s.nonExplique >
                                      0
                                      ? COULEURS.rouge
                                      : COULEURS.vert,
                                }}
                              >
                                {heures(
                                  s.nonExplique
                                )}
                              </td>
                            </tr>
                          )
                        )}

                      {semainesFiltrees.length ===
                        0 && (
                          <tr>
                            <td
                              colSpan={11}
                              style={
                                styles.emptyCell
                              }
                            >
                              Aucune donnée sur
                              cette période.
                            </td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

        {/* =================================================
            NON EXPLIQUE
        ================================================= */}

        {onglet ===
          "NON_EXPLIQUE" && (
            <NonExpliqueTable
              lignes={
                lignesNonExpliquees
              }
            />
          )}

        {/* =================================================
            COLLABORATEURS
        ================================================= */}

        {onglet ===
          "COLLABORATEURS" && (
            <section
              style={
                styles.card
              }
            >
              <div
                style={
                  styles.cardHeader
                }
              >
                <div>
                  <div
                    style={
                      styles.sectionEyebrow
                    }
                  >
                    Équipe
                  </div>

                  <h2
                    style={
                      styles.cardTitle
                    }
                  >
                    Vision par collaborateur
                  </h2>
                </div>

                <input
                  value={
                    recherche
                  }
                  onChange={(e) =>
                    setRecherche(
                      e.target.value
                    )
                  }
                  placeholder="Rechercher…"
                  style={{
                    ...styles.input,
                    maxWidth: 260,
                  }}
                />
              </div>

              <div
                style={
                  styles.collaborateursGrid
                }
              >
                {bilansCollaborateurs.map(
                  (b) => {
                    const c =
                      collaborateursMap.get(
                        b.collaborateurId
                      );

                    const productif =
                      b.cbe +
                      b.dbe;

                    const tauxProductif =
                      taux(
                        productif,
                        b.capacite
                      );

                    return (
                      <div
                        key={
                          b.collaborateurId
                        }
                        style={
                          styles.collaborateurCard
                        }
                      >
                        <div
                          style={
                            styles.collaborateurTop
                          }
                        >
                          <div
                            style={
                              styles.avatar
                            }
                          >
                            {(
                              c?.trigramme ??
                              "?"
                            ).slice(
                              0,
                              3
                            )}
                          </div>

                          <div>
                            <strong
                              style={{
                                fontSize: 17,
                              }}
                            >
                              {
                                c?.prenom
                              }{" "}
                              {
                                c?.nom
                              }
                            </strong>

                            <div
                              style={
                                styles.smallText
                              }
                            >
                              {
                                c?.trigramme
                              }
                            </div>
                          </div>
                        </div>

                        <div
                          style={
                            styles.collaborateurStats
                          }
                        >
                          <StatLine
                            label="Capacité"
                            value={heures(
                              b.capacite
                            )}
                          />

                          <StatLine
                            label="CBE"
                            value={heures(
                              b.cbe
                            )}
                            color={
                              COULEURS.rouge
                            }
                          />

                          <StatLine
                            label="DBE"
                            value={heures(
                              b.dbe
                            )}
                            color={
                              COULEURS.orange
                            }
                          />

                          <StatLine
                            label="NI"
                            value={heures(
                              b.ni
                            )}
                            color={
                              COULEURS.gris
                            }
                          />

                          <StatLine
                            label="Formation"
                            value={heures(
                              b.formation
                            )}
                            color={
                              COULEURS.violet
                            }
                          />

                          <StatLine
                            label="Non expliqué"
                            value={heures(
                              b.nonExplique
                            )}
                            color={
                              COULEURS.rouge
                            }
                          />
                        </div>

                        <div
                          style={
                            styles.progressBackground
                          }
                        >
                          <div
                            style={{
                              ...styles.progressBar,
                              width: `${Math.min(
                                100,
                                Math.max(
                                  0,
                                  tauxProductif
                                )
                              )}%`,
                            }}
                          />
                        </div>

                        <div
                          style={
                            styles.progressCaption
                          }
                        >
                          <span>
                            Production (CBE + DBE)
                          </span>

                          <strong>
                            {pourcentage(
                              tauxProductif
                            )}
                          </strong>
                        </div>
                      </div>
                    );
                  }
                )}

                {bilansCollaborateurs.length ===
                  0 && (
                    <div
                      style={
                        styles.emptyBox
                      }
                    >
                      Aucun collaborateur
                      trouvé sur cette période.
                    </div>
                  )}
              </div>
            </section>
          )}
      </main>
    </div>
  );
}

/* =========================================================
   KPI
========================================================= */

function Kpi({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
}) {
  return (
    <div
      style={{
        ...styles.kpi,
        borderTop:
          `4px solid ${color ??
          COULEURS.rouge
          }`,
      }}
    >
      <div
        style={
          styles.kpiLabel
        }
      >
        {label}
      </div>

      <div
        style={
          styles.kpiValue
        }
      >
        {value}
      </div>

      <div
        style={
          styles.kpiSub
        }
      >
        {sub}
      </div>
    </div>
  );
}

/* =========================================================
   SOURCE BADGE
========================================================= */

function SourceBadge({
  source,
}: {
  source:
  | "HISTORIQUE"
  | "NOUVEAU";
}) {
  return (
    <span
      style={{
        ...styles.sourceBadge,
        background:
          source ===
            "HISTORIQUE"
            ? "#eef0f2"
            : "#e8f5eb",
        color:
          source ===
            "HISTORIQUE"
            ? "#60666c"
            : "#217a38",
      }}
    >
      {source ===
        "HISTORIQUE"
        ? "Historique"
        : "Nouveau"}
    </span>
  );
}

/* =========================================================
   STAT LINE
========================================================= */

function StatLine({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={
        styles.statLine
      }
    >
      <span>
        {color && (
          <span
            style={{
              display:
                "inline-block",
              width: 8,
              height: 8,
              borderRadius:
                "50%",
              background:
                color,
              marginRight: 7,
            }}
          />
        )}

        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   GRAPHIQUE CHARGE
========================================================= */

function ChargeTimeline({
  semaines,
}: {
  semaines: SemaineConsolidee[];
}) {
  return (
    <section
      style={
        styles.card
      }
    >
      <div
        style={
          styles.cardHeader
        }
      >
        <div>
          <div
            style={
              styles.sectionEyebrow
            }
          >
            Charge dans le temps
          </div>

          <h2
            style={
              styles.cardTitle
            }
          >
            Chaque semaine = 100 % de
            capacité
          </h2>

          <p
            style={
              styles.cardSubtitle
            }
          >
            Les barres sont normalisées
            par rapport à la capacité
            disponible de la semaine. Les
            codes FE / CP / CN / GI / AC / AP
            sont volontairement hors périmètre.
          </p>
        </div>

        <div
          style={
            styles.legend
          }
        >
          <Legend
            color={
              COULEURS.rouge
            }
            label="CBE vendu"
          />

          <Legend
            color={
              COULEURS.orange
            }
            label="DBE / devis"
          />

          <Legend
            color={
              COULEURS.gris
            }
            label="NI"
          />

          <Legend
            color={
              COULEURS.violet
            }
            label="Formation"
          />

          <Legend
            color="#e7b24b"
            label="Divers d'absences"
          />

          <Legend
            color={
              COULEURS.grisClair
            }
            label="Divers de production"
          />

          <Legend
            color="#dddddd"
            label="Autres"
          />

          <Legend
            color="#f7f7f7"
            border
            label="Non expliqué"
          />
        </div>
      </div>

      {semaines.length ===
        0 ? (
        <div
          style={
            styles.emptyBox
          }
        >
          Aucune semaine à afficher.
        </div>
      ) : (
        <div
          style={
            styles.chartScroll
          }
        >
          <div
            style={{
              ...styles.chart,
              minWidth: Math.max(
                760,
                semaines.length *
                95
              ),
            }}
          >
            <div
              style={
                styles.chartAxis
              }
            >
              <span>
                100 %
              </span>
              <span>
                75 %
              </span>
              <span>
                50 %
              </span>
              <span>
                25 %
              </span>
              <span>
                0 %
              </span>
            </div>

            <div
              style={
                styles.chartBars
              }
            >
              {semaines.map(
                (s) => {
                  const capacite =
                    s.capacite;

                  const cbePct =
                    taux(
                      s.cbe,
                      capacite
                    );

                  const dbePct =
                    taux(
                      s.dbe,
                      capacite
                    );

                  const niPct =
                    taux(
                      s.ni,
                      capacite
                    );

                  const formationPct =
                    taux(
                      s.formation,
                      capacite
                    );

                  const diversAbsencesPct =
                    taux(
                      s.heuresAbsence,
                      capacite
                    );

                  const diversProductionPct =
                    taux(
                      s.affairesSansType,
                      capacite
                    );

                  const autresPct =
                    taux(
                      s.autres,
                      capacite
                    );

                  const nonExpliquePct =
                    taux(
                      s.nonExplique,
                      capacite
                    );

                  return (
                    <div
                      key={`${s.annee}-${s.semaine}`}
                      style={
                        styles.chartColumn
                      }
                    >
                      <div
                        style={
                          styles.barArea
                        }
                      >
                        <div
                          style={
                            styles.barCapacity
                          }
                        >
                          <BarSegment
                            pct={
                              cbePct
                            }
                            color={
                              COULEURS.rouge
                            }
                          />

                          <BarSegment
                            pct={
                              dbePct
                            }
                            color={
                              COULEURS.orange
                            }
                          />

                          <BarSegment
                            pct={
                              niPct
                            }
                            color={
                              COULEURS.gris
                            }
                          />

                          <BarSegment
                            pct={
                              formationPct
                            }
                            color={
                              COULEURS.violet
                            }
                          />

                          <BarSegment
                            pct={
                              diversAbsencesPct
                            }
                            color="#e7b24b"
                          />

                          <BarSegment
                            pct={
                              diversProductionPct
                            }
                            color={
                              COULEURS.grisClair
                            }
                          />

                          <BarSegment
                            pct={
                              autresPct
                            }
                            color="#dddddd"
                          />

                          <BarSegment
                            pct={
                              nonExpliquePct
                            }
                            color="#f7f7f7"
                            border
                          />
                        </div>
                      </div>

                      <div
                        style={
                          styles.chartWeek
                        }
                      >
                        S
                        {
                          s.semaine
                        }
                      </div>

                      <div
                        style={
                          styles.chartHours
                        }
                      >
                        {heures(
                          s.capacite
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>
        </div>
      )}

      <div
        style={
          styles.chartExplanation
        }
      >
        <div
          style={
            styles.explanationDot
          }
        />

        <div>
          <strong>
            Comment lire le graphique ?
          </strong>

          <div
            style={{
              marginTop: 3,
            }}
          >
            Une barre pleine représente
            100 % de la capacité disponible
            de la semaine. Si le rouge monte,
            les heures CBE vendues montent.
            Le blanc représente le temps qui
            reste sans explication dans les
            catégories du bilan.
          </div>
        </div>
      </div>
    </section>
  );
}

function BarSegment({
  pct,
  color,
  border,
}: {
  pct: number;
  color: string;
  border?: boolean;
}) {
  if (pct <= 0) {
    return null;
  }

  return (
    <div
      style={{
        height: `${Math.min(
          100,
          Math.max(0, pct)
        )}%`,
        background: color,
        border:
          border
            ? "1px solid #d8d8d8"
            : undefined,
        boxSizing:
          "border-box",
        minHeight:
          pct > 0
            ? 1
            : undefined,
      }}
      title={`${pourcentage(
        pct
      )}`}
    />
  );
}

function Legend({
  color,
  label,
  border,
}: {
  color: string;
  label: string;
  border?: boolean;
}) {
  return (
    <span
      style={
        styles.legendItem
      }
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: color,
          border:
            border
              ? "1px solid #d5d5d5"
              : undefined,
        }}
      />

      {label}
    </span>
  );
}

/* =========================================================
   TABLE NON EXPLIQUE
========================================================= */

function NonExpliqueTable({
  lignes,
}: {
  lignes: LigneNonExpliquee[];
}) {
  const [ouvert, setOuvert] =
    useState<string | null>(
      null
    );

  return (
    <section
      style={
        styles.card
      }
    >
      <div
        style={
          styles.cardHeader
        }
      >
        <div>
          <div
            style={
              styles.sectionEyebrow
            }
          >
            Diagnostic
          </div>

          <h2
            style={
              styles.cardTitle
            }
          >
            Ce qui reste à expliquer
          </h2>

          <p
            style={
              styles.cardSubtitle
            }
          >
            Ici, on cherche à comprendre
            pourquoi la capacité disponible
            n'est pas entièrement retrouvée
            dans les catégories du bilan.
          </p>
        </div>

        <div
          style={
            styles.warningBadge
          }
        >
          {lignes.length} ligne
          {lignes.length > 1
            ? "s"
            : ""}
        </div>
      </div>

      <div
        style={
          styles.infoBox
        }
      >
        <strong>
          Attention :
        </strong>{" "}
        « Non expliqué » n'est pas synonyme
        de « erreur ».
        <br />
        Il s'agit du reliquat entre la
        capacité disponible et les heures
        classées.
        <br />
        Les anciennes affaires dont le type
        CBE/DBE n'est pas connu apparaissent
        séparément dans{" "}
        <strong>
          Affaires sans type
        </strong>.
      </div>

      <div
        style={
          styles.tableWrap
        }
      >
        <table
          style={
            styles.table
          }
        >
          <thead>
            <tr>
              <th>
                Semaine
              </th>

              <th>
                Collaborateur
              </th>

              <th>
                Source
              </th>

              <th>
                Capacité
              </th>

              <th>
                CBE
              </th>

              <th>
                DBE
              </th>

              <th>
                NI
              </th>

              <th>
                CN
              </th>

              <th>
                Formation
              </th>

              <th>
                Autres
              </th>

              <th>
                Affaires sans type
              </th>

              <th>
                Non expliqué
              </th>
            </tr>
          </thead>

          <tbody>
            {lignes.map(
              (ligne) => {
                const id =
                  ligne.id;

                const isOpen =
                  ouvert ===
                  id;

                return (
                  <React.Fragment
                    key={id}
                  >
                    <tr
                      onClick={() =>
                        setOuvert(
                          isOpen
                            ? null
                            : id
                        )
                      }
                      style={{
                        cursor:
                          "pointer",
                        background:
                          isOpen
                            ? "#fafafa"
                            : undefined,
                      }}
                    >
                      <td>
                        <strong>
                          S
                          {
                            ligne.semaine
                          }
                        </strong>

                        <div
                          style={
                            styles.smallText
                          }
                        >
                          {
                            ligne.annee
                          }
                        </div>
                      </td>

                      <td>
                        <strong>
                          {
                            ligne.trigramme
                          }
                        </strong>

                        <div
                          style={

                            styles.smallText
                          }
                        >
                          {
                            ligne.nom
                          }
                        </div>
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        <SourceBadge
                          source={
                            ligne.source
                          }
                        />
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(ligne.capacite)}
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(ligne.cbe)}
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(ligne.dbe)}
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(
                          ligne.ni
                        )}
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(
                          ligne.cn
                        )}
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(
                          ligne.formation
                        )}
                      </td>

                      <td style={styles.diagnosticNumberCell}>
                        {heures(
                          ligne.autres
                        )}
                      </td>

                      <td
                        style={{
                          ...styles.diagnosticNumberCell,
                          color:
                            ligne.affairesSansType >
                              0
                              ? COULEURS.orange
                              : undefined,
                          fontWeight:
                            ligne.affairesSansType >
                              0
                              ? 700
                              : undefined,
                        }}
                      >
                        {heures(
                          ligne.affairesSansType
                        )}
                      </td>

                      <td
                        style={{
                          ...styles.diagnosticNumberCell,
                          color:
                            COULEURS.rouge,
                          fontWeight: 800,
                        }}
                      >
                        {heures(
                          ligne.nonExplique
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td
                          colSpan={12}
                          style={{
                            background:
                              "#fafafa",
                            padding:
                              "18px 22px",
                          }}
                        >
                          <div
                            style={
                              styles.detailGrid
                            }
                          >
                            <DetailBox
                              label="Capacité"
                              value={heures(
                                ligne.capacite
                              )}
                            />

                            <DetailBox
                              label="Heures classées"
                              value={heures(
                                ligne.cbe +
                                ligne.dbe +
                                ligne.ni +
                                ligne.formation +
                                ligne.autres +
                                ligne.affairesSansType
                              )}
                            />

                            <DetailBox
                              label="Divers de production"
                              value={heures(
                                ligne.affairesSansType
                              )}
                              warning={
                                ligne.affairesSansType >
                                0
                              }
                            />

                            <DetailBox
                              label="Reliquat"
                              value={heures(
                                ligne.nonExplique
                              )}
                              warning={
                                ligne.nonExplique >
                                0
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              }
            )}

            {lignes.length ===
              0 && (
                <tr>
                  <td
                    colSpan={12}
                    style={
                      styles.emptyCell
                    }
                  >
                    🎉 Rien à expliquer sur
                    cette période.
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailBox({
  label,
  value,
  warning,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.detailBox,
        borderLeft:
          `4px solid ${warning
            ? COULEURS.orange
            : COULEURS.bordure
          }`,
      }}
    >
      <div
        style={
          styles.smallText
        }
      >
        {label}
      </div>

      <strong
        style={{
          fontSize: 20,
          marginTop: 4,
        }}
      >
        {value}
      </strong>
    </div>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background:
      COULEURS.fond,
    color:
      COULEURS.texte,
    fontFamily:
      "Calibri, Arial, sans-serif",
  },

  header: {
    height: 76,
    background:
      COULEURS.rouge,
    color:
      COULEURS.blanc,
    display: "flex",
    alignItems:
      "center",
    justifyContent:
      "space-between",
    padding:
      "0 28px",
    boxSizing:
      "border-box",
    boxShadow:
      "0 2px 10px rgba(0,0,0,.10)",
  },

  logo: {
    fontWeight: 900,
    fontSize: 21,
    letterSpacing: 1.5,
  },

  headerTitle: {
    fontSize: 14,
    opacity: 0.88,
    marginTop: 2,
  },

  dashboardButton: {
    border:
      "1px solid rgba(255,255,255,.4)",
    background:
      "rgba(255,255,255,.10)",
    color:
      COULEURS.blanc,
    borderRadius: 8,
    padding:
      "10px 15px",
    cursor:
      "pointer",
    fontWeight: 700,
    fontFamily:
      "inherit",
  },

  main: {
    maxWidth: 1500,
    margin:
      "0 auto",
    padding:
      "26px 28px 60px",
  },

  hero: {
    background:
      COULEURS.blanc,
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 14,
    padding:
      "25px 28px",
    display: "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    gap: 30,
    boxShadow:
      "0 2px 8px rgba(0,0,0,.035)",
  },

  heroTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 800,
  },

  heroSubtitle: {
    margin:
      "8px 0 0",
    color:
      COULEURS.texteSecondaire,
    fontSize: 15,
    lineHeight: 1.45,
    maxWidth: 720,
  },

  heroPeriod: {
    minWidth: 230,
    padding:
      "14px 17px",
    borderRadius: 10,
    background:
      "#fafafa",
    border:
      `1px solid ${COULEURS.bordure}`,
  },

  heroPeriodLabel: {
    fontSize: 11,
    textTransform:
      "uppercase",
    letterSpacing: 0.7,
    color:
      COULEURS.texteSecondaire,
    marginBottom: 5,
  },

  filtersCard: {
    background:
      COULEURS.blanc,
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 14,
    marginTop: 18,
    padding:
      "20px 22px",
  },

  filtersHeader: {
    display: "flex",
    justifyContent:
      "space-between",
    marginBottom: 14,
  },

  sectionEyebrow: {
    fontSize: 11,
    textTransform:
      "uppercase",
    letterSpacing: 1,
    fontWeight: 800,
    color:
      COULEURS.rouge,
    marginBottom: 3,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: 800,
  },

  periodButtons: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 18,
  },

  periodButton: {
    padding:
      "9px 15px",
    border:
      `1px solid ${COULEURS.bordure}`,
    background:
      COULEURS.blanc,
    borderRadius: 8,
    cursor:
      "pointer",
    fontFamily:
      "inherit",
    fontWeight: 700,
    color:
      COULEURS.texteSecondaire,
  },

  periodButtonActive: {
    background:
      COULEURS.rouge,
    color:
      COULEURS.blanc,
    borderColor:
      COULEURS.rouge,
  },

  filtersGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(180px,1fr))",
    gap: 14,
  },

  field: {
    display: "flex",
    flexDirection:
      "column",
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
  },

  input: {
    width: "100%",
    boxSizing:
      "border-box",
    padding:
      "10px 11px",
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 8,
    background:
      COULEURS.blanc,
    fontFamily:
      "inherit",
    fontSize: 14,
  },

  select: {
    width: "100%",
    boxSizing:
      "border-box",
    padding:
      "10px 11px",
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 8,
    background:
      COULEURS.blanc,
    fontFamily:
      "inherit",
    fontSize: 14,
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(190px,1fr))",
    gap: 14,
    marginTop: 18,
  },

  kpi: {
    background:
      COULEURS.blanc,
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 12,
    padding:
      "15px 17px",
    minHeight: 105,
    boxSizing:
      "border-box",
  },

  kpiLabel: {
    fontSize: 13,
    color:
      COULEURS.texteSecondaire,
    fontWeight: 700,
  },

  kpiValue: {
    fontSize: 27,
    fontWeight: 900,
    marginTop: 7,
  },

  kpiSub: {
    fontSize: 12,
    color:
      COULEURS.texteSecondaire,
    marginTop: 4,
  },

  tabs: {
    display: "flex",
    gap: 4,
    marginTop: 25,
    borderBottom:
      `1px solid ${COULEURS.bordure}`,
  },

  tab: {
    border: "none",
    background:
      "transparent",
    padding:
      "12px 17px",
    cursor:
      "pointer",
    fontFamily:
      "inherit",
    fontWeight: 800,
    color:
      COULEURS.texteSecondaire,
    borderBottom:
      "3px solid transparent",
  },

  tabActive: {
    color:
      COULEURS.rouge,
    borderBottomColor:
      COULEURS.rouge,
  },

  tabBadge: {
    display:
      "inline-flex",
    alignItems:
      "center",
    justifyContent:
      "center",
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: 7,
    background:
      COULEURS.rouge,
    color:
      COULEURS.blanc,
    fontSize: 11,
  },

  card: {
    background:
      COULEURS.blanc,
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 14,
    marginTop: 18,
    overflow:
      "hidden",
  },

  cardHeader: {
    padding:
      "21px 22px",
    display: "flex",
    alignItems:
      "flex-start",
    justifyContent:
      "space-between",
    gap: 20,
    flexWrap:
      "wrap",
    borderBottom:
      `1px solid ${COULEURS.bordure}`,
  },

  cardTitle: {
    margin: 0,
    fontSize: 21,
    fontWeight: 800,
  },

  cardSubtitle: {
    margin:
      "5px 0 0",
    color:
      COULEURS.texteSecondaire,
    fontSize: 13,
  },

  legend: {
    display: "flex",
    gap: 13,
    flexWrap:
      "wrap",
    justifyContent:
      "flex-end",
  },

  legendItem: {
    display: "flex",
    alignItems:
      "center",
    gap: 6,
    fontSize: 12,
    color:
      COULEURS.texteSecondaire,
  },

  chartScroll: {
    overflowX:
      "auto",
    padding:
      "25px 22px 18px",
  },

  chart: {
    position:
      "relative",
    height: 370,
    display: "flex",
    paddingLeft: 50,
    boxSizing:
      "border-box",
  },

  chartAxis: {
    position:
      "absolute",
    left: 0,
    top: 0,
    bottom: 45,
    width: 40,
    display: "flex",
    flexDirection:
      "column",
    justifyContent:
      "space-between",
    alignItems:
      "flex-end",
    paddingRight: 8,
    boxSizing:
      "border-box",
    fontSize: 10,
    color:
      "#999",
  },

  chartBars: {
    display: "flex",
    alignItems:
      "stretch",
    gap: 12,
    height: "100%",
    width: "100%",
  },

  chartColumn: {
    flex: 1,
    minWidth: 55,
    display: "flex",
    flexDirection:
      "column",
    alignItems:
      "center",
  },

  barArea: {
    flex: 1,
    width: "100%",
    display: "flex",
    alignItems:
      "flex-end",
    borderBottom:
      "1px solid #bfc3c7",
    borderLeft:
      "1px solid #eceeef",
    borderRight:
      "1px solid #eceeef",
    background:
      "linear-gradient(to bottom, transparent 24.8%, #eceeef 25%, transparent 25.2%, transparent 49.8%, #eceeef 50%, transparent 50.2%, transparent 74.8%, #eceeef 75%, transparent 75.2%)",
  },

  barCapacity: {
    width: "80%",
    height: "100%",
    display: "flex",
    flexDirection:
      "column",
    justifyContent:
      "flex-end",
    overflow:
      "hidden",
    borderRadius:
      "5px 5px 0 0",
    background:
      "#fafafa",
  },

  chartWeek: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 800,
  },

  chartHours: {
    marginTop: 2,
    fontSize: 10,
    color:
      COULEURS.texteSecondaire,
  },

  chartExplanation: {
    margin:
      "0 22px 22px",
    padding:
      "13px 15px",
    borderRadius: 9,
    background:
      "#fafafa",
    border:
      `1px solid ${COULEURS.bordure}`,
    display: "flex",
    gap: 10,
    fontSize: 12,
    color:
      COULEURS.texteSecondaire,
    lineHeight: 1.4,
  },

  explanationDot: {
    width: 10,
    height: 10,
    borderRadius:
      "50%",
    background:
      COULEURS.rouge,
    marginTop: 3,
    flexShrink: 0,
  },

  tableWrap: {
    overflowX:
      "auto",
  },

  table: {
    width: "100%",
    borderCollapse:
      "collapse",
    fontSize: 13,
  },

  sourceBadge: {
    display:
      "inline-flex",
    padding:
      "4px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    textTransform:
      "uppercase",
    letterSpacing:
      0.4,
  },

  tableHeader: {},

  diagnosticNumberCell: {
    textAlign: "center",
    whiteSpace: "nowrap",
  },

  smallText: {
    fontSize: 11,
    color:
      COULEURS.texteSecondaire,
    marginTop: 2,
  },

  emptyCell: {
    padding: 35,
    textAlign:
      "center",
    color:
      COULEURS.texteSecondaire,
  },

  infoBox: {
    margin:
      "18px 22px",
    padding:
      "13px 15px",
    borderRadius: 9,
    background:
      "#f8f8f8",
    border:
      `1px solid ${COULEURS.bordure}`,
    color:
      COULEURS.texteSecondaire,
    fontSize: 12,
    lineHeight: 1.5,
  },

  warningBadge: {
    padding:
      "7px 11px",
    borderRadius: 999,
    background:
      COULEURS.orangeClair,
    color:
      "#a85d00",
    fontSize: 12,
    fontWeight: 800,
  },

  detailGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(170px,1fr))",
    gap: 10,
  },

  detailBox: {
    background:
      COULEURS.blanc,
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 8,
    padding:
      "11px 13px",
  },

  collaborateursGrid: {
    padding: 22,
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fill,minmax(285px,1fr))",
    gap: 14,
  },

  collaborateurCard: {
    border:
      `1px solid ${COULEURS.bordure}`,
    borderRadius: 12,
    padding: 17,
    background:
      "#fff",
  },

  collaborateurTop: {
    display: "flex",
    alignItems:
      "center",
    gap: 12,
    paddingBottom: 13,
    borderBottom:
      `1px solid ${COULEURS.bordure}`,
  },

  avatar: {
    width: 43,
    height: 43,
    borderRadius:
      "50%",
    background:
      COULEURS.rouge,
    color:
      COULEURS.blanc,
    display: "flex",
    alignItems:
      "center",
    justifyContent:
      "center",
    fontWeight: 900,
    fontSize: 12,
  },

  collaborateurStats: {
    padding:
      "12px 0",
  },

  statLine: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems:
      "center",
    padding:
      "5px 0",
    fontSize: 13,
  },

  progressBackground: {
    height: 7,
    background:
      "#eceeef",
    borderRadius: 999,
    overflow:
      "hidden",
    marginTop: 7,
  },

  progressBar: {
    height: "100%",
    background:
      COULEURS.rouge,
    borderRadius: 999,
    transition:
      "width .25s ease",
  },

  progressCaption: {
    display: "flex",
    justifyContent:
      "space-between",
    fontSize: 11,
    color:
      COULEURS.texteSecondaire,
    marginTop: 6,
  },

  emptyBox: {
    padding: 35,
    textAlign:
      "center",
    color:
      COULEURS.texteSecondaire,
    background:
      "#fafafa",
    borderRadius: 10,
    margin: 22,
  },

  errorBox: {
    background:
      COULEURS.blanc,
    border:
      "1px solid #e2b5b5",
    borderLeft:
      `5px solid ${COULEURS.rouge}`,
    borderRadius: 10,
    padding: 20,
    color:
      COULEURS.texte,
  },

  primaryButton: {
    marginTop: 15,
    padding:
      "10px 15px",
    border: "none",
    borderRadius: 8,
    background:
      COULEURS.rouge,
    color:
      COULEURS.blanc,
    fontFamily:
      "inherit",
    fontWeight: 800,
    cursor:
      "pointer",
  },

  loading: {
    minHeight: "100vh",
    display: "flex",
    alignItems:
      "center",
    justifyContent:
      "center",
    gap: 14,
    background:
      COULEURS.fond,
  },

  spinner: {
    width: 28,
    height: 28,
    borderRadius:
      "50%",
    border:
      "3px solid #ddd",
    borderTopColor:
      COULEURS.rouge,
    animation:
      "spin 0.8s linear infinite",
  },
};

/* =========================================================
   GLOBAL TABLE CSS
========================================================= */

/*
  Les styles de cellules sont ajoutés ici
  pour conserver un rendu propre sans fichier CSS.
*/

if (
  typeof document !==
  "undefined"
) {
  const styleId =
    "polynov-bilans-table-style";

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
      .polynov-bilans-table th {
        text-align: left;
        padding: 11px 12px;
        background: #f7f8f9;
        border-bottom: 1px solid #e2e5e9;
        color: #626970;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .45px;
        white-space: nowrap;
      }

      .polynov-bilans-table td {
        padding: 11px 12px;
        border-bottom: 1px solid #eceeef;
        white-space: nowrap;
      }

      .polynov-bilans-table tbody tr:hover {
        background: #fafafa;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }
}