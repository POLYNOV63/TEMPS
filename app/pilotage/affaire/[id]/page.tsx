"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { BadgeType, C, Message, Modal, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerActivites,
  chargerAffaires,
  chargerAffectationsAffaire,
  chargerAnnuaire,
  chargerCharges,
  chargerImputations,
  chargerMoi,
  chargerRealise,
  type Moi,
  type ReferentielActivites,
} from "@/lib/pilotageDonnees";
import {
  aujourdhuiISO,
  chargesParAffaire,
  cleAffaire,
  detailActivites,
  etatAffaire,
  formatDate,
  formatHeures,
  formatPourcent,
  indexParAffaire,
  libelleStatut,
  nomCollab,
  num,
  planifieParAffaire,
  STATUTS,
  totauxAffaire,
  traduireErreur,
  type Affaire,
  type Charge,
  type Collab,
  type Imputation,
  type PlanningAffaire,
  type Realise,
  type StatutAffaire,
} from "@/lib/pilotageCalculs";
import type { Affectation, JourRow } from "@/lib/pilotagePlanning";

/* ===============================================================
   PILOTAGE BE - FICHE D'UNE AFFAIRE

   Chiffré par activité, réalisé (feuilles d'heures), reste et
   dépassements ; historique des changements de date.
   Les boutons de modification n'apparaissent que pour les
   responsables et les administrateurs.
================================================================ */

type Historique = {
  id: string;
  ancienne_date: string | null;
  nouvelle_date: string | null;
  motif: string;
  commentaire: string | null;
  modifie_par: string | null;
  modifie_le: string;
};

type LigneEdition = { cle: number; activite_id: string; code: string; heures: string; initial: string };

let compteur = 1;

function FicheContenu() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id ?? "");

  const [toutes, setToutes] = useState<Affaire[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [historique, setHistorique] = useState<Historique[]>([]);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [joursAff, setJoursAff] = useState<JourRow[]>([]);

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const [modal, setModal] = useState<"" | "infos" | "echeance" | "charges" | "suppression">("");
  const [enCours, setEnCours] = useState(false);
  const [erreurModal, setErreurModal] = useState("");

  // formulaires
  const [fDesignation, setFDesignation] = useState("");
  const [fImputation, setFImputation] = useState("");
  const [fResponsable, setFResponsable] = useState("");
  const [fStatut, setFStatut] = useState<StatutAffaire>("EN_COURS");
  const [fLivraison, setFLivraison] = useState("");
  const [fDate, setFDate] = useState("");
  const [fMotif, setFMotif] = useState("");
  const [fCommentaire, setFCommentaire] = useState("");
  const [fLignes, setFLignes] = useState<LigneEdition[]>([]);

  const charger = useCallback(async () => {
    try {
      const [af, ch, re, an, im, ref, m, hist, affs] = await Promise.all([
        chargerAffaires({ horsPlanning: true }),
        chargerCharges(),
        chargerRealise(),
        chargerAnnuaire(),
        chargerImputations(),
        chargerActivites(),
        chargerMoi(),
        supabase
          .from("pilotage_echeances_historique")
          .select("id,ancienne_date,nouvelle_date,motif,commentaire,modifie_par,modifie_le")
          .eq("affaire_id", id)
          .order("modifie_le", { ascending: false }),
        chargerAffectationsAffaire(id),
      ]);

      if (hist.error) throw new Error(hist.error.message);

      setToutes(af);
      setCharges(ch);
      setRealise(re);
      setAnnuaire(an);
      setImputations(im);
      setReferentiel(ref);
      setMoi(m);
      setHistorique((hist.data ?? []) as Historique[]);
      setAffectations(affs.affectations);
      setJoursAff(affs.jours);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Impossible de charger l’affaire.");
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    charger();
  }, [charger]);

  const affaire = toutes.find((a) => a.id === id);
  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);

  const mesCharges = useMemo(() => chargesParAffaire(charges).get(id) ?? [], [charges, id]);
  const mesRealise = useMemo(
    () => (affaire ? indexParAffaire(realise).get(cleAffaire(affaire.type, affaire.numero)) ?? [] : []),
    [realise, affaire]
  );

  const totaux = useMemo(() => totauxAffaire(mesCharges, mesRealise), [mesCharges, mesRealise]);
  const imputationAffaire = imputations.find((i) => i.code === affaire?.imputation);
  const planningAffaire = useMemo(() => {
    const p = planifieParAffaire(affectations, joursAff, aujourdhuiISO()).get(id) ?? { planifie: 0, fin: null, nb: 0 };

    return {
      ...p,
      chargeObligatoire: imputationAffaire ? imputationAffaire.charge_obligatoire !== false : true,
      planningActif: affectations.length > 0,
    } as PlanningAffaire;
  }, [affectations, joursAff, id, imputationAffaire]);

  const etat = affaire ? etatAffaire(affaire, totaux, aujourdhuiISO(), planningAffaire) : null;

  const affectationsAffichees = useMemo(
    () =>
      affectations
        .map((a) => ({
          affectation: a,
          heures: joursAff.filter((j) => j.affectation_id === a.id).reduce((t, j) => t + num(j.heures), 0),
        }))
        .sort((a, b) => a.affectation.date_debut.localeCompare(b.affectation.date_debut)),
    [affectations, joursAff]
  );

  const lignesActivites = useMemo(
    () =>
      referentiel
        ? detailActivites(mesCharges, mesRealise, referentiel.activites, referentiel.libellesCodes)
        : [],
    [mesCharges, mesRealise, referentiel]
  );

  const origine = affaire?.dbe_origine_id ? toutes.find((a) => a.id === affaire.dbe_origine_id) : undefined;
  const cbeLies = affaire?.type === "DBE" ? toutes.filter((a) => a.dbe_origine_id === affaire.id) : [];

  /* ------------------------- ouvertures de fenêtres ------------------------- */

  function ouvrir(m: "infos" | "echeance" | "charges" | "suppression") {
    if (!affaire) return;

    setErreurModal("");

    if (m === "infos") {
      setFDesignation(affaire.designation);
      setFImputation(affaire.imputation ?? "");
      setFResponsable(affaire.responsable_id);
      setFStatut(affaire.statut);
      setFLivraison(affaire.date_livraison ?? "");
    }

    if (m === "echeance") {
      setFDate(affaire.echeance ?? "");
      setFMotif("");
      setFCommentaire("");
    }

    if (m === "charges") {
      setFLignes(
        mesCharges.length > 0
          ? mesCharges.map((c) => ({
              cle: compteur++,
              activite_id: c.activite_id,
              code: c.code ?? "",
              heures: String(num(c.heures)).replace(".", ","),
              initial: num(c.realise_initial) > 0 ? String(num(c.realise_initial)).replace(".", ",") : "",
            }))
          : [{ cle: compteur++, activite_id: "", code: "", heures: "", initial: "" }]
      );
    }

    setModal(m);
  }

  /* ------------------------------ enregistrements ------------------------------ */

  async function enregistrerInfos() {
    if (!affaire) return;

    if (!fDesignation.trim()) {
      setErreurModal("Le descriptif est obligatoire.");
      return;
    }

    setEnCours(true);

    const { error } = await supabase
      .from("pilotage_affaires")
      .update({
        designation: fDesignation.trim(),
        imputation: fImputation || null,
        responsable_id: fResponsable,
        statut: fStatut,
        date_livraison: fStatut === "LIVREE" ? fLivraison || null : null,
      })
      .eq("id", affaire.id);

    setEnCours(false);

    if (error) {
      setErreurModal(traduireErreur(error.message));
      return;
    }

    setModal("");
    setInfo("Affaire modifiée.");
    await charger();
  }

  async function enregistrerEcheance() {
    if (!affaire) return;

    if (!fDate) {
      setErreurModal("Indiquez la nouvelle date.");
      return;
    }

    if (!fMotif.trim()) {
      setErreurModal("Le motif est obligatoire : il est conservé dans l’historique.");
      return;
    }

    setEnCours(true);

    const { error } = await supabase.rpc("pilotage_changer_echeance", {
      p_affaire_id: affaire.id,
      p_nouvelle_date: fDate,
      p_motif: fMotif.trim(),
      p_commentaire: fCommentaire.trim() || null,
    });

    setEnCours(false);

    if (error) {
      setErreurModal(traduireErreur(error.message));
      return;
    }

    setModal("");
    setInfo("Échéance modifiée et historisée.");
    await charger();
  }

  async function enregistrerCharges() {
    if (!affaire) return;

    const lignes = fLignes
      .map((l) => ({
        activite_id: l.activite_id,
        code: l.code || null,
        heures: num(l.heures.replace(",", ".")),
        realise_initial: num(l.initial.replace(",", ".")),
      }))
      .filter((l) => l.activite_id || l.heures > 0 || l.realise_initial > 0);

    if (lignes.some((l) => !l.activite_id)) {
      setErreurModal("Chaque ligne doit avoir une activité.");
      return;
    }

    const vus = new Set<string>();

    for (const l of lignes) {
      const k = `${l.activite_id}|${l.code ?? ""}`;
      if (vus.has(k)) {
        setErreurModal("La même activité (avec le même code) est saisie deux fois.");
        return;
      }
      vus.add(k);
    }

    setEnCours(true);

    const { error } = await supabase.rpc("pilotage_remplacer_charges", {
      p_affaire_id: affaire.id,
      p_charges: lignes,
    });

    setEnCours(false);

    if (error) {
      setErreurModal(traduireErreur(error.message));
      return;
    }

    setModal("");
    setInfo("Charge modifiée.");
    await charger();
  }

  async function supprimer() {
    if (!affaire) return;

    setEnCours(true);

    const { error } = await supabase.from("pilotage_affaires").delete().eq("id", affaire.id);

    setEnCours(false);

    if (error) {
      setErreurModal(traduireErreur(error.message));
      return;
    }

    router.push("/pilotage");
  }

  /* ------------------------------------ rendu ------------------------------------ */

  const peutModifier = Boolean(moi?.peutModifier);
  const libelleImputation = (code: string | null) =>
    code ? imputations.find((i) => i.code === code)?.libelle ?? code : "—";

  const totalEdition = fLignes.reduce((t, l) => t + Math.max(0, num(l.heures.replace(",", "."))), 0);

  if (chargement) {
    return (
      <main style={page.fond}>
        <EnTetePage section="Pilotage BE" />
        <div style={page.contenu}>
          <Message genre="info">Chargement de l’affaire…</Message>
        </div>
      </main>
    );
  }

  if (!affaire) {
    return (
      <main style={page.fond}>
        <EnTetePage section="Pilotage BE" />
        <OngletsPilotage actif="portefeuille" />
        <div style={page.contenu}>
          {erreur && <Message genre="erreur">{erreur}</Message>}
          <Message genre="info">Affaire introuvable.</Message>
          <Link href="/pilotage" style={page.btnSecondaire}>
            ← Portefeuille
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="portefeuille" />

      <div style={page.contenu}>
        <Link
          href="/pilotage"
          style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontWeight: 700, color: C.rougeFonce }}
        >
          ← Portefeuille
        </Link>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <BadgeType type={affaire.type} />
              <h1 style={{ ...page.titre, fontSize: 32 }}>
                {affaire.numero} — {affaire.designation}
              </h1>
              {etat && <Pastille genre={etat.genre}>{etat.texte}</Pastille>}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", marginTop: 10, color: "#3b4046" }}>
              <span>
                Imputation : <strong>{libelleImputation(affaire.imputation)}</strong>
              </span>
              <span>
                Responsable : <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>
              </span>
              <span>
                Statut : <strong>{libelleStatut(affaire.statut)}</strong>
              </span>
              {origine && (
                <span>
                  Origine :{" "}
                  <Link href={`/pilotage/affaire/${origine.id}`} style={{ fontWeight: 700, color: C.rougeFonce }}>
                    DBE {origine.numero}
                  </Link>
                </span>
              )}
            </div>
          </div>

          {peutModifier && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={page.btnSecondaire} onClick={() => ouvrir("infos")}>
                Modifier
              </button>
              <button type="button" style={page.btnSecondaire} onClick={() => ouvrir("charges")}>
                Modifier la charge
              </button>
              <Link href="/pilotage/affaires" style={page.btnPrimaire}>
                Affecter dans le planning
              </Link>
            </div>
          )}
        </div>

        {/* Échéance */}
        <section style={{ ...page.carte, marginTop: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px 48px", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px 48px" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: C.gris }}>
                  {affaire.type === "DBE" ? "Remise initiale" : "Objectif initial"}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{formatDate(affaire.echeance_initiale)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: C.gris }}>
                  {affaire.type === "DBE" ? "Remise actuelle" : "Objectif actuel"}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{formatDate(affaire.echeance)}</div>
                {historique[0] && (
                  <div style={{ fontSize: 13, color: C.gris, marginTop: 2 }}>
                    modifié le {formatDate(historique[0].modifie_le)} — {historique[0].motif}
                  </div>
                )}
              </div>
              {affaire.date_livraison && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: C.gris }}>
                    Livrée le
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{formatDate(affaire.date_livraison)}</div>
                </div>
              )}
            </div>

            {peutModifier && (
              <button type="button" style={page.btnSecondaire} onClick={() => ouvrir("echeance")}>
                {affaire.echeance ? "Modifier l’échéance" : "Définir l’échéance"}
              </button>
            )}
          </div>
        </section>

        {/* Synthèse */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16 }}>
          <Tuile libelle="Chiffré" valeur={formatHeures(totaux.chiffre)} sous="charge par activité" />
          <Tuile libelle="Réalisé" valeur={formatHeures(totaux.realise)} sous="depuis les feuilles d’heures" />
          <Tuile libelle="Reste à faire" valeur={formatHeures(totaux.reste)} sous="chiffré − réalisé" />
          {planningAffaire.planningActif && (
            <Tuile
              libelle="Planifié"
              valeur={formatHeures(planningAffaire.planifie)}
              sous={planningAffaire.fin ? `jusqu’au ${formatDate(planningAffaire.fin)}` : "aucune affectation à venir"}
            />
          )}
          {planningAffaire.planningActif && planningAffaire.chargeObligatoire && totaux.chiffre > 0 && (
            <Tuile
              libelle="Non affecté"
              valeur={formatHeures(Math.max(0, totaux.reste - planningAffaire.planifie))}
              sous="reste − planifié"
              accent={totaux.reste - planningAffaire.planifie > 0.01}
            />
          )}
          <Tuile
            libelle={totaux.depassement > 0 ? "Dépassement" : "Budget consommé"}
            valeur={totaux.depassement > 0 ? formatHeures(totaux.depassement) : totaux.pourcent === null ? "—" : formatPourcent(totaux.pourcent)}
            sous={totaux.depassement > 0 ? "réalisé au-delà du chiffré" : "réalisé ÷ chiffré"}
            accent={totaux.depassement > 0}
          />
        </div>

        {/* Charge par activité */}
        <section style={{ ...page.carte, marginTop: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Charge par activité</h2>
          <p style={{ margin: "0 0 12px", color: C.gris, fontSize: 14 }}>
            Le réalisé est rattaché par l’activité (et le code) de chaque imputation.
          </p>

          {lignesActivites.length === 0 ? (
            <p style={{ color: C.gris }}>Aucune charge chiffrée ni heure imputée pour cette affaire.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={page.th}>Activité</th>
                    <th style={{ ...page.th, textAlign: "right" }}>Chiffré</th>
                    <th style={{ ...page.th, textAlign: "right" }}>Réalisé</th>
                    <th style={{ ...page.th, textAlign: "right" }}>Reste</th>
                    <th style={page.th}>Avancement</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesActivites.map((l) => {
                    const base = Math.max(l.chiffre, l.realise, 1);
                    const largeurRealise = Math.min(100, (l.realise / base) * 100);
                    const largeurChiffre = (l.chiffre / base) * 100;

                    return (
                      <Fragment key={l.activite_id ?? "sans"}>
                        <tr>
                          <td style={page.td}>
                            <strong>{l.nom}</strong>
                            {l.horsChiffrage && (
                              <div style={{ marginTop: 4 }}>
                                <Pastille genre="warn">Heures imputées hors chiffrage</Pastille>
                              </div>
                            )}
                          </td>
                          <td style={{ ...page.td, textAlign: "right" }}>{l.chiffre > 0 ? formatHeures(l.chiffre) : "—"}</td>
                          <td style={{ ...page.td, textAlign: "right" }}>{l.realise > 0 ? formatHeures(l.realise) : "—"}</td>
                          <td style={{ ...page.td, textAlign: "right" }}>
                            {l.depassement > 0 ? (
                              <Pastille genre="crit">+{formatHeures(l.depassement)}</Pastille>
                            ) : l.chiffre > 0 ? (
                              formatHeures(l.reste)
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ ...page.td, width: "30%" }}>
                            <div
                              role="img"
                              aria-label={`Réalisé ${formatHeures(l.realise)} pour ${formatHeures(l.chiffre)} chiffrées`}
                              style={{ position: "relative", height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 160 }}
                            >
                              <div
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: `${largeurRealise}%`,
                                  background: l.depassement > 0 ? "#b3261e" : "#34506b",
                                  borderRadius: 3,
                                }}
                              />
                              {l.chiffre > 0 && (
                                <div
                                  title={`Chiffré : ${formatHeures(l.chiffre)}`}
                                  style={{
                                    position: "absolute",
                                    left: `${Math.min(100, largeurChiffre)}%`,
                                    top: -4,
                                    bottom: -4,
                                    width: 2,
                                    background: C.encre,
                                  }}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                        {l.codes.map((c) => (
                          <tr key={`${l.activite_id}-${c.code}`}>
                            <td style={{ ...page.td, paddingLeft: 32, fontSize: 14, color: "#3b4046" }}>
                              <strong>{c.code}</strong> {c.libelle}
                            </td>
                            <td style={{ ...page.td, textAlign: "right", fontSize: 14 }}>{c.chiffre > 0 ? formatHeures(c.chiffre) : "—"}</td>
                            <td style={{ ...page.td, textAlign: "right", fontSize: 14 }}>{c.realise > 0 ? formatHeures(c.realise) : "—"}</td>
                            <td style={page.td} />
                            <td style={page.td} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ margin: "12px 2px 0", fontSize: 13, color: C.gris }}>
            Le trait noir marque le chiffré ; la barre rouge indique un dépassement.
          </p>
        </section>

        {/* Affectations */}
        <section style={{ ...page.carte, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Affectations</h2>
            <Link href="/pilotage/planning" style={{ fontWeight: 700, color: C.rougeFonce }}>
              Voir le planning →
            </Link>
          </div>

          {affectationsAffichees.length === 0 ? (
            <p style={{ color: C.gris, margin: 0 }}>
              Aucune affectation. {affaire.type === "DBE"
                ? "La date de remise apparaît dans le planning comme un jalon."
                : "Ajoutez une personne et une date de fin, ou un nombre d’heures."}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680 }}>
                <thead>
                  <tr>
                    <th style={page.th}>Ressource</th>
                    <th style={page.th}>Activité</th>
                    <th style={page.th}>Du</th>
                    <th style={page.th}>Au</th>
                    <th style={{ ...page.th, textAlign: "right" }}>Heures</th>
                    <th style={page.th} />
                  </tr>
                </thead>
                <tbody>
                  {affectationsAffichees.map(({ affectation, heures }) => (
                    <tr key={affectation.id}>
                      <td style={page.td}>
                        <strong>{nomCollab(collabs.get(affectation.collaborateur_id))}</strong>
                      </td>
                      <td style={page.td}>
                        {affectation.activite_id
                          ? referentiel?.activites.find((a) => a.id === affectation.activite_id)?.nom ?? "—"
                          : "—"}
                        {affectation.code ? ` · ${affectation.code}` : ""}
                      </td>
                      <td style={page.td}>{formatDate(affectation.date_debut)}</td>
                      <td style={page.td}>{formatDate(affectation.date_fin)}</td>
                      <td style={{ ...page.td, textAlign: "right" }}>{formatHeures(heures)}</td>
                      <td style={{ ...page.td, textAlign: "right" }}>
                        {peutModifier && (
                          <Link href="/pilotage/affaires" style={{ fontWeight: 700, color: C.rougeFonce }}>
                            Modifier dans le planning
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Liens DBE / CBE */}
        {cbeLies.length > 0 && (
          <section style={{ ...page.carte, marginTop: 20 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>CBE issus de ce DBE</h2>
            <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              {cbeLies.map((a) => (
                <li key={a.id}>
                  <Link href={`/pilotage/affaire/${a.id}`} style={{ fontWeight: 700, color: C.rougeFonce }}>
                    CBE {a.numero}
                  </Link>{" "}
                  — {a.designation}
                </li>
              ))}
            </ul>
          </section>
        )}

        {peutModifier && affaire.type === "DBE" && (
          <div style={{ marginTop: 16 }}>
            <Link href={`/pilotage/nouvelle?origine=${affaire.id}`} style={page.btnSecondaire}>
              Créer le CBE de ce DBE
            </Link>
          </div>
        )}

        {/* Historique */}
        <section style={{ ...page.carte, marginTop: 20 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>
            Historique des {affaire.type === "DBE" ? "dates de remise" : "objectifs"}
          </h2>
          {historique.length === 0 ? (
            <p style={{ color: C.gris }}>Aucun changement de date.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={page.th}>Date</th>
                    <th style={page.th}>Ancienne date</th>
                    <th style={page.th}>Nouvelle date</th>
                    <th style={page.th}>Motif</th>
                    <th style={page.th}>Modifié par</th>
                  </tr>
                </thead>
                <tbody>
                  {historique.map((h) => (
                    <tr key={h.id}>
                      <td style={page.td}>{formatDate(h.modifie_le)}</td>
                      <td style={page.td}>{formatDate(h.ancienne_date)}</td>
                      <td style={page.td}>
                        <strong>{formatDate(h.nouvelle_date)}</strong>
                      </td>
                      <td style={page.td}>
                        {h.motif}
                        {h.commentaire && <div style={{ fontSize: 13, color: C.gris }}>{h.commentaire}</div>}
                      </td>
                      <td style={page.td}>{nomCollab(h.modifie_par ? collabs.get(h.modifie_par) : undefined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {moi?.estAdmin && (
          <div style={{ marginTop: 24 }}>
            <button
              type="button"
              onClick={() => ouvrir("suppression")}
              style={{ ...page.btnSecondaire, borderColor: "#b9bec5", color: "#3b4046" }}
            >
              Supprimer l’affaire
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------- Fenêtres ---------------------------- */}

      {modal === "infos" && (
        <Modal titre="Modifier l’affaire" onClose={() => setModal("")}>
          {erreurModal && <Message genre="erreur">{erreurModal}</Message>}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label htmlFor="m-des" style={page.etiquette}>Descriptif</label>
              <input id="m-des" type="text" value={fDesignation} onChange={(e) => setFDesignation(e.target.value)} style={page.entrees} />
              <div style={page.aide}>Sans nom de client.</div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="m-imp" style={page.etiquette}>Imputation</label>
                <select id="m-imp" value={fImputation} onChange={(e) => setFImputation(e.target.value)} style={page.entrees}>
                  <option value="">—</option>
                  {imputations
                    .filter((i) => i.actif || i.code === affaire.imputation)
                    .map((i) => (
                      <option key={i.code} value={i.code}>{i.libelle}</option>
                    ))}
                </select>
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="m-resp" style={page.etiquette}>Responsable</label>
                <select id="m-resp" value={fResponsable} onChange={(e) => setFResponsable(e.target.value)} style={page.entrees}>
                  {annuaire.map((c) => (
                    <option key={c.id} value={c.id}>{nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="m-sta" style={page.etiquette}>Statut</label>
                <select id="m-sta" value={fStatut} onChange={(e) => setFStatut(e.target.value as StatutAffaire)} style={page.entrees}>
                  {STATUTS.map((s) => (
                    <option key={s.valeur} value={s.valeur}>{s.libelle}</option>
                  ))}
                </select>
              </div>
              {fStatut === "LIVREE" && (
                <div style={{ flex: "1 1 180px" }}>
                  <label htmlFor="m-liv" style={page.etiquette}>Date de livraison</label>
                  <input id="m-liv" type="date" value={fLivraison} onChange={(e) => setFLivraison(e.target.value)} style={page.entrees} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setModal("")}>Annuler</button>
              <button type="button" style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={enregistrerInfos}>
                {enCours ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "echeance" && (
        <Modal titre={affaire.type === "DBE" ? "Modifier la date de remise" : "Modifier l’objectif"} onClose={() => setModal("")} largeur={560}>
          {erreurModal && <Message genre="erreur">{erreurModal}</Message>}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label htmlFor="e-date" style={page.etiquette}>Nouvelle date</label>
              <input id="e-date" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} style={page.entrees} />
              <div style={page.aide}>Date actuelle : {formatDate(affaire.echeance)}</div>
            </div>
            <div>
              <label htmlFor="e-motif" style={page.etiquette}>Motif (obligatoire)</label>
              <input id="e-motif" list="motifs" type="text" value={fMotif} onChange={(e) => setFMotif(e.target.value)} style={page.entrees} />
              <datalist id="motifs">
                <option value="Ressource indisponible" />
                <option value="Demande du client" />
                <option value="Retard fournisseur" />
                <option value="Changement de périmètre" />
                <option value="Replanification interne" />
              </datalist>
              <div style={page.aide}>Conservé dans l’historique pour comprendre les dérives.</div>
            </div>
            <div>
              <label htmlFor="e-com" style={page.etiquette}>Commentaire</label>
              <input id="e-com" type="text" value={fCommentaire} onChange={(e) => setFCommentaire(e.target.value)} style={page.entrees} />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setModal("")}>Annuler</button>
              <button type="button" style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={enregistrerEcheance}>
                {enCours ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "charges" && (
        <Modal titre="Modifier la charge" onClose={() => setModal("")} largeur={820}>
          {erreurModal && <Message genre="erreur">{erreurModal}</Message>}
          <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
            Activité et heures chiffrées. « Déjà réalisé » sert aux heures faites avant le suivi dans
            l’application (elles s’ajoutent au réalisé).
          </p>
          {fLignes.map((l) => (
            <div key={l.cle} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ flex: "2 1 170px", minWidth: 0 }}>
                <label htmlFor={`c-a-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>Activité</label>
                <select
                  id={`c-a-${l.cle}`}
                  value={l.activite_id}
                  onChange={(e) => setFLignes((x) => x.map((y) => (y.cle === l.cle ? { ...y, activite_id: e.target.value, code: "" } : y)))}
                  style={page.entrees}
                >
                  <option value="">— Choisir —</option>
                  {(referentiel?.activites ?? [])
                    .filter((a) => a.actif || a.id === l.activite_id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>{a.nom}</option>
                    ))}
                </select>
              </div>
              <div style={{ flex: "1 1 110px", minWidth: 0 }}>
                <label htmlFor={`c-h-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>Chiffré</label>
                <input
                  id={`c-h-${l.cle}`}
                  type="text"
                  inputMode="decimal"
                  value={l.heures}
                  onChange={(e) => setFLignes((x) => x.map((y) => (y.cle === l.cle ? { ...y, heures: e.target.value } : y)))}
                  style={{ ...page.entrees, textAlign: "right" }}
                />
              </div>
              <div style={{ flex: "1 1 110px", minWidth: 0 }}>
                <label htmlFor={`c-i-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>Déjà réalisé</label>
                <input
                  id={`c-i-${l.cle}`}
                  type="text"
                  inputMode="decimal"
                  value={l.initial}
                  onChange={(e) => setFLignes((x) => x.map((y) => (y.cle === l.cle ? { ...y, initial: e.target.value } : y)))}
                  style={{ ...page.entrees, textAlign: "right" }}
                />
              </div>
              <button
                type="button"
                aria-label="Retirer cette ligne"
                onClick={() => setFLignes((x) => x.filter((y) => y.cle !== l.cle))}
                style={{ minWidth: 44, minHeight: 44, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, fontSize: 20, fontWeight: 700, color: "#3b4046", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.ligne}` }}>
            <button
              type="button"
              style={page.btnSecondaire}
              onClick={() => setFLignes((x) => [...x, { cle: compteur++, activite_id: "", code: "", heures: "", initial: "" }])}
            >
              + Ajouter une activité
            </button>
            <div style={{ fontSize: 18 }}>
              Total chiffré : <strong style={{ fontSize: 22 }}>{formatHeures(totalEdition)}</strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 16 }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setModal("")}>Annuler</button>
            <button type="button" style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={enregistrerCharges}>
              {enCours ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </Modal>
      )}

      {modal === "suppression" && (
        <Modal titre="Supprimer l’affaire ?" onClose={() => setModal("")} largeur={520}>
          {erreurModal && <Message genre="erreur">{erreurModal}</Message>}
          <p style={{ marginTop: 0 }}>
            L’affaire <strong>{affaire.type} {affaire.numero}</strong> sera supprimée avec ses charges, ses affectations et
            son historique. Les heures déjà saisies dans les feuilles d’heures ne sont pas touchées. Pour la conserver
            sans qu’elle apparaisse, passez plutôt son statut en « Abandonnée ».
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setModal("")}>Annuler</button>
            <button type="button" style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={supprimer}>
              {enCours ? "Suppression…" : "Supprimer définitivement"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

export default function FichePage() {
  return (
    <GardeAcces droit="piloterBE">
      <FicheContenu />
    </GardeAcces>
  );
}
