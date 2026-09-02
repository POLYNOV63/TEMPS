"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type FeuilleHeures = {
  id: string;
  semaine_debut: string;
  total_heures: number;
  total_theorique: number;
  heures_supplementaires: number;
  created_at: string;
};

function formatHeures(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function numeroSemaine(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);

  date.setHours(0, 0, 0, 0);

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

export default function MesFeuillesPage() {
  const router = useRouter();

  const [chargement, setChargement] =
    useState(true);

  const [feuilles, setFeuilles] =
    useState<FeuilleHeures[]>([]);

  const [erreur, setErreur] =
    useState("");

  useEffect(() => {
    async function charger() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        const {
          data: collaborateur,
          error: erreurCollaborateur,
        } = await supabase
          .from("collaborateurs")
          .select("id")
          .eq(
            "auth_user_id",
            user.id
          )
          .single();

        if (
          erreurCollaborateur ||
          !collaborateur
        ) {
          setErreur(
            "Collaborateur introuvable."
          );

          return;
        }

        const {
          data,
          error,
        } = await supabase
          .from("feuilles_heures")
          .select("*")
          .eq(
            "collaborateur_id",
            collaborateur.id
          )
          .order(
            "semaine_debut",
            {
              ascending: false,
            }
          );

        if (error) {
          setErreur(
            error.message
          );

          return;
        }

        setFeuilles(
          (data ??
            []) as FeuilleHeures[]
        );
      } finally {
        setChargement(false);
      }
    }

    charger();
  }, [router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily:
          "Calibri, Arial, sans-serif",
      }}
    >
      <header
  style={{
    background: "#c00000",
    color: "white",
    padding: "22px 32px",
  }}
>
  <button
    onClick={() =>
      router.push("/dashboard")
    }
    style={{
      background: "rgba(255,255,255,0.15)",
      border: "1px solid rgba(255,255,255,0.3)",
      color: "white",
      borderRadius: 8,
      padding: "8px 14px",
      cursor: "pointer",
      fontWeight: 700,
      marginBottom: 12,
    }}
  >
    🏠 Retour au tableau de bord
  </button>

  <div
    style={{
      fontSize: 28,
      fontWeight: 700,
    }}
  >
    POLYNOV
  </div>

  <div
    style={{
      marginTop: 4,
    }}
  >
    Mes feuilles
  </div>
</header>

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: 30,
        }}
      >


        <div
          style={{
            background: "white",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow:
              "0 1px 5px rgba(0,0,0,.08)",
          }}
        >
          <div
            style={{
              padding: 20,
              borderBottom:
                "1px solid #e5e5e5",
            }}
          >
            <h1
              style={{
                margin: 0,
              }}
            >
              Historique
            </h1>
          </div>

          {chargement && (
            <div
              style={{
                padding: 30,
              }}
            >
              Chargement...
            </div>
          )}

          {erreur && (
            <div
              style={{
                padding: 30,
                color: "#c00000",
              }}
            >
              {erreur}
            </div>
          )}

          {!chargement &&
            !erreur &&
            feuilles.length ===
              0 && (
              <div
                style={{
                  padding: 30,
                  color: "#777",
                }}
              >
                Aucune feuille
                enregistrée.
              </div>
            )}

          {!chargement &&
            feuilles.length > 0 && (
              <table
                style={{
                  width: "100%",
                  borderCollapse:
                    "collapse",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:
                        "#f7f7f7",
                    }}
                  >
                    <th
                      style={
                        thStyle
                      }
                    >
                      Semaine
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      Heures
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      Théorique
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      Écart
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      État
                    </th>
                    <th
                    style={
                        thStyle
                    }
                    >
                    Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {feuilles.map(
                    (
                      feuille
                    ) => {
                      const complete =
                        feuille.total_heures >=
                        feuille.total_theorique -
                          0.01;
const couleurFond =
  !complete
    ? "#fff8dd"
    : feuille.heures_supplementaires > 0
      ? "#fff5f5"
      : "#ffffff";
                      return (
<tr
  key={
    feuille.id
  }
  style={{
    background:
      couleurFond,
  }}
>
<td style={tdStyle}>
  S{numeroSemaine(
    feuille.semaine_debut
  )} - Du{" "}
  {new Date(
    `${feuille.semaine_debut}T00:00:00`
  ).toLocaleDateString("fr-FR")}
  {" "}au{" "}
  {new Date(
    new Date(
      `${feuille.semaine_debut}T00:00:00`
    ).getTime() +
      6 * 24 * 60 * 60 * 1000
  ).toLocaleDateString("fr-FR")}
</td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {formatHeures(
                              feuille.total_heures
                            )}{" "}
                            h
                          </td>

                          <td
                            style={
                              tdStyle
                            }
                          >
                            {formatHeures(
                              feuille.total_theorique
                            )}{" "}
                            h
                          </td>

<td
  style={{
    ...tdStyle,
    fontWeight: 700,
    color:
      feuille.heures_supplementaires > 0
        ? "#c00000"
        : feuille.heures_supplementaires < 0
          ? "#0066cc"
          : "#333",
  }}
>
  {feuille.heures_supplementaires > 0
    ? "+"
    : ""}
  {formatHeures(
    feuille.heures_supplementaires
  )} h
</td>

<td
  style={
    tdStyle
  }
>
  <span
    style={{
      display: "inline-block",
      padding: "5px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 700,
      background:
        complete
          ? "#dff5e4"
          : "#fff4cc",
      color:
        complete
          ? "#197a37"
          : "#996c00",
    }}
  >
    {complete
      ? "✅ Complète"
      : "⚠ Incomplète"}
  </span>
</td>

                          <td
  style={
    tdStyle
  }
>
  <button
    onClick={() =>
      router.push(
        `/ma-semaine?semaine=${feuille.semaine_debut}`
      )
    }
    style={{
      background: "#c00000",
      color: "white",
      border: "none",
      borderRadius: 6,
      padding: "6px 12px",
      cursor: "pointer",
      fontWeight: 700,
    }}
  >
    Ouvrir
  </button>
</td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </main>
  );
}

const thStyle: React.CSSProperties =
  {
    textAlign: "left",
    padding: "12px 16px",
    borderBottom:
      "1px solid #ddd",
  };

const tdStyle: React.CSSProperties =
  {
    padding: "12px 16px",
    borderBottom:
      "1px solid #eee",
  };