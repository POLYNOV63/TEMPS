"use client";

import Link from "next/link";
import { C } from "@/components/pilotage/ui";

/* Navigation du module Pilotage BE. */

const ONGLETS = [
  { cle: "portefeuille", libelle: "Portefeuille", href: "/pilotage" },
  { cle: "planning", libelle: "Planning", href: "/pilotage/planning" },
  { cle: "ressources", libelle: "Charge par ressource", href: "/pilotage/ressources" },
] as const;

export default function OngletsPilotage({
  actif,
}: {
  actif: (typeof ONGLETS)[number]["cle"];
}) {
  return (
    <nav
      aria-label="Pilotage BE"
      style={{
        background: "#ffffff",
        borderBottom: `1px solid ${C.ligne}`,
        padding: "0 28px",
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        fontFamily: "Calibri, Arial, sans-serif",
      }}
    >
      {ONGLETS.map((o) => {
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
