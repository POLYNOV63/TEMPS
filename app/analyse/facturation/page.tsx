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
   PRÉVU : les commandes reçues (et intentions) pas encore livrées, attendues
   dans le mois d'après la date de livraison estimée du Suivi d'affaire BE
   (même règle que le CA attendu de Finances), affichées en bleu, à part
   du total « à facturer » ; « Prévisionnel du mois » = les deux.
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
  date_livraison_estimee: string | null;
  numero_arc_louxor: string | null;
  base_devis: string | null;
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
  dbe: string | null;
  /* PREVU_DU_MOIS : commande reçue / intention pas encore livrée, attendue ce mois-ci
     (date de livraison estimée du Suivi d'affaire BE ; déjà dépassée = comptée au mois en cours) */
  prevu: boolean;
  retard: boolean;
};
type LignePrestation = {
  numero: string;
  arc: string | null;
  dbe: string | null;
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
/* « 2603 » ou « DBE2603 » -> « DBE2603 » */
const numeroDbe = (v: string | null | undefined) => {
  const m = String(v ?? "").toUpperCase().replace(/\s/g, "").match(/^(?:DBE)?(\d.*)$/);
  return m ? `DBE${m[1]}` : null;
};

/* une ligne du tableau unique : forfait livré ou PE / PI du relevé */
type LigneFacturation = {
  type: "Forfait" | "Forfait prévu" | "PE / PI";
  prevu: boolean;
  retard: boolean;
  client: string;
  numero: string;
  dbe: string;
  arc: string;
  imputation: string;
  designation: string;
  personne: string;
  quantite: number | null;
  unite: string;
  taux: number | null;
  livraison: string;
  montant: number;
  statut: string;
  statutBase: string;
  facturable: boolean;
  cloture: boolean;
  alerteLouxor: boolean;
};
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
          .select("id,cle,genre,parent_cle,base_affaire,numero_affaire,statut,imputation,designation,client_id,date_livraison,date_livraison_estimee,numero_arc_louxor,base_devis,disparue")
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
            // n° Louxor de LA commande (base ou avenant) : jamais repris d'une autre ligne
            arc: sl?.numero_arc_louxor?.trim() || null,
            dbe: numeroDbe(sl?.base_devis ?? base?.base_devis),
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
    const moisCourant = new Date().toISOString().slice(0, 7);
    const enAttente = (l: LigneSuivi) => l.statut === "Commande reçue" || l.statut === "Intention de commande";
    // ce que les découpages d'une commande couvrent déjà : livrés, ou attendus à leur propre date
    const couverts = new Map<string, number>();
    for (const l of suivi) {
      if ((l.genre !== "ECHEANCE" && l.genre !== "LOT") || !l.parent_cle || l.disparue) continue;
      if (l.statut !== "Livrée" && !(enAttente(l) && l.date_livraison_estimee)) continue;
      const m = montants.get(l.id);
      couverts.set(l.parent_cle, (couverts.get(l.parent_cle) ?? 0) + ((m?.echeances || m?.montant) ?? 0));
    }
    for (const l of suivi) {
      if (l.disparue || !["BASE", "AVENANT", "ECHEANCE", "LOT"].includes(l.genre)) continue;
      // prévu : pas encore livré, attendu ce mois-ci d'après la date de livraison estimée
      if (enAttente(l)) {
        const d = l.date_livraison_estimee;
        const retard = Boolean(d && d.slice(0, 7) < moisCourant && mois === moisCourant);
        if (!d || !(d.startsWith(mois) || retard)) continue;
        const baseP = baseDe(l);
        const imputationP = baseP.imputation ?? l.imputation;
        if (prestation(imputationP)) continue;
        const mp = montants.get(l.id);
        const montantP =
          l.genre === "ECHEANCE" || l.genre === "LOT" ? (mp?.echeances || mp?.montant) ?? 0 : Math.max(0, (mp?.montant ?? 0) - (couverts.get(l.cle) ?? 0));
        if (montantP <= 0.004) continue;
        res.push({
          numero: l.genre === "BASE" || l.genre === "AVENANT" ? l.numero_affaire ?? l.cle : l.cle,
          arc: l.numero_arc_louxor?.trim() || null,
          dbe: numeroDbe(l.base_devis ?? baseP.base_devis),
          client: (l.client_id ?? baseP.client_id) ? clients.get((l.client_id ?? baseP.client_id) as string) ?? null : null,
          imputation: imputationP,
          designation: baseP.designation ?? l.designation,
          livraison: d,
          montant: Math.round(montantP * 100) / 100,
          statut: l.statut,
          statutBase: baseP !== l ? baseP.statut : null,
          prevu: true,
          retard,
        });
        continue;
      }
      if (l.statut !== "Livrée" || !l.date_livraison || !l.date_livraison.startsWith(mois)) continue;
      const base = baseDe(l);
      const imputation = base.imputation ?? l.imputation;
      if (prestation(imputation)) continue;
      const m = montants.get(l.id);
      const montant =
        l.genre === "ECHEANCE" || l.genre === "LOT" ? (m?.echeances || m?.montant) ?? 0 : Math.max(0, (m?.montant ?? 0) - (decoupages.get(l.cle) ?? 0));
      if (montant <= 0.004) continue;
      res.push({
        numero: l.genre === "BASE" || l.genre === "AVENANT" ? l.numero_affaire ?? l.cle : l.cle,
        // n° Louxor de cette ligne seulement (un avenant / une échéance sans n° reste sans n°)
        arc: l.numero_arc_louxor?.trim() || null,
        dbe: numeroDbe(l.base_devis ?? base.base_devis),
        client: (l.client_id ?? base.client_id) ? clients.get((l.client_id ?? base.client_id) as string) ?? null : null,
        imputation,
        designation: base.designation ?? l.designation,
        livraison: l.date_livraison,
        montant: Math.round(montant * 100) / 100,
        statut: l.statut,
        statutBase: base !== l ? base.statut : null,
        prevu: false,
        retard: false,
      });
    }
    return res.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
  }, [suivi, montants, clients, mois]); // eslint-disable-line react-hooks/exhaustive-deps

  /* N° Louxor attendu dès que la commande est reçue ou livrée */
  const louxorManquant = (statut: string | null, arc: string | null) =>
    !arc?.trim() && (statut === "Commande reçue" || statut === "Livrée");

  /* un seul tableau : forfaits et PE / PI, trié par client (puis n°) par défaut */
  const lignes = useMemo<LigneFacturation[]>(
    () => [
      ...forfaits.map((f) => ({
        type: f.prevu ? ("Forfait prévu" as const) : ("Forfait" as const),
        prevu: f.prevu,
        retard: f.retard,
        client: f.client ?? "",
        numero: f.numero,
        dbe: f.dbe ?? "",
        arc: f.arc ?? "",
        imputation: f.imputation ?? "",
        designation: f.designation ?? "",
        personne: "",
        quantite: null,
        unite: "",
        taux: null,
        livraison: f.livraison,
        montant: f.montant,
        statut: f.statut ?? "",
        statutBase: f.statutBase && f.statutBase !== f.statut ? f.statutBase : "",
        facturable: true,
        cloture: false,
        alerteLouxor: louxorManquant(f.statut, f.arc),
      })),
      ...prestations.map((p) => ({
        type: "PE / PI" as const,
        prevu: false,
        retard: false,
        client: p.client ?? "",
        numero: p.numero,
        dbe: p.dbe ?? "",
        arc: p.arc ?? "",
        imputation: p.imputation ?? "",
        designation: p.designation ?? "",
        personne: p.personne,
        quantite: Math.round(p.quantite * 100) / 100,
        unite: p.unite === "JOUR" ? "j" : "h",
        taux: p.taux,
        livraison: "",
        montant: p.montant,
        statut: p.statutCommande ?? "pas de commande",
        statutBase: "",
        facturable: p.facturable,
        cloture: p.cloture,
        alerteLouxor: louxorManquant(p.statutCommande, p.arc),
      })),
    ],
    [forfaits, prestations] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [tri, setTri] = useState<{ cle: keyof LigneFacturation; sens: 1 | -1 }>({ cle: "client", sens: 1 });
  const lignesTriees = useMemo(
    () =>
      [...lignes].sort((a, b) => {
        const va = a[tri.cle];
        const vb = b[tri.cle];
        const r =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va ?? "").localeCompare(String(vb ?? ""), "fr", { numeric: true, sensitivity: "base" });
        // à égalité : par n° d'affaire
        return r * tri.sens || a.numero.localeCompare(b.numero, "fr", { numeric: true });
      }),
    [lignes, tri]
  );

  const forfaitsLivres = forfaits.filter((f) => !f.prevu);
  const forfaitsPrevus = forfaits.filter((f) => f.prevu);
  const totalForfaits = forfaitsLivres.reduce((t, f) => t + f.montant, 0);
  const totalPrevu = forfaitsPrevus.reduce((t, f) => t + f.montant, 0);
  /* TROIS_CHIFFRES : total facturable du mois, déjà facturé, reste à facturer
     - facturé : forfaits livrés + PE / PI facturables dont le mois est clôturé (« Clôturer le mois (facturé) ») ;
     - reste : forfaits prévus (pas encore livrés) + PE / PI facturables pas encore clôturés ;
     - le non facturable n'entre dans aucun des trois (affiché à part) */
  const peFacturables = prestations.filter((p) => p.facturable);
  const totalPeClotures = peFacturables.filter((p) => p.cloture).reduce((t, p) => t + p.montant, 0);
  const totalFacture = totalForfaits + totalPeClotures;
  const totalFacturable = totalForfaits + totalPrevu + peFacturables.reduce((t, p) => t + p.montant, 0);
  const resteAFacturer = totalFacturable - totalFacture;
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
    await exporterExcelPolynov(`Facturation_${mois}`, [
      {
        nom: "Facturation",
        titre: `Facturation ${libMois}`,
        sousTitre:
          "Forfaits livrés dans le mois et PE / PI du relevé. Le total « facturable » n'inclut PAS les lignes non facturables. En jaune : non facturable ou n° ARC Louxor manquant.",
        colonnes: [
          { titre: "Client", cle: "client", largeur: 18 },
          { titre: "N° CBE", cle: "numero", largeur: 13 },
          { titre: "N° DBE", cle: "dbe", largeur: 11 },
          { titre: "N° ARC Louxor", cle: "arc", largeur: 15 },
          { titre: "Type", cle: "type", largeur: 9 },
          { titre: "Désignation", cle: "designation", largeur: 36 },
          { titre: "Pers.", cle: "personne", largeur: 7 },
          { titre: "Quantité", cle: "quantiteTexte", largeur: 10 },
          { titre: "Taux", cle: "taux", format: "euros", largeur: 11 },
          { titre: "Livrée le", cle: "livraison", format: "date", largeur: 11 },
          { titre: "Statut Suivi d'affaire", cle: "statutTexte", largeur: 24 },
          { titre: "Montant facturable", cle: "montantFacturable", format: "euros", largeur: 16, total: true },
          { titre: "Prévu (pas encore livré)", cle: "montantPrevu", format: "euros", largeur: 16, total: true },
          { titre: "Non facturable", cle: "montantNon", format: "euros", largeur: 14, total: true },
          { titre: "Alerte", cle: "alerte", largeur: 30 },
        ],
        lignes: lignesTriees.map((l) => ({
          client: l.client,
          numero: l.numero,
          dbe: l.dbe,
          arc: l.arc,
          type: l.type,
          imputation: l.imputation,
          designation: l.designation,
          personne: l.personne,
          quantiteTexte: l.quantite === null ? "" : `${String(l.quantite).replace(".", ",")} ${l.unite}`,
          taux: l.taux,
          livraison: l.livraison,
          statutTexte: l.statutBase ? `${l.statut} (commande : ${l.statutBase})` : l.statut,
          montantFacturable: l.facturable && !l.prevu ? l.montant : null,
          montantPrevu: l.prevu ? l.montant : null,
          montantNon: l.facturable ? null : l.montant,
          alerte: [l.facturable ? "" : "NON FACTURABLE", l.alerteLouxor ? "N° Louxor manquant" : ""].filter(Boolean).join(" · "),
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
          { poste: "TOTAL FACTURABLE (forfaits livrés et prévus + PE / PI facturables)", montant: totalFacturable, lignes: forfaits.length + peFacturables.length },
          { poste: "Facturé (forfaits livrés + PE / PI des mois clôturés)", montant: totalFacture, lignes: forfaitsLivres.length + peFacturables.filter((p) => p.cloture).length },
          { poste: "RESTE À FACTURER (forfaits prévus + PE / PI non clôturés)", montant: resteAFacturer, lignes: forfaitsPrevus.length + peFacturables.filter((p) => !p.cloture).length },
          { poste: "Non facturable (compté nulle part)", montant: totalNonFacturable, lignes: nonFacturables.length },
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
  const EnteteTri = ({ cle, libelle, droite }: { cle: keyof LigneFacturation; libelle: string; droite?: boolean }) => (
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Total facturable" valeur={euros(totalFacturable)} sous="forfaits livrés et prévus + PE / PI facturables du mois" />
              <Tuile libelle="Facturé" valeur={euros(totalFacture)} sous="forfaits livrés + PE / PI des mois clôturés" />
              <Tuile libelle="Reste à facturer" valeur={euros(resteAFacturer)} sous="forfaits prévus + PE / PI non clôturés" accent={resteAFacturer > 0.5} />
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

            <section style={{ ...page.carte, padding: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>
                À facturer en {libMois}{" "}
                <Link href="/pilotage/prestations" style={{ fontSize: 14, fontWeight: 700, color: C.rougeFonce }}>ouvrir le relevé PE / PI →</Link>
              </h2>
              {lignes.length === 0 ? (
                <p style={{ color: C.gris }}>Rien à facturer ce mois-ci.</p>
              ) : (
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                  <thead>
                    <tr>
                      <EnteteTri cle="client" libelle="Client" />
                      <EnteteTri cle="numero" libelle="N° CBE" />
                      <EnteteTri cle="dbe" libelle="N° DBE" />
                      <EnteteTri cle="arc" libelle="N° ARC Louxor" />
                      <EnteteTri cle="type" libelle="Type" />
                      <EnteteTri cle="designation" libelle="Désignation" />
                      <EnteteTri cle="personne" libelle="Pers." />
                      <EnteteTri cle="quantite" libelle="Quantité" droite />
                      <EnteteTri cle="taux" libelle="Taux" droite />
                      <EnteteTri cle="livraison" libelle="Livrée le" />
                      <EnteteTri cle="statut" libelle="Statut Suivi d’affaire" />
                      <EnteteTri cle="montant" libelle="Montant" droite />
                    </tr>
                  </thead>
                  <tbody>
                    {lignesTriees.map((l, i) => (
                      <tr key={`${l.type}-${l.numero}-${l.personne}-${i}`} style={!l.facturable || l.alerteLouxor ? { background: "#fff7c2" } : l.prevu ? { background: "#f3f7ff", fontStyle: "italic" } : undefined}>
                        <td style={{ ...td, fontWeight: 700 }}>{l.client || "—"}</td>
                        <td style={{ ...td, fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>{l.numero}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{l.dbe || "—"}</td>
                        <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{celluleLouxor(l.arc || null, l.statut)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", color: C.gris }}>{l.type}</td>
                        <td style={{ ...td, maxWidth: 240, fontSize: 13 }}>{l.designation}</td>
                        <td style={{ ...td, fontWeight: 800 }}>{l.personne}</td>
                        <td style={tdD}>{l.quantite === null ? "" : `${nombre(l.quantite)} ${l.unite}`}</td>
                        <td style={tdD}>{l.taux !== null ? `${nombre(l.taux)} €/${l.unite}` : ""}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {l.livraison ? new Date(`${l.livraison}T00:00:00`).toLocaleDateString("fr-FR") : ""}
                          {l.prevu && <div style={{ fontSize: 11, color: l.retard ? "#b3261e" : "#2455a4", fontStyle: "normal", fontWeight: 700 }}>{l.retard ? "estimée, dépassée" : "estimée"}</div>}
                        </td>
                        <td style={{ ...td, fontWeight: l.facturable ? 400 : 800, color: l.facturable ? undefined : "#7a3e00" }}>
                          {l.facturable ? l.statut || "—" : `⚠ ${l.statut} — non facturable`}
                          {l.statutBase && <div style={{ fontSize: 12, color: C.gris }}>commande : {l.statutBase}</div>}
                        </td>
                        <td style={{ ...tdD, fontWeight: 800 }}>
                          <span style={l.facturable ? undefined : { textDecoration: "line-through", color: C.gris }} title={l.facturable ? undefined : "Non compté dans le total à facturer"}>
                            {euros(l.montant)}
                          </span>
                          {l.cloture && <span title="Mois clôturé : montant figé"> 🔒</span>}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={11} style={{ ...td, fontWeight: 800, textAlign: "right", borderTop: `2px solid ${C.rouge}` }}>Total facturable</td>
                      <td style={{ ...tdD, fontWeight: 800, borderTop: `2px solid ${C.rouge}` }}>{euros(totalFacturable)}</td>
                    </tr>
                    <tr>
                      <td colSpan={11} style={{ ...td, textAlign: "right" }}>dont facturé</td>
                      <td style={tdD}>{euros(totalFacture)}</td>
                    </tr>
                    <tr>
                      <td colSpan={11} style={{ ...td, fontWeight: 800, textAlign: "right" }}>Reste à facturer</td>
                      <td style={{ ...tdD, fontWeight: 800 }}>{euros(resteAFacturer)}</td>
                    </tr>
                    {nonFacturables.length > 0 && (
                      <tr>
                        <td colSpan={11} style={{ ...td, textAlign: "right", color: "#7a3e00" }}>Non facturable — compté nulle part ci-dessus</td>
                        <td style={{ ...tdD, color: "#7a3e00", textDecoration: "line-through" }}>{euros(totalNonFacturable)}</td>
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
