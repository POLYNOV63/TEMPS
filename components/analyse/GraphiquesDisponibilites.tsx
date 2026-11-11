"use client";

import { C, page } from "@/components/pilotage/ui";
import { numeroSemaine } from "@/lib/pilotagePlanning";
import { NIVEAUX, type DonneeActivite } from "@/lib/disponibilitesActivites";

/* ===============================================================
   LES 3 GRAPHIQUES DE DISPONIBILITÉ PAR ACTIVITÉ (DISPOS_PARTAGEES)
   Page « Disponibilités par activité » et tableau de bord de la Direction.
   Une barre par semaine : hauteur = capacité ; occupées (couleur de
   l'activité, prévisionnel hachuré) ; disponibles par niveau.
================================================================ */

const h = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} h`;
const somme = (v: number[]) => v.reduce((t, x) => t + x, 0);

export default function GraphiquesDisponibilites({
  donnees,
  semaines,
  lundiActuel,
  selection,
  onBarre,
  hauteur = 150,
  aide = "La hauteur totale d’une barre est la capacité de la semaine. Cliquez sur une barre ou une case pour voir le détail par personne.",
}: {
  donnees: DonneeActivite[];
  semaines: string[];
  lundiActuel: string;
  selection?: { cle: string; w: number } | null;
  onBarre?: (cle: string, w: number) => void;
  hauteur?: number;
  aide?: string;
}) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 16 }}>
        {donnees.map((d) => {
          const max = Math.max(1, ...d.capa, ...d.occ);
          return (
            <section key={d.cle} style={{ ...page.carte, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 18, color: d.couleur }}>{d.libelle}</h2>
                <span style={{ fontSize: 12, color: C.gris }}>
                  {d.personnes.length} personne{d.personnes.length > 1 ? "s" : ""} · {h(somme(d.dispo))} disponibles sur {semaines.length} semaines
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: hauteur, borderBottom: `1px solid ${C.ligne}` }}>
                {semaines.map((l, w) => {
                  const capa = d.capa[w];
                  const occ = d.occ[w];
                  // DISPOS_SANS_SURCHARGE : plus de surcharge dans le graphique
                  const occUtile = Math.max(0, capa - d.dispo[w]);
                  const choisie = selection?.cle === d.cle && selection.w === w;
                  return (
                    <div
                      key={l}
                      title={`S${numeroSemaine(l)} : capacité ${h(capa)} · occupées ${h(occ)} · disponibles ${h(d.dispo[w])}${
                        d.dispo[w] >= 0.5
                          ? ` (${NIVEAUX.map((nv, k) => (d.parNiveau[k][w] >= 0.5 ? `${nv.libelle.replace("Niveau non renseigné", "non renseigné")} ${h(d.parNiveau[k][w])}` : "")).filter(Boolean).join(", ")})`
                          : ""
                      }${d.prev[w] >= 0.5 ? ` · dont prévisionnel ${h(d.prev[w])}` : ""}`}
                      onClick={onBarre ? () => onBarre(d.cle, w) : undefined}
                      style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column-reverse", cursor: onBarre ? "pointer" : "default", outline: choisie ? `2px solid ${C.encre}` : undefined }}
                    >
                      <div style={{ height: `${(Math.max(0, occUtile - d.prevUtile[w]) / max) * 100}%`, background: d.couleur, opacity: 0.85 }} />
                      {d.prevUtile[w] > 0 && (
                        <div style={{ height: `${(d.prevUtile[w] / max) * 100}%`, background: "repeating-linear-gradient(45deg,#8e9aa8,#8e9aa8 3px,#c3cad3 3px,#c3cad3 6px)" }} />
                      )}
                      {/* disponibles, du niveau 3 (foncé, en bas) au niveau 1 (clair), puis non renseigné */}
                      {[2, 1, 0, 3].map((k) => (d.parNiveau[k][w] > 0 ? <div key={k} style={{ height: `${(d.parNiveau[k][w] / max) * 100}%`, background: NIVEAUX[k].couleur }} /> : null))}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                {semaines.map((l) => (
                  <div key={l} style={{ flex: 1, textAlign: "center", fontSize: 10, color: l === lundiActuel ? C.rougeFonce : C.gris, fontWeight: l === lundiActuel ? 800 : 600 }}>
                    S{numeroSemaine(l)}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, margin: "-6px 0 16px" }}>
        <span>
          <i style={{ display: "inline-block", width: 12, height: 12, background: "#7b8189", verticalAlign: "middle" }} /> occupées (couleur de l’activité)
        </span>
        <span>
          <i style={{ display: "inline-block", width: 12, height: 12, background: "repeating-linear-gradient(45deg,#8e9aa8,#8e9aa8 3px,#c3cad3 3px,#c3cad3 6px)", verticalAlign: "middle" }} /> dont prévisionnel (non
          confirmé)
        </span>
        {NIVEAUX.map((nv) => (
          <span key={nv.n} title={nv.aide}>
            <i style={{ display: "inline-block", width: 12, height: 12, background: nv.couleur, verticalAlign: "middle", border: "1px solid #c9d1c9" }} /> disponibles · {nv.libelle.toLowerCase()}
            {nv.n > 0 ? <span style={{ color: C.gris }}> ({nv.aide})</span> : null}
          </span>
        ))}
        {aide && <span style={{ color: C.gris }}>{aide}</span>}
      </div>
    </>
  );
}
