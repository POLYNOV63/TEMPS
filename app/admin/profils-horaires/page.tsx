"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   TYPES
================================================================ */

type Profil = {
  id: string;
  nom: string;
  lundi: number;
  mardi: number;
  mercredi: number;
  jeudi: number;
  vendredi: number;
  total_hebdomadaire: number | null;
  actif: boolean;
};

type JourCode =
  | "lundi"
  | "mardi"
  | "mercredi"
  | "jeudi"
  | "vendredi";

const jours: {
  code: JourCode;
  libelle: string;
  court: string;
}[] = [
  {
    code: "lundi",
    libelle: "Lundi",
    court: "Lun.",
  },
  {
    code: "mardi",
    libelle: "Mardi",
    court: "Mar.",
  },
  {
    code: "mercredi",
    libelle: "Mercredi",
    court: "Mer.",
  },
  {
    code: "jeudi",
    libelle: "Jeudi",
    court: "Jeu.",
  },
  {
    code: "vendredi",
    libelle: "Vendredi",
    court: "Ven.",
  },
];

/* ===============================================================
   UTILITAIRES
================================================================ */

function totalProfil(profil: Profil) {
  return (
    Number(profil.lundi || 0) +
    Number(profil.mardi || 0) +
    Number(profil.mercredi || 0) +
    Number(profil.jeudi || 0) +
    Number(profil.vendredi || 0)
  );
}

function formatHeures(heures: number | null | undefined) {
  const valeur = Number(heures ?? 0);

  if (Number.isNaN(valeur)) {
    return "0 h";
  }

  const heuresEntieres = Math.floor(valeur);
  const minutes = Math.round(
    (valeur - heuresEntieres) * 60
  );

  if (minutes === 0) {
    return `${heuresEntieres} h`;
  }

  if (heuresEntieres === 0) {
    return `${minutes} min`;
  }

  return `${heuresEntieres} h ${String(minutes).padStart(
    2,
    "0"
  )}`;
}

function formatDecimal(heures: number) {
  return Number(heures).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/* ===============================================================
   PAGE
================================================================ */

export default function ProfilsHorairesPage() {
  const router = useRouter();

  const [profils, setProfils] = useState<Profil[]>([]);
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] =
    useState<string | null>(null);

  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  const [edition, setEdition] = useState<string | null>(null);

  const [nouveauProfil, setNouveauProfil] = useState(false);

  const [nomNouveau, setNomNouveau] = useState("");
  const [heuresNouveau, setHeuresNouveau] =
    useState<Record<JourCode, number>>({
      lundi: 7.5,
      mardi: 7.5,
      mercredi: 7.5,
      jeudi: 7.5,
      vendredi: 5,
    });

  /* =============================================================
     CHARGEMENT
  ============================================================= */

  useEffect(() => {
    chargerProfils();
  }, []);

  async function chargerProfils() {
    try {
      setChargement(true);
      setErreur("");

      const { data, error } = await supabase
        .from("profils_horaires")
        .select(
          `
            id,
            nom,
            lundi,
            mardi,
            mercredi,
            jeudi,
            vendredi,
            total_hebdomadaire,
            actif
          `
        )
        .order("actif", {
          ascending: false,
        })
        .order("nom", {
          ascending: true,
        });

      if (error) {
        console.error(
          "Erreur chargement profils horaires :",
          error
        );

        throw error;
      }

      setProfils(
        (data ?? []).map((profil) => ({
          ...profil,
          lundi: Number(profil.lundi ?? 0),
          mardi: Number(profil.mardi ?? 0),
          mercredi: Number(profil.mercredi ?? 0),
          jeudi: Number(profil.jeudi ?? 0),
          vendredi: Number(profil.vendredi ?? 0),
          total_hebdomadaire:
            profil.total_hebdomadaire === null
              ? null
              : Number(
                  profil.total_hebdomadaire
                ),
        }))
      );
    } catch (error) {
      console.error(error);

      setErreur(
        "Impossible de charger les profils horaires."
      );
    } finally {
      setChargement(false);
    }
  }

  /* =============================================================
     MODIFICATION LOCALE
  ============================================================= */

  function modifierProfil(
    id: string,
    champ: keyof Profil,
    valeur: string | number | boolean
  ) {
    setProfils((anciens) =>
      anciens.map((profil) =>
        profil.id === id
          ? {
              ...profil,
              [champ]: valeur,
            }
          : profil
      )
    );
  }

  /* =============================================================
     ENREGISTRER UN PROFIL EXISTANT
  ============================================================= */

  async function enregistrerProfil(
    profil: Profil
  ) {
    try {
      setErreur("");
      setMessage("");
      setEnregistrement(profil.id);

      const total = totalProfil(profil);

      const { error } = await supabase
        .from("profils_horaires")
        .update({
          nom: profil.nom.trim(),
          lundi: Number(profil.lundi),
          mardi: Number(profil.mardi),
          mercredi: Number(profil.mercredi),
          jeudi: Number(profil.jeudi),
          vendredi: Number(profil.vendredi),
          total_hebdomadaire: total,
          actif: profil.actif,
        })
        .eq("id", profil.id);

      if (error) {
        console.error(
          "Erreur enregistrement profil :",
          error
        );

        throw error;
      }

      setProfils((anciens) =>
        anciens.map((p) =>
          p.id === profil.id
            ? {
                ...profil,
                total_hebdomadaire: total,
              }
            : p
        )
      );

      setEdition(null);
      setMessage(
        `Profil « ${profil.nom} » enregistré.`
      );
    } catch (error) {
      console.error(error);

      setErreur(
        "Impossible d'enregistrer le profil horaire."
      );
    } finally {
      setEnregistrement(null);
    }
  }

  /* =============================================================
     NOUVEAU PROFIL
  ============================================================= */

  function modifierHeureNouveau(
    jour: JourCode,
    valeur: string
  ) {
    setHeuresNouveau((ancien) => ({
      ...ancien,
      [jour]: Number(valeur),
    }));
  }

  const totalNouveau = useMemo(() => {
    return (
      Number(heuresNouveau.lundi || 0) +
      Number(heuresNouveau.mardi || 0) +
      Number(heuresNouveau.mercredi || 0) +
      Number(heuresNouveau.jeudi || 0) +
      Number(heuresNouveau.vendredi || 0)
    );
  }, [heuresNouveau]);

  async function creerProfil() {
    try {
      setErreur("");
      setMessage("");

      const nom = nomNouveau.trim();

      if (!nom) {
        setErreur(
          "Veuillez renseigner le nom du profil."
        );
        return;
      }

      if (totalNouveau <= 0) {
        setErreur(
          "Le total hebdomadaire doit être supérieur à 0."
        );
        return;
      }

      setEnregistrement("nouveau");

      const { data, error } = await supabase
        .from("profils_horaires")
        .insert({
          nom,
          lundi: Number(heuresNouveau.lundi),
          mardi: Number(heuresNouveau.mardi),
          mercredi: Number(
            heuresNouveau.mercredi
          ),
          jeudi: Number(heuresNouveau.jeudi),
          vendredi: Number(
            heuresNouveau.vendredi
          ),
          total_hebdomadaire: totalNouveau,
          actif: true,
        })
        .select(
          `
            id,
            nom,
            lundi,
            mardi,
            mercredi,
            jeudi,
            vendredi,
            total_hebdomadaire,
            actif
          `
        )
        .single();

      if (error || !data) {
        console.error(
          "Erreur création profil :",
          error
        );

        throw error;
      }

      const profil: Profil = {
        ...data,
        lundi: Number(data.lundi ?? 0),
        mardi: Number(data.mardi ?? 0),
        mercredi: Number(
          data.mercredi ?? 0
        ),
        jeudi: Number(data.jeudi ?? 0),
        vendredi: Number(
          data.vendredi ?? 0
        ),
        total_hebdomadaire:
          Number(
            data.total_hebdomadaire ??
              totalNouveau
          ),
      };

      setProfils((anciens) =>
        [...anciens, profil].sort((a, b) => {
          if (a.actif !== b.actif) {
            return a.actif ? -1 : 1;
          }

          return a.nom.localeCompare(
            b.nom,
            "fr"
          );
        })
      );

      setNomNouveau("");

      setHeuresNouveau({
        lundi: 7.5,
        mardi: 7.5,
        mercredi: 7.5,
        jeudi: 7.5,
        vendredi: 5,
      });

      setNouveauProfil(false);

      setMessage(
        `Profil « ${nom} » créé avec succès.`
      );
    } catch (error) {
      console.error(error);

      setErreur(
        "Impossible de créer le profil horaire."
      );
    } finally {
      setEnregistrement(null);
    }
  }

  /* =============================================================
     ACTIVER / DESACTIVER
  ============================================================= */

  async function basculerActif(
    profil: Profil
  ) {
    try {
      setErreur("");
      setMessage("");
      setEnregistrement(profil.id);

      const nouvelEtat = !profil.actif;

      const { error } = await supabase
        .from("profils_horaires")
        .update({
          actif: nouvelEtat,
        })
        .eq("id", profil.id);

      if (error) {
        console.error(
          "Erreur changement statut profil :",
          error
        );

        throw error;
      }

      setProfils((anciens) =>
        anciens
          .map((p) =>
            p.id === profil.id
              ? {
                  ...p,
                  actif: nouvelEtat,
                }
              : p
          )
          .sort((a, b) => {
            if (a.actif !== b.actif) {
              return a.actif ? -1 : 1;
            }

            return a.nom.localeCompare(
              b.nom,
              "fr"
            );
          })
      );

      setMessage(
        nouvelEtat
          ? `Profil « ${profil.nom} » activé.`
          : `Profil « ${profil.nom} » désactivé.`
      );
    } catch (error) {
      console.error(error);

      setErreur(
        "Impossible de modifier le statut du profil."
      );
    } finally {
      setEnregistrement(null);
    }
  }

  /* =============================================================
     STATISTIQUES
  ============================================================= */

  const statistiques = useMemo(() => {
    const actifs = profils.filter(
      (p) => p.actif
    );

    const inactifs = profils.filter(
      (p) => !p.actif
    );

    const total35 = profils.filter(
      (p) =>
        Math.abs(
          totalProfil(p) - 35
        ) < 0.01
    ).length;

    const total375 = profils.filter(
      (p) =>
        Math.abs(
          totalProfil(p) - 37.5
        ) < 0.01
    ).length;

    return {
      total: profils.length,
      actifs: actifs.length,
      inactifs: inactifs.length,
      total35,
      total375,
    };
  }, [profils]);

  /* =============================================================
     CHARGEMENT
  ============================================================= */

  if (chargement) {
    return (
      <main className="min-h-screen bg-gray-50 font-calibri">
        <header className="border-b-4 border-[#c00000] bg-white">
          <div className="mx-auto max-w-7xl px-8 py-6">
            <div className="text-3xl font-bold text-[#c00000]">
              POLYNOV
            </div>

            <div className="mt-1 text-sm text-gray-500">
              Administration · Profils horaires
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-8 py-16 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#c00000]" />

          <div className="font-semibold text-gray-700">
            Chargement des profils horaires…
          </div>
        </div>
      </main>
    );
  }

  /* =============================================================
     RENDU
  ============================================================= */

  return (
    <main className="min-h-screen bg-[#f5f5f5] font-calibri text-gray-800">
      {/* =========================================================
          HEADER
      ========================================================= */}

      <header className="border-b-4 border-[#c00000] bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-8 py-5">
          <div>
            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-[#c00000] transition hover:bg-red-100"
            >
              ← Tableau de bord
            </button>

            <div className="text-3xl font-extrabold tracking-tight text-[#c00000]">
              POLYNOV
            </div>

            <div className="mt-1 text-sm text-gray-500">
              Bureau d'études mécaniques
            </div>
          </div>

          <div className="hidden text-right sm:block">
            <div className="text-xl font-bold text-gray-800">
              Administration
            </div>

            <div className="mt-1 text-sm text-gray-500">
              Profils horaires
            </div>
          </div>
        </div>
      </header>

      {/* =========================================================
          CONTENU
      ========================================================= */}

      <section className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
        {/* Titre */}

        <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#c00000]">
              ⏰ Paramétrage
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
              Profils horaires
            </h1>

            <p className="mt-2 max-w-2xl text-gray-500">
              Gérez les horaires théoriques utilisés
              pour calculer le temps de travail des
              collaborateurs.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setNouveauProfil(
                !nouveauProfil
              );
              setErreur("");
              setMessage("");
            }}
            className="rounded-xl bg-[#c00000] px-5 py-3 font-bold text-white shadow-sm transition hover:bg-[#a80000]"
          >
            {nouveauProfil
              ? "✕ Fermer"
              : "+ Nouveau profil"}
          </button>
        </div>

        {/* =======================================================
            MESSAGES
        ======================================================= */}

        {erreur && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border-l-4 border-[#c00000] bg-white p-4 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 font-bold text-[#c00000]">
              !
            </div>

            <div>
              <div className="font-bold text-gray-800">
                Une erreur est survenue
              </div>

              <div className="mt-1 text-sm text-gray-600">
                {erreur}
              </div>
            </div>
          </div>
        )}

        {message && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border-l-4 border-green-600 bg-white p-4 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 font-bold text-green-700">
              ✓
            </div>

            <div className="text-sm font-semibold text-gray-700">
              {message}
            </div>
          </div>
        )}

        {/* =======================================================
            NOUVEAU PROFIL
        ======================================================= */}

        {nouveauProfil && (
          <div className="mb-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b bg-gradient-to-r from-red-50 to-white px-6 py-5">
              <div className="text-lg font-extrabold text-gray-900">
                Nouveau profil horaire
              </div>

              <div className="mt-1 text-sm text-gray-500">
                Créez un profil directement dans
                la table{" "}
                <strong>
                  profils_horaires
                </strong>
                .
              </div>
            </div>

            <div className="p-6">
              <div className="mb-5">
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Nom du profil
                </label>

                <input
                  value={nomNouveau}
                  onChange={(e) =>
                    setNomNouveau(
                      e.target.value
                    )
                  }
                  placeholder="Ex. Bureau 35h"
                  className="w-full max-w-xl rounded-xl border border-gray-300 px-4 py-3 outline-none transition focus:border-[#c00000] focus:ring-2 focus:ring-red-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {jours.map((jour) => (
                  <div key={jour.code}>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-500">
                      {jour.libelle}
                    </label>

                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      value={
                        heuresNouveau[
                          jour.code
                        ]
                      }
                      onChange={(e) =>
                        modifierHeureNouveau(
                          jour.code,
                          e.target.value
                        )
                      }
                      className="w-full rounded-xl border border-gray-300 px-3 py-3 text-center font-semibold outline-none transition focus:border-[#c00000] focus:ring-2 focus:ring-red-100"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-xl bg-gray-50 p-4 sm:flex-row sm:items-center">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
                    Total hebdomadaire
                  </div>

                  <div className="mt-1 text-2xl font-extrabold text-[#c00000]">
                    {formatHeures(
                      totalNouveau
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={
                    enregistrement ===
                    "nouveau"
                  }
                  onClick={creerProfil}
                  className="rounded-xl bg-[#c00000] px-6 py-3 font-bold text-white transition hover:bg-[#a80000] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enregistrement ===
                  "nouveau"
                    ? "Création…"
                    : "Créer le profil"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =======================================================
            KPI
        ======================================================= */}

        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi
            valeur={statistiques.total}
            label="Profils"
            icon="⏰"
          />

          <Kpi
            valeur={statistiques.actifs}
            label="Profils actifs"
            icon="✓"
            vert
          />

          <Kpi
            valeur={statistiques.total35}
            label="Profils à 35 h"
            icon="35"
          />

          <Kpi
            valeur={statistiques.total375}
            label="Profils à 37,5 h"
            icon="37,5"
          />
        </div>

        {/* =======================================================
            TABLEAU
        ======================================================= */}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-3 border-b px-6 py-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-extrabold text-gray-900">
                Profils enregistrés
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Les profils actifs sont utilisés
                pour les horaires théoriques.
              </p>
            </div>

            <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
              {profils.length} profil
              {profils.length > 1
                ? "s"
                : ""}
            </div>
          </div>

          {/* Desktop */}

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-6 py-4 text-left">
                    Profil
                  </th>

                  {jours.map((jour) => (
                    <th
                      key={jour.code}
                      className="px-3 py-4 text-center"
                    >
                      {jour.court}
                    </th>
                  ))}

                  <th className="px-4 py-4 text-center">
                    Total
                  </th>

                  <th className="px-4 py-4 text-center">
                    Statut
                  </th>

                  <th className="px-6 py-4 text-right">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {profils.map(
                  (profil) => {
                    const enEdition =
                      edition ===
                      profil.id;

                    const total =
                      totalProfil(
                        profil
                      );

                    return (
                      <tr
                        key={
                          profil.id
                        }
                        className={`border-b last:border-0 ${
                          !profil.actif
                            ? "bg-gray-50/70"
                            : "bg-white"
                        }`}
                      >
                        {/* Profil */}

                        <td className="px-6 py-5">
                          {enEdition ? (
                            <input
                              value={
                                profil.nom
                              }
                              onChange={(
                                e
                              ) =>
                                modifierProfil(
                                  profil.id,
                                  "nom",
                                  e.target
                                    .value
                                )
                              }
                              className="w-full min-w-[220px] rounded-lg border border-gray-300 px-3 py-2 font-semibold outline-none focus:border-[#c00000] focus:ring-2 focus:ring-red-100"
                            />
                          ) : (
                            <div>
                              <div
                                className={`font-bold ${
                                  profil.actif
                                    ? "text-gray-900"
                                    : "text-gray-400"
                                }`}
                              >
                                {
                                  profil.nom
                                }
                              </div>

                              <div className="mt-1 text-xs text-gray-400">
                                ID :{" "}
                                {profil.id.slice(
                                  0,
                                  8
                                )}
                                …
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Jours */}

                        {jours.map(
                          (jour) => (
                            <td
                              key={
                                jour.code
                              }
                              className="px-2 py-5 text-center"
                            >
                              {enEdition ? (
                                <input
                                  type="number"
                                  min="0"
                                  max="24"
                                  step="0.5"
                                  value={
                                    profil[
                                      jour
                                        .code
                                    ]
                                  }
                                  onChange={(
                                    e
                                  ) =>
                                    modifierProfil(
                                      profil.id,
                                      jour.code,
                                      Number(
                                        e
                                          .target
                                          .value
                                      )
                                    )
                                  }
                                  className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-center outline-none focus:border-[#c00000] focus:ring-2 focus:ring-red-100"
                                />
                              ) : (
                                <span
                                  className={
                                    profil.actif
                                      ? "font-semibold text-gray-700"
                                      : "text-gray-400"
                                  }
                                >
                                  {formatDecimal(
                                    profil[
                                      jour
                                        .code
                                    ]
                                  )}
                                </span>
                              )}
                            </td>
                          )
                        )}

                        {/* Total */}

                        <td className="px-4 py-5 text-center">
                          <span
                            className={`inline-flex rounded-lg px-3 py-2 text-sm font-extrabold ${
                              total === 35
                                ? "bg-red-50 text-[#c00000]"
                                : total ===
                                  37.5
                                ? "bg-orange-50 text-orange-700"
                                : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {formatHeures(
                              total
                            )}
                          </span>
                        </td>

                        {/* Statut */}

                        <td className="px-4 py-5 text-center">
                          <button
                            type="button"
                            disabled={
                              enregistrement ===
                              profil.id
                            }
                            onClick={() =>
                              basculerActif(
                                profil
                              )
                            }
                            className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                              profil.actif
                                ? "bg-green-100 text-green-700 hover:bg-green-200"
                                : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                            }`}
                          >
                            {profil.actif
                              ? "✓ Actif"
                              : "Inactif"}
                          </button>
                        </td>

                        {/* Action */}

                        <td className="px-6 py-5 text-right">
                          {enEdition ? (
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setEdition(
                                    null
                                  )
                                }
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                              >
                                Annuler
                              </button>

                              <button
                                type="button"
                                disabled={
                                  enregistrement ===
                                  profil.id
                                }
                                onClick={() =>
                                  enregistrerProfil(
                                    profil
                                  )
                                }
                                className="rounded-lg bg-[#c00000] px-4 py-2 text-sm font-bold text-white hover:bg-[#a80000] disabled:opacity-50"
                              >
                                {enregistrement ===
                                profil.id
                                  ? "Enregistrement…"
                                  : "Enregistrer"}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setEdition(
                                  profil.id
                                )
                              }
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 transition hover:border-[#c00000] hover:text-[#c00000]"
                            >
                              Modifier
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }
                )}

                {profils.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={
                        9
                      }
                      className="px-6 py-16 text-center"
                    >
                      <div className="text-4xl">
                        ⏰
                      </div>

                      <div className="mt-3 font-bold text-gray-800">
                        Aucun profil
                        horaire
                      </div>

                      <div className="mt-1 text-sm text-gray-500">
                        Créez votre
                        premier
                        profil avec
                        le bouton
                        « Nouveau
                        profil ».
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* =====================================================
              MOBILE
          ===================================================== */}

          <div className="divide-y md:hidden">
            {profils.map(
              (profil) => {
                const enEdition =
                  edition ===
                  profil.id;

                const total =
                  totalProfil(
                    profil
                  );

                return (
                  <div
                    key={
                      profil.id
                    }
                    className={`p-5 ${
                      profil.actif
                        ? "bg-white"
                        : "bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {enEdition ? (
                          <input
                            value={
                              profil.nom
                            }
                            onChange={(
                              e
                            ) =>
                              modifierProfil(
                                profil.id,
                                "nom",
                                e.target
                                  .value
                              )
                            }
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-bold"
                          />
                        ) : (
                          <div className="font-extrabold text-gray-900">
                            {
                              profil.nom
                            }
                          </div>
                        )}

                        <div className="mt-1 text-xs text-gray-400">
                          {profil.actif
                            ? "Profil actif"
                            : "Profil inactif"}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          basculerActif(
                            profil
                          )
                        }
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                          profil.actif
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {profil.actif
                          ? "Actif"
                          : "Inactif"}
                      </button>
                    </div>

                    <div className="mt-5 grid grid-cols-5 gap-2">
                      {jours.map(
                        (jour) => (
                          <div
                            key={
                              jour.code
                            }
                            className="rounded-lg bg-gray-50 p-2 text-center"
                          >
                            <div className="text-[10px] font-bold uppercase text-gray-400">
                              {
                                jour.court
                              }
                            </div>

                            {enEdition ? (
                              <input
                                type="number"
                                min="0"
                                max="24"
                                step="0.5"
                                value={
                                  profil[
                                    jour
                                      .code
                                  ]
                                }
                                onChange={(
                                  e
                                ) =>
                                  modifierProfil(
                                    profil.id,
                                    jour.code,
                                    Number(
                                      e
                                        .target
                                        .value
                                    )
                                  )
                                }
                                className="mt-1 w-full rounded border px-1 py-1 text-center text-sm"
                              />
                            ) : (
                              <div className="mt-1 text-sm font-bold">
                                {formatDecimal(
                                  profil[
                                    jour
                                      .code
                                  ]
                                )}
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase text-gray-400">
                          Total
                        </div>

                        <div className="text-xl font-extrabold text-[#c00000]">
                          {formatHeures(
                            total
                          )}
                        </div>
                      </div>

                      {enEdition ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setEdition(
                                null
                              )
                            }
                            className="rounded-lg border px-3 py-2 text-sm font-semibold"
                          >
                            Annuler
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              enregistrerProfil(
                                profil
                              )
                            }
                            className="rounded-lg bg-[#c00000] px-3 py-2 text-sm font-bold text-white"
                          >
                            Enregistrer
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setEdition(
                              profil.id
                            )
                          }
                          className="rounded-lg border px-4 py-2 text-sm font-bold hover:border-[#c00000] hover:text-[#c00000]"
                        >
                          Modifier
                        </button>
                      )}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* =======================================================
            INFORMATION
        ======================================================= */}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-lg">
                ⏱️
              </div>

              <div>
                <div className="font-bold text-gray-800">
                  Heures décimales
                </div>

                <p className="mt-1 text-sm leading-6 text-gray-500">
                  Les horaires sont saisis en
                  heures décimales :
                  <strong>
                    {" "}
                    7,5 = 7 h 30
                  </strong>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-lg">
                ✓
              </div>

              <div>
                <div className="font-bold text-gray-800">
                  Profils actifs
                </div>

                <p className="mt-1 text-sm leading-6 text-gray-500">
                  Un profil désactivé reste en
                  base afin de préserver
                  l'historique des
                  collaborateurs qui l'ont
                  utilisé.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ===============================================================
   KPI
================================================================ */

function Kpi({
  valeur,
  label,
  icon,
  vert = false,
}: {
  valeur: number | string;
  label: string;
  icon: string;
  vert?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div
        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl text-sm font-extrabold ${
          vert
            ? "bg-green-50 text-green-700"
            : "bg-red-50 text-[#c00000]"
        }`}
      >
        {icon}
      </div>

      <div className="text-2xl font-extrabold text-gray-900">
        {valeur}
      </div>

      <div className="mt-1 text-xs font-semibold text-gray-500">
        {label}
      </div>
    </div>
  );
}