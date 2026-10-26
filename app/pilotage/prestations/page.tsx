"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyboardReact } from "react";
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
type SuiviLigne = { base_affaire: string | null; base_devis: string | null; numero_affaire: string | null; genre: string; statut: string | null; rang_avenant: number | null; client_id: string | null; date_livraison: string | null };

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
  return { heures: null, code: t.toUpperCase().slice(0, 6) };
}

function PrestationsContenu() {
  const [mois, setMois] = useState(moisDepuisUrl);
  const [peutAgir, setPeutAgir] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rechargement, setRechargement] = useState(0);

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
  const [editeurReport, setEditeurReport] = useState<null | { ligne: Ligne; heures: string; jour: string; separee: boolean }>(null);
  const [enCours, setEnCours] = useState("");
  /* DECALER_JOUR : heures retirées d'une ligne (jour vidé, remplacé par CP…), qu'on propose de décaler à la fin */
  const [decalage, setDecalage] = useState<null | { ligne: Ligne; heures: number; dates: string[] }>(null);
  // lignes dont les réglages (⚙) sont ouverts
  const [details, setDetails] = useState<Set<string>>(new Set());

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
            supabase.from("suivi_lignes").select("base_affaire,base_devis,numero_affaire,genre,statut,rang_avenant,client_id,date_livraison").in("genre", ["BASE", "AVENANT"]).order("cle").range(a, b)
          ).catch(() => [] as SuiviLigne[]),
          chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)).catch(() => []),
        ]);
        if (!actif) return;

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
        setReel(r);
        setSuivi({ lignes: sl, clients: new Map(sc.map((c) => [c.id, c.nom_abrege])) });
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

  /* Mois reporté : réglage enregistré, sinon automatique tant que la commande n'est pas reçue (intention) */
  const estReporte = useCallback(
    (l: Ligne) => {
      const ml = moisLignes.get(l.id);
      return ml ? ml.reporte : affairesParId.get(l.affaire_id)?.statut === "EN_ATTENTE";
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
          .filter((l) => l.actif && categorie(l) === cat && l.unite === unite)
          .sort(
            (x, y) =>
              (affairesParId.get(x.affaire_id)?.numero ?? "").localeCompare(affairesParId.get(y.affaire_id)?.numero ?? "", "fr", { numeric: true }) ||
              nomCollab(collabs.get(x.collaborateur_id)).localeCompare(nomCollab(collabs.get(y.collaborateur_id)))
          );
        if (ls.length) res.push({ cle: `${cat}-${unite}`, titre: `${titres[cat]} — tarif ${unite === "JOUR" ? "journalier" : "horaire"}`, categorie: cat, unite, lignes: ls });
      }
    return res;
  }, [lignes, categorie, affairesParId, collabs]);

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
          .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      })(),
    [affaires, lignes, debut]
  );

  async function staffer(affaireId: string, collaborateurId: string) {
    if (!collaborateurId) return;
    const { error } = await supabase.from("prestation_lignes").upsert({ affaire_id: affaireId, collaborateur_id: collaborateurId, actif: true }, { onConflict: "affaire_id,collaborateur_id" });
    if (error) return setErreur(traduireErreur(error.message));
    setRechargement((n) => n + 1);
  }

  const totaux = useMemo(() => {
    let montant = 0;
    let heures = 0;
    const parActivite = new Map<string, number>();
    for (const l of lignes.filter((x) => x.actif)) {
      const c = calcul(l);
      heures += c.facturables;
      montant += c.montant ?? 0;
      const k = l.activite_id ? nomsActivites.get(l.activite_id) ?? "Activité" : "Sans activité";
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
    return { montant, heures, parActivite, parCategorie };
  }, [lignes, calcul, nomsActivites, categorie]);

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
      valeurs.push({ jour: j.date, valeur: absent(l.collaborateur_id, j.date) ? { heures: null, code: "CP" } : { heures: l.base_horaire, code: null } });
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
      const sansTaux = lignes.filter((l) => l.actif && l.taux === null).length;
      if (sansTaux && !window.confirm(`${sansTaux} ligne(s) sans taux : leur montant sera vide. Valider quand même ?`)) return;
      if (!window.confirm(`Valider ${NOMS_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)} ? Les montants seront figés.`)) return;
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
                    return sa ? sa.code ?? sa.heures : null;
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
              Ce relevé fait foi et alimente le planning. <strong>⤓</strong> remplit le mois d’une ligne · cliquer-glisser sur des jours puis taper
              une valeur et <strong>Entrée</strong> · <strong>Suppr</strong> vide la sélection · coin orange = la feuille d’heures dit autre chose.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setMois(decalerMois(mois, -1))} aria-label="Mois précédent">◀</button>
            <strong style={{ fontSize: 18, minWidth: 150, textAlign: "center" }}>{nomMois}</strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">▶</button>
            <Link href="/admin/import-prestations" style={{ ...page.btnSecondaire, textDecoration: "none", display: "inline-flex", alignItems: "center" }} title="Le Suivi des prestations (Excel) fait foi : importer ses onglets de mois dans le relevé">
              ⇪ Importer le Suivi des prestations
            </Link>
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
        {!chargement && lignes.length === 0 && (
          <Message genre="info">Aucune prestation ce mois-ci. Ajoutez une ligne (affaire PE / PI × personne) en bas de page.</Message>
        )}

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
          const L_RESTE = 84;
          const L_OUTILS = 98;
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
          const entete: CSSProperties = { ...th, position: "sticky", top: HAUT, zIndex: 3, background: "#f1f2f4", padding: "5px 4px", fontSize: 11 };
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
                    <th rowSpan={2} style={{ ...entete, ...fixeG(L_CMD, L_PERS, "#f1f2f4"), zIndex: 5, textAlign: "left" }}>Pers.</th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_MOIS, L_MOIS, "#f1f2f4"), zIndex: 5, textAlign: "right" }} title="Facturé ce mois-ci, dans l'unité de la ligne (jours ou heures)">
                      Mois
                    </th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_MONTANT, L_MONTANT, "#f1f2f4"), zIndex: 5, textAlign: "right" }}>Montant</th>
                    <th rowSpan={2} style={{ ...entete, ...fixeG(X_RESTE, L_RESTE, "#f1f2f4"), zIndex: 5, textAlign: "right" }} title="Reste sur la commande : celui du Suivi des prestations quand il est connu, sinon commandé − consommé">
                      Reste
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
                        <div style={{ fontSize: j.weekend || j.ferie ? 8 : 11, lineHeight: "15px" }}>{j.jour}</div>
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
                          <Link
                            href={`/affaires/bilan?affaire=${a.type}${numeroBase(a.numero)}&commande=${encodeURIComponent(a.numero)}`}
                            title="Ouvrir la fiche de l’affaire (bilan et pilotage)"
                            style={{ fontWeight: 800, color: C.rougeFonce }}
                          >
                            {numeroFacture(a).numero}
                          </Link>
                          {a.statut === "EN_ATTENTE" && <span style={{ fontSize: 11, color: "#7a3e00", fontWeight: 800 }}>INT.</span>}
                        </span>
                      </td>
                      <td colSpan={nbCol - 1} style={cellule}>
                        <div style={{ position: "sticky", left: L_CMD, display: "inline-flex", alignItems: "center", gap: 10 }}>
                          {peutAgir ? (
                            <select defaultValue="" onChange={(e) => void staffer(a.id, e.target.value)} style={{ ...champ, width: 120 }} aria-label={`Personne pour ${a.numero}`}>
                              <option value="">Personne…</option>
                              {annuaire.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {nomCollab(p)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            "—"
                          )}
                          <span style={{ color: C.gris, fontSize: 13 }}>
                            {a.imputation} · {a.designation}
                            {(() => {
                              const e = enveloppes.get(a.id);
                              return e && e.commande > 0 ? ` · ${formatHeures(e.commande)} commandées` : "";
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
                                        title={nonFacturable ? "Commande pas encore reçue : NON FACTURABLE en l’état" : undefined}
                                        style={{ fontWeight: 800, color: C.rougeFonce, ...(nonFacturable ? { background: "#ffe94d", padding: "0 4px", borderRadius: 3 } : {}) }}
                                      >
                                        {nf?.numero}
                                      </Link>
                                      {a.statut === "EN_ATTENTE" && <span style={{ fontSize: 11, color: "#7a3e00", fontWeight: 800 }}>INT.</span>}
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
                                {ecart && <div style={{ fontSize: 10, color: "#b35c00" }}>feuilles {enUnite(l, c.heuresReel)}</div>}
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
                                {premiere && resteClasseur !== null ? (
                                  <span title={`Reste d’après le Suivi des prestations${ml?.commande_import ? ` (commande ${texteHeures(ml.commande_import)} ${l.unite === "JOUR" ? "j" : "h"})` : ""}${resteCalcul !== null ? ` · calcul de l’application : ${enUnite(l, Math.max(0, resteCalcul))}` : ""}`}>
                                    <Pastille genre={resteClasseur <= 0 ? "crit" : ml?.commande_import && resteClasseur / ml.commande_import < 0.2 ? "warn" : "ok"}>
                                      {texteHeures(resteClasseur)} {l.unite === "JOUR" ? "j" : "h"}
                                    </Pastille>
                                  </span>
                                ) : premiere && env && resteCalcul !== null ? (
                                  <span title={`Commandé ${formatHeures(env.commande)} · facturé avant ${formatHeures(env.avant)} · ce mois ${formatHeures(env.mois)}`}>
                                    <Pastille genre={env.reste <= 0 ? "crit" : env.reste / env.commande < 0.2 ? "warn" : "ok"}>{enUnite(l, Math.max(0, env.reste))}</Pastille>
                                  </span>
                                ) : premiere ? (
                                  <span style={{ color: C.gris, fontSize: 12 }}>non chiffrée</span>
                                ) : null}
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
                                      <button type="button" style={petitOutil} title={`Remplir les jours vides du mois avec ${texteHeures(l.base_horaire)} h (CP sur congé validé)`} onClick={() => remplirLigne(l)}>
                                        ⤓
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
                                const texte = s ? s.code ?? (s.heures !== null ? texteHeures(s.heures) : "") : "";
                                const factureH = s?.heures ?? 0;
                                const r = reelDe(l, j.date);
                                const different = Math.abs(factureH - r) > 0.01 && (factureH > 0 || r > 0);
                                const choisi = selection?.ligne === l.id && selection.jours.has(j.date);
                                const ferme = j.weekend || j.ferie;
                                // congé validé (Validation RH) : proposé en grisé, on peut toujours forcer une autre valeur
                                const conge = !s && absent(l.collaborateur_id, j.date);
                                return (
                                  <td
                                    key={j.date}
                                    onMouseDown={(e) => !verrou && surSourisBas(l, j.date, e.shiftKey)}
                                    onMouseEnter={() => !verrou && surSourisEntre(l, j.date)}
                                    title={different ? `Saisi ${texteHeures(factureH)} h · feuille d’heures ${texteHeures(r)} h` : conge ? "Congé validé : tapez une valeur pour forcer" : undefined}
                                    style={{
                                      ...bordHaut,
                                      padding: 0,
                                      borderBottom: `1px solid ${C.ligne}`,
                                      borderLeft: j.js === 1 ? `2px solid ${C.ligne}` : "1px solid #eef0f3",
                                      background: choisi ? "#fff3c4" : ferme ? "#eceef1" : "#ffffff",
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
                                        fontSize: ferme ? 10 : 13,
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
                    <div key={k}>
                      {k} : <strong>{euros(v)}</strong>
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

            {peutAgir && (
              <section style={{ ...page.carte, padding: 14, flex: "1 1 420px" }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>Ajouter une ligne</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <select value={ajout?.affaire_id ?? ""} onChange={(e) => setAjout({ affaire_id: e.target.value, collaborateur_id: ajout?.collaborateur_id ?? "" })} style={{ ...page.entrees, width: "auto" }} aria-label="Affaire">
                    <option value="">Affaire PE / PI…</option>
                    {affaires.filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE").map((a) => (
                      <option key={a.id} value={a.id}>{a.type} {a.numero} — {a.designation}</option>
                    ))}
                  </select>
                  <select value={ajout?.collaborateur_id ?? ""} onChange={(e) => setAjout({ affaire_id: ajout?.affaire_id ?? "", collaborateur_id: e.target.value })} style={{ ...page.entrees, width: "auto" }} aria-label="Personne">
                    <option value="">Personne…</option>
                    {annuaire.map((c) => (
                      <option key={c.id} value={c.id}>{nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}</option>
                    ))}
                  </select>
                  <button type="button" style={page.btnPrimaire} disabled={!ajout?.affaire_id || !ajout?.collaborateur_id} onClick={() => void ajouterLigne()}>
                    Ajouter
                  </button>
                </div>
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
