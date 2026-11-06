/* ===============================================================
   NOTE DE FRAIS : remplissage du gabarit Excel (public/gabarits/note-de-frais.xlsx,
   copie de CT-NFP) avec la saisie de l'application. Seules les cases à remplir
   sont écrites : les formules du classeur (prix au km, coûts, total) font le
   reste à l'ouverture dans Excel.
================================================================ */

export type DepNote = { jour: string | null; depart: string; site: string; km: number | null; ar?: boolean };
export type FraisNote = { jour: string | null; nature: string; commentaire: string; montant: number };
export type NotePourExcel = {
  qui: string;
  mois: string; // AAAA-MM-01
  vehicule: string;
  puissance: string;
  kmDomicile: number | null;
  deplacements: DepNote[];
  regDepart: string;
  regSite: string;
  regKmJour: number | null;
  regNbTrajets: number | null;
  frais: FraisNote[];
  /* barème réglé par l'administration : recopié dans l'onglet Prix-Km du classeur */
  bareme?: { puissance: string; prix_km: number }[];
};

export const MAX_DEPLACEMENTS_EXCEL = 8;

export async function remplirNoteExcel(n: NotePourExcel): Promise<Blob> {
  const reponse = await fetch("/gabarits/note-de-frais.xlsx");
  if (!reponse.ok) throw new Error("Gabarit introuvable : public/gabarits/note-de-frais.xlsx.");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await reponse.arrayBuffer());
  const ws = wb.getWorksheet("Note de frais");
  const px = wb.getWorksheet("Prix-Km");
  if (!ws) throw new Error("Onglet « Note de frais » introuvable dans le gabarit.");

  // la puissance doit être écrite EXACTEMENT comme dans la liste du classeur (« 6 CV » y a une espace finale)
  let puissance = n.puissance;
  if (px) {
    for (let r = 3; r <= 7; r++) {
      const v = String(px.getCell(`B${r}`).value ?? "");
      if (v.trim() === n.puissance.trim()) puissance = v;
      // prix au km de l'application (modifiable par l'administration), pour que le classeur calcule pareil
      const b = n.bareme?.find((x) => x.puissance.trim() === v.trim());
      if (b) px.getCell(`C${r}`).value = b.prix_km;
    }
  }
  const date = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

  ws.getCell("C7").value = n.qui;
  ws.getCell("C8").value = n.vehicule || null;
  ws.getCell("C9").value = puissance || null;
  ws.getCell("C11").value = n.kmDomicile;

  n.deplacements.slice(0, MAX_DEPLACEMENTS_EXCEL).forEach((d, i) => {
    const r = 8 + i;
    const cDate = ws.getCell(`E${r}`);
    cDate.value = date(d.jour);
    cDate.numFmt = "dd/mm/yyyy";
    // le classeur compte des km A/R et retire 2 × domicile au départ du domicile : un A/R s'y écrit tel quel (km × 2) ;
    // un aller simple s'écrit en km déjà indemnisés, départ « Polynov », pour que le classeur calcule juste
    const ar = d.ar !== false;
    if (ar || d.km === null) {
      ws.getCell(`F${r}`).value = d.depart || null;
      ws.getCell(`G${r}`).value = d.site || null;
      ws.getCell(`H${r}`).value = d.km === null ? null : d.km * (ar ? 2 : 1);
    } else {
      const indemnises = Math.max(0, d.km - (d.depart === "Domicile" ? n.kmDomicile ?? 0 : 0));
      ws.getCell(`F${r}`).value = "Polynov";
      ws.getCell(`G${r}`).value = `${d.site || ""} (aller simple${d.depart === "Domicile" ? ", départ domicile" : ""})`.trim();
      ws.getCell(`H${r}`).value = indemnises;
    }
  });

  if ((n.regKmJour ?? 0) > 0 && (n.regNbTrajets ?? 0) > 0) {
    ws.getCell("C14").value = new Date(`${n.mois}T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    ws.getCell("C15").value = n.regDepart || null;
    ws.getCell("C16").value = n.regSite || null;
    ws.getCell("C17").value = n.regKmJour;
    ws.getCell("C18").value = n.regNbTrajets;
  }

  // frais annexes : le classeur n'a qu'une ligne ; on y met le total et le détail en commentaire
  if (n.frais.length > 0) {
    const fr = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "");
    ws.getCell("G18").value = n.frais
      .map((f) => `${f.nature || "Frais"}${f.jour ? ` ${fr(f.jour)}` : ""} : ${f.montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €${f.commentaire ? ` (${f.commentaire})` : ""}`)
      .join(" ; ");
    ws.getCell("I18").value = Math.round(n.frais.reduce((t, f) => t + f.montant, 0) * 100) / 100;
  }

  // Excel recalcule toutes les formules à l'ouverture
  wb.calcProperties.fullCalcOnLoad = true;
  const octets = await wb.xlsx.writeBuffer();
  return new Blob([octets], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
