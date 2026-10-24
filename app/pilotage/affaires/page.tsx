"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as MouseReact, type PointerEvent as PointerReact, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import AffecterDialog from "@/components/pilotage/AffecterDialog";
import AffectationDialog from "@/components/pilotage/AffectationDialog";
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
  chargerCodesDivers,
  chargerImputations,
  chargerPlanifie,
  chargerRealise,
  chargerTout,
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

   Chaque affaire mise au planning montre deux niveaux :
   - la barre de l'affaire (de son début à son échéance), qui se remplit
     à mesure que les heures chiffrées sont affectées ;
   - dessous (en dépliant ▸), une barre par ressource affectée.

   Affecter : glisser une personne du panneau de droite, « + Affecter »,
   ou double-cliquer sur une ligne vide de l'affaire à la date voulue.
   Une barre de ressource : un clic la sélectionne (Suppr la supprime),
   un double-clic la modifie, on la glisse ou on étire ses bords.
   « ✓ Livrée » range l'affaire, avec ses barres, dans « Affaires livrées »
   en bas du planning (la charge passée reste visible sur l'année). Ce bouton
   n'existe que pour les affaires déclarées à la main : une affaire venue
   d'Excel (repère « XLS ») suit le statut du classeur.

   Toute commande en cours ou en intention apparaît d'office, PE / PI
   comprises (pour une PE / PI : ses avenants R1, R2… s'il y en a, sinon la
   commande de base). Plus de choix
   « au planning » à faire dans le portefeuille). Les mois sont au-dessus des semaines, et le
   planning, qui prend toute la largeur.

   Une ligne par COMMANDE : commande de base (CBE1604) et chaque avenant
   (CBE1604R1, R2…) à part, avec ses heures et son délai ; une commande
   livrée dans Excel quitte le planning, les autres restent.

   PE / PI : le relevé « Prestations PE / PI » FAIT FOI. Les barres des
   ressources d'une PE / PI en viennent : elles ne se glissent pas ici, un
   double-clic (ou « + Affecter ») ouvre le relevé du mois.

   PE / PI (prestations au temps passé) : la barre montre l'ENVELOPPE
   d'heures (commande + avenants) : consommé (feuilles d'heures), puis
   planifié à venir, puis reste. Alerte « nouvelle commande à demander »
   quand il reste moins de 20 % de l'enveloppe ou que son épuisement est
   prévu dans moins de 2 semaines. Une PI épuisée passe d'elle-même
   « en attente de commande » (fonction SQL pilotage_enveloppes_epuisees).

   « Hors affaire » (en haut) : salons, formations, absences connues à
   l'avance… Un intitulé, un code d'imputation, une ou plusieurs personnes.
   Ces événements comptent dans la charge des personnes.

   Les personnes en PE sont chez le client : elles ne sont pas
   affectables ailleurs.
================================================================ */

/* PE en haut, PI ensuite, le reste dessous */
// de haut en bas : hors affaire (zone du haut), le reste, puis les PI, puis les PE
const rangGroupe = (a: { imputation: string | null }) => (a.imputation === "PE" ? 2 : a.imputation === "PI" ? 1 : 0);
const TITRES_GROUPES = ["Affaires", "Prestations internes (PI)", "Prestations externes (PE) — chez le client"];

const LARGEUR_NOM = 250;
const LARGEUR_STATUT = 280;
const JOURS_COURTS = ["L", "M", "M", "J", "V"];
const DELAI_DOUBLE_CLIC = 450;

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

/* Barre de l'affaire : de son début à son échéance */
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
  // le planning s'ouvre une semaine avant la semaine en cours
  const [lundi, setLundi] = useState(() => ajouterJours(lundiDe(aISO(new Date())), -7));
  const [nbSemaines, setNbSemaines] = useState(4);

  const [affaires, setAffaires] = useState<Affaire[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [peutAgir, setPeutAgir] = useState(false);
  const [estAdmin, setEstAdmin] = useState(false);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [joursRows, setJoursRows] = useState<JourRow[]>([]);
  const [caps, setCaps] = useState<Awaited<ReturnType<typeof chargerCapacitesAbsences>>>({ caps: [], absences: [] });

  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rechargement, setRechargement] = useState(0);
  const [gensReplies, setGensReplies] = useState(false);
  // Qui d'autre a le planning ouvert (temps réel), et modification faite par quelqu'un d'autre
  const [moiId, setMoiId] = useState<string | null>(null);
  const [autres, setAutres] = useState<{ id: string; nom: string; modifie: boolean }[]>([]);
  const [modifAilleurs, setModifAilleurs] = useState(false);
  const derniereEcriture = useRef(0);

  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [filtreType, setFiltreType] = useState<"TOUS" | "CBE" | "DBE" | "PE" | "PI">("TOUS");
  // On a toujours le droit de dépasser le chiffré : les barres ne s'arrêtent jamais au chiffré
  const limiter = false;
  const [drag, setDrag] = useState<DragEtat | null>(null);
  const [dragAffaire, setDragAffaire] = useState<DragEtat | null>(null);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  // FOCUS_PERSONNE : toutes les affectations d'une personne en surbrillance, sa charge jour par jour sous les dates
  const [focus, setFocus] = useState<string | null>(null);
  const [livreesOuvertes, setLivreesOuvertes] = useState(false);
  const [livraisonEnCours, setLivraisonEnCours] = useState("");
  const [codesDivers, setCodesDivers] = useState<{ code: string; libelle: string }[]>([]);
  const [realiseParAffaire, setRealiseParAffaire] = useState<Map<string, number>>(new Map());
  // toutes les commandes (livrées comprises) : pour répartir le pointé d'une famille base + avenants
  const [toutesAffaires, setToutesAffaires] = useState<Affaire[]>([]);
  // client (nom abrégé du Suivi d'affaire) par commande de base : « CBE|1750 »
  const [clientsParBase, setClientsParBase] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let actif = true;
    Promise.all([
      chargerTout<{ base_affaire: string | null; base_devis: string | null; genre: string; client_id: string | null }>((a, b) =>
        supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id").not("client_id", "is", null).order("cle").range(a, b)
      ),
      chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
    ])
      .then(([sl, sc]) => {
        if (!actif) return;
        const noms = new Map(sc.map((c) => [c.id, c.nom_abrege]));
        const m = new Map<string, string>();
        for (const l of sl) {
          const nom = l.client_id ? noms.get(l.client_id) : undefined;
          if (!nom) continue;
          if (l.base_affaire) {
            const k = `CBE|${l.base_affaire.replace(/^0+/, "")}`;
            if (l.genre === "BASE" || !m.has(k)) m.set(k, nom);
          }
          if (l.base_devis) {
            const k = `DBE|${l.base_devis.replace(/^0+/, "")}`;
            if (!m.has(k)) m.set(k, nom);
          }
        }
        setClientsParBase(m);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, []);
  // heures facturées (relevé des prestations) jusqu'à hier, par affaire
  const [factureParAffaire, setFactureParAffaire] = useState<Map<string, number>>(new Map());
  const [horsAffaireOuvert, setHorsAffaireOuvert] = useState(true);
  const [evenement, setEvenement] = useState<null | {
    prefill?: { collaborateurId?: string; debut?: string };
    edition?: { affectation: Affectation; jours: JourRow[] };
  }>(null);
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
  // Dernier clic sur une barre de ressource (pour reconnaître le double-clic)
  const dernierClic = useRef<{ id: string; t: number } | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ouvrir");

    if (id) {
      ouvrirId.current = id;
      setOuvertes(new Set([id]));
    }
  }, []);

  /* Temps réel : présence des autres utilisateurs et modifications faites ailleurs */
  useEffect(() => {
    chargerMoi()
      .then((m) => setMoiId(m?.id ?? null))
      .catch(() => setMoiId(null));
  }, []);

  const nomMoi = annuaire.find((c) => c.id === moiId);
  useEffect(() => {
    if (!moiId) return;
    const canal = supabase.channel("planning-be", { config: { presence: { key: moiId } } });

    canal
      .on("presence", { event: "sync" }, () => {
        const etat = canal.presenceState() as Record<string, { id: string; nom: string; modifie: boolean }[]>;
        const liste = Object.values(etat)
          .flat()
          .filter((p) => p.id !== moiId);
        setAutres([...new Map(liste.map((p) => [p.id, p])).values()]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pilotage_affectations" }, () => {
        // nos propres enregistrements déclenchent aussi l'événement : on les ignore quelques secondes
        if (Date.now() - derniereEcriture.current > 4000) setModifAilleurs(true);
      })
      .subscribe(async (statut) => {
        if (statut === "SUBSCRIBED") {
          await canal.track({ id: moiId, nom: nomMoi ? nomCollab(nomMoi) : "Quelqu’un", modifie: peutAgir });
        }
      });

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [moiId, nomMoi, peutAgir]);

  // toute écriture faite d'ici est datée, pour ne pas s'alerter soi-même
  useEffect(() => {
    derniereEcriture.current = Date.now();
  }, [rechargement]);

  useEffect(() => {
    let actif = true;
    setChargement(true);

    Promise.all([
      chargerAffaires({ horsPlanning: true }),
      chargerCharges(),
      chargerAnnuaire(),
      chargerActivites(),
      chargerImputations(),
      chargerMoi(),
      chargerPlanifie(debutDonnees),
      chargerCapacitesAbsences(lundi, fin),
      chargerCodesDivers().catch(() => [] as { code: string; libelle: string }[]),
      chargerRealise().catch(() => []),
      Promise.resolve(null as { data: { affaire_id: string; heures: number | string }[] | null } | null),
    ])
      .then(([af, ch, an, ref, im, moi, pl, cap, cd, re, fa]) => {
        if (!actif) return;
        // Au planning d'office : toute commande en cours ou en intention de commande ; une commande
        // livrée ou abandonnée n'y reste que si elle a eu des affectations (historique de charge).
        const avecAffectations = new Set(pl.affectations.map((x) => x.affaire_id).filter(Boolean) as string[]);
        const actives = af.filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE" || avecAffectations.has(a.id));
        setToutesAffaires(af);

        // PE / PI : seulement les avenants (R1, R2…) quand il y en a ; sinon la commande de base.
        // (une base qui a déjà des affectations reste visible, pour l'historique de charge)
        const prestationImp = (code: string | null) => {
          const i = im.find((x) => x.code === code);
          return i ? i.charge_obligatoire === false : code === "PE" || code === "PI";
        };
        const basesAvecAvenant = new Set(
          actives.filter((a) => a.type === "CBE" && prestationImp(a.imputation) && /R\d+$/i.test(a.numero)).map((a) => a.numero.match(/^\d+/)?.[0] ?? "")
        );
        setAffaires(
          actives.filter(
            (a) => !(a.type === "CBE" && prestationImp(a.imputation) && /^\d+$/.test(a.numero) && basesAvecAvenant.has(a.numero) && !avecAffectations.has(a.id))
          )
        );
        setCharges(ch);
        setAnnuaire(an);
        setReferentiel(ref);
        setImputations(im);
        setPeutAgir(Boolean(moi?.peutModifier));
        setEstAdmin(Boolean(moi?.estAdmin));
        setAffectations(pl.affectations);
        setJoursRows(pl.jours);
        setCaps(cap);
        setCodesDivers(cd);

        const r = new Map<string, number>();
        for (const x of re) {
          const k = `${x.type_affaire}|${String(x.numero).replace(/^0+/, "")}`;
          r.set(k, (r.get(k) ?? 0) + (Number(x.heures) || 0));
        }
        setRealiseParAffaire(r);

        const factures = new Map<string, number>();
        for (const x of ((fa?.data ?? []) as { affaire_id: string; heures: number | string }[])) factures.set(x.affaire_id, Number(x.heures) || 0);
        setFactureParAffaire(factures);

        setSelection((s) => (s && pl.affectations.some((a) => a.id === s) ? s : null));

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

  /* Bornes de chaque affaire : celles de l'affaire si elles sont définies,
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

      // La barre de l'affaire couvre ses dates ET ses affectations : une affaire sans dates (ou dont
      // les dates ne couvrent pas les affectations) apparaît dès qu'on y affecte quelqu'un.
      const debuts = [af.date_debut, debutEffectif].filter(Boolean).sort() as string[];
      const fins = [af.echeance, finEffective].filter(Boolean).sort() as string[];
      m.set(af.id, { debut: debuts[0] ?? null, fin: fins[fins.length - 1] ?? null });
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

  // personne suivie : choisie dans la barre du haut, sinon celle de la barre sélectionnée
  const focusCollab = focus ?? (selection ? affectations.find((a) => a.id === selection)?.collaborateur_id ?? null : null);

  // sa charge, jour par jour, avec les affaires concernées
  const chargeFocus = useMemo(() => {
    const m = new Map<string, { heures: number; affaires: Map<string, number> }>();
    if (!focusCollab) return m;
    const affaireNom = new Map(toutesAffaires.map((a) => [a.id, `${a.type}${a.numero}`]));
    for (const a of affectations) {
      if (a.collaborateur_id !== focusCollab) continue;
      const nom = a.affaire_id ? affaireNom.get(a.affaire_id) ?? "Affaire" : a.libelle ?? "Hors affaire";
      for (const j of joursParAffectation.get(a.id) ?? []) {
        const e = m.get(j.jour) ?? { heures: 0, affaires: new Map<string, number>() };
        e.heures += j.heures;
        e.affaires.set(nom, (e.affaires.get(nom) ?? 0) + j.heures);
        m.set(j.jour, e);
      }
    }
    return m;
  }, [focusCollab, affectations, joursParAffectation, toutesAffaires]);

  useEffect(() => {
    if (!focus) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [focus]);

  const joursAffectes: JourAffecte[] = useMemo(() => {
    const parId = new Map(affectations.map((a) => [a.id, a]));

    return joursRows
      .map((j) => {
        const a = parId.get(j.affectation_id);
        return a ? { collaborateur_id: a.collaborateur_id, jour: j.jour, heures: num(j.heures) } : null;
      })
      .filter((x): x is JourAffecte => x !== null);
  }, [joursRows, affectations]);

  // Blocs, par affaire (les événements hors affaire sont rangés sous la clé "")
  const blocsParAffaire = useMemo(() => {
    const index = new Map<string, Bloc[]>();
    const premier = colonnes[0];
    const dernier = colonnes[colonnes.length - 1];

    for (const a of affectations) {
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

      const cle = a.affaire_id ?? "";
      if (!index.has(cle)) index.set(cle, []);
      index.get(cle)!.push(bloc);
    }

    for (const l of index.values()) l.sort((x, y) => x.debutIdx - y.debutIdx);

    return index;
  }, [affectations, joursParAffectation, colonnes]);

  /* Événements hors affaire visibles sur la période, regroupés par intitulé */
  const evenements = useMemo(() => {
    const groupes = new Map<string, { libelle: string; code: string | null; blocs: Bloc[] }>();

    for (const b of blocsParAffaire.get("") ?? []) {
      const libelle = b.affectation.libelle?.trim() || "Événement";
      const cle = b.affectation.groupe_id ?? `${libelle.toLowerCase()}|${b.affectation.code ?? ""}`;
      const g = groupes.get(cle) ?? { libelle, code: b.affectation.code, blocs: [] };
      g.blocs.push(b);
      groupes.set(cle, g);
    }

    return [...groupes.entries()]
      .map(([cle, g]) => ({ cle, ...g, debutIdx: Math.min(...g.blocs.map((b) => b.debutIdx)) }))
      .sort((x, y) => x.debutIdx - y.debutIdx || x.libelle.localeCompare(y.libelle, "fr"));
  }, [blocsParAffaire]);

  /* FORFAITS : ce qui reste à planifier, commande par commande
     = chiffré − déjà pointé (feuilles d'heures) − déjà planifié à venir.
     Les heures sont pointées sur la commande de base : le pointé de la famille (base + avenants)
     remplit d'abord la base, puis R1, R2… dans l'ordre. */
  const resteAPlanifier = useMemo(() => {
    const m = new Map<string, { chiffre: number; pointe: number; planifie: number; reste: number }>();
    const futur = new Map<string, number>();
    for (const a of affectations) {
      if (!a.affaire_id) continue;
      const h = (joursParAffectation.get(a.id) ?? []).filter((j) => j.jour >= aujourdhui).reduce((t, j) => t + j.heures, 0);
      futur.set(a.affaire_id, (futur.get(a.affaire_id) ?? 0) + h);
    }
    const familles = new Map<string, Affaire[]>();
    // la famille complète (une base livrée a consommé ses heures en premier)
    for (const af of toutesAffaires) {
      if (estPrestation(af) || af.statut === "ABANDONNEE") continue;
      const k = `${af.type}|${(af.numero.match(/^\d+/)?.[0] ?? af.numero).replace(/^0+/, "")}`;
      familles.set(k, [...(familles.get(k) ?? []), af]);
    }
    for (const [k, membres] of familles) {
      membres.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      let pointeRestant = realiseParAffaire.get(k) ?? 0;
      membres.forEach((af, i) => {
        const chiffre = chiffreParAffaire.get(af.id) ?? 0;
        const derniere = i === membres.length - 1;
        const pointe = derniere ? pointeRestant : Math.min(chiffre, pointeRestant);
        pointeRestant -= pointe;
        const planifie = futur.get(af.id) ?? 0;
        m.set(af.id, { chiffre, pointe, planifie, reste: Math.max(0, chiffre - pointe - planifie) });
      });
    }
    return m;
  }, [toutesAffaires, affectations, joursParAffectation, chiffreParAffaire, realiseParAffaire, estPrestation, aujourdhui]);

  const totalResteAPlanifier = useMemo(() => {
    let h = 0;
    let n = 0;
    const affichees = new Set(affaires.filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE").map((a) => a.id));
    for (const [id, r] of resteAPlanifier)
      if (affichees.has(id) && r.reste > 0.5) {
        h += r.reste;
        n++;
      }
    return { h, n };
  }, [resteAPlanifier, affaires]);

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

  const garderType = useCallback(
    (a: Affaire) => {
      if (filtreType === "TOUS") return true;
      if (filtreType === "PE") return a.imputation === "PE";
      if (filtreType === "PI") return a.imputation === "PI";
      return a.type === filtreType;
    },
    [filtreType]
  );

  const lignes = useMemo(
    () =>
      affaires
        .filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE")
        .filter(garderType)
        .sort(
          (a, b) =>
            // ORDRE_PAR_NUMERO : plus anciennes d'abord, avenant juste sous sa commande de base
            rangGroupe(a) - rangGroupe(b) ||
            (a.type === b.type ? 0 : a.type === "CBE" ? -1 : 1) ||
            a.numero.localeCompare(b.numero, "fr", { numeric: true })
        ),
    [affaires, garderType]
  );

  /* Affaires livrées restées au planning : rangées en bas, la plus récente d'abord */
  const lignesLivrees = useMemo(
    () =>
      affaires
        .filter((a) => a.statut === "LIVREE")
        .filter(garderType)
        .sort(
          (a, b) =>
            (b.date_livraison ?? "").localeCompare(a.date_livraison ?? "") ||
            b.numero.localeCompare(a.numero, "fr", { numeric: true })
        ),
    [affaires, garderType]
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

  /* Barre de chaque affaire (toutes les affaires ayant un début et une fin) */
  /* Enveloppe des prestations (PE, PI) : commandé, consommé, planifié à venir, reste, épuisement prévu */
  /* PE / PI : plus de jauge d'enveloppe ici. Chaque commande (base ou avenant) est une ligne du
     planning, avec ses heures commandées comme une affaire au forfait ; la consommation et la
     facturation se suivent dans le relevé des prestations. */
  const enveloppes = useMemo(
    () =>
      new Map<
        string,
        { commande: number; consomme: number; planifie: number; reste: number; epuisement: string | null; alerte: "EPUISEE" | "RELANCE" | null }
      >(),
    []
  );

  const pistesAffaires = useMemo(() => {
    const m = new Map<string, PisteAffaire>();

    for (const a of affaires) {
      const b = bornesParAffaire.get(a.id);
      if (!b?.debut || !b.fin) continue;

      const position = positionPiste(b.debut, b.fin, colonnes);
      if (!position) continue;

      m.set(a.id, { debut: b.debut, fin: b.fin, ...position });
    }

    return m;
  }, [affaires, bornesParAffaire, colonnes]);

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
      if (a.affaire_id && !affaire) return;

      const { i, f } = calculerNouvellesBornes(b, mode, delta);
      const debut = r.colonnes[i];
      let finJour = r.colonnes[f];

      const cap = r.capacites.get(a.collaborateur_id);
      const net = (j: string) => cap?.get(j)?.net ?? 0;
      const ratio = ratioDuBloc(b.jours, net);

      // Me contenir : on arrête le bloc au chiffré
      const chiffre = affaire ? r.chiffreParAffaire.get(affaire.id) ?? 0 : 0;
      const total = affaire ? r.affecteParAffaire.get(affaire.id)?.heures ?? 0 : b.heures;
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

  /* PE / PI : les heures se modifient dans le relevé des prestations */
  function ouvrirReleve(jour: string) {
    window.location.assign(`/pilotage/prestations?mois=${jour.slice(0, 7)}`);
  }

  /* Ouvre la fenêtre de modification d'une barre de ressource */
  function modifierBloc(id: string) {
    const bloc = ref.current.blocs.get(id);
    if (!bloc) return;

    const edition = { affectation: bloc.affectation, jours: joursRows.filter((j) => j.affectation_id === bloc.affectation.id) };

    if (!bloc.affectation.affaire_id) {
      setEvenement({ edition });
      return;
    }

    const affaire = ref.current.affairesParId.get(bloc.affectation.affaire_id);
    if (!affaire) return;

    if (ref.current.estPrestation(affaire)) {
      ouvrirReleve(bloc.jours[0]?.jour ?? aujourdhui);
      return;
    }

    if (ref.current.estPrestation(affaire)) setFicheRessource({ affaire, edition });
    else setDialogue({ affaire, edition });
  }

  function demarrerDrag(e: PointerReact<HTMLElement>, b: Bloc, mode: DragEtat["mode"]) {
    if (!peutAgir) return;

    const ligne = (e.currentTarget as HTMLElement).closest("[data-ligne]") as HTMLElement | null;
    if (!ligne) return;

    e.preventDefault();
    e.stopPropagation();

    // Barre coupée par le bord de la période, ou ressource d'une PE / PI (gérée dans le relevé
    // des prestations) : on peut la sélectionner, pas la glisser.
    const affaireBloc = b.affectation.affaire_id ? ref.current.affairesParId.get(b.affectation.affaire_id) : undefined;
    const bloque =
      (affaireBloc ? ref.current.estPrestation(affaireBloc) : false) ||
      (mode === "move" && (b.coupeGauche || b.coupeDroite)) ||
      (mode === "debut" && b.coupeGauche) ||
      (mode === "fin" && b.coupeDroite);

    const largeur = ligne.getBoundingClientRect().width - LARGEUR_NOM - LARGEUR_STATUT;
    const etat = { id: b.affectation.id, mode, x0: e.clientX, pxCol: Math.max(4, largeur / ref.current.colonnes.length), delta: 0 };

    dragRef.current = etat;
    if (!bloque) setDrag({ id: etat.id, mode, delta: 0 });

    const bouger = (ev: PointerEvent) => {
      const courant = dragRef.current;
      if (!courant || bloque) return;
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
        // Un clic sélectionne la barre ; un second clic rapide (double-clic) l'ouvre.
        const maintenant = Date.now();
        const precedent = dernierClic.current;

        if (precedent && precedent.id === courant.id && maintenant - precedent.t < DELAI_DOUBLE_CLIC) {
          dernierClic.current = null;
          modifierBloc(courant.id);
        } else {
          dernierClic.current = { id: courant.id, t: maintenant };
          setSelection(courant.id);
        }
        return;
      }

      void appliquer(courant.id, courant.mode, courant.delta);
    };

    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", relacher, { once: true });
  }

  /* ------------------------------ suppression au clavier ------------------------------ */

  const fenetreOuverte = Boolean(dialogue || ficheRessource || ficheAffaire || evenement);

  useEffect(() => {
    if (!selection || fenetreOuverte) return;

    const surTouche = async (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      if (cible && (["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName) || cible.isContentEditable)) return;

      if (e.key === "Escape") {
        setSelection(null);
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();

      const bloc = tousLesBlocs.get(selection);
      if (!bloc) return;
      const affaire = bloc.affectation.affaire_id ? affairesParId.get(bloc.affectation.affaire_id) : undefined;
      if (affaire && estPrestation(affaire)) {
        setErreur("Les heures d’une PE / PI se modifient dans l’onglet « Prestations PE / PI » (double-clic sur la barre).");
        return;
      }
      const qui = nomCollab(annuaire.find((c) => c.id === bloc.affectation.collaborateur_id));
      const sur = affaire ? ` sur ${affaire.type} ${affaire.numero}` : bloc.affectation.libelle ? ` (« ${bloc.affectation.libelle} »)` : "";

      if (
        !window.confirm(
          `Supprimer l’affectation de ${qui}${sur} (${formatHeures(bloc.heures)}, du ${formatDate(bloc.jours[0].jour)} au ${formatDate(bloc.jours[bloc.jours.length - 1].jour)}) ?`
        )
      )
        return;

      const { error } = await supabase.from("pilotage_affectations").delete().eq("id", selection);

      if (error) {
        setErreur(traduireErreur(error.message));
        return;
      }

      setSelection(null);
      setInfo(`Affectation de ${qui} supprimée.`);
      setRechargement((n) => n + 1);
    };

    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [selection, fenetreOuverte, tousLesBlocs, affairesParId, annuaire, estPrestation]);

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

  /* Colonne (jour) sous la souris dans une ligne du planning */
  function jourSousLaSouris(ligne: HTMLElement, clientX: number): string | null {
    const rect = ligne.getBoundingClientRect();
    const largeur = rect.width - LARGEUR_NOM - LARGEUR_STATUT;
    const x = clientX - rect.left - LARGEUR_NOM;
    if (x < 0 || x > largeur || colonnes.length === 0) return null;
    const idx = Math.min(colonnes.length - 1, Math.max(0, Math.floor((x / Math.max(1, largeur)) * colonnes.length)));
    return colonnes[idx];
  }

  function ouvrirAffectation(affaire: Affaire, debut: string, collaborateurId?: string) {
    if (estPrestation(affaire)) {
      ouvrirReleve(debut);
      return;
    }
    setDialogue({ affaire, prefill: { collaborateurId, debut } });
  }

  function surDepot(e: DragEvent<HTMLElement>, affaire: Affaire) {
    e.preventDefault();
    if (!peutAgir) return;

    const collaborateurId = e.dataTransfer.getData("text/plain");
    if (!collaborateurId) return;

    const jour = jourSousLaSouris(e.currentTarget as HTMLElement, e.clientX);
    if (!jour) return;

    ouvrirAffectation(affaire, jour, collaborateurId);
  }

  /* Double-clic sur une partie vide d'une ligne d'affaire : affecter quelqu'un à cette date */
  function surDoubleClic(e: MouseReact<HTMLElement>, affaire: Affaire) {
    if (!peutAgir) return;
    if ((e.target as HTMLElement).closest("button, a, [data-barre]")) return;

    const jour = jourSousLaSouris(e.currentTarget as HTMLElement, e.clientX);
    if (!jour) return;

    ouvrirAffectation(affaire, jour);
  }

  /* « ✓ Livrée » : range l'affaire dans « Affaires livrées » (elle reste au planning) */
  async function changerLivree(affaire: Affaire, livree: boolean) {
    if (
      livree &&
      !window.confirm(
        `Marquer ${affaire.type} ${affaire.numero} comme livrée aujourd’hui ?\nElle passera, avec ses barres, dans « Affaires livrées » en bas du planning.`
      )
    )
      return;

    setLivraisonEnCours(affaire.id);

    const { error } = await supabase
      .from("pilotage_affaires")
      .update(livree ? { statut: "LIVREE", date_livraison: aujourdhui } : { statut: "EN_COURS", date_livraison: null })
      .eq("id", affaire.id);

    setLivraisonEnCours("");

    if (error) {
      setErreur(traduireErreur(error.message));
      return;
    }

    setInfo(
      livree
        ? `${affaire.type} ${affaire.numero} livrée : rangée dans « Affaires livrées », en bas du planning.`
        : `${affaire.type} ${affaire.numero} remise en cours.`
    );
    setRechargement((n) => n + 1);
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
    if (affaire.statut === "LIVREE") return { genre: "info", texte: affaire.date_livraison ? `Livrée le ${formatDate(affaire.date_livraison)}` : "Livrée" };
    if (chiffre > 0 && affecte > chiffre + 0.001) return { genre: "crit", texte: `Au-delà du chiffré (+${formatHeures(affecte - chiffre)})` };
    if (affaire.echeance && finPrevue && finPrevue > affaire.echeance) return { genre: "crit", texte: "Fin après la livraison souhaitée" };
    if (chiffre > 0 && chiffre - affecte > 0.5) return { genre: "warn", texte: `Reste ${formatHeures(chiffre - affecte)} à affecter` };
    if (chiffre > 0) return { genre: "ok", texte: "✓ Chiffré couvert" };
    if (affecte > 0) return { genre: "info", texte: finPrevue ? `Fin le ${formatDate(finPrevue)}` : "Affectée" };
    return { genre: "info", texte: affaire.type === "DBE" ? "Jalon de remise" : "Non affectée" };
  }

  function rendreBloc(b: Bloc, affaire: Affaire | null) {
    const enDrag = drag && drag.id === b.affectation.id ? drag : null;
    const bornes = enDrag ? calculerNouvellesBornes(b, enDrag.mode, enDrag.delta) : { i: b.debutIdx, f: b.finIdx };
    const c = annuaire.find((x) => x.id === b.affectation.collaborateur_id);
    const pe = affaire ? estPE(affaire.id) : false;
    const pi = affaire?.imputation === "PI";
    const prestation = affaire ? estPrestation(affaire) : false;
    const libre = !affaire;
    const verrouille = !peutAgir;
    const choisi = selection === b.affectation.id;
    const suivi = Boolean(focusCollab) && b.affectation.collaborateur_id === focusCollab;
    const estompe = Boolean(focusCollab) && !suivi;
    const cap = capacites.get(b.affectation.collaborateur_id);
    const manquants = joursSansCapacite(colonnes[bornes.i], colonnes[bornes.f], cap);
    const nb = bornes.f - bornes.i + 1;
    const fond = libre ? "#7b8189" : pe ? "#6f8fb3" : pi ? "#6b58a8" : affaire?.type === "DBE" ? "#f2bfd0" : C.rouge;
    const encre = affaire?.type === "DBE" && !pe && !pi ? "#4a0f28" : "#ffffff";
    const net = (j: string) => cap?.get(j)?.net ?? 0;
    const part = Math.round(ratioDuBloc(b.jours, net) * 100);

    // la ressource dépasse les bornes de la prestation : jours concernés
    const borneAffaire = prestation && affaire ? bornesParAffaire.get(affaire.id) : undefined;
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
          data-barre
          aria-selected={choisi}
          title={`${nomCollab(c)} — ${formatHeures(b.heures)} — du ${formatDate(b.jours[0].jour)} au ${formatDate(b.jours[b.jours.length - 1].jour)}${pe ? " — chez le client" : ""}\nUn clic : sélectionner (Suppr pour supprimer) · double-clic : modifier`}
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
            border: enDrag
              ? "2px dashed #1f2328"
              : choisi
                ? "3px solid #1f2328"
                : `1.5px solid ${libre ? "#4b5057" : pe ? "#34506b" : pi ? "#4a3a85" : affaire?.type === "DBE" ? "#d98aa6" : C.rouge}`,
            boxShadow: choisi ? "0 0 0 3px #ffd54a" : suivi ? "0 0 0 3px #1f6feb" : "none",
            opacity: estompe ? 0.22 : 1,
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
            zIndex: enDrag || choisi ? 3 : 1,
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

  /* Barre de l'affaire : de son début à son échéance. Elle se remplit à mesure que le chiffré est affecté.
     Prestation (PE, PI) : barre pointillée qu'on peut glisser et étirer (bornes de la prestation). */
  function rendrePisteAffaire(affaire: Affaire, chiffre: number, affecte: number) {
    const piste = pistesAffaires.get(affaire.id);
    const borne = bornesParAffaire.get(affaire.id);
    const prestation = estPrestation(affaire);

    if (!piste) {
      // pas de bornes, ou bornes hors de la période affichée
      if (!prestation || (borne?.debut && borne.fin)) return null;

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

    const enDrag = prestation && dragAffaire && dragAffaire.id === affaire.id ? dragAffaire : null;
    const bornes = enDrag ? bornesApresGlisse(piste, enDrag.mode, enDrag.delta) : { i: piste.debutIdx, f: piste.finIdx };
    const pi = affaire.imputation === "PI";
    const verrouille = !peutAgir || !prestation;
    const nouveauDebut = enDrag ? (enDrag.mode === "fin" ? piste.debut : colonnes[bornes.i]) : piste.debut;
    const nouvelleFin = enDrag ? (enDrag.mode === "debut" ? piste.fin : colonnes[bornes.f]) : piste.fin;

    const livree = affaire.statut === "LIVREE";
    const env = prestation ? enveloppes.get(affaire.id) : undefined;
    // forfait : la barre montre le déjà POINTÉ (foncé) + le planifié à venir (clair), sur le chiffré
    const rp = !prestation ? resteAPlanifier.get(affaire.id) : undefined;
    const remplissage = env
      ? env.commande > 0 ? Math.min(100, ((env.consomme + env.planifie) / env.commande) * 100) : 0
      : rp && rp.chiffre > 0
        ? Math.min(100, ((rp.pointe + rp.planifie) / rp.chiffre) * 100)
        : chiffre > 0 ? Math.min(100, (affecte / chiffre) * 100) : 0;
    const partConsommee = env && env.commande > 0
      ? Math.min(100, (env.consomme / env.commande) * 100)
      : rp && rp.chiffre > 0 ? Math.min(100, (rp.pointe / rp.chiffre) * 100) : 0;
    const couvert = !env && (rp ? rp.chiffre > 0 && rp.reste <= 0.5 : chiffre > 0 && affecte >= chiffre - 0.5);
    const couleurBord = prestation ? (pi ? "#6b58a8" : "#34506b") : affaire.type === "DBE" ? "#d98aa6" : C.rouge;
    const fondBarre = prestation ? (pi ? "#f1eef9" : "#eaf1fa") : affaire.type === "DBE" ? "#fdf1f5" : "#fbeeee";
    const fondRempli = couvert ? "#bfe3c6" : prestation ? (pi ? "#cfc6ea" : "#bcd0e8") : affaire.type === "DBE" ? "#f2bfd0" : "#f0b9b9";

    const libelle = env
      ? env.commande > 0
        ? `enveloppe ${formatHeures(env.commande)} · reste ${formatHeures(Math.max(0, env.reste))}`
        : ""
      : rp && rp.chiffre > 0
        ? `${formatHeures(rp.pointe)} pointées${rp.planifie > 0.5 ? ` + ${formatHeures(rp.planifie)} planifiées` : ""} / ${formatHeures(rp.chiffre)}`
        : chiffre > 0
        ? `${formatHeures(affecte)} / ${formatHeures(chiffre)}`
        : affecte > 0
          ? `${formatHeures(affecte)} affectées`
          : "";

    const poignee = (cote: "debut" | "fin", coupe: boolean): CSSProperties => ({
      position: "absolute",
      top: 0,
      bottom: 0,
      [cote === "debut" ? "left" : "right"]: 0,
      width: 9,
      zIndex: 2,
      background: coupe || verrouille ? "transparent" : "rgba(0,0,0,.28)",
      cursor: coupe || verrouille ? "default" : "ew-resize",
      borderRadius: cote === "debut" ? "4px 0 0 4px" : "0 4px 4px 0",
      touchAction: "none",
    });

    return (
      <div style={{ display: "contents" }}>
        <div
          data-barre
          title={
            prestation
              ? `Prestation du ${formatDate(piste.debut)} au ${formatDate(piste.fin)} — glisser pour décaler, étirer un bord pour changer le début ou la fin, cliquer pour modifier`
              : `${affaire.type} ${affaire.numero} : du ${formatDate(piste.debut)} au ${formatDate(piste.fin)}${
                  rp && rp.chiffre > 0
                    ? ` — chiffré ${formatHeures(rp.chiffre)} : déjà pointé ${formatHeures(rp.pointe)}, planifié à venir ${formatHeures(rp.planifie)}, reste à planifier ${formatHeures(rp.reste)}`
                    : chiffre > 0
                      ? ` — ${formatHeures(affecte)} affectées sur ${formatHeures(chiffre)} chiffrées`
                      : ""
                }`
          }
          onPointerDown={prestation ? (e) => demarrerDragAffaire(e, affaire, "move") : undefined}
          style={{
            gridColumn: `${col(bornes.i)} / ${col(bornes.f) + 1}`,
            gridRow: 1,
            alignSelf: "center",
            position: "relative",
            height: 28,
            margin: "0 1px",
            borderRadius: 5,
            background: fondBarre,
            color: "#1f2328",
            border: `2px ${prestation && !enDrag ? "dashed" : "solid"} ${enDrag ? C.rouge : couleurBord}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            padding: "0 11px",
            fontWeight: 800,
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            opacity: livree ? 0.7 : 1,
            cursor: verrouille ? "default" : enDrag?.mode === "move" ? "grabbing" : "grab",
            touchAction: "none",
            zIndex: enDrag ? 3 : 1,
          }}
        >
          {/* remplissage : part du chiffré déjà affectée */}
          {remplissage > 0 && (
            <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${remplissage}%`, background: fondRempli, pointerEvents: "none" }} />
          )}
          {/* la partie déjà consommée (pointée dans les feuilles d'heures), plus foncée */}
          {partConsommee > 0 && (
            <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${partConsommee}%`, background: prestation ? (pi ? "#a99bd6" : "#8fb0d6") : affaire.type === "DBE" ? "#d98aa6" : "#d46a6a", pointerEvents: "none" }} />
          )}
          {prestation && <span aria-hidden="true" style={poignee("debut", piste.coupeGauche)} onPointerDown={(e) => demarrerDragAffaire(e, affaire, "debut")} />}
          <span style={{ position: "relative", overflow: "hidden", textOverflow: "ellipsis" }}>
            {prestation ? `${formatDate(nouveauDebut)} → ${formatDate(nouvelleFin)}` : `${affaire.type} ${affaire.numero}`}
            {libelle && ` · ${libelle}`}
            {couvert && " ✓"}
          </span>
          {prestation && <span aria-hidden="true" style={poignee("fin", piste.coupeDroite)} onPointerDown={(e) => demarrerDragAffaire(e, affaire, "fin")} />}
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

  /* Une affaire du planning : sa ligne (barre de l'affaire), ses besoins, ses ressources, la ligne d'affectation */
  function rendreAffaire(affaire: Affaire, titreGroupe: string | null, premiere: boolean): ReactNode {
    const ouverte = ouvertes.has(affaire.id);
    const blocs = blocsParAffaire.get(affaire.id) ?? [];
    const chiffre = chiffreParAffaire.get(affaire.id) ?? 0;
    const total = affecteParAffaire.get(affaire.id);
    const affecteReel = total?.heures ?? 0;
    const livree = affaire.statut === "LIVREE";

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
        {titreGroupe && (
          <div style={{ marginTop: premiere ? 8 : 14, padding: "6px 8px", background: "#eef0f3", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: "#3b4046", borderRadius: 4 }}>
            {titreGroupe}
          </div>
        )}
        <div style={{ borderTop: `2px solid ${C.ligne}` }} />
        <div
          data-ligne
          onDoubleClick={(e) => surDoubleClic(e, affaire)}
          onDragOver={(e) => peutAgir && e.preventDefault()}
          onDrop={(e) => surDepot(e, affaire)}
          style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "46px", background: livree ? "#f1f2f4" : "#f8f9fa", position: "relative" }}
        >
          <div style={{ gridColumn: 1, display: "flex", alignItems: "center", gap: 4, padding: "0 4px", minWidth: 0 }}>
            <button
              type="button"
              aria-expanded={ouverte}
              aria-label={`${ouverte ? "Replier" : "Déplier"} ${affaire.type} ${affaire.numero}`}
              onClick={() =>
                setOuvertes((s) => {
                  const n = new Set(s);
                  if (n.has(affaire.id)) n.delete(affaire.id);
                  else n.add(affaire.id);
                  return n;
                })
              }
              style={{ minWidth: 30, minHeight: 34, border: "none", background: "transparent", fontSize: 14, cursor: "pointer", color: C.gris }}
            >
              {ouverte ? "▾" : "▸"}
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <BadgeType type={affaire.type} />
                <Link href={`/pilotage/affaire/${affaire.id}`} style={{ fontWeight: 800, fontSize: 15, color: C.rougeFonce }}>
                  {affaire.numero}
                </Link>
                {affaire.imputation && <span style={{ fontSize: 11, fontWeight: 800, color: C.gris }}>{affaire.imputation}</span>}
                {(affaire as Affaire & { suivi_maj_le?: string | null }).suivi_maj_le && (
                  <span title="Statut, dates et chiffré suivis depuis le Suivi d’affaire BE (Excel)" style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, color: "#1d6f42", border: "1px solid #9cc9ae", borderRadius: 4, padding: "0 4px" }}>
                    XLS
                  </span>
                )}
                {/* Livrée / Reprendre : seulement pour les affaires déclarées à la main.
                    Une affaire venue d'Excel suit le statut du classeur (Excel fait foi). */}
                {peutAgir && !(affaire as Affaire & { suivi_maj_le?: string | null }).suivi_maj_le && (
                  <button
                    type="button"
                    disabled={livraisonEnCours === affaire.id}
                    onClick={() => changerLivree(affaire, !livree)}
                    title={livree ? "Remettre l’affaire en cours (reprise client)" : "Marquer livrée : l’affaire passe dans « Affaires livrées »"}
                    style={{
                      marginLeft: "auto",
                      minHeight: 24,
                      padding: "0 7px",
                      border: `1.5px solid ${livree ? "#b9bec5" : "#2e7d32"}`,
                      background: "#ffffff",
                      color: livree ? "#3b4046" : "#1b5e20",
                      borderRadius: 6,
                      fontWeight: 800,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                      opacity: livraisonEnCours === affaire.id ? 0.5 : 1,
                    }}
                  >
                    {livree ? "↺ Reprendre" : "✓ Livrée"}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={affaire.designation}>
                {(() => {
                  // client de la commande de base, même pour un avenant (1750R2 -> 1750)
                  const base = (affaire.numero.match(/^\d+/)?.[0] ?? affaire.numero).replace(/^0+/, "");
                  const client = clientsParBase.get(`${affaire.type}|${base}`);
                  return client ? <strong style={{ fontWeight: 800 }}>{client} · </strong> : null;
                })()}
                {affaire.designation}
              </div>
            </div>
          </div>

          {fonds()}

          {/* barre de l'affaire */}
          {rendrePisteAffaire(affaire, chiffre, affecteAffiche)}

          {/* prestation : épuisement prévu de l'enveloppe */}
          {prestation &&
            (() => {
              const env = enveloppes.get(affaire.id);
              const idx = env?.epuisement && env.alerte !== "EPUISEE" ? colonnes.indexOf(env.epuisement) : -1;
              return idx >= 0 ? (
                <div
                  title={`Enveloppe consommée vers le ${formatDate(env?.epuisement ?? null)} au rythme planifié`}
                  style={{ gridColumn: col(idx), gridRow: 1, alignSelf: "center", justifySelf: "end", fontSize: 15, fontWeight: 800, color: "#7a3e00", zIndex: 4, pointerEvents: "none" }}
                >
                  ⌛
                </div>
              ) : null;
            })()}

          {/* jalon : livraison souhaitée / remise */}
          {!prestation && idxLivraison >= 0 && (
            <div
              title={`${affaire.type === "DBE" ? "Remise de l’offre" : "Livraison souhaitée"} : ${formatDate(affaire.echeance)}`}
              style={{ gridColumn: col(idxLivraison), gridRow: 1, alignSelf: "center", justifySelf: "end", fontSize: 16, fontWeight: 800, color: affaire.type === "DBE" ? "#8a3a5d" : C.rougeFonce, zIndex: 2, pointerEvents: "none" }}
            >
              {affaire.type === "DBE" ? "◆" : "⚑"}
            </div>
          )}

          <div
            style={{
              gridColumn: colonnes.length + 2,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "nowrap",
              gap: 6,
              padding: "0 8px",
              overflow: "hidden",
              minWidth: 0,
              whiteSpace: "nowrap",
            }}
          >
            {prestation ? (
              (() => {
                const env = enveloppes.get(affaire.id);
                if (livree || !env || env.commande <= 0) {
                  return (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>
                        {borne?.debut && borne.fin ? `${formatDate(borne.debut)} → ${formatDate(borne.fin)}` : "Dates à définir"}
                      </div>
                      <Pastille genre={etat.genre}>{etat.texte}</Pastille>
                    </>
                  );
                }
                return (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800 }} title="Consommé (feuilles d'heures) + planifié à venir, sur l'enveloppe commandée">
                      {formatHeures(env.consomme)} + {formatHeures(env.planifie)} / {formatHeures(env.commande)}
                    </div>
                    <Pastille genre={env.alerte === "EPUISEE" ? "crit" : env.alerte === "RELANCE" ? "warn" : nbDepassent > 0 ? "warn" : "ok"}>
                      {env.alerte === "EPUISEE"
                        ? "Enveloppe consommée"
                        : env.alerte === "RELANCE"
                          ? "Nouvelle commande à demander"
                          : nbDepassent > 0
                            ? `▲ ${nbDepassent} dépasse${nbDepassent > 1 ? "nt" : ""} les dates`
                            : `Reste ${formatHeures(Math.max(0, env.reste))} à planifier`}
                    </Pastille>
                    <div style={{ fontSize: 11, color: C.gris }}>
                      {env.epuisement
                        ? env.alerte === "EPUISEE"
                          ? "plus d'heures disponibles"
                          : `épuisée vers le ${formatDate(env.epuisement)}`
                        : env.reste > 0.5
                          ? `${formatHeures(env.reste)} non planifiées`
                          : ""}
                    </div>
                  </>
                );
              })()
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 800 }} title="Déjà pointé + planifié à venir, sur le chiffré">
                  {(() => {
                    const r = resteAPlanifier.get(affaire.id);
                    if (r && r.chiffre > 0) return `${formatHeures(r.pointe + r.planifie)} / ${formatHeures(r.chiffre)}`;
                    return chiffre > 0 ? `${formatHeures(affecteAffiche)} / ${formatHeures(chiffre)}` : affecteAffiche > 0 ? formatHeures(affecteAffiche) : "—";
                  })()}
                </div>
                {(() => {
                  const r = resteAPlanifier.get(affaire.id);
                  // forfait chiffré : l'état dit ce qui reste à planifier (chiffré − pointé − planifié à venir)
                  if (!r || r.chiffre <= 0 || etat.genre === "crit") return <Pastille genre={etat.genre}>{etat.texte}</Pastille>;
                  return (
                    <span title={`Chiffré ${formatHeures(r.chiffre)} − déjà pointé ${formatHeures(r.pointe)} − planifié à venir ${formatHeures(r.planifie)}`}>
                      <Pastille genre={r.reste > 0.5 ? "warn" : "ok"}>{r.reste > 0.5 ? `Reste ${formatHeures(r.reste)} à planifier` : "✓ Tout est planifié"}</Pastille>
                    </span>
                  );
                })()}
              </>
            )}
          </div>
        </div>

        {ouverte && (
          <>
            {besoins.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 10px 6px 42px", background: "#fcfcfd", borderTop: `1px dashed ${C.ligne}` }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.gris, alignSelf: "center" }}>Besoins :</span>
                {besoins.map(([id, e]) => {
                  const reste = e.chiffre - e.affecte;
                  const genre: Genre = reste < -0.5 ? "crit" : reste > 0.5 ? "warn" : "ok";

                  return (
                    <Pastille key={id} genre={genre}>
                      {genre === "ok" ? "✓ " : ""}
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

            {/* ligne d'affectation : dépôt, double-clic ou « + Affecter » */}
            <div
              data-ligne
              onDragOver={(e) => peutAgir && e.preventDefault()}
              onDrop={(e) => surDepot(e, affaire)}
              onDoubleClick={(e) => surDoubleClic(e, affaire)}
              style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "42px", borderTop: `1px dashed ${C.ligne}`, position: "relative", cursor: peutAgir ? "cell" : "default" }}
            >
              <div style={{ gridColumn: 1, display: "flex", alignItems: "center", padding: "0 6px 0 38px" }}>
                {peutAgir && (
                  <button
                    type="button"
                    style={{ minHeight: 34, padding: "0 12px", border: "1.5px dashed #b9bec5", background: "#ffffff", borderRadius: 8, fontWeight: 700, fontSize: 13, color: C.rougeFonce, cursor: "pointer", fontFamily: "inherit" }}
                    onClick={() => (prestation ? ouvrirReleve(colonnes.includes(aujourdhui) ? aujourdhui : colonnes[0]) : setDialogue({ affaire }))}
                  >
                    + Affecter
                  </button>
                )}
              </div>
              {fonds()}
              <div style={{ gridColumn: `2 / ${colonnes.length + 2}`, gridRow: 1, alignSelf: "center", textAlign: "center", fontSize: 12, color: C.gris, pointerEvents: "none" }}>
                {prestation ? "PE / PI : les heures se saisissent dans l’onglet « Prestations PE / PI » (double-clic ici)" : "double-cliquez ici à la date voulue, ou glissez une personne du panneau de droite"}
              </div>
            </div>
          </>
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

  const blocChoisi = selection ? tousLesBlocs.get(selection) : undefined;

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="affaires" />

      <div style={{ ...page.contenu, maxWidth: 1500 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 style={page.titre}>Planning des affaires</h1>
          <p style={page.sousTitre}>
            Chaque affaire mise au planning a sa barre (du début à l’échéance), qui se remplit à mesure que le chiffré est affecté.
            Dépliez-la (▸) pour voir ses besoins par activité et ses ressources. Affectez en double-cliquant à la date voulue ou en
            glissant une personne du panneau de droite.
          </p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        {/* Ascenseur horizontal : glisser pour se déplacer dans les mois */}
        {(() => {
          const origine = ajouterJours(lundiDe(aujourdhui), -26 * 7); // 6 mois en arrière
          const nbPas = 26 + 78; // jusqu'à 18 mois en avant, semaine par semaine
          const position = Math.round((Date.parse(lundi) - Date.parse(origine)) / (7 * 86400000));
          const mois: { pos: number; libelle: string }[] = [];
          for (let k = 0; k <= nbPas; k++) {
            const d = ajouterJours(origine, k * 7);
            const precedent = ajouterJours(origine, (k - 1) * 7);
            if (k === 0 || d.slice(5, 7) !== precedent.slice(5, 7))
              mois.push({ pos: k, libelle: new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: d.slice(5, 7) === "01" || k === 0 ? "2-digit" : undefined }) });
          }
          return (
            <div
              style={{
                ...page.carte,
                padding: "6px 14px 4px",
                marginBottom: 12,
                // reste visible sous les onglets du Pilotage quand on descend dans les affaires
                position: "sticky",
                top: 50,
                zIndex: 20,
                boxShadow: "0 4px 10px -6px rgba(0,0,0,.35)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
                <button type="button" aria-label="Semaine précédente" onClick={() => setLundi(ajouterJours(lundi, -7))} style={{ ...fleche, minWidth: 30, minHeight: 26, padding: "0 6px" }}>◀</button>
                <span>
                  {formatDate(lundi)} → {formatDate(colonnes[colonnes.length - 1])}
                  <span style={{ color: C.gris, fontWeight: 600 }}> · S{numeroSemaine(lundi)}</span>
                </span>
                <button type="button" aria-label="Semaine suivante" onClick={() => setLundi(ajouterJours(lundi, 7))} style={{ ...fleche, minWidth: 30, minHeight: 26, padding: "0 6px" }}>▶</button>
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                  <span aria-hidden="true">👁</span>
                  <select
                    value={focus ?? ""}
                    onChange={(e) => setFocus(e.target.value || null)}
                    aria-label="Voir les affectations d'une personne"
                    title="Allume toutes les affectations de la personne et montre sa charge jour par jour (Échap pour revenir)"
                    style={{ minHeight: 28, borderRadius: 6, border: `1.5px solid ${focus ? "#1f6feb" : "#c9cdd2"}`, fontFamily: "inherit", fontWeight: 700, padding: "0 6px" }}
                  >
                    <option value="">Voir une personne…</option>
                    {annuaire.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                      </option>
                    ))}
                  </select>
                  {focus && (
                    <button type="button" onClick={() => setFocus(null)} style={{ ...fleche, minWidth: 26, minHeight: 26, padding: "0 6px", fontSize: 13 }} aria-label="Ne plus suivre cette personne">
                      ✕
                    </button>
                  )}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={nbPas}
                step={1}
                value={Math.max(0, Math.min(nbPas, position))}
                onChange={(e) => setLundi(ajouterJours(origine, Number(e.target.value) * 7))}
                aria-label="Se déplacer dans les mois"
                style={{ width: "100%", accentColor: C.rouge, cursor: "grab" }}
              />
              <div style={{ position: "relative", height: 16, fontSize: 11, color: C.gris, fontWeight: 700 }}>
                {mois.map((m) => (
                  <span key={m.pos} style={{ position: "absolute", left: `${(m.pos / nbPas) * 100}%`, transform: "translateX(-2px)", whiteSpace: "nowrap" }}>
                    {m.libelle}
                  </span>
                ))}
                <span title="Aujourd’hui" style={{ position: "absolute", left: `${(26 / nbPas) * 100}%`, top: -4, width: 2, height: 18, background: C.rouge }} />
              </div>
            </div>
          );
        })()}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" aria-label="Période précédente" style={fleche} onClick={() => setLundi(ajouterJours(lundi, -7 * Math.max(1, Math.floor(nbSemaines / 3))))}>◀</button>
            <div style={{ fontWeight: 800, fontSize: 18, minWidth: 220, textAlign: "center" }}>
              {formatDate(lundi)} → {formatDate(colonnes[colonnes.length - 1])}
              <div style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>S{numeroSemaine(lundi)} à S{numeroSemaine(colonnes[colonnes.length - 1] ?? lundi)}</div>
            </div>
            <button type="button" aria-label="Période suivante" style={fleche} onClick={() => setLundi(ajouterJours(lundi, 7 * Math.max(1, Math.floor(nbSemaines / 3))))}>▶</button>
            <button type="button" style={{ ...page.btnSecondaire, border: "none", textDecoration: "underline" }} onClick={() => setLundi(ajouterJours(lundiDe(aujourdhui), -7))}>Aujourd’hui</button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {(["TOUS", "CBE", "DBE", "PE", "PI"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={filtreType === t} style={bouton(filtreType === t)} onClick={() => setFiltreType(t)}>
                {t === "TOUS" ? "Tout" : t}
              </button>
            ))}
            <span style={{ width: 8 }} />
            {[2, 4, 8, 12, 26, 52].map((n) => (
              <button key={n} type="button" aria-pressed={nbSemaines === n} style={bouton(nbSemaines === n)} onClick={() => setNbSemaines(n)}>
                {n === 52 ? "1 an" : `${n} sem.`}
              </button>
            ))}
            <button type="button" style={bouton(false)} onClick={() => setOuvertes(ouvertes.size > 0 ? new Set() : new Set(lignes.map((a) => a.id)))}>
              {ouvertes.size > 0 ? "Tout replier" : "Tout déplier"}
            </button>
          </div>
        </div>

        {/* Présence : d'autres personnes ont le planning ouvert */}
        {!chargement && totalResteAPlanifier.n > 0 && (
          <Message genre="info">
            <strong>Reste à planifier sur les forfaits en cours : {formatHeures(totalResteAPlanifier.h)}</strong> ({totalResteAPlanifier.n} commande
            {totalResteAPlanifier.n > 1 ? "s" : ""}) — chiffré, moins ce qui est déjà pointé, moins ce qui est déjà planifié à venir. Le détail est dans
            la colonne de droite de chaque affaire.
          </Message>
        )}

        {peutAgir && autres.some((a) => a.modifie) && (
          <Message genre="info">
            ⚠ <strong>{autres.filter((a) => a.modifie).map((a) => a.nom).join(", ")}</strong>{" "}
            {autres.filter((a) => a.modifie).length > 1 ? "ont" : "a"} aussi le planning ouvert en ce moment. Si vous modifiez la même barre, la dernière
            modification enregistrée l’emporte : coordonnez-vous.
          </Message>
        )}
        {modifAilleurs && (
          <Message genre="info">
            Le planning vient d’être modifié par quelqu’un d’autre.{" "}
            <button
              type="button"
              onClick={() => {
                setModifAilleurs(false);
                setRechargement((n) => n + 1);
              }}
              style={{ ...page.btnSecondaire, minHeight: 32, marginLeft: 6 }}
            >
              ↻ Actualiser
            </button>
          </Message>
        )}
        {!peutAgir && !chargement && (
          <Message genre="info">Planning en lecture seule. Les affectations sont faites par les responsables (et par l’administration pour les PE / PI).</Message>
        )}

        {blocChoisi && (
          <div style={{ position: "sticky", top: 56, zIndex: 30, marginBottom: 10 }}>
            <Message genre="info">
              Barre sélectionnée : <strong>{nomCollab(annuaire.find((c) => c.id === blocChoisi.affectation.collaborateur_id))}</strong>,{" "}
              {formatHeures(blocChoisi.heures)}. Touche <strong>Suppr</strong> pour la supprimer, double-clic pour la modifier,{" "}
              <strong>Échap</strong> pour annuler.
            </Message>
          </div>
        )}

        {chargement && <Message genre="info">Chargement du planning…</Message>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          <section onPointerDown={() => setSelection(null)} style={{ ...page.carte, padding: 12, flex: "1 1 100%", minWidth: 0 }}>
            <div style={{ minWidth: 1050 }}>
              {/* en-têtes : semaines et jours, FIXES sous la barre des mois quand on descend */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gabarit,
                  position: "sticky",
                  top: 128,
                  zIndex: 15,
                  background: "#ffffff",
                  boxShadow: "0 4px 6px -5px rgba(0,0,0,.35)",
                }}
              >
                <div style={{ gridColumn: 1, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>
                  Affaire · ressource
                </div>
                {/* les mois, au-dessus des numéros de semaine */}
                {(() => {
                  const mois: { cle: string; debut: number; nb: number }[] = [];
                  colonnes.forEach((j, i) => {
                    const cle = j.slice(0, 7);
                    const dernier = mois[mois.length - 1];
                    if (dernier && dernier.cle === cle) dernier.nb++;
                    else mois.push({ cle, debut: i, nb: 1 });
                  });
                  return mois.map((m) => (
                    <div
                      key={m.cle}
                      style={{
                        gridColumn: `${col(m.debut)} / span ${m.nb}`,
                        gridRow: 1,
                        textAlign: "center",
                        fontWeight: 800,
                        fontSize: 13,
                        padding: "4px 0",
                        color: C.rougeFonce,
                        background: "#ffffff",
                        borderLeft: "2px solid #b3b9c0",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textTransform: "capitalize",
                      }}
                    >
                      {m.nb >= 3 ? new Date(`${m.cle}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : ""}
                    </div>
                  ));
                })()}
                {semaines.map((l, w) => (
                  <div key={l} style={{ gridColumn: `${col(5 * w)} / span 5`, gridRow: 2, textAlign: "center", fontWeight: 800, padding: "4px 0", background: "#f1f2f4", borderLeft: `1px solid ${C.ligne}`, fontSize: nbSemaines > 26 ? 10 : 13, overflow: "hidden", whiteSpace: "nowrap" }}>
                    S{numeroSemaine(l)}
                  </div>
                ))}
                {colonnes.map((j, i) => (
                  <div key={j} style={{ gridColumn: col(i), gridRow: 3, textAlign: "center", padding: "3px 0", background: estFerie(j) ? "#e3e6ea" : j === aujourdhui ? "#fff4f4" : "#ffffff", borderBottom: `1px solid ${C.ligne}`, fontSize: nbSemaines > 12 ? 9 : 11, lineHeight: 1.1, color: C.gris, fontWeight: 700 }}>
                    {nbSemaines > 12 ? "" : JOURS_COURTS[jourSemaine(j) - 1]}
                    <div style={{ color: j === aujourdhui ? C.rougeFonce : C.encre }}>{nbSemaines > 12 ? "" : Number(j.slice(8))}</div>
                  </div>
                ))}
                <div style={{ gridColumn: colonnes.length + 2, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", padding: "0 8px 6px", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>
                  Pointé + planifié / chiffré
                </div>
                {focusCollab && (
                  <>
                    <div style={{ gridColumn: 1, gridRow: 4, display: "flex", alignItems: "center", gap: 6, padding: "2px 4px", fontSize: 12, fontWeight: 800, color: "#1f6feb" }}>
                      Charge de {nomCollab(annuaire.find((c) => c.id === focusCollab))}
                    </div>
                    {colonnes.map((j, i) => {
                      const e = chargeFocus.get(j);
                      const net = capacites.get(focusCollab)?.get(j)?.net ?? 0;
                      const h = e?.heures ?? 0;
                      const ratio = net > 0 ? h / net : h > 0 ? 2 : 0;
                      const couleur =
                        net <= 0 && h <= 0 ? "#eceef1" : ratio <= 0.01 ? "#dff3e3" : ratio < 0.99 ? "#fff1c4" : ratio <= 1.01 ? "#ffd8a8" : "#f7b4b4";
                      const detail = e ? [...e.affaires.entries()].map(([n, x]) => `${n} : ${formatHeures(x)}`).join("\n") : "libre";
                      return (
                        <div
                          key={`f-${j}`}
                          title={`${formatDate(j)} — ${formatHeures(h)} / ${formatHeures(net)} disponibles\n${detail}`}
                          style={{ gridColumn: col(i), gridRow: 4, height: 16, margin: "2px 1px", borderRadius: 3, background: couleur, border: ratio > 1.01 ? "1px solid #b3261e" : "1px solid transparent", boxSizing: "border-box" }}
                        />
                      );
                    })}
                  </>
                )}
              </div>

              {/* événements hors affaire : salons, formations, absences connues… */}
              <div style={{ marginTop: 8, padding: "6px 8px", background: "#eef0f3", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  aria-expanded={horsAffaireOuvert}
                  onClick={() => setHorsAffaireOuvert((v) => !v)}
                  style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: "#3b4046", minHeight: 30, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span aria-hidden="true">{horsAffaireOuvert ? "▾" : "▸"}</span>
                  Hors affaire ({evenements.length})
                  <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.gris }}>salons, formations, absences connues…</span>
                </button>
                {peutAgir && referentiel && (
                  <button
                    type="button"
                    onClick={() => setEvenement({ prefill: { debut: colonnes.includes(aujourdhui) ? aujourdhui : colonnes[0] } })}
                    style={{ marginLeft: "auto", minHeight: 30, padding: "0 10px", border: "1.5px dashed #7b8189", background: "#ffffff", borderRadius: 8, fontWeight: 700, fontSize: 13, color: "#3b4046", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    + Événement hors affaire
                  </button>
                )}
              </div>
              {horsAffaireOuvert && evenements.length === 0 && (
                <p style={{ margin: "6px 8px", fontSize: 13, color: C.gris }}>Aucun événement hors affaire sur cette période.</p>
              )}
              {horsAffaireOuvert &&
                evenements.map((ev) => (
                  <div key={ev.cle}>
                    <div style={{ borderTop: `1px solid ${C.ligne}` }} />
                    {ev.blocs.map((b, k) => (
                      <div
                        key={b.affectation.id}
                        data-ligne
                        onDoubleClick={(e) => {
                          if (!peutAgir || !referentiel || (e.target as HTMLElement).closest("button, a, [data-barre]")) return;
                          const jour = jourSousLaSouris(e.currentTarget as HTMLElement, e.clientX);
                          if (jour) setEvenement({ prefill: { debut: jour } });
                        }}
                        style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "36px", borderTop: k > 0 ? `1px dashed ${C.ligne}` : "none", position: "relative" }}
                      >
                        <div style={{ gridColumn: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 6px 0 12px", lineHeight: 1.2, minWidth: 0 }}>
                          {k === 0 ? (
                            <strong style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ev.libelle}
                              {ev.code && <span style={{ fontWeight: 600, color: C.gris }}> · {ev.code}</span>}
                            </strong>
                          ) : null}
                          <span style={{ fontSize: 12, color: "#3b4046" }}>
                            {nomCollab(annuaire.find((c) => c.id === b.affectation.collaborateur_id))} · {formatHeures(b.heures)}
                          </span>
                        </div>
                        {fonds()}
                        {rendreBloc(b, null)}
                        <div style={{ gridColumn: colonnes.length + 2, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 12, fontWeight: 700 }}>
                          {formatDate(b.jours[0].jour)} → {formatDate(b.jours[b.jours.length - 1].jour)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

              {lignes.length === 0 && !chargement && (
                <p style={{ color: C.gris, padding: "16px 4px" }}>
                  Aucune affaire en cours ou en attente au planning. Mettez-en au planning depuis le portefeuille (« + Planifier »).
                </p>
              )}

              {lignes.map((affaire, indexLigne) => {
                const groupe = rangGroupe(affaire);
                const premierDuGroupe = indexLigne === 0 || rangGroupe(lignes[indexLigne - 1]) !== groupe;
                return rendreAffaire(affaire, premierDuGroupe ? TITRES_GROUPES[groupe] : null, indexLigne === 0);
              })}

              {/* affaires livrées restées au planning */}
              {lignesLivrees.length > 0 && (
                <div style={{ marginTop: 18, borderTop: `2px solid ${C.ligne}`, paddingTop: 6 }}>
                  <button
                    type="button"
                    aria-expanded={livreesOuvertes}
                    onClick={() => setLivreesOuvertes((v) => !v)}
                    style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 8px", fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: "#3b4046" }}
                  >
                    <span aria-hidden="true">{livreesOuvertes ? "▾" : "▸"}</span>
                    Affaires livrées ({lignesLivrees.length})
                    <span style={{ fontSize: 12, fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.gris }}>
                      gardées pour voir la charge programmée sur l’année
                    </span>
                  </button>
                  {livreesOuvertes && lignesLivrees.map((affaire) => rendreAffaire(affaire, null, false))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: 12, color: "#3b4046", marginTop: 12 }}>
              <span>
                Barre d’une ressource : <strong>un clic</strong> la sélectionne (<strong>Suppr</strong> la supprime) · <strong>double-clic</strong> pour la modifier ·{" "}
                <strong>glisser</strong> pour la déplacer · <strong>étirer</strong> ses bords pour la raccourcir ou l’allonger
              </span>
              <span>
                <strong>Double-clic</strong> sur une ligne vide d’une affaire : affecter quelqu’un à cette date · <strong>✓ Livrée</strong> : range l’affaire en bas
              </span>
              <span>▸ replié · ⚑ livraison souhaitée · ◆ remise d’un DBE</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "#7b8189", border: "1px solid #4b5057" }} />événement hors affaire (salon, formation, absence connue…)</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 30, height: 12, background: "linear-gradient(to right,#f0b9b9 60%,#fbeeee 60%)", border: "2px solid #c00000", boxSizing: "border-box" }} />affaire : la partie foncée est le chiffré déjà affecté (verte quand tout est affecté)</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "repeating-linear-gradient(45deg,#cfd4da,#cfd4da 4px,#eceef1 4px,#eceef1 8px)", border: "1px solid #6b6f75" }} />congé ou jour férié dans un bloc</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "#6f8fb3", border: "1px solid #34506b" }} />PE : chez le client</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "#6b58a8", border: "1px solid #4a3a85" }} />PI</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: ROUGE_HACHURE, border: "1px solid #b3261e" }} />la ressource dépasse la prestation</span>
            </div>
          </section>


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

      {evenement && referentiel && (
        <AffectationDialog
          onClose={() => setEvenement(null)}
          onSaved={(message) => {
            setEvenement(null);
            setInfo(message);
            setRechargement((n) => n + 1);
          }}
          affaires={affaires}
          annuaire={annuaire}
          referentiel={referentiel}
          imputations={imputations}
          codesDivers={codesDivers}
          affectationsConnues={affectations}
          prefill={{ onglet: "LIBRE", ...evenement.prefill }}
          edition={evenement.edition}
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
    <GardeAcces droit="voirPlanning">
      <PlanningAffairesContenu />
    </GardeAcces>
  );
}
