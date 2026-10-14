"use client";

import type { CSSProperties, ReactNode } from "react";
import { numeroSemaineISO, periodeCourte } from "@/lib/grilleSemaine";

/* ===============================================================
   MA SEMAINE - EN-TETE COMPACT (ordinateur)

   Remplace le titre, la carte de la semaine et les quatre grandes cartes de
   totaux par UNE barre : navigation entre les semaines, semaine affichée,
   totaux (saisies, heures supplémentaires, récupération, tickets) et bouton du
   week-end. Les explications passent dans des pastilles « i » : un clic les
   affiche. Rien n'est calculé ici : la page fournit les valeurs déjà formatées.

   Les enfants (la barre « Reprendre les affaires / Aide ») s'affichent dans la
   même carte, sous la barre. Quand `actif` est faux (téléphone), le composant ne
   dessine rien d'autre que ses enfants.
================================================================ */

export type EnteteSemaineCompactProps = {
  actif?: boolean; // faux : seulement les enfants (téléphone)
  children?: ReactNode;

  debut: string; // lundi de la semaine, AAAA-MM-JJ
  fin: string; // dimanche de la semaine, AAAA-MM-JJ

  saisies: string; // « 32 »
  prevues: string; // « 35 »

  heuresSup: string; // « 1 »
  heuresSupPositives: boolean;
  supMensuelles: string | null; // cumul sur la période mensuelle, null si aucun
  cloture: boolean; // semaine de clôture mensuelle
  libellePeriode: string;
  repartitionCompteur: string | null; // choix fait à la clôture
  repartitionPayee: string;

  compteur: string; // compteur de récupération après cette semaine
  compteurAlerte: boolean;
  compteurBase: string; // en début de semaine
  recuperation: string | null; // heures de récupération saisies cette semaine

  tickets: number;

  statutTexte: string;
  statutStyle: CSSProperties;

  weekendOuvert: boolean;
  onBasculerWeekend: () => void;
  onPrecedente: () => void;
  onSuivante: () => void;
};

const C = { rouge: "#c00000", encre: "#222222", gris: "#5b6168", ligne: "#e3e3e3", vert: "#138113" };

const bouton: CSSProperties = {
  minHeight: 44,
  padding: "0 14px",
  border: "1.5px solid #b9bec5",
  background: "#ffffff",
  color: "#222222",
  fontWeight: 700,
  fontSize: 14,
  fontFamily: "inherit",
  borderRadius: 8,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function Info({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <details style={{ position: "relative", display: "inline-block", marginLeft: 2 }}>
      <summary
        aria-label={`Détail : ${titre}`}
        title="Cliquer pour le détail"
        style={{
          listStyle: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `1.5px solid ${C.gris}`,
          color: C.gris,
          fontSize: 12,
          fontWeight: 800,
          cursor: "pointer",
          background: "#ffffff",
        }}
      >
        i
      </summary>
      <div
        role="note"
        style={{
          position: "absolute",
          top: 30,
          right: -8,
          zIndex: 40,
          width: 330,
          maxWidth: "80vw",
          padding: "12px 14px",
          background: "#ffffff",
          border: "1.5px solid #b9bec5",
          borderRadius: 10,
          boxShadow: "0 8px 22px rgba(0,0,0,.18)",
          fontSize: 13,
          lineHeight: 1.45,
          color: "#333333",
          whiteSpace: "normal",
          textAlign: "left",
          fontWeight: 400,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{titre}</div>
        {children}
      </div>
    </details>
  );
}

function Pastille({ libelle, children, info }: { libelle: string; children: ReactNode; info?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        minHeight: 44,
        padding: "0 12px",
        background: "#f6f7f8",
        border: `1px solid ${C.ligne}`,
        borderRadius: 10,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".3px", textTransform: "uppercase", color: C.gris }}>{libelle}</span>
      <strong style={{ fontSize: 18 }}>{children}</strong>
      {info}
    </div>
  );
}

export default function EnteteSemaineCompact(p: EnteteSemaineCompactProps) {
  if (p.actif === false) return <>{p.children}</>;

  const numero = String(numeroSemaineISO(p.debut)).padStart(2, "0");

  return (
    <section
      aria-label="Semaine et totaux"
      style={{
        background: "#ffffff",
        border: `1px solid ${C.ligne}`,
        borderRadius: 11,
        boxShadow: "0 2px 8px rgba(0,0,0,.06)",
        padding: "10px 14px",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={p.onPrecedente} style={bouton} aria-label="Semaine précédente">
          ◀ Précédente
        </button>

        <div style={{ textAlign: "center", lineHeight: 1.15, minWidth: 128 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.rouge }}>S{numero}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#3b4046" }}>{periodeCourte(p.debut, p.fin)}</div>
          <div style={{ ...p.statutStyle, fontSize: 11, lineHeight: 1.2, margin: 0, padding: 0, background: "transparent", border: 0 }}>{p.statutTexte}</div>
        </div>

        <button type="button" onClick={p.onSuivante} style={bouton} aria-label="Semaine suivante">
          Suivante ▶
        </button>

        <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: C.ligne, margin: "0 4px" }} />

        <Pastille libelle="Saisies">
          {p.saisies} h <span style={{ fontSize: 13, fontWeight: 700, color: C.gris }}>/ {p.prevues} h</span>
        </Pastille>

        <Pastille
          libelle="Heures sup"
          info={
            <Info titre={`Heures supplémentaires : ${p.heuresSupPositives ? "+" : ""}${p.heuresSup} h`}>
              <div>Calculées jour par jour. Elles sont conservées dans le cumul mensuel jusqu’à la clôture.</div>
              {p.supMensuelles !== null && p.cloture && (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #d8b56a", background: "#fffaf0", fontSize: 12 }}>
                  <strong>⚠ Clôture mensuelle — {p.libellePeriode}</strong>
                  <div style={{ marginTop: 3 }}>
                    Total à répartir : <strong>+{p.supMensuelles} h</strong>
                  </div>
                  <div style={{ marginTop: 3, color: "#666666" }}>
                    {p.repartitionCompteur !== null
                      ? `${p.repartitionCompteur} h au compteur · ${p.repartitionPayee} h payées`
                      : "La répartition compteur / heures payées doit être choisie avant la validation."}
                  </div>
                </div>
              )}
              {p.supMensuelles !== null && !p.cloture && (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #d7d7d7", background: "#fafafa", fontSize: 12 }}>
                  Cumul provisoire sur la période mensuelle : <strong>+{p.supMensuelles} h</strong>.
                  <br />
                  La répartition compteur / heures payées sera demandée lors de la semaine de clôture.
                </div>
              )}
            </Info>
          }
        >
          <span style={{ color: p.heuresSupPositives ? C.vert : "#333333" }}>
            {p.heuresSupPositives ? "+" : ""}
            {p.heuresSup} h
          </span>
        </Pastille>

        <Pastille
          libelle="Récup."
          info={
            <Info titre="Compteur de récupération">
              <div>
                Début de semaine : <strong>{p.compteurBase} h</strong>
              </div>
              {p.recuperation !== null && <div>− {p.recuperation} h de récupération saisie</div>}
              {p.cloture && p.repartitionCompteur !== null && <div>+ {p.repartitionCompteur} h affectées au compteur ce mois-ci</div>}
              {!p.cloture && p.supMensuelles !== null && <div>+ {p.supMensuelles} h en cours d’accumulation mensuelle</div>}
            </Info>
          }
        >
          <span style={{ color: p.compteurAlerte ? C.rouge : "#333333" }}>{p.compteur} h</span>
        </Pastille>

        <Pastille libelle="Tickets">{p.tickets}</Pastille>

        <span style={{ flex: 1 }} />

        <button type="button" onClick={p.onBasculerWeekend} style={bouton} aria-pressed={p.weekendOuvert}>
          {p.weekendOuvert ? "Masquer le week-end" : "Afficher le week-end"}
        </button>
      </div>

      {p.children && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.ligne}` }}>{p.children}</div>}

      {p.cloture && (
        <div style={{ marginTop: 10, padding: "7px 12px", borderRadius: 8, border: "1px solid #d9b45f", background: "#fff9e9", color: "#6b5100", fontSize: 13, lineHeight: 1.4 }}>
          <strong>Clôture mensuelle — {p.libellePeriode}.</strong> Cette semaine permet de répartir les heures supplémentaires cumulées entre le compteur de récupération et les heures payées.
        </div>
      )}
    </section>
  );
}
