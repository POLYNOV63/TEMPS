"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

const jours = [
  ["lundi", "Lundi"],
  ["mardi", "Mardi"],
  ["mercredi", "Mercredi"],
  ["jeudi", "Jeudi"],
  ["vendredi", "Vendredi"],
] as const;

function formatHeures(heures: number) {
  const heuresEntieres = Math.floor(heures);
  const minutes = Math.round((heures - heuresEntieres) * 60);

  if (minutes === 0) {
    return `${heuresEntieres} h`;
  }

  return `${heuresEntieres} h ${minutes
    .toString()
    .padStart(2, "0")}`;
}

export default function ProfilsHorairesPage() {
 const router = useRouter();
  const [profils, setProfils] = useState(profilsInitiaux);
  const [edition, setEdition] = useState<number | null>(null);

  function total(profil: Profil) {
    return (
      profil.lundi +
      profil.mardi +
      profil.mercredi +
      profil.jeudi +
      profil.vendredi
    );
  }

  function modifier(
    id: number,
    champ: keyof Profil,
    valeur: string | number | boolean
  ) {
    setProfils((anciens) =>
      anciens.map((profil) =>
        profil.id === id
          ? { ...profil, [champ]: valeur }
          : profil
      )
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 font-calibri">
      {/* En-tête */}
      <header className="border-b-4 border-polynov-red bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <div>
  <button
    onClick={() =>
      router.push("/dashboard")
    }
    className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-polynov-red hover:bg-red-100"
  >
    🏠 Retour au tableau de bord
  </button>

  <div className="text-3xl font-bold text-polynov-red">
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
              Profils horaires
            </div>
          </div>
        </div>
      </header>

      {/* Contenu */}
      <section className="mx-auto max-w-7xl px-8 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">
              Profils horaires
            </h1>

            <p className="mt-2 text-gray-500">
              Paramétrage des horaires théoriques des collaborateurs.
            </p>
          </div>

          <button className="rounded-lg bg-polynov-red px-5 py-3 font-semibold text-white hover:bg-polynov-dark">
            + Nouveau profil
          </button>
        </div>

        {/* Tableau */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-5 py-4 text-left">
                  Profil
                </th>

                {jours.map(([code, libelle]) => (
                  <th
                    key={code}
                    className="px-4 py-4 text-center"
                  >
                    {libelle}
                  </th>
                ))}

                <th className="px-4 py-4 text-center">
                  Total
                </th>

                <th className="px-4 py-4 text-center">
                  Statut
                </th>

                <th className="px-5 py-4 text-right">
                  Action
                </th>
              </tr>
            </thead>

            <tbody>
              {profils.map((profil) => (
                <tr
                  key={profil.id}
                  className="border-b last:border-0"
                >
                  <td className="px-5 py-5">
                    {edition === profil.id ? (
                      <input
                        value={profil.nom}
                        onChange={(e) =>
                          modifier(
                            profil.id,
                            "nom",
                            e.target.value
                          )
                        }
                        className="w-full rounded-lg border px-3 py-2"
                      />
                    ) : (
                      <span className="font-semibold text-gray-800">
                        {profil.nom}
                      </span>
                    )}
                  </td>

                  {jours.map(([code]) => (
                    <td
                      key={code}
                      className="px-3 py-5 text-center"
                    >
                      {edition === profil.id ? (
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={profil[code]}
                          onChange={(e) =>
                            modifier(
                              profil.id,
                              code,
                              Number(e.target.value)
                            )
                          }
                          className="w-20 rounded-lg border px-2 py-2 text-center"
                        />
                      ) : (
                        formatHeures(profil[code])
                      )}
                    </td>
                  ))}

                  <td className="px-4 py-5 text-center">
                    <span className="font-bold text-polynov-red">
                      {formatHeures(total(profil))}
                    </span>
                  </td>

                  <td className="px-4 py-5 text-center">
                    <button
                      onClick={() =>
                        modifier(
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

                  <td className="px-5 py-5 text-right">
                    <button
                      onClick={() =>
                        setEdition(
                          edition === profil.id
                            ? null
                            : profil.id
                        )
                      }
                      className="rounded-lg border px-4 py-2 text-sm font-semibold hover:border-polynov-red hover:text-polynov-red"
                    >
                      {edition === profil.id
                        ? "Terminer"
                        : "Modifier"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Information */}
        <div className="mt-6 rounded-xl border bg-white p-5">
          <p className="text-sm text-gray-500">
            💡 Les horaires sont exprimés en heures décimales :
            <strong> 7,5 h = 7 h 30</strong>.
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Le total hebdomadaire est calculé automatiquement.
          </p>
        </div>
      </section>
    </main>
  );
}