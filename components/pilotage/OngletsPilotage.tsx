"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { C } from "@/components/pilotage/ui";
import { peut, type Droit } from "@/lib/droits";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   NAVIGATION SUR UNE LIGNE (NAVIGATION_UNE_LIGNE)
   (reprend NAVIGATION_AXES, PLANNING_NAV_UNIQUE, DISPOS_SANS_SURCHARGE)

   Un seul bandeau, fixe en haut :
   - à gauche, les trois axes en menus déroulants : Affaires ▾, Charge ▾,
     Analyses ▾ (un clic ouvre la liste des pages de l'axe) ;
   - à droite des menus, les pages de l'axe courant, en onglets, pour
     passer de l'une à l'autre en un clic.
   Chaque page n'apparaît qu'aux rôles qui y ont accès ; un axe sans page
   accessible n'apparaît pas. La hauteur du bandeau est mesurée
   (--hauteur-nav) pour que les éléments figés des pages se placent dessous.
================================================================ */

type Axe = "affaires" | "charge" | "analyses";

const AXES: { cle: Axe; libelle: string }[] = [
  { cle: "affaires", libelle: "Affaires" },
  { cle: "charge", libelle: "Charge" },
  { cle: "analyses", libelle: "Analyses" },
];

const ONGLETS = [
  // Affaires : où en est-on
  { cle: "portefeuille", axe: "affaires", libelle: "Suivi des affaires", href: "/pilotage", droit: "voirPlanning" },
  { cle: "bilan", axe: "affaires", libelle: "Bilan affaire", href: "/affaires/bilan", droit: "voirPlanning" },
  { cle: "prestations", axe: "affaires", libelle: "Relevé PE / PI", href: "/pilotage/prestations", droit: "relevePrestations" },
  // Charge : a-t-on les bras
  { cle: "affaires", axe: "charge", libelle: "Planning des affaires", href: "/pilotage/affaires", droit: "voirPlanning" },
  { cle: "ressources-planning", axe: "charge", libelle: "Planning par ressource", href: "/pilotage/planning-ressources", droit: "voirPlanning" },
  { cle: "ressources", axe: "charge", libelle: "Charge par ressource", href: "/pilotage/ressources", droit: "chargeRessources" },
  { cle: "charge-activites", axe: "charge", libelle: "Disponibilités par activité", href: "/analyse/charge-activites", droit: "chargeRessources" },
  { cle: "feuilles-route", axe: "charge", libelle: "Feuilles de route", href: "/ma-feuille-de-route", droit: "piloterBE" },
  // Analyses : l'Analyse de capacité en dernier (la plus longue à charger)
  { cle: "finances", axe: "analyses", libelle: "Finances", href: "/analyse/finances", droit: "indicateurs" },
  { cle: "facturation", axe: "analyses", libelle: "Facturation du mois", href: "/analyse/facturation", droit: "indicateurs" },
  { cle: "rentabilite", axe: "analyses", libelle: "Rentabilité", href: "/analyse/rentabilite", droit: "indicateurs" },
  { cle: "indicateurs", axe: "analyses", libelle: "Indicateurs commerciaux", href: "/pilotage/indicateurs", droit: "indicateurs" },
  { cle: "effectifs", axe: "analyses", libelle: "Cartographie de l’équipe", href: "/analyse/effectifs", droit: "indicateurs" },
  { cle: "capacite", axe: "analyses", libelle: "Analyse de capacité", href: "/admin/bilans", droit: "administration" },
] as const satisfies readonly { cle: string; axe: Axe; libelle: string; href: string; droit: Droit }[];

export type OngletActif = (typeof ONGLETS)[number]["cle"];

export default function OngletsPilotage({ actif }: { actif: OngletActif }) {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [ouvert, setOuvert] = useState<Axe | null>(null);
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

  // un clic ailleurs ou Échap referme le menu
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      if (refNav.current && !refNav.current.contains(e.target as Node)) setOuvert(null);
    };
    const touche = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(null);
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", touche);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", touche);
    };
  }, [ouvert]);

  const courant = ONGLETS.find((o) => o.cle === actif);
  const axeCourant: Axe = courant?.axe ?? "affaires";
  // tant que le rôle n'est pas connu, seul l'onglet courant est affiché
  const visibles = ONGLETS.filter((o) => (role === undefined ? o.cle === actif : peut(role, o.droit)));
  const axesVisibles = AXES.filter((a) => visibles.some((o) => o.axe === a.cle));
  const pagesAxe = visibles.filter((o) => o.axe === axeCourant);

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
        padding: "0 20px",
        fontFamily: "Calibri, Arial, sans-serif",
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexWrap: "wrap",
        minHeight: 46,
      }}
    >
      {/* les axes, en menus déroulants */}
      {axesVisibles.map((a) => {
        const actifAxe = a.cle === axeCourant;
        const pages = visibles.filter((o) => o.axe === a.cle);
        return (
          <div key={a.cle} style={{ position: "relative" }}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={ouvert === a.cle}
              onClick={() => setOuvert((x) => (x === a.cle ? null : a.cle))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: ".4px",
                background: actifAxe ? C.rouge : ouvert === a.cle ? "#e6e8eb" : "#f1f2f4",
                color: actifAxe ? "#ffffff" : "#3b4046",
              }}
            >
              {a.libelle} <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {ouvert === a.cle && (
              <div
                role="menu"
                style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, minWidth: 240, background: "#ffffff", border: `1px solid ${C.ligne}`, borderRadius: 10, boxShadow: "0 10px 24px rgba(0,0,0,.16)", padding: 4 }}
              >
                {pages.map((o) => (
                  <Link
                    key={o.cle}
                    role="menuitem"
                    href={o.href}
                    onClick={() => setOuvert(null)}
                    style={{
                      display: "block",
                      padding: "9px 12px",
                      borderRadius: 7,
                      textDecoration: "none",
                      fontWeight: o.cle === actif ? 800 : 600,
                      color: o.cle === actif ? C.rougeFonce : "#1f2328",
                      background: o.cle === actif ? "#fff1f1" : undefined,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {o.libelle}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* séparateur */}
      <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", margin: "8px 10px", background: C.ligne }} />

      {/* les pages de l'axe courant, en onglets */}
      {pagesAxe.map((o) => {
        const a = o.cle === actif;
        return (
          <Link
            key={o.cle}
            href={o.href}
            aria-current={a ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              padding: "0 11px",
              fontWeight: 700,
              fontSize: 14,
              color: a ? C.rougeFonce : "#3b4046",
              textDecoration: "none",
              borderBottom: `3px solid ${a ? C.rouge : "transparent"}`,
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
