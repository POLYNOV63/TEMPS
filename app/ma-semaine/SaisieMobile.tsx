"use client";

import type { CSSProperties } from "react";

/* ===============================================================
   MA SEMAINE - SAISIE SUR TELEPHONE (SAISIE_MOBILE_V2)

   Barre fixe en bas de l'écran (téléphone seulement), sur UNE ligne :
   jour précédent · Enregistrer · Valider · jour suivant. Le jour affiché
   se choisit aussi dans la barre des jours, en haut.

   La logique (enregistrement, validation, contrôles) reste dans
   MaSemaineContent.tsx : cette barre déclenche les mêmes actions que les
   boutons de la version ordinateur.
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
      <button
        type="button"
        onClick={onPrecedent}
        disabled={!peutPrecedent}
        style={{ ...styles.fleche, opacity: peutPrecedent ? 1 : 0.35 }}
        aria-label={`Jour précédent (affiché : ${jourLibelle})`}
      >
        ◀
      </button>

      <button
        type="button"
        onClick={onEnregistrer}
        disabled={boutonsBloques}
        style={{ ...styles.brouillon, opacity: boutonsBloques ? 0.5 : 1, ...(modifiee ? styles.aEnregistrer : {}) }}
      >
        {enregistrement ? "…" : modifiee ? "● Enregistrer" : "Enregistrer"}
      </button>

      <button
        type="button"
        onClick={onValider}
        disabled={validationBloquee}
        style={{ ...styles.valider, opacity: validationBloquee ? 0.5 : 1 }}
      >
        {validee ? "✓ Validée" : "✓ Valider"}
      </button>

      <button
        type="button"
        onClick={onSuivant}
        disabled={!peutSuivant}
        style={{ ...styles.fleche, opacity: peutSuivant ? 1 : 0.35 }}
        aria-label={`Jour suivant (affiché : ${jourLibelle})`}
      >
        ▶
      </button>
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
    padding: "8px 10px calc(8px + env(safe-area-inset-bottom, 0px))",
    display: "grid",
    gridTemplateColumns: "48px 1fr 1fr 48px",
    gap: 8,
    fontFamily: "Calibri, Arial, sans-serif",
  },

  fleche: {
    height: 46,
    border: "1px solid #cfcfcf",
    borderRadius: 10,
    background: "#fff",
    color: "#c00000",
    fontSize: 18,
    fontWeight: 800,
    fontFamily: "inherit",
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

  aEnregistrer: {
    borderColor: "#e9b877",
    background: "#fff7ea",
    color: "#7a3e00",
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
