"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { C, Message, Modal, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import {
  aISO,
  ajouterJours,
  construireCapacites,
  estWeekend,
  joursChezLeClient,
  joursSansCapacite,
  recalculerBloc,
  type Affectation,
  type Capacites,
  type JourRow,
} from "@/lib/pilotagePlanning";
import { formatDate, formatHeures, nomCollab, num, traduireErreur, type Affaire, type Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - FICHE D'UNE RESSOURCE SUR UNE PRESTATION (PE / PI)

   Clic sur la barre d'une ressource : début, fin, personne (changer =
   la barre passe à une autre personne) et part de son temps. Les congés
   et jours fériés sont sautés et signalés. Si la barre dépasse les
   bornes de la prestation, on le dit et on propose d'étirer l'affaire.

   La barre d'une ressource et celle de l'affaire sont indépendantes.
================================================================ */

type Props = {
  onClose: () => void;
  onSaved: (message: string) => void;
  affaire: Affaire;
  annuaire: Collab[];
  affectations: Affectation[];
  joursRows: JourRow[];
  estPE: (affaireId: string) => boolean;
  /* bornes théoriques de la prestation (null si pas encore définies) */
  bornes: { debut: string | null; fin: string | null };
  edition?: { affectation: Affectation; jours: JourRow[] };
  prefill?: { collaborateurId?: string; debut?: string; fin?: string };
  onEtirerAffaire: (debut: string, fin: string) => Promise<void>;
};

function prochainJourOuvre(depuis: string): string {
  let j = depuis;
  while (estWeekend(j)) j = ajouterJours(j, 1);
  return j;
}

export default function FicheRessourceDialog({
  onClose,
  onSaved,
  affaire,
  annuaire,
  affectations,
  joursRows,
  estPE,
  bornes,
  edition,
  prefill,
  onEtirerAffaire,
}: Props) {
  const enEdition = Boolean(edition);

  const [collab, setCollab] = useState(edition?.affectation.collaborateur_id ?? prefill?.collaborateurId ?? "");
  const [debut, setDebut] = useState(
    edition?.affectation.date_debut ?? prefill?.debut ?? bornes.debut ?? prochainJourOuvre(aISO(new Date()))
  );
  const [fin, setFin] = useState(edition?.affectation.date_fin ?? prefill?.fin ?? bornes.fin ?? "");
  const [pourcent, setPourcent] = useState(() => {
    if (!edition || edition.jours.length === 0) return "100";
    const total = edition.jours.reduce((t, j) => t + num(j.heures), 0);
    return String(Math.min(100, Math.max(5, Math.round((total / edition.jours.length / 7.5) * 100))));
  });
  const [note, setNote] = useState(edition?.affectation.commentaire ?? "");

  const [capacites, setCapacites] = useState<Capacites | null>(null);
  const [couverture, setCouverture] = useState<{ debut: string; fin: string } | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreurCap, setErreurCap] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [etiree, setEtiree] = useState(false);

  const periodeValide = Boolean(debut && fin && fin >= debut && ajouterJours(debut, 400) >= fin);

  useEffect(() => {
    setCapacites(null);
    setCouverture(null);
    setErreurCap("");

    if (!periodeValide) {
      setChargement(false);
      return;
    }

    let actif = true;
    setChargement(true);

    const t = setTimeout(async () => {
      try {
        const { caps, absences } = await chargerCapacitesAbsences(debut, fin);

        if (actif) {
          setCapacites(construireCapacites(caps, absences));
          setCouverture({ debut, fin });
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
  }, [debut, fin, periodeValide]);

  const pret = Boolean(capacites && couverture && couverture.debut === debut && couverture.fin === fin && !chargement);
  const p = Math.min(100, Math.max(1, num(pourcent.replace(",", ".")) || 100));

  const calcul = useMemo(() => {
    if (!pret || !capacites || !collab) return null;

    const cap = capacites.get(collab);
    const net = (j: string) => cap?.get(j)?.net ?? 0;
    const r = recalculerBloc({ debut, fin, capaciteJour: net, ratio: p / 100 });
    const premier = r.jours[0]?.jour ?? null;
    const dernier = r.jours.length ? r.jours[r.jours.length - 1].jour : null;

    // jours où la personne est déjà chez un client (hors cette barre) : non affectable
    const client = joursChezLeClient(
      affectations.filter((a) => a.id !== edition?.affectation.id),
      joursRows,
      estPE
    ).get(collab);
    const conflit = client ? r.jours.find((j) => client.has(j.jour))?.jour ?? null : null;

    const avant = Boolean(bornes.debut && premier && premier < bornes.debut);
    const apres = Boolean(bornes.fin && dernier && dernier > bornes.fin);

    return {
      r,
      premier,
      dernier,
      manquants: joursSansCapacite(debut, fin, cap),
      conflit,
      depasse: avant || apres,
    };
  }, [pret, capacites, collab, debut, fin, p, affectations, joursRows, estPE, edition, bornes.debut, bornes.fin]);

  const personne = annuaire.find((c) => c.id === collab);

  async function etirer() {
    if (!calcul?.premier || !calcul.dernier) return;

    const nouveauDebut = bornes.debut && bornes.debut < calcul.premier ? bornes.debut : calcul.premier;
    const nouvelleFin = bornes.fin && bornes.fin > calcul.dernier ? bornes.fin : calcul.dernier;

    setEnCours(true);

    try {
      await onEtirerAffaire(nouveauDebut, nouvelleFin);
      setEtiree(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Impossible d’étirer l’affaire.");
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrer() {
    setErreur("");

    if (!collab) return setErreur("Choisissez la personne.");
    if (!periodeValide) return setErreur("Indiquez un début et une fin (la fin ne précède pas le début).");
    if (!calcul || calcul.r.jours.length === 0) return setErreur("Aucun jour disponible sur cette période (week-ends, fériés, congés).");
    if (calcul.conflit) return setErreur(`${nomCollab(personne)} est déjà chez un client (prestation externe) le ${formatDate(calcul.conflit)} : elle n’est pas affectable ailleurs.`);

    setEnCours(true);

    const jours = calcul.r.jours;

    const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {
      p_id: edition?.affectation.id ?? null,
      p_affaire_id: affaire.id,
      p_activite_id: edition?.affectation.activite_id ?? null,
      p_code: edition?.affectation.code ?? null,
      p_libelle: null,
      p_collaborateur_id: collab,
      p_date_debut: jours[0].jour,
      p_date_fin: jours[jours.length - 1].jour,
      p_commentaire: note.trim() || null,
      p_jours: jours,
      p_groupe_id: edition?.affectation.groupe_id ?? null,
    });

    setEnCours(false);

    if (error) return setErreur(traduireErreur(error.message));

    onSaved(enEdition ? "Barre modifiée." : "Ressource ajoutée.");
  }

  async function retirer() {
    if (!edition || !window.confirm(`Retirer ${nomCollab(personne)} de cette prestation ?`)) return;

    setEnCours(true);

    const { error } = await supabase.from("pilotage_affectations").delete().eq("id", edition.affectation.id);

    setEnCours(false);

    if (error) return setErreur(traduireErreur(error.message));

    onSaved("Ressource retirée.");
  }

  const alerte = (contenu: ReactNode, genre: "warn" | "crit" = "warn") => (
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
      {contenu}
    </div>
  );

  return (
    <Modal titre={`${enEdition ? "Barre de" : "Ajouter une ressource à"} ${enEdition ? nomCollab(personne) + " — " : ""}${affaire.imputation ?? ""} ${affaire.numero}`} onClose={onClose} largeur={640}>
      {erreur && <Message genre="erreur">{erreur}</Message>}

      <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
        {affaire.designation}
        {bornes.debut && bornes.fin ? ` · prestation du ${formatDate(bornes.debut)} au ${formatDate(bornes.fin)}` : ""}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="fr-d" style={page.etiquette}>Début</label>
            <input id="fr-d" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={page.entrees} />
          </div>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="fr-f" style={page.etiquette}>Fin</label>
            <input id="fr-f" type="date" value={fin} onChange={(e) => setFin(e.target.value)} style={page.entrees} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label htmlFor="fr-p" style={page.etiquette}>Personne</label>
            <select id="fr-p" value={collab} onChange={(e) => setCollab(e.target.value)} style={page.entrees}>
              <option value="">— Choisir —</option>
              {annuaire.map((c) => (
                <option key={c.id} value={c.id}>
                  {nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                  {!c.inclus_statistiques ? " (encadrement)" : ""}
                </option>
              ))}
            </select>
            {enEdition && <div style={page.aide}>Changer de personne : la barre passe à une autre personne, mêmes dates.</div>}
          </div>
          <div style={{ flex: "0 1 130px" }}>
            <label htmlFor="fr-pc" style={page.etiquette}>% de son temps</label>
            <input id="fr-pc" type="text" inputMode="numeric" value={pourcent} onChange={(e) => setPourcent(e.target.value)} style={{ ...page.entrees, textAlign: "right" }} />
          </div>
        </div>

        <div>
          <label htmlFor="fr-n" style={page.etiquette}>Note</label>
          <input id="fr-n" type="text" value={note} onChange={(e) => setNote(e.target.value)} style={page.entrees} />
          <div style={page.aide}>Facultative.</div>
        </div>

        <div style={{ border: `1px solid ${C.ligne}`, borderRadius: 10, padding: 14, background: "#fafbfc", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Résultat</div>
          {erreurCap && <div style={{ color: C.rougeTexte, fontSize: 14 }}>{erreurCap}</div>}
          {!pret && !erreurCap && <div style={{ color: C.gris, fontSize: 14 }}>{chargement ? "Calcul des disponibilités…" : "Choisissez la personne et les dates."}</div>}

          {calcul && (
            <>
              <div style={{ fontSize: 15 }}>
                {calcul.r.jours.length === 0 ? (
                  <span style={{ color: C.rougeTexte }}>Aucun jour disponible sur cette période.</span>
                ) : (
                  <>
                    <strong>{nomCollab(personne)}</strong> : {formatHeures(calcul.r.total)} sur {calcul.r.jours.length} jour(s), du {formatDate(calcul.premier)} au{" "}
                    <strong>{formatDate(calcul.dernier)}</strong>
                  </>
                )}
              </div>

              {calcul.manquants.length > 0 &&
                alerte(
                  <>
                    <strong>Congés et jours fériés sautés.</strong>{" "}
                    {calcul.manquants.map((m) => `${m.motif === "ferie" ? "Jour férié" : "Congé validé"} le ${formatDate(m.jour)}`).join(" · ")}.
                  </>
                )}

              {calcul.depasse && !etiree &&
                alerte(
                  <>
                    <strong>▲ Dépasse la prestation.</strong> Les bornes de l’affaire sont {bornes.debut ? formatDate(bornes.debut) : "—"} → {bornes.fin ? formatDate(bornes.fin) : "—"}.
                    <div style={{ marginTop: 8 }}>
                      <button type="button" style={page.btnSecondaire} onClick={etirer} disabled={enCours}>
                        Étirer l’affaire pour inclure cette barre
                      </button>
                    </div>
                  </>
                )}

              {etiree && <div style={{ color: "#0b3f78", fontSize: 14, fontWeight: 700 }}>✓ L’affaire a été étirée pour inclure cette barre.</div>}

              {calcul.conflit &&
                alerte(
                  <>
                    <strong>Chez le client.</strong> {nomCollab(personne)} est déjà en prestation externe le {formatDate(calcul.conflit)} : elle n’est pas affectable ailleurs.
                  </>,
                  "crit"
                )}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            {enEdition && (
              <button type="button" style={{ ...page.btnSecondaire, borderColor: "#b9bec5", color: "#3b4046" }} onClick={retirer} disabled={enCours}>
                Retirer cette ressource
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={onClose}>Annuler</button>
            <button type="button" style={{ ...page.btnPrimaire, opacity: enCours || !pret || Boolean(calcul?.conflit) ? 0.6 : 1 }} disabled={enCours || !pret || Boolean(calcul?.conflit)} onClick={enregistrer}>
              {enCours ? "Enregistrement…" : !pret ? "Calcul en cours…" : "Appliquer"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
