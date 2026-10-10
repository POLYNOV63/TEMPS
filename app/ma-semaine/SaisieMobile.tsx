"use client";

import type { CSSProperties } from "react";

/* ===============================================================
   MA SEMAINE - SAISIE SUR TELEPHONE

   Barre fixe en bas de l'écran (affichée uniquement sur téléphone) :
     - navigation d'un jour à l'autre ;
     - Enregistrer et Valider ma semaine, toujours à portée de pouce.

   La logique (enregistrement, validation, contrôles) reste dans
   MaSemaineContent.tsx : cette barre ne fait que déclencher les mêmes
   actions que les boutons de la version ordinateur.
================================================================ */

export function BarreActionsMobile({
  jourLibelle,
  peutPrecedent,
  peutSuivant,
  onPrecedent,
  onSuivant,
  onEnregistrer,
  onValider,
  enregistrement,
  boutonsBloques,
  validationBloquee,
  validee,
  modifiee,
}: {
  jourLibelle: string;
  peutPrecedent: boolean;
  peutSuivant: boolean;
  onPrecedent: () => void;
  onSuivant: () => void;
  onEnregistrer: () => void;
  onValider: () => void;
  enregistrement: boolean;
  boutonsBloques: boolean;
  validationBloquee: boolean;
  validee: boolean;
  modifiee: boolean;
}) {
  return (
    <div style={styles.barre} role="toolbar" aria-label="Jour et actions de la feuille">
      <div style={styles.navigation}>
        <button
          type="button"
          onClick={onPrecedent}
          disabled={!peutPrecedent}
          style={{ ...styles.fleche, opacity: peutPrecedent ? 1 : 0.35 }}
          aria-label="Jour précédent"
        >
          ◀
        </button>

        <div style={styles.jour}>
          <strong>{jourLibelle}</strong>
          {modifiee && <span style={styles.modifiee}>● non enregistré</span>}
        </div>

        <button
          type="button"
          onClick={onSuivant}
          disabled={!peutSuivant}
          style={{ ...styles.fleche, opacity: peutSuivant ? 1 : 0.35 }}
          aria-label="Jour suivant"
        >
          ▶
        </button>
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          onClick={onEnregistrer}
          disabled={boutonsBloques}
          style={{ ...styles.brouillon, opacity: boutonsBloques ? 0.5 : 1 }}
        >
          {enregistrement ? "Enregistrement…" : "💾 Enregistrer"}
        </button>

        <button
          type="button"
          onClick={onValider}
          disabled={validationBloquee}
          style={{ ...styles.valider, opacity: validationBloquee ? 0.5 : 1 }}
        >
          {validee ? "✓ Semaine validée" : "✓ Valider"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  barre: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 60,
    background: "#ffffff",
    borderTop: "1px solid #d8d8d8",
    boxShadow: "0 -4px 14px rgba(0,0,0,.12)",
    padding: "8px 12px calc(10px + env(safe-area-inset-bottom, 0px))",
    display: "grid",
    gap: 8,
    fontFamily: "Calibri, Arial, sans-serif",
  },

  navigation: {
    display: "grid",
    gridTemplateColumns: "48px minmax(0, 1fr) 48px",
    alignItems: "center",
    gap: 8,
  },

  fleche: {
    height: 44,
    border: "1px solid #cfcfcf",
    borderRadius: 10,
    background: "#fff",
    color: "#c00000",
    fontSize: 18,
    fontWeight: 800,
    fontFamily: "inherit",
  },

  jour: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    fontSize: 16,
    lineHeight: 1.2,
  },

  modifiee: {
    fontSize: 11,
    color: "#a05a00",
    fontWeight: 800,
  },

  actions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },

  brouillon: {
    height: 46,
    border: "1px solid #cfcfcf",
    borderRadius: 10,
    background: "#fff",
    color: "#333",
    fontSize: 15,
    fontWeight: 800,
    fontFamily: "inherit",
  },

  valider: {
    height: 46,
    border: "none",
    borderRadius: 10,
    background: "#138113",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    fontFamily: "inherit",
  },
};
