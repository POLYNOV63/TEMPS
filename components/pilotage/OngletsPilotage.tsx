"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { C } from "@/components/pilotage/ui";
import { pageAutorisee } from "@/lib/droits";
import { FAMILLES_NAV, type CleNav } from "@/lib/navigation";
import { useDroitsRoles } from "@/lib/droitsRoles";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   NAVIGATION : TOUTES LES PAGES D'UN COUP D'ŒIL (NAVIGATION_TOUT_VOIR)
   (reprend NAVIGATION_UNE_LIGNE, NAVIGATION_AXES, PLANNING_NAV_UNIQUE,
   DISPOS_SANS_SURCHARGE)

   Un seul bandeau, fixe en haut, toutes les pages visibles, dans l'ordre
   du travail : les affaires et leur planning, la facturation et les
   chiffres, puis la charge, et en dernier les analyses d'équipe et de
   capacité. De fins séparateurs marquent les familles. Le bandeau passe
   à la ligne si l'écran est étroit. Chaque page n'apparaît qu'aux rôles
   qui y ont accès. La hauteur du bandeau est mesurée (--hauteur-nav) pour
   que les éléments figés des pages se placent dessous.
================================================================ */

// NAVIGATION_UNIQUE : la liste vient de lib/navigation.ts (la même que les tuiles du tableau de bord)
const ONGLETS = FAMILLES_NAV.flatMap((f) => f.pages.map((p) => ({ ...p, groupe: f.cle, famille: f.titre })));

export type OngletActif = CleNav;

export default function OngletsPilotage({ actif }: { actif: OngletActif }) {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  useDroitsRoles(); // se redessine quand les réglages de droits arrivent
  const refNav = useRef<HTMLElement | null>(null);

  useEffect(() => {
    chargerMoi()
      .then((m) => setRole(m?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  // la hauteur du bandeau, pour les éléments figés des pages
  useEffect(() => {
    const el = refNav.current;
    if (!el) return;
    const maj = () => document.documentElement.style.setProperty("--hauteur-nav", `${Math.round(el.getBoundingClientRect().height)}px`);
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // tant que le rôle n'est pas connu, seul l'onglet courant est affiché
  const visibles = ONGLETS.filter((o) => (role === undefined ? o.cle === actif : pageAutorisee(role, o.href))); // DROITS_ROLES

  return (
    <nav
      ref={refNav}
      aria-label="Navigation"
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
      {visibles.map((o, i) => {
        const a = o.cle === actif;
        const nouveauGroupe = i === 0 || visibles[i - 1].groupe !== o.groupe;
        return (
          <span key={o.cle} style={{ display: "inline-flex", alignItems: "stretch" }}>
            {nouveauGroupe && i > 0 && <span aria-hidden="true" style={{ width: 1, margin: "10px 6px 10px 8px", background: "#d5d9de" }} />}
            {nouveauGroupe && (
              <span style={{ display: "inline-flex", alignItems: "center", padding: "0 6px 0 4px", fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: C.rouge }}>
                {o.famille}
              </span>
            )}
            <Link
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
              {o.court}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
