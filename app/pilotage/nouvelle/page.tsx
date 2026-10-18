"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { usePrestation, type ModeFin, type PersonnePrestation } from "@/components/pilotage/usePrestation";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerActivites,
  chargerAffaires,
  chargerAnnuaire,
  chargerImputations,
  chargerMoi,
  chargerPlanifie,
  type ReferentielActivites,
} from "@/lib/pilotageDonnees";
import { aISO, estWeekend, ajouterJours, joursChezLeClient, type Affectation, type JourRow } from "@/lib/pilotagePlanning";
import {
  formatDate,
  formatHeures,
  nomCollab,
  num,
  traduireErreur,
  type Affaire,
  type Collab,
  type Imputation,
  type TypeAffaire,
} from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - DECLARER UNE AFFAIRE

   On commence par l'IMPUTATION, qui décide du reste :
     - prestation (PE, PI : imputation « sans heures chiffrées ») :
       une personne, une date de début, puis une date de fin, un nombre
       d'heures ou un nombre de jours. On peut affecter tout de suite ;
     - autres imputations (BE, Scan, Négoce, IG) : heures chiffrées par
       activité et date de livraison souhaitée. Elles apparaissent dans le
       planning, où l'on affecte les ressources ;
     - DBE : date de remise de l'offre (code DT).
   Jamais de nom de client dans le descriptif.
================================================================ */

type LigneCharge = { cle: number; activite_id: string; heures: string };

let compteur = 1;
const nouvelleLigne = (): LigneCharge => ({ cle: compteur++, activite_id: "", heures: "" });

function prochainJourOuvre(depuis: string): string {
  let j = depuis;
  while (estWeekend(j)) j = ajouterJours(j, 1);
  return j;
}

function NouvelleAffaireContenu() {
  const router = useRouter();
  const aujourdhui = aISO(new Date());

  const [imputation, setImputation] = useState("");
  const [type, setType] = useState<TypeAffaire>("CBE");
  const [numero, setNumero] = useState("");
  const [designation, setDesignation] = useState("");
  const [responsable, setResponsable] = useState("");
  const [echeance, setEcheance] = useState("");
  const [origine, setOrigine] = useState("");
  const [lignes, setLignes] = useState<LigneCharge[]>([nouvelleLigne()]);
  const [heuresDbe, setHeuresDbe] = useState("");

  // prestation
  const [personnes, setPersonnes] = useState<PersonnePrestation[]>([]);
  const [comprendConges, setComprendConges] = useState(false);
  const [debut, setDebut] = useState(prochainJourOuvre(aujourdhui));
  const [modeFin, setModeFin] = useState<ModeFin>("DATE");
  const [finDate, setFinDate] = useState("");
  const [quantite, setQuantite] = useState("");
  const [activitePrestation, setActivitePrestation] = useState("");

  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [joursRows, setJoursRows] = useState<JourRow[]>([]);

  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;

    async function charger() {
      try {
        const [an, im, ref, af, moi, pl] = await Promise.all([
          chargerAnnuaire(),
          chargerImputations(),
          chargerActivites(),
          chargerAffaires({ horsPlanning: true }),
          chargerMoi(),
          chargerPlanifie(aujourdhui),
        ]);

        if (!actif) return;

        setAnnuaire(an);
        setImputations(im.filter((i) => i.actif));
        setReferentiel(ref);
        setAffaires(af);
        setAffectations(pl.affectations);
        setJoursRows(pl.jours);

        const params = new URLSearchParams(window.location.search);
        const typeUrl = params.get("type");
        const origineUrl = params.get("origine");
        const dbe = af.find((a) => a.id === origineUrl && a.type === "DBE");

        if (typeUrl === "DBE" || typeUrl === "CBE") setType(typeUrl);

        if (dbe) {
          setType("CBE");
          setOrigine(dbe.id);
          setDesignation(dbe.designation);
          setResponsable(dbe.responsable_id);
          if (dbe.imputation) setImputation(dbe.imputation);
        } else if (moi && an.some((c) => c.id === moi.id)) {
          setResponsable(moi.id);
        }
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger le formulaire.");
      } finally {
        if (actif) setChargement(false);
      }
    }

    charger();

    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const imputationChoisie = imputations.find((i) => i.code === imputation);
  const prestation = type === "CBE" && imputationChoisie?.charge_obligatoire === false;
  const dbeDisponibles = affaires.filter((a) => a.type === "DBE");
  const dtActivite = referentiel?.liens.find((l) => l.code === "DT")?.activite_id ?? "";
  const activitesActives = (referentiel?.activites ?? []).filter((a) => a.actif);
  const total = lignes.reduce((t, l) => t + Math.max(0, num(l.heures.replace(",", "."))), 0);

  // Personnes choisies (une seule fois chacune)
  const personnesValides = useMemo(
    () => personnes.filter((p, i) => p.id && personnes.findIndex((x) => x.id === p.id) === i),
    [personnes]
  );

  const calcul = usePrestation({ personnes: prestation ? personnesValides : [], debut, mode: modeFin, fin: finDate, quantite, comprendConges });

  // Personne en PE chez un client : non affectable sur les mêmes jours
  const chezLeClient = useMemo(
    () => joursChezLeClient(affectations, joursRows, (id) => affaires.find((a) => a.id === id)?.imputation === "PE"),
    [affectations, joursRows, affaires]
  );
  const conflits = useMemo(() => {
    const m = new Map<string, string>();

    if (!prestation) return m;

    for (const p of personnesValides) {
      const client = chezLeClient.get(p.id);
      const jour = client ? calcul.resultats.get(p.id)?.jours.find((j) => client.has(j.jour))?.jour : undefined;

      if (jour) m.set(p.id, jour);
    }

    return m;
  }, [prestation, personnesValides, calcul.resultats, chezLeClient]);

  async function enregistrer() {
    setErreur("");

    const numeroNettoye = numero.trim();

    if (!imputation) return setErreur("Choisissez d’abord l’imputation de l’affaire.");
    if (!/^[0-9]{1,8}$/.test(numeroNettoye)) return setErreur("Le numéro d’affaire ne contient que des chiffres (sans CBE ni DBE).");
    if (!designation.trim()) return setErreur("Le descriptif est obligatoire (sans nom de client).");
    if (!responsable) return setErreur("Choisissez le responsable d’affaire.");
    if (type === "DBE" && !echeance) return setErreur("La date de remise de l’offre est obligatoire pour un DBE : c’est le jalon du planning.");

    let charges: { activite_id: string; code: string | null; heures: number }[] = [];
    let echeanceFinale: string | null = echeance || null;
    let affectationsACreer: { collaborateur: string; jours: { jour: string; heures: number }[] }[] = [];

    if (type === "DBE") {
      const h = num(heuresDbe.replace(",", "."));

      if (h > 0) {
        if (!dtActivite) return setErreur("Le code DT n’est rattaché à aucune activité : rattachez-le dans Gestion des activités.");
        charges = [{ activite_id: dtActivite, code: "DT", heures: h }];
      }
    } else if (prestation) {
      if (debut && modeFin === "DATE" && finDate && finDate < debut) return setErreur("Indiquez une date de fin qui ne précède pas le début.");

      if (personnesValides.length > 0) {
        if (!debut) return setErreur("Indiquez la date de début.");
        if (modeFin === "DATE" && !finDate) return setErreur("Indiquez la date de fin.");
        if (modeFin !== "DATE" && num(quantite.replace(",", ".")) <= 0) return setErreur(modeFin === "HEURES" ? "Indiquez le nombre d’heures." : "Indiquez le nombre de jours.");
        if (!calcul.pret) return setErreur("Les disponibilités sont en cours de calcul : réessayez dans un instant.");

        for (const p of personnesValides) {
          const r = calcul.resultats.get(p.id);
          const nom = nomCollab(annuaire.find((c) => c.id === p.id));
          const conflit = conflits.get(p.id);

          if (!r || r.jours.length === 0) return setErreur(`${nom} : aucun jour disponible à partir de cette date.`);
          if (!r.epuise) return setErreur(`${nom} : la durée dépasse un an de planning, réduisez-la.`);
          if (conflit) return setErreur(`${nom} est déjà chez un client (prestation externe) le ${formatDate(conflit)} : elle n’est pas affectable ailleurs.`);

          affectationsACreer.push({ collaborateur: p.id, jours: r.jours });
        }
      }

      echeanceFinale = calcul.finTheorique;
    } else {
      charges = lignes
        .map((l) => ({ activite_id: l.activite_id, code: null, heures: num(l.heures.replace(",", ".")) }))
        .filter((l) => l.activite_id || l.heures > 0);

      if (charges.length === 0 || charges.some((c) => !c.activite_id || c.heures <= 0)) {
        return setErreur("Indiquez au moins une activité avec ses heures chiffrées (chaque ligne : activité et heures).");
      }

      if (new Set(charges.map((c) => c.activite_id)).size !== charges.length) {
        return setErreur("La même activité est saisie deux fois : regroupez ses heures sur une seule ligne.");
      }
    }

    setEnregistrement(true);

    const { data, error } = await supabase.rpc("pilotage_creer_affaire", {
      p_type: type,
      p_numero: numeroNettoye,
      p_designation: designation.trim(),
      p_responsable_id: responsable,
      p_echeance: echeanceFinale,
      p_priorite: null,
      p_dbe_origine_id: type === "CBE" && origine ? origine : null,
      p_charges: charges,
      p_imputation: imputation,
      p_date_debut: prestation ? debut || null : null,
      p_quantite: prestation && modeFin !== "DATE" ? num(quantite.replace(",", ".")) || null : null,
      p_unite: prestation && modeFin !== "DATE" ? (modeFin === "HEURES" ? "HEURES" : "JOURS") : null,
      p_comprend_conges: prestation ? comprendConges : false,
    });

    if (error) {
      setEnregistrement(false);
      return setErreur(traduireErreur(error.message));
    }

    const id = data as string;

    for (const a of affectationsACreer) {
      const jours = a.jours;

      const { error: erreurAff } = await supabase.rpc("pilotage_enregistrer_affectation", {
        p_id: null,
        p_affaire_id: id,
        p_activite_id: activitePrestation || null,
        p_code: null,
        p_libelle: null,
        p_collaborateur_id: a.collaborateur,
        p_date_debut: jours[0].jour,
        p_date_fin: jours[jours.length - 1].jour,
        p_commentaire: null,
        p_jours: jours,
        p_groupe_id: null,
      });

      if (erreurAff) {
        setEnregistrement(false);
        setErreur(`L’affaire est créée, mais l’affectation de ${nomCollab(annuaire.find((c) => c.id === a.collaborateur))} a échoué : ${traduireErreur(erreurAff.message)} Ouvrez le planning pour l’affecter.`);
        return;
      }
    }

    setEnregistrement(false);
    router.push(`/pilotage/affaires?ouvrir=${id}`);
  }

  const segment = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#b9bec5"}`,
    minHeight: 44,
    padding: "0 20px",
    fontWeight: 800,
    fontSize: 15,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const etoile = <span aria-hidden="true" style={{ color: C.rougeFonce }}> *</span>;
  const titreEtape = (n: number, texte: string) => (
    <h2 style={{ margin: "0 0 12px", fontSize: 20, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: C.rouge, color: "#ffffff", fontSize: 15 }}>{n}</span>
      {texte}
    </h2>
  );

  const libelleCourt = (i: Imputation) => i.libelle.replace(/^[^—-]+[—-]\s*/, "");

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="portefeuille" />

      <div style={{ ...page.contenu, maxWidth: 980 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={page.titre}>Déclarer une nouvelle affaire</h1>
          <p style={page.sousTitre}>On commence par l’imputation : elle décide de ce qu’il faut renseigner ensuite. Jamais de nom de client.</p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && !erreur && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* 1. imputation */}
            <section style={{ ...page.carte, padding: 22 }}>
              {titreEtape(1, "Imputation")}
              <div role="radiogroup" aria-label="Imputation" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                {imputations.map((i) => {
                  const actif = imputation === i.code;

                  return (
                    <button
                      key={i.code}
                      type="button"
                      role="radio"
                      aria-checked={actif}
                      onClick={() => setImputation(i.code)}
                      style={{
                        textAlign: "left",
                        minHeight: 64,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `2px solid ${actif ? C.rouge : "#c9cdd2"}`,
                        background: actif ? "#fff4f4" : "#ffffff",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: C.encre,
                      }}
                    >
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{actif ? "✓ " : ""}{i.code}</div>
                      <div style={{ fontSize: 13, color: "#3b4046" }}>{libelleCourt(i)}</div>
                      <div style={{ fontSize: 12, color: C.gris, marginTop: 2 }}>
                        {i.charge_obligatoire === false ? "une personne, des dates" : "heures par activité"}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 14 }}>
                <div style={page.etiquette}>Type</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["CBE", "DBE"] as TypeAffaire[]).map((t) => (
                    <button key={t} type="button" aria-pressed={type === t} style={segment(type === t)} onClick={() => setType(t)}>
                      {t === "CBE" ? "CBE — affaire" : "DBE — offre"}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* 2. l'affaire */}
            <section style={{ ...page.carte, padding: 22 }}>
              {titreEtape(2, "L’affaire")}
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <label htmlFor="numero" style={page.etiquette}>Numéro d’affaire{etoile}</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, color: C.rougeFonce }}>{type}</span>
                      <input id="numero" type="text" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="ex. 1741" style={page.entrees} />
                    </div>
                    <div style={page.aide}>Le même numéro que dans les feuilles d’heures.</div>
                  </div>
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <label htmlFor="responsable" style={page.etiquette}>Responsable d’affaire{etoile}</label>
                    <select id="responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)} style={page.entrees}>
                      <option value="">— Choisir —</option>
                      {annuaire.map((c) => (
                        <option key={c.id} value={c.id}>{nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="designation" style={page.etiquette}>Descriptif{etoile}</label>
                  <input id="designation" type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} style={page.entrees} />
                  <div style={page.aide}>Sans nom de client : un descriptif court suffit.</div>
                </div>

                {type === "CBE" && (
                  <div>
                    <label htmlFor="origine" style={page.etiquette}>DBE d’origine</label>
                    <select id="origine" value={origine} onChange={(e) => setOrigine(e.target.value)} style={page.entrees}>
                      <option value="">Aucun</option>
                      {dbeDisponibles.map((a) => (
                        <option key={a.id} value={a.id}>DBE {a.numero} — {a.designation}</option>
                      ))}
                    </select>
                    <div style={page.aide}>Facultatif. Le DBE reste consultable : le CBE est créé à côté.</div>
                  </div>
                )}
              </div>
            </section>

            {/* 3. selon l'imputation */}
            {imputation && type === "DBE" && (
              <section style={{ ...page.carte, padding: 22 }}>
                {titreEtape(3, "Remise de l’offre")}
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <label htmlFor="remise" style={page.etiquette}>Date de remise{etoile}</label>
                    <input id="remise" type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} style={page.entrees} />
                    <div style={page.aide}>Obligatoire : c’est le jalon qui apparaît dans le planning.</div>
                  </div>
                  <div style={{ flex: "0 1 220px" }}>
                    <label htmlFor="h-dbe" style={page.etiquette}>Heures de rédaction (code DT)</label>
                    <input id="h-dbe" type="text" inputMode="decimal" value={heuresDbe} onChange={(e) => setHeuresDbe(e.target.value)} style={{ ...page.entrees, textAlign: "right" }} />
                    <div style={page.aide}>Facultatives : pour réserver du temps de rédaction.</div>
                  </div>
                </div>
              </section>
            )}

            {imputation && type === "CBE" && prestation && (
              <section style={{ ...page.carte, padding: 22 }}>
                {titreEtape(3, `Prestation ${imputation}`)}
                <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
                  Une ou plusieurs personnes, une date de début, puis une date de fin, un nombre d’heures ou un nombre de jours.
                  Vous pouvez affecter tout de suite, ou le faire plus tard dans le planning.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 100%" }}>
                      <div style={page.etiquette}>Personnes</div>

                      {personnes.length === 0 && <div style={{ ...page.aide, marginTop: 0, marginBottom: 8 }}>Aucune pour l’instant : vous pourrez affecter plus tard, dans le planning.</div>}

                      {personnes.map((p, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                          <select
                            aria-label={`Personne ${i + 1}`}
                            value={p.id}
                            onChange={(e) => setPersonnes((l) => l.map((x, k) => (k === i ? { ...x, id: e.target.value } : x)))}
                            style={{ ...page.entrees, flex: "1 1 240px", width: "auto" }}
                          >
                            <option value="">— Choisir —</option>
                            {annuaire.map((c) => (
                              <option key={c.id} value={c.id}>{nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}{!c.inclus_statistiques ? " (encadrement)" : ""}</option>
                            ))}
                          </select>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                            % du temps
                            <input
                              aria-label={`Part du temps, personne ${i + 1}`}
                              type="text"
                              inputMode="numeric"
                              value={p.pourcent}
                              onChange={(e) => setPersonnes((l) => l.map((x, k) => (k === i ? { ...x, pourcent: e.target.value } : x)))}
                              style={{ ...page.entrees, width: 90, textAlign: "right" }}
                            />
                          </label>
                          <button type="button" aria-label="Retirer cette personne" onClick={() => setPersonnes((l) => l.filter((_, k) => k !== i))} style={{ minWidth: 44, minHeight: 44, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, fontSize: 20, cursor: "pointer" }}>×</button>
                        </div>
                      ))}

                      <button type="button" style={page.btnSecondaire} onClick={() => setPersonnes((l) => [...l, { id: "", pourcent: "100" }])}>
                        + une personne
                      </button>
                      <div style={page.aide}>Une seule pour la plupart des PE ; plusieurs pour les PI (une barre chacune dans le planning).</div>
                    </div>
                    <div style={{ flex: "1 1 170px" }}>
                      <label htmlFor="debut" style={page.etiquette}>À partir du</label>
                      <input id="debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={page.entrees} />
                    </div>
                    <div style={{ flex: "1 1 220px" }}>
                      <label htmlFor="act" style={page.etiquette}>Activité (facultative)</label>
                      <select id="act" value={activitePrestation} onChange={(e) => setActivitePrestation(e.target.value)} style={page.entrees}>
                        <option value="">—</option>
                        {activitesActives.map((a) => (
                          <option key={a.id} value={a.id}>{a.nom}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div style={page.etiquette}>La fin se définit par</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {([["DATE", "Une date de fin"], ["HEURES", "Un nombre d’heures"], ["JOURS", "Un nombre de jours"]] as [ModeFin, string][]).map(([m, l]) => (
                        <button key={m} type="button" aria-pressed={modeFin === m} style={{ ...segment(modeFin === m), padding: "0 16px", fontSize: 14 }} onClick={() => setModeFin(m)}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {modeFin === "DATE" ? (
                      <div style={{ flex: "1 1 200px" }}>
                        <label htmlFor="fin" style={page.etiquette}>Date de fin</label>
                        <input id="fin" type="date" value={finDate} onChange={(e) => setFinDate(e.target.value)} style={page.entrees} />
                      </div>
                    ) : (
                      <div style={{ flex: "0 1 200px" }}>
                        <label htmlFor="qte" style={page.etiquette}>{modeFin === "HEURES" ? "Nombre d’heures" : "Nombre de jours"}</label>
                        <input id="qte" type="text" inputMode="decimal" value={quantite} onChange={(e) => setQuantite(e.target.value)} style={{ ...page.entrees, textAlign: "right" }} />
                        <div style={page.aide}>{modeFin === "JOURS" ? "Les demi-journées sont acceptées (2,5)." : ""}</div>
                      </div>
                    )}
                  </div>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 44, padding: "10px 12px", border: "1.5px solid #6f8fb3", background: "#f3f8fd", borderRadius: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={comprendConges} onChange={(e) => setComprendConges(e.target.checked)} style={{ width: 22, height: 22, margin: "2px 0 0", flex: "none" }} />
                    <span>
                      <strong>Cette durée comprend déjà les congés et jours fériés</strong>
                      <span style={{ display: "block", fontSize: 13, color: "#3b4046", marginTop: 2 }}>
                        {comprendConges
                          ? "Cochée : ils sont comptés dans la durée, la fin ne bouge pas."
                          : "Décochée : ils ne sont pas travaillés, la fin est repoussée d’autant."}
                      </span>
                    </span>
                  </label>

                  {personnesValides.length > 0 && (
                    <div style={{ border: `1px solid ${C.ligne}`, borderRadius: 10, padding: 14, background: "#fafbfc", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontWeight: 800 }}>Résultat</div>
                      {calcul.erreur && <div style={{ color: C.rougeTexte, fontSize: 14 }}>{calcul.erreur}</div>}
                      {!calcul.pret && !calcul.erreur && (
                        <div style={{ color: C.gris, fontSize: 14 }}>{calcul.chargement ? "Calcul des disponibilités…" : "Renseignez la fin (date, heures ou jours)."}</div>
                      )}

                      {calcul.pret && calcul.finTheorique && (
                        <div style={{ fontSize: 15 }}>
                          Prestation du <strong>{formatDate(debut)}</strong> au <strong>{formatDate(calcul.finTheorique)}</strong> (début et fin théoriques de l’affaire).
                        </div>
                      )}

                      {personnesValides.map((p) => {
                        const r = calcul.resultats.get(p.id);
                        const nom = nomCollab(annuaire.find((c) => c.id === p.id));
                        const conflit = conflits.get(p.id);

                        if (!r) return null;

                        return (
                          <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: `1px solid ${C.ligne}` }}>
                            <div style={{ fontSize: 15 }}>
                              <strong>{nom}</strong> :{" "}
                              {r.jours.length === 0 ? (
                                <span style={{ color: C.rougeTexte }}>aucun jour disponible à partir de cette date.</span>
                              ) : (
                                <>
                                  {formatHeures(r.total)} sur {r.jours.length} jour(s), du {formatDate(r.jours[0].jour)} au <strong>{formatDate(r.fin)}</strong>
                                  {!comprendConges && modeFin === "DATE" && finDate && r.fin && r.fin > finDate && (
                                    <strong style={{ color: C.orangeTexte }}> — fin repoussée (date demandée : {formatDate(finDate)})</strong>
                                  )}
                                </>
                              )}
                            </div>
                            {r.manquants.length > 0 && (
                              <div role="status" style={{ background: "#fdebd0", color: "#5c2f00", border: "1px solid #e9b877", borderRadius: 10, padding: "8px 12px", fontSize: 14 }}>
                                <strong>▲ Pas disponible tous les jours.</strong>{" "}
                                {r.manquants.map((m) => `${m.motif === "ferie" ? "Jour férié" : "Congé validé"} le ${formatDate(m.jour)}`).join(" · ")}.{" "}
                                {comprendConges ? "Ces jours sont comptés dans la durée : la fin ne bouge pas." : "La fin est repoussée d’autant."}
                              </div>
                            )}
                            {conflit && (
                              <div role="status" style={{ background: "#fde1e1", color: "#5c0a0a", border: "1px solid #e5a3a3", borderRadius: 10, padding: "8px 12px", fontSize: 14 }}>
                                <strong>Chez le client.</strong> {nom} est déjà en prestation externe le {formatDate(conflit)} : elle n’est pas affectable ailleurs.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

            {imputation && type === "CBE" && !prestation && (
              <section style={{ ...page.carte, padding: 22 }}>
                {titreEtape(3, "Heures chiffrées et livraison")}
                <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
                  Les heures par activité apparaissent ensuite dans le planning, où vous affectez les ressources. Le détail se fera dans les feuilles d’heures, au bilan.
                </p>

                {lignes.map((l) => (
                  <div key={l.cle} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
                    <div style={{ flex: "3 1 260px", minWidth: 0 }}>
                      <label htmlFor={`act-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>Activité</label>
                      <select id={`act-${l.cle}`} value={l.activite_id} onChange={(e) => setLignes((x) => x.map((y) => (y.cle === l.cle ? { ...y, activite_id: e.target.value } : y)))} style={page.entrees}>
                        <option value="">— Choisir —</option>
                        {activitesActives.map((a) => (
                          <option key={a.id} value={a.id}>{a.nom}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                      <label htmlFor={`h-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>Heures chiffrées</label>
                      <input id={`h-${l.cle}`} type="text" inputMode="decimal" value={l.heures} onChange={(e) => setLignes((x) => x.map((y) => (y.cle === l.cle ? { ...y, heures: e.target.value } : y)))} style={{ ...page.entrees, textAlign: "right" }} />
                    </div>
                    <button
                      type="button"
                      aria-label="Retirer cette ligne"
                      disabled={lignes.length === 1}
                      onClick={() => setLignes((x) => x.filter((y) => y.cle !== l.cle))}
                      style={{ minWidth: 44, minHeight: 44, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, fontSize: 20, fontWeight: 700, color: "#3b4046", cursor: lignes.length === 1 ? "default" : "pointer", opacity: lignes.length === 1 ? 0.4 : 1 }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.ligne}` }}>
                  <button type="button" style={page.btnSecondaire} onClick={() => setLignes((x) => [...x, nouvelleLigne()])}>+ Ajouter une activité</button>
                  <div style={{ fontSize: 18 }}>Total chiffré : <strong style={{ fontSize: 24 }}>{formatHeures(total)}</strong></div>
                </div>

                <div style={{ marginTop: 18, maxWidth: 260 }}>
                  <label htmlFor="livraison" style={page.etiquette}>Date de livraison souhaitée</label>
                  <input id="livraison" type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} style={page.entrees} />
                  <div style={page.aide}>Facultative : à préciser plus tard si besoin.</div>
                </div>
              </section>
            )}

            {!imputation && (
              <p style={{ color: C.gris, margin: "4px 4px 0" }}>Choisissez une imputation pour continuer.</p>
            )}

            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" style={page.btnSecondaire} onClick={() => router.push("/pilotage")}>Annuler</button>
              <button type="button" style={{ ...page.btnPrimaire, opacity: enregistrement || !imputation ? 0.6 : 1 }} disabled={enregistrement || !imputation} onClick={enregistrer}>
                {enregistrement ? "Enregistrement…" : prestation && personnesValides.length > 0 ? "Déclarer et affecter" : "Déclarer l’affaire"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function NouvelleAffairePage() {
  return (
    <GardeAcces droit="piloterBE">
      <NouvelleAffaireContenu />
    </GardeAcces>
  );
}
