"use client";

import { useState } from "react";
import { C, page } from "@/components/pilotage/ui";
import { aISO, ajouterJours, numeroSemaine } from "@/lib/pilotagePlanning";
import { formatDate } from "@/lib/pilotageCalculs";
import { NIVEAUX, type DonneeActivite } from "@/lib/disponibilitesActivites";
import { exporterExcelPolynov, type ColonneExcel } from "@/lib/excelPolynov";

/* ===============================================================
   RÉCAPITULATIF EN HEURES DES DISPONIBILITÉS PAR ACTIVITÉ (RECAP_PARTAGE)
   Un bloc par activité (capacité, occupées, dont prévisionnel,
   disponibles et leur détail par niveau), une colonne par semaine, et
   le bouton « Exporter en Excel ».
   Sert dans l'Analyse de capacité (onglet « Disponibilités à venir »,
   un clic sur une cellule ouvre le détail de la semaine) et sur le
   tableau de bord de la Direction.
================================================================ */

const ROUGE = "#c62828";

export default function RecapDisponibilites({
  donnees,
  semaines,
  lundi,
  fenetreFin,
  lundiActuel,
  chargement = false,
  onCellule,
  ouvert = true,
}: {
  donnees: DonneeActivite[];
  semaines: string[];
  lundi: string;
  fenetreFin: string;
  lundiActuel: string;
  chargement?: boolean;
  selection?: { cle: string; w: number } | null;
  onCellule?: (cle: string, w: number) => void;
  ouvert?: boolean;
}) {
  const somme = (v: number[]) => v.reduce((t, x) => t + x, 0);
  const h = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} h`;

  /* EXPORT_RECAP : le récapitulatif en heures, tel qu'il est affiché (mêmes lignes, valeurs arrondies à l'heure) */
  const [exportEnCours, setExportEnCours] = useState(false);
  async function exporterRecap() {
    setExportEnCours(true);
    try {
      const colonnes: ColonneExcel[] = [
        { titre: "Activité", cle: "activite", largeur: 14 },
        { titre: "Mesure", cle: "mesure", largeur: 34 },
        ...semaines.map((l, w) => ({ titre: `S${numeroSemaine(l)}
${formatDate(l)}`, cle: `s${w}`, largeur: 11, format: "nombre" as const })),
        { titre: `${semaines.length} sem.`, cle: "total", largeur: 11, format: "nombre" as const, formule: `SUM([s0]:[s${semaines.length - 1}])` },
      ];
      const lignes: Record<string, string | number | null>[] = [];
      for (const d of donnees) {
        const ajouter = (mesure: string, v: number[], style?: "groupe" | "detail") => {
          const l: Record<string, string | number | null> = { activite: d.libelle, mesure, total: Math.round(somme(v)) };
          v.forEach((x, w) => (l[`s${w}`] = Math.round(x)));
          if (style) l._style = style;
          lignes.push(l);
        };
        ajouter("Capacité", d.capa);
        ajouter("Occupées", d.occ);
        if (d.prev.some((x) => x >= 0.5)) ajouter("dont prévisionnel (non confirmé)", d.prev, "detail");
        ajouter("Disponibles", d.dispo, "groupe");
        NIVEAUX.forEach((nv, i) => {
          if (nv.n > 0 || d.parNiveau[i].some((x) => x >= 0.5))
            ajouter(`dont ${nv.libelle.replace("Niveau non renseigné", "non renseigné").toLowerCase()}`, d.parNiveau[i], "detail");
        });
      }
      await exporterExcelPolynov(`Disponibilites_S${numeroSemaine(lundi)}_${lundi}`, [
        {
          nom: "Récapitulatif",
          titre: `Disponibilités par activité · S${numeroSemaine(lundi)} → S${numeroSemaine(semaines[semaines.length - 1] ?? lundi)}`,
          sousTitre: `Récapitulatif en heures, ${formatDate(lundi)} → ${formatDate(ajouterJours(fenetreFin, -2))} · extrait le ${formatDate(aISO(new Date()))}`,
          colonnes,
          lignes,
          notes: [
            "Chaque activité regroupe les personnes dont c’est une activité principale (fiche collaborateur), encadrement exclu ; une personne qui a plusieurs activités principales compte dans chacune : les activités ne s’additionnent pas entre elles.",
            "Occupées : tout ce qui est planifié (affaires, PE / PI, hors affaire, prévisionnel). Disponibles : heures libres de chacun, détaillées par niveau ; une valeur négative signale une surcharge.",
          ],
        },
      ]);
    } finally {
      setExportEnCours(false);
    }
  }

  return (
  // RECAP_PAR_ACTIVITE : un bloc par activité, bien séparés (titre de couleur, son propre tableau)
  <details open={ouvert} /* DEPLIE_PAR_DEFAUT */ style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
    <summary style={{ cursor: "pointer", fontSize: 18, fontWeight: 800, minHeight: 32 }}>Récapitulatif, en heures</summary>
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "4px 0 12px" }}>
      <button
        type="button"
        onClick={() => void exporterRecap()}
        disabled={exportEnCours || chargement || donnees.length === 0}
        style={{ minHeight: 36, border: `1.5px solid ${C.rouge}`, background: "#ffffff", color: C.rougeFonce, borderRadius: 8, padding: "0 14px", fontWeight: 800, fontFamily: "inherit", cursor: exportEnCours ? "wait" : "pointer" }}
      >
        {exportEnCours ? "Export…" : "⬇ Exporter en Excel"}
      </button>
    </div>
    {donnees.map((d, ia) => (
      <div
        key={d.cle}
        style={{
          border: `1px solid ${C.ligne}`,
          borderLeft: `6px solid ${d.couleur}`,
          borderRadius: 10,
          marginTop: ia === 0 ? 0 : 22,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10, padding: "8px 12px", background: `${d.couleur}14`, borderBottom: `1px solid ${C.ligne}` }}>
          <strong style={{ fontSize: 17, color: d.couleur, textTransform: "uppercase", letterSpacing: ".4px" }}>{d.libelle}</strong>
          <span style={{ fontSize: 13, color: C.gris }}>
            {d.personnes.length} personne{d.personnes.length > 1 ? "s" : ""} · {h(somme(d.dispo))} disponibles sur 12 semaines
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 980, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 190 }} />
              {semaines.map((l) => (
                <col key={l} />
              ))}
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...page.th, background: "#f7f8f9" }} />
                {semaines.map((l) => (
                  <th key={l} style={{ ...page.th, textAlign: "center", padding: "6px 2px", background: l === lundiActuel ? "#fff4f4" : "#f7f8f9" }}>
                    S{numeroSemaine(l)}
                  </th>
                ))}
                <th style={{ ...page.th, textAlign: "center", background: "#f7f8f9" }}>12 sem.</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Capacité", d.capa, null],
                  ["Occupées", d.occ, null],
                  ...(d.prev.some((x) => x >= 0.5) ? [["dont prévisionnel (non confirmé)", d.prev, "PREV"] as [string, number[], "PREV"]] : []),
                  ["Disponibles", d.dispo, null],
                  ...NIVEAUX.map((nv, i) => [`dont ${nv.libelle.replace("Niveau non renseigné", "non renseigné").toLowerCase()}`, d.parNiveau[i], nv] as [string, number[], (typeof NIVEAUX)[number]])
                    .filter(([, v, nv]) => nv && (nv.n > 0 || v.some((x) => x >= 0.5))),
                ] as [string, number[], (typeof NIVEAUX)[number] | "PREV" | null][]
              ).map(([lib, v, nvOuPrev]) => {
                if (nvOuPrev === "PREV")
                  return (
                    <tr key={lib}>
                      <th scope="row" style={{ textAlign: "left", padding: "2px 8px 2px 18px", fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#5b6168", borderBottom: `1px solid ${C.ligne}` }}>
                        {lib}
                      </th>
                      {v.map((x, w) => (
                        <td key={w} style={{ textAlign: "center", padding: "2px", fontSize: 12, fontStyle: "italic", color: x >= 0.5 ? "#5b6168" : C.gris, borderBottom: `1px solid ${C.ligne}` }}>
                          {x >= 0.5 ? Math.round(x).toLocaleString("fr-FR") : "—"}
                        </td>
                      ))}
                      <td style={{ textAlign: "center", fontSize: 12, fontWeight: 700, fontStyle: "italic", color: "#5b6168", borderBottom: `1px solid ${C.ligne}` }}>{Math.round(somme(v)).toLocaleString("fr-FR")}</td>
                    </tr>
                  );
                const nv = nvOuPrev;
                const dispo = lib === "Disponibles";
                if (nv)
                  return (
                    <tr key={lib}>
                      <th scope="row" style={{ textAlign: "left", padding: "2px 8px 2px 18px", fontSize: 12, fontWeight: 600, color: "#3b4046", borderBottom: `1px solid ${C.ligne}` }} title={nv.aide}>
                        <i style={{ display: "inline-block", width: 10, height: 10, background: nv.couleur, border: "1px solid #c9d1c9", marginRight: 6, verticalAlign: "middle" }} />
                        {lib}
                      </th>
                      {v.map((x, w) => (
                        <td key={w} style={{ textAlign: "center", padding: "2px", fontSize: 12, color: x >= 0.5 ? "#1b5e20" : C.gris, borderBottom: `1px solid ${C.ligne}` }}>
                          {x >= 0.5 ? Math.round(x).toLocaleString("fr-FR") : "—"}
                        </td>
                      ))}
                      <td style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "#1b5e20", borderBottom: `1px solid ${C.ligne}` }}>{Math.round(somme(v)).toLocaleString("fr-FR") || "—"}</td>
                    </tr>
                  );
                return (
                  <tr key={lib} style={{ background: dispo ? "#f6fbf7" : undefined }}>
                    <th scope="row" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13, borderBottom: `1px solid ${C.ligne}` }}>
                      <span style={{ fontWeight: dispo ? 800 : 600, color: dispo ? "#1b5e20" : "#3b4046" }}>{lib}</span>
                    </th>
                    {v.map((x, w) => (
                      <td
                        key={w}
                        onClick={onCellule ? () => onCellule(d.cle, w) : undefined}
                        style={{
                          textAlign: "center",
                          padding: "6px 2px",
                          fontSize: 13,
                          cursor: onCellule ? "pointer" : undefined,
                          fontWeight: dispo ? 800 : 500,
                          color: dispo ? (x < -0.5 ? ROUGE : x >= 0.5 ? "#1b5e20" : C.gris) : "#3b4046",
                          borderBottom: `1px solid ${C.ligne}`,
                          background: semaines[w] === lundiActuel ? "#fffafa" : undefined,
                        }}
                      >
                        {Math.abs(x) < 0.5 ? "—" : `${dispo && x < 0 ? "▲ " : ""}${Math.round(Math.abs(x)).toLocaleString("fr-FR")}`}
                      </td>
                    ))}
                    <td style={{ textAlign: "center", fontWeight: 800, fontSize: 13, color: dispo ? (somme(v) < 0 ? ROUGE : "#1b5e20") : "#3b4046", borderBottom: `1px solid ${C.ligne}` }}>
                      {Math.round(Math.abs(somme(v))).toLocaleString("fr-FR")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    ))}
  </details>
  );
}
