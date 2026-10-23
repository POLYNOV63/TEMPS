/* ===============================================================
   FACTURATION D'UN MOIS (calcul partagé)

   Mêmes règles que la page « Facturation du mois », pour pouvoir la
   rapprocher de l'atterrissage de Finances (même mois) :
   - forfaits LIVRÉS dans le mois : montant − découpages ;
   - forfaits PRÉVUS : « Commande reçue » / « Intention de commande »
     pas encore livrés, date de livraison estimée dans le mois (déjà
     dépassée : comptée au mois en cours) ;
   - PE / PI du relevé : montant figé (mois clôturé), sinon montant
     importé du classeur, sinon (heures − report + HS × 125 %) × taux ;
     facturable si l'affaire du Pilotage est EN_COURS ou LIVREE.
   Si vous changez une règle ici, changez-la aussi dans
   app/analyse/facturation/page.tsx (et inversement).
================================================================ */

import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";

export type LigneFacturationMois = {
  base: string; // n° d'affaire de base, sans zéros : « 1604 »
  numero: string; // n° affiché : « 1604R2 », « CBE1624 »
  type: "Forfait" | "Forfait prévu" | "PE / PI";
  client: string;
  montant: number;
  facturable: boolean;
  cloture: boolean;
};

type LigneSuivi = {
  id: string;
  cle: string;
  genre: string;
  parent_cle: string | null;
  base_affaire: string | null;
  numero_affaire: string | null;
  statut: string | null;
  imputation: string | null;
  client_id: string | null;
  date_livraison: string | null;
  date_livraison_estimee: string | null;
  disparue: boolean;
};

const prestation = (imp: string | null) => imp === "PE" || imp === "PI";
export const baseAffaire = (v: string | null | undefined) =>
  String(v ?? "").toUpperCase().replace(/^(CBE|DBE)/, "").match(/\d+/)?.[0]?.replace(/^0+/, "") ?? "";

export async function chargerFacturationMois(mois: string): Promise<LigneFacturationMois[]> {
  const debut = `${mois}-01`;
  const fin = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const moisCourant = new Date().toISOString().slice(0, 7);

  const [suivi, mt, cl, pm, lp, pa, sa] = await Promise.all([
    chargerTout<LigneSuivi>((a, b) =>
      supabase
        .from("suivi_lignes")
        .select("id,cle,genre,parent_cle,base_affaire,numero_affaire,statut,imputation,client_id,date_livraison,date_livraison_estimee,disparue")
        .order("cle")
        .range(a, b)
    ),
    chargerTout<{ ligne_id: string; montant: number | string; montant_echeances: number | string }>((a, b) =>
      supabase.from("suivi_lignes_montants").select("ligne_id,montant,montant_echeances").order("ligne_id").range(a, b)
    ),
    chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
    supabase.from("prestation_mois").select("ligne_id,valide,reporte,report_sortant,hs_refacturer,heures_fige,montant_fige,montant_import").eq("mois", debut),
    supabase.from("prestation_lignes").select("id,affaire_id,unite,taux,base_horaire"),
    supabase.from("pilotage_affaires").select("id,numero,statut,imputation"),
    chargerTout<{ ligne_id: string; heures: number | string | null }>((a, b) =>
      supabase.from("prestation_saisies").select("ligne_id,heures").gte("jour", debut).lte("jour", fin).order("ligne_id").range(a, b)
    ),
  ]);
  for (const r of [pm, lp, pa]) if (r.error) throw new Error(r.error.message);

  const montants = new Map(mt.map((m) => [m.ligne_id, { montant: Number(m.montant) || 0, echeances: Number(m.montant_echeances) || 0 }]));
  const clients = new Map(cl.map((c) => [c.id, c.nom_abrege]));
  const parNumero = new Map<string, LigneSuivi>();
  for (const l of suivi) if (l.numero_affaire && (l.genre === "BASE" || l.genre === "AVENANT")) parNumero.set(l.numero_affaire.toUpperCase().replace(/^CBE/, ""), l);
  const baseDe = (l: LigneSuivi) => (l.base_affaire ? parNumero.get(l.base_affaire) : undefined) ?? l;
  const clientDe = (l: LigneSuivi) => {
    const id = l.client_id ?? baseDe(l).client_id;
    return id ? clients.get(id) ?? "" : "";
  };

  const res: LigneFacturationMois[] = [];

  /* ---- forfaits livrés et prévus ---- */
  const enAttente = (l: LigneSuivi) => l.statut === "Commande reçue" || l.statut === "Intention de commande";
  const decoupages = new Map<string, number>();
  const couverts = new Map<string, number>();
  for (const l of suivi) {
    if ((l.genre !== "ECHEANCE" && l.genre !== "LOT") || !l.parent_cle || l.disparue) continue;
    const m = montants.get(l.id);
    const v = (m?.echeances || m?.montant) ?? 0;
    decoupages.set(l.parent_cle, (decoupages.get(l.parent_cle) ?? 0) + v);
    if (l.statut === "Livrée" || (enAttente(l) && l.date_livraison_estimee)) couverts.set(l.parent_cle, (couverts.get(l.parent_cle) ?? 0) + v);
  }
  for (const l of suivi) {
    if (l.disparue || !["BASE", "AVENANT", "ECHEANCE", "LOT"].includes(l.genre)) continue;
    const b = baseDe(l);
    if (prestation(b.imputation ?? l.imputation)) continue;
    const m = montants.get(l.id);
    const decoupage = l.genre === "ECHEANCE" || l.genre === "LOT";
    const numero = l.genre === "BASE" || l.genre === "AVENANT" ? l.numero_affaire ?? l.cle : l.cle;

    if (enAttente(l)) {
      const d = l.date_livraison_estimee;
      const retard = Boolean(d && d.slice(0, 7) < moisCourant && mois === moisCourant);
      if (!d || !(d.startsWith(mois) || retard)) continue;
      const montant = decoupage ? (m?.echeances || m?.montant) ?? 0 : Math.max(0, (m?.montant ?? 0) - (couverts.get(l.cle) ?? 0));
      if (montant > 0.004) res.push({ base: baseAffaire(l.base_affaire ?? numero), numero, type: "Forfait prévu", client: clientDe(l), montant, facturable: true, cloture: false });
      continue;
    }
    if (l.statut !== "Livrée" || !l.date_livraison || !l.date_livraison.startsWith(mois)) continue;
    const montant = decoupage ? (m?.echeances || m?.montant) ?? 0 : Math.max(0, (m?.montant ?? 0) - (decoupages.get(l.cle) ?? 0));
    if (montant > 0.004) res.push({ base: baseAffaire(l.base_affaire ?? numero), numero, type: "Forfait", client: clientDe(l), montant, facturable: true, cloture: false });
  }

  /* ---- PE / PI du relevé ---- */
  const affaires = new Map(((pa.data ?? []) as { id: string; numero: string; statut: string; imputation: string | null }[]).map((a) => [a.id, a]));
  const heures = new Map<string, number>();
  for (const s of sa) heures.set(s.ligne_id, (heures.get(s.ligne_id) ?? 0) + (Number(s.heures) || 0));
  type Mois = { ligne_id: string; valide: boolean; reporte: boolean; report_sortant: number | null; hs_refacturer: number | null; heures_fige: number | null; montant_fige: number | null; montant_import: number | null };
  const moisLignes = new Map(((pm.data ?? []) as Mois[]).map((x) => [x.ligne_id, x]));
  for (const l of (lp.data ?? []) as { id: string; affaire_id: string; unite: "JOUR" | "HEURE"; taux: number | null; base_horaire: number }[]) {
    const x = moisLignes.get(l.id);
    const h0 = heures.get(l.id) ?? 0;
    if (!x && h0 <= 0) continue;
    const a = affaires.get(l.affaire_id);
    if (!a) continue;
    const tauxH = l.taux === null ? null : l.unite === "JOUR" ? l.taux / (Number(l.base_horaire) || 7) : l.taux;
    const facturees = x?.valide ? Number(x.heures_fige) || 0 : x?.reporte ? 0 : Math.max(0, h0 - (Number(x?.report_sortant) || 0));
    const montant = x?.valide
      ? Number(x.montant_fige) || 0
      : x?.montant_import !== null && x?.montant_import !== undefined
        ? Number(x.montant_import)
        : tauxH === null
          ? 0
          : (facturees + (Number(x?.hs_refacturer) || 0) * 1.25) * tauxH;
    if (montant <= 0.004 && facturees <= 0) continue;
    const sl = parNumero.get(a.numero.toUpperCase());
    res.push({
      base: baseAffaire(a.numero),
      numero: `CBE${a.numero}`,
      type: "PE / PI",
      client: sl ? clientDe(sl) : "",
      montant: Math.round(montant * 100) / 100,
      facturable: a.statut === "EN_COURS" || a.statut === "LIVREE",
      cloture: Boolean(x?.valide),
    });
  }
  return res;
}
