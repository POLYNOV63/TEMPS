"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerAffaires, chargerAnnuaire, chargerTout, type AffaireP } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, nomCollab, type Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE DES AFFAIRES - LES DEVIS (DBE)

   « Combien coûtent nos devis, et que rapportent-ils ? »
   Sur une période (depuis l'ouverture, exercice, mois, dates libres) :
   - les devis travaillés : nombre, heures passées (feuilles d'heures et
     historique, SQL 73), moyenne par devis, et qui les a passées ;
   - la transformation : un devis est « commandé » quand une commande du
     Suivi d'affaire BE porte son n° de devis ; montant commandé ;
   - le rendement : heures de devis pour 1 000 € commandés.
================================================================ */

type Ligne = { type_affaire: string; numero: string; collaborateur_id: string; heures: number };
type Commande = { cbe: string; montant: number; statut: string | null };

const sansZeros = (n: string) => String(n ?? "").replace(/^0+/, "");
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function DevisContenu() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [devis, setDevis] = useState<AffaireP[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [clients, setClients] = useState<Map<string, string>>(new Map());
  const [commandes, setCommandes] = useState<Map<string, Commande>>(new Map());
  const [cumul, setCumul] = useState<Ligne[]>([]);
  const [surPeriode, setSurPeriode] = useState<Ligne[]>([]);
  const [recherche, setRecherche] = useState("");
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());

  const exerciceCourant = new Date().getMonth() >= 10 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const [periode, setPeriode] = useState<{ mode: "TOUT" | "EXERCICE" | "MOIS" | "LIBRE"; exercice: number; mois: string; du: string; au: string }>({
    mode: "EXERCICE",
    exercice: exerciceCourant,
    mois: new Date().toISOString().slice(0, 7),
    du: "",
    au: "",
  });
  const bornes = (() => {
    if (periode.mode === "EXERCICE") return { du: `${periode.exercice}-11-01`, au: `${periode.exercice + 1}-10-31` };
    if (periode.mode === "MOIS" && periode.mois) {
      const [a, m] = periode.mois.split("-").map(Number);
      return { du: `${periode.mois}-01`, au: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) };
    }
    if (periode.mode === "LIBRE" && periode.du && periode.au && periode.du <= periode.au) return { du: periode.du, au: periode.au };
    return null;
  })();
  const frDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR");
  const libellePeriode = bornes ? `du ${frDate(bornes.du)} au ${frDate(bornes.au)}` : "depuis l’ouverture des devis";

  /* ---------- chargement : devis, personnes, clients, commandes, heures cumulées ---------- */
  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [af, an, sl, sc, mt, pp] = await Promise.all([
          chargerAffaires({ horsPlanning: true }),
          chargerAnnuaire(),
          chargerTout<{ id: string; base_affaire: string | null; base_devis: string | null; genre: string; statut: string | null; client_id: string | null }>((a, b) =>
            supabase.from("suivi_lignes").select("id,base_affaire,base_devis,genre,statut,client_id").order("cle").range(a, b)
          ),
          chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
          chargerTout<{ ligne_id: string; montant: number | string | null }>((a, b) => supabase.from("suivi_lignes_montants").select("ligne_id,montant").order("ligne_id").range(a, b)).catch(
            () => [] as { ligne_id: string; montant: number | string | null }[]
          ),
          chargerTout<Ligne>((a, b) => supabase.rpc("pointage_par_personne").range(a, b)).catch(() => [] as Ligne[]),
        ]);
        if (!actif) return;
        setDevis(af.filter((a) => a.type === "DBE"));
        setAnnuaire(an);
        const noms = new Map(sc.map((c) => [c.id, c.nom_abrege]));
        const montants = new Map(mt.map((m) => [m.ligne_id, Number(m.montant) || 0]));
        // client de chaque devis, et commande qui porte son n° de devis (montant de la base et des avenants)
        const cl = new Map<string, string>();
        const parBase = new Map<string, number>();
        for (const l of sl) {
          if (l.base_devis && l.client_id && !cl.has(sansZeros(l.base_devis))) {
            const nom = noms.get(l.client_id);
            if (nom) cl.set(sansZeros(l.base_devis), nom);
          }
          if (l.base_affaire && (l.genre === "BASE" || l.genre === "AVENANT"))
            parBase.set(sansZeros(l.base_affaire), (parBase.get(sansZeros(l.base_affaire)) ?? 0) + (montants.get(l.id) ?? 0));
        }
        const cmd = new Map<string, Commande>();
        for (const l of sl) {
          if (l.genre !== "BASE" || !l.base_devis || !l.base_affaire) continue;
          const k = sansZeros(l.base_devis);
          if (cmd.has(k)) continue;
          cmd.set(k, { cbe: sansZeros(l.base_affaire), montant: parBase.get(sansZeros(l.base_affaire)) ?? 0, statut: l.statut });
        }
        setClients(cl);
        setCommandes(cmd);
        setCumul(pp.filter((x) => x.type_affaire === "DBE").map((x) => ({ ...x, numero: sansZeros(x.numero), heures: Number(x.heures) || 0 })));
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Chargement impossible.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, []);

  /* ---------- heures sur la période (SQL 73) ---------- */
  useEffect(() => {
    if (!bornes) {
      setSurPeriode([]);
      return;
    }
    let actif = true;
    void supabase.rpc("pointage_periode", { p_debut: bornes.du, p_fin: bornes.au }).then(({ data, error }) => {
      if (!actif) return;
      setSurPeriode(
        error
          ? []
          : ((data ?? []) as { type_affaire: string; numero: string; collaborateur_id: string; heures: number | string }[])
              .filter((x) => x.type_affaire === "DBE")
              .map((x) => ({ ...x, numero: sansZeros(x.numero), heures: Number(x.heures) || 0 }))
      );
    });
    return () => {
      actif = false;
    };
  }, [bornes?.du, bornes?.au]);

  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);
  const devisParNumero = useMemo(() => new Map(devis.map((d) => [sansZeros(d.numero), d])), [devis]);

  /* ---------- un devis par ligne : heures sur la période, en cumul, par personne ---------- */
  const lignes = useMemo(() => {
    const source = bornes ? surPeriode : cumul;
    const parNumero = new Map<string, { heures: number; parPersonne: Map<string, number> }>();
    for (const x of source) {
      const v = parNumero.get(x.numero) ?? { heures: 0, parPersonne: new Map<string, number>() };
      v.heures += x.heures;
      v.parPersonne.set(x.collaborateur_id, (v.parPersonne.get(x.collaborateur_id) ?? 0) + x.heures);
      parNumero.set(x.numero, v);
    }
    const cumulParNumero = new Map<string, number>();
    for (const x of cumul) cumulParNumero.set(x.numero, (cumulParNumero.get(x.numero) ?? 0) + x.heures);
    const q = recherche.trim().toLowerCase();
    return [...parNumero.entries()]
      .filter(([, v]) => v.heures > 0.01)
      .map(([numero, v]) => {
        const d = devisParNumero.get(numero);
        return {
          numero,
          devis: d,
          client: clients.get(numero) ?? "",
          heures: v.heures,
          cumul: cumulParNumero.get(numero) ?? v.heures,
          parPersonne: v.parPersonne,
          commande: commandes.get(numero) ?? null,
        };
      })
      .filter((l) => !q || `dbe${l.numero} ${l.client} ${l.devis?.designation ?? ""} ${l.commande ? `cbe${l.commande.cbe}` : ""}`.toLowerCase().includes(q))
      .sort((x, y) => Number(y.numero) - Number(x.numero));
  }, [bornes?.du, bornes?.au, surPeriode, cumul, devisParNumero, clients, commandes, recherche]);

  const synthese = useMemo(() => {
    const heures = lignes.reduce((t, l) => t + l.heures, 0);
    const commandes = lignes.filter((l) => l.commande);
    const montant = commandes.reduce((t, l) => t + (l.commande?.montant ?? 0), 0);
    const termines = lignes.filter((l) => l.commande || (l.devis && l.devis.statut !== "EN_COURS"));
    const heuresCommandes = commandes.reduce((t, l) => t + l.cumul, 0);
    return { n: lignes.length, heures, commandes: commandes.length, montant, termines: termines.length, heuresCommandes };
  }, [lignes]);

  const parPersonne = useMemo(() => {
    const m = new Map<string, { heures: number; devis: number; commandes: number }>();
    for (const l of lignes)
      for (const [id, h] of l.parPersonne) {
        const v = m.get(id) ?? { heures: 0, devis: 0, commandes: 0 };
        v.heures += h;
        v.devis += 1;
        if (l.commande) v.commandes += 1;
        m.set(id, v);
      }
    return [...m.entries()].sort((x, y) => y[1].heures - x[1].heures);
  }, [lignes]);

  const statutDevis = (l: (typeof lignes)[number]) =>
    l.commande ? "commandé" : !l.devis ? "hors Suivi d’affaire" : l.devis.statut === "EN_COURS" ? "ouvert" : l.devis.statut === "ABANDONNEE" ? "perdu" : "envoyé";

  const th: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap" };
  const thG: CSSProperties = { ...th, textAlign: "left" };
  const td: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap" };
  const tdG: CSSProperties = { ...page.td, textAlign: "left" };
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse des affaires" />
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <h1 style={page.titre}>Les devis : ce qu’ils coûtent, ce qu’ils rapportent</h1>
        <p style={page.sousTitre}>
          Les heures passées sur les devis (DBE), par devis et par personne, et ce qu’ils sont devenus : un devis est « commandé » quand une commande du Suivi
          d’affaire BE porte son numéro de devis.
        </p>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ ...page.carte, padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <strong style={{ fontSize: 14 }}>Période :</strong>
              {(
                [
                  ["TOUT", "Depuis l’ouverture"],
                  ["EXERCICE", "Exercice"],
                  ["MOIS", "Mois"],
                  ["LIBRE", "Dates libres"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={periode.mode === v} onClick={() => setPeriode({ ...periode, mode: v })} style={periode.mode === v ? page.btnPrimaire : page.btnSecondaire}>
                  {l}
                </button>
              ))}
              {periode.mode === "EXERCICE" && (
                <select value={periode.exercice} onChange={(e) => setPeriode({ ...periode, exercice: Number(e.target.value) })} style={{ ...page.entrees, width: "auto" }} aria-label="Exercice">
                  {[0, 1, 2, 3].map((k) => (
                    <option key={k} value={exerciceCourant - k}>
                      {exerciceCourant - k}-{exerciceCourant - k + 1}
                    </option>
                  ))}
                </select>
              )}
              {periode.mode === "MOIS" && <input type="month" value={periode.mois} onChange={(e) => setPeriode({ ...periode, mois: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Mois" />}
              {periode.mode === "LIBRE" && (
                <>
                  <input type="date" value={periode.du} onChange={(e) => setPeriode({ ...periode, du: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Du" />
                  <input type="date" value={periode.au} onChange={(e) => setPeriode({ ...periode, au: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Au" />
                </>
              )}
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher : n°, client, désignation…" style={{ ...page.entrees, maxWidth: 260 }} aria-label="Rechercher" />
            </div>

            <Message genre="info">
              <strong>Ce que vous regardez :</strong> les devis sur lesquels quelqu’un a pointé des heures {libellePeriode}, quel que soit leur statut aujourd’hui
              (ouvert, envoyé, perdu ou commandé). Heures : feuilles d’heures, et historique avant le 2 novembre 2026.
            </Message>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, margin: "14px 0" }}>
              <Tuile libelle="Devis travaillés" valeur={String(synthese.n)} sous={`${formatHeures(synthese.heures)} passées · ${synthese.n > 0 ? formatHeures(synthese.heures / synthese.n) : "—"} en moyenne par devis`} />
              <Tuile
                libelle="Devis commandés"
                valeur={String(synthese.commandes)}
                sous={`${pct(synthese.commandes, synthese.n)} des devis travaillés · ${pct(synthese.commandes, synthese.termines)} des devis déjà tranchés (commandés, envoyés ou perdus)`}
              />
              <Tuile libelle="Montant commandé" valeur={euros(synthese.montant)} sous="commandes issues de ces devis (base et avenants)" />
              <Tuile
                libelle="Heures de devis pour 1 000 € commandés"
                valeur={synthese.montant > 0 ? formatHeures((synthese.heuresCommandes / synthese.montant) * 1000) : "—"}
                sous="heures passées sur les devis commandés, rapportées à leur montant"
              />
            </div>

            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Par personne</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Personne</th>
                    <th style={th}>Devis</th>
                    <th style={th}>Heures</th>
                    <th style={th}>Moyenne par devis</th>
                    <th style={th}>Dont commandés</th>
                  </tr>
                </thead>
                <tbody>
                  {parPersonne.map(([id, v]) => (
                    <tr key={id}>
                      <td style={{ ...tdG, fontWeight: 800 }}>
                        {nomCollab(collabs.get(id))} <span style={{ fontWeight: 400, color: C.gris }}>{`${collabs.get(id)?.prenom ?? ""} ${collabs.get(id)?.nom ?? ""}`.trim()}</span>
                      </td>
                      <td style={td}>{v.devis}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{formatHeures(v.heures)}</td>
                      <td style={td}>{formatHeures(v.heures / Math.max(1, v.devis))}</td>
                      <td style={td}>
                        {v.commandes} <span style={{ color: C.gris }}>({pct(v.commandes, v.devis)})</span>
                      </td>
                    </tr>
                  ))}
                  {parPersonne.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...tdG, color: C.gris }}>
                        Aucune heure pointée sur un devis sur cette période.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Devis par devis — les plus récents d’abord</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Devis</th>
                    <th style={thG}>Client</th>
                    <th style={thG}>Désignation</th>
                    <th style={thG}>Rendu prévu</th>
                    <th style={th}>{bornes ? "Sur la période" : "Heures"}</th>
                    {bornes && <th style={th}>Depuis l’ouverture</th>}
                    <th style={thG}>Devenu</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const ouvert = ouverts.has(l.numero);
                    const st = statutDevis(l);
                    return (
                      <Fragment key={l.numero}>
                        <tr>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              aria-expanded={ouvert}
                              onClick={() =>
                                setOuverts((s) => {
                                  const n = new Set(s);
                                  if (n.has(l.numero)) n.delete(l.numero);
                                  else n.add(l.numero);
                                  return n;
                                })
                              }
                              style={{ all: "unset", cursor: "pointer", width: 18, color: C.gris }}
                            >
                              {ouvert ? "▾" : "▸"}
                            </button>{" "}
                            {l.devis ? (
                              <Link href={`/pilotage/affaire/${l.devis.id}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                                DBE{l.numero}
                              </Link>
                            ) : (
                              <strong>DBE{l.numero}</strong>
                            )}
                          </td>
                          <td style={{ ...tdG, fontWeight: 700 }}>{l.client || "—"}</td>
                          <td style={{ ...tdG, fontSize: 13 }}>{l.devis?.designation ?? ""}</td>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>{l.devis?.echeance ? formatDate(l.devis.echeance) : "—"}</td>
                          <td style={{ ...td, fontWeight: 800 }}>{formatHeures(l.heures)}</td>
                          {bornes && <td style={{ ...td, color: C.gris }}>{formatHeures(l.cumul)}</td>}
                          <td style={tdG}>
                            {l.commande ? (
                              <span style={{ fontWeight: 800, color: "#1b5e20" }}>
                                ✓ CBE{l.commande.cbe}
                                {l.commande.montant > 0 ? ` · ${euros(l.commande.montant)}` : ""}
                              </span>
                            ) : (
                              <span style={{ color: st === "perdu" ? "#b3261e" : C.gris }}>{st}</span>
                            )}
                          </td>
                        </tr>
                        {ouvert && (
                          <tr>
                            <td colSpan={bornes ? 7 : 6} style={{ ...tdG, background: "#fafbfc", padding: "8px 16px 8px 40px", fontSize: 13 }}>
                              <strong>Passées par :</strong>{" "}
                              {[...l.parPersonne.entries()]
                                .sort((x, y) => y[1] - x[1])
                                .map(([id, h]) => `${nomCollab(collabs.get(id))} ${formatHeures(h)}`)
                                .join(" · ")}
                              {l.devis && (
                                <span style={{ color: C.gris }}>
                                  {" "}
                                  · rédacteur au planning : {nomCollab(collabs.get(l.devis.responsable_id))}
                                </span>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {lignes.length === 0 && (
                    <tr>
                      <td colSpan={bornes ? 7 : 6} style={{ ...tdG, color: C.gris }}>
                        Aucun devis pointé sur cette période.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p style={{ margin: "10px 4px 0", fontSize: 12, color: C.gris }}>
                « Devenu » : commandé (une commande du Suivi d’affaire porte ce n° de devis), sinon le statut du devis aujourd’hui : ouvert, envoyé ou perdu. « Hors
                Suivi d’affaire » : n° pointé dans les feuilles d’heures mais absent du classeur (devis ancien ou numéro mal saisi).
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function DevisPage() {
  return (
    <GardeAcces droit="indicateurs">
      <DevisContenu />
    </GardeAcces>
  );
}
