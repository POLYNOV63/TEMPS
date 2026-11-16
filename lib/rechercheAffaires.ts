import { supabase } from "@/lib/supabase";
import { chargerAffaires, chargerTout } from "@/lib/pilotageDonnees";

/* ===============================================================
   RECHERCHE D'AFFAIRES COMMUNE (RECHERCHE_AFFAIRES)
   La même recherche dans la Fiche affaire et le Suivi des affaires :
   n° de commande (CBE) ou de devis (DBE, y compris le devis d'origine
   d'une commande), client, descriptif, trigramme du responsable ou du
   rédacteur du devis. Plusieurs mots = tous doivent se trouver
   (« michelin mmo », « 1604 », « dbe 2835 »…). Accents et majuscules
   ignorés.
================================================================ */

export type EntreeAffaire = {
  type: "CBE" | "DBE";
  numero: string; // n° de base, sans zéros devant (« 1604 »)
  designation: string;
  client: string;
  devis: string | null; // pour une commande : son devis d'origine
  responsable: string; // trigramme
  redacteur: string; // trigramme du rédacteur du devis (Suivi d'affaire)
  statut: string | null;
  imputation: string | null;
  texte: string; // tout ce qui se cherche, normalisé
};

export function normaliserRecherche(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const sansZeros = (n: string) => n.replace(/^0+(?=\d)/, "");
const baseDe = (numero: string | null | undefined) => sansZeros(String(numero ?? "").toUpperCase().replace(/^\s*(CBE|DBE)\s*/, "").match(/^\d+/)?.[0] ?? "");

/* les mots de la requête ; « CBE 1604 », « cbe1604 » et « 01604 » reviennent au même */
function motsDe(requete: string): string[] {
  return normaliserRecherche(requete)
    .replace(/\b(cbe|dbe)\s+(\d)/g, "$1$2")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((m) => m.replace(/^(cbe|dbe)?0+(?=\d)/, "$1"));
}

/* texte de recherche d'une affaire : numéros sous toutes leurs formes, puis le reste */
export function texteRecherche(parties: {
  type: string;
  numero: string;
  autresNumeros?: string[];
  devis?: string | null;
  designation?: string | null;
  client?: string | null;
  trigrammes?: (string | null | undefined)[];
}): string {
  const t = parties.type.toLowerCase();
  const nums = [parties.numero, ...(parties.autresNumeros ?? [])].map((n) => sansZeros(n.toLowerCase()));
  const d = parties.devis ? baseDe(parties.devis) : "";
  return normaliserRecherche(
    [
      ...nums.map((n) => `${t}${n} ${n}`),
      d ? `dbe${d} ${d}` : "",
      parties.designation ?? "",
      parties.client ?? "",
      ...(parties.trigrammes ?? []).filter(Boolean),
    ].join(" ")
  );
}

/* tous les mots de la requête sont-ils dans le texte ? */
export function correspondRecherche(texte: string, requete: string): boolean {
  const mots = motsDe(requete);
  return mots.length > 0 && mots.every((m) => texte.includes(m));
}

/* score pour classer les résultats : un numéro ou un trigramme exact passe devant */
export function scoreRecherche(e: EntreeAffaire, requete: string): number {
  let s = 0;
  const exacts = new Set([e.numero, `${e.type.toLowerCase()}${e.numero}`, e.devis ?? "", e.devis ? `dbe${e.devis}` : "", normaliserRecherche(e.responsable), normaliserRecherche(e.redacteur)]);
  for (const m of motsDe(requete)) {
    if (exacts.has(m)) s += 10;
    else if (e.numero.startsWith(m)) s += 5;
    else if (normaliserRecherche(e.client).startsWith(m)) s += 3;
  }
  if (e.statut === "EN_COURS" || e.statut === "EN_ATTENTE") s += 1;
  return s;
}

/* toutes les affaires (commandes et devis), enrichies du Suivi d'affaire BE */
export async function chargerIndexAffaires(): Promise<EntreeAffaire[]> {
  const [affaires, lignes, clients, collabs] = await Promise.all([
    chargerAffaires({ horsPlanning: true }),
    chargerTout<{ genre: string; base_affaire: string | null; base_devis: string | null; designation: string | null; client_id: string | null; redacteur_id: string | null }>((a, b) =>
      supabase.from("suivi_lignes").select("genre,base_affaire,base_devis,designation,client_id,redacteur_id").in("genre", ["BASE", "DEVIS"]).order("cle").range(a, b)
    ).catch(() => []),
    chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)).catch(() => []),
    supabase.from("collaborateurs").select("id,trigramme"),
  ]);
  const tri = new Map(((collabs.data ?? []) as { id: string; trigramme: string | null }[]).map((c) => [c.id, c.trigramme ?? ""]));
  const nomClient = new Map(clients.map((c) => [c.id, c.nom_abrege]));

  const parCle = new Map<string, Omit<EntreeAffaire, "texte">>();
  const prendre = (type: "CBE" | "DBE", numero: string) => {
    const cle = `${type}${numero}`;
    let e = parCle.get(cle);
    if (!e) {
      e = { type, numero, designation: "", client: "", devis: null, responsable: "", redacteur: "", statut: null, imputation: null };
      parCle.set(cle, e);
    }
    return e;
  };

  // le Suivi d'affaire BE : client, devis d'origine, rédacteur
  for (const l of lignes) {
    const estDevis = l.genre === "DEVIS";
    const numero = baseDe(estDevis ? l.base_devis : l.base_affaire);
    if (!numero) continue;
    const e = prendre(estDevis ? "DBE" : "CBE", numero);
    if (!e.designation && l.designation) e.designation = l.designation;
    if (!e.client && l.client_id) e.client = nomClient.get(l.client_id) ?? "";
    if (!estDevis && !e.devis && l.base_devis) e.devis = baseDe(l.base_devis) || null;
    if (!e.redacteur && l.redacteur_id) e.redacteur = tri.get(l.redacteur_id) ?? "";
  }
  // une commande et son devis partagent le client
  for (const e of parCle.values()) {
    if (e.type === "CBE" && e.devis && !e.client) e.client = parCle.get(`DBE${e.devis}`)?.client ?? "";
  }

  // le pilotage : descriptif, responsable, état (une ligne par commande : la base l'emporte sur ses avenants)
  for (const a of affaires) {
    const numero = baseDe(a.numero);
    if (!numero) continue;
    const e = prendre(a.type, numero);
    const estBase = /^\d+$/.test(String(a.numero).trim());
    if (estBase || !e.designation) e.designation = a.designation || e.designation;
    if (estBase || !e.responsable) e.responsable = tri.get(a.responsable_id) ?? e.responsable;
    if (estBase || !e.statut) e.statut = a.statut;
    if (estBase || !e.imputation) e.imputation = a.imputation;
  }

  return [...parCle.values()].map((e) => ({
    ...e,
    texte: texteRecherche({ type: e.type, numero: e.numero, devis: e.devis, designation: e.designation, client: e.client, trigrammes: [e.responsable, e.redacteur] }),
  }));
}
