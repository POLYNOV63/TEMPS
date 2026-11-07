"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
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

  // DETAIL_PERIODE : le détail porte sur 1, 2 ou 4 semaines à partir de la semaine affichée
  const [nbSemDetail, setNbSemDetail] = useState(1);
  const finSemaine = ajouterJours(lundi, 7 * nbSemDetail - 1);

  const lignes = useMemo(
    () =>
      annuaire
        .map((c) => {
          const s = Array.from({ length: nbSemDetail }, (_, w) => chargeParSemaine(capacites, joursAffectes, c.id, ajouterJours(lundi, 7 * w))).reduce((t, x) => ({
            ...t,
            theorique: t.theorique + x.theorique,
            ferie: t.ferie + x.ferie,
            absence: t.absence + x.absence,
            net: t.net + x.net,
            affecte: t.affecte + x.affecte,
            ecart: t.ecart + x.ecart,
          }));
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
    [annuaire, capacites, joursAffectes, jours, affectationsParId, affairesParId, lundi, finSemaine, nbSemDetail]
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

  /* REPARTITION_CHARGE : charge et répartition CBE / DBE / Divers, par activité (et par personne) sur les 12 semaines ;
     réalisé (pointé) pour les semaines passées, prévu ensuite */
  const [groupesRep, setGroupesRep] = useState<{ predo: Map<string, string>; activites: { id: string; nom: string; ordre: number }[] }>({ predo: new Map(), activites: [] });
  const [realiseRep, setRealiseRep] = useState<{ collaborateur_id: string; jour: string; type_affaire: string; heures: number }[]>([]);
  const [groupesOuverts, setGroupesOuverts] = useState<Set<string>>(new Set());
  const lundiActuelRep = lundiDe(aISO(new Date()));
  useEffect(() => {
    void Promise.all([
      supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id").eq("niveau", "PRINCIPALE"),
      supabase.from("activites").select("id,nom,ordre_affichage"),
    ]).then(([p, a]) =>
      setGroupesRep({
        predo: new Map(((p.data ?? []) as { collaborateur_id: string; activite_id: string }[]).map((x) => [x.collaborateur_id, x.activite_id])),
        activites: ((a.data ?? []) as { id: string; nom: string; ordre_affichage: number | null }[]).map((x) => ({ id: x.id, nom: x.nom, ordre: x.ordre_affichage ?? 99 })),
      })
    );
  }, []);
  useEffect(() => {
    if (lundi >= lundiActuelRep) {
      setRealiseRep([]);
      return;
    }
    let actif = true;
    const veille = ajouterJours(lundiActuelRep, -1);
    const finR = fenetreFin < veille ? fenetreFin : veille;
    void (async () => {
      const tout: { collaborateur_id: string; jour: string; type_affaire: string; heures: number | string }[] = [];
      for (let a = 0; a < 100000; a += 1000) {
        const { data, error } = await supabase.rpc("planning_realise", { p_debut: lundi, p_fin: finR }).range(a, a + 999);
        if (error || !data) break;
        tout.push(...(data as typeof tout));
        if (data.length < 1000) break;
      }
      if (actif) setRealiseRep(tout.map((x) => ({ collaborateur_id: x.collaborateur_id, jour: x.jour, type_affaire: x.type_affaire, heures: Number(x.heures) || 0 })));
    })();
    return () => {
      actif = false;
    };
  }, [lundi, fenetreFin, lundiActuelRep]);

  const repartition = useMemo(() => {
    type Cel = { dispo: number; cbe: number; dbe: number; div: number };
    const vide = (): Cel => ({ dispo: 0, cbe: 0, dbe: 0, div: 0 });
    const semaineDe = (jour: string) => semaines12.findIndex((l) => jour >= l && jour <= ajouterJours(l, 6));
    const parPersonne = new Map<string, Cel[]>();
    for (const c of equipe12) parPersonne.set(c.id, semaines12.map((l) => ({ ...vide(), dispo: chargeParSemaine(capacites, joursAffectes, c.id, l).net })));
    const ajouter = (id: string, jour: string, type: string | undefined, h: number, passe: boolean) => {
      const t = parPersonne.get(id);
      const w = semaineDe(jour);
      if (!t || w < 0 || (semaines12[w] < lundiActuelRep) !== passe) return;
      if (type === "CBE") t[w].cbe += h;
      else if (type === "DBE") t[w].dbe += h;
      else t[w].div += h;
    };
    for (const j of jours) {
      const a = affectationsParId.get(j.affectation_id);
      if (a) ajouter(a.collaborateur_id, j.jour, a.affaire_id ? affairesParId.get(a.affaire_id)?.type : undefined, num(j.heures), false);
    }
    for (const x of realiseRep) ajouter(x.collaborateur_id, x.jour, x.type_affaire, x.heures, true);
    const parId = new Map(groupesRep.activites.map((a) => [a.id, a]));
    const parGroupe = new Map<string, { nom: string; ordre: number; personnes: Collab[] }>();
    for (const c of equipe12) {
      const act = parId.get(groupesRep.predo.get(c.id) ?? "");
      const k = act?.id ?? "_";
      const g = parGroupe.get(k) ?? { nom: act?.nom ?? "Sans activité principale", ordre: act?.ordre ?? 999, personnes: [] };
      g.personnes.push(c);
      parGroupe.set(k, g);
    }
    const somme = (ids: string[]) =>
      semaines12.map((_, w) =>
        ids.reduce((t, id) => {
          const x = parPersonne.get(id)?.[w];
          if (x) {
            t.dispo += x.dispo;
            t.cbe += x.cbe;
            t.dbe += x.dbe;
            t.div += x.div;
          }
          return t;
        }, vide())
      );
    return {
      parPersonne,
      equipe: somme(equipe12.map((c) => c.id)),
      groupes: [...parGroupe.entries()]
        .sort((x, y) => x[1].ordre - y[1].ordre)
        .map(([cle, g]) => ({ cle, nom: g.nom, personnes: g.personnes.sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), "fr")), cellules: somme(g.personnes.map((c) => c.id)) })),
    };
  }, [semaines12, equipe12, capacites, joursAffectes, jours, affectationsParId, affairesParId, realiseRep, groupesRep, lundiActuelRep]);

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
          <Tuile libelle="Planifié" valeur={formatHeures(totalAffecte)} sous={nbSemDetail === 1 ? "affectations de la semaine" : `affectations des ${nbSemDetail} semaines`} />
          <Tuile libelle="Disponible" valeur={totalNet - totalAffecte >= 0 ? formatHeures(totalNet - totalAffecte) : "0 h"} sous="sur l’ensemble de l’équipe" />
          <Tuile
            libelle="En surcharge"
            valeur={`${surcharges.length} personne${surcharges.length > 1 ? "s" : ""}`}
            sous={surcharges.map((l) => `${nomCollab(l.collab)} +${formatHeures(l.semaine.ecart)}`).join(" · ") || "aucune"}
            accent={surcharges.length > 0}
          />
        </div>

        {/* DETAIL_PERIODE : le détail en premier, sur 1, 2 ou 4 semaines */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 10px" }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {nbSemDetail === 1
              ? `Détail de la semaine S${numeroSemaine(lundi)}`
              : `Détail de S${numeroSemaine(lundi)} à S${numeroSemaine(ajouterJours(lundi, 7 * (nbSemDetail - 1)))}`}
          </h2>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={nbSemDetail === n}
                onClick={() => setNbSemDetail(n)}
                style={{ ...page.btnSecondaire, minHeight: 32, padding: "0 10px", background: nbSemDetail === n ? C.rouge : "#ffffff", color: nbSemDetail === n ? "#ffffff" : C.rougeFonce, borderColor: nbSemDetail === n ? C.rouge : undefined }}
              >
                {n === 1 ? "1 semaine" : `${n} semaines`}
              </button>
            ))}
          </span>
          {nbSemDetail > 1 && <span style={{ fontSize: 13, color: C.gris }}>totaux sur la période · « Déplacer… » se fait semaine par semaine</span>}
        </div>

        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
          {/* DETAIL_COMPACT : sans ascenseur horizontal, titres figés */}
          <div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4", width: 110 }}>Ressource</th>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4", textAlign: "right" }}>Théorique</th>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4", textAlign: "right" }} title="Heures affectées / capacité disponible (fériés et absences déduits)">Affecté / capacité</th>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }}>Charge</th>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }}>Écart</th>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }}>Affectations</th>
                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }} />
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
                      <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <strong>{formatHeures(s.affecte)}</strong>
                        <span style={{ color: C.gris }}> / {encadrement ? "hors capacité" : formatHeures(s.net)}</span>
                        {s.ferie + s.absence > 0 && (
                          <div style={{ fontSize: 12, color: C.gris }}>
                            − {formatHeures(s.ferie + s.absence)} {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "absence" : ""].filter(Boolean).join(" + ")}
                          </div>
                        )}
                      </td>
                      <td style={{ ...page.td, width: "20%" }}>
                        {!encadrement && (
                          <div
                            role="img"
                            aria-label={`Affecté ${formatHeures(s.affecte)} pour ${formatHeures(s.net)} disponibles`}
                            style={{ position: "relative", height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 100 }}
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
                        {nbSemDetail === 1 && !encadrement && s.ecart > 0.01 && l.details.length > 0 && (
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
                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right", whiteSpace: "nowrap" }}>
                    <strong>{formatHeures(totalAffecte)}</strong>
                    <span style={{ color: C.gris }}> / {formatHeures(totalNet)}</span>
                  </td>
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

        {/* Vue d'ensemble : charge de chaque personne sur 12 semaines */}
        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Charge des 12 semaines à partir de S{numeroSemaine(lundi)}</h2>
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

        {/* REPARTITION_CHARGE : par activité, dépliable par personne */}
        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Répartition du temps, par activité</h2>
          <p style={{ margin: "0 0 12px", color: C.gris, fontSize: 14 }}>
            Pour chaque semaine : la <strong>charge</strong> (heures ÷ capacité disponible, congés et fériés déduits), puis la part du temps disponible passée
            sur les commandes, les devis et l’interne : <span style={{ color: "#b03a64", fontWeight: 800 }}>CBE</span> ·{" "}
            <span style={{ color: "#c2708f", fontWeight: 800 }}>DBE</span> · <span style={{ color: "#6b7178", fontWeight: 800 }}>Divers</span>, en %. Semaines
            passées (fond gris) : ce qui a été pointé ; semaines à venir : ce qui est planifié. Cliquez sur une activité pour voir chacun.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 170 }} />
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
                      <div style={{ fontSize: 10, fontWeight: 600, color: C.gris }}>{l < lundiActuelRep ? "réalisé" : "prévu"}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const cellule = (x: { dispo: number; cbe: number; dbe: number; div: number }, l: string, gras: boolean) => {
                    const pc = (h: number) => Math.round((h / x.dispo) * 100);
                    return (
                      <td
                        key={l}
                        title={x.dispo > 0 ? `S${numeroSemaine(l)} : CBE ${formatHeures(x.cbe)} · DBE ${formatHeures(x.dbe)} · Divers ${formatHeures(x.div)} pour ${formatHeures(x.dispo)} disponibles` : undefined}
                        style={{ padding: "5px 2px", textAlign: "center", borderBottom: `1px solid ${C.ligne}`, background: l < lundiActuelRep ? "#f6f7f8" : undefined }}
                      >
                        {x.dispo > 0 ? (
                          <>
                            <div style={{ fontSize: gras ? 14 : 13, fontWeight: 800, color: C.encre }}>{pc(x.cbe + x.dbe + x.div)} %</div>
                            <div style={{ fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                              <span style={{ color: "#b03a64" }}>{pc(x.cbe)}</span>
                              <span style={{ color: C.gris }}> · </span>
                              <span style={{ color: "#c2708f" }}>{pc(x.dbe)}</span>
                              <span style={{ color: C.gris }}> · </span>
                              <span style={{ color: "#6b7178" }}>{pc(x.div)}</span>
                            </div>
                          </>
                        ) : (
                          <span style={{ color: C.gris }}>—</span>
                        )}
                      </td>
                    );
                  };
                  return (
                    <>
                      <tr style={{ background: "#f8f9fa" }}>
                        <th scope="row" style={{ textAlign: "left", padding: "8px", fontSize: 14 }}>
                          Équipe BE
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.gris }}>hors encadrement</div>
                        </th>
                        {repartition.equipe.map((x, w) => cellule(x, semaines12[w], true))}
                      </tr>
                      {repartition.groupes.map((g) => {
                        const ouvert = groupesOuverts.has(g.cle);
                        return (
                          <Fragment key={g.cle}>
                            <tr>
                              <th scope="row" style={{ textAlign: "left", padding: "8px", fontSize: 14, borderBottom: `1px solid ${C.ligne}` }}>
                                <button
                                  type="button"
                                  aria-expanded={ouvert}
                                  onClick={() =>
                                    setGroupesOuverts((s) => {
                                      const n = new Set(s);
                                      if (n.has(g.cle)) n.delete(g.cle);
                                      else n.add(g.cle);
                                      return n;
                                    })
                                  }
                                  style={{ all: "unset", cursor: "pointer", fontWeight: 800, color: C.rougeFonce, textTransform: "uppercase", fontSize: 13 }}
                                >
                                  {ouvert ? "▾" : "▸"} {g.nom}
                                </button>
                                <div style={{ fontSize: 11, fontWeight: 600, color: C.gris }}>
                                  {g.personnes.length} personne{g.personnes.length > 1 ? "s" : ""}
                                </div>
                              </th>
                              {g.cellules.map((x, w) => cellule(x, semaines12[w], true))}
                            </tr>
                            {ouvert &&
                              g.personnes.map((c) => (
                                <tr key={c.id}>
                                  <th scope="row" style={{ textAlign: "left", padding: "6px 8px 6px 24px", fontSize: 13, fontWeight: 700, borderBottom: `1px solid ${C.ligne}` }}>
                                    {nomCollab(c)}
                                  </th>
                                  {(repartition.parPersonne.get(c.id) ?? []).map((x, w) => cellule(x, semaines12[w], false))}
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                    </>
                  );
                })()}
              </tbody>
            </table>
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
