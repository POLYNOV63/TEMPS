"use client";

import { useEffect, useState } from "react";
import GraphiquesDisponibilites from "@/components/analyse/GraphiquesDisponibilites";
import { C, Message, page } from "@/components/pilotage/ui";
import { aISO, ajouterJours, lundiDe, numeroSemaine } from "@/lib/pilotagePlanning";
import { formatDate, formatHeures, nomCollab } from "@/lib/pilotageCalculs";
import { NIVEAUX, useDisponibilitesActivites } from "@/lib/disponibilitesActivites";
import { exporterExcelPolynov, type ColonneExcel } from "@/lib/excelPolynov";

/* ===============================================================
   RESSOURCES - DISPONIBILITÉS PAR ACTIVITÉ (RESSOURCES_FUSION)
   CAPACITE_DISPOS : affiché dans l'Analyse de capacité, onglet
   « Disponibilités à venir » ; le récapitulatif en heures s'exporte en
   Excel (une ligne par activité et par mesure, une colonne par semaine).
   Reprise de l'ancienne page « Disponibilités par activité », intégrée
   sous la charge de l'équipe dans la page Ressources. Les 12 semaines
   partent de la semaine analysée (pilotée par la page). Au-dessus des
   graphiques : la composition de chaque activité (nombre de personnes
   et niveaux, en nombres seulement).
   Ancien en-tête (CHARGE_ACTIVITES_V5) :
   ADMIN et DIRECTION (lecture seule, droit « chargeRessources »)

   Méca, Elec et Calcul, sur 12 semaines. Pour chaque activité, les
   personnes dont c'est l'activité principale (équipe hors encadrement) :
   - CAPACITÉ   : leurs heures disponibles (profil horaire, congés et
                  fériés déduits) ;
   - OCCUPÉES   : tout ce qui leur est planifié (affaires, PE / PI,
                  hors affaire) ;
   - DISPONIBLES : heures libres des personnes (capacité − occupées de
                  chacune, quand c'est positif), détaillées par NIVEAU
                  (fiche collaborateur, SQL 86) : 1 clair → 3 foncé ;
   - SURCHARGE   : heures planifiées au-delà de la capacité de chacun.
   Capacité − occupées = disponibles − surcharge.
   Le niveau n'est jamais affiché nominativement : seulement des totaux.
   V5 : dans les occupées, le PRÉVISIONNEL (charge probable, non confirmée,
   SQL 87) est montré à part (hachuré, ligne « dont prévisionnel »).
   Un graphique par activité, puis le tableau récapitulatif.
   V3 : une personne peut avoir PLUSIEURS activités principales (ex.
   Mécanique et Calcul) : elle compte alors dans chacune (les lignes ne
   s'additionnent pas entre activités).
   DISPOS_PARTAGEES : le calcul (lib/disponibilitesActivites.ts) et les
   graphiques (components/analyse/GraphiquesDisponibilites.tsx) servent
   aussi au tableau de bord de la Direction.
================================================================ */

const ROUGE = "#c62828";

/* barre des niveaux : N1 clair → N3 foncé, le nombre écrit dans chaque part */
function BarreNiveaux({ nb }: { nb: number[] }) {
  const total = nb.reduce((t, x) => t + x, 0);
  return (
    <span style={{ display: "inline-flex", height: 20, width: "100%", borderRadius: 5, overflow: "hidden", background: "#eef0f3" }}>
      {NIVEAUX.map((nv, k) =>
        nb[k] <= 0 ? null : (
          <span
            key={nv.n}
            title={`${nv.libelle} (${nv.aide}) : ${nb[k]} personne${nb[k] > 1 ? "s" : ""}`}
            style={{ width: `${(nb[k] / Math.max(1, total)) * 100}%`, background: nv.couleur, color: nv.n === 3 ? "#ffffff" : "#13361a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", borderRight: "2px solid #ffffff" }}
          >
            {nb[k] / Math.max(1, total) >= 0.2 ? `${nv.n === 0 ? "?" : `N${nv.n}`} · ${nb[k]}` : nb[k]}
          </span>
        )
      )}
    </span>
  );
}

export default function DisponibilitesActivites({ lundi }: { lundi: string }) {
  const [detail, setDetail] = useState<{ cle: string; w: number } | null>(null);
  useEffect(() => {
    if (detail) window.setTimeout(() => document.getElementById("detail-semaine")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }, [detail]);

  const { donnees, semaines, fenetreFin, chargement, erreur } = useDisponibilitesActivites(lundi, 12);
  const lundiActuel = lundiDe(aISO(new Date()));

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
    <div>
      <div id="disponibilites" style={{ margin: "8px 0 12px", scrollMarginTop: "calc(var(--hauteur-nav, 50px) + 12px)" }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>Disponibilités par activité · S{numeroSemaine(lundi)} → S{numeroSemaine(semaines[11] ?? lundi)}</h2>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: C.gris }}>
          Méca, Elec et Calcul : capacité, heures occupées et heures disponibles sur 12 semaines ({formatDate(lundi)} → {formatDate(ajouterJours(fenetreFin, -2))}). Tout découle du planning des affaires.
        </p>
      </div>
        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {/* COMPOSITION_ACTIVITES : qui compose chaque activité (nombres seulement, jamais de niveau nominatif) */}
        {!chargement && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 12 }}>
            {donnees.map((d) => (
              <div key={d.cle} style={{ ...page.carte, padding: "8px 12px", borderLeft: `5px solid ${d.couleur}` }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                  <strong style={{ color: d.couleur, textTransform: "uppercase", letterSpacing: ".4px" }}>{d.libelle}</strong>
                  <span style={{ fontSize: 13, color: C.gris }}>
                    {d.personnes.length} personne{d.personnes.length > 1 ? "s" : ""} en activité principale
                  </span>
                </div>
                {d.personnes.length > 0 ? <BarreNiveaux nb={NIVEAUX.map((nv) => d.personnes.filter((p) => p.niveau === nv.n).length)} /> : <span style={{ color: C.gris, fontSize: 13 }}>personne</span>}
              </div>
            ))}
          </div>
        )}

        {/* ---------- graphiques : une activité par carte ---------- */}
        <GraphiquesDisponibilites
          donnees={donnees}
          semaines={semaines}
          lundiActuel={lundiActuel}
          selection={detail}
          onBarre={(cle, w) => setDetail(detail?.cle === cle && detail.w === w ? null : { cle, w })}
        />

        {/* DETAIL_SOUS_GRAPHIQUES : le détail de la semaine cliquée, juste sous les graphiques */}
        {detail &&
          (() => {
            const d = donnees.find((x) => x.cle === detail.cle);
            if (!d) return null;
            const w = detail.w;
            const personnes = [...d.personnes].sort((a, b) => b.semaines[w].capa - b.semaines[w].occ - (a.semaines[w].capa - a.semaines[w].occ));
            const echelle = Math.max(1, ...personnes.map((p) => Math.max(p.semaines[w].capa, p.semaines[w].occ)));
            const vignette = (titre: string, valeur: string, couleur?: string, sous?: string) => (
              <div style={{ flex: "1 1 150px", border: `1px solid ${C.ligne}`, borderRadius: 10, padding: "8px 12px", background: "#ffffff" }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>{titre}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: couleur }}>{valeur}</div>
                {sous && <div style={{ fontSize: 12, color: C.gris }}>{sous}</div>}
              </div>
            );
            return (
              <section id="detail-semaine" style={{ ...page.carte, padding: 16, marginBottom: 16, borderLeft: `5px solid ${d.couleur}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>
                    <span style={{ color: d.couleur }}>{d.libelle}</span> · semaine S{numeroSemaine(semaines[w])}
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>
                      {" "}
                      · du {formatDate(semaines[w])} au {formatDate(ajouterJours(semaines[w], 4))}
                    </span>
                  </h2>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setDetail(null)} aria-label="Fermer le détail" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                    ×
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                  {vignette("Capacité", h(d.capa[w]), undefined, `${d.personnes.length} personne${d.personnes.length > 1 ? "s" : ""}`)}
                  {vignette("Occupées", h(d.occ[w]), undefined, d.prev[w] >= 0.5 ? `dont prévisionnel ${h(d.prev[w])}` : undefined)}
                  {vignette(
                    "Disponibles",
                    h(d.dispo[w]),
                    d.dispo[w] >= 0.5 ? "#1b5e20" : C.gris,
                    NIVEAUX.map((nv, k) => (d.parNiveau[k][w] >= 0.5 ? `${nv.libelle.replace("Niveau non renseigné", "non renseigné")} ${h(d.parNiveau[k][w])}` : ""))
                      .filter(Boolean)
                      .join(" · ") || undefined
                  )}
                  {d.surcharge[w] >= 0.5 && vignette("Surcharge", h(d.surcharge[w]), ROUGE, "au-delà de la capacité de certains")}
                </div>
                {personnes.length === 0 ? (
                  <span style={{ color: C.gris }}>Personne n’a cette activité comme activité principale.</span>
                ) : (
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        {["Personne", "Capacité", "Occupé", "Charge", "Libre"].map((t) => (
                          <th key={t} style={{ ...page.th, textAlign: t === "Personne" ? "left" : "center", padding: "6px 8px" }}>
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {personnes.map((p, i) => {
                        const x = p.semaines[w];
                        const libre = x.capa - x.occ;
                        return (
                          <tr key={p.c.id} style={{ background: i % 2 ? "#fafbfc" : undefined }}>
                            <td style={{ ...page.td, padding: "6px 8px", whiteSpace: "nowrap" }}>
                              <strong>{nomCollab(p.c)}</strong>
                              {p.aussi.length > 0 && <span style={{ color: C.gris, fontSize: 12 }}> · aussi {p.aussi.join(", ")}</span>}
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", textAlign: "center" }}>{formatHeures(x.capa)}</td>
                            <td style={{ ...page.td, padding: "6px 8px", textAlign: "center" }}>{formatHeures(x.occ)}</td>
                            <td style={{ ...page.td, padding: "6px 8px", width: "35%" }}>
                              <div style={{ position: "relative", height: 14, background: "#eef0f3", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(Math.min(x.occ, x.capa) / echelle) * 100}%`, background: d.couleur, opacity: 0.85 }} />
                                {x.occ > x.capa && (
                                  <div style={{ position: "absolute", left: `${(x.capa / echelle) * 100}%`, top: 0, bottom: 0, width: `${((x.occ - x.capa) / echelle) * 100}%`, background: `repeating-linear-gradient(45deg,${ROUGE},${ROUGE} 3px,#f3b1ae 3px,#f3b1ae 6px)` }} />
                                )}
                                <div style={{ position: "absolute", left: `${(x.capa / echelle) * 100}%`, top: 0, bottom: 0, width: 2, background: "#1f2328" }} />
                              </div>
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", textAlign: "center", fontWeight: 800, color: libre < -0.5 ? ROUGE : libre >= 0.5 ? "#1b5e20" : C.gris, whiteSpace: "nowrap" }}>
                              {libre < -0.5 ? `surcharge ${formatHeures(-libre)}` : libre >= 0.5 ? `libre ${formatHeures(libre)}` : "complet"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })()}

        {/* ---------- tableau récapitulatif ---------- */}
        {/* RECAP_PAR_ACTIVITE : un bloc par activité, bien séparés (titre de couleur, son propre tableau) */}
        <details open /* DEPLIE_PAR_DEFAUT */ style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
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
                              onClick={() => setDetail(detail?.cle === d.cle && detail.w === w ? null : { cle: d.cle, w })}
                              style={{
                                textAlign: "center",
                                padding: "6px 2px",
                                fontSize: 13,
                                cursor: "pointer",
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

        <p style={{ margin: "4px 4px 16px", fontSize: 13, color: C.gris }}>
          Chaque activité regroupe les personnes dont c’est une activité principale (fiche collaborateur), encadrement exclu ; une personne qui a
          plusieurs activités principales compte dans chacune, les activités ne s’additionnent donc pas entre elles. Occupées : tout ce qui leur est
          planifié, affaires, PE / PI, hors affaire et prévisionnel (charge probable, non confirmée, montrée à part). Disponibles : les heures libres de chacun, détaillées par niveau (fiche collaborateur).
          Ce qui est planifié au-delà de la capacité d’une personne n’est pas montré ici (voir le détail d’une semaine). Détail par personne et par affaire : « Charge de l’équipe » plus haut.
        </p>
    </div>
  );
}
