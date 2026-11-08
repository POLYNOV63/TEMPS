"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerMoi, chargerRealise, chargerTout } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";
import {
  GROUPES,
  GROUPE_DISCIPLINE,
  affairesTerminees,
  coutHoraire,
  groupesVides,
  type Discipline,
  type Groupe,
  type LigneFin,
  type ParGroupe,
} from "@/lib/finances";

/* ===============================================================
   ANALYSE - RENTABILITÉ (RENTABILITE_V1)
   ADMIN (saisie du coût horaire) et Direction (lecture), droit « indicateurs »

   Sur les affaires au forfait LIVRÉES de l'exercice (toutes les commandes
   de la famille livrées), trois taux horaires :
   - COÛT HORAIRE DE STRUCTURE : saisi ici (calculé dans le classeur
     « Point mort », onglet Indicateurs) ;
   - TAUX VENDU    = (prix − achats) ÷ heures chiffrées ;
   - TAUX OBTENU   = (prix − achats) ÷ heures réellement passées.
   Coût d'une affaire = achats + heures passées × coût horaire ;
   marge = prix − coût.
   Négoce et scan (imputation NEGOCE / SCAN) sont vendus au montant : pas
   de taux vendu, ils comptent entiers dans leur ligne « Négoce » / « Scan ».
   PE / PI (au temps passé) : pas encore dans cette page.
================================================================ */

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const parHeure = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${Math.round(n).toLocaleString("fr-FR")} €/h`);
const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${Math.round(n * 100)} %`);
const sansAccents = (t: string | null | undefined) => (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const venteAuMontant = (imp: string | null | undefined) => /^(negoce|scan)/.test(sansAccents(imp));

function exerciceCourant() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}

type LigneRenta = {
  cle: string;
  libelle: string;
  ca: number;
  achats: number;
  hc: number;
  hr: number;
  cout: number | null;
  auMontant: boolean;
};
type Affaire = LigneRenta & { base: string; designation: string | null; client: string | null; fin: string; imputation: string | null };

const tauxVendu = (l: LigneRenta) => (!l.auMontant && l.hc > 0 ? (l.ca - l.achats) / l.hc : null);
const tauxObtenu = (l: LigneRenta) => (l.hr > 0 ? (l.ca - l.achats) / l.hr : null);
const marge = (l: LigneRenta) => (l.cout === null ? null : l.ca - l.cout);

function RentabiliteContenu() {
  const [exercice, setExercice] = useState(exerciceCourant);
  const [lignesFin, setLignesFin] = useState<LigneFin[]>([]);
  const [realiseParBase, setRealiseParBase] = useState<Map<string, ParGroupe>>(new Map());
  const [couts, setCouts] = useState<Map<number, number>>(new Map());
  const [estAdmin, setEstAdmin] = useState(false);
  const [coutSaisi, setCoutSaisi] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    let actif = true;
    (async () => {
      const n = (v: number | string | null | undefined) => Number(v) || 0;
      const [brutes, montants, clients, realise, corr, acts, co, moi] = await Promise.all([
        chargerTout<{
          id: string; cle: string; parent_cle: string | null; genre: LigneFin["genre"]; base_affaire: string | null; statut: string | null;
          imputation: string | null; designation: string | null; client_id: string | null; date_livraison: string | null;
          date_livraison_estimee: string | null; disparue: boolean;
          heures_meca: number | string; heures_calcul: number | string; heures_elec: number | string; heures_pneu: number | string;
          heures_scan: number | string; heures_autre: number | string; heures_total: number | string;
        }>((a, b) =>
          supabase
            .from("suivi_lignes")
            .select("id,cle,parent_cle,genre,base_affaire,statut,imputation,designation,client_id,date_livraison,date_livraison_estimee,disparue,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre,heures_total")
            .order("cle")
            .range(a, b)
        ),
        chargerTout<Record<string, number | string> & { ligne_id: string }>((a, b) =>
          supabase
            .from("suivi_lignes_montants")
            .select("ligne_id,montant,montant_echeances,montant_meca,montant_calcul,montant_elec_pneu,montant_scan,montant_autre,montant_achats,montant_negoce")
            .order("ligne_id")
            .range(a, b)
        ),
        chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
        chargerRealise(),
        supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
        supabase.from("activites").select("id,nom"),
        supabase.from("indicateurs_couts").select("annee,cout_horaire"),
        chargerMoi().catch(() => null),
      ]);
      if (!actif) return;

      const noms = new Map(clients.map((c) => [c.id, c.nom_abrege]));
      const detail = new Map(montants.map((m) => [m.ligne_id, m]));
      setLignesFin(
        brutes.map((l) => {
          const m = detail.get(l.id);
          return {
            cle: l.cle,
            genre: l.genre,
            parent_cle: l.parent_cle,
            base_affaire: l.base_affaire,
            statut: l.statut,
            imputation: l.imputation,
            designation: l.designation,
            client: l.client_id ? noms.get(l.client_id) ?? null : null,
            date_livraison: l.date_livraison,
            date_estimee: l.date_livraison_estimee,
            disparue: l.disparue,
            heures: { meca: n(l.heures_meca), calcul: n(l.heures_calcul), elec: n(l.heures_elec), pneu: n(l.heures_pneu), scan: n(l.heures_scan), autre: n(l.heures_autre) },
            heures_total: n(l.heures_total),
            m: {
              montant: n(m?.montant),
              echeances: n(m?.montant_echeances),
              meca: n(m?.montant_meca),
              calcul: n(m?.montant_calcul),
              elec_pneu: n(m?.montant_elec_pneu),
              scan: n(m?.montant_scan),
              autre: n(m?.montant_autre),
              achats: n(m?.montant_achats),
              negoce: n(m?.montant_negoce),
            },
          };
        })
      );

      // heures passées par affaire (famille) et par groupe d'activité
      const versDiscipline: Record<string, Discipline> = { "Méca": "meca", Calcul: "calcul", Elec: "elec", Pneu: "pneu", Scan: "scan", Autre: "autre" };
      const groupeActivite = new Map<string, Groupe>();
      for (const c of (corr.data ?? []) as { colonne_excel: string; activite_id: string | null }[]) {
        const d = versDiscipline[c.colonne_excel];
        if (c.activite_id && d) groupeActivite.set(c.activite_id, GROUPE_DISCIPLINE[d]);
      }
      for (const a of (acts.data ?? []) as { id: string; nom: string }[]) if (/^negoce/.test(sansAccents(a.nom))) groupeActivite.set(a.id, "Négoce");
      const rb = new Map<string, ParGroupe>();
      for (const x of realise) {
        if (x.type_affaire !== "CBE") continue;
        const k = String(x.numero).replace(/^0+/, "");
        const g = rb.get(k) ?? groupesVides();
        g[(x.activite_id && groupeActivite.get(x.activite_id)) || "Autre"] += Number(x.heures) || 0;
        rb.set(k, g);
      }
      setRealiseParBase(rb);
      setCouts(new Map(((co.data ?? []) as { annee: number; cout_horaire: number | string }[]).map((c) => [c.annee, Number(c.cout_horaire)])));
      setEstAdmin(Boolean(moi?.estAdmin));
    })()
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger la rentabilité."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const coutExercice = coutHoraire(couts, `${exercice}-11-01`);
  const coutPropre = couts.has(exercice);

  async function enregistrerCout() {
    setErreur("");
    setInfo("");
    const v = Number(coutSaisi.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return setErreur("Coût horaire invalide.");
    const { error } = await supabase.from("indicateurs_couts").upsert({ annee: exercice, cout_horaire: v }, { onConflict: "annee" });
    if (error) return setErreur(error.message);
    setCouts((m) => new Map(m).set(exercice, v));
    setCoutSaisi("");
    setInfo(`Coût horaire de structure ${exercice}-${exercice + 1} : ${v.toLocaleString("fr-FR")} €/h.`);
  }

  const vue = useMemo(() => {
    const debut = `${exercice}-11-01`;
    const fin = `${exercice + 1}-10-31`;
    const affaires: Affaire[] = [];
    const parGroupe = new Map<string, LigneRenta>();
    const ajouter = (cle: string, ca: number, achats: number, hc: number, hr: number, cout: number | null, auMontant: boolean) => {
      const l = parGroupe.get(cle) ?? { cle, libelle: cle, ca: 0, achats: 0, hc: 0, hr: 0, cout: 0, auMontant };
      l.ca += ca;
      l.achats += achats;
      l.hc += hc;
      l.hr += hr;
      l.cout = l.cout === null || cout === null ? null : l.cout + cout;
      parGroupe.set(cle, l);
    };

    for (const a of affairesTerminees(lignesFin)) {
      if (a.date_fin < debut || a.date_fin > fin) continue;
      const base = a.base_affaire.replace(/^0+/, "");
      const rg = realiseParBase.get(base) ?? groupesVides();
      const hr = GROUPES.reduce((t, g) => t + rg[g], 0);
      const hc = GROUPES.reduce((t, g) => t + a.heuresChiffrees[g], 0);
      const c = coutHoraire(couts, a.date_fin);
      const montant = venteAuMontant(a.imputation);
      affaires.push({
        cle: base,
        libelle: `CBE ${base}`,
        base,
        designation: a.designation,
        client: a.client,
        fin: a.date_fin,
        imputation: a.imputation,
        ca: a.montant,
        achats: a.achats,
        hc,
        hr,
        cout: c === null ? null : a.achats + hr * c,
        auMontant: montant,
      });
      if (montant) {
        // négoce / scan pur : l'affaire entière dans sa ligne, heures passées comprises
        ajouter(/^scan/.test(sansAccents(a.imputation)) ? "Scan" : "Négoce", a.montant, a.achats, 0, hr, c === null ? null : a.achats + hr * c, true);
        continue;
      }
      for (const g of GROUPES) {
        if (g === "Négoce") continue;
        if (a.parGroupe[g] === 0 && rg[g] === 0 && a.heuresChiffrees[g] === 0) continue;
        ajouter(g, a.parGroupe[g], 0, a.heuresChiffrees[g], rg[g], c === null ? null : rg[g] * c, false);
      }
      if (a.parGroupe["Négoce"] > 0 || a.achats > 0 || rg["Négoce"] > 0)
        ajouter("Négoce", a.parGroupe["Négoce"], a.achats, 0, rg["Négoce"], c === null ? null : a.achats + rg["Négoce"] * c, true);
    }

    const ordre = [...GROUPES, "Scan"];
    const groupes = [...parGroupe.values()].sort((x, y) => ordre.indexOf(x.cle) - ordre.indexOf(y.cle));
    const total: LigneRenta = {
      cle: "Total",
      libelle: "Total",
      ca: affaires.reduce((t, a) => t + a.ca, 0),
      achats: affaires.reduce((t, a) => t + a.achats, 0),
      hc: affaires.filter((a) => !a.auMontant).reduce((t, a) => t + a.hc, 0),
      hr: affaires.reduce((t, a) => t + a.hr, 0),
      cout: affaires.some((a) => a.cout === null) ? null : affaires.reduce((t, a) => t + (a.cout ?? 0), 0),
      auMontant: false,
    };
    affaires.sort((x, y) => {
      const mx = marge(x);
      const my = marge(y);
      if (mx === null || my === null) return 0;
      return mx / (x.ca || 1) - my / (y.ca || 1);
    });
    return { affaires, groupes, total };
  }, [lignesFin, realiseParBase, couts, exercice]);

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px 6px", textAlign: "center" };
  const td: CSSProperties = { ...page.td, padding: "7px 6px", fontSize: 13, textAlign: "right", whiteSpace: "nowrap" };
  const tdG: CSSProperties = { ...td, textAlign: "left" };

  /* couleur du taux obtenu : sous le coût de structure (perte), sous le taux vendu (dérive), ou bon */
  const couleurObtenu = (l: LigneRenta, coutRef: number | null) => {
    const o = tauxObtenu(l);
    const v = tauxVendu(l);
    if (o === null) return undefined;
    if (coutRef !== null && o < coutRef) return "#b3261e";
    if (v !== null && o < v * 0.95) return "#b35c00";
    return "#1b5e20";
  };

  const ligneTableau = (l: LigneRenta, gras = false, coutRef: number | null = coutExercice) => {
    const m = marge(l);
    return (
      <>
        <td style={{ ...td, fontWeight: gras ? 800 : 400 }}>{euros(l.ca)}</td>
        <td style={td}>{l.achats ? euros(l.achats) : "—"}</td>
        <td style={td}>{l.hc > 0 ? formatHeures(l.hc) : "—"}</td>
        <td style={td}>{l.hr > 0 ? formatHeures(l.hr) : "—"}</td>
        <td style={{ ...td, color: C.gris }}>{l.auMontant ? <span style={{ fontSize: 11 }}>au montant</span> : parHeure(tauxVendu(l))}</td>
        <td style={{ ...td, fontWeight: 800, color: couleurObtenu(l, coutRef) }}>{parHeure(tauxObtenu(l))}</td>
        <td style={td}>{l.cout === null ? "—" : euros(l.cout)}</td>
        <td style={{ ...td, fontWeight: 800, color: m !== null && m < 0 ? C.rougeTexte : undefined }}>{m === null ? "—" : euros(m)}</td>
        <td style={td}>{m === null || l.ca === 0 ? "—" : pct(m / l.ca)}</td>
      </>
    );
  };
  const enTetes = (premiere: string, autres: string[] = []) => (
    <tr>
      <th style={{ ...th, textAlign: "left" }}>{premiere}</th>
      {autres.map((t) => (
        <th key={t} style={{ ...th, textAlign: "left" }}>
          {t}
        </th>
      ))}
      <th style={th}>Prix</th>
      <th style={th}>Achats</th>
      <th style={th} title="Heures chiffrées au devis">H. chiffrées</th>
      <th style={th} title="Heures réellement passées (feuilles d’heures et historique)">H. passées</th>
      <th style={th} title="(prix − achats) ÷ heures chiffrées">Taux vendu</th>
      <th style={th} title="(prix − achats) ÷ heures passées">Taux obtenu</th>
      <th style={th} title="achats + heures passées × coût horaire de structure">Coût</th>
      <th style={th}>Marge</th>
      <th style={th}>Marge %</th>
    </tr>
  );

  const t = vue.total;
  const mTotal = marge(t);

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Rentabilité</h1>
            <p style={page.sousTitre}>
              Les affaires au forfait livrées de l’exercice : ce qu’on pensait gagner par heure (taux vendu), ce qu’on a gagné (taux obtenu), face au coût
              d’une heure (coût de structure).
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
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            {/* ---------- coût horaire de structure ---------- */}
            <section style={{ ...page.carte, padding: 14, marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, borderLeft: `5px solid ${C.rouge}` }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>
                  Coût horaire de structure {exercice}-{exercice + 1}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>
                  {coutExercice === null ? "non saisi" : `${coutExercice.toLocaleString("fr-FR")} €/h`}
                  {coutExercice !== null && !coutPropre && <span style={{ fontSize: 13, fontWeight: 600, color: "#b35c00" }}> (celui d’un autre exercice)</span>}
                </div>
                <div style={{ fontSize: 12, color: C.gris }}>Calculé dans le classeur « Point mort » (onglet Indicateurs) : ce que coûte une heure vendue.</div>
              </div>
              {estAdmin && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  <input
                    value={coutSaisi}
                    onChange={(e) => setCoutSaisi(e.target.value)}
                    placeholder="€/h"
                    inputMode="decimal"
                    aria-label="Coût horaire de structure"
                    style={{ ...page.entrees, width: 110 }}
                  />
                  <button type="button" style={page.btnPrimaire} disabled={!coutSaisi} onClick={() => void enregistrerCout()}>
                    Enregistrer
                  </button>
                </span>
              )}
            </section>

            {coutExercice === null && (
              <Message genre="info">Saisissez le coût horaire de structure pour calculer les coûts et les marges. Les taux vendus et obtenus s’affichent déjà.</Message>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile
                libelle="Affaires livrées"
                valeur={String(vue.affaires.length)}
                sous={`dont ${vue.affaires.filter((a) => a.auMontant).length} de négoce ou de scan · ${euros(t.ca)}`}
              />
              <Tuile
                libelle="Taux horaire obtenu"
                valeur={parHeure(tauxObtenu(t))}
                sous={coutExercice !== null ? `coût de structure ${coutExercice.toLocaleString("fr-FR")} €/h` : "coût de structure non saisi"}
                accent={coutExercice !== null && (tauxObtenu(t) ?? 0) < coutExercice}
              />
              <Tuile
                libelle="Marge"
                valeur={mTotal === null ? "—" : euros(mTotal)}
                sous={mTotal === null ? "coût de structure à saisir" : `${pct(mTotal / (t.ca || 1))} du prix · ${formatHeures(t.hr)} passées`}
                accent={mTotal !== null && mTotal < 0}
              />
              <Tuile
                libelle="Affaires à perte"
                valeur={coutExercice === null ? "—" : String(vue.affaires.filter((a) => (marge(a) ?? 0) < 0).length)}
                sous="marge négative après coût de structure"
                accent={vue.affaires.some((a) => (marge(a) ?? 0) < 0)}
              />
            </div>

            {vue.affaires.length === 0 ? (
              <Message genre="info">Aucune affaire au forfait entièrement livrée sur cet exercice.</Message>
            ) : (
              <>
                <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par activité</h2>
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                    Taux obtenu <span style={{ color: "#1b5e20", fontWeight: 800 }}>vert</span> : au niveau du taux vendu ·{" "}
                    <span style={{ color: "#b35c00", fontWeight: 800 }}>orange</span> : plus bas (heures en plus) ·{" "}
                    <span style={{ color: "#b3261e", fontWeight: 800 }}>rouge</span> : sous le coût de structure (perte). Les achats sont portés par la ligne
                    Négoce ; négoce et scan purs comptent entiers dans leur ligne.
                  </p>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>{enTetes("Activité")}</thead>
                    <tbody>
                      {vue.groupes.map((g) => (
                        <tr key={g.cle}>
                          <td style={{ ...tdG, fontWeight: 800 }}>{g.libelle}</td>
                          {ligneTableau(g)}
                        </tr>
                      ))}
                      <tr style={{ background: "#f8f9fa" }}>
                        <td style={{ ...tdG, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>Total</td>
                        {ligneTableau(t, true)}
                      </tr>
                    </tbody>
                  </table>
                </section>

                <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Affaire par affaire</h2>
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>Les moins rentables d’abord. Cliquez sur une affaire pour ouvrir son bilan.</p>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>{enTetes("Affaire", ["Client", "Livrée le"])}</thead>
                    <tbody>
                      {vue.affaires.map((a) => (
                        <tr key={a.base}>
                          <td style={{ ...tdG, whiteSpace: "normal", minWidth: 180 }}>
                            <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                              CBE {a.base}
                            </Link>{" "}
                            {a.auMontant && <span style={{ fontSize: 11, fontWeight: 700, color: "#b35c00" }}>{a.imputation}</span>}
                            <div style={{ fontSize: 12, color: C.gris }}>{a.designation}</div>
                          </td>
                          <td style={{ ...tdG, fontWeight: 400 }}>{a.client ?? "—"}</td>
                          <td style={{ ...tdG, fontWeight: 400 }}>{formatDate(a.fin)}</td>
                          {ligneTableau(a, false, coutHoraire(couts, a.fin))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Affaires analysées</strong> : les forfaits dont toutes les commandes (base et avenants) sont livrées, à la date de la dernière
                  livraison, dans l’exercice. PE / PI non comprises (vendues au temps passé).
                </li>
                <li>
                  <strong>Prix</strong> : montant des commandes et avenants retenus (Suivi d’affaire BE). <strong>Achats</strong> : achats des commandes et de
                  leurs découpages.
                </li>
                <li>
                  <strong>Taux vendu</strong> = (prix − achats) ÷ heures chiffrées. <strong>Taux obtenu</strong> = (prix − achats) ÷ heures réellement passées
                  (feuilles d’heures et historique, toutes activités).
                </li>
                <li>
                  <strong>Coût</strong> = achats + heures passées × coût horaire de structure de l’exercice de livraison. <strong>Marge</strong> = prix − coût.
                </li>
                <li>
                  <strong>Négoce et scan</strong> (imputation NEGOCE / SCAN) : vendus au montant, sans taux vendu ; leurs heures passées comptent dans leur coût.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function RentabilitePage() {
  return (
    <GardeAcces droit="indicateurs">
      <RentabiliteContenu />
    </GardeAcces>
  );
}
