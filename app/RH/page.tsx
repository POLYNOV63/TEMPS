"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

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
  justificatif_nom: string | null;
  justificatif_url: string | null;
  statut: string;
  created_at: string;
  validateur_id: string | null;
  date_validation: string | null;
  signature_demandeur: string | null;
  signature_validateur: string | null;
};

const rouge = "#c00000";
const MAX_COMPTEUR = 30;

function exerciceActuel() {
  const d = new Date();
  return d.getMonth() >= 10
    ? d.getFullYear()
    : d.getFullYear() - 1;
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  });
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

function joursOuvresInclusifs(
  debut: string,
  fin: string
) {
  if (!debut || !fin) return 0;

  const d1 = new Date(`${debut}T00:00:00`);
  const d2 = new Date(`${fin}T00:00:00`);

  if (d2 < d1) return 0;

  let total = 0;
  const courant = new Date(d1);

  while (courant <= d2) {
    const jour = courant.getDay();

    if (jour !== 0 && jour !== 6) {
      total += 1;
    }

    courant.setDate(courant.getDate() + 1);
  }

  return total;
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

  const [demiJourneeFin, setDemiJourneeFin] =
    useState(false);

  const [dureeRTT, setDureeRTT] =
    useState<0.5 | 1>(1);

  const [heuresRE, setHeuresRE] =
    useState("");

  const [commentaire, setCommentaire] =
    useState("");

  const [fichier, setFichier] =
    useState<File | null>(null);

  const [envoi, setEnvoi] =
    useState(false);

  const exercice = exerciceActuel();

  async function charger() {
    setChargement(true);
    setErreur("");

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
            "id,exercice,type_demande,date_debut,date_fin,duree_jours,heures_re,commentaire,justificatif_nom,justificatif_url,statut,created_at,validateur_id,date_validation,signature_demandeur,signature_validateur"
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
      setErreur(
        e?.message ||
          "Impossible de charger votre espace RH."
      );
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    charger();
  }, []);

  const prisesCP = useMemo(
    () =>
      demandes
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
    [demandes]
  );

  const attenteCP = useMemo(
    () =>
      demandes
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
    [demandes]
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
      demandes
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
    [demandes]
  );

  const attenteRTT = useMemo(
    () =>
      demandes
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
    [demandes]
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

  const dureeCPCalculee = useMemo(() => {
    if (!estCP(type)) return 0;

    const jours = joursOuvresInclusifs(
      dateDebut,
      dateFin
    );

    if (!jours) return 0;

    return Math.max(
      0.5,
      jours -
        (demiJourneeFin ? 0.5 : 0)
    );
  }, [
    type,
    dateDebut,
    dateFin,
    demiJourneeFin,
  ]);

  function reinitialiserDatesPourType(
    nouveauType: string
  ) {
    setType(nouveauType);
    setDemiJourneeFin(false);

    if (nouveauType === "RE") {
      setDateFin("");
    } else if (
      nouveauType === "CP" ||
      nouveauType.startsWith("CP_EXCEPTIONNEL")
    ) {
      if (dateDebut) {
        setDateFin(
          dateFin || dateDebut
        );
      }
    }
  }

  async function supprimerDemande(
    d: Demande
  ) {
    if (d.statut !== "EN_ATTENTE") return;

    if (
      !window.confirm(
        "Supprimer cette demande ? Cette action est définitive."
      )
    ) {
      return;
    }

    setErreur("");

    const { error } =
      await supabase
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

    if (
      estCP(type) &&
      !dateFin
    ) {
      setErreur(
        "Veuillez renseigner une date de fin de CP."
      );
      return;
    }

    if (
      estCP(type) &&
      dateFin < dateDebut
    ) {
      setErreur(
        "La date de fin ne peut pas être antérieure à la date de début."
      );
      return;
    }

    if (
      estCP(type) &&
      dureeCPCalculee <= 0
    ) {
      setErreur(
        "La période sélectionnée ne contient aucun jour ouvré."
      );
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

    const dureeDemandee = estCP(type)
      ? dureeCPCalculee
      : type === "RE"
        ? 1
        : dureeRTT;

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
      estCP(type)
        ? `${dateFR(dateDebut)} → ${dateFR(
            dateFin
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
              estCP(type)
                ? dateFin
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
        <div style={styles.card}>
          <strong>Erreur</strong>
          <p>{erreur}</p>

          <button
            style={styles.secondary}
            onClick={() =>
              (window.location.href =
                "/dashboard")
            }
          >
            ← Retour au tableau de bord
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>
            POLYNOV · ESPACE COLLABORATEUR
          </div>

          <h1 style={styles.h1}>
            Mon espace RH
          </h1>

          <div>
            {collab?.prenom}{" "}
            {collab?.nom} ·{" "}
            {collab?.trigramme}
          </div>
        </div>

        <button
          style={styles.headerButton}
          onClick={() =>
            (window.location.href =
              "/dashboard")
          }
        >
          ← Retour au tableau de bord
        </button>
      </header>

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

            <Field
              label={
                estCP(type)
                  ? "Date de début CP"
                  : "Date"
              }
            >
              <input
                type="date"
                style={styles.input}
                value={dateDebut}
                onChange={(e) => {
                  const value =
                    e.target.value;

                  setDateDebut(value);

                  if (
                    estCP(type) &&
                    (!dateFin ||
                      dateFin <
                        value)
                  ) {
                    setDateFin(value);
                  }
                }}
                required
              />
            </Field>

            {estCP(type) && (
              <Field label="Date de fin CP (incluse)">
                <input
                  type="date"
                  style={styles.input}
                  min={dateDebut || undefined}
                  value={dateFin}
                  onChange={(e) =>
                    setDateFin(
                      e.target.value
                    )
                  }
                  required
                />
              </Field>
            )}

            {estCP(type) && (
              <Field label="Fin de période">
                <select
                  style={styles.input}
                  value={
                    demiJourneeFin
                      ? "0.5"
                      : "1"
                  }
                  onChange={(e) =>
                    setDemiJourneeFin(
                      e.target.value ===
                        "0.5"
                    )
                  }
                >
                  <option value="1">
                    Dernier jour entier
                  </option>

                  <option value="0.5">
                    Dernier jour en ½
                    journée
                  </option>
                </select>
              </Field>
            )}

            {estCP(type) && (
              <div
                style={
                  styles.durationPreview
                }
              >
                <span>
                  Durée calculée
                </span>

                <strong>
                  {fmt(
                    dureeCPCalculee
                  )}{" "}
                  jour
                  {dureeCPCalculee >
                  1
                    ? "s"
                    : ""}
                </strong>

                <small>
                  Jours ouvrés
                  uniquement
                </small>
              </div>
            )}

            {type === "RTT" && (
              <Field label="Durée">
                <select
                  style={styles.input}
                  value={dureeRTT}
                  onChange={(e) =>
                    setDureeRTT(
                      Number(
                        e.target.value
                      ) as 0.5 | 1
                    )
                  }
                >
                  <option value="1">
                    Journée
                  </option>

                  <option value="0.5">
                    ½ journée
                  </option>
                </select>
              </Field>
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

            <Field label="Commentaire">
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
                      {d.statut ===
                      "EN_ATTENTE" ? (
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
