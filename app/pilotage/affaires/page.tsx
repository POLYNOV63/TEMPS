"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as PointerReact } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import AffecterDialog from "@/components/pilotage/AffecterDialog";
import FicheAffaireDialog from "@/components/pilotage/FicheAffaireDialog";
import FicheRessourceDialog from "@/components/pilotage/FicheRessourceDialog";
import { BadgeType, C, Message, Pastille, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerActivites,
  chargerAffaires,
  chargerAnnuaire,
  chargerCapacitesAbsences,
  chargerCharges,
  chargerImputations,
  chargerPlanifie,
  type ReferentielActivites,
} from "@/lib/pilotageDonnees";
import {
  aISO,
  ajouterJours,
  chargeParSemaine,
  construireCapacites,
  estFerie,
  estWeekend,
  finMaxPourHeures,
  jourSemaine,
  joursChezLeClient,
  joursOuvres,
  joursSansCapacite,
  lundiDe,
  positionPiste,
  numeroSemaine,
  ratioDuBloc,
  recalculerBloc,
  bornesApresGlisse as bornesGlisse,
  depasseBornes,
  type Affectation,
  type JourAffecte,
  type JourHeures,
  type JourRow,
} from "@/lib/pilotagePlanning";
import {
  formatDate,
  formatHeures,
  nomCollab,
  num,
  traduireErreur,
  type Affaire,
  type Charge,
  type Collab,
  type Genre,
  type Imputation,
} from "@/lib/pilotageCalculs";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   PILOTAGE BE - PLANNING DES AFFAIRES

   On pilote les affaires. On déplie une affaire, on y affecte des
   personnes (en les glissant depuis le panneau des ressources, ou avec
   « + Affecter »), puis on étire ou on déplace leur bloc. Le logiciel
   compare aussitôt au chiffré et signale congés et surcharges.
   Le planning de charge des ressources en découle (autre fenêtre).

   Les personnes en PE sont chez le client : elles ne sont pas
   affectables ailleurs.
================================================================ */

/* PE en haut, PI ensuite, le reste dessous */
const rangGroupe = (a: { imputation: string | null }) => (a.imputation === "PE" ? 0 : a.imputation === "PI" ? 1 : 2);
const TITRES_GROUPES = ["Prestations externes (PE) — chez le client", "Prestations internes (PI)", "Autres affaires"];

const LARGEUR_NOM = 250;
const LARGEUR_STATUT = 210;
const JOURS_COURTS = ["L", "M", "M", "J", "V"];

type Bloc = {
  affectation: Affectation;
  jours: JourHeures[];
  heures: number;
  debutIdx: number;
  finIdx: number;
  coupeGauche: boolean;
  coupeDroite: boolean;
};

type DragEtat = { id: string; mode: "move" | "debut" | "fin"; delta: number };

/* Barre de l'affaire (bornes théoriques d'une prestation PE / PI) */
type PisteAffaire = {
  debut: string;
  fin: string;
  debutIdx: number;
  finIdx: number;
  coupeGauche: boolean;
  coupeDroite: boolean;
};

const ROUGE_HACHURE = "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#f0b4b0 4px,#f0b4b0 8px)";

function PlanningAffairesContenu() {
  const [lundi, setLundi] = useState(() => lundiDe(aISO(new Date())));
  const [nbSemaines, setNbSemaines] = useState(4);

  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [peutAgir, setPeutAgir] = useState(false);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [joursRows, setJoursRows] = useState<JourRow[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rechargement, setRechargement] = useState(0);

  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [filtreType, setFiltreType] = useState<"TOUS" | "CBE" | "DBE" | "PE" | "PI">("TOUS");
  const [limiter, setLimiter] = useState(false);
  const [drag, setDrag] = useState<DragEtat | null>(null);
  const [dragAffaire, setDragAffaire] = useState<DragEtat | null>(null);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [ficheRessource, setFicheRessource] = useState<null | {
    affaire: Affaire;
    edition?: { affectation: Affectation; jours: JourRow[] };
    prefill?: { collaborateurId?: string; debut?: string; fin?: string };
  }>(null);
  const [ficheAffaire, setFicheAffaire] = useState<Affaire | null>(null);
  const [dialogue, setDialogue] = useState<null | {
    affaire: Affaire;
    prefill?: { collaborateurId?: string; debut?: string };
    edition?: { affectation: Affectation; jours: JourRow[] };
  }>(null);

  const fin = ajouterJours(lundi, nbSemaines * 7 - 1);
  const debutDonnees = ajouterJours(lundi, -90);

  // Ouverture directe d'une affaire (?ouvrir=...) après sa déclaration
  const ouvrirId = useRef<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ouvrir");

    if (id) {
      ouvrirId.current = id;
      setOuvertes(new Set([id]));
    }
  }, []);

  useEffect(() => {
    try {
      setLimiter(window.localStorage.getItem("polynov-limiter-chiffre") === "1");
    } catch {
      /* stockage indisponible : on garde le réglage par défaut */
    }
  }, []);

  function changerLimiter(valeur: boolean) {
    setLimiter(valeur);
    try {
      window.localStorage.setItem("polynov-limiter-chiffre", valeur ? "1" : "0");
    } catch {
      /* ignoré */
    }
  }

  useEffect(() => {
    let actif = true;
    setChargement(true);

    Promise.all([
      chargerAffaires(),
      chargerCharges(),
      chargerAnnuaire(),
      chargerActivites(),
      chargerImputations(),
      chargerMoi(),
      chargerPlanifie(debutDonnees),
      chargerCapacitesAbsences(lundi, fin),
    ])
      .then(([af, ch, an, ref, im, moi, pl, cap]) => {
        if (!actif) return;
        setAffaires(af);
        setCharges(ch);
        setAnnuaire(an);
        setReferentiel(ref);
        setImputations(im);
        setPeutAgir(Boolean(moi?.peutModifier));
        setAffectations(pl.affectations);
        setJoursRows(pl.jours);
        setCaps(cap);

        const cible = ouvrirId.current;

        if (cible) {
          ouvrirId.current = null;
          const premiers = pl.affectations.filter((a) => a.affaire_id === cible).map((a) => a.date_debut).sort();
          if (premiers.length > 0) setLundi(lundiDe(premiers[0] > aISO(new Date()) ? premiers[0] : aISO(new Date())));
        }
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger le planning."))
      .finally(() => actif && setChargement(false));

    return () => {
      actif = false;
    };
  }, [lundi, fin, debutDonnees, rechargement]);

  const colonnes = useMemo(() => joursOuvres(lundi, fin), [lundi, fin]);
  const capacites = useMemo(() => construireCapacites(caps.caps, caps.absences), [caps]);
  const aujourdhui = aISO(new Date());

  const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);
  const estPE = useCallback((id: string) => affairesParId.get(id)?.imputation === "PE", [affairesParId]);

  /* Prestation (PE, PI) : imputation sans heures chiffrées obligatoires */
  const estPrestation = useCallback(
    (a: Affaire) => {
      const imputation = imputations.find((i) => i.code === a.imputation);
      return imputation ? imputation.charge_obligatoire === false : a.imputation === "PE" || a.imputation === "PI";
    },
    [imputations]
  );

  /* Bornes théoriques de chaque affaire : celles de l'affaire si elles sont définies,
     sinon l'étendue de ses ressources. */
  const bornesParAffaire = useMemo(() => {
    const m = new Map<string, { debut: string | null; fin: string | null }>();
    const parAffaire = new Map<string, Affectation[]>();

    for (const a of affectations) {
      if (!a.affaire_id) continue;
      const l = parAffaire.get(a.affaire_id) ?? [];
      l.push(a);
      parAffaire.set(a.affaire_id, l);
    }

    for (const af of affaires) {
      const l = parAffaire.get(af.id) ?? [];
      const debutEffectif = l.length ? l.map((x) => x.date_debut).sort()[0] : null;
      const finEffective = l.length ? l.map((x) => x.date_fin).sort().slice(-1)[0] : null;

      m.set(af.id, { debut: af.date_debut ?? debutEffectif, fin: af.echeance ?? finEffective });
    }

    return m;
  }, [affaires, affectations]);

  const chiffreParAffaire = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of charges) m.set(c.affaire_id, (m.get(c.affaire_id) ?? 0) + num(c.heures));
    return m;
  }, [charges]);

  const joursParAffectation = useMemo(() => {
    const m = new Map<string, JourHeures[]>();

    for (const j of joursRows) {
      if (!m.has(j.affectation_id)) m.set(j.affectation_id, []);
      m.get(j.affectation_id)!.push({ jour: j.jour, heures: num(j.heures) });
    }

    for (const l of m.values()) l.sort((a, b) => a.jour.localeCompare(b.jour));

    return m;
  }, [joursRows]);

  const chezLeClient = useMemo(() => joursChezLeClient(affectations, joursRows, estPE), [affectations, joursRows, estPE]);

  const joursAffectes: JourAffecte[] = useMemo(() => {
    const parId = new Map(affectations.map((a) => [a.id, a]));

    return joursRows
      .map((j) => {
        const a = parId.get(j.affectation_id);
        return a ? { collaborateur_id: a.collaborateur_id, jour: j.jour, heures: num(j.heures) } : null;
      })
      .filter((x): x is JourAffecte => x !== null);
  }, [joursRows, affectations]);

  // Blocs, par affaire
  const blocsParAffaire = useMemo(() => {
    const index = new Map<string, Bloc[]>();
    const premier = colonnes[0];
    const dernier = colonnes[colonnes.length - 1];

    for (const a of affectations) {
      if (!a.affaire_id) continue;
      const jours = joursParAffectation.get(a.id) ?? [];
      if (jours.length === 0) continue;

      const d = jours[0].jour;
      const f = jours[jours.length - 1].jour;
      if (f < premier || d > dernier) continue;

      const idxDebut = colonnes.findIndex((j) => j >= d);
      let idxFin = -1;
      for (let i = colonnes.length - 1; i >= 0; i--) {
        if (colonnes[i] <= f) {
          idxFin = i;
          break;
        }
      }
      if (idxDebut < 0 || idxFin < 0 || idxFin < idxDebut) continue;

      const bloc: Bloc = {
        affectation: a,
        jours,
        heures: jours.reduce((t, j) => t + j.heures, 0),
        debutIdx: idxDebut,
        finIdx: idxFin,
        coupeGauche: d < premier,
        coupeDroite: f > dernier,
      };

      if (!index.has(a.affaire_id)) index.set(a.affaire_id, []);
      index.get(a.affaire_id)!.push(bloc);
    }

    for (const l of index.values()) l.sort((x, y) => x.debutIdx - y.debutIdx);

    return index;
  }, [affectations, joursParAffectation, colonnes]);

  const affecteParAffaire = useMemo(() => {
    const m = new Map<string, { heures: number; fin: string | null }>();

    for (const a of affectations) {
      if (!a.affaire_id) continue;
      const jours = joursParAffectation.get(a.id) ?? [];
      const r = m.get(a.affaire_id) ?? { heures: 0, fin: null };
      r.heures += jours.reduce((t, j) => t + j.heures, 0);
      const f = jours.length ? jours[jours.length - 1].jour : null;
      if (f && (!r.fin || f > r.fin)) r.fin = f;
      m.set(a.affaire_id, r);
    }

    return m;
  }, [affectations, joursParAffectation]);

  const besoinsParAffaire = useMemo(() => {
    const noms = new Map((referentiel?.activites ?? []).map((a) => [a.id, a.nom]));
    const parAffaire = new Map<string, Map<string, { nom: string; chiffre: number; affecte: number }>>();

    for (const c of charges) {
      const m = parAffaire.get(c.affaire_id) ?? new Map();
      const e = m.get(c.activite_id) ?? { nom: noms.get(c.activite_id) ?? "Activité", chiffre: 0, affecte: 0 };
      e.chiffre += num(c.heures);
      m.set(c.activite_id, e);
      parAffaire.set(c.affaire_id, m);
    }

    for (const a of affectations) {
      if (!a.affaire_id || !a.activite_id) continue;
      const e = parAffaire.get(a.affaire_id)?.get(a.activite_id);
      if (e) e.affecte += (joursParAffectation.get(a.id) ?? []).reduce((t, j) => t + j.heures, 0);
    }

    return parAffaire;
  }, [charges, affectations, joursParAffectation, referentiel]);

  const lignes = useMemo(
    () =>
      affaires
        .filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE")
        .filter((a) => {
          if (filtreType === "TOUS") return true;
          if (filtreType === "PE") return a.imputation === "PE";
          if (filtreType === "PI") return a.imputation === "PI";
          return a.type === filtreType;
        })
        .sort(
          (a, b) =>
            rangGroupe(a) - rangGroupe(b) ||
            (a.echeance ?? "9999").localeCompare(b.echeance ?? "9999") ||
            b.numero.localeCompare(a.numero, "fr", { numeric: true })
        ),
    [affaires, filtreType]
  );

  // Panneau des ressources : les plus libres d'abord
  const ressources = useMemo(() => {
    const semaines = Array.from({ length: Math.min(8, nbSemaines) }, (_, w) => ajouterJours(lundi, w * 7));

    return annuaire
      .filter((c) => c.inclus_statistiques)
      .map((c) => {
        const libre = semaines.map((l) => {
          const s = chargeParSemaine(capacites, joursAffectes, c.id, l);
          return s.net > 0 ? Math.max(0, Math.round(100 - (s.affecte / s.net) * 100)) : 0;
        });
        const client = chezLeClient.get(c.id);
        const jusquau = client ? [...client].filter((j) => j >= aujourdhui).sort().slice(-1)[0] ?? null : null;

        return { collab: c, libre, totalLibre: libre.reduce((t, v) => t + v, 0), chezLeClientJusquau: jusquau };
      })
      .sort((a, b) => Number(!!a.chezLeClientJusquau) - Number(!!b.chezLeClientJusquau) || b.totalLibre - a.totalLibre);
  }, [annuaire, nbSemaines, lundi, capacites, joursAffectes, chezLeClient, aujourdhui]);

  /* ------------------------------ glisser / étirer ------------------------------ */

  const pistesAffaires = useMemo(() => {
    const m = new Map<string, PisteAffaire>();

    for (const a of affaires) {
      if (!estPrestation(a)) continue;

      const b = bornesParAffaire.get(a.id);
      if (!b?.debut || !b.fin) continue;

      const position = positionPiste(b.debut, b.fin, colonnes);
      if (!position) continue;

      m.set(a.id, { debut: b.debut, fin: b.fin, ...position });
    }

    return m;
  }, [affaires, estPrestation, bornesParAffaire, colonnes]);

  const ref = useRef({
    colonnes,
    blocs: new Map<string, Bloc>(),
    capacites,
    affairesParId,
    chiffreParAffaire,
    affecteParAffaire,
    chezLeClient,
    limiter,
    joursParAffectation,
    pistes: new Map<string, PisteAffaire>(),
    estPrestation: (_a: Affaire) => false as boolean,
    clientHorsAffectation: (_id: string, _collab: string) => undefined as Set<string> | undefined,
  });

  const tousLesBlocs = useMemo(() => {
    const m = new Map<string, Bloc>();
    for (const l of blocsParAffaire.values()) for (const b of l) m.set(b.affectation.id, b);
    return m;
  }, [blocsParAffaire]);

  ref.current = {
    colonnes,
    blocs: tousLesBlocs,
    capacites,
    affairesParId,
    chiffreParAffaire,
    affecteParAffaire,
    chezLeClient,
    limiter,
    joursParAffectation,
    pistes: pistesAffaires,
    estPrestation,
    // jours où la personne est chez un client, sans compter la barre qu'on modifie
    clientHorsAffectation: (id: string, collabId: string) =>
      joursChezLeClient(affectations.filter((x) => x.id !== id), joursRows, estPE).get(collabId),
  };

  const dragRef = useRef<{ id: string; mode: DragEtat["mode"]; x0: number; pxCol: number; delta: number } | null>(null);

  const calculerNouvellesBornes = useCallback(
    (b: Bloc, mode: DragEtat["mode"], delta: number) => bornesGlisse(b, mode, delta, ref.current.colonnes.length),
    []
  );

  const appliquer = useCallback(
    async (id: string, mode: DragEtat["mode"], delta: number) => {
      const r = ref.current;
      const b = r.blocs.get(id);
      if (!b) return;

      const a = b.affectation;
      const affaire = a.affaire_id ? r.affairesParId.get(a.affaire_id) : undefined;
      if (!affaire) return;

      const { i, f } = calculerNouvellesBornes(b, mode, delta);
      const debut = r.colonnes[i];
      let finJour = r.colonnes[f];

      const cap = r.capacites.get(a.collaborateur_id);
      const net = (j: string) => cap?.get(j)?.net ?? 0;
      const ratio = ratioDuBloc(b.jours, net);

      // Me contenir : on arrête le bloc au chiffré
      const chiffre = r.chiffreParAffaire.get(affaire.id) ?? 0;
      const total = r.affecteParAffaire.get(affaire.id)?.heures ?? 0;
      const autres = total - b.heures;

      if (r.limiter && chiffre > 0) {
        finJour = finMaxPourHeures({ debut, fin: finJour, capaciteJour: net, ratio, heuresMax: Math.max(0, chiffre - autres) });
      }

      const resultat = recalculerBloc({ debut, fin: finJour, capaciteJour: net, ratio });

      if (resultat.jours.length === 0) {
        setErreur("Aucun jour disponible à cet endroit (jours fériés, congés).");
        return;
      }

      const client = r.clientHorsAffectation(a.id, a.collaborateur_id);
      if (client && resultat.jours.some((j) => client.has(j.jour))) {
        setErreur("Cette personne est déjà chez un client (prestation externe) à ces dates : elle n’est pas affectable ailleurs.");
        return;
      }

      const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {
        p_id: a.id,
        p_affaire_id: a.affaire_id,
        p_activite_id: a.activite_id,
        p_code: a.code,
        p_libelle: a.libelle,
        p_collaborateur_id: a.collaborateur_id,
        p_date_debut: resultat.jours[0].jour,
        p_date_fin: resultat.jours[resultat.jours.length - 1].jour,
        p_commentaire: a.commentaire,
        p_jours: resultat.jours,
        p_groupe_id: a.groupe_id,
      });

      if (error) {
        setErreur(traduireErreur(error.message));
        return;
      }

      const nouveauTotal = autres + resultat.total;
      setInfo(
        chiffre > 0 && nouveauTotal > chiffre + 0.001
          ? `Bloc modifié. ▲ Au-delà du chiffré : ${formatHeures(nouveauTotal)} affectées pour ${formatHeures(chiffre)}.`
          : "Bloc modifié."
      );
      setRechargement((n) => n + 1);
    },
    [calculerNouvellesBornes]
  );

  function demarrerDrag(e: PointerReact<HTMLElement>, b: Bloc, mode: DragEtat["mode"]) {
    if (!peutAgir) return;
    if ((mode === "move" && (b.coupeGauche || b.coupeDroite)) || (mode === "debut" && b.coupeGauche) || (mode === "fin" && b.coupeDroite)) return;

    const ligne = (e.currentTarget as HTMLElement).closest("[data-ligne]") as HTMLElement | null;
    if (!ligne) return;

    e.preventDefault();
    e.stopPropagation();

    const largeur = ligne.getBoundingClientRect().width - LARGEUR_NOM - LARGEUR_STATUT;
    const etat = { id: b.affectation.id, mode, x0: e.clientX, pxCol: Math.max(4, largeur / ref.current.colonnes.length), delta: 0 };

    dragRef.current = etat;
    setDrag({ id: etat.id, mode, delta: 0 });

    const bouger = (ev: PointerEvent) => {
      const courant = dragRef.current;
      if (!courant) return;
      const delta = Math.round((ev.clientX - courant.x0) / courant.pxCol);

      if (delta !== courant.delta) {
        courant.delta = delta;
        setDrag({ id: courant.id, mode: courant.mode, delta });
      }
    };

    const relacher = () => {
      window.removeEventListener("pointermove", bouger);
      const courant = dragRef.current;
      dragRef.current = null;
      setDrag(null);

      if (!courant) return;

      if (courant.delta === 0) {
        const bloc = ref.current.blocs.get(courant.id);
        const affaire = bloc?.affectation.affaire_id ? ref.current.affairesParId.get(bloc.affectation.affaire_id) : undefined;

        if (bloc && affaire) {
          const edition = { affectation: bloc.affectation, jours: joursRows.filter((j) => j.affectation_id === bloc.affectation.id) };

          if (ref.current.estPrestation(affaire)) setFicheRessource({ affaire, edition });
          else setDialogue({ affaire, edition });
        }
        return;
      }

      void appliquer(courant.id, courant.mode, courant.delta);
    };

    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", relacher, { once: true });
  }

  /* ------------------------------ barre de l'affaire (bornes d'une prestation) ------------------------------ */

  const dragAffaireRef = useRef<{ id: string; mode: DragEtat["mode"]; x0: number; pxCol: number; delta: number } | null>(null);

  const bornesApresGlisse = useCallback(
    (p: PisteAffaire, mode: DragEtat["mode"], delta: number) => bornesGlisse(p, mode, delta, ref.current.colonnes.length),
    []
  );

  async function enregistrerBornes(affaire: Affaire, debutPrestation: string, finPrestation: string) {
    const { error } = await supabase.rpc("pilotage_modifier_prestation", {
      p_affaire_id: affaire.id,
      p_date_debut: debutPrestation,
      p_date_fin: finPrestation,
      p_quantite: affaire.prestation_quantite !== null && affaire.prestation_quantite !== undefined ? num(affaire.prestation_quantite) : null,
      p_unite: affaire.prestation_unite,
      p_comprend_conges: Boolean(affaire.prestation_comprend_conges),
    });

    if (error) throw new Error(traduireErreur(error.message));
  }

  const appliquerAffaire = useCallback(
    async (id: string, mode: DragEtat["mode"], delta: number) => {
      const r = ref.current;
      const piste = r.pistes.get(id);
      const affaire = r.affairesParId.get(id);
      if (!piste || !affaire) return;

      const { i, f } = bornesApresGlisse(piste, mode, delta);
      const debutPrestation = mode === "fin" ? piste.debut : r.colonnes[i];
      const finPrestation = mode === "debut" ? piste.fin : r.colonnes[f];

      try {
        await enregistrerBornes(affaire, debutPrestation, finPrestation);
        setInfo(`Prestation du ${formatDate(debutPrestation)} au ${formatDate(finPrestation)}.`);
        setRechargement((n) => n + 1);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Impossible de modifier la prestation.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bornesApresGlisse]
  );

  function demarrerDragAffaire(e: PointerReact<HTMLElement>, affaire: Affaire, mode: DragEtat["mode"]) {
    if (!peutAgir) return;

    const piste = ref.current.pistes.get(affaire.id);
    if (!piste) return;
    if ((mode === "move" && (piste.coupeGauche || piste.coupeDroite)) || (mode === "debut" && piste.coupeGauche) || (mode === "fin" && piste.coupeDroite)) return;

    const ligne = (e.currentTarget as HTMLElement).closest("[data-ligne]") as HTMLElement | null;
    if (!ligne) return;

    e.preventDefault();
    e.stopPropagation();

    const largeur = ligne.getBoundingClientRect().width - LARGEUR_NOM - LARGEUR_STATUT;
    const etat = { id: affaire.id, mode, x0: e.clientX, pxCol: Math.max(4, largeur / ref.current.colonnes.length), delta: 0 };

    dragAffaireRef.current = etat;
    setDragAffaire({ id: etat.id, mode, delta: 0 });

    const bouger = (ev: PointerEvent) => {
      const courant = dragAffaireRef.current;
      if (!courant) return;
      const delta = Math.round((ev.clientX - courant.x0) / courant.pxCol);

      if (delta !== courant.delta) {
        courant.delta = delta;
        setDragAffaire({ id: courant.id, mode: courant.mode, delta });
      }
    };

    const relacher = () => {
      window.removeEventListener("pointermove", bouger);
      const courant = dragAffaireRef.current;
      dragAffaireRef.current = null;
      setDragAffaire(null);

      if (!courant) return;

      if (courant.delta === 0) {
        setFicheAffaire(affaire);
        return;
      }

      void appliquerAffaire(courant.id, courant.mode, courant.delta);
    };

    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", relacher, { once: true });
  }

  function surDepot(e: DragEvent<HTMLElement>, affaire: Affaire) {
    e.preventDefault();
    if (!peutAgir) return;

    const collaborateurId = e.dataTransfer.getData("text/plain");
    if (!collaborateurId) return;

    const ligne = e.currentTarget as HTMLElement;
    const largeur = ligne.getBoundingClientRect().width - LARGEUR_NOM - LARGEUR_STATUT;
    const x = e.clientX - ligne.getBoundingClientRect().left - LARGEUR_NOM;
    const idx = Math.min(colonnes.length - 1, Math.max(0, Math.floor((x / Math.max(1, largeur)) * colonnes.length)));

    if (estPrestation(affaire)) {
      const b = bornesParAffaire.get(affaire.id);
      setFicheRessource({ affaire, prefill: { collaborateurId, debut: colonnes[idx], fin: b?.fin && b.fin >= colonnes[idx] ? b.fin : undefined } });
      return;
    }

    setDialogue({ affaire, prefill: { collaborateurId, debut: colonnes[idx] } });
  }

  /* ------------------------------ rendu ------------------------------ */

  const gabarit = `${LARGEUR_NOM}px repeat(${colonnes.length}, minmax(0, 1fr)) ${LARGEUR_STATUT}px`;
  const col = (i: number) => i + 2;
  const semaines = Array.from({ length: nbSemaines }, (_, w) => ajouterJours(lundi, w * 7));

  const fonds = (nbLignes = 1) => (
    <>
      <div
        aria-hidden="true"
        style={{
          gridColumn: `2 / ${colonnes.length + 2}`,
          gridRow: `1 / span ${nbLignes}`,
          backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(100% / ${nbSemaines} - 1px), ${C.ligne} calc(100% / ${nbSemaines} - 1px), ${C.ligne} calc(100% / ${nbSemaines}))`,
          pointerEvents: "none",
        }}
      />
      {colonnes.map((j, i) =>
        estFerie(j) ? (
          <div key={`f-${j}`} aria-hidden="true" style={{ gridColumn: col(i), gridRow: `1 / span ${nbLignes}`, background: "#e9ebee", pointerEvents: "none" }} />
        ) : null
      )}
      {colonnes.includes(aujourdhui) && (
        <div aria-hidden="true" style={{ gridColumn: col(colonnes.indexOf(aujourdhui)), gridRow: `1 / span ${nbLignes}`, borderLeft: `2px solid ${C.rouge}`, pointerEvents: "none" }} />
      )}
    </>
  );

  function etatAffaire(affaire: Affaire, chiffre: number, affecte: number, finPrevue: string | null): { genre: Genre; texte: string } {
    if (chiffre > 0 && affecte > chiffre + 0.001) return { genre: "crit", texte: `Au-delà du chiffré (+${formatHeures(affecte - chiffre)})` };
    if (affaire.echeance && finPrevue && finPrevue > affaire.echeance) return { genre: "crit", texte: "Fin après la livraison souhaitée" };
    if (chiffre > 0 && chiffre - affecte > 0.5) return { genre: "warn", texte: `Reste ${formatHeures(chiffre - affecte)} à affecter` };
    if (chiffre > 0) return { genre: "ok", texte: "Chiffré couvert" };
    if (affecte > 0) return { genre: "info", texte: finPrevue ? `Fin le ${formatDate(finPrevue)}` : "Affectée" };
    return { genre: "info", texte: affaire.type === "DBE" ? "Jalon de remise" : "Non affectée" };
  }

  function rendreBloc(b: Bloc, affaire: Affaire) {
    const enDrag = drag && drag.id === b.affectation.id ? drag : null;
    const bornes = enDrag ? calculerNouvellesBornes(b, enDrag.mode, enDrag.delta) : { i: b.debutIdx, f: b.finIdx };
    const c = annuaire.find((x) => x.id === b.affectation.collaborateur_id);
    const pe = estPE(affaire.id);
    const pi = affaire.imputation === "PI";
    const prestation = estPrestation(affaire);
    const verrouille = !peutAgir;
    const cap = capacites.get(b.affectation.collaborateur_id);
    const manquants = joursSansCapacite(colonnes[bornes.i], colonnes[bornes.f], cap);
    const nb = bornes.f - bornes.i + 1;
    const fond = pe ? "#6f8fb3" : pi ? "#6b58a8" : affaire.type === "DBE" ? "#f2bfd0" : C.rouge;
    const encre = affaire.type === "DBE" && !pe && !pi ? "#4a0f28" : "#ffffff";
    const net = (j: string) => cap?.get(j)?.net ?? 0;
    const part = Math.round(ratioDuBloc(b.jours, net) * 100);

    // la ressource dépasse les bornes de la prestation : jours concernés
    const borneAffaire = prestation ? bornesParAffaire.get(affaire.id) : undefined;
    const horsBornes: number[] = [];

    if (borneAffaire) {
      for (let k = bornes.i; k <= bornes.f; k++) {
        const j = colonnes[k];
        if ((borneAffaire.debut && j < borneAffaire.debut) || (borneAffaire.fin && j > borneAffaire.fin)) horsBornes.push(k);
      }
    }

    const poignee = (cote: "debut" | "fin", coupe: boolean): CSSProperties => ({
      position: "absolute",
      top: 0,
      bottom: 0,
      [cote === "debut" ? "left" : "right"]: 0,
      width: 9,
      background: coupe || verrouille ? "transparent" : "rgba(0,0,0,.28)",
      cursor: coupe || verrouille ? "default" : "ew-resize",
      borderRadius: cote === "debut" ? "5px 0 0 5px" : "0 5px 5px 0",
      touchAction: "none",
    });

    return (
      <div key={b.affectation.id} style={{ display: "contents" }}>
        <div
          title={`${nomCollab(c)} — ${formatHeures(b.heures)} — du ${formatDate(b.jours[0].jour)} au ${formatDate(b.jours[b.jours.length - 1].jour)}${pe ? " — chez le client" : ""}`}
          onPointerDown={(e) => demarrerDrag(e, b, "move")}
          style={{
            gridColumn: `${col(bornes.i)} / ${col(bornes.f) + 1}`,
            gridRow: 1,
            alignSelf: "center",
            position: "relative",
            height: 28,
            margin: "0 1px",
            borderRadius: 5,
            background: fond,
            color: encre,
            border: enDrag ? "2px dashed #1f2328" : `1.5px solid ${pe ? "#34506b" : pi ? "#4a3a85" : affaire.type === "DBE" ? "#d98aa6" : C.rouge}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            padding: "0 11px",
            fontWeight: 800,
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            cursor: verrouille ? "default" : enDrag?.mode === "move" ? "grabbing" : "grab",
            touchAction: "none",
            zIndex: enDrag ? 3 : 1,
          }}
        >
          <span aria-hidden="true" style={poignee("debut", b.coupeGauche)} onPointerDown={(e) => demarrerDrag(e, b, "debut")} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {prestation
              ? nb >= 3 && part < 100
                ? `${nomCollab(c)} · ${part} %`
                : nomCollab(c)
              : nb >= 3
                ? `${nomCollab(c)} · ${formatHeures(b.heures)}`
                : nomCollab(c)}
          </span>
          <span aria-hidden="true" style={poignee("fin", b.coupeDroite)} onPointerDown={(e) => demarrerDrag(e, b, "fin")} />
        </div>
        {manquants.map((m) => {
          const k = colonnes.indexOf(m.jour);
          return k < 0 ? null : (
            <div
              key={`m-${b.affectation.id}-${m.jour}`}
              title={m.motif === "ferie" ? `Jour férié le ${formatDate(m.jour)}` : `Congé validé le ${formatDate(m.jour)}`}
              style={{ gridColumn: col(k), gridRow: 1, alignSelf: "center", height: 28, margin: "0 1px", borderRadius: 4, background: "repeating-linear-gradient(45deg,#cfd4da,#cfd4da 4px,#eceef1 4px,#eceef1 8px)", border: "1px solid #6b6f75", boxSizing: "border-box", zIndex: 2, pointerEvents: "none" }}
            />
          );
        })}
        {horsBornes.map((k) => (
          <div
            key={`h-${b.affectation.id}-${k}`}
            title="Dépasse les bornes de la prestation"
            style={{ gridColumn: col(k), gridRow: 1, alignSelf: "center", height: 28, margin: "0 1px", borderRadius: 4, background: ROUGE_HACHURE, border: "1.5px solid #b3261e", boxSizing: "border-box", zIndex: 4, pointerEvents: "none" }}
          />
        ))}
      </div>
    );
  }

  /* Barre pointillée de l'affaire : début et fin théoriques de la prestation (PE, PI).
     Indépendante des barres de ses ressources. */
  function rendrePisteAffaire(affaire: Affaire) {
    const piste = pistesAffaires.get(affaire.id);
    const borne = bornesParAffaire.get(affaire.id);

    if (!piste) {
      // pas de bornes, ou bornes hors de la période affichée
      if (borne?.debut && borne.fin) return null;

      return peutAgir ? (
        <button
          type="button"
          onClick={() => setFicheAffaire(affaire)}
          style={{ gridColumn: `2 / ${colonnes.length + 2}`, gridRow: 1, alignSelf: "center", justifySelf: "start", margin: "0 8px", minHeight: 34, padding: "0 14px", border: "1.5px dashed #6f8fb3", background: "#ffffff", borderRadius: 8, fontWeight: 700, fontSize: 13, color: "#34506b", cursor: "pointer", fontFamily: "inherit" }}
        >
          Définir le début et la fin de la prestation
        </button>
      ) : null;
    }

    const enDrag = dragAffaire && dragAffaire.id === affaire.id ? dragAffaire : null;
    const bornes = enDrag ? bornesApresGlisse(piste, enDrag.mode, enDrag.delta) : { i: piste.debutIdx, f: piste.finIdx };
    const pi = affaire.imputation === "PI";
    const verrouille = !peutAgir;
    const nouveauDebut = enDrag ? (enDrag.mode === "fin" ? piste.debut : colonnes[bornes.i]) : piste.debut;
    const nouvelleFin = enDrag ? (enDrag.mode === "debut" ? piste.fin : colonnes[bornes.f]) : piste.fin;

    const poignee = (cote: "debut" | "fin", coupe: boolean): CSSProperties => ({
      position: "absolute",
      top: 0,
      bottom: 0,
      [cote === "debut" ? "left" : "right"]: 0,
      width: 9,
      background: coupe || verrouille ? "transparent" : "rgba(0,0,0,.28)",
      cursor: coupe || verrouille ? "default" : "ew-resize",
      borderRadius: cote === "debut" ? "4px 0 0 4px" : "0 4px 4px 0",
      touchAction: "none",
    });

    return (
      <div style={{ display: "contents" }}>
        <div
          title={`Prestation du ${formatDate(piste.debut)} au ${formatDate(piste.fin)} — glisser pour décaler, étirer un bord pour changer le début ou la fin, cliquer pour modifier`}
          onPointerDown={(e) => demarrerDragAffaire(e, affaire, "move")}
          style={{
            gridColumn: `${col(bornes.i)} / ${col(bornes.f) + 1}`,
            gridRow: 1,
            alignSelf: "center",
            position: "relative",
            height: 28,
            margin: "0 1px",
            borderRadius: 5,
            background: pi ? "#e8e3f5" : "#dbe7f7",
            color: "#1f2328",
            border: `2px ${enDrag ? "solid" : "dashed"} ${enDrag ? C.rouge : pi ? "#6b58a8" : "#34506b"}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            padding: "0 11px",
            fontWeight: 800,
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            cursor: verrouille ? "default" : enDrag?.mode === "move" ? "grabbing" : "grab",
            touchAction: "none",
            zIndex: enDrag ? 3 : 1,
          }}
        >
          <span aria-hidden="true" style={poignee("debut", piste.coupeGauche)} onPointerDown={(e) => demarrerDragAffaire(e, affaire, "debut")} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Prestation · {formatDate(nouveauDebut)} → {formatDate(nouvelleFin)}</span>
          <span aria-hidden="true" style={poignee("fin", piste.coupeDroite)} onPointerDown={(e) => demarrerDragAffaire(e, affaire, "fin")} />
        </div>
        {enDrag && (
          <div
            role="status"
            style={{ gridColumn: `${col(bornes.i)} / ${Math.min(col(bornes.i) + 6, colonnes.length + 2)}`, gridRow: 1, alignSelf: "start", marginTop: -22, zIndex: 6, background: "#ffffff", border: `2px solid ${C.rouge}`, borderRadius: 8, padding: "3px 10px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", justifySelf: "start", pointerEvents: "none" }}
          >
            {formatDate(nouveauDebut)} → {formatDate(nouvelleFin)} · {joursOuvres(nouveauDebut, nouvelleFin).length} jours ouvrés
          </div>
        )}
      </div>
    );
  }

  const bouton = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#b9bec5"}`,
    minHeight: 44,
    padding: "0 14px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const fleche: CSSProperties = { minHeight: 44, minWidth: 44, border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, color: C.rougeFonce, fontSize: 18, fontWeight: 800, cursor: "pointer" };

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="affaires" />

      <div style={{ ...page.contenu, maxWidth: 1500 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 style={page.titre}>Planning des affaires</h1>
          <p style={page.sousTitre}>
            On pilote les affaires : on y glisse des personnes depuis le panneau de droite, puis on étire ou on déplace leur bloc.
            Une prestation (PE, PI) montre sa barre pointillée (début et fin théoriques) et une barre par ressource, indépendantes.
            Les heures se calculent et sont comparées au chiffré. La charge des ressources en découle.
          </p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" aria-label="Période précédente" style={fleche} onClick={() => setLundi(ajouterJours(lundi, -7 * Math.max(1, Math.floor(nbSemaines / 3))))}>◀</button>
            <div style={{ fontWeight: 800, fontSize: 18, minWidth: 220, textAlign: "center" }}>
              {formatDate(lundi)} → {formatDate(colonnes[colonnes.length - 1])}
              <div style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>S{numeroSemaine(lundi)} à S{numeroSemaine(colonnes[colonnes.length - 1] ?? lundi)}</div>
            </div>
            <button type="button" aria-label="Période suivante" style={fleche} onClick={() => setLundi(ajouterJours(lundi, 7 * Math.max(1, Math.floor(nbSemaines / 3))))}>▶</button>
            <button type="button" style={{ ...page.btnSecondaire, border: "none", textDecoration: "underline" }} onClick={() => setLundi(lundiDe(aujourdhui))}>Aujourd’hui</button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {(["TOUS", "CBE", "DBE", "PE", "PI"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={filtreType === t} style={bouton(filtreType === t)} onClick={() => setFiltreType(t)}>
                {t === "TOUS" ? "Tout" : t}
              </button>
            ))}
            <span style={{ width: 8 }} />
            {[2, 4, 8, 12, 26].map((n) => (
              <button key={n} type="button" aria-pressed={nbSemaines === n} style={bouton(nbSemaines === n)} onClick={() => setNbSemaines(n)}>
                {n} sem.
              </button>
            ))}
            <button type="button" style={bouton(false)} onClick={() => setOuvertes(ouvertes.size > 0 ? new Set() : new Set(lignes.map((a) => a.id)))}>
              {ouvertes.size > 0 ? "Tout replier" : "Tout déplier"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginBottom: 14, padding: "10px 16px", background: "#ffffff", border: `1px solid ${C.ligne}`, borderRadius: 12 }}>
          <strong>Quand je dépasse le chiffré :</strong>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
            <input type="radio" name="depasse" checked={!limiter} onChange={() => changerLimiter(false)} style={{ width: 20, height: 20, margin: 0 }} />
            m’alerter et me laisser décider
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
            <input type="radio" name="depasse" checked={limiter} onChange={() => changerLimiter(true)} style={{ width: 20, height: 20, margin: 0 }} />
            me contenir : le bloc s’arrête au chiffré
          </label>
        </div>

        {chargement && <Message genre="info">Chargement du planning…</Message>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          <section style={{ ...page.carte, padding: 12, flex: "999 1 760px", minWidth: 0, overflowX: "auto" }}>
            <div style={{ minWidth: 1050 }}>
              {/* en-têtes */}
              <div style={{ display: "grid", gridTemplateColumns: gabarit }}>
                <div style={{ gridColumn: 1, gridRow: "1 / span 2", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>
                  Affaire · ressource
                </div>
                {semaines.map((l, w) => (
                  <div key={l} style={{ gridColumn: `${col(5 * w)} / span 5`, gridRow: 1, textAlign: "center", fontWeight: 800, padding: "6px 0", background: "#f1f2f4", borderLeft: `1px solid ${C.ligne}`, fontSize: 13 }}>
                    S{numeroSemaine(l)} <span style={{ fontWeight: 600, color: C.gris }}>· {formatDate(l).slice(0, 5)}</span>
                  </div>
                ))}
                {colonnes.map((j, i) => (
                  <div key={j} style={{ gridColumn: col(i), gridRow: 2, textAlign: "center", padding: "3px 0", background: estFerie(j) ? "#e3e6ea" : j === aujourdhui ? "#fff4f4" : "#ffffff", borderBottom: `1px solid ${C.ligne}`, fontSize: nbSemaines > 12 ? 9 : 11, lineHeight: 1.1, color: C.gris, fontWeight: 700 }}>
                    {nbSemaines > 12 ? "" : JOURS_COURTS[jourSemaine(j) - 1]}
                    <div style={{ color: j === aujourdhui ? C.rougeFonce : C.encre }}>{nbSemaines > 12 ? "" : Number(j.slice(8))}</div>
                  </div>
                ))}
                <div style={{ gridColumn: colonnes.length + 2, gridRow: "1 / span 2", display: "flex", alignItems: "flex-end", padding: "0 8px 6px", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>
                  Affecté / chiffré
                </div>
              </div>

              {lignes.length === 0 && !chargement && <p style={{ color: C.gris, padding: "16px 4px" }}>Aucune affaire en cours ou en attente.</p>}

              {lignes.map((affaire, indexLigne) => {
                const groupeCourant = rangGroupe(affaire);
                const premierDuGroupe = indexLigne === 0 || rangGroupe(lignes[indexLigne - 1]) !== groupeCourant;
                const ouverte = ouvertes.has(affaire.id);
                const blocs = blocsParAffaire.get(affaire.id) ?? [];
                const chiffre = chiffreParAffaire.get(affaire.id) ?? 0;
                const total = affecteParAffaire.get(affaire.id);
                const affecteReel = total?.heures ?? 0;

                // aperçu des heures pendant un glisser
                let affecteAffiche = affecteReel;
                if (drag) {
                  const b = tousLesBlocs.get(drag.id);
                  if (b && b.affectation.affaire_id === affaire.id) {
                    const { i, f } = calculerNouvellesBornes(b, drag.mode, drag.delta);
                    const cap = capacites.get(b.affectation.collaborateur_id);
                    const net = (j: string) => cap?.get(j)?.net ?? 0;
                    const r = recalculerBloc({ debut: colonnes[i], fin: colonnes[f], capaciteJour: net, ratio: ratioDuBloc(b.jours, net) });
                    affecteAffiche = affecteReel - b.heures + r.total;
                  }
                }

                const etat = etatAffaire(affaire, chiffre, affecteAffiche, total?.fin ?? null);
                const idxLivraison = (() => {
                  if (!affaire.echeance) return -1;
                  const j = estWeekend(affaire.echeance) ? lundiDe(ajouterJours(affaire.echeance, 7)) : affaire.echeance;
                  return colonnes.indexOf(j);
                })();
                const pe = affaire.imputation === "PE";
                const prestation = estPrestation(affaire);
                const borne = bornesParAffaire.get(affaire.id);
                const afficherLignes = ouverte || prestation;
                const depasse = (b: Bloc) => {
                  if (!borne) return false;
                  const d = depasseBornes(b.jours[0].jour, b.jours[b.jours.length - 1].jour, borne);
                  return d.avant || d.apres;
                };
                const nbDepassent = prestation ? blocs.filter(depasse).length : 0;

                const besoins = [...(besoinsParAffaire.get(affaire.id)?.entries() ?? [])];
                const sansActivite = Math.max(0, affecteReel - besoins.reduce((t, [, e]) => t + e.affecte, 0));

                return (
                  <div key={affaire.id}>
                    {premierDuGroupe && (
                      <div style={{ marginTop: indexLigne === 0 ? 8 : 14, padding: "6px 8px", background: "#eef0f3", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: "#3b4046", borderRadius: 4 }}>
                        {TITRES_GROUPES[groupeCourant]}
                      </div>
                    )}
                    <div style={{ borderTop: `2px solid ${C.ligne}` }} />
                    <div data-ligne style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "46px", background: "#f8f9fa", position: "relative" }}>
                      <div style={{ gridColumn: 1, display: "flex", alignItems: "center", gap: 6, padding: "0 4px", minWidth: 0 }}>
                        {prestation ? (
                          <span aria-hidden="true" style={{ minWidth: 34 }} />
                        ) : (
                        <button
                          type="button"
                          aria-expanded={ouverte}
                          aria-label={`${ouverte ? "Replier" : "Déplier"} ${affaire.type} ${affaire.numero}`}
                          onClick={() => setOuvertes((s) => { const n = new Set(s); if (n.has(affaire.id)) n.delete(affaire.id); else n.add(affaire.id); return n; })}
                          style={{ minWidth: 34, minHeight: 34, border: "none", background: "transparent", fontSize: 14, cursor: "pointer", color: C.gris }}
                        >
                          {ouverte ? "▾" : "▸"}
                        </button>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <BadgeType type={affaire.type} />
                            <Link href={`/pilotage/affaire/${affaire.id}`} style={{ fontWeight: 800, fontSize: 15, color: C.rougeFonce }}>{affaire.numero}</Link>
                            {affaire.imputation && <span style={{ fontSize: 11, fontWeight: 800, color: C.gris }}>{affaire.imputation}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{affaire.designation}</div>
                        </div>
                      </div>

                      {fonds()}

                      {/* prestation : barre pointillée = bornes de l'affaire */}
                      {prestation && rendrePisteAffaire(affaire)}

                      {/* aperçu replié : étendue des affectations */}
                      {!ouverte && !prestation && blocs.length > 0 && (
                        <div
                          style={{
                            gridColumn: `${col(Math.min(...blocs.map((b) => b.debutIdx)))} / ${col(Math.max(...blocs.map((b) => b.finIdx))) + 1}`,
                            gridRow: 1,
                            alignSelf: "center",
                            height: 12,
                            margin: "0 1px",
                            borderRadius: 6,
                            background: pe ? "#9fb4cb" : affaire.type === "DBE" ? "#f2bfd0" : "#f3c9c9",
                            border: `1px solid ${pe ? "#34506b" : C.rouge}`,
                            boxSizing: "border-box",
                          }}
                        />
                      )}

                      {/* jalon : livraison souhaitée / remise */}
                      {!prestation && idxLivraison >= 0 && (
                        <div
                          title={`${affaire.type === "DBE" ? "Remise de l’offre" : "Livraison souhaitée"} : ${formatDate(affaire.echeance)}`}
                          style={{ gridColumn: col(idxLivraison), gridRow: 1, alignSelf: "center", justifySelf: "end", fontSize: 16, fontWeight: 800, color: affaire.type === "DBE" ? "#8a3a5d" : C.rougeFonce, zIndex: 2 }}
                        >
                          {affaire.type === "DBE" ? "◆" : "⚑"}
                        </div>
                      )}

                      <div style={{ gridColumn: colonnes.length + 2, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, padding: "0 8px" }}>
                        {prestation ? (
                          <>
                            <div style={{ fontSize: 12, fontWeight: 800 }}>
                              {borne?.debut && borne.fin ? `${formatDate(borne.debut)} → ${formatDate(borne.fin)}` : "Dates à définir"}
                            </div>
                            <Pastille genre={nbDepassent > 0 ? "warn" : blocs.length === 0 ? "info" : "ok"}>
                              {nbDepassent > 0
                                ? `▲ ${nbDepassent} dépasse${nbDepassent > 1 ? "nt" : ""} la prestation`
                                : blocs.length === 0
                                  ? "Sans ressource"
                                  : `${blocs.length} ressource${blocs.length > 1 ? "s" : ""}`}
                            </Pastille>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 12, fontWeight: 800 }}>
                              {chiffre > 0 ? `${formatHeures(affecteAffiche)} / ${formatHeures(chiffre)}` : affecteAffiche > 0 ? formatHeures(affecteAffiche) : "—"}
                            </div>
                            <Pastille genre={etat.genre}>{etat.texte}</Pastille>
                          </>
                        )}
                      </div>
                    </div>

                    {afficherLignes && (
                      <>
                        {!prestation && besoins.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 10px 6px 42px", background: "#fcfcfd", borderTop: `1px dashed ${C.ligne}` }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: C.gris, alignSelf: "center" }}>Besoins :</span>
                            {besoins.map(([id, e]) => {
                              const reste = e.chiffre - e.affecte;
                              const genre: Genre = reste < -0.5 ? "crit" : reste > 0.5 ? "warn" : "ok";

                              return (
                                <Pastille key={id} genre={genre}>
                                  {e.nom} {formatHeures(e.affecte)} / {formatHeures(e.chiffre)}
                                </Pastille>
                              );
                            })}
                            {sansActivite > 0.5 && <Pastille genre="info">Sans activité précise {formatHeures(sansActivite)}</Pastille>}
                          </div>
                        )}
                        {blocs.map((b) => (
                          <div key={b.affectation.id} data-ligne style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "38px", borderTop: `1px dashed ${C.ligne}`, position: "relative" }}>
                            <div style={{ gridColumn: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 6px 0 38px", lineHeight: 1.2 }}>
                              <strong style={{ fontSize: 14 }}>{nomCollab(annuaire.find((c) => c.id === b.affectation.collaborateur_id))}</strong>
                              <span style={{ fontSize: 12, color: C.gris }}>
                                {pe ? `${formatHeures(b.heures)} · chez le client` : formatHeures(b.heures)}
                                {b.affectation.activite_id ? ` · ${referentiel?.activites.find((x) => x.id === b.affectation.activite_id)?.nom ?? ""}` : ""}
                              </span>
                            </div>
                            {fonds()}
                            {rendreBloc(b, affaire)}
                            <div style={{ gridColumn: colonnes.length + 2, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 8px", fontSize: 12, lineHeight: 1.3 }}>
                              {prestation && (
                                <>
                                  <span style={{ fontWeight: 700 }}>{formatDate(b.jours[0].jour)} → {formatDate(b.jours[b.jours.length - 1].jour)}</span>
                                  {depasse(b) && <span style={{ color: "#8f1010", fontWeight: 800 }}>▲ dépasse la prestation</span>}
                                </>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* zone de dépôt */}
                        <div
                          data-ligne
                          onDragOver={(e) => peutAgir && e.preventDefault()}
                          onDrop={(e) => surDepot(e, affaire)}
                          style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "42px", borderTop: `1px dashed ${C.ligne}`, position: "relative" }}
                        >
                          <div style={{ gridColumn: 1, display: "flex", alignItems: "center", padding: "0 6px 0 38px" }}>
                            {peutAgir && (
                              <button type="button" style={{ minHeight: 34, padding: "0 12px", border: "1.5px dashed #b9bec5", background: "#ffffff", borderRadius: 8, fontWeight: 700, fontSize: 13, color: C.rougeFonce, cursor: "pointer", fontFamily: "inherit" }} onClick={() => (prestation ? setFicheRessource({ affaire, prefill: { debut: borne?.debut ?? undefined, fin: borne?.fin ?? undefined } }) : setDialogue({ affaire }))}>
                                + Affecter
                              </button>
                            )}
                          </div>
                          {fonds()}
                          <div style={{ gridColumn: `2 / ${colonnes.length + 2}`, gridRow: 1, alignSelf: "center", textAlign: "center", fontSize: 12, color: C.gris, pointerEvents: "none" }}>
                            {prestation ? "ou glissez une personne du panneau de droite sur cette ligne : une barre par ressource" : "ou glissez une personne du panneau de droite sur cette ligne, à la date de début voulue"}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: 12, color: "#3b4046", marginTop: 12 }}>
              <span><strong>Glisser</strong> un bloc pour le déplacer · <strong>étirer</strong> ses bords pour le raccourcir ou l’allonger · un simple clic le modifie (dates, personne, % de temps)</span>
              <span>▸ replié · ⚑ livraison souhaitée · ◆ remise d’un DBE</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "repeating-linear-gradient(45deg,#cfd4da,#cfd4da 4px,#eceef1 4px,#eceef1 8px)", border: "1px solid #6b6f75" }} />congé ou jour férié dans un bloc</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "#6f8fb3", border: "1px solid #34506b" }} />PE : chez le client</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "#6b58a8", border: "1px solid #4a3a85" }} />PI</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "#dbe7f7", border: "2px dashed #34506b", boxSizing: "border-box" }} />bornes d’une prestation (indépendantes de ses ressources)</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: ROUGE_HACHURE, border: "1px solid #b3261e" }} />la ressource dépasse la prestation</span>
            </div>
          </section>

          {/* panneau des ressources */}
          <aside style={{ ...page.carte, flex: "1 1 300px", maxWidth: 360, minWidth: 280 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Ressources</h2>
            <p style={{ margin: "0 0 10px", color: C.gris, fontSize: 13 }}>
              Les plus libres d’abord ({Math.min(8, nbSemaines)} prochaines semaines : plus la case est claire, plus la personne est libre). Glissez une personne sur une affaire dépliée.
            </p>

            {ressources.map(({ collab, libre, chezLeClientJusquau }) => {
              const verrou = Boolean(chezLeClientJusquau);

              return (
                <div
                  key={collab.id}
                  draggable={peutAgir && !verrou}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", collab.id)}
                  title={verrou ? `En prestation externe chez le client jusqu’au ${formatDate(chezLeClientJusquau)} : non affectable` : "Glisser sur une affaire"}
                  style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 4px", borderTop: `1px solid ${C.ligne}`, opacity: verrou ? 0.55 : 1, cursor: verrou ? "not-allowed" : peutAgir ? "grab" : "default" }}
                >
                  <strong style={{ fontSize: 18, minWidth: 46 }}>{nomCollab(collab)}</strong>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#3b4046" }}>{`${collab.prenom ?? ""} ${collab.nom ?? ""}`.trim()}</div>
                    <div style={{ display: "flex", gap: 2, margin: "4px 0" }}>
                      {libre.map((v, i) => (
                        <span key={i} title={`S${numeroSemaine(ajouterJours(lundi, i * 7))} : ${v} % de libre`} style={{ display: "inline-block", width: 22, height: 14, boxSizing: "border-box", border: "1px solid #c9cdd2", background: v >= 80 ? "#ffffff" : v >= 40 ? "#dce6f1" : v > 0 ? "#9fb4cb" : "#34506b" }} />
                      ))}
                    </div>
                    {verrou && <div style={{ fontSize: 12, color: C.gris }}>Chez le client jusqu’au {formatDate(chezLeClientJusquau)}</div>}
                  </div>
                </div>
              );
            })}

            <p style={{ margin: "10px 0 0", fontSize: 12, color: C.gris }}>
              L’encadrement n’apparaît pas ici. Pour voir la charge de chacun semaine par semaine :{" "}
              <Link href="/pilotage/ressources" style={{ fontWeight: 700, color: C.rougeFonce }}>Charge par ressource</Link>.
            </p>
          </aside>
        </div>
      </div>

      {ficheRessource && (
        <FicheRessourceDialog
          onClose={() => setFicheRessource(null)}
          onSaved={(message) => {
            setFicheRessource(null);
            setInfo(message);
            setRechargement((n) => n + 1);
          }}
          affaire={ficheRessource.affaire}
          annuaire={annuaire}
          affectations={affectations}
          joursRows={joursRows}
          estPE={estPE}
          bornes={bornesParAffaire.get(ficheRessource.affaire.id) ?? { debut: null, fin: null }}
          edition={ficheRessource.edition}
          prefill={ficheRessource.prefill}
          onEtirerAffaire={async (debutPrestation, finPrestation) => {
            await enregistrerBornes(ficheRessource.affaire, debutPrestation, finPrestation);
            setRechargement((n) => n + 1);
          }}
        />
      )}

      {ficheAffaire && (
        <FicheAffaireDialog
          onClose={() => setFicheAffaire(null)}
          onSaved={(message) => {
            setFicheAffaire(null);
            setInfo(message);
            setRechargement((n) => n + 1);
          }}
          affaire={ficheAffaire}
          bornes={bornesParAffaire.get(ficheAffaire.id) ?? { debut: null, fin: null }}
        />
      )}

      {dialogue && (
        <AffecterDialog
          onClose={() => setDialogue(null)}
          onSaved={(message) => {
            setDialogue(null);
            setInfo(message);
            setRechargement((n) => n + 1);
          }}
          affaire={dialogue.affaire}
          annuaire={annuaire}
          chiffre={chiffreParAffaire.get(dialogue.affaire.id) ?? 0}
          affectations={affectations}
          joursRows={joursRows}
          chezLeClient={chezLeClient}
          activites={[...(besoinsParAffaire.get(dialogue.affaire.id)?.entries() ?? [])].map(([id, e]) => ({ id, nom: e.nom, chiffre: e.chiffre, affecte: e.affecte }))}
          limiter={limiter}
          prefill={dialogue.prefill}
          edition={dialogue.edition}
        />
      )}
    </main>
  );
}

export default function PlanningAffairesPage() {
  return (
    <GardeAcces droit="piloterBE">
      <PlanningAffairesContenu />
    </GardeAcces>
  );
}
