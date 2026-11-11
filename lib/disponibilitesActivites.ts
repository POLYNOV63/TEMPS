import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chargerAffectations, chargerAnnuaire, chargerCapacitesAbsences } from "@/lib/pilotageDonnees";
import { ajouterJours, chargeParSemaine, construireCapacites, type JourAffecte } from "@/lib/pilotagePlanning";
import { num, type Collab } from "@/lib/pilotageCalculs";

/* ===============================================================
   DISPONIBILITÉS PAR ACTIVITÉ - CALCUL PARTAGÉ (DISPOS_PARTAGEES)

   Repris tel quel de la page « Disponibilités par activité »
   (CHARGE_ACTIVITES_V5), pour servir aussi au tableau de bord de la
   Direction. Méca, Elec et Calcul ; pour chaque activité, les personnes
   dont c'est une activité principale (équipe hors encadrement) :
   capacité, occupées (dont prévisionnel), disponibles par niveau,
   surcharge, semaine par semaine.
================================================================ */

export const ACTIVITES_SUIVIES = [
  { cle: "meca", libelle: "Méca", couleur: "#c00000" },
  { cle: "elec", libelle: "Elec", couleur: "#34506b" },
  { cle: "calcul", libelle: "Calcul", couleur: "#6b58a8" },
];

/* niveaux : du plus clair au plus foncé */
export const NIVEAUX = [
  { n: 1, libelle: "Niveau 1", aide: "exécute sous supervision", couleur: "#c8e6c9" },
  { n: 2, libelle: "Niveau 2", aide: "autonome sur une affaire courante", couleur: "#66bb6a" },
  { n: 3, libelle: "Niveau 3", aide: "expert ou référent", couleur: "#2e7d32" },
  { n: 0, libelle: "Niveau non renseigné", aide: "à saisir dans la fiche collaborateur", couleur: "#e3e7e3" },
];

const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export type PersonneDispo = {
  c: Collab;
  niveau: number;
  aussi: string[]; // ses autres activités principales
  semaines: { capa: number; occ: number; prev: number }[];
};

export type DonneeActivite = (typeof ACTIVITES_SUIVIES)[number] & {
  personnes: PersonneDispo[];
  capa: number[];
  occ: number[];
  prev: number[];
  prevUtile: number[];
  dispo: number[];
  parNiveau: number[][];
  surcharge: number[];
};

export function useDisponibilitesActivites(lundi: string, nbSemaines = 12) {
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [predo, setPredo] = useState<Map<string, Set<string>>>(new Map());
  const [activites, setActivites] = useState<{ id: string; nom: string }[]>([]);
  const [joursAffectes, setJoursAffectes] = useState<JourAffecte[]>([]);
  const [joursPrev, setJoursPrev] = useState<JourAffecte[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });
  const [niveaux, setNiveaux] = useState<Map<string, number>>(new Map());
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const fenetreFin = ajouterJours(lundi, nbSemaines * 7 - 1);

  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerAnnuaire(),
      supabase.from("collaborateurs_predominances").select("collaborateur_id,activite_id").eq("niveau", "PRINCIPALE"),
      supabase.from("activites").select("id,nom"),
      supabase.from("collaborateurs_niveaux").select("collaborateur_id,niveau"),
    ])
      .then(([an, p, a, nv]) => {
        if (!actif) return;
        // sans la table (SQL 86 pas encore passé) : tout le monde « non renseigné »
        setNiveaux(new Map(((nv.data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0])));
        setAnnuaire(an);
        // une personne peut avoir plusieurs activités principales : on les garde toutes
        const m = new Map<string, Set<string>>();
        for (const x of (p.data ?? []) as { collaborateur_id: string; activite_id: string }[]) {
          const e = m.get(x.collaborateur_id) ?? new Set<string>();
          e.add(x.activite_id);
          m.set(x.collaborateur_id, e);
        }
        setPredo(m);
        setActivites((a.data ?? []) as { id: string; nom: string }[]);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."));
    return () => {
      actif = false;
    };
  }, []);

  useEffect(() => {
    let actif = true;
    setChargement(true);
    Promise.all([chargerAffectations(lundi, fenetreFin), chargerCapacitesAbsences(lundi, fenetreFin)])
      .then(([aff, cap]) => {
        if (!actif) return;
        const parId = new Map(aff.affectations.map((a) => [a.id, a]));
        const tous = aff.jours
          .map((j) => {
            const a = parId.get(j.affectation_id);
            return a ? { collaborateur_id: a.collaborateur_id, jour: j.jour, heures: num(j.heures), prev: Boolean((a as { previsionnel?: boolean | null }).previsionnel) } : null;
          })
          .filter((x): x is JourAffecte & { prev: boolean } => x !== null);
        setJoursAffectes(tous);
        setJoursPrev(tous.filter((x) => x.prev));
        setCaps(cap);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [lundi, fenetreFin]);

  const capacites = useMemo(() => construireCapacites(caps.caps, caps.absences), [caps]);
  const semaines = useMemo(() => Array.from({ length: nbSemaines }, (_, w) => ajouterJours(lundi, w * 7)), [lundi, nbSemaines]);

  /* par activité suivie : ses personnes, et pour chaque semaine capacité / occupées / disponibles */
  const donnees: DonneeActivite[] = useMemo(() => {
    const equipe = annuaire.filter((c) => c.inclus_statistiques);
    return ACTIVITES_SUIVIES.map((s) => {
      const ids = new Set(activites.filter((a) => sansAccents(a.nom).startsWith(s.cle)).map((a) => a.id));
      const personnes = equipe.filter((c) => [...(predo.get(c.id) ?? [])].some((id) => ids.has(id)));
      const parPersonne: PersonneDispo[] = personnes.map((c) => ({
        c,
        niveau: niveaux.get(c.id) ?? 0,
        aussi: [...(predo.get(c.id) ?? [])].filter((id) => !ids.has(id)).map((id) => activites.find((a) => a.id === id)?.nom ?? "").filter(Boolean),
        semaines: semaines.map((l) => {
          const x = chargeParSemaine(capacites, joursAffectes, c.id, l);
          const pv = chargeParSemaine(capacites, joursPrev, c.id, l).affecte;
          return { capa: x.net, occ: x.affecte, prev: pv };
        }),
      }));
      const capa = semaines.map((_, w) => parPersonne.reduce((t, p) => t + p.semaines[w].capa, 0));
      const occ = semaines.map((_, w) => parPersonne.reduce((t, p) => t + p.semaines[w].occ, 0));
      const libre = (p: PersonneDispo, w: number) => Math.max(0, p.semaines[w].capa - p.semaines[w].occ);
      const parNiveau = NIVEAUX.map((nv) => semaines.map((_, w) => parPersonne.filter((p) => p.niveau === nv.n).reduce((t, p) => t + libre(p, w), 0)));
      const dispo = semaines.map((_, w) => parNiveau.reduce((t, x) => t + x[w], 0));
      const surcharge = semaines.map((_, w) => parPersonne.reduce((t, p) => t + Math.max(0, p.semaines[w].occ - p.semaines[w].capa), 0));
      const prev = semaines.map((_, w) => parPersonne.reduce((t, p) => t + p.semaines[w].prev, 0));
      // part prévisionnelle dans les heures occupées sans surcharge (pour le graphique)
      const prevUtile = semaines.map((_, w) => parPersonne.reduce((t, p) => t + Math.min(p.semaines[w].prev, Math.min(p.semaines[w].occ, p.semaines[w].capa)), 0));
      return { ...s, personnes: parPersonne, capa, occ, prev, prevUtile, dispo, parNiveau, surcharge };
    });
  }, [annuaire, activites, predo, niveaux, semaines, capacites, joursAffectes, joursPrev]);

  return { donnees, semaines, fenetreFin, chargement, erreur };
}
