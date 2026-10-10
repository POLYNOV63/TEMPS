"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

/* ===============================================================
   MA SEMAINE - PRESSE-PAPIERS DE BLOCS

   Composants d'affichage du copier-coller de blocs d'imputations
   et d'absences. La logique (copie, collage, calculs) reste dans
   MaSemaineContent.tsx, qui connaît les règles métier de la feuille.

   BoutonLecture : bouton de COPIE. C'est volontairement un <span>
   et non un <button> : il reste utilisable même quand la feuille
   est verrouillée ou validée (la zone de saisie est alors désactivée
   par un <fieldset disabled>), car copier ne modifie rien. Cela
   permet par exemple de recopier la semaine précédente, déjà
   validée, dans la semaine en cours.
================================================================ */

export function BoutonLecture({
  onClick,
  title,
  actif = false,
  children,
}: {
  onClick: () => void;
  title?: string;
  actif?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      aria-pressed={actif}
      onClick={onClick}
      onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        ...styles.boutonLecture,
        ...(actif ? styles.boutonLectureActif : {}),
      }}
    >
      {children}
    </span>
  );
}

export type JourCible = {
  date: string;
  libelle: string;
  ferie: boolean;
};

export function BarrePressePapiers({
  nbLignes,
  totalHeures,
  resumeAbsence,
  jours,
  cibles,
  onChangerCibles,
  onCollerImputations,
  onCollerAbsence,
  onVider,
  desactive,
}: {
  nbLignes: number;
  totalHeures: string;
  resumeAbsence: string | null;
  jours: JourCible[];
  cibles: string[];
  onChangerCibles: (dates: string[]) => void;
  onCollerImputations: () => void;
  onCollerAbsence: () => void;
  onVider: () => void;
  desactive: boolean;
}) {
  if (nbLignes === 0 && !resumeAbsence) {
    return null;
  }

  function basculer(date: string) {
    onChangerCibles(
      cibles.includes(date)
        ? cibles.filter((d) => d !== date)
        : [...cibles, date]
    );
  }

  const joursOuvres = jours.filter((j) => !j.ferie).map((j) => j.date);
  const aucuneCible = cibles.length === 0;

  return (
    <div style={styles.barre}>
      <div style={styles.ligneHaute}>
        <div style={styles.contenu}>
          <strong>📋 Presse-papiers</strong>

          {nbLignes > 0 && (
            <span style={styles.pastille}>
              {nbLignes} imputation{nbLignes > 1 ? "s" : ""} · {totalHeures} h
            </span>
          )}

          {resumeAbsence && (
            <span style={styles.pastilleAbsence}>Absence : {resumeAbsence}</span>
          )}
        </div>

        <span
          role="button"
          tabIndex={0}
          onClick={onVider}
          onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onVider();
            }
          }}
          style={styles.vider}
        >
          Vider
        </span>
      </div>

      <div style={styles.ligneCibles}>
        <span style={styles.etiquette}>Coller sur plusieurs jours :</span>

        {jours.map((jour) => (
          <label key={jour.date} style={styles.cible}>
            <input
              type="checkbox"
              checked={cibles.includes(jour.date)}
              disabled={desactive}
              onChange={() => basculer(jour.date)}
            />
            {jour.libelle}
            {jour.ferie ? " (férié)" : ""}
          </label>
        ))}

        <button
          type="button"
          disabled={desactive}
          onClick={() => onChangerCibles(joursOuvres)}
          style={styles.lien}
        >
          Jours ouvrés
        </button>

        <button
          type="button"
          disabled={desactive || aucuneCible}
          onClick={() => onChangerCibles([])}
          style={styles.lien}
        >
          Aucun
        </button>
      </div>

      <div style={styles.ligneActions}>
        {nbLignes > 0 && (
          <button
            type="button"
            disabled={desactive || aucuneCible}
            onClick={onCollerImputations}
            style={{
              ...styles.action,
              opacity: desactive || aucuneCible ? 0.5 : 1,
            }}
          >
            Coller les imputations sur {cibles.length} jour
            {cibles.length > 1 ? "s" : ""}
          </button>
        )}

        {resumeAbsence && (
          <button
            type="button"
            disabled={desactive || aucuneCible}
            onClick={onCollerAbsence}
            style={{
              ...styles.action,
              ...styles.actionAbsence,
              opacity: desactive || aucuneCible ? 0.5 : 1,
            }}
          >
            Coller l'absence sur {cibles.length} jour
            {cibles.length > 1 ? "s" : ""}
          </button>
        )}

        <span style={styles.aide}>
          Les jours fériés et les journées d'absence complète ne reçoivent pas
          d'imputation. Vous pouvez aussi coller jour par jour avec les boutons
          « Coller » de chaque journée.
        </span>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  boutonLecture: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    border: "1px solid #b9c7e0",
    background: "#f3f7ff",
    color: "#1f4e99",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    userSelect: "none",
    fontFamily: "Calibri, Arial, sans-serif",
  },

  boutonLectureActif: {
    background: "#1f4e99",
    borderColor: "#1f4e99",
    color: "white",
  },

  barre: {
    background: "#f3f7ff",
    border: "1px solid #b9c7e0",
    borderLeft: "5px solid #1f4e99",
    borderRadius: 10,
    padding: "12px 14px",
    margin: "0 0 14px",
    display: "grid",
    gap: 10,
    fontFamily: "Calibri, Arial, sans-serif",
    fontSize: 13,
    color: "#243b66",
  },

  ligneHaute: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },

  contenu: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  pastille: {
    background: "white",
    border: "1px solid #b9c7e0",
    borderRadius: 999,
    padding: "3px 10px",
    fontWeight: 700,
  },

  pastilleAbsence: {
    background: "#fff8e7",
    border: "1px solid #ead7a0",
    color: "#6b5100",
    borderRadius: 999,
    padding: "3px 10px",
    fontWeight: 700,
  },

  vider: {
    color: "#a00000",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
  },

  ligneCibles: {
    display: "flex",
    alignItems: "center",
    gap: "6px 14px",
    flexWrap: "wrap",
  },

  etiquette: {
    fontWeight: 700,
  },

  cible: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "white",
    border: "1px solid #d3dcee",
    borderRadius: 6,
    padding: "4px 8px",
    cursor: "pointer",
  },

  lien: {
    background: "transparent",
    border: "none",
    color: "#1f4e99",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
    fontSize: 13,
    fontFamily: "inherit",
    padding: 0,
  },

  ligneActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  action: {
    background: "#1f4e99",
    color: "white",
    border: "none",
    borderRadius: 7,
    padding: "9px 14px",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  },

  actionAbsence: {
    background: "#8b6a14",
  },

  aide: {
    color: "#566a8f",
    fontSize: 12,
    lineHeight: 1.4,
    flex: 1,
    minWidth: 240,
  },
};
