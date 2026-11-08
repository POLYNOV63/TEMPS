/* ===============================================================
   MAJ - PAGE RENTABILITÉ (RENTABILITE_V1)

   Nouvelle page app/analyse/rentabilite (fournie dans le ZIP) ; tuile
   « Rentabilité » ajoutée au tableau de bord, juste après « Finances » :
   groupe Analyses (ADMIN) et groupe Chiffre d'affaires (DIRECTION).

   À lancer à la racine du projet :   node outils/maj-rentabilite.mjs
   Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PAGE = "app/analyse/rentabilite/page.tsx";
const TABLEAU = "app/dashboard/page.tsx";
const MARQUEUR = "RENTABILITE_V1";
const ADMIN =
  '        <CarteCompacte principale icone="💶" titre="Finances" description="CA de l\'exercice : réalisé, attendu, atterrissage, rentabilité" onClick={() => aller("/analyse/finances")} />\n';
const DIRECTION =
  '          <CarteCompacte principale icone="💶" titre="Finances" description="CA de l\'exercice : réalisé, attendu, atterrissage face au prévisionnel, rentabilité" onClick={() => aller("/analyse/finances")} />\n';
const tuile = (indent) =>
  `${indent}{/* ${MARQUEUR} */}\n${indent}<CarteCompacte icone="📊" titre="Rentabilité" description="Taux vendu, taux obtenu et coût de structure, par activité et par affaire" onClick={() => aller("/analyse/rentabilite")} />\n`;

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
if (!existsSync(PAGE)) echec(`${PAGE} introuvable : décompressez d'abord le ZIP à la racine du projet.`);
if (!existsSync(TABLEAU)) echec(`Fichier introuvable : ${TABLEAU} (lancez la commande à la racine du projet).`);
let t = readFileSync(TABLEAU, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${TABLEAU} : déjà à jour, rien à faire.`);
  process.exit(0);
}
for (const [nom, a] of [["Finances (Analyses)", ADMIN], ["Finances (Direction)", DIRECTION]]) {
  const n = t.split(a).length - 1;
  if (n !== 1) echec(`tuile « ${nom} » trouvée ${n} fois (attendu : 1).`);
}
t = t.replace(ADMIN, (x) => x + tuile("        ")).replace(DIRECTION, (x) => x + tuile("          "));
writeFileSync(TABLEAU, t, "utf8");
console.log("✓ tuile « Rentabilité » ajoutée (Analyses pour l’ADMIN, Chiffre d’affaires pour la Direction)");
console.log(`✓ nouvelle page : ${PAGE}`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
