"use client";

import { useState } from "react";

type Profil = {
  id: number;
  nom: string;
  lundi: number;
  mardi: number;
  mercredi: number;
  jeudi: number;
  vendredi: number;
  actif: boolean;
};

const profilsInitiaux: Profil[] = [
  {
    id: 1,
    nom: "Bureau 35h",
    lundi: 7.5,
    mardi: 7.5,
    mercredi: 7.5,
    jeudi: 7.5,
    vendredi: 5,
    actif: true,
  },
  {
    id: 2,
    nom: "Client 37,5h - 8/8/8/8/5,5",
    lundi: 8,
    mardi: 8,
    mercredi: 8,
    jeudi: 8,
    vendredi: 5.5,
    actif: true,
  },
  {
    id: 3,
    nom: "Client 37,5h - 7,5/7,5/7,5/7,5/7,5",
    lundi: 7.5,
    mardi: 7.5,
    mercredi: 7.5,
    jeudi: 7.5,
    vendredi: 7.5,
    actif: true,
  },
];

function formatHeures(heures: number) {
  const heuresEntieres = Math.floor(heures);
  const minutes = Math.round((heures - heuresEntieres) * 60);

  if (minutes === 0) {
    return `${heuresEntieres} h`;
  }

  return `${heuresEntieres} h ${minutes.toString().padStart(2, "0")}`;
}

export default function ProfilsHorairesPage() {
  const [profils, setProfils] = useState(profilsInitiaux);
  const [edition, setEdition] = useState<number | null>(null);

  function modifierProfil(
    id: number,
    champ: keyof Profil,
    valeur: string | number | boolean
  ) {
    setProfils((anciens) =>
      anciens.map((profil) =>
        profil.id === id
          ? {
              ...profil,
              [champ]:
                typeof profil[champ] === "number"
                  ? Number(valeur)
                  : valeur,
            }
          : profil
      )
    );
  }

  function total(profil: Profil) {
    return (
      profil.lundi +
      profil.mardi +
      profil.mercredi +
      profil.jeudi +
      profil.vendredi
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 font-calibri">
      {/* En-tête POLYNOV */}
      <header className="border-b-4 border-polynov-red bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <div>
            <div className="text-3xl font-bold tracking-tight text-polynov-red">
              POLYNOV
            </div>

            <div className="text-sm text-gray-500">
              Bureau d'études mécaniques
            </div>
          </div>

          <div className="text-right">
            <div className="text-xl font-semibold text-gray-800">
              Administration
            </div>

            <div className="text-sm text-gray-500">
              Gestion des profils horaires
            </div>
          </div>
        </div>
      </header>

      {/* Contenu */}
      <section className="mx-auto max-w-7xl px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            Profils horaires
          </h1>

          <p className="mt-2 text-gray-500">
            Définissez les horaires théoriques utilisés pour calculer le temps
            de travail des collaborateurs.
          </p>
        </div>

        {/* Tableau */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-5 py-4 text-left text-sm font-semibold text-gray-700">
                  Profil
                </th>

                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700">
                  Lundi
                </th>

                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700">
                  Mardi
                </th>

                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700">
                  Mercredi
                </th>

                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700">
                  Jeudi
                </th>

                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700">
                  Vendredi
                </th>

                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700">
                  Total
                </th>

                <th className="px-5 py-4 text-center text-sm font-semibold text-gray-700">
                  Statut
                </th>

                <th className="px-5 py-4 text-right text-sm font-semibold text-gray-700">
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {profils.map((profil) => (
                <tr
                  key={profil.id}
                  className="border-b border-gray-100 last:border-0"
                >
                  {/* Nom */}
                  <td className="px-5 py-5">
                    {edition === profil.id ? (
                      <input
                        type="text"
                        value={profil.nom}
                        onChange={(e) =>
                          modifierProfil(profil.id, "nom", e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-polynov-red"
                      />
                    ) : (
                      <div className="font-semibold text-gray-800">
                        {profil.nom}
                      </div>
                    )}
                  </td>

                  {/* Heures */}
                  {(
                    [
                      "lundi",
                      "mardi",
                      "mercredi",
                      "jeudi",
                      "vendredi",
                    ] as const
                  ).map((jour) => (
                    <td key={jour} className="px-3 py-5 text-center">
                      {edition === profil.id ? (
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={profil[jour]}
                          onChange={(e) =>
                            modifierProfil(
                              profil.id,
                              jour,
                              Number(e.target.value)
                            )
                          }
                          className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-center outline-none focus:border-polynov-red"
                        />
                      ) : (
                        <span className="text-gray-700">
                          {formatHeures(profil[jour])}
                        </span>
                      )}
                    </td>
                  ))}

                  {/* Total */}
                  <td className="px-4 py-5 text-center">
                    <span className="font-bold text-polynov-red">
                      {formatHeures(total(profil))}
                    </span>
                  </td>

                  {/* Statut */}
                  <td className="px-5 py-5 text-center">
                    <button
                      onClick={() =>
                        modifierProfil(
                          profil.id,
                          "actif",
                          !profil.actif
                        )
                      }
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        profil.actif
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {profil.actif ? "Actif" : "Inactif"}
                    </button>
                  </td>

                  {/* Action */}
                  <td className="px-5 py-5 text-right">
                    <button
                      onClick={() =>
                        setEdition(
                          edition === profil.id ? null : profil.id
                        )
                      }
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-polynov-red hover:text-polynov-red"
                    >
                      {edition === profil.id ? "Terminer" : "Modifier"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Information */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <div className="font-semibold text-gray-800">
            ℹ️ Fonctionnement
          </div>

          <p className="mt-2 text-sm text-gray-500">
            Les heures sont exprimées en heures décimales. Par exemple,
            7,5 h correspond à 7 h 30.
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Le total hebdomadaire est calculé automatiquement à partir des
            horaires du lundi au vendredi.
          </p>
        </div>
      </section>
    </main>
  );
}