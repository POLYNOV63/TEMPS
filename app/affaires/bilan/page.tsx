"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/* =========================================================
   TYPES
========================================================= */

type LigneHistorique = {
  annee: number;
  semaine: number;
  collaborateur_id: string;
  affaire_code: string;
  code_imputation: string;
  heures: number;
  trigramme: string;
};

type LigneTableau = {
  semaine: number;
  annee: number;
  trigramme: string;
  codes: Record<string, number>;
  total: number;
};

type Collaborateur = {
  id: string;
  trigramme: string;
};

/* =========================================================
   COULEURS DES CODES
========================================================= */

const couleursCodes = [
  "#c00000",
  "#e67e22",
  "#2e7d32",
  "#1565c0",
  "#7b1fa2",
  "#00838f",
  "#6d4c41",
  "#546e7a",
  "#8e24aa",
  "#43a047",
  "#fb8c00",
  "#3949ab",
];

function couleurCode(code: string, index: number) {
  return couleursCodes[index % couleursCodes.length];
}

/* =========================================================
   GRAPHIQUE EVOLUTION
========================================================= */

function EvolutionCodes({
  tableau,
  codes,
}: {
  tableau: LigneTableau[];
  codes: string[];
}) {
  /*
   * On regroupe les lignes par semaine.
   *
   * Exemple :
   *
   * S12
   *   AMZ -> 12 h
   *   MMO -> 8 h
   *   KID -> 15 h
   *
   * S13
   *   AMZ -> 18 h
   *
   * Chaque collaborateur possède donc SA propre barre.
   */

  const groupesSemaines = useMemo(() => {
    const groupes = new Map<string, LigneTableau[]>();

    for (const ligne of tableau) {
      const cle = `${ligne.annee}-${String(ligne.semaine).padStart(2, "0")}`;

      if (!groupes.has(cle)) {
        groupes.set(cle, []);
      }

      groupes.get(cle)!.push(ligne);
    }

    return Array.from(groupes.entries())
      .sort(([a], [b]) => {
        const [anneeA, semaineA] = a.split("-").map(Number);
        const [anneeB, semaineB] = b.split("-").map(Number);

        if (anneeA !== anneeB) {
          return anneeA - anneeB;
        }

        return semaineA - semaineB;
      })
      .map(([cle, lignes]) => ({
        cle,
        annee: lignes[0].annee,
        semaine: lignes[0].semaine,
        lignes: lignes.sort((a, b) =>
          a.trigramme.localeCompare(b.trigramme)
        ),
      }));
  }, [tableau]);

  const maxHeures = useMemo(() => {
    if (tableau.length === 0) {
      return 0;
    }

    return Math.max(...tableau.map((ligne) => ligne.total));
  }, [tableau]);

  const hauteurGraphique = 240;

  if (tableau.length === 0) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 30,
          textAlign: "center",
          color: "#777",
        }}
      >
        Aucune donnée à afficher avec les filtres sélectionnés.
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      {/* =====================================================
          TITRE
      ===================================================== */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          marginBottom: 6,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              color: "#222",
            }}
          >
            Évolution des heures par semaine
          </h2>

          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "#777",
            }}
          >
            Chaque barre représente un collaborateur. La hauteur représente
            le nombre total d'heures imputées.
          </div>
        </div>
      </div>

      {/* =====================================================
          GRAPHIQUE
      ===================================================== */}

      <div
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          marginTop: 20,
          paddingBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            minWidth: "max-content",
            padding: "10px 10px 0 10px",
          }}
        >
          {groupesSemaines.map((groupe) => {
            /*
             * Largeur du groupe selon le nombre de collaborateurs.
             *
             * 1 personne  -> groupe suffisamment large pour centrer la barre
             * 3 personnes -> trois barres côte à côte
             */

            const largeurGroupe = Math.max(
              120,
              groupe.lignes.length * 76 + 24
            );

            return (
              <div
                key={groupe.cle}
                style={{
                  width: largeurGroupe,
                  minWidth: largeurGroupe,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                {/* =========================================
                    ZONE DES BARRES
                ========================================= */}

                <div
                  style={{
                    width: "100%",
                    height: hauteurGraphique + 65,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: 8,
                    borderBottom: "1px solid #ddd",
                  }}
                >
                  {groupe.lignes.map((ligne) => {
                    const hauteurBarre =
                      maxHeures > 0
                        ? (ligne.total / maxHeures) * hauteurGraphique
                        : 0;

                    return (
                      <div
                        key={`${groupe.annee}-${groupe.semaine}-${ligne.trigramme}`}
                        style={{
                          width: 62,
                          height: hauteurGraphique + 55,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "flex-end",
                          alignItems: "center",
                          flexShrink: 0,
                        }}
                      >
                        {/* ================================
                            TOTAL AU-DESSUS DE LA BARRE
                        ================================= */}

                        <div
                          style={{
                            height: 22,
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#333",
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          {ligne.total.toFixed(1)} h
                        </div>

                        {/* ================================
                            BARRE EMPILEE
                        ================================= */}

                        <div
                          style={{
                            width: 58,
                            height: Math.max(2, hauteurBarre),
                            display: "flex",
                            flexDirection: "column-reverse",
                            borderRadius: "5px 5px 0 0",
                            overflow: "hidden",
                            background: "#f0f0f0",
                            boxShadow:
                              "0 1px 4px rgba(0,0,0,0.12)",
                          }}
                          title={`${ligne.trigramme} — ${ligne.total.toFixed(
                            1
                          )} h`}
                        >
                          {codes.map((code, index) => {
                            const heures = ligne.codes[code] || 0;

                            if (heures <= 0) {
                              return null;
                            }

                            const hauteurSegment =
                              ligne.total > 0
                                ? (heures / ligne.total) * hauteurBarre
                                : 0;

                            return (
                              <div
                                key={code}
                                title={`${code} : ${heures.toFixed(1)} h`}
                                style={{
                                  width: "100%",
                                  height: hauteurSegment,
                                  minHeight:
                                    hauteurSegment > 0 ? 1 : 0,
                                  backgroundColor: couleurCode(
                                    code,
                                    index
                                  ),
                                  transition:
                                    "height 0.2s ease",
                                }}
                              />
                            );
                          })}
                        </div>

                        {/* ================================
                            TRIGRAMME SOUS LA BARRE
                        ================================= */}

                        <div
                          style={{
                            height: 32,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 800,
                            color: "#c00000",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ligne.trigramme}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* =========================================
                    NUMERO DE SEMAINE
                ========================================= */}

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#444",
                    whiteSpace: "nowrap",
                  }}
                >
                  S{String(groupe.semaine).padStart(2, "0")}-
                  {groupe.annee}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* =====================================================
          LEGENDE
      ===================================================== */}

      <div
        style={{
          marginTop: 22,
          paddingTop: 16,
          borderTop: "1px solid #eee",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {codes.map((code, index) => {
          const totalCode = tableau.reduce(
            (somme, ligne) => somme + (ligne.codes[code] || 0),
            0
          );

          if (totalCode <= 0) {
            return null;
          }

          const totalGeneral = tableau.reduce(
            (somme, ligne) => somme + ligne.total,
            0
          );

          const pourcentage =
            totalGeneral > 0
              ? (totalCode / totalGeneral) * 100
              : 0;

          return (
            <div
              key={code}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12,
                color: "#555",
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  backgroundColor: couleurCode(code, index),
                  flexShrink: 0,
                }}
              />

              <strong>{code}</strong>

              <span>
                {totalCode.toFixed(1)} h
              </span>

              <span style={{ color: "#999" }}>
                ({pourcentage.toFixed(0)} %)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================
   PAGE PRINCIPALE
========================================================= */

export default function BilanAffairePage() {
  const router = useRouter();
  const [typeAffaire, setTypeAffaire] = useState("CBE");
  const [numero, setNumero] = useState("");

  const [lignes, setLignes] = useState<LigneHistorique[]>([]);
  const [loading, setLoading] = useState(false);
  const [rechercheFaite, setRechercheFaite] = useState(false);

  const [collaborateurs, setCollaborateurs] = useState<
    Collaborateur[]
  >([]);

  const [collaborateurFiltre, setCollaborateurFiltre] =
    useState("");

  const [semaineFiltre, setSemaineFiltre] = useState("");

  const [triColonne, setTriColonne] = useState<
    "semaine" | "trigramme" | "total"
  >("semaine");

  const [triDirection, setTriDirection] = useState<
    "asc" | "desc"
  >("asc");

  /* =========================================================
     RECHERCHE
  ========================================================= */

  async function rechercher() {
    const numeroPropre = numero.trim();

    if (!numeroPropre) {
      return;
    }

    setLoading(true);
    setRechercheFaite(true);

    try {
      const { data, error } = await supabase
        .from("historique_imputations")
        .select(
          `
            annee,
            semaine,
            collaborateur_id,
            affaire_code,
            code_imputation,
            heures
          `
        )
        .ilike(
          "affaire_code",
          `${typeAffaire} ${numeroPropre}%`
        );

      if (error) {
        console.error(
          "Erreur chargement historique :",
          error
        );

        setLignes([]);
        setCollaborateurs([]);
        return;
      }

      const historique: LigneHistorique[] = (data || []).map(
        (ligne: any) => ({
          annee: Number(ligne.annee),
          semaine: Number(ligne.semaine),
          collaborateur_id: ligne.collaborateur_id,
          affaire_code: ligne.affaire_code,
          code_imputation: ligne.code_imputation,
          heures: Number(ligne.heures) || 0,
          trigramme: "",
        })
      );

      /* =====================================================
         RECUPERATION DES COLLABORATEURS
      ===================================================== */

      const ids = Array.from(
        new Set(
          historique
            .map((ligne) => ligne.collaborateur_id)
            .filter(Boolean)
        )
      );

      let collaborateursData: Collaborateur[] = [];

      if (ids.length > 0) {
        const { data: collabs, error: collabError } =
          await supabase
            .from("collaborateurs")
            .select("id, trigramme")
            .in("id", ids);

        if (collabError) {
          console.error(
            "Erreur chargement collaborateurs :",
            collabError
          );
        } else {
          collaborateursData = (collabs || []).map(
            (collab: any) => ({
              id: collab.id,
              trigramme: collab.trigramme || "?",
            })
          );
        }
      }

      setCollaborateurs(collaborateursData);

      /* =====================================================
         AJOUT DU TRIGRAMME AUX LIGNES
      ===================================================== */

      const mapCollaborateurs = new Map<
        string,
        string
      >();

      for (const collab of collaborateursData) {
        mapCollaborateurs.set(
          collab.id,
          collab.trigramme
        );
      }

      const lignesAvecTrigramme = historique.map(
        (ligne) => ({
          ...ligne,
          trigramme:
            mapCollaborateurs.get(
              ligne.collaborateur_id
            ) || "?",
        })
      );

      setLignes(lignesAvecTrigramme);
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     CODE IMPLICATIONS DISTINCTS
  ========================================================= */

  const codes = useMemo(() => {
    const ensemble = new Set<string>();

    for (const ligne of lignes) {
      if (ligne.code_imputation) {
        ensemble.add(ligne.code_imputation);
      }
    }

    return Array.from(ensemble).sort();
  }, [lignes]);

  /* =========================================================
     LISTE COLLABORATEURS
  ========================================================= */

  const collaborateursFiltres = useMemo(() => {
    return collaborateurs
      .filter((collab) => collab.trigramme)
      .sort((a, b) =>
        a.trigramme.localeCompare(b.trigramme)
      );
  }, [collaborateurs]);

  /* =========================================================
     LISTE SEMAINES
  ========================================================= */

  const semaines = useMemo(() => {
    const ensemble = new Set<string>();

    for (const ligne of lignes) {
      ensemble.add(
        `${ligne.annee}-${String(
          ligne.semaine
        ).padStart(2, "0")}`
      );
    }

    return Array.from(ensemble).sort((a, b) => {
      const [anneeA, semaineA] = a
        .split("-")
        .map(Number);

      const [anneeB, semaineB] = b
        .split("-")
        .map(Number);

      if (anneeA !== anneeB) {
        return anneeA - anneeB;
      }

      return semaineA - semaineB;
    });
  }, [lignes]);

  /* =========================================================
     TABLEAU PAR SEMAINE + COLLABORATEUR
  ========================================================= */

  const tableau = useMemo(() => {
    const map = new Map<
      string,
      LigneTableau
    >();

    for (const ligne of lignes) {
      const cle = `${ligne.annee}-${ligne.semaine}-${ligne.trigramme}`;

      if (!map.has(cle)) {
        map.set(cle, {
          semaine: ligne.semaine,
          annee: ligne.annee,
          trigramme: ligne.trigramme,
          codes: {},
          total: 0,
        });
      }

      const resultat = map.get(cle)!;

      resultat.codes[ligne.code_imputation] =
        (resultat.codes[ligne.code_imputation] || 0) +
        ligne.heures;

      resultat.total += ligne.heures;
    }

    return Array.from(map.values());
  }, [lignes]);

  /* =========================================================
     FILTRES
  ========================================================= */

  const tableauFiltre = useMemo(() => {
    return tableau.filter((ligne) => {
      const okCollaborateur =
        !collaborateurFiltre ||
        ligne.trigramme === collaborateurFiltre;

      const okSemaine =
        !semaineFiltre ||
        `${ligne.annee}-${String(
          ligne.semaine
        ).padStart(2, "0")}` === semaineFiltre;

      return okCollaborateur && okSemaine;
    });
  }, [
    tableau,
    collaborateurFiltre,
    semaineFiltre,
  ]);

  /* =========================================================
     TRI TABLEAU
  ========================================================= */

  const tableauTrie = useMemo(() => {
    const copie = [...tableauFiltre];

    copie.sort((a, b) => {
      let comparaison = 0;

      if (triColonne === "semaine") {
        if (a.annee !== b.annee) {
          comparaison = a.annee - b.annee;
        } else {
          comparaison = a.semaine - b.semaine;
        }
      }

      if (triColonne === "trigramme") {
        comparaison =
          a.trigramme.localeCompare(b.trigramme);
      }

      if (triColonne === "total") {
        comparaison = a.total - b.total;
      }

      return triDirection === "asc"
        ? comparaison
        : -comparaison;
    });

    return copie;
  }, [
    tableauFiltre,
    triColonne,
    triDirection,
  ]);

  /* =========================================================
     TOTAL HEURES
  ========================================================= */

  const totalHeures = useMemo(() => {
    return tableauFiltre.reduce(
      (somme, ligne) => somme + ligne.total,
      0
    );
  }, [tableauFiltre]);

  /* =========================================================
     NOMBRE DE COLLABORATEURS
  ========================================================= */

  const nombreCollaborateurs = useMemo(() => {
    return new Set(
      tableauFiltre.map(
        (ligne) => ligne.trigramme
      )
    ).size;
  }, [tableauFiltre]);

  /* =========================================================
     NOMBRE DE SEMAINES
  ========================================================= */

  const nombreSemaines = useMemo(() => {
    return new Set(
      tableauFiltre.map(
        (ligne) =>
          `${ligne.annee}-${ligne.semaine}`
      )
    ).size;
  }, [tableauFiltre]);

  /* =========================================================
     CHANGEMENT DE TRI
  ========================================================= */

  function changerTri(
    colonne:
      | "semaine"
      | "trigramme"
      | "total"
  ) {
    if (triColonne === colonne) {
      setTriDirection(
        triDirection === "asc"
          ? "desc"
          : "asc"
      );
    } else {
      setTriColonne(colonne);
      setTriDirection("asc");
    }
  }

  /* =========================================================
     RESET FILTRES
  ========================================================= */

  function resetFiltres() {
    setCollaborateurFiltre("");
    setSemaineFiltre("");
  }

  /* =========================================================
     STYLE COMMUN
  ========================================================= */

  const styles = {
    page: {
      minHeight: "100vh",
      background: "#f5f5f5",
      fontFamily: "Calibri, Arial, sans-serif",
      color: "#222",
    },

    header: {
      background: "#c00000",
      color: "#fff",
      padding: "22px 30px",
    },

    container: {
      maxWidth: 1500,
      margin: "0 auto",
      padding: "25px 30px 50px",
    },

    card: {
      background: "#fff",
      borderRadius: 12,
      border: "1px solid #e5e5e5",
      padding: 20,
      marginBottom: 20,
    },

    label: {
      display: "block",
      fontSize: 13,
      fontWeight: 700,
      color: "#555",
      marginBottom: 6,
    },

    input: {
      width: "100%",
      boxSizing: "border-box" as const,
      border: "1px solid #ccc",
      borderRadius: 7,
      padding: "10px 12px",
      fontSize: 14,
      outline: "none",
      background: "#fff",
    },

    select: {
      width: "100%",
      boxSizing: "border-box" as const,
      border: "1px solid #ccc",
      borderRadius: 7,
      padding: "10px 12px",
      fontSize: 14,
      background: "#fff",
    },

    button: {
      border: "none",
      borderRadius: 7,
      padding: "10px 20px",
      background: "#c00000",
      color: "#fff",
      fontWeight: 700,
      fontSize: 14,
      cursor: "pointer",
    },
  };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div style={styles.page}>
      {/* =====================================================
          HEADER
      ===================================================== */}

      <header style={styles.header}>
  <div
    style={{
      maxWidth: 1500,
      margin: "0 auto",
    }}
  >
    <button
      type="button"
      onClick={() => router.push("/dashboard")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 18,
        padding: "8px 14px",
        border: "1px solid rgba(255,255,255,0.35)",
        borderRadius: 7,
        background: "rgba(255,255,255,0.12)",
        color: "#fff",
        fontFamily:
          "Calibri, Arial, sans-serif",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ←
      </span>

      Retour au dashboard
    </button>

    <div
      style={{
        fontSize: 13,
        opacity: 0.85,
        marginBottom: 4,
      }}
    >
      POLYNOV
    </div>

    <h1
      style={{
        margin: 0,
        fontSize: 28,
        fontWeight: 700,
      }}
    >
      Bilan affaire
    </h1>

    <div
      style={{
        marginTop: 5,
        fontSize: 14,
        opacity: 0.9,
      }}
    >
      Analyse des heures imputées par affaire,
      semaine et collaborateur
    </div>
  </div>
</header>

      {/* =====================================================
          CONTENU
      ===================================================== */}

      <main style={styles.container}>
        {/* ===================================================
            RECHERCHE AFFAIRE
        =================================================== */}

        <div style={styles.card}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginBottom: 16,
            }}
          >
            Rechercher une affaire
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "140px minmax(150px, 300px) auto",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <label style={styles.label}>
                Type
              </label>

              <select
                value={typeAffaire}
                onChange={(e) =>
                  setTypeAffaire(e.target.value)
                }
                style={styles.select}
              >
                <option value="CBE">
                  CBE
                </option>

                <option value="DBE">
                  DBE
                </option>
              </select>
            </div>

            <div>
              <label style={styles.label}>
                Numéro d'affaire
              </label>

              <input
                value={numero}
                onChange={(e) =>
                  setNumero(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    rechercher();
                  }
                }}
                placeholder="Ex. 1234"
                style={styles.input}
              />
            </div>

            <button
              type="button"
              onClick={rechercher}
              disabled={loading}
              style={{
                ...styles.button,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading
                ? "Recherche..."
                : "Rechercher"}
            </button>
          </div>
        </div>

        {/* ===================================================
            RESULTATS
        =================================================== */}

        {rechercheFaite && (
          <>
            {/* ===============================================
                STATISTIQUES
            =============================================== */}

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",
                gap: 15,
                marginBottom: 20,
              }}
            >
              {/* TOTAL HEURES */}

              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #e5e5e5",
                  padding: 20,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "#777",
                    marginBottom: 5,
                  }}
                >
                  Total heures
                </div>

                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: "#c00000",
                  }}
                >
                  {totalHeures.toFixed(1)} h
                </div>
              </div>

              {/* COLLABORATEURS */}

              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #e5e5e5",
                  padding: 20,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "#777",
                    marginBottom: 5,
                  }}
                >
                  Collaborateurs
                </div>

                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                  }}
                >
                  {nombreCollaborateurs}
                </div>
              </div>

              {/* SEMAINES */}

              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #e5e5e5",
                  padding: 20,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "#777",
                    marginBottom: 5,
                  }}
                >
                  Semaines
                </div>

                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                  }}
                >
                  {nombreSemaines}
                </div>
              </div>
            </div>

            {/* ===============================================
                FILTRES
            =============================================== */}

            {lignes.length > 0 && (
              <div style={styles.card}>
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    marginBottom: 15,
                    gap: 15,
                  }}
                >
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                    }}
                  >
                    Filtres
                  </div>

                  <button
                    type="button"
                    onClick={resetFiltres}
                    style={{
                      border: "1px solid #ccc",
                      background: "#fff",
                      borderRadius: 7,
                      padding:
                        "7px 12px",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    Réinitialiser
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(2, minmax(180px, 1fr))",
                    gap: 15,
                  }}
                >
                  <div>
                    <label
                      style={styles.label}
                    >
                      Collaborateur
                    </label>

                    <select
                      value={
                        collaborateurFiltre
                      }
                      onChange={(e) =>
                        setCollaborateurFiltre(
                          e.target.value
                        )
                      }
                      style={styles.select}
                    >
                      <option value="">
                        Tous les collaborateurs
                      </option>

                      {collaborateursFiltres.map(
                        (collab) => (
                          <option
                            key={collab.id}
                            value={
                              collab.trigramme
                            }
                          >
                            {collab.trigramme}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      style={styles.label}
                    >
                      Semaine
                    </label>

                    <select
                      value={semaineFiltre}
                      onChange={(e) =>
                        setSemaineFiltre(
                          e.target.value
                        )
                      }
                      style={styles.select}
                    >
                      <option value="">
                        Toutes les semaines
                      </option>

                      {semaines.map(
                        (semaine) => (
                          <option
                            key={semaine}
                            value={semaine}
                          >
                            S
                            {semaine
                              .split("-")[1]
                              .padStart(
                                2,
                                "0"
                              )}
                            -
                            {
                              semaine.split(
                                "-"
                              )[0]
                            }
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </div>
              </div>
            )}



            {/* ===============================================
                TABLEAU
            =============================================== */}

            <div style={styles.card}>
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  marginBottom: 15,
                  gap: 15,
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  Détail des imputations
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#777",
                  }}
                >
                  {tableauTrie.length} ligne
                  {tableauTrie.length > 1
                    ? "s"
                    : ""}
                </div>
              </div>

              {tableauTrie.length === 0 ? (
                <div
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: "#777",
                  }}
                >
                  Aucune donnée ne correspond aux
                  filtres sélectionnés.
                </div>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse:
                        "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          onClick={() =>
                            changerTri(
                              "semaine"
                            )
                          }
                          style={{
                            padding:
                              "11px 10px",
                            textAlign: "left",
                            borderBottom:
                              "2px solid #ddd",
                            cursor: "pointer",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          Semaine{" "}
                          {triColonne ===
                            "semaine" &&
                            (triDirection ===
                            "asc"
                              ? "↑"
                              : "↓")}
                        </th>

                        <th
                          onClick={() =>
                            changerTri(
                              "trigramme"
                            )
                          }
                          style={{
                            padding:
                              "11px 10px",
                            textAlign: "left",
                            borderBottom:
                              "2px solid #ddd",
                            cursor: "pointer",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          Collaborateur{" "}
                          {triColonne ===
                            "trigramme" &&
                            (triDirection ===
                            "asc"
                              ? "↑"
                              : "↓")}
                        </th>

                        {codes.map(
                          (code, index) => (
                            <th
                              key={code}
                              style={{
                                padding:
                                  "11px 10px",
                                textAlign:
                                  "right",
                                borderBottom:
                                  "2px solid #ddd",
                                whiteSpace:
                                  "nowrap",
                              }}
                            >
                              <span
                                style={{
                                  display:
                                    "inline-block",
                                  width: 9,
                                  height: 9,
                                  borderRadius:
                                    2,
                                  backgroundColor:
                                    couleurCode(
                                      code,
                                      index
                                    ),
                                  marginRight: 5,
                                }}
                              />

                              {code}
                            </th>
                          )
                        )}

                        <th
                          onClick={() =>
                            changerTri(
                              "total"
                            )
                          }
                          style={{
                            padding:
                              "11px 10px",
                            textAlign: "right",
                            borderBottom:
                              "2px solid #ddd",
                            cursor: "pointer",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          Total{" "}
                          {triColonne ===
                            "total" &&
                            (triDirection ===
                            "asc"
                              ? "↑"
                              : "↓")}
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {tableauTrie.map(
                        (ligne, index) => (
                          <tr
                            key={`${ligne.annee}-${ligne.semaine}-${ligne.trigramme}-${index}`}
                            style={{
                              backgroundColor:
                                index % 2 ===
                                0
                                  ? "#fff"
                                  : "#fafafa",
                            }}
                          >
                            {/* SEMAINE */}

                            <td
                              style={{
                                padding:
                                  "10px",
                                borderBottom:
                                  "1px solid #eee",
                                whiteSpace:
                                  "nowrap",
                                fontWeight: 600,
                              }}
                            >
                              S
                              {String(
                                ligne.semaine
                              ).padStart(
                                2,
                                "0"
                              )}
                              -
                              {ligne.annee}
                            </td>

                            {/* TRIGRAMME */}

                            <td
                              style={{
                                padding:
                                  "10px",
                                borderBottom:
                                  "1px solid #eee",
                                fontWeight: 800,
                                color:
                                  "#c00000",
                              }}
                            >
                              {
                                ligne.trigramme
                              }
                            </td>

                            {/* CODES */}

                            {codes.map(
                              (code) => (
                                <td
                                  key={code}
                                  style={{
                                    padding:
                                      "10px",
                                    borderBottom:
                                      "1px solid #eee",
                                    textAlign:
                                      "right",
                                  }}
                                >
                                  {ligne.codes[
                                    code
                                  ]
                                    ? ligne.codes[
                                        code
                                      ].toFixed(1)
                                    : "—"}
                                </td>
                              )
                            )}

                            {/* TOTAL */}

                            <td
                              style={{
                                padding:
                                  "10px",
                                borderBottom:
                                  "1px solid #eee",
                                textAlign:
                                  "right",
                                fontWeight: 800,
                              }}
                            >
                              {ligne.total.toFixed(
                                1
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>

                    {/* =====================================
                        TOTAL DU TABLEAU
                    ===================================== */}

                    <tfoot>
                      <tr
                        style={{
                          background:
                            "#f3f3f3",
                          fontWeight: 800,
                        }}
                      >
                        <td
                          colSpan={2}
                          style={{
                            padding: 11,
                            borderTop:
                              "2px solid #ccc",
                          }}
                        >
                          TOTAL
                        </td>

                        {codes.map(
                          (code) => {
                            const totalCode =
                              tableauTrie.reduce(
                                (
                                  somme,
                                  ligne
                                ) =>
                                  somme +
                                  (ligne
                                    .codes[
                                    code
                                  ] || 0),
                                0
                              );

                            return (
                              <td
                                key={code}
                                style={{
                                  padding: 11,
                                  textAlign:
                                    "right",
                                  borderTop:
                                    "2px solid #ccc",
                                }}
                              >
                                {totalCode.toFixed(
                                  1
                                )}
                              </td>
                            );
                          }
                        )}

                        <td
                          style={{
                            padding: 11,
                            textAlign:
                              "right",
                            borderTop:
                              "2px solid #ccc",
                            color:
                              "#c00000",
                          }}
                        >
                          {totalHeures.toFixed(
                            1
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>


                        {/* ===============================================
                GRAPHIQUE
            =============================================== */}

            {lignes.length > 0 && (
              <EvolutionCodes
                tableau={tableauFiltre}
                codes={codes}
              />
            )}

            {/* ===============================================
                AUCUN RESULTAT
            =============================================== */}

            {lignes.length === 0 && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  border:
                    "1px solid #e5e5e5",
                  padding: 40,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  Aucune imputation trouvée
                </div>

                <div
                  style={{
                    color: "#777",
                    fontSize: 14,
                  }}
                >
                  Aucune heure n'a été trouvée
                  pour {typeAffaire}{" "}
                  {numero}.
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}