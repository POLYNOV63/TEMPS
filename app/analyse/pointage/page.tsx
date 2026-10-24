"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsCharge from "@/components/analyse/OngletsCharge";
import { BadgeType, C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerActivites, chargerAffaires, chargerAnnuaire, chargerCharges, chargerRealise, chargerTout, type AffaireP, type ReferentielActivites } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, nomCollab, num, type Charge, type Collab, type Realise } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE TECHNIQUE - CHARGE & POINTAGE (ADMIN)

   « Les gars ont-ils pointé ce que j'avais chiffré ? »
   Pour chaque affaire (famille : commande de base + avenants, puisque
   les feuilles d'heures sont pointées sur la base) :
   - chiffré par activité (Suivi d'affaire BE) face au pointé par activité
     (feuilles d'heures + historique importé) ;
   - les DÉPASSEMENTS (pointé au-delà du chiffré, par activité ou au total) ;
   - le pointé sur une activité NON CHIFFRÉE ;
   - le détail par CODE d'imputation et par PERSONNE (qui a pointé quoi).
   Les PE / PI sont exclues par défaut (elles se suivent dans le relevé).
================================================================ */

type Detail = { activite: string; nom: string; chiffre: number; pointe: number };
type Famille = {
  base: string;
  type: AffaireP["type"];
  numeros: string[];
  designation: string;
  imputation: string | null;
  statut: string;
  responsable: string | null;
  echeance: string | null;
  chiffre: number;
  pointe: number;
  activites: Detail[];
  horsChiffrage: number; // pointé sur des activités non chiffrées
  codes: { code: string; heures: number }[];
};

type Ventilation = { type_affaire: string; numero: string; collaborateur_id: string; activite_id: string | null; code: string | null; heures: number };

const pct = (x: number) => `${Math.round(x * 100)} %`;

function PointageContenu() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [parPersonne, setParPersonne] = useState<Ventilation[]>([]);

  const [vue, setVue] = useState<"EN_COURS" | "LIVREES" | "TOUTES">("EN_COURS");
  const [perimetre, setPerimetre] = useState<"FORFAITS" | "PEPI" | "TOUT">("FORFAITS");
  const [seulementAlertes, setSeulementAlertes] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerAffaires({ horsPlanning: true }),
      chargerCharges(),
      chargerRealise(),
      chargerAnnuaire(),
      chargerActivites(),
      chargerTout<Ventilation>((a, b) => supabase.rpc("pointage_par_personne").range(a, b)).catch(() => [] as Ventilation[]),
    ])
      .then(([af, ch, re, an, ref, pp]) => {
        if (!actif) return;
        setAffaires(af);
        setCharges(ch);
        setRealise(re);
        setAnnuaire(an);
        setReferentiel(ref);
        setParPersonne(pp);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const nomActivite = useMemo(() => new Map((referentiel?.activites ?? []).map((a) => [a.id, a.nom])), [referentiel]);
  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);

  /* ---------- familles (base + avenants) ---------- */
  const familles = useMemo(() => {
    const groupes = new Map<string, AffaireP[]>();
    for (const a of affaires) {
      const base = a.numero.match(/^\d+/)?.[0] ?? a.numero;
      const k = `${a.type}|${base.replace(/^0+/, "")}`;
      groupes.set(k, [...(groupes.get(k) ?? []), a]);
    }
    const realiseParCle = new Map<string, Realise[]>();
    for (const r of realise) {
      const k = `${r.type_affaire}|${String(r.numero).replace(/^0+/, "")}`;
      realiseParCle.set(k, [...(realiseParCle.get(k) ?? []), r]);
    }

    const res: Famille[] = [];
    for (const [k, membres] of groupes) {
      const retenus = membres.filter((m) => m.statut !== "ABANDONNEE");
      if (retenus.length === 0) continue;
      membres.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      const base = membres.find((m) => /^\d+$/.test(m.numero)) ?? membres[0];
      const enCours = retenus.some((m) => m.statut === "EN_COURS" || m.statut === "EN_ATTENTE");

      const parActivite = new Map<string, Detail>();
      const ligne = (id: string) => {
        if (!parActivite.has(id)) parActivite.set(id, { activite: id, nom: id === "?" ? "Sans activité" : nomActivite.get(id) ?? "Activité", chiffre: 0, pointe: 0 });
        return parActivite.get(id)!;
      };
      const ids = new Set(retenus.map((m) => m.id));
      for (const c of charges) {
        if (!ids.has(c.affaire_id)) continue;
        const d = ligne(c.activite_id);
        d.chiffre += num(c.heures);
        d.pointe += num(c.realise_initial);
      }
      const codes = new Map<string, number>();
      for (const r of realiseParCle.get(k) ?? []) {
        ligne(r.activite_id ?? "?").pointe += num(r.heures);
        const code = (r.code ?? "—").toUpperCase();
        codes.set(code, (codes.get(code) ?? 0) + num(r.heures));
      }
      const activites = [...parActivite.values()].sort((x, y) => y.chiffre - x.chiffre || y.pointe - x.pointe);
      const chiffre = activites.reduce((t, d) => t + d.chiffre, 0);
      const pointe = activites.reduce((t, d) => t + d.pointe, 0);
      if (chiffre === 0 && pointe === 0) continue;

      res.push({
        base: base.numero.match(/^\d+/)?.[0] ?? base.numero,
        type: base.type,
        numeros: membres.map((m) => m.numero),
        designation: base.designation,
        imputation: base.imputation,
        statut: enCours ? "EN_COURS" : "LIVREE",
        responsable: base.responsable_id,
        echeance: retenus.map((m) => m.echeance).filter(Boolean).sort().slice(-1)[0] ?? null,
        chiffre,
        pointe,
        activites,
        horsChiffrage: activites.filter((d) => d.chiffre === 0).reduce((t, d) => t + d.pointe, 0),
        codes: [...codes.entries()].map(([code, heures]) => ({ code, heures })).sort((x, y) => y.heures - x.heures),
      });
    }
    return res;
  }, [affaires, charges, realise, nomActivite]);

  const affichees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return familles
      .filter((f) => {
        const pepi = f.imputation === "PE" || f.imputation === "PI";
        return perimetre === "TOUT" || (perimetre === "PEPI" ? pepi : !pepi);
      })
      .filter((f) => vue === "TOUTES" || (vue === "EN_COURS" ? f.statut === "EN_COURS" : f.statut === "LIVREE"))
      .filter((f) => !seulementAlertes || f.pointe > f.chiffre + 0.5 || f.horsChiffrage > 0.5 || f.activites.some((d) => d.chiffre > 0 && d.pointe > d.chiffre + 0.5))
      .filter((f) => !q || `${f.type}${f.base} ${f.designation}`.toLowerCase().includes(q))
      .sort((x, y) => (y.chiffre > 0 ? y.pointe / y.chiffre : 9) - (x.chiffre > 0 ? x.pointe / x.chiffre : 9));
  }, [familles, perimetre, vue, seulementAlertes, recherche]);

  const totaux = useMemo(() => {
    const chiffre = affichees.reduce((t, f) => t + f.chiffre, 0);
    const pointe = affichees.reduce((t, f) => t + f.pointe, 0);
    const depassees = affichees.filter((f) => f.chiffre > 0 && f.pointe > f.chiffre + 0.5).length;
    const hors = affichees.reduce((t, f) => t + f.horsChiffrage, 0);
    // par activité, toutes affaires affichées
    const parAct = new Map<string, { nom: string; chiffre: number; pointe: number }>();
    for (const f of affichees)
      for (const d of f.activites) {
        const v = parAct.get(d.nom) ?? { nom: d.nom, chiffre: 0, pointe: 0 };
        v.chiffre += d.chiffre;
        v.pointe += d.pointe;
        parAct.set(d.nom, v);
      }
    return { chiffre, pointe, depassees, hors, parAct: [...parAct.values()].sort((x, y) => y.chiffre - x.chiffre) };
  }, [affichees]);

  function exporter() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        affichees.flatMap((f) =>
          f.activites.map((d) => ({
            Affaire: `${f.type}${f.base}`,
            Commandes: f.numeros.join(", "),
            Désignation: f.designation,
            Imputation: f.imputation ?? "",
            Statut: f.statut === "EN_COURS" ? "En cours" : "Livrée",
            Activité: d.nom,
            "Chiffré (h)": Math.round(d.chiffre * 10) / 10,
            "Pointé (h)": Math.round(d.pointe * 10) / 10,
            "Écart (h)": Math.round((d.pointe - d.chiffre) * 10) / 10,
            "Consommé (%)": d.chiffre > 0 ? Math.round((d.pointe / d.chiffre) * 100) : "",
          }))
        )
      ),
      "Pointé vs chiffré"
    );
    XLSX.writeFile(wb, `Pointage_vs_chiffre_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const th: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap" };
  const thG: CSSProperties = { ...th, textAlign: "left" };
  const td: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap" };
  const tdG: CSSProperties = { ...page.td, textAlign: "left" };

  const jauge = (chiffre: number, pointe: number) => {
    const ratio = chiffre > 0 ? pointe / chiffre : pointe > 0 ? 2 : 0;
    const couleur = ratio > 1.0001 ? "#c62828" : ratio > 0.9 ? "#e08a00" : "#2e7d32";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        <div style={{ width: 90, height: 8, background: "#eceef1", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", background: couleur }} />
        </div>
        <span style={{ minWidth: 42, fontWeight: 800, color: ratio > 1.0001 ? C.rougeTexte : undefined }}>{chiffre > 0 ? pct(ratio) : "—"}</span>
      </div>
    );
  };

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse technique" />
      <OngletsCharge actif="affaires" />
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={page.titre}>Charge &amp; pointage</h1>
            <p style={page.sousTitre}>
              Ce qui a été pointé (feuilles d’heures et historique) face à ce qui a été chiffré, affaire par affaire et activité par activité. Une
              affaire regroupe sa commande de base et ses avenants : les heures sont pointées sur la base.
            </p>
          </div>
          <button type="button" style={page.btnSecondaire} onClick={exporter} disabled={chargement}>
            Exporter en Excel
          </button>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ ...page.carte, padding: 12, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {(
                  [
                    ["EN_COURS", "En cours"],
                    ["LIVREES", "Livrées"],
                    ["TOUTES", "Toutes"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setVue(v)} style={vue === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={seulementAlertes} onChange={(e) => setSeulementAlertes(e.target.checked)} style={{ width: 18, height: 18 }} />
                Seulement les dépassements et le hors chiffrage
              </label>
              <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Affaires montrées">
                {(
                  [
                    ["FORFAITS", "Forfaits"],
                    ["PEPI", "PE / PI"],
                    ["TOUT", "Tout"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={perimetre === v} onClick={() => setPerimetre(v)} style={perimetre === v ? page.btnPrimaire : page.btnSecondaire}>
                    {l}
                  </button>
                ))}
              </div>
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher une affaire…" style={{ ...page.entrees, maxWidth: 240 }} aria-label="Rechercher" />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Affaires" valeur={String(affichees.length)} sous={`${formatHeures(totaux.chiffre)} chiffrées`} />
              <Tuile libelle="Pointé" valeur={formatHeures(totaux.pointe)} sous={totaux.chiffre > 0 ? `${pct(totaux.pointe / totaux.chiffre)} du chiffré` : ""} />
              <Tuile libelle="Au-delà du chiffré" valeur={String(totaux.depassees)} sous="affaires dont le pointé dépasse le chiffré" accent={totaux.depassees > 0} />
            </div>

            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Par activité (affaires affichées)</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Activité</th>
                    <th style={th}>Chiffré</th>
                    <th style={th}>Pointé</th>
                    <th style={th}>Écart</th>
                    <th style={th}>Consommé</th>
                  </tr>
                </thead>
                <tbody>
                  {totaux.parAct.map((a) => (
                    <tr key={a.nom}>
                      <td style={{ ...tdG, fontWeight: 800 }}>{a.nom}</td>
                      <td style={td}>{formatHeures(a.chiffre)}</td>
                      <td style={td}>{formatHeures(a.pointe)}</td>
                      <td style={{ ...td, color: a.pointe > a.chiffre ? C.rougeTexte : undefined, fontWeight: 700 }}>
                        {a.pointe - a.chiffre > 0 ? "+" : ""}
                        {formatHeures(a.pointe - a.chiffre)}
                      </td>
                      <td style={td}>{jauge(a.chiffre, a.pointe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Affaire par affaire — les plus consommées d’abord</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thG}>Affaire</th>
                    <th style={thG}>Désignation</th>
                    <th style={thG}>Resp.</th>
                    <th style={thG}>Échéance</th>
                    <th style={th}>Chiffré</th>
                    <th style={th}>Pointé</th>
                    <th style={th}>Consommé</th>
                    <th style={thG}>Alerte</th>
                  </tr>
                </thead>
                <tbody>
                  {affichees.map((f) => {
                    const cle = `${f.type}${f.base}`;
                    const ouverte = ouvertes.has(cle);
                    const actDepassees = f.activites.filter((d) => d.chiffre > 0 && d.pointe > d.chiffre + 0.5);
                    const personnes = parPersonne
                      .filter((p) => p.type_affaire === f.type && String(p.numero).replace(/^0+/, "") === f.base.replace(/^0+/, ""))
                      .reduce((m, p) => m.set(p.collaborateur_id, (m.get(p.collaborateur_id) ?? 0) + num(p.heures)), new Map<string, number>());
                    return (
                      <Fragment key={cle}>
                        <tr>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              aria-expanded={ouverte}
                              onClick={() =>
                                setOuvertes((s) => {
                                  const n = new Set(s);
                                  if (n.has(cle)) n.delete(cle);
                                  else n.add(cle);
                                  return n;
                                })
                              }
                              style={{ all: "unset", cursor: "pointer", width: 18, color: C.gris }}
                            >
                              {ouverte ? "▾" : "▸"}
                            </button>{" "}
                            <BadgeType type={f.type} />{" "}
                            <Link href={`/affaires/bilan?affaire=${cle}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                              {f.base}
                            </Link>
                            {f.numeros.length > 1 && <div style={{ fontSize: 11, color: C.gris, paddingLeft: 22 }}>{f.numeros.join(", ")}</div>}
                          </td>
                          <td style={tdG}>
                            {f.designation}
                            <div style={{ fontSize: 11, color: C.gris }}>{f.imputation}</div>
                          </td>
                          <td style={tdG}>{nomCollab(collabs.get(f.responsable ?? ""))}</td>
                          <td style={{ ...tdG, whiteSpace: "nowrap" }}>{formatDate(f.echeance)}</td>
                          <td style={td}>{formatHeures(f.chiffre)}</td>
                          <td style={{ ...td, fontWeight: 800 }}>{formatHeures(f.pointe)}</td>
                          <td style={td}>{jauge(f.chiffre, f.pointe)}</td>
                          <td style={tdG}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {f.chiffre > 0 && f.pointe > f.chiffre + 0.5 && <Pastille genre="crit">+{formatHeures(f.pointe - f.chiffre)}</Pastille>}
                              {actDepassees.length > 0 && <Pastille genre="warn">{actDepassees.map((d) => d.nom).join(", ")} au-delà</Pastille>}
                              {f.horsChiffrage > 0.5 && <Pastille genre="warn">{formatHeures(f.horsChiffrage)} hors chiffrage</Pastille>}
                              {f.chiffre === 0 && <Pastille genre="info">non chiffrée</Pastille>}
                            </div>
                          </td>
                        </tr>
                        {ouverte && (
                          <tr>
                            <td colSpan={8} style={{ ...tdG, background: "#fafbfc", padding: "10px 16px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                                <div style={{ flex: "1 1 360px" }}>
                                  <strong>Par activité</strong>
                                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                    <tbody>
                                      {f.activites.map((d) => (
                                        <tr key={d.activite}>
                                          <td style={{ ...tdG, padding: "4px 6px" }}>{d.nom}</td>
                                          <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(d.chiffre)} chiffrées</td>
                                          <td style={{ ...td, padding: "4px 6px", fontWeight: 700, color: d.pointe > d.chiffre + 0.5 ? C.rougeTexte : undefined }}>{formatHeures(d.pointe)} pointées</td>
                                          <td style={{ ...td, padding: "4px 6px" }}>{d.chiffre > 0 ? jauge(d.chiffre, d.pointe) : <Pastille genre="warn">hors chiffrage</Pastille>}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <div style={{ flex: "1 1 200px" }}>
                                  <strong>Par code</strong>
                                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                    <tbody>
                                      {f.codes.map((c) => (
                                        <tr key={c.code}>
                                          <td style={{ ...tdG, padding: "4px 6px", fontWeight: 700 }}>{c.code}</td>
                                          <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(c.heures)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {personnes.size > 0 && (
                                  <div style={{ flex: "1 1 200px" }}>
                                    <strong>Par personne</strong>
                                    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 4 }}>
                                      <tbody>
                                        {[...personnes.entries()]
                                          .sort((x, y) => y[1] - x[1])
                                          .map(([id, h]) => (
                                            <tr key={id}>
                                              <td style={{ ...tdG, padding: "4px 6px", fontWeight: 700 }}>{nomCollab(collabs.get(id))}</td>
                                              <td style={{ ...td, padding: "4px 6px" }}>{formatHeures(h)}</td>
                                            </tr>
                                          ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function PointagePage() {
  return (
    <GardeAcces droit="indicateurs">
      <PointageContenu />
    </GardeAcces>
  );
}
