import { supabase } from "@/lib/supabase";
import { chargerAnnuaire, chargerTout } from "@/lib/pilotageDonnees";
import { GROUPE_DISCIPLINE, mouvementsAttendus, mouvementsExcel, type Discipline, type Groupe } from "@/lib/finances";
import { chargerPrestationsMois } from "@/lib/facturationMois";
import { chargerDonneesRentabilite, type DonneesRentabilite } from "@/lib/rentabilite";
import { chargerSourcesCA, type SourcesCA } from "@/lib/caExercice";
import type { Collab } from "@/lib/pilotageCalculs";
import { chargerDormantes } from "@/lib/dormantes";
import { categorieDevis, numeroDevis } from "@/lib/suiviDevis";

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
     qui touchent la période, du début du mois à 4 semaines après aujourd'hui) ;
   - les activités de chaque affaire (heures chiffrées) et un bilan par
     activité : affaires en cours, chiffré, pointé, reste à faire ;
   - le délai : livraison prévue (échéance du planning, sinon « Délai estimé »
     du Suivi), retard si elle est passée, décalage face à l'échéance initiale.
   La charge (4 semaines, NEWSLETTER_A4) est lue par la page (useDisponibilitesActivites).
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
  // NEWSLETTER_DEVIS : pour les devis en cours et les intentions de commande
  numero_devis: string | null;
  base_devis: string | null;
  designation: string | null;
  client_id: string | null;
  redacteur_id: string | null;
  date_envoi: string | null;
  heures_total: number | string | null;
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
  previsionnel: Map<string, number>; // NEWSLETTER_CA : AAAA-MM -> € (prévisionnel saisi dans Finances)
  pepiPrevues: { mois: string; montant: number }[]; // NEWSLETTER_PROJETE : PE / PI pas encore clôturées (comme l'attendu de Finances)
  clients: Map<string, string>; // NEWSLETTER_DEVIS : suivi_clients id -> nom abrégé
  dormantes: Set<string>; // NEWSLETTER_PORTEFEUILLE : PE / PI dormantes (ids pilotage_affaires), écartées comme dans le Suivi des affaires
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
  const moisPEPI: string[] = [];
  for (let k = -12; k <= 18; k++) {
    const x = new Date();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() + k);
    moisPEPI.push(x.toISOString().slice(0, 7));
  }
  const [renta, suivi, sources, affaires, affectations, annuaire, prev, pepi, cl] = await Promise.all([
    chargerDonneesRentabilite(),
    chargerTout<LigneSuivi>((a, b) =>
      supabase
        .from("suivi_lignes")
        .select("cle,genre,statut,base_affaire,numero_affaire,disparue,date_ouverture,date_reception_commande,date_livraison,numero_devis,base_devis,designation,client_id,redacteur_id,date_envoi,heures_total")
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
    supabase.from("finances_previsionnel").select("mois,montant"),
    chargerPrestationsMois(moisPEPI).catch(() => new Map<string, { montant: number; cloture: boolean }[]>()),
    chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)).catch(
      () => [] as { id: string; nom_abrege: string }[]
    ),
  ]);
  const clients = new Map(cl.map((c) => [c.id, c.nom_abrege]));
  const pepiPrevues: DonneesNewsletter["pepiPrevues"] = [];
  for (const [m, liste] of pepi) for (const x of liste) if (!x.cloture && x.montant > 0.004) pepiPrevues.push({ mois: m, montant: x.montant });
  const previsionnel = new Map(((prev.data ?? []) as { mois: string; montant: number | string }[]).map((p) => [String(p.mois).slice(0, 7), Number(p.montant) || 0]));
  const dormantes = new Set((await chargerDormantes(affaires).catch(() => new Map<string, unknown>())).keys());
  return { renta, suivi, sources, affaires, affectations, annuaire, previsionnel, pepiPrevues, clients, dormantes };
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
  numero: string; // « CBE 1587 », ou « DBE 2345 » pour une intention sans n° de commande
  client: string;
  designation: string;
  montant: number;
  chiffre: number;
  pointe: number;
  avancement: number | null; // 0..1+
  activites: { groupe: Groupe; chiffre: number; pointe: number }[];
  equipe: string[];
  intention: boolean; // toute la famille est en « Intention de commande »
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

/* NEWSLETTER_DEVIS : un devis ouvert (en rédaction) ou envoyé (en attente de réponse), comme au Suivi des devis */
export type DevisEnCours = {
  numero: string; // DBE…
  categorie: "OUVERT" | "ENVOYE";
  client: string;
  designation: string;
  redacteur: string;
  ouverture: string | null;
  envoi: string | null;
  attente: number; // jours depuis l'envoi (devis envoyé), 0 sinon
  heures: number; // heures chiffrées
};

export type BilanActivite = { groupe: Groupe; nb: number; chiffre: number; pointe: number; reste: number };

export type Newsletter = {
  mois: string; // AAAA-MM
  commandes: { nombre: number; montant: number };
  livrees: { nombre: number; montant: number };
  devis: number;
  ca: number;
  /* NEWSLETTER_PROJETE (20/11/2026) : CA de l'exercice en cours (facturé, projeté, prévu) ; CA projeté du mois choisi et du suivant.
     Projeté = facturé + attendu, comme l'atterrissage de Finances (forfaits non livrés au mois de leur délai estimé, en retard sur
     le mois en courant ; PE / PI pas encore clôturées). Prévu = prévisionnel saisi dans Finances. */
  exercice: { libelle: string; facture: number; projete: number; prevu: number | null };
  projections: { mois: string; facture: number; projete: number; prevu: number | null }[];
  enCours: AffaireEnCours[];
  nbEnCours: number;
  nbIntentions: number;
  devisEnCours: DevisEnCours[];
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
  const moisCourant = aujourdhui.slice(0, 7);
  const viaReleve = new Set(d.sources.releve.map((r) => r.base));
  const mouvements = mouvementsExcel(d.renta.lignesFin, (b) => viaReleve.has(sansZeros(b)));
  const caDe = (m: string) =>
    mouvements.filter((x) => String(x.date ?? "").slice(0, 7) === m).reduce((t, x) => t + x.montant, 0) +
    d.sources.releve.filter((r) => r.mois === m).reduce((t, r) => t + r.montant, 0) +
    (m < moisCourant ? d.sources.historique.filter((h) => h.mois === m).reduce((t, h) => t + h.montant, 0) : 0) +
    d.sources.ajustements.filter((a) => a.mois === m).reduce((t, a) => t + a.montant, 0);
  const ca = caDe(mois);
  const decaleMois = (m: string, k: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1)).toISOString().slice(0, 7);
  const attendus = mouvementsAttendus(d.renta.lignesFin, aujourdhui).mouvements;
  const attenduDe = (m: string) =>
    attendus.filter((x) => String(x.date ?? "").slice(0, 7) === m).reduce((t, x) => t + x.montant, 0) +
    d.pepiPrevues.filter((p) => p.mois === m).reduce((t, p) => t + p.montant, 0);
  const prevuDe = (m: string) => (d.previsionnel.has(m) ? (d.previsionnel.get(m) ?? 0) : null);
  const projection = (m: string) => {
    const facture = caDe(m);
    return { mois: m, facture, projete: facture + attenduDe(m), prevu: prevuDe(m) };
  };
  // l'exercice EN COURS (novembre → octobre, d'après aujourd'hui), ses 12 mois
  const anneeEx = Number(moisCourant.slice(5, 7)) >= 11 ? Number(moisCourant.slice(0, 4)) : Number(moisCourant.slice(0, 4)) - 1;
  const moisEx = Array.from({ length: 12 }, (_, k) => decaleMois(`${anneeEx}-11`, k)).map(projection);
  const prevusEx = moisEx.map((x) => x.prevu);

  // planning : affaires par n° de base ; équipe = affectations qui touchent la période (début du mois → 4 semaines après aujourd'hui)
  const debutPeriode = `${mois}-01`;
  const finMois = jourISO(new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)));
  const horizon = plusJours(aujourdhui, 28);
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

  /* NEWSLETTER_PORTEFEUILLE (20/11/2026) : les affaires en cours sont celles du Suivi des affaires (portefeuille,
     /pilotage) : commandes CBE au forfait (hors PE / PI) « en cours » ou « intention de commande », une ligne par famille
     (commande de base + avenants). Client, désignation, heures chiffrées et activités : Suivi d'affaire BE. */
  const lignesFamille = new Map<string, LigneSuivi[]>();
  for (const l of d.suivi) {
    if (!commande(l) || l.statut === "Commande annulée") continue;
    const b = sansZeros(l.base_affaire);
    if (b) lignesFamille.set(b, [...(lignesFamille.get(b) ?? []), l]);
  }
  const enCours: AffaireEnCours[] = [];
  for (const [b, as] of planningParBase) {
    const ouvertes = as.filter((a) => !estPEPI(a.imputation) && (a.statut === "EN_COURS" || a.statut === "EN_ATTENTE"));
    if (ouvertes.length === 0 || as.some((a) => estPEPI(a.imputation))) continue;
    const ls = lignesFamille.get(b) ?? [];
    const laBase = ls.find((l) => l.genre === "BASE") ?? ls[0];
    const fb = laBase ? fin.get(laBase.cle) : undefined;
    const montant = ls.reduce((t, l) => t + montantDe(l.cle), 0);
    const chiffre = ls.reduce((t, l) => t + (fin.get(l.cle)?.heures_total ?? 0), 0);
    const g = d.renta.realiseParBase.get(b);
    const pointe = (g ? Object.values(g).reduce((t, x) => t + x, 0) : 0) + (d.renta.trajetsParBase.get(b) ?? 0);
    // heures chiffrées par activité (groupes de Finances)
    const parGroupe = new Map<Groupe, number>();
    for (const l of ls) {
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
    const estimees = ls
      .filter((l) => !FERMES.has(l.statut ?? ""))
      .map((l) => fin.get(l.cle)?.date_estimee)
      .filter((x): x is string => Boolean(x));
    const basePil = ouvertes.find((a) => baseDe(a.numero) === b && !a.numero.toUpperCase().includes("R")) ?? ouvertes[0];
    enCours.push({
      base: b,
      numero: `CBE ${b}`,
      client: fb?.client ?? "",
      designation: fb?.designation || basePil.designation || "",
      montant,
      chiffre,
      pointe,
      avancement: chiffre > 0.5 ? pointe / chiffre : null,
      activites,
      equipe: equipeDe(b),
      intention: ouvertes.every((a) => a.statut === "EN_ATTENTE"),
      ...delaiDe(b, estimees),
    });
  }
  /* NEWSLETTER_DEVIS : les intentions de commande du Suivi d'affaire BE qui ne sont pas (encore) au planning, avec ou sans
     n° de commande : une ligne par affaire (n° de base), sinon par devis */
  const dejaLa = new Set(enCours.map((a) => a.base));
  const intentionsExcel = new Map<string, LigneSuivi[]>();
  for (const l of d.suivi) {
    if (l.disparue || l.statut !== "Intention de commande" || !(l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT")) continue;
    const b = l.numero_affaire ? sansZeros(l.base_affaire) : "";
    const cle = b ? b : `D:${numeroDevis(l.base_devis) ?? numeroDevis(l.numero_devis) ?? l.cle}`;
    if (b && dejaLa.has(b)) continue;
    intentionsExcel.set(cle, [...(intentionsExcel.get(cle) ?? []), l]);
  }
  for (const [cle, ls] of intentionsExcel) {
    const b = cle.startsWith("D:") ? "" : cle;
    const l0 = ls.find((l) => l.genre === "BASE") ?? ls[0];
    const chiffre = ls.reduce((t, l) => t + (fin.get(l.cle)?.heures_total ?? (Number(l.heures_total) || 0)), 0);
    const g = b ? d.renta.realiseParBase.get(b) : undefined;
    const pointe = b ? (g ? Object.values(g).reduce((t, x) => t + x, 0) : 0) + (d.renta.trajetsParBase.get(b) ?? 0) : 0;
    const parGroupe = new Map<Groupe, number>();
    for (const l of ls) {
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
    const estimees = ls.map((l) => fin.get(l.cle)?.date_estimee).filter((x): x is string => Boolean(x));
    enCours.push({
      base: b || cle.slice(2),
      numero: b ? `CBE ${b}` : cle.slice(2).toUpperCase().startsWith("DBE") ? cle.slice(2) : `DBE ${cle.slice(2)}`,
      client: (l0.client_id ? d.clients.get(l0.client_id) : undefined) ?? fin.get(l0.cle)?.client ?? "",
      designation: l0.designation ?? fin.get(l0.cle)?.designation ?? "",
      montant: ls.reduce((t, l) => t + montantDe(l.cle), 0),
      chiffre,
      pointe,
      avancement: chiffre > 0.5 && b ? pointe / chiffre : null,
      activites,
      equipe: b ? equipeDe(b) : [],
      intention: true,
      ...delaiDe(b, estimees),
    });
  }
  // tri : par client, puis n° d'affaire
  enCours.sort((x, y) => (x.client || "~").localeCompare(y.client || "~", "fr") || x.numero.localeCompare(y.numero, "fr", { numeric: true }));

  /* NEWSLETTER_DEVIS : les devis ouverts ou envoyés (mêmes règles que le Suivi des devis : un devis = un n° DBE, son statut
     est celui de la commande s'il y en a une, sinon celui du devis) */
  const parDevis = new Map<string, LigneSuivi[]>();
  for (const l of d.suivi) {
    if (l.disparue || !(l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT")) continue;
    const num = numeroDevis(l.base_devis) ?? numeroDevis(l.numero_devis);
    if (num) parDevis.set(num, [...(parDevis.get(num) ?? []), l]);
  }
  const devisEnCours: DevisEnCours[] = [];
  for (const [numero, ls] of parDevis) {
    const cmd = (g: string) => ls.find((x) => x.genre === g && x.statut !== "Devis perdu");
    const l = cmd("BASE") ?? cmd("AVENANT") ?? ls.find((x) => x.genre === "DEVIS") ?? ls[0];
    const cat = categorieDevis(l.statut, l.genre, false);
    if (cat !== "OUVERT" && cat !== "ENVOYE") continue;
    const ouverture = ls.map((x) => x.date_ouverture).filter((x): x is string => Boolean(x)).sort()[0]?.slice(0, 10) ?? null;
    const envoi = (l.date_envoi ?? ls.map((x) => x.date_envoi).filter((x): x is string => Boolean(x)).sort()[0] ?? null)?.slice(0, 10) ?? null;
    devisEnCours.push({
      numero,
      categorie: cat,
      client: (l.client_id ? d.clients.get(l.client_id) : undefined) ?? "",
      designation: l.designation ?? "",
      redacteur: l.redacteur_id ? nomCourt(collabs.get(l.redacteur_id)) : "",
      ouverture,
      envoi,
      attente: cat === "ENVOYE" && envoi ? Math.max(0, ecartJours(aujourdhui, envoi)) : 0,
      heures: ls.reduce((t, x) => t + (Number(x.heures_total) || 0), 0),
    });
  }
  // les envoyés d'abord (les plus anciens en tête), puis ceux en rédaction
  devisEnCours.sort(
    (x, y) =>
      (x.categorie === "ENVOYE" ? 0 : 1) - (y.categorie === "ENVOYE" ? 0 : 1) ||
      (x.categorie === "ENVOYE" ? (x.envoi ?? "").localeCompare(y.envoi ?? "") : (x.ouverture ?? "").localeCompare(y.ouverture ?? "")) ||
      x.numero.localeCompare(y.numero, "fr", { numeric: true })
  );

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

  // prestations PE / PI : celles du relevé (Suivi des affaires, onglet PE / PI) en cours et non dormantes, ou facturées dans le mois
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
  for (const [b, as] of planningParBase) if (as.some((a) => estPEPI(a.imputation) && a.statut === "EN_COURS" && !d.dormantes.has(a.id))) basesPEPI.add(b);
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
  prestations.sort((x, y) => x.imputation.localeCompare(y.imputation) || (x.client || "~").localeCompare(y.client || "~", "fr") || Number(x.base) - Number(y.base));

  return {
    mois,
    commandes: { nombre: recues.length, montant: recues.reduce((t, l) => t + montantDe(l.cle), 0) },
    livrees: { nombre: livrees.length, montant: livrees.reduce((t, l) => t + montantDe(l.cle), 0) },
    devis,
    ca,
    exercice: {
      libelle: `${anneeEx}-${anneeEx + 1}`,
      facture: moisEx.reduce((t, x) => t + x.facture, 0),
      projete: moisEx.reduce((t, x) => t + x.projete, 0),
      prevu: prevusEx.some((v) => v !== null) ? prevusEx.reduce<number>((t, v) => t + (v ?? 0), 0) : null,
    },
    projections: [projection(mois), projection(decaleMois(mois, 1))],
    enCours,
    nbEnCours: enCours.length,
    nbIntentions: enCours.filter((a) => a.intention).length,
    devisEnCours,
    montantEnCours: enCours.reduce((t, a) => t + a.montant, 0),
    nbRetard: enCours.filter((a) => a.retard > 0).length,
    parActivite,
    prestations,
    caPrestationsMois: prestations.reduce((t, p) => t + p.caMois, 0),
  };
}
