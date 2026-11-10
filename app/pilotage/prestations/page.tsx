"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyboardReact, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { BadgeType, C, Message, Pastille, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerActivites,
  chargerAffaires,
  chargerAnnuaire,
  chargerCapacitesAbsences,
  chargerCharges,
  chargerImputations,
  chargerMoi,
  chargerPlanifie,
  chargerTout,
  type AffaireP,
  type ReferentielActivites,
} from "@/lib/pilotageDonnees";
import { formatHeures, nomCollab, num, traduireErreur, type Charge, type Collab, type Imputation } from "@/lib/pilotageCalculs";
import { estFerie, type AbsenceRow, type Affectation, type JourRow } from "@/lib/pilotagePlanning";
import { remplirGabarit, type LigneGabarit } from "@/lib/gabaritPrestations";
import { chargerDormantes, libelleDormance, type Dormance } from "@/lib/dormantes";

/* ===============================================================
   PILOTAGE BE - PRESTATIONS PE / PI (relevé mensuel)

   Ce relevé FAIT FOI pour les PE / PI : ce qu'on y saisit alimente le
   planning (une affectation par ligne et par mois, fonction SQL
   prestation_synchroniser_planning) et consomme l'enveloppe de l'affaire.

   Mise en page : deux rangées par ligne (paramètres et totaux, puis les
   jours du mois sur toute la largeur), sans ascenseur horizontal. Chaque
   commande (base ou avenant, ex. 1604R2) est une affaire à part.

   Saisie rapide :
   - « ⤓ » remplit le mois d'une ligne avec sa base horaire (jours ouvrés,
     « CP » sur un congé validé) ; « Tout remplir » le fait pour toutes
     les lignes encore vides ;
   - cliquer-glisser (ou Maj + clic) sélectionne plusieurs jours : la
     valeur tapée puis Entrée s'applique à toute la sélection ;
   - Entrée passe au jour suivant, flèches pour se déplacer, Suppr vide.

   Un petit coin orange signale un jour où la feuille d'heures de la
   personne dit autre chose : on garde le choix (facturer au réel ou
   comme prévu), mais on le sait.

   Les PE / PI venues d'Excel apparaissent d'elles-mêmes (ligne « à
   staffer » tant qu'aucune personne n'y est affectée), avec leur n°
   d'avenant en cours ; elles disparaissent après le mois de leur livraison.

   Commande pas encore reçue (affaire en « Intention de commande ») : le
   mois est « reporté » : ses heures sont faites et planifiées, mais
   facturées plus tard. Le premier mois non reporté propose de les
   facturer (« +35 h ») : on choisit librement combien, et où les placer
   dans l'export (ajoutées à un jour, ex. 47 h le 1er, ou sur une ligne à
   part). Le bouton « ↪ » reporte n'importe quel mois.

   « Exporter » remplit le gabarit Excel (public/gabarits/prestations.xlsx)
   sans en changer la mise en forme, les formules ni le nombre de lignes.
================================================================ */

type Ligne = {
  id: string;
  affaire_id: string;
  collaborateur_id: string;
  unite: "JOUR" | "HEURE";
  taux: number | null;
  base_horaire: number;
  activite_id: string | null;
  intergroupe: boolean;
  actif: boolean;
};

type Saisie = { ligne_id: string; jour: string; heures: number | null; code: string | null };
type MoisLigne = {
  ligne_id: string;
  mois: string;
  hs_refacturer: number;
  valide: boolean;
  reporte: boolean;
  report_heures: number | null;
  report_jour: number | null;
  report_ligne_separee: boolean;
  report_sortant: number | null; // heures envoyées sur le mois suivant (report libre)
  heures_fige: number | null;
  montant_fige: number | null;
  commande_import?: number | null; // Suivi des prestations, unité de la ligne (SQL 64)
  reste_import?: number | null;
};
type SuiviLigne = { id?: string; base_affaire: string | null; base_devis: string | null; numero_affaire: string | null; genre: string; statut: string | null; rang_avenant: number | null; client_id: string | null; date_livraison: string | null; heures_total?: number | string | null; montant?: number };

/* STAFFAGE_CONTRATS : contrats cadres (MICHELIN…) : base hebdomadaire, rythme du lundi au vendredi pour les PE et les PI, tarifs nommés */
type TarifContrat = { nom: string; montant: number | null; unite: "HEURE" | "JOUR" | "SEMAINE" };
type Contrat = { id: string; client_motif: string; libelle: string; base_hebdo: number; rythme_pe: number[]; rythme_pi: number[]; tarifs: TarifContrat[]; actif: boolean };
const normTexte = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const JOURS_SEMAINE = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven."];
const contratVide = (motif = ""): Contrat => ({
  id: "",
  client_motif: motif,
  libelle: motif ? `Contrat cadre ${motif}` : "Contrat cadre",
  base_hebdo: 37.5,
  rythme_pe: [7.5, 7.5, 7.5, 7.5, 7.5],
  rythme_pi: [8, 8, 8, 8, 5.5],
  tarifs: ["Etude", "Mise en plan", "Faisabilité", "AMO", "Calcul"].map((nom) => ({ nom, montant: null, unite: "SEMAINE" as const })),
  actif: true,
});
/* taux d'une ligne (dans son unité) d'après un tarif du contrat */
const tauxDepuisTarif = (k: Contrat, t: TarifContrat, unite: "JOUR" | "HEURE", base: number) => {
  if (t.montant === null || !Number.isFinite(t.montant)) return null;
  const parHeure = t.unite === "SEMAINE" ? t.montant / (k.base_hebdo || 37.5) : t.unite === "JOUR" ? t.montant / ((k.base_hebdo || 37.5) / 5) : t.montant;
  return Math.round((unite === "JOUR" ? parHeure * base : parHeure) * 100) / 100;
};

const LETTRES = ["D", "L", "M", "M", "J", "V", "S"];
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (a: number, m: number, j: number) => `${a}-${pad(m)}-${pad(j)}`;
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const nb = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const sansZeros = (n: string) => String(n ?? "").replace(/^0+/, "");
const texteHeures = (h: number) => String(Math.round(h * 100) / 100).replace(".", ",");
const numeroBase = (n: string) => n.match(/^\d+/)?.[0] ?? n; // 1604R2 -> 1604

function moisDepuisUrl(): string {
  if (typeof window !== "undefined") {
    const m = new URLSearchParams(window.location.search).get("mois");
    if (m && /^\d{4}-\d{2}/.test(m)) return `${m.slice(0, 7)}-01`;
  }
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, 1);
}

function decalerMois(mois: string, n: number): string {
  const d = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)) - 1 + n, 1));
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function joursDuMois(mois: string) {
  const a = Number(mois.slice(0, 4));
  const m = Number(mois.slice(5, 7));
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const date = iso(a, m, i + 1);
    const js = new Date(Date.UTC(a, m - 1, i + 1)).getUTCDay();
    return { date, jour: i + 1, js, weekend: js === 0 || js === 6, ferie: estFerie(date) };
  });
}

/* Texte tapé -> saisie (null = case vidée) */
function lireValeur(texte: string): { heures: number | null; code: string | null } | null {
  const t = texte.trim().replace(",", ".");
  if (t === "") return null;
  if (/^\d+(\.\d+)?$/.test(t)) return { heures: Math.min(744, Number(t)), code: null };
  // CP_FACTURE : « 7 CP » (ou « CP 7 ») = absent, mais facturé quand même ; pas reporté au planning
  const avecCode = t.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]{1,6})\.?$/) ?? t.match(/^([A-Za-z]{1,6})\.?\s*(\d+(?:\.\d+)?)$/); // ABS_FACTURE
  if (avecCode) {
    const [x, y] = /^\d/.test(avecCode[1]) ? [avecCode[1], avecCode[2]] : [avecCode[2], avecCode[1]];
    // SAISIE_7A : « 7A » (ou 7 Abs.) = absent, facturé quand même
    const code = y.toUpperCase().slice(0, 6);
    return { heures: Math.min(744, Number(x)), code: ["A", "AB", "ABS"].includes(code) ? "ABS" : code };
  }
  return { heures: null, code: t.toUpperCase().slice(0, 6) };
}

function PrestationsContenu() {
  const [mois, setMois] = useState(moisDepuisUrl);
  const [peutAgir, setPeutAgir] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rechargement, setRechargement] = useState(0);
  /* PRESENCE_RELEVE : qui d'autre a le relevé ouvert, et modification faite ailleurs */
  const [moiId, setMoiId] = useState<string | null>(null);
  const [autres, setAutres] = useState<{ id: string; nom: string }[]>([]);
  const [modifAilleurs, setModifAilleurs] = useState(false);
  const derniereAction = useRef(0);

  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [referentiel, setReferentiel] = useState<ReferentielActivites | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [planifie, setPlanifie] = useState<{ affectations: Affectation[]; jours: JourRow[] }>({ affectations: [], jours: [] });
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [saisies, setSaisies] = useState<Saisie[]>([]);
  const [consoAvant, setConsoAvant] = useState<Map<string, number>>(new Map());
  // heures saisies des mois précédents, par ligne et par mois (« ligne|AAAA-MM »), et leurs réglages
  const [heuresMoisPasses, setHeuresMoisPasses] = useState<Map<string, number>>(new Map());
  const [moisPasses, setMoisPasses] = useState<Map<string, MoisLigne>>(new Map());
  const [moisLignes, setMoisLignes] = useState<Map<string, MoisLigne>>(new Map());
  const [reel, setReel] = useState<Map<string, number>>(new Map()); // « collab|numero|jour » -> heures des feuilles
  const [suivi, setSuivi] = useState<{ lignes: SuiviLigne[]; clients: Map<string, string> }>({ lignes: [], clients: new Map() });

  const [selection, setSelection] = useState<{ ligne: string; jours: Set<string> } | null>(null);
  const ancre = useRef<{ ligne: string; jour: string } | null>(null);
  const glisse = useRef(false);
  const champs = useRef(new Map<string, HTMLInputElement>());
  const minuteurs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const [ajout, setAjout] = useState<{ affaire_id: string; collaborateur_id: string } | null>(null);
  // recherche : client, affaire (désignation), n° (CBE, avenant, DBE), trigramme ou nom
  const [recherche, setRecherche] = useState("");
  /* RELEVE_FILTRE_AFFAIRE : ouvert depuis une autre page (?affaire=1604R2) : le relevé est filtré sur cette commande */
  useEffect(() => {
    const cible = new URLSearchParams(window.location.search).get("affaire");
    if (cible) setRecherche(cible.replace(/^CBE/i, ""));
  }, []);
  const [editeurReport, setEditeurReport] = useState<null | { ligne: Ligne; heures: string; jour: string; separee: boolean }>(null);
  const [enCours, setEnCours] = useState("");
  /* DECALER_JOUR : heures retirées d'une ligne (jour vidé, remplacé par CP…), qu'on propose de décaler à la fin */
  const [decalage, setDecalage] = useState<null | { ligne: Ligne; heures: number; dates: string[] }>(null);
  // lignes dont les réglages (⚙) sont ouverts
  const [details, setDetails] = useState<Set<string>>(new Set());
  /* FICHE_COMMANDE : réglages de vente de chaque commande (SQL 65), consommé des mois passés par ligne,
     commande dont la fiche est ouverte */
  const [reglages, setReglages] = useState<Map<string, { unite: "JOUR" | "HEURE" | null; base: number | null }>>(new Map());
  const [consoLigneAvant, setConsoLigneAvant] = useState<Map<string, number>>(new Map());
  const [fiche, setFiche] = useState<string | null>(null);
  /* FICHE_FAMILLE : dates de chaque commande de la famille (base et avenants), lues dans la copie du Suivi d'affaire */
  const [datesCommandes, setDatesCommandes] = useState<Map<string, { statut: string | null; ouverture: string | null; reception: string | null; livraison: string | null }>>(new Map());
  useEffect(() => {
    if (!fiche) return;
    let actif = true;
    void chargerTout<{ numero_affaire: string | null; statut: string | null; date_ouverture: string | null; date_reception_commande: string | null; date_livraison: string | null }>((a, b) =>
      supabase
        .from("suivi_lignes")
        .select("numero_affaire,statut,date_ouverture,date_reception_commande,date_livraison")
        .in("genre", ["BASE", "AVENANT"])
        .not("numero_affaire", "is", null)
        .order("cle")
        .range(a, b)
    ).then((l) => {
      if (!actif) return;
      setDatesCommandes(
        new Map(
          l.map((x) => [
            String(x.numero_affaire).toUpperCase().replace(/^\s*CBE\s*[-:]?\s*/, "").replace(/^0+/, ""),
            { statut: x.statut, ouverture: x.date_ouverture, reception: x.date_reception_commande, livraison: x.date_livraison },
          ])
        )
      );
    });
    return () => {
      actif = false;
    };
  }, [fiche]);
  /* PLANIFIE_FUTUR : heures déjà saisies après le mois affiché (planifiées) et dernier jour saisi avant lui, par ligne */
  const [planif, setPlanif] = useState<{ futur: Map<string, { heures: number; dernier: string; fait: number }>; avant: Map<string, string> }>({ futur: new Map(), avant: new Map() });
  /* AVENANTS_IGNORES : commandes qu'on ne veut plus voir dans « Avenant à prévoir » (retenu sur ce poste) */
  const [avenantsIgnores, setAvenantsIgnores] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setAvenantsIgnores(new Set(JSON.parse(localStorage.getItem("polynov_avenants_ignores") ?? "[]") as string[]));
    } catch {
      /* rien de retenu */
    }
  }, []);
  const ignorerAvenants = (ids: string[] | null) =>
    setAvenantsIgnores((s) => {
      const n = ids === null ? new Set<string>() : new Set([...s, ...ids]);
      try {
        localStorage.setItem("polynov_avenants_ignores", JSON.stringify([...n]));
      } catch {
        /* stockage indisponible */
      }
      return n;
    });
  /* DORMANTES_RELEVE : PE / PI en cours sans activité depuis 3 mois, rangées à part ; « reprendre » les remet dans le relevé */
  const [dormantes, setDormantes] = useState<Map<string, Dormance>>(new Map());
  /* ACTIVITE_PAR_DEFAUT : activité principale de chaque personne (fiche Collaborateurs), pour une ligne qui n'en a pas */
  const [predo, setPredo] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void supabase
      .from("collaborateurs_predominances")
      .select("collaborateur_id,activite_id")
      .eq("niveau", "PRINCIPALE")
      .then(({ data }) => setPredo(new Map(((data ?? []) as { collaborateur_id: string; activite_id: string }[]).map((x) => [x.collaborateur_id, x.activite_id]))));
  }, []);
  const [reveillees, setReveillees] = useState<Set<string>>(new Set());
  /* STAFFAGE_CONTRATS : contrats cadres, fenêtre de staffage */
  const [contrats, setContrats] = useState<Contrat[]>([]);
  const [contratsOuverts, setContratsOuverts] = useState(false);
  const [brouillonContrats, setBrouillonContrats] = useState<Contrat[]>([]);
  const chargerContrats = useCallback(async () => {
    const { data, error } = await supabase.from("prestation_contrats").select("*").order("client_motif");
    if (error) return; // script SQL 90 pas encore installé
    setContrats(
      ((data ?? []) as Contrat[]).map((k) => ({
        ...k,
        base_hebdo: Number(k.base_hebdo) || 37.5,
        rythme_pe: (k.rythme_pe ?? []).map(Number),
        rythme_pi: (k.rythme_pi ?? []).map(Number),
        tarifs: Array.isArray(k.tarifs) ? k.tarifs : [],
      }))
    );
  }, []);
  useEffect(() => {
    void chargerContrats();
  }, [chargerContrats]);
  const [staffage, setStaffage] = useState<null | {
    affaire: AffaireP;
    personne: string;
    unite: "JOUR" | "HEURE";
    base: string;
    taux: string;
    tarif: string;
    depart: string;
    dejaH: number;
    personneSource: string | null;
    rythme: string[];
    remplir: boolean;
    source: string | null;
    enCours: boolean;
  }>(null);
  /* STAFFAGE_V2 : absences de la personne choisie (18 mois à partir du départ), pour la date de fin */
  const [absStaffage, setAbsStaffage] = useState<AbsenceRow[]>([]);
  useEffect(() => {
    if (!staffage?.personne || !staffage.depart) {
      setAbsStaffage([]);
      return;
    }
    let actif = true;
    const qui = staffage.personne;
    const d = new Date(`${staffage.depart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 18);
    void chargerCapacitesAbsences(staffage.depart, d.toISOString().slice(0, 10))
      .then((c) => {
        if (actif) setAbsStaffage(c.absences.filter((x) => x.collaborateur_id === qui));
      })
      .catch(() => {
        if (actif) setAbsStaffage([]);
      });
    return () => {
      actif = false;
    };
  }, [staffage?.personne, staffage?.depart]);

  const jours = useMemo(() => joursDuMois(mois), [mois]);
  const debut = jours[0].date;
  const fin = jours[jours.length - 1].date;

  useEffect(() => {
    window.history.replaceState(null, "", `?mois=${mois.slice(0, 7)}`);
    setSelection(null);
  }, [mois]);

  useEffect(() => {
    const fin = () => (glisse.current = false);
    window.addEventListener("mouseup", fin);
    return () => window.removeEventListener("mouseup", fin);
  }, []);

  /* PRESENCE_RELEVE : nos propres enregistrements suivent un clic ou une touche ; ceux qui arrivent sans
     action de notre part depuis 5 s viennent d'un collègue */
  useEffect(() => {
    const action = () => (derniereAction.current = Date.now());
    window.addEventListener("keydown", action, true);
    window.addEventListener("mousedown", action, true);
    return () => {
      window.removeEventListener("keydown", action, true);
      window.removeEventListener("mousedown", action, true);
    };
  }, []);
  const nomMoiReleve = annuaire.find((c) => c.id === moiId);
  useEffect(() => {
    if (!moiId) return;
    const canal = supabase.channel("releve-pepi", { config: { presence: { key: moiId } } });
    const ailleurs = () => {
      if (Date.now() - derniereAction.current > 5000) setModifAilleurs(true);
    };
    canal
      .on("presence", { event: "sync" }, () => {
        const etat = canal.presenceState() as Record<string, { id: string; nom: string }[]>;
        const liste = Object.values(etat)
          .flat()
          .filter((p) => p.id !== moiId);
        setAutres([...new Map(liste.map((p) => [p.id, p])).values()]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "prestation_saisies" }, ailleurs)
      .on("postgres_changes", { event: "*", schema: "public", table: "prestation_mois" }, ailleurs)
      .subscribe(async (statut) => {
        if (statut === "SUBSCRIBED") await canal.track({ id: moiId, nom: nomMoiReleve ? nomCollab(nomMoiReleve) : "Quelqu’un" });
      });
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [moiId, nomMoiReleve]);

  /* ------------------------------ chargement ------------------------------ */

  useEffect(() => {
    let actif = true;
    setChargement(true);
    setErreur("");

    (async () => {
      try {
        const [moi, af, im, an, ref, ch, pl, cap, re] = await Promise.all([
          chargerMoi(),
          chargerAffaires({ horsPlanning: true }),
          chargerImputations(),
          chargerAnnuaire(),
          chargerActivites(),
          chargerCharges(),
          chargerPlanifie(debut),
          chargerCapacitesAbsences(debut, fin),
          supabase.rpc("prestation_realise_jours", { p_debut: debut, p_fin: fin }),
        ]);
        if (!actif) return;

        const estPrestation = (a: AffaireP) => {
          const i = im.find((x) => x.code === a.imputation);
          return i ? i.charge_obligatoire === false : a.imputation === "PE" || a.imputation === "PI";
        };
        const affPrest = af.filter((a) => estPrestation(a) && a.statut !== "ABANDONNEE");
        const ids = new Set(affPrest.map((a) => a.id));

        const lireLignes = () => chargerTout<Ligne>((a, b) => supabase.from("prestation_lignes").select("*").order("id").range(a, b));
        let lg = await lireLignes();

        // Première utilisation : une ligne pour chaque personne déjà affectée à une PE / PI ce mois-ci
        const joursMois = pl.jours.filter((j) => j.jour >= debut && j.jour <= fin && num(j.heures) > 0);
        const actives = new Set(joursMois.map((j) => j.affectation_id));
        const manquantes = new Map<string, { affaire_id: string; collaborateur_id: string; activite_id: string | null }>();
        for (const a of pl.affectations) {
          if (!a.affaire_id || !ids.has(a.affaire_id) || !actives.has(a.id)) continue;
          if (lg.some((l) => l.affaire_id === a.affaire_id && l.collaborateur_id === a.collaborateur_id)) continue;
          manquantes.set(`${a.affaire_id}|${a.collaborateur_id}`, { affaire_id: a.affaire_id, collaborateur_id: a.collaborateur_id, activite_id: a.activite_id });
        }
        if (moi?.peutModifier && manquantes.size > 0) {
          const { error } = await supabase.from("prestation_lignes").upsert([...manquantes.values()], { onConflict: "affaire_id,collaborateur_id", ignoreDuplicates: true });
          if (!error) lg = await lireLignes();
        }

        const [sm, sa, mo, sl, sc] = await Promise.all([
          chargerTout<Saisie>((a, b) => supabase.from("prestation_saisies").select("ligne_id,jour,heures,code").gte("jour", debut).lte("jour", fin).order("jour").range(a, b)),
          chargerTout<Saisie>((a, b) => supabase.from("prestation_saisies").select("ligne_id,jour,heures,code").lt("jour", debut).order("jour").range(a, b)),
          supabase.from("prestation_mois").select("ligne_id,mois,hs_refacturer,valide,reporte,report_heures,report_jour,report_ligne_separee,report_sortant,heures_fige,montant_fige,commande_import,reste_import").lte("mois", debut),
          chargerTout<SuiviLigne>((a, b) =>
            supabase.from("suivi_lignes").select("id,base_affaire,base_devis,numero_affaire,genre,statut,rang_avenant,client_id,date_livraison,heures_total").in("genre", ["BASE", "AVENANT"]).order("cle").range(a, b)
          ).catch(() => [] as SuiviLigne[]),
          chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)).catch(() => []),
        ]);
        if (!actif) return;

        const fu = await chargerTout<Saisie>((a, b) =>
          supabase.from("prestation_saisies").select("ligne_id,jour,heures,code").gt("jour", fin).order("jour").range(a, b)
        );
        if (!actif) return;
        // FICHE_AU_JOUR : dans ce qui est saisi après le mois affiché, la part déjà faite (jusqu'à aujourd'hui)
        const jourAuj = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();
        const futur = new Map<string, { heures: number; dernier: string; fait: number }>();
        for (const s of fu) {
          const h = Number(s.heures) || 0;
          if (h <= 0) continue;
          const v = futur.get(s.ligne_id) ?? { heures: 0, dernier: "", fait: 0 };
          v.heures += h;
          if (s.jour <= jourAuj) v.fait += h;
          if (s.jour > v.dernier) v.dernier = s.jour;
          futur.set(s.ligne_id, v);
        }
        const dernierAvant = new Map<string, string>();
        for (const s of sa) if ((Number(s.heures) || 0) > 0 && s.jour > (dernierAvant.get(s.ligne_id) ?? "")) dernierAvant.set(s.ligne_id, s.jour);
        setPlanif({ futur, avant: dernierAvant });

        const affaireDe = new Map(lg.map((l) => [l.id, l.affaire_id]));
        const avant = new Map<string, number>();
        const parLigneMois = new Map<string, number>();
        for (const s of sa) {
          const x = affaireDe.get(s.ligne_id);
          if (x) avant.set(x, (avant.get(x) ?? 0) + (Number(s.heures) || 0));
          const k = `${s.ligne_id}|${s.jour.slice(0, 7)}`;
          parLigneMois.set(k, (parLigneMois.get(k) ?? 0) + (Number(s.heures) || 0));
        }
        const tousMois = ((mo.data ?? []) as MoisLigne[]).map((x) => ({
          ...x,
          hs_refacturer: Number(x.hs_refacturer) || 0,
          heures_fige: nb(x.heures_fige),
          montant_fige: nb(x.montant_fige),
          reporte: Boolean(x.reporte),
          report_heures: nb(x.report_heures),
          report_jour: nb(x.report_jour),
          report_ligne_separee: Boolean(x.report_ligne_separee),
          report_sortant: nb(x.report_sortant),
          commande_import: nb(x.commande_import),
          reste_import: nb(x.reste_import),
        }));

        const r = new Map<string, number>();
        for (const x of ((re.data ?? []) as { collaborateur_id: string; type_affaire: string; numero: string; jour: string; heures: number | string }[])) {
          const k = `${x.collaborateur_id}|${x.type_affaire}|${sansZeros(x.numero)}|${x.jour}`;
          r.set(k, (r.get(k) ?? 0) + (Number(x.heures) || 0));
        }

        setPeutAgir(Boolean(moi?.peutModifier));
        setMoiId(moi?.id ?? null);
        setAffaires(affPrest);
        setImputations(im);
        setAnnuaire(an);
        setReferentiel(ref);
        setCharges(ch);
        setPlanifie({ affectations: pl.affectations, jours: joursMois });
        setAbsences(cap.absences);
        // une affaire livrée reste visible jusqu'au mois de sa livraison
        const visible = (id: string) => {
          const a = affPrest.find((x) => x.id === id);
          if (!a) return false;
          if (a.statut !== "LIVREE") return true;
          return (a.date_livraison ?? "9999-12-31") >= debut;
        };
        setLignes(lg.filter((l) => ids.has(l.affaire_id) && visible(l.affaire_id)));
        setSaisies(sm.map((s) => ({ ...s, heures: nb(s.heures) })));
        setConsoAvant(avant);
        setMoisLignes(new Map(tousMois.filter((x) => x.mois.slice(0, 10) === debut).map((x) => [x.ligne_id, x])));
        setMoisPasses(new Map(tousMois.filter((x) => x.mois.slice(0, 10) < debut).map((x) => [`${x.ligne_id}|${x.mois.slice(0, 7)}`, x])));
        setHeuresMoisPasses(parLigneMois);
        const parLigne = new Map<string, number>();
        for (const [k, h] of parLigneMois) parLigne.set(k.split("|")[0], (parLigne.get(k.split("|")[0]) ?? 0) + h);
        setConsoLigneAvant(parLigne);
        setReel(r);
        // FICHE_COMMANDE : montant de chaque commande (Suivi d'affaire) et réglages de vente (SQL 65)
        const [mts, reg] = await Promise.all([
          chargerTout<{ ligne_id: string; montant: number | string | null }>((a, b) =>
            supabase.from("suivi_lignes_montants").select("ligne_id,montant").order("ligne_id").range(a, b)
          ).catch(() => [] as { ligne_id: string; montant: number | string | null }[]),
          supabase.from("pilotage_affaires").select("id,releve_unite,releve_base_horaire").in("id", [...ids]),
        ]);
        if (!actif) return;
        const montantParLigne = new Map(mts.map((m) => [m.ligne_id, Number(m.montant) || 0]));
        setSuivi({
          lignes: sl.map((x) => ({ ...x, montant: x.id ? montantParLigne.get(x.id) ?? 0 : 0 })),
          clients: new Map(sc.map((c) => [c.id, c.nom_abrege])),
        });
        setReglages(
          new Map(
            ((reg.data ?? []) as { id: string; releve_unite: string | null; releve_base_horaire: number | string | null }[]).map((x) => [
              x.id,
              { unite: x.releve_unite === "JOUR" || x.releve_unite === "HEURE" ? x.releve_unite : null, base: nb(x.releve_base_horaire) },
            ])
          )
        );
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger les prestations.");
      } finally {
        if (actif) setChargement(false);
      }
    })();

    return () => {
      actif = false;
    };
  }, [debut, fin, rechargement]);

  /* ------------------------------ données dérivées ------------------------------ */

  useEffect(() => {
    if (affaires.length === 0) return;
    void chargerDormantes(affaires).then(setDormantes);
  }, [affaires]);
  const dort = useCallback((affaireId: string) => dormantes.has(affaireId) && !reveillees.has(affaireId), [dormantes, reveillees]);

  const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);
  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);
  const nomsActivites = useMemo(() => new Map((referentiel?.activites ?? []).map((a) => [a.id, a.nom])), [referentiel]);
  const saisieParCle = useMemo(() => new Map(saisies.map((s) => [`${s.ligne_id}|${s.jour}`, s])), [saisies]);

  const planParCle = useMemo(() => {
    const parAff = new Map(planifie.affectations.map((a) => [a.id, a]));
    const m = new Map<string, number>();
    for (const j of planifie.jours) {
      const a = parAff.get(j.affectation_id);
      if (!a?.affaire_id) continue;
      const k = `${a.affaire_id}|${a.collaborateur_id}|${j.jour}`;
      m.set(k, (m.get(k) ?? 0) + num(j.heures));
    }
    return m;
  }, [planifie]);

  const absent = useCallback(
    (collab: string, date: string) => absences.some((a) => a.collaborateur_id === collab && a.genre !== "HEURES" && a.date_debut <= date && a.date_fin >= date),
    [absences]
  );

  const reelDe = useCallback(
    (l: Ligne, date: string) => {
      const a = affairesParId.get(l.affaire_id);
      // les feuilles d'heures sont pointées sur le numéro de BASE (CBE1604), même pour un avenant
      return a ? reel.get(`${l.collaborateur_id}|${a.type}|${sansZeros(numeroBase(a.numero))}|${date}`) ?? 0 : 0;
    },
    [affairesParId, reel]
  );

  const dernierParLigne = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lignes) {
      let d = planif.avant.get(l.id) ?? "";
      for (const s of saisies) if (s.ligne_id === l.id && (s.heures ?? 0) > 0 && s.jour > d) d = s.jour;
      const f = planif.futur.get(l.id)?.dernier ?? "";
      m.set(l.id, f > d ? f : d);
    }
    return m;
  }, [lignes, saisies, planif]);
  const dernierJourLigne = (l: Ligne) => dernierParLigne.get(l.id) ?? "";

  /* Mois reporté : réglage enregistré, sinon automatique tant que la commande n'est pas reçue (intention) */
  const estReporte = useCallback(
    (l: Ligne) => {
      const ml = moisLignes.get(l.id);
      return ml ? ml.reporte : false; // REPORT_MANUEL : le report ne se fait qu'à la main
    },
    [moisLignes, affairesParId]
  );

  /* Heures des mois précédents reportés à la suite, à facturer ce mois-ci */
  const reportEntrant = useCallback(
    (l: Ligne) => {
      let total = 0;
      for (let k = 1; k <= 24; k++) {
        const m = decalerMois(mois, -k).slice(0, 7);
        const ml = moisPasses.get(`${l.id}|${m}`);
        if (ml?.reporte) {
          // mois reporté en entier : toutes ses heures, et on remonte encore
          total += heuresMoisPasses.get(`${l.id}|${m}`) ?? 0;
          continue;
        }
        // premier mois facturé : ce qu'il a envoyé sur le mois suivant (report libre)
        total += ml?.report_sortant ?? 0;
        break;
      }
      return total;
    },
    [mois, moisPasses, heuresMoisPasses]
  );

  const calcul = useCallback(
    (l: Ligne) => {
      let heures = 0;
      let heuresReel = 0;
      for (const j of jours) {
        heures += saisieParCle.get(`${l.id}|${j.date}`)?.heures ?? 0;
        heuresReel += reelDe(l, j.date);
      }
      const ml = moisLignes.get(l.id);
      const reporte = estReporte(l);
      const disponible = reporte ? 0 : reportEntrant(l); // heures des mois reportés en attente
      const entrant = reporte ? 0 : ml?.report_heures ?? disponible; // celles qu'on facture ce mois-ci
      // report libre : heures de ce mois envoyées sur le mois suivant, sous la même commande
      const sortant = reporte ? heures : Math.min(heures, Math.max(0, ml?.report_sortant ?? 0));
      const facturables = reporte ? 0 : heures - sortant + entrant;
      const hs = ml?.hs_refacturer ?? 0;
      const tauxH = l.taux === null ? null : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux;
      const montant = tauxH === null ? null : facturables * tauxH + (reporte ? 0 : hs * 1.25 * tauxH);
      return {
        heures, // heures faites et planifiées ce mois (consomment l'enveloppe)
        facturables: ml?.valide && ml.heures_fige !== null ? ml.heures_fige : facturables,
        reportEntrant: entrant,
        reportDisponible: disponible,
        sortant,
        reporte,
        heuresReel,
        hs,
        montant: ml?.valide && ml.montant_fige !== null ? ml.montant_fige : montant,
        valide: Boolean(ml?.valide),
      };
    },
    [jours, saisieParCle, reelDe, moisLignes, estReporte, reportEntrant]
  );

  const enveloppes = useMemo(() => {
    const m = new Map<string, { commande: number; avant: number; mois: number; reste: number }>();
    for (const a of affaires) {
      const chiffre = charges.filter((c) => c.affaire_id === a.id).reduce((t, c) => t + num(c.heures), 0);
      const commande = Math.max(chiffre, a.prestation_unite === "HEURES" ? num(a.prestation_quantite ?? 0) : 0);
      const avant = consoAvant.get(a.id) ?? 0;
      const ceMois = lignes.filter((l) => l.affaire_id === a.id).reduce((t, l) => t + calcul(l).heures, 0);
      m.set(a.id, { commande, avant, mois: ceMois, reste: commande - avant - ceMois });
    }
    return m;
  }, [affaires, charges, consoAvant, lignes, calcul]);

  const categorie = useCallback(
    (l: Ligne): "PE" | "PI" | "IG" => (l.intergroupe ? "IG" : affairesParId.get(l.affaire_id)?.imputation === "PE" ? "PE" : "PI"),
    [affairesParId]
  );

  const blocs = useMemo(() => {
    const titres = { PE: "Prestations externes (PE)", PI: "Prestations internes au BE (PI)", IG: "Prestations en intergroupe" } as const;
    const res: { cle: string; titre: string; categorie: "PE" | "PI" | "IG"; unite: "JOUR" | "HEURE"; lignes: Ligne[] }[] = [];
    for (const cat of ["PE", "PI", "IG"] as const)
      for (const unite of ["JOUR", "HEURE"] as const) {
        const ls = lignes
          .filter((l) => l.actif && categorie(l) === cat && l.unite === unite && !dort(l.affaire_id))
          .sort(
            (x, y) =>
              // TRI_RECENT : les commandes les plus récentes (n° le plus grand) en haut
              (affairesParId.get(y.affaire_id)?.numero ?? "").localeCompare(affairesParId.get(x.affaire_id)?.numero ?? "", "fr", { numeric: true }) ||
              nomCollab(collabs.get(x.collaborateur_id)).localeCompare(nomCollab(collabs.get(y.collaborateur_id)))
          );
        if (ls.length) res.push({ cle: `${cat}-${unite}`, titre: `${titres[cat]} — tarif ${unite === "JOUR" ? "journalier" : "horaire"}`, categorie: cat, unite, lignes: ls });
      }
    return res;
  }, [lignes, categorie, affairesParId, collabs, dort]);

  const ordreLignes = useMemo(() => blocs.flatMap((b) => b.lignes.map((l) => l.id)), [blocs]);

  /* PE / PI venues d'Excel sans personne encore : à staffer */
  const aStaffer = useMemo(
    () =>
      (() => {
        const candidates = affaires.filter(
          (a) => (a.statut === "EN_COURS" || a.statut === "EN_ATTENTE" || (a.statut === "LIVREE" && (a.date_livraison ?? "") >= debut)) && !lignes.some((l) => l.affaire_id === a.id)
        );
        // seulement les avenants (R1, R2…) quand il y en a ; sinon la commande de base
        const basesAvecAvenant = new Set(
          affaires.filter((a) => /R\d+$/i.test(a.numero) && (a.statut === "EN_COURS" || a.statut === "EN_ATTENTE")).map((a) => a.numero.match(/^\d+/)?.[0] ?? "")
        );
        return candidates
          .filter((a) => !(/^\d+$/.test(a.numero) && basesAvecAvenant.has(a.numero)))
          .filter((a) => !dort(a.id))
          .sort((x, y) => y.numero.localeCompare(x.numero, "fr", { numeric: true }));
      })(),
    [affaires, lignes, debut, dort]
  );

  async function staffer(affaireId: string, collaborateurId: string) {
    if (!collaborateurId) return;
    // la ligne prend l'unité, la base et le taux de la commande (fiche commande)
    const a = affairesParId.get(affaireId);
    const f = a ? ficheDe(a) : null;
    const vente = f ? { unite: f.unite, base_horaire: f.base, ...(f.taux !== null ? { taux: Math.round(f.taux * 100) / 100 } : {}) } : {};
    const { error } = await supabase
      .from("prestation_lignes")
      .upsert({ affaire_id: affaireId, collaborateur_id: collaborateurId, actif: true, ...vente, ...(predo.get(collaborateurId) ? { activite_id: predo.get(collaborateurId) } : {}) }, { onConflict: "affaire_id,collaborateur_id" });
    if (error) return setErreur(traduireErreur(error.message));
    setRechargement((n) => n + 1);
  }

  const totaux = useMemo(() => {
    let montant = 0;
    let heures = 0;
    const parActivite = new Map<string, number>();
    const sansActivite: string[] = [];
    for (const l of lignes.filter((x) => x.actif)) {
      const c = calcul(l);
      heures += c.facturables;
      montant += c.montant ?? 0;
      const act = l.activite_id ?? predo.get(l.collaborateur_id) ?? null;
      const k = act ? nomsActivites.get(act) ?? "Activité" : "Sans activité";
      if (!act && (c.montant ?? 0) !== 0) sansActivite.push(`${affairesParId.get(l.affaire_id)?.numero ?? "?"} ${nomCollab(collabs.get(l.collaborateur_id))}`);
      parActivite.set(k, (parActivite.get(k) ?? 0) + (c.montant ?? 0));
    }
    // TAUX_MOYEN_PEPI : montant ÷ heures (et ÷ jours) facturées, par catégorie, lignes avec un taux
    const parCategorie = new Map<string, { montant: number; heures: number; jours: number }>();
    for (const l of lignes.filter((x) => x.actif && x.taux !== null)) {
      const c = calcul(l);
      if (c.reporte || c.montant === null || c.facturables <= 0) continue;
      const k = categorie(l);
      const v = parCategorie.get(k) ?? { montant: 0, heures: 0, jours: 0 };
      v.montant += c.montant;
      v.heures += c.facturables;
      v.jours += c.facturables / l.base_horaire;
      parCategorie.set(k, v);
    }
    return { montant, heures, parActivite, parCategorie, sansActivite };
  }, [lignes, calcul, nomsActivites, categorie, predo, affairesParId, collabs]);

  const moisValide = lignes.some((l) => l.actif) && lignes.filter((l) => l.actif).every((l) => moisLignes.get(l.id)?.valide);

  /* ------------------------------ enregistrement ------------------------------ */

  /* Recopie le mois d'une ligne dans le planning (après une courte pause) */
  const programmerPlanning = useCallback(
    (ligneId: string) => {
      const ancien = minuteurs.current.get(ligneId);
      if (ancien) clearTimeout(ancien);
      minuteurs.current.set(
        ligneId,
        setTimeout(async () => {
          minuteurs.current.delete(ligneId);
          const { error } = await supabase.rpc("prestation_synchroniser_planning", { p_ligne_id: ligneId, p_mois: debut });
          if (error) setErreur(`Planning non mis à jour : ${traduireErreur(error.message)}`);
        }, 900)
      );
    },
    [debut]
  );

  async function ecrire(l: Ligne, valeurs: { jour: string; valeur: { heures: number | null; code: string | null } | null }[], proposerDecalage = true) {
    if (!peutAgir || moisLignes.get(l.id)?.valide || valeurs.length === 0) return;
    setErreur("");
    // heures retirées (jour vidé, remplacé par un code, ou diminué) : on propose de les décaler à la fin
    if (proposerDecalage) {
      let retire = 0;
      for (const v of valeurs) {
        const avant = saisieParCle.get(`${l.id}|${v.jour}`)?.heures ?? 0;
        const apres = v.valeur?.heures ?? 0;
        if (avant > apres) retire += avant - apres;
      }
      setDecalage(retire > 0.001 ? { ligne: l, heures: Math.round(retire * 100) / 100, dates: valeurs.map((v) => v.jour) } : null);
    }
    const aSupprimer = valeurs.filter((v) => v.valeur === null).map((v) => v.jour);
    const aEcrire = valeurs.filter((v) => v.valeur !== null).map((v) => ({ ligne_id: l.id, jour: v.jour, heures: v.valeur!.heures, code: v.valeur!.code }));

    // affichage immédiat
    setSaisies((liste) => {
      const jours = new Set(valeurs.map((v) => v.jour));
      return [...liste.filter((s) => !(s.ligne_id === l.id && jours.has(s.jour))), ...aEcrire];
    });

    if (aSupprimer.length) {
      const { error } = await supabase.from("prestation_saisies").delete().eq("ligne_id", l.id).in("jour", aSupprimer);
      if (error) return setErreur(traduireErreur(error.message));
    }
    if (aEcrire.length) {
      const { error } = await supabase.from("prestation_saisies").upsert(aEcrire, { onConflict: "ligne_id,jour" });
      if (error) return setErreur(traduireErreur(error.message));
    }
    programmerPlanning(l.id);
  }

  /* Remplit les jours vides du mois avec la base horaire (CP sur congé validé) */
  function remplirLigne(l: Ligne, source: "BASE" | "PLANNING" = "BASE") {
    const valeurs: { jour: string; valeur: { heures: number | null; code: string | null } }[] = [];
    for (const j of jours) {
      if (saisieParCle.has(`${l.id}|${j.date}`)) continue;
      if (source === "PLANNING") {
        const p = planParCle.get(`${l.affaire_id}|${l.collaborateur_id}|${j.date}`) ?? 0;
        if (p > 0) valeurs.push({ jour: j.date, valeur: { heures: p, code: null } });
        continue;
      }
      if (j.weekend || j.ferie) continue;
      const hj = heuresDuJour(l, j.date); // rythme du contrat cadre, sinon la base de la ligne
      if (hj <= 0) continue;
      valeurs.push({ jour: j.date, valeur: absent(l.collaborateur_id, j.date) ? { heures: null, code: "CP" } : { heures: hj, code: null } });
    }
    void ecrire(l, valeurs);
  }

  function viderLigne(l: Ligne) {
    if (!window.confirm(`Vider le mois de ${nomCollab(collabs.get(l.collaborateur_id))} sur ${affairesParId.get(l.affaire_id)?.numero ?? ""} ?`)) return;
    void ecrire(l, jours.filter((j) => saisieParCle.has(`${l.id}|${j.date}`)).map((j) => ({ jour: j.date, valeur: null })), false);
  }

  /* DECALER_JOUR : les heures retirées vont sur les jours ouvrés libres après le dernier jour rempli de la ligne
     (ni week-end, ni férié, ni congé validé), une base horaire par jour ; s'il n'y a plus de place ce mois-ci,
     sur le mois suivant, après ce qui y est déjà rempli. */
  async function decaler(d: { ligne: Ligne; heures: number; dates: string[] }) {
    const l = d.ligne;
    let reste = d.heures;
    setDecalage(null);
    const parJour = Math.max(0.5, l.base_horaire);
    const remplis = jours.filter((j) => (saisieParCle.get(`${l.id}|${j.date}`)?.heures ?? 0) > 0).map((j) => j.date);
    const apresLe = [...remplis, ...d.dates].sort().slice(-1)[0] ?? "";
    const places: string[] = [];

    const ceMois: { jour: string; valeur: { heures: number; code: null } }[] = [];
    for (const j of jours) {
      if (reste <= 0.001) break;
      if (j.date <= apresLe || j.weekend || j.ferie || absent(l.collaborateur_id, j.date) || saisieParCle.has(`${l.id}|${j.date}`)) continue;
      const h = Math.min(reste, parJour);
      ceMois.push({ jour: j.date, valeur: { heures: h, code: null } });
      places.push(`${texteHeures(h)} h le ${j.jour}`);
      reste -= h;
    }
    if (ceMois.length) await ecrire(l, ceMois, false);

    if (reste > 0.001) {
      const suivant = decalerMois(mois, 1);
      const jSuiv = joursDuMois(suivant);
      const { data, error } = await supabase
        .from("prestation_saisies")
        .select("jour")
        .eq("ligne_id", l.id)
        .gte("jour", jSuiv[0].date)
        .lte("jour", jSuiv[jSuiv.length - 1].date);
      if (error) return setErreur(traduireErreur(error.message));
      const pris = new Set(((data ?? []) as { jour: string }[]).map((x) => x.jour));
      const dernierSuiv = [...pris].sort().slice(-1)[0] ?? "";
      const aInserer: { ligne_id: string; jour: string; heures: number; code: null }[] = [];
      for (const j of jSuiv) {
        if (reste <= 0.001) break;
        if (j.date <= dernierSuiv || j.weekend || j.ferie || pris.has(j.date)) continue;
        const h = Math.min(reste, parJour);
        aInserer.push({ ligne_id: l.id, jour: j.date, heures: h, code: null });
        reste -= h;
      }
      if (aInserer.length) {
        const { error: ei } = await supabase.from("prestation_saisies").insert(aInserer);
        if (ei) return setErreur(traduireErreur(ei.message));
        const { error: ep } = await supabase.rpc("prestation_synchroniser_planning", { p_ligne_id: l.id, p_mois: suivant });
        if (ep) setErreur(`Planning du mois suivant non mis à jour : ${traduireErreur(ep.message)}`);
        places.push(`${texteHeures(aInserer.reduce((t, x) => t + x.heures, 0))} h en ${NOMS_MOIS[Number(suivant.slice(5, 7)) - 1]} (à partir du ${Number(aInserer[0].jour.slice(8))})`);
      }
    }
    setInfo(
      places.length
        ? `${formatHeures(d.heures)} décalées pour ${nomCollab(collabs.get(l.collaborateur_id))} sur ${affairesParId.get(l.affaire_id)?.numero ?? ""} : ${places.join(", ")}.`
        : "Aucun jour libre pour décaler ces heures."
    );
  }

  /* ALIGNER_FEUILLES : reprend, jour par jour, les heures pointées dans les feuilles d'heures de la personne
     (les codes d'absence saisis ne changent pas) */
  function alignerSurFeuilles(l: Ligne) {
    const valeurs: { jour: string; valeur: { heures: number | null; code: string | null } | null }[] = [];
    for (const j of jours) {
      const s = saisieParCle.get(`${l.id}|${j.date}`);
      if (s?.code) continue;
      const r = Math.round(reelDe(l, j.date) * 100) / 100;
      if (Math.abs(r - (s?.heures ?? 0)) < 0.01) continue;
      valeurs.push({ jour: j.date, valeur: r > 0 ? { heures: r, code: null } : null });
    }
    if (valeurs.length === 0) return setInfo("Cette ligne correspond déjà aux feuilles d’heures.");
    const c = calcul(l);
    if (
      !window.confirm(
        `Aligner ${affairesParId.get(l.affaire_id)?.numero ?? ""} · ${nomCollab(collabs.get(l.collaborateur_id))} sur les feuilles d’heures ?\n\n${formatHeures(c.heures)} saisies → ${formatHeures(c.heuresReel)} pointées (${valeurs.length} jour(s) modifié(s)). Les absences saisies ne changent pas.`
      )
    )
      return;
    // troisième paramètre (pas de proposition de décalage) : pris en compte s'il existe
    void (ecrire as unknown as (x: Ligne, v: typeof valeurs, p?: boolean) => Promise<void>)(l, valeurs, false);
  }

  /* PLANIFIER_RESTE : le reste non planifié de la commande, sur cette personne, une journée (base de la ligne)
     par jour ouvré à partir du lendemain du dernier jour saisi, mois suivants compris */
  async function planifierReste(l: Ligne, depart?: { jour: string; dejaH: number }, sansConfirmer = false) {
    const a = affairesParId.get(l.affaire_id);
    if (!a || !peutAgir) return;
    const f = ficheDe(a);
    if (f.reste === null || f.quantite === null) return setErreur("Commande non chiffrée : montant ou heures absents du Suivi d’affaire.");
    const parUnite = (x: Ligne) => (f.unite === "JOUR" ? x.base_horaire || f.base : 1);
    const futurU = lignes.filter((x) => x.affaire_id === a.id).reduce((t, x) => t + (planif.futur.get(x.id)?.heures ?? 0) / parUnite(x), 0);
    const resteU = f.reste - futurU;
    if (resteU <= 0.01) return setInfo(`${a.numero} : tout est déjà planifié.`);
    let resteH = Math.round(resteU * parUnite(l) * 100) / 100;
    const lendemain = (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    const dernier = dernierJourLigne(l);
    let jour = depart?.jour ?? (dernier && dernier >= debut ? lendemain(dernier) : debut);
    const parJour = Math.max(0.5, l.base_horaire);
    const ajouts: { jour: string; heures: number }[] = [];
    for (let garde = 0; resteH > 0.001 && garde < 800; garde++, jour = lendemain(jour)) {
      const js = new Date(`${jour}T00:00:00Z`).getUTCDay();
      if (js === 0 || js === 6 || estFerie(jour) || absent(l.collaborateur_id, jour)) continue;
      const cap = heuresDuJour(l, jour) - (depart && jour === depart.jour ? depart.dejaH : 0);
      if (cap <= 0.01) continue;
      const h = Math.min(resteH, cap);
      ajouts.push({ jour, heures: Math.round(h * 100) / 100 });
      resteH -= h;
    }
    if (ajouts.length === 0) return;
    const fr = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR");
    const u = f.unite === "JOUR" ? "j" : "h";
    if (
      !sansConfirmer &&
      !window.confirm(
        `Planifier ${texteHeures(Math.round(resteU * 100) / 100)} ${u} pour ${nomCollab(collabs.get(l.collaborateur_id))} sur ${a.numero}, du ${fr(ajouts[0].jour)} au ${fr(ajouts[ajouts.length - 1].jour)} (${ajouts.length} jour(s) ouvré(s)) ?`
      )
    )
      return;
    const ceMois = ajouts.filter((x) => x.jour >= debut && x.jour <= fin);
    const ensuite = ajouts.filter((x) => x.jour < debut || x.jour > fin);
    if (ceMois.length) await ecrire(l, ceMois.map((x) => ({ jour: x.jour, valeur: { heures: x.heures, code: null } })), false);
    if (ensuite.length) {
      const { error } = await supabase
        .from("prestation_saisies")
        .upsert(ensuite.map((x) => ({ ligne_id: l.id, jour: x.jour, heures: x.heures, code: null })), { onConflict: "ligne_id,jour" });
      if (error) return setErreur(traduireErreur(error.message));
      for (const m of [...new Set(ensuite.map((x) => `${x.jour.slice(0, 7)}-01`))]) {
        const { error: ep } = await supabase.rpc("prestation_synchroniser_planning", { p_ligne_id: l.id, p_mois: m });
        if (ep) setErreur(`Planning non mis à jour (${m.slice(0, 7)}) : ${traduireErreur(ep.message)}`);
      }
    }
    setInfo(`${a.numero} : ${texteHeures(Math.round(resteU * 100) / 100)} ${u} planifiés jusqu’au ${fr(ajouts[ajouts.length - 1].jour)}.`);
    setRechargement((n) => n + 1);
  }

  function toutRemplir() {
    for (const l of lignes.filter((x) => x.actif && !moisLignes.get(x.id)?.valide)) {
      if (jours.some((j) => saisieParCle.has(`${l.id}|${j.date}`))) continue;
      remplirLigne(l);
    }
  }

  /* Changer la personne d'une ligne (erreur de saisie, remplacement) : ses heures, ses mois et ses
     affectations au planning suivent. */
  async function changerPersonne(l: Ligne, collaborateurId: string) {
    if (!collaborateurId || collaborateurId === l.collaborateur_id) return;
    const ancien = nomCollab(collabs.get(l.collaborateur_id));
    const nouveau = nomCollab(collabs.get(collaborateurId));
    if (lignes.some((x) => x.affaire_id === l.affaire_id && x.collaborateur_id === collaborateurId)) {
      setErreur(`${nouveau} a déjà une ligne sur cette commande : saisissez ses heures sur sa ligne, puis videz celle de ${ancien}.`);
      return;
    }
    if (!window.confirm(`Remplacer ${ancien} par ${nouveau} sur cette ligne ?\nSes heures, ses mois et son planning passent à ${nouveau}.`)) return;
    setErreur("");

    const { error } = await supabase.from("prestation_lignes").update({ collaborateur_id: collaborateurId }).eq("id", l.id);
    if (error) return setErreur(traduireErreur(error.message));

    // les affectations du planning créées par ce relevé changent aussi de personne
    const { data: mois } = await supabase.from("prestation_mois").select("affectation_id").eq("ligne_id", l.id).not("affectation_id", "is", null);
    const ids = ((mois ?? []) as { affectation_id: string }[]).map((m) => m.affectation_id);
    if (ids.length) {
      const { error: ea } = await supabase.from("pilotage_affectations").update({ collaborateur_id: collaborateurId }).in("id", ids);
      if (ea) setErreur(`Ligne modifiée, mais planning non mis à jour : ${traduireErreur(ea.message)}`);
    }
    setInfo(`${ancien} remplacé par ${nouveau}.`);
    setRechargement((n) => n + 1);
  }

  async function modifierLigne(l: Ligne, patch: Partial<Ligne>) {
    setErreur("");
    const { error } = await supabase.from("prestation_lignes").update(patch).eq("id", l.id);
    if (error) return setErreur(traduireErreur(error.message));
    setLignes((liste) => liste.map((x) => (x.id === l.id ? { ...x, ...patch } : x)));
    if ("activite_id" in patch) programmerPlanning(l.id);
  }

  async function modifierHs(l: Ligne, texte: string) {
    const hs = Number(texte.replace(",", ".")) || 0;
    const { error } = await supabase.from("prestation_mois").upsert({ ligne_id: l.id, mois: debut, hs_refacturer: hs }, { onConflict: "ligne_id,mois" });
    if (error) return setErreur(traduireErreur(error.message));
    setMoisLignes((m) => {
      const n = new Map(m);
      n.set(l.id, { ligne_id: l.id, mois: debut, valide: false, reporte: estReporte(l), report_heures: null, report_jour: null, report_ligne_separee: false, report_sortant: null, heures_fige: null, montant_fige: null, ...m.get(l.id), hs_refacturer: hs });
      return n;
    });
  }

  /* Report libre : quantité (dans l'unité de la ligne) envoyée sur le mois suivant */
  async function enregistrerSortant(l: Ligne, texte: string) {
    const v = texte.trim() === "" ? 0 : Number(texte.replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return setErreur("Report invalide.");
    const heures = Math.round((l.unite === "JOUR" ? v * l.base_horaire : v) * 100) / 100;
    const { error } = await supabase
      .from("prestation_mois")
      .upsert({ ligne_id: l.id, mois: debut, report_sortant: heures || null, reporte: false }, { onConflict: "ligne_id,mois" });
    if (error) return setErreur(traduireErreur(error.message));
    setMoisLignes((m) => {
      const n = new Map(m);
      n.set(l.id, {
        ligne_id: l.id,
        mois: debut,
        hs_refacturer: 0,
        valide: false,
        report_heures: null,
        report_jour: null,
        report_ligne_separee: false,
        heures_fige: null,
        montant_fige: null,
        ...m.get(l.id),
        reporte: false,
        report_sortant: heures || null,
      });
      return n;
    });
  }

  async function basculerReport(l: Ligne) {
    const reporte = !estReporte(l);
    const { error } = await supabase.from("prestation_mois").upsert({ ligne_id: l.id, mois: debut, reporte }, { onConflict: "ligne_id,mois" });
    if (error) return setErreur(traduireErreur(error.message));
    setMoisLignes((m) => {
      const n = new Map(m);
      n.set(l.id, { ligne_id: l.id, mois: debut, hs_refacturer: 0, valide: false, report_heures: null, report_jour: null, report_ligne_separee: false, report_sortant: null, heures_fige: null, montant_fige: null, ...m.get(l.id), reporte });
      return n;
    });
  }

  /* Premier jour ouvré du mois (pour placer les heures reportées) */
  const premierOuvre = jours.find((j) => !j.weekend && !j.ferie)?.jour ?? 1;

  function ouvrirReport(l: Ligne) {
    const ml = moisLignes.get(l.id);
    const c = calcul(l);
    setEditeurReport({
      ligne: l,
      heures: texteHeures(c.reportEntrant),
      jour: String(ml?.report_jour ?? premierOuvre),
      separee: Boolean(ml?.report_ligne_separee),
    });
  }

  async function enregistrerReport() {
    if (!editeurReport) return;
    const { ligne: l, heures, jour, separee } = editeurReport;
    const h = Number(heures.replace(",", "."));
    if (!Number.isFinite(h) || h < 0) return setErreur("Nombre d’heures reportées invalide.");
    const valeurs = { report_heures: h, report_jour: Number(jour) || premierOuvre, report_ligne_separee: separee };
    const { error } = await supabase.from("prestation_mois").upsert({ ligne_id: l.id, mois: debut, ...valeurs }, { onConflict: "ligne_id,mois" });
    if (error) return setErreur(traduireErreur(error.message));
    setMoisLignes((m) => {
      const n = new Map(m);
      n.set(l.id, {
        ligne_id: l.id,
        mois: debut,
        hs_refacturer: 0,
        valide: false,
        reporte: false,
        report_sortant: null,
        heures_fige: null,
        montant_fige: null,
        ...m.get(l.id),
        ...valeurs,
      });
      return n;
    });
    setEditeurReport(null);
  }

  async function validerMois(valider: boolean) {
    if (valider) {
      // CONTROLE_CLOTURE : ce qui cloche, avant de figer le mois
      const actives = lignes.filter((l) => l.actif);
      const nom = (l: Ligne) => `${affairesParId.get(l.affaire_id)?.numero ?? "?"} ${nomCollab(collabs.get(l.collaborateur_id))}`;
      const liste = (xs: string[]) => (xs.length > 6 ? `${xs.slice(0, 6).join(", ")}… (+${xs.length - 6})` : xs.join(", "));
      const points: string[] = [];
      const sansTaux = actives.filter((l) => l.taux === null);
      if (sansTaux.length) points.push(`${sansTaux.length} ligne(s) sans taux, montant vide : ${liste(sansTaux.map(nom))}`);
      const ecarts = actives.filter((l) => {
        const c = calcul(l);
        return Math.abs(c.heures - c.heuresReel) > 0.5;
      });
      if (ecarts.length)
        points.push(
          `${ecarts.length} ligne(s) en écart avec les feuilles d’heures : ${liste(
            ecarts.map((l) => {
              const c = calcul(l);
              return `${nom(l)} (${formatHeures(c.heures)} saisies, ${formatHeures(c.heuresReel)} pointées)`;
            })
          )}`
        );
      const intentions = actives.filter((l) => {
        const c = calcul(l);
        return affairesParId.get(l.affaire_id)?.statut === "EN_ATTENTE" && !c.reporte && c.facturables > 0;
      });
      if (intentions.length) points.push(`${intentions.length} ligne(s) facturée(s) sans commande reçue (intention) : ${liste(intentions.map(nom))}`);
      const depassees = [...new Set(actives.map((l) => l.affaire_id))]
        .map((id) => affairesParId.get(id))
        .filter((a): a is AffaireP => Boolean(a))
        .filter((a) => {
          const f = ficheDe(a);
          return f.reste !== null && f.reste < -0.01;
        });
      if (depassees.length) points.push(`${depassees.length} commande(s) dépassée(s) : ${liste(depassees.map((a) => a.numero))}`);
      const question = `Clôturer ${NOMS_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)} ? Les heures et les montants seront figés.`;
      if (!window.confirm(points.length ? `Avant de clôturer, à vérifier :\n\n• ${points.join("\n• ")}\n\n${question}` : question)) return;
    } else if (!window.confirm("Rouvrir ce mois ? Les heures et les montants pourront de nouveau changer.")) return;

    setEnCours("validation");
    const maintenant = new Date().toISOString();
    const lignesMois = lignes
      .filter((l) => l.actif)
      .map((l) => {
        const c = calcul(l);
        return {
          ligne_id: l.id,
          mois: debut,
          hs_refacturer: c.hs,
          valide: valider,
          valide_le: valider ? maintenant : null,
          reporte: c.reporte,
          heures_fige: valider ? Math.round(c.facturables * 100) / 100 : null,
          montant_fige: valider && c.montant !== null ? Math.round(c.montant * 100) / 100 : null,
        };
      });
    const { error } = await supabase.from("prestation_mois").upsert(lignesMois, { onConflict: "ligne_id,mois" });
    setEnCours("");
    if (error) return setErreur(traduireErreur(error.message));
    setInfo(valider ? "Mois validé : montants figés." : "Mois rouvert.");
    setRechargement((n) => n + 1);
  }

  /* STAFFAGE_V2 : paramétrer une PE / PI à staffer : personne, unité, base, taux (contrat cadre, ou repris de la
     commande sœur pour un avenant), rythme du lundi au vendredi, date de début (à la suite de la commande sœur),
     et date de fin calculée (jours ouvrés, fériés et absences de la personne évités) */
  async function ouvrirStaffage(a: AffaireP, personne = "") {
    const f = ficheDe(a);
    const k = contratDe(a);
    const base = numeroBase(a.numero);
    const famille = affaires.filter((x) => numeroBase(x.numero) === base && x.id !== a.id && x.numero.localeCompare(a.numero, "fr", { numeric: true }) < 0);
    let source: string | null = null;
    let modele: Ligne | null = null;
    let depart = new Date().toISOString().slice(0, 10);
    let dejaH = 0;
    if (famille.length > 0) {
      const { data } = await supabase.from("prestation_lignes").select("*").in("affaire_id", famille.map((x) => x.id));
      const ls = ((data ?? []) as Ligne[]).map((l) => ({ ...l, taux: l.taux === null ? null : Number(l.taux), base_horaire: Number(l.base_horaire) || 7 }));
      // la commande sœur la plus récente qui a des lignes : R1 pour un R2, la commande de base pour un R1
      const soeur = [...famille].sort((x, y) => y.numero.localeCompare(x.numero, "fr", { numeric: true })).find((x) => ls.some((l) => l.affaire_id === x.id));
      if (soeur) {
        const lsS = ls.filter((l) => l.affaire_id === soeur.id);
        modele = lsS.find((l) => l.collaborateur_id === personne) ?? lsS[0];
        source = soeur.numero;
        const { data: sj } = await supabase
          .from("prestation_saisies")
          .select("ligne_id,jour,heures")
          .in("ligne_id", lsS.map((l) => l.id))
          .gt("heures", 0)
          .order("jour", { ascending: false })
          .limit(40);
        const rows = (sj ?? []) as { ligne_id: string; jour: string; heures: number | string }[];
        if (rows.length > 0) {
          depart = rows[0].jour;
          dejaH = rows.filter((r) => r.jour === depart && r.ligne_id === modele?.id).reduce((s, r) => s + (Number(r.heures) || 0), 0);
        }
      }
    }
    const unite = modele?.unite ?? f.unite;
    const baseH = modele ? modele.base_horaire : k ? (k.base_hebdo || 37.5) / 5 : f.base;
    const rythmeK = k ? (a.imputation === "PE" ? k.rythme_pe : k.rythme_pi) : null;
    setStaffage({
      affaire: a,
      personne: personne || modele?.collaborateur_id || "",
      unite,
      base: String(baseH),
      taux: modele?.taux !== null && modele?.taux !== undefined ? String(modele.taux) : f.taux !== null ? String(Math.round(f.taux * 100) / 100) : "",
      tarif: "",
      depart,
      dejaH,
      personneSource: modele?.collaborateur_id ?? null,
      rythme: (rythmeK ?? [baseH, baseH, baseH, baseH, baseH]).map((x) => String(x)),
      remplir: true,
      source,
      enCours: false,
    });
  }

  /* les jours que le remplissage va saisir, et la date de fin */
  const simulerStaffage = (s: NonNullable<typeof staffage>) => {
    const f = ficheDe(s.affaire);
    const base = Number(s.base.replace(",", "."));
    const taux = s.taux.trim() === "" ? null : Number(s.taux.replace(",", "."));
    const rythme = s.rythme.map((x) => Number(String(x).replace(",", ".")) || 0);
    // quantité à planifier, en heures : le montant de la commande au taux choisi, sinon la quantité commandée
    let heures: number | null = null;
    if (f.montant > 0 && taux !== null && taux > 0 && base > 0) {
      const q = f.montant / taux;
      heures = s.unite === "JOUR" ? q * base : q;
    } else if (f.quantite !== null) heures = f.quantite * (f.unite === "JOUR" ? f.base : 1);
    const jours: { jour: string; heures: number }[] = [];
    let evites = 0;
    if (heures === null || heures <= 0 || !s.depart || rythme.every((x) => x <= 0)) return { heures, jours, fin: null as string | null, evites };
    const absentLe = (date: string) => absStaffage.some((x) => x.genre !== "HEURES" && x.date_debut <= date && x.date_fin >= date);
    const lendemain = (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };
    let reste = heures;
    let jour = s.depart;
    for (let garde = 0; reste > 0.001 && garde < 900; garde++, jour = lendemain(jour)) {
      const js = new Date(`${jour}T00:00:00Z`).getUTCDay();
      if (js === 0 || js === 6 || estFerie(jour)) continue;
      const cap = (rythme[js - 1] ?? 0) - (jour === s.depart && s.personne === s.personneSource ? s.dejaH : 0);
      if (cap <= 0.01) continue;
      if (absentLe(jour)) {
        evites++;
        continue;
      }
      const h = Math.round(Math.min(reste, cap) * 100) / 100;
      jours.push({ jour, heures: h });
      reste -= h;
    }
    return { heures, jours, fin: jours.length > 0 ? jours[jours.length - 1].jour : null, evites };
  };

  async function validerStaffage() {
    if (!staffage) return;
    const s = staffage;
    const base = Number(s.base.replace(",", "."));
    const taux = s.taux.trim() === "" ? null : Number(s.taux.replace(",", "."));
    if (!s.personne) return setErreur("Choisissez la personne.");
    if (!Number.isFinite(base) || base <= 0 || base > 12) return setErreur("Base horaire invalide : entre 0 et 12 h.");
    if (taux !== null && !Number.isFinite(taux)) return setErreur("Taux invalide.");
    const sim = simulerStaffage(s);
    setErreur("");
    setStaffage({ ...s, enCours: true });
    const { data, error } = await supabase
      .from("prestation_lignes")
      .upsert(
        { affaire_id: s.affaire.id, collaborateur_id: s.personne, actif: true, unite: s.unite, base_horaire: base, taux, ...(predo.get(s.personne) ? { activite_id: predo.get(s.personne) } : {}) },
        { onConflict: "affaire_id,collaborateur_id" }
      )
      .select("id")
      .single();
    if (error || !data) {
      setStaffage({ ...s, enCours: false });
      return setErreur(traduireErreur(error?.message ?? "Staffage impossible."));
    }
    const ligneId = (data as { id: string }).id;
    await supabase.from("pilotage_affaires").update({ releve_unite: s.unite, releve_base_horaire: base }).eq("id", s.affaire.id);
    if (s.remplir && sim.jours.length > 0) {
      const { error: es } = await supabase
        .from("prestation_saisies")
        .upsert(sim.jours.map((x) => ({ ligne_id: ligneId, jour: x.jour, heures: x.heures, code: null })), { onConflict: "ligne_id,jour" });
      if (es) setErreur(`Ligne créée, mais remplissage impossible : ${traduireErreur(es.message)}`);
      else {
        for (const m of [...new Set(sim.jours.map((x) => `${x.jour.slice(0, 7)}-01`))]) {
          const { error: ep } = await supabase.rpc("prestation_synchroniser_planning", { p_ligne_id: ligneId, p_mois: m });
          if (ep) setErreur(`Planning non mis à jour (${m.slice(0, 7)}) : ${traduireErreur(ep.message)}`);
        }
        const fr = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR");
        setInfo(`${s.affaire.numero} staffé : ${texteHeures(Math.round(sim.jours.reduce((t, x) => t + x.heures, 0) * 100) / 100)} h du ${fr(sim.jours[0].jour)} au ${fr(sim.fin ?? sim.jours[0].jour)}.`);
      }
    }
    setStaffage(null);
    setRechargement((n) => n + 1);
  }

  /* STAFFAGE_CONTRATS : enregistrer les contrats cadres */
  async function enregistrerContrats() {
    for (const k of brouillonContrats) {
      const motif = k.client_motif.trim();
      if (!motif) continue;
      const ligne = {
        client_motif: motif,
        libelle: k.libelle.trim() || `Contrat cadre ${motif}`,
        base_hebdo: Number(k.base_hebdo) || 37.5,
        rythme_pe: k.rythme_pe.map((x) => Number(x) || 0),
        rythme_pi: k.rythme_pi.map((x) => Number(x) || 0),
        tarifs: k.tarifs.filter((t) => t.nom.trim() !== "").map((t) => ({ nom: t.nom.trim(), montant: t.montant === null || !Number.isFinite(t.montant) ? null : t.montant, unite: t.unite })),
        actif: k.actif,
        modifie_le: new Date().toISOString(),
      };
      const r = k.id ? await supabase.from("prestation_contrats").update(ligne).eq("id", k.id) : await supabase.from("prestation_contrats").insert(ligne);
      if (r.error) return setErreur(/prestation_contrats/.test(r.error.message) ? "Installez d’abord le script SQL 90 (contrats cadres)." : traduireErreur(r.error.message));
    }
    await chargerContrats();
    setContratsOuverts(false);
    setInfo("Contrats cadres enregistrés.");
  }

  async function ajouterLigne() {
    if (!ajout?.affaire_id || !ajout.collaborateur_id) return;
    const { error } = await supabase.from("prestation_lignes").upsert({ ...ajout, actif: true }, { onConflict: "affaire_id,collaborateur_id" });
    if (error) return setErreur(traduireErreur(error.message));
    setAjout(null);
    setRechargement((n) => n + 1);
  }

  /* ------------------------------ saisie au clavier et à la souris ------------------------------ */

  const focaliser = (ligneId: string, date: string) => {
    const el = champs.current.get(`${ligneId}|${date}`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  function surSourisBas(l: Ligne, date: string, shift: boolean) {
    if (shift && ancre.current?.ligne === l.id) {
      const [a, b] = [ancre.current.jour, date].sort();
      setSelection({ ligne: l.id, jours: new Set(jours.filter((j) => j.date >= a && j.date <= b).map((j) => j.date)) });
      return;
    }
    ancre.current = { ligne: l.id, jour: date };
    glisse.current = true;
    setSelection({ ligne: l.id, jours: new Set([date]) });
  }

  function surSourisEntre(l: Ligne, date: string) {
    if (!glisse.current || ancre.current?.ligne !== l.id) return;
    const [a, b] = [ancre.current.jour, date].sort();
    setSelection({ ligne: l.id, jours: new Set(jours.filter((j) => j.date >= a && j.date <= b).map((j) => j.date)) });
  }

  function surTouche(e: KeyboardReact<HTMLInputElement>, l: Ligne, date: string) {
    const idx = jours.findIndex((j) => j.date === date);
    const cible = selection && selection.ligne === l.id && selection.jours.has(date) && selection.jours.size > 1 ? [...selection.jours] : [date];

    if (e.key === "Enter") {
      e.preventDefault();
      const valeur = lireValeur(e.currentTarget.value);
      void ecrire(l, cible.map((jour) => ({ jour, valeur })));
      const suivant = jours[Math.min(jours.length - 1, Math.max(...cible.map((c) => jours.findIndex((j) => j.date === c))) + 1)];
      setSelection(null);
      if (suivant) focaliser(l.id, suivant.date);
    } else if ((e.key === "Delete" || (e.key === "Backspace" && e.currentTarget.value === "")) && cible.length > 1) {
      e.preventDefault();
      void ecrire(l, cible.map((jour) => ({ jour, valeur: null })));
      setSelection(null);
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      if (jours[idx + 1]) focaliser(l.id, jours[idx + 1].date);
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) {
      if (jours[idx - 1]) focaliser(l.id, jours[idx - 1].date);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = ordreLignes.indexOf(l.id) + (e.key === "ArrowDown" ? 1 : -1);
      if (ordreLignes[i]) focaliser(ordreLignes[i], date);
    } else if (e.key === "Escape") {
      setSelection(null);
    }
  }

  /* ------------------------------ export au gabarit ------------------------------ */

  /* N° à facturer : l'avenant en cours le plus récent, sinon la commande */
  /* Chaque affaire du Pilotage est une commande : son numéro EST celui à facturer (1604, 1604R2…) */
  const numeroFacture = useCallback(
    (a: AffaireP) => {
      const ligne = suivi.lignes.find((s) => (s.numero_affaire ?? "").replace(/^CBE/i, "").toUpperCase() === a.numero.toUpperCase());
      const base = suivi.lignes.find((s) => s.genre === "BASE" && sansZeros(s.base_affaire ?? "") === sansZeros(numeroBase(a.numero)));
      const client = ligne?.client_id ?? base?.client_id ?? null;
      const devis = ligne?.base_devis ?? base?.base_devis ?? null;
      return { numero: a.numero, client: client ? suivi.clients.get(client) ?? null : null, devis };
    },
    [suivi]
  );

  /* STAFFAGE_CONTRATS : contrat cadre d'une commande (le nom du client contient le mot du contrat) et heures d'un jour selon son rythme */
  const contratDe = useCallback(
    (a: AffaireP | undefined) => {
      if (!a) return null;
      const client = normTexte(numeroFacture(a).client ?? "");
      if (!client) return null;
      return contrats.find((k) => k.actif && k.client_motif.trim() !== "" && client.includes(normTexte(k.client_motif.trim()))) ?? null;
    },
    [contrats, numeroFacture]
  );
  const heuresDuJour = (l: Pick<Ligne, "affaire_id" | "base_horaire">, date: string) => {
    const a = affairesParId.get(l.affaire_id);
    const k = contratDe(a);
    if (!k) return l.base_horaire;
    const js = new Date(`${date}T00:00:00Z`).getUTCDay();
    const r = a?.imputation === "PE" ? k.rythme_pe : k.rythme_pi;
    return js >= 1 && js <= 5 ? Number(r[js - 1]) || 0 : 0;
  };

  /* FICHE_COMMANDE : ce que prévoit la commande (Suivi d'affaire : montant et total d'heures), sa vente
     (unité, base, taux = montant ÷ quantité) et où on en est (consommé : heures saisies au relevé, tous
     mois et toutes personnes confondus ; en euros, au taux de chaque ligne). */
  const ficheDe = useCallback(
    (a: AffaireP) => {
      const sl = suivi.lignes.find((s) => (s.numero_affaire ?? "").replace(/^CBE/i, "").toUpperCase() === a.numero.toUpperCase());
      const lignesCmd = lignes.filter((l) => l.affaire_id === a.id);
      const reg = reglages.get(a.id);
      const unite: "JOUR" | "HEURE" = reg?.unite ?? lignesCmd[0]?.unite ?? (a.imputation === "PE" ? "JOUR" : "HEURE");
      const base = reg?.base ?? lignesCmd[0]?.base_horaire ?? 7;
      const montant = sl?.montant ?? 0;
      const heuresCmd = Number(sl?.heures_total) || 0;
      const k = unite === "JOUR" ? base : 1;
      const quantiteHeures = heuresCmd > 0 ? heuresCmd / k : null;
      // FICHE_COMMANDE_V3 : la commande est un MONTANT ; quantité = montant ÷ taux des lignes (décimales comprises)
      const premiere = lignesCmd.find((l) => l.taux !== null);
      const tauxLignes =
        premiere && premiere.taux !== null
          ? premiere.unite === unite
            ? premiere.taux
            : premiere.unite === "JOUR"
              ? premiere.taux / premiere.base_horaire
              : premiere.taux * premiere.base_horaire
          : null;
      const taux = tauxLignes ?? (quantiteHeures && montant > 0 ? montant / quantiteHeures : null);
      const quantite = montant > 0 && taux ? montant / taux : quantiteHeures;
      // FICHE_COMMANDE_V2 : consommé dans l'unité de la commande, avec la base de chaque ligne
      let consoH = 0;
      let consoU = 0;
      let consoE = 0;
      let sansTaux = false;
      const personnes = lignesCmd.map((l) => {
        const h = (consoLigneAvant.get(l.id) ?? 0) + calcul(l).heures;
        const tauxH = l.taux === null ? null : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux;
        consoH += h;
        consoU += unite === "JOUR" ? h / (l.base_horaire || base) : h;
        if (tauxH === null) sansTaux = true;
        else consoE += h * tauxH;
        // taux de la ligne ramené dans l'unité de la commande, pour le comparer
        const tauxUnite = l.taux === null ? null : l.unite === unite ? l.taux : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux * base;
        return { ligne: l, heures: h, propre: taux !== null && tauxUnite !== null && Math.abs(tauxUnite - taux) / taux > 0.01 };
      });
      return {
        montant,
        heuresCmd,
        unite,
        base,
        quantite,
        taux,
        consomme: montant > 0 && taux ? consoE / taux : consoH / k,
        consoE,
        reste: quantite === null ? null : quantite - (montant > 0 && taux ? consoE / taux : consoH / k),
        resteE: montant > 0 && !sansTaux ? montant - consoE : null,
        personnes,
      };
    },
    [suivi, lignes, reglages, consoLigneAvant, calcul]
  );

  /* FIN_COMMANDE_JAUNE : jour où chaque commande est épuisée (dans le mois affiché), par ligne, et ce qu'il en restait ce jour-là (en heures) */
  const finCommande = useMemo(() => {
    const m = new Map<string, { jour: string; resteH: number }>();
    for (const a of affaires) {
      const ls = lignes.filter((l) => l.affaire_id === a.id);
      if (ls.length === 0) continue;
      const f = ficheDe(a);
      if (f.quantite === null || f.quantite <= 0) continue;
      const tauxH = (l: Ligne) => (l.taux === null ? null : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux);
      const enEuros = f.montant > 0 && ls.every((l) => tauxH(l) !== null);
      const valeur = (l: Ligne, h: number) => (enEuros ? h * (tauxH(l) as number) : h);
      const plafond = enEuros ? f.montant : f.quantite * (f.unite === "JOUR" ? f.base : 1);
      let cumul = ls.reduce((s, l) => s + valeur(l, consoLigneAvant.get(l.id) ?? 0), 0);
      if (cumul >= plafond - 0.01) continue; // déjà épuisée avant ce mois
      let trouve = false;
      for (const j of jours) {
        for (const l of ls) {
          const h = saisieParCle.get(`${l.id}|${j.date}`)?.heures ?? 0;
          if (h <= 0) continue;
          const avant = cumul;
          cumul += valeur(l, h);
          if (cumul >= plafond - 0.01) {
            const resteV = plafond - avant;
            m.set(l.id, { jour: j.date, resteH: Math.max(0, enEuros ? resteV / (tauxH(l) as number) : resteV) });
            trouve = true;
            break;
          }
        }
        if (trouve) break;
      }
    }
    return m;
  }, [affaires, lignes, ficheDe, consoLigneAvant, jours, saisieParCle]);

  /* Unité ou base de la commande : ses lignes suivent ; le taux de chaque ligne est converti si l'unité change */
  async function reglerCommande(a: AffaireP, patch: { unite?: "JOUR" | "HEURE"; base?: number }) {
    const f = ficheDe(a);
    const unite = patch.unite ?? f.unite;
    const base = patch.base ?? f.base;
    setErreur("");
    const { error } = await supabase.from("pilotage_affaires").update({ releve_unite: unite, releve_base_horaire: base }).eq("id", a.id);
    if (error) return setErreur(traduireErreur(error.message));
    const misesAJour = lignes
      .filter((l) => l.affaire_id === a.id)
      .map((l) => {
        let taux = l.taux;
        if (taux !== null && l.unite !== unite) taux = Math.round((unite === "HEURE" ? taux / l.base_horaire : taux * l.base_horaire) * 100) / 100;
        return { l, patch: { unite, taux } };
      });
    for (const m of misesAJour) {
      const { error: el } = await supabase.from("prestation_lignes").update(m.patch).eq("id", m.l.id);
      if (el) return setErreur(traduireErreur(el.message));
    }
    setReglages((r) => new Map(r).set(a.id, { unite, base }));
    setLignes((ls) => ls.map((l) => misesAJour.find((m) => m.l.id === l.id) ? { ...l, ...misesAJour.find((m) => m.l.id === l.id)!.patch } : l));
  }

  async function exporter() {
    setErreur("");
    setEnCours("export");
    try {
      const reponse = await fetch("/gabarits/prestations.xlsx");
      if (!reponse.ok) throw new Error("Gabarit introuvable : déposez-le dans public/gabarits/prestations.xlsx.");
      const modele = await reponse.arrayBuffer();

      const dejaAffaire = new Set<string>();
      const lignesGabarit: LigneGabarit[] = blocs.flatMap((b) =>
        b.lignes.flatMap((l): LigneGabarit[] => {
          const a = affairesParId.get(l.affaire_id)!;
          const env = enveloppes.get(l.affaire_id);
          const nf = numeroFacture(a);
          // enveloppe restante au début du mois, sur la première ligne de l'affaire
          const premiere = !dejaAffaire.has(l.affaire_id);
          dejaAffaire.add(l.affaire_id);
          const resteDebut = env && env.commande > 0 ? env.commande - env.avant : null;
          const c = calcul(l);
          const ml = moisLignes.get(l.id);
          const base: LigneGabarit = {
            categorie: b.categorie,
            unite: b.unite,
            type: a.type,
            numero: nf.numero,
            client: nf.client,
            personne: collabs.get(l.collaborateur_id)?.trigramme ?? nomCollab(collabs.get(l.collaborateur_id)),
            taux: l.taux,
            base: l.base_horaire,
            // mois reporté : rien de facturé ce mois-ci ; report libre : retiré des derniers jours du mois
            jours: c.reporte
              ? jours.map(() => null)
              : (() => {
                  const valeurs: (number | string | null)[] = jours.map((j) => {
                    const sa = saisieParCle.get(`${l.id}|${j.date}`);
                    return sa ? (sa.code && (sa.heures ?? 0) > 0 ? sa.heures : sa.code ?? sa.heures) : null;
                  });
                  let aRetirer = c.sortant;
                  for (let i = valeurs.length - 1; i >= 0 && aRetirer > 0.001; i--) {
                    const v = valeurs[i];
                    if (typeof v !== "number" || v <= 0) continue;
                    const retire = Math.min(v, aRetirer);
                    valeurs[i] = Math.round((v - retire) * 100) / 100 || null;
                    aRetirer -= retire;
                  }
                  return valeurs;
                })(),
            hs: c.reporte ? 0 : ml?.hs_refacturer ?? 0,
            commandeInitiale: premiere && resteDebut !== null ? (l.unite === "JOUR" ? resteDebut / l.base_horaire : resteDebut) : null,
          };

          // heures reportées des mois précédents : ajoutées au jour choisi, ou sur une ligne à part
          if (c.reporte || c.reportEntrant <= 0) return [base];
          const jourReport = Math.min(jours.length, Math.max(1, ml?.report_jour ?? premierOuvre)) - 1;

          if (ml?.report_ligne_separee) {
            return [
              base,
              {
                ...base,
                jours: jours.map((_, i) => (i === jourReport ? c.reportEntrant : null)),
                hs: 0,
                commandeInitiale: null,
              },
            ];
          }

          const joursAvecReport = [...base.jours];
          // si le jour choisi porte un code (CP…), on prend le premier jour suivant sans code
          let i = jourReport;
          while (i < joursAvecReport.length && typeof joursAvecReport[i] === "string") i++;
          if (i >= joursAvecReport.length) i = jourReport;
          const actuel = joursAvecReport[i];
          joursAvecReport[i] = (typeof actuel === "number" ? actuel : 0) + c.reportEntrant;
          return [{ ...base, jours: joursAvecReport }];
        })
      );

      const r = await remplirGabarit(modele, debut, lignesGabarit);
      const blob = new Blob([r.fichier as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(blob);
      lien.download = `Prestations ${r.nomFeuille}.xlsx`;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(lien.href), 5000);

      setInfo(
        [
          `Exporté : ${r.nomFeuille}.`,
          r.debordements.length ? `⚠ Plus de lignes que le gabarit n’en prévoit, non exportées : ${r.debordements.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Export impossible.");
    } finally {
      setEnCours("");
    }
  }

  /* ------------------------------ rendu ------------------------------ */

  const nomMois = `${NOMS_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;

  /* Recherche : chaque mot doit se retrouver dans le client, la désignation, les n° ou la personne */
  const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const mots = sansAccents(recherche).split(/\s+/).filter(Boolean);
  const correspond = (a: AffaireP | undefined, collabId?: string) => {
    if (mots.length === 0) return true;
    if (!a) return false;
    const nf = numeroFacture(a);
    const c = collabId ? collabs.get(collabId) : undefined;
    const texte = sansAccents(
      [a.type, a.numero, `${a.type}${a.numero}`, nf.devis ? `DBE${nf.devis}` : "", nf.client ?? "", a.designation ?? "", a.imputation ?? "", c?.trigramme ?? "", c ? `${c.prenom ?? ""} ${c.nom ?? ""}` : ""].join(" ")
    );
    return mots.every((m) => texte.includes(m));
  };
  const blocsAffiches = blocs
    .map((b) => ({ ...b, lignes: b.lignes.filter((l) => correspond(affairesParId.get(l.affaire_id), l.collaborateur_id)) }))
    .filter((b) => b.lignes.length > 0);
  const aStafferAffiches = aStaffer.filter((a) => correspond(a));
  const nbTrouves = blocsAffiches.reduce((t, b) => t + b.lignes.length, 0) + aStafferAffiches.length;
  const th: CSSProperties = { ...page.th, padding: "8px 5px", fontSize: 12, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 2, overflow: "hidden", textOverflow: "ellipsis" };
  const td: CSSProperties = { ...page.td, padding: "8px 5px", fontSize: 15, whiteSpace: "nowrap", verticalAlign: "middle" };
  const champ: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    border: "1.5px solid #b9bec5",
    borderRadius: 6,
    padding: "6px 8px",
    minHeight: 38,
    fontSize: 15,
    fontFamily: "inherit",
    background: "#ffffff",
  };
  const outil: CSSProperties = { minWidth: 34, height: 36, border: "1.5px solid #b9bec5", borderRadius: 6, background: "#ffffff", cursor: "pointer", fontSize: 15, padding: "0 6px", fontFamily: "inherit" };

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="prestations" />

      <div style={{ ...page.contenu, maxWidth: "none", padding: "16px 20px 40px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
          <div>
            <h1 style={page.titre}>Prestations PE / PI — relevé du mois</h1>
            <p style={page.sousTitre}>
              Ce relevé fait foi et alimente le planning. <strong>↦ reste</strong> planifie le reste de la commande · jour <span style={{ background: "#ffe94d", padding: "0 3px" }}>en jaune</span> = fin de la commande (tout ce qui est commandé est consommé) · <strong>⚙</strong> ouvre ses réglages · cliquer-glisser sur des jours puis taper
              une valeur et <strong>Entrée</strong> · <strong>Suppr</strong> vide la sélection · coin orange = la feuille d’heures dit autre chose · <strong>« 7A »</strong> = absent mais facturé quand même (pas au planning).
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setMois(decalerMois(mois, -1))} aria-label="Mois précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 150, textAlign: "center" }}>{nomMois}</strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">▶</button>
            {/* LIEN_FACTURATION_RELEVE */}
            <Link href={`/analyse/facturation?mois=${mois.slice(0, 7)}`} title="La facturation de ce mois" style={{ ...page.btnSecondaire, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Facturation du mois →
            </Link>
            {/* STAFFAGE_CONTRATS */}
            {peutAgir && (
              <button
                type="button"
                style={page.btnSecondaire}
                onClick={() => {
                  setBrouillonContrats(contrats.length > 0 ? contrats.map((k) => ({ ...k, tarifs: k.tarifs.map((t) => ({ ...t })) })) : [contratVide("MICHELIN")]);
                  setContratsOuverts(true);
                }}
                title="Tarifs et rythme des contrats cadres (MICHELIN…)"
              >
                Contrats cadres
              </button>
            )}
            <button type="button" style={page.btnSecondaire} onClick={() => void exporter()} disabled={lignes.length === 0 || enCours !== ""}>
              {enCours === "export" ? "Export…" : "Exporter (gabarit Excel)"}
            </button>
            {peutAgir && lignes.length > 0 && (
              <button
                type="button"
                style={moisValide ? page.btnSecondaire : page.btnPrimaire}
                disabled={enCours !== ""}
                onClick={() => void validerMois(!moisValide)}
                title={
                  moisValide
                    ? "Rouvrir le mois : ses heures et ses montants redeviennent modifiables (et réimportables depuis le Suivi des prestations)."
                    : "Clôturer le mois une fois la facture faite : heures et montants sont figés (ils ne bougent plus, même si un taux change ou si on réimporte), et le mois compte comme FACTURÉ dans les Finances. Les mois passés importés du Suivi des prestations sont clôturés automatiquement."
                }
              >
                {moisValide ? "↺ Rouvrir le mois" : "🔒 Clôturer le mois (facturé)"}
              </button>
            )}
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}
        {moisValide && <Message genre="ok">Mois validé : heures et montants figés 🔒. « Rouvrir le mois » pour corriger.</Message>}

        {/* PRESENCE_RELEVE : collègues sur la page, modification faite ailleurs */}
        {autres.length > 0 && (
          <Message genre="info">
            👥 <strong>{autres.map((x) => x.nom).join(", ")}</strong> {autres.length > 1 ? "ont" : "a"} aussi le relevé ouvert : si vous modifiez la même case, la dernière saisie
            l’emporte.
          </Message>
        )}
        {modifAilleurs && (
          <Message genre="info">
            Le relevé vient d’être modifié par quelqu’un d’autre.{" "}
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

        {/* ALERTES_RETIREES : le bandeau « Avenant à prévoir » est remplacé par « tout planifié / à planifier » dans la colonne Reste */}
        {!chargement && lignes.length === 0 && (
          <Message genre="info">Aucune prestation ce mois-ci. Ajoutez une ligne (affaire PE / PI × personne) en bas de page.</Message>
        )}

        {/* REPORTS_RELEVE : ce qui est reporté ce mois-ci, reçu des mois précédents, envoyé au mois suivant */}
        {!chargement &&
          (() => {
            const items = lignes
              .filter((l) => l.actif)
              .map((l) => ({ l, c: calcul(l), a: affairesParId.get(l.affaire_id), ml: moisLignes.get(l.id) }))
              .filter((x) => x.a && ((x.c.reporte && x.c.heures > 0) || x.c.reportDisponible > 0.01 || x.c.reportEntrant > 0.01 || x.c.sortant > 0.01));
            if (items.length === 0) return null;
            const tauxH = (l: Ligne) => (l.taux === null ? null : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux);
            // REPORTS_TITRE : le mois d'où viennent les heures reportées
            const moisPrecedent = NOMS_MOIS[(Number(mois.slice(5, 7)) + 10) % 12];
            const nbRecus = items.filter((x) => !x.c.reporte && x.c.reportDisponible > 0.01).length;
            const nbReportes = items.filter((x) => x.c.reporte && x.c.heures > 0).length;
            const nbEnvoyes = items.filter((x) => !x.c.reporte && x.c.sortant > 0.01).length;
            const pluriel = (n: number, s: string) => `${n} ${s}${n > 1 ? "s" : ""}`;
            const thR: CSSProperties = { ...page.th, padding: "6px 8px", fontSize: 12, whiteSpace: "nowrap" };
            const tdR: CSSProperties = { ...page.td, padding: "6px 8px", fontSize: 13 };
            return (
              <details open style={{ ...page.carte, padding: "10px 14px", marginBottom: 10, borderLeft: "5px solid #7a3e00" }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 15, color: "#7a3e00" }}>
                  ↪{" "}
                  {[
                    nbRecus ? `${pluriel(nbRecus, "report")} de ${moisPrecedent}, à facturer` : "",
                    nbReportes ? `${pluriel(nbReportes, "ligne")} de ${nomMois.split(" ")[0]} reportée${nbReportes > 1 ? "s" : ""} au mois suivant` : "",
                    nbEnvoyes ? `${pluriel(nbEnvoyes, "ligne")} envoyée${nbEnvoyes > 1 ? "s" : ""} en partie au mois suivant` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </summary>
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={thR}>Commande</th>
                        <th style={thR}>Pers.</th>
                        <th style={thR}>Ce mois-ci</th>
                        <th style={{ ...thR, textAlign: "right" }}>Heures</th>
                        <th style={{ ...thR, textAlign: "right" }}>Montant estimé</th>
                        <th style={thR} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(({ l, c, a, ml }) => {
                        const t = tauxH(l);
                        const nf = a ? numeroFacture(a) : null;
                        const lignesTexte: { texte: string; heures: number }[] = [];
                        if (c.reporte && c.heures > 0)
                          lignesTexte.push({
                            texte: ml ? "Mois reporté (à la main) : facturé plus tard" : "Mois reporté : commande pas encore reçue",
                            heures: c.heures,
                          });
                        if (!c.reporte && c.reportEntrant > 0.01) lignesTexte.push({ texte: `Reporté de ${moisPrecedent} : facturé ce mois-ci`, heures: c.reportEntrant });
                        if (!c.reporte && c.reportDisponible - c.reportEntrant > 0.01)
                          lignesTexte.push({ texte: `Reporté de ${moisPrecedent} : encore en attente`, heures: c.reportDisponible - c.reportEntrant });
                        if (!c.reporte && c.sortant > 0.01) lignesTexte.push({ texte: "Envoyé au mois suivant", heures: c.sortant });
                        return lignesTexte.map((x, k) => (
                          <tr key={`${l.id}-${k}`}>
                            <td style={{ ...tdR, fontWeight: 800, whiteSpace: "nowrap" }}>
                              {k === 0 ? (
                                <>
                                  {nf?.numero}
                                  {nf?.client ? <span style={{ fontWeight: 400, color: C.gris }}> · {nf.client}</span> : null}
                                </>
                              ) : null}
                            </td>
                            <td style={{ ...tdR, fontWeight: 800 }}>{k === 0 ? nomCollab(collabs.get(l.collaborateur_id)) : ""}</td>
                            <td style={{ ...tdR, color: "#7a3e00" }}>{x.texte}</td>
                            <td style={{ ...tdR, textAlign: "right", whiteSpace: "nowrap" }}>{formatHeures(x.heures)}</td>
                            <td style={{ ...tdR, textAlign: "right", whiteSpace: "nowrap" }}>{t === null ? "taux ?" : euros(x.heures * t)}</td>
                            <td style={tdR}>
                              {k === 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDetails((d) => {
                                      const n = new Set(d);
                                      n.add(l.id);
                                      return n;
                                    })
                                  }
                                  title="Ouvrir les réglages de la ligne (⚙), partie Report"
                                  style={{ ...outil, minHeight: 28, height: 28, fontSize: 12 }}
                                >
                                  ⚙ régler
                                </button>
                              )}
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })()}

        {/* DORMANTES_RELEVE : encadré replié des commandes ouvertes sans activité */}
        {!chargement &&
          (() => {
            const avecAvenant = new Set(affaires.filter((a) => /R\d+$/i.test(a.numero) && a.statut === "EN_COURS").map((a) => a.numero.match(/^\d+/)?.[0] ?? ""));
            const liste = affaires
              .filter((a) => dort(a.id) && !(/^\d+$/.test(a.numero) && avecAvenant.has(a.numero)) && correspond(a))
              .sort((x, y) => y.numero.localeCompare(x.numero, "fr", { numeric: true }));
            if (liste.length === 0) return null;
            // RESTE_FAMILLE_DORMANTE : reste de toutes les commandes en cours de la famille (base + avenants)
            const resteFamille = (a: AffaireP) => {
              const base = a.numero.match(/^\d+/)?.[0] ?? "";
              const fam = affaires
                .filter((x) => (x.numero.match(/^\d+/)?.[0] ?? "") === base && x.statut === "EN_COURS")
                .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
              let quantite = 0;
              let montant = 0;
              const detail: string[] = [];
              for (const x of fam) {
                const fx = ficheDe(x);
                quantite += Math.max(0, fx.reste ?? 0);
                montant += Math.max(0, fx.resteE ?? 0);
                detail.push(`${x.numero} : reste ${texteHeures(Math.round((fx.reste ?? 0) * 10) / 10)} ${fx.unite === "JOUR" ? "j" : "h"}${fx.resteE !== null ? ` (${euros(fx.resteE)})` : ""}`);
              }
              return { fam, quantite, montant, detail };
            };
            const totalReste = liste.reduce((t, a) => t + resteFamille(a).montant, 0);
            return (
              <details style={{ ...page.carte, padding: "10px 14px", marginBottom: 10, borderLeft: "5px solid #8a9097" }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 15, color: "#3b4046" }}>
                  💤 Commandes ouvertes sans activité depuis 3 mois ({liste.length}){totalReste > 0 ? ` · reste disponible : ${euros(totalReste)}` : ""}
                  <span style={{ fontWeight: 400, fontSize: 13, color: C.gris }}> · des clients à relancer</span>
                </summary>
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <tbody>
                      {liste.map((a) => {
                        const f = ficheDe(a);
                        const nf = numeroFacture(a);
                        const u = f.unite === "JOUR" ? "j" : "h";
                        const d = dormantes.get(a.id);
                        return (
                          <tr key={a.id}>
                            <td style={{ ...page.td, padding: "6px 8px", whiteSpace: "nowrap" }}>
                              <button type="button" onClick={() => setFiche(a.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 800, color: C.rougeFonce, textDecoration: "underline dotted" }}>
                                {a.numero}
                              </button>{" "}
                              <span style={{ fontSize: 12, fontWeight: 700, color: C.gris }}>{a.imputation}</span>
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", fontSize: 13 }}>
                              {nf.client ? <strong>{nf.client} · </strong> : null}
                              {a.designation}
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", fontSize: 13, whiteSpace: "nowrap", textAlign: "right" }}>
                              {(() => {
                                const rf = resteFamille(a);
                                if (rf.fam.length < 2)
                                  return (
                                    <>
                                      {f.reste === null ? "—" : `reste ${texteHeures(Math.round(f.reste * 10) / 10)} ${u}`}
                                      {f.resteE !== null && f.resteE > 0 ? ` · ${euros(f.resteE)}` : ""}
                                    </>
                                  );
                                return (
                                  <span title={rf.detail.join("\n")}>
                                    reste {texteHeures(Math.round(rf.quantite * 10) / 10)} {u}
                                    {rf.montant > 0 ? ` · ${euros(rf.montant)}` : ""}
                                    <div style={{ fontSize: 11, color: C.gris }}>famille : {rf.fam.map((x) => x.numero).join(" + ")}</div>
                                  </span>
                                );
                              })()}
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", fontSize: 13, color: C.gris }}>{d ? libelleDormance(d) : ""}</td>
                            <td style={{ ...page.td, padding: "6px 8px" }}>
                              <button
                                type="button"
                                onClick={() => setReveillees((s) => new Set(s).add(a.id))}
                                title="La remettre dans le relevé ce mois-ci (pour la staffer ou y saisir des heures)"
                                style={{ ...page.btnSecondaire, minHeight: 30, fontSize: 13 }}
                              >
                                Reprendre dans le relevé
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })()}

        {!chargement && (blocs.length > 0 || aStaffer.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher : client, affaire, n° (1604R2, DBE2603), trigramme…"
              aria-label="Rechercher dans le relevé"
              style={{ ...page.entrees, maxWidth: 460, minHeight: 40, fontSize: 15 }}
            />
            {mots.length > 0 && (
              <>
                <span style={{ fontSize: 14, color: C.gris }}>
                  {nbTrouves} ligne{nbTrouves > 1 ? "s" : ""} trouvée{nbTrouves > 1 ? "s" : ""}
                </span>
                <button type="button" style={page.btnSecondaire} onClick={() => setRecherche("")}>
                  Effacer
                </button>
              </>
            )}
          </div>
        )}
        {!chargement && mots.length > 0 && nbTrouves === 0 && <Message genre="info">Aucune ligne ne correspond à « {recherche} ».</Message>}

        {(blocsAffiches.length > 0 || aStafferAffiches.length > 0) && (() => {
          /* RELEVE_UNE_LIGNE_V7 : n° d’une affaire à staffer cliquable ; flèches du mois fixes dans l’en-tête (le tableau reste affiché pendant le chargement, la page ne remonte pas) ; « à staffer » en haut, jours plus étroits ; n° de semaine, jours qui se partagent la largeur de l’écran, un seul ascenseur (celui de la page) ; tout à gauche (commande, mois, montant, reste, réglages), le calendrier mince à droite ; une ligne par commande × personne, comme le Suivi des prestations.
             Le calendrier reste fixe en haut ; la commande (à gauche) et le mois, le montant, le reste
             (à droite) restent visibles quand on fait défiler. ⚙ ouvre les réglages de la ligne. */
          const L_CMD = 180;
          const L_PERS = 62;
          const L_MOIS = 66;
          const L_MONTANT = 80;
          const L_RESTE = 104;
          const L_OUTILS = 128;
          const X_MOIS = L_CMD + L_PERS;
          const X_MONTANT = X_MOIS + L_MOIS;
          const X_RESTE = X_MONTANT + L_MONTANT;
          const X_OUTILS = X_RESTE + L_RESTE;
          // calendrier étroit : jours ouvrés 26 px, week-ends et fériés 10 px (s'il manque de la place,
          // la page défile de côté et la partie gauche reste en place)
          // JOURS_LARGES : jours ouvrés 32 px, week-ends et fériés 13 px
          const largeurJour = (j: { weekend: boolean; ferie: boolean }) => (j.weekend || j.ferie ? 13 : 32);
          const largeurTableau = X_OUTILS + L_OUTILS + jours.reduce((t, j) => t + largeurJour(j), 0);
          // l'en-tête reste visible sous les onglets du Pilotage (49 px) ; deux rangées : semaines, puis jours
          const HAUT = 49;
          const H_SEMAINES = 18;
          const semaineIso = (date: string) => {
            const d = new Date(`${date}T00:00:00Z`);
            const n = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - n);
            return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
          };
          const semainesMois: { numero: number; nb: number }[] = [];
          for (const j of jours) {
            const n = semaineIso(j.date);
            const der = semainesMois[semainesMois.length - 1];
            if (der && der.numero === n) der.nb++;
            else semainesMois.push({ numero: n, nb: 1 });
          }
          const petitOutil: CSSProperties = { ...outil, minWidth: 28, height: 30, padding: "0 4px", fontSize: 14 };
          const nbCol = 2 + jours.length + 4;
          const fondFixe = "#ffffff";
          // ENTETES_VISIBLES : titres de colonnes plus grands et plus foncés
          const entete: CSSProperties = { ...th, position: "sticky", top: HAUT, zIndex: 3, background: "#f1f2f4", padding: "6px 4px", fontSize: 13, fontWeight: 800, color: "#1f2328", letterSpacing: ".3px", borderBottom: "2px solid #b3b9c0", textAlign: "center", whiteSpace: "normal", lineHeight: 1.15, overflow: "visible", textOverflow: "clip" }; // ENTETES_CENTRES
          const fixeG = (left: number, largeur: number, fond: string = fondFixe): CSSProperties => ({ position: "sticky", left, zIndex: 2, background: fond, minWidth: largeur, maxWidth: largeur, width: largeur });
          const cellule: CSSProperties = { ...td, padding: "3px 4px", fontSize: 13, borderBottom: `1px solid ${C.ligne}`, overflow: "hidden", textOverflow: "ellipsis" };
          const enUnite = (l: Ligne, heures: number) =>
            l.unite === "JOUR" ? `${(Math.round((heures / l.base_horaire) * 100) / 100).toLocaleString("fr-FR")} j` : formatHeures(heures);
          const etiquette: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris };
          return (
            <div style={{ background: "#ffffff", border: `1px solid ${C.ligne}`, borderRadius: 10, userSelect: "none", width: largeurTableau + 2, boxSizing: "border-box", opacity: chargement ? 0.55 : 1, transition: "opacity .15s" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: largeurTableau }}>
                <colgroup>
                  {[L_CMD, L_PERS, L_MOIS, L_MONTANT, L_RESTE, L_OUTILS].map((w, i) => (
                    <col key={`g${i}`} style={{ width: w }} />
                  ))}
                  {jours.map((j) => (
                    <col key={`c${j.date}`} style={{ width: largeurJour(j) }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(0, L_CMD, "#f1f2f4"), zIndex: 5, textAlign: "left", padding: "2px 4px" }}>
                      {/* changer de mois sans quitter la ligne regardée */}
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <button type="button" onClick={() => setMois(decalerMois(mois, -1))} aria-label="Mois précédent" title="Mois précédent" style={{ ...outil, minWidth: 26, height: 26, padding: 0, color: C.rougeFonce, fontSize: 12 }}>
                          ◀
                        </button>
                        <span style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 12, textTransform: "capitalize", color: C.rougeFonce, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {nomMois}
                        </span>
                        <button type="button" onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant" title="Mois suivant" style={{ ...outil, minWidth: 26, height: 26, padding: 0, color: C.rougeFonce, fontSize: 12 }}>
                          ▶
                        </button>
                      </div>
                    </th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(L_CMD, L_PERS, "#f1f2f4"), zIndex: 5, textAlign: "center" }}>Pers.</th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_MOIS, L_MOIS, "#f1f2f4"), zIndex: 5, textAlign: "center" }} title="Facturé ce mois-ci, dans l'unité de la ligne (jours ou heures)">
                      Mois
                    </th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_MONTANT, L_MONTANT, "#f1f2f4"), zIndex: 5, textAlign: "center" }}>Montant</th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_RESTE, L_RESTE, "#f1f2f4"), zIndex: 5, textAlign: "center" }} title="Reste sur la commande à la fin du mois affiché, consommé sur commandé, et ce qui reste à planifier après">
                      Reste commande
                    </th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_OUTILS, L_OUTILS, "#f1f2f4"), zIndex: 5, borderRight: `2px solid ${C.ligne}` }} />
                    {semainesMois.map((w) => (
                      <th
                        key={`s${w.numero}`}
                        colSpan={w.nb}
                        style={{ ...entete, height: H_SEMAINES, padding: "1px 0", textAlign: "center", fontSize: w.nb >= 3 ? 11 : 9, color: C.rougeFonce, borderLeft: `2px solid ${C.ligne}`, borderBottom: `1px solid ${C.ligne}` }}
                      >
                        S{w.numero}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {jours.map((j) => (
                      <th
                        key={j.date}
                        style={{
                          ...entete,
                          top: HAUT + H_SEMAINES + 2,
                          padding: "3px 0",
                          borderLeft: j.js === 1 ? `2px solid ${C.ligne}` : undefined,
                          textAlign: "center",
                          background: j.weekend || j.ferie ? "#e3e6ea" : "#f1f2f4",
                          color: j.weekend || j.ferie ? "#8a9097" : C.encre,
                        }}
                      >
                        <div style={{ fontSize: j.weekend || j.ferie ? 8 : 10, fontWeight: 700, lineHeight: "11px" }}>{LETTRES[j.js]}</div>
                        {/* AUJOURDHUI_RELEVE : le jour d'aujourd'hui, entouré */}
                        {(() => {
                          const d = new Date();
                          const auj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                          return j.date === auj ? (
                            <div style={{ lineHeight: "15px" }}>
                              <span
                                title="Aujourd’hui"
                                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: `2px solid ${C.rouge}`, boxSizing: "border-box", fontSize: 10, fontWeight: 800, color: C.rougeFonce }}
                              >
                                {j.jour}
                              </span>
                            </div>
                          ) : (
                            <div style={{ fontSize: j.weekend || j.ferie ? 8 : 11, lineHeight: "15px" }}>{j.jour}</div>
                          );
                        })()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* PE / PI à staffer : en tête, pour ne pas les oublier */}
                  {aStafferAffiches.length > 0 && (
                    <tr>
                      <td colSpan={nbCol} style={{ ...cellule, background: "#fff7ea", padding: 0 }}>
                        <div style={{ position: "sticky", left: 0, display: "inline-block", padding: "6px 8px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px", color: "#7a3e00" }}>
                          PE / PI à staffer — choisissez la personne
                        </div>
                      </td>
                    </tr>
                  )}
                  {aStafferAffiches.map((a) => (
                    <tr key={`s-${a.id}`}>
                      <td style={{ ...cellule, ...fixeG(0, L_CMD), whiteSpace: "normal" }} title={a.designation}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <BadgeType type={a.type} />
                          <button
                            type="button"
                            onClick={() => setFiche(a.id)}
                            title="Voir la fiche commande : ce qui est commandé, le taux, le montant"
                            style={{ all: "unset", cursor: "pointer", fontWeight: 800, color: C.rougeFonce, textDecoration: "underline dotted" }}
                          >
                            {numeroFacture(a).numero}
                          </button>
                          {numeroFacture(a).devis && <span title="Devis d’origine (Suivi d’affaire BE)" style={{ fontSize: 11, fontWeight: 700, color: C.gris }}>DBE{String(numeroFacture(a).devis).replace(/^DBE/i, "")}</span>}
                          {a.statut === "EN_ATTENTE" && <span style={{ fontSize: 11, color: "#7a3e00", fontWeight: 800 }}>INT.</span>}
                        </span>
                      </td>
                      <td colSpan={nbCol - 1} style={cellule}>
                        <div style={{ position: "sticky", left: L_CMD, display: "inline-flex", alignItems: "center", gap: 10 }}>
                          {peutAgir ? (
                            <button
                              type="button"
                              onClick={() => void ouvrirStaffage(a)}
                              title="Personne, taux, rythme, dates de début et de fin"
                              style={{ ...page.btnPrimaire, minHeight: 32, fontSize: 13, padding: "0 12px" }}
                            >
                              ⚙ Paramétrer
                            </button>
                          ) : (
                            "—"
                          )}
                          <span style={{ color: C.gris, fontSize: 13 }}>
                            {a.imputation} · {a.designation}
                            {(() => {
                              const f = ficheDe(a);
                              const u = f.unite === "JOUR" ? "j" : "h";
                              if (f.quantite === null || f.taux === null) return " · montant ou heures absents du Suivi d’affaire";
                              return ` · ${texteHeures(Math.round(f.quantite * 100) / 100)} ${u} à ${f.taux.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € / ${u} = ${euros(f.montant)}`;
                            })()}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {blocsAffiches.map((b) => (
                    <Fragment key={b.cle}>
                      <tr>
                        <td colSpan={nbCol} style={{ ...cellule, background: "#eef0f3", padding: 0 }}>
                          <div style={{ position: "sticky", left: 0, display: "inline-block", padding: "6px 8px", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>
                            {b.titre}
                          </div>
                        </td>
                      </tr>
                      {b.lignes.map((l, k) => {
                        const a = affairesParId.get(l.affaire_id);
                        const c = calcul(l);
                        const env = enveloppes.get(l.affaire_id);
                        const premiere = k === 0 || b.lignes[k - 1].affaire_id !== l.affaire_id;
                        const verrou = !peutAgir || c.valide;
                        const vide = !jours.some((j) => saisieParCle.has(`${l.id}|${j.date}`));
                        const planDispo = vide && jours.some((j) => (planParCle.get(`${l.affaire_id}|${l.collaborateur_id}|${j.date}`) ?? 0) > 0);
                        const ecart = Math.abs(c.heures - c.heuresReel) > 0.01;
                        const nf = a ? numeroFacture(a) : null;
                        const ouvert = details.has(l.id);
                        const ml = moisLignes.get(l.id);
                        const nonFacturable = a ? !(a.statut === "EN_COURS" || a.statut === "LIVREE") : false;
                        // reste : celui du classeur (Suivi des prestations) s'il est connu, sinon le calcul
                        const resteClasseur = ml?.reste_import ?? null;
                        const resteCalcul = env && env.commande > 0 ? env.reste : null;
                        const bordHaut: CSSProperties = premiere ? { borderTop: `2px solid ${C.ligne}` } : {};
                        return (
                          <Fragment key={l.id}>
                            <tr>
                              {/* ---------- commande (fixe à gauche) ---------- */}
                              <td style={{ ...cellule, ...bordHaut, ...fixeG(0, L_CMD), whiteSpace: "normal" }}>
                                {premiere && a ? (
                                  <>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                      <BadgeType type={a.type} />
                                      <Link
                                        href={`/affaires/bilan?affaire=${a.type}${numeroBase(a.numero)}&commande=${encodeURIComponent(a.numero)}`}
                                        title={nonFacturable ? "Commande pas encore reçue : NON FACTURABLE en l’état" : a.statut === "LIVREE" ? `Commande livrée${a.date_livraison ? ` le ${new Date(`${a.date_livraison.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR")}` : ""}` : undefined}
                                        style={{ fontWeight: 800, color: C.rougeFonce, ...(nonFacturable ? { background: "#ffe94d", padding: "0 4px", borderRadius: 3 } : a.statut === "LIVREE" ? { background: "#c8ecc9", padding: "0 4px", borderRadius: 3 } : {}) }}
                                      >
                                        {nf?.numero}
                                      </Link>
                                      {nf?.devis && <span title="Devis d’origine (Suivi d’affaire BE)" style={{ fontSize: 11, fontWeight: 700, color: C.gris }}>DBE{String(nf?.devis).replace(/^DBE/i, "")}</span>}
                                      {a.statut === "EN_ATTENTE" && <span style={{ fontSize: 11, color: "#7a3e00", fontWeight: 800 }}>INT.</span>}
                                      {/* REPERE_REPORT : heures reportées du mois précédent sur cette ligne */}
                                      {!c.reporte && c.reportEntrant > 0.01 && (
                                        <span
                                          title={`Cette ligne facture ce mois-ci ${formatHeures(c.reportEntrant)} reportées de ${NOMS_MOIS[(Number(mois.slice(5, 7)) + 10) % 12]} : elles sont déjà comptées, ne les ressaisissez pas dans les jours.`}
                                          style={{ fontSize: 11, fontWeight: 800, color: "#ffffff", background: "#7a3e00", borderRadius: 4, padding: "0 5px" }}
                                        >
                                          ↪ report {NOMS_MOIS[(Number(mois.slice(5, 7)) + 10) % 12].slice(0, 4)}.
                                        </span>
                                      )}
                                      <button type="button" onClick={() => setFiche(a.id)} title="Fiche commande : commandé, taux, consommé, reste" aria-label={`Fiche commande ${a.numero}`} style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "#1f4e99", fontWeight: 800, border: "1px solid #9fb6cf", borderRadius: 999, padding: "0 6px", lineHeight: "16px" }}>
                                        {/* BOUTON_FICHE : un mot plutôt qu'un petit i */}
                                        fiche
                                      </button>
                                    </span>
                                    <div style={{ fontSize: 12, color: C.gris, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${a.designation}${nf?.client ? ` · ${nf.client}` : ""}`}>
                                      {nf?.client ? <strong>{nf.client}</strong> : null}
                                      {nf?.client ? " · " : ""}
                                      {a.designation}
                                    </div>
                                  </>
                                ) : (
                                  <span style={{ fontSize: 12, color: C.gris }}>↳ même commande</span>
                                )}
                              </td>
                              <td style={{ ...cellule, ...bordHaut, ...fixeG(L_CMD, L_PERS), fontWeight: 800 }}>
                                {nomCollab(collabs.get(l.collaborateur_id))}
                                {l.activite_id && <div style={{ fontSize: 10, color: C.gris, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{nomsActivites.get(l.activite_id)}</div>}
                              </td>

                              {/* ---------- le mois, le montant, le reste, les réglages (fixes à gauche) ---------- */}
                              <td
                                style={{ ...cellule, ...bordHaut, ...fixeG(X_MOIS, L_MOIS), textAlign: "right", fontWeight: 800 }}
                                title={`Saisi ${formatHeures(c.heures)} · feuilles d’heures ${formatHeures(c.heuresReel)}${c.reportEntrant > 0 ? ` · + ${formatHeures(c.reportEntrant)} reportées` : ""}${c.sortant > 0 ? ` · ${formatHeures(c.sortant)} envoyées au mois suivant` : ""}`}
                              >
                                {c.reporte ? <span style={{ color: "#7a3e00", fontSize: 12 }}>↪ reporté</span> : enUnite(l, c.facturables)}
                                {ecart &&
                                  (verrou ? (
                                    <div style={{ fontSize: 10, color: "#b35c00" }}>feuilles {enUnite(l, c.heuresReel)}</div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => alignerSurFeuilles(l)}
                                      title="Aligner cette ligne sur les heures pointées dans les feuilles d’heures"
                                      style={{ all: "unset", display: "block", marginLeft: "auto", cursor: "pointer", fontSize: 10, color: "#b35c00", textDecoration: "underline dotted" }}
                                    >
                                      feuilles {enUnite(l, c.heuresReel)} ≡
                                    </button>
                                  ))}
                                {!c.reporte && (c.reportEntrant > 0 || c.sortant > 0) && (
                                  <div style={{ fontSize: 10, color: "#7a3e00" }}>
                                    {c.reportEntrant > 0 ? `+${enUnite(l, c.reportEntrant)}` : ""}
                                    {c.sortant > 0 ? ` ↪${enUnite(l, c.sortant)}` : ""}
                                  </div>
                                )}
                              </td>
                              <td style={{ ...cellule, ...bordHaut, ...fixeG(X_MONTANT, L_MONTANT), textAlign: "right", fontWeight: 800 }}>
                                {c.montant === null ? <span style={{ color: "#7a3e00", fontWeight: 600 }}>taux ?</span> : euros(c.montant)}
                                {c.valide && <span title="Mois clôturé : montant figé"> 🔒</span>}
                              </td>
                              <td style={{ ...cellule, ...bordHaut, ...fixeG(X_RESTE, L_RESTE), textAlign: "right" }}>
                                {premiere && a
                                  ? (() => {
                                      const f = ficheDe(a);
                                      const u = f.unite === "JOUR" ? "j" : "h";
                                      if (f.reste === null)
                                        return (
                                          <span style={{ color: C.gris, fontSize: 12 }} title="Montant ou total d’heures absent du Suivi d’affaire">
                                            non chiffrée
                                          </span>
                                        );
                                      const ecartClasseur = resteClasseur !== null && Math.abs(resteClasseur - f.reste) > 0.5;
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => setFiche(a.id)}
                                          title={`Commande ${texteHeures(Math.round((f.quantite ?? 0) * 100) / 100)} ${u} · consommé ${texteHeures(Math.round(f.consomme * 100) / 100)} ${u}${f.resteE !== null ? ` · reste ${euros(f.resteE)}` : ""}`}
                                          style={{ all: "unset", cursor: "pointer" }}
                                        >
                                          <Pastille genre={f.reste <= 0 ? "crit" : f.quantite && f.reste / f.quantite < 0.2 ? "warn" : "ok"}>
                                            {texteHeures(Math.round(f.reste * 10) / 10)} {u}
                                          </Pastille>
                                          {/* CONSO_PLANIFIE : consommé sur commandé, et ce qui reste à planifier après ce mois */}
                                          {(() => {
                                            const futurU = lignes
                                              .filter((x) => x.affaire_id === a.id)
                                              .reduce((t, x) => t + (planif.futur.get(x.id)?.heures ?? 0) / (f.unite === "JOUR" ? x.base_horaire || f.base : 1), 0);
                                            const aPlanifier = f.reste - futurU;
                                            return (
                                              <>
                                                <div style={{ fontSize: 10, color: C.gris, whiteSpace: "nowrap" }}>
                                                  {texteHeures(Math.round(f.consomme * 10) / 10)} / {texteHeures(Math.round((f.quantite ?? 0) * 10) / 10)} {u} consommés
                                                </div>
                                                <div style={{ fontSize: 10, fontWeight: 800, whiteSpace: "nowrap", color: aPlanifier <= 0.05 ? "#1b5e20" : "#b35c00" }}>
                                                  {aPlanifier <= 0.05 ? "✓ tout planifié" : `${texteHeures(Math.round(aPlanifier * 10) / 10)} ${u} à planifier`}
                                                </div>
                                              </>
                                            );
                                          })()}
                                        </button>
                                      );
                                    })()
                                  : null}
                              </td>
                              <td style={{ ...cellule, ...bordHaut, ...fixeG(X_OUTILS, L_OUTILS), whiteSpace: "nowrap", borderRight: `2px solid ${C.ligne}` }}>
                                <span style={{ display: "inline-flex", gap: 2 }}>
                                  <button
                                    type="button"
                                    aria-expanded={ouvert}
                                    onClick={() =>
                                      setDetails((d) => {
                                        const n = new Set(d);
                                        if (n.has(l.id)) n.delete(l.id);
                                        else n.add(l.id);
                                        return n;
                                      })
                                    }
                                    title="Réglages de la ligne : personne, activité, unité, taux, base, intergroupe, report, heures sup"
                                    style={{ ...petitOutil, ...(l.taux === null ? { borderColor: "#e9b877", background: "#fff7ea" } : {}), ...(ouvert ? { borderColor: C.rouge } : {}) }}
                                  >
                                    ⚙
                                  </button>
                                  {!verrou &&
                                    (planDispo ? (
                                      <button type="button" style={petitOutil} title="Reprendre les heures déjà prévues au planning ce mois-ci" onClick={() => remplirLigne(l, "PLANNING")}>
                                        📅
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        style={{ ...petitOutil, fontSize: 11, fontWeight: 800 }}
                                        title="Planifier le reste de la commande sur cette personne : une journée par jour ouvré à partir du dernier jour saisi, mois suivants compris"
                                        onClick={() => void planifierReste(l)}
                                      >
                                        ↦ reste
                                      </button>
                                    ))}
                                  {!verrou && (
                                    <button type="button" style={petitOutil} title="Vider le mois de cette ligne" onClick={() => viderLigne(l)}>
                                      ✕
                                    </button>
                                  )}
                                </span>
                              </td>

                              {/* ---------- les jours du mois ---------- */}
                              {jours.map((j) => {
                                const s = saisieParCle.get(`${l.id}|${j.date}`);
                                const force = Boolean(s?.code && (s?.heures ?? 0) > 0);
                                const texte = s ? (force ? `${texteHeures(s.heures ?? 0)} ${s.code === "ABS" ? "Abs." : s.code}` : s.code ?? (s.heures !== null ? texteHeures(s.heures) : "")) : "";
                                const factureH = s?.heures ?? 0;
                                const r = reelDe(l, j.date);
                                const different = Math.abs(factureH - r) > 0.01 && (factureH > 0 || r > 0);
                                const choisi = selection?.ligne === l.id && selection.jours.has(j.date);
                                const ferme = j.weekend || j.ferie;
                                // congé validé (Validation RH) : proposé en grisé, on peut toujours forcer une autre valeur
                                const conge = !s && absent(l.collaborateur_id, j.date);
                                const fin = finCommande.get(l.id);
                                const dernierPlanifie = fin?.jour === j.date;
                                return (
                                  <td
                                    key={j.date}
                                    onMouseDown={(e) => !verrou && surSourisBas(l, j.date, e.shiftKey)}
                                    onMouseEnter={() => !verrou && surSourisEntre(l, j.date)}
                                    title={force ? `${s?.code === "ABS" ? "Absent" : s?.code}, facturé quand même (${texteHeures(s?.heures ?? 0)} h) : compté dans la facture, mais la personne reste absente au planning` : dernierPlanifie ? `Fin de la commande : ce qui est commandé est consommé ce jour-là (il en restait ${texteHeures(Math.round((fin?.resteH ?? 0) * 100) / 100)} h)` : different ? `Saisi ${texteHeures(factureH)} h · feuille d’heures ${texteHeures(r)} h` : conge ? "Congé validé : tapez une valeur pour forcer" : undefined}
                                    style={{
                                      ...bordHaut,
                                      padding: 0,
                                      borderBottom: `1px solid ${C.ligne}`,
                                      borderLeft: j.js === 1 ? `2px solid ${C.ligne}` : "1px solid #eef0f3",
                                      // FOND_ABSENCE : absence saisie ou congé validé en bleu clair, maladie / accident en rose
                                      background: choisi
                                        ? "#fff3c4"
                                        : dernierPlanifie
                                          ? "#ffe94d"
                                        : s?.code || conge
                                          ? /^(ML|MA|AT|MP)/i.test(s?.code ?? "")
                                            ? "#fde2e2"
                                            : "#dbe8fd"
                                          : ferme
                                            ? "#eceef1"
                                            : "#ffffff",
                                      backgroundImage: different ? "linear-gradient(225deg, #e07a00 0, #e07a00 6px, transparent 6px)" : undefined,
                                      outline: choisi ? "1px solid #e0b400" : undefined,
                                    }}
                                  >
                                    <input
                                      ref={(el) => {
                                        const cle = `${l.id}|${j.date}`;
                                        if (el) champs.current.set(cle, el);
                                        else champs.current.delete(cle);
                                      }}
                                      key={`${l.id}-${j.date}-${texte}`}
                                      disabled={verrou}
                                      defaultValue={texte}
                                      placeholder={conge ? "CP" : undefined}
                                      aria-label={`${nomCollab(collabs.get(l.collaborateur_id))} le ${j.jour}`}
                                      onFocus={(e) => e.currentTarget.select()}
                                      onKeyDown={(e) => surTouche(e, l, j.date)}
                                      onBlur={(e) => {
                                        if (e.currentTarget.value.trim() !== texte) void ecrire(l, [{ jour: j.date, valeur: lireValeur(e.currentTarget.value) }]);
                                      }}
                                      style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        border: "none",
                                        background: "transparent",
                                        textAlign: "center",
                                        fontSize: ferme || force ? 10 : 13,
                                        fontWeight: 700,
                                        color: s?.code ? "#7a3e00" : C.encre,
                                        fontFamily: "inherit",
                                        padding: "7px 0",
                                        cursor: verrou ? "default" : "cell",
                                      }}
                                    />
                                  </td>
                                );
                              })}

                            </tr>

                            {/* ---------- réglages de la ligne (⚙) ---------- */}
                            {ouvert && (
                              <tr>
                                <td colSpan={nbCol} style={{ ...cellule, background: "#fafbfc", padding: 0 }}>
                                  <div style={{ position: "sticky", left: 0, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, padding: "10px 12px", maxWidth: "min(100vw - 80px, 1300px)", boxSizing: "border-box" }}>
                                    <label style={{ ...etiquette, width: 110 }}>
                                      Personne
                                      <select disabled={verrou} value={l.collaborateur_id} onChange={(e) => void changerPersonne(l, e.target.value)} style={champ}>
                                        {annuaire.map((p) => (
                                          <option key={p.id} value={p.id}>
                                            {nomCollab(p)}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label style={{ ...etiquette, width: 160 }}>
                                      Activité
                                      <select disabled={verrou} value={l.activite_id ?? ""} onChange={(e) => void modifierLigne(l, { activite_id: e.target.value || null })} style={champ}>
                                        <option value="">—</option>
                                        {(referentiel?.activites ?? []).filter((x) => x.actif || x.id === l.activite_id).map((x) => (
                                          <option key={x.id} value={x.id}>
                                            {x.nom}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label style={{ ...etiquette, width: 90 }}>
                                      Unité
                                      <select disabled={verrou} value={l.unite} onChange={(e) => void modifierLigne(l, { unite: e.target.value as Ligne["unite"] })} style={champ}>
                                        <option value="JOUR">€/jour</option>
                                        <option value="HEURE">€/h</option>
                                      </select>
                                    </label>
                                    <label style={{ ...etiquette, width: 90 }}>
                                      Taux
                                      <input
                                        key={`t-${l.id}-${l.taux}`}
                                        disabled={verrou}
                                        defaultValue={l.taux ?? ""}
                                        inputMode="decimal"
                                        placeholder="taux"
                                        onBlur={(e) => {
                                          const v = e.target.value.trim().replace(",", ".");
                                          const n = v === "" ? null : Number(v);
                                          if (n !== l.taux && (n === null || Number.isFinite(n))) void modifierLigne(l, { taux: n });
                                        }}
                                        style={{ ...champ, textAlign: "right", borderColor: l.taux === null ? "#e9b877" : "#c9cdd2" }}
                                      />
                                    </label>
                                    <label style={{ ...etiquette, width: 70 }} title="Base horaire vendue (heures par jour)">
                                      Base
                                      <input
                                        key={`b-${l.id}-${l.base_horaire}`}
                                        disabled={verrou}
                                        defaultValue={texteHeures(l.base_horaire)}
                                        inputMode="decimal"
                                        onBlur={(e) => {
                                          const n = Number(e.target.value.replace(",", "."));
                                          if (Number.isFinite(n) && n > 0 && n <= 12 && n !== l.base_horaire) void modifierLigne(l, { base_horaire: n });
                                        }}
                                        style={{ ...champ, textAlign: "right" }}
                                      />
                                    </label>
                                    <label style={{ ...etiquette, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 38 }} title="Facturée à une société du groupe">
                                      <input type="checkbox" disabled={verrou} checked={l.intergroupe} onChange={(e) => void modifierLigne(l, { intergroupe: e.target.checked })} style={{ width: 18, height: 18 }} />
                                      Intergroupe
                                    </label>
                                    <label style={{ ...etiquette, width: 90 }} title="Heures sup refacturées à 125 %">
                                      HS 125 %
                                      <input
                                        key={`hs-${l.id}-${c.hs}`}
                                        disabled={verrou}
                                        defaultValue={c.hs ? texteHeures(c.hs) : ""}
                                        inputMode="decimal"
                                        onBlur={(e) => {
                                          if ((Number(e.target.value.replace(",", ".")) || 0) !== c.hs) void modifierHs(l, e.target.value);
                                        }}
                                        style={{ ...champ, textAlign: "right" }}
                                      />
                                    </label>
                                    <div style={{ ...etiquette, width: 230 }}>
                                      Report
                                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        {!c.reporte && (c.reportEntrant > 0 || c.reportDisponible > 0 || (ml?.report_heures ?? null) !== null) && (
                                          <button
                                            type="button"
                                            disabled={verrou}
                                            onClick={() => ouvrirReport(l)}
                                            title={`Reçu des mois précédents (${formatHeures(c.reportDisponible)} en attente). Cliquer pour choisir combien et où les placer.`}
                                            style={{ ...outil, color: "#7a3e00", borderColor: "#e9b877", background: "#fff7ea", fontWeight: 800 }}
                                          >
                                            +{formatHeures(c.reportEntrant)}
                                            {ml?.report_ligne_separee ? " ⧉" : ""}
                                          </button>
                                        )}
                                        <span aria-hidden="true" style={{ color: "#7a3e00", fontWeight: 800 }}>↪</span>
                                        {c.reporte ? (
                                          <button type="button" disabled={verrou} onClick={() => void basculerReport(l)} title="Tout le mois est reporté. Cliquer pour facturer ce mois-ci." style={{ ...outil, color: "#7a3e00", borderColor: "#e9b877", background: "#fff7ea", fontWeight: 800 }}>
                                            tout le mois
                                          </button>
                                        ) : (
                                          <>
                                            <input
                                              key={`rs-${l.id}-${c.sortant}`}
                                              disabled={verrou}
                                              defaultValue={c.sortant > 0 ? texteHeures(l.unite === "JOUR" ? c.sortant / l.base_horaire : c.sortant) : ""}
                                              placeholder={l.unite === "JOUR" ? "j" : "h"}
                                              inputMode="decimal"
                                              aria-label="À reporter sur le mois suivant"
                                              onBlur={(e) => {
                                                const actuel = c.sortant > 0 ? texteHeures(l.unite === "JOUR" ? c.sortant / l.base_horaire : c.sortant) : "";
                                                if (e.target.value.trim() !== actuel) void enregistrerSortant(l, e.target.value);
                                              }}
                                              style={{ ...champ, width: 70, textAlign: "right" }}
                                            />
                                            {!verrou && (
                                              <button type="button" onClick={() => void basculerReport(l)} title="Reporter tout le mois" style={{ ...outil, color: C.gris, fontSize: 12 }}>
                                                tout
                                              </button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ ...etiquette, color: C.encre, fontWeight: 400, fontSize: 13 }}>
                                      <span>
                                        Saisi <strong>{formatHeures(c.heures)}</strong> · feuilles d’heures{" "}
                                        <strong style={{ color: ecart ? "#b35c00" : undefined }}>{formatHeures(c.heuresReel)}</strong>
                                        {ecart && !verrou && (
                                          <button type="button" onClick={() => alignerSurFeuilles(l)} style={{ ...outil, marginLeft: 8, fontSize: 12, color: "#b35c00", borderColor: "#e9b877" }}>
                                            ≡ Aligner sur les feuilles
                                          </button>
                                        )}
                                      </span>
                                      <span>
                                        Facturé <strong>{formatHeures(c.facturables)}</strong> · {(Math.round((c.facturables / l.base_horaire) * 100) / 100).toLocaleString("fr-FR")} j
                                      </span>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {!chargement && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 14 }}>
            {lignes.length > 0 && (
              <section style={{ ...page.carte, padding: 14, flex: "1 1 320px" }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>Total de {nomMois}</h2>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{euros(totaux.montant)}</div>
                <div style={{ color: C.gris, fontSize: 13 }}>{formatHeures(totaux.heures)} facturées</div>
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  {[...totaux.parActivite.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => (
                    <div key={k} title={k === "Sans activité" ? `Lignes sans activité (à choisir dans ⚙) : ${totaux.sansActivite.join(", ")}` : undefined}>
                      {k} : <strong>{euros(v)}</strong>
                      {k === "Sans activité" && totaux.sansActivite.length > 0 && <span style={{ fontSize: 12, color: C.gris }}> ({totaux.sansActivite.join(", ")})</span>}
                    </div>
                  ))}
                </div>
                {totaux.parCategorie.size > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.ligne}`, fontSize: 14 }}>
                    <strong>Taux de vente moyen du mois</strong>
                    {(["PE", "PI", "IG"] as const)
                      .filter((k) => totaux.parCategorie.has(k))
                      .map((k) => {
                        const v = totaux.parCategorie.get(k)!;
                        return (
                          <div key={k} title={`${euros(v.montant)} pour ${formatHeures(v.heures)} facturées`}>
                            {k === "IG" ? "Intergroupe" : k} : <strong>{euros(v.montant / v.heures)} / h</strong> · {euros(v.montant / v.jours)} / jour
                          </div>
                        );
                      })}
                  </div>
                )}
              </section>
            )}

          </div>
        )}

        <p style={{ fontSize: 12, color: C.gris, marginTop: 12 }}>
          Montant = heures facturées × taux horaire (taux jour ÷ base pour un tarif journalier) + heures sup × 125 % × taux horaire. Chaque
          modification part dans le planning (affectation du mois) une seconde après. Imputations concernées :{" "}
          {imputations.filter((i) => !i.charge_obligatoire).map((i) => i.code).join(", ") || "PE, PI"}.
        </p>
      </div>

      {/* DECALER_JOUR : proposition de décaler les heures retirées */}
      {decalage && peutAgir && (
        <div
          role="status"
          style={{ position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)", zIndex: 90, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", maxWidth: "94vw", padding: "10px 14px", background: "#ffffff", border: "2px solid #1f4e99", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.2)", fontSize: 14 }}
        >
          <span>
            <strong>{formatHeures(decalage.heures)}</strong> retirées pour {nomCollab(collabs.get(decalage.ligne.collaborateur_id))} sur{" "}
            <strong>{affairesParId.get(decalage.ligne.affaire_id)?.numero}</strong>.
          </span>
          <button type="button" style={page.btnPrimaire} onClick={() => void decaler(decalage)} title="Les mettre sur les jours ouvrés libres après le dernier jour rempli de la ligne (ou le mois suivant)">
            ↦ Décaler à la fin
          </button>
          <button type="button" style={page.btnSecondaire} onClick={() => setDecalage(null)}>
            Non
          </button>
        </div>
      )}

      {/* FICHE_COMMANDE : ce qui est commandé, la vente, où on en est (lecture seule, sauf l'unité et la base) */}
      {fiche &&
        (() => {
          const a = affairesParId.get(fiche);
          if (!a) return null;
          const f = ficheDe(a);
          const nf = numeroFacture(a);
          const u = f.unite === "JOUR" ? "j" : "h";
          const deux = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
          const info = (libelle: string, valeur: ReactNode, aide?: string) => (
            <div title={aide} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: `1px solid ${C.ligne}`, fontSize: 14 }}>
              <span style={{ color: C.gris }}>{libelle}</span>
              <strong style={{ textAlign: "right" }}>{valeur}</strong>
            </div>
          );
          const titreSection = (t: string) => <div style={{ marginTop: 14, fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>{t}</div>;
          const tousPropres = f.personnes.length > 0 && f.personnes.every((p) => p.propre);
          const sansLigne = f.personnes.length === 0;
          return (
            <div role="dialog" aria-modal="true" aria-label="Fiche commande" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setFiche(null)}>
              <div style={{ ...page.carte, padding: 20, width: 540, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <BadgeType type={a.type} />
                  <strong style={{ fontSize: 20, color: C.rougeFonce }}>{nf.numero}</strong>
                  {nf.devis && <span title="Devis d’origine (Suivi d’affaire BE)" style={{ fontSize: 13, fontWeight: 700, color: C.gris }}>DBE{String(nf.devis).replace(/^DBE/i, "")}</span>}
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.gris }}>{a.imputation}</span>
                  {a.statut === "EN_ATTENTE" && <span style={{ fontSize: 12, color: "#7a3e00", fontWeight: 800 }}>Intention de commande</span>}
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setFiche(null)} aria-label="Fermer" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 14, color: "#3b4046", marginTop: 2 }}>
                  {nf.client ? <strong>{nf.client} · </strong> : null}
                  {a.designation}
                </div>

                {titreSection("Ce que prévoit la commande (Suivi d’affaire)")}
                {info("Montant", f.montant > 0 ? euros(f.montant) : <span style={{ color: "#b3261e" }}>absent</span>)}
                {info("Total d’heures", f.heuresCmd > 0 ? formatHeures(f.heuresCmd) : <span style={{ color: "#b3261e" }}>absent</span>)}

                {titreSection("La vente")}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${C.ligne}`, alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>
                    Vendue
                    <select disabled={!peutAgir} value={f.unite} onChange={(e) => void reglerCommande(a, { unite: e.target.value as "JOUR" | "HEURE" })} style={{ ...champ, width: 130 }}>
                      <option value="JOUR">au jour</option>
                      <option value="HEURE">à l’heure</option>
                    </select>
                  </label>
                  {f.unite === "JOUR" && (
                    <label title="Base d’une journée vendue : convertit le total d’heures du Suivi d’affaire en jours" style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>
                      Journée de
                      <select disabled={!peutAgir} value={String(f.base)} onChange={(e) => void reglerCommande(a, { base: Number(e.target.value) })} style={{ ...champ, width: 100 }}>
                        <option value="7">7 h</option>
                        <option value="7.5">7,5 h</option>
                        {![7, 7.5].includes(f.base) && <option value={String(f.base)}>{deux(f.base)} h</option>}
                      </select>
                    </label>
                  )}
                </div>
                {info("Quantité commandée", f.quantite === null ? "—" : `${deux(f.quantite)} ${u}`, "Montant de la commande ÷ taux des lignes")}
                {info("Taux de la commande", f.taux === null ? "—" : `${deux(f.taux)} € / ${u}`, "Taux des lignes du relevé (celui de la première, s’il y en a plusieurs)")}

                {(() => {
                  const auj = (() => {
                    const d = new Date();
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  })();
                  let faitU = 0;
                  let planU = 0;
                  let faitE = 0;
                  let planE = 0;
                  for (const l of lignes.filter((x) => x.affaire_id === a.id)) {
                    const k = f.unite === "JOUR" ? l.base_horaire || f.base : 1;
                    const tH = l.taux === null ? null : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux;
                    let fait = 0;
                    let plan = 0;
                    const avant = consoLigneAvant.get(l.id) ?? 0;
                    if (debut <= auj) fait += avant;
                    else plan += avant;
                    for (const s of saisies) {
                      if (s.ligne_id !== l.id || !(s.heures && s.heures > 0)) continue;
                      if (s.jour <= auj) fait += s.heures;
                      else plan += s.heures;
                    }
                    const fu = planif.futur.get(l.id);
                    if (fu) {
                      fait += fu.fait;
                      plan += fu.heures - fu.fait;
                    }
                    faitU += fait / k;
                    planU += plan / k;
                    if (tH !== null) {
                      faitE += fait * tH;
                      planE += plan * tH;
                    }
                  }
                  const q = f.quantite ?? 0;
                  const reste = q - faitU - planU;
                  const resteE = f.montant > 0 ? f.montant - faitE - planE : null;
                  const arr = (n: number) => deux(Math.round(n * 100) / 100);
                  return (
                    <>
                      {titreSection(`Où on en est au ${new Date().toLocaleDateString("fr-FR")}`)}
                      {info("Commandé", f.quantite === null ? "—" : `${arr(q)} ${u}${f.montant > 0 ? ` · ${euros(f.montant)}` : ""}`)}
                      {info("Fait", `${arr(faitU)} ${u}${faitE > 0 ? ` · ${euros(faitE)}` : ""}`, "Saisi au relevé jusqu’à aujourd’hui, toutes personnes confondues")}
                      {info("Planifié", `${arr(planU)} ${u}${planE > 0 ? ` · ${euros(planE)}` : ""}`, "Saisi au relevé après aujourd’hui (ce mois-ci et les mois suivants)")}
                      {info(
                        "Reste à planifier",
                        f.quantite === null ? (
                          "—"
                        ) : (
                          <span style={{ color: reste < -0.01 ? "#b3261e" : reste <= 0.05 ? "#1b5e20" : undefined }}>
                            {reste < -0.01 ? `dépassé de ${arr(-reste)} ${u}` : reste <= 0.05 ? "✓ rien : tout est fait ou planifié" : `${arr(reste)} ${u}`}
                            {resteE !== null && reste > 0.05 ? ` · ${euros(resteE)}` : ""}
                          </span>
                        ),
                        "Commandé − fait − planifié"
                      )}
                    </>
                  );
                })()}

                {(() => {
                  const base = (a.numero.match(/^\d+/)?.[0] ?? a.numero).replace(/^0+/, "");
                  const famille = affaires
                    .filter((x) => (x.numero.match(/^\d+/)?.[0] ?? x.numero).replace(/^0+/, "") === base)
                    .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
                  const frD = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR") : "—");
                  return (
                    <>
                      {titreSection(famille.length > 1 ? "Commandes de la famille" : "Dates de la commande")}
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, marginBottom: 6 }}>
                        <thead>
                          <tr>
                            <th style={{ ...page.th, padding: "4px 6px" }}>N°</th>
                            <th style={{ ...page.th, padding: "4px 6px" }}>Statut</th>
                            <th style={{ ...page.th, padding: "4px 6px" }}>Ouverte</th>
                            <th style={{ ...page.th, padding: "4px 6px" }}>Reçue</th>
                            <th style={{ ...page.th, padding: "4px 6px" }}>Livrée</th>
                          </tr>
                        </thead>
                        <tbody>
                          {famille.map((x) => {
                            const d = datesCommandes.get(x.numero.toUpperCase().replace(/^0+/, ""));
                            const inversee = Boolean(d?.reception && d?.ouverture && (new Date(`${d.ouverture.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${d.reception.slice(0, 10)}T00:00:00Z`).getTime()) / 86400000 > 60); // DATES_TOLERANCE
                            return (
                              <tr key={x.id} style={x.id === a.id ? { background: "#fff7e0" } : undefined}>
                                <td style={{ ...page.td, padding: "4px 6px", fontWeight: 800 }}>{x.numero}</td>
                                <td style={{ ...page.td, padding: "4px 6px" }}>{d?.statut ?? (x.statut === "LIVREE" ? "Livrée" : x.statut === "EN_COURS" ? "En cours" : x.statut)}</td>
                                <td style={{ ...page.td, padding: "4px 6px", whiteSpace: "nowrap" }}>{frD(d?.ouverture ?? null)}</td>
                                <td
                                  style={{ ...page.td, padding: "4px 6px", whiteSpace: "nowrap", color: inversee ? "#b3261e" : undefined, fontWeight: inversee ? 800 : undefined }}
                                  title={inversee ? "Reçue avant son ouverture : date à vérifier dans le Suivi d’affaire (jour et mois inversés ?)" : undefined}
                                >
                                  {frD(d?.reception ?? null)}
                                  {inversee ? " ⚠" : ""}
                                </td>
                                <td style={{ ...page.td, padding: "4px 6px", whiteSpace: "nowrap" }}>{frD(d?.livraison ?? null)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  );
                })()}

                {titreSection("Personnes")}
                {sansLigne ? (
                  <div style={{ padding: "6px 0", fontSize: 14 }}>
                    Personne n’est encore staffé.
                    {peutAgir && (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          setFiche(null);
                          void ouvrirStaffage(a, e.target.value);
                        }}
                        style={{ ...champ, width: 160, marginLeft: 8 }}
                        aria-label={`Staffer ${a.numero}`}
                      >
                        <option value="">Staffer…</option>
                        {annuaire.map((p) => (
                          <option key={p.id} value={p.id}>
                            {nomCollab(p)}
                          </option>
                        ))}
                      </select>
                    )}
                    {f.taux !== null && <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>La ligne prendra le taux de la commande ({deux(f.taux)} € / {u}), modifiable ensuite dans ⚙.</div>}
                  </div>
                ) : (
                  f.personnes.map((p) => (
                    <div key={p.ligne.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.ligne}`, fontSize: 14 }}>
                      <strong>{nomCollab(collabs.get(p.ligne.collaborateur_id))}</strong>
                      <span>
                        {formatHeures(p.heures)} ·{" "}
                        {p.ligne.taux === null ? <span style={{ color: "#7a3e00" }}>taux ?</span> : `${deux(p.ligne.taux)} € / ${p.ligne.unite === "JOUR" ? "j" : "h"}`}
                        {p.propre && !tousPropres && (
                          <span title="Taux différent de celui de la commande : profil vendu à un autre prix" style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#34506b", border: "1px solid #9fb6cf", borderRadius: 999, padding: "0 6px" }}>
                            taux propre
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
                {/* AJOUT_DANS_FICHE : une personne de plus sur la commande (remplace « Ajouter une ligne » en bas de page) */}
                {peutAgir && !sansLigne && (
                  <div style={{ padding: "8px 0" }}>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        void staffer(a.id, e.target.value);
                        setFiche(null);
                      }}
                      style={{ ...champ, width: 240 }}
                      aria-label={`Ajouter une personne sur ${a.numero}`}
                    >
                      <option value="">+ Ajouter une personne…</option>
                      {annuaire
                        .filter((p) => !f.personnes.some((x) => x.ligne.collaborateur_id === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {nomCollab(p)}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {(f.montant <= 0 || f.heuresCmd <= 0) && (
                  <div style={{ marginTop: 12 }}>
                    <Message genre="erreur">Montant ou total d’heures manquant dans le Suivi d’affaire : complétez le classeur, puis synchronisez.</Message>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <Link href={`/affaires/bilan?affaire=${a.type}${numeroBase(a.numero)}&commande=${encodeURIComponent(a.numero)}`} style={{ ...page.btnSecondaire, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                    Fiche de l’affaire (bilan) →
                  </Link>
                  <button type="button" style={page.btnPrimaire} onClick={() => setFiche(null)}>
                    Fermer
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* STAFFAGE_V2 : paramétrer la commande à staffer */}
      {staffage &&
        (() => {
          const s = staffage;
          const k = contratDe(s.affaire);
          const f = ficheDe(s.affaire);
          const nf = numeroFacture(s.affaire);
          const libre = s.base !== "7" && s.base !== "7.5";
          const u = s.unite === "JOUR" ? "jour" : "h";
          const sim = simulerStaffage(s);
          const fr = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
          const avecTarif = (patch: Partial<typeof s>) => {
            const n = { ...s, ...patch };
            // sans contrat, un rythme uniforme suit la base horaire
            if (!k && patch.base !== undefined && s.rythme.every((x) => x === s.rythme[0]) && s.rythme[0] === s.base && patch.base !== "") n.rythme = n.rythme.map(() => patch.base as string);
            const t = k?.tarifs.find((x) => x.nom === n.tarif);
            const bn = Number(n.base.replace(",", "."));
            const tx = k && t ? tauxDepuisTarif(k, t, n.unite, Number.isFinite(bn) && bn > 0 ? bn : (k.base_hebdo || 37.5) / 5) : null;
            setStaffage(tx !== null ? { ...n, taux: String(tx) } : n);
          };
          const etiquetteS: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: C.gris };
          const totalRythme = s.rythme.reduce((t, x) => t + (Number(String(x).replace(",", ".")) || 0), 0);
          return (
            <div role="dialog" aria-modal="true" aria-label="Paramétrer la commande" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => !s.enCours && setStaffage(null)}>
              <div style={{ ...page.carte, padding: 20, width: 640, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <BadgeType type={s.affaire.type} />
                  <strong style={{ fontSize: 20, color: C.rougeFonce }}>{nf.numero}</strong>
                  {nf.devis && <span style={{ fontSize: 13, fontWeight: 800, color: C.gris }}>DBE{String(nf.devis).replace(/^DBE/i, "")}</span>}
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.gris }}>{s.affaire.imputation}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setStaffage(null)} aria-label="Fermer" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 14, color: "#3b4046", margin: "2px 0 12px" }}>
                  {nf.client ? <strong>{nf.client} · </strong> : null}
                  {s.affaire.designation}
                  {f.montant > 0 && <span style={{ color: C.gris }}> · commande {euros(f.montant)}</span>}
                </div>
                {s.source && (
                  <Message genre="info">
                    Avenant : personne, unité, base et taux repris de <strong>{s.source}</strong>, début à la suite de son dernier jour. Vérifiez, puis confirmez.
                  </Message>
                )}
                {k && (
                  <div style={{ padding: 10, background: "#f6f9ff", border: `1px solid ${C.ligne}`, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                    <strong>{k.libelle}</strong>
                    <label style={{ ...etiquetteS, marginTop: 8 }}>
                      Prestation du contrat
                      <select value={s.tarif} onChange={(e) => avecTarif({ tarif: e.target.value })} style={{ ...champ, maxWidth: 380 }}>
                        <option value="">— taux libre —</option>
                        {k.tarifs.map((t) => (
                          <option key={t.nom} value={t.nom}>
                            {t.nom}
                            {t.montant !== null ? ` · ${t.montant.toLocaleString("fr-FR")} € / ${t.unite === "HEURE" ? "h" : t.unite === "JOUR" ? "jour" : "semaine"}` : " · tarif non saisi"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                  <label style={{ ...etiquetteS, width: 170 }}>
                    Personne
                    <select value={s.personne} onChange={(e) => setStaffage({ ...s, personne: e.target.value })} style={champ}>
                      <option value="">Choisir…</option>
                      {annuaire.map((p) => (
                        <option key={p.id} value={p.id}>
                          {nomCollab(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ ...etiquetteS, width: 110 }}>
                    Vendue
                    <select value={s.unite} onChange={(e) => avecTarif({ unite: e.target.value as "JOUR" | "HEURE" })} style={champ}>
                      <option value="JOUR">au jour</option>
                      <option value="HEURE">à l’heure</option>
                    </select>
                  </label>
                  <label style={{ ...etiquetteS, width: 120 }} title="Heures d’une journée vendue">
                    Base horaire
                    <select value={libre ? "AUTRE" : s.base} onChange={(e) => avecTarif({ base: e.target.value === "AUTRE" ? "" : e.target.value })} style={champ}>
                      <option value="7">7 h</option>
                      <option value="7.5">7,5 h</option>
                      <option value="AUTRE">autre…</option>
                    </select>
                  </label>
                  {libre && (
                    <label style={{ ...etiquetteS, width: 80 }}>
                      Heures
                      <input value={s.base} onChange={(e) => avecTarif({ base: e.target.value })} inputMode="decimal" placeholder="ex. 8" style={{ ...champ, textAlign: "right" }} />
                    </label>
                  )}
                  <label style={{ ...etiquetteS, width: 120 }}>
                    Taux (€ / {u})
                    <input value={s.taux} onChange={(e) => setStaffage({ ...s, taux: e.target.value, tarif: "" })} inputMode="decimal" style={{ ...champ, textAlign: "right" }} />
                  </label>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 12 }}>
                  <strong style={{ width: 70, fontSize: 13, alignSelf: "center" }}>Rythme</strong>
                  {JOURS_SEMAINE.map((jour, d) => (
                    <label key={jour} style={{ ...etiquetteS, width: 62 }}>
                      {jour}
                      <input
                        value={s.rythme[d] ?? ""}
                        onChange={(e) => setStaffage({ ...s, rythme: s.rythme.map((x, j) => (j === d ? e.target.value : x)) })}
                        inputMode="decimal"
                        style={{ ...champ, textAlign: "right" }}
                      />
                    </label>
                  ))}
                  <span style={{ fontSize: 12, color: C.gris, alignSelf: "center" }}>= {texteHeures(Math.round(totalRythme * 100) / 100)} h / semaine{k ? " (contrat)" : ""}</span>
                </div>

                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.ligne}` }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                      <input type="checkbox" checked={s.remplir} onChange={(e) => setStaffage({ ...s, remplir: e.target.checked })} style={{ width: 18, height: 18 }} />
                      Remplir à partir du
                    </label>
                    <input type="date" value={s.depart} disabled={!s.remplir} onChange={(e) => setStaffage({ ...s, depart: e.target.value, dejaH: 0 })} style={{ ...champ, width: 160 }} />
                  </div>
                  {s.remplir && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: sim.fin ? "#eef7ef" : "#fff7ea", fontSize: 14 }}>
                      {sim.heures === null ? (
                        "Commande non chiffrée (ni montant, ni heures dans le Suivi d’affaire) : rien à planifier."
                      ) : !s.personne ? (
                        "Choisissez la personne pour calculer la date de fin."
                      ) : sim.fin ? (
                        <>
                          <strong>{texteHeures(Math.round(sim.heures * 100) / 100)} h</strong> à planifier
                          {f.montant > 0 && s.taux.trim() !== "" ? ` (${euros(f.montant)} au taux de ${s.taux.replace(".", ",")} € / ${u})` : ""} :{" "}
                          du <strong>{fr(sim.jours[0].jour)}</strong> au <strong>{fr(sim.fin)}</strong>, {sim.jours.length} jour{sim.jours.length > 1 ? "s" : ""}
                          {sim.evites > 0 && (
                            <span style={{ color: "#7a3e00" }}>
                              {" "}
                              · {sim.evites} jour{sim.evites > 1 ? "s" : ""} d’absence évité{sim.evites > 1 ? "s" : ""}
                            </span>
                          )}
                          .
                          {s.dejaH > 0.01 && s.personne === s.personneSource && (
                            <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>
                              Le premier jour, {texteHeures(s.dejaH)} h sont déjà prises par {s.source} : on commence avec le reste de la journée.
                            </div>
                          )}
                        </>
                      ) : (
                        "Rien à planifier : vérifiez le rythme et la date."
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                  <button type="button" style={page.btnSecondaire} onClick={() => setStaffage(null)} disabled={s.enCours}>
                    Annuler
                  </button>
                  <button type="button" style={page.btnPrimaire} onClick={() => void validerStaffage()} disabled={s.enCours || !s.personne}>
                    {s.enCours ? "Enregistrement…" : s.source ? "Confirmer" : "Valider"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* STAFFAGE_CONTRATS : paramétrage des contrats cadres */}
      {contratsOuverts && (
        <div role="dialog" aria-modal="true" aria-label="Contrats cadres" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setContratsOuverts(false)}>
          <div style={{ ...page.carte, padding: 20, width: 820, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Contrats cadres</h2>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setContratsOuverts(false)} aria-label="Fermer" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                ×
              </button>
            </div>
            <p style={{ margin: "4px 0 12px", fontSize: 13, color: C.gris }}>
              Un contrat s’applique aux PE / PI d’un client dont le nom <strong>contient</strong> le mot indiqué (MICHELIN : quel que soit le préfixe ou le suffixe). Son rythme sert au
              remplissage (↦ reste, staffage) ; ses tarifs se choisissent au staffage.
            </p>
            {brouillonContrats.map((k, i) => {
              const maj = (patch: Partial<Contrat>) => setBrouillonContrats((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const nombre = (v: string) => {
                const n = Number(v.replace(",", "."));
                return v.trim() === "" || !Number.isFinite(n) ? null : n;
              };
              const etiquetteC: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris };
              return (
                <fieldset key={`${k.id}-${i}`} style={{ border: `1px solid ${C.ligne}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                    <label style={{ ...etiquetteC, width: 160 }}>
                      Le client contient
                      <input defaultValue={k.client_motif} onBlur={(e) => maj({ client_motif: e.target.value })} style={champ} />
                    </label>
                    <label style={{ ...etiquetteC, width: 240 }}>
                      Libellé
                      <input defaultValue={k.libelle} onBlur={(e) => maj({ libelle: e.target.value })} style={champ} />
                    </label>
                    <label style={{ ...etiquetteC, width: 110 }}>
                      Base / semaine
                      <input defaultValue={texteHeures(k.base_hebdo)} onBlur={(e) => maj({ base_hebdo: nombre(e.target.value) ?? 37.5 })} inputMode="decimal" style={{ ...champ, textAlign: "right" }} />
                    </label>
                    <label style={{ ...etiquetteC, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 38 }}>
                      <input type="checkbox" checked={k.actif} onChange={(e) => maj({ actif: e.target.checked })} style={{ width: 18, height: 18 }} />
                      Actif
                    </label>
                  </div>
                  {(["rythme_pe", "rythme_pi"] as const).map((cle) => (
                    <div key={cle} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 10 }}>
                      <strong style={{ width: 90, fontSize: 13, alignSelf: "center" }}>Rythme {cle === "rythme_pe" ? "PE" : "PI"}</strong>
                      {JOURS_SEMAINE.map((jour, d) => (
                        <label key={jour} style={{ ...etiquetteC, width: 64 }}>
                          {jour}
                          <input
                            defaultValue={texteHeures(k[cle][d] ?? 0)}
                            onBlur={(e) => maj({ [cle]: k[cle].map((x, j) => (j === d ? nombre(e.target.value) ?? 0 : x)) } as Partial<Contrat>)}
                            inputMode="decimal"
                            style={{ ...champ, textAlign: "right" }}
                          />
                        </label>
                      ))}
                      <span style={{ fontSize: 12, color: C.gris, alignSelf: "center" }}>= {texteHeures(k[cle].reduce((s, x) => s + (Number(x) || 0), 0))} h</span>
                    </div>
                  ))}
                  <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12, fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...page.th, padding: "6px 8px" }}>Prestation</th>
                        <th style={{ ...page.th, padding: "6px 8px", textAlign: "right" }}>Tarif (€)</th>
                        <th style={{ ...page.th, padding: "6px 8px" }}>par</th>
                        <th style={{ ...page.th, padding: "6px 8px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {k.tarifs.map((t, ti) => {
                        const majT = (patch: Partial<TarifContrat>) => maj({ tarifs: k.tarifs.map((x, j) => (j === ti ? { ...x, ...patch } : x)) });
                        return (
                          <tr key={`${ti}-${t.nom}`}>
                            <td style={{ ...page.td, padding: "4px 8px" }}>
                              <input defaultValue={t.nom} onBlur={(e) => majT({ nom: e.target.value })} style={champ} />
                            </td>
                            <td style={{ ...page.td, padding: "4px 8px", width: 140 }}>
                              <input defaultValue={t.montant === null ? "" : String(t.montant).replace(".", ",")} onBlur={(e) => majT({ montant: nombre(e.target.value) })} inputMode="decimal" style={{ ...champ, textAlign: "right" }} />
                            </td>
                            <td style={{ ...page.td, padding: "4px 8px", width: 190 }}>
                              <select value={t.unite} onChange={(e) => majT({ unite: e.target.value as TarifContrat["unite"] })} style={champ}>
                                <option value="SEMAINE">semaine ({texteHeures(k.base_hebdo)} h)</option>
                                <option value="JOUR">jour ({texteHeures(k.base_hebdo / 5)} h)</option>
                                <option value="HEURE">heure</option>
                              </select>
                            </td>
                            <td style={{ ...page.td, padding: "4px 8px", width: 40 }}>
                              <button type="button" onClick={() => maj({ tarifs: k.tarifs.filter((_, j) => j !== ti) })} title="Retirer ce tarif" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16 }}>
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button type="button" onClick={() => maj({ tarifs: [...k.tarifs, { nom: "", montant: null, unite: "SEMAINE" }] })} style={{ ...page.btnSecondaire, minHeight: 32, marginTop: 8, fontSize: 13 }}>
                    + Ajouter un tarif
                  </button>
                </fieldset>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setBrouillonContrats((b) => [...b, contratVide("")])}>
                + Nouveau contrat
              </button>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <button type="button" style={page.btnSecondaire} onClick={() => setContratsOuverts(false)}>
                  Annuler
                </button>
                <button type="button" style={page.btnPrimaire} onClick={() => void enregistrerContrats()}>
                  Enregistrer
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {editeurReport && (
        <div role="dialog" aria-modal="true" aria-label="Heures reportées" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setEditeurReport(null)}>
          <div style={{ ...page.carte, padding: 20, width: 420, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Heures reportées à facturer en {nomMois}</h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: C.gris }}>
              {affairesParId.get(editeurReport.ligne.affaire_id)?.numero} · {nomCollab(collabs.get(editeurReport.ligne.collaborateur_id))} ·{" "}
              {formatHeures(calcul(editeurReport.ligne).reportDisponible)} en attente des mois reportés.
            </p>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 10 }}>
              Heures à facturer ce mois-ci
              <input value={editeurReport.heures} onChange={(e) => setEditeurReport({ ...editeurReport, heures: e.target.value })} inputMode="decimal" style={{ ...page.entrees, marginTop: 4 }} autoFocus />
            </label>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 10 }}>
              Jour où les placer dans l’export
              <select value={editeurReport.jour} onChange={(e) => setEditeurReport({ ...editeurReport, jour: e.target.value })} style={{ ...page.entrees, marginTop: 4 }}>
                {jours.map((j) => (
                  <option key={j.jour} value={j.jour}>
                    {LETTRES[j.js]} {j.jour}
                    {j.weekend || j.ferie ? " (fermé)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <input type="checkbox" checked={editeurReport.separee} onChange={(e) => setEditeurReport({ ...editeurReport, separee: e.target.checked })} style={{ width: 20, height: 20 }} />
              Sur une ligne à part (sinon, ajoutées aux heures de ce jour)
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setEditeurReport(null)}>Annuler</button>
              <button type="button" style={page.btnPrimaire} onClick={() => void enregistrerReport()}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PrestationsPage() {
  return (
    <GardeAcces droit="relevePrestations">
      <PrestationsContenu />
    </GardeAcces>
  );
}
