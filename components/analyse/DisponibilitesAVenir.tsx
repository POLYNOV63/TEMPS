"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { C, page } from "@/components/pilotage/ui";
import DisponibilitesActivites from "@/components/ressources/DisponibilitesActivites";
import CompositionEquipe from "@/components/ressources/CompositionEquipe";
import { aISO, ajouterJours, lundiDe, numeroSemaine } from "@/lib/pilotagePlanning";
import { formatDate } from "@/lib/pilotageCalculs";

/* ===============================================================
   ANALYSE DE CAPACITÉ - ONGLET « DISPONIBILITÉS À VENIR » (CAPACITE_DISPOS)
   Déplacé depuis la page Ressources : les disponibilités par activité
   (graphiques, détail d'une semaine, récapitulatif en heures exportable
   en Excel) et la composition de l'équipe.
   Sur Ressources, la semaine de départ venait de « Charge de l'équipe » ;
   ici elle a son propre sélecteur (cette semaine au départ).
   Les anciennes adresses (/analyse/charge-activites, /analyse/effectifs)
   arrivent ici (#disponibilites, #composition).
================================================================ */

export default function DisponibilitesAVenir() {
  const [lundi, setLundi] = useState(() => lundiDe(aISO(new Date())));
  const lundiActuel = lundiDe(aISO(new Date()));

  /* ANCRES : #disponibilites ou #composition dans l'adresse */
  useEffect(() => {
    const id = window.location.hash.replace("#", "");
    if (id !== "disponibilites" && id !== "composition") return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 600);
    return () => window.clearTimeout(t);
  }, []);

  const btn: CSSProperties = { minHeight: 36, minWidth: 36, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: "0 10px" };

  return (
    <div style={{ maxWidth: 1500 }}>
      <div style={{ ...page.carte, padding: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.gris, textTransform: "uppercase" }}>À partir de</span>
        <button type="button" style={btn} onClick={() => setLundi(ajouterJours(lundi, -7))} aria-label="Semaine précédente">
          ◀
        </button>
        <strong>
          S{numeroSemaine(lundi)} · {formatDate(lundi)}
        </strong>
        <button type="button" style={btn} onClick={() => setLundi(ajouterJours(lundi, 7))} aria-label="Semaine suivante">
          ▶
        </button>
        {lundi !== lundiActuel && (
          <button type="button" style={btn} onClick={() => setLundi(lundiActuel)}>
            Cette semaine
          </button>
        )}
        <span style={{ fontSize: 13, color: C.gris }}>l’avenir, tel qu’il est planifié ; le détail par personne reste dans Ressources</span>
      </div>
      <DisponibilitesActivites lundi={lundi} />
      <CompositionEquipe />
    </div>
  );
}
