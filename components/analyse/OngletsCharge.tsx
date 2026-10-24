"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { C } from "@/components/pilotage/ui";
import { peut, type Droit } from "@/lib/droits";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   CHARGE & POINTAGE : deux vues d'une même question
   « comment est consommé le temps du BE ? »
   - Par affaire       : pointé face au chiffré (/analyse/pointage)
   - Par collaborateur : heures, activités, taux d'occupation (/admin/bilans)
   Chaque onglet n'apparaît qu'aux rôles qui y ont accès.
================================================================ */

const ONGLETS: readonly { cle: "affaires" | "collaborateurs"; libelle: string; href: string; droit: Droit }[] = [
  { cle: "affaires", libelle: "🎯 Par affaire", href: "/analyse/pointage", droit: "indicateurs" },
  { cle: "collaborateurs", libelle: "👥 Par collaborateur", href: "/admin/bilans", droit: "administration" },
];

export default function OngletsCharge({ actif }: { actif: "affaires" | "collaborateurs" }) {
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    chargerMoi()
      .then((m) => setRole(m?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  // tant que le rôle n'est pas connu, seul l'onglet courant est affiché
  const visibles = ONGLETS.filter((o) => (role === undefined ? o.cle === actif : peut(role, o.droit)));
  if (visibles.length < 2) return null;

  return (
    <nav
      aria-label="Charge & pointage"
      style={{
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
        alignItems: "center",
        fontFamily: "Calibri, Arial, sans-serif",
      }}
    >
      <span style={{ fontWeight: 800, color: C.gris, fontSize: 13, textTransform: "uppercase", letterSpacing: ".4px", marginRight: 6 }}>Charge &amp; pointage</span>
      {visibles.map((o) => {
        const a = o.cle === actif;
        return (
          <Link
            key={o.cle}
            href={o.href}
            aria-current={a ? "page" : undefined}
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
