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

   DROITS_ROLES (SQL 97) : ces réglages sont ceux d'ORIGINE. La page
   Paramétrage › Droits d'accès peut les changer rôle par rôle, pour
   chaque fonction (DROITS) et chaque page (PAGES) ; les réglages
   modifiés sont lus dans la base (lib/droitsRoles.ts) et priment.
   L'ADMIN a toujours tout.
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
const DROITS_DIRECTION: ReadonlySet<string> = new Set(["voirPlanning", "chargeRessources", "indicateurs", "suiviDevis"]); // SUIVI_DEVIS

/* Niveau minimum requis pour chaque droit. */
export const DROITS = {
  voirFeuillesEquipe: 1,
  bilanRH: 1,
  exporterExcel: 1,
  administrerFeuilles: 2,
  voirPlanning: 0, // Planning des affaires : lecture pour tous
  piloterBE: 1, // Pilotage BE : portefeuille, déclarer et modifier les affaires au forfait, affecter
  relevePrestations: 1, // relevé PE / PI (taux, heures facturées) : ADMIN et RESPONSABLE ; il alimente le planning des PE / PI
  chargeRessources: 2, // charge par ressource
  indicateurs: 2, // indicateurs et finances
  suiviDevis: 1, // SUIVI_DEVIS : page Suivi des devis (liste : ADMIN, RESPONSABLE ; statistiques : ADMIN, DIRECTION)
  suiviAffaires: 0, // DROITS_ROLES : page Suivi des affaires (tout le monde sauf la Direction)
  montantsAffaires: 2, // DROITS_ROLES : montants du Suivi des affaires (montant, facturé, reste à facturer, € / h)
  administration: 2, // codes, activités, profils, bilans, imports, export IA...
} as const;

export type Droit = keyof typeof DROITS;

/* Libellé et rôle de chaque fonction, pour la page des droits */
export const DESCRIPTIONS_DROITS: Record<Droit, { libelle: string; aide: string; groupe: string }> = {
  voirPlanning: { libelle: "Voir le planning", aide: "Planning des affaires, planning par ressource, fiche affaire (lecture)", groupe: "Pilotage" },
  piloterBE: { libelle: "Piloter le BE", aide: "Modifier les affaires, affecter au planning, feuilles de route de l’équipe", groupe: "Pilotage" },
  suiviAffaires: { libelle: "Suivi des affaires", aide: "L’onglet et la page « Suivi des affaires » (heures chiffrées, réalisées, planifiées)", groupe: "Pilotage" },
  montantsAffaires: { libelle: "Suivi des affaires avec les montants", aide: "Montant, facturé, reste à facturer et € / h réalisé, dans la page et son export", groupe: "Pilotage" },
  relevePrestations: { libelle: "Relevé PE / PI", aide: "Saisir et clôturer le relevé des prestations, staffer les PE / PI", groupe: "Pilotage" },
  suiviDevis: { libelle: "Suivi des devis", aide: "Gestion des devis et relances ; statistiques pour ceux qui ont aussi « Analyse et finances »", groupe: "Pilotage" },
  chargeRessources: { libelle: "Charge et disponibilités", aide: "Charge par ressource, disponibilités par activité", groupe: "Analyse" },
  indicateurs: { libelle: "Analyse et finances", aide: "Finances, facturation du mois, rentabilité, indicateurs, cartographie de l’équipe", groupe: "Analyse" },
  voirFeuillesEquipe: { libelle: "Feuilles de l’équipe", aide: "Voir les feuilles d’heures de tous (consultation)", groupe: "RH" },
  administrerFeuilles: { libelle: "Gérer les feuilles", aide: "Modifier, rouvrir ou supprimer la feuille d’un collaborateur", groupe: "RH" },
  bilanRH: { libelle: "Bilan RH mensuel", aide: "Le bilan du mois, son export et le rappel de fin de mois", groupe: "RH" },
  exporterExcel: { libelle: "Exports Excel", aide: "Récapitulatifs d’heures et exports de fin de mois", groupe: "Exports" },
  administration: { libelle: "Administration", aide: "Validation RH, suivi RH, notes de frais, référentiels, imports, maintenance", groupe: "Paramétrage" },
};

/* DROITS_ROLES : chaque page, avec la fonction qui l'ouvre à l'origine (null : toute personne connectée) */
export type PageApp = { href: string; libelle: string; groupe: string; droit: Droit | null; prefixe?: boolean };
export const PAGES: PageApp[] = [
  { href: "/dashboard", libelle: "Tableau de bord", groupe: "Mon espace", droit: null },
  { href: "/ma-semaine", libelle: "Ma semaine (feuille d’heures)", groupe: "Mon espace", droit: null },
  { href: "/mes-feuilles", libelle: "Mes feuilles", groupe: "Mon espace", droit: null },
  { href: "/mon-bilan", libelle: "Mon bilan", groupe: "Mon espace", droit: null },
  { href: "/RH", libelle: "Mon espace RH (congés, demandes)", groupe: "Mon espace", droit: null },
  { href: "/notes-frais", libelle: "Mes notes de frais", groupe: "Mon espace", droit: null },
  { href: "/ma-feuille-de-route", libelle: "Feuille de route", groupe: "Mon espace", droit: null },
  { href: "/guide", libelle: "Guide", groupe: "Mon espace", droit: null },

  { href: "/pilotage", libelle: "Suivi des affaires", groupe: "Pilotage", droit: "suiviAffaires" },
  { href: "/pilotage/devis", libelle: "Suivi des devis", groupe: "Pilotage", droit: "suiviDevis" },
  { href: "/pilotage/affaires", libelle: "Planning des affaires", groupe: "Pilotage", droit: "voirPlanning" },
  { href: "/pilotage/prestations", libelle: "Relevé PE / PI", groupe: "Pilotage", droit: "relevePrestations" },
  { href: "/pilotage/planning-ressources", libelle: "Planning par ressource", groupe: "Pilotage", droit: "voirPlanning" },
  { href: "/affaires/bilan", libelle: "Fiche affaire (bilan d’affaire)", groupe: "Pilotage", droit: "voirPlanning" },

  { href: "/analyse/facturation", libelle: "Facturation du mois", groupe: "Analyse", droit: "indicateurs" },
  { href: "/analyse/finances", libelle: "Finances", groupe: "Analyse", droit: "indicateurs" },
  { href: "/analyse/rentabilite", libelle: "Rentabilité", groupe: "Analyse", droit: "indicateurs" },
  { href: "/analyse/effectifs", libelle: "Cartographie de l’équipe", groupe: "Analyse", droit: "indicateurs" },
  { href: "/analyse/fiabilite-chiffrage", libelle: "Fiabilité du chiffrage", groupe: "Analyse", droit: "indicateurs" },
  { href: "/pilotage/ressources", libelle: "Charge par ressource", groupe: "Analyse", droit: "chargeRessources" },
  { href: "/analyse/charge-activites", libelle: "Disponibilités par activité", groupe: "Analyse", droit: "chargeRessources" },
  { href: "/admin/bilans", libelle: "Analyse de capacité", groupe: "Analyse", droit: "administration" },

  { href: "/admin/feuilles", libelle: "Feuilles d’heures", groupe: "RH", droit: "voirFeuillesEquipe" },
  { href: "/admin/Valid_RH", libelle: "Validation RH", groupe: "RH", droit: "administration" },
  { href: "/admin/suivi-rh", libelle: "Absences et compteurs", groupe: "RH", droit: "administration" },
  { href: "/admin/compteurs", libelle: "Compteurs de récupération", groupe: "RH", droit: "administration" },
  { href: "/admin/suivi-notes-frais", libelle: "Notes de frais (suivi)", groupe: "RH", droit: "administration" },
  { href: "/admin/bilan-rh", libelle: "Bilan RH mensuel", groupe: "RH", droit: "bilanRH" },

  { href: "/admin/export-excel", libelle: "Exports Excel", groupe: "Exports", droit: "exporterExcel" },

  { href: "/admin/collaborateurs", libelle: "Collaborateurs", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/droits", libelle: "Droits d’accès", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/Gestion-codes", libelle: "Codes d’imputation", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/Gestion-activites", libelle: "Activités", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/imputations-pilotage", libelle: "Imputations des affaires", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/profils-horaires", libelle: "Rythmes horaires", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/notes-frais", libelle: "Notes de frais (destinataires et barème)", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/synchro-suivi-affaires", libelle: "Synchronisation Suivi d’affaire", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/import-prestations", libelle: "Import des prestations", groupe: "Paramétrage", droit: "administration" },
  { href: "/import-historique-v2", libelle: "Import de l’historique", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/coherence", libelle: "Cohérence", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/sauvegarde", libelle: "Sauvegarde", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/Export-IA", libelle: "Export IA", groupe: "Paramétrage", droit: "administration" },
  { href: "/admin/reinitialisation", libelle: "Remise à zéro", groupe: "Paramétrage", droit: "administration" },
];

/* pages toujours ouvertes à toute personne connectée (on ne peut pas s'en fermer l'accès) */
const PAGES_TOUJOURS = new Set(["/dashboard"]);

/* ---------- réglages modifiés (SQL 97), chargés par lib/droitsRoles.ts ---------- */
let surcharges: Map<string, boolean> = new Map();
export function definirSurcharges(m: Map<string, boolean>) {
  surcharges = m;
}
export function surchargeDe(cle: string, role: Role): boolean | undefined {
  return surcharges.get(`${cle}|${role}`);
}

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

/* le réglage d'origine d'une fonction pour un rôle */
export function peutParDefaut(role: string | null | undefined, droit: Droit): boolean {
  const r = normaliserRole(role);
  if (r === "DIRECTION") return DROITS_DIRECTION.has(droit);
  return NIVEAU[r] >= DROITS[droit];
}

export function peut(role: string | null | undefined, droit: Droit): boolean {
  const r = normaliserRole(role);
  if (r === "ADMIN") return true;
  const s = surchargeDe(`droit:${droit}`, r);
  return s ?? peutParDefaut(r, droit);
}

/* la page d'une adresse (la plus précise) */
export function pageDe(chemin: string): PageApp | undefined {
  const c = (chemin.split("?")[0] || "/").replace(/\/$/, "").toLowerCase() || "/";
  let meilleure: PageApp | undefined;
  for (const p of PAGES) {
    const h = p.href.toLowerCase();
    const ok = p.prefixe ? c.startsWith(h) : c === h.replace(/\/$/, "");
    if (ok && (!meilleure || h.length > meilleure.href.length)) meilleure = p;
  }
  return meilleure;
}

/* le réglage d'origine d'une page pour un rôle */
export function pageParDefaut(role: string | null | undefined, page: PageApp): boolean {
  return page.droit === null ? true : peut(role, page.droit);
}

/* une page est-elle ouverte à ce rôle ? (page inconnue de la liste : oui) */
export function pageAutorisee(role: string | null | undefined, chemin: string): boolean {
  const r = normaliserRole(role);
  if (r === "ADMIN") return true;
  const p = pageDe(chemin);
  if (!p || PAGES_TOUJOURS.has(p.href)) return true;
  const s = surchargeDe(`page:${p.href}`, r);
  return s ?? pageParDefaut(r, p);
}

/* une page réglée explicitement pour ce rôle (ouverte ou fermée), sinon undefined */
export function pageReglee(role: string | null | undefined, chemin: string): boolean | undefined {
  const r = normaliserRole(role);
  const p = pageDe(chemin);
  return p ? surchargeDe(`page:${p.href}`, r) : undefined;
}
