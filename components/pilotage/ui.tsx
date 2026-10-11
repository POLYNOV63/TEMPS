"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Genre, TypeAffaire } from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - ELEMENTS D'INTERFACE COMMUNS
   (même charte que le reste de POLYNOV-TEMPS : rouge #c00000, Calibri)
================================================================ */

export const C = {
  rouge: "#c00000",
  rougeFonce: "#a30000",
  encre: "#1f2328",
  gris: "#5b6168",
  ligne: "#dfe2e6",
  fond: "#f3f4f6",
  bleuFond: "#e3eefb",
  bleuTexte: "#0b3f78",
  orangeFond: "#fdebd0",
  orangeTexte: "#7a3e00",
  rougeFond: "#fde1e1",
  rougeTexte: "#8f1010",
  neutreFond: "#e9edf2",
  neutreTexte: "#333a42",
};

export const page: Record<string, CSSProperties> = {
  fond: {
    minHeight: "100vh",
    background: C.fond,
    fontFamily: "Calibri, Arial, sans-serif",
    color: C.encre,
  },
  contenu: {
    maxWidth: 1240,
    margin: "0 auto",
    padding: "24px 28px 60px",
    boxSizing: "border-box",
  },
  titre: { margin: 0, fontSize: 30, fontWeight: 800 },
  sousTitre: { margin: "4px 0 0", color: C.gris },
  carte: {
    background: "#ffffff",
    border: `1px solid ${C.ligne}`,
    borderRadius: 12,
    padding: 20,
    boxSizing: "border-box",
  },
  entrees: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: 44,
    padding: "0 12px",
    fontSize: 16,
    fontFamily: "inherit",
    color: C.encre,
    background: "#ffffff",
    border: "1.5px solid #b9bec5",
    borderRadius: 8,
  },
  etiquette: { display: "block", fontWeight: 700, marginBottom: 6 },
  aide: { fontSize: 13, color: C.gris, marginTop: 4 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: ".4px",
    textTransform: "uppercase",
    color: "#454b52",
    background: "#f1f2f4",
    borderBottom: `1px solid ${C.ligne}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px",
    borderBottom: `1px solid ${C.ligne}`,
    verticalAlign: "middle",
  },
  btnPrimaire: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 8,
    border: `1.5px solid ${C.rouge}`,
    background: C.rouge,
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 15,
    fontFamily: "inherit",
    cursor: "pointer",
    textDecoration: "none",
  },
  btnSecondaire: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 8,
    border: `1.5px solid ${C.rouge}`,
    background: "#ffffff",
    color: C.rougeFonce,
    fontWeight: 700,
    fontSize: 15,
    fontFamily: "inherit",
    cursor: "pointer",
    textDecoration: "none",
  },
};

const PASTILLES: Record<Genre, { fond: string; texte: string; icone: string }> = {
  ok: { fond: C.bleuFond, texte: C.bleuTexte, icone: "✓" },
  warn: { fond: C.orangeFond, texte: C.orangeTexte, icone: "▲" },
  crit: { fond: C.rougeFond, texte: C.rougeTexte, icone: "✕" },
  info: { fond: C.neutreFond, texte: C.neutreTexte, icone: "●" },
};

/* L'icône et le texte accompagnent toujours la couleur : l'état ne repose jamais sur la couleur seule. */
export function Pastille({ genre, children }: { genre: Genre; children: ReactNode }) {
  const p = PASTILLES[genre];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 13,
        background: p.fond,
        color: p.texte,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 11 }}>
        {p.icone}
      </span>
      {children}
    </span>
  );
}

export function BadgeType({ type }: { type: TypeAffaire }) {
  const cbe = type === "CBE";

  return (
    <span
      style={{
        background: cbe ? C.rouge : "#f2bfd0",
        color: cbe ? "#ffffff" : "#5b1233",
        fontWeight: 800,
        fontSize: 12,
        padding: "3px 8px",
        borderRadius: 5,
        letterSpacing: ".3px",
      }}
    >
      {type}
    </span>
  );
}

export function Tuile({
  libelle,
  valeur,
  sous,
  accent,
}: {
  libelle: string;
  valeur: string;
  sous?: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        flex: "1 1 200px",
        background: "#ffffff",
        border: `1px solid ${C.ligne}`,
        borderRadius: 12,
        padding: "16px 18px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".5px",
          textTransform: "uppercase",
          color: C.gris,
        }}
      >
        {libelle}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          marginTop: 4,
          color: accent ? C.rougeTexte : C.encre,
        }}
      >
        {valeur}
      </div>
      {sous && <div style={{ fontSize: 13, color: C.gris, marginTop: 2 }}>{sous}</div>}
    </div>
  );
}

export function Message({
  genre,
  children,
}: {
  genre: "erreur" | "info" | "ok";
  children: ReactNode;
}) {
  const styles = {
    erreur: { background: "#ffe9e9", border: "1px solid #ffbcbc", color: "#a00000" },
    info: { background: "#f3f7ff", border: "1px solid #b9c7e0", color: "#243b66" },
    ok: { background: "#eaf6ec", border: "1px solid #b5dcbb", color: "#1d5a2a" },
  }[genre];

  return (
    <div
      role={genre === "erreur" ? "alert" : "status"}
      style={{
        ...styles,
        borderRadius: 10,
        padding: "12px 16px",
        fontWeight: 600,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

export function Modal({
  titre,
  onClose,
  children,
  largeur = 640,
}: {
  titre: string;
  onClose: () => void;
  children: ReactNode;
  largeur?: number;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,22,26,.5)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: 14,
          width: "100%",
          maxWidth: largeur,
          padding: 24,
          boxSizing: "border-box",
          boxShadow: "0 12px 40px rgba(0,0,0,.25)",
          fontFamily: "Calibri, Arial, sans-serif",
          color: C.encre,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 22 }}>{titre}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              minWidth: 44,
              minHeight: 44,
              border: "none",
              background: "transparent",
              fontSize: 26,
              cursor: "pointer",
              color: C.gris,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
