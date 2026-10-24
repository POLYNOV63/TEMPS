"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { C } from "@/components/pilotage/ui";
import { peut, type Droit } from "@/lib/droits";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* Navigation du module Pilotage BE (bandeau fixe en haut de l'écran).
   Chaque onglet n'apparaît qu'aux rôles qui y ont accès. */

const ONGLETS: readonly { cle: string; libelle: string; href: string; droit: Droit }[] = [
  { cle: "portefeuille", libelle: "Portefeuille", href: "/pilotage", droit: "piloterBE" },
  { cle: "affaires", libelle: "Planning des affaires", href: "/pilotage/affaires", droit: "voirPlanning" },
  { cle: "ressources", libelle: "Charge par ressource", href: "/pilotage/ressources", droit: "chargeRessources" },
  { cle: "ressources-planning", libelle: "Planning par ressource", href: "/pilotage/planning-ressources", droit: "chargeRessources" },
  { cle: "prestations", libelle: "Prestations PE / PI", href: "/pilotage/prestations", droit: "relevePrestations" },
  { cle: "feuilles-route", libelle: "Feuilles de route", href: "/ma-feuille-de-route", droit: "piloterBE" },
];

export default function OngletsPilotage({
  actif,
}: {
  actif: "portefeuille" | "affaires" | "ressources" | "ressources-planning" | "prestations" | "indicateurs" | "feuilles-route";
}) {
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    chargerMoi()
      .then((m) => setRole(m?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  // Tant que le rôle n'est pas connu, seul l'onglet courant est affiché
  const visibles = ONGLETS.filter((o) => (role === undefined ? o.cle === actif : peut(role, o.droit)));

  return (
    <nav
      aria-label="Pilotage BE"
      style={{
        // reste collé en haut de l'écran quand on fait défiler la page
        position: "sticky",
        top: 0,
        zIndex: 40,
        boxShadow: "0 1px 4px rgba(0,0,0,.06)",
        background: "#ffffff",
        borderBottom: `1px solid ${C.ligne}`,
        padding: "0 28px",
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        fontFamily: "Calibri, Arial, sans-serif",
      }}
    >
      {visibles.map((o) => {
        const a = o.cle === actif;

        return (
          <Link
            key={o.cle}
            href={o.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 48,
              padding: "0 16px",
              fontWeight: 700,
              color: a ? C.rougeFonce : "#3b4046",
              textDecoration: "none",
              borderBottom: `3px solid ${a ? C.rouge : "transparent"}`,
            }}
          >
            {o.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
