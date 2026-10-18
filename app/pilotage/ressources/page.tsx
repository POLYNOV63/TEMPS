"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { C, Message, Modal, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerAffaires,
  chargerAffectations,
  chargerAnnuaire,
  chargerCapacitesAbsences,
  chargerJoursAffectation,
} from "@/lib/pilotageDonnees";
import {
  aISO,
  ajouterJours,
  chargeParSemaine,
  construireCapacites,
  deplacerHeures,
  lundiDe,
  numeroSemaine,
  tauxServiceEquipe,
  type Affectation,
  type JourAffecte,
  type JourRow,
} from "@/lib/pilotagePlanning";
import {
  formatDate,
  formatHeures,
  nomCollab,
  num,
  traduireErreur,
  type Affaire,
  type Collab,
} from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - CHARGE PAR RESSOURCE (une semaine)

   Capacité théorique, absences et fériés déduits, heures affectées,
   écart. Une surcharge n'est jamais bloquée : on peut déplacer des
   heures vers une autre semaine et voir tout de suite la conséquence.
================================================================ */

const ECHELLE_MIN = 45;

type DeplacementEtat = {
  collab: Collab;
  affectationId: string;
  heures: string;
  semaineCible: string;
};

function RessourcesContenu() {
  const [lundi, setLundi] = useState(() => lundiDe(aISO(new Date())));
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [jours, setJours] = useState<JourRow[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rechargement, setRechargement] = useState(0);

  const [deplacement, setDeplacement] = useState<DeplacementEtat | null>(null);
  const [erreurModal, setErreurModal] = useState("");
  const [enCours, setEnCours] = useState(false);

  // fenêtre : 12 semaines à partir de la semaine affichée (vue d'ensemble et cibles d'un déplacement)
  const fenetreFin = ajouterJours(lundi, 12 * 7 - 1);

  useEffect(() => {
    let actif = true;

    Promise.all([chargerAnnuaire(), chargerAffaires({ horsPlanning: true })])
      .then(([an, af]) => {
        if (!actif) return;
        setAnnuaire(an);
        setAffaires(af);
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
  }, [lundi, fenetreFin, rechargement]);

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

  const finSemaine = ajouterJours(lundi, 6);

  const lignes = useMemo(
    () =>
      annuaire
        .map((c) => {
          const s = chargeParSemaine(capacites, joursAffectes, c.id, lundi);
          const heuresParAffectation = new Map<string, number>();

          for (const j of jours) {
            const a = affectationsParId.get(j.affectation_id);
            if (!a || a.collaborateur_id !== c.id || j.jour < lundi || j.jour > finSemaine) continue;
            heuresParAffectation.set(a.id, (heuresParAffectation.get(a.id) ?? 0) + num(j.heures));
          }

          const details = [...heuresParAffectation.entries()].map(([id, h]) => {
            const a = affectationsParId.get(id)!;
            const affaire = a.affaire_id ? affairesParId.get(a.affaire_id) : undefined;

            return {
              id,
              etiquette: a.affaire_id ? `${affaire?.type ?? "?"} ${affaire?.numero ?? ""}` : a.libelle ?? "Événement",
              libre: !a.affaire_id,
              heures: h,
            };
          });

          return { collab: c, semaine: s, details, visible: s.theorique > 0 || details.length > 0 };
        })
        .filter((l) => l.visible)
        .sort((a, b) => Number(b.collab.inclus_statistiques) - Number(a.collab.inclus_statistiques) || nomCollab(a.collab).localeCompare(nomCollab(b.collab), "fr")),
    [annuaire, capacites, joursAffectes, jours, affectationsParId, affairesParId, lundi, finSemaine]
  );

  const equipe = lignes.filter((l) => l.collab.inclus_statistiques && l.semaine.theorique > 0);
  const totalTheorique = equipe.reduce((t, l) => t + l.semaine.theorique, 0);
  const totalNet = equipe.reduce((t, l) => t + l.semaine.net, 0);
  const totalAffecte = equipe.reduce((t, l) => t + l.semaine.affecte, 0);
  const surcharges = equipe.filter((l) => l.semaine.ecart > 0.01);

  const echelle = Math.max(ECHELLE_MIN, ...lignes.map((l) => Math.max(l.semaine.net, l.semaine.affecte)));

  /* Vue d'ensemble sur 12 semaines */
  const semaines12 = useMemo(() => Array.from({ length: 12 }, (_, w) => ajouterJours(lundi, w * 7)), [lundi]);
  const equipe12 = useMemo(
    () => annuaire.filter((c) => c.inclus_statistiques && (capacites.get(c.id) ? [...capacites.get(c.id)!.values()].some((j) => j.theorique > 0) : false)),
    [annuaire, capacites]
  );
  const tauxParSemaine = useMemo(
    () =>
      semaines12.map((l) => {
        const t = tauxServiceEquipe(capacites, joursAffectes, equipe12.map((c) => c.id), [l]);
        return { lundi: l, taux: t.taux, affecte: t.affecte, net: t.net };
      }),
    [semaines12, capacites, joursAffectes, equipe12]
  );

  /* ------------------------------ déplacement ------------------------------ */

  function ouvrirDeplacement(collab: Collab, surcharge: number) {
    const ligne = lignes.find((l) => l.collab.id === collab.id);
    const premiere = ligne?.details[0];

    if (!premiere) {
      setErreur("Aucune affectation à déplacer cette semaine.");
      return;
    }

    setErreurModal("");
    setDeplacement({
      collab,
      affectationId: premiere.id,
      heures: String(Math.min(premiere.heures, Math.max(0.25, surcharge))).replace(".", ","),
      semaineCible: ajouterJours(lundi, 7),
    });
  }

  const apercuDeplacement = useMemo(() => {
    if (!deplacement) return null;

    const ligne = lignes.find((l) => l.collab.id === deplacement.collab.id);
    if (!ligne) return null;

    const heures = Math.max(0, num(deplacement.heures.replace(",", ".")));
    const cibleAvant = chargeParSemaine(capacites, joursAffectes, deplacement.collab.id, deplacement.semaineCible);

    return {
      heures,
      sourceApres: ligne.semaine.affecte - heures,
      sourceNet: ligne.semaine.net,
      cibleApres: cibleAvant.affecte + heures,
      cibleNet: cibleAvant.net,
    };
  }, [deplacement, lignes, capacites, joursAffectes]);

  async function appliquerDeplacement() {
    if (!deplacement) return;

    const a = affectationsParId.get(deplacement.affectationId);
    const heures = num(deplacement.heures.replace(",", "."));

    if (!a || heures <= 0) {
      setErreurModal("Indiquez un nombre d’heures à déplacer.");
      return;
    }

    setEnCours(true);
    setErreurModal("");

    try {
      const tous = await chargerJoursAffectation(a.id);
      const capCollab = capacites.get(deplacement.collab.id);

      const resultat = deplacerHeures({
        jours: tous.map((j) => ({ jour: j.jour, heures: num(j.heures) })),
        semaineSource: lundi,
        semaineCible: deplacement.semaineCible,
        heures,
        capaciteJour: (j) => capCollab?.get(j)?.net ?? 0,
      });

      if (resultat.jours.length === 0 || resultat.deplace <= 0) {
        setErreurModal("Aucun jour disponible dans la semaine cible (fériés, absences).");
        setEnCours(false);
        return;
      }

      const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {
        p_id: a.id,
        p_affaire_id: a.affaire_id,
        p_activite_id: a.activite_id,
        p_code: a.code,
        p_libelle: a.libelle,
        p_collaborateur_id: a.collaborateur_id,
        p_date_debut: resultat.jours[0].jour,
        p_date_fin: resultat.jours[resultat.jours.length - 1].jour,
        p_commentaire: a.commentaire,
        p_jours: resultat.jours,
        p_groupe_id: a.groupe_id,
      });

      if (error) throw new Error(error.message);

      setDeplacement(null);
      setInfo(`${formatHeures(resultat.deplace)} déplacées vers la semaine S${numeroSemaine(deplacement.semaineCible)}.`);
      setRechargement((n) => n + 1);
    } catch (e) {
      setErreurModal(traduireErreur(e instanceof Error ? e.message : String(e)));
    } finally {
      setEnCours(false);
    }
  }

  const ecartPastille = (ecart: number) =>
    ecart > 0.01 ? (
      <Pastille genre="crit">Surcharge +{formatHeures(ecart)}</Pastille>
    ) : ecart > -0.01 ? (
      <Pastille genre="ok">Complet</Pastille>
    ) : (
      <Pastille genre="info">Disponible : {formatHeures(-ecart)}</Pastille>
    );

  const flecheStyle = {
    minHeight: 44,
    minWidth: 44,
    border: "1.5px solid #b9bec5",
    background: "#ffffff",
    borderRadius: 8,
    color: C.rougeFonce,
    fontSize: 18,
    fontWeight: 800,
    cursor: "pointer",
  } as const;

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="ressources" />

      <div style={page.contenu}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div>
            <h1 style={page.titre}>Charge par ressource</h1>
            <p style={page.sousTitre}>Qui est chargé, qui est disponible, semaine par semaine.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" aria-label="Semaine précédente" style={flecheStyle} onClick={() => setLundi(ajouterJours(lundi, -7))}>◀</button>
            <div style={{ fontWeight: 800, fontSize: 18, minWidth: 220, textAlign: "center" }}>
              S{numeroSemaine(lundi)}
              <div style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>
                {formatDate(lundi)} → {formatDate(ajouterJours(lundi, 4))}
              </div>
            </div>
            <button type="button" aria-label="Semaine suivante" style={flecheStyle} onClick={() => setLundi(ajouterJours(lundi, 7))}>▶</button>
            <button type="button" style={{ ...page.btnSecondaire, border: "none", textDecoration: "underline" }} onClick={() => setLundi(lundiDe(aISO(new Date())))}>
              Aujourd’hui
            </button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
          <Tuile libelle="Capacité disponible" valeur={formatHeures(totalNet)} sous={`${formatHeures(totalTheorique)} théoriques, fériés et absences déduits`} />
          <Tuile libelle="Planifié" valeur={formatHeures(totalAffecte)} sous="affectations de la semaine" />
          <Tuile libelle="Disponible" valeur={totalNet - totalAffecte >= 0 ? formatHeures(totalNet - totalAffecte) : "0 h"} sous="sur l’ensemble de l’équipe" />
          <Tuile
            libelle="En surcharge"
            valeur={`${surcharges.length} personne${surcharges.length > 1 ? "s" : ""}`}
            sous={surcharges.map((l) => `${nomCollab(l.collab)} +${formatHeures(l.semaine.ecart)}`).join(" · ") || "aucune"}
            accent={surcharges.length > 0}
          />
        </div>

        {/* Vue d'ensemble : charge de chaque personne sur 12 semaines */}
        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Charge des 12 prochaines semaines</h2>
          <p style={{ margin: "0 0 12px", color: C.gris, fontSize: 14 }}>
            Heures affectées ÷ capacité de chaque personne (congés et jours fériés déduits). Elle découle du planning des affaires : rien n’est saisi à part.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 150 }} />
                {semaines12.map((l) => (
                  <col key={l} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th style={page.th} />
                  {semaines12.map((l) => (
                    <th key={l} style={{ ...page.th, textAlign: "center", padding: "6px 2px" }}>S{numeroSemaine(l)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equipe12.map((c) => (
                  <tr key={c.id}>
                    <th scope="row" style={{ textAlign: "left", padding: "6px 8px", fontSize: 15 }}>{nomCollab(c)}</th>
                    {semaines12.map((l) => {
                      const s = chargeParSemaine(capacites, joursAffectes, c.id, l);
                      const pct = s.net > 0 ? Math.round((s.affecte / s.net) * 100) : s.affecte > 0 ? 999 : 0;
                      const surcharge = pct > 100;

                      return (
                        <td
                          key={l}
                          title={`S${numeroSemaine(l)} : ${formatHeures(s.affecte)} affectées pour ${formatHeures(s.net)} disponibles`}
                          style={{
                            padding: "6px 2px",
                            textAlign: "center",
                            border: "1px solid #ffffff",
                            fontSize: 12,
                            fontWeight: 700,
                            background: surcharge ? "repeating-linear-gradient(45deg,#fde1e1,#fde1e1 5px,#f5b5b0 5px,#f5b5b0 10px)" : pct === 0 ? "#f4f5f7" : pct >= 80 ? "#cfe0f3" : "#e6eef8",
                            color: surcharge ? "#8f1010" : pct === 0 ? "#9aa0a6" : "#10263d",
                          }}
                        >
                          {pct === 0 ? "—" : surcharge ? `▲ ${pct === 999 ? "!" : pct} %` : `${pct} %`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row" style={{ textAlign: "left", padding: "8px 8px", fontSize: 13, borderTop: `2px solid ${C.ligne}`, background: "#f8f9fa" }}>
                    Taux de charge
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.gris }}>équipe, hors encadrement</div>
                  </th>
                  {tauxParSemaine.map((s) => (
                    <td
                      key={s.lundi}
                      title={`S${numeroSemaine(s.lundi)} : ${formatHeures(s.affecte)} affectées pour ${formatHeures(s.net)} de capacité`}
                      style={{ padding: "8px 2px", textAlign: "center", borderTop: `2px solid ${C.ligne}`, background: "#f8f9fa", fontSize: 13, fontWeight: 800, color: s.taux > 100 ? "#8f1010" : C.encre }}
                    >
                      {s.net > 0 ? `${s.taux > 100 ? "▲ " : ""}${Math.round(s.taux)} %` : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Détail de la semaine S{numeroSemaine(lundi)}</h2>

        <section style={{ ...page.carte, padding: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1020 }}>
              <thead>
                <tr>
                  <th style={{ ...page.th, width: 120 }}>Ressource</th>
                  <th style={{ ...page.th, textAlign: "right" }}>Théorique</th>
                  <th style={{ ...page.th, textAlign: "right" }}>Fériés et absences</th>
                  <th style={{ ...page.th, textAlign: "right" }}>Disponible</th>
                  <th style={{ ...page.th, textAlign: "right" }}>Affecté</th>
                  <th style={page.th}>Charge</th>
                  <th style={page.th}>Écart</th>
                  <th style={page.th}>Affectations de la semaine</th>
                  <th style={page.th} />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const encadrement = !l.collab.inclus_statistiques;
                  const s = l.semaine;
                  const exces = Math.max(0, s.affecte - s.net);
                  const normal = Math.min(s.affecte, s.net);

                  return (
                    <tr key={l.collab.id}>
                      <td style={page.td}>
                        <strong style={{ fontSize: 18 }}>{nomCollab(l.collab)}</strong>
                        {encadrement && <div style={{ fontSize: 12, color: C.gris }}>Encadrement</div>}
                      </td>
                      <td style={{ ...page.td, textAlign: "right" }}>{formatHeures(s.theorique)}</td>
                      <td style={{ ...page.td, textAlign: "right" }}>
                        {s.ferie + s.absence > 0 ? (
                          <>
                            <strong>{formatHeures(s.ferie + s.absence)}</strong>
                            <div style={{ fontSize: 12, color: C.gris }}>
                              {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "absence RH" : ""].filter(Boolean).join(" + ")}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...page.td, textAlign: "right" }}>
                        <strong>{encadrement ? "hors capacité" : formatHeures(s.net)}</strong>
                      </td>
                      <td style={{ ...page.td, textAlign: "right" }}>
                        <strong>{formatHeures(s.affecte)}</strong>
                      </td>
                      <td style={{ ...page.td, width: "20%" }}>
                        {!encadrement && (
                          <div
                            role="img"
                            aria-label={`Affecté ${formatHeures(s.affecte)} pour ${formatHeures(s.net)} disponibles`}
                            style={{ position: "relative", height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 180 }}
                          >
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(normal / echelle) * 100}%`, background: "#34506b" }} />
                            {exces > 0 && (
                              <div style={{ position: "absolute", left: `${(normal / echelle) * 100}%`, top: 0, bottom: 0, width: `${(exces / echelle) * 100}%`, background: "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#e58a84 4px,#e58a84 8px)" }} />
                            )}
                            <div title={`Capacité disponible : ${formatHeures(s.net)}`} style={{ position: "absolute", left: `${(s.net / echelle) * 100}%`, top: -4, bottom: -4, width: 2, background: C.encre }} />
                          </div>
                        )}
                      </td>
                      <td style={page.td}>{encadrement ? <Pastille genre="info">Pas de seuil</Pastille> : ecartPastille(s.ecart)}</td>
                      <td style={{ ...page.td, fontSize: 14 }}>
                        {l.details.length === 0 ? (
                          <span style={{ color: C.gris }}>—</span>
                        ) : (
                          l.details.map((d) => (
                            <div key={d.id} style={{ whiteSpace: "nowrap" }}>
                              <strong>{d.etiquette}</strong> · {formatHeures(d.heures)}
                            </div>
                          ))
                        )}
                      </td>
                      <td style={{ ...page.td, textAlign: "right" }}>
                        {!encadrement && s.ecart > 0.01 && l.details.length > 0 && (
                          <button type="button" style={{ ...page.btnSecondaire, minHeight: 44 }} onClick={() => ouvrirDeplacement(l.collab, s.ecart)}>
                            Déplacer…
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...page.td, background: "#f8f9fa" }}><strong>Équipe BE</strong></td>
                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalTheorique)}</strong></td>
                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalTheorique - totalNet)}</strong></td>
                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalNet)}</strong></td>
                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalAffecte)}</strong></td>
                  <td style={{ ...page.td, background: "#f8f9fa" }} />
                  <td style={{ ...page.td, background: "#f8f9fa" }}>{ecartPastille(totalAffecte - totalNet)}</td>
                  <td style={{ ...page.td, background: "#f8f9fa", fontSize: 14 }}>
                    {surcharges.length > 0 ? `${surcharges.length} personne(s) en surcharge` : ""}
                  </td>
                  <td style={{ ...page.td, background: "#f8f9fa" }} />
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ margin: "12px 4px 0", fontSize: 13, color: C.gris }}>
            Capacité théorique : profil horaire. Absences : demandes validées dans Validation RH. Le trait noir marque la
            capacité disponible ; la zone hachurée rouge est le dépassement. L’encadrement n’entre pas dans la capacité de
            l’équipe.
          </p>
          <div style={{ marginTop: 10 }}>
            <Link href="/pilotage/planning" style={{ fontWeight: 700, color: C.rougeFonce }}>
              Voir le planning visuel →
            </Link>
          </div>
        </section>
      </div>

      {deplacement && (
        <Modal titre={`Déplacer des heures — ${nomCollab(deplacement.collab)}`} onClose={() => setDeplacement(null)} largeur={600}>
          {erreurModal && <Message genre="erreur">{erreurModal}</Message>}
          <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
            Les heures sont retirées en fin de semaine {`S${numeroSemaine(lundi)}`} et réparties dans la semaine choisie.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label htmlFor="dep-aff" style={page.etiquette}>Affectation</label>
              <select
                id="dep-aff"
                value={deplacement.affectationId}
                onChange={(e) => setDeplacement({ ...deplacement, affectationId: e.target.value })}
                style={page.entrees}
              >
                {lignes
                  .find((l) => l.collab.id === deplacement.collab.id)
                  ?.details.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.etiquette} — {formatHeures(d.heures)} cette semaine
                    </option>
                  ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px" }}>
                <label htmlFor="dep-h" style={page.etiquette}>Heures à déplacer</label>
                <input
                  id="dep-h"
                  type="text"
                  inputMode="decimal"
                  value={deplacement.heures}
                  onChange={(e) => setDeplacement({ ...deplacement, heures: e.target.value })}
                  style={{ ...page.entrees, textAlign: "right" }}
                />
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <label htmlFor="dep-s" style={page.etiquette}>Vers la semaine</label>
                <select
                  id="dep-s"
                  value={deplacement.semaineCible}
                  onChange={(e) => setDeplacement({ ...deplacement, semaineCible: e.target.value })}
                  style={page.entrees}
                >
                  {[1, 2, 3, 4, 5].map((n) => {
                    const l = ajouterJours(lundi, 7 * n);
                    return (
                      <option key={l} value={l}>
                        S{numeroSemaine(l)} — {formatDate(l)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {apercuDeplacement && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", border: `1px solid ${C.ligne}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: C.gris }}>
                    S{numeroSemaine(lundi)} · {nomCollab(deplacement.collab)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 16 }}>
                    <span style={{ color: C.gris, textDecoration: "line-through" }}>{formatHeures(apercuDeplacement.sourceApres + apercuDeplacement.heures)}</span> →{" "}
                    <strong>{formatHeures(apercuDeplacement.sourceApres)}</strong>
                  </div>
                  <div style={{ marginTop: 8 }}>{ecartPastille(apercuDeplacement.sourceApres - apercuDeplacement.sourceNet)}</div>
                </div>
                <div style={{ flex: "1 1 220px", border: `1px solid ${C.ligne}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: C.gris }}>
                    S{numeroSemaine(deplacement.semaineCible)} · {nomCollab(deplacement.collab)}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 16 }}>
                    <span style={{ color: C.gris }}>{formatHeures(apercuDeplacement.cibleApres - apercuDeplacement.heures)}</span> →{" "}
                    <strong>{formatHeures(apercuDeplacement.cibleApres)}</strong>
                  </div>
                  <div style={{ marginTop: 8 }}>{ecartPastille(apercuDeplacement.cibleApres - apercuDeplacement.cibleNet)}</div>
                </div>
              </div>
            )}

            <p style={{ margin: 0, fontSize: 14, color: "#3b4046" }}>
              Le déplacement est toujours autorisé : le logiciel signale seulement si la semaine d’arrivée dépasse la
              capacité. Le responsable décide.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setDeplacement(null)}>Annuler</button>
              <button type="button" style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={appliquerDeplacement}>
                {enCours ? "Enregistrement…" : "Appliquer le déplacement"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

export default function RessourcesPage() {
  return (
    <GardeAcces droit="chargeRessources">
      <RessourcesContenu />
    </GardeAcces>
  );
}
