"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import AffectationDialog, { type PrefAffectation } from "@/components/pilotage/AffectationDialog";
import { C, Message, page } from "@/components/pilotage/ui";
import {
  chargerActivites,
  chargerAffaires,
  chargerAffectations,
  chargerAnnuaire,
  chargerCapacitesAbsences,
  chargerCodesDivers,
  chargerImputations,
  chargerJoursAffectation,
  type ReferentielActivites,
} from "@/lib/pilotageDonnees";
import {
  aISO,
  ajouterJours,
  attribuerVoies,
  chargeParSemaine,
  construireCapacites,
  estFerie,
  estWeekend,
  jourSemaine,
  listeJours,
  lundiDe,
  numeroSemaine,
  segmentsAffectation,
  type Affectation,
  type JourAffecte,
  type JourHeures,
  type JourRow,
} from "@/lib/pilotagePlanning";
import {
  formatDate,
  formatHeures,
  nomCollab,
  num,
  type Affaire,
  type Collab,
  type Imputation,
} from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - PLANNING VISUEL

   Une frise par ressource : la largeur d'un bloc est la période
   réellement affectée. Les absences validées par les RH et les jours
   fériés apparaissent dans la grille ; les semaines en surcharge sont
   encadrées. Les dates de remise des DBE et les objectifs des CBE sont
   des jalons dans la bande « Échéances ».

   Le planning calcule et avertit : il ne bloque jamais une affectation.
================================================================ */

const LARGEUR_NOM = 148;
const JOURS_COURTS = ["L", "M", "M", "J", "V"];

type SegmentAffiche = {
  affectation: Affectation;
  debutIdx: number;
  finIdx: number;
  heures: number;
  voie: number;
  libre: boolean;
  etiquette: string;
  titre: string;
};

function PlanningContenu() {
  const [lundi, setLundi] = useState(() => lundiDe(aISO(new Date())));
  const [nbSemaines, setNbSemaines] = useState(4);

  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [codesDivers, setCodesDivers] = useState<{ code: string; libelle: string }[]>([]);

  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [jours, setJours] = useState<JourRow[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rechargement, setRechargement] = useState(0);

  const [dialogue, setDialogue] = useState<
    null | { prefill?: PrefAffectation; edition?: { affectation: Affectation; jours: JourRow[] } }
  >(null);

  const fin = ajouterJours(lundi, nbSemaines * 7 - 1);

  // Référentiels : chargés une fois
  useEffect(() => {
    let actif = true;

    Promise.all([chargerAffaires(), chargerAnnuaire(), chargerActivites(), chargerImputations(), chargerCodesDivers()])
      .then(([af, an, ref, im, cd]) => {
        if (!actif) return;
        setAffaires(af);
        setAnnuaire(an);
        setReferentiel(ref);
        setImputations(im);
        setCodesDivers(cd);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger le planning."));

    return () => {
      actif = false;
    };
  }, [rechargement]);

  // Période affichée
  useEffect(() => {
    let actif = true;
    setChargement(true);

    Promise.all([chargerAffectations(lundi, fin), chargerCapacitesAbsences(lundi, fin)])
      .then(([aff, cap]) => {
        if (!actif) return;
        setAffectations(aff.affectations);
        setJours(aff.jours);
        setCaps(cap);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger le planning."))
      .finally(() => actif && setChargement(false));

    return () => {
      actif = false;
    };
  }, [lundi, fin, rechargement]);

  const colonnes = useMemo(() => listeJours(lundi, fin).filter((j) => !estWeekend(j)), [lundi, fin]);
  const capacites = useMemo(() => construireCapacites(caps.caps, caps.absences), [caps]);
  const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);

  const joursParAffectation = useMemo(() => {
    const index = new Map<string, JourHeures[]>();

    for (const j of jours) {
      if (!index.has(j.affectation_id)) index.set(j.affectation_id, []);
      index.get(j.affectation_id)!.push({ jour: j.jour, heures: num(j.heures) });
    }

    return index;
  }, [jours]);

  const joursAffectes: JourAffecte[] = useMemo(() => {
    const parId = new Map(affectations.map((a) => [a.id, a]));

    return jours
      .map((j) => {
        const a = parId.get(j.affectation_id);
        return a ? { collaborateur_id: a.collaborateur_id, jour: j.jour, heures: num(j.heures) } : null;
      })
      .filter((x): x is JourAffecte => x !== null);
  }, [jours, affectations]);

  const semaines = useMemo(
    () => Array.from({ length: nbSemaines }, (_, w) => ajouterJours(lundi, w * 7)),
    [lundi, nbSemaines]
  );

  // Lignes : une par ressource
  const lignes = useMemo(() => {
    const aujourdhui = aISO(new Date());

    return annuaire
      .map((c) => {
        const cap = capacites.get(c.id);
        const aCapacite = cap ? [...cap.values()].some((j) => j.theorique > 0) : false;
        const siennes = affectations.filter((a) => a.collaborateur_id === c.id);

        const segments: SegmentAffiche[] = [];

        for (const a of siennes) {
          const segs = segmentsAffectation(joursParAffectation.get(a.id) ?? [], colonnes);
          const affaire = a.affaire_id ? affairesParId.get(a.affaire_id) : undefined;
          const libre = !a.affaire_id;

          for (const s of segs) {
            const base = libre ? a.libelle ?? "Événement" : `${affaire?.type ?? "?"} ${affaire?.numero ?? ""}`;
            const detail = !libre && a.code ? ` · ${a.code}` : "";

            segments.push({
              affectation: a,
              debutIdx: s.debutIdx,
              finIdx: s.finIdx,
              heures: s.heures,
              voie: 0,
              libre,
              etiquette: `${base}${detail}`,
              titre: `${base}${detail} — ${formatHeures(s.heures)}${a.commentaire ? ` — ${a.commentaire}` : ""}`,
            });
          }
        }

        const voies = attribuerVoies(segments);
        segments.forEach((s, i) => (s.voie = voies[i]));
        const nbVoies = Math.max(1, ...segments.map((s) => s.voie + 1));

        const surcharges = semaines
          .map((l) => ({ l, s: chargeParSemaine(capacites, joursAffectes, c.id, l) }))
          .filter((x) => x.s.ecart > 0.01);

        return { collab: c, aCapacite, segments, nbVoies, surcharges, visible: aCapacite || segments.length > 0, aujourdhui };
      })
      .filter((l) => l.visible)
      .sort((a, b) => Number(b.collab.inclus_statistiques) - Number(a.collab.inclus_statistiques) || nomCollab(a.collab).localeCompare(nomCollab(b.collab), "fr"));
  }, [annuaire, capacites, affectations, joursParAffectation, colonnes, affairesParId, semaines, joursAffectes]);

  // Totaux de l'équipe (hors encadrement)
  const totaux = useMemo(
    () =>
      semaines.map((l) => {
        let net = 0;
        let affecte = 0;

        for (const ligne of lignes) {
          if (!ligne.collab.inclus_statistiques || !ligne.aCapacite) continue;
          const s = chargeParSemaine(capacites, joursAffectes, ligne.collab.id, l);
          net += s.net;
          affecte += s.affecte;
        }

        return { net, affecte, dispo: net - affecte };
      }),
    [semaines, lignes, capacites, joursAffectes]
  );

  // Jalons : remises de DBE et objectifs de CBE
  const jalons = useMemo(() => {
    const index = new Map<string, Affaire[]>();

    for (const a of affaires) {
      if (!a.echeance || !(a.statut === "EN_COURS" || a.statut === "EN_ATTENTE")) continue;
      if (a.echeance < lundi || a.echeance > fin) continue;

      const jour = estWeekend(a.echeance) ? lundiDe(ajouterJours(a.echeance, 7)) : a.echeance;
      if (!index.has(jour)) index.set(jour, []);
      index.get(jour)!.push(a);
    }

    return index;
  }, [affaires, lundi, fin]);

  const peutAgir = Boolean(referentiel);

  const ouvrirEdition = useCallback(async (a: Affectation) => {
    try {
      const joursComplets = await chargerJoursAffectation(a.id);
      setDialogue({ edition: { affectation: a, jours: joursComplets } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Impossible d’ouvrir l’affectation.");
    }
  }, []);

  const col = (i: number) => i + 2;
  const gabarit = `${LARGEUR_NOM}px repeat(${colonnes.length}, minmax(0, 1fr))`;
  const aujourdhui = aISO(new Date());

  const bouton = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#b9bec5"}`,
    minHeight: 44,
    padding: "0 16px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const flecheStyle: CSSProperties = {
    minHeight: 44,
    minWidth: 44,
    border: "1.5px solid #b9bec5",
    background: "#ffffff",
    borderRadius: 8,
    color: C.rougeFonce,
    fontSize: 18,
    fontWeight: 800,
    cursor: "pointer",
  };

  const pas = Math.max(1, Math.floor(nbSemaines / 2));
  const dernierJour = colonnes[colonnes.length - 1];

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="planning" />

      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={page.titre}>Planning BE</h1>
          <p style={page.sousTitre}>
            La largeur d’un bloc est la période réellement affectée. Les absences viennent de Validation RH, les jours
            fériés sont automatiques. Le planning avertit, il ne bloque rien.
          </p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" aria-label="Période précédente" style={flecheStyle} onClick={() => setLundi(ajouterJours(lundi, -7 * pas))}>◀</button>
            <div style={{ fontWeight: 800, fontSize: 18, minWidth: 230, textAlign: "center" }}>
              {formatDate(lundi)} → {dernierJour ? formatDate(dernierJour) : ""}
              <div style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>
                S{numeroSemaine(lundi)} à S{numeroSemaine(dernierJour ?? lundi)} · {nbSemaines} semaines
              </div>
            </div>
            <button type="button" aria-label="Période suivante" style={flecheStyle} onClick={() => setLundi(ajouterJours(lundi, 7 * pas))}>▶</button>
            <button type="button" style={{ ...page.btnSecondaire, border: "none", textDecoration: "underline" }} onClick={() => setLundi(lundiDe(aujourdhui))}>
              Aujourd’hui
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {[2, 4, 8].map((n) => (
              <button key={n} type="button" aria-pressed={nbSemaines === n} style={bouton(nbSemaines === n)} onClick={() => setNbSemaines(n)}>
                {n} semaines
              </button>
            ))}
            <button
              type="button"
              style={{ ...page.btnPrimaire, opacity: peutAgir ? 1 : 0.5 }}
              disabled={!peutAgir}
              onClick={() => setDialogue({ prefill: {} })}
            >
              + Ajouter une affectation
            </button>
          </div>
        </div>

        {chargement && <Message genre="info">Chargement du planning…</Message>}

        <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            {/* En-têtes */}
            <div style={{ display: "grid", gridTemplateColumns: gabarit }}>
              <div style={{ gridColumn: 1, gridRow: "1 / span 2", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>
                Ressource
              </div>
              {semaines.map((l, w) => (
                <div
                  key={l}
                  style={{ gridColumn: `${col(5 * w)} / span 5`, gridRow: 1, textAlign: "center", fontWeight: 800, padding: "8px 0", background: "#f1f2f4", borderLeft: `1px solid ${C.ligne}`, fontSize: 14 }}
                >
                  S{numeroSemaine(l)} <span style={{ fontWeight: 600, color: C.gris }}>· {formatDate(l).slice(0, 5)}</span>
                </div>
              ))}
              {colonnes.map((j, i) => (
                <div
                  key={j}
                  style={{
                    gridColumn: col(i),
                    gridRow: 2,
                    textAlign: "center",
                    padding: "5px 0",
                    background: estFerie(j) ? "#e3e6ea" : j === aujourdhui ? "#fff4f4" : "#ffffff",
                    borderLeft: `1px solid ${i % 5 === 0 ? C.ligne : "#eef0f3"}`,
                    borderBottom: `1px solid ${C.ligne}`,
                    lineHeight: 1.15,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.gris }}>{JOURS_COURTS[jourSemaine(j) - 1]}</div>
                  <div style={{ fontSize: nbSemaines > 4 ? 11 : 15, fontWeight: j === aujourdhui ? 800 : 700, color: j === aujourdhui ? C.rougeFonce : C.encre }}>
                    {Number(j.slice(8))}
                  </div>
                  {estFerie(j) && nbSemaines <= 4 && <div style={{ fontSize: 10, fontWeight: 700 }}>Férié</div>}
                </div>
              ))}
            </div>

            {/* Jalons */}
            <div style={{ display: "grid", gridTemplateColumns: gabarit, borderTop: `1px solid ${C.ligne}`, minHeight: 40 }}>
              <div style={{ gridColumn: 1, display: "flex", alignItems: "center", padding: "6px 4px", fontSize: 12, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", color: "#3b4046" }}>
                Échéances
              </div>
              {colonnes.map((j, i) => (
                <div key={j} style={{ gridColumn: col(i), borderLeft: `1px solid ${i % 5 === 0 ? C.ligne : "#f4f5f7"}`, background: estFerie(j) ? "#e9ebee" : "transparent", padding: "3px 1px", display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch" }}>
                  {(jalons.get(j) ?? []).map((a) => (
                    <Link
                      key={a.id}
                      href={`/pilotage/affaire/${a.id}`}
                      title={`${a.type === "DBE" ? "Remise de l’offre" : "Objectif"} ${a.type} ${a.numero} — ${a.designation} (${formatDate(a.echeance)})`}
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textDecoration: "none",
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "2px 4px",
                        borderRadius: 4,
                        ...(a.type === "DBE"
                          ? { background: "#f2bfd0", color: "#4a0f28", border: "1px solid #d98aa6" }
                          : { background: "#ffffff", color: C.rougeFonce, border: `1.5px solid ${C.rouge}` }),
                      }}
                    >
                      {a.type === "DBE" ? "◆" : "⚑"} {a.numero}
                    </Link>
                  ))}
                </div>
              ))}
            </div>

            {/* Ressources */}
            {lignes.map((ligne) => (
              <div
                key={ligne.collab.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: gabarit,
                  gridTemplateRows: `repeat(${ligne.nbVoies}, 34px)`,
                  rowGap: 4,
                  borderTop: `1px solid ${C.ligne}`,
                  padding: "6px 0",
                }}
              >
                <div style={{ gridColumn: 1, gridRow: `1 / span ${ligne.nbVoies}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, paddingLeft: 4 }}>
                  <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1 }}>{nomCollab(ligne.collab)}</div>
                  <div style={{ fontSize: 12, color: C.gris }}>
                    {!ligne.collab.inclus_statistiques ? "Encadrement" : ligne.aCapacite ? "" : "Sans horaire"}
                  </div>
                  {ligne.surcharges.slice(0, 2).map((s) => (
                    <span
                      key={s.l}
                      style={{ alignSelf: "flex-start", padding: "2px 8px", borderRadius: 999, background: "#ffffff", border: "1.5px solid #b3261e", color: C.rougeTexte, fontWeight: 800, fontSize: 12 }}
                    >
                      ▲ S{numeroSemaine(s.l)} : +{formatHeures(s.s.ecart)}
                    </span>
                  ))}
                </div>

                {/* fonds : semaines en surcharge, séparateurs, fériés, absences */}
                {ligne.surcharges.map((s) => {
                  const w = semaines.indexOf(s.l);
                  return (
                    <div key={`s-${s.l}`} aria-hidden="true" style={{ gridColumn: `${col(5 * w)} / span 5`, gridRow: `1 / span ${ligne.nbVoies}`, background: "#fdecec", border: "2px solid #b3261e", borderRadius: 6, boxSizing: "border-box" }} />
                  );
                })}
                {colonnes.map((j, i) => {
                  const jc = capacites.get(ligne.collab.id)?.get(j);
                  const ferie = estFerie(j);
                  const absent = jc && jc.theorique > 0 && !ferie && jc.absence >= jc.theorique * 0.95;
                  const partiel = jc && !absent && jc.absence > 0.01;

                  return (
                    <div key={`f-${j}`} style={{ display: "contents" }}>
                      {i % 5 === 0 && (
                        <div aria-hidden="true" style={{ gridColumn: col(i), gridRow: `1 / span ${ligne.nbVoies}`, borderLeft: `1px solid ${C.ligne}` }} />
                      )}
                      {ferie && <div aria-hidden="true" style={{ gridColumn: col(i), gridRow: `1 / span ${ligne.nbVoies}`, background: "#e9ebee" }} />}
                      {absent && (
                        <div
                          title="Absent(e) — Validation RH"
                          style={{ gridColumn: col(i), gridRow: `1 / span ${ligne.nbVoies}`, margin: "2px 1px", borderRadius: 5, background: "repeating-linear-gradient(45deg,#cfd4da,#cfd4da 5px,#eceef1 5px,#eceef1 10px)", display: "flex", alignItems: "center", justifyContent: "center", writingMode: "vertical-rl", fontSize: 11, fontWeight: 700, color: "#2c3238" }}
                        >
                          {nbSemaines <= 4 ? "Absent(e)" : ""}
                        </div>
                      )}
                      {partiel && (
                        <div
                          title={`Absence partielle : ${formatHeures(jc!.absence)}`}
                          style={{ gridColumn: col(i), gridRow: `${ligne.nbVoies} / span 1`, alignSelf: "end", height: 8, margin: "0 1px", borderRadius: 3, background: "repeating-linear-gradient(45deg,#cfd4da,#cfd4da 4px,#eceef1 4px,#eceef1 8px)" }}
                        />
                      )}
                    </div>
                  );
                })}

                {/* blocs */}
                {ligne.segments.map((s, k) => {
                  const nb = s.finIdx - s.debutIdx + 1;
                  const cbe = !s.libre && affairesParId.get(s.affectation.affaire_id ?? "")?.type === "CBE";
                  const style: CSSProperties = s.libre
                    ? { background: "#e8e3f5", border: "1.5px dashed #6b58a8", color: "#2b1d63" }
                    : cbe
                      ? { background: C.rouge, color: "#ffffff" }
                      : { background: "#f2bfd0", border: "1px solid #d98aa6", color: "#4a0f28" };

                  return (
                    <button
                      key={`${s.affectation.id}-${k}`}
                      type="button"
                      title={s.titre}
                      onClick={() => ouvrirEdition(s.affectation)}
                      style={{
                        gridColumn: `${col(s.debutIdx)} / ${col(s.finIdx) + 1}`,
                        gridRow: s.voie + 1,
                        alignSelf: "center",
                        height: 30,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 8px",
                        borderRadius: 5,
                        fontWeight: 800,
                        fontSize: 13,
                        overflow: "hidden",
                        margin: "0 1px",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                        cursor: "pointer",
                        textAlign: "left",
                        ...style,
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {nb === 1 && !s.libre ? s.etiquette.replace(/^(CBE|DBE) /, "") : nb === 1 ? "·" : s.etiquette}
                      </span>
                      {nb > 1 && <span style={{ fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", marginLeft: 8 }}>{formatHeures(s.heures)}</span>}
                    </button>
                  );
                })}
              </div>
            ))}

            {!chargement && lignes.length === 0 && (
              <p style={{ color: C.gris, padding: "16px 4px" }}>Aucune ressource à afficher sur cette période.</p>
            )}

            {/* Totaux */}
            {[
              { libelle: "Capacité BE", valeurs: totaux.map((t) => formatHeures(t.net)), fond: "#f8f9fa", couleur: C.encre, gras: false },
              { libelle: "Planifié", valeurs: totaux.map((t) => formatHeures(t.affecte)), fond: "#f8f9fa", couleur: C.encre, gras: false },
              {
                libelle: "Disponible",
                valeurs: totaux.map((t) => (t.dispo >= 0 ? formatHeures(t.dispo) : `Surcharge ${formatHeures(-t.dispo)}`)),
                fond: "#eef4fc",
                couleur: C.bleuTexte,
                gras: true,
              },
            ].map((ligneTotal) => (
              <div key={ligneTotal.libelle} style={{ display: "grid", gridTemplateColumns: gabarit, borderTop: `1px solid ${C.ligne}`, background: ligneTotal.fond, alignItems: "center" }}>
                <div style={{ gridColumn: 1, padding: "9px 4px", fontWeight: 800, fontSize: 13, letterSpacing: ".3px", textTransform: "uppercase", color: "#3b4046" }}>
                  {ligneTotal.libelle}
                </div>
                {ligneTotal.valeurs.map((v, w) => (
                  <div key={w} style={{ gridColumn: `${col(5 * w)} / span 5`, textAlign: "center", padding: "9px 0", borderLeft: `1px solid ${C.ligne}`, fontWeight: ligneTotal.gras ? 800 : 600, color: ligneTotal.couleur, fontSize: ligneTotal.gras ? 17 : 16 }}>
                    {v}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", fontSize: 13, color: "#3b4046", marginTop: 14 }}>
            {[
              { style: { background: C.rouge }, texte: "CBE (réalisation)" },
              { style: { background: "#f2bfd0", border: "1px solid #d98aa6" }, texte: "DBE (rédaction de l’offre, code DT)" },
              { style: { background: "#e8e3f5", border: "1.5px dashed #6b58a8" }, texte: "Événement libre" },
              { style: { background: "repeating-linear-gradient(45deg,#cfd4da,#cfd4da 4px,#eceef1 4px,#eceef1 8px)" }, texte: "Absence validée par les RH" },
              { style: { background: "#e3e6ea" }, texte: "Jour férié" },
              { style: { background: "#fdecec", border: "2px solid #b3261e" }, texte: "Semaine en surcharge" },
            ].map((l) => (
              <span key={l.texte} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <i style={{ display: "inline-block", width: 26, height: 14, borderRadius: 4, boxSizing: "border-box", ...(l.style as CSSProperties) }} />
                {l.texte}
              </span>
            ))}
            <span>◆ remise d’un DBE · ⚑ objectif d’un CBE (bande « Échéances »)</span>
          </div>
        </section>
      </div>

      {dialogue && referentiel && (
        <AffectationDialog
          onClose={() => setDialogue(null)}
          onSaved={(message) => {
            setDialogue(null);
            setInfo(message);
            setRechargement((n) => n + 1);
          }}
          affaires={affaires}
          annuaire={annuaire}
          referentiel={referentiel}
          imputations={imputations}
          codesDivers={codesDivers}
          prefill={dialogue.prefill}
          edition={dialogue.edition}
        />
      )}
    </main>
  );
}

export default function PlanningPage() {
  return (
    <GardeAcces droit="piloterBE">
      <PlanningContenu />
    </GardeAcces>
  );
}
