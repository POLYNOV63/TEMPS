"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import BilanFinancierAffaire from "@/components/BilanFinancierAffaire";
import HistoriquePEPI from "@/components/HistoriquePEPI";
import SousDossiersAffaire from "@/components/SousDossiersAffaire";
import PanneauPilotageAffaire from "@/components/pilotage/PanneauPilotageAffaire";
import { BadgeType, C, Message, Pastille, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";
import { chargerPlanifie } from "@/lib/pilotageDonnees";

/* ===============================================================
   FICHE AFFAIRE (FICHE_AFFAIRE_V3) - ancien « Bilan affaire »
   (reprend et remplace ORDRE_FICHE et MONTANTS_FICHE_AFFAIRE)

   Pour une affaire (CBE ou DBE), de haut en bas :
   - L'AFFAIRE, en un seul cadre compact (FICHE_COMPACTE) : n°, devis,
     désignation, statut ; « 📅 Voir au planning » (et le relevé PE / PI) ;
     client, réception, responsable et délai (modifiables, PANNEAU_COMPACT,
     historique) ; le pilotage d'un coup d'œil (chiffré, pointé, à venir,
     reste à planifier ou dépassement prévu, avancement estimé, jauge) et
     les points d'attention ; la commande, repliée (mère, filles,
     échéances, dates, statuts, heures commandées par activité).
   - ① LE BILAN DES HEURES : prévu, consommé, planifié, par activité ou
     par commande ; les affectations à venir (qui, quand), comparées au
     chiffré. Pour une PE / PI, l'historique du relevé mois par mois et
     avenant par avenant (HISTORIQUE_PEPI).
   - ② LE DÉTAIL DES HEURES, à onglets : par personne, par mois (courbe du
     cumul face au chiffré), par code, par sous-dossier, semaine par
     semaine.
   - ③ L'ARGENT (BilanFinancierAffaire) : seulement pour la fonction
     « Montants des affaires » ; caché en entier pour les autres.

   CHIFFRÉ : Suivi d'affaire BE (commande de base + avenants retenus),
   par activité ; à défaut, les besoins du Pilotage. POINTÉ : feuilles
   d'heures + historique importé (bilan_affaire_imputations). À VENIR :
   planning des affaires, à partir d'aujourd'hui.
================================================================ */

type TypeAffaire = "CBE" | "DBE";

type Imputation = {
  source: "FEUILLE" | "HISTORIQUE";
  annee: number;
  semaine: number;
  jour: string | null;
  collaborateur_id: string | null;
  trigramme: string | null;
  numero_complet: string;
  code: string;
  activite_id: string | null;
  heures: number;
};

type LigneExcel = {
  cle: string;
  genre: "DEVIS" | "BASE" | "AVENANT" | "LOT" | "ECHEANCE";
  numero_affaire: string | null;
  numero_devis: string | null;
  base_devis: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_id: string | null;
  redacteur: string | null;
  date_ouverture: string | null;
  date_reception_commande: string | null;
  delai: string | null;
  date_livraison_estimee: string | null;
  date_livraison: string | null;
  heures_meca: number;
  heures_calcul: number;
  heures_elec: number;
  heures_pneu: number;
  heures_scan: number;
  heures_autre: number;
  heures_total: number;
  disparue: boolean;
};

type AffairePilotage = {
  id: string;
  statut: string;
  echeance: string | null;
  responsable_id: string;
  au_planning: boolean | null;
  avancement_pct?: number | string | null;
  avancement_le?: string | null;
};

type AVenir = { id: string; personne: string; activiteId: string | null; activite: string; numero: string; du: string; au: string; heures: number };

const COLONNES_EXCEL: { colonne: string; champ: keyof LigneExcel }[] = [
  { colonne: "Méca", champ: "heures_meca" },
  { colonne: "Calcul", champ: "heures_calcul" },
  { colonne: "Elec", champ: "heures_elec" },
  { colonne: "Pneu", champ: "heures_pneu" },
  { colonne: "Scan", champ: "heures_scan" },
  { colonne: "Autre", champ: "heures_autre" },
];

const INACTIFS = ["Devis perdu", "Commande annulée"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const SANS_ACTIVITE = "__sans__";
const auj = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Lundi de la semaine ISO (année ISO, n° de semaine) */
function lundiIso(annee: number, semaine: number): string {
  const simple = new Date(Date.UTC(annee, 0, 4));
  const jour = simple.getUTCDay() || 7;
  simple.setUTCDate(simple.getUTCDate() - jour + 1 + (semaine - 1) * 7);
  return simple.toISOString().slice(0, 10);
}

/* Suffixe d'une imputation : « R2 », « LOT1 », « ECH1 », « R1ECH2 »… ou "" pour la commande de base */
function suffixe(numeroComplet: string): string {
  const m = numeroComplet.replace(/\s/g, "").match(/^(?:CBE|DBE|CAS)?[-:]?\d+(.*)$/i);
  return (m?.[1] ?? "").toUpperCase();
}

/* « 2603 », « DBE2603 » ou « DBE 2603 » -> « DBE2603 » */
function numeroDevis(valeur: string | null | undefined): string | null {
  const m = String(valeur ?? "").toUpperCase().replace(/\s/g, "").match(/^(?:DBE)?(\d+.*)$/);
  return m ? `DBE${m[1]}` : null;
}

function lireAffaireDansUrl(): { type: TypeAffaire; numero: string } | null {
  const brut = new URLSearchParams(window.location.search).get("affaire");
  if (!brut) return null;
  const m = brut.toUpperCase().replace(/\s/g, "").match(/^(CBE|DBE)?(\d+)/);
  if (!m) return null;
  return { type: (m[1] as TypeAffaire) || "CBE", numero: m[2] };
}

/* jauge : pointé (foncé) + planifié (clair), trait noir au chiffré quand on le dépasse */
function Jauge({ chiffre, pointe, prevu, large = 120 }: { chiffre: number; pointe: number; prevu: number; large?: number }) {
  const total = pointe + prevu;
  const echelle = Math.max(chiffre, total, 0.01);
  const au = chiffre > 0 && total > chiffre + 0.01;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        title={`Pointé ${formatHeures(pointe)} + planifié ${formatHeures(prevu)}${chiffre > 0 ? ` sur ${formatHeures(chiffre)} chiffrées` : ""}`}
        style={{ display: "inline-flex", width: large, height: 10, background: "#eef0f3", borderRadius: 5, overflow: "hidden", position: "relative" }}
      >
        <span style={{ width: `${(pointe / echelle) * 100}%`, background: au ? "#b3261e" : "#2e7d32" }} />
        <span style={{ width: `${(prevu / echelle) * 100}%`, background: au ? "#f0a8a2" : "#a8d5ae" }} />
        {au && <span style={{ position: "absolute", left: `${(chiffre / echelle) * 100}%`, top: -2, bottom: -2, borderLeft: "2px solid #1f2328" }} />}
      </span>
      {chiffre > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: au ? C.rougeTexte : C.gris }}>{Math.round((total / chiffre) * 100)} %</span>}
    </span>
  );
}

function TitrePartie({ numero, titre, aide }: { numero: string; titre: string; aide?: string }) {
  return (
    <h2 style={{ margin: "28px 0 12px", fontSize: 22, color: C.rougeFonce, borderBottom: `2px solid ${C.rouge}`, paddingBottom: 4 }}>
      {numero} {titre} {aide && <span style={{ fontSize: 14, fontWeight: 400, color: C.gris }}>{aide}</span>}
    </h2>
  );
}

function BilanContenu() {
  const [type, setType] = useState<TypeAffaire>("CBE");
  const [saisie, setSaisie] = useState("");
  const [affaire, setAffaire] = useState<{ type: TypeAffaire; numero: string } | null>(null);

  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [lignesExcel, setLignesExcel] = useState<LigneExcel[]>([]);
  const [client, setClient] = useState<string | null>(null);
  const [pilotage, setPilotage] = useState<AffairePilotage | null>(null);
  const [chiffrePilotage, setChiffrePilotage] = useState<{ activite_id: string; heures: number }[]>([]);
  const [activites, setActivites] = useState<Map<string, { nom: string; ordre: number }>>(new Map());
  const [correspondance, setCorrespondance] = useState<Map<string, string>>(new Map());
  const [noms, setNoms] = useState<Map<string, string>>(new Map());
  const [suggestions, setSuggestions] = useState<{ cle: string; libelle: string }[]>([]);
  const [filtrePersonne, setFiltrePersonne] = useState("");
  const [libellesCodes, setLibellesCodes] = useState<Map<string, string>>(new Map());
  const [aVenir, setAVenir] = useState<AVenir[]>([]);
  // présentation
  const [commandeOuverte, setCommandeOuverte] = useState(false);
  const [vue, setVue] = useState<"ACTIVITE" | "COMMANDE">("ACTIVITE");
  const [onglet, setOnglet] = useState<"PERSONNE" | "MOIS" | "CODE" | "SOUS_DOSSIER" | "SEMAINE">("PERSONNE");

  useEffect(() => {
    void supabase
      .from("codes_imputation")
      .select("code,libelle")
      .then(({ data }) => setLibellesCodes(new Map(((data ?? []) as { code: string; libelle: string | null }[]).map((c) => [c.code.toUpperCase(), c.libelle ?? ""]))));
  }, []);

  /* Référentiels + liste des affaires pour la saisie assistée */
  useEffect(() => {
    (async () => {
      const [act, cor, sug, col] = await Promise.all([
        supabase.from("activites").select("id,nom,ordre_affichage"),
        supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
        supabase.from("suivi_lignes").select("numero_affaire,designation").eq("genre", "BASE").order("numero_affaire", { ascending: false }).limit(1000),
        supabase.from("collaborateurs").select("id,prenom,nom,trigramme"),
      ]);
      setActivites(new Map(((act.data ?? []) as { id: string; nom: string; ordre_affichage: number }[]).map((a) => [a.id, { nom: a.nom, ordre: a.ordre_affichage }])));
      setCorrespondance(
        new Map(((cor.data ?? []) as { colonne_excel: string; activite_id: string | null }[]).filter((c) => c.activite_id).map((c) => [c.colonne_excel, c.activite_id as string]))
      );
      setSuggestions(
        ((sug.data ?? []) as { numero_affaire: string | null; designation: string | null }[]).filter((s) => s.numero_affaire).map((s) => ({ cle: s.numero_affaire as string, libelle: s.designation ?? "" }))
      );
      setNoms(
        new Map(((col.data ?? []) as { id: string; prenom: string | null; nom: string | null; trigramme: string | null }[]).map((c) => [c.id, c.trigramme || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim()]))
      );
    })();

    const depuisUrl = lireAffaireDansUrl();
    if (depuisUrl) {
      setType(depuisUrl.type);
      setSaisie(depuisUrl.numero);
      setAffaire(depuisUrl);
    }
  }, []);

  /* Chargement d'une affaire */
  const charger = useCallback(async (cible: { type: TypeAffaire; numero: string }) => {
    setChargement(true);
    setErreur("");
    setFiltrePersonne("");

    try {
      const num = cible.numero.replace(/^0+/, "");

      const [imp, excel, pil] = await Promise.all([
        supabase.rpc("bilan_affaire_imputations", { p_type: cible.type, p_numero: num }),
        supabase
          .from("suivi_lignes")
          .select(
            "cle,genre,numero_affaire,numero_devis,base_devis,statut,imputation,designation,client_id,redacteur,date_ouverture,date_reception_commande,delai,date_livraison_estimee,date_livraison,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre,heures_total,disparue"
          )
          .eq(cible.type === "CBE" ? "base_affaire" : "base_devis", num),
        supabase.from("pilotage_affaires").select("*").eq("type", cible.type),
      ]);

      if (imp.error) throw new Error(imp.error.message);

      setImputations(((imp.data ?? []) as Imputation[]).map((r) => ({ ...r, heures: Number(r.heures) || 0 })));

      const lignes = ((excel.data ?? []) as LigneExcel[])
        .filter((l) => (cible.type === "CBE" ? true : l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT"))
        .map((l) => ({
          ...l,
          heures_meca: Number(l.heures_meca) || 0,
          heures_calcul: Number(l.heures_calcul) || 0,
          heures_elec: Number(l.heures_elec) || 0,
          heures_pneu: Number(l.heures_pneu) || 0,
          heures_scan: Number(l.heures_scan) || 0,
          heures_autre: Number(l.heures_autre) || 0,
          heures_total: Number(l.heures_total) || 0,
        }));
      const ordre = { BASE: 0, DEVIS: 0, AVENANT: 1, LOT: 2, ECHEANCE: 3 } as const;
      lignes.sort((a, b) => ordre[a.genre] - ordre[b.genre] || a.cle.localeCompare(b.cle, "fr", { numeric: true }));
      setLignesExcel(lignes);

      const base = lignes.find((l) => l.genre === "BASE") ?? lignes[0];
      if (base?.client_id) {
        const { data } = await supabase.from("suivi_clients").select("nom_abrege").eq("id", base.client_id).maybeSingle();
        setClient((data as { nom_abrege: string } | null)?.nom_abrege ?? null);
      } else setClient(null);

      const p = ((pil.data ?? []) as (AffairePilotage & { numero: string })[]).find((a) => a.numero.replace(/^0+/, "") === num) ?? null;
      setPilotage(p);

      if (p) {
        const { data } = await supabase.from("pilotage_charges").select("activite_id,heures").eq("affaire_id", p.id);
        setChiffrePilotage(((data ?? []) as { activite_id: string; heures: number }[]).map((c) => ({ ...c, heures: Number(c.heures) || 0 })));
      } else setChiffrePilotage([]);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Impossible de charger la fiche.");
      setImputations([]);
      setLignesExcel([]);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (affaire) void charger(affaire);
  }, [affaire, charger]);

  /* Planifié à venir de la famille, affectation par affectation (qui, quelle activité, quelle commande, du… au…) */
  useEffect(() => {
    if (!affaire) return;
    let actif = true;
    void (async () => {
      const a0 = auj();
      const base = affaire.numero.replace(/^0+/, "");
      const { data: afs } = await supabase.from("pilotage_affaires").select("id,numero").eq("type", affaire.type);
      const famille = new Map(
        ((afs ?? []) as { id: string; numero: string }[]).filter((a) => (a.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "") === base).map((a) => [a.id, a.numero.toUpperCase().replace(/^0+/, "")])
      );
      if (famille.size === 0) {
        if (actif) setAVenir([]);
        return;
      }
      const pl = await chargerPlanifie(a0);
      const res: AVenir[] = [];
      for (const a of pl.affectations) {
        if (!a.affaire_id || !famille.has(a.affaire_id)) continue;
        const js = pl.jours.filter((j) => j.affectation_id === a.id && j.jour >= a0 && (Number(j.heures) || 0) > 0);
        if (js.length === 0) continue;
        const dates = js.map((j) => j.jour).sort();
        const x = a as unknown as { collaborateur_id?: string | null; activite_id?: string | null };
        res.push({
          id: a.id,
          personne: (x.collaborateur_id && noms.get(x.collaborateur_id)) || "—",
          activiteId: x.activite_id ?? null,
          activite: (x.activite_id && activites.get(x.activite_id)?.nom) || "—",
          numero: famille.get(a.affaire_id) ?? "",
          du: dates[0],
          au: dates[dates.length - 1],
          heures: js.reduce((s, j) => s + (Number(j.heures) || 0), 0),
        });
      }
      res.sort((p, q) => p.du.localeCompare(q.du) || p.personne.localeCompare(q.personne, "fr"));
      if (actif) setAVenir(res);
    })().catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [affaire, noms, activites]);

  function rechercher(e: FormEvent) {
    e.preventDefault();
    const m = saisie.toUpperCase().replace(/\s/g, "").match(/^(CBE|DBE)?(\d+)/);
    if (!m) {
      setErreur("Saisissez un numéro d’affaire, par exemple 1533 ou CBE1533.");
      return;
    }
    const cible = { type: ((m[1] as TypeAffaire) || type) as TypeAffaire, numero: m[2] };
    setType(cible.type);
    setAffaire(cible);
    window.history.replaceState(null, "", `?affaire=${cible.type}${cible.numero}`);
  }

  /* ------------------------------ calculs ------------------------------ */

  const nomActivite = useCallback((id: string) => (id === SANS_ACTIVITE ? "Sans activité (code non rattaché)" : activites.get(id)?.nom ?? "Activité"), [activites]);

  const comptees = useMemo(() => lignesExcel.filter((l) => !l.disparue && (l.genre === "BASE" || l.genre === "AVENANT") && !INACTIFS.includes(l.statut ?? "")), [lignesExcel]);

  const bilan = useMemo(() => {
    const chiffre = new Map<string, number>();
    let chiffreNonRattache = 0;
    const sourceChiffre: "EXCEL" | "PILOTAGE" | "AUCUN" = comptees.length > 0 ? "EXCEL" : chiffrePilotage.length > 0 ? "PILOTAGE" : "AUCUN";

    if (sourceChiffre === "EXCEL") {
      for (const l of comptees) {
        for (const { colonne, champ } of COLONNES_EXCEL) {
          const h = Number(l[champ]) || 0;
          if (h === 0) continue;
          const act = correspondance.get(colonne);
          if (act) chiffre.set(act, (chiffre.get(act) ?? 0) + h);
          else chiffreNonRattache += h;
        }
        const detail = COLONNES_EXCEL.reduce((t, { champ }) => t + (Number(l[champ]) || 0), 0);
        if (l.heures_total > detail + 0.01) chiffreNonRattache += l.heures_total - detail;
      }
    } else if (sourceChiffre === "PILOTAGE") {
      for (const c of chiffrePilotage) chiffre.set(c.activite_id, (chiffre.get(c.activite_id) ?? 0) + c.heures);
    }

    const realise = new Map<string, number>();
    for (const i of imputations) {
      const k = i.activite_id ?? SANS_ACTIVITE;
      realise.set(k, (realise.get(k) ?? 0) + i.heures);
    }

    // négoce et scan sont vendus au montant
    const auMontantNom = (nom?: string) => /^(negoce|scan)/.test((nom ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());
    const imputationBase = (lignesExcel.find((l) => l.genre === "BASE") ?? lignesExcel[0])?.imputation ?? undefined;
    const toutAuMontant = auMontantNom(imputationBase);
    const auMontant = new Set([...realise.keys()].filter((id) => auMontantNom(activites.get(id)?.nom)));
    const horsComparaison = toutAuMontant ? 0 : [...auMontant].filter((id) => (chiffre.get(id) ?? 0) <= 0).reduce((t, id) => t + (realise.get(id) ?? 0), 0);
    const ids = new Set([...chiffre.keys(), ...realise.keys()]);
    const parActivite = [...ids]
      .map((id) => ({ id, nom: nomActivite(id), ordre: activites.get(id)?.ordre ?? 999, chiffre: chiffre.get(id) ?? 0, realise: realise.get(id) ?? 0 }))
      .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, "fr"));

    const totalChiffre = [...chiffre.values()].reduce((t, v) => t + v, 0) + chiffreNonRattache;
    const totalRealise = imputations.reduce((t, i) => t + i.heures, 0);
    const codesSans = [...new Set(imputations.filter((i) => !i.activite_id).map((i) => i.code))].sort();

    const parPersonne = new Map<string, { nom: string; heures: number; premiere: string; derniere: string; parActivite: Map<string, number> }>();
    for (const i of imputations) {
      const cle = i.collaborateur_id ?? "__autres__";
      const date = i.jour ?? lundiIso(i.annee, i.semaine);
      const p = parPersonne.get(cle) ?? { nom: i.collaborateur_id ? i.trigramme ?? noms.get(i.collaborateur_id) ?? "?" : "Autres collaborateurs", heures: 0, premiere: date, derniere: date, parActivite: new Map() };
      p.heures += i.heures;
      if (date < p.premiere) p.premiere = date;
      if (date > p.derniere) p.derniere = date;
      const a = i.activite_id ?? SANS_ACTIVITE;
      p.parActivite.set(a, (p.parActivite.get(a) ?? 0) + i.heures);
      parPersonne.set(cle, p);
    }

    const parMois = new Map<string, number>();
    for (const i of imputations) {
      const m = (i.jour ?? lundiIso(i.annee, i.semaine)).slice(0, 7);
      parMois.set(m, (parMois.get(m) ?? 0) + i.heures);
    }
    let cumul = 0;
    const evolution = [...parMois.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, h]) => {
      cumul += h;
      return { mois: m, heures: h, cumul };
    });

    const parSuffixe = new Map<string, number>();
    for (const i of imputations) {
      const s = suffixe(i.numero_complet);
      parSuffixe.set(s, (parSuffixe.get(s) ?? 0) + i.heures);
    }

    return {
      toutAuMontant,
      auMontant,
      horsComparaison,
      realiseCompare: totalRealise - horsComparaison,
      sourceChiffre,
      parActivite,
      chiffreNonRattache,
      totalChiffre,
      totalRealise,
      codesSans,
      parPersonne: [...parPersonne.entries()].map(([cle, p]) => ({ cle, ...p })).sort((a, b) => b.heures - a.heures),
      evolution,
      parSuffixe,
      sources: {
        feuilles: imputations.filter((i) => i.source === "FEUILLE").reduce((t, i) => t + i.heures, 0),
        historique: imputations.filter((i) => i.source === "HISTORIQUE").reduce((t, i) => t + i.heures, 0),
      },
    };
  }, [comptees, chiffrePilotage, correspondance, imputations, activites, nomActivite, noms, lignesExcel]);

  const detail = useMemo(() => {
    const m = new Map<string, { semaine: string; personne: string; cle: string; numero: string; code: string; activite: string; heures: number; source: string }>();
    for (const i of imputations) {
      const personne = i.collaborateur_id ? i.trigramme ?? "?" : "Autres";
      if (filtrePersonne && (i.collaborateur_id ?? "__autres__") !== filtrePersonne) continue;
      const lundi = i.jour ? i.jour : lundiIso(i.annee, i.semaine);
      const semaine = `${i.annee}-S${String(i.semaine).padStart(2, "0")}`;
      const k = `${semaine}|${personne}|${i.numero_complet}|${i.code}`;
      const e = m.get(k) ?? { semaine, personne, cle: lundi, numero: i.numero_complet, code: i.code, activite: nomActivite(i.activite_id ?? SANS_ACTIVITE), heures: 0, source: i.source === "FEUILLE" ? "Feuille" : "Historique" };
      e.heures += i.heures;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.semaine.localeCompare(a.semaine) || a.personne.localeCompare(b.personne));
  }, [imputations, filtrePersonne, nomActivite]);

  /* ------------------------------ rendu ------------------------------ */

  const base = lignesExcel.find((l) => l.genre === "BASE") ?? lignesExcel[0] ?? null;
  const devis = affaire?.type === "CBE" ? numeroDevis(base?.base_devis ?? base?.numero_devis) : null;
  /* STATUT_FAMILLE : pour une famille (base + avenants), la commande qui vit encore (la plus récente pas
     livrée) donne le statut et le délai de l'en-tête ; la base livrée ne fait pas croire l'affaire terminée */
  const commandeActive =
    [...comptees].filter((l) => l.statut !== "Livrée").sort((a, b) => String(a.numero_affaire ?? a.cle).localeCompare(String(b.numero_affaire ?? b.cle), "fr", { numeric: true })).slice(-1)[0] ?? null;
  const livreesFamille = comptees.filter((l) => l.statut === "Livrée");
  const echeance = (() => {
    if (commandeActive && comptees.length > 1) return commandeActive.delai ?? commandeActive.date_livraison_estimee ?? null;
    const dates = comptees.map((l) => l.delai ?? l.date_livraison_estimee).filter((d): d is string => Boolean(d)).sort();
    return pilotage?.echeance ?? dates[dates.length - 1] ?? null;
  })();
  const livree = comptees.length > 0 && comptees.every((l) => l.statut === "Livrée");
  const dateLivraison = livree ? comptees.map((l) => l.date_livraison).filter(Boolean).sort().slice(-1)[0] ?? null : null;
  const maxMois = Math.max(1, ...bilan.evolution.map((m) => m.heures));

  // planifié à venir
  const planifieTotal = aVenir.reduce((s, x) => s + x.heures, 0);
  const planifieParNumero = new Map<string, number>();
  const planifieParActivite = new Map<string, number>();
  for (const x of aVenir) {
    planifieParNumero.set(x.numero, (planifieParNumero.get(x.numero) ?? 0) + x.heures);
    const k = x.activiteId ?? SANS_ACTIVITE;
    planifieParActivite.set(k, (planifieParActivite.get(k) ?? 0) + x.heures);
  }
  const finPlanifiee = aVenir.length > 0 ? aVenir.map((x) => x.au).sort().slice(-1)[0] : null;
  const pointe = bilan.toutAuMontant ? bilan.totalRealise : bilan.realiseCompare;
  const resteAPlanifier = bilan.totalChiffre - pointe - planifieTotal;
  const depassementPrevu = !bilan.toutAuMontant && bilan.totalChiffre > 0 ? Math.max(0, pointe + planifieTotal - bilan.totalChiffre) : 0;
  const avancement = pilotage?.avancement_pct !== null && pilotage?.avancement_pct !== undefined ? Number(pilotage.avancement_pct) : null;
  const consommePct = bilan.totalChiffre > 0 ? (pointe / bilan.totalChiffre) * 100 : null;

  // points d'attention
  const attention: { texte: string; grave: boolean }[] = [];
  if (affaire?.type === "CBE" && !livree) {
    if (lignesExcel.some((l) => l.statut === "Intention de commande") && bilan.totalRealise > 0.5)
      attention.push({ texte: `Intention de commande, mais ${formatHeures(bilan.totalRealise)} déjà pointées : travail à risque tant que la commande n’est pas reçue.`, grave: true });
    if (echeance && echeance < auj()) attention.push({ texte: `Délai dépassé (${formatDate(echeance)}) et pas encore livrée.`, grave: true });
    if (finPlanifiee && echeance && finPlanifiee > echeance) attention.push({ texte: `Le planifié court jusqu’au ${formatDate(finPlanifiee)}, après le délai du ${formatDate(echeance)}.`, grave: true });
    if (depassementPrevu > 0.5) attention.push({ texte: `Dépassement prévu : pointé + planifié dépassent le chiffré de ${formatHeures(depassementPrevu)}.`, grave: true });
    if (avancement !== null && consommePct !== null && consommePct - avancement > 15)
      attention.push({ texte: `${Math.round(consommePct)} % des heures consommées pour ${Math.round(avancement)} % d’avancement estimé : dérive à surveiller.`, grave: true });
  }
  if (bilan.codesSans.length > 0) attention.push({ texte: `Codes pointés sans activité : ${bilan.codesSans.join(", ")} (à rattacher dans Gestion des activités).`, grave: false });

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "10px 8px" };
  const thN: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "9px 8px" };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const bascule = (actif: boolean): CSSProperties => ({
    minHeight: 34,
    padding: "0 14px",
    borderRadius: 999,
    border: `1.5px solid ${actif ? C.rouge : "#c9cdd2"}`,
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  });
  const reste = (h: number): ReactNode => (bilan.toutAuMontant ? "—" : h < -0.01 ? <strong style={{ color: C.rougeTexte }}>+{formatHeures(-h)} au-delà</strong> : formatHeures(h));
  const nature = (l: LigneExcel) => (l.genre === "BASE" ? "Commande" : l.genre === "AVENANT" ? "Avenant" : l.genre === "LOT" ? "Lot" : l.genre === "ECHEANCE" ? "Échéance" : "Devis");
  const cleNumero = (l: LigneExcel) => String(l.numero_affaire ?? "").toUpperCase().replace(/^(CBE|DBE)/, "").replace(/^0+/, "");

  // répartition du pointé de la famille : la commande, puis chaque avenant dans l'ordre
  const reparti = new Map<string, number>();
  {
    let restant = pointe;
    comptees.forEach((l, i) => {
      const p = i === comptees.length - 1 ? restant : Math.min(l.heures_total, restant);
      reparti.set(l.cle, Math.max(0, p));
      restant -= p;
    });
  }

  return (
    <main style={page.fond} className="bilan-page">
      <style>{CSS_MOBILE_BILAN}</style>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="bilan" />

      <div className="bilan-contenu" style={{ ...page.contenu, maxWidth: 1200 }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={page.titre}>Fiche affaire</h1>
        </div>

        <form onSubmit={rechercher} style={{ ...page.carte, padding: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
          {(["CBE", "DBE"] as TypeAffaire[]).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} style={{ ...bascule(type === t), minHeight: 44, borderRadius: 8, fontSize: 15 }}>
              {t}
            </button>
          ))}
          <input
            list="bilan-affaires"
            aria-label="Numéro d’affaire"
            placeholder="N° d’affaire, ex. 1533"
            value={saisie}
            onChange={(e) => {
              const v = e.target.value;
              setSaisie(v);
              if (suggestions.some((s) => s.cle === v)) {
                const m = v.toUpperCase().replace(/\s/g, "").match(/^(CBE|DBE)?(\d+)/);
                if (m) {
                  const cible = { type: ((m[1] as TypeAffaire) || type) as TypeAffaire, numero: m[2] };
                  setType(cible.type);
                  setAffaire(cible);
                  window.history.replaceState(null, "", `?affaire=${cible.type}${cible.numero}`);
                }
              }
            }}
            style={{ ...page.entrees, maxWidth: 260 }}
          />
          <datalist id="bilan-affaires">
            {suggestions.map((s) => (
              <option key={s.cle} value={s.cle}>
                {s.libelle}
              </option>
            ))}
          </datalist>
          <button type="submit" style={page.btnPrimaire} disabled={chargement}>
            {chargement ? "Chargement…" : affaire ? "Ouvrir une autre affaire" : "Ouvrir"}
          </button>
        </form>

        {erreur && <Message genre="erreur">{erreur}</Message>}

        {affaire && !chargement && !erreur && (
          <>
            {/* ================= L'AFFAIRE (FICHE_COMPACTE) : identité, pilotage et commande, en un seul cadre ================= */}
            {(() => {
              const cols = COLONNES_EXCEL.filter(({ champ }) => lignesExcel.some((l) => (Number(l[champ]) || 0) > 0));
              const ordreL = [...lignesExcel].sort((a, b) => (a.numero_affaire ?? a.cle).localeCompare(b.numero_affaire ?? b.cle, "fr", { numeric: true }));
              const meres = ordreL.filter((l) => l.genre !== "LOT" && l.genre !== "ECHEANCE");
              const num = (l: LigneExcel) => String(l.numero_affaire ?? l.cle).toUpperCase();
              const filles = (l: LigneExcel) =>
                ordreL.filter((d) => (d.genre === "LOT" || d.genre === "ECHEANCE") && num(d).startsWith(num(l)) && !meres.some((m) => m !== l && num(m).length > num(l).length && num(d).startsWith(num(m))));
              const nbCommandes = meres.filter((l) => l.genre !== "DEVIS").length;
              const nbAvenants = meres.filter((l) => l.genre === "AVENANT").length;
              const nbDecoupes = ordreL.length - meres.length;
              const prestation = base?.imputation === "PE" || base?.imputation === "PI";
              const bouton: CSSProperties = { ...page.btnSecondaire, minHeight: 36, fontSize: 14, textDecoration: "none", display: "inline-flex", alignItems: "center" };
              const chiffre = (libelle: string, valeur: string, sous?: string, rouge?: boolean) => (
                <div style={{ minWidth: 110 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>{libelle}</div>
                  <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15, color: rouge ? C.rougeTexte : "#1f2328" }}>{valeur}</div>
                  {sous && <div style={{ fontSize: 12, color: C.gris }}>{sous}</div>}
                </div>
              );
              const ligne = (l: LigneExcel, fille: boolean) => {
                const compte = comptees.includes(l);
                const intention = l.statut === "Intention de commande";
                return (
                  <tr key={l.cle} style={{ opacity: l.disparue || (!fille && !compte && l.genre !== "DEVIS") ? 0.55 : 1, background: fille ? undefined : "#fafbfc" }}>
                    <td style={{ ...td, whiteSpace: "nowrap", paddingLeft: fille ? 26 : 8 }}>
                      {fille ? "↳ " : ""}
                      <span style={{ fontWeight: fille ? 600 : 800, color: C.rougeFonce, ...(intention ? { background: "#ffe58a", borderRadius: 3, padding: "0 4px" } : {}) }}>{l.numero_affaire ?? l.numero_devis ?? l.cle}</span>
                      <span style={{ fontSize: 12, color: C.gris }}> {nature(l)}</span>
                    </td>
                    <td style={td}>
                      {l.statut ?? "—"}
                      {!fille && !compte && (l.genre === "BASE" || l.genre === "AVENANT") && <div style={{ fontSize: 12, color: C.gris }}>non retenue dans le chiffré</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(l.date_reception_commande)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(l.delai ?? l.date_livraison_estimee)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: l.date_livraison ? "#1b5e20" : undefined }}>{l.date_livraison ? `✓ ${formatDate(l.date_livraison)}` : "—"}</td>
                    {cols.map(({ colonne, champ }) => (
                      <td key={colonne} style={tdN}>
                        {fille ? "" : (Number(l[champ]) || 0) > 0 ? formatHeures(Number(l[champ])) : "—"}
                      </td>
                    ))}
                    <td style={{ ...tdN, fontWeight: 800 }}>{fille || l.genre === "DEVIS" ? "" : formatHeures(l.heures_total)}</td>
                  </tr>
                );
              };
              return (
                <section style={{ ...page.carte, padding: "14px 18px", marginBottom: 16 }}>
                  {/* l'affaire, et les raccourcis */}
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <BadgeType type={affaire.type} />
                    <span style={{ fontSize: 24, fontWeight: 800, color: C.rougeFonce }}>{affaire.numero}</span>
                    {devis && <span title="Devis d'origine (Suivi d'affaire BE)" style={{ fontSize: 15, fontWeight: 800, color: C.gris }}>{devis}</span>}
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{base?.designation ?? ""}</span>
                    {livree ? (
                      <Pastille genre="info">
                        {comptees.length > 1 ? "Toutes les commandes livrées" : "Livrée"}
                        {dateLivraison ? ` · dernière le ${formatDate(dateLivraison)}` : ""}
                      </Pastille>
                    ) : commandeActive && comptees.length > 1 ? (
                      <>
                        <Pastille genre="info">
                          {commandeActive.statut ?? "En cours"} · {commandeActive.numero_affaire ?? commandeActive.cle}
                        </Pastille>
                        {livreesFamille.length > 0 && (
                          <span style={{ fontSize: 13, color: C.gris }}>
                            {livreesFamille.map((l) => l.numero_affaire ?? l.cle).join(", ")} livrée{livreesFamille.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </>
                    ) : base?.statut ? (
                      <Pastille genre="info">{base.statut}</Pastille>
                    ) : null}
                    <span style={{ flex: 1 }} />
                    {/* LIEN_PLANNING : l'affaire au planning, dépliée sur ses affectations */}
                    <Link href={pilotage ? `/pilotage/affaires?ouvrir=${pilotage.id}` : "/pilotage/affaires"} style={bouton}>
                      📅 Voir au planning
                    </Link>
                    {prestation && (
                      <Link href={`/pilotage/prestations?affaire=${encodeURIComponent(affaire.numero)}`} style={bouton}>
                        📋 Relevé PE / PI
                      </Link>
                    )}
                  </div>

                  {/* qui, quand : client, réception, responsable et délai (modifiables) */}
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 22px", marginTop: 8, fontSize: 14 }}>
                    {client && (
                      <span>
                        <span style={{ color: C.gris }}>Client</span> <strong>{client}</strong>
                      </span>
                    )}
                    {base?.imputation && (
                      <span>
                        <span style={{ color: C.gris }}>Imputation</span> <strong>{base.imputation}</strong>
                      </span>
                    )}
                    {base?.date_reception_commande && (
                      <span>
                        <span style={{ color: C.gris }}>Reçue le</span> <strong>{formatDate(base.date_reception_commande)}</strong>
                      </span>
                    )}
                    {pilotage ? (
                      <PanneauPilotageAffaire type={affaire.type} base={affaire.numero} compact />
                    ) : (
                      echeance && (
                        <span>
                          <span style={{ color: C.gris }}>Délai</span> <strong>{formatDate(echeance)}</strong>
                        </span>
                      )
                    )}
                    {base?.redacteur && (
                      <span>
                        <span style={{ color: C.gris }}>Devis rédigé par</span> <strong>{base.redacteur}</strong>
                      </span>
                    )}
                  </div>

                  {/* PILOTAGE_COUP_D_OEIL */}
                  {affaire.type === "CBE" && (bilan.totalChiffre > 0 || bilan.totalRealise > 0) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 26px", alignItems: "flex-end", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.ligne}` }}>
                      {chiffre("Chiffré", bilan.totalChiffre > 0 ? formatHeures(bilan.totalChiffre) : "—")}
                      {chiffre("Pointé", formatHeures(bilan.totalRealise))}
                      {chiffre("À venir", planifieTotal > 0.01 ? formatHeures(planifieTotal) : "—", finPlanifiee ? `jusqu’au ${formatDate(finPlanifiee)}` : undefined)}
                      {!bilan.toutAuMontant &&
                        bilan.totalChiffre > 0 &&
                        chiffre(resteAPlanifier < -0.01 ? "Dépassement prévu" : "Reste à planifier", formatHeures(Math.abs(resteAPlanifier)), undefined, resteAPlanifier < -0.01)}
                      {avancement !== null && chiffre("Avancement estimé", `${Math.round(avancement)} %`, consommePct !== null ? `pour ${Math.round(consommePct)} % consommé` : undefined)}
                      {!bilan.toutAuMontant && bilan.totalChiffre > 0 && (
                        <div style={{ flex: "1 1 200px", paddingBottom: 4 }}>
                          <Jauge chiffre={bilan.totalChiffre} pointe={pointe} prevu={planifieTotal} large={220} />
                        </div>
                      )}
                      {bilan.toutAuMontant && <span style={{ fontSize: 13, color: C.gris, paddingBottom: 4 }}>vendu au montant : temps passé, sans comparaison au chiffré</span>}
                    </div>
                  )}
                  {attention.length > 0 && (
                    <ul style={{ margin: "10px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 3 }}>
                      {attention.map((a) => (
                        <li key={a.texte} style={{ fontSize: 13.5, color: a.grave ? "#8d1d16" : "#7a3e00" }}>
                          {a.grave ? "⚠" : "•"} {a.texte}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* la commande, repliée */}
                  {lignesExcel.length > 0 && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.ligne}`, overflowX: "auto" }}>
                      <button type="button" aria-expanded={commandeOuverte} onClick={() => setCommandeOuverte((v) => !v)} style={{ all: "unset", cursor: "pointer", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontWeight: 800, color: C.rougeFonce }}>{commandeOuverte ? "▾" : "▸"}</span>
                        <strong style={{ fontSize: 14.5 }}>
                          {nbCommandes} commande{nbCommandes > 1 ? "s" : ""}
                          {nbAvenants > 0 ? ` (dont ${nbAvenants} avenant${nbAvenants > 1 ? "s" : ""})` : ""}
                          {nbDecoupes > 0 ? ` · ${nbDecoupes} échéance${nbDecoupes > 1 ? "s" : ""} ou lot${nbDecoupes > 1 ? "s" : ""}` : ""}
                        </strong>
                        <span style={{ fontSize: 13.5, color: C.gris }}>
                          {comptees.length > 0 ? `${formatHeures(comptees.reduce((s, l) => s + l.heures_total, 0))} commandées · ` : ""}dates, statuts, heures par activité
                        </span>
                      </button>
                      {commandeOuverte && (
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, marginTop: 10 }}>
                          <thead>
                            <tr>
                              <th style={th}>N°</th>
                              <th style={th}>Statut</th>
                              <th style={th}>Reçue le</th>
                              <th style={th}>Délai</th>
                              <th style={th}>Livrée le</th>
                              {cols.map(({ colonne }) => (
                                <th key={colonne} style={thN}>
                                  {colonne}
                                </th>
                              ))}
                              <th style={thN}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {meres.flatMap((l) => [ligne(l, false), ...filles(l).map((d) => ligne(d, true))])}
                            {comptees.length > 1 && (
                              <tr>
                                <td colSpan={5} style={{ ...td, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>
                                  Toute la famille (commandes retenues)
                                </td>
                                {cols.map(({ colonne, champ }) => (
                                  <td key={colonne} style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>
                                    {formatHeures(comptees.reduce((s, l) => s + (Number(l[champ]) || 0), 0))}
                                  </td>
                                ))}
                                <td style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(comptees.reduce((s, l) => s + l.heures_total, 0))}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </section>
              );
            })()}

            {lignesExcel.length === 0 && bilan.sourceChiffre === "AUCUN" && (
              <Message genre="info">Cette affaire n’est pas dans le Suivi d’affaire BE (antérieure au 01/11/2024, ou numéro inconnu) : pas d’heures chiffrées, seul le pointé est affiché.</Message>
            )}
            {bilan.sourceChiffre === "PILOTAGE" && <Message genre="info">Chiffré tiré des besoins saisis dans le Pilotage BE (pas de ligne dans le Suivi d’affaire).</Message>}
            {affaire.type === "DBE" && <Message genre="info">Un DBE n’a pas d’heures chiffrées à produire : on mesure ici le temps passé à préparer le devis.</Message>}

            {/* ================= ② PRÉVU, CONSOMMÉ, PLANIFIÉ ================= */}
            <TitrePartie numero="①" titre="Le bilan des heures" aide="prévu, consommé, planifié" />
            <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <button type="button" aria-pressed={vue === "ACTIVITE"} onClick={() => setVue("ACTIVITE")} style={bascule(vue === "ACTIVITE")}>
                  Par activité
                </button>
                {comptees.length > 0 && (
                  <button type="button" aria-pressed={vue === "COMMANDE"} onClick={() => setVue("COMMANDE")} style={bascule(vue === "COMMANDE")}>
                    Par commande
                  </button>
                )}
                <span style={{ fontSize: 13, color: C.gris }}>planifié : planning des affaires, à partir d’aujourd’hui</span>
              </div>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={th}>{vue === "ACTIVITE" ? "Activité" : "Commande"}</th>
                    <th style={thN}>Chiffré</th>
                    <th style={thN}>Pointé</th>
                    <th style={thN}>Planifié</th>
                    <th style={thN}>Pointé + planifié</th>
                    <th style={thN}>Écart prévu</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {vue === "ACTIVITE"
                    ? bilan.parActivite.map((a) => {
                        const pl = planifieParActivite.get(a.id) ?? 0;
                        const info = bilan.toutAuMontant || (bilan.auMontant.has(a.id) && a.chiffre <= 0);
                        const ecart = a.chiffre - a.realise - pl;
                        return (
                          <tr key={a.id}>
                            <td style={{ ...td, fontWeight: 800 }}>{a.nom}</td>
                            <td style={tdN}>{a.chiffre > 0 ? formatHeures(a.chiffre) : "—"}</td>
                            <td style={tdN}>{a.realise > 0 ? formatHeures(a.realise) : "—"}</td>
                            <td style={tdN}>{pl > 0.01 ? formatHeures(pl) : "—"}</td>
                            <td style={{ ...tdN, fontWeight: 700 }}>{a.realise + pl > 0.01 ? formatHeures(a.realise + pl) : "—"}</td>
                            <td style={{ ...tdN, color: info ? C.gris : undefined }}>{info ? "vendu au montant" : a.chiffre > 0 ? reste(ecart) : a.realise > 0 ? "non chiffré" : "—"}</td>
                            <td style={td}>{a.chiffre > 0 && !info ? <Jauge chiffre={a.chiffre} pointe={a.realise} prevu={pl} /> : null}</td>
                          </tr>
                        );
                      })
                    : comptees.map((l) => {
                        const p = reparti.get(l.cle) ?? 0;
                        const pl = planifieParNumero.get(cleNumero(l)) ?? 0;
                        return (
                          <tr key={l.cle}>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>
                              <span style={{ fontWeight: 800, color: C.rougeFonce, ...(l.statut === "Intention de commande" ? { background: "#ffe58a", borderRadius: 3, padding: "0 4px" } : {}) }}>{l.numero_affaire ?? l.cle}</span>
                              <span style={{ fontSize: 12, color: C.gris }}> · {l.statut ?? nature(l)}</span>
                            </td>
                            <td style={tdN}>{formatHeures(l.heures_total)}</td>
                            <td style={tdN}>{formatHeures(p)}</td>
                            <td style={tdN}>{pl > 0.01 ? formatHeures(pl) : "—"}</td>
                            <td style={{ ...tdN, fontWeight: 700 }}>{formatHeures(p + pl)}</td>
                            <td style={tdN}>{reste(l.heures_total - p - pl)}</td>
                            <td style={td}>{l.heures_total > 0 && !bilan.toutAuMontant ? <Jauge chiffre={l.heures_total} pointe={p} prevu={pl} /> : null}</td>
                          </tr>
                        );
                      })}
                  {vue === "ACTIVITE" && bilan.chiffreNonRattache > 0.01 && (
                    <tr>
                      <td style={td}>
                        <strong>Chiffré non rattaché</strong>
                        <div style={{ fontSize: 12, color: C.gris }}>colonne Excel sans activité (ex. « Autre ») ou heures non ventilées</div>
                      </td>
                      <td style={tdN}>{formatHeures(bilan.chiffreNonRattache)}</td>
                      <td colSpan={5} style={td} />
                    </tr>
                  )}
                  <tr>
                    <td style={{ ...td, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>Total</td>
                    <td style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{bilan.totalChiffre > 0 ? formatHeures(bilan.totalChiffre) : "—"}</td>
                    <td style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(bilan.totalRealise)}</td>
                    <td style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{planifieTotal > 0.01 ? formatHeures(planifieTotal) : "—"}</td>
                    <td style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(bilan.totalRealise + planifieTotal)}</td>
                    <td style={{ ...tdN, fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{bilan.totalChiffre > 0 ? reste(resteAPlanifier) : "—"}</td>
                    <td style={{ ...td, borderTop: `2px solid ${C.ligne}` }}>{bilan.totalChiffre > 0 && !bilan.toutAuMontant ? <Jauge chiffre={bilan.totalChiffre} pointe={pointe} prevu={planifieTotal} /> : null}</td>
                  </tr>
                </tbody>
              </table>
              {vue === "COMMANDE" && <p style={{ fontSize: 12.5, color: C.gris, margin: "8px 0 0" }}>Les heures sont pointées sur la commande de base : elles remplissent d’abord la commande, puis chaque avenant dans l’ordre ; le dernier porte le dépassement éventuel.</p>}
              {bilan.horsComparaison > 0.01 && !bilan.toutAuMontant && (
                <p style={{ fontSize: 12.5, color: C.gris, margin: "8px 0 0" }}>Dont {formatHeures(bilan.horsComparaison)} de scan / négoce non chiffrées (vendues au montant) : comptées dans le pointé, hors comparaison au chiffré.</p>
              )}

              {/* qui, quand */}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 16px" }}>
                  <strong style={{ fontSize: 15 }}>Affectations à venir : qui, quand</strong>
                  {bilan.totalChiffre > 0 && !bilan.toutAuMontant && (
                    <span style={{ fontSize: 13.5, color: "#3b4046" }}>
                      pointé {formatHeures(pointe)} + à venir {formatHeures(planifieTotal)} = <strong>{formatHeures(pointe + planifieTotal)}</strong> pour {formatHeures(bilan.totalChiffre)} chiffrées
                      {" "}
                      <span style={{ fontWeight: 800, color: resteAPlanifier < -0.01 ? C.rougeTexte : "#1b5e20" }}>
                        ({resteAPlanifier < -0.01 ? `+${formatHeures(-resteAPlanifier)} au-delà` : `${formatHeures(resteAPlanifier)} non planifiées`})
                      </span>
                    </span>
                  )}
                </div>
                {aVenir.length === 0 ? (
                  <p style={{ margin: "6px 0 0", color: C.gris }}>Rien n’est planifié à partir d’aujourd’hui.</p>
                ) : (
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, marginTop: 6 }}>
                    <thead>
                      <tr>
                        <th style={th}>Personne</th>
                        <th style={th}>Activité</th>
                        <th style={th}>Commande</th>
                        <th style={th}>Du</th>
                        <th style={th}>Au</th>
                        <th style={thN}>Heures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aVenir.map((x) => (
                        <tr key={x.id}>
                          <td style={{ ...td, fontWeight: 800 }}>{x.personne}</td>
                          <td style={td}>{x.activite}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{x.numero}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(x.du)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap", color: echeance && x.au > echeance && !livree ? C.rougeTexte : undefined }}>{formatDate(x.au)}</td>
                          <td style={{ ...tdN, fontWeight: 800 }}>{formatHeures(x.heures)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* ================= ③ LE DÉTAIL DES HEURES (onglets) ================= */}
            {/* HISTORIQUE_PEPI : pour une PE / PI, ce qui est facturé mois par mois, avenant par avenant, face au pointé, et le prévu */}
            {affaire.type === "CBE" && (base?.imputation === "PE" || base?.imputation === "PI") && (
              <HistoriquePEPI base={affaire.numero} pointeParMois={new Map(bilan.evolution.map((m) => [m.mois, m.heures]))} />
            )}

            <TitrePartie numero="②" titre="Le détail des heures" />
            <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
              <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {(
                  [
                    ["PERSONNE", "Par personne"],
                    ["MOIS", "Par mois"],
                    ["CODE", "Par code"],
                    ["SOUS_DOSSIER", "Par sous-dossier"],
                    ["SEMAINE", "Semaine par semaine"],
                  ] as const
                ).map(([cle, libelle]) => (
                  <button key={cle} type="button" role="tab" aria-selected={onglet === cle} onClick={() => setOnglet(cle)} style={bascule(onglet === cle)}>
                    {libelle}
                  </button>
                ))}
              </div>

              {onglet === "PERSONNE" &&
                (bilan.parPersonne.length === 0 ? (
                  <p style={{ color: C.gris, margin: 0 }}>Aucune heure pointée.</p>
                ) : (
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={th}>Personne</th>
                        <th style={thN}>Heures</th>
                        <th style={th}>Activités</th>
                        <th style={th}>Période</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bilan.parPersonne.map((p) => (
                        <tr key={p.cle}>
                          <td style={{ ...td, fontWeight: 800 }}>{p.nom}</td>
                          <td style={tdN}>{formatHeures(p.heures)}</td>
                          <td style={{ ...td, fontSize: 12.5 }}>
                            {[...p.parActivite.entries()]
                              .sort((a, b) => b[1] - a[1])
                              .map(([a, h]) => `${nomActivite(a).replace(" (code non rattaché)", "")} ${formatHeures(h)}`)
                              .join(" · ")}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12.5 }}>
                            {formatDate(p.premiere)} → {formatDate(p.derniere)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

              {onglet === "MOIS" &&
                (bilan.evolution.length === 0 ? (
                  <p style={{ color: C.gris, margin: 0 }}>Aucune heure pointée.</p>
                ) : (
                  <>
                    {/* COURBE_CUMUL : le cumul du pointé face au chiffré */}
                    {bilan.totalChiffre > 0 &&
                      !bilan.toutAuMontant &&
                      (() => {
                        const W = 640;
                        const H = 150;
                        const n = bilan.evolution.length;
                        const max = Math.max(bilan.totalChiffre, ...bilan.evolution.map((m) => m.cumul)) * 1.08;
                        const x = (i: number) => (n === 1 ? W / 2 : 20 + (i * (W - 40)) / (n - 1));
                        const y = (v: number) => H - 14 - (v / max) * (H - 28);
                        const points = bilan.evolution.map((m, i) => `${x(i)},${y(m.cumul)}`).join(" ");
                        return (
                          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 760, height: "auto", marginBottom: 10 }} role="img" aria-label="Cumul des heures pointées face au chiffré">
                            <line x1={10} x2={W - 10} y1={y(bilan.totalChiffre)} y2={y(bilan.totalChiffre)} stroke="#1f2328" strokeWidth={1.5} strokeDasharray="6 4" />
                            <text x={W - 12} y={y(bilan.totalChiffre) - 5} textAnchor="end" fontSize={12} fill="#1f2328">
                              chiffré {formatHeures(bilan.totalChiffre)}
                            </text>
                            <polyline points={points} fill="none" stroke={C.rouge} strokeWidth={2.5} />
                            {bilan.evolution.map((m, i) => (
                              <circle key={m.mois} cx={x(i)} cy={y(m.cumul)} r={3.5} fill={m.cumul > bilan.totalChiffre ? "#b3261e" : C.rouge}>
                                <title>{`${MOIS[Number(m.mois.slice(5, 7)) - 1]} ${m.mois.slice(2, 4)} : cumul ${formatHeures(m.cumul)}`}</title>
                              </circle>
                            ))}
                          </svg>
                        );
                      })()}
                    <div style={{ display: "grid", gap: 5 }}>
                      {bilan.evolution.map((m) => (
                        <div key={m.mois} style={{ display: "grid", gridTemplateColumns: "72px 1fr 64px 140px", alignItems: "center", gap: 8, fontSize: 13 }}>
                          <span>{`${MOIS[Number(m.mois.slice(5, 7)) - 1]} ${m.mois.slice(2, 4)}`}</span>
                          <span style={{ background: "#f1f2f4", height: 12, borderRadius: 4, position: "relative" }}>
                            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(m.heures / maxMois) * 100}%`, background: C.rouge, borderRadius: 4 }} />
                          </span>
                          <strong style={{ textAlign: "right" }}>{formatHeures(m.heures)}</strong>
                          <span style={{ color: !bilan.toutAuMontant && m.cumul > bilan.totalChiffre && bilan.totalChiffre > 0 ? C.rougeTexte : C.gris, fontSize: 12 }}>
                            cumul {formatHeures(m.cumul)}
                            {bilan.totalChiffre > 0 && !bilan.toutAuMontant ? ` (${Math.round((m.cumul / bilan.totalChiffre) * 100)} %)` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ))}

              {onglet === "CODE" &&
                (() => {
                  const parCode = new Map<string, { heures: number; activites: Map<string, number>; personnes: Set<string> }>();
                  for (const i of imputations) {
                    const code = (i.code || "—").toUpperCase();
                    const e = parCode.get(code) ?? { heures: 0, activites: new Map<string, number>(), personnes: new Set<string>() };
                    e.heures += i.heures;
                    const act = i.activite_id ?? SANS_ACTIVITE;
                    e.activites.set(act, (e.activites.get(act) ?? 0) + i.heures);
                    e.personnes.add(i.collaborateur_id ?? i.trigramme ?? "?");
                    parCode.set(code, e);
                  }
                  const liste = [...parCode.entries()].sort((a, b) => b[1].heures - a[1].heures);
                  const total = liste.reduce((t, [, e]) => t + e.heures, 0);
                  if (liste.length === 0) return <p style={{ color: C.gris, margin: 0 }}>Aucune heure pointée.</p>;
                  return (
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                      <thead>
                        <tr>
                          <th style={th}>Code</th>
                          <th style={th}>Libellé</th>
                          <th style={th}>Activité</th>
                          <th style={thN}>Heures</th>
                          <th style={thN}>Part</th>
                          <th style={thN}>Personnes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liste.map(([code, e]) => (
                          <tr key={code}>
                            <td style={{ ...td, fontWeight: 800, color: C.rougeFonce }}>{code}</td>
                            <td style={td}>{libellesCodes.get(code) || "—"}</td>
                            <td style={{ ...td, fontSize: 12.5 }}>
                              {[...e.activites.entries()]
                                .sort((a, b) => b[1] - a[1])
                                .map(([a, h]) => (e.activites.size > 1 ? `${nomActivite(a).replace(" (code non rattaché)", "")} ${formatHeures(h)}` : nomActivite(a).replace(" (code non rattaché)", "")))
                                .join(" · ")}
                            </td>
                            <td style={{ ...tdN, fontWeight: 800 }}>{formatHeures(e.heures)}</td>
                            <td style={tdN}>{total > 0 ? `${Math.round((e.heures / total) * 100)} %` : "—"}</td>
                            <td style={tdN}>{e.personnes.size}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}

              {onglet === "SOUS_DOSSIER" && (
                <>
                  <SousDossiersAffaire type={affaire.type} numero={affaire.numero} />
                  <p style={{ fontSize: 13, color: C.gris, margin: 0 }}>Sous-dossiers précisés dans les feuilles d’heures (champ libre). Rien au-dessus : aucun sous-dossier n’a été précisé sur cette affaire.</p>
                </>
              )}

              {onglet === "SEMAINE" && (
                <>
                  {bilan.parPersonne.length > 1 && (
                    <select aria-label="Filtrer par personne" value={filtrePersonne} onChange={(e) => setFiltrePersonne(e.target.value)} style={{ ...page.entrees, width: "auto", marginBottom: 8 }}>
                      <option value="">Toutes les personnes</option>
                      {bilan.parPersonne.map((p) => (
                        <option key={p.cle} value={p.cle}>
                          {p.nom}
                        </option>
                      ))}
                    </select>
                  )}
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={th}>Semaine</th>
                        <th style={th}>Personne</th>
                        <th style={th}>N° saisi</th>
                        <th style={th}>Code</th>
                        <th style={th}>Activité</th>
                        <th style={thN}>Heures</th>
                        <th style={th}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((d, k) => (
                        <tr key={k}>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {d.semaine} <span style={{ color: C.gris, fontSize: 12 }}>· {formatDate(d.cle)}</span>
                          </td>
                          <td style={{ ...td, fontWeight: 700 }}>{d.personne}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{d.numero}</td>
                          <td style={td}>{d.code}</td>
                          <td style={td}>{d.activite}</td>
                          <td style={tdN}>{formatHeures(d.heures)}</td>
                          <td style={{ ...td, color: C.gris }}>{d.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>

            {/* ================= ④ L'ARGENT (fonction « Montants des affaires ») ================= */}
            {affaire.type === "CBE" && (
              <BilanFinancierAffaire
                type={affaire.type}
                numero={affaire.numero}
                realiseParActivite={new Map(bilan.parActivite.map((a) => [a.id, a.realise]))}
                correspondance={correspondance}
                heuresNegoce={bilan.parActivite.filter((a) => /^n[ée]goce/i.test(a.nom)).reduce((t, a) => t + a.realise, 0)}
                depassementPrevu={depassementPrevu}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

/* BILAN_MOBILE : affichage téléphone (< 760 px) */
const CSS_MOBILE_BILAN = `
@media (max-width: 760px) {
  .bilan-contenu { padding: 10px 10px 40px !important; }
  .bilan-page h1 { font-size: 24px !important; }
  .bilan-page section { padding: 12px !important; }
  .bilan-page table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
  .bilan-page input, .bilan-page select { font-size: 16px !important; min-height: 44px; max-width: none !important; flex: 1 1 100%; }
  .bilan-page form button[type="submit"] { flex: 1 1 100%; min-height: 48px; }
  .bilan-page div[style*="grid-template-columns: 72px"] { grid-template-columns: 56px 1fr 52px !important; }
  .bilan-page div[style*="grid-template-columns: 72px"] > span:last-child { grid-column: 2 / 4; font-size: 11px !important; }
}
`;

export default function BilanAffairePage() {
  return (
    <GardeAcces droit={null}>
      <BilanContenu />
    </GardeAcces>
  );
}
