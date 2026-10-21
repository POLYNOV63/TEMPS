"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";

/* ===============================================================
   FACTURATION DU MOIS (point de fin de mois avec la comptabilité)

   FORFAITS : seules les lignes du Suivi d'affaire BE passées « Livrée »
   avec une date de livraison dans le mois (commande, avenant, échéance,
   lot). Montant : une échéance / un lot pour son montant ; une commande
   ou un avenant pour son montant moins ses échéances / lots (facturés
   chacun à leur livraison).

   PE / PI : seuls les montants du relevé « Prestations PE / PI » du mois.
   Quantité en jours ou en heures selon l'unité de vente, taux, montant
   (figé si le mois est clôturé, sinon celui importé du Suivi des
   prestations, sinon heures × taux). Une PE / PI dont la commande n'est ni
   « Commande reçue » ni « Livrée » est signalée NON FACTURABLE.

   Numéro ARC Louxor et client : colonnes du Suivi d'affaire BE.
================================================================ */

type LigneSuivi = {
  id: string;
  cle: string;
  genre: string;
  parent_cle: string | null;
  base_affaire: string | null;
  numero_affaire: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_id: string | null;
  date_livraison: string | null;
  numero_arc_louxor: string | null;
  disparue: boolean;
};

type LigneForfait = { numero: string; arc: string | null; client: string | null; imputation: string | null; designation: string | null; livraison: string; montant: number };
type LignePrestation = {
  numero: string;
  arc: string | null;
  client: string | null;
  imputation: string | null;
  designation: string | null;
  personne: string;
  unite: "JOUR" | "HEURE";
  quantite: number;
  taux: number | null;
  montant: number;
  statutCommande: string | null;
  facturable: boolean;
  cloture: boolean;
};

const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nombre = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR");
const prestation = (imp: string | null) => imp === "PE" || imp === "PI";
const decaler = (m: string, k: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};

function FacturationContenu() {
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7));
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [suivi, setSuivi] = useState<LigneSuivi[]>([]);
  const [montants, setMontants] = useState<Map<string, { montant: number; echeances: number }>>(new Map());
  const [clients, setClients] = useState<Map<string, string>>(new Map());
  const [prestations, setPrestations] = useState<LignePrestation[]>([]);

  /* Suivi d'affaire BE : chargé une fois */
  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerTout<LigneSuivi>((a, b) =>
        supabase
          .from("suivi_lignes")
          .select("id,cle,genre,parent_cle,base_affaire,numero_affaire,statut,imputation,designation,client_id,date_livraison,numero_arc_louxor,disparue")
          .order("cle")
          .range(a, b)
      ),
      chargerTout<{ ligne_id: string; montant: number | string; montant_echeances: number | string }>((a, b) =>
        supabase.from("suivi_lignes_montants").select("ligne_id,montant,montant_echeances").order("ligne_id").range(a, b)
      ),
      chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
    ])
      .then(([sl, mt, cl]) => {
        if (!actif) return;
        setSuivi(sl);
        setMontants(new Map(mt.map((m) => [m.ligne_id, { montant: Number(m.montant) || 0, echeances: Number(m.montant_echeances) || 0 }])));
        setClients(new Map(cl.map((c) => [c.id, c.nom_abrege])));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    return () => {
      actif = false;
    };
  }, []);

  /* Repères du Suivi d'affaire par n° de commande (« 1604R2 ») et par base */
  const parNumero = useMemo(() => {
    const m = new Map<string, LigneSuivi>();
    for (const l of suivi) if (l.numero_affaire && (l.genre === "BASE" || l.genre === "AVENANT")) m.set(l.numero_affaire.toUpperCase().replace(/^CBE/, ""), l);
    return m;
  }, [suivi]);
  const baseDe = (l: LigneSuivi) => (l.base_affaire ? parNumero.get(l.base_affaire) : undefined) ?? l;

  /* Relevé PE / PI du mois */
  useEffect(() => {
    let actif = true;
    setChargement(true);
    const debut = `${mois}-01`;
    const fin = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).toISOString().slice(0, 10);
    (async () => {
      try {
        const [pm, lp, pa, co, sa] = await Promise.all([
          supabase.from("prestation_mois").select("ligne_id,valide,reporte,report_sortant,hs_refacturer,heures_fige,montant_fige,montant_import").eq("mois", debut),
          supabase.from("prestation_lignes").select("id,affaire_id,collaborateur_id,unite,taux,base_horaire"),
          supabase.from("pilotage_affaires").select("id,numero,statut,imputation,designation"),
          supabase.from("collaborateurs").select("id,trigramme"),
          chargerTout<{ ligne_id: string; heures: number | string | null }>((a, b) =>
            supabase.from("prestation_saisies").select("ligne_id,heures").gte("jour", debut).lte("jour", fin).order("ligne_id").range(a, b)
          ),
        ]);
        for (const r of [pm, lp, pa, co]) if (r.error) throw new Error(r.error.message);
        if (!actif) return;

        const lignesP = new Map(((lp.data ?? []) as { id: string; affaire_id: string; collaborateur_id: string; unite: "JOUR" | "HEURE"; taux: number | null; base_horaire: number }[]).map((l) => [l.id, l]));
        const affaires = new Map(((pa.data ?? []) as { id: string; numero: string; statut: string; imputation: string | null; designation: string }[]).map((a) => [a.id, a]));
        const trig = new Map(((co.data ?? []) as { id: string; trigramme: string | null }[]).map((c) => [c.id, c.trigramme ?? "?"]));
        const heures = new Map<string, number>();
        for (const s of sa) heures.set(s.ligne_id, (heures.get(s.ligne_id) ?? 0) + (Number(s.heures) || 0));
        const moisLignes = new Map(((pm.data ?? []) as { ligne_id: string; valide: boolean; reporte: boolean; report_sortant: number | null; hs_refacturer: number | null; heures_fige: number | null; montant_fige: number | null; montant_import: number | null }[]).map((m) => [m.ligne_id, m]));

        const res: LignePrestation[] = [];
        for (const [id, l] of lignesP) {
          const m = moisLignes.get(id);
          const h0 = heures.get(id) ?? 0;
          if (!m && h0 <= 0) continue;
          const a = affaires.get(l.affaire_id);
          if (!a) continue;
          const tauxH = l.taux === null ? null : l.unite === "JOUR" ? l.taux / (Number(l.base_horaire) || 7) : l.taux;
          const facturees = m?.valide ? Number(m.heures_fige) || 0 : m?.reporte ? 0 : Math.max(0, h0 - (Number(m?.report_sortant) || 0));
          const montant = m?.valide
            ? Number(m.montant_fige) || 0
            : m?.montant_import !== null && m?.montant_import !== undefined
              ? Number(m.montant_import)
              : tauxH === null
                ? 0
                : (facturees + (Number(m?.hs_refacturer) || 0) * 1.25) * tauxH;
          if (montant <= 0.004 && facturees <= 0) continue;
          const sl = parNumero.get(a.numero.toUpperCase());
          const base = sl ? baseDe(sl) : undefined;
          res.push({
            numero: `CBE${a.numero}`,
            arc: sl?.numero_arc_louxor ?? base?.numero_arc_louxor ?? null,
            client: (sl?.client_id ?? base?.client_id) ? clients.get((sl?.client_id ?? base?.client_id) as string) ?? null : null,
            imputation: a.imputation,
            designation: a.designation,
            personne: trig.get(l.collaborateur_id) ?? "?",
            unite: l.unite,
            quantite: l.unite === "JOUR" ? facturees / (Number(l.base_horaire) || 7) : facturees,
            taux: l.taux,
            montant: Math.round(montant * 100) / 100,
            statutCommande: sl?.statut ?? null,
            facturable: a.statut === "EN_COURS" || a.statut === "LIVREE",
            cloture: Boolean(m?.valide),
          });
        }
        res.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }) || x.personne.localeCompare(y.personne));
        setPrestations(res);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Chargement impossible.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [mois, parNumero, clients]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Forfaits livrés dans le mois */
  const forfaits = useMemo(() => {
    const decoupages = new Map<string, number>();
    for (const l of suivi) {
      if ((l.genre !== "ECHEANCE" && l.genre !== "LOT") || !l.parent_cle || l.disparue) continue;
      const m = montants.get(l.id);
      decoupages.set(l.parent_cle, (decoupages.get(l.parent_cle) ?? 0) + ((m?.echeances || m?.montant) ?? 0));
    }
    const res: LigneForfait[] = [];
    for (const l of suivi) {
      if (l.disparue || l.statut !== "Livrée" || !l.date_livraison || !l.date_livraison.startsWith(mois)) continue;
      if (!["BASE", "AVENANT", "ECHEANCE", "LOT"].includes(l.genre)) continue;
      const base = baseDe(l);
      const imputation = base.imputation ?? l.imputation;
      if (prestation(imputation)) continue;
      const m = montants.get(l.id);
      const montant =
        l.genre === "ECHEANCE" || l.genre === "LOT" ? (m?.echeances || m?.montant) ?? 0 : Math.max(0, (m?.montant ?? 0) - (decoupages.get(l.cle) ?? 0));
      if (montant <= 0.004) continue;
      res.push({
        numero: l.genre === "BASE" || l.genre === "AVENANT" ? l.numero_affaire ?? l.cle : l.cle,
        arc: l.numero_arc_louxor ?? base.numero_arc_louxor,
        client: (l.client_id ?? base.client_id) ? clients.get((l.client_id ?? base.client_id) as string) ?? null : null,
        imputation,
        designation: base.designation ?? l.designation,
        livraison: l.date_livraison,
        montant: Math.round(montant * 100) / 100,
      });
    }
    return res.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
  }, [suivi, montants, clients, mois]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalForfaits = forfaits.reduce((t, f) => t + f.montant, 0);
  const totalPrestations = prestations.reduce((t, p) => t + p.montant, 0);
  const nonFacturables = prestations.filter((p) => !p.facturable);
  const libMois = `${NOMS_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;

  function exporter() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        forfaits.map((f) => ({
          "N° CBE": f.numero,
          "N° ARC Louxor": f.arc ?? "",
          Client: f.client ?? "",
          Imputation: f.imputation ?? "",
          Désignation: f.designation ?? "",
          "Livrée le": f.livraison,
          "Montant (€)": f.montant,
        }))
      ),
      "Forfaits"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        prestations.map((p) => ({
          "N° CBE": p.numero,
          "N° ARC Louxor": p.arc ?? "",
          Client: p.client ?? "",
          Imputation: p.imputation ?? "",
          Personne: p.personne,
          Quantité: Math.round(p.quantite * 100) / 100,
          Unité: p.unite === "JOUR" ? "jours" : "heures",
          Taux: p.taux ?? "",
          "Montant (€)": p.montant,
          "Statut commande": p.statutCommande ?? "",
          Facturable: p.facturable ? "oui" : "NON : commande pas reçue",
          "Mois clôturé": p.cloture ? "oui" : "non",
        }))
      ),
      "PE-PI"
    );
    XLSX.writeFile(wb, `Facturation_${mois}.xlsx`);
  }

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap" };
  const thD: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "8px 8px" };
  const tdD: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  return (
    <main style={page.fond}>
      <EnTetePage section="Chiffre d'affaires" />
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={page.titre}>Facturation du mois</h1>
            <p style={page.sousTitre}>
              Pour le point de fin de mois avec la comptabilité : forfaits livrés dans le mois, et PE / PI du relevé.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setMois((m) => decaler(m, -1))} aria-label="Mois précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 140, textAlign: "center" }}>{libMois}</strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setMois((m) => decaler(m, 1))} aria-label="Mois suivant">▶</button>
            <button type="button" style={page.btnPrimaire} onClick={exporter} disabled={chargement}>Exporter en Excel</button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="À facturer" valeur={euros(totalForfaits + totalPrestations)} sous={`${forfaits.length + prestations.length} lignes`} />
              <Tuile libelle="Forfaits livrés" valeur={euros(totalForfaits)} sous={`${forfaits.length} lignes`} />
              <Tuile libelle="PE / PI" valeur={euros(totalPrestations)} sous={`${prestations.length} lignes`} />
              <Tuile
                libelle="Non facturable"
                valeur={euros(nonFacturables.reduce((t, p) => t + p.montant, 0))}
                sous={`${nonFacturables.length} PE / PI sans commande reçue`}
                accent={nonFacturables.length > 0}
              />
            </div>

            {nonFacturables.length > 0 && (
              <Message genre="erreur">
                <strong>Attention :</strong> {nonFacturables.map((p) => p.numero).filter((v, i, t) => t.indexOf(v) === i).join(", ")} — commande ni
                « reçue » ni « livrée » dans le Suivi d’affaire BE : <strong>impossible de facturer</strong> en l’état. Ces lignes sont surlignées en
                jaune.
              </Message>
            )}

            <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Forfaits livrés en {libMois}</h2>
              {forfaits.length === 0 ? (
                <p style={{ color: C.gris }}>Aucun forfait livré ce mois-ci.</p>
              ) : (
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={th}>N° CBE</th>
                      <th style={th}>N° ARC Louxor</th>
                      <th style={th}>Client</th>
                      <th style={th}>Imputation</th>
                      <th style={th}>Désignation</th>
                      <th style={th}>Livrée le</th>
                      <th style={thD}>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forfaits.map((f) => (
                      <tr key={f.numero}>
                        <td style={{ ...td, fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>{f.numero}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{f.arc ?? <span style={{ color: "#a33a3a" }}>manquant</span>}</td>
                        <td style={td}>{f.client ?? "—"}</td>
                        <td style={td}>{f.imputation ?? "—"}</td>
                        <td style={td}>{f.designation}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(`${f.livraison}T00:00:00`).toLocaleDateString("fr-FR")}</td>
                        <td style={{ ...tdD, fontWeight: 800 }}>{euros(f.montant)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={6} style={{ ...td, fontWeight: 800, textAlign: "right" }}>Total forfaits</td>
                      <td style={{ ...tdD, fontWeight: 800 }}>{euros(totalForfaits)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>

            <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>
                PE / PI de {libMois}{" "}
                <Link href="/pilotage/prestations" style={{ fontSize: 14, fontWeight: 700, color: C.rougeFonce }}>ouvrir le relevé →</Link>
              </h2>
              {prestations.length === 0 ? (
                <p style={{ color: C.gris }}>Aucune heure au relevé ce mois-ci.</p>
              ) : (
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={th}>N° CBE</th>
                      <th style={th}>N° ARC Louxor</th>
                      <th style={th}>Client</th>
                      <th style={th}>Imputation</th>
                      <th style={th}>Pers.</th>
                      <th style={thD}>Quantité</th>
                      <th style={thD}>Taux</th>
                      <th style={thD}>Montant</th>
                      <th style={th}>Commande</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prestations.map((p, i) => (
                      <tr key={i} style={p.facturable ? undefined : { background: "#fff7c2" }}>
                        <td style={{ ...td, fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>
                          <span style={p.facturable ? undefined : { background: "#ffe94d", padding: "0 4px", borderRadius: 3 }}>{p.numero}</span>
                        </td>
                        <td style={{ ...td, fontWeight: 700 }}>{p.arc ?? <span style={{ color: "#a33a3a" }}>manquant</span>}</td>
                        <td style={td}>{p.client ?? "—"}</td>
                        <td style={td}>{p.imputation ?? "—"}</td>
                        <td style={{ ...td, fontWeight: 800 }}>{p.personne}</td>
                        <td style={tdD}>
                          {nombre(p.quantite)} {p.unite === "JOUR" ? "j" : "h"}
                        </td>
                        <td style={tdD}>{p.taux !== null ? `${nombre(p.taux)} €/${p.unite === "JOUR" ? "j" : "h"}` : "—"}</td>
                        <td style={{ ...tdD, fontWeight: 800 }}>
                          {euros(p.montant)}
                          {p.cloture && <span title="Mois clôturé : montant figé"> 🔒</span>}
                        </td>
                        <td style={{ ...td, fontWeight: p.facturable ? 400 : 800, color: p.facturable ? undefined : "#7a3e00" }}>
                          {p.facturable ? p.statutCommande ?? "—" : `⚠ ${p.statutCommande ?? "pas de commande"} — non facturable`}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={7} style={{ ...td, fontWeight: 800, textAlign: "right" }}>Total PE / PI</td>
                      <td style={{ ...tdD, fontWeight: 800 }}>{euros(totalPrestations)}</td>
                      <td style={td} />
                    </tr>
                  </tbody>
                </table>
              )}
            </section>

            <p style={{ fontSize: 13, color: C.gris, marginTop: 12, lineHeight: 1.5 }}>
              Forfaits : lignes « Livrée » du Suivi d’affaire BE dont la date de livraison tombe dans le mois ; une commande avec échéances n’est
              facturée que pour sa part non découpée, chaque échéance l’est à sa propre livraison. PE / PI : montants du relevé du mois (figés 🔒 si
              le mois est clôturé, sinon ceux importés du Suivi des prestations, sinon heures × taux).
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function FacturationPage() {
  return (
    <GardeAcces droit="indicateurs">
      <FacturationContenu />
    </GardeAcces>
  );
}
