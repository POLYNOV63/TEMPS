"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type FeuilleHeures = {
  id: string;
  semaine_debut: string;
  total_heures: number;
  total_theorique: number;
  heures_supplementaires: number;
  created_at: string;
  verrouillee?: boolean | null;
  verrouillee_le?: string | null;
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

  const [anneesOuvertes, setAnneesOuvertes] =
    useState<number[]>([new Date().getFullYear()]);

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

  const feuillesParAnnee = useMemo(() => {
    const groupes: Record<number, FeuilleHeures[]> = {};

    for (const feuille of feuilles) {
      const annee = Number(feuille.semaine_debut.slice(0, 4));
      if (!groupes[annee]) groupes[annee] = [];
      groupes[annee].push(feuille);
    }

    return Object.entries(groupes)
      .map(([annee, liste]) => ({
        annee: Number(annee),
        feuilles: liste.sort((a, b) =>
          b.semaine_debut.localeCompare(a.semaine_debut)
        ),
      }))
      .sort((a, b) => b.annee - a.annee);
  }, [feuilles]);

  function basculerAnnee(annee: number) {
    setAnneesOuvertes((actuelles) =>
      actuelles.includes(annee)
        ? actuelles.filter((item) => item !== annee)
        : [...actuelles, annee]
    );
  }

  function dateFinSemaine(dateString: string) {
    const date = new Date(`${dateString}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return date;
  }

  function formatDateHeure(dateString: string | null | undefined) {
    if (!dateString) return "";
    return new Date(dateString).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7f8fa 0%, #f1f3f5 100%)",
        fontFamily: "Calibri, Arial, sans-serif",
        color: "#202020",
      }}
    >
      <header
        style={{
          background: "linear-gradient(135deg, #c00000 0%, #a80000 100%)",
          color: "white",
          padding: "22px 32px 24px",
          boxShadow: "0 3px 12px rgba(0,0,0,.12)",
        }}
      >
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.30)",
            color: "white",
            borderRadius: 9,
            padding: "8px 14px",
            cursor: "pointer",
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          🏠 Retour au tableau de bord
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "rgba(255,255,255,.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 25,
            }}
          >
            🗂️
          </div>
          <div>
            <div style={{ fontSize: 29, fontWeight: 800, letterSpacing: "-0.4px" }}>
              Mes feuilles
            </div>
            <div style={{ marginTop: 4, opacity: 0.88, fontSize: 15 }}>
              Retrouvez vos feuilles de temps classées par année.
            </div>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 24px 50px" }}>
        <div
          style={{
            background: "white",
            borderRadius: 16,
            padding: "20px 22px",
            marginBottom: 22,
            boxShadow: "0 2px 12px rgba(0,0,0,.06)",
            border: "1px solid #e7e9ed",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, color: "#777", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>
                Historique
              </div>
              <div style={{ fontSize: 23, fontWeight: 800, marginTop: 4, color: "#222" }}>
                Vos feuilles de temps
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ background: "#f7f7f8", border: "1px solid #e5e5e8", borderRadius: 10, padding: "9px 13px", color: "#555", fontSize: 14 }}>
                📄 {feuilles.length} feuille{feuilles.length > 1 ? "s" : ""}
              </div>
              <div style={{ background: "#fff1f1", border: "1px solid #f3d1d1", borderRadius: 10, padding: "9px 13px", color: "#a50000", fontSize: 14, fontWeight: 700 }}>
                🔒 Une feuille verrouillée reste consultable
              </div>
            </div>
          </div>
        </div>

        {chargement && (
          <div style={{ background: "white", borderRadius: 16, padding: 45, textAlign: "center", color: "#777", boxShadow: "0 2px 12px rgba(0,0,0,.05)" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
            Chargement de vos feuilles...
          </div>
        )}

        {erreur && (
          <div style={{ background: "#fff5f5", border: "1px solid #efcaca", color: "#a00000", borderRadius: 14, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,.04)" }}>
            <strong>Une erreur est survenue</strong>
            <div style={{ marginTop: 5 }}>{erreur}</div>
          </div>
        )}

        {!chargement && !erreur && feuilles.length === 0 && (
          <div style={{ background: "white", borderRadius: 16, padding: "55px 30px", textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,.05)", border: "1px solid #e7e9ed" }}>
            <div style={{ fontSize: 46, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 21, fontWeight: 800, marginBottom: 7 }}>
              Aucune feuille enregistrée
            </div>
            <div style={{ color: "#777" }}>
              Vos feuilles hebdomadaires apparaîtront ici.
            </div>
          </div>
        )}

        {!chargement && !erreur && feuillesParAnnee.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {feuillesParAnnee.map(({ annee, feuilles: feuillesAnnee }) => {
              const ouverte = anneesOuvertes.includes(annee);
              const estAnneeCourante = annee === new Date().getFullYear();
              const feuillesCompletes = feuillesAnnee.filter(
                (feuille) => feuille.total_heures >= feuille.total_theorique - 0.01
              ).length;

              return (
                <section
                  key={annee}
                  style={{
                    background: "white",
                    borderRadius: 16,
                    border: estAnneeCourante ? "1px solid #e5bebe" : "1px solid #e3e5e8",
                    overflow: "hidden",
                    boxShadow: ouverte ? "0 3px 14px rgba(0,0,0,.07)" : "0 1px 5px rgba(0,0,0,.04)",
                  }}
                >
                  <button
                    onClick={() => basculerAnnee(annee)}
                    aria-expanded={ouverte}
                    style={{
                      width: "100%",
                      border: "none",
                      background: ouverte ? (estAnneeCourante ? "#fff8f8" : "#fafafa") : "white",
                      cursor: "pointer",
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 11,
                          background: estAnneeCourante ? "#fff0f0" : "#f1f3f5",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 22,
                        }}
                      >
                        📁
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 20, fontWeight: 800, color: "#222" }}>
                            Année {annee}
                          </span>
                          {estAnneeCourante && (
                            <span style={{ background: "#c00000", color: "white", borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 800 }}>
                              ANNÉE EN COURS
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 3, color: "#777", fontSize: 13 }}>
                          {feuillesAnnee.length} feuille{feuillesAnnee.length > 1 ? "s" : ""} · {feuillesCompletes} complète{feuillesCompletes > 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: 20, color: "#555", transition: "transform .15s ease", transform: ouverte ? "rotate(180deg)" : "rotate(0deg)" }}>
                      ▾
                    </span>
                  </button>

                  {ouverte && (
                    <div style={{ borderTop: "1px solid #ececef" }}>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                          <thead>
                            <tr style={{ background: "#f8f9fa" }}>
                              <th style={thStyle}>Semaine</th>
                              <th style={thStyle}>Heures</th>
                              <th style={thStyle}>Théorique</th>
                              <th style={thStyle}>Écart</th>
                              <th style={thStyle}>État</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {feuillesAnnee.map((feuille) => {
                              const complete = feuille.total_heures >= feuille.total_theorique - 0.01;
                              const verrouillee = Boolean(feuille.verrouillee);
                              const couleurFond = !complete
                                ? "#fffaf0"
                                : feuille.heures_supplementaires > 0
                                  ? "#fff8f8"
                                  : "#ffffff";

                              return (
                                <tr key={feuille.id} style={{ background: couleurFond }}>
                                  <td style={tdStyle}>
                                    <div style={{ fontWeight: 800, color: "#252525" }}>
                                      S{numeroSemaine(feuille.semaine_debut)}
                                    </div>
                                    <div style={{ marginTop: 3, fontSize: 12, color: "#777" }}>
                                      Du {new Date(`${feuille.semaine_debut}T00:00:00`).toLocaleDateString("fr-FR")} au {dateFinSemaine(feuille.semaine_debut).toLocaleDateString("fr-FR")}
                                    </div>
                                  </td>

                                  <td style={tdStyle}>
                                    <strong>{formatHeures(feuille.total_heures)} h</strong>
                                  </td>

                                  <td style={tdStyle}>
                                    {formatHeures(feuille.total_theorique)} h
                                  </td>

                                  <td
                                    style={{
                                      ...tdStyle,
                                      fontWeight: 800,
                                      color:
                                        feuille.heures_supplementaires > 0
                                          ? "#c00000"
                                          : feuille.heures_supplementaires < 0
                                            ? "#0066cc"
                                            : "#333",
                                    }}
                                  >
                                    {feuille.heures_supplementaires > 0 ? "+" : ""}
                                    {formatHeures(feuille.heures_supplementaires)} h
                                  </td>

                                  <td style={tdStyle}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                      <span
                                        title={
                                          verrouillee
                                            ? `Feuille verrouillée${feuille.verrouillee_le ? ` le ${formatDateHeure(feuille.verrouillee_le)}` : ""}`
                                            : "Feuille ouverte et modifiable"
                                        }
                                        style={{
                                          width: 34,
                                          height: 34,
                                          borderRadius: 9,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          background: verrouillee ? "#f1f1f2" : "#e9f8ee",
                                          border: verrouillee ? "1px solid #dddde0" : "1px solid #bfe6ca",
                                          fontSize: 17,
                                        }}
                                      >
                                        {verrouillee ? "🔒" : "🔓"}
                                      </span>
                                      <div>
                                        <div style={{ fontWeight: 700, color: verrouillee ? "#444" : "#197a37" }}>
                                          {verrouillee ? "Verrouillée" : "Ouverte"}
                                        </div>
                                        <div style={{ marginTop: 2, fontSize: 11, color: "#888" }}>
                                          {verrouillee ? "Non modifiable" : "Modifiable"}
                                        </div>
                                      </div>
                                    </div>
                                  </td>

                                  <td style={{ ...tdStyle, textAlign: "right" }}>
                                    <button
                                      onClick={() =>
                                        router.push(`/ma-semaine?semaine=${feuille.semaine_debut}`)
                                      }
                                      style={{
                                        background: verrouillee ? "#f4f5f6" : "#c00000",
                                        color: verrouillee ? "#333" : "white",
                                        border: verrouillee ? "1px solid #ddd" : "none",
                                        borderRadius: 8,
                                        padding: "8px 13px",
                                        cursor: "pointer",
                                        fontWeight: 700,
                                      }}
                                    >
                                      {verrouillee ? "Consulter" : "Ouvrir"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ padding: "11px 18px", background: "#fafafa", borderTop: "1px solid #ececec", fontSize: 12, color: "#777" }}>
                        💡 Une feuille verrouillée peut toujours être consultée, mais elle ne peut plus être modifiée.
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
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