"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C } from "@/components/pilotage/ui";
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
   BANDEAU_COMME_PILOTAGE : même présentation que le bandeau du Pilotage
   (barre blanche sous l'en-tête rouge, fixe en haut, onglet courant
   souligné de rouge). Le composant reste appelé dans l'en-tête ; il se
   place de lui-même juste sous celui-ci.
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
      { href: "/admin/bilan-rh", libelle: "Bilan RH mensuel", droit: "bilanRH" }, // BILAN_RH_RAPPEL
    ],
    affichageSur: ["/admin/feuilles", "/admin/Valid_RH", "/admin/suivi-rh", "/admin/suivi-notes-frais", "/admin/bilan-rh"],
  },
  {
    cle: "exports",
    titre: "Exports",
    onglets: [
      { href: "/admin/bilan-rh", libelle: "Bilan RH mensuel", droit: "bilanRH" },
      { href: "/admin/export-excel", libelle: "Récapitulatif d’heures", droit: "exporterExcel" },
      { href: "/analyse/facturation", libelle: "Facturation du mois", droit: "indicateurs" },
    ],
    affichageSur: ["/admin/export-excel"],
  },
];

export default function OngletsSection() {
  const chemin = usePathname() ?? "";
  const section = SECTIONS.find((s) => s.affichageSur.some((p) => p.toLowerCase() === chemin.replace(/\/$/, "").toLowerCase()));
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const repere = useRef<HTMLSpanElement | null>(null);
  const refNav = useRef<HTMLElement | null>(null);
  const [cible, setCible] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!section) return;
    chargerMoi()
      .then((m) => setRole(m?.role ?? null))
      .catch(() => setRole(null));
  }, [section]);

  // la barre se place juste sous l'en-tête rouge (comme celle du Pilotage)
  useEffect(() => {
    if (!section) return;
    const entete = repere.current?.closest("header");
    if (!entete) return;
    const div = document.createElement("div");
    div.setAttribute("data-onglets-section", "");
    entete.insertAdjacentElement("afterend", div);
    setCible(div);
    return () => {
      div.remove();
      setCible(null);
    };
  }, [section]);

  // la hauteur du bandeau, pour les éléments figés des pages
  useEffect(() => {
    const el = refNav.current;
    if (!el) return;
    const maj = () => document.documentElement.style.setProperty("--hauteur-nav", `${Math.round(el.getBoundingClientRect().height)}px`);
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cible, role]);

  if (!section) return null;
  const visibles = role === undefined ? [] : section.onglets.filter((o) => peut(role, o.droit));

  const barre =
    visibles.length < 2 ? null : (
      <nav
        ref={refNav}
        aria-label={`Navigation ${section.titre}`}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          boxShadow: "0 1px 4px rgba(0,0,0,.06)",
          background: "#ffffff",
          borderBottom: `1px solid ${C.ligne}`,
          padding: "0 14px",
          fontFamily: "Calibri, Arial, sans-serif",
          display: "flex",
          alignItems: "stretch",
          flexWrap: "wrap",
          columnGap: 2,
        }}
      >
        {visibles.map((o) => {
          const a = o.href.toLowerCase() === chemin.replace(/\/$/, "").toLowerCase();
          return (
            <Link
              key={o.href}
              href={o.href}
              aria-current={a ? "page" : undefined}
              title={o.libelle}
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 42,
                padding: "0 9px",
                fontWeight: a ? 800 : 700,
                fontSize: 13.5,
                color: a ? C.rougeFonce : "#3b4046",
                textDecoration: "none",
                borderBottom: `3px solid ${a ? C.rouge : "transparent"}`,
                background: a ? "#fff5f5" : undefined,
                whiteSpace: "nowrap",
              }}
            >
              {o.libelle}
            </Link>
          );
        })}
      </nav>
    );

  return (
    <>
      <span ref={repere} hidden />
      {cible && barre ? createPortal(barre, cible) : null}
    </>
  );
}
