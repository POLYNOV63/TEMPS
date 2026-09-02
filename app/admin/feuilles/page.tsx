"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Collaborateur = {
  id: string;
  trigramme: string;
  prenom: string;
  nom: string;
  actif: boolean;
};

type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  total_heures: number;
  total_theorique: number;
  heures_supplementaires: number;
  updated_at: string;
};

function numeroSemaine(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);

  date.setDate(
    date.getDate() +
      3 -
      ((date.getDay() + 6) % 7)
  );

  const semaine1 = new Date(
    date.getFullYear(),
    0,
    4
  );

  return (
    1 +
    Math.round(
      (
        (
          date.getTime() -
          semaine1.getTime()
        ) /
        86400000 -
        3 +
        ((semaine1.getDay() + 6) % 7)
      ) /
        7
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

  fin.setDate(fin.getDate() + 6);

  return `S${numeroSemaine(
    dateDebut
  )} - Du ${debut.toLocaleDateString(
    "fr-FR"
  )} au ${fin.toLocaleDateString(
    "fr-FR"
  )}`;
}

export default function FeuillesPage() {
  const router = useRouter();

  const [
    collaborateurs,
    setCollaborateurs,
  ] = useState<Collaborateur[]>([]);

  const [feuilles, setFeuilles] =
    useState<Feuille[]>([]);

  const [recherche, setRecherche] =
    useState("");

  const [chargement, setChargement] =
    useState(true);

  useEffect(() => {
    async function charger() {
      const {
        data: collaborateursData,
      } = await supabase
        .from("collaborateurs")
        .select("*")
        .eq("actif", true)
        .order("nom");

      const {
        data: feuillesData,
      } = await supabase
        .from("feuilles_heures")
        .select("*")
        .order(
          "semaine_debut",
          {
            ascending: false,
          }
        );

      setCollaborateurs(
        collaborateursData ?? []
      );

      setFeuilles(
        feuillesData ?? []
      );

      setChargement(false);
    }

    charger();
  }, []);

  const semainesDisponibles =
    Array.from(
      new Set(
        feuilles.map(
          f => f.semaine_debut
        )
      )
    )
      .sort()
      .reverse();

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <button
          onClick={() =>
            router.push(
              "/dashboard"
            )
          }
          style={styles.retour}
        >
          🏠 Retour au tableau de bord
        </button>

        <h1>POLYNOV</h1>

        <p>
          Feuilles collaborateurs
        </p>
      </header>

      <div style={styles.container}>
        <div
          style={styles.searchBox}
        >
          <input
            value={recherche}
            onChange={e =>
              setRecherche(
                e.target.value
              )
            }
placeholder="Rechercher (trigramme, prénom ou nom)..."
            style={
              styles.searchInput
            }
          />
        </div>

        {semainesDisponibles.map(
          semaine => {
            const feuillesSemaine =
              feuilles.filter(
                f =>
                  f.semaine_debut ===
                  semaine
              );

            const complets =
              feuillesSemaine.filter(
                f =>
                  f.total_heures >=
                  f.total_theorique
              ).length;

            const incomplets =
              feuillesSemaine.filter(
                f =>
                  f.total_heures <
                  f.total_theorique
              ).length;

            const absents =
              collaborateurs.length -
              feuillesSemaine.length;

            return (
              <details
                key={semaine}
                style={
                  styles.details
                }
              >
                <summary
                  style={
                    styles.summary
                  }
                >
                  <div>
                    📂{" "}
                    {libelleSemaine(
                      semaine
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      display:
                        "flex",
                      gap: 20,
                    }}
                  >
                    <span
                      style={{
                        color:
                          "#138113",
                      }}
                    >
                      ✅ {complets}
                    </span>

                    <span
                      style={{
                        color:
                          "#b68700",
                      }}
                    >
                      ⚠️{" "}
                      {
                        incomplets
                      }
                    </span>

                    <span
                      style={{
                        color:
                          "#c00000",
                      }}
                    >
                      ❌ {absents}
                    </span>
                  </div>
                </summary>

                <div
                  style={{
                    padding: 20,
                  }}
                >
                  {collaborateurs
                    .filter(c =>
                      `${c.prenom} ${c.nom} ${c.trigramme}`
                        .toLowerCase()
                        .includes(
                          recherche.toLowerCase()
                        )
                    )
                    .sort(
                      (a, b) => {
                        const feuilleA =
                          feuillesSemaine.find(
                            f =>
                              f.collaborateur_id ===
                              a.id
                          );

                        const feuilleB =
                          feuillesSemaine.find(
                            f =>
                              f.collaborateur_id ===
                              b.id
                          );

                        const scoreA =
                          !feuilleA
                            ? 0
                            : feuilleA.total_heures <
                              feuilleA.total_theorique
                            ? 1
                            : 2;

                        const scoreB =
                          !feuilleB
                            ? 0
                            : feuilleB.total_heures <
                              feuilleB.total_theorique
                            ? 1
                            : 2;

                        return (
                          scoreA -
                          scoreB
                        );
                      }
                    )
                    .map(
                      collaborateur => {
                        const feuille =
                          feuillesSemaine.find(
                            f =>
                              f.collaborateur_id ===
                              collaborateur.id
                          );

                        const complete =
                          feuille &&
                          feuille.total_heures >=
                            feuille.total_theorique;

                        return (
                          <div
                            key={
                              collaborateur.id
                            }
                            style={
                              styles.ligne
                            }
                          >
                            <div>
<div
  style={{
    display: "flex",
    alignItems: "center",
    gap: 10,
  }}
>
<span
  style={{
    background: !feuille
      ? "#ffe5e5"
      : !complete
      ? "#fff4cc"
      : "#dff5e4",
    color: !feuille
      ? "#c00000"
      : !complete
      ? "#996c00"
      : "#138113",
    padding: "3px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 700,
    minWidth: 42,
    textAlign: "center",
  }}
>
  {collaborateur.trigramme}
</span>

  <strong>
    {collaborateur.prenom}{" "}
    {collaborateur.nom}
  </strong>
</div>

                              {feuille && (
                                <div
                                  style={{
                                    fontSize: 12,
                                    color:
                                      "#666",
                                  }}
                                >
                                  {
                                    feuille.total_heures
                                  }{" "}
                                  h /
                                  {
                                    feuille.total_theorique
                                  }{" "}
                                  h
                                </div>
                              )}
                            </div>

                            <div
                              style={{
                                display:
                                  "flex",
                                gap: 20,
                                alignItems:
                                  "center",
                              }}
                            >
                              {!feuille && (
                                <span
                                  style={{
                                    color:
                                      "#c00000",
                                    fontWeight:
                                      700,
                                  }}
                                >
                                  ❌ Aucune
                                  feuille
                                </span>
                              )}

                              {feuille &&
                                complete && (
                                  <span
                                    style={{
                                      color:
                                        "#138113",
                                      fontWeight:
                                        700,
                                    }}
                                  >
                                    ✅
                                    Complète
                                  </span>
                                )}

                              {feuille &&
                                !complete && (
                                  <span
                                    style={{
                                      color:
                                        "#b68700",
                                      fontWeight:
                                        700,
                                    }}
                                  >
                                    ⚠️
                                    Incomplète
                                  </span>
                                )}

                              
<button
  style={{
    ...styles.ouvrir,
    background: feuille
      ? "#c00000"
      : "#138113",
  }}
  onClick={() =>
    router.push(
      `/ma-semaine?semaine=${semaine}&collaborateur=${collaborateur.id}`
    )
  }
>
  {feuille ? "Ouvrir" : "Créer"}
</button>

                              
                            </div>
                          </div>
                        );
                      }
                    )}
                </div>
              </details>
            );
          }
        )}

        {chargement && (
          <div>
            Chargement...
          </div>
        )}
      </div>
    </main>
  );
}

const styles: any = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    fontFamily:
      "Calibri, Arial, sans-serif",
  },

  header: {
    background: "#c00000",
    color: "white",
    padding: 30,
  },

  retour: {
    background:
      "rgba(255,255,255,.15)",
    border:
      "1px solid rgba(255,255,255,.3)",
    color: "white",
    borderRadius: 8,
    padding: "8px 14px",
    cursor: "pointer",
    marginBottom: 15,
  },

  container: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: 30,
  },

  searchBox: {
    background: "white",
    padding: 16,
    borderRadius: 10,
    marginBottom: 20,
  },

  searchInput: {
    width: "100%",
    padding: 12,
  },

  details: {
    background: "white",
    borderRadius: 10,
    marginBottom: 15,
  },

  summary: {
    padding: 20,
    cursor: "pointer",
    fontWeight: 700,
  },

  ligne: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    padding: "10px 0",
    borderBottom:
      "1px solid #eee",
  },

  ouvrir: {
    background: "#c00000",
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
  },
};