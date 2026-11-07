"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerAffectations, chargerAnnuaire, chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import { aISO, ajouterJours, chargeParSemaine, construireCapacites, lundiDe, numeroSemaine, type JourAffecte } from "@/lib/pilotagePlanning";
import { formatDate, formatHeures, nomCollab, num, type Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE - DISPONIBILITÉS PAR ACTIVITÉ (CHARGE_ACTIVITES_V5)
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
================================================================ */

const ACTIVITES_SUIVIES = [
  { cle: "meca", libelle: "Méca", couleur: "#c00000" },
  { cle: "elec", libelle: "Elec", couleur: "#34506b" },
  { cle: "calcul", libelle: "Calcul", couleur: "#6b58a8" },
];
const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
/* niveaux : du plus clair au plus foncé */
const NIVEAUX = [
  { n: 1, libelle: "Niveau 1", aide: "exécute sous supervision", couleur: "#c8e6c9" },
  { n: 2, libelle: "Niveau 2", aide: "autonome sur une affaire courante", couleur: "#66bb6a" },
  { n: 3, libelle: "Niveau 3", aide: "expert ou référent", couleur: "#2e7d32" },
  { n: 0, libelle: "Niveau non renseigné", aide: "à saisir dans la fiche collaborateur", couleur: "#e3e7e3" },
];
const ROUGE = "#c62828";

function ChargeActivitesContenu() {
  const [lundi, setLundi] = useState(() => lundiDe(aISO(new Date())));
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [predo, setPredo] = useState<Map<string, Set<string>>>(new Map());
  const [activites, setActivites] = useState<{ id: string; nom: string }[]>([]);
  const [joursAffectes, setJoursAffectes] = useState<JourAffecte[]>([]);
  const [joursPrev, setJoursPrev] = useState<JourAffecte[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [detail, setDetail] = useState<{ cle: string; w: number } | null>(null);
  const [niveaux, setNiveaux] = useState<Map<string, number>>(new Map());

  const fenetreFin = ajouterJours(lundi, 12 * 7 - 1);
  const lundiActuel = lundiDe(aISO(new Date()));

  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerAnnuaire(),
      supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id").eq("niveau", "PRINCIPALE"),
      supabase.from("activites").select("id,nom"),
      supabase.from("collaborateurs_niveaux").select("collaborateur_id,niveau"),
    ])
      .then(([an, p, a, nv]) => {
        if (!actif) return;
        // sans la table (SQL 86 pas encore passé) : tout le monde « non renseigné »
        setNiveaux(new Map(((nv.data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0])));
        setAnnuaire(an);
        // une personne peut avoir plusieurs activités principales : on les garde toutes
        const m = new Map<string, Set<string>>();
        for (const x of (p.data ?? []) as { collaborateur_id: string; activite_id: string }[]) {
          const e = m.get(x.collaborateur_id) ?? new Set<string>();
          e.add(x.activite_id);
          m.set(x.collaborateur_id, e);
        }
        setPredo(m);
        setActivites((a.data ?? []) as { id: string; nom: string }[]);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    return () => {
      actif = false;
    };
  }, []);

  useEffect(() => {
    let actif = true;
    setChargement(true);
    Promise.all([chargerAffectations(lundi, fenetreFin), chargerCapacitesAbsences(lundi, fenetreFin)])
      .then(([aff, cap]) => {
        if (!actif) return;
        const parId = new Map(aff.affectations.map((a) => [a.id, a]));
        const tous = aff.jours
          .map((j) => {
            const a = parId.get(j.affectation_id);
            return a ? { collaborateur_id: a.collaborateur_id, jour: j.jour, heures: num(j.heures), prev: Boolean((a as { previsionnel?: boolean | null }).previsionnel) } : null;
          })
          .filter((x): x is JourAffecte & { prev: boolean } => x !== null);
        setJoursAffectes(tous);
        setJoursPrev(tous.filter((x) => x.prev));
        setCaps(cap);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [lundi, fenetreFin]);

  const capacites = useMemo(() => construireCapacites(caps.caps, caps.absences), [caps]);
  const semaines = useMemo(() => Array.from({ length: 12 }, (_, w) => ajouterJours(lundi, w * 7)), [lundi]);

  /* par activité suivie : ses personnes, et pour chaque semaine capacité / occupées / disponibles */
  const donnees = useMemo(() => {
    const equipe = annuaire.filter((c) => c.inclus_statistiques);
    return ACTIVITES_SUIVIES.map((s) => {
      const ids = new Set(activites.filter((a) => sansAccents(a.nom).startsWith(s.cle)).map((a) => a.id));
      const personnes = equipe.filter((c) => [...(predo.get(c.id) ?? [])].some((id) => ids.has(id)));
      const parPersonne = personnes.map((c) => ({
        c,
        niveau: niveaux.get(c.id) ?? 0,
        // ses autres activités principales, pour le signaler dans le détail
        aussi: [...(predo.get(c.id) ?? [])].filter((id) => !ids.has(id)).map((id) => activites.find((a) => a.id === id)?.nom ?? "").filter(Boolean),
        semaines: semaines.map((l) => {
          const x = chargeParSemaine(capacites, joursAffectes, c.id, l);
          const pv = chargeParSemaine(capacites, joursPrev, c.id, l).affecte;
          return { capa: x.net, occ: x.affecte, prev: pv };
        }),
      }));
      const capa = semaines.map((_, w) => parPersonne.reduce((t, p) => t + p.semaines[w].capa, 0));
      const occ = semaines.map((_, w) => parPersonne.reduce((t, p) => t + p.semaines[w].occ, 0));
      const libre = (p: (typeof parPersonne)[number], w: number) => Math.max(0, p.semaines[w].capa - p.semaines[w].occ);
      const parNiveau = NIVEAUX.map((nv) => semaines.map((_, w) => parPersonne.filter((p) => p.niveau === nv.n).reduce((t, p) => t + libre(p, w), 0)));
      const dispo = semaines.map((_, w) => parNiveau.reduce((t, x) => t + x[w], 0));
      const surcharge = semaines.map((_, w) => parPersonne.reduce((t, p) => t + Math.max(0, p.semaines[w].occ - p.semaines[w].capa), 0));
      const prev = semaines.map((_, w) => parPersonne.reduce((t, p) => t + p.semaines[w].prev, 0));
      // part prévisionnelle dans les heures occupées sans surcharge (pour le graphique)
      const prevUtile = semaines.map((_, w) => parPersonne.reduce((t, p) => t + Math.min(p.semaines[w].prev, Math.min(p.semaines[w].occ, p.semaines[w].capa)), 0));
      return { ...s, personnes: parPersonne, capa, occ, prev, prevUtile, dispo, parNiveau, surcharge };
    });
  }, [annuaire, activites, predo, niveaux, semaines, capacites, joursAffectes, joursPrev]);

  const somme = (v: number[]) => v.reduce((t, x) => t + x, 0);
  const h = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} h`;
  const fleche = { minHeight: 44, minWidth: 44, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontSize: 18, fontWeight: 800, cursor: "pointer" } as const;

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div>
            <h1 style={page.titre}>Disponibilités par activité</h1>
            <p style={page.sousTitre}>
              Méca, Elec et Calcul : capacité, heures occupées et heures disponibles, sur les 12 semaines à venir. Tout découle du planning des affaires.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" aria-label="Semaine précédente" style={fleche} onClick={() => setLundi(ajouterJours(lundi, -7))}>◀</button>
            <div style={{ fontWeight: 800, fontSize: 18, minWidth: 220, textAlign: "center" }}>
              S{numeroSemaine(lundi)} → S{numeroSemaine(semaines[11] ?? lundi)}
              <div style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>
                {formatDate(lundi)} → {formatDate(ajouterJours(fenetreFin, -2))}
              </div>
            </div>
            <button type="button" aria-label="Semaine suivante" style={fleche} onClick={() => setLundi(ajouterJours(lundi, 7))}>▶</button>
            <button type="button" style={{ ...page.btnSecondaire, border: "none", textDecoration: "underline" }} onClick={() => setLundi(lundiDe(aISO(new Date())))}>
              Aujourd’hui
            </button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {/* ---------- graphiques : une activité par carte ---------- */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, marginBottom: 16 }}>
          {donnees.map((d) => {
            const max = Math.max(1, ...d.capa, ...d.occ);
            return (
              <section key={d.cle} style={{ ...page.carte, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 18, color: d.couleur }}>{d.libelle}</h2>
                  <span style={{ fontSize: 12, color: C.gris }}>
                    {d.personnes.length} personne{d.personnes.length > 1 ? "s" : ""} · {h(somme(d.dispo))} disponibles sur 12 semaines
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 150, borderBottom: `1px solid ${C.ligne}` }}>
                  {semaines.map((l, w) => {
                    const capa = d.capa[w];
                    const occ = d.occ[w];
                    const exces = d.surcharge[w];
                    const occUtile = Math.max(0, capa - d.dispo[w]);
                    return (
                      <div
                        key={l}
                        title={`S${numeroSemaine(l)} : capacité ${h(capa)} · occupées ${h(occ)} · disponibles ${h(d.dispo[w])}${
                          d.dispo[w] >= 0.5 ? ` (${NIVEAUX.map((nv, k) => (d.parNiveau[k][w] >= 0.5 ? `${nv.libelle.replace("Niveau non renseigné", "non renseigné")} ${h(d.parNiveau[k][w])}` : "")).filter(Boolean).join(", ")})` : ""
                        }${d.prev[w] >= 0.5 ? ` · dont prévisionnel ${h(d.prev[w])}` : ""}${exces >= 0.5 ? ` · surcharge ${h(exces)}` : ""}`}
                        onClick={() => setDetail(detail?.cle === d.cle && detail.w === w ? null : { cle: d.cle, w })}
                        style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column-reverse", cursor: "pointer", outline: detail?.cle === d.cle && detail.w === w ? `2px solid ${C.encre}` : undefined }}
                      >
                        <div style={{ height: `${(Math.max(0, occUtile - d.prevUtile[w]) / max) * 100}%`, background: d.couleur, opacity: 0.85 }} />
                        {d.prevUtile[w] > 0 && (
                          <div style={{ height: `${(d.prevUtile[w] / max) * 100}%`, background: `repeating-linear-gradient(45deg,${d.couleur},${d.couleur} 3px,#ffffff 3px,#ffffff 6px)`, opacity: 0.6 }} />
                        )}
                        {exces > 0 && <div style={{ height: `${(exces / max) * 100}%`, background: `repeating-linear-gradient(45deg,${ROUGE},${ROUGE} 3px,#f3b1ae 3px,#f3b1ae 6px)` }} />}
                        {/* disponibles, du niveau 3 (foncé, en bas) au niveau 1 (clair), puis non renseigné */}
                        {[2, 1, 0, 3].map((k) =>
                          d.parNiveau[k][w] > 0 ? <div key={k} style={{ height: `${(d.parNiveau[k][w] / max) * 100}%`, background: NIVEAUX[k].couleur }} /> : null
                        )}
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
          <span><i style={{ display: "inline-block", width: 12, height: 12, background: "#7b8189", verticalAlign: "middle" }} /> occupées (couleur de l’activité)</span>
          <span><i style={{ display: "inline-block", width: 12, height: 12, background: "repeating-linear-gradient(45deg,#7b8189,#7b8189 3px,#ffffff 3px,#ffffff 6px)", verticalAlign: "middle", opacity: 0.7 }} /> dont prévisionnel (non confirmé)</span>
          {NIVEAUX.map((nv) => (
            <span key={nv.n} title={nv.aide}>
              <i style={{ display: "inline-block", width: 12, height: 12, background: nv.couleur, verticalAlign: "middle", border: "1px solid #c9d1c9" }} /> disponibles · {nv.libelle.toLowerCase()}
              {nv.n > 0 ? <span style={{ color: C.gris }}> ({nv.aide})</span> : null}
            </span>
          ))}
          <span><i style={{ display: "inline-block", width: 12, height: 12, background: `repeating-linear-gradient(45deg,${ROUGE},${ROUGE} 3px,#f3b1ae 3px,#f3b1ae 6px)`, verticalAlign: "middle" }} /> surcharge</span>
          <span style={{ color: C.gris }}>La hauteur totale d’une barre est la capacité de la semaine. Cliquez sur une barre ou une case pour voir le détail par personne.</span>
        </div>

        {/* ---------- tableau récapitulatif ---------- */}
        <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Récapitulatif, en heures</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 980, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 170 }} />
                {semaines.map((l) => (
                  <col key={l} />
                ))}
                <col style={{ width: 90 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={page.th} />
                  {semaines.map((l) => (
                    <th key={l} style={{ ...page.th, textAlign: "center", padding: "6px 2px", background: l === lundiActuel ? "#fff4f4" : undefined }}>
                      S{numeroSemaine(l)}
                    </th>
                  ))}
                  <th style={{ ...page.th, textAlign: "center" }}>12 sem.</th>
                </tr>
              </thead>
              <tbody>
                {donnees.map((d) => (
                  <Fragment key={d.cle}>
                    {(
                      [
                        ["Capacité", d.capa, null],
                        ["Occupées", d.occ, null],
                        ...(d.prev.some((x) => x >= 0.5) ? [["dont prévisionnel (non confirmé)", d.prev, "PREV"] as [string, number[], "PREV"]] : []),
                        ["Disponibles", d.dispo, null],
                        ...NIVEAUX.map((nv, i) => [`dont ${nv.libelle.replace("Niveau non renseigné", "non renseigné").toLowerCase()}`, d.parNiveau[i], nv] as [string, number[], (typeof NIVEAUX)[number]])
                          .filter(([, v, nv]) => nv && (nv.n > 0 || v.some((x) => x >= 0.5))),
                        ...(d.surcharge.some((x) => x >= 0.5) ? [["Surcharge", d.surcharge.map((x) => -x), null] as [string, number[], null]] : []),
                      ] as [string, number[], (typeof NIVEAUX)[number] | "PREV" | null][]
                    ).map(([lib, v, nvOuPrev], k) => {
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
                      const dispo = lib === "Disponibles" || lib === "Surcharge";
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
                          <th
                            scope="row"
                            style={{ textAlign: "left", padding: "5px 8px", fontSize: 13, borderTop: k === 0 ? `2px solid ${C.ligne}` : undefined, borderBottom: `1px solid ${C.ligne}` }}
                          >
                            {k === 0 && <div style={{ fontWeight: 800, color: d.couleur, textTransform: "uppercase", fontSize: 13 }}>{d.libelle}</div>}
                            <span style={{ fontWeight: dispo ? 800 : 600, color: dispo ? "#1b5e20" : lib === "Surcharge" ? ROUGE : "#3b4046" }}>{lib}</span>
                          </th>
                          {v.map((x, w) => (
                            <td
                              key={w}
                              onClick={() => setDetail(detail?.cle === d.cle && detail.w === w ? null : { cle: d.cle, w })}
                              style={{
                                textAlign: "center",
                                padding: "5px 2px",
                                fontSize: 13,
                                cursor: "pointer",
                                fontWeight: dispo ? 800 : 500,
                                color: dispo ? (x < -0.5 ? ROUGE : x >= 0.5 ? "#1b5e20" : C.gris) : "#3b4046",
                                borderTop: k === 0 ? `2px solid ${C.ligne}` : undefined,
                                borderBottom: `1px solid ${C.ligne}`,
                                background: semaines[w] === lundiActuel ? "#fffafa" : undefined,
                              }}
                            >
                              {Math.abs(x) < 0.5 ? "—" : `${dispo && x < 0 ? "▲ " : ""}${Math.round(Math.abs(x)).toLocaleString("fr-FR")}`}
                            </td>
                          ))}
                          <td style={{ textAlign: "center", fontWeight: 800, fontSize: 13, color: dispo ? (somme(v) < 0 ? ROUGE : "#1b5e20") : "#3b4046", borderTop: k === 0 ? `2px solid ${C.ligne}` : undefined, borderBottom: `1px solid ${C.ligne}` }}>
                            {Math.round(Math.abs(somme(v))).toLocaleString("fr-FR")}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {detail &&
            (() => {
              const d = donnees.find((x) => x.cle === detail.cle);
              if (!d) return null;
              const w = detail.w;
              return (
                <div style={{ marginTop: 12, padding: "10px 12px", border: `1px solid ${C.ligne}`, borderRadius: 8, background: "#fcfcfd", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <strong>
                      {d.libelle} · S{numeroSemaine(semaines[w])}
                    </strong>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => setDetail(null)} aria-label="Fermer le détail" style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>
                      ×
                    </button>
                  </div>
                  {d.personnes.length === 0 ? (
                    <span style={{ color: C.gris }}>Personne n’a cette activité comme activité principale.</span>
                  ) : (
                    [...d.personnes]
                      .sort((a, b) => b.semaines[w].capa - b.semaines[w].occ - (a.semaines[w].capa - a.semaines[w].occ))
                      .map((p) => {
                        const x = p.semaines[w];
                        const libre = x.capa - x.occ;
                        return (
                          <div key={p.c.id} style={{ padding: "2px 0" }}>
                            <strong>{nomCollab(p.c)}</strong>
                            {p.aussi.length > 0 && <span style={{ color: C.gris }}> (aussi en {p.aussi.join(", ")})</span>} · capacité {formatHeures(x.capa)} · occupé {formatHeures(x.occ)} ·{" "}
                            <strong style={{ color: libre < -0.5 ? ROUGE : libre >= 0.5 ? "#1b5e20" : C.gris }}>
                              {libre < -0.5 ? `surcharge ${formatHeures(-libre)}` : libre >= 0.5 ? `libre ${formatHeures(libre)}` : "complet"}
                            </strong>
                          </div>
                        );
                      })
                  )}
                </div>
              );
            })()}
        </section>

        <p style={{ margin: "4px 4px 0", fontSize: 13, color: C.gris }}>
          Chaque activité regroupe les personnes dont c’est une activité principale (fiche collaborateur), encadrement exclu ; une personne qui a
          plusieurs activités principales compte dans chacune, les activités ne s’additionnent donc pas entre elles. Occupées : tout ce qui leur est
          planifié, affaires, PE / PI, hors affaire et prévisionnel (charge probable, non confirmée, montrée à part). Disponibles : les heures libres de chacun, détaillées par niveau (fiche collaborateur) ; surcharge :
          ce qui dépasse la capacité de certains. Capacité − occupées = disponibles − surcharge. Détail par personne et par affaire :{" "}
          <Link href="/pilotage/ressources" style={{ fontWeight: 700, color: C.rougeFonce }}>
            Charge par ressource →
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function ChargeActivitesPage() {
  return (
    <GardeAcces droit="chargeRessources">
      <ChargeActivitesContenu />
    </GardeAcces>
  );
}
