"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { C, Message, Modal, Pastille, page } from "@/components/pilotage/ui";
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
   RESSOURCES - CHARGE DE L'ÉQUIPE (RESSOURCES_FUSION)
   Reprise de l'ancienne page « Charge par ressource », intégrée sous le
   planning de la page Ressources (droit « chargeRessources »). La semaine
   analysée est choisie ici (◀ ▶).
   La grille « 12 semaines en % » a été retirée (le planning reste sans
   pourcentage) ; la charge semaine par semaine se lit ici, flèches ◀ ▶.
   Le tableau « Répartition du temps, par activité » (CBE / DBE / Divers
   sur 12 semaines) a été retiré : doublon du détail et des disponibilités.

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

export default function ChargeEquipe({ lundi, setLundi, onModifie }: { lundi: string; setLundi: (l: string) => void; onModifie?: () => void }) {
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
  // DETAIL_LISIBLE : affectations repliées ; dépliées personne par personne, ou toutes
  const [affOuvertes, setAffOuvertes] = useState<Set<string>>(new Set());
  const [toutDeplie, setToutDeplie] = useState(false);
  // BANDEAU_EQUIPE : niveau de chacun (SQL 86 ; sans la table, tout est « non renseigné »)
  const [niveauxCollab, setNiveauxCollab] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    void supabase
      .from("collaborateurs_niveaux")
      .select("collaborateur_id,niveau")
      .then(({ data }) => setNiveauxCollab(new Map(((data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0]))));
  }, []);
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

  /* activités principales de chacun (regroupement et filtre du détail par personne) */
  const [groupesRep, setGroupesRep] = useState<{ predo: Map<string, string>; activites: { id: string; nom: string; ordre: number }[] }>({ predo: new Map(), activites: [] });
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

  /* CHARGE_TRI_FILTRE : recherche, filtres d'état et d'activité, tri, regroupement par activité principale */
  const [rechDetail, setRechDetail] = useState("");
  const [filtreEtat, setFiltreEtat] = useState<"TOUS" | "SURCHARGE" | "DISPONIBLE" | "COMPLET">("TOUS");
  const [filtreAct, setFiltreAct] = useState("");
  const [triDetail, setTriDetail] = useState<{ cle: "ACTIVITE" | "NOM" | "CHARGE" | "ECART"; sens: 1 | -1 }>({ cle: "ACTIVITE", sens: 1 });
  // ACTIVITES_BE : le tableau de détail ne montre que Méca, Elec et Calcul (d'après le nom de l'activité)
  const estActiviteBE = (nom: string) => /^(meca|elec|calcul)/.test(nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());
  // ACTIVITE_SPECIALITE : toutes les activités principales de chacun ; avec plusieurs, la personne est rangée dans
  // la plus rare parmi Méca / Elec / Calcul (sa spécialité)
  const [principales, setPrincipales] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    void supabase
      .from("collaborateurs_predominances")
      .select("collaborateur_id,activite_id")
      .eq("niveau", "PRINCIPALE")
      .then(({ data }) => {
        const m = new Map<string, string[]>();
        for (const x of (data ?? []) as { collaborateur_id: string; activite_id: string }[]) m.set(x.collaborateur_id, [...(m.get(x.collaborateur_id) ?? []), x.activite_id]);
        setPrincipales(m);
      });
  }, []);
  const lignesDetail = useMemo(() => {
    const parId = new Map(groupesRep.activites.map((a) => [a.id, a]));
    const nbTitulaires = new Map<string, number>();
    for (const ids of principales.values()) for (const x of ids) nbTitulaires.set(x, (nbTitulaires.get(x) ?? 0) + 1);
    const activiteDe = (id: string) => {
      const be = (principales.get(id) ?? [])
        .filter((x) => estActiviteBE(parId.get(x)?.nom ?? ""))
        .sort((x, y) => (nbTitulaires.get(x) ?? 0) - (nbTitulaires.get(y) ?? 0));
      const a = parId.get(be[0] ?? groupesRep.predo.get(id) ?? "");
      return a ? { cle: a.id, nom: a.nom, ordre: a.ordre } : { cle: "_", nom: "Sans activité principale", ordre: 9999 };
    };
    const etat = (l: (typeof lignes)[number]) =>
      !l.collab.inclus_statistiques ? "ENCADREMENT" : l.semaine.ecart > 0.01 ? "SURCHARGE" : l.semaine.ecart < -0.01 ? "DISPONIBLE" : "COMPLET";
    const taux = (l: (typeof lignes)[number]) => (l.semaine.net > 0 ? l.semaine.affecte / l.semaine.net : 0);
    const q = rechDetail.trim().toLowerCase();
    const res = lignes
      .filter((l) => !q || `${l.collab.trigramme ?? ""} ${l.collab.prenom ?? ""} ${l.collab.nom ?? ""}`.toLowerCase().includes(q))
      .filter((l) => filtreEtat === "TOUS" || etat(l) === filtreEtat)
      .map((l) => ({ ...l, activite: activiteDe(l.collab.id) }))
      .filter((l) => estActiviteBE(l.activite.nom))
      .filter((l) => !filtreAct || l.activite.cle === filtreAct);
    const nom = (l: (typeof res)[number]) => nomCollab(l.collab);
    const s = triDetail.sens;
    res.sort((a, b) => {
      if (triDetail.cle === "NOM") return s * nom(a).localeCompare(nom(b), "fr");
      if (triDetail.cle === "CHARGE") return s * (taux(a) - taux(b)) || nom(a).localeCompare(nom(b), "fr");
      if (triDetail.cle === "ECART") return s * (a.semaine.ecart - b.semaine.ecart) || nom(a).localeCompare(nom(b), "fr");
      return (
        s * (a.activite.ordre - b.activite.ordre) ||
        a.activite.nom.localeCompare(b.activite.nom, "fr") ||
        Number(b.collab.inclus_statistiques) - Number(a.collab.inclus_statistiques) ||
        nom(a).localeCompare(nom(b), "fr")
      );
    });
    return res;
  }, [lignes, rechDetail, filtreEtat, filtreAct, triDetail, groupesRep, principales]);
  const enteteTri = (cle: "NOM" | "CHARGE" | "ECART", libelle: string) => (
    <button
      type="button"
      title="Trier"
      onClick={() => setTriDetail((t) => ({ cle, sens: t.cle === cle ? (t.sens === 1 ? -1 : 1) : cle === "NOM" ? 1 : -1 }))}
      style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      {libelle} {triDetail.cle === cle ? (triDetail.sens === 1 ? "▲" : "▼") : <span style={{ color: "#b9bec5" }}>↕</span>}
    </button>
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
      onModifie?.();
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
    <div>
      <div id="charge" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: "8px 0 12px", scrollMarginTop: "calc(var(--hauteur-nav, 50px) + 12px)" }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>Charge de l’équipe</h2>
        <button type="button" aria-label="Semaine précédente" style={flecheStyle} onClick={() => setLundi(ajouterJours(lundi, -7))}>◀</button>
        <div style={{ fontWeight: 800, fontSize: 17, minWidth: 190, textAlign: "center" }}>
          S{numeroSemaine(lundi)}
          <div style={{ fontSize: 12, fontWeight: 600, color: C.gris }}>
            {formatDate(lundi)} → {formatDate(ajouterJours(lundi, 4))}
          </div>
        </div>
        <button type="button" aria-label="Semaine suivante" style={flecheStyle} onClick={() => setLundi(ajouterJours(lundi, 7))}>▶</button>
        <button type="button" style={{ ...page.btnSecondaire, border: "none", textDecoration: "underline" }} onClick={() => setLundi(lundiDe(aISO(new Date())))}>
          Cette semaine
        </button>
      </div>
      {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {/* BANDEAU_EQUIPE : l'équipe BE en un coup d'œil, sur la période du détail */}
        {(() => {
          const NIV = [
            { n: 1, lib: "N1", aide: "niveau 1 : exécute sous supervision", couleur: "#c8e6c9" },
            { n: 2, lib: "N2", aide: "niveau 2 : autonome sur une affaire courante", couleur: "#66bb6a" },
            { n: 3, lib: "N3", aide: "niveau 3 : expert ou référent", couleur: "#2e7d32" },
            { n: 0, lib: "non renseigné", aide: "niveau à saisir dans la fiche collaborateur", couleur: "#e3e7e3" },
          ];
          const libres = NIV.map((nv) =>
            equipe.filter((l) => (niveauxCollab.get(l.collab.id) ?? 0) === nv.n).reduce((s, l) => s + Math.max(0, l.semaine.net - l.semaine.affecte), 0)
          );
          const libreTotal = libres.reduce((s, x) => s + x, 0);
          const taux = totalNet > 0 ? totalAffecte / totalNet : 0;
          const etiquette: CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris, marginBottom: 4 };
          return (
            <section style={{ ...page.carte, padding: "14px 18px", marginBottom: 20, borderLeft: `5px solid ${C.rouge}` }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: "14px 30px" }}>
                <div style={{ minWidth: 150 }}>
                  <div style={etiquette}>Équipe BE · toutes activités</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>
                    {nbSemDetail === 1 ? `Semaine S${numeroSemaine(lundi)}` : `S${numeroSemaine(lundi)} à S${numeroSemaine(ajouterJours(lundi, 7 * (nbSemDetail - 1)))}`}
                  </div>
                  <div style={{ fontSize: 12, color: C.gris }}>{equipe.length} personnes · hors encadrement</div>
                </div>
                <div>
                  <div style={etiquette}>Affecté / capacité</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>
                    {formatHeures(totalAffecte)} <span style={{ fontSize: 16, color: C.gris, fontWeight: 600 }}>/ {formatHeures(totalNet)}</span>
                  </div>
                  {totalTheorique - totalNet > 0.01 && <div style={{ fontSize: 12, color: C.gris }}>− {formatHeures(totalTheorique - totalNet)} fériés et absences</div>}
                </div>
                <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                  <div style={etiquette}>Charge</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 14, borderRadius: 4, background: "#eef0f3", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, taux * 100)}%`, height: "100%", background: taux > 1.001 ? "#b3261e" : taux >= 0.8 ? "#34506b" : "#8fb0d6" }} />
                    </div>
                    <strong style={{ fontSize: 24, color: taux > 1.001 ? "#8f1010" : C.encre }}>{Math.round(taux * 100)} %</strong>
                  </div>
                </div>
                <div style={{ minWidth: 220 }}>
                  <div style={etiquette}>Disponible</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: libreTotal >= 0.5 ? "#1b5e20" : C.gris }}>{formatHeures(libreTotal)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {NIV.map((nv, k) =>
                      nv.n === 0 && libres[k] < 0.5 ? null : (
                        <span key={nv.n} title={nv.aide} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#3b4046" }}>
                          <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: nv.couleur, border: "1px solid #c9d1c9" }} />
                          {nv.lib} {formatHeures(libres[k])}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div style={{ minWidth: 150, maxWidth: 260 }}>
                  <div style={etiquette}>En surcharge</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: surcharges.length > 0 ? "#8f1010" : "#1b5e20" }}>
                    {surcharges.length > 0 ? `${surcharges.length} pers.` : "personne"}
                  </div>
                  {surcharges.length > 0 && (
                    <div style={{ fontSize: 12, color: C.gris }}>{surcharges.map((l) => `${nomCollab(l.collab)} +${formatHeures(l.semaine.ecart)}`).join(" · ")}</div>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

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
          {/* CHARGE_TRI_FILTRE : recherche, filtres, regroupement */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              type="search"
              value={rechDetail}
              onChange={(e) => setRechDetail(e.target.value)}
              placeholder="Rechercher un collaborateur…"
              aria-label="Rechercher un collaborateur"
              style={{ ...page.entrees, width: 220, minHeight: 34 }}
            />
            {(
              [
                ["TOUS", "Tous"],
                ["SURCHARGE", "En surcharge"],
                ["DISPONIBLE", "Disponibles"],
                ["COMPLET", "Complets"],
              ] as const
            ).map(([v, lib]) => (
              <button
                key={v}
                type="button"
                aria-pressed={filtreEtat === v}
                onClick={() => setFiltreEtat(v)}
                style={{ ...page.btnSecondaire, minHeight: 34, padding: "0 10px", background: filtreEtat === v ? C.rouge : "#ffffff", color: filtreEtat === v ? "#ffffff" : C.rougeFonce, borderColor: filtreEtat === v ? C.rouge : undefined }}
              >
                {lib}
              </button>
            ))}
            <select
              value={filtreAct}
              onChange={(e) => setFiltreAct(e.target.value)}
              aria-label="Filtrer par activité"
              style={{ minHeight: 34, borderRadius: 8, border: "1.5px solid #b9bec5", fontFamily: "inherit", fontWeight: 700, padding: "0 6px" }}
            >
              <option value="">Toutes les activités</option>
              {[...groupesRep.activites]
                .filter((a) => estActiviteBE(a.nom))
                .sort((a, b) => a.ordre - b.ordre)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
            </select>
            <button
              type="button"
              aria-pressed={triDetail.cle === "ACTIVITE"}
              onClick={() => setTriDetail({ cle: "ACTIVITE", sens: 1 })}
              style={{ ...page.btnSecondaire, minHeight: 34, padding: "0 10px", background: triDetail.cle === "ACTIVITE" ? C.rouge : "#ffffff", color: triDetail.cle === "ACTIVITE" ? "#ffffff" : C.rougeFonce, borderColor: triDetail.cle === "ACTIVITE" ? C.rouge : undefined }}
            >
              Par activité
            </button>
            <span style={{ fontSize: 12, color: C.gris }}>
              {lignesDetail.length} personne{lignesDetail.length > 1 ? "s" : ""} · cliquez sur un titre de colonne pour trier
            </span>
          </div>

          {/* DETAIL_COMPACT : sans ascenseur horizontal, titres figés */}
          <div>
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
              {/* LARGEURS_DETAIL : Ressource, Affecté / capacité, Charge, Écart, Affectations (le reste), Déplacer */}
              <colgroup>
                <col style={{ width: 76 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 300 }} />
                <col style={{ width: 165 }} />
                <col />
                <col style={{ width: nbSemDetail === 1 ? 110 : 8 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...page.th, position: "sticky", top: "var(--hauteur-nav, 50px)", zIndex: 5, background: "#f1f2f4", textAlign: "center" }}>{enteteTri("NOM", "Ressource")}</th>
                  <th style={{ ...page.th, position: "sticky", top: "var(--hauteur-nav, 50px)", zIndex: 5, background: "#f1f2f4", textAlign: "center" }} title="Heures affectées / capacité disponible (fériés et absences déduits)">Affecté / capacité</th>
                  <th style={{ ...page.th, position: "sticky", top: "var(--hauteur-nav, 50px)", zIndex: 5, background: "#f1f2f4", textAlign: "center" }}>{enteteTri("CHARGE", "Charge")}</th>
                  <th style={{ ...page.th, position: "sticky", top: "var(--hauteur-nav, 50px)", zIndex: 5, background: "#f1f2f4", textAlign: "center" }}>{enteteTri("ECART", "Écart")}</th>
                  <th style={{ ...page.th, position: "sticky", top: "var(--hauteur-nav, 50px)", zIndex: 5, background: "#f1f2f4", textAlign: "center" }}>
                    Affectations{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setToutDeplie((v) => !v);
                        setAffOuvertes(new Set());
                      }}
                      style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700, color: C.rougeFonce, textTransform: "none", textDecoration: "underline" }}
                    >
                      {toutDeplie ? "tout replier" : "tout déplier"}
                    </button>
                  </th>
                  <th style={{ ...page.th, position: "sticky", top: "var(--hauteur-nav, 50px)", zIndex: 5, background: "#f1f2f4" }} />
                </tr>
              </thead>
              <tbody>
                {lignesDetail.map((l, idx) => {
                  const encadrement = !l.collab.inclus_statistiques;
                  const s = l.semaine;
                  const exces = Math.max(0, s.affecte - s.net);
                  const normal = Math.min(s.affecte, s.net);

                  const groupeNouveau = triDetail.cle === "ACTIVITE" && (idx === 0 || lignesDetail[idx - 1].activite.cle !== l.activite.cle);
                  return (
                    <Fragment key={l.collab.id}>
                    {groupeNouveau &&
                      (() => {
                        const du = lignesDetail.filter((x) => x.activite.cle === l.activite.cle && x.collab.inclus_statistiques);
                        const aff = du.reduce((t, x) => t + x.semaine.affecte, 0);
                        const net = du.reduce((t, x) => t + x.semaine.net, 0);
                        const dispo = net - aff;
                        return (
                          <tr>
                            <td colSpan={6} style={{ padding: "8px 8px 5px", background: "#eef0f3", borderTop: `2px solid ${C.ligne}` }}>
                              <strong style={{ color: C.rougeFonce, textTransform: "uppercase", fontSize: 13, letterSpacing: ".4px" }}>{l.activite.nom}</strong>
                              <span style={{ marginLeft: 12, fontSize: 13, color: "#3b4046" }}>
                                {du.length} pers. · {formatHeures(aff)} / {formatHeures(net)}
                                {net > 0 && <> · charge <strong>{Math.round((aff / net) * 100)} %</strong></>} ·{" "}
                                <strong style={{ color: dispo >= -0.01 ? "#1b5e20" : "#8f1010" }}>
                                  {dispo >= -0.01 ? `disponible ${formatHeures(Math.max(0, dispo))}` : `surcharge ${formatHeures(-dispo)}`}
                                </strong>
                              </span>
                            </td>
                          </tr>
                        );
                      })()}
                    <tr style={{ background: idx % 2 ? "#fafbfc" : "#ffffff" }}>
                      <td style={{ ...page.td, whiteSpace: "nowrap" }}>
                        <strong style={{ fontSize: 15 }}>{nomCollab(l.collab)}</strong>
                        {encadrement && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: C.gris }}>encadrement</span>}
                      </td>
                      <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <strong>{formatHeures(s.affecte)}</strong>
                        <span style={{ color: C.gris }}> / {encadrement ? "hors capacité" : formatHeures(s.net)}</span>
                        {s.ferie + s.absence > 0 && (
                          <span
                            title={`Capacité réduite de ${formatHeures(s.ferie + s.absence)} : ${[s.ferie > 0 ? `férié ${formatHeures(s.ferie)}` : "", s.absence > 0 ? `absence ${formatHeures(s.absence)}` : ""].filter(Boolean).join(", ")}`}
                            style={{ marginLeft: 4, fontSize: 11, color: C.gris }}
                          >
                            (−{formatHeures(s.ferie + s.absence)} {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "abs." : ""].filter(Boolean).join("+")})
                          </span>
                        )}
                      </td>
                      <td style={page.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                        {!encadrement && (
                          <div
                            role="img"
                            aria-label={`Affecté ${formatHeures(s.affecte)} pour ${formatHeures(s.net)} disponibles`}
                            style={{ position: "relative", height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 100 }}
                          >
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(normal / echelle) * 100}%`, background: s.net > 0 && s.affecte / s.net >= 0.8 ? "#34506b" : "#8fb0d6" }} />
                            {exces > 0 && (
                              <div style={{ position: "absolute", left: `${(normal / echelle) * 100}%`, top: 0, bottom: 0, width: `${(exces / echelle) * 100}%`, background: "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#e58a84 4px,#e58a84 8px)" }} />
                            )}
                            <div title={`Capacité disponible : ${formatHeures(s.net)}`} style={{ position: "absolute", left: `${(s.net / echelle) * 100}%`, top: -4, bottom: -4, width: 2, background: C.encre }} />
                          </div>
                        )}
                        </div>
                        {!encadrement && s.net > 0 && (
                          <strong style={{ fontSize: 13, minWidth: 42, textAlign: "right", color: s.affecte > s.net + 0.01 ? "#8f1010" : C.encre }}>
                            {Math.round((s.affecte / s.net) * 100)} %
                          </strong>
                        )}
                        </div>
                      </td>
                      <td style={{ ...page.td, whiteSpace: "nowrap" }}>{encadrement ? <Pastille genre="info">Pas de seuil</Pastille> : ecartPastille(s.ecart)}</td>
                      <td style={{ ...page.td, fontSize: 13 }}>
                        {l.details.length === 0 ? (
                          <span style={{ color: C.gris }}>—</span>
                        ) : (
                          (() => {
                            const ouvert = toutDeplie || affOuvertes.has(l.collab.id);
                            const tries = [...l.details].sort((a, b) => b.heures - a.heures);
                            return (
                              <>
                                <button
                                  type="button"
                                  aria-expanded={ouvert}
                                  onClick={() =>
                                    setAffOuvertes((x) => {
                                      const n = new Set(x);
                                      if (n.has(l.collab.id)) n.delete(l.collab.id);
                                      else n.add(l.collab.id);
                                      return n;
                                    })
                                  }
                                  title={tries.map((d) => `${d.etiquette} · ${formatHeures(d.heures)}`).join("\n")}
                                  style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap", color: "#3b4046" }}
                                >
                                  <span style={{ color: C.rougeFonce, fontWeight: 800 }}>{ouvert ? "▾" : "▸"}</span> <strong>{tries[0].etiquette}</strong>
                                  {tries.length > 1 && <span style={{ color: C.gris }}> + {tries.length - 1}</span>}
                                </button>
                                {ouvert &&
                                  tries.map((d) => (
                                    <div key={d.id} style={{ whiteSpace: "nowrap", paddingLeft: 14, color: d.libre ? C.gris : undefined }}>
                                      {d.etiquette} · {formatHeures(d.heures)}
                                    </div>
                                  ))}
                              </>
                            );
                          })()
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
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ margin: "12px 4px 0", fontSize: 13, color: C.gris }}>
            Capacité théorique : profil horaire. Absences : demandes validées dans Validation RH. Le trait noir marque la
            capacité disponible ; la zone hachurée rouge est le dépassement. L’encadrement n’entre pas dans la capacité de
            l’équipe.
          </p>
        </section>

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
    </div>
  );
}
