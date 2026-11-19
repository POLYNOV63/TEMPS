import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { mouvementsExcel, type LigneFin } from "@/lib/finances";

/* ===============================================================
   CA RÉEL D'UN EXERCICE (CA_REEL_EXERCICE, PLG, 19/11/2026)
   Le chiffre d'affaires réalisé d'un exercice (novembre → octobre), avec
   les règles de la page Finances, pour que le Simulateur de rentabilité
   puisse « coller » à l'exercice passé :
   - forfaits : livraisons et échéances du Suivi d'affaire BE à leur date
     (mouvementsExcel) ; une famille suivie au relevé n'y est pas reprise ;
   - PE / PI / intergroupe : mois validés du relevé (montant figé) ;
   - historique du Suivi des prestations (lignes non rattachées, CAS
     compris) : mois passés ;
   - ajustements saisis à la main dans Finances (finances_ajustements).
   Ne compte pas le prévisionnel ni les PE / PI pas encore validées.
================================================================ */

export type SourcesCA = {
  releve: { base: string; mois: string; montant: number }[];
  historique: { mois: string; montant: number }[];
  ajustements: { mois: string; montant: number }[];
};

export async function chargerSourcesCA(): Promise<SourcesCA> {
  const [pm, pl, af, hi, aj] = await Promise.all([
    chargerTout<{ ligne_id: string; mois: string; montant_fige: number | string | null }>((a, b) =>
      supabase.from("prestation_mois").select("ligne_id,mois,montant_fige").eq("valide", true).order("ligne_id").range(a, b)
    ),
    chargerTout<{ id: string; affaire_id: string }>((a, b) => supabase.from("prestation_lignes").select("id,affaire_id").order("id").range(a, b)),
    chargerTout<{ id: string; numero: string }>((a, b) => supabase.from("pilotage_affaires").select("id,numero").eq("type", "CBE").order("id").range(a, b)),
    chargerTout<{ mois: string; montant: number | string | null }>((a, b) => supabase.from("prestation_historique").select("mois,montant").order("id").range(a, b)).catch(
      () => [] as { mois: string; montant: number | string | null }[]
    ),
    supabase.from("finances_ajustements").select("mois,montant"),
  ]);
  const affaire = new Map(af.map((a) => [a.id, a.numero]));
  const ligne = new Map(pl.map((l) => [l.id, l.affaire_id]));
  const releve: SourcesCA["releve"] = [];
  for (const m of pm) {
    const numero = affaire.get(ligne.get(m.ligne_id) ?? "");
    if (!numero) continue;
    releve.push({ base: (numero.match(/^\d+/)?.[0] ?? numero).replace(/^0+/, ""), mois: String(m.mois).slice(0, 7), montant: Number(m.montant_fige) || 0 });
  }
  return {
    releve,
    historique: hi.map((h) => ({ mois: String(h.mois).slice(0, 7), montant: Number(h.montant) || 0 })),
    ajustements: ((aj.data ?? []) as { mois: string; montant: number | string }[]).map((a) => ({ mois: String(a.mois).slice(0, 7), montant: Number(a.montant) || 0 })),
  };
}

export function caExercice(lignesFin: LigneFin[], s: SourcesCA, exercice: number) {
  const debut = `${exercice}-11`;
  const fin = `${exercice + 1}-10`;
  const dans = (m: string) => m.slice(0, 7) >= debut && m.slice(0, 7) <= fin;
  const moisCourant = new Date().toISOString().slice(0, 7);
  const viaReleve = new Set(s.releve.map((r) => r.base));
  const forfaits = mouvementsExcel(lignesFin, (b) => viaReleve.has(b.replace(/^0+/, "")))
    .filter((m) => dans(m.date))
    .reduce((t, m) => t + m.montant, 0);
  const releve = s.releve.filter((r) => dans(r.mois)).reduce((t, r) => t + r.montant, 0);
  const historique = s.historique.filter((h) => dans(h.mois) && h.mois < moisCourant).reduce((t, h) => t + h.montant, 0);
  const ajustements = s.ajustements.filter((a) => dans(a.mois)).reduce((t, a) => t + a.montant, 0);
  return { total: forfaits + releve + historique + ajustements, forfaits, releve, historique, ajustements };
}
