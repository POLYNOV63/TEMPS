"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";

type Collaborateur = {
  id: string;
  auth_user_id: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  trigramme: string | null;
  role: string | null;
  profil_horaire_id: string | null;
  actif: boolean | null;
  compteur_recuperation: number | null;
};

type Droit = {
  id: string;
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

type Demande = {
  id: string;
  exercice: number;
  type_demande: string;
  date_debut: string;
  date_fin: string;
  duree_jours: number;
  heures_re: number | null;
  commentaire: string | null;
  motif_refus: string | null;
  justificatif_nom: string | null;
  justificatif_url: string | null;
  statut: string;
  created_at: string;
  validateur_id: string | null;
  date_validation: string | null;
  signature_demandeur: string | null;
  signature_validateur: string | null;
  rh_transmise: boolean;
  rh_transmise_le: string | null;
};

const rouge = "#c00000";
const MAX_COMPTEUR = 30;

function exerciceActuel() {
  const d = new Date();
  return d.getMonth() >= 10
    ? d.getFullYear()
    : d.getFullYear() - 1;
}

function exerciceDeDemande(d: {
  exercice?: number | null;
  date_debut: string;
}) {
  if (d.exercice !== null && d.exercice !== undefined) {
    return Number(d.exercice);
  }

  const date = new Date(`${d.date_debut}T00:00:00`);

  return date.getMonth() >= 10
    ? date.getFullYear()
    : date.getFullYear() - 1;
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  });
}

function dateISO(date: Date) {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

function dateFR(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString(
    "fr-FR"
  );
}

function isoWeek(s: string) {
  const d = new Date(`${s}T00:00:00`);
  const u = new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate()
    )
  );
  const day = u.getUTCDay() || 7;

  u.setUTCDate(u.getUTCDate() + 4 - day);

  const y = new Date(
    Date.UTC(u.getUTCFullYear(), 0, 1)
  );

  return Math.ceil(
    (((u.getTime() - y.getTime()) / 86400000) + 1) /
      7
  );
}

function semaineLabel(s: string) {
  const d = new Date(`${s}T00:00:00`);

  return `S${String(isoWeek(s)).padStart(
    2,
    "0"
  )}-${d.getFullYear()}`;
}

function libelleType(t: string) {
  return (
    {
      RE: "Récupération",
      CP: "Congé payé",
      CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF:
        "CP exceptionnel avec justificatif",
      CP_EXCEPTIONNEL_SANS_JUSTIFICATIF:
        "CP exceptionnel sans justificatif",
      RTT: "RTT",
    } as Record<string, string>
  )[t] || t;
}

function estCP(type: string) {
  return [
    "CP",
    "CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF",
    "CP_EXCEPTIONNEL_SANS_JUSTIFICATIF",
  ].includes(type);
}

function calculerPaques(annee: number) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
}

function ajouterJours(date: Date, nombre: number) {
  const resultat = new Date(date);
  resultat.setDate(resultat.getDate() + nombre);
  return resultat;
}

function joursFeriesFrancais(annee: number) {
  const paques = calculerPaques(annee);
  return new Set([
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
  ].map(dateISO));
}

function estJourOuvre(date: Date) {
  const jour = date.getDay();
  if (jour === 0 || jour === 6) return false;
  return !joursFeriesFrancais(date.getFullYear()).has(dateISO(date));
}

function estVendredi(dateString: string) {
  if (!dateString) return false;
  return new Date(`${dateString}T00:00:00`).getDay() === 5;
}

function joursOuvresInclusifs(debut: string, fin: string) {
  if (!debut || !fin) return 0;
  const d1 = new Date(`${debut}T00:00:00`);
  const d2 = new Date(`${fin}T00:00:00`);
  if (d2 < d1) return 0;

  let total = 0;
  const courant = new Date(d1);
  while (courant <= d2) {
    if (estJourOuvre(courant)) total += 1;
    courant.setDate(courant.getDate() + 1);
  }
  return total;
}

function calculerDureePeriode(
  dateDebut: string,
  dateFin: string,
  demiDebut: boolean,
  demiFin: boolean
) {
  if (!dateDebut || !dateFin) return { valide: false, duree: 0, erreur: "Veuillez renseigner les deux dates." };

  const debut = new Date(`${dateDebut}T00:00:00`);
  const fin = new Date(`${dateFin}T00:00:00`);

  if (fin < debut) return { valide: false, duree: 0, erreur: "La date de fin doit être postérieure ou égale à la date de début." };
  if (!estJourOuvre(debut)) return { valide: false, duree: 0, erreur: "La date de début doit être un jour ouvré. Les week-ends et jours fériés ne peuvent pas être le début d'une demande." };
  if (!estJourOuvre(fin)) return { valide: false, duree: 0, erreur: "La date de fin doit être un jour ouvré. Les week-ends et jours fériés ne peuvent pas être la fin d'une demande." };
  if (demiDebut && estVendredi(dateDebut)) return { valide: false, duree: 0, erreur: "Une demi-journée ne peut pas être posée le vendredi (début de demande)." };
  if (demiFin && estVendredi(dateFin)) return { valide: false, duree: 0, erreur: "Une demi-journée ne peut pas être posée le vendredi (fin de demande)." };

  const jours = joursOuvresInclusifs(dateDebut, dateFin);
  if (jours <= 0) return { valide: false, duree: 0, erreur: "La période ne contient aucun jour ouvré." };

  if (dateDebut === dateFin) {
    if (demiDebut !== demiFin) {
      return { valide: false, duree: 0, erreur: "Pour une seule journée, sélectionnez la même durée au début et à la fin." };
    }
    return { valide: true, duree: demiDebut ? 0.5 : 1, erreur: "" };
  }

  const duree = jours - (demiDebut ? 0.5 : 0) - (demiFin ? 0.5 : 0);
  if (duree <= 0) return { valide: false, duree: 0, erreur: "La durée calculée est invalide." };
  return { valide: true, duree: Math.round(duree * 2) / 2, erreur: "" };
}


function Badge({
  statut,
}: {
  statut: string;
}) {
  const m: Record<
    string,
    [string, string, string]
  > = {
    EN_ATTENTE: [
      "#fff3cd",
      "#8a6500",
      "En attente",
    ],
    VALIDEE: [
      "#e7f6ec",
      "#18713b",
      "Validée",
    ],
    ENVOYEE_RH: [
      "#e8f0ff",
      "#2455a4",
      "Envoyée RH",
    ],
    REFUSEE: [
      "#fdecec",
      "#a51d1d",
      "Refusée",
    ],
    ANNULEE: [
      "#eee",
      "#666",
      "Annulée",
    ],
  };

  const x =
    m[statut] || ["#eee", "#555", statut];

  return (
    <span
      style={{
        ...styles.badge,
        background: x[0],
        color: x[1],
      }}
    >
      {x[2]}
    </span>
  );
}

function Mini({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={styles.mini}>
      <span>{label}</span>
      <strong>{fmt(value)} j</strong>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function BarreCompteur({
  valeur,
}: {
  valeur: number;
}) {
  const position = Math.max(
    0,
    Math.min(
      100,
      ((valeur + MAX_COMPTEUR) /
        (MAX_COMPTEUR * 2)) *
        100
    )
  );

  const positif = valeur >= 0;

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          position: "relative",
          height: 12,
          borderRadius: 999,
          background:
            "linear-gradient(90deg,#e8edf2 0%,#eef0f2 50%,#e8edf2 100%)",
          border: "1px solid #dfe3e7",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: -4,
            width: 2,
            height: 20,
            background: "#999",
            transform: "translateX(-50%)",
          }}
        />

        <div
          title={`Compteur : ${
            valeur >= 0 ? "+" : ""
          }${fmt(valeur)} h`}
          style={{
            position: "absolute",
            left: `${position}%`,
            top: "50%",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: positif
              ? "#198754"
              : rouge,
            border: "3px solid white",
            boxShadow:
              "0 1px 5px rgba(0,0,0,.22)",
            transform:
              "translate(-50%, -50%)",
            zIndex: 2,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          color: "#777",
          fontSize: 12,
        }}
      >
        <span>-30 h</span>
        <span>0 h</span>
        <span>+30 h</span>
      </div>
    </div>
  );
}

export default function RHPage() {
  const [collab, setCollab] =
    useState<Collaborateur | null>(null);

  const [droit, setDroit] =
    useState<Droit | null>(null);

  const [demandes, setDemandes] =
    useState<Demande[]>([]);

  const [validateurs, setValidateurs] =
    useState<Record<string, string>>({});

  const [feuilles, setFeuilles] =
    useState<any[]>([]);

  const [jours, setJours] =
    useState<any[]>([]);

  const [heuresSupExercice, setHeuresSupExercice] =
    useState(0);

  const [chargement, setChargement] =
    useState(true);

  const [erreur, setErreur] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [type, setType] =
    useState("CP");

  const [dateDebut, setDateDebut] =
    useState("");

  const [dateFin, setDateFin] =
    useState("");

  const [demiJourneeDebut, setDemiJourneeDebut] =
    useState(false);

  const [demiJourneeFin, setDemiJourneeFin] =
    useState(false);

  const [heuresRE, setHeuresRE] =
    useState("");

  const [commentaire, setCommentaire] =
    useState("");

  const [fichier, setFichier] =
    useState<File | null>(null);

  const [envoi, setEnvoi] =
    useState(false);

  const exercice = exerciceActuel();

  async function charger(silencieux = false) {
    if (!silencieux) {
      setChargement(true);
      setErreur("");
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const {
        data: c,
        error: ce,
      } = await supabase
        .from("collaborateurs")
        .select(
          "id,auth_user_id,prenom,nom,email,trigramme,role,profil_horaire_id,actif,compteur_recuperation"
        )
        .eq("auth_user_id", user.id)
        .single();

      if (ce || !c) {
        throw (
          ce ||
          new Error(
            "Collaborateur introuvable."
          )
        );
      }

      setCollab(c as Collaborateur);

      const [
        { data: dr, error: de },
        { data: ds, error: dse },
      ] = await Promise.all([
        supabase
          .from("rh_droits")
          .select("*")
          .eq("collaborateur_id", c.id)
          .eq("exercice", exercice)
          .maybeSingle(),

        supabase
          .from("rh_demandes")
          .select(
            "id,exercice,type_demande,date_debut,date_fin,duree_jours,heures_re,commentaire,justificatif_nom,justificatif_url,statut,created_at,validateur_id,date_validation,signature_demandeur,signature_validateur,motif_refus,rh_transmise,rh_transmise_le"
          )
          .eq(
            "collaborateur_id",
            c.id
          )
          .order("date_debut", {
            ascending: false,
          }),
      ]);

      if (de) throw de;
      if (dse) throw dse;

      setDroit(dr as Droit | null);

      const demandesChargees =
        (ds || []) as Demande[];

      setDemandes(demandesChargees);

      const idsValidateurs = [
        ...new Set(
          demandesChargees
            .map((d) => d.validateur_id)
            .filter(Boolean)
        ),
      ] as string[];

      if (idsValidateurs.length) {
        const {
          data: vs,
          error: ve,
        } = await supabase
          .from("collaborateurs")
          .select(
            "id,trigramme,prenom,nom"
          )
          .in(
            "id",
            idsValidateurs
          );

        if (ve) throw ve;

        const vm: Record<
          string,
          string
        > = {};

        (vs || []).forEach(
          (v: any) => {
            vm[v.id] =
              v.trigramme ||
              `${v.prenom || ""} ${
                v.nom || ""
              }`.trim();
          }
        );

        setValidateurs(vm);
      } else {
        setValidateurs({});
      }

      const {
        data: fs,
        error: fe,
      } = await supabase
        .from("feuilles_heures")
        .select(
          "id,semaine_debut,total_re,compteur_avant,compteur_apres,heures_supplementaires"
        )
        .eq(
          "collaborateur_id",
          c.id
        )
        .order("semaine_debut", {
          ascending: false,
        });

      if (fe) throw fe;

      setFeuilles(fs || []);

      const hsExercice = (
        fs || []
      )
        .filter((f: any) => {
          const d = new Date(
            `${f.semaine_debut}T00:00:00`
          );

          const ex =
            d.getMonth() >= 10
              ? d.getFullYear()
              : d.getFullYear() - 1;

          return ex === exercice;
        })
        .reduce(
          (
            s: number,
            f: any
          ) =>
            s +
            Number(
              f.heures_supplementaires ||
                0
            ),
          0
        );

      setHeuresSupExercice(
        hsExercice
      );

      const ids = (fs || []).map(
        (x: any) => x.id
      );

      if (ids.length) {
        const {
          data: js,
          error: je,
        } = await supabase
          .from(
            "feuilles_heures_jours"
          )
          .select(
            "id,feuille_id,date_jour,presence,ticket_restaurant"
          )
          .in(
            "feuille_id",
            ids
          );

        if (je) throw je;

        setJours(js || []);
      } else {
        setJours([]);
      }
    } catch (e: any) {
      if (!silencieux) {
        setErreur(
          e?.message ||
            "Impossible de charger votre espace RH."
        );
      }
    } finally {
      if (!silencieux) {
        setChargement(false);
      }
    }
  }

  useEffect(() => {
    charger();

    // Un administrateur peut modifier les droits RH pendant que la page est
    // ouverte : on les relit sans écran de chargement en revenant sur l'onglet.
    function auRetour() {
      if (document.visibilityState === "visible") {
        charger(true);
      }
    }

    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("focus", auRetour);

    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("focus", auRetour);
    };
  }, []);

  // Les droits (Collaborateurs > Droits RH) sont relus à chaque chargement :
  // ils restent la référence. Seules les demandes de l'exercice en cours sont
  // décomptées de ces droits.
  const demandesExercice = useMemo(
    () => demandes.filter((d) => exerciceDeDemande(d) === exercice),
    [demandes, exercice]
  );

  const prisesCP = useMemo(
    () =>
      demandesExercice
        .filter(
          (d) =>
            ["VALIDEE", "ENVOYEE_RH"].includes(
              d.statut
            ) &&
            estCP(d.type_demande)
        )
        .reduce(
          (s, d) =>
            s + Number(d.duree_jours || 0),
          0
        ),
    [demandesExercice]
  );

  const attenteCP = useMemo(
    () =>
      demandesExercice
        .filter(
          (d) =>
            d.statut === "EN_ATTENTE" &&
            estCP(d.type_demande)
        )
        .reduce(
          (s, d) =>
            s + Number(d.duree_jours || 0),
          0
        ),
    [demandesExercice]
  );

  const totalCP = droit
    ? Number(droit.cp_reportes || 0) +
      Number(droit.cp_acquis || 0) +
      Number(droit.cp_anciennete || 0) +
      Number(
        droit.cp_exceptionnels_avec_justificatif ||
          0
      ) +
      Number(
        droit.cp_exceptionnels_sans_justificatif ||
          0
      )
    : 0;

  const resteCP =
    totalCP - prisesCP - attenteCP;

  const prisesRTT = useMemo(
    () =>
      demandesExercice
        .filter(
          (d) =>
            ["VALIDEE", "ENVOYEE_RH"].includes(
              d.statut
            ) &&
            d.type_demande === "RTT"
        )
        .reduce(
          (s, d) =>
            s + Number(d.duree_jours || 0),
          0
        ),
    [demandesExercice]
  );

  const attenteRTT = useMemo(
    () =>
      demandesExercice
        .filter(
          (d) =>
            d.statut === "EN_ATTENTE" &&
            d.type_demande === "RTT"
        )
        .reduce(
          (s, d) =>
            s + Number(d.duree_jours || 0),
          0
        ),
    [demandesExercice]
  );

  const resteRTT =
    Number(droit?.rtt_acquis || 0) -
    prisesRTT -
    attenteRTT;

  // Le compteur affiché est le compteur réel en fin de dernière feuille.
  // S'il n'existe encore aucune feuille, on reprend la valeur initiale RH,
  // puis seulement en dernier recours la valeur historique du collaborateur.
  const compteur = Number(
    feuilles.length > 0
      ? (feuilles[0].compteur_apres ?? 0)
      : (droit?.compteur_recuperation_initial ??
          collab?.compteur_recuperation ??
          0)
  );

  const tickets = jours.filter((j: any) => {
    const d = new Date(`${j.date_jour}T00:00:00`);
    const ex =
      d.getMonth() >= 10
        ? d.getFullYear()
        : d.getFullYear() - 1;

    return (
      ex === exercice &&
      j.ticket_restaurant === true
    );
  }).length;

  const teletravail = jours.filter((j: any) => {
    const d = new Date(`${j.date_jour}T00:00:00`);
    const ex =
      d.getMonth() >= 10
        ? d.getFullYear()
        : d.getFullYear() - 1;

    const p = String(j.presence || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return (
      ex === exercice &&
      (p === "TELETRAVAIL" ||
        p === "TELE-TRAVAIL" ||
        p === "TELE TRAVAIL")
    );
  }).length;

  const periodeDemandeCalculee = useMemo(() => {
    if (type === "RE") {
      return { valide: Boolean(dateDebut) && estJourOuvre(new Date(`${dateDebut}T00:00:00`)), duree: 0, erreur: "" };
    }

    return calculerDureePeriode(
      dateDebut,
      dateFin,
      demiJourneeDebut,
      demiJourneeFin
    );
  }, [type, dateDebut, dateFin, demiJourneeDebut, demiJourneeFin]);

  function reinitialiserDatesPourType(nouveauType: string) {
    setType(nouveauType);
    setDemiJourneeDebut(false);
    setDemiJourneeFin(false);
    if (dateDebut) {
      setDateFin(dateDebut);
    }
  }

  async function supprimerDemande(
    d: Demande
  ) {
    if (!(d.statut === "EN_ATTENTE" || d.statut === "REFUSEE")) {
      setErreur("Seules les demandes en attente ou refusées peuvent être supprimées par le collaborateur.");
      return;
    }

    if (!window.confirm("Supprimer définitivement cette demande ?")) return;

    setErreur("");
    const { error } = await supabase
      .from("rh_demandes")
      .delete()
      .eq("id", d.id);

    if (error) {
      setErreur(error.message);
      return;
    }

    setMessage("Demande supprimée.");
    await charger();
  }

  async function envoyerDemande(
    e: React.FormEvent
  ) {
    e.preventDefault();

    setErreur("");
    setMessage("");

    if (!collab || !dateDebut) {
      setErreur(
        "Veuillez renseigner une date de début."
      );
      return;
    }

    const dateDebutObjet = new Date(`${dateDebut}T00:00:00`);

    if (!estJourOuvre(dateDebutObjet)) {
      setErreur(
        "La date de début doit être un jour ouvré : les week-ends et jours fériés ne peuvent pas être sélectionnés."
      );
      return;
    }

    if (type !== "RE") {
      const calcul = calculerDureePeriode(
        dateDebut,
        dateFin,
        demiJourneeDebut,
        demiJourneeFin
      );

      if (!calcul.valide) {
        setErreur(calcul.erreur);
        return;
      }
    }

    const dureeDemandee =
      type === "RE"
        ? 1
        : periodeDemandeCalculee.duree;

    const dateFinDemande =
      type === "RE" ? dateDebut : dateFin;

    if (!dateFinDemande) {
      setErreur("Veuillez renseigner une date de fin.");
      return;
    }

    if (
      type === "RE" &&
      Number(heuresRE) <= 0
    ) {
      setErreur(
        "Indiquez le nombre d'heures de récupération."
      );
      return;
    }

    if (
      estCP(type) &&
      dureeDemandee > resteCP
    ) {
      setErreur(
        "Le solde disponible de CP est insuffisant en tenant compte des demandes déjà en validation."
      );
      return;
    }

    if (
      type === "RTT" &&
      dureeDemandee > resteRTT
    ) {
      setErreur(
        "Le solde disponible de RTT est insuffisant en tenant compte des demandes déjà en validation."
      );
      return;
    }

    const texteDate =
      (estCP(type) || type === "RTT")
        ? `${dateFR(dateDebut)} → ${dateFR(
            dateFinDemande
          )}`
        : dateFR(dateDebut);

    const texteDuree =
      type === "RE"
        ? `${fmt(
            Number(heuresRE)
          )} h`
        : `${fmt(
            dureeDemandee
          )} jour${
            dureeDemandee > 1
              ? "s"
              : ""
          }`;

    if (
      !window.confirm(
        `Confirmer l'envoi de cette demande ?\n\n${libelleType(
          type
        )}\n${texteDate}\nDurée : ${texteDuree}\n\nUne notification sera envoyée automatiquement aux administrateurs AMA / PLG.`
      )
    ) {
      return;
    }

    setEnvoi(true);

    try {
      let justificatif_url:
        | string
        | null = null;

      let justificatif_nom:
        | string
        | null = null;

      if (fichier) {
        justificatif_nom =
          fichier.name;

        const {
          data: { user },
        } =
          await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            "Session utilisateur introuvable."
          );
        }

        const path = `${
          user.id
        }/${crypto.randomUUID()}-${fichier.name.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        )}`;

        const { error: up } =
          await supabase.storage
            .from(
              "rh-justificatifs"
            )
            .upload(
              path,
              fichier
            );

        if (up) throw up;

        justificatif_url = path;
      }

      const { data: created, error } =
        await supabase
          .from("rh_demandes")
          .insert({
            collaborateur_id:
              collab.id,
            exercice,
            type_demande: type,
            date_debut:
              dateDebut,
            date_fin:
              (estCP(type) || type === "RTT")
                ? dateFinDemande
                : dateDebut,
            duree_jours:
              dureeDemandee,
            heures_re:
              type === "RE"
                ? Number(
                    heuresRE
                  )
                : null,
            commentaire:
              commentaire ||
              null,
            justificatif_nom,
            justificatif_url,
            email_rh:
              "a.loyer@sibim.fr",
            signature_demandeur:
              `${collab.prenom || ""} ${
                collab.nom || ""
              }`.trim() +
              ` (${collab.trigramme || ""})`,
            rh_transmise: false,
            rh_transmise_le: null,
          })
          .select("id")
          .single();

      if (error) throw error;

      if (!created?.id) {
        throw new Error(
          "La demande a été créée mais son identifiant est introuvable."
        );
      }

      const notification =
        await supabase.functions.invoke(
          "notifier-demande-rh",
          {
            body: {
              demande_id:
                created.id,
            },
          }
        );

      if (notification.error) {
        setMessage(
          "Demande enregistrée, mais la notification aux administrateurs n’a pas pu être envoyée. La demande reste visible dans « Mes demandes »."
        );
      } else {
        setMessage(
          "Demande envoyée aux administrateurs. AMA et PLG ont été notifiés par e-mail."
        );
      }

      setDateDebut("");
      setDateFin("");
      setDemiJourneeDebut(false);
      setDemiJourneeFin(false);
      setHeuresRE("");
      setCommentaire("");
      setFichier(null);

      await charger();
    } catch (e: any) {
      setErreur(
        e?.message ||
          "Impossible d'envoyer la demande."
      );
    } finally {
      setEnvoi(false);
    }
  }

  if (chargement) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          Chargement de votre espace RH…
        </div>
      </main>
    );
  }

  if (erreur && !collab) {
    return (
      <main style={styles.page}>
        <EnTetePage
          forme="encadre"
          section="Espace collaborateur"
          titre="Mon espace RH"
        />

        <div style={styles.card}>
          <strong>Erreur</strong>
          <p>{erreur}</p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <EnTetePage
        forme="encadre"
        section="Espace collaborateur"
        titre="Mon espace RH"
        description={`${collab?.prenom ?? ""} ${collab?.nom ?? ""} · ${collab?.trigramme ?? ""}`}
      />

      {erreur && (
        <div style={styles.alert}>
          {erreur}
        </div>
      )}

      {message && (
        <div style={styles.success}>
          {message}
        </div>
      )}

      <section
        style={{
          ...styles.grid,
          gridTemplateColumns:
            "repeat(5,minmax(0,1fr))",
        }}
      >
        <div
          style={{
            ...styles.card,
            gridColumn: "span 2",
          }}
        >
          <div style={styles.cardTitle}>
            🕐 Compteur de récupération
          </div>

          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              color:
                compteur < 0
                  ? rouge
                  : "#198754",
            }}
          >
            {compteur >= 0
              ? "+"
              : ""}
            {fmt(compteur)} h
          </div>

          <BarreCompteur
            valeur={compteur}
          />

          <small
            style={styles.muted}
          >
            Position actuelle dans la
            limite autorisée de -30 h à
            +30 h.
          </small>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            🍽 Tickets restaurant
          </div>

          <div style={styles.big}>
            {tickets}
          </div>

          <small style={styles.muted}>
            Sur l’exercice {exercice}-{exercice + 1}
          </small>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            🏠 Télétravail
          </div>

          <div style={styles.big}>
            {teletravail}
          </div>

          <small style={styles.muted}>
            Sur l’exercice {exercice}-{exercice + 1}
          </small>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            ⏱️ Heures supplémentaires
          </div>

          <div style={styles.big}>
            {fmt(
              heuresSupExercice
            )}{" "}
            <span
              style={styles.unit}
            >
              h
            </span>
          </div>

          <small style={styles.muted}>
            Sur l’exercice {exercice}-
            {exercice + 1}
          </small>
        </div>
      </section>

      <section style={styles.grid}>
        <div
          style={{
            ...styles.card,
            gridColumn: "span 3",
          }}
        >
          <div style={styles.cardTitle}>
            🏖️ Mes congés payés
          </div>

          {droit ? (
            <>
              <div
                style={styles.cpTotal}
              >
                {fmt(
                  Math.max(0, resteCP)
                )}{" "}
                <span>
                  jours disponibles
                </span>
              </div>

              <div style={styles.cpGrid}>
                <Mini
                  label="CP reportés — année précédente"
                  value={
                    droit.cp_reportes
                  }
                />

                <Mini
                  label="CP acquis — année courante"
                  value={
                    droit.cp_acquis
                  }
                />

                <Mini
                  label="Ancienneté"
                  value={
                    droit.cp_anciennete
                  }
                />

                <Mini
                  label="Exceptionnels"
                  value={
                    Number(
                      droit.cp_exceptionnels_avec_justificatif ||
                        0
                    ) +
                    Number(
                      droit.cp_exceptionnels_sans_justificatif ||
                        0
                    )
                  }
                />
              </div>

              <div
                style={{
                  ...styles.balance,
                  marginTop: 8,
                }}
              >
                <span>
                  Dont ancienneté :{" "}
                  <strong>
                    {fmt(
                      droit.cp_anciennete
                    )}{" "}
                    j
                  </strong>
                </span>

                <span>
                  Pris :{" "}
                  <strong>
                    {fmt(
                      prisesCP
                    )}{" "}
                    j
                  </strong>
                </span>

                <span>
                  En validation :{" "}
                  <strong>
                    {fmt(
                      attenteCP
                    )}{" "}
                    j
                  </strong>
                </span>

                <span>
                  Total :{" "}
                  <strong>
                    {fmt(totalCP)} j
                  </strong>
                </span>
              </div>

              <div style={styles.period}>
                <strong>
                  Période CP paramétrée : {exercice} → {exercice + 1}
                </strong>
                <br />
                <span style={{ fontSize: 11, color: "#777" }}>
                  {droit.cp_periode_debut
                    ? dateFR(droit.cp_periode_debut)
                    : `01/04/${exercice}`}
                  {" → "}
                  {droit.cp_periode_fin
                    ? dateFR(droit.cp_periode_fin)
                    : `31/05/${exercice + 1}`}
                </span>
              </div>
            </>
          ) : (
            <div
              style={styles.warning}
            >
              Les droits CP de l’exercice{" "}
              {exercice}-
              {exercice + 1} ne sont
              pas paramétrés.
            </div>
          )}
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>
            📅 RTT
          </div>

          <div style={styles.big}>
            {fmt(
              Math.max(
                0,
                resteRTT
              )
            )}{" "}
            <span
              style={styles.unit}
            >
              j
            </span>
          </div>

          <div style={styles.muted}>
            Pris : {fmt(prisesRTT)} j
            · En validation :{" "}
            {fmt(attenteRTT)} j ·
            Acquis :{" "}
            {fmt(
              droit?.rtt_acquis ||
                0
            )}{" "}
            j
          </div>
        </div>
      </section>

      <section
        style={{
          ...styles.card,
          marginBottom: 24,
        }}
      >
        <div style={styles.cardTitle}>
          ✉️ Faire une demande
        </div>

        <div
          style={styles.notificationInfo}
        >
          <strong>
            🔔 Information
          </strong>

          <span>
            Chaque demande envoyée ici
            crée une demande RH et
            déclenche automatiquement une
            notification par e-mail aux
            administrateurs AMA et PLG.
          </span>
        </div>

        <form
          onSubmit={envoyerDemande}
        >
          <div style={styles.formGrid}>
            <Field label="Type">
              <select
                style={styles.input}
                value={type}
                onChange={(e) =>
                  reinitialiserDatesPourType(
                    e.target.value
                  )
                }
              >
                <option value="CP">
                  CP normal
                </option>

                <option value="RTT">
                  RTT
                </option>

                <option value="RE">
                  Récupération
                </option>

                <option value="CP_EXCEPTIONNEL_SANS_JUSTIFICATIF">
                  CP exceptionnel sans
                  justificatif
                </option>

                <option value="CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF">
                  CP exceptionnel avec
                  justificatif
                </option>
              </select>
            </Field>

            {type === "RE" ? (
              <Field label="Date de début">
                <input
                  type="date"
                  style={styles.input}
                  value={dateDebut}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDateDebut(value);
                    if (!dateFin || dateFin < value) setDateFin(value);
                    if (estVendredi(value)) setDemiJourneeDebut(false);
                  }}
                  required
                />
              </Field>
            ) : (
              <div style={styles.periodeGrid}>
                <div style={styles.periodeColonne}>
                  <Field label="Date de début">
                    <input
                      type="date"
                      style={styles.input}
                      value={dateDebut}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDateDebut(value);
                        if (!dateFin || dateFin < value) setDateFin(value);
                        if (estVendredi(value)) setDemiJourneeDebut(false);
                      }}
                      required
                    />
                  </Field>

                  <Field label="Début de période">
                    <select
                      style={styles.input}
                      value={demiJourneeDebut ? "0.5" : "1"}
                      onChange={(e) =>
                        setDemiJourneeDebut(e.target.value === "0.5")
                      }
                    >
                      <option value="1">Journée entière</option>
                      <option
                        value="0.5"
                        disabled={estVendredi(dateDebut)}
                      >
                        ½ journée
                      </option>
                    </select>
                  </Field>
                </div>

                <div style={styles.periodeColonne}>
                  <Field label="Date de fin (incluse)">
                    <input
                      type="date"
                      style={styles.input}
                      value={dateFin}
                      min={dateDebut || undefined}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDateFin(value);
                        if (estVendredi(value)) setDemiJourneeFin(false);
                      }}
                      required
                    />
                  </Field>

                  <Field label="Fin de période">
                    <select
                      style={styles.input}
                      value={demiJourneeFin ? "0.5" : "1"}
                      onChange={(e) =>
                        setDemiJourneeFin(e.target.value === "0.5")
                      }
                    >
                      <option value="1">Journée entière</option>
                      <option
                        value="0.5"
                        disabled={estVendredi(dateFin)}
                      >
                        ½ journée
                      </option>
                    </select>
                  </Field>
                </div>
              </div>
            )}

            {type !== "RE" && (
              <div style={styles.durationPreview}>
                <span>Période réellement décomptée</span>
                <strong>
                  {dateDebut && dateFin
                    ? `${dateFR(dateDebut)} → ${dateFR(dateFin)}`
                    : "Choisissez les deux dates"}
                </strong>
                <small>
                  {periodeDemandeCalculee.valide
                    ? `${fmt(periodeDemandeCalculee.duree)} jour${periodeDemandeCalculee.duree > 1 ? "s" : ""} ouvré${periodeDemandeCalculee.duree > 1 ? "s" : ""} · week-ends et jours fériés non décomptés`
                    : periodeDemandeCalculee.erreur || "La durée sera calculée automatiquement."}
                </small>
              </div>
            )}

            {type === "RE" && (
              <Field label="Heures à récupérer">
                <input
                  type="number"
                  min="0.5"
                  max="7.5"
                  step="0.5"
                  style={styles.input}
                  value={heuresRE}
                  onChange={(e) =>
                    setHeuresRE(
                      e.target.value
                    )
                  }
                />
              </Field>
            )}

            {type ===
              "CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF" && (
              <Field label="Justificatif">
                <input
                  type="file"
                  style={styles.input}
                  onChange={(e) =>
                    setFichier(
                      e.target.files?.[0] ||
                        null
                    )
                  }
                />
              </Field>
            )}

            <Field label="Commentaire (facultatif)">
              <textarea
                style={{
                  ...styles.input,
                  minHeight: 42,
                }}
                value={
                  commentaire
                }
                onChange={(e) =>
                  setCommentaire(
                    e.target.value
                  )
                }
              />
            </Field>
          </div>

          <button
            disabled={envoi}
            style={{
              ...styles.button,
              opacity: envoi ? 0.65 : 1,
            }}
          >
            {envoi
              ? "Envoi en cours…"
              : "Envoyer la demande"}
          </button>
        </form>
      </section>

      <section style={styles.card}>
        <div style={styles.cardTitle}>
          📋 Mes demandes
        </div>

        {demandes.length === 0 ? (
          <div style={styles.muted}>
            Aucune demande.
          </div>
        ) : (
          <div
            style={{
              overflowX: "auto",
            }}
          >
            <table
              style={styles.table}
            >
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Période</th>
                  <th>Durée</th>
                  <th>Statut</th>
                  <th>Validation</th>
                  <th>Transmission RH</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {demandes.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {libelleType(
                        d.type_demande
                      )}
                    </td>

                    <td>
                      {d.date_debut ===
                      d.date_fin
                        ? dateFR(
                            d.date_debut
                          )
                        : `${dateFR(
                            d.date_debut
                          )} → ${dateFR(
                            d.date_fin
                          )}`}
                      <br />
                      <small>
                        {semaineLabel(
                          d.date_debut
                        )}
                      </small>
                    </td>

                    <td>
                      {d.type_demande ===
                      "RE"
                        ? `${fmt(
                            d.heures_re ||
                              0
                          )} h`
                        : `${fmt(
                            d.duree_jours
                          )} j`}
                    </td>

                    <td>
                      <Badge
                        statut={
                          d.statut
                        }
                      />
                      {d.statut === "REFUSEE" && d.motif_refus && (
                        <div style={styles.refusalReason}>
                          <strong>Motif :</strong> {d.motif_refus}
                        </div>
                      )}
                    </td>

                    <td>
                      {d.validateur_id
                        ? `${
                            validateurs[
                              d.validateur_id
                            ] ||
                            "Validateur"
                          } · ${
                            d.date_validation
                              ? new Date(
                                  d.date_validation
                                ).toLocaleString(
                                  "fr-FR"
                                )
                              : ""
                          }`
                        : "—"}
                    </td>

                    <td>
                      <span
                        style={{
                          ...styles.transmissionBadge,
                          ...(d.rh_transmise
                            ? styles.transmissionOui
                            : styles.transmissionNon),
                        }}
                      >
                        {d.rh_transmise ? "✓ Transmise au RH" : "— Non transmise"}
                      </span>
                      {d.rh_transmise_le && (
                        <div style={styles.transmissionDate}>
                          {new Date(d.rh_transmise_le).toLocaleString("fr-FR")}
                        </div>
                      )}
                    </td>

                    <td>
                      {(d.statut === "EN_ATTENTE" || d.statut === "REFUSEE") ? (
                        <button
                          style={
                            styles.deleteButton
                          }
                          onClick={() =>
                            supprimerDemande(
                              d
                            )
                          }
                          title="Supprimer"
                        >
                          ×
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#f5f6f8",
    fontFamily:
      "Calibri, Arial, sans-serif",
    padding: "32px 5vw",
    color: "#252525",
  },

  header: {
    background: rouge,
    color: "#fff",
    borderRadius: 14,
    padding: "25px 30px",
    marginBottom: 24,
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: 20,
  },

  headerButton: {
    border:
      "1px solid rgba(255,255,255,.5)",
    background: "transparent",
    color: "#fff",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },

  kicker: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1.2,
    opacity: 0.85,
  },

  h1: {
    margin: "4px 0",
    fontSize: 32,
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(4,minmax(0,1fr))",
    gap: 18,
    marginBottom: 18,
  },

  card: {
    background: "#fff",
    border:
      "1px solid #e2e5e9",
    borderRadius: 14,
    padding: 22,
    boxShadow:
      "0 2px 8px rgba(0,0,0,.05)",
  },

  cardTitle: {
    fontWeight: 800,
    fontSize: 18,
    marginBottom: 14,
  },

  big: {
    fontSize: 34,
    fontWeight: 800,
  },

  unit: {
    fontSize: 16,
  },

  muted: {
    color: "#6d737a",
    fontSize: 13,
  },

  cpTotal: {
    fontSize: 32,
    fontWeight: 800,
    marginBottom: 12,
  },

  cpGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(4,1fr)",
    gap: 10,
    margin: "15px 0",
  },

  mini: {
    background: "#f7f7f7",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    fontSize: 12,
  },

  balance: {
    display: "flex",
    gap: 25,
    flexWrap: "wrap",
    fontSize: 13,
    borderTop:
      "1px solid #eee",
    paddingTop: 12,
  },

  period: {
    marginTop: 12,
    padding: 10,
    background: "#f7f7f7",
    borderRadius: 8,
    fontSize: 12,
    color: "#666",
  },

  warning: {
    padding: 14,
    background: "#fff6df",
    borderRadius: 10,
    color: "#8a6500",
  },

  notificationInfo: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "#f4f7fb",
    border:
      "1px solid #dce5f0",
    color: "#4f5d6b",
    borderRadius: 10,
    padding: "11px 13px",
    marginBottom: 18,
    fontSize: 13,
    lineHeight: 1.45,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3,minmax(0,1fr))",
    gap: 14,
    marginBottom: 16,
  },

  periodeGrid: {
    gridColumn: "span 2",
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 14,
    alignItems: "start",
  },

  periodeColonne: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },

  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
  },

  input: {
    border:
      "1px solid #d7dadd",
    borderRadius: 8,
    padding: "10px 11px",
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 400,
    background: "#fff",
  },

  durationPreview: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    background: "#f7f9fb",
    border:
      "1px solid #e0e5ea",
    borderRadius: 8,
    padding: "10px 12px",
    gap: 3,
  },

  button: {
    border: 0,
    borderRadius: 8,
    background: rouge,
    color: "#fff",
    padding: "11px 18px",
    fontWeight: 800,
    cursor: "pointer",
  },

  table: {
    width: "100%",
    borderCollapse:
      "collapse",
    fontSize: 14,
    textAlign: "center",
  },

  badge: {
    display: "inline-block",
    padding: "5px 9px",
    borderRadius: 20,
    fontWeight: 700,
    fontSize: 12,
  },

  refusalReason: {
    marginTop: 6,
    fontSize: 12,
    color: "#a51d1d",
    background: "#fdecec",
    border: "1px solid #f2caca",
    borderRadius: 7,
    padding: "6px 8px",
    textAlign: "left",
  },
  transmissionBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
  },
  transmissionOui: {
    background: "#e8f7ed",
    color: "#19713c",
  },
  transmissionNon: {
    background: "#f3f3f3",
    color: "#777",
  },
  transmissionDate: {
    marginTop: 4,
    fontSize: 10,
    color: "#888",
  },

  deleteButton: {
    border: 0,
    background: "transparent",
    color: rouge,
    fontSize: 25,
    fontWeight: 800,
    cursor: "pointer",
    lineHeight: 1,
  },

  alert: {
    background: "#fdecec",
    color: "#a51d1d",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },

  success: {
    background: "#e7f6ec",
    color: "#18713b",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },

  secondary: {
    border:
      "1px solid #ddd",
    borderRadius: 8,
    padding: "10px 14px",
    background: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
};
