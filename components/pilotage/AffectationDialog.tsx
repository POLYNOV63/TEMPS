"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { C, Message, Modal, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerCapacitesAbsences, type ReferentielActivites } from "@/lib/pilotageDonnees";
import {
  aISO,
  ajouterJours,
  arrondi2,
  construireCapacites,
  estWeekend,
  genererJours,
  quantiteJusquaDate,
  remplirHeures,
  remplirJours,
  type Affectation,
  type Capacites,
  type JourHeures,
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
  type Imputation,
} from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - AJOUTER OU MODIFIER UNE AFFECTATION

   Sur une affaire, quatre façons de planifier :
     - « Jusqu'à une date »        : prestation (PE, PI...) ; la personne est
                                     affectée jusqu'à la date, aux jours où elle
                                     est disponible ;
     - « Pour un nombre de jours » : idem, pour N journées de travail ;
     - « Pour un nombre d'heures » : idem, pour N heures ;
     - « Répartir sur une période » : N heures étalées entre deux dates
                                     (petites affaires à plusieurs ressources).
   Pour les trois premières, les jours fériés et les absences (congés...) ne
   sont pas travaillés : LA DATE DE FIN EST REPOUSSEE d'autant.

   Un DBE se planifie toujours sur le code DT.
   Événement libre (salon, déplacement...) : intitulé + code d'imputation.

   Le planning calcule et avertit : il ne bloque jamais une surcharge.
================================================================ */

export type PrefAffectation = {
  onglet?: "AFFAIRE" | "LIBRE";
  affaireId?: string;
  collaborateurId?: string;
  debut?: string;
};

type ModeSaisie = "DATE" | "JOURS" | "NB_HEURES" | "PERIODE";

type Props = {
  onClose: () => void;
  onSaved: (message: string) => void;
  affaires: Affaire[];
  annuaire: Collab[];
  referentiel: ReferentielActivites;
  imputations: Imputation[];
  codesDivers: { code: string; libelle: string }[];
  /* affectations déjà connues : servent à proposer le même code pour une même affaire */
  affectationsConnues?: Pick<Affectation, "affaire_id" | "activite_id" | "code" | "date_debut">[];
  prefill?: PrefAffectation;
  edition?: { affectation: Affectation; jours: JourRow[] };
};

function prochainJourOuvre(depuis: string): string {
  let j = depuis;
  while (estWeekend(j)) j = ajouterJours(j, 1);
  return j;
}

const minISO = (a: string, b: string) => (a < b ? a : b);

export default function AffectationDialog({
  onClose,
  onSaved,
  affaires,
  annuaire,
  referentiel,
  imputations,
  codesDivers,
  affectationsConnues = [],
  prefill,
  edition,
}: Props) {
  const enEdition = Boolean(edition);
  const aujourdhui = aISO(new Date());

  const [onglet, setOnglet] = useState<"AFFAIRE" | "LIBRE">(
    edition ? (edition.affectation.affaire_id ? "AFFAIRE" : "LIBRE") : prefill?.onglet ?? "AFFAIRE"
  );

  const [affaireId, setAffaireId] = useState(edition?.affectation.affaire_id ?? prefill?.affaireId ?? "");
  const [activiteId, setActiviteId] = useState(edition?.affectation.activite_id ?? "");
  const [code, setCode] = useState(edition?.affectation.code ?? "");
  const [libelle, setLibelle] = useState(edition?.affectation.libelle ?? "");
  const [codeLibre, setCodeLibre] = useState(edition && !edition.affectation.affaire_id ? edition.affectation.code ?? "" : "");
  const [commentaire, setCommentaire] = useState(edition?.affectation.commentaire ?? "");
  const [ressources, setRessources] = useState<string[]>(
    edition ? [edition.affectation.collaborateur_id] : prefill?.collaborateurId ? [prefill.collaborateurId] : []
  );

  const debutInitial = edition?.affectation.date_debut ?? prefill?.debut ?? prochainJourOuvre(aujourdhui);
  const [debut, setDebut] = useState(debutInitial);
  const [fin, setFin] = useState(edition?.affectation.date_fin ?? "");
  const [mode, setMode] = useState<ModeSaisie>("PERIODE");
  const [pourcent, setPourcent] = useState("100");
  const [nbJours, setNbJours] = useState("");
  const [nbHeures, setNbHeures] = useState("");
  const [total, setTotal] = useState(
    edition ? String(arrondi2(edition.jours.reduce((t, j) => t + num(j.heures), 0))).replace(".", ",") : ""
  );
  const [heuresParJour, setHeuresParJour] = useState("");
  const [journeeEntiere, setJourneeEntiere] = useState(true);

  // détail jour par jour modifiable (modification d'une affectation existante)
  const [manuel, setManuel] = useState<Map<string, string> | null>(
    edition ? new Map(edition.jours.map((j) => [j.jour, String(num(j.heures)).replace(".", ",")])) : null
  );

  const [capacites, setCapacites] = useState<Capacites | null>(null);
  const [couverture, setCouverture] = useState<{ debut: string; fin: string } | null>(null);
  const [chargementCap, setChargementCap] = useState(false);
  const [erreurCap, setErreurCap] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  const affaire = affaires.find((a) => a.id === affaireId);
  const imputationAffaire = imputations.find((i) => i.code === affaire?.imputation);
  const planifieParDate = imputationAffaire ? imputationAffaire.charge_obligatoire === false : false;
  const activitesActives = referentiel.activites.filter((a) => a.actif || a.id === activiteId);
  const modeEffectif: ModeSaisie | "LIBRE" = onglet === "LIBRE" ? "LIBRE" : mode;

  const dtActivite = useMemo(() => referentiel.liens.find((l) => l.code === "DT")?.activite_id ?? "", [referentiel]);

  const codesActivite = useMemo(
    () =>
      referentiel.liens
        .filter((l) => l.activite_id === activiteId)
        .map((l) => ({ code: l.code, libelle: referentiel.libellesCodes.get(l.code) ?? "" }))
        .sort((a, b) => a.code.localeCompare(b.code, "fr")),
    [referentiel, activiteId]
  );

  // À l'ouverture d'une affaire : mode proposé, date de fin = échéance de l'affaire, même code que d'habitude
  useEffect(() => {
    if (enEdition || onglet !== "AFFAIRE" || !affaire) return;

    setMode(planifieParDate ? "DATE" : "PERIODE");
    setFin((f) => f || affaire.echeance || "");

    if (affaire.type !== "DBE") {
      const derniere = affectationsConnues
        .filter((a) => a.affaire_id === affaire.id)
        .sort((a, b) => b.date_debut.localeCompare(a.date_debut))[0];

      if (derniere?.activite_id) {
        setActiviteId((x) => x || derniere.activite_id!);
        setCode((x) => x || derniere.code || "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affaireId]);

  useEffect(() => {
    if (onglet === "LIBRE" && !fin && !enEdition) setFin(debut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  /* Dernier jour dont on a besoin des disponibilités (la fin peut être repoussée par les congés). */
  const horizon = useMemo(() => {
    if (!debut) return "";

    const plafond = ajouterJours(debut, 380);

    if (modeEffectif === "DATE") {
      return fin && fin >= debut ? minISO(ajouterJours(fin, 150), plafond) : "";
    }

    if (modeEffectif === "JOURS") {
      const n = num(nbJours.replace(",", "."));
      return n > 0 ? minISO(ajouterJours(debut, Math.ceil(n * 2.2) + 60), plafond) : "";
    }

    if (modeEffectif === "NB_HEURES") {
      const h = num(nbHeures.replace(",", "."));
      const p = Math.min(100, Math.max(1, num(pourcent.replace(",", ".")) || 100)) / 100;
      const n = Math.ceil(h / Math.max(0.5, 7.5 * p));
      return h > 0 ? minISO(ajouterJours(debut, Math.ceil(n * 2.2) + 60), plafond) : "";
    }

    return fin && fin >= debut ? fin : "";
  }, [debut, fin, modeEffectif, nbJours, nbHeures, pourcent]);

  // Chargement des disponibilités : on n'utilise JAMAIS des données qui ne couvrent pas la période demandée
  useEffect(() => {
    setCapacites(null);
    setCouverture(null);
    setErreurCap("");

    if (!debut || !horizon || horizon < debut) {
      setChargementCap(false);
      return;
    }

    let actif = true;
    setChargementCap(true);

    const t = setTimeout(async () => {
      try {
        const { caps, absences } = await chargerCapacitesAbsences(debut, horizon);

        if (actif) {
          setCapacites(construireCapacites(caps, absences));
          setCouverture({ debut, fin: horizon });
        }
      } catch (e) {
        if (actif) setErreurCap(e instanceof Error ? e.message : "Impossible de calculer les disponibilités.");
      } finally {
        if (actif) setChargementCap(false);
      }
    }, 250);

    return () => {
      actif = false;
      clearTimeout(t);
    };
  }, [debut, horizon]);

  const pret = Boolean(capacites && couverture && couverture.debut === debut && couverture.fin === horizon && !chargementCap);

  type Rep = {
    jours: JourHeures[];
    total: number;
    fin: string | null;
    epuise: boolean;
    finDemandee: string | null;
  };

  const repartitions = useMemo(() => {
    const resultat = new Map<string, Rep>();

    if (!pret || !capacites) return resultat;

    const p = num(pourcent.replace(",", ".")) || 100;

    for (const id of ressources) {
      const cap = capacites.get(id);
      const net = (j: string) => cap?.get(j)?.net ?? 0;
      const theorique = (j: string) => {
        const x = cap?.get(j);
        return x && !x.ferie ? x.theorique : 0;
      };

      if (modeEffectif === "DATE") {
        const q = quantiteJusquaDate({ debut, fin, capaciteHorsAbsence: theorique, pourcent: p });
        const r = remplirHeures({ debut, quantiteHeures: q, capaciteJour: net, pourcent: p, horizon });
        resultat.set(id, { jours: r.jours, total: r.total, fin: r.fin, epuise: r.epuise, finDemandee: fin });
      } else if (modeEffectif === "JOURS") {
        const r = remplirJours({ debut, nbJours: num(nbJours.replace(",", ".")), capaciteJour: net, theoriqueJour: theorique, pourcent: p, horizon });
        resultat.set(id, { jours: r.jours, total: r.total, fin: r.fin, epuise: r.epuise, finDemandee: null });
      } else if (modeEffectif === "NB_HEURES") {
        const r = remplirHeures({ debut, quantiteHeures: num(nbHeures.replace(",", ".")), capaciteJour: net, pourcent: p, horizon });
        resultat.set(id, { jours: r.jours, total: r.total, fin: r.fin, epuise: r.epuise, finDemandee: null });
      } else if (modeEffectif === "PERIODE") {
        const r = genererJours({ mode: "HEURES", debut, fin, capaciteJour: net, total: num(total.replace(",", ".")) });
        resultat.set(id, { jours: r.jours, total: r.total, fin: r.jours.length ? r.jours[r.jours.length - 1].jour : null, epuise: true, finDemandee: fin });
      } else {
        const r = genererJours({
          mode: "PAR_JOUR",
          debut,
          fin,
          capaciteJour: net,
          heuresParJour: journeeEntiere ? undefined : num(heuresParJour.replace(",", ".")),
        });
        resultat.set(id, { jours: r.jours, total: r.total, fin: r.jours.length ? r.jours[r.jours.length - 1].jour : null, epuise: true, finDemandee: fin });
      }
    }

    return resultat;
  }, [pret, capacites, ressources, modeEffectif, debut, fin, horizon, pourcent, nbJours, nbHeures, total, heuresParJour, journeeEntiere]);

  function basculerRessource(id: string) {
    if (enEdition) return;
    setRessources((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  function joursPourEnregistrer(id: string): JourHeures[] {
    if (manuel) {
      return [...manuel.entries()]
        .map(([jour, h]) => ({ jour, heures: num(h.replace(",", ".")) }))
        .filter((j) => j.heures > 0)
        .sort((a, b) => a.jour.localeCompare(b.jour));
    }

    return repartitions.get(id)?.jours ?? [];
  }

  async function enregistrer() {
    setErreur("");

    if (onglet === "AFFAIRE" && !affaire) {
      setErreur("Choisissez l’affaire.");
      return;
    }

    if (onglet === "LIBRE") {
      if (!libelle.trim()) {
        setErreur("Indiquez l’intitulé de l’événement.");
        return;
      }
      if (!codeLibre) {
        setErreur("Choisissez le code d’imputation : c’est lui qui fera remonter les heures dans les bilans.");
        return;
      }
    }

    if (ressources.length === 0) {
      setErreur("Choisissez au moins une ressource.");
      return;
    }

    const besoinFin = modeEffectif === "DATE" || modeEffectif === "PERIODE" || modeEffectif === "LIBRE";

    if (!debut || (besoinFin && (!fin || fin < debut))) {
      setErreur(besoinFin ? "Indiquez la date de début et une date de fin qui ne la précède pas." : "Indiquez la date de début.");
      return;
    }

    if (modeEffectif === "JOURS" && num(nbJours.replace(",", ".")) <= 0) {
      setErreur("Indiquez le nombre de jours.");
      return;
    }

    if ((modeEffectif === "NB_HEURES" || modeEffectif === "PERIODE") && num((modeEffectif === "NB_HEURES" ? nbHeures : total).replace(",", ".")) <= 0) {
      setErreur("Indiquez le nombre d’heures.");
      return;
    }

    if (!manuel && !pret) {
      setErreur("Les disponibilités sont en cours de calcul : réessayez dans un instant.");
      return;
    }

    let activite: string | null = activiteId || null;
    let codeFinal: string | null = code || null;

    if (onglet === "AFFAIRE" && affaire?.type === "DBE") {
      if (!dtActivite) {
        setErreur("Le code DT n’est rattaché à aucune activité : rattachez-le dans Gestion des activités.");
        return;
      }
      activite = dtActivite;
      codeFinal = "DT";
    }

    if (onglet === "AFFAIRE" && codeFinal && !activite) {
      setErreur("Choisissez l’activité du code, ou retirez le code.");
      return;
    }

    const aEnregistrer = ressources
      .map((id) => ({ id, jours: joursPourEnregistrer(id) }))
      .filter((r) => r.jours.length > 0);

    if (aEnregistrer.length === 0) {
      setErreur("Aucun jour disponible sur cette période (week-ends, jours fériés, absences).");
      return;
    }

    const incomplet = ressources.some((id) => repartitions.get(id) && !repartitions.get(id)!.epuise);

    if (!manuel && incomplet) {
      setErreur("La quantité demandée dépasse la période calculée (un an au plus) : réduisez-la.");
      return;
    }

    setEnCours(true);

    const groupe = aEnregistrer.length > 1 && typeof crypto !== "undefined" ? crypto.randomUUID() : null;

    for (const r of aEnregistrer) {
      const jours = r.jours;

      const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {
        p_id: edition?.affectation.id ?? null,
        p_affaire_id: onglet === "AFFAIRE" ? affaireId : null,
        p_activite_id: onglet === "AFFAIRE" ? activite : null,
        p_code: onglet === "AFFAIRE" ? codeFinal : codeLibre,
        p_libelle: onglet === "LIBRE" ? libelle.trim() : null,
        p_collaborateur_id: r.id,
        p_date_debut: jours[0].jour,
        p_date_fin: jours[jours.length - 1].jour,
        p_commentaire: commentaire.trim() || null,
        p_jours: jours,
        p_groupe_id: groupe,
      });

      if (error) {
        setEnCours(false);
        setErreur(traduireErreur(error.message));
        return;
      }
    }

    setEnCours(false);
    onSaved(enEdition ? "Affectation modifiée." : `${aEnregistrer.length} affectation(s) ajoutée(s).`);
  }

  async function supprimer() {
    if (!edition) return;
    if (!window.confirm("Supprimer cette affectation ?")) return;

    setEnCours(true);

    const { error } = await supabase.from("pilotage_affectations").delete().eq("id", edition.affectation.id);

    setEnCours(false);

    if (error) {
      setErreur(traduireErreur(error.message));
      return;
    }

    onSaved("Affectation supprimée.");
  }

  /* ------------------------------ rendu ------------------------------ */

  const chip = (actif: boolean): CSSProperties => ({
    background: actif ? "#e8e3f5" : "#ffffff",
    color: actif ? "#2b1d63" : "#3b4046",
    border: `1.5px solid ${actif ? "#6b58a8" : "#b9bec5"}`,
    minHeight: 44,
    minWidth: 64,
    padding: "0 14px",
    fontWeight: 800,
    fontSize: 15,
    fontFamily: "inherit",
    borderRadius: 999,
    cursor: enEdition ? "default" : "pointer",
  });

  const segment = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#b9bec5"}`,
    minHeight: 44,
    padding: "0 16px",
    fontWeight: 800,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const affairesProposees = affaires
    .filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE" || a.id === affaireId)
    .sort((a, b) => a.type.localeCompare(b.type) || b.numero.localeCompare(a.numero, "fr", { numeric: true }));

  const manuelTriable = manuel ? [...manuel.keys()].sort() : [];

  const modes: { valeur: ModeSaisie; libelle: string; aide: string }[] = [
    { valeur: "DATE", libelle: "Jusqu’à une date", aide: "La personne est affectée jusqu’à cette date, les jours où elle est disponible. Congés et jours fériés repoussent la fin." },
    { valeur: "JOURS", libelle: "Pour un nombre de jours", aide: "La personne est affectée pour N journées de travail. Congés et jours fériés repoussent la fin." },
    { valeur: "NB_HEURES", libelle: "Pour un nombre d’heures", aide: "La personne est affectée jusqu’à avoir fait ces heures. Congés et jours fériés repoussent la fin." },
    { valeur: "PERIODE", libelle: "Répartir sur une période", aide: "Les heures sont étalées entre les deux dates, proportionnellement à la disponibilité de chaque jour (petites affaires)." },
  ];

  return (
    <Modal titre={enEdition ? "Modifier l’affectation" : "Ajouter une affectation"} onClose={onClose} largeur={780}>
      {erreur && <Message genre="erreur">{erreur}</Message>}

      {!enEdition && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <button type="button" aria-pressed={onglet === "AFFAIRE"} style={segment(onglet === "AFFAIRE")} onClick={() => setOnglet("AFFAIRE")}>
            Sur une affaire
          </button>
          <button type="button" aria-pressed={onglet === "LIBRE"} style={segment(onglet === "LIBRE")} onClick={() => setOnglet("LIBRE")}>
            Événement libre
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {onglet === "AFFAIRE" ? (
          <>
            <div>
              <label htmlFor="aff" style={page.etiquette}>Affaire</label>
              <select id="aff" value={affaireId} disabled={enEdition} onChange={(e) => setAffaireId(e.target.value)} style={page.entrees}>
                <option value="">— Choisir —</option>
                {affairesProposees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.type} {a.numero} — {a.designation}
                  </option>
                ))}
              </select>
              {affaire && (
                <div style={page.aide}>
                  Imputation {affaire.imputation ?? "—"}
                  {planifieParDate ? " : prestation planifiée par date, nombre de jours ou d’heures." : "."}
                  {affaire.echeance ? ` ${affaire.type === "DBE" ? "Remise" : "Échéance"} : ${formatDate(affaire.echeance)}.` : ""}
                </div>
              )}
            </div>

            {affaire?.type === "DBE" ? (
              <div style={{ ...page.aide, marginTop: 0, fontSize: 14, color: "#3b4046" }}>
                Un DBE se planifie toujours sur le code <strong>DT</strong> (devis technique). Sa date de remise
                apparaît dans le planning comme un jalon : ne planifiez des heures que pour réserver du temps de rédaction.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px" }}>
                  <label htmlFor="act" style={page.etiquette}>Activité (facultative)</label>
                  <select id="act" value={activiteId} onChange={(e) => { setActiviteId(e.target.value); setCode(""); }} style={page.entrees}>
                    <option value="">— Toute activité —</option>
                    {activitesActives.map((a) => (
                      <option key={a.id} value={a.id}>{a.nom}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 220px" }}>
                  <label htmlFor="cod" style={page.etiquette}>Code (facultatif)</label>
                  <select id="cod" value={code} disabled={!activiteId} onChange={(e) => setCode(e.target.value)} style={page.entrees}>
                    <option value="">Toute l’activité</option>
                    {codesActivite.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.libelle}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...page.aide, flexBasis: "100%", marginTop: -6 }}>
                  Une prestation garde le même code du début à la fin : celui des heures qui seront imputées.
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <label htmlFor="lib" style={page.etiquette}>Intitulé</label>
              <input id="lib" type="text" value={libelle} onChange={(e) => setLibelle(e.target.value)} style={page.entrees} />
              <div style={page.aide}>Salon, déplacement, formation, journée interne… tout ce qui n’est pas une affaire.</div>
            </div>
            <div>
              <label htmlFor="codl" style={page.etiquette}>Imputation (code)</label>
              <select id="codl" value={codeLibre} onChange={(e) => setCodeLibre(e.target.value)} style={page.entrees}>
                <option value="">— Choisir —</option>
                {codesDivers.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.libelle}</option>
                ))}
              </select>
              <div style={page.aide}>Les heures remonteront dans ce code (commercial, formation, divers de production…).</div>
            </div>
          </>
        )}

        <div>
          <div style={page.etiquette}>Ressources</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {annuaire.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={ressources.includes(c.id)}
                disabled={enEdition && !ressources.includes(c.id)}
                style={chip(ressources.includes(c.id))}
                onClick={() => basculerRessource(c.id)}
                title={`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
              >
                {ressources.includes(c.id) ? "✓ " : ""}
                {nomCollab(c)}
              </button>
            ))}
          </div>
          {!enEdition && <div style={page.aide}>Une affectation est créée pour chaque personne sélectionnée.</div>}
        </div>

        {onglet === "AFFAIRE" && (
          <div>
            <div style={page.etiquette}>Comment planifier</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {modes.map((m) => (
                <button key={m.valeur} type="button" aria-pressed={mode === m.valeur} style={segment(mode === m.valeur)} onClick={() => { setMode(m.valeur); setManuel(null); }}>
                  {m.libelle}
                </button>
              ))}
            </div>
            <div style={page.aide}>{modes.find((m) => m.valeur === mode)?.aide}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="du" style={page.etiquette}>À partir du</label>
            <input id="du" type="date" value={debut} onChange={(e) => { setDebut(e.target.value); setManuel(null); }} style={page.entrees} />
          </div>

          {(modeEffectif === "DATE" || modeEffectif === "PERIODE" || modeEffectif === "LIBRE") && (
            <div style={{ flex: "1 1 170px" }}>
              <label htmlFor="au" style={page.etiquette}>{modeEffectif === "DATE" ? "Jusqu’au" : "Au"}</label>
              <input id="au" type="date" value={fin} onChange={(e) => { setFin(e.target.value); setManuel(null); }} style={page.entrees} />
            </div>
          )}

          {modeEffectif === "JOURS" && (
            <div style={{ flex: "0 1 170px" }}>
              <label htmlFor="nbj" style={page.etiquette}>Nombre de jours</label>
              <input id="nbj" type="text" inputMode="decimal" value={nbJours} onChange={(e) => { setNbJours(e.target.value); setManuel(null); }} style={{ ...page.entrees, textAlign: "right" }} />
            </div>
          )}

          {modeEffectif === "NB_HEURES" && (
            <div style={{ flex: "0 1 170px" }}>
              <label htmlFor="nbh" style={page.etiquette}>Heures (par personne)</label>
              <input id="nbh" type="text" inputMode="decimal" value={nbHeures} onChange={(e) => { setNbHeures(e.target.value); setManuel(null); }} style={{ ...page.entrees, textAlign: "right" }} />
            </div>
          )}

          {modeEffectif === "PERIODE" && (
            <div style={{ flex: "0 1 170px" }}>
              <label htmlFor="tot" style={page.etiquette}>Heures (par personne)</label>
              <input id="tot" type="text" inputMode="decimal" value={total} onChange={(e) => { setTotal(e.target.value); setManuel(null); }} style={{ ...page.entrees, textAlign: "right" }} />
            </div>
          )}

          {(modeEffectif === "DATE" || modeEffectif === "JOURS" || modeEffectif === "NB_HEURES") && (
            <div style={{ flex: "0 1 170px" }}>
              <label htmlFor="pct" style={page.etiquette}>% de leur temps</label>
              <input id="pct" type="text" inputMode="numeric" value={pourcent} onChange={(e) => { setPourcent(e.target.value); setManuel(null); }} style={{ ...page.entrees, textAlign: "right" }} />
            </div>
          )}
        </div>

        {onglet === "LIBRE" && (
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ ...page.etiquette, padding: 0 }}>Temps occupé</legend>
            <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
              <input type="radio" name="temps" checked={journeeEntiere} onChange={() => { setJourneeEntiere(true); setManuel(null); }} style={{ width: 20, height: 20, margin: 0 }} />
              Journées entières (horaire de la personne)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
              <input type="radio" name="temps" checked={!journeeEntiere} onChange={() => { setJourneeEntiere(false); setManuel(null); }} style={{ width: 20, height: 20, margin: 0 }} />
              Un nombre d’heures par jour :
              <input
                type="text"
                aria-label="Heures par jour"
                inputMode="decimal"
                value={heuresParJour}
                placeholder="ex. 4"
                onChange={(e) => { setHeuresParJour(e.target.value); setJourneeEntiere(false); setManuel(null); }}
                style={{ ...page.entrees, width: 90, textAlign: "right" }}
              />
            </label>
          </fieldset>
        )}

        <div>
          <label htmlFor="com" style={page.etiquette}>Note</label>
          <input id="com" type="text" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} style={page.entrees} />
          <div style={page.aide}>Facultative.</div>
        </div>

        {/* Aperçu */}
        <div style={{ border: `1px solid ${C.ligne}`, borderRadius: 10, padding: 14, background: "#fafbfc" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Aperçu</div>
          {erreurCap && <div style={{ color: C.rougeTexte, fontSize: 14 }}>{erreurCap}</div>}
          {!manuel && !pret && !erreurCap && (
            <div style={{ color: C.gris, fontSize: 14 }}>
              {chargementCap ? "Calcul des disponibilités…" : "Renseignez les dates et la quantité."}
            </div>
          )}
          {(manuel || pret) &&
            ressources.length === 0 && <div style={{ color: C.gris, fontSize: 14 }}>Choisissez au moins une ressource.</div>}
          {(manuel || pret) &&
            ressources.map((id) => {
              const c = annuaire.find((x) => x.id === id);
              const rep = repartitions.get(id);
              const jours = manuel ? joursPourEnregistrer(id) : rep?.jours ?? [];
              const somme = arrondi2(jours.reduce((t, j) => t + j.heures, 0));
              const finReelle = jours.length ? jours[jours.length - 1].jour : null;
              const repoussee = !manuel && rep?.finDemandee && finReelle && finReelle > rep.finDemandee && (modeEffectif === "DATE");

              return (
                <div key={id} style={{ fontSize: 14, padding: "3px 0" }}>
                  <strong>{nomCollab(c)}</strong> —{" "}
                  {jours.length === 0 ? (
                    <span style={{ color: C.rougeTexte }}>aucun jour disponible (week-ends, fériés, absences validées)</span>
                  ) : (
                    <>
                      {formatHeures(somme)} sur {jours.length} jour(s), du {formatDate(jours[0].jour)} au {formatDate(finReelle)}
                      {repoussee && (
                        <strong style={{ color: C.orangeTexte }}>
                          {" "}— fin repoussée au {formatDate(finReelle)} (date demandée : {formatDate(rep!.finDemandee)}), à cause de congés ou de jours fériés
                        </strong>
                      )}
                      {!manuel && rep && !rep.epuise && (
                        <strong style={{ color: C.rougeTexte }}> — la quantité dépasse un an de planning : réduisez-la</strong>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          <div style={{ ...page.aide, marginTop: 8 }}>
            Jours fériés et absences validées par les RH déduits. Le planning avertit en cas de surcharge, il ne bloque rien.
          </div>
        </div>

        {/* Détail jour par jour (modification) */}
        {manuel && (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center" }}>
              Détail jour par jour ({manuelTriable.length} jours)
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginTop: 8 }}>
              {manuelTriable.map((j) => (
                <label key={j} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ minWidth: 78 }}>{formatDate(j)}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manuel.get(j) ?? ""}
                    onChange={(e) => setManuel((m) => new Map(m ?? []).set(j, e.target.value))}
                    style={{ ...page.entrees, minHeight: 36, width: 70, textAlign: "right", fontSize: 14 }}
                  />
                </label>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setManuel(null)}>
                Recalculer à partir des dates et du mode
              </button>
            </div>
          </details>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap", marginTop: 4 }}>
          <div>
            {enEdition && (
              <button type="button" style={{ ...page.btnSecondaire, borderColor: "#b9bec5", color: "#3b4046" }} onClick={supprimer} disabled={enCours}>
                Supprimer
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={onClose}>Annuler</button>
            <button
              type="button"
              style={{ ...page.btnPrimaire, opacity: enCours || (!manuel && !pret) ? 0.6 : 1 }}
              disabled={enCours || (!manuel && !pret)}
              onClick={enregistrer}
            >
              {enCours ? "Enregistrement…" : !manuel && !pret ? "Calcul en cours…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
