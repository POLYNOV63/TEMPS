"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type Collaborateur = {
  id: string;
  trigramme: string | null;
  prenom: string;
  nom: string;
  actif: boolean;
};

type Ventilation = {
  code: string;
  heures: number;
};

type Imputation = {
  affaireCode: string | null;
  type: "CBE" | "DBE" | "DIVERS";
  ventilations: Ventilation[];
};

type Jour = {
  heures: number;
  statut: string;
};

type DonneesCollaborateur = {
  collaborateur: Collaborateur;
  ticketsRestaurant: number;
  jours: Jour[];
  heuresSup: number;
  imputations: Imputation[];
};

type SemaineAnalyse = {
  feuille: string;
  annee: number;
  semaine: number;
  donnees: DonneesCollaborateur[];
  anomalies: Anomalie[];
  heuresSource: number;
  heuresCollaborateursIgnores: number;
};

type Anomalie = {
  feuille: string;
  semaine: number;
  type: "COLLABORATEUR_INCONNU" | "ACTIVITE_SANS_COLLABORATEUR" | "CODE_SANS_ENTETE";
  collaborateur: string;
  detail: string;
  heures: number;
};

type LigneHistorique = {
  annee: number;
  semaine: number;
  collaborateur_id: string;
  affaire_code: string | null;
  code_imputation: string;
  heures: number;
  source: string;
};

type LignePresence = {
  annee: number;
  semaine: number;
  collaborateur_id: string;
  heures_total: number;
  heures_theoriques: number;
  heures_presence: number;
  heures_affaires: number;
  heures_administratives: number;
  heures_absences: number;
  heures_non_vendues: number;
  heures_sup: number;
  tickets_restaurant: number;
  jours_presentiel: number;
  jours_teletravail: number;
  jours_absent: number;
  jours_travailles: number;
  details_codes: Record<string, number>;
  details_jours: Jour[];
  source: string;
};

const SOURCE = "IMPORT_EXCEL";
const FIRST_YEAR = 2024;
const FIRST_WEEK = 1;
const TOLERANCE = 0.01;

// Excel : E:AO = colonnes de ventilation.
// Excel : AP:BC = heures + codes de présence des 7 jours.
const VENTILATION_START = 4; // E, index 0-based
const VENTILATION_END = 40; // AO
const PRESENCE_START = 41; // AP
const PRESENCE_END = 54; // BC
const DAILY_HOURS_OFFSET = 0;
const DAILY_STATUS_OFFSET = 1;

const CBE_PREFIXES = ["CBE", "CAS", "CIM", "COF"];
const DBE_PREFIXES = ["DBE", "DAS", "DIM", "DOF"];
const ABSENCE_CODES = new Set(["CP", "RE", "RTT", "ML", "FE", "AUTRE", "AA", "AT", "AI", "VM"]);
// Les codes d'absence restent importés afin que le Bilan puisse expliquer
// les heures (ex. CP = congés payés) au lieu de les faire apparaître
// artificiellement en "Non expliqué". EC reste volontairement hors import.
const IGNORED_CODES = new Set(["EC"]);

// Collaboratrice volontairement exclue de l'import historique.
// Ses heures sont comptabilisées séparément et ne constituent pas une anomalie.
const COLLABORATEURS_IGNORES = new Set([
  "AURELIE BERGNER",
  "PHILIPPE BONETTI",
  "REDA",
  "SEBASTIEN VACHON",
]);

function normaliser(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normaliserCode(value: unknown): string {
  return normaliser(value);
}

function estCollaborateurIgnoreNom(value: unknown): boolean {
  return COLLABORATEURS_IGNORES.has(normaliser(value));
}

function nombre(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function arrondir(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function texteLigne(ligne: unknown[], debut = 0, fin = 3): string {
  return ligne.slice(debut, fin + 1).map(normaliser).filter(Boolean).join(" ");
}

function extraireSemaineAnnee(nom: string): { semaine: number; annee: number } | null {
  const m = normaliser(nom).match(/^S\s*(\d{1,2})[-_](\d{4})$/);
  if (!m) return null;
  const semaine = Number(m[1]);
  const annee = Number(m[2]);
  if (semaine < 1 || semaine > 53 || annee < FIRST_YEAR) return null;
  return { semaine, annee };
}

function comparerSemaine(a: { semaine: number; annee: number }, b: { semaine: number; annee: number }) {
  return a.annee - b.annee || a.semaine - b.semaine;
}

function feuillesImportables(sheetNames: string[]): string[] {
  const debut = { semaine: FIRST_WEEK, annee: FIRST_YEAR };
  return sheetNames
    .map((nom) => {
      const info = extraireSemaineAnnee(nom);
      return info ? { nom, ...info } : null;
    })
    .filter((x): x is { nom: string; semaine: number; annee: number } => !!x)
    .filter((x) => comparerSemaine(x, debut) >= 0)
    .sort(comparerSemaine)
    .map((x) => x.nom);
}

function cleCollaborateur(nom: string, prenom: string): string {
  return normaliser(`${nom}|${prenom}`);
}

function trouverCollaborateur(ligne: unknown[], collaborateurs: Collaborateur[]): Collaborateur | null {
  const valeur = normaliser(ligne[0]);
  if (!valeur) return null;
  for (const c of collaborateurs) {
    if (
      valeur === normaliser(`${c.nom} ${c.prenom}`) ||
      valeur === normaliser(`${c.prenom} ${c.nom}`)
    ) {
      return c;
    }
  }
  return null;
}

function trouverBlocs(rows: unknown[][], collaborateurs: Collaborateur[]) {
  const blocs: { collaborateur: Collaborateur; debut: number; fin: number }[] = [];
  let courant: { collaborateur: Collaborateur; debut: number } | null = null;
  const collaborateursDejaVus = new Set<string>();
  let ignorerBlocDoublon = false;

  for (let i = 0; i < rows.length; i++) {
    // Aurélie BERGNER est volontairement ignorée.
    // Elle ferme le bloc précédent pour que ses lignes ne soient jamais
    // absorbées dans le bloc du collaborateur précédent.
    if (estCollaborateurIgnoreNom(rows[i]?.[0])) {
      if (courant) {
        blocs.push({
          collaborateur: courant.collaborateur,
          debut: courant.debut,
          fin: i - 1,
        });
        courant = null;
      }
      continue;
    }

    const c = trouverCollaborateur(rows[i] ?? [], collaborateurs);
    if (c) {
      if (collaborateursDejaVus.has(c.id)) {
        // Sécurité : un même collaborateur peut apparaître plusieurs fois
        // dans une même feuille Excel. On conserve le PREMIER bloc rencontré
        // et on ignore intégralement les suivants.
        if (courant) {
          blocs.push({
            collaborateur: courant.collaborateur,
            debut: courant.debut,
            fin: i - 1,
          });
          courant = null;
        }
        ignorerBlocDoublon = true;
        continue;
      }

      if (ignorerBlocDoublon) {
        ignorerBlocDoublon = false;
      }

      collaborateursDejaVus.add(c.id);
    } else {
      if (ignorerBlocDoublon) continue;
      continue;
    }

    if (courant) {
      blocs.push({
        collaborateur: courant.collaborateur,
        debut: courant.debut,
        fin: i - 1,
      });
    }

    courant = { collaborateur: c, debut: i };
  }

  if (courant) {
    blocs.push({
      collaborateur: courant.collaborateur,
      debut: courant.debut,
      fin: rows.length - 1,
    });
  }

  return blocs;
}

function lireCodesLigne2(rows: unknown[][]): string[] {
  const ligne2 = rows[1] ?? [];
  const codes: string[] = [];
  for (let col = VENTILATION_START; col <= VENTILATION_END; col++) {
    codes[col] = normaliserCode(ligne2[col]);
  }
  return codes;
}

function parserAffaire(valeur: unknown): { type: "CBE" | "DBE"; code: string } | null {
  const texte = normaliser(valeur);
  if (!texte) return null;

  const match = texte.match(/^([A-Z]+)\s*[-:]?\s*(.+)$/);
  if (!match) return null;

  const prefixe = match[1];
  const numero = match[2].trim();

  if (CBE_PREFIXES.includes(prefixe)) return { type: "CBE", code: `${prefixe} ${numero}` };
  if (DBE_PREFIXES.includes(prefixe)) return { type: "DBE", code: `${prefixe} ${numero}` };
  return null;
}

function extraireVentilations(ligne: unknown[], codesLigne2: string[]): Ventilation[] {
  const resultat: Ventilation[] = [];
  for (let col = VENTILATION_START; col <= VENTILATION_END; col++) {
    const code = codesLigne2[col];
    if (!code || IGNORED_CODES.has(code)) continue;
    const heures = nombre(ligne[col]);
    if (Math.abs(heures) <= TOLERANCE) continue;
    resultat.push({ code, heures: arrondir(heures) });
  }
  return resultat;
}

function extraireHeuresVentileesBrutes(ligne: unknown[], codesLigne2: string[]): number {
  let total = 0;
  for (let col = VENTILATION_START; col <= VENTILATION_END; col++) {
    const code = codesLigne2[col];
    if (!code || IGNORED_CODES.has(code)) continue;
    total += nombre(ligne[col]);
  }
  return arrondir(total);
}

function estLigneSpecialeNom(valeur: string): boolean {
  return !valeur || /\bTR$/i.test(valeur) || /jour\(s\) TT/i.test(valeur) || /^(TOTAL|H\/JOUR|HEURES SUP)$/i.test(valeur);
}

function analyserAnomaliesBrutes(
  rows: unknown[][],
  nomFeuille: string,
  info: { semaine: number; annee: number },
  collaborateurs: Collaborateur[],
  codesLigne2: string[]
): {
  anomalies: Anomalie[];
  heuresSource: number;
  heuresCollaborateursIgnores: number;
} {
  const anomalies: Anomalie[] = [];
  let heuresSource = 0;
  let heuresCollaborateursIgnores = 0;
  let collaborateurCourant: Collaborateur | null = null;
  let nomInconnuCourant = "";
  let collaborateurIgnoreCourant = false;

  for (const ligne of rows) {
    const valeurA = String(ligne[0] ?? "").trim();

    // Collaboratrice volontairement exclue.
    if (estCollaborateurIgnoreNom(valeurA)) {
      collaborateurCourant = null;
      nomInconnuCourant = "";
      collaborateurIgnoreCourant = true;
      continue;
    }

    const collab = trouverCollaborateur(ligne, collaborateurs);

    if (
      valeurA &&
      !estLigneSpecialeNom(valeurA) &&
      !estDivers(ligne) &&
      !parserAffaire(ligne[2])
    ) {
      if (collab) {
        collaborateurCourant = collab;
        nomInconnuCourant = "";
        collaborateurIgnoreCourant = false;
      } else {
        collaborateurCourant = null;
        nomInconnuCourant = valeurA;
        collaborateurIgnoreCourant = false;
      }
    }

    const estActivite = !!parserAffaire(ligne[2]) || estDivers(ligne);
    if (!estActivite) continue;

    const heures = extraireHeuresVentileesBrutes(ligne, codesLigne2);
    if (heures <= TOLERANCE) continue;

    // Les heures d'Aurélie sont volontairement sorties du périmètre importable.
    if (collaborateurIgnoreCourant) {
      heuresCollaborateursIgnores = arrondir(
        heuresCollaborateursIgnores + heures
      );
      continue;
    }

    heuresSource = arrondir(heuresSource + heures);

    if (nomInconnuCourant) {
      anomalies.push({
        feuille: nomFeuille,
        semaine: info.semaine,
        type: "COLLABORATEUR_INCONNU",
        collaborateur: nomInconnuCourant,
        detail: String(ligne[2] ?? "DIVERS").trim() || "DIVERS",
        heures,
      });
    } else if (!collaborateurCourant) {
      anomalies.push({
        feuille: nomFeuille,
        semaine: info.semaine,
        type: "ACTIVITE_SANS_COLLABORATEUR",
        collaborateur: "—",
        detail: String(ligne[2] ?? "DIVERS").trim() || "DIVERS",
        heures,
      });
    }

    for (let col = VENTILATION_START; col <= VENTILATION_END; col++) {
      const code = codesLigne2[col];
      const valeur = nombre(ligne[col]);
      if (valeur <= TOLERANCE) continue;

      if (!code) {
        anomalies.push({
          feuille: nomFeuille,
          semaine: info.semaine,
          type: "CODE_SANS_ENTETE",
          collaborateur: collaborateurCourant
            ? `${collaborateurCourant.prenom} ${collaborateurCourant.nom}`
            : (nomInconnuCourant || "—"),
          detail: `Colonne ${col + 1}`,
          heures: arrondir(valeur),
        });
      }
    }
  }

  return {
    anomalies,
    heuresSource,
    heuresCollaborateursIgnores,
  };
}

function estDivers(ligne: unknown[]): boolean {
  return normaliser(ligne[2]) === "DIVERS" || /\bDIVERS\b/.test(texteLigne(ligne));
}

function estLigne(ligne: unknown[], libelle: string): boolean {
  const cible = normaliser(libelle);
  return normaliser(ligne[2]) === cible || normaliser(ligne[1]) === cible || normaliser(ligne[0]) === cible;
}

function extraireTickets(ligne: unknown[]): number {
  const texte = normaliser(ligne[0]);
  const m = texte.match(/(?:^|\s)(\d+)\s*TR(?:\s|$)/);
  return m ? Number(m[1]) : 0;
}

function trouverLigneDansBloc(rows: unknown[][], debut: number, fin: number, libelle: string): number {
  for (let i = debut; i <= fin; i++) {
    if (estLigne(rows[i] ?? [], libelle)) return i;
  }
  return -1;
}

function extraireJours(rows: unknown[][], ligneHJour: number): Jour[] {
  if (ligneHJour < 0) return [];
  const ligneHeures = rows[ligneHJour] ?? [];
  const ligneTotal = ligneHJour + 2;
  const ligneStatuts = rows[ligneTotal] ?? [];

  const jours: Jour[] = [];
  for (let i = 0; i < 7; i++) {
    const colHeures = PRESENCE_START + i * 2 + DAILY_HOURS_OFFSET;
    const colStatut = PRESENCE_START + i * 2 + DAILY_STATUS_OFFSET;
    jours.push({
      heures: arrondir(nombre(ligneHeures[colHeures])),
      statut: normaliser(ligneStatuts[colHeures]),
    });
  }
  return jours;
}

function extraireHeuresSup(rows: unknown[][], debut: number, fin: number): number {
  const ligne = trouverLigneDansBloc(rows, debut, fin, "HEURES SUP");
  if (ligne < 0) return 0;
  // Ici, et uniquement ici, la colonne D est utilisée.
  const valeurD = nombre(rows[ligne]?.[3]);
  if (Math.abs(valeurD) > TOLERANCE) return arrondir(valeurD);

  let total = 0;
  for (let col = PRESENCE_START; col <= PRESENCE_END; col += 2) total += nombre(rows[ligne]?.[col]);
  return arrondir(total);
}

function analyserBloc(rows: unknown[][], bloc: { collaborateur: Collaborateur; debut: number; fin: number }, codesLigne2: string[]): DonneesCollaborateur {
  const imputations: Imputation[] = [];
  let ticketsRestaurant = 0;

  for (let i = bloc.debut; i <= bloc.fin; i++) {
    const ligne = rows[i] ?? [];
    const c = parserAffaire(ligne[2]);

    if (c) {
      ticketsRestaurant = Math.max(ticketsRestaurant, extraireTickets(ligne));
      const ventilations = extraireVentilations(ligne, codesLigne2);
      if (ventilations.length) imputations.push({ affaireCode: c.code, type: c.type, ventilations });
      continue;
    }

    if (estDivers(ligne)) {
      ticketsRestaurant = Math.max(ticketsRestaurant, extraireTickets(ligne));
      const ventilations = extraireVentilations(ligne, codesLigne2);
      if (ventilations.length) imputations.push({ affaireCode: null, type: "DIVERS", ventilations });
    }
  }

  const ligneHJour = trouverLigneDansBloc(rows, bloc.debut, bloc.fin, "H/JOUR");
  const jours = extraireJours(rows, ligneHJour);
  const heuresSup = extraireHeuresSup(rows, bloc.debut, bloc.fin);

  return { collaborateur: bloc.collaborateur, ticketsRestaurant, jours, heuresSup, imputations };
}

function analyserFeuille(rows: unknown[][], nomFeuille: string, collaborateurs: Collaborateur[]): SemaineAnalyse {
  const info = extraireSemaineAnnee(nomFeuille);
  if (!info) throw new Error(`Feuille invalide : ${nomFeuille}`);

  const codesLigne2 = lireCodesLigne2(rows);
  const blocs = trouverBlocs(rows, collaborateurs);
  const donnees = blocs.map((bloc) => analyserBloc(rows, bloc, codesLigne2));
  const controle = analyserAnomaliesBrutes(rows, nomFeuille, info, collaborateurs, codesLigne2);

  return {
    feuille: nomFeuille,
    annee: info.annee,
    semaine: info.semaine,
    donnees,
    anomalies: controle.anomalies,
    heuresSource: controle.heuresSource,
    heuresCollaborateursIgnores:
      controle.heuresCollaborateursIgnores,
  };
}

function construireLignesImputations(semaine: SemaineAnalyse): LigneHistorique[] {
  const map = new Map<string, LigneHistorique>();

  for (const d of semaine.donnees) {
    for (const imp of d.imputations) {
      for (const v of imp.ventilations) {
        const key = [semaine.annee, semaine.semaine, d.collaborateur.id, imp.affaireCode ?? "", v.code].join("|");
        const existante = map.get(key);
        if (existante) {
          existante.heures = arrondir(existante.heures + v.heures);
        } else {
          map.set(key, {
            annee: semaine.annee,
            semaine: semaine.semaine,
            collaborateur_id: d.collaborateur.id,
            affaire_code: imp.affaireCode,
            code_imputation: v.code,
            heures: arrondir(v.heures),
            source: SOURCE,
          });
        }
      }
    }
  }
  return Array.from(map.values()).filter((x) => x.heures > TOLERANCE);
}

function construirePresence(semaine: SemaineAnalyse): LignePresence[] {
  const map = new Map<string, LignePresence>();

  for (const d of semaine.donnees) {
    const heuresTotal = arrondir(d.jours.reduce((s, j) => s + j.heures, 0));
    const joursPresentiel = d.jours.filter((j) => j.heures > TOLERANCE && j.statut === "PRESENTIEL").length;
    const joursTeletravail = d.jours.filter((j) => j.heures > TOLERANCE && j.statut === "TELETRAVAIL").length;
    const joursAbsent = d.jours.filter((j) => j.statut === "ABSENT" || (j.statut === "" && j.heures <= TOLERANCE)).length;
    const joursTravailles = joursPresentiel + joursTeletravail;

    const lignes = construireLignesImputations(semaine).filter((x) => x.collaborateur_id === d.collaborateur.id);
    const heuresAffaires = arrondir(lignes.filter((x) => x.affaire_code !== null).reduce((s, x) => s + x.heures, 0));
    const heuresAdministratives = arrondir(lignes.filter((x) => x.affaire_code === null).reduce((s, x) => s + x.heures, 0));

    const detailsCodes: Record<string, number> = {};
    for (const l of lignes) detailsCodes[l.code_imputation] = arrondir((detailsCodes[l.code_imputation] ?? 0) + l.heures);

    const lignePresence: LignePresence = {
      annee: semaine.annee,
      semaine: semaine.semaine,
      collaborateur_id: d.collaborateur.id,
      heures_total: heuresTotal,
      // Le fichier Excel ne donne pas la base théorique fiable du collaborateur.
      // On ne fabrique donc pas 35 h : la valeur reste à 0 jusqu'à ce qu'on
      // rattache l'historique aux anciens profils horaires.
      heures_theoriques: 0,
      heures_presence: heuresTotal,
      heures_affaires: heuresAffaires,
      heures_administratives: heuresAdministratives,
      heures_absences: 0,
      heures_non_vendues: 0,
      heures_sup: d.heuresSup,
      tickets_restaurant: d.ticketsRestaurant,
      jours_presentiel: joursPresentiel,
      jours_teletravail: joursTeletravail,
      jours_absent: joursAbsent,
      jours_travailles: joursTravailles,
      details_codes: detailsCodes,
      details_jours: d.jours,
      source: SOURCE,
    };

    // Une présence doit être unique par semaine + collaborateur + source.
    // Cette Map ajoute une seconde sécurité avant l'INSERT Supabase.
    if (!map.has(d.collaborateur.id)) {
      map.set(d.collaborateur.id, lignePresence);
    }
  }

  return Array.from(map.values());
}

function statistiques(semaine: SemaineAnalyse[]) {
  const lignes = semaine.flatMap(construireLignesImputations);
  const anomalies = semaine.flatMap((x) => x.anomalies);
  return {
    semaines: semaine.length,
    feuillesCollaborateurs: semaine.reduce((s, x) => s + x.donnees.length, 0),
    lignes: lignes.length,
    heures: arrondir(lignes.reduce((s, x) => s + x.heures, 0)),
    presence: semaine.flatMap(construirePresence).length,
    heuresSup: arrondir(semaine.reduce((s, x) => s + x.donnees.reduce((a, d) => a + d.heuresSup, 0), 0)),
    heuresSource: arrondir(semaine.reduce((s, x) => s + x.heuresSource, 0)),
    heuresCollaborateursIgnores: arrondir(
      semaine.reduce(
        (s, x) => s + x.heuresCollaborateursIgnores,
        0
      )
    ),
    anomalies: anomalies.length,
    heuresAnomalies: arrondir(anomalies.reduce((s, x) => s + x.heures, 0)),
  };
}

export default function ImportHistoriqueV3() {
  const router = useRouter();
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [fichier, setFichier] = useState<File | null>(null);
  const [semaines, setSemaines] = useState<SemaineAnalyse[]>([]);
  const [chargement, setChargement] = useState(false);
  const [importEnCours, setImportEnCours] = useState(false);
  const [progression, setProgression] = useState(0);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [inconnus, setInconnus] = useState<string[]>([]);
  const [codesInconnus, setCodesInconnus] = useState<string[]>([]);

  const stats = useMemo(() => statistiques(semaines), [semaines]);

  async function chargerCollaborateurs() {
    const { data, error } = await supabase.from("collaborateurs").select("id,trigramme,prenom,nom,actif").eq("actif", true).order("nom").order("prenom");
    if (error) throw new Error(`Chargement collaborateurs : ${error.message}`);
    setCollaborateurs((data ?? []) as Collaborateur[]);
  }

  async function analyser(f: File) {
    setChargement(true);
    setErreur("");
    setMessage("");
    setSemaines([]);
    setProgression(0);
    setInconnus([]);
    setCodesInconnus([]);

    try {
      await chargerCollaborateurs();
      const buffer = await f.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true });
      const noms = feuillesImportables(wb.SheetNames);
      if (!noms.length) throw new Error("Aucune feuille Sxx-aaaa à partir de S01-2024.");

      // On recharge localement les collaborateurs après le select pour garantir la correspondance.
      const { data: collabsDB, error: collabError } =
        await supabase
          .from("collaborateurs")
          .select("id,trigramme,prenom,nom,actif")
          .order("nom")
          .order("prenom");
      if (collabError) throw new Error(collabError.message);
      const collabs = (collabsDB ?? []) as Collaborateur[];
      setCollaborateurs(collabs);

      const resultats: SemaineAnalyse[] = [];
      const inconnusSet = new Set<string>();

      for (let i = 0; i < noms.length; i++) {
        const nom = noms[i];
        const sheet = wb.Sheets[nom];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][];

        // Les noms inconnus sont maintenant contrôlés par le même moteur que
        // les anomalies détaillées affichées sous le résumé.
        for (const row of rows) {
          const a = String(row[0] ?? "").trim();
          if (!a || /TR$/i.test(a) || /jour\(s\) TT/i.test(a)) continue;
          if (estCollaborateurIgnoreNom(a)) continue;
          const c = trouverCollaborateur(row, collabs);
          if (!c && row[2] == null && a.length > 2 && !/^(TOTAL|H\/JOUR|HEURES SUP)$/i.test(a)) inconnusSet.add(a);
        }

        try {
          resultats.push(analyserFeuille(rows, nom, collabs));
        } catch (e) {
          console.error(`[IMPORT] Analyse ${nom}`, e);
        }

        setProgression(Math.round(((i + 1) / noms.length) * 100));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Vérification des codes réellement trouvés.
      const codes = Array.from(new Set(resultats.flatMap(construireLignesImputations).map((x) => x.code_imputation)));
      if (codes.length) {
        const { data, error } = await supabase.from("codes_imputation").select("code").in("code", codes);
        if (error) throw new Error(`Vérification des codes : ${error.message}`);
        const existants = new Set((data ?? []).map((x: { code: string }) => normaliserCode(x.code)));
        setCodesInconnus(codes.filter((x) => !existants.has(normaliserCode(x))));
      }

      setInconnus(Array.from(inconnusSet).sort());
      setSemaines(resultats);
      const s = statistiques(resultats);
      setMessage(
        `Analyse terminée : ${s.semaines} feuilles, ${s.feuillesCollaborateurs} blocs collaborateurs, ${s.lignes} lignes atomiques, ${s.heures.toFixed(2)} h importables sur ${s.heuresSource.toFixed(2)} h détectées, ${s.heuresCollaborateursIgnores.toFixed(2)} h volontairement ignorées (Aurélie BERGNER), ${s.anomalies} anomalies (${s.heuresAnomalies.toFixed(2)} h), ${s.presence} présences et ${s.heuresSup.toFixed(2)} h sup.`
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur pendant l'analyse.");
    } finally {
      setChargement(false);
    }
  }

  async function handleFichier(event: React.ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0];
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
      setErreur("Le fichier doit être un .xlsx ou .xlsm.");
      return;
    }
    setFichier(f);
    await analyser(f);
  }

  async function verifierCodesFinal(lignes: LigneHistorique[]) {
    const codes = Array.from(new Set(lignes.map((x) => x.code_imputation)));
    if (!codes.length) return [];
    const { data, error } = await supabase.from("codes_imputation").select("code").in("code", codes);
    if (error) throw new Error(error.message);
    const existants = new Set((data ?? []).map((x: { code: string }) => normaliserCode(x.code)));
    return codes.filter((x) => !existants.has(normaliserCode(x)));
  }

  async function importer() {
    if (!semaines.length) {
      setErreur("Analyse d'abord le classeur.");
      return;
    }
    if (codesInconnus.length) {
      setErreur(`Import bloqué : codes inconnus dans codes_imputation : ${codesInconnus.join(", ")}`);
      return;
    }

    setImportEnCours(true);
    setErreur("");
    setMessage("");
    setProgression(0);

    try {
      // Chaque lancement repart d'un historique IMPORT_EXCEL propre.
      // On ne touche jamais aux éventuelles données provenant d'une autre source.
      const { error: purgeImputationsError } = await supabase
        .from("historique_imputations")
        .delete()
        .eq("source", SOURCE);
      if (purgeImputationsError) {
        throw new Error(`Purge historique_imputations : ${purgeImputationsError.message}`);
      }

      const { error: purgePresenceError } = await supabase
        .from("historique_presence")
        .delete()
        .eq("source", SOURCE);
      if (purgePresenceError) {
        throw new Error(`Purge historique_presence : ${purgePresenceError.message}`);
      }

      const resultats = [] as string[];

      for (let i = 0; i < semaines.length; i++) {
        const semaine = semaines[i];
        const lignes = construireLignesImputations(semaine);
        const presence = construirePresence(semaine);

        const codesManquants = await verifierCodesFinal(lignes);
        if (codesManquants.length) throw new Error(`${semaine.feuille} : codes inconnus : ${codesManquants.join(", ")}`);

        if (lignes.length) {
          const { error } = await supabase.from("historique_imputations").insert(lignes);
          if (error) throw new Error(`${semaine.feuille} imputations : ${error.message}`);
        }

        if (presence.length) {
          const { error } = await supabase.from("historique_presence").insert(presence);
          if (error) throw new Error(`${semaine.feuille} présence : ${error.message}`);
        }

        resultats.push(`${semaine.feuille} OK`);
        setProgression(Math.round(((i + 1) / semaines.length) * 100));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setMessage(`Import terminé : ${resultats.length} semaines importées. Les imputations sont stockées de façon atomique et les données IMPORT_EXCEL des semaines/collaborateurs concernés ont été remplacées.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur pendant l'import.");
    } finally {
      setImportEnCours(false);
    }
  }

  const totalTickets = semaines.reduce((s, x) => s + x.donnees.reduce((a, d) => a + d.ticketsRestaurant, 0), 0);
  const totalCBE = semaines.reduce((s, x) => s + construireLignesImputations(x).filter((l) => l.affaire_code !== null).reduce((a, l) => a + l.heures, 0), 0);
  const totalDivers = semaines.reduce((s, x) => s + construireLignesImputations(x).filter((l) => l.affaire_code === null).reduce((a, l) => a + l.heures, 0), 0);
  const anomalies = semaines.flatMap((s) => s.anomalies);
  const anomaliesHeures = arrondir(anomalies.reduce((s, a) => s + a.heures, 0));
  const anomaliesParType = anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + a.heures;
    return acc;
  }, {});

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>POLYNOV · ADMINISTRATION</div>
          <h1 style={styles.title}>Import historique Excel — V3</h1>
          <p style={styles.subtitle}>Import du fichier « Récupération heures » à partir de S01-2024.</p>
        </div>
        <div style={styles.badge}>
          {collaborateurs.filter((c) => c.actif).length} actifs
          {" · "}
          {collaborateurs.filter((c) => !c.actif).length} anciens
        </div>
      </div>

      <section style={styles.card}>
        <div style={styles.fileHeader}>
          <div>
            <h2 style={styles.h2}>1. Sélection du fichier</h2>
            <p style={styles.fileHint}>Choisis le fichier Excel « Récupération heures » à importer.</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            style={styles.dashboardButton}
            disabled={chargement || importEnCours}
          >
            ← Retour au dashboard
          </button>
        </div>

        <label style={styles.fileButton}>
          <span>📂 Choisir le fichier Excel</span>
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={handleFichier}
            disabled={chargement || importEnCours}
            style={styles.hiddenInput}
          />
        </label>

        {fichier && <div style={styles.file}>{fichier.name}</div>}
      </section>

      <section style={styles.grid}>
        <Stat label="Feuilles" value={stats.semaines} />
        <Stat label="Blocs collaborateurs" value={stats.feuillesCollaborateurs} />
        <Stat label="Lignes atomiques" value={stats.lignes} />
        <Stat label="Heures ventilées" value={`${stats.heures.toFixed(2)} h`} />
        <Stat label="Présences" value={stats.presence} />
        <Stat label="Heures sup" value={`${stats.heuresSup.toFixed(2)} h`} />
      </section>

      {semaines.length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>2. Contrôle avant import</h2>
          <div style={styles.controlGrid}>
            <div><strong>{totalCBE.toFixed(2)} h</strong><span>affaires</span></div>
            <div><strong>{totalDivers.toFixed(2)} h</strong><span>divers</span></div>
            <div><strong>{totalTickets}</strong><span>tickets restaurant</span></div>
            <div><strong>{inconnus.length}</strong><span>collaborateurs inconnus</span></div>
            <div><strong>{codesInconnus.length}</strong><span>codes inconnus</span></div>
            <div><strong>{stats.heuresCollaborateursIgnores.toFixed(2)} h</strong><span>heures volontairement ignorées</span></div>
            <div><strong>{anomaliesHeures.toFixed(2)} h</strong><span>heures en anomalie</span></div>
          </div>

          {inconnus.length > 0 && <div style={styles.warning}><b>Collaborateurs inconnus :</b> {inconnus.join(", ")}</div>}
          {codesInconnus.length > 0 && <div style={styles.error}><b>Codes inconnus :</b> {codesInconnus.join(", ")}</div>}

          {anomalies.length > 0 && (
            <div style={styles.anomalyBox}>
              <div style={styles.anomalyHeader}>
                <div>
                  <h3 style={styles.anomalyTitle}>Anomalies détectées</h3>
                  <div style={styles.anomalySubtitle}>
                    Les heures « D » ne servent plus à déclarer une anomalie. Ici, on affiche uniquement les problèmes qui peuvent expliquer une différence entre Excel et ce que l'import peut réellement stocker.
                  </div>
                </div>
                <div style={styles.anomalyTotal}>{anomaliesHeures.toFixed(2)} h</div>
              </div>

              <div style={styles.anomalySummary}>
                {Object.entries(anomaliesParType).map(([type, heures]) => (
                  <div key={type} style={styles.anomalyPill}>
                    <strong>{heures.toFixed(2)} h</strong>
                    <span>{libelleAnomalie(type)}</span>
                  </div>
                ))}
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr><th>Feuille</th><th>Sem.</th><th>Type</th><th>Collaborateur</th><th>Ligne / détail</th><th>Heures</th></tr>
                  </thead>
                  <tbody>
                    {anomalies.map((a, index) => (
                      <tr key={`${a.feuille}-${index}`}>
                        <td>{a.feuille}</td>
                        <td>{a.semaine}</td>
                        <td>{libelleAnomalie(a.type)}</td>
                        <td>{a.collaborateur}</td>
                        <td>{a.detail}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{a.heures.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={styles.actions}>
            <button
              onClick={importer}
              disabled={importEnCours || chargement || !!codesInconnus.length}
              style={{
                ...styles.button,
                ...(importEnCours || chargement || !!codesInconnus.length ? styles.buttonDisabled : {}),
              }}
            >
              {importEnCours ? "Import en cours…" : "Importer dans Supabase"}
            </button>
          </div>
        </section>
      )}

      {(chargement || importEnCours) && (
        <section style={styles.card}>
          <div style={styles.progressTrack}><div style={{ ...styles.progressBar, width: `${progression}%` }} /></div>
          <div style={styles.progressText}>{progression}%</div>
        </section>
      )}

      {message && <div style={styles.success}>{message}</div>}
      {erreur && <div style={styles.error}>{erreur}</div>}

      {semaines.length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>Résumé des feuilles</h2>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead><tr><th>Feuille</th><th>Semaine</th><th>Collaborateurs</th><th>Lignes</th><th>Heures</th><th>H sup</th></tr></thead>
              <tbody>
                {semaines.map((s) => {
                  const l = construireLignesImputations(s);
                  const hs = s.donnees.reduce((a, d) => a + d.heuresSup, 0);
                  return <tr key={s.feuille}><td>{s.feuille}</td><td>{s.semaine}</td><td>{s.donnees.length}</td><td>{l.length}</td><td>{l.reduce((a, x) => a + x.heures, 0).toFixed(2)}</td><td>{hs.toFixed(2)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div style={styles.stat}><span>{label}</span><strong>{value}</strong></div>;
}

function libelleAnomalie(type: string): string {
  switch (type) {
    case "COLLABORATEUR_INCONNU": return "Collaborateur inconnu";
    case "ACTIVITE_SANS_COLLABORATEUR": return "Activité sans collaborateur";
    case "CODE_SANS_ENTETE": return "Code sans en-tête";
    default: return type;
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f5f6f8", fontFamily: "Calibri, Arial, sans-serif", color: "#222", padding: 32 },
  header: { background: "#c00000", color: "white", borderRadius: 14, padding: "24px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 22 },
  kicker: { fontSize: 12, fontWeight: 700, letterSpacing: 1.2, opacity: 0.85 },
  title: { margin: "5px 0", fontSize: 28 },
  subtitle: { margin: 0, opacity: 0.9 },
  badge: { background: "rgba(255,255,255,.15)", padding: "9px 13px", borderRadius: 999, whiteSpace: "nowrap" },
  card: { background: "white", borderRadius: 14, padding: 22, marginBottom: 18, boxShadow: "0 2px 10px rgba(0,0,0,.05)" },
  h2: { marginTop: 0, fontSize: 18 },
  file: { marginTop: 12, fontWeight: 700 },
  fileHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 16 },
  fileHint: { margin: "-8px 0 0", color: "#666", fontSize: 13 },
  fileButton: { display: "inline-flex", alignItems: "center", padding: "12px 18px", borderRadius: 10, background: "#c00000", color: "white", fontWeight: 700, cursor: "pointer", boxShadow: "0 5px 14px rgba(192,0,0,.18)" },
  hiddenInput: { display: "none" },
  dashboardButton: { border: "1px solid #d7dce2", background: "white", color: "#333", borderRadius: 9, padding: "10px 14px", fontWeight: 700, cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12, marginBottom: 18 },
  stat: { background: "white", borderRadius: 12, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,.04)" },
  controlGrid: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 12, marginBottom: 18 },
  warning: { background: "#fff4dd", border: "1px solid #f0c36a", padding: 12, borderRadius: 9, marginBottom: 10 },
  anomalyBox: { background: "#fffaf0", border: "1px solid #ead8aa", borderRadius: 12, padding: 16, marginTop: 16 },
  anomalyHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 },
  anomalyTitle: { margin: 0, fontSize: 17 },
  anomalySubtitle: { marginTop: 5, color: "#666", fontSize: 13, lineHeight: 1.4 },
  anomalyTotal: { fontWeight: 800, fontSize: 20, whiteSpace: "nowrap" },
  anomalySummary: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  anomalyPill: { background: "white", border: "1px solid #e5d7b8", borderRadius: 9, padding: "8px 11px", display: "flex", flexDirection: "column", gap: 2 },
  error: { background: "#ffe5e5", border: "1px solid #e0a0a0", padding: 12, borderRadius: 9, marginTop: 10 },
  success: { background: "#e7f6ea", border: "1px solid #9ad3a3", padding: 14, borderRadius: 10, marginBottom: 18 },
  actions: { marginTop: 20, display: "flex", justifyContent: "flex-end" },
  button: {
    border: 0,
    background: "#c00000",
    color: "white",
    borderRadius: 10,
    padding: "12px 22px",
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: 0.1,
    cursor: "pointer",
    boxShadow: "0 5px 14px rgba(192,0,0,.20)",
    transition: "transform .15s ease, box-shadow .15s ease, opacity .15s ease",
  },
  buttonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
    boxShadow: "none",
  },
  progressTrack: { height: 12, background: "#eee", borderRadius: 999, overflow: "hidden" },
  progressBar: { height: "100%", background: "#c00000", transition: "width .2s" },
  progressText: { marginTop: 7, textAlign: "center" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
};
