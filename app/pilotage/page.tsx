"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { BadgeType, C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import {
  chargerAffaires,
  chargerAnnuaire,
  chargerCharges,
  chargerImputations,
  chargerMoi,
  chargerPlanifie,
  chargerRealise,
  type Moi,
} from "@/lib/pilotageDonnees";
import {
  aujourdhuiISO,
  chargesParAffaire,
  cleAffaire,
  etatAffaire,
  formatDate,
  formatHeures,
  indexParAffaire,
  nomCollab,
  planifieParAffaire,
  totauxAffaire,
  type Affaire,
  type Collab,
  type Genre,
  type Imputation,
  type PlanningAffaire,
  type Realise,
  type Totaux,
} from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - PORTEFEUILLE DES AFFAIRES

   Tout le monde voit cette page ; seuls les responsables et les
   administrateurs peuvent déclarer ou modifier une affaire.
================================================================ */

type Ligne = {
  affaire: Affaire;
  totaux: Totaux;
  planning: { planifie: number; fin: string | null; nb: number };
  etat: { genre: Genre; texte: string };
};

type FiltreStatut = "EN_COURS" | "EN_ATTENTE" | "TOUS" | "DEPASSEMENT";
type FiltreType = "TOUS" | "DBE" | "CBE";

function normaliser(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function PortefeuilleContenu() {
  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [charges, setCharges] = useState<Awaited<ReturnType<typeof chargerCharges>>>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [planifies, setPlanifies] = useState<Map<string, { planifie: number; fin: string | null; nb: number }>>(new Map());
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [filtreType, setFiltreType] = useState<FiltreType>("TOUS");
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>("EN_COURS");
  const [afficherClos, setAfficherClos] = useState(false);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    let actif = true;

    async function charger() {
      try {
        const [a, c, r, an, im, m, pl] = await Promise.all([
          chargerAffaires(),
          chargerCharges(),
          chargerRealise(),
          chargerAnnuaire(),
          chargerImputations(),
          chargerMoi(),
          chargerPlanifie(aujourdhuiISO()),
        ]);

        if (!actif) return;

        setAffaires(a);
        setCharges(c);
        setRealise(r);
        setAnnuaire(an);
        setImputations(im);
        setMoi(m);
        setPlanifies(planifieParAffaire(pl.affectations, pl.jours, aujourdhuiISO()));
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger le portefeuille.");
      } finally {
        if (actif) setChargement(false);
      }
    }

    charger();

    return () => {
      actif = false;
    };
  }, []);

  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);
  const libellesImputation = useMemo(
    () => new Map(imputations.map((i) => [i.code, i.code])),
    [imputations]
  );

  const lignes: Ligne[] = useMemo(() => {
    const parAffaireCharges = chargesParAffaire(charges);
    const parAffaireRealise = indexParAffaire(realise);
    const aujourdhui = aujourdhuiISO();

    return affaires.map((affaire) => {
      const totaux = totauxAffaire(
        parAffaireCharges.get(affaire.id) ?? [],
        parAffaireRealise.get(cleAffaire(affaire.type, affaire.numero)) ?? []
      );

      const p = planifies.get(affaire.id) ?? { planifie: 0, fin: null, nb: 0 };
      const imputation = imputations.find((i) => i.code === affaire.imputation);
      const planning: PlanningAffaire = {
        ...p,
        chargeObligatoire: imputation ? imputation.charge_obligatoire !== false : true,
        planningActif: planifies.size > 0,
      };

      return { affaire, totaux, planning: p, etat: etatAffaire(affaire, totaux, aujourdhui, planning) };
    });
  }, [affaires, charges, realise, planifies, imputations]);

  const planningActif = planifies.size > 0;

  const visibles = useMemo(() => {
    const q = normaliser(recherche.trim());

    return lignes
      .filter(({ affaire, totaux }) => {
        if (filtreType !== "TOUS" && affaire.type !== filtreType) return false;

        if (q && !normaliser(`${affaire.numero} ${affaire.designation}`).includes(q)) return false;

        if (filtreStatut === "DEPASSEMENT") return totaux.depassement > 0;
        if (filtreStatut === "EN_COURS") return affaire.statut === "EN_COURS";
        if (filtreStatut === "EN_ATTENTE") return affaire.statut === "EN_ATTENTE";

        // Tous : le courant seulement, sauf si l'on demande les affaires terminées
        if (!afficherClos && (affaire.statut === "LIVREE" || affaire.statut === "ABANDONNEE")) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const ea = a.affaire.echeance ?? "9999-12-31";
        const eb = b.affaire.echeance ?? "9999-12-31";
        return ea.localeCompare(eb) || b.affaire.numero.localeCompare(a.affaire.numero, "fr", { numeric: true });
      });
  }, [lignes, filtreType, filtreStatut, afficherClos, recherche]);

  const synthese = useMemo(() => {
    const enCours = lignes.filter((l) => l.affaire.statut === "EN_COURS");
    const cbeEnCours = enCours.filter((l) => l.affaire.type === "CBE");

    return {
      enCours: enCours.length,
      cbe: cbeEnCours.length,
      dbe: enCours.length - cbeEnCours.length,
      enAttente: lignes.filter((l) => l.affaire.statut === "EN_ATTENTE").length,
      reste: cbeEnCours.reduce((t, l) => t + l.totaux.reste, 0),
      depassements: lignes.filter((l) => l.affaire.statut !== "ABANDONNEE" && l.totaux.depassement > 0).length,
    };
  }, [lignes]);

  const alertes = useMemo(() => {
    const actives = lignes.filter(
      (l) => l.affaire.statut === "EN_COURS" || l.totaux.depassement > 0
    );

    return {
      critiques: actives.filter((l) => l.etat.genre === "crit"),
      surveiller: actives.filter((l) => l.etat.genre === "warn"),
    };
  }, [lignes]);

  function LigneAlerte({ l }: { l: Ligne }) {
    return (
      <li style={{ padding: "10px 0", borderTop: `1px solid ${C.ligne}`, fontSize: 14 }}>
        <Link href={`/pilotage/affaire/${l.affaire.id}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
          {l.affaire.type} {l.affaire.numero}
        </Link>{" "}
        — {l.etat.texte}
      </li>
    );
  }

  const bouton = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#c9cdd2"}`,
    minHeight: 44,
    padding: "0 16px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const statutsFiltres: { valeur: FiltreStatut; libelle: string }[] = [
    { valeur: "EN_COURS", libelle: "En cours" },
    { valeur: "EN_ATTENTE", libelle: "En attente" },
    { valeur: "TOUS", libelle: "Tous" },
    { valeur: "DEPASSEMENT", libelle: "Dépassements" },
  ];

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="portefeuille" />

      <div style={page.contenu}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={page.titre}>Portefeuille des affaires</h1>
            <p style={page.sousTitre}>
              Affaires DBE et CBE : chiffré, réalisé et dépassements. Réservé aux responsables et aux administrateurs.
            </p>
          </div>

          {moi?.peutModifier && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/pilotage/nouvelle?type=DBE" style={page.btnSecondaire}>
                + Nouveau DBE
              </Link>
              <Link href="/pilotage/nouvelle?type=CBE" style={page.btnPrimaire}>
                + Nouveau CBE
              </Link>
            </div>
          )}
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && !erreur && <Message genre="info">Chargement du portefeuille…</Message>}

        {!chargement && !erreur && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
              <Tuile
                libelle="Affaires en cours"
                valeur={String(synthese.enCours)}
                sous={`${synthese.cbe} CBE · ${synthese.dbe} DBE`}
              />
              <Tuile libelle="En attente" valeur={String(synthese.enAttente)} sous="décision du client" />
              <Tuile
                libelle="Reste à faire"
                valeur={formatHeures(synthese.reste)}
                sous="CBE en cours : chiffré − réalisé"
              />
              <Tuile
                libelle="Dépassements"
                valeur={String(synthese.depassements)}
                sous="réalisé supérieur au chiffré"
                accent={synthese.depassements > 0}
              />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
              <div style={{ flex: "999 1 640px", minWidth: 0 }}>
                <section style={{ ...page.carte, padding: 16 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {(["TOUS", "DBE", "CBE"] as FiltreType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={filtreType === t}
                        style={bouton(filtreType === t)}
                        onClick={() => setFiltreType(t)}
                      >
                        {t === "TOUS" ? "DBE + CBE" : t}
                      </button>
                    ))}

                    <span style={{ width: 8 }} />

                    {statutsFiltres.map((s) => (
                      <button
                        key={s.valeur}
                        type="button"
                        aria-pressed={filtreStatut === s.valeur}
                        style={bouton(filtreStatut === s.valeur)}
                        onClick={() => setFiltreStatut(s.valeur)}
                      >
                        {s.libelle}
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 16,
                      alignItems: "center",
                      margin: "12px 0",
                    }}
                  >
                    <input
                      type="search"
                      aria-label="Rechercher une affaire"
                      placeholder="Rechercher un numéro ou un descriptif…"
                      value={recherche}
                      onChange={(e) => setRecherche(e.target.value)}
                      style={{ ...page.entrees, maxWidth: 360 }}
                    />

                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 10,
                        minHeight: 44,
                        fontWeight: 600,
                        color: "#3b4046",
                        cursor: filtreStatut === "TOUS" ? "pointer" : "default",
                        opacity: filtreStatut === "TOUS" ? 1 : 0.5,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={afficherClos}
                        disabled={filtreStatut !== "TOUS"}
                        onChange={(e) => setAfficherClos(e.target.checked)}
                        style={{ width: 20, height: 20, margin: 0 }}
                      />
                      Afficher les affaires livrées ou abandonnées
                    </label>
                  </div>

                  {visibles.length === 0 ? (
                    <p style={{ color: C.gris, padding: "16px 4px" }}>
                      {affaires.length === 0
                        ? "Aucune affaire pour le moment."
                        : "Aucune affaire ne correspond à ces filtres."}
                    </p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1000, fontSize: 15 }}>
                        <thead>
                          <tr>
                            <th style={page.th}>N°</th>
                            <th style={page.th}>Descriptif</th>
                            <th style={page.th}>Imputation</th>
                            <th style={page.th}>Resp.</th>
                            <th style={page.th}>Échéance ↑</th>
                            <th style={{ ...page.th, textAlign: "right" }}>Chiffré</th>
                            <th style={{ ...page.th, textAlign: "right" }}>Réalisé</th>
                            <th style={{ ...page.th, textAlign: "right" }}>Reste</th>
                            {planningActif && <th style={{ ...page.th, textAlign: "right" }}>Planifié</th>}
                            {planningActif && <th style={{ ...page.th, textAlign: "right" }}>Non affecté</th>}
                            <th style={page.th}>État</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map(({ affaire, totaux, etat, planning }) => (
                            <tr key={affaire.id}>
                              <td style={page.td}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                                  <BadgeType type={affaire.type} />
                                  <Link
                                    href={`/pilotage/affaire/${affaire.id}`}
                                    style={{ fontWeight: 800, fontSize: 16, color: C.rougeFonce }}
                                  >
                                    {affaire.numero}
                                  </Link>
                                </span>
                              </td>
                              <td style={{ ...page.td, minWidth: 200 }}>{affaire.designation}</td>
                              <td style={page.td}>{affaire.imputation ? libellesImputation.get(affaire.imputation) ?? affaire.imputation : "—"}</td>
                              <td style={page.td}>
                                <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>
                              </td>
                              <td style={{ ...page.td, whiteSpace: "nowrap" }}>
                                {formatDate(affaire.echeance)}
                                <div style={{ fontSize: 12, color: C.gris }}>
                                  {affaire.echeance ? (affaire.type === "DBE" ? "Remise" : "Objectif") : ""}
                                </div>
                              </td>
                              <td style={{ ...page.td, textAlign: "right" }}>
                                {totaux.chiffre > 0 ? formatHeures(totaux.chiffre) : <span style={{ color: C.gris }}>—</span>}
                              </td>
                              <td style={{ ...page.td, textAlign: "right" }}>
                                {totaux.realise > 0 ? formatHeures(totaux.realise) : <span style={{ color: C.gris }}>—</span>}
                              </td>
                              <td style={{ ...page.td, textAlign: "right" }}>
                                {totaux.chiffre > 0 ? formatHeures(totaux.reste) : <span style={{ color: C.gris }}>—</span>}
                              </td>
                              {planningActif && (
                                <td style={{ ...page.td, textAlign: "right" }}>
                                  {planning.planifie > 0 ? formatHeures(planning.planifie) : <span style={{ color: C.gris }}>—</span>}
                                </td>
                              )}
                              {planningActif && (
                                <td style={{ ...page.td, textAlign: "right" }}>
                                  {affaire.type === "CBE" && affaire.statut === "EN_COURS" && totaux.chiffre > 0 ? (
                                    totaux.reste - planning.planifie > 0.01 ? (
                                      <strong style={{ color: C.orangeTexte }}>{formatHeures(totaux.reste - planning.planifie)}</strong>
                                    ) : (
                                      <span style={{ color: C.gris }}>0 h</span>
                                    )
                                  ) : (
                                    <span style={{ color: C.gris }}>—</span>
                                  )}
                                </td>
                              )}
                              <td style={page.td}>
                                <Pastille genre={etat.genre}>{etat.texte}</Pastille>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p style={{ margin: "12px 4px 0", fontSize: 13, color: C.gris }}>
                    Chiffré : heures prévues par activité. Réalisé : heures imputées dans les feuilles d’heures
                    sur le numéro de l’affaire.
                  </p>
                </section>
              </div>

              <aside style={{ flex: "1 1 320px", maxWidth: 380, minWidth: 280 }}>
                <section style={page.carte}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Alertes</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: C.gris }}>
                    Le logiciel calcule et alerte. Le responsable décide.
                  </p>

                  <div style={{ marginTop: 16 }}>
                    <Pastille genre="crit">Critique</Pastille>
                    <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                      {alertes.critiques.length === 0 && (
                        <li style={{ padding: "10px 0", fontSize: 14, color: C.gris }}>Aucune alerte critique.</li>
                      )}
                      {alertes.critiques.slice(0, 10).map((l) => (
                        <LigneAlerte key={l.affaire.id} l={l} />
                      ))}
                    </ul>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <Pastille genre="warn">À surveiller</Pastille>
                    <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
                      {alertes.surveiller.length === 0 && (
                        <li style={{ padding: "10px 0", fontSize: 14, color: C.gris }}>Rien à signaler.</li>
                      )}
                      {alertes.surveiller.slice(0, 10).map((l) => (
                        <LigneAlerte key={l.affaire.id} l={l} />
                      ))}
                    </ul>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function PortefeuillePage() {
  return (
    <GardeAcces droit="piloterBE">
      <PortefeuilleContenu />
    </GardeAcces>
  );
}
