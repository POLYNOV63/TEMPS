"use client";

import { useState, type CSSProperties } from "react";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";

type Mode = "leger" | "complet";
type Etat = "repos" | "encours" | "succes" | "erreur";

const MODES: { valeur: Mode; titre: string; taille: string; texte: string }[] = [
  {
    valeur: "leger",
    titre: "Léger",
    taille: "environ 230 Ko",
    texte:
      "Recommandé. Contexte métier, structure Supabase condensée, carte du code, code des petits fichiers et résumé des plus gros.",
  },
  {
    valeur: "complet",
    titre: "Complet",
    taille: "environ 1 Mo",
    texte:
      "Code intégral de toutes les pages, dans la limite du budget. À réserver aux demandes qui touchent plusieurs gros fichiers.",
  },
];

const CONTENUS = [
  {
    icone: "🗄️",
    titre: "Base de données",
    texte: "Tables, colonnes, relations, fonctions SQL et policies RLS, sous forme condensée.",
  },
  {
    icone: "📁",
    titre: "Code du projet",
    texte: "Pages, composants et routes API. Les gros fichiers sont résumés en mode léger.",
  },
  {
    icone: "📝",
    titre: "Contexte métier",
    texte: "Le fichier docs/AI_PROJECT_CONTEXT.md : rôles, règles de gestion, conventions.",
  },
  {
    icone: "🔐",
    titre: "Sans données sensibles",
    texte: "Clés, jetons, mots de passe et emails sont masqués. Les fichiers .env ne sont jamais lus.",
  },
];

function ExportIAContenu() {
  const [mode, setMode] = useState<Mode>("leger");
  const [etat, setEtat] = useState<Etat>("repos");
  const [message, setMessage] = useState("");
  const [avertissement, setAvertissement] = useState("");

  async function exportIA() {
    try {
      setEtat("encours");
      setMessage("");
      setAvertissement("");

      const response = await fetch(`/api/Export-IA?mode=${mode}`);

      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Accès refusé : cet export est réservé aux administrateurs."
            : `Erreur pendant la génération de l'export (code ${response.status}).`
        );
      }

      const blob = await response.blob();
      const nomFichier = `POLYNOV_AI_CONTEXT_${mode}.txt`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = nomFichier;

      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);

      const complets = response.headers.get("X-Export-Complets");
      const resumes = response.headers.get("X-Export-Resumes");
      const omis = Number(response.headers.get("X-Export-Omis") ?? 0);
      const masques = response.headers.get("X-Export-Masques");

      if (response.headers.get("X-Export-Avertissement") === "AUCUN_FICHIER") {
        setAvertissement(
          "Le fichier ne contient AUCUN code source : l'export s'est exécuté sans accès aux fichiers du projet (cas du site déployé). Lancez-le en local (npm run dev) ou ajoutez la configuration outputFileTracingIncludes décrite dans INSTALLATION.md."
        );
      }

      setEtat("succes");
      setMessage(
        `${nomFichier} téléchargé (${Math.max(1, Math.round(blob.size / 1024))} Ko)` +
          (complets !== null
            ? ` · ${complets} fichier(s) complet(s), ${resumes} résumé(s)${omis > 0 ? `, ${omis} omis` : ""}`
            : "") +
          (masques !== null ? ` · ${masques} valeur(s) sensible(s) masquée(s).` : ".")
      );
    } catch (erreur) {
      console.error(erreur);
      setEtat("erreur");
      setMessage(
        erreur instanceof Error ? erreur.message : "Erreur pendant l'export."
      );
    }
  }

  const enCours = etat === "encours";

  return (
    <main style={styles.page}>
      <EnTetePage
        section="Administration"
        titre="Export IA"
        description="Génère un contexte complet du projet à fournir à une IA, sans données sensibles."
      />

      <div style={styles.container}>
        <section style={styles.carte}>
          <div style={styles.carteEntete}>
            <div style={styles.icone}>🧠</div>

            <div>
              <h2 style={styles.carteTitre}>Contexte IA du projet</h2>
              <p style={styles.carteTexte}>
                Un seul fichier texte regroupant ce qu'une IA doit connaître de
                POLYNOV-TEMPS pour travailler sur le projet sans que vous ayez à
                lui réexpliquer la structure.
              </p>
            </div>
          </div>

          <div style={styles.grille}>
            {CONTENUS.map((c) => (
              <div key={c.titre} style={styles.tuile}>
                <div style={styles.tuileIcone}>{c.icone}</div>
                <div style={styles.tuileTitre}>{c.titre}</div>
                <div style={styles.tuileTexte}>{c.texte}</div>
              </div>
            ))}
          </div>

          <div style={styles.choixTitre}>Taille du fichier</div>

          <div style={styles.choix} role="radiogroup" aria-label="Taille du fichier">
            {MODES.map((m) => {
              const actif = m.valeur === mode;

              return (
                <button
                  key={m.valeur}
                  type="button"
                  role="radio"
                  aria-checked={actif}
                  onClick={() => setMode(m.valeur)}
                  disabled={enCours}
                  style={{
                    ...styles.choixCarte,
                    ...(actif ? styles.choixCarteActive : {}),
                  }}
                >
                  <div style={styles.choixLigne}>
                    <strong>{m.titre}</strong>
                    <span style={styles.choixTaille}>{m.taille}</span>
                  </div>
                  <div style={styles.choixTexte}>{m.texte}</div>
                </button>
              );
            })}
          </div>

          <div style={styles.zoneAction}>
            <button
              type="button"
              onClick={exportIA}
              disabled={enCours}
              style={{
                ...styles.bouton,
                opacity: enCours ? 0.7 : 1,
                cursor: enCours ? "wait" : "pointer",
              }}
            >
              {enCours ? "Génération en cours…" : "Générer et télécharger"}
            </button>

            <div style={styles.aide}>
              Le fichier est téléchargé directement par le navigateur.
            </div>
          </div>

          {message && (
            <div
              role="status"
              style={{
                ...styles.message,
                ...(etat === "erreur" ? styles.messageErreur : styles.messageSucces),
              }}
            >
              {etat === "erreur" ? "⚠️ " : "✓ "}
              {message}
            </div>
          )}

          {avertissement && (
            <div role="alert" style={styles.messageAvertissement}>
              ⚠️ {avertissement}
            </div>
          )}
        </section>

        <section style={styles.note}>
          <strong>Export complet :</strong> le code source n'est lu que si les
          fichiers du projet sont présents là où l'export s'exécute. Depuis le
          site déployé, il peut donc manquer ; pour un export complet, lancez-le
          en local (<code>npm run dev</code>) avec un compte administrateur, ou ajoutez
          <code> outputFileTracingIncludes</code> dans <code>next.config</code> (voir
          INSTALLATION.md).
          Pensez aussi à tenir à jour <code>docs/AI_PROJECT_CONTEXT.md</code> :
          c'est le moyen le plus économique de transmettre les règles de gestion.
        </section>
      </div>
    </main>
  );
}

export default function ExportIAPage() {
  return (
    <GardeAcces droit="administration">
      <ExportIAContenu />
    </GardeAcces>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f6f8",
    fontFamily: "Calibri, Arial, sans-serif",
    color: "#202020",
  },

  container: {
    maxWidth: 920,
    margin: "0 auto",
    padding: "30px 24px 50px",
    display: "grid",
    gap: 18,
  },

  carte: {
    background: "white",
    borderRadius: 16,
    padding: 28,
    border: "1px solid #e7e9ed",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  },

  carteEntete: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
  },

  icone: {
    flex: "0 0 auto",
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "#fdeaea",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
  },

  carteTitre: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
  },

  carteTexte: {
    margin: "6px 0 0",
    color: "#555",
    lineHeight: 1.5,
    maxWidth: 640,
  },

  grille: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 14,
    marginTop: 24,
  },

  tuile: {
    background: "#f8f9fb",
    border: "1px solid #e7e9ed",
    borderRadius: 12,
    padding: 16,
  },

  tuileIcone: {
    fontSize: 22,
  },

  tuileTitre: {
    marginTop: 6,
    fontWeight: 800,
  },

  tuileTexte: {
    marginTop: 4,
    color: "#666",
    fontSize: 14,
    lineHeight: 1.45,
  },

  choixTitre: {
    marginTop: 26,
    fontWeight: 800,
    fontSize: 15,
  },

  choix: {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
  },

  choixCarte: {
    textAlign: "left",
    background: "white",
    border: "2px solid #e1e4e8",
    borderRadius: 12,
    padding: "14px 16px",
    fontFamily: "inherit",
    fontSize: 15,
    color: "#202020",
    cursor: "pointer",
  },

  choixCarteActive: {
    borderColor: "#c00000",
    background: "#fff7f7",
  },

  choixLigne: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
  },

  choixTaille: {
    color: "#777",
    fontSize: 13,
  },

  choixTexte: {
    marginTop: 6,
    color: "#666",
    fontSize: 14,
    lineHeight: 1.45,
  },

  zoneAction: {
    marginTop: 26,
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },

  bouton: {
    background: "#c00000",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "13px 22px",
    fontSize: 16,
    fontWeight: 800,
    fontFamily: "inherit",
    boxShadow: "0 5px 14px rgba(192,0,0,0.22)",
  },

  aide: {
    color: "#777",
    fontSize: 14,
  },

  message: {
    marginTop: 18,
    borderRadius: 10,
    padding: "12px 16px",
    fontWeight: 700,
    lineHeight: 1.45,
  },

  messageSucces: {
    background: "#e8f6ec",
    color: "#176b34",
    border: "1px solid #bfe3ca",
  },

  messageErreur: {
    background: "#ffe9e9",
    color: "#a00000",
    border: "1px solid #ffbcbc",
  },

  messageAvertissement: {
    marginTop: 12,
    borderRadius: 10,
    padding: "12px 16px",
    fontWeight: 700,
    lineHeight: 1.45,
    background: "#fff3d6",
    color: "#7a4b00",
    border: "1px solid #f0cf85",
  },

  note: {
    background: "#fff8e6",
    border: "1px solid #f0dca0",
    color: "#6b5200",
    borderRadius: 12,
    padding: "14px 18px",
    fontSize: 14,
    lineHeight: 1.5,
  },
};
