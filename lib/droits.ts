/* ===============================================================
   POLYNOV-TEMPS - NIVEAUX D'ACCES

   Source unique pour les droits liés au rôle (collaborateurs.role).
   Les contrôles côté React ne servent qu'à l'affichage : la vraie
   protection reste assurée par les policies RLS et les fonctions SQL
   (rh_est_admin, polynov_est_exporteur...).

   Niveaux :
     0 - COLLABORATEUR : ses propres feuilles, ses demandes RH, le planning
                         des affaires (lecture)
     1 - RESPONSABLE   : niveau 0 + Suivi des feuilles (consultation),
                         Bilan RH mensuel, Export Excel, portefeuille et
                         planning des affaires au forfait (modification)
     2 - ADMIN         : tout (administration, référentiels, relevé des
                         prestations PE / PI, charge par ressource,
                         indicateurs et finances)

   Rôle à part, en LECTURE SEULE :
     DIRECTION         : Président, adjoint… Indicateurs commerciaux,
                         Finances, Charge & pointage, Charge par ressource,
                         planning des affaires. Aucune saisie, aucune
                         modification, pas de feuille d'heures.
================================================================ */

export type Role = "COLLABORATEUR" | "RESPONSABLE" | "ADMIN" | "DIRECTION";

export const ROLES: { value: Role; label: string }[] = [
  { value: "COLLABORATEUR", label: "Collaborateur" },
  { value: "RESPONSABLE", label: "Responsable (niveau 1)" },
  { value: "ADMIN", label: "Administrateur" },
  { value: "DIRECTION", label: "Direction (lecture seule)" },
];

const NIVEAU: Record<Role, number> = {
  COLLABORATEUR: 0,
  RESPONSABLE: 1,
  ADMIN: 2,
  DIRECTION: -1, // droits listés à part (DROITS_DIRECTION)
};

/* Ce que la Direction peut consulter (lecture seule) */
const DROITS_DIRECTION: ReadonlySet<string> = new Set(["voirPlanning", "chargeRessources", "indicateurs"]);

/* Niveau minimum requis pour chaque droit. */
export const DROITS = {
  voirFeuillesEquipe: 1,
  bilanRH: 1,
  exporterExcel: 1,
  administrerFeuilles: 2,
  voirPlanning: 0, // Planning des affaires : lecture pour tous
  piloterBE: 1, // Pilotage BE : portefeuille, déclarer et modifier les affaires au forfait, affecter
  relevePrestations: 2, // relevé PE / PI (taux, heures facturées) : il alimente le planning des PE / PI
  chargeRessources: 2, // charge par ressource
  indicateurs: 2, // indicateurs et finances
  administration: 2, // codes, activités, profils, bilans, imports, export IA...
} as const;

export type Droit = keyof typeof DROITS;

export function normaliserRole(role?: string | null): Role {
  const valeur = String(role ?? "").trim().toUpperCase();

  if (valeur === "ADMIN" || valeur === "RESPONSABLE" || valeur === "DIRECTION") {
    return valeur;
  }

  return "COLLABORATEUR";
}

export function libelleRole(role?: string | null): string {
  const r = normaliserRole(role);
  return ROLES.find((x) => x.value === r)?.label ?? "Collaborateur";
}

export function peut(
  role: string | null | undefined,
  droit: Droit
): boolean {
  const r = normaliserRole(role);
  if (r === "DIRECTION") return DROITS_DIRECTION.has(droit);
  return NIVEAU[r] >= DROITS[droit];
}
