"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { C } from "@/components/pilotage/ui";
import { peut, type Droit } from "@/lib/droits";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   NAVIGATION PAR AXES (NAVIGATION_AXES)

   Bandeau fixe en haut des pages du Pilotage et des analyses, rangé comme
   le tableau de bord :
   - 1re ligne : les axes (Affaires · Charge · Analyses) ;
   - 2e ligne  : les pages de l'axe courant.
   Chaque page n'apparaît qu'aux rôles qui y ont accès ; un axe sans page
   accessible n'apparaît pas.
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
  // Analyses : ce qui a été fait, ce que ça a rapporté
  // DISPOS_SANS_SURCHARGE : Analyse de capacité en dernier (la plus longue à charger)
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

  useEffect(() => {
    chargerMoi()
      .then((m) => setRole(m?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  /* PLANNING_NAV_UNIQUE : la hauteur du bandeau, pour que les éléments figés des pages se placent juste dessous */
  const refNav = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = refNav.current;
    if (!el) return;
    const maj = () => document.documentElement.style.setProperty("--hauteur-nav", `${Math.round(el.getBoundingClientRect().height)}px`);
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const courant = ONGLETS.find((o) => o.cle === actif);
  const axeCourant: Axe = courant?.axe ?? "affaires";
  // Tant que le rôle n'est pas connu, seul l'onglet courant est affiché
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
        padding: "0 28px",
        fontFamily: "Calibri, Arial, sans-serif",
      }}
    >
      {/* les axes */}
      {axesVisibles.length > 1 && (
        <div style={{ display: "flex", gap: 6, paddingTop: 8, flexWrap: "wrap" }}>
          {axesVisibles.map((a) => {
            const actifAxe = a.cle === axeCourant;
            const premiere = visibles.find((o) => o.axe === a.cle);
            return (
              <Link
                key={a.cle}
                href={actifAxe || !premiere ? "#" : premiere.href}
                aria-current={actifAxe ? "true" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 30,
                  padding: "0 14px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: ".4px",
                  textDecoration: "none",
                  background: actifAxe ? C.rouge : "#f1f2f4",
                  color: actifAxe ? "#ffffff" : "#3b4046",
                }}
              >
                {a.libelle}
              </Link>
            );
          })}
        </div>
      )}

      {/* les pages de l'axe courant */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                padding: "0 14px",
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
      </div>
    </nav>
  );
}
