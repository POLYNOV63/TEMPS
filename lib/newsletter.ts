import { supabase } from "@/lib/supabase";
import { chargerAnnuaire, chargerTout } from "@/lib/pilotageDonnees";
import { GROUPE_DISCIPLINE, mouvementsExcel, type Discipline, type Groupe } from "@/lib/finances";
import { chargerDonneesRentabilite, type DonneesRentabilite } from "@/lib/rentabilite";
import { chargerSourcesCA, type SourcesCA } from "@/lib/caExercice";
import type { Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   NEWSLETTER DU MOIS (NEWSLETTER, PLG, 20/11/2026)
   Les chiffres de l'image mensuelle, pour l'équipe (montants compris) :
   - le mois en chiffres : commandes reçues (nombre, montant), affaires
     livrées (nombre, montant), CA facturé (règles de Finances), devis
     ouverts ;
   - les affaires en cours (forfaits, hors PE / PI) : client, désignation,
     montant commandé, avancement = heures pointées ÷ heures chiffrées de la
     famille (commande + avenants), livraison prévue.
   Sources : Suivi d'affaire BE, relevé PE / PI, feuilles d'heures.

   NEWSLETTER_V2 (PLG, 20/11/2026) : en plus
   - les prestations PE / PI en cours : facturé du mois (relevé validé ou
     historique), heures, fin prévue ;
   - qui travaille sur chaque affaire : les personnes au planning (affectations
     qui touchent la période, du début du mois à 8 semaines après aujourd'hui) ;
   - les activités de chaque affaire (heures chiffrées) et un bilan par
     activité : affaires en cours, chiffré, pointé, reste à faire ;
   - le délai : livraison prévue (échéance du planning, sinon « Délai estimé »
     du Suivi), retard si elle est passée, décalage face à l'échéance initiale.
   La charge (8 semaines) est lue par la page (useDisponibilitesActivites).
================================================================ */

type LigneSuivi = {
  cle: string;
  genre: string;
  statut: string | null;
  base_affaire: string | null;
  numero_affaire: string | null;
  disparue: boolean;
  date_ouverture: string | null;
  date_reception_commande: string | null;
  date_livraison: string | null;
};

type AffairePlanning = {
  id: string;
  numero: string;
  imputation: string | null;
  designation: string | null;
  statut: string;
  echeance: string | null;
  echeance_initiale: string | null;
};
type AffectationCourte = { affaire_id: string; collaborateur_id: string; date_debut: string; date_fin: string };

export type DonneesNewsletter = {
  renta: DonneesRentabilite;
  suivi: LigneSuivi[];
  sources: SourcesCA;
  affaires: AffairePlanning[];
  affectations: AffectationCourte[];
  annuaire: Collab[];
};

const jourISO = (d: Date) => d.toISOString().slice(0, 10);
const plusJours = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return jourISO(d);
};
const ecartJours = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

export async function chargerNewsletter(): Promise<DonneesNewsletter> {
  const depuis = plusJours(jourISO(new Date()), -400);
  const [renta, suivi, sources, affaires, affectations, annuaire] = await Promise.all([
    chargerDonneesRentabilite(),
    chargerTout<LigneSuivi>((a, b) =>
      supabase
        .from("suivi_lignes")
        .select("cle,genre,statut,base_affaire,numero_affaire,disparue,date_ouverture,date_reception_commande,date_livraison")
        .order("cle")
        .range(a, b)
    ),
    chargerSourcesCA(),
    chargerTout<AffairePlanning>((a, b) =>
      supabase.from("pilotage_affaires").select("id,numero,imputation,designation,statut,echeance,echeance_initiale").eq("type", "CBE").order("id").range(a, b)
    ),
    chargerTout<AffectationCourte>((a, b) =>
      supabase.from("pilotage_affectations").select("affaire_id,collaborateur_id,date_debut,date_fin").gte("date_fin", depuis).order("id").range(a, b)
    ).catch(() => [] as AffectationCourte[]),
    chargerAnnuaire({ inactifs: true }).catch(() => chargerAnnuaire()),
  ]);
  return { renta, suivi, sources, affaires, affectations, annuaire };
}

/* les activités montrées (le négoce et le non ventilé n'ont pas d'équipe) */
export const GROUPES_NEWSLETTER: Groupe[] = ["Méca", "Calcul", "Elec / Pneu", "Scan"];

export type Delai = {
  livraison: string | null;
  retard: number; // jours de retard (livraison passée), 0 sinon
  decalage: number; // jours de décalage face à l'échéance initiale (> 0 : repoussée)
};

export type AffaireEnCours = Delai & {
  base: string;
  client: string;
  designation: string;
  montant: number;
  chiffre: number;
  pointe: number;
  avancement: number | null; // 0..1+
  activites: { groupe: Groupe; chiffre: number; pointe: number }[];
  equipe: string[];
};

export type PrestationEnCours = Delai & {
  base: string;
  imputation: "PE" | "PI";
  client: string;
  designation: string;
  caMois: number;
  heuresMois: number;
  equipe: string[];
};

export type BilanActivite = { groupe: Groupe; nb: number; chiffre: number; pointe: number; reste: number };

export type Newsletter = {
  mois: string; // AAAA-MM
  commandes: { nombre: number; montant: number };
  livrees: { nombre: number; montant: number };
  devis: number;
  ca: number;
  enCours: AffaireEnCours[];
  nbEnCours: number;
  montantEnCours: number;
  nbRetard: number;
  parActivite: BilanActivite[];
  prestations: PrestationEnCours[];
  caPrestationsMois: number;
};

const FERMES = new Set(["Livrée", "Commande annulée", "Devis perdu"]);
const estPEPI = (imp: string | null | undefined) => imp === "PE" || imp === "PI";
const sansZeros = (b: string | null | undefined) => String(b ?? "").replace(/^0+/, "");
const baseDe = (numero: string) => sansZeros(String(numero ?? "").toUpperCase().replace(/^CBE\s*/, "").match(/^\d+/)?.[0] ?? "");

/* « Prénom N. », sinon le trigramme */
export const nomCourt = (c: Collab | undefined) =>
  !c ? "?" : c.prenom ? `${c.prenom.trim()}${c.nom ? ` ${c.nom.trim().charAt(0).toUpperCase()}.` : ""}` : (c.trigramme ?? "?");

export function calculerNewsletter(d: DonneesNewsletter, mois: string): Newsletter {
  const aujourdhui = jourISO(new Date());
  const dans = (date: string | null | undefined) => Boolean(date) && String(date).slice(0, 7) === mois;
  const fin = new Map(d.renta.lignesFin.map((l) => [l.cle, l]));
  const montantDe = (cle: string) => fin.get(cle)?.m.montant ?? 0;
  const commande = (l: LigneSuivi) => (l.genre === "BASE" || l.genre === "AVENANT") && Boolean(l.numero_affaire) && !l.disparue;

  // le mois en chiffres
  const recues = d.suivi.filter((l) => commande(l) && l.statut !== "Commande annulée" && dans(l.date_reception_commande));
  const livrees = d.suivi.filter((l) => commande(l) && l.statut === "Livrée" && dans(l.date_livraison));
  const devis = d.suivi.filter((l) => (l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT") && !l.disparue && dans(l.date_ouverture)).length;

  // CA facturé du mois, règles de Finances (forfaits livrés, relevé validé, historique, ajustements)
  const viaReleve = new Set(d.sources.releve.map((r) => r.base));
  const ca =
    mouvementsExcel(d.renta.lignesFin, (b) => viaReleve.has(sansZeros(b)))
      .filter((m) => dans(m.date))
      .reduce((t, m) => t + m.montant, 0) +
    d.sources.releve.filter((r) => r.mois === mois).reduce((t, r) => t + r.montant, 0) +
    d.sources.historique.filter((h) => h.mois === mois).reduce((t, h) => t + h.montant, 0) +
    d.sources.ajustements.filter((a) => a.mois === mois).reduce((t, a) => t + a.montant, 0);

  // planning : affaires par n° de base ; équipe = affectations qui touchent la période (début du mois → 8 semaines après aujourd'hui)
  const debutPeriode = `${mois}-01`;
  const finMois = jourISO(new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)));
  const horizon = plusJours(aujourdhui, 56);
  const finPeriode = finMois > horizon ? finMois : horizon;
  const planningParBase = new Map<string, AffairePlanning[]>();
  const baseAffaire = new Map<string, string>();
  for (const a of d.affaires) {
    const b = baseDe(a.numero);
    if (!b) continue;
    baseAffaire.set(a.id, b);
    planningParBase.set(b, [...(planningParBase.get(b) ?? []), a]);
  }
  const collabs = new Map(d.annuaire.map((c) => [c.id, c]));
  const equipeParBase = new Map<string, Set<string>>();
  for (const x of d.affectations) {
    if (!x.collaborateur_id || x.date_fin < debutPeriode || x.date_debut > finPeriode) continue;
    const b = baseAffaire.get(x.affaire_id);
    if (!b) continue;
    const e = equipeParBase.get(b) ?? new Set<string>();
    e.add(x.collaborateur_id);
    equipeParBase.set(b, e);
  }
  const equipeDe = (b: string) =>
    [...(equipeParBase.get(b) ?? [])].map((id) => nomCourt(collabs.get(id))).sort((x, y) => x.localeCompare(y, "fr"));

  /* délai : échéance du planning (affaires non livrées de la famille), sinon « Délai estimé » du Suivi */
  const delaiDe = (b: string, estimees: string[]): Delai => {
    const ouvertes = (planningParBase.get(b) ?? []).filter((a) => a.statut !== "LIVREE" && a.statut !== "ABANDONNEE");
    const ech = ouvertes.map((a) => a.echeance).filter((x): x is string => Boolean(x)).map((x) => x.slice(0, 10)).sort();
    const init = ouvertes.map((a) => a.echeance_initiale).filter((x): x is string => Boolean(x)).map((x) => x.slice(0, 10)).sort();
    const est = estimees.map((x) => x.slice(0, 10)).sort();
    const l = ech.length ? ech[ech.length - 1] : est.length ? est[est.length - 1] : null;
    return {
      livraison: l,
      retard: l && l < aujourdhui ? ecartJours(aujourdhui, l) : 0,
      decalage: l && init.length ? Math.max(0, ecartJours(l, init[init.length - 1])) : 0,
    };
  };

  // affaires en cours : familles de forfaits avec au moins une commande ouverte
  const familles = new Map<string, LigneSuivi[]>();
  for (const l of d.suivi) {
    if (!commande(l)) continue;
    const b = sansZeros(l.base_affaire);
    if (!b) continue;
    familles.set(b, [...(familles.get(b) ?? []), l]);
  }
  const enCours: AffaireEnCours[] = [];
  for (const [b, ls] of familles) {
    const actives = ls.filter((l) => l.statut !== "Commande annulée");
    if (!actives.some((l) => !FERMES.has(l.statut ?? ""))) continue;
    const laBase = actives.find((l) => l.genre === "BASE") ?? actives[0];
    const fb = fin.get(laBase.cle);
    if (estPEPI(fb?.imputation) || actives.some((l) => estPEPI(fin.get(l.cle)?.imputation))) continue;
    const montant = actives.reduce((t, l) => t + montantDe(l.cle), 0);
    const chiffre = actives.reduce((t, l) => t + (fin.get(l.cle)?.heures_total ?? 0), 0);
    const g = d.renta.realiseParBase.get(b);
    const pointe = (g ? Object.values(g).reduce((t, x) => t + x, 0) : 0) + (d.renta.trajetsParBase.get(b) ?? 0);
    // heures chiffrées par activité (groupes de Finances)
    const parGroupe = new Map<Groupe, number>();
    for (const l of actives) {
      const h = fin.get(l.cle)?.heures;
      if (!h) continue;
      for (const [disc, v] of Object.entries(h) as [Discipline, number][]) {
        const gr = GROUPE_DISCIPLINE[disc];
        if (v > 0) parGroupe.set(gr, (parGroupe.get(gr) ?? 0) + v);
      }
    }
    const activites = GROUPES_NEWSLETTER.filter((gr) => (parGroupe.get(gr) ?? 0) > 0.5)
      .map((gr) => ({ groupe: gr, chiffre: parGroupe.get(gr) ?? 0, pointe: g?.[gr] ?? 0 }))
      .sort((x, y) => y.chiffre - x.chiffre);
    const estimees = actives
      .filter((l) => !FERMES.has(l.statut ?? ""))
      .map((l) => fin.get(l.cle)?.date_estimee)
      .filter((x): x is string => Boolean(x));
    enCours.push({
      base: b,
      client: fb?.client ?? "",
      designation: fb?.designation ?? "",
      montant,
      chiffre,
      pointe,
      avancement: chiffre > 0.5 ? pointe / chiffre : null,
      activites,
      equipe: equipeDe(b),
      ...delaiDe(b, estimees),
    });
  }
  enCours.sort((x, y) => y.montant - x.montant);

  // bilan par activité : les affaires en cours qui ont des heures chiffrées dans l'activité
  const parActivite: BilanActivite[] = GROUPES_NEWSLETTER.map((gr) => {
    const ls = enCours.flatMap((a) => a.activites.filter((x) => x.groupe === gr));
    return {
      groupe: gr,
      nb: ls.length,
      chiffre: ls.reduce((t, x) => t + x.chiffre, 0),
      pointe: ls.reduce((t, x) => t + x.pointe, 0),
      reste: ls.reduce((t, x) => t + Math.max(0, x.chiffre - x.pointe), 0),
    };
  }).filter((x) => x.nb > 0);

  // prestations PE / PI : en cours au planning, ou facturées dans le mois
  const caMois = new Map<string, { ca: number; h: number; imp: string }>();
  for (const p of d.renta.prestations) {
    if (p.mois !== mois) continue;
    const e = caMois.get(p.base) ?? { ca: 0, h: 0, imp: p.imputation };
    e.ca += p.ca;
    e.h += p.hFact;
    caMois.set(p.base, e);
  }
  const clientDeBase = new Map<string, { client: string; designation: string }>();
  for (const l of d.renta.lignesFin)
    if (l.genre === "BASE" && l.base_affaire) clientDeBase.set(sansZeros(l.base_affaire), { client: l.client ?? "", designation: l.designation ?? "" });
  const basesPEPI = new Set<string>();
  for (const [b, as] of planningParBase) if (as.some((a) => estPEPI(a.imputation) && a.statut === "EN_COURS")) basesPEPI.add(b);
  for (const b of caMois.keys()) basesPEPI.add(b);
  const prestations: PrestationEnCours[] = [...basesPEPI].map((b) => {
    const as = (planningParBase.get(b) ?? []).filter((a) => estPEPI(a.imputation));
    const m = caMois.get(b);
    const imp = (as.find((a) => a.statut === "EN_COURS")?.imputation ?? m?.imp ?? as[0]?.imputation) === "PI" ? "PI" : "PE";
    const cb = clientDeBase.get(b);
    return {
      base: b,
      imputation: imp,
      client: cb?.client ?? "",
      designation: cb?.designation || as[0]?.designation || "",
      caMois: m?.ca ?? 0,
      heuresMois: m?.h ?? 0,
      equipe: equipeDe(b),
      ...delaiDe(b, []),
    };
  });
  prestations.sort((x, y) => y.caMois - x.caMois || y.equipe.length - x.equipe.length);

  return {
    mois,
    commandes: { nombre: recues.length, montant: recues.reduce((t, l) => t + montantDe(l.cle), 0) },
    livrees: { nombre: livrees.length, montant: livrees.reduce((t, l) => t + montantDe(l.cle), 0) },
    devis,
    ca,
    enCours,
    nbEnCours: enCours.length,
    montantEnCours: enCours.reduce((t, a) => t + a.montant, 0),
    nbRetard: enCours.filter((a) => a.retard > 0).length,
    parActivite,
    prestations,
    caPrestationsMois: prestations.reduce((t, p) => t + p.caMois, 0),
  };
}
