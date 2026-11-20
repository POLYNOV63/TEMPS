import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { mouvementsExcel } from "@/lib/finances";
import { chargerDonneesRentabilite, type DonneesRentabilite } from "@/lib/rentabilite";
import { chargerSourcesCA, type SourcesCA } from "@/lib/caExercice";

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

export type DonneesNewsletter = { renta: DonneesRentabilite; suivi: LigneSuivi[]; sources: SourcesCA };

export async function chargerNewsletter(): Promise<DonneesNewsletter> {
  const [renta, suivi, sources] = await Promise.all([
    chargerDonneesRentabilite(),
    chargerTout<LigneSuivi>((a, b) =>
      supabase
        .from("suivi_lignes")
        .select("cle,genre,statut,base_affaire,numero_affaire,disparue,date_ouverture,date_reception_commande,date_livraison")
        .order("cle")
        .range(a, b)
    ),
    chargerSourcesCA(),
  ]);
  return { renta, suivi, sources };
}

export type AffaireEnCours = {
  base: string;
  client: string;
  designation: string;
  montant: number;
  chiffre: number;
  pointe: number;
  avancement: number | null; // 0..1+
  livraison: string | null;
};

export type Newsletter = {
  mois: string; // AAAA-MM
  commandes: { nombre: number; montant: number };
  livrees: { nombre: number; montant: number };
  devis: number;
  ca: number;
  enCours: AffaireEnCours[];
  nbEnCours: number;
  montantEnCours: number;
};

const FERMES = new Set(["Livrée", "Commande annulée", "Devis perdu"]);
const estPEPI = (imp: string | null | undefined) => imp === "PE" || imp === "PI";
const sansZeros = (b: string | null | undefined) => String(b ?? "").replace(/^0+/, "");

export function calculerNewsletter(d: DonneesNewsletter, mois: string): Newsletter {
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
    const prevues = actives
      .filter((l) => !FERMES.has(l.statut ?? ""))
      .map((l) => fin.get(l.cle)?.date_estimee)
      .filter((x): x is string => Boolean(x))
      .sort();
    enCours.push({
      base: b,
      client: fb?.client ?? "",
      designation: fb?.designation ?? "",
      montant,
      chiffre,
      pointe,
      avancement: chiffre > 0.5 ? pointe / chiffre : null,
      livraison: prevues.length ? prevues[prevues.length - 1] : null,
    });
  }
  enCours.sort((x, y) => y.montant - x.montant);

  return {
    mois,
    commandes: { nombre: recues.length, montant: recues.reduce((t, l) => t + montantDe(l.cle), 0) },
    livrees: { nombre: livrees.length, montant: livrees.reduce((t, l) => t + montantDe(l.cle), 0) },
    devis,
    ca,
    enCours,
    nbEnCours: enCours.length,
    montantEnCours: enCours.reduce((t, a) => t + a.montant, 0),
  };
}
