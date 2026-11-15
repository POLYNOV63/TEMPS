"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { formatHeures } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE - PAR CLIENT (ANALYSE_CLIENTS) - ADMIN

   Sur un exercice (novembre → octobre), client par client :
   - devis ouverts dans l'exercice : nombre, gagnés, perdus, transformation ;
   - commandes reçues dans l'exercice (commande ou avenant) et leur montant ;
   - CA facturé dans l'exercice : forfaits livrés (échéances, lots, puis le
     solde de la commande à sa livraison) et PE / PI au relevé (mois clôturés) ;
   - heures pointées dans l'exercice sur ses affaires (CBE) et ses devis (DBE),
     par activité et par méthode de vente ;
   - marge = CA facturé − heures × coût de structure − achats des commandes
     livrées dans l'exercice.
   Le client d'une affaire = celui de sa commande de base au Suivi d'affaire
   BE ; les noms identiques se regroupent, les autres d'après la table
   client_regroupements (SQL 100).
================================================================ */

type Ligne = {
  id: string;
  cle: string;
  genre: string;
  parent_cle: string | null;
  numero_affaire: string | null;
  base_affaire: string | null;
  base_devis: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_id: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  date_livraison: string | null;
  disparue: boolean;
};
type Montant = {
  ligne_id: string;
  montant: number | string | null;
  montant_echeances: number | string | null;
  montant_achats: number | string | null;
  montant_scan: number | string | null;
  montant_negoce: number | string | null;
};
type Heure = { type_affaire: string; numero: string; activite_id: string | null; heures: number | string };

type Affaire = { base: string; designation: string; methode: string; statut: string; heures: number; ca: number };
type Stat = {
  client: string;
  devis: number;
  gagnes: number;
  perdus: number;
  montantDevis: number;
  commandes: number;
  montantCommandes: number;
  ca: number;
  achats: number;
  heures: number;
  heuresDevis: number;
  parActivite: Map<string, number>;
  parMethode: Map<string, number>; // METHODES_VENTE : heures en PE, PI, BE (forfait), Négoce, Scan
  caMethode: Map<string, number>; // le CA facturé, même découpage
  affaires: Map<string, Affaire>;
};

const n = (v: unknown) => Number(v) || 0;
const sansZeros = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase().replace(/^(CBE|DBE|CAS)\s*/, "").replace(/^0+/, "");
const euros = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} €`;
const pc = (v: number) => `${Math.round(v * 100)} %`;
const sansAccents = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const COULEURS_ACTIVITES: [RegExp, string][] = [
  [/^meca|mecanique/, "#c00000"],
  [/^elec|electri|pneu/, "#34506b"],
  [/^calcul/, "#6b58a8"],
  [/^scan/, "#e08a1e"],
  [/^negoce/, "#8d6e63"],
];
const couleurAct = (nom: string) => COULEURS_ACTIVITES.find(([m]) => m.test(sansAccents(nom).replace(/ /g, "")))?.[1] ?? "#5b6168";
/* METHODES_VENTE : PE, PI, BE (forfait), Négoce, Scan. Sur un forfait, le négoce et le scan se reconnaissent
   à l'activité des heures et aux montants négoce / scan de la commande ; une affaire imputée « Négoce » ou « Scan »
   compte en entier dans sa méthode. */
const METHODES = ["PE", "PI", "BE", "Négoce", "Scan"] as const;
const COULEURS_METHODES: Record<string, string> = { PE: "#1f4e99", PI: "#2e7d6b", BE: "#c00000", Négoce: "#8d6e63", Scan: "#e08a1e" };

function methodeDe(imp: string | null | undefined): "PE" | "PI" | "BE" | "Négoce" | "Scan" {
  const i = sansAccents(imp ?? "");
  if (i === "pe") return "PE";
  if (i === "pi") return "PI";
  if (i.startsWith("negoce")) return "Négoce";
  if (i.startsWith("scan")) return "Scan";
  return "BE";
}
const methodeHeure = (methodeAffaire: string, activite: string) => {
  if (methodeAffaire !== "BE") return methodeAffaire;
  const a = sansAccents(activite);
  return a.startsWith("negoce") ? "Négoce" : a.startsWith("scan") ? "Scan" : "BE";
};

async function toutesLesLignes<T>(requete: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const tout: T[] = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await requete(debut, debut + 999);
    if (error) throw new Error(error.message);
    const lot = (data ?? []) as T[];
    tout.push(...lot);
    if (lot.length < 1000) return tout;
  }
}

type Tri = { cle: string; sens: 1 | -1 };

function ClientsContenu() {
  const [exercice, setExercice] = useState(() => {
    const d = new Date();
    return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
  });
  const [donnees, setDonnees] = useState<{
    lignes: Ligne[];
    montants: Map<string, Montant>;
    nomsClients: Map<string, string>;
    groupes: Map<string, string>;
    activites: Map<string, string>;
    couts: { annee: number; cout_horaire: number }[];
  } | null>(null);
  const [heures, setHeures] = useState<Heure[]>([]);
  const [releve, setReleve] = useState<{ base: string; montant: number }[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [tri, setTri] = useState<Tri>({ cle: "ca", sens: -1 });

  // ce qui ne dépend pas de l'exercice
  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [lignes, montants, cl, rg, ac, co] = await Promise.all([
          toutesLesLignes<Ligne>((a, b) =>
            supabase
              .from("suivi_lignes")
              .select("id,cle,genre,parent_cle,numero_affaire,base_affaire,base_devis,statut,imputation,designation,client_id,date_ouverture,date_envoi,date_reception_commande,date_livraison,disparue")
              .order("id", { ascending: true })
              .range(a, b)
          ),
          toutesLesLignes<Montant>((a, b) => supabase.from("suivi_lignes_montants").select("ligne_id,montant,montant_echeances,montant_achats,montant_scan,montant_negoce").order("ligne_id", { ascending: true }).range(a, b)),
          supabase.from("suivi_clients").select("id,nom_abrege"),
          supabase.from("client_regroupements").select("nom,groupe"),
          supabase.from("activites").select("id,nom"),
          supabase.from("indicateurs_couts").select("annee,cout_horaire"),
        ]);
        if (!actif) return;
        setDonnees({
          lignes: lignes.filter((l) => !l.disparue),
          montants: new Map(montants.map((m) => [m.ligne_id, m])),
          nomsClients: new Map(((cl.data ?? []) as { id: string; nom_abrege: string }[]).map((c) => [c.id, c.nom_abrege.trim()])),
          groupes: new Map(((rg.data ?? []) as { nom: string; groupe: string }[]).map((g) => [g.nom.trim().toUpperCase(), g.groupe.trim()])),
          activites: new Map(((ac.data ?? []) as { id: string; nom: string }[]).map((a) => [a.id, a.nom])),
          couts: ((co.data ?? []) as { annee: number; cout_horaire: number }[]).map((c) => ({ annee: n(c.annee), cout_horaire: n(c.cout_horaire) })),
        });
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger l’analyse.");
      }
    })();
    return () => {
      actif = false;
    };
  }, []);

  // ce qui dépend de l'exercice : heures pointées et relevé PE / PI clôturé
  useEffect(() => {
    let actif = true;
    setChargement(true);
    (async () => {
      try {
        const debut = `${exercice}-11-01`;
        const fin = `${exercice + 1}-10-31`;
        const { data: h, error: eh } = await supabase.rpc("analyse_heures_clients", { p_debut: debut, p_fin: fin });
        if (eh) throw new Error(eh.message.includes("analyse_heures_clients") ? "Lancez d’abord le SQL 100 (analyse par client) dans Supabase." : eh.message);
        const mois = await toutesLesLignes<{ ligne_id: string; montant_fige: number | string | null }>((a, b) =>
          supabase.from("prestation_mois").select("ligne_id,montant_fige").eq("valide", true).gte("mois", debut).lte("mois", fin).order("ligne_id", { ascending: true }).order("mois", { ascending: true }).range(a, b)
        );
        const idsLignes = [...new Set(mois.map((m) => m.ligne_id))];
        const lp: { id: string; affaire_id: string }[] = [];
        for (let k = 0; k < idsLignes.length; k += 150) {
          const { data } = await supabase.from("prestation_lignes").select("id,affaire_id").in("id", idsLignes.slice(k, k + 150));
          lp.push(...((data ?? []) as { id: string; affaire_id: string }[]));
        }
        const idsAff = [...new Set(lp.map((l) => l.affaire_id))];
        const af: { id: string; numero: string }[] = [];
        for (let k = 0; k < idsAff.length; k += 150) {
          const { data } = await supabase.from("pilotage_affaires").select("id,numero").in("id", idsAff.slice(k, k + 150));
          af.push(...((data ?? []) as { id: string; numero: string }[]));
        }
        const numeroAff = new Map(af.map((a) => [a.id, a.numero]));
        const affLigne = new Map(lp.map((l) => [l.id, l.affaire_id]));
        if (!actif) return;
        setHeures((h ?? []) as Heure[]);
        setReleve(
          mois
            .map((m) => ({ base: sansZeros((numeroAff.get(affLigne.get(m.ligne_id) ?? "") ?? "").match(/^\d+/)?.[0] ?? ""), montant: n(m.montant_fige) }))
            .filter((x) => x.base)
        );
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger l’analyse.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [exercice]);

  const vue = useMemo(() => {
    if (!donnees) return null;
    const debut = `${exercice}-11-01`;
    const fin = `${exercice + 1}-10-31`;
    const dans = (d: string | null) => Boolean(d && d >= debut && d <= fin);
    const groupe = (clientId: string | null) => {
      const nom = clientId ? donnees.nomsClients.get(clientId) : undefined;
      if (!nom) return "Client non renseigné";
      return donnees.groupes.get(nom.toUpperCase()) ?? nom.toUpperCase();
    };
    const cout = (donnees.couts.find((c) => c.annee === exercice) ?? [...donnees.couts].sort((a, b) => b.annee - a.annee)[0])?.cout_horaire ?? null;
    const montant = (l: Ligne) => n(donnees.montants.get(l.id)?.montant);

    // la commande de base de chaque affaire : son client et sa méthode de vente
    const bases = new Map<string, Ligne>();
    for (const l of donnees.lignes) if (l.genre === "BASE" && l.base_affaire) bases.set(sansZeros(l.base_affaire), l);
    const devisBase = new Map<string, Ligne>();
    for (const l of donnees.lignes) if ((l.genre === "DEVIS" || l.genre === "BASE") && l.base_devis) devisBase.set(sansZeros(l.base_devis), l);
    const clientDeLigne = (l: Ligne) => groupe(l.client_id ?? (l.base_affaire ? bases.get(sansZeros(l.base_affaire))?.client_id ?? null : null));
    const methodeAff = (b: string) => methodeDe(bases.get(b)?.imputation);

    const stats = new Map<string, Stat>();
    const stat = (client: string) => {
      let s = stats.get(client);
      if (!s) {
        s = { client, devis: 0, gagnes: 0, perdus: 0, montantDevis: 0, commandes: 0, montantCommandes: 0, ca: 0, achats: 0, heures: 0, heuresDevis: 0, parActivite: new Map(), parMethode: new Map(), caMethode: new Map(), affaires: new Map() };
        stats.set(client, s);
      }
      return s;
    };
    const affaireDe = (s: Stat, b: string) => {
      let a = s.affaires.get(b);
      if (!a) {
        const l = bases.get(b);
        a = { base: b, designation: l?.designation ?? "", methode: methodeAff(b), statut: l?.statut ?? "", heures: 0, ca: 0 };
        s.affaires.set(b, a);
      }
      return a;
    };

    // devis ouverts dans l'exercice (devis, commandes et avenants : chacun a été un devis)
    for (const l of donnees.lignes) {
      if (!["DEVIS", "BASE", "AVENANT"].includes(l.genre) || !dans(l.date_ouverture)) continue;
      const s = stat(clientDeLigne(l));
      s.devis++;
      s.montantDevis += montant(l);
      if (l.statut === "Devis perdu" && l.date_envoi) s.perdus++;
      else if (l.numero_affaire && l.statut !== "Devis perdu" && l.statut !== "Commande annulée") s.gagnes++;
    }

    // commandes reçues dans l'exercice
    for (const l of donnees.lignes) {
      if ((l.genre !== "BASE" && l.genre !== "AVENANT") || !l.numero_affaire || !dans(l.date_reception_commande) || l.statut === "Commande annulée") continue;
      const s = stat(clientDeLigne(l));
      s.commandes++;
      s.montantCommandes += montant(l);
    }

    // CA facturé dans l'exercice : forfaits (hors PE / PI, qui passent par le relevé)
    const enfants = new Map<string, Ligne[]>();
    for (const l of donnees.lignes) if (l.parent_cle) enfants.set(l.parent_cle, [...(enfants.get(l.parent_cle) ?? []), l]);
    const parCle = new Map(donnees.lignes.map((l) => [l.cle, l]));
    const ajoute = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    // le CA d'une ligne de forfait, découpé en BE / Négoce / Scan selon les montants de sa commande
    const decouperCA = (s: Stat, l: Ligne, v: number, methodeAffaire: string) => {
      if (methodeAffaire !== "BE") return ajoute(s.caMethode, methodeAffaire, v);
      const mere = l.genre === "ECHEANCE" || l.genre === "LOT" ? parCle.get(l.parent_cle ?? "") ?? l : l;
      const md = donnees.montants.get(mere.id);
      const total = n(md?.montant);
      const scan = total > 0.5 ? Math.min(1, n(md?.montant_scan) / total) : 0;
      const neg = total > 0.5 ? Math.min(1 - scan, n(md?.montant_negoce) / total) : 0;
      if (scan > 0) ajoute(s.caMethode, "Scan", v * scan);
      if (neg > 0) ajoute(s.caMethode, "Négoce", v * neg);
      ajoute(s.caMethode, "BE", v * (1 - scan - neg));
    };
    for (const l of donnees.lignes) {
      const b = sansZeros(l.base_affaire);
      if (!b || !l.date_livraison || !dans(l.date_livraison)) continue;
      const m = methodeAff(b);
      if (m === "PE" || m === "PI") continue;
      let v = 0;
      if (l.genre === "ECHEANCE" || l.genre === "LOT") {
        const md = donnees.montants.get(l.id);
        v = n(md?.montant_echeances) || n(md?.montant);
      } else if (l.genre === "BASE" || l.genre === "AVENANT") {
        const deja = (enfants.get(l.cle) ?? []).filter((d) => d.date_livraison).reduce((t, d) => {
          const md = donnees.montants.get(d.id);
          return t + (n(md?.montant_echeances) || n(md?.montant));
        }, 0);
        v = montant(l) - deja;
        const s = stat(clientDeLigne(l));
        s.achats += n(donnees.montants.get(l.id)?.montant_achats);
      } else continue;
      if (Math.abs(v) < 0.5) continue;
      const s = stat(clientDeLigne(l));
      s.ca += v;
      decouperCA(s, l, v, m);
      affaireDe(s, b).ca += v;
    }
    // PE / PI : mois clôturés du relevé
    for (const r of releve) {
      const l = bases.get(r.base);
      const s = stat(groupe(l?.client_id ?? null));
      s.ca += r.montant;
      ajoute(s.caMethode, methodeDe(l?.imputation) === "PI" ? "PI" : "PE", r.montant);
      affaireDe(s, r.base).ca += r.montant;
    }

    // heures pointées dans l'exercice
    for (const h of heures) {
      const b = sansZeros(h.numero);
      const v = n(h.heures);
      if (!b || v === 0) continue;
      if (h.type_affaire === "DBE") {
        const s = stat(groupe(devisBase.get(b)?.client_id ?? null));
        s.heures += v;
        s.heuresDevis += v;
        const nomA = h.activite_id ? donnees.activites.get(h.activite_id) ?? "Autre" : "Sans activité";
        s.parActivite.set(nomA, (s.parActivite.get(nomA) ?? 0) + v);
        continue;
      }
      const s = stat(groupe(bases.get(b)?.client_id ?? null));
      s.heures += v;
      const nomA = h.activite_id ? donnees.activites.get(h.activite_id) ?? "Autre" : "Sans activité";
      ajoute(s.parMethode, methodeHeure(methodeAff(b), nomA), v);
      s.parActivite.set(nomA, (s.parActivite.get(nomA) ?? 0) + v);
      affaireDe(s, b).heures += v;
    }

    const liste = [...stats.values()].filter((s) => s.devis + s.commandes > 0 || s.ca > 0.5 || s.heures > 0.05);
    const totalH = liste.reduce((t, s) => t + s.heures, 0);
    const totalCA = liste.reduce((t, s) => t + s.ca, 0);
    const margeDe = (s: Stat) => (cout === null ? null : s.ca - s.heures * cout - s.achats);
    const totalMarge = cout === null ? null : liste.reduce((t, s) => t + (margeDe(s) ?? 0), 0);
    return { liste, totalH, totalCA, totalMarge, cout, margeDe };
  }, [donnees, heures, releve, exercice]);

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px", textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "8px", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  const enTete = (libelle: string, cle: string, style: CSSProperties = th, sensDefaut: 1 | -1 = -1, title?: string) => {
    const actif = tri.cle === cle;
    return (
      <th
        style={{ ...style, cursor: "pointer", userSelect: "none", color: actif ? C.rougeFonce : style.color }}
        title={title ?? "Cliquer pour trier"}
        aria-sort={actif ? (tri.sens === 1 ? "ascending" : "descending") : undefined}
        onClick={() => setTri(actif ? { cle, sens: tri.sens === 1 ? -1 : 1 } : { cle, sens: sensDefaut })}
      >
        {libelle} <span style={{ fontSize: 11, opacity: actif ? 1 : 0.35 }}>{actif ? (tri.sens === 1 ? "▲" : "▼") : "↕"}</span>
      </th>
    );
  };

  const lignesTriees = useMemo(() => {
    if (!vue) return [];
    const transfo = (s: Stat) => (s.gagnes + s.perdus > 0 ? s.gagnes / (s.gagnes + s.perdus) : -1);
    const val = (s: Stat): number | string => {
      const m = vue.margeDe(s);
      switch (tri.cle) {
        case "client":
          return s.client;
        case "devis":
          return s.devis;
        case "transfo":
          return transfo(s);
        case "commandes":
          return s.montantCommandes;
        case "heures":
          return s.heures;
        case "marge":
          return m ?? 0;
        case "margePc":
          return m !== null && s.ca > 0.5 ? m / s.ca : -Infinity;
        default:
          return s.ca;
      }
    };
    return [...vue.liste].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr");
      return (c || a.client.localeCompare(b.client, "fr")) * tri.sens;
    });
  }, [vue, tri]);

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <OngletsPilotage actif="clients" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Analyse par client</h1>
            <p style={page.sousTitre}>Devis, commandes, CA facturé, heures et marge de chaque client sur l’exercice. Cliquez sur un client pour le détail.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">
              ◀
            </button>
            <strong style={{ fontSize: 18, minWidth: 110, textAlign: "center" }}>
              {exercice}-{exercice + 1}
            </strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">
              ▶
            </button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {(chargement || !vue) && !erreur && <Message genre="info">Chargement…</Message>}

        {vue && !chargement && !erreur && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Clients actifs" valeur={String(vue.liste.length)} sous="un devis, une commande, du CA ou des heures sur l’exercice" />
              <Tuile libelle="CA facturé" valeur={euros(vue.totalCA)} sous={`du 1er novembre ${exercice} au 31 octobre ${exercice + 1}`} />
              <Tuile libelle="Heures pointées" valeur={formatHeures(vue.totalH)} sous="sur les affaires et les devis des clients" />
              <Tuile
                libelle="Marge"
                valeur={vue.totalMarge === null ? "—" : euros(vue.totalMarge)}
                sous={vue.cout === null ? "coût de structure non saisi" : `${vue.totalCA > 0.5 && vue.totalMarge !== null ? `${pc(vue.totalMarge / vue.totalCA)} · ` : ""}coût ${euros(vue.cout)} / h`}
              />
            </div>

            <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      {enTete("Client", "client", { ...th, textAlign: "left" }, 1)}
                      {enTete("Devis", "devis")}
                      {enTete("Transformation", "transfo", th, -1, "Devis gagnés ÷ (gagnés + perdus)")}
                      {enTete("Commandes reçues", "commandes")}
                      {enTete("CA facturé", "ca")}
                      {enTete("Heures", "heures")}
                      {enTete("Marge", "marge")}
                      {enTete("Marge %", "margePc")}
                    </tr>
                  </thead>
                  <tbody>
                    {lignesTriees.map((s) => {
                      const m = vue.margeDe(s);
                      const ouv = ouvert === s.client;
                      const transfo = s.gagnes + s.perdus > 0 ? s.gagnes / (s.gagnes + s.perdus) : null;
                      const totalAct = [...s.parActivite.values()].reduce((t, x) => t + x, 0);
                      return (
                        <Fragment key={s.client}>
                          <tr onClick={() => setOuvert(ouv ? null : s.client)} style={{ cursor: "pointer", background: ouv ? "#f6f8fb" : undefined }}>
                            <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>
                              <span style={{ color: C.rougeFonce, marginRight: 6 }}>{ouv ? "▾" : "▸"}</span>
                              {s.client}
                            </td>
                            <td style={tdN}>
                              {s.devis || "—"}
                              {s.montantDevis > 0.5 && <span style={{ color: C.gris, fontSize: 12 }}> · {euros(s.montantDevis)}</span>}
                            </td>
                            <td style={tdN}>
                              {transfo === null ? "—" : pc(transfo)}
                              {transfo !== null && (
                                <span style={{ color: C.gris, fontSize: 12 }}>
                                  {" "}
                                  ({s.gagnes} / {s.gagnes + s.perdus})
                                </span>
                              )}
                            </td>
                            <td style={tdN}>
                              {s.commandes || "—"}
                              {s.montantCommandes > 0.5 && <span style={{ color: C.gris, fontSize: 12 }}> · {euros(s.montantCommandes)}</span>}
                            </td>
                            <td style={{ ...tdN, fontWeight: 800 }}>{s.ca > 0.5 ? euros(s.ca) : "—"}</td>
                            <td style={tdN}>
                              {s.heures > 0.05 ? formatHeures(s.heures) : "—"}
                              {vue.totalH > 0 && s.heures > 0.05 && <span style={{ color: C.gris, fontSize: 12 }}> · {pc(s.heures / vue.totalH)}</span>}
                            </td>
                            <td style={{ ...tdN, fontWeight: 800, color: m === null ? C.gris : m < 0 ? "#b3261e" : "#1b5e20" }}>{m === null ? "—" : euros(m)}</td>
                            <td style={{ ...tdN, fontWeight: 700, color: m === null ? C.gris : m < 0 ? "#b3261e" : "#1b5e20" }}>{m !== null && s.ca > 0.5 ? pc(m / s.ca) : "—"}</td>
                          </tr>
                          {ouv && (
                            <tr>
                              <td colSpan={8} style={{ ...td, background: "#fafbfc", padding: "12px 16px 16px 28px" }}>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                                  {/* heures par activité */}
                                  <div style={{ flex: "1 1 320px" }}>
                                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Heures par activité</div>
                                    {totalAct <= 0.05 ? (
                                      <div style={{ color: C.gris }}>Aucune heure pointée sur l’exercice.</div>
                                    ) : (
                                      [...s.parActivite.entries()]
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([nom, h]) => (
                                          <div key={nom} style={{ display: "grid", gridTemplateColumns: "110px 1fr 120px", gap: 8, alignItems: "center", marginBottom: 4 }}>
                                            <strong style={{ color: couleurAct(nom), fontSize: 13 }}>{nom}</strong>
                                            <div style={{ height: 12, background: "#eef0f2", borderRadius: 6 }}>
                                              <div style={{ height: "100%", width: `${(h / totalAct) * 100}%`, background: couleurAct(nom), borderRadius: 6 }} />
                                            </div>
                                            <span style={{ fontSize: 13, textAlign: "right" }}>
                                              {formatHeures(h)} <span style={{ color: C.gris }}>· {pc(h / totalAct)}</span>
                                            </span>
                                          </div>
                                        ))
                                    )}
                                  </div>
                                  {/* méthodes de vente */}
                                  <div style={{ flex: "1 1 260px" }}>
                                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Répartition PE / PI / BE / Négoce / Scan</div>
                                    {(
                                      [
                                        ["Heures", s.parMethode, (v: number) => formatHeures(v)],
                                        ["CA facturé", s.caMethode, (v: number) => euros(v)],
                                      ] as [string, Map<string, number>, (v: number) => string][]
                                    ).map(([titre, carte, f]) => {
                                      const total = [...carte.values()].reduce((t, x) => t + x, 0);
                                      return (
                                        <div key={titre} style={{ marginBottom: 10 }}>
                                          <div style={{ fontSize: 12, fontWeight: 800, color: C.gris, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 3 }}>
                                            {titre} {total > 0.05 ? `· ${f(total)}` : ""}
                                          </div>
                                          {total <= 0.05 ? (
                                            <div style={{ color: C.gris, fontSize: 13 }}>—</div>
                                          ) : (
                                            <>
                                              <div style={{ display: "flex", height: 14, borderRadius: 6, overflow: "hidden", marginBottom: 4 }}>
                                                {METHODES.filter((m2) => (carte.get(m2) ?? 0) > 0.01).map((m2) => (
                                                  <div key={m2} title={`${m2} : ${f(carte.get(m2) ?? 0)}`} style={{ width: `${((carte.get(m2) ?? 0) / total) * 100}%`, background: COULEURS_METHODES[m2] }} />
                                                ))}
                                              </div>
                                              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 13 }}>
                                                {METHODES.filter((m2) => (carte.get(m2) ?? 0) > 0.01).map((m2) => (
                                                  <span key={m2}>
                                                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: COULEURS_METHODES[m2], marginRight: 5 }} />
                                                    <strong>{m2}</strong> {f(carte.get(m2) ?? 0)} <span style={{ color: C.gris }}>· {pc((carte.get(m2) ?? 0) / total)}</span>
                                                  </span>
                                                ))}
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {s.heuresDevis > 0.05 && <div style={{ fontSize: 13, color: C.gris }}>Temps passé sur ses devis (à part) : {formatHeures(s.heuresDevis)}</div>}
                                    {s.achats > 0.5 && <div style={{ marginTop: 8, fontSize: 13, color: C.gris }}>Achats des commandes livrées : {euros(s.achats)}</div>}
                                  </div>
                                </div>
                                {/* ses affaires */}
                                {s.affaires.size > 0 && (
                                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 14, fontSize: 13 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ ...th, textAlign: "left" }}>Affaire</th>
                                        <th style={{ ...th, textAlign: "left" }}>Descriptif</th>
                                        <th style={{ ...th, textAlign: "left" }}>Méthode</th>
                                        <th style={{ ...th, textAlign: "left" }}>Statut</th>
                                        <th style={th}>Heures (exercice)</th>
                                        <th style={th}>CA facturé (exercice)</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {[...s.affaires.values()]
                                        .sort((a, b) => b.ca - a.ca || b.heures - a.heures)
                                        .map((a) => (
                                          <tr key={a.base}>
                                            <td style={{ ...td, fontSize: 13, whiteSpace: "nowrap" }}>
                                              <Link href={`/affaires/bilan?affaire=CBE${a.base}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                                                CBE {a.base}
                                              </Link>
                                            </td>
                                            <td style={{ ...td, fontSize: 13 }}>{a.designation}</td>
                                            <td style={{ ...td, fontSize: 13, whiteSpace: "nowrap" }}>{a.methode}</td>
                                            <td style={{ ...td, fontSize: 13, whiteSpace: "nowrap", color: C.gris }}>{a.statut}</td>
                                            <td style={{ ...tdN, fontSize: 13 }}>{a.heures > 0.05 ? formatHeures(a.heures) : "—"}</td>
                                            <td style={{ ...tdN, fontSize: 13, fontWeight: 700 }}>{a.ca > 0.5 ? euros(a.ca) : "—"}</td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                )}

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

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Client</strong> : celui de la commande de base au Suivi d’affaire BE. Les noms identiques se regroupent ; les autres (MICHELIN URG,
                  LAD, COM…) d’après la table des regroupements.
                </li>
                <li>
                  <strong>Devis</strong> : ouverts dans l’exercice (devis, commandes et avenants). <strong>Transformation</strong> : gagnés ÷ (gagnés +
                  perdus) ; un devis perdu n’est compté que s’il a été envoyé.
                </li>
                <li>
                  <strong>CA facturé</strong> : forfaits livrés dans l’exercice (échéances et lots à leur livraison, puis le solde de la commande) et mois
                  clôturés du relevé PE / PI.
                </li>
                <li>
                  <strong>Heures</strong> : pointées dans l’exercice sur ses affaires et ses devis (feuilles d’heures et historique).
                  <strong> Répartition PE / PI / BE / Négoce / Scan</strong> : PE et PI d’après l’imputation de l’affaire ; sur un forfait, les heures
                  pointées en activité Négoce ou Scan, et la part négoce / scan du montant de la commande pour le CA ; le reste est du BE. Le temps de
                  devis est indiqué à part.
                </li>
                <li>
                  <strong>Marge</strong> = CA facturé − heures × coût de structure de l’exercice − achats des commandes livrées. Les heures et le CA d’une
                  même affaire peuvent tomber sur deux exercices : une affaire en cours pèse sur la marge avant d’être facturée.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function AnalyseClientsPage() {
  return (
    <GardeAcces droit="administration">
      <ClientsContenu />
    </GardeAcces>
  );
}
