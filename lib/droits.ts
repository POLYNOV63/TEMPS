/* ===============================================================
   POLYNOV-TEMPS - NIVEAUX D'ACCES

   Source unique pour les droits liés au rôle (collaborateurs.role).
   Les contrôles côté React ne servent qu'à l'affichage : la vraie
   protection reste assurée par les policies RLS et les fonctions SQL
   (rh_est_admin, polynov_est_exporteur...).

   Niveaux :
     0 - COLLABORATEUR : ses propres feuilles, ses demandes RH
     1 - RESPONSABLE   : niveau 0 + Suivi des feuilles (consultation),
                         Bilan RH mensuel, Export Excel
     2 - ADMIN         : tout (administration, gestion des référentiels)
================================================================ */

export type Role = "COLLABORATEUR" | "RESPONSABLE" | "ADMIN";

export const ROLES: { value: Role; label: string }[] = [
  { value: "COLLABORATEUR", label: "Collaborateur" },
  { value: "RESPONSABLE", label: "Responsable (niveau 1)" },
  { value: "ADMIN", label: "Administrateur" },
];

const NIVEAU: Record<Role, number> = {
  COLLABORATEUR: 0,
  RESPONSABLE: 1,
  ADMIN: 2,
};

/* Niveau minimum requis pour chaque droit. */
export const DROITS = {
  voirFeuillesEquipe: 1,
  bilanRH: 1,
  exporterExcel: 1,
  administrerFeuilles: 2,
  administration: 2, // codes, activités, profils, bilans, imports, export IA...
} as const;

export type Droit = keyof typeof DROITS;

export function normaliserRole(role?: string | null): Role {
  const valeur = String(role ?? "").trim().toUpperCase();

  if (valeur === "ADMIN" || valeur === "RESPONSABLE") {
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
  return NIVEAU[normaliserRole(role)] >= DROITS[droit];
}
