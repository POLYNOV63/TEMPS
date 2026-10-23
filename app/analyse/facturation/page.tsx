"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { exporterExcelPolynov } from "@/lib/excelPolynov";

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

   Numéro ARC Louxor, client et STATUT : colonnes du Suivi d'affaire BE.
   Alerte quand le n° Louxor manque sur une commande reçue ou livrée.
   Les totaux « à facturer » N'INCLUENT PAS les lignes non facturables
   (affichées à part). Colonnes triables ; export Excel mis en page.
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

type LigneForfait = {
  numero: string;
  arc: string | null;
  client: string | null;
  imputation: string | null;
  designation: string | null;
  livraison: string;
  montant: number;
  statut: string | null; // statut de la ligne dans le Suivi d'affaire BE
  statutBase: string | null; // statut de la commande de base (si différent : échéance, avenant)
};
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
        statut: l.statut,
        statutBase: base !== l ? base.statut : null,
      });
    }
    return res.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
  }, [suivi, montants, clients, mois]); // eslint-disable-line react-hooks/exhaustive-deps

  /* N° Louxor attendu dès que la commande est reçue ou livrée */
  const louxorManquant = (statut: string | null, arc: string | null) =>
    !arc?.trim() && (statut === "Commande reçue" || statut === "Livrée");

  /* tri des colonnes (clic sur l'en-tête) */
  const [triF, setTriF] = useState<{ cle: string; sens: 1 | -1 }>({ cle: "numero", sens: 1 });
  const [triP, setTriP] = useState<{ cle: string; sens: 1 | -1 }>({ cle: "numero", sens: 1 });
  const trier = <T,>(liste: T[], tri: { cle: string; sens: 1 | -1 }) =>
    [...liste].sort((a, b) => {
      const va = (a as Record<string, unknown>)[tri.cle];
      const vb = (b as Record<string, unknown>)[tri.cle];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * tri.sens;
      return String(va ?? "").localeCompare(String(vb ?? ""), "fr", { numeric: true }) * tri.sens;
    });
  const forfaitsTries = useMemo(() => trier(forfaits, triF), [forfaits, triF]); // eslint-disable-line react-hooks/exhaustive-deps
  const prestationsTriees = useMemo(() => trier(prestations, triP), [prestations, triP]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalForfaits = forfaits.reduce((t, f) => t + f.montant, 0);
  const nonFacturables = prestations.filter((p) => !p.facturable);
  const totalNonFacturable = nonFacturables.reduce((t, p) => t + p.montant, 0);
  // le total « à facturer » des PE / PI N'INCLUT PAS les lignes non facturables
  const totalPrestations = prestations.filter((p) => p.facturable).reduce((t, p) => t + p.montant, 0);
  const sansLouxor = [
    ...forfaits.filter((f) => louxorManquant(f.statut, f.arc)).map((f) => f.numero),
    ...prestations.filter((p) => louxorManquant(p.statutCommande, p.arc)).map((p) => p.numero),
  ].filter((v, i, t) => t.indexOf(v) === i);
  const libMois = `${NOMS_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;

  async function exporter() {
    const statutF = (f: LigneForfait) => (f.statutBase && f.statutBase !== f.statut ? `${f.statut} (commande : ${f.statutBase})` : f.statut ?? "");
    await exporterExcelPolynov(`Facturation_${mois}`, [
      {
        nom: "Forfaits",
        titre: `Facturation ${libMois} — forfaits livrés`,
        sousTitre: "Lignes « Livrée » du Suivi d'affaire BE dont la date de livraison tombe dans le mois. En jaune : n° ARC Louxor manquant.",
        colonnes: [
          { titre: "N° CBE", cle: "numero", largeur: 14 },
          { titre: "N° ARC Louxor", cle: "arc", largeur: 16 },
          { titre: "Client", cle: "client", largeur: 18 },
          { titre: "Imputation", cle: "imputation", largeur: 12 },
          { titre: "Désignation", cle: "designation", largeur: 40 },
          { titre: "Statut Suivi d'affaire", cle: "statut", largeur: 26 },
          { titre: "Livrée le", cle: "livraison", format: "date", largeur: 12 },
          { titre: "Montant", cle: "montant", format: "euros", largeur: 15, total: true },
          { titre: "Alerte", cle: "alerte", largeur: 26 },
        ],
        lignes: forfaitsTries.map((f) => ({
          ...f,
          statut: statutF(f),
          alerte: louxorManquant(f.statut, f.arc) ? "N° Louxor manquant" : "",
        })),
        alerte: (l) => l.alerte !== "",
        libelleTotal: "Total forfaits",
      },
      {
        nom: "PE-PI",
        titre: `Facturation ${libMois} — PE / PI du relevé`,
        sousTitre: "Le total ne compte QUE les lignes facturables. En jaune : non facturable (commande ni reçue ni livrée) ou n° Louxor manquant.",
        colonnes: [
          { titre: "N° CBE", cle: "numero", largeur: 14 },
          { titre: "N° ARC Louxor", cle: "arc", largeur: 16 },
          { titre: "Client", cle: "client", largeur: 18 },
          { titre: "Imputation", cle: "imputation", largeur: 12 },
          { titre: "Personne", cle: "personne", largeur: 10 },
          { titre: "Quantité", cle: "quantite", format: "nombre", largeur: 10 },
          { titre: "Unité", cle: "unite", largeur: 8 },
          { titre: "Taux", cle: "taux", format: "euros", largeur: 12 },
          { titre: "Montant facturable", cle: "montantFacturable", format: "euros", largeur: 17, total: true },
          { titre: "Montant non facturable", cle: "montantNon", format: "euros", largeur: 18, total: true },
          { titre: "Statut Suivi d'affaire", cle: "statut", largeur: 22 },
          { titre: "Mois clôturé", cle: "cloture", largeur: 12 },
          { titre: "Alerte", cle: "alerte", largeur: 34 },
        ],
        lignes: prestationsTriees.map((p) => ({
          numero: p.numero,
          arc: p.arc,
          client: p.client,
          imputation: p.imputation,
          personne: p.personne,
          quantite: Math.round(p.quantite * 100) / 100,
          unite: p.unite === "JOUR" ? "jours" : "heures",
          taux: p.taux,
          montantFacturable: p.facturable ? p.montant : null,
          montantNon: p.facturable ? null : p.montant,
          statut: p.statutCommande ?? "pas de commande",
          cloture: p.cloture ? "oui" : "non",
          alerte: [p.facturable ? "" : "NON FACTURABLE", louxorManquant(p.statutCommande, p.arc) ? "N° Louxor manquant" : ""].filter(Boolean).join(" · "),
        })),
        alerte: (l) => l.alerte !== "",
        libelleTotal: "Totaux",
      },
      {
        nom: "Synthèse",
        titre: `Facturation ${libMois} — synthèse`,
        colonnes: [
          { titre: "Poste", cle: "poste", largeur: 46 },
          { titre: "Montant", cle: "montant", format: "euros", largeur: 16 },
          { titre: "Lignes", cle: "lignes", format: "nombre", largeur: 10 },
        ],
        lignes: [
          { poste: "Forfaits livrés", montant: totalForfaits, lignes: forfaits.length },
          { poste: "PE / PI facturables", montant: totalPrestations, lignes: prestations.length - nonFacturables.length },
          { poste: "TOTAL À FACTURER (hors non facturable)", montant: totalForfaits + totalPrestations, lignes: forfaits.length + prestations.length - nonFacturables.length },
          { poste: "Non facturable (NON compté dans le total)", montant: totalNonFacturable, lignes: nonFacturables.length },
        ],
        alerte: (l) => String(l.poste).startsWith("Non facturable") && Number(l.montant) > 0,
        notes: sansLouxor.length > 0 ? [`N° ARC Louxor manquant (commande reçue ou livrée) : ${sansLouxor.join(", ")}`] : [],
      },
    ]);
  }

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap" };
  const thD: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "8px 8px" };
  const tdD: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const EnteteTri = ({ cle, libelle, tri, setTri, droite }: { cle: string; libelle: string; tri: { cle: string; sens: 1 | -1 }; setTri: (t: { cle: string; sens: 1 | -1 }) => void; droite?: boolean }) => (
    <th style={droite ? thD : th} aria-sort={tri.cle === cle ? (tri.sens === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => setTri({ cle, sens: tri.cle === cle ? (tri.sens === 1 ? -1 : 1) : 1 })}
        title="Trier"
        style={{ all: "unset", cursor: "pointer", fontWeight: 800 }}
      >
        {libelle} <span style={{ color: tri.cle === cle ? C.rouge : "#b3b9c0" }}>{tri.cle === cle ? (tri.sens === 1 ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
  const celluleLouxor = (arc: string | null, statut: string | null) =>
    arc ? arc : louxorManquant(statut, arc) ? <span style={{ color: "#b3261e", fontWeight: 800 }}>⚠ manquant</span> : <span style={{ color: C.gris }}>—</span>;

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
            <button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="À facturer" valeur={euros(totalForfaits + totalPrestations)} sous="forfaits + PE / PI facturables · sans le non facturable" />
              <Tuile libelle="Forfaits livrés" valeur={euros(totalForfaits)} sous={`${forfaits.length} lignes`} />
              <Tuile libelle="PE / PI facturables" valeur={euros(totalPrestations)} sous={`${prestations.length - nonFacturables.length} lignes`} />
              <Tuile
                libelle="Non facturable"
                valeur={euros(totalNonFacturable)}
                sous={`${nonFacturables.length} PE / PI · NON compté dans « À facturer »`}
                accent={nonFacturables.length > 0}
              />
            </div>

            {sansLouxor.length > 0 && (
              <Message genre="erreur">
                <strong>N° ARC Louxor manquant</strong> alors que la commande est reçue ou livrée : {sansLouxor.join(", ")}. À renseigner dans le Suivi
                d’affaire BE avant de facturer.
              </Message>
            )}

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
                      <EnteteTri cle="numero" libelle="N° CBE" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="arc" libelle="N° ARC Louxor" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="client" libelle="Client" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="imputation" libelle="Imputation" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="designation" libelle="Désignation" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="statut" libelle="Statut Suivi d’affaire" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="livraison" libelle="Livrée le" tri={triF} setTri={setTriF} />
                      <EnteteTri cle="montant" libelle="Montant" tri={triF} setTri={setTriF} droite />
                    </tr>
                  </thead>
                  <tbody>
                    {forfaitsTries.map((f) => (
                      <tr key={f.numero} style={louxorManquant(f.statut, f.arc) ? { background: "#fff7c2" } : undefined}>
                        <td style={{ ...td, fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>{f.numero}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{celluleLouxor(f.arc, f.statut)}</td>
                        <td style={td}>{f.client ?? "—"}</td>
                        <td style={td}>{f.imputation ?? "—"}</td>
                        <td style={td}>{f.designation}</td>
                        <td style={td}>
                          {f.statut ?? "—"}
                          {f.statutBase && f.statutBase !== f.statut && <div style={{ fontSize: 12, color: C.gris }}>commande : {f.statutBase}</div>}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{new Date(`${f.livraison}T00:00:00`).toLocaleDateString("fr-FR")}</td>
                        <td style={{ ...tdD, fontWeight: 800 }}>{euros(f.montant)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={7} style={{ ...td, fontWeight: 800, textAlign: "right" }}>Total forfaits</td>
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
                      <EnteteTri cle="numero" libelle="N° CBE" tri={triP} setTri={setTriP} />
                      <EnteteTri cle="arc" libelle="N° ARC Louxor" tri={triP} setTri={setTriP} />
                      <EnteteTri cle="client" libelle="Client" tri={triP} setTri={setTriP} />
                      <EnteteTri cle="imputation" libelle="Imputation" tri={triP} setTri={setTriP} />
                      <EnteteTri cle="personne" libelle="Pers." tri={triP} setTri={setTriP} />
                      <EnteteTri cle="quantite" libelle="Quantité" tri={triP} setTri={setTriP} droite />
                      <EnteteTri cle="taux" libelle="Taux" tri={triP} setTri={setTriP} droite />
                      <EnteteTri cle="montant" libelle="Montant" tri={triP} setTri={setTriP} droite />
                      <EnteteTri cle="statutCommande" libelle="Statut Suivi d’affaire" tri={triP} setTri={setTriP} />
                    </tr>
                  </thead>
                  <tbody>
                    {prestationsTriees.map((p, i) => (
                      <tr key={i} style={p.facturable && !louxorManquant(p.statutCommande, p.arc) ? undefined : { background: "#fff7c2" }}>
                        <td style={{ ...td, fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>
                          <span style={p.facturable ? undefined : { background: "#ffe94d", padding: "0 4px", borderRadius: 3 }}>{p.numero}</span>
                        </td>
                        <td style={{ ...td, fontWeight: 700 }}>{celluleLouxor(p.arc, p.statutCommande)}</td>
                        <td style={td}>{p.client ?? "—"}</td>
                        <td style={td}>{p.imputation ?? "—"}</td>
                        <td style={{ ...td, fontWeight: 800 }}>{p.personne}</td>
                        <td style={tdD}>
                          {nombre(p.quantite)} {p.unite === "JOUR" ? "j" : "h"}
                        </td>
                        <td style={tdD}>{p.taux !== null ? `${nombre(p.taux)} €/${p.unite === "JOUR" ? "j" : "h"}` : "—"}</td>
                        <td style={{ ...tdD, fontWeight: 800 }}>
                          <span style={p.facturable ? undefined : { textDecoration: "line-through", color: C.gris }} title={p.facturable ? undefined : "Non compté dans le total à facturer"}>
                            {euros(p.montant)}
                          </span>
                          {p.cloture && <span title="Mois clôturé : montant figé"> 🔒</span>}
                        </td>
                        <td style={{ ...td, fontWeight: p.facturable ? 400 : 800, color: p.facturable ? undefined : "#7a3e00" }}>
                          {p.facturable ? p.statutCommande ?? "—" : `⚠ ${p.statutCommande ?? "pas de commande"} — non facturable`}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={7} style={{ ...td, fontWeight: 800, textAlign: "right" }}>Total PE / PI facturable</td>
                      <td style={{ ...tdD, fontWeight: 800 }}>{euros(totalPrestations)}</td>
                      <td style={td} />
                    </tr>
                    {nonFacturables.length > 0 && (
                      <tr>
                        <td colSpan={7} style={{ ...td, textAlign: "right", color: "#7a3e00" }}>Non facturable — NON compté ci-dessus</td>
                        <td style={{ ...tdD, color: "#7a3e00", textDecoration: "line-through" }}>{euros(totalNonFacturable)}</td>
                        <td style={td} />
                      </tr>
                    )}
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
