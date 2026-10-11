"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerActivites,
  chargerAffaires,
  chargerAnnuaire,
  chargerImputations,
  chargerMoi,
  type ReferentielActivites,
} from "@/lib/pilotageDonnees";
import {
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

   Informations demandées : numéro, descriptif (jamais de nom de
   client), imputation, responsable d'affaire et heures chiffrées par
   activité (le code est facultatif, comme dans les feuilles d'heures).
================================================================ */

type LigneCharge = {
  cle: number;
  activite_id: string;
  code: string;
  heures: string;
};

let compteur = 1;
const nouvelleLigne = (): LigneCharge => ({ cle: compteur++, activite_id: "", code: "", heures: "" });

function NouvelleAffaireContenu() {
  const router = useRouter();

  const [type, setType] = useState<TypeAffaire>("CBE");
  const [numero, setNumero] = useState("");
  const [designation, setDesignation] = useState("");
  const [imputation, setImputation] = useState("");
  const [responsable, setResponsable] = useState("");
  const [echeance, setEcheance] = useState("");
  const [priorite, setPriorite] = useState("");
  const [origine, setOrigine] = useState("");
  const [lignes, setLignes] = useState<LigneCharge[]>([nouvelleLigne()]);
  const [heuresDbe, setHeuresDbe] = useState("");

  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [affaires, setAffaires] = useState<Affaire[]>([]);

  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;

    async function charger() {
      try {
        const [an, im, ref, af, moi] = await Promise.all([
          chargerAnnuaire(),
          chargerImputations(),
          chargerActivites(),
          chargerAffaires(),
          chargerMoi(),
        ]);

        if (!actif) return;

        setAnnuaire(an);
        setImputations(im.filter((i) => i.actif));
        setReferentiel(ref);
        setAffaires(af);

        const params = new URLSearchParams(window.location.search);
        const typeUrl = params.get("type");
        const origineUrl = params.get("origine");
        const dbe = af.find((a) => a.id === origineUrl && a.type === "DBE");

        if (typeUrl === "DBE" || typeUrl === "CBE") setType(typeUrl);

        if (dbe) {
          // Création d'un CBE à partir d'un DBE : on reprend ses informations
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
  }, []);

  const activitesActives = useMemo(
    () => (referentiel?.activites ?? []).filter((a) => a.actif),
    [referentiel]
  );

  function codesDeLActivite(activiteId: string) {
    if (!referentiel || !activiteId) return [];

    return referentiel.liens
      .filter((l) => l.activite_id === activiteId)
      .map((l) => ({ code: l.code, libelle: referentiel.libellesCodes.get(l.code) ?? "" }))
      .sort((a, b) => a.code.localeCompare(b.code, "fr"));
  }

  function modifierLigne(cle: number, champs: Partial<LigneCharge>) {
    setLignes((l) => l.map((x) => (x.cle === cle ? { ...x, ...champs } : x)));
  }

  const total = lignes.reduce((t, l) => t + Math.max(0, num(l.heures.replace(",", "."))), 0);
  const dbeDisponibles = affaires.filter((a) => a.type === "DBE");

  const imputationChoisie = imputations.find((i) => i.code === imputation);
  // Heures chiffrées obligatoires pour un CBE, sauf imputation « à date de fin » (ex. PE) ; jamais pour un DBE
  const chargeObligatoire = type === "CBE" && (imputationChoisie ? imputationChoisie.charge_obligatoire !== false : true);
  const dtActivite = referentiel?.liens.find((l) => l.code === "DT")?.activite_id ?? "";

  async function enregistrer() {
    setErreur("");

    const numeroNettoye = numero.trim();

    if (!/^[0-9]{1,8}$/.test(numeroNettoye)) {
      setErreur("Le numéro d’affaire ne contient que des chiffres (sans CBE ni DBE).");
      return;
    }

    if (!designation.trim()) {
      setErreur("Le descriptif est obligatoire (sans nom de client).");
      return;
    }

    if (!imputation) {
      setErreur("Choisissez l’imputation de l’affaire.");
      return;
    }

    if (!responsable) {
      setErreur("Choisissez le responsable d’affaire.");
      return;
    }

    if (type === "DBE" && !echeance) {
      setErreur("La date de remise de l’offre est obligatoire pour un DBE : c’est le jalon du planning.");
      return;
    }

    let charges: { activite_id: string; code: string | null; heures: number }[] = [];

    if (type === "DBE") {
      // Un DBE s'impute toujours sur le code DT ; ses heures sont facultatives
      const h = num(heuresDbe.replace(",", "."));

      if (h > 0) {
        if (!dtActivite) {
          setErreur("Le code DT n’est rattaché à aucune activité : rattachez-le dans Gestion des activités.");
          return;
        }

        charges = [{ activite_id: dtActivite, code: "DT", heures: h }];
      }
    } else {
      charges = lignes
        .map((l) => ({
          activite_id: l.activite_id,
          code: l.code || null,
          heures: num(l.heures.replace(",", ".")),
        }))
        .filter((l) => l.activite_id || l.heures > 0);

      if (chargeObligatoire && (charges.length === 0 || charges.some((c) => !c.activite_id || c.heures <= 0))) {
        setErreur("Indiquez au moins une activité avec ses heures chiffrées (chaque ligne : activité et heures).");
        return;
      }

      if (!chargeObligatoire && charges.some((c) => !c.activite_id || c.heures <= 0)) {
        setErreur("Chaque ligne de charge doit avoir une activité et des heures (ou retirez la ligne).");
        return;
      }
    }

    const doublons = new Set<string>();

    for (const c of charges) {
      const k = `${c.activite_id}|${c.code ?? ""}`;
      if (doublons.has(k)) {
        setErreur("La même activité (avec le même code) est saisie deux fois.");
        return;
      }
      doublons.add(k);
    }

    setEnregistrement(true);

    const { data, error } = await supabase.rpc("pilotage_creer_affaire", {
      p_type: type,
      p_numero: numeroNettoye,
      p_designation: designation.trim(),
      p_responsable_id: responsable,
      p_echeance: echeance || null,
      p_priorite: priorite ? Number(priorite) : null,
      p_dbe_origine_id: type === "CBE" && origine ? origine : null,
      p_charges: charges,
      p_imputation: imputation,
    });

    setEnregistrement(false);

    if (error) {
      setErreur(traduireErreur(error.message));
      return;
    }

    router.push(`/pilotage/affaire/${data as string}`);
  }

  const bouton = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#b9bec5"}`,
    minHeight: 44,
    padding: "0 26px",
    fontWeight: 800,
    fontSize: 16,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const etoile = <span aria-hidden="true" style={{ color: C.rougeFonce }}> *</span>;

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="portefeuille" />

      <div style={page.contenu}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={page.titre}>Déclarer une nouvelle affaire</h1>
          <p style={page.sousTitre}>
            Un numéro, un descriptif (sans nom de client), l’imputation, un responsable et les heures chiffrées par
            activité.
          </p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && !erreur && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
            <section style={{ ...page.carte, padding: 24, flex: "999 1 620px", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <div style={page.etiquette}>Type d’affaire{etoile}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {(["DBE", "CBE"] as TypeAffaire[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={type === t}
                          style={bouton(type === t)}
                          onClick={() => setType(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <label htmlFor="numero" style={page.etiquette}>
                      Numéro d’affaire{etoile}
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, color: C.rougeFonce }}>{type}</span>
                      <input
                        id="numero"
                        type="text"
                        inputMode="numeric"
                        value={numero}
                        onChange={(e) => setNumero(e.target.value)}
                        placeholder="ex. 1741"
                        style={page.entrees}
                      />
                    </div>
                    <div style={page.aide}>Le même numéro que dans les feuilles d’heures.</div>
                  </div>
                </div>

                <div>
                  <label htmlFor="designation" style={page.etiquette}>
                    Descriptif{etoile}
                  </label>
                  <input
                    id="designation"
                    type="text"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    style={page.entrees}
                  />
                  <div style={page.aide}>Sans nom de client : un descriptif court suffit.</div>
                </div>

                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <label htmlFor="imputation" style={page.etiquette}>
                      Imputation{etoile}
                    </label>
                    <select
                      id="imputation"
                      value={imputation}
                      onChange={(e) => setImputation(e.target.value)}
                      style={page.entrees}
                    >
                      <option value="">— Choisir —</option>
                      {imputations.map((i) => (
                        <option key={i.code} value={i.code}>
                          {i.libelle}
                        </option>
                      ))}
                    </select>
                    <div style={page.aide}>La liste est gérée par l’administrateur.</div>
                  </div>

                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <label htmlFor="responsable" style={page.etiquette}>
                      Responsable d’affaire{etoile}
                    </label>
                    <select
                      id="responsable"
                      value={responsable}
                      onChange={(e) => setResponsable(e.target.value)}
                      style={page.entrees}
                    >
                      <option value="">— Choisir —</option>
                      {annuaire.map((c) => (
                        <option key={c.id} value={c.id}>
                          {nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <label htmlFor="echeance" style={page.etiquette}>
                      {type === "DBE" ? <>Date de remise{etoile}</> : "Date objectif"}
                    </label>
                    <input
                      id="echeance"
                      type="date"
                      value={echeance}
                      onChange={(e) => setEcheance(e.target.value)}
                      style={page.entrees}
                    />
                    <div style={page.aide}>
                      {type === "DBE"
                        ? "Obligatoire : c’est le jalon qui apparaît dans le planning."
                        : "Facultative : à préciser plus tard si besoin."}
                    </div>
                  </div>

                  <div style={{ flex: "0 1 140px", minWidth: 0 }}>
                    <label htmlFor="priorite" style={page.etiquette}>
                      Priorité
                    </label>
                    <select
                      id="priorite"
                      value={priorite}
                      onChange={(e) => setPriorite(e.target.value)}
                      style={page.entrees}
                    >
                      <option value="">—</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                    <div style={page.aide}>Facultative.</div>
                  </div>
                </div>

                {type === "CBE" && (
                  <div>
                    <label htmlFor="origine" style={page.etiquette}>
                      DBE d’origine
                    </label>
                    <select
                      id="origine"
                      value={origine}
                      onChange={(e) => setOrigine(e.target.value)}
                      style={page.entrees}
                    >
                      <option value="">Aucun</option>
                      {dbeDisponibles.map((a) => (
                        <option key={a.id} value={a.id}>
                          DBE {a.numero} — {a.designation}
                        </option>
                      ))}
                    </select>
                    <div style={page.aide}>Facultatif. Le DBE reste consultable : le CBE est créé à côté.</div>
                  </div>
                )}

                <hr style={{ border: 0, borderTop: `1px solid ${C.ligne}`, width: "100%", margin: "4px 0" }} />

                {type === "DBE" ? (
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
                      Heures de rédaction de l’offre{" "}
                      <span style={{ fontWeight: 600, fontSize: 14, color: C.gris }}>(facultatives)</span>
                    </div>
                    <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
                      Un DBE est surtout une date de remise dans le planning. Pour réserver du temps de rédaction,
                      indiquez des heures : elles s’imputent toujours sur le code <strong>DT</strong> (devis technique).
                    </p>
                    <div style={{ maxWidth: 240 }}>
                      <label htmlFor="h-dbe" style={page.etiquette}>
                        Heures (code DT)
                      </label>
                      <input
                        id="h-dbe"
                        type="text"
                        inputMode="decimal"
                        value={heuresDbe}
                        onChange={(e) => setHeuresDbe(e.target.value)}
                        style={{ ...page.entrees, textAlign: "right" }}
                      />
                    </div>
                  </div>
                ) : (
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
                    Charge chiffrée par activité
                    {chargeObligatoire ? (
                      etoile
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: 14, color: C.gris }}> (facultative pour cette imputation)</span>
                    )}
                  </div>
                  <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
                    On choisit l’activité, puis, si on le souhaite, le code : comme dans les feuilles d’heures.
                  </p>

                  {lignes.map((l) => {
                    const codes = codesDeLActivite(l.activite_id);

                    return (
                      <div
                        key={l.cle}
                        style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}
                      >
                        <div style={{ flex: "2 1 200px", minWidth: 0 }}>
                          <label htmlFor={`act-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>
                            Activité
                          </label>
                          <select
                            id={`act-${l.cle}`}
                            value={l.activite_id}
                            onChange={(e) => modifierLigne(l.cle, { activite_id: e.target.value, code: "" })}
                            style={page.entrees}
                          >
                            <option value="">— Choisir —</option>
                            {activitesActives.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.nom}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div style={{ flex: "3 1 240px", minWidth: 0 }}>
                          <label htmlFor={`code-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>
                            Code (facultatif)
                          </label>
                          <select
                            id={`code-${l.cle}`}
                            value={l.code}
                            disabled={!l.activite_id}
                            onChange={(e) => modifierLigne(l.cle, { code: e.target.value })}
                            style={page.entrees}
                          >
                            <option value="">Toute l’activité</option>
                            {codes.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} — {c.libelle}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                          <label htmlFor={`h-${l.cle}`} style={{ ...page.aide, fontWeight: 700, marginTop: 0 }}>
                            Heures chiffrées
                          </label>
                          <input
                            id={`h-${l.cle}`}
                            type="text"
                            inputMode="decimal"
                            value={l.heures}
                            onChange={(e) => modifierLigne(l.cle, { heures: e.target.value })}
                            style={{ ...page.entrees, textAlign: "right" }}
                          />
                        </div>

                        <button
                          type="button"
                          aria-label="Retirer cette ligne"
                          disabled={lignes.length === 1}
                          onClick={() => setLignes((x) => x.filter((y) => y.cle !== l.cle))}
                          style={{
                            minWidth: 44,
                            minHeight: 44,
                            border: "1.5px solid #b9bec5",
                            background: "#ffffff",
                            borderRadius: 8,
                            fontSize: 20,
                            fontWeight: 700,
                            color: "#3b4046",
                            cursor: lignes.length === 1 ? "default" : "pointer",
                            opacity: lignes.length === 1 ? 0.4 : 1,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: `1px solid ${C.ligne}`,
                    }}
                  >
                    <button type="button" style={page.btnSecondaire} onClick={() => setLignes((x) => [...x, nouvelleLigne()])}>
                      + Ajouter une activité
                    </button>
                    <div style={{ fontSize: 18 }}>
                      Total chiffré : <strong style={{ fontSize: 24 }}>{formatHeures(total)}</strong>
                    </div>
                  </div>
                </div>
                )}

                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap", paddingTop: 8 }}>
                  <button type="button" style={page.btnSecondaire} onClick={() => router.push("/pilotage")}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    style={{ ...page.btnPrimaire, opacity: enregistrement ? 0.6 : 1 }}
                    disabled={enregistrement}
                    onClick={enregistrer}
                  >
                    {enregistrement ? "Enregistrement…" : "Déclarer l’affaire"}
                  </button>
                </div>
              </div>
            </section>

            <aside style={{ ...page.carte, flex: "1 1 300px", maxWidth: 360, minWidth: 260 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Ce qu’il faut renseigner</h2>
              <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                <li>
                  Un numéro et un <strong>descriptif</strong>, sans nom de client.
                </li>
                <li>
                  L’<strong>imputation</strong> (BE, PE, PI…).
                </li>
                <li>
                  Un <strong>responsable d’affaire</strong>.
                </li>
                <li>
                  Les <strong>heures chiffrées par activité</strong>, avec le code si on veut détailler (facultatives
                  pour une prestation planifiée par date de fin, comme PE).
                </li>
                <li>
                  Pour un <strong>DBE</strong> : la date de remise de l’offre (code DT, heures facultatives).
                </li>
              </ul>
              <h2 style={{ margin: "20px 0 10px", fontSize: 18 }}>Ce qui vient ensuite</h2>
              <p style={{ margin: 0, color: "#3b4046" }}>
                Les heures réellement passées arrivent seules depuis les feuilles d’heures : la fiche de l’affaire
                les compare au chiffré, activité par activité.
              </p>
            </aside>
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
