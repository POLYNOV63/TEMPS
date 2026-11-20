import type { Droit } from "@/lib/droits";

/* ===============================================================
   NAVIGATION_UNIQUE : la liste des pages, rangées par famille.
   Une seule source pour le bandeau (OngletsPilotage) et pour les tuiles
   du tableau de bord : mêmes familles, mêmes pages, mêmes noms, même ordre.
   (Les pages RH ont leur propre bandeau : components/OngletsSection.tsx.)
================================================================ */

export type PageNav = { cle: string; court: string; libelle: string; href: string; droit: Droit };
export type FamilleNav = { cle: "pilotage" | "finance" | "analyses"; titre: string; pages: readonly PageNav[] };

export const FAMILLES_NAV = [
  {
    cle: "pilotage",
    titre: "Pilotage",
    pages: [
      { cle: "portefeuille", court: "Suivi des affaires", libelle: "Suivi des affaires", href: "/pilotage", droit: "voirPlanning" },
      { cle: "devis", court: "Suivi des devis", libelle: "Suivi des devis", href: "/pilotage/devis", droit: "suiviDevis" },
      { cle: "affaires", court: "Planning affaires", libelle: "Planning des affaires", href: "/pilotage/affaires", droit: "voirPlanning" },
      { cle: "prestations", court: "Relevé PE / PI", libelle: "Relevé PE / PI", href: "/pilotage/prestations", droit: "relevePrestations" },
      { cle: "ressources-planning", court: "Ressources", libelle: "Ressources : planning, charge, équipe", href: "/pilotage/planning-ressources", droit: "voirPlanning" },
      { cle: "bilan", court: "Fiche affaire", libelle: "Fiche affaire", href: "/affaires/bilan", droit: "voirPlanning" },
      { cle: "feuilles-route", court: "Feuilles de route", libelle: "Feuilles de route", href: "/ma-feuille-de-route", droit: "piloterBE" },
    ],
  },
  {
    cle: "finance",
    titre: "Finance",
    pages: [
      { cle: "finances", court: "Finances", libelle: "Finances", href: "/analyse/finances", droit: "indicateurs" },
      { cle: "facturation", court: "Facturation", libelle: "Facturation du mois", href: "/analyse/facturation", droit: "indicateurs" },
      { cle: "rentabilite", court: "Rentabilité", libelle: "Rentabilité", href: "/analyse/rentabilite", droit: "indicateurs" },
      { cle: "simulateur", court: "Simulateur", libelle: "Simulateur de rentabilité", href: "/analyse/simulateur", droit: "indicateurs" },
      { cle: "simulateur-cuve", court: "Cuve", libelle: "Simulateur : la cuve", href: "/analyse/simulateur-cuve", droit: "indicateurs" },
      { cle: "simulation-pe", court: "Simulation PE", libelle: "Simulation PE (taux jour)", href: "/analyse/simulation-pe", droit: "indicateurs" },
      { cle: "newsletter", court: "Newsletter", libelle: "Newsletter du mois", href: "/analyse/newsletter", droit: "indicateurs" },
    ],
  },
  {
    cle: "analyses",
    titre: "Analyses",
    pages: [
      { cle: "capacite", court: "Capacité", libelle: "Analyse de capacité", href: "/admin/bilans", droit: "chargeRessources" },
      { cle: "fiabilite", court: "Fiabilité chiffrage", libelle: "Fiabilité du chiffrage", href: "/analyse/fiabilite-chiffrage", droit: "indicateurs" },
      { cle: "clients", court: "Clients", libelle: "Analyse par client", href: "/analyse/clients", droit: "administration" },
    ],
  },
] as const satisfies readonly FamilleNav[];

export type CleNav = (typeof FAMILLES_NAV)[number]["pages"][number]["cle"];
