"use client";

import type { CSSProperties, KeyboardEvent } from "react";

/* ===============================================================
   MA SEMAINE - ASSISTANT DE SAISIE

   Composants d'affichage : bandeau de la semaine, affaires récentes,
   bouton « solde ». La logique (calculs, requêtes, règles métier)
   reste dans MaSemaineContent.tsx.
================================================================ */

export type AffaireRecente = {
  cle: string;
  typeAffaire: "CBE" | "DBE" | "Divers";
  activiteId: string | null;
  numeroAffaire: string;
  description: string;
  code: string;
  occurrences: number;
  dernierJour: string;
};

export type DemandeConges = {
  id: string;
  type_demande: string;
  date_debut: string;
  date_fin: string;
  duree_jours: number | null;
  heures_re: number | null;
};

export type JourBandeau = {
  date: string;
  libelle: string;
  etat: "COMPLET" | "MANQUE" | "FERIE" | "ABSENT";
  texte: string;
};

/* ---------------------------------------------------------------
   BANDEAU DE LA SEMAINE
--------------------------------------------------------------- */

export function BandeauSemaine({
  jours,
  resume,
  premierIncomplet,
  onAllerA,
  aideOuverte,
  onBasculerAide,
  desactive,
  repriseEnCours,
  onReprendre,
  propositionConges,
  congesIgnores,
  compact = false,
  jourSelectionne,
}: {
  jours: JourBandeau[];
  resume: string;
  premierIncomplet: string | null;
  onAllerA: (date: string) => void;
  aideOuverte: boolean;
  onBasculerAide: () => void;
  desactive: boolean;
  repriseEnCours: boolean;
  onReprendre: () => void;
  propositionConges: { libelle: string; onAppliquer: () => void } | null;
  congesIgnores: string[];
  /* Téléphone : bandeau réduit à une ligne de jours défilante */
  compact?: boolean;
  jourSelectionne?: string;
}) {
  return (
    <div style={styles.bandeau}>
      <div style={styles.ligne}>
        <div style={compact ? styles.pucesCompact : styles.puces}>
          {jours.map((jour) => (
            <a
              key={jour.date}
              href={`#jour-${jour.date}`}
              onClick={(e) => {
                e.preventDefault();
                onAllerA(jour.date);
              }}
              title="Aller à ce jour"
              style={{
                ...styles.puce,
                ...styleEtat(jour.etat),
                ...(compact ? styles.puceCompact : {}),
                ...(jourSelectionne === jour.date
                  ? { outline: "3px solid #1f4e99", outlineOffset: -2 }
                  : {}),
              }}
            >
              <span style={styles.puceJour}>{jour.libelle}</span>
              <span style={styles.puceTexte}>{jour.texte}</span>
            </a>
          ))}
        </div>

        {!compact && <div style={styles.resume}>{resume}</div>}
      </div>

      <div style={styles.ligneActions}>
        {premierIncomplet && !compact && (
          <a
            href={`#jour-${premierIncomplet}`}
            onClick={(e) => {
              e.preventDefault();
              onAllerA(premierIncomplet);
            }}
            style={styles.lien}
          >
            ↓ Aller au premier jour incomplet
          </a>
        )}

        <button
          type="button"
          onClick={onReprendre}
          disabled={desactive || repriseEnCours}
          title="Pré-remplit les jours vides avec les affaires de la semaine précédente (sans les heures)"
          style={{
            ...styles.bouton,
            opacity: desactive || repriseEnCours ? 0.5 : 1,
          }}
        >
          {repriseEnCours ? "Reprise en cours…" : "↺ Reprendre les affaires de la semaine précédente"}
        </button>

        <span
          role="button"
          tabIndex={0}
          aria-pressed={aideOuverte}
          onClick={onBasculerAide}
          onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onBasculerAide();
            }
          }}
          style={styles.lien}
        >
          {aideOuverte ? "ℹ️ Masquer l'aide" : "ℹ️ Aide à la saisie"}
        </span>
      </div>

      {propositionConges && (
        <div style={styles.conges}>
          <span>
            🗓 <strong>Congés validés cette semaine :</strong> {propositionConges.libelle}
          </span>

          <button
            type="button"
            onClick={propositionConges.onAppliquer}
            disabled={desactive}
            style={{ ...styles.boutonConges, opacity: desactive ? 0.5 : 1 }}
          >
            Appliquer à la feuille
          </button>
        </div>
      )}

      {congesIgnores.length > 0 && (
        <div style={styles.note}>
          À saisir manuellement (demi-journée) : {congesIgnores.join(" · ")}
        </div>
      )}
    </div>
  );
}

function styleEtat(etat: JourBandeau["etat"]): CSSProperties {
  if (etat === "COMPLET") {
    return { background: "#edf8ef", borderColor: "#b9dfbf", color: "#176b22" };
  }

  if (etat === "MANQUE") {
    return { background: "#fff0f0", borderColor: "#e0aaaa", color: "#a00000" };
  }

  return { background: "#f1f1f1", borderColor: "#d8d8d8", color: "#777" };
}

/* ---------------------------------------------------------------
   AFFAIRES RECENTES (propositions à l'ajout d'une ligne)
--------------------------------------------------------------- */

export function AffairesRecentes({
  ouvert,
  affaires,
  nomActivite,
  onBasculer,
  onChoisir,
}: {
  ouvert: boolean;
  affaires: AffaireRecente[];
  nomActivite: (id: string | null) => string;
  onBasculer: () => void;
  onChoisir: (affaire: AffaireRecente) => void;
}) {
  if (affaires.length === 0) return null;

  return (
    <div style={{ flex: ouvert ? "1 1 100%" : "0 0 auto" }}>
      <button type="button" onClick={onBasculer} style={styles.declencheur}>
        ⭐ Affaires récentes {ouvert ? "▴" : "▾"}
      </button>

      {ouvert && (
        <div style={styles.panneau}>
          <div style={styles.panneauTitre}>
            Cliquez sur une affaire : la ligne est créée, il ne reste que les heures.
          </div>

          <div style={styles.liste}>
            {affaires.map((affaire) => (
              <button
                key={affaire.cle}
                type="button"
                onClick={() => onChoisir(affaire)}
                style={styles.element}
              >
                <strong>
                  {affaire.typeAffaire === "Divers"
                    ? "Divers"
                    : `${affaire.typeAffaire} ${affaire.numeroAffaire}`}
                </strong>

                <span style={styles.elementDetail}>
                  {affaire.typeAffaire === "Divers"
                    ? affaire.code
                    : `${nomActivite(affaire.activiteId)} · ${affaire.code || "code à choisir"}`}
                </span>

                {affaire.description && (
                  <span style={styles.elementDescription}>{affaire.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   BOUTON « SOLDE »
--------------------------------------------------------------- */

export function BoutonSolde({
  heures,
  onClick,
}: {
  heures: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Ajouter à cette ligne les ${heures} h qu'il reste à saisir ce jour-là`}
      style={styles.solde}
    >
      +{heures}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  bandeau: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#ffffff",
    border: "1px solid #e1e1e1",
    borderRadius: 10,
    padding: "10px 12px",
    margin: "0 0 14px",
    boxShadow: "0 3px 10px rgba(0,0,0,.08)",
    display: "grid",
    gap: 8,
    fontFamily: "Calibri, Arial, sans-serif",
    fontSize: 13,
    color: "#333",
  },

  ligne: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },

  puces: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },

  pucesCompact: {
    display: "flex",
    gap: 6,
    flexWrap: "nowrap",
    overflowX: "auto",
    paddingBottom: 2,
    width: "100%",
  },

  puceCompact: {
    flex: "0 0 auto",
    minWidth: 66,
    padding: "6px 8px",
  },

  puce: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: 82,
    padding: "5px 9px",
    border: "1px solid",
    borderRadius: 8,
    textDecoration: "none",
    cursor: "pointer",
    lineHeight: 1.2,
  },

  puceJour: {
    fontSize: 11,
    fontWeight: 700,
  },

  puceTexte: {
    fontSize: 13,
    fontWeight: 800,
  },

  resume: {
    color: "#666",
    fontWeight: 700,
  },

  ligneActions: {
    display: "flex",
    alignItems: "center",
    gap: "6px 16px",
    flexWrap: "wrap",
  },

  lien: {
    color: "#1f4e99",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "underline",
  },

  bouton: {
    background: "#fff",
    color: "#333",
    border: "1px solid #cfcfcf",
    borderRadius: 7,
    padding: "7px 11px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  },

  conges: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    background: "#f3f7ff",
    border: "1px solid #b9c7e0",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#243b66",
  },

  boutonConges: {
    background: "#1f4e99",
    color: "white",
    border: "none",
    borderRadius: 7,
    padding: "7px 12px",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  },

  note: {
    color: "#7a5a00",
    fontSize: 12,
  },

  declencheur: {
    background: "#fff8e7",
    color: "#6b5100",
    border: "1px solid #ead7a0",
    borderRadius: 6,
    padding: "7px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "inherit",
    marginTop: 2,
  },

  panneau: {
    marginTop: 8,
    background: "#fffdf5",
    border: "1px solid #ead7a0",
    borderRadius: 8,
    padding: 10,
  },

  panneauTitre: {
    fontSize: 12,
    color: "#7a5a00",
    marginBottom: 8,
  },

  liste: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
    gap: 8,
  },

  element: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    background: "#ffffff",
    border: "1px solid #e4d9b8",
    borderLeft: "4px solid #c8a63b",
    borderRadius: 6,
    padding: "7px 9px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    color: "#333",
  },

  elementDetail: {
    color: "#555",
  },

  elementDescription: {
    color: "#888",
    fontStyle: "italic",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  solde: {
    flex: "0 0 auto",
    background: "#fff8e7",
    color: "#6b5100",
    border: "1px solid #ead7a0",
    borderRadius: 6,
    padding: "0 8px",
    fontWeight: 800,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  },
};
