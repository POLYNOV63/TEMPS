"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/* ===============================================================
   EN-TETE COMMUN DES PAGES POLYNOV-TEMPS

   Barre rouge unique pour toutes les pages :
     - marque POLYNOV + nom de la section
     - bouton "Précédent" (retour à la page d'où l'on vient)
     - bouton "Tableau de bord"
     - titre / description optionnels
     - zone d'actions propre à chaque page (children)

   forme :
     "pleine"  barre pleine largeur (page sans marge)
     "encadre" carte arrondie (page avec marges)
     "joint"   arrondie en haut seulement, collée à une carte
               blanche placée juste en dessous
================================================================ */

type Forme = "pleine" | "encadre" | "joint";

type Props = {
  section: string;
  titre?: string;
  description?: string;
  forme?: Forme;
  /* Appelée avant chaque navigation ; retourner false l'annule.
     Sert à Ma semaine pour avertir d'une saisie non enregistrée. */
  avantNavigation?: () => boolean;
  children?: ReactNode;
};

export default function EnTetePage({
  section,
  titre,
  description,
  forme = "pleine",
  avantNavigation,
  children,
}: Props) {
  const router = useRouter();

  function precedent() {
    if (avantNavigation && !avantNavigation()) return;

    // Sans historique (page ouverte directement) : retour au tableau de bord.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  }

  const conteneur: CSSProperties = {
    ...styles.header,
    ...(forme === "encadre" ? styles.encadre : {}),
    ...(forme === "joint" ? styles.joint : {}),
  };

  return (
    <header style={conteneur}>
      <div style={styles.ligneHaute}>
        <div style={styles.marque}>
          <span style={styles.logo}>POLYNOV</span>
          <span style={styles.separateur}>/</span>
          <span style={styles.section}>{section}</span>
        </div>

        <div style={styles.actions}>
          {!titre && children}

          <BoutonNavigation onClick={precedent}>← Précédent</BoutonNavigation>

          <BoutonNavigation
            onClick={() => {
              if (avantNavigation && !avantNavigation()) return;
              router.push("/dashboard");
            }}
          >
            ⌂ Tableau de bord
          </BoutonNavigation>
        </div>
      </div>

      {titre && (
        <div style={styles.ligneTitre}>
          <div>
            <div style={styles.titre}>{titre}</div>

            {description && (
              <div style={styles.description}>{description}</div>
            )}
          </div>

          {children && <div style={styles.actionsPage}>{children}</div>}
        </div>
      )}
    </header>
  );
}

function BoutonNavigation({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  const [survol, setSurvol] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        ...styles.bouton,
        background: survol
          ? "rgba(255,255,255,0.28)"
          : "rgba(255,255,255,0.14)",
      }}
    >
      {children}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    background: "linear-gradient(135deg, #c00000 0%, #a80000 100%)",
    color: "white",
    padding: "16px 32px 18px",
    boxShadow: "0 3px 12px rgba(0,0,0,0.12)",
    fontFamily: "Calibri, Arial, sans-serif",
    boxSizing: "border-box",
  },

  encadre: {
    borderRadius: 14,
    marginBottom: 22,
  },

  joint: {
    borderRadius: "12px 12px 0 0",
    boxShadow: "none",
  },

  ligneHaute: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },

  marque: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },

  logo: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: 0.5,
  },

  separateur: {
    opacity: 0.55,
    fontSize: 18,
  },

  section: {
    fontSize: 16,
    fontWeight: 600,
    opacity: 0.95,
  },

  actions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  bouton: {
    color: "white",
    border: "1px solid rgba(255,255,255,0.40)",
    borderRadius: 8,
    padding: "8px 14px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease",
  },

  ligneTitre: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 20,
    flexWrap: "wrap",
    marginTop: 18,
  },

  titre: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: "-0.4px",
  },

  description: {
    marginTop: 4,
    opacity: 0.9,
    fontSize: 15,
  },

  actionsPage: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
};
