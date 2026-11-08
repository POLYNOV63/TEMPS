"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerAffaires, chargerCharges, chargerRealise, type AffaireP } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, type Charge, type Realise } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE - FIABILITÉ DU CHIFFRAGE (FIABILITE_CHIFFRAGE)
   ADMIN et DIRECTION (droit « indicateurs »)

   Sur les forfaits LIVRÉS de l'exercice (novembre → octobre), activité par
   activité : heures chiffrées face aux heures réellement passées.
   - une affaire = une famille (commande de base + avenants), comptée quand
     toutes ses commandes sont livrées, à la date de la dernière livraison ;
   - chiffré : pilotage_charges de la famille ; réalisé : heures pointées
     (feuilles d'heures, historique) + réalisé initial importé du classeur ;
   - « juste » : réalisé à ±10 % du chiffré dans l'activité ;
   - « non chiffré » : heures passées dans une activité qui n'avait pas été
     chiffrée sur l'affaire.
   PE et PI (temps passé) sont exclues. Aucune donnée nominative.
   NEGOCE_A_PART : les affaires de négoce pur (imputation « Négoce ») ne
   sont pas comptées par activité (leurs heures, non chiffrées, sont dans
   la marge) : elles sont résumées à part, heures passées comprises.
================================================================ */

const SEUIL = 0.1;
const SANS = "__sans__";
/* NEGOCE_ROBUSTE : « Négoce », « NEGOCE », « Negoce »… (accents et majuscules ignorés) */
const estNegoceImp = (imp: string | null | undefined) => /^negoce/.test((imp ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());

type Activite = { id: string; nom: string; ordre: number };
type LigneAffaire = { base: string; designation: string; fin: string; chiffre: number; realise: number };
type StatAct = {
  id: string;
  nom: string;
  ordre: number;
  chiffre: number;
  realise: number;
  nonChiffre: number;
  nb: number;
  sous: number;
  juste: number;
  dessus: number;
  affaires: LigneAffaire[];
};

function exerciceCourant() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}
const baseDe = (numero: string) => (numero.match(/^\d+/)?.[0] ?? numero).replace(/^0+/, "");
const pctSigne = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`;
const couleurEcart = (x: number) => (x > SEUIL ? "#c62828" : x < -SEUIL ? "#1f6feb" : "#2e7d32");

/* barre centrée : à droite au-delà du chiffré, à gauche en deçà */
function BarreEcart({ ecart }: { ecart: number }) {
  const largeur = Math.min(50, Math.abs(ecart) * 50);
  return (
    <span style={{ display: "inline-block", position: "relative", width: 160, height: 12, background: "#eef0f3", borderRadius: 6, verticalAlign: "middle" }}>
      <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 2, background: "#6b7178" }} />
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: ecart >= 0 ? "50%" : `${50 - largeur}%`,
          width: `${largeur}%`,
          background: couleurEcart(ecart),
          borderRadius: ecart >= 0 ? "0 6px 6px 0" : "6px 0 0 6px",
        }}
      />
    </span>
  );
}

function FiabiliteContenu() {
  const [exercice, setExercice] = useState(exerciceCourant);
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [activites, setActivites] = useState<Activite[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    Promise.all([chargerAffaires({ horsPlanning: true }), chargerCharges(), chargerRealise(), supabase.from("activites").select("id,nom,ordre_affichage")])
      .then(([af, ch, re, ac]) => {
        if (!actif) return;
        if (ac.error) throw new Error(ac.error.message);
        setAffaires(af);
        setCharges(ch);
        setRealise(re);
        setActivites(((ac.data ?? []) as { id: string; nom: string; ordre_affichage: number | null }[]).map((a) => ({ id: a.id, nom: a.nom, ordre: a.ordre_affichage ?? 999 })));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger l’analyse."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const vue = useMemo(() => {
    const debut = `${exercice}-11-01`;
    const fin = `${exercice + 1}-10-31`;
    const nomAct = new Map(activites.map((a) => [a.id, a]));

    // familles de forfaits (hors PE / PI) entièrement livrées dans l'exercice ; le négoce pur à part
    const familles = new Map<string, AffaireP[]>();
    const imputationBase = new Map<string, string | null>();
    for (const a of affaires) if (a.type === "CBE" && /^\d+$/.test(a.numero)) imputationBase.set(baseDe(a.numero), a.imputation);
    for (const a of affaires) {
      if (a.type !== "CBE" || a.imputation === "PE" || a.imputation === "PI" || a.statut === "ABANDONNEE") continue;
      const b = baseDe(a.numero);
      familles.set(b, [...(familles.get(b) ?? []), a]);
    }
    const negoce: LigneAffaire[] = [];
    const chargesParAffaire = new Map<string, Charge[]>();
    for (const c of charges) chargesParAffaire.set(c.affaire_id, [...(chargesParAffaire.get(c.affaire_id) ?? []), c]);
    const realiseParBase = new Map<string, Map<string, number>>();
    for (const r of realise) {
      if (r.type_affaire !== "CBE") continue;
      const b = baseDe(String(r.numero));
      const m = realiseParBase.get(b) ?? new Map<string, number>();
      const k = r.activite_id ?? SANS;
      m.set(k, (m.get(k) ?? 0) + (Number(r.heures) || 0));
      realiseParBase.set(b, m);
    }

    const stats = new Map<string, StatAct>();
    const stat = (id: string) => {
      let s = stats.get(id);
      if (!s) {
        const a = nomAct.get(id);
        s = { id, nom: id === SANS ? "Sans activité" : a?.nom ?? "Activité", ordre: a?.ordre ?? 9999, chiffre: 0, realise: 0, nonChiffre: 0, nb: 0, sous: 0, juste: 0, dessus: 0, affaires: [] };
        stats.set(id, s);
      }
      return s;
    };
    const parAffaire: { base: string; designation: string; fin: string; chiffre: number; realise: number }[] = [];

    for (const [base, membres] of familles) {
      if (!membres.every((m) => m.statut === "LIVREE")) continue;
      const dateFin = membres.map((m) => m.date_livraison ?? "").sort().slice(-1)[0];
      if (!dateFin || dateFin < debut || dateFin > fin) continue;
      const laBase = membres.find((m) => /^\d+$/.test(m.numero)) ?? membres[0];

      const ch = new Map<string, number>();
      const re = new Map<string, number>(realiseParBase.get(base) ?? []);
      for (const m of membres)
        for (const c of chargesParAffaire.get(m.id) ?? []) {
          ch.set(c.activite_id, (ch.get(c.activite_id) ?? 0) + (Number(c.heures) || 0));
          re.set(c.activite_id, (re.get(c.activite_id) ?? 0) + (Number(c.realise_initial) || 0));
        }
      const totalCh = [...ch.values()].reduce((t, x) => t + x, 0);
      const totalRe = [...re.values()].reduce((t, x) => t + x, 0);
      // NEGOCE_A_PART : négoce pur (imputation de la commande de base), résumé à part
      if (estNegoceImp(imputationBase.get(base) ?? laBase.imputation)) {
        negoce.push({ base, designation: laBase.designation, fin: dateFin, chiffre: totalCh, realise: totalRe });
        continue;
      }
      if (totalCh <= 0) continue; // sans chiffré, rien à comparer
      parAffaire.push({ base, designation: laBase.designation, fin: dateFin, chiffre: totalCh, realise: totalRe });

      for (const id of new Set([...ch.keys(), ...re.keys()])) {
        const c = ch.get(id) ?? 0;
        const r = re.get(id) ?? 0;
        if (c > 0.01) {
          const s = stat(id);
          s.chiffre += c;
          s.realise += r;
          s.nb++;
          const e = (r - c) / c;
          if (e > SEUIL) s.dessus++;
          else if (e < -SEUIL) s.sous++;
          else s.juste++;
          s.affaires.push({ base, designation: laBase.designation, fin: dateFin, chiffre: c, realise: r });
        } else if (r > 0.01) {
          stat(id).nonChiffre += r;
        }
      }
    }

    const liste = [...stats.values()].sort((x, y) => x.ordre - y.ordre || x.nom.localeCompare(y.nom, "fr"));
    for (const s of liste) s.affaires.sort((x, y) => (y.realise - y.chiffre) / y.chiffre - (x.realise - x.chiffre) / x.chiffre);
    const totalCh = parAffaire.reduce((t, a) => t + a.chiffre, 0);
    const totalRe = parAffaire.reduce((t, a) => t + a.realise, 0);
    const justes = parAffaire.filter((a) => Math.abs((a.realise - a.chiffre) / a.chiffre) <= SEUIL).length;
    negoce.sort((x, y) => y.realise - x.realise);
    return { negoce, liste, parAffaire: parAffaire.sort((x, y) => (y.realise - y.chiffre) / y.chiffre - (x.realise - x.chiffre) / x.chiffre), totalCh, totalRe, justes };
  }, [affaires, charges, realise, activites, exercice]);

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px", textAlign: "center" };
  const td: CSSProperties = { ...page.td, padding: "8px", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const ecartGlobal = vue.totalCh > 0 ? (vue.totalRe - vue.totalCh) / vue.totalCh : 0;

  const tableauAffaires = (lignes: LigneAffaire[]) => (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: "left" }}>Affaire</th>
          <th style={{ ...th, textAlign: "left" }}>Descriptif</th>
          <th style={th}>Livrée le</th>
          <th style={th}>Chiffré</th>
          <th style={th}>Réalisé</th>
          <th style={th}>Écart</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((a) => {
          const e = (a.realise - a.chiffre) / a.chiffre;
          return (
            <tr key={a.base}>
              <td style={{ ...td, fontSize: 13, whiteSpace: "nowrap" }}>
                <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                  CBE {a.base}
                </Link>
              </td>
              <td style={{ ...td, fontSize: 13 }}>{a.designation}</td>
              <td style={{ ...tdN, fontSize: 13, textAlign: "center" }}>{formatDate(a.fin)}</td>
              <td style={{ ...tdN, fontSize: 13 }}>{formatHeures(a.chiffre)}</td>
              <td style={{ ...tdN, fontSize: 13 }}>{formatHeures(a.realise)}</td>
              <td style={{ ...tdN, fontSize: 13, fontWeight: 800, color: couleurEcart(e) }}>
                {pctSigne(e)} <span style={{ fontWeight: 600, color: C.gris }}>({a.realise >= a.chiffre ? "+" : "−"}{formatHeures(Math.abs(a.realise - a.chiffre))})</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Fiabilité du chiffrage</h1>
            <p style={page.sousTitre}>
              Sur les forfaits livrés de l’exercice, activité par activité : les heures chiffrées face aux heures réellement passées. De quoi corriger
              les prochains devis.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 110, textAlign: "center" }}>
              {exercice}-{exercice + 1}
            </strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">▶</button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && !erreur && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Forfaits livrés analysés" valeur={String(vue.parAffaire.length)} sous={`du 1er novembre ${exercice} au 31 octobre ${exercice + 1}`} />
              <Tuile libelle="Chiffré" valeur={formatHeures(vue.totalCh)} sous="heures vendues sur ces affaires" />
              <Tuile
                libelle="Réalisé"
                valeur={formatHeures(vue.totalRe)}
                sous={vue.totalCh > 0 ? `${pctSigne(ecartGlobal)} par rapport au chiffré` : "—"}
                accent={ecartGlobal > SEUIL}
              />
              <Tuile
                libelle="Chiffrage juste"
                valeur={vue.parAffaire.length ? `${Math.round((vue.justes / vue.parAffaire.length) * 100)} %` : "—"}
                sous="des affaires livrées à ±10 % du chiffré"
              />
            </div>

            {vue.parAffaire.length === 0 ? (
              <Message genre="info">Aucun forfait livré avec des heures chiffrées sur cet exercice.</Message>
            ) : (
              <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par activité</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  <span style={{ color: "#c62828", fontWeight: 800 }}>Rouge</span> : plus de 10 % au-delà du chiffré (chiffrage trop court) ·{" "}
                  <span style={{ color: "#2e7d32", fontWeight: 800 }}>vert</span> : à ±10 % · <span style={{ color: "#1f6feb", fontWeight: 800 }}>bleu</span> :
                  plus de 10 % en deçà (chiffrage large). Cliquez sur une activité pour voir ses affaires, de la plus dépassée à la moins dépassée.
                </p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, textAlign: "left" }}>Activité</th>
                        <th style={th}>Affaires</th>
                        <th style={th}>Chiffré</th>
                        <th style={th}>Réalisé</th>
                        <th style={th}>Écart</th>
                        <th style={th}>Affaires : en deçà · justes · au-delà</th>
                        <th style={th} title="Heures passées dans cette activité sur des affaires où elle n’avait pas été chiffrée">Réalisé non chiffré</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vue.liste.map((s) => {
                        const e = s.chiffre > 0 ? (s.realise - s.chiffre) / s.chiffre : 0;
                        const ouv = ouverte === s.id;
                        return (
                          <Fragment key={s.id}>
                            <tr onClick={() => setOuverte(ouv ? null : s.id)} style={{ cursor: s.nb > 0 ? "pointer" : "default", background: ouv ? "#f6f8fb" : undefined }}>
                              <td style={{ ...td, fontWeight: 800 }}>
                                {s.nb > 0 && <span style={{ color: C.rougeFonce, marginRight: 6 }}>{ouv ? "▾" : "▸"}</span>}
                                {s.nom}
                              </td>
                              <td style={{ ...tdN, textAlign: "center" }}>{s.nb || "—"}</td>
                              <td style={tdN}>{s.chiffre > 0 ? formatHeures(s.chiffre) : "—"}</td>
                              <td style={tdN}>{s.chiffre > 0 ? formatHeures(s.realise) : "—"}</td>
                              <td style={{ ...tdN, textAlign: "left" }}>
                                {s.chiffre > 0 ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    <BarreEcart ecart={e} />
                                    <strong style={{ color: couleurEcart(e), minWidth: 52, textAlign: "right" }}>{pctSigne(e)}</strong>
                                    <span style={{ fontSize: 12, color: C.gris }}>
                                      ({s.realise >= s.chiffre ? "+" : "−"}
                                      {formatHeures(Math.abs(s.realise - s.chiffre))})
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={{ ...tdN, textAlign: "center" }}>
                                {s.nb > 0 ? (
                                  <>
                                    <span style={{ color: "#1f6feb", fontWeight: 800 }}>{s.sous}</span> ·{" "}
                                    <span style={{ color: "#2e7d32", fontWeight: 800 }}>{s.juste}</span> ·{" "}
                                    <span style={{ color: "#c62828", fontWeight: 800 }}>{s.dessus}</span>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={{ ...tdN, color: s.nonChiffre > 0.5 ? "#b35c00" : C.gris, fontWeight: s.nonChiffre > 0.5 ? 800 : 400 }}>
                                {s.nonChiffre > 0.5 ? formatHeures(s.nonChiffre) : "—"}
                              </td>
                            </tr>
                            {ouv && s.nb > 0 && (
                              <tr>
                                <td colSpan={7} style={{ ...td, background: "#fafbfc", padding: "8px 16px 14px 30px" }}>
                                  {tableauAffaires(s.affaires)}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* NEGOCE_A_PART : le négoce pur, résumé à part */}
            {vue.negoce.length > 0 &&
              (() => {
                const heures = vue.negoce.reduce((t, a) => t + a.realise, 0);
                const chiffre = vue.negoce.reduce((t, a) => t + a.chiffre, 0);
                return (
                  <details style={{ ...page.carte, padding: 16, marginBottom: 14, borderLeft: "5px solid #b35c00" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 16 }}>
                      Négoce, à part : {vue.negoce.length} affaire{vue.negoce.length > 1 ? "s" : ""} livrée{vue.negoce.length > 1 ? "s" : ""} ·{" "}
                      <span style={{ color: "#b35c00" }}>{formatHeures(heures)} passées</span>
                      {chiffre > 0 ? ` pour ${formatHeures(chiffre)} chiffrées` : ", non chiffrées"}
                    </summary>
                    <p style={{ margin: "8px 0 10px", fontSize: 13, color: C.gris }}>
                      Les affaires de négoce pur ne comptent pas dans le tableau par activité : leurs heures (consultation, commandes, suivi fournisseur) ne sont
                      en général pas chiffrées, elles sont couvertes par la marge. Les voici, pour mesurer ce qu’elles coûtent vraiment.
                    </p>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, textAlign: "left" }}>Affaire</th>
                          <th style={{ ...th, textAlign: "left" }}>Descriptif</th>
                          <th style={th}>Livrée le</th>
                          <th style={th}>Chiffré</th>
                          <th style={th}>Heures passées</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vue.negoce.map((a) => (
                          <tr key={a.base}>
                            <td style={{ ...td, fontSize: 13, whiteSpace: "nowrap" }}>
                              <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                                CBE {a.base}
                              </Link>
                            </td>
                            <td style={{ ...td, fontSize: 13 }}>{a.designation}</td>
                            <td style={{ ...tdN, fontSize: 13, textAlign: "center" }}>{formatDate(a.fin)}</td>
                            <td style={{ ...tdN, fontSize: 13 }}>{a.chiffre > 0 ? formatHeures(a.chiffre) : "—"}</td>
                            <td style={{ ...tdN, fontSize: 13, fontWeight: 800 }}>{a.realise > 0 ? formatHeures(a.realise) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                );
              })()}

            {vue.parAffaire.length > 0 && (
              <details style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 16 }}>Toutes les affaires analysées ({vue.parAffaire.length}), toutes activités</summary>
                <div style={{ marginTop: 10 }}>{tableauAffaires(vue.parAffaire)}</div>
              </details>
            )}

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Affaires analysées</strong> : les forfaits (commandes hors PE / PI) dont toutes les commandes de la famille (base et avenants)
                  sont livrées, à la date de la dernière livraison, dans l’exercice ; une affaire sans heures chiffrées est ignorée.
                </li>
                <li>
                  <strong>Chiffré</strong> : les heures chiffrées par activité de toute la famille. <strong>Réalisé</strong> : les heures pointées sur
                  l’affaire (feuilles d’heures et historique) et le réalisé initial repris du classeur, dans la même activité.
                </li>
                <li>
                  <strong>Négoce pur</strong> (imputation « Négoce ») : à part, avec ses heures passées ; il ne pèse pas sur la Mécanique.
                </li>
                <li>
                  <strong>Juste</strong> : réalisé à ±10 % du chiffré. <strong>Réalisé non chiffré</strong> : heures passées dans une activité qui
                  n’avait pas été chiffrée sur l’affaire (souvent un oubli au chiffrage, ou une heure pointée sur la mauvaise activité).
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function FiabiliteChiffragePage() {
  return (
    <GardeAcces droit="indicateurs">
      <FiabiliteContenu />
    </GardeAcces>
  );
}
