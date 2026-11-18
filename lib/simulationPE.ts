import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { coutHoraire } from "@/lib/finances";

/* ===============================================================
   SIMULATION PE (SIMULATION_PE, PLG, 18/11/2026)
   Préparer les taux de vente journaliers des PE, compétence par
   compétence (les tarifs du contrat cadre : Etude, Mise en plan,
   Faisabilité, AMO, Calcul), défraiement kilométrique compris, en voyant
   la marge.
   - Coût d'une journée = heures d'une journée × coût horaire de
     structure (Rentabilité) + km indemnisés par jour × prix du km ;
   - le défraiement peut aussi être facturé au client (€ par jour) ;
   - rappel : ce que les notes de frais transmises ont remboursé
     (mêmes règles que la note : A/R compté double, trajet domicile →
     Polynov déduit au départ du domicile) et le taux jour moyen
     réellement facturé sur les PE (relevé validé).
   Rien n'est écrit en base : la simulation reste dans le navigateur.
================================================================ */

export type Tarif = { nom: string; montant: number | null; unite: "HEURE" | "JOUR" | "SEMAINE" };
export type Contrat = { id: string; client_motif: string; libelle: string; base_hebdo: number; rythme_pe: number[]; tarifs: Tarif[] };

export type Competence = {
  nom: string;
  tauxJour: number; // € HT par jour vendu
  jours: number; // jours vendus par an
  kmJour: number; // km indemnisés par jour (A/R)
  defraiFacture: number; // € par jour facturés au client au titre du déplacement
};

export type Globaux = { heuresJour: number; coutHoraire: number; prixKm: number; margeCible: number };

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/* heures d'une journée de PE d'après le contrat (moyenne du rythme du lundi au vendredi) */
export function heuresJourContrat(k: Contrat | null): number {
  const r = (k?.rythme_pe ?? []).map(n).filter((x) => x > 0);
  return r.length ? r.reduce((t, x) => t + x, 0) / r.length : 7.5;
}

/* un tarif du contrat ramené à la journée */
export function tarifJour(t: Tarif, k: Contrat, heuresJour: number): number {
  if (t.montant === null || !Number.isFinite(t.montant)) return 0;
  if (t.unite === "JOUR") return t.montant;
  if (t.unite === "HEURE") return t.montant * heuresJour;
  const base = n(k.base_hebdo) || heuresJour * 5;
  return (t.montant * heuresJour) / base; // la semaine couvre la base hebdomadaire
}

export function calculer(c: Competence, g: Globaux) {
  const ca = c.tauxJour + c.defraiFacture;
  const coutTemps = g.heuresJour * g.coutHoraire;
  const coutKm = c.kmJour * g.prixKm;
  const cout = coutTemps + coutKm;
  const marge = ca - cout;
  const cible = Math.min(0.95, Math.max(0, g.margeCible / 100));
  return {
    ca,
    coutTemps,
    coutKm,
    cout,
    marge,
    pct: ca > 0.5 ? marge / ca : null,
    plancher: cout - c.defraiFacture, // taux jour qui ne perd rien
    conseille: cout / (1 - cible) - c.defraiFacture, // taux jour pour tenir la marge cible
    caAn: ca * c.jours,
    margeAn: marge * c.jours,
    defraiAn: coutKm * c.jours,
  };
}

/* ---------------- rappel des notes de frais ---------------- */

export type LigneFrais = {
  collaborateurId: string;
  nom: string;
  notes: number;
  joursReg: number; // trajets réguliers (jours)
  kmReg: number;
  euroReg: number;
  trajetsPonct: number;
  kmPonct: number;
  euroPonct: number;
  autres: number; // repas, péages… (hors km)
};
export type SiteFrais = { site: string; jours: number; km: number; euros: number };

export type RappelFrais = {
  debut: string; // mois (AAAA-MM-01)
  fin: string;
  lignes: LigneFrais[];
  sites: SiteFrais[];
  brouillons: number;
  prixKmMoyen: number | null;
  kmParJourReg: number | null;
  euroParJourReg: number | null;
};

export async function chargerRappelFrais(debut: string, fin: string): Promise<RappelFrais> {
  type Note = {
    id: string;
    collaborateur_id: string;
    mois: string;
    statut: string;
    prix_km: number | string | null;
    km_domicile: number | string | null;
    reg_depart: string | null;
    reg_site: string | null;
    reg_km_jour: number | string | null;
    reg_nb_trajets: number | string | null;
  };
  const notes = await chargerTout<Note>((a, b) =>
    supabase
      .from("nf_notes")
      .select("id,collaborateur_id,mois,statut,prix_km,km_domicile,reg_depart,reg_site,reg_km_jour,reg_nb_trajets")
      .gte("mois", debut)
      .lte("mois", fin)
      .order("id")
      .range(a, b)
  );
  const transmises = notes.filter((x) => x.statut === "TRANSMISE");
  const ids = transmises.map((x) => x.id);
  type Dep = { note_id: string; depart: string | null; site: string | null; km: number | string | null; aller_retour: boolean | null };
  type Fr = { note_id: string; montant: number | string | null };
  const deps: Dep[] = [];
  const frais: Fr[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lot = ids.slice(i, i + 200);
    const [d, f] = await Promise.all([
      supabase.from("nf_deplacements").select("note_id,depart,site,km,aller_retour").in("note_id", lot),
      supabase.from("nf_frais").select("note_id,montant").in("note_id", lot),
    ]);
    if (d.error) throw new Error(d.error.message);
    if (f.error) throw new Error(f.error.message);
    deps.push(...((d.data ?? []) as Dep[]));
    frais.push(...((f.data ?? []) as Fr[]));
  }
  const collabIds = [...new Set(transmises.map((x) => x.collaborateur_id))];
  const noms = new Map<string, string>();
  if (collabIds.length) {
    const { data } = await supabase.from("collaborateurs").select("id,prenom,nom,trigramme").in("id", collabIds);
    for (const c of (data ?? []) as { id: string; prenom: string | null; nom: string | null; trigramme: string | null }[])
      noms.set(c.id, `${c.trigramme ? `${c.trigramme} · ` : ""}${c.prenom ?? ""} ${c.nom ?? ""}`.trim());
  }

  const parCollab = new Map<string, LigneFrais>();
  const parSite = new Map<string, SiteFrais>();
  const site = (s: string | null) => (s ?? "").trim() || "(site non précisé)";
  const ajouterSite = (s: string, jours: number, km: number, euros: number) => {
    const x = parSite.get(s) ?? { site: s, jours: 0, km: 0, euros: 0 };
    x.jours += jours;
    x.km += km;
    x.euros += euros;
    parSite.set(s, x);
  };
  const noteParId = new Map(transmises.map((x) => [x.id, x]));
  let kmPrixTotal = 0;
  let kmTotal = 0;
  for (const x of transmises) {
    const l =
      parCollab.get(x.collaborateur_id) ??
      { collaborateurId: x.collaborateur_id, nom: noms.get(x.collaborateur_id) ?? "?", notes: 0, joursReg: 0, kmReg: 0, euroReg: 0, trajetsPonct: 0, kmPonct: 0, euroPonct: 0, autres: 0 };
    l.notes++;
    const prix = n(x.prix_km);
    const kmDom = n(x.km_domicile);
    const kj = n(x.reg_km_jour);
    const nt = n(x.reg_nb_trajets);
    if (kj > 0 && nt > 0) {
      // NF : même règle que la note (le trajet domicile → Polynov est déduit deux fois par jour au départ du domicile)
      const km = x.reg_depart === "Domicile" ? Math.max(0, (kj - 2 * kmDom) * nt) : kj * nt;
      l.joursReg += nt;
      l.kmReg += km;
      l.euroReg += km * prix;
      ajouterSite(site(x.reg_site), nt, km, km * prix);
      kmTotal += km;
      kmPrixTotal += km * prix;
    }
    parCollab.set(x.collaborateur_id, l);
  }
  for (const d of deps) {
    const x = noteParId.get(d.note_id);
    if (!x) continue;
    const l = parCollab.get(x.collaborateur_id)!;
    const f = d.aller_retour === false ? 1 : 2;
    const km = Math.max(0, n(d.km) * f - (d.depart === "Domicile" ? f * n(x.km_domicile) : 0));
    const e = km * n(x.prix_km);
    l.trajetsPonct++;
    l.kmPonct += km;
    l.euroPonct += e;
    ajouterSite(site(d.site), 1, km, e);
    kmTotal += km;
    kmPrixTotal += e;
  }
  for (const f of frais) {
    const x = noteParId.get(f.note_id);
    if (!x) continue;
    parCollab.get(x.collaborateur_id)!.autres += n(f.montant);
  }
  const lignes = [...parCollab.values()].sort((a, b) => b.euroReg + b.euroPonct - (a.euroReg + a.euroPonct));
  const joursReg = lignes.reduce((t, l) => t + l.joursReg, 0);
  const kmReg = lignes.reduce((t, l) => t + l.kmReg, 0);
  const euroReg = lignes.reduce((t, l) => t + l.euroReg, 0);
  return {
    debut,
    fin,
    lignes,
    sites: [...parSite.values()].sort((a, b) => b.euros - a.euros),
    brouillons: notes.length - transmises.length,
    prixKmMoyen: kmTotal > 0 ? kmPrixTotal / kmTotal : null,
    kmParJourReg: joursReg > 0 ? kmReg / joursReg : null,
    euroParJourReg: joursReg > 0 ? euroReg / joursReg : null,
  };
}

/* ---------------- références : contrat, coût horaire, barème, PE facturés ---------------- */

export type References = {
  contrats: Contrat[];
  coutHoraire: number | null;
  prixKmBareme: number | null; // moyenne du barème (repli si aucune note)
  peFacture: { montant: number; heures: number } | null; // relevé validé des PE, 12 derniers mois
};

export async function chargerReferences(debutMois: string): Promise<References> {
  const [k, co, ba, pl, af] = await Promise.all([
    supabase.from("prestation_contrats").select("id,client_motif,libelle,base_hebdo,rythme_pe,tarifs,actif").eq("actif", true).order("client_motif"),
    supabase.from("indicateurs_couts").select("annee,cout_horaire"),
    supabase.from("nf_baremes").select("prix_km"),
    supabase.from("prestation_lignes").select("id,affaire_id"),
    supabase.from("pilotage_affaires").select("id,imputation").eq("imputation", "PE"),
  ]);
  const contrats = ((k.data ?? []) as (Contrat & { actif: boolean })[]).map((x) => ({
    id: x.id,
    client_motif: x.client_motif,
    libelle: x.libelle,
    base_hebdo: n(x.base_hebdo),
    rythme_pe: Array.isArray(x.rythme_pe) ? x.rythme_pe.map(n) : [],
    tarifs: Array.isArray(x.tarifs) ? x.tarifs : [],
  }));
  const couts = new Map(((co.data ?? []) as { annee: number; cout_horaire: number | string }[]).map((c) => [c.annee, n(c.cout_horaire)]));
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const prix = ((ba.data ?? []) as { prix_km: number | string }[]).map((b) => n(b.prix_km)).filter((x) => x > 0);

  let peFacture: References["peFacture"] = null;
  try {
    const pe = new Set(((af.data ?? []) as { id: string }[]).map((a) => a.id));
    const lignesPE = new Set(((pl.data ?? []) as { id: string; affaire_id: string }[]).filter((l) => pe.has(l.affaire_id)).map((l) => l.id));
    const mois = await chargerTout<{ ligne_id: string; mois: string; montant_fige: number | string | null; heures_fige: number | string | null }>((a, b) =>
      supabase.from("prestation_mois").select("ligne_id,mois,montant_fige,heures_fige").eq("valide", true).gte("mois", debutMois).order("ligne_id").range(a, b)
    );
    let montant = 0;
    let heures = 0;
    for (const m of mois) {
      if (!lignesPE.has(m.ligne_id)) continue;
      montant += n(m.montant_fige);
      heures += n(m.heures_fige);
    }
    if (heures > 0) peFacture = { montant, heures };
  } catch {
    peFacture = null;
  }

  return {
    contrats,
    coutHoraire: coutHoraire(couts, aujourdhui),
    prixKmBareme: prix.length ? prix.reduce((t, x) => t + x, 0) / prix.length : null,
    peFacture,
  };
}
