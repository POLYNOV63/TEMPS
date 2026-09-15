"use client";

import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ImportHistoriquePage() {
  const router = useRouter();

  const inputFichierRef = useRef<HTMLInputElement>(null);

  const [nomFichier, setNomFichier] = useState("");
  const [donnees, setDonnees] = useState<any[]>([]);

  const [nbLignes, setNbLignes] = useState(0);

  const [codesDetectes, setCodesDetectes] =
    useState<string[]>([]);

  const [collaborateursDetectes, setCollaborateursDetectes] =
    useState<string[]>([]);

  const [affairesDetectees, setAffairesDetectees] =
    useState<string[]>([]);

  const [semainesDetectees, setSemainesDetectees] =
    useState<string[]>([]);

  const [affairesInconnues, setAffairesInconnues] =
    useState<string[]>([]);

  const [collaborateursInconnus, setCollaborateursInconnus] =
    useState<string[]>([]);

  const [message, setMessage] = useState("");

  const [nbImportees, setNbImportees] = useState(0);
  const [nbIgnorees, setNbIgnorees] = useState(0);

  /* =========================================================
     NORMALISATION COLLABORATEUR
  ========================================================= */

  function normaliserCollaborateur(nomComplet: string) {
    const mots = nomComplet
      .trim()
      .replace(/\s+/g, " ")
      .split(" ");

    const nom = mots
      .filter((mot) => mot === mot.toUpperCase())
      .join(" ");

    const prenom = mots
      .filter((mot) => mot !== mot.toUpperCase())
      .join(" ");

    return `${nom}|${prenom}`.toUpperCase().trim();
  }

  /* =========================================================
     CHOIX DU FICHIER
  ========================================================= */

  async function choisirFichier(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const fichier = e.target.files?.[0];

    if (!fichier) return;

    setNomFichier(fichier.name);

    setMessage("");
    setNbImportees(0);
    setNbIgnorees(0);

    const buffer = await fichier.arrayBuffer();

    const workbook = XLSX.read(buffer, {
      type: "array",
    });

    const nomOnglet = workbook.SheetNames[0];

    const feuille = workbook.Sheets[nomOnglet];

    const lignesExcel = XLSX.utils.sheet_to_json(feuille);

    const affaires = new Set<string>();
    const semaines = new Set<string>();
    const codes = new Set<string>();
    const collaborateurs = new Set<string>();

    lignesExcel.forEach((ligne: any) => {
      /* =========================
         SEMAINES
      ========================= */

      if (ligne.ANNEE && ligne.SEMAINE) {
        semaines.add(
          `${ligne.ANNEE}-S${ligne.SEMAINE}`
        );
      }

      /* =========================
         AFFAIRES
      ========================= */

      if (ligne.AFFAIRE) {
        affaires.add(
          String(ligne.AFFAIRE).trim()
        );
      }

      /* =========================
         CODES
      ========================= */

      if (ligne.CODE) {
        codes.add(
          String(ligne.CODE).trim()
        );
      }

      /* =========================
         COLLABORATEURS
      ========================= */

      if (ligne.COLLABORATEUR) {
        collaborateurs.add(
          normaliserCollaborateur(
            String(ligne.COLLABORATEUR)
          )
        );
      }
    });

    setDonnees(lignesExcel);

    setNbLignes(lignesExcel.length);

    setCodesDetectes(
      Array.from(codes).sort()
    );

    setCollaborateursDetectes(
      Array.from(collaborateurs).sort()
    );

    setAffairesDetectees(
      Array.from(affaires).sort()
    );

    setSemainesDetectees(
      Array.from(semaines).sort()
    );

    setMessage(
      `${lignesExcel.length} lignes chargées depuis le fichier.`
    );

    console.log(
      "DONNEES EXCEL",
      lignesExcel
    );
  }

  /* =========================================================
     ANALYSE
  ========================================================= */

  async function analyserFichier() {
    if (donnees.length === 0) {
      setMessage(
        "Aucune donnée chargée."
      );
      return;
    }

    setMessage(
      "Analyse du fichier en cours..."
    );

    /* =========================
       COLLABORATEURS DB
    ========================= */

    const {
      data: collaborateursDB,
      error: erreurCollaborateurs,
    } = await supabase
      .from("collaborateurs")
      .select("id, nom, prenom, trigramme");

    if (erreurCollaborateurs) {
      setMessage(
        "Erreur lors de la lecture des collaborateurs."
      );

      alert(
        erreurCollaborateurs.message
      );

      return;
    }

    /* =========================
       AFFAIRES DB
    ========================= */

    const {
      data: affairesDB,
      error: erreurAffaires,
    } = await supabase
      .from("affaires")
      .select("numero");

    if (erreurAffaires) {
      setMessage(
        "Erreur lors de la lecture des affaires."
      );

      alert(
        erreurAffaires.message
      );

      return;
    }

    /* =========================
       INDEX COLLABORATEURS
    ========================= */

    const collaborateursBase =
      new Set(
        (collaborateursDB ?? []).map(
          (c) =>
            `${c.nom}|${c.prenom}`
              .toUpperCase()
              .trim()
        )
      );

    /* =========================
       INDEX AFFAIRES
    ========================= */

    const affairesBase =
      new Set(
        (affairesDB ?? []).map(
          (a) =>
            String(a.numero)
              .toUpperCase()
              .trim()
        )
      );

    /* =========================
       COLLABORATEURS INCONNUS
    ========================= */

    const collabInconnus =
      Array.from(
        new Set(
          donnees
            .map((ligne: any) =>
              ligne.COLLABORATEUR
                ? normaliserCollaborateur(
                    String(
                      ligne.COLLABORATEUR
                    )
                  )
                : ""
            )
            .filter(
              (nom) =>
                nom !== "" &&
                !collaborateursBase.has(
                  nom
                )
            )
        )
      ).sort();

    /* =========================
       AFFAIRES INCONNUES
    ========================= */

    const affInconnues =
      Array.from(
        new Set(
          donnees
            .map((ligne: any) =>
              ligne.AFFAIRE
                ? String(
                    ligne.AFFAIRE
                  )
                    .toUpperCase()
                    .trim()
                : ""
            )
            .filter(
              (affaire) =>
                affaire !== "" &&
                !affairesBase.has(
                  affaire
                )
            )
        )
      ).sort();

    setCollaborateursInconnus(
      collabInconnus
    );

    setAffairesInconnues(
      affInconnues
    );

    setMessage(
      "Analyse terminée."
    );

    console.log(
      "COLLABORATEURS FICHIER",
      collaborateursDetectes
    );

    console.log(
      "COLLABORATEURS INCONNUS",
      collabInconnus
    );

    console.log(
      "AFFAIRES INCONNUES",
      affInconnues
    );
  }

  /* =========================================================
     IMPORT
  ========================================================= */

  async function importer() {
    if (donnees.length === 0) {
      alert(
        "Aucune donnée à importer."
      );

      return;
    }

    setMessage(
      "Import en cours..."
    );

    setNbImportees(0);
    setNbIgnorees(0);

    /* =========================
       RECUPERATION COLLABORATEURS
    ========================= */

    const {
      data: collaborateursDB,
      error,
    } = await supabase
      .from("collaborateurs")
      .select(
        "id, nom, prenom, trigramme"
      );

    if (error) {
      alert(error.message);
      return;
    }

    /* =========================
       CREATION MAP
    ========================= */

    const collaborateursMap =
      new Map<string, string>();

    (collaborateursDB ?? []).forEach(
      (collaborateur) => {
        const cle =
          `${collaborateur.nom}|${collaborateur.prenom}`
            .toUpperCase()
            .trim();

        collaborateursMap.set(
          cle,
          collaborateur.id
        );
      }
    );

    let importees = 0;
    let ignorees = 0;

    const inconnus = new Set<string>();

    /* =========================
       IMPORT LIGNE PAR LIGNE
    ========================= */

    for (const ligne of donnees) {
      const nomExcel =
        String(
          ligne.COLLABORATEUR ?? ""
        ).trim();

      const nomNormalise =
        normaliserCollaborateur(
          nomExcel
        );

      const collaborateurId =
        collaborateursMap.get(
          nomNormalise
        );

      /* =========================
         COLLABORATEUR INCONNU
      ========================= */

      if (!collaborateurId) {
        ignorees++;

        if (nomExcel) {
          inconnus.add(
            nomExcel
          );
        }

        continue;
      }

      /* =========================
         PREPARATION LIGNE
      ========================= */

      const ligneHistorique = {
        annee: Number(
          ligne.ANNEE
        ),

        semaine: Number(
          ligne.SEMAINE
        ),

        collaborateur_id:
          collaborateurId,

        affaire_code:
          String(
            ligne.AFFAIRE ?? ""
          ).trim(),

        code_imputation:
          String(
            ligne.CODE ?? ""
          ).trim(),

        heures:
          Number(
            ligne.HEURES ?? 0
          ),

        source:
          "IMPORT_EXCEL",
      };

      /* =========================
         UPSERT
      ========================= */

      const {
        error: erreurImport,
      } = await supabase
        .from(
          "historique_imputations"
        )
        .upsert(
          ligneHistorique,
          {
            onConflict:
              "annee,semaine,collaborateur_id,affaire_code,code_imputation",
          }
        );

      if (erreurImport) {
        alert(
          JSON.stringify(
            erreurImport,
            null,
            2
          )
        );

        setMessage(
          "Erreur pendant l'import."
        );

        return;
      }

      importees++;

      if (importees % 100 === 0) {
        console.log(
          "Importées :",
          importees
        );
      }
    }

    /* =========================
       RESULTAT
    ========================= */

    setNbImportees(
      importees
    );

    setNbIgnorees(
      ignorees
    );

    setCollaborateursInconnus(
      Array.from(
        inconnus
      ).sort()
    );

    setMessage(
      "Import terminé."
    );

    alert(
      `Import terminé.\n\n` +
      `Lignes Excel : ${donnees.length}\n` +
      `Importées : ${importees}\n` +
      `Ignorées : ${ignorees}`
    );
  }

  /* =========================================================
     AFFICHAGE
  ========================================================= */

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        fontFamily:
          "Calibri, Arial, sans-serif",
      }}
    >
      {/* =========================
          HEADER
      ========================= */}

      <header
        style={{
          background: "#c00000",
          color: "white",
          padding: "25px 35px",
        }}
      >
        <button
          onClick={() =>
            router.push(
              "/dashboard"
            )
          }
          style={{
            background:
              "rgba(255,255,255,0.15)",
            border:
              "1px solid rgba(255,255,255,0.3)",
            color: "white",
            borderRadius: 8,
            padding:
              "8px 14px",
            cursor: "pointer",
            marginBottom: 15,
            fontFamily: "inherit",
            fontWeight: 700,
          }}
        >
          🏠 Retour au tableau de bord
        </button>

        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
          }}
        >
          POLYNOV
        </div>

        <div
          style={{
            marginTop: 5,
            opacity: 0.9,
          }}
        >
          Import historique
        </div>
      </header>

      {/* =========================
          CONTENU
      ========================= */}

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: 30,
        }}
      >
        {/* =========================
            IMPORT
        ========================= */}

        <div
          style={{
            background: "white",
            borderRadius: 12,
            padding: 24,
            marginBottom: 25,
            borderLeft:
              "5px solid #c00000",
            boxShadow:
              "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <h1
            style={{
              margin:
                "0 0 20px 0",
              fontSize: 28,
            }}
          >
            Importer un historique
          </h1>

          <input
            ref={inputFichierRef}
            type="file"
            accept=".xlsx"
            onChange={
              choisirFichier
            }
            style={{
              display: "none",
            }}
          />

          <button
            onClick={() =>
              inputFichierRef.current?.click()
            }
            style={{
              background:
                "#c00000",
              color: "white",
              border: "none",
              borderRadius: 7,
              padding:
                "11px 18px",
              cursor: "pointer",
              fontFamily:
                "inherit",
              fontWeight: 700,
              marginRight: 10,
            }}
          >
            📂 Sélectionner un fichier Excel
          </button>

          {nomFichier && (
            <span
              style={{
                color: "#666",
                fontSize: 14,
              }}
            >
              Fichier :
              <strong>
                {" "}
                {nomFichier}
              </strong>
            </span>
          )}

          <div
            style={{
              marginTop: 20,
            }}
          >
            <button
              onClick={
                analyserFichier
              }
              disabled={
                donnees.length === 0
              }
              style={{
                background:
                  donnees.length === 0
                    ? "#ccc"
                    : "#666",
                color: "white",
                border: "none",
                borderRadius: 7,
                padding:
                  "10px 18px",
                cursor:
                  donnees.length === 0
                    ? "default"
                    : "pointer",
                fontFamily:
                  "inherit",
                fontWeight: 700,
                marginRight: 10,
              }}
            >
              🔍 Analyser
            </button>

            <button
              onClick={
                importer
              }
              disabled={
                donnees.length === 0
              }
              style={{
                background:
                  donnees.length === 0
                    ? "#ccc"
                    : "#c00000",
                color: "white",
                border: "none",
                borderRadius: 7,
                padding:
                  "10px 18px",
                cursor:
                  donnees.length === 0
                    ? "default"
                    : "pointer",
                fontFamily:
                  "inherit",
                fontWeight: 700,
              }}
            >
              📥 Importer
            </button>
          </div>

          {message && (
            <div
              style={{
                marginTop: 20,
                padding: 15,
                background:
                  "#f7f7f7",
                borderRadius: 8,
                borderLeft:
                  "5px solid #c00000",
                fontWeight: 700,
              }}
            >
              {message}
            </div>
          )}
        </div>

        {/* =========================
            STATISTIQUES
        ========================= */}

        {nbLignes > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 20,
              marginBottom: 25,
            }}
          >
            <CarteStat
              titre="Lignes Excel"
              valeur={nbLignes}
            />

            <CarteStat
              titre="Collaborateurs"
              valeur={
                collaborateursDetectes.length
              }
            />

            <CarteStat
              titre="Affaires"
              valeur={
                affairesDetectees.length
              }
            />

            <CarteStat
              titre="Codes"
              valeur={
                codesDetectes.length
              }
            />

            <CarteStat
              titre="Semaines"
              valeur={
                semainesDetectees.length
              }
            />
          </div>
        )}

        {/* =========================
            RESULTAT IMPORT
        ========================= */}

        {(nbImportees > 0 ||
          nbIgnorees > 0) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
              marginBottom: 25,
            }}
          >
            <CarteStat
              titre="Lignes importées"
              valeur={nbImportees}
            />

            <CarteStat
              titre="Lignes ignorées"
              valeur={nbIgnorees}
            />
          </div>
        )}

        {/* =========================
            COLLABORATEURS INCONNUS
        ========================= */}

        {collaborateursInconnus.length >
          0 && (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              marginBottom: 25,
              borderLeft:
                "5px solid #c00000",
              boxShadow:
                "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <h2
              style={{
                margin:
                  "0 0 15px 0",
                color: "#c00000",
                fontSize: 22,
              }}
            >
              ⚠ Collaborateurs inconnus
            </h2>

            <p
              style={{
                color: "#666",
                marginTop: 0,
              }}
            >
              Ces collaborateurs existent
              dans le fichier Excel mais
              n'ont pas été trouvés dans
              la base POLYNOV.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {collaborateursInconnus.map(
                (collaborateur) => (
                  <div
                    key={
                      collaborateur
                    }
                    style={{
                      background:
                        "#f7f7f7",
                      border:
                        "1px solid #ddd",
                      borderRadius: 7,
                      padding:
                        "8px 12px",
                      fontWeight: 700,
                    }}
                  >
                    {collaborateur}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* =========================
            AFFAIRES INCONNUES
        ========================= */}

        {affairesInconnues.length >
          0 && (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: 24,
              borderLeft:
                "5px solid #c00000",
              boxShadow:
                "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <h2
              style={{
                margin:
                  "0 0 15px 0",
                color: "#c00000",
                fontSize: 22,
              }}
            >
              ⚠ Affaires inconnues
            </h2>

            <p
              style={{
                color: "#666",
                marginTop: 0,
              }}
            >
              Ces affaires sont présentes
              dans l'historique mais ne
              sont pas encore présentes
              dans la table des affaires.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {affairesInconnues.map(
                (affaire) => (
                  <div
                    key={affaire}
                    style={{
                      background:
                        "#f7f7f7",
                      border:
                        "1px solid #ddd",
                      borderRadius: 7,
                      padding:
                        "8px 12px",
                      fontWeight: 700,
                    }}
                  >
                    {affaire}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}


/* =========================================================
   CARTE STATISTIQUE
========================================================= */

function CarteStat({
  titre,
  valeur,
}: {
  titre: string;
  valeur: number;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 12,
        padding: 22,
        borderLeft:
          "5px solid #c00000",
        boxShadow:
          "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          color: "#666",
          fontSize: 14,
          marginBottom: 7,
        }}
      >
        {titre}
      </div>

      <div
        style={{
          color: "#c00000",
          fontSize: 30,
          fontWeight: 800,
        }}
      >
        {valeur}
      </div>
    </div>
  );
}