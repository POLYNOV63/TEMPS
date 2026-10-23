/* ===============================================================
   Mon espace RH (app/RH/page.tsx) : affichage téléphone.
   - cartes empilées sur une colonne, soldes CP sur deux colonnes ;
   - formulaire de demande sur une colonne, champs et boutons plus grands ;
   - « Mes demandes » en fiches (une par demande) au lieu d'un tableau.
   Rien ne change sur ordinateur.
   Utilisation (à la racine du projet) :  node outils/maj-rh-mobile.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/RH/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8");
if (texte.includes("CSS_MOBILE_RH")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;

const changements = [
  [
    "Feuille de styles téléphone dans la page",
    /<main style=\{styles\.page\}>(\s*<EnTetePage\s+forme="encadre"\s+section="Espace collaborateur"\s+titre="Mon espace RH"\s+description=)/,
    '<main style={styles.page} className="rh-page">\n      <style>{CSS_MOBILE_RH}</style>$1',
    1,
  ],
  ["Grille des compteurs", /<section(\s+style=\{\{\s*\.\.\.styles\.grid,)/, '<section className="rh-grille"$1', 1],
  ["Grille des congés", /<section style=\{styles\.grid\}>/, '<section className="rh-grille" style={styles.grid}>', 1],
  ["Cartes larges", /style=\{\{(\s*)\.\.\.styles\.card,(\s*)gridColumn:/g, 'className="rh-pleine" style={{$1...styles.card,$2gridColumn:', 2],
  ["Détail des CP", /<div style=\{styles\.cpGrid\}>/, '<div className="rh-cp" style={styles.cpGrid}>', 1],
  ["Formulaire", /<div style=\{styles\.formGrid\}>/, '<div className="rh-form" style={styles.formGrid}>', 1],
  ["Dates de la demande", /<div style=\{styles\.periodeGrid\}>/, '<div className="rh-periode" style={styles.periodeGrid}>', 1],
  ["Tableau « Mes demandes »", /<table(\s+)style=\{(\s*)styles\.table(\s*)\}(\s*)>/, '<table className="rh-table"$1style={$2styles.table$3}$4>', 1],
];

for (const [nom, cherche, remplace, attendu] of changements) {
  const nb = (texte.match(new RegExp(cherche.source, "g")) ?? []).length;
  if (nb !== attendu) {
    console.error(`✗ ${nom} : trouvé ${nb} fois (attendu ${attendu})`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

texte += `

/* RH_MOBILE : affichage téléphone (< 760 px). Les styles de la page sont écrits dans les balises :
   ces règles « !important » les remplacent seulement sur petit écran. */
const CSS_MOBILE_RH = \`
@media (max-width: 760px) {
  .rh-page { padding: 10px 10px 48px !important; }
  .rh-grille { grid-template-columns: 1fr !important; gap: 12px !important; }
  .rh-pleine { grid-column: auto !important; }
  .rh-cp { grid-template-columns: 1fr 1fr !important; }
  .rh-form { grid-template-columns: 1fr !important; }
  .rh-periode { grid-column: auto !important; grid-template-columns: 1fr !important; }
  .rh-page input, .rh-page select, .rh-page textarea { font-size: 16px !important; min-height: 44px; box-sizing: border-box; width: 100%; }
  .rh-page input[type="checkbox"] { width: auto; min-height: 0; }
  .rh-page button { min-height: 44px; }
  .rh-table thead { display: none; }
  .rh-table, .rh-table tbody, .rh-table tr, .rh-table td { display: block; width: 100%; box-sizing: border-box; }
  .rh-table tr { border: 1px solid #e2e5e9; border-radius: 12px; padding: 8px 12px; margin-bottom: 10px; background: #ffffff; }
  .rh-table td { display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: right !important; padding: 6px 0; border: none !important; }
  .rh-table td::before { font-weight: 700; color: #6d737a; text-align: left; font-size: 13px; }
  .rh-table td:nth-child(1)::before { content: "Type"; }
  .rh-table td:nth-child(2)::before { content: "Période"; }
  .rh-table td:nth-child(3)::before { content: "Durée"; }
  .rh-table td:nth-child(4)::before { content: "Statut"; }
  .rh-table td:nth-child(5)::before { content: "Validation"; }
  .rh-table td:nth-child(6)::before { content: "Transmission"; }
  .rh-table td:nth-child(7)::before { content: ""; }
  .rh-table td:nth-child(1) { font-weight: 800; font-size: 16px; }
}
\`;
`;

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : Mon espace RH s'adapte au téléphone.");
