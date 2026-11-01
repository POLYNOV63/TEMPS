import { supabase } from "@/lib/supabase";

/* ===============================================================
   COMMANDES PE / PI DORMANTES (SQL 71)

   Une PE / PI en cours est « dormante » quand sa famille (commande de
   base et avenants) n'a ni heure saisie au relevé, ni nouvelle commande
   reçue, depuis 3 mois. Une commande reçue récemment n'est donc jamais
   dormante, même sans heure encore saisie.
================================================================ */

export type Dormance = { depuis: string | null; jamais: boolean };

const baseDe = (numero: string) => (numero.match(/^\d+/)?.[0] ?? numero).replace(/^0+/, "");

export async function chargerDormantes(
  affaires: { id: string; numero: string; statut: string; imputation: string | null }[],
  mois = 3
): Promise<Map<string, Dormance>> {
  const res = new Map<string, Dormance>();
  const { data, error } = await supabase.rpc("pepi_activite_commandes");
  if (error || !data) return res;
  const familles = new Map<string, { derniere: string | null; commande: string | null }>();
  for (const r of data as { numero: string; derniere_saisie: string | null; date_commande: string | null }[]) {
    const k = baseDe(r.numero);
    const f = familles.get(k) ?? { derniere: null, commande: null };
    if (r.derniere_saisie && (!f.derniere || r.derniere_saisie > f.derniere)) f.derniere = r.derniere_saisie;
    if (r.date_commande && (!f.commande || r.date_commande > f.commande)) f.commande = r.date_commande;
    familles.set(k, f);
  }
  const d = new Date();
  d.setMonth(d.getMonth() - mois);
  const seuil = d.toISOString().slice(0, 10);
  for (const a of affaires) {
    if (a.statut !== "EN_COURS" || !(a.imputation === "PE" || a.imputation === "PI")) continue;
    const f = familles.get(baseDe(a.numero));
    if (!f) continue;
    const recent = [f.derniere, f.commande].filter((x): x is string => Boolean(x)).sort().pop();
    if (!recent || recent >= seuil) continue;
    res.set(a.id, { depuis: f.derniere, jamais: !f.derniere });
  }
  return res;
}

export const libelleDormance = (d: Dormance) =>
  d.jamais
    ? "jamais consommée"
    : `sans activité depuis ${new Date(`${d.depuis}T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
