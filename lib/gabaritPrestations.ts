import JSZip from "jszip";

/* ===============================================================
   EXPORT DU RELEVÉ DES PRESTATIONS DANS LE GABARIT EXCEL

   On part du gabarit fourni (public/gabarits/prestations.xlsx) et on ne
   modifie QUE les cellules de saisie, directement dans le fichier : mise
   en forme, formules, nombre de lignes et liens vers le classeur
   « Données » restent strictement identiques. Excel recalcule les
   formules à l'ouverture.

   Blocs : repérés dans le gabarit lui-même, d'après les titres de la
   colonne A (« PRESTATION EXTERNE en TARIF JOURNALIER », « PRESTATION
   INTERNE AU BE » puis « TARIF HORAIRE », « PRESTATION EN INTERGROUPE »…) :
   les lignes d'un bloc sont celles qui suivent son titre et dont la
   colonne A porte un type d'affaire (CBE…). Le nombre de lignes n'est
   jamais modifié.
   Calendrier (P à AT) : chaque jour reprend la couleur « jour ouvré » ou
   « week-end » du gabarit (les jours fériés comptent comme week-end), et
   les jours au-delà de la fin du mois prennent la couleur « hors mois ».
   Colonnes écrites : A type · B n° · C client · D personne ·
     F taux jour (journalier) ou G taux horaire (horaire) · H base horaire ·
     K heures sup à refacturer · P..AT jours 1 à 31 ·
     AV jours / heures restant en début de mois.
   En-têtes du mois : ligne 1 (L, M, M…), ligne 2 (1..31), ligne 3
   (n° de semaine, cellules fusionnées par semaine) et nom de la feuille.
================================================================ */

export type CategoriePrestation = "PE" | "PI" | "IG";
export type UnitePrestation = "JOUR" | "HEURE";

export type LigneGabarit = {
  categorie: CategoriePrestation;
  unite: UnitePrestation;
  type: string; // CBE
  numero: string; // 1604R2
  client: string | null;
  personne: string; // trigramme
  taux: number | null;
  base: number;
  jours: (number | string | null)[]; // index 0 = 1er du mois
  hs: number;
  commandeInitiale: number | null; // jours (journalier) ou heures (horaire) restant au début du mois
};

const STYLE_COLONNE_JOUR = "5"; // style par défaut des colonnes P..AS du gabarit
const STYLE_COLONNE_31 = "7"; // style par défaut de la colonne AT

const LETTRES_JOURS = ["D", "L", "M", "M", "J", "V", "S"];
const NOMS_MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const PREMIERE_COLONNE_JOUR = 16; // P
const DERNIERE_COLONNE_JOUR = 46; // AT

export function lettreColonne(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function numeroColonne(lettres: string): number {
  let n = 0;
  for (const ch of lettres) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function echapper(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Jours fériés français (pour colorer le calendrier) */
function paques(a: number): Date {
  const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4;
  const g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30;
  const k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
  const mois = Math.floor((i + m - 7 * n + 114) / 31), jour = ((i + m - 7 * n + 114) % 31) + 1;
  return new Date(Date.UTC(a, mois - 1, jour));
}

function feries(a: number): Set<string> {
  const p = paques(a);
  const plus = (j: number) => new Date(p.getTime() + j * 86400000).toISOString().slice(0, 10);
  return new Set([`${a}-01-01`, plus(1), `${a}-05-01`, `${a}-05-08`, plus(39), plus(50), `${a}-07-14`, `${a}-08-15`, `${a}-11-01`, `${a}-11-11`, `${a}-12-25`]);
}

function semaineIso(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const jour = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7);
}

/* ------------------------------ édition du XML d'une feuille ------------------------------ */

class Feuille {
  constructor(public xml: string) {}

  private bornesLigne(r: number): { debut: number; fin: number; ouverture: string; contenu: string; autoFermee: boolean } | null {
    const re = new RegExp(`<row r="${r}"(?=[\\s>/])[^>]*?(/?)>`, "g");
    const m = re.exec(this.xml);
    if (!m) return null;
    const debut = m.index;
    const ouverture = m[0];
    if (m[1] === "/") return { debut, fin: debut + ouverture.length, ouverture, contenu: "", autoFermee: true };
    const finContenu = this.xml.indexOf("</row>", debut);
    return { debut, fin: finContenu + 6, ouverture, contenu: this.xml.slice(debut + ouverture.length, finContenu), autoFermee: false };
  }

  /* value : nombre, texte, ou null pour vider la cellule (sa mise en forme est conservée) */
  ecrire(ref: string, valeur: number | string | null) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) throw new Error(`Cellule invalide ${ref}`);
    const ligne = Number(m[2]);
    const col = numeroColonne(m[1]);
    const b = this.bornesLigne(ligne);
    if (!b) throw new Error(`Ligne ${ligne} absente du gabarit`);

    const reCell = new RegExp(`<c r="${ref}"(?=[\\s>/])([^>]*?)(/>|>([\\s\\S]*?)</c>)`);
    const existante = b.contenu.match(reCell);
    let attributs = existante ? existante[1] : "";
    attributs = attributs.replace(/\s+t="[^"]*"/, "");

    let nouvelle: string;
    if (valeur === null || valeur === "") nouvelle = `<c r="${ref}"${attributs}/>`;
    else if (typeof valeur === "number") nouvelle = `<c r="${ref}"${attributs}><v>${valeur}</v></c>`;
    else nouvelle = `<c r="${ref}"${attributs} t="inlineStr"><is><t>${echapper(valeur)}</t></is></c>`;

    let contenu: string;
    if (existante) {
      contenu = b.contenu.replace(reCell, nouvelle);
    } else {
      // insertion à sa place (ordre des colonnes)
      const reToutes = /<c r="([A-Z]+)\d+"/g;
      let position = b.contenu.length;
      let x: RegExpExecArray | null;
      while ((x = reToutes.exec(b.contenu))) {
        if (numeroColonne(x[1]) > col) {
          position = x.index;
          break;
        }
      }
      contenu = b.contenu.slice(0, position) + nouvelle + b.contenu.slice(position);
    }

    const ouverture = b.autoFermee ? b.ouverture.replace(/\/>$/, ">") : b.ouverture;
    this.xml = this.xml.slice(0, b.debut) + ouverture + contenu + "</row>" + this.xml.slice(b.fin);
  }

  style(ref: string): string | null {
    const ligne = Number(ref.match(/\d+$/)![0]);
    const b = this.bornesLigne(ligne);
    if (!b) return null;
    const c = b.contenu.match(new RegExp(`<c r="${ref}"(?=[\\s>/])([^>]*?)(/>|>)`));
    return c?.[1].match(/\ss="(\d+)"/)?.[1] ?? null;
  }

  styler(ref: string, style: string) {
    const ligne = Number(ref.match(/\d+$/)![0]);
    const b = this.bornesLigne(ligne);
    if (!b) return;
    const re = new RegExp(`<c r="${ref}"(?=[\\s>/])([^>]*?)(/>|>)`);
    const c = b.autoFermee ? null : b.contenu.match(re);
    if (!c) {
      // cellule absente : on la crée (vide), puis on lui donne son style
      this.ecrire(ref, null);
      const b2 = this.bornesLigne(ligne)!;
      const c2 = b2.contenu.match(re)!;
      const contenu = b2.contenu.replace(re, `<c r="${ref}"${c2[1].replace(/\ss="\d+"/, "")} s="${style}"${c2[2]}`);
      this.xml = this.xml.slice(0, b2.debut) + b2.ouverture + contenu + "</row>" + this.xml.slice(b2.fin);
      return;
    }
    const attributs = /\ss="\d+"/.test(c[1]) ? c[1].replace(/\ss="\d+"/, ` s="${style}"`) : `${c[1]} s="${style}"`;
    const contenu = b.contenu.replace(re, `<c r="${ref}"${attributs}${c[2]}`);
    this.xml = this.xml.slice(0, b.debut) + b.ouverture + contenu + "</row>" + this.xml.slice(b.fin);
  }

  lignesPresentes(): number[] {
    return [...this.xml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
  }

  /* fusions de la ligne des semaines (ligne 3, colonnes P à AT) */
  fusionsSemaines(plages: string[]) {
    this.xml = this.xml.replace(/<mergeCells count="\d+">([\s\S]*?)<\/mergeCells>/, (_t, contenu: string) => {
      const gardees = [...contenu.matchAll(/<mergeCell ref="([^"]+)"\/>/g)]
        .map((m) => m[1])
        .filter((ref) => {
          const r = ref.match(/^([A-Z]+)3:([A-Z]+)3$/);
          if (!r) return true;
          const c1 = numeroColonne(r[1]);
          return c1 < PREMIERE_COLONNE_JOUR || c1 > DERNIERE_COLONNE_JOUR;
        });
      const toutes = [...gardees, ...plages];
      return `<mergeCells count="${toutes.length}">${toutes.map((r) => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>`;
    });
  }
}

/* ------------------------------ remplissage ------------------------------ */

export async function remplirGabarit(
  modele: ArrayBuffer | Uint8Array,
  mois: string, // AAAA-MM-01
  lignes: LigneGabarit[]
): Promise<{ fichier: Uint8Array; nomFeuille: string; debordements: string[] }> {
  const zip = await JSZip.loadAsync(modele);

  // première feuille du classeur
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  let workbook = await zip.file("xl/workbook.xml")!.async("string");
  const premiere = workbook.match(/<sheet [^>]*r:id="([^"]+)"[^>]*\/>/);
  if (!premiere) throw new Error("Gabarit : aucune feuille.");
  const cible = rels.match(new RegExp(`Id="${premiere[1]}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${premiere[1]}"`))?.[1];
  if (!cible) throw new Error("Gabarit : feuille introuvable.");
  const cheminFeuille = cible.startsWith("/") ? cible.slice(1) : `xl/${cible}`;
  const f = new Feuille(await zip.file(cheminFeuille)!.async("string"));

  // textes partagés (pour lire la colonne A)
  const partages: string[] = [];
  const fichierTextes = zip.file("xl/sharedStrings.xml");
  if (fichierTextes) {
    const xmlTextes = await fichierTextes.async("string");
    for (const si of xmlTextes.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      partages.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
    }
  }
  const texteA = (r: number): string => {
    const m = f.xml.match(new RegExp(`<c r="A${r}"(?=[\\s>/])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`));
    if (!m || !m[2]) return "";
    const v = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? m[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
    return (/t="s"/.test(m[1]) ? partages[Number(v)] ?? "" : v).trim();
  };

  // blocs repérés d'après les titres de la colonne A
  const blocs = new Map<string, number[]>();
  let cat: CategoriePrestation | null = null;
  let unite: UnitePrestation | null = null;
  for (const r of f.lignesPresentes()) {
    if (r < 4) continue;
    const t = texteA(r).toUpperCase();
    if (!t) continue;
    if (t.includes("PRESTATION")) {
      cat = t.includes("INTERGROUPE") ? "IG" : t.includes("INTERNE") ? "PI" : t.includes("EXTERNE") ? "PE" : cat;
      unite = t.includes("JOURNALIER") ? "JOUR" : t.includes("HORAIRE") ? "HEURE" : null;
      continue;
    }
    if (t.includes("TARIF")) {
      unite = t.includes("JOURNALIER") ? "JOUR" : t.includes("HORAIRE") ? "HEURE" : unite;
      continue;
    }
    if (cat && unite && /^[A-Z]{2,4}$/.test(t)) {
      const cle = `${cat}-${unite}`;
      blocs.set(cle, [...(blocs.get(cle) ?? []), r]);
    }
  }

  const annee = Number(mois.slice(0, 4));
  const numMois = Number(mois.slice(5, 7));
  const nbJours = new Date(Date.UTC(annee, numMois, 0)).getUTCDate();
  const nomFeuille = `${NOMS_MOIS[numMois - 1]} ${annee}`;

  // couleurs du calendrier : pour chaque ligne, styles « jour ouvré », « week-end » et « hors mois »
  // relevés dans le gabarit (colonne P = jour ouvré, U = week-end, AT = 31 absent du mois du gabarit)
  const ferie = feries(annee);
  for (const r of f.lignesPresentes()) {
    if (r === 3) continue;
    const ouvre = f.style(`P${r}`) ?? STYLE_COLONNE_JOUR;
    const weekend = f.style(`U${r}`) ?? STYLE_COLONNE_JOUR;
    const horsMois = f.style(`AT${r}`) ?? STYLE_COLONNE_31;
    if (ouvre === weekend) continue;
    for (let j = 1; j <= 31; j++) {
      const ref = `${lettreColonne(PREMIERE_COLONNE_JOUR + j - 1)}${r}`;
      if (j > nbJours) {
        f.styler(ref, horsMois);
        continue;
      }
      const d = new Date(Date.UTC(annee, numMois - 1, j));
      const ferme = d.getUTCDay() === 0 || d.getUTCDay() === 6 || ferie.has(d.toISOString().slice(0, 10));
      f.styler(ref, ferme ? weekend : ouvre);
    }
  }
  // ligne des semaines : bord gauche / milieu / bord droit de chaque semaine
  const sDebut = f.style("P3") ?? "55";
  const sMilieu = f.style("Q3") ?? "56";
  const sFin = f.style("V3") ?? "57";

  // en-têtes : lettres, numéros et semaines
  const plages: string[] = [];
  let debutSemaine = -1;
  let semaineCourante = -1;
  for (let j = 1; j <= 31; j++) {
    const col = lettreColonne(PREMIERE_COLONNE_JOUR + j - 1);
    if (j > nbJours) {
      f.ecrire(`${col}1`, null);
      f.ecrire(`${col}2`, null);
      f.ecrire(`${col}3`, null);
      continue;
    }
    const d = new Date(Date.UTC(annee, numMois - 1, j));
    f.ecrire(`${col}1`, LETTRES_JOURS[d.getUTCDay()]);
    f.ecrire(`${col}2`, j);
    const s = semaineIso(d);
    if (s !== semaineCourante) {
      if (debutSemaine > 0 && j - 1 > debutSemaine) plages.push(`${lettreColonne(PREMIERE_COLONNE_JOUR + debutSemaine - 1)}3:${lettreColonne(PREMIERE_COLONNE_JOUR + j - 2)}3`);
      semaineCourante = s;
      debutSemaine = j;
      f.ecrire(`${col}3`, s);
    } else {
      f.ecrire(`${col}3`, null);
    }
  }
  if (debutSemaine > 0 && nbJours > debutSemaine) plages.push(`${lettreColonne(PREMIERE_COLONNE_JOUR + debutSemaine - 1)}3:${lettreColonne(PREMIERE_COLONNE_JOUR + nbJours - 1)}3`);
  f.fusionsSemaines(plages);
  for (let j = 1; j <= 31; j++) {
    const ref = `${lettreColonne(PREMIERE_COLONNE_JOUR + j - 1)}3`;
    if (j > nbJours) continue;
    const d = new Date(Date.UTC(annee, numMois - 1, j));
    const lundi = d.getUTCDay() === 1 || j === 1;
    const dimanche = d.getUTCDay() === 0 || j === nbJours;
    f.styler(ref, lundi ? sDebut : dimanche ? sFin : sMilieu);
  }

  // lignes, bloc par bloc, sans jamais dépasser les lignes prévues
  const debordements: string[] = [];
  const prochaine: Record<string, number> = {}; // rang de la prochaine ligne libre de chaque bloc
  for (const l of lignes) {
    const cle = `${l.categorie}-${l.unite}`;
    const disponibles = blocs.get(cle) ?? [];
    const rang = prochaine[cle] ?? 0;
    const r = disponibles[rang];
    if (r === undefined) {
      debordements.push(`${l.type}${l.numero} / ${l.personne} (${l.categorie} ${l.unite === "JOUR" ? "journalier" : "horaire"})`);
      continue;
    }
    prochaine[cle] = rang + 1;

    f.ecrire(`A${r}`, l.type);
    f.ecrire(`B${r}`, /^\d+$/.test(l.numero) ? Number(l.numero) : l.numero);
    f.ecrire(`C${r}`, l.client ?? null);
    f.ecrire(`D${r}`, l.personne);
    if (l.unite === "JOUR") f.ecrire(`F${r}`, l.taux);
    else f.ecrire(`G${r}`, l.taux);
    f.ecrire(`H${r}`, l.base);
    f.ecrire(`K${r}`, l.hs > 0 ? l.hs : null);
    for (let j = 1; j <= 31; j++) {
      const v = j <= nbJours ? l.jours[j - 1] ?? null : null;
      f.ecrire(`${lettreColonne(PREMIERE_COLONNE_JOUR + j - 1)}${r}`, v === "" ? null : v);
    }
    f.ecrire(`AV${r}`, l.commandeInitiale === null ? null : Math.round(l.commandeInitiale * 100) / 100);
  }

  zip.file(cheminFeuille, f.xml);

  // nom de la feuille et recalcul à l'ouverture
  const ancienNom = workbook.match(/<sheet [^>]*name="([^"]+)"/)?.[1];
  workbook = workbook.replace(/(<sheet [^>]*name=")([^"]+)(")/, `$1${echapper(nomFeuille)}$3`);
  workbook = /<calcPr[^>]*fullCalcOnLoad/.test(workbook)
    ? workbook
    : workbook.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  zip.file("xl/workbook.xml", workbook);

  const app = zip.file("docProps/app.xml");
  if (app && ancienNom) {
    const contenu = await app.async("string");
    zip.file("docProps/app.xml", contenu.split(`>${echapper(ancienNom)}<`).join(`>${echapper(nomFeuille)}<`));
  }

  const fichier = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { fichier, nomFeuille, debordements };
}
