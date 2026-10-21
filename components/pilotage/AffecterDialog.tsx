"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { C, Message, Modal, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import {
  aISO,
  ajouterJours,
  chargeParSemaine,
  construireCapacites,
  estWeekend,
  joursSansCapacite,
  lundiDe,
  numeroSemaine,
  remplirHeures,
  remplirJours,
  type Affectation,
  type Capacites,
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
   PILOTAGE BE - AFFECTER UNE PERSONNE A UNE AFFAIRE

   Une personne, une date de début, une durée : en jours, en demi-journées
   ou en heures. Les heures se calculent ; les congés validés et les jours
   fériés ne sont pas travaillés (la fin est repoussée) et sont signalés.

   Le logiciel avertit (personne en congé, déjà chargée, chiffré dépassé)
   mais ne bloque pas, sauf pour une personne en PE : elle est chez le
   client et n'est pas affectable ailleurs.
   Si « me contenir » est activé, la durée est limitée au chiffré.
================================================================ */

type Unite = "JOURS" | "DEMI" | "HEURES";

type Props = {
  onClose: () => void;
  onSaved: (message: string) => void;
  affaire: Affaire;
  annuaire: Collab[];
  chiffre: number; // total chiffré de l'affaire (0 si non chiffrée)
  affectations: Affectation[];
  joursRows: JourRow[]; // tous les jours affectés connus (toutes affaires)
  chezLeClient: Map<string, Set<string>>;
  /* activités chiffrées de l'affaire : heures chiffrées et déjà affectées */
  activites?: { id: string; nom: string; chiffre: number; affecte: number }[];
  limiter: boolean;
  prefill?: { collaborateurId?: string; debut?: string };
  edition?: { affectation: Affectation; jours: JourRow[] };
};

function prochainJourOuvre(depuis: string): string {
  let j = depuis;
  while (estWeekend(j)) j = ajouterJours(j, 1);
  return j;
}

export default function AffecterDialog({
  onClose,
  onSaved,
  affaire,
  annuaire,
  chiffre,
  affectations,
  joursRows,
  chezLeClient,
  activites = [],
  limiter,
  prefill,
  edition,
}: Props) {
  const enEdition = Boolean(edition);
  const jourDuJour = aISO(new Date());

  const nbJoursExistant = edition ? edition.jours.length : 0;

  const [collab, setCollab] = useState(edition?.affectation.collaborateur_id ?? prefill?.collaborateurId ?? "");
  const [debut, setDebut] = useState(edition?.affectation.date_debut ?? prefill?.debut ?? prochainJourOuvre(jourDuJour));
  // En modification : mêmes heures, même intensité ; on peut simplement recaler la date de début ou la durée
  const heuresExistantes = edition ? edition.jours.reduce((t, j) => t + num(j.heures), 0) : 0;
  const [quantite, setQuantite] = useState(
    edition ? String(Math.round(heuresExistantes * 100) / 100).replace(".", ",") : ""
  );
  const [unite, setUnite] = useState<Unite>(edition ? "HEURES" : "JOURS");
  const [pourcent, setPourcent] = useState(
    edition && nbJoursExistant > 0
      ? String(Math.min(100, Math.max(5, Math.round((heuresExistantes / nbJoursExistant / 7.5) * 100))))
      : "100"
  );
  const [commentaire, setCommentaire] = useState(edition?.affectation.commentaire ?? "");
  const [activiteId, setActiviteId] = useState(() => {
    if (edition) return edition.affectation.activite_id ?? "";
    const plusGros = [...activites].sort((a, b) => b.chiffre - b.affecte - (a.chiffre - a.affecte))[0];
    return plusGros && plusGros.chiffre - plusGros.affecte > 0 ? plusGros.id : "";
  });

  const [capacites, setCapacites] = useState<Capacites | null>(null);
  const [couverture, setCouverture] = useState<{ debut: string; fin: string } | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreurCap, setErreurCap] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  const n = num(quantite.replace(",", "."));
  const p = Math.min(100, Math.max(1, num(pourcent.replace(",", ".")) || 100));

  // Dernier jour dont on a besoin des disponibilités
  const horizon = useMemo(() => {
    if (!debut || n <= 0) return "";

    const plafond = ajouterJours(debut, 380);
    const joursEstimes =
      unite === "JOURS" ? n : unite === "DEMI" ? n / 2 : Math.ceil(n / Math.max(0.5, 7.5 * (p / 100)));

    const h = ajouterJours(debut, Math.ceil(joursEstimes * 2.2) + 45);

    return h < plafond ? h : plafond;
  }, [debut, n, unite, p]);

  useEffect(() => {
    setCapacites(null);
    setCouverture(null);
    setErreurCap("");

    if (!debut || !horizon || horizon < debut) {
      setChargement(false);
      return;
    }

    let actif = true;
    setChargement(true);

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
        if (actif) setChargement(false);
      }
    }, 250);

    return () => {
      actif = false;
      clearTimeout(t);
    };
  }, [debut, horizon]);

  const pret = Boolean(capacites && couverture && couverture.debut === debut && couverture.fin === horizon && !chargement);

  const idsExclus = useMemo(() => new Set(edition ? [edition.affectation.id] : []), [edition]);
  const affaireDe = useMemo(() => new Map(affectations.map((a) => [a.id, a])), [affectations]);

  // Heures déjà affectées à cette affaire, hors le bloc modifié
  const affecteAilleurs = useMemo(
    () =>
      joursRows
        .filter((j) => !idsExclus.has(j.affectation_id) && affaireDe.get(j.affectation_id)?.affaire_id === affaire.id)
        .reduce((t, j) => t + num(j.heures), 0),
    [joursRows, idsExclus, affaireDe, affaire.id]
  );

  const dureeBloc = edition ? edition.jours.reduce((t, j) => t + num(j.heures), 0) : 0;
  const activiteChoisie = affaire.type === "DBE" ? undefined : activites.find((a) => a.id === activiteId);
  const affecteActivite = activiteChoisie
    ? activiteChoisie.affecte - (edition && edition.affectation.activite_id === activiteChoisie.id ? dureeBloc : 0)
    : 0;
  const restantActivite = activiteChoisie && activiteChoisie.chiffre > 0 ? Math.max(0, activiteChoisie.chiffre - affecteActivite) : Infinity;

  const calcul = useMemo(() => {
    if (!pret || !capacites || !collab || n <= 0) return null;

    const cap = capacites.get(collab);
    const net = (j: string) => cap?.get(j)?.net ?? 0;
    const theorique = (j: string) => {
      const x = cap?.get(j);
      return x && !x.ferie ? x.theorique : 0;
    };

    let r =
      unite === "HEURES"
        ? remplirHeures({ debut, quantiteHeures: n, capaciteJour: net, pourcent: p, horizon })
        : remplirJours({ debut, nbJours: unite === "DEMI" ? n / 2 : n, capaciteJour: net, theoriqueJour: theorique, pourcent: p, horizon });

    let limite = false;

    // « Me contenir » : la durée est limitée à ce qui reste du chiffré (de l'affaire et de l'activité)
    const restantTotal = chiffre > 0 ? Math.max(0, chiffre - affecteAilleurs) : Infinity;
    const restantLimite = Math.min(restantTotal, restantActivite);

    if (limiter && restantLimite !== Infinity && r.total > restantLimite + 0.001) {
      const restant = restantLimite;
      r = remplirHeures({ debut, quantiteHeures: restant, capaciteJour: net, pourcent: p, horizon });
      limite = true;
    }

    const fin = r.jours.length ? r.jours[r.jours.length - 1].jour : null;
    const manquants = fin ? joursSansCapacite(debut, fin, cap) : [];

    // charge de la personne avec ce bloc, semaine par semaine
    const autres: JourAffecte[] = joursRows
      .filter((j) => !idsExclus.has(j.affectation_id) && affaireDe.get(j.affectation_id)?.collaborateur_id === collab)
      .map((j) => ({ collaborateur_id: collab, jour: j.jour, heures: num(j.heures) }));
    const nouveaux: JourAffecte[] = r.jours.map((j) => ({ collaborateur_id: collab, jour: j.jour, heures: j.heures }));
    const semaines = [...new Set(r.jours.map((j) => lundiDe(j.jour)))];
    const surcharges = semaines
      .map((l) => ({ l, s: chargeParSemaine(capacites, [...autres, ...nouveaux], collab, l) }))
      .filter((x) => x.s.ecart > 0.01 && x.s.net > 0);

    const client = chezLeClient.get(collab);
    const conflitsPE = client ? r.jours.filter((j) => client.has(j.jour)) : [];

    return { r, fin, manquants, surcharges, conflitsPE, limite };
  }, [pret, capacites, collab, n, unite, p, debut, horizon, limiter, chiffre, affecteAilleurs, restantActivite, joursRows, idsExclus, affaireDe, chezLeClient]);

  const totalApres = calcul ? affecteAilleurs + calcul.r.total : affecteAilleurs;
  const depasse = chiffre > 0 && totalApres > chiffre + 0.001;
  const depasseActivite = Boolean(calcul && activiteChoisie && activiteChoisie.chiffre > 0 && affecteActivite + calcul.r.total > activiteChoisie.chiffre + 0.001);
  const bloque = Boolean(calcul && calcul.conflitsPE.length > 0);

  async function enregistrer() {
    setErreur("");

    if (!collab) return setErreur("Choisissez la personne.");
    if (!debut) return setErreur("Indiquez la date de début.");
    if (n <= 0) return setErreur("Indiquez la durée.");
    if (!calcul || calcul.r.jours.length === 0) return setErreur("Aucun jour disponible : vérifiez la date de début et la durée.");
    if (!calcul.r.epuise) return setErreur("La durée dépasse un an de planning : réduisez-la.");
    if (bloque) return setErreur("Cette personne est chez le client (prestation externe) sur ces jours : elle n’est pas affectable ailleurs.");

    setEnCours(true);

    const jours = calcul.r.jours;

    const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {
      p_id: edition?.affectation.id ?? null,
      p_affaire_id: affaire.id,
      p_activite_id: affaire.type === "DBE" ? null : activiteId || null,
      p_code: affaire.type === "DBE" ? "DT" : null,
      p_libelle: null,
      p_collaborateur_id: collab,
      p_date_debut: jours[0].jour,
      p_date_fin: jours[jours.length - 1].jour,
      p_commentaire: commentaire.trim() || null,
      p_jours: jours,
      p_groupe_id: null,
    });

    setEnCours(false);

    if (error) {
      setErreur(traduireErreur(error.message));
      return;
    }

    onSaved(enEdition ? "Affectation modifiée." : "Personne affectée.");
  }

  async function supprimer() {
    if (!edition || !window.confirm("Retirer cette personne de l’affaire ?")) return;

    setEnCours(true);

    const { error } = await supabase.from("pilotage_affectations").delete().eq("id", edition.affectation.id);

    setEnCours(false);

    if (error) return setErreur(traduireErreur(error.message));

    onSaved("Affectation supprimée.");
  }

  const personne = annuaire.find((c) => c.id === collab);
  const alerte = (texte: ReactNode, genre: "warn" | "crit" = "warn") => (
    <div
      role="status"
      style={{
        background: genre === "crit" ? "#fde1e1" : "#fdebd0",
        color: genre === "crit" ? "#5c0a0a" : "#5c2f00",
        border: `1px solid ${genre === "crit" ? "#e5a3a3" : "#e9b877"}`,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 14,
      }}
    >
      {texte}
    </div>
  );

  return (
    <Modal
      titre={`${enEdition ? "Modifier l’affectation" : "Affecter"} — ${affaire.type} ${affaire.numero}`}
      onClose={onClose}
      largeur={640}
    >
      {erreur && <Message genre="erreur">{erreur}</Message>}

      <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
        {affaire.designation}
        {chiffre > 0 ? ` · chiffré ${formatHeures(chiffre)}` : ""}
        {affaire.echeance ? ` · ${affaire.type === "DBE" ? "remise" : "livraison souhaitée"} ${formatDate(affaire.echeance)}` : ""}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label htmlFor="af-p" style={page.etiquette}>Personne</label>
          <select id="af-p" value={collab} disabled={enEdition} onChange={(e) => setCollab(e.target.value)} style={page.entrees}>
            <option value="">— Choisir —</option>
            {annuaire.map((c) => (
              <option key={c.id} value={c.id}>
                {nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                {!c.inclus_statistiques ? " (encadrement)" : ""}
              </option>
            ))}
          </select>
        </div>

        {affaire.type !== "DBE" && activites.length > 0 && (
          <div>
            <label htmlFor="af-a" style={page.etiquette}>Activité (facultative)</label>
            <select id="af-a" value={activiteId} onChange={(e) => setActiviteId(e.target.value)} style={page.entrees}>
              <option value="">— Sans activité précise —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom} — {a.chiffre > 0 ? `reste ${formatHeures(Math.max(0, a.chiffre - a.affecte))} sur ${formatHeures(a.chiffre)}` : "non chiffrée"}
                </option>
              ))}
            </select>
            <div style={page.aide}>Choisissez selon l’activité à couvrir et les appétences de la personne.</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="af-d" style={page.etiquette}>À partir du</label>
            <input id="af-d" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={page.entrees} />
          </div>
          <div style={{ flex: "0 1 130px" }}>
            <label htmlFor="af-q" style={page.etiquette}>Durée</label>
            <input id="af-q" type="text" inputMode="decimal" value={quantite} onChange={(e) => setQuantite(e.target.value)} style={{ ...page.entrees, textAlign: "right" }} />
          </div>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="af-u" style={page.etiquette}>Unité</label>
            <select id="af-u" value={unite} onChange={(e) => setUnite(e.target.value as Unite)} style={page.entrees}>
              <option value="JOURS">jours</option>
              <option value="DEMI">demi-journées</option>
              <option value="HEURES">heures</option>
            </select>
          </div>
          <div style={{ flex: "0 1 130px" }}>
            <label htmlFor="af-pc" style={page.etiquette}>% du temps</label>
            <input id="af-pc" type="text" inputMode="numeric" value={pourcent} onChange={(e) => setPourcent(e.target.value)} style={{ ...page.entrees, textAlign: "right" }} />
          </div>
        </div>

        {enEdition && (
          <div style={{ ...page.aide, marginTop: -4 }}>
            Pour décaler le bloc, changez simplement la date de début : les mêmes heures sont replacées à partir de là. Pour le raccourcir
            ou l’allonger, changez la durée.
          </div>
        )}

        <div>
          <label htmlFor="af-n" style={page.etiquette}>Note</label>
          <input id="af-n" type="text" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} style={page.entrees} />
          <div style={page.aide}>Facultative.</div>
        </div>

        {/* Résultat et alertes */}
        <div style={{ border: `1px solid ${C.ligne}`, borderRadius: 10, padding: 14, background: "#fafbfc", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Résultat</div>
          {erreurCap && <div style={{ color: C.rougeTexte, fontSize: 14 }}>{erreurCap}</div>}
          {!pret && !erreurCap && (
            <div style={{ color: C.gris, fontSize: 14 }}>{chargement ? "Calcul des disponibilités…" : "Choisissez la personne, la date et la durée."}</div>
          )}

          {calcul && (
            <>
              <div style={{ fontSize: 15 }}>
                {calcul.r.jours.length === 0 ? (
                  <span style={{ color: C.rougeTexte }}>Aucun jour disponible à partir de cette date.</span>
                ) : (
                  <>
                    <strong>{nomCollab(personne)}</strong> : {formatHeures(calcul.r.total)} sur {calcul.r.jours.length} jour(s), du{" "}
                    {formatDate(calcul.r.jours[0].jour)} au <strong>{formatDate(calcul.fin)}</strong>
                    {affaire.echeance && calcul.fin && calcul.fin > affaire.echeance && (
                      <span style={{ color: C.orangeTexte, fontWeight: 700 }}> — après la date souhaitée du {formatDate(affaire.echeance)}</span>
                    )}
                  </>
                )}
              </div>

              {calcul.manquants.length > 0 &&
                alerte(
                  <>
                    <strong>▲ {nomCollab(personne)} n’est pas disponible tous les jours.</strong>{" "}
                    {calcul.manquants
                      .map((m) => `${m.motif === "ferie" ? "Jour férié" : "Congé validé"} le ${formatDate(m.jour)}`)
                      .join(" · ")}
                    . La fin est repoussée d’autant.
                  </>
                )}

              {calcul.surcharges.length > 0 &&
                alerte(
                  <>
                    <strong>▲ Déjà chargé(e).</strong>{" "}
                    {calcul.surcharges
                      .slice(0, 3)
                      .map((s) => `S${numeroSemaine(s.l)} : ${Math.round((s.s.affecte / s.s.net) * 100)} % de sa capacité`)
                      .join(" · ")}
                    .
                  </>
                )}

              {calcul.limite &&
                alerte(
                  <>
                    <strong>Durée limitée au chiffré.</strong> L’option « me contenir » est activée : {formatHeures(calcul.r.total)} affectées pour{" "}
                    {formatHeures(chiffre)} chiffrées.
                  </>
                )}

              {!calcul.limite && !depasse && depasseActivite &&
                alerte(
                  <>
                    <strong>▲ Au-delà du chiffré de l’activité.</strong> {activiteChoisie!.nom} : {formatHeures(affecteActivite + calcul.r.total)} pour{" "}
                    {formatHeures(activiteChoisie!.chiffre)} chiffrées (+{formatHeures(affecteActivite + calcul.r.total - activiteChoisie!.chiffre)}).
                  </>
                )}

              {!calcul.limite && depasse &&
                alerte(
                  <>
                    <strong>▲ Au-delà du chiffré.</strong> Affecté {formatHeures(totalApres)} pour {formatHeures(chiffre)} chiffrées (
                    +{formatHeures(totalApres - chiffre)}).
                  </>,
                  "crit"
                )}

              {bloque &&
                alerte(
                  <>
                    <strong>Chez le client.</strong> {nomCollab(personne)} est en prestation externe le {formatDate(calcul.conflitsPE[0].jour)} : elle n’est pas
                    affectable ailleurs.
                  </>,
                  "crit"
                )}

              {chiffre > 0 && !depasse && !calcul.limite && (
                <div style={{ fontSize: 14, color: C.gris }}>
                  Affecté à l’affaire : {formatHeures(totalApres)} sur {formatHeures(chiffre)} chiffrées (reste {formatHeures(chiffre - totalApres)}).
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            {enEdition && (
              <button type="button" style={{ ...page.btnSecondaire, borderColor: "#b9bec5", color: "#3b4046" }} onClick={supprimer} disabled={enCours}>
                Retirer
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={onClose}>Annuler</button>
            <button
              type="button"
              style={{ ...page.btnPrimaire, opacity: enCours || !pret || bloque ? 0.6 : 1 }}
              disabled={enCours || !pret || bloque}
              onClick={enregistrer}
            >
              {enCours
                ? "Enregistrement…"
                : !pret
                  ? "Calcul en cours…"
                  : calcul && !bloque && (calcul.manquants.length > 0 || calcul.surcharges.length > 0 || depasse || depasseActivite)
                    ? "Affecter quand même"
                    : "Affecter"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
