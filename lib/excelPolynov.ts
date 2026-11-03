/* ===============================================================
   EXPORT EXCEL AUX COULEURS DE POLYNOV

   Classeur mis en page : titre rouge, ligne d'en-tête rouge POLYNOV
   (#C00000) en blanc gras, Calibri, lignes alternées, montants au
   format « 1 234,56 € », ligne de total, en-tête figé, filtres
   automatiques, lignes en alerte surlignées en jaune.

   FORMULES (v2) : une colonne peut porter une formule Excel, écrite avec
   les clés des autres colonnes entre crochets, par ex.
   « [montant]-[negoce] » ou « MAX(0,[valeur]-[facture]) » (noms de
   fonctions en anglais, séparateur virgule : Excel les affiche en
   français). La valeur calculée par l'application est enregistrée comme
   résultat : le fichier s'ouvre rempli, et Excel recalcule si on change
   une donnée. Une cellule numérique vide reste vraiment vide (comptée 0).

   Utilise la bibliothèque exceljs (npm install exceljs), chargée
   seulement au moment de l'export.
================================================================ */

export type FormatColonne = "texte" | "euros" | "nombre" | "date" | "pourcent";

export type ColonneExcel = {
  titre: string;
  cle: string;
  largeur?: number;
  format?: FormatColonne;
  /* additionnée dans la ligne de total */
  total?: boolean;
  /* formule Excel de la ligne, avec les autres colonnes entre crochets : « [montant]-[negoce] » */
  formule?: string;
};

export type FeuilleExcel = {
  nom: string; // nom de l'onglet (31 caractères max)
  titre: string; // grand titre en haut
  sousTitre?: string; // ligne d'explication sous le titre
  colonnes: ColonneExcel[];
  lignes: Record<string, string | number | null | undefined>[];
  /* ligne surlignée en jaune (ex. non facturable, n° Louxor manquant) */
  alerte?: (ligne: Record<string, string | number | null | undefined>) => boolean;
  libelleTotal?: string;
  /* lignes de texte ajoutées sous le tableau (légende, remarques) */
  notes?: string[];
};

const ROUGE = "FFC00000";
const ROUGE_PALE = "FFFDECEC";
const GRIS_LIGNE = "FFF6F7F8";
const GRIS_BORD = "FFD9DCE0";
const JAUNE = "FFFFF4B8";
const BLEU_FORMULE = "FF1F4E99";

const numerique = (f?: FormatColonne) => f === "euros" || f === "nombre" || f === "pourcent";
const formatNombre = (f?: FormatColonne) => (f === "euros" ? '#,##0.00 "€"' : f === "pourcent" ? "0%" : "#,##0.##");

export async function exporterExcelPolynov(nomFichier: string, feuilles: FeuilleExcel[]) {
  const ExcelJS = (await import("exceljs")).default;
  const classeur = new ExcelJS.Workbook();
  classeur.creator = "Espace POLYNOV";
  classeur.created = new Date();

  for (const f of feuilles) {
    const ws = classeur.addWorksheet(f.nom.slice(0, 31), {
      views: [{ state: "frozen", ySplit: f.sousTitre ? 4 : 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    const nbCol = f.colonnes.length;
    const police = { name: "Calibri", size: 11 };
    const lettres = new Map(f.colonnes.map((c, i) => [c.cle, ws.getColumn(i + 1).letter]));

    // titre
    ws.mergeCells(1, 1, 1, nbCol);
    const titre = ws.getCell(1, 1);
    titre.value = f.titre;
    titre.font = { name: "Calibri", size: 16, bold: true, color: { argb: ROUGE } };
    ws.getRow(1).height = 26;

    let ligneEntete = 3;
    if (f.sousTitre) {
      ws.mergeCells(2, 1, 2, nbCol);
      const st = ws.getCell(2, 1);
      st.value = f.sousTitre;
      st.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5B6168" } };
      ligneEntete = 4;
    }

    // en-tête
    const entete = ws.getRow(ligneEntete);
    f.colonnes.forEach((c, i) => {
      const cell = entete.getCell(i + 1);
      cell.value = c.formule ? `${c.titre} ƒ` : c.titre;
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROUGE } };
      cell.alignment = { vertical: "middle", horizontal: numerique(c.format) ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: "FF8F0000" } } };
      if (c.formule) cell.note = `Formule : =${c.formule.replace(/\[(\w+)\]/g, (_, k: string) => `${f.colonnes.find((x) => x.cle === k)?.titre ?? k}`)}`;
      ws.getColumn(i + 1).width = c.largeur ?? Math.max(12, c.titre.length + 4);
    });
    entete.height = 30;

    // lignes
    f.lignes.forEach((l, k) => {
      const numLigne = ligneEntete + 1 + k;
      const row = ws.getRow(numLigne);
      const enAlerte = f.alerte?.(l) ?? false;
      f.colonnes.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = l[c.cle];
        if (c.formule) {
          const expr = c.formule.replace(/\[(\w+)\]/g, (_, cle: string) => `${lettres.get(cle) ?? "A"}${numLigne}`);
          cell.value = { formula: expr, result: v === null || v === undefined || v === "" ? undefined : numerique(c.format) ? Number(v) : v } as never;
          if (numerique(c.format)) cell.numFmt = formatNombre(c.format);
        } else if (c.format === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
          cell.value = new Date(`${v.slice(0, 10)}T00:00:00Z`);
          cell.numFmt = "dd/mm/yyyy";
        } else if (numerique(c.format) && v !== null && v !== undefined && v !== "") {
          cell.value = Number(v);
          cell.numFmt = formatNombre(c.format);
        } else {
          // une cellule numérique vide reste vide (une formule la compte 0) ; le texte vide reste une chaîne vide
          cell.value = v === null || v === undefined || v === "" ? (numerique(c.format) ? null : "") : v;
        }
        cell.font = c.formule ? { ...police, color: { argb: BLEU_FORMULE } } : police;
        cell.alignment = { vertical: "top", horizontal: numerique(c.format) ? "right" : "left", wrapText: c.format === "texte" || !c.format };
        cell.border = { bottom: { style: "thin", color: { argb: GRIS_BORD } } };
        if (enAlerte) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: JAUNE } };
        else if (k % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_LIGNE } };
      });
    });

    // total
    const derniere = ligneEntete + f.lignes.length;
    if (f.colonnes.some((c) => c.total) && f.lignes.length > 0) {
      const rowT = ws.getRow(derniere + 1);
      const premiereTotal = f.colonnes.findIndex((c) => c.total);
      f.colonnes.forEach((c, i) => {
        const cell = rowT.getCell(i + 1);
        if (c.total) {
          const lettre = ws.getColumn(i + 1).letter;
          cell.value = { formula: `SUBTOTAL(9,${lettre}${ligneEntete + 1}:${lettre}${derniere})` };
          cell.numFmt = formatNombre(c.format);
          cell.alignment = { horizontal: "right" };
        } else if (i === Math.max(0, premiereTotal - 1)) {
          cell.value = f.libelleTotal ?? "Total";
          cell.alignment = { horizontal: "right" };
        }
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF8F0000" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROUGE_PALE } };
        cell.border = { top: { style: "medium", color: { argb: ROUGE } } };
      });
    }

    // notes
    (f.notes ?? []).forEach((n, k) => {
      const r = derniere + 3 + k;
      ws.mergeCells(r, 1, r, nbCol);
      const cell = ws.getCell(r, 1);
      cell.value = n;
      cell.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5B6168" } };
      cell.alignment = { wrapText: true };
    });

    if (f.lignes.length > 0) {
      ws.autoFilter = { from: { row: ligneEntete, column: 1 }, to: { row: derniere, column: nbCol } };
    }
  }

  const tampon = await classeur.xlsx.writeBuffer();
  const blob = new Blob([tampon], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier.endsWith(".xlsx") ? nomFichier : `${nomFichier}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
