"use client";

import { useEffect, useMemo, useState } from "react";
import { chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import {
  ajouterJours,
  construireCapacites,
  joursSansCapacite,
  quantiteJusquaDate,
  remplirHeures,
  remplirJours,
  type Capacites,
  type JourHeures,
  type JourManquant,
} from "@/lib/pilotagePlanning";
import { num } from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - CALCUL D'UNE PRESTATION (PE / PI)

   Une personne, une date de début, puis :
     - une date de fin,
     - ou un nombre d'heures,
     - ou un nombre de jours.
   Congés validés, jours fériés et week-ends ne sont pas travaillés :
   la fin est repoussée d'autant. On n'utilise jamais des disponibilités
   qui ne couvrent pas exactement la période demandée.
================================================================ */

export type ModeFin = "DATE" | "HEURES" | "JOURS";

export type ResultatPrestation = {
  jours: JourHeures[];
  total: number;
  fin: string | null;
  epuise: boolean;
};

export function usePrestation(o: {
  collab: string;
  debut: string;
  mode: ModeFin;
  fin: string;
  quantite: string;
  pourcent: string;
}) {
  const n = num(o.quantite.replace(",", "."));
  const p = Math.min(100, Math.max(1, num(o.pourcent.replace(",", ".")) || 100));

  const horizon = useMemo(() => {
    if (!o.debut) return "";

    const plafond = ajouterJours(o.debut, 380);

    if (o.mode === "DATE") {
      if (!o.fin || o.fin < o.debut) return "";
      const h = ajouterJours(o.fin, 150);
      return h < plafond ? h : plafond;
    }

    if (n <= 0) return "";

    const joursEstimes = o.mode === "JOURS" ? n : Math.ceil(n / Math.max(0.5, 7.5 * (p / 100)));
    const h = ajouterJours(o.debut, Math.ceil(joursEstimes * 2.2) + 45);

    return h < plafond ? h : plafond;
  }, [o.debut, o.mode, o.fin, n, p]);

  const [capacites, setCapacites] = useState<Capacites | null>(null);
  const [couverture, setCouverture] = useState<{ debut: string; fin: string } | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setCapacites(null);
    setCouverture(null);
    setErreur("");

    if (!o.collab || !o.debut || !horizon || horizon < o.debut) {
      setChargement(false);
      return;
    }

    let actif = true;
    setChargement(true);

    const t = setTimeout(async () => {
      try {
        const { caps, absences } = await chargerCapacitesAbsences(o.debut, horizon);

        if (actif) {
          setCapacites(construireCapacites(caps, absences));
          setCouverture({ debut: o.debut, fin: horizon });
        }
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de calculer les disponibilités.");
      } finally {
        if (actif) setChargement(false);
      }
    }, 250);

    return () => {
      actif = false;
      clearTimeout(t);
    };
  }, [o.collab, o.debut, horizon]);

  const pret = Boolean(capacites && couverture && couverture.debut === o.debut && couverture.fin === horizon && !chargement);

  const resultat: ResultatPrestation | null = useMemo(() => {
    if (!pret || !capacites || !o.collab) return null;

    const cap = capacites.get(o.collab);
    const net = (j: string) => cap?.get(j)?.net ?? 0;
    const theorique = (j: string) => {
      const x = cap?.get(j);
      return x && !x.ferie ? x.theorique : 0;
    };

    if (o.mode === "DATE") {
      const q = quantiteJusquaDate({ debut: o.debut, fin: o.fin, capaciteHorsAbsence: theorique, pourcent: p });
      const r = remplirHeures({ debut: o.debut, quantiteHeures: q, capaciteJour: net, pourcent: p, horizon });
      return { jours: r.jours, total: r.total, fin: r.fin, epuise: r.epuise };
    }

    if (o.mode === "HEURES") {
      const r = remplirHeures({ debut: o.debut, quantiteHeures: n, capaciteJour: net, pourcent: p, horizon });
      return { jours: r.jours, total: r.total, fin: r.fin, epuise: r.epuise };
    }

    const r = remplirJours({ debut: o.debut, nbJours: n, capaciteJour: net, theoriqueJour: theorique, pourcent: p, horizon });
    return { jours: r.jours, total: r.total, fin: r.fin, epuise: r.epuise };
  }, [pret, capacites, o.collab, o.mode, o.debut, o.fin, n, p, horizon]);

  const manquants: JourManquant[] = useMemo(
    () => (resultat?.fin && capacites ? joursSansCapacite(o.debut, resultat.fin, capacites.get(o.collab)) : []),
    [resultat, capacites, o.debut, o.collab]
  );

  return { pret, chargement, erreur, resultat, manquants };
}
