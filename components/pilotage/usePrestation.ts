"use client";

import { useEffect, useMemo, useState } from "react";
import { chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import {
  ajouterJours,
  construireCapacites,
  finTheoriquePrestation,
  genererJours,
  joursSansCapacite,
  quantiteJusquaDate,
  remplirCalendrier,
  remplirHeures,
  remplirJours,
  type Capacites,
  type JourHeures,
  type JourManquant,
} from "@/lib/pilotagePlanning";
import { num } from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - CALCUL D'UNE PRESTATION (PE / PI)

   Une ou plusieurs personnes, une date de début, puis :
     - une date de fin,
     - ou un nombre d'heures,
     - ou un nombre de jours.

   La durée peut EXCLURE les congés et jours fériés (défaut) : ils ne sont
   pas travaillés, la fin est repoussée d'autant. Ou les COMPRENDRE : ils
   sont comptés dans la durée et la fin ne bouge pas.

   On n'utilise jamais des disponibilités qui ne couvrent pas exactement
   la période demandée.
================================================================ */

export type ModeFin = "DATE" | "HEURES" | "JOURS";

export type PersonnePrestation = { id: string; pourcent: string };

export type ResultatPrestation = {
  jours: JourHeures[];
  total: number;
  fin: string | null; // dernier jour avec des heures
  finDuree: string | null; // fin de la durée (identique à `fin`, sauf durée qui comprend les congés)
  epuise: boolean;
  manquants: JourManquant[];
};

export function usePrestation(o: {
  personnes: PersonnePrestation[];
  debut: string;
  mode: ModeFin;
  fin: string;
  quantite: string;
  comprendConges: boolean;
}) {
  const n = num(o.quantite.replace(",", "."));
  const ids = o.personnes.map((p) => p.id).join("|");
  const pourcents = o.personnes.map((p) => p.pourcent).join("|");

  const horizon = useMemo(() => {
    if (!o.debut) return "";

    const plafond = ajouterJours(o.debut, 380);

    if (o.mode === "DATE") {
      if (!o.fin || o.fin < o.debut) return "";
      const h = ajouterJours(o.fin, 150);
      return h < plafond ? h : plafond;
    }

    if (n <= 0) return "";

    const joursEstimes = o.mode === "JOURS" ? n : Math.ceil(n / 3);
    const h = ajouterJours(o.debut, Math.ceil(joursEstimes * 2.2) + 45);

    return h < plafond ? h : plafond;
  }, [o.debut, o.mode, o.fin, n]);

  const [capacites, setCapacites] = useState<Capacites | null>(null);
  const [couverture, setCouverture] = useState<{ debut: string; fin: string } | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setCapacites(null);
    setCouverture(null);
    setErreur("");

    if (o.personnes.length === 0 || !o.debut || !horizon || horizon < o.debut) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids ? 1 : 0, o.debut, horizon]);

  const pret = Boolean(capacites && couverture && couverture.debut === o.debut && couverture.fin === horizon && !chargement);

  const resultats = useMemo(() => {
    const m = new Map<string, ResultatPrestation>();

    if (!pret || !capacites) return m;

    for (const personne of o.personnes) {
      const p = Math.min(100, Math.max(1, num(personne.pourcent.replace(",", ".")) || 100));
      const cap = capacites.get(personne.id);
      const net = (j: string) => cap?.get(j)?.net ?? 0;
      const theorique = (j: string) => {
        const x = cap?.get(j);
        return x && !x.ferie ? x.theorique : 0;
      };

      let jours: JourHeures[] = [];
      let total = 0;
      let fin: string | null = null;
      let finDuree: string | null = null;
      let epuise = true;

      if (o.mode === "DATE") {
        if (o.comprendConges) {
          // fin fixe : les heures sont réparties sur les jours travaillés, rien n'est repoussé
          const r = genererJours({ mode: "PLAGE", debut: o.debut, fin: o.fin, capaciteJour: net, pourcent: p });
          jours = r.jours;
          total = r.total;
          fin = r.jours.length ? r.jours[r.jours.length - 1].jour : null;
          finDuree = o.fin;
        } else {
          const q = quantiteJusquaDate({ debut: o.debut, fin: o.fin, capaciteHorsAbsence: theorique, pourcent: p });
          const r = remplirHeures({ debut: o.debut, quantiteHeures: q, capaciteJour: net, pourcent: p, horizon });
          jours = r.jours;
          total = r.total;
          fin = r.fin;
          finDuree = r.fin;
          epuise = r.epuise;
        }
      } else if (o.comprendConges) {
        // durée qui comprend congés et fériés : « heures » converties en jours de la personne
        const parJour = (() => {
          for (let j = o.debut, k = 0; k < 14; j = ajouterJours(j, 1), k++) {
            const x = theorique(j);
            if (x > 0) return x;
          }
          return 7.5;
        })();

        const nbJours = o.mode === "JOURS" ? n : Math.ceil((n / (parJour * (p / 100))) * 4) / 4;
        const r = remplirCalendrier({ debut: o.debut, nbJours, capaciteJour: net, pourcent: p, horizon });

        jours = r.jours;
        total = r.total;
        fin = r.fin;
        finDuree = r.finCalendrier ?? null;
        epuise = r.epuise;
      } else if (o.mode === "HEURES") {
        const r = remplirHeures({ debut: o.debut, quantiteHeures: n, capaciteJour: net, pourcent: p, horizon });
        jours = r.jours;
        total = r.total;
        fin = r.fin;
        finDuree = r.fin;
        epuise = r.epuise;
      } else {
        const r = remplirJours({ debut: o.debut, nbJours: n, capaciteJour: net, theoriqueJour: theorique, pourcent: p, horizon });
        jours = r.jours;
        total = r.total;
        fin = r.fin;
        finDuree = r.fin;
        epuise = r.epuise;
      }

      m.set(personne.id, {
        jours,
        total,
        fin,
        finDuree,
        epuise,
        manquants: finDuree && cap ? joursSansCapacite(o.debut, finDuree, cap) : [],
      });
    }

    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pret, capacites, ids, pourcents, o.mode, o.debut, o.fin, n, o.comprendConges, horizon]);

  /* Fin théorique de la prestation : la plus tardive des personnes ; sans résultat (personne pas encore
     choisie), calcul sur les seuls jours fériés. */
  const finTheorique = useMemo(() => {
    const fins = [...resultats.values()].map((r) => r.finDuree).filter((x): x is string => Boolean(x));

    if (fins.length > 0) return fins.sort().slice(-1)[0];

    if (o.mode === "DATE") return o.fin || null;

    return n > 0 && o.debut
      ? finTheoriquePrestation({ debut: o.debut, quantite: n, unite: o.mode === "HEURES" ? "HEURES" : "JOURS", comprendConges: o.comprendConges })
      : null;
  }, [resultats, o.mode, o.fin, o.debut, o.comprendConges, n]);

  return { pret, chargement, erreur, resultats, finTheorique };
}
