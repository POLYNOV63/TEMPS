/* ===============================================================
   FACTURATION D'UN MOIS (calcul partagé) — FACTURATION_PARTAGEE_V2

   Mêmes règles que la page « Facturation du mois » :
   - forfaits LIVRÉS dans le mois : montant − découpages ;
   - forfaits PRÉVUS : « Commande reçue » / « Intention de commande »
     pas encore livrés, date de livraison estimée dans le mois (déjà
     dépassée : comptée au mois en cours) ;
   - PE / PI du relevé, comme le relevé : montant figé (mois clôturé),
     sinon (heures du mois − heures envoyées au mois suivant + heures
     reçues des mois reportés + HS × 125 %) × taux ; un mois reporté à la
     main n'est pas facturé ce mois-ci ; facturable si l'affaire du
     Pilotage est EN_COURS ou LIVREE. (Plus de montant importé de l'ancien
     classeur « Suivi des prestations » : le relevé fait foi.)
   Sert au rapprochement Finances ↔ Facturation, et à l'attendu des PE / PI
   de Finances (chargerPrestationsMois), pour que les deux pages tombent juste.
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
  imputation?: string | null; // PE / PI
  activite_id?: string | null; // PE / PI : activité de la ligne du relevé
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
const finDuMois = (mois: string) => new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).toISOString().slice(0, 10);
const decaler = (m: string, k: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1)).toISOString().slice(0, 7);

/* ------------------------------ le relevé PE / PI ------------------------------ */

type MoisReleve = {
  ligne_id: string;
  mois: string;
  valide: boolean;
  reporte: boolean | null;
  report_sortant: number | string | null;
  report_heures: number | string | null;
  hs_refacturer: number | string | null;
  heures_fige: number | string | null;
  montant_fige: number | string | null;
};
type Releve = {
  lignes: { id: string; affaire_id: string; unite: "JOUR" | "HEURE"; taux: number | string | null; base_horaire: number | string | null; activite_id: string | null }[];
  affaires: Map<string, { id: string; numero: string; statut: string; imputation: string | null }>;
  moisParCle: Map<string, MoisReleve>; // « ligne|AAAA-MM »
  heuresParCle: Map<string, number>; // « ligne|AAAA-MM »
};

async function chargerReleve(jusquA: string): Promise<Releve> {
  const [pm, lp, pa, sa] = await Promise.all([
    chargerTout<MoisReleve>((a, b) =>
      supabase
        .from("prestation_mois")
        .select("ligne_id,mois,valide,reporte,report_sortant,report_heures,hs_refacturer,heures_fige,montant_fige")
        .lte("mois", jusquA)
        .order("ligne_id")
        .range(a, b)
    ),
    supabase.from("prestation_lignes").select("id,affaire_id,unite,taux,base_horaire,activite_id"),
    supabase.from("pilotage_affaires").select("id,numero,statut,imputation"),
    chargerTout<{ ligne_id: string; jour: string; heures: number | string | null }>((a, b) =>
      supabase.from("prestation_saisies").select("ligne_id,jour,heures").lte("jour", jusquA).order("ligne_id").range(a, b)
    ),
  ]);
  for (const r of [lp, pa]) if (r.error) throw new Error(r.error.message);
  const heuresParCle = new Map<string, number>();
  for (const s of sa) {
    const k = `${s.ligne_id}|${s.jour.slice(0, 7)}`;
    heuresParCle.set(k, (heuresParCle.get(k) ?? 0) + (Number(s.heures) || 0));
  }
  return {
    lignes: (lp.data ?? []) as Releve["lignes"],
    affaires: new Map(((pa.data ?? []) as { id: string; numero: string; statut: string; imputation: string | null }[]).map((a) => [a.id, a])),
    moisParCle: new Map(pm.map((x) => [`${x.ligne_id}|${String(x.mois).slice(0, 7)}`, x])),
    heuresParCle,
  };
}

/* PE / PI d'un mois, calculées comme le relevé */
function prestationsDuMois(mois: string, r: Releve, clientDe: (numero: string) => string): LigneFacturationMois[] {
  // heures des mois précédents reportés à la suite, facturées ce mois-ci
  const reportEntrant = (ligne: string) => {
    let t = 0;
    for (let k = 1; k <= 24; k++) {
      const mm = decaler(mois, -k);
      const row = r.moisParCle.get(`${ligne}|${mm}`);
      if (row?.reporte) {
        t += r.heuresParCle.get(`${ligne}|${mm}`) ?? 0;
        continue;
      }
      t += Number(row?.report_sortant) || 0;
      break;
    }
    return t;
  };
  const res: LigneFacturationMois[] = [];
  for (const l of r.lignes) {
    const x = r.moisParCle.get(`${l.id}|${mois}`);
    const h0 = r.heuresParCle.get(`${l.id}|${mois}`) ?? 0;
    if (!x && h0 <= 0) continue;
    const a = r.affaires.get(l.affaire_id);
    if (!a) continue;
    if (x?.reporte && !x.valide) continue; // reporté à la main : facturé plus tard
    const taux = l.taux === null ? null : Number(l.taux);
    const tauxH = taux === null ? null : l.unite === "JOUR" ? taux / (Number(l.base_horaire) || 7) : taux;
    const entrant = x?.valide ? 0 : x?.report_heures !== null && x?.report_heures !== undefined ? Number(x.report_heures) || 0 : reportEntrant(l.id);
    const facturees = x?.valide ? Number(x.heures_fige) || 0 : Math.max(0, h0 - (Number(x?.report_sortant) || 0)) + entrant;
    const montant = x?.valide ? Number(x.montant_fige) || 0 : tauxH === null ? 0 : (facturees + (Number(x?.hs_refacturer) || 0) * 1.25) * tauxH;
    if (montant <= 0.004 && facturees <= 0) continue;
    res.push({
      base: baseAffaire(a.numero),
      numero: `CBE${a.numero}`,
      type: "PE / PI",
      client: clientDe(a.numero),
      montant: Math.round(montant * 100) / 100,
      facturable: a.statut === "EN_COURS" || a.statut === "LIVREE",
      cloture: Boolean(x?.valide),
      imputation: a.imputation,
      activite_id: l.activite_id,
    });
  }
  return res;
}

/* PE / PI de plusieurs mois d'un coup (« AAAA-MM »), sans les clients : pour l'attendu de Finances */
export async function chargerPrestationsMois(moisListe: string[]): Promise<Map<string, LigneFacturationMois[]>> {
  const res = new Map<string, LigneFacturationMois[]>();
  if (moisListe.length === 0) return res;
  const dernier = [...moisListe].sort().slice(-1)[0];
  const r = await chargerReleve(finDuMois(dernier));
  for (const m of moisListe) res.set(m, prestationsDuMois(m, r, () => ""));
  return res;
}

/* ------------------------------ un mois complet (forfaits + PE / PI) ------------------------------ */

export async function chargerFacturationMois(mois: string): Promise<LigneFacturationMois[]> {
  const moisCourant = new Date().toISOString().slice(0, 7);

  const [suivi, mt, cl, releve] = await Promise.all([
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
    chargerReleve(finDuMois(mois)),
  ]);

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
  res.push(
    ...prestationsDuMois(mois, releve, (numero) => {
      const sl = parNumero.get(numero.toUpperCase());
      return sl ? clientDe(sl) : "";
    })
  );
  return res;
}
