import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import type { AbsenceRow, Affectation, CapaciteRow, JourRow } from "@/lib/pilotagePlanning";
import type {
  Activite,
  Affaire,
  Charge,
  Collab,
  Imputation,
  Realise,
} from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - CHARGEMENT DES DONNEES

   Les droits réels sont assurés par les règles de sécurité de la base
   (RLS) : ici, on ne fait que lire ce que l'utilisateur a le droit de voir.
================================================================ */

type Reponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function chargerTout<T>(
  requete: (debut: number, fin: number) => PromiseLike<Reponse<T>>
): Promise<T[]> {
  const resultat: T[] = [];
  const taille = 1000;

  for (let page = 0; ; page++) {
    const { data, error } = await requete(page * taille, page * taille + taille - 1);

    if (error) throw new Error(error.message);
    if (!data) break;

    resultat.push(...data);

    if (data.length < taille) break;
  }

  return resultat;
}

export type Moi = {
  id: string;
  role: string | null;
  peutModifier: boolean; // responsables et administrateurs
  estAdmin: boolean;
};

export async function chargerMoi(): Promise<Moi | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("collaborateurs")
    .select("id,role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    role: (data.role as string | null) ?? null,
    peutModifier: peut(data.role, "piloterBE"),
    estAdmin: peut(data.role, "administration"),
  };
}

export async function chargerAffaires(): Promise<Affaire[]> {
  return chargerTout<Affaire>((a, b) =>
    supabase
      .from("pilotage_affaires")
      .select(
        "id,type,numero,designation,responsable_id,priorite,statut,echeance,echeance_initiale,dbe_origine_id,date_livraison,imputation,created_at"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(a, b)
  );
}

export async function chargerCharges(): Promise<Charge[]> {
  return chargerTout<Charge>((a, b) =>
    supabase
      .from("pilotage_charges")
      .select("id,affaire_id,activite_id,code,heures,realise_initial")
      .order("id", { ascending: true })
      .range(a, b)
  );
}

export async function chargerRealise(): Promise<Realise[]> {
  return chargerTout<Realise>((a, b) =>
    supabase
      .rpc("pilotage_realise")
      .order("type_affaire", { ascending: true })
      .order("numero", { ascending: true })
      .order("activite_id", { ascending: true })
      .order("code", { ascending: true })
      .range(a, b)
  );
}

export async function chargerAnnuaire(): Promise<Collab[]> {
  const { data, error } = await supabase.rpc("pilotage_annuaire");

  if (error) throw new Error(error.message);

  return (data ?? []) as Collab[];
}

export async function chargerImputations(): Promise<Imputation[]> {
  const { data, error } = await supabase
    .from("pilotage_imputations")
    .select("code,libelle,actif,ordre_affichage,charge_obligatoire")
    .order("ordre_affichage", { ascending: true })
    .order("code", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as Imputation[];
}

export type ReferentielActivites = {
  activites: Activite[];
  liens: { activite_id: string; code: string }[];
  libellesCodes: Map<string, string>;
};

export async function chargerActivites(): Promise<ReferentielActivites> {
  const [activites, liens, codes] = await Promise.all([
    supabase
      .from("activites")
      .select("id,code,nom,actif,ordre_affichage")
      .order("ordre_affichage", { ascending: true }),
    supabase.from("activites_codes").select("activite_id,code"),
    supabase.from("codes_imputation").select("code,libelle"),
  ]);

  const erreur = activites.error || liens.error || codes.error;

  if (erreur) throw new Error(erreur.message);

  return {
    activites: (activites.data ?? []) as Activite[],
    liens: (liens.data ?? []) as { activite_id: string; code: string }[],
    libellesCodes: new Map(
      ((codes.data ?? []) as { code: string; libelle: string }[]).map((c) => [c.code, c.libelle])
    ),
  };
}

/* ---------------------------------------------------------------
   PLANNING
--------------------------------------------------------------- */

const COLONNES_AFFECTATION =
  "id,groupe_id,affaire_id,activite_id,code,libelle,collaborateur_id,date_debut,date_fin,commentaire";

/* Affectations qui touchent la période [debut, fin] et leurs jours dans la période. */
export async function chargerAffectations(
  debut: string,
  fin: string
): Promise<{ affectations: Affectation[]; jours: JourRow[] }> {
  const [affectations, jours] = await Promise.all([
    chargerTout<Affectation>((a, b) =>
      supabase
        .from("pilotage_affectations")
        .select(COLONNES_AFFECTATION)
        .lte("date_debut", fin)
        .gte("date_fin", debut)
        .order("id", { ascending: true })
        .range(a, b)
    ),
    chargerTout<JourRow>((a, b) =>
      supabase
        .from("pilotage_affectations_jours")
        .select("affectation_id,jour,heures")
        .gte("jour", debut)
        .lte("jour", fin)
        .order("affectation_id", { ascending: true })
        .order("jour", { ascending: true })
        .range(a, b)
    ),
  ]);

  return { affectations, jours };
}

/* Affectations de toute une affaire (avec tous leurs jours). */
export async function chargerAffectationsAffaire(
  affaireId: string
): Promise<{ affectations: Affectation[]; jours: JourRow[] }> {
  const { data, error } = await supabase
    .from("pilotage_affectations")
    .select(COLONNES_AFFECTATION)
    .eq("affaire_id", affaireId)
    .order("date_debut", { ascending: true });

  if (error) throw new Error(error.message);

  const affectations = (data ?? []) as Affectation[];

  if (affectations.length === 0) return { affectations, jours: [] };

  const jours = await chargerTout<JourRow>((a, b) =>
    supabase
      .from("pilotage_affectations_jours")
      .select("affectation_id,jour,heures")
      .in("affectation_id", affectations.map((x) => x.id))
      .order("affectation_id", { ascending: true })
      .order("jour", { ascending: true })
      .range(a, b)
  );

  return { affectations, jours };
}

/* Tous les jours d'une affectation. */
export async function chargerJoursAffectation(affectationId: string): Promise<JourRow[]> {
  const { data, error } = await supabase
    .from("pilotage_affectations_jours")
    .select("affectation_id,jour,heures")
    .eq("affectation_id", affectationId)
    .order("jour", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as JourRow[];
}

/* Ce qui est planifié à partir d'une date (pour le portefeuille et les fiches). */
export async function chargerPlanifie(
  aPartirDe: string
): Promise<{ affectations: Affectation[]; jours: JourRow[] }> {
  const [affectations, jours] = await Promise.all([
    chargerTout<Affectation>((a, b) =>
      supabase
        .from("pilotage_affectations")
        .select(COLONNES_AFFECTATION)
        .gte("date_fin", aPartirDe)
        .order("id", { ascending: true })
        .range(a, b)
    ),
    chargerTout<JourRow>((a, b) =>
      supabase
        .from("pilotage_affectations_jours")
        .select("affectation_id,jour,heures")
        .gte("jour", aPartirDe)
        .order("affectation_id", { ascending: true })
        .order("jour", { ascending: true })
        .range(a, b)
    ),
  ]);

  return { affectations, jours };
}

/* Capacités théoriques et absences validées (Validation RH) sur une période (400 jours au plus). */
export async function chargerCapacitesAbsences(
  debut: string,
  fin: string
): Promise<{ caps: CapaciteRow[]; absences: AbsenceRow[] }> {
  const [caps, absences] = await Promise.all([
    chargerTout<CapaciteRow>((a, b) =>
      supabase
        .rpc("pilotage_capacites", { p_debut: debut, p_fin: fin })
        .order("collaborateur_id", { ascending: true })
        .order("jour", { ascending: true })
        .range(a, b)
    ),
    chargerTout<AbsenceRow>((a, b) =>
      supabase
        .rpc("pilotage_absences", { p_debut: debut, p_fin: fin })
        .order("collaborateur_id", { ascending: true })
        .order("date_debut", { ascending: true })
        .range(a, b)
    ),
  ]);

  return { caps, absences };
}

/* Codes utilisables dans un événement libre (lignes « Divers »). */
export async function chargerCodesDivers(): Promise<{ code: string; libelle: string }[]> {
  const { data, error } = await supabase
    .from("codes_imputation")
    .select("code,libelle,actif,autorise_divers")
    .eq("autorise_divers", true)
    .eq("actif", true)
    .order("code", { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as { code: string; libelle: string }[]).map((c) => ({
    code: c.code,
    libelle: c.libelle,
  }));
}

/* Nombre d'affaires différentes et heures par personne depuis une date (ADMIN et RESPONSABLE). */
export async function chargerAffairesParPersonne(
  depuis: string
): Promise<{ collaborateur_id: string; nb_affaires: number; heures: number | string }[]> {
  const { data, error } = await supabase.rpc("pilotage_affaires_par_personne", { p_depuis: depuis });

  if (error) throw new Error(error.message);

  return (data ?? []) as { collaborateur_id: string; nb_affaires: number; heures: number | string }[];
}
