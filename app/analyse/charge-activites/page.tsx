"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerAffaires, chargerAffectations, chargerAnnuaire, chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import { aISO, ajouterJours, chargeParSemaine, construireCapacites, lundiDe, numeroSemaine, type Affectation, type JourAffecte, type JourRow } from "@/lib/pilotagePlanning";
import { formatDate, formatHeures, nomCollab, num, type Affaire, type Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE - CHARGE ET COMPÉTENCES PAR ACTIVITÉ (CHARGE_ACTIVITES)
   ADMIN et DIRECTION (lecture seule, droit « chargeRessources »)

   Sur 12 semaines, par activité (Méca, Calcul, Elec…) :
   - COMPÉTENCES DISPONIBLES : heures encore libres (capacité − tout ce qui
     est planifié, congés et fériés déduits) des personnes dont c'est
     l'activité principale, et le renfort de celles qui ont la compétence ;
   - PLANNING DE CHARGE : heures planifiées selon l'activité de chaque
     affectation, face à la capacité des personnes dont c'est l'activité
     principale.
   Équipe hors encadrement. Tout découle du planning des affaires.
================================================================ */

function ChargeActivitesContenu() {
  const [lundi, setLundi] = useState(() => lundiDe(aISO(new Date())));
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [jours, setJours] = useState<JourRow[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });
  const [groupesRep, setGroupesRep] = useState<{ predo: Map<string, string>; activites: { id: string; nom: string; ordre: number }[] }>({ predo: new Map(), activites: [] });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const fenetreFin = ajouterJours(lundi, 12 * 7 - 1);
  const lundiActuelRep = lundiDe(aISO(new Date()));

  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerAnnuaire(),
      chargerAffaires({ horsPlanning: true }),
      supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id").eq("niveau", "PRINCIPALE"),
      supabase.from("activites").select("id,nom,ordre_affichage"),
    ])
      .then(([an, af, p, a]) => {
        if (!actif) return;
        setAnnuaire(an);
        setAffaires(af);
        setGroupesRep({
          predo: new Map(((p.data ?? []) as { collaborateur_id: string; activite_id: string }[]).map((x) => [x.collaborateur_id, x.activite_id])),
          activites: ((a.data ?? []) as { id: string; nom: string; ordre_affichage: number | null }[]).map((x) => ({ id: x.id, nom: x.nom, ordre: x.ordre_affichage ?? 99 })),
        });
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
        setAffectations(aff.affectations);
        setJours(aff.jours);
        setCaps(cap);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [lundi, fenetreFin]);

  const capacites = useMemo(() => construireCapacites(caps.caps, caps.absences), [caps]);
  const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);
  const affectationsParId = useMemo(() => new Map(affectations.map((a) => [a.id, a])), [affectations]);
  const joursAffectes: JourAffecte[] = useMemo(
    () =>
      jours
        .map((j) => {
          const a = affectationsParId.get(j.affectation_id);
          return a ? { collaborateur_id: a.collaborateur_id, jour: j.jour, heures: num(j.heures) } : null;
        })
        .filter((x): x is JourAffecte => x !== null),
    [jours, affectationsParId]
  );
  const semaines12 = useMemo(() => Array.from({ length: 12 }, (_, w) => ajouterJours(lundi, w * 7)), [lundi]);
  const equipe12 = useMemo(
    () => annuaire.filter((c) => c.inclus_statistiques && (capacites.get(c.id) ? [...capacites.get(c.id)!.values()].some((j) => j.theorique > 0) : false)),
    [annuaire, capacites]
  );

  /* le travail planifié, rangé selon l'activité de chaque affectation (Méca, Calcul…), face à la
     capacité des personnes dont c'est l'activité principale (congés et fériés déduits) ; équipe hors encadrement, 12 semaines */
  const [detailActivite, setDetailActivite] = useState<{ cle: string; w: number } | null>(null);
  const chargeActivite = useMemo(() => {
    type LigneAct = { cle: string; nom: string; ordre: number; capa: number[]; charge: number[]; detail: Map<string, Map<string, number>>[] };
    const ids = new Set(equipe12.map((c) => c.id));
    const semaineDe = (jour: string) => semaines12.findIndex((l) => jour >= l && jour <= ajouterJours(l, 6));
    const parCle = new Map<string, LigneAct>();
    const ligneDe = (cle: string, nom: string, ordre: number) => {
      let l = parCle.get(cle);
      if (!l) {
        l = { cle, nom, ordre, capa: semaines12.map(() => 0), charge: semaines12.map(() => 0), detail: semaines12.map(() => new Map<string, Map<string, number>>()) };
        parCle.set(cle, l);
      }
      return l;
    };
    for (const a of groupesRep.activites) ligneDe(a.id, a.nom, a.ordre);
    const connues = new Set(groupesRep.activites.map((a) => a.id));
    // capacité : chaque personne compte pour son activité principale
    for (const c of equipe12) {
      const act = groupesRep.predo.get(c.id);
      const l = act && connues.has(act) ? ligneDe(act, "", 0) : ligneDe("_sans", "Sans activité principale", 998);
      semaines12.forEach((s, w) => (l.capa[w] += chargeParSemaine(capacites, joursAffectes, c.id, s).net));
    }
    // charge : les heures planifiées, selon l'activité de l'affectation
    for (const j of jours) {
      const a = affectationsParId.get(j.affectation_id);
      if (!a || !ids.has(a.collaborateur_id)) continue;
      const w = semaineDe(j.jour);
      const h = num(j.heures);
      if (w < 0 || h <= 0) continue;
      const l = !a.affaire_id
        ? ligneDe("_hors", "Hors affaire (salons, formations…)", 1000)
        : a.activite_id && connues.has(a.activite_id)
          ? ligneDe(a.activite_id, "", 0)
          : ligneDe("_nonprecise", "Activité non précisée", 999);
      l.charge[w] += h;
      const aff = a.affaire_id ? affairesParId.get(a.affaire_id) : undefined;
      const etiquette = aff ? `${aff.type} ${aff.numero}` : a.libelle ?? "Événement";
      const qui = nomCollab(annuaire.find((x) => x.id === a.collaborateur_id));
      const m = l.detail[w].get(etiquette) ?? new Map<string, number>();
      m.set(qui, (m.get(qui) ?? 0) + h);
      l.detail[w].set(etiquette, m);
    }
    const liste = [...parCle.values()]
      .filter((l) => l.capa.some((x) => x > 0.01) || l.charge.some((x) => x > 0.01))
      .sort((x, y) => x.ordre - y.ordre || x.nom.localeCompare(y.nom, "fr"));
    const total = {
      capa: semaines12.map((_, w) => liste.reduce((t, l) => t + l.capa[w], 0)),
      charge: semaines12.map((_, w) => liste.reduce((t, l) => t + l.charge[w], 0)),
    };
    return { liste, total };
  }, [equipe12, semaines12, groupesRep, capacites, joursAffectes, jours, affectationsParId, affairesParId, annuaire]);

  /* compétences disponibles = heures encore libres des personnes (capacité − tout ce qui est
     planifié), par activité : celles dont c'est l'activité principale, puis le renfort de celles qui ont la compétence */
  const [competences, setCompetences] = useState<Map<string, Set<string>>>(new Map());
  const [detailDispo, setDetailDispo] = useState<{ cle: string; w: number } | null>(null);
  useEffect(() => {
    void supabase
      .from("collaborateurs_predominances")
      .select("collaborateur_id,activite_id")
      .eq("niveau", "COMPETENCE")
      .then(({ data }) => {
        const m = new Map<string, Set<string>>();
        for (const x of (data ?? []) as { collaborateur_id: string; activite_id: string }[]) {
          const s = m.get(x.activite_id) ?? new Set<string>();
          s.add(x.collaborateur_id);
          m.set(x.activite_id, s);
        }
        setCompetences(m);
      });
  }, []);
  const dispoActivite = useMemo(() => {
    const libre = new Map<string, number[]>();
    for (const c of equipe12)
      libre.set(
        c.id,
        semaines12.map((s) => {
          const x = chargeParSemaine(capacites, joursAffectes, c.id, s);
          return Math.max(0, x.net - x.affecte);
        })
      );
    const somme = (liste: Collab[], w: number) => liste.reduce((t, c) => t + (libre.get(c.id)?.[w] ?? 0), 0);
    return [...groupesRep.activites]
      .sort((x, y) => x.ordre - y.ordre)
      .map((a) => {
        const titulaires = equipe12.filter((c) => groupesRep.predo.get(c.id) === a.id);
        const renforts = equipe12.filter((c) => groupesRep.predo.get(c.id) !== a.id && Boolean(competences.get(a.id)?.has(c.id)));
        return {
          cle: a.id,
          nom: a.nom,
          titulaires,
          renforts,
          libre,
          titu: semaines12.map((_, w) => somme(titulaires, w)),
          renf: semaines12.map((_, w) => somme(renforts, w)),
        };
      })
      .filter((x) => x.titulaires.length + x.renforts.length > 0);
  }, [equipe12, semaines12, capacites, joursAffectes, groupesRep, competences]);

  const fleche = { minHeight: 44, minWidth: 44, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontSize: 18, fontWeight: 800, cursor: "pointer" } as const;

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div>
            <h1 style={page.titre}>Charge et compétences par activité</h1>
            <p style={page.sousTitre}>
              Quelles compétences sont disponibles, et quelles activités sont en tension, sur les 12 semaines à venir. Tout découle du planning des affaires.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" aria-label="Semaine précédente" style={fleche} onClick={() => setLundi(ajouterJours(lundi, -7))}>◀</button>
            <div style={{ fontWeight: 800, fontSize: 18, minWidth: 220, textAlign: "center" }}>
              S{numeroSemaine(lundi)} → S{numeroSemaine(semaines12[11] ?? lundi)}
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

        {/* compétences disponibles : heures libres par activité */}
        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Compétences disponibles</h2>
          <p style={{ margin: "0 0 10px", color: C.gris, fontSize: 14 }}>
            Heures <strong>encore libres</strong>, semaine par semaine (capacité − tout ce qui est déjà planifié, congés et fériés déduits). En gros : les
            personnes dont c’est l’<strong>activité principale</strong> ; en petit : le <strong>renfort</strong> possible des personnes qui ont aussi cette
            compétence. Une même personne peut compter dans plusieurs activités : ne pas additionner les lignes. Cliquez sur une case pour voir qui.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 190 }} />
                {semaines12.map((l) => (
                  <col key={l} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th style={page.th} />
                  {semaines12.map((l) => (
                    <th key={l} style={{ ...page.th, textAlign: "center", padding: "6px 2px", background: l < lundiActuelRep ? "#eef0f3" : undefined }}>
                      S{numeroSemaine(l)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dispoActivite.map((a) => (
                  <tr key={a.cle}>
                    <th scope="row" style={{ textAlign: "left", padding: "8px", fontSize: 13, borderBottom: `1px solid ${C.ligne}` }}>
                      <span style={{ fontWeight: 800, color: C.rougeFonce, textTransform: "uppercase" }}>{a.nom}</span>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.gris }}>
                        {a.titulaires.length} principale{a.titulaires.length > 1 ? "s" : ""} · {a.renforts.length} renfort{a.renforts.length > 1 ? "s" : ""}
                      </div>
                    </th>
                    {semaines12.map((l, w) => {
                      const t = a.titu[w];
                      const r = a.renf[w];
                      const choisie = detailDispo?.cle === a.cle && detailDispo.w === w;
                      return (
                        <td
                          key={l}
                          onClick={() => setDetailDispo(choisie ? null : { cle: a.cle, w })}
                          title={`S${numeroSemaine(l)} : ${formatHeures(t)} libres en activité principale (≈ ${Math.round((t / 7) * 10) / 10} j), + ${formatHeures(r)} en renfort`}
                          style={{
                            padding: "5px 2px",
                            textAlign: "center",
                            cursor: "pointer",
                            border: "1px solid #ffffff",
                            outline: choisie ? `2px solid ${C.encre}` : undefined,
                            outlineOffset: -2,
                            background: t >= 21 ? "#cdebd3" : t >= 0.5 ? "#e6f4e9" : "#f4f5f7",
                            color: t >= 0.5 ? "#1b5e20" : C.gris,
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 800 }}>{t >= 0.5 ? `${Math.round(t)} h` : "—"}</div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: C.gris, whiteSpace: "nowrap" }}>{r >= 0.5 ? `+ ${Math.round(r)} h renfort` : " "}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detailDispo &&
            (() => {
              const a = dispoActivite.find((x) => x.cle === detailDispo.cle);
              if (!a) return null;
              const w = detailDispo.w;
              const liste = (gens: Collab[]) =>
                gens
                  .map((c) => ({ c, h: a.libre.get(c.id)?.[w] ?? 0 }))
                  .sort((x, y) => y.h - x.h)
                  .map((x) => `${nomCollab(x.c)} ${x.h >= 0.5 ? formatHeures(x.h) : "complet"}`)
                  .join(", ");
              return (
                <div style={{ marginTop: 12, padding: "10px 12px", border: `1px solid ${C.ligne}`, borderRadius: 8, background: "#fcfcfd", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <strong>
                      {a.nom} · S{numeroSemaine(semaines12[w])} : heures libres
                    </strong>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => setDetailDispo(null)} aria-label="Fermer le détail" style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>
                      ×
                    </button>
                  </div>
                  <div>
                    <strong>Activité principale :</strong> {a.titulaires.length > 0 ? liste(a.titulaires) : "personne"}
                  </div>
                  <div>
                    <strong>Renfort (compétence) :</strong> {a.renforts.length > 0 ? liste(a.renforts) : "personne"}
                  </div>
                </div>
              );
            })()}
        </section>

        {/* le travail planifié par activité, face à la capacité de chaque activité */}
        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Planning de charge par activité</h2>
          <p style={{ margin: "0 0 12px", color: C.gris, fontSize: 14 }}>
            Les heures <strong>planifiées</strong>, rangées selon l’activité de chaque affectation (Méca, Calcul…), face à la <strong>capacité</strong> des
            personnes dont c’est l’activité principale (congés et fériés déduits). Équipe hors encadrement. Un taux au-dessus de 100 % : il manque du
            monde dans cette activité cette semaine-là. Cliquez sur une case pour voir les affaires et les personnes.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 190 }} />
                {semaines12.map((l) => (
                  <col key={l} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th style={page.th} />
                  {semaines12.map((l) => (
                    <th key={l} style={{ ...page.th, textAlign: "center", padding: "6px 2px", background: l < lundiActuelRep ? "#eef0f3" : undefined }}>
                      S{numeroSemaine(l)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const cellule = (cle: string, w: number, charge: number, capa: number, gras: boolean) => {
                    const choisie = detailActivite?.cle === cle && detailActivite.w === w;
                    if (capa <= 0.01 && charge <= 0.01)
                      return (
                        <td key={w} style={{ padding: "5px 2px", textAlign: "center", borderBottom: `1px solid ${C.ligne}`, color: C.gris }}>
                          —
                        </td>
                      );
                    const pct = capa > 0.01 ? Math.round((charge / capa) * 100) : null;
                    const surcharge = pct !== null && pct > 100;
                    return (
                      <td
                        key={w}
                        onClick={() => setDetailActivite(choisie ? null : { cle, w })}
                        title={`S${numeroSemaine(semaines12[w])} : ${formatHeures(charge)} planifiées${capa > 0.01 ? ` pour ${formatHeures(capa)} de capacité` : " (pas de capacité dédiée)"}`}
                        style={{
                          padding: "5px 2px",
                          textAlign: "center",
                          cursor: "pointer",
                          border: "1px solid #ffffff",
                          outline: choisie ? `2px solid ${C.encre}` : undefined,
                          outlineOffset: -2,
                          background:
                            pct === null
                              ? "#f4f5f7"
                              : surcharge
                                ? "repeating-linear-gradient(45deg,#fde1e1,#fde1e1 5px,#f5b5b0 5px,#f5b5b0 10px)"
                                : pct === 0
                                  ? "#f4f5f7"
                                  : pct >= 80
                                    ? "#cfe0f3"
                                    : "#e6eef8",
                          color: surcharge ? "#8f1010" : "#10263d",
                        }}
                      >
                        <div style={{ fontSize: gras ? 14 : 13, fontWeight: 800 }}>{pct === null ? formatHeures(charge) : `${surcharge ? "▲ " : ""}${pct} %`}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: surcharge ? "#8f1010" : C.gris, whiteSpace: "nowrap" }}>
                          {pct === null ? "sans capacité" : `${Math.round(charge)} / ${Math.round(capa)} h`}
                        </div>
                      </td>
                    );
                  };
                  return (
                    <>
                      {chargeActivite.liste.map((l) => (
                        <tr key={l.cle}>
                          <th scope="row" style={{ textAlign: "left", padding: "8px", fontSize: 13, borderBottom: `1px solid ${C.ligne}` }}>
                            <span style={{ fontWeight: 800, color: l.cle.startsWith("_") ? "#3b4046" : C.rougeFonce, textTransform: l.cle.startsWith("_") ? undefined : "uppercase" }}>
                              {l.nom}
                            </span>
                          </th>
                          {semaines12.map((_, w) => cellule(l.cle, w, l.charge[w], l.capa[w], false))}
                        </tr>
                      ))}
                      <tr style={{ background: "#f8f9fa" }}>
                        <th scope="row" style={{ textAlign: "left", padding: "8px", fontSize: 14, borderTop: `2px solid ${C.ligne}` }}>
                          Équipe BE
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.gris }}>toutes activités</div>
                        </th>
                        {semaines12.map((_, w) => cellule("_total", w, chargeActivite.total.charge[w], chargeActivite.total.capa[w], true))}
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
          {detailActivite &&
            (() => {
              const l = chargeActivite.liste.find((x) => x.cle === detailActivite.cle);
              const w = detailActivite.w;
              const detail = new Map<string, Map<string, number>>();
              for (const src of l ? [l] : chargeActivite.liste)
                for (const [et, m] of src.detail[w]) {
                  const d = detail.get(et) ?? new Map<string, number>();
                  for (const [q, h] of m) d.set(q, (d.get(q) ?? 0) + h);
                  detail.set(et, d);
                }
              const lignesDetail = [...detail.entries()]
                .map(([et, m]) => ({ et, total: [...m.values()].reduce((t, h) => t + h, 0), gens: [...m.entries()].sort((a, b) => b[1] - a[1]) }))
                .sort((a, b) => b.total - a.total);
              return (
                <div style={{ marginTop: 12, padding: "10px 12px", border: `1px solid ${C.ligne}`, borderRadius: 8, background: "#fcfcfd" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <strong>
                      {l ? l.nom : "Équipe BE"} · S{numeroSemaine(semaines12[w])}
                    </strong>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => setDetailActivite(null)} aria-label="Fermer le détail" style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>
                      ×
                    </button>
                  </div>
                  {lignesDetail.length === 0 ? (
                    <span style={{ color: C.gris, fontSize: 13 }}>Rien de planifié cette semaine.</span>
                  ) : (
                    lignesDetail.map((x) => (
                      <div key={x.et} style={{ fontSize: 13, padding: "2px 0" }}>
                        <strong>{x.et}</strong> · {formatHeures(x.total)}
                        <span style={{ color: C.gris }}> ({x.gens.map(([q, h]) => `${q} ${formatHeures(h)}`).join(", ")})</span>
                      </div>
                    ))
                  )}
                </div>
              );
            })()}

        </section>

        <p style={{ margin: "4px 4px 0", fontSize: 13, color: C.gris }}>
          Activité principale et compétences de chacun : fiche collaborateur (Paramétrage › Collaborateurs). Charge détaillée par personne :{" "}
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
