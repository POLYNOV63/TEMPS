"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { peut, type Droit } from "@/lib/droits";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   BANDEAUX RH ET EXPORTS (ONGLETS_SECTION)

   Comme le bandeau du Pilotage, pour les pages RH et Exports : affiché
   automatiquement dans l'en-tête rouge (EnTetePage) des pages listées
   ci-dessous, sans toucher à ces pages. Chaque onglet n'apparaît qu'aux
   rôles qui y ont accès. La Facturation du mois garde le bandeau du
   Pilotage (elle y figure aussi) : on la trouve ici dans les liens.
================================================================ */

type Onglet = { href: string; libelle: string; droit: Droit };

const SECTIONS: { cle: string; titre: string; onglets: Onglet[]; affichageSur: string[] }[] = [
  {
    cle: "rh",
    titre: "RH",
    onglets: [
      { href: "/admin/feuilles", libelle: "Feuilles d’heures", droit: "voirFeuillesEquipe" },
      { href: "/admin/Valid_RH", libelle: "Validation RH", droit: "administration" },
      { href: "/admin/suivi-rh", libelle: "Absences et compteurs", droit: "administration" },
      { href: "/admin/suivi-notes-frais", libelle: "Notes de frais", droit: "administration" },
    ],
    affichageSur: ["/admin/feuilles", "/admin/Valid_RH", "/admin/suivi-rh", "/admin/suivi-notes-frais"],
  },
  {
    cle: "exports",
    titre: "Exports",
    onglets: [
      { href: "/admin/bilan-rh", libelle: "Bilan RH mensuel", droit: "bilanRH" },
      { href: "/admin/export-excel", libelle: "Récapitulatif d’heures", droit: "exporterExcel" },
      { href: "/analyse/facturation", libelle: "Facturation du mois", droit: "indicateurs" },
    ],
    affichageSur: ["/admin/bilan-rh", "/admin/export-excel"],
  },
];

export default function OngletsSection() {
  const chemin = usePathname() ?? "";
  const section = SECTIONS.find((s) => s.affichageSur.some((p) => p.toLowerCase() === chemin.replace(/\/$/, "").toLowerCase()));
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!section) return;
    chargerMoi()
      .then((m) => setRole(m?.role ?? null))
      .catch(() => setRole(null));
  }, [section]);

  if (!section || role === undefined) return null;
  const visibles = section.onglets.filter((o) => peut(role, o.droit));
  if (visibles.length < 2) return null;

  return (
    <nav aria-label={`Navigation ${section.titre}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", opacity: 0.75, marginRight: 6 }}>{section.titre}</span>
      {visibles.map((o) => {
        const actif = o.href.toLowerCase() === chemin.replace(/\/$/, "").toLowerCase();
        return (
          <Link
            key={o.href}
            href={o.href}
            aria-current={actif ? "page" : undefined}
            style={{
              color: actif ? "#a80000" : "#ffffff",
              background: actif ? "#ffffff" : "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: 999,
              padding: "5px 12px",
              fontWeight: 800,
              fontSize: 13.5,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {o.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
