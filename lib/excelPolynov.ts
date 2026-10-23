/* ===============================================================
   EXPORT EXCEL AUX COULEURS DE POLYNOV

   Classeur mis en page : titre rouge, ligne d'en-tête rouge POLYNOV
   (#C00000) en blanc gras, Calibri, lignes alternées, montants au
   format « 1 234,56 € », ligne de total, en-tête figé, filtres
   automatiques, lignes en alerte surlignées en jaune.

   Utilise la bibliothèque exceljs (npm install exceljs), chargée
   seulement au moment de l'export.
================================================================ */

export type FormatColonne = "texte" | "euros" | "nombre" | "date";

export type ColonneExcel = {
  titre: string;
  cle: string;
  largeur?: number;
  format?: FormatColonne;
  /* additionnée dans la ligne de total */
  total?: boolean;
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
      cell.value = c.titre;
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROUGE } };
      cell.alignment = { vertical: "middle", horizontal: c.format === "euros" || c.format === "nombre" ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: "FF8F0000" } } };
      ws.getColumn(i + 1).width = c.largeur ?? Math.max(12, c.titre.length + 4);
    });
    entete.height = 22;

    // lignes
    f.lignes.forEach((l, k) => {
      const row = ws.getRow(ligneEntete + 1 + k);
      const enAlerte = f.alerte?.(l) ?? false;
      f.colonnes.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = l[c.cle];
        if (c.format === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
          cell.value = new Date(`${v.slice(0, 10)}T00:00:00Z`);
          cell.numFmt = "dd/mm/yyyy";
        } else if ((c.format === "euros" || c.format === "nombre") && v !== null && v !== undefined && v !== "") {
          cell.value = Number(v);
          cell.numFmt = c.format === "euros" ? '#,##0.00 "€"' : "#,##0.##";
        } else {
          cell.value = v === null || v === undefined ? "" : v;
        }
        cell.font = police;
        cell.alignment = { vertical: "top", horizontal: c.format === "euros" || c.format === "nombre" ? "right" : "left", wrapText: c.format === "texte" || !c.format };
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
          cell.numFmt = c.format === "euros" ? '#,##0.00 "€"' : "#,##0.##";
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
