/* ===============================================================
   MAJ RENTABILITÉ - COLONNE ACTIVITÉ (RENTABILITE_ACTIVITE)

   « Forfaits livrés, affaire par affaire » : nouvelle colonne
   « Activité » (l'activité principale de l'affaire : celle qui porte le
   plus gros montant, à défaut le plus d'heures passées ; Négoce ou Scan
   pour une affaire vendue au montant), avec la couleur de l'activité
   (celles des Indicateurs commerciaux), triable comme les autres. Trier
   par activité range les affaires de même activité ensemble, les moins
   rentables d'abord.

   À lancer à la racine du projet :   node outils/maj-rentabilite-activite.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/rentabilite/page.tsx";
const MARQUEUR = "RENTABILITE_ACTIVITE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const R = [
  [
    "type",
    'type Affaire = LigneRenta & { base: string; designation: string | null; client: string | null; fin: string; imputation: string | null; nonVentile: "CHIFFRE" | "PASSE" | "AUCUN" | null };',
    `type Affaire = LigneRenta & { base: string; designation: string | null; client: string | null; fin: string; imputation: string | null; nonVentile: "CHIFFRE" | "PASSE" | "AUCUN" | null; activite: string };
/* ${MARQUEUR} : couleurs des activités (celles des Indicateurs commerciaux) */
const COULEUR_ACTIVITE: Record<string, string> = { "Méca": "#c00000", Calcul: "#6b58a8", "Elec / Pneu": "#34506b", Scan: "#e08a1e", "Négoce": "#8d6e63", Autre: "#9aa0a6", "Non ventilé": "#9aa0a6" };`,
  ],
  [
    "activité principale",
    "      affaires.push({\n        cle: base,",
    `      const activite = (() => {
        if (montant) return /^scan/.test(sansAccents(a.imputation)) ? "Scan" : "Négoce";
        let meilleure = "Non ventilé";
        let plus = 0;
        for (const g of GROUPES) if (g !== "Non ventilé" && (pg[g] ?? 0) > plus) [meilleure, plus] = [g, pg[g]];
        if (plus <= 0) for (const g of GROUPES) if ((rg[g] ?? 0) > plus) [meilleure, plus] = [g, rg[g]];
        return meilleure;
      })();
      affaires.push({
        activite,
        cle: base,`,
  ],
  ["tri : type", "  type LigneTri = LigneRenta & { base?: string; client?: string | null; fin?: string; imputation?: string | null; nbMois?: number };", "  type LigneTri = LigneRenta & { base?: string; client?: string | null; fin?: string; imputation?: string | null; nbMois?: number; activite?: string };"],
  ["tri : valeur", '      case "client": return (l.client ?? "~").toLowerCase();', '      case "client": return (l.client ?? "~").toLowerCase();\n      case "activite": return l.activite ?? "~";'],
  ["tri : en-tête", '    const cles: Record<string, string> = { Affaire: "numero", Client: "client",', '    const cles: Record<string, string> = { Affaire: "numero", "Activité": "activite", Client: "client",'],
  ["tri croissant", 'col === "numero" || col === "client" || col === "type" ? 1 : -1', 'col === "numero" || col === "client" || col === "type" || col === "activite" ? 1 : -1'],
  ['colonnes', '<thead>{enTetes("Affaire", ["Client", "Livrée le"], { etat: triF, changer: changerTri(setTriF) })}</thead>', '<thead>{enTetes("Affaire", ["Activité", "Client", "Livrée le"], { etat: triF, changer: changerTri(setTriF) })}</thead>'],
  [
    "cellule",
    '                          <td style={{ ...tdG, fontWeight: 400 }}>{a.client ?? "—"}</td>\n                          <td style={{ ...tdG, fontWeight: 400 }}>{formatDate(a.fin)}</td>',
    `                          <td style={{ ...tdG, fontWeight: 700, whiteSpace: "nowrap" }}>
                            <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: COULEUR_ACTIVITE[a.activite] ?? "#9aa0a6", marginRight: 6 }} />
                            {a.activite}
                          </td>
                          <td style={{ ...tdG, fontWeight: 400 }}>{a.client ?? "—"}</td>
                          <td style={{ ...tdG, fontWeight: 400 }}>{formatDate(a.fin)}</td>`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ colonne « Activité » triable dans les forfaits livrés");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
