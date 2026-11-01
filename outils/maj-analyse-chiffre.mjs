/* ===============================================================
   « Analyse du chiffré » : la page app/analyse/pointage/page.tsx est
   remplacée en entier (fournie dans le zip) ; ce script renomme ses
   cartes au tableau de bord.
   Utilisation (à la racine du projet) :  node outils/maj-analyse-chiffre.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const page = "app/analyse/pointage/page.tsx";
if (!existsSync(page) || !readFileSync(page, "utf8").includes("ANALYSE DU CHIFFRÉ")) {
  console.error("✗ La nouvelle page n'est pas en place : décompressez tout le zip à la racine (en acceptant de remplacer), puis relancez.");
  process.exit(1);
}
console.log("✓ Page « Analyse du chiffré » en place");
const chemin = "app/dashboard/page.tsx";
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
const avant = texte;
texte = texte
  .split(`titre="Pointé / chiffré"`).join(`titre="Analyse du chiffré"`)
  .split(`titre="Charge & pointage"`).join(`titre="Analyse du chiffré"`)
  .split(`description="Pointé face au chiffré, affaire par affaire"`).join(`description="Heures produites face aux heures chiffrées, par commande"`)
  .split(`description="Pointé face au chiffré, par affaire et par activité"`).join(`description="Heures produites face aux heures chiffrées, par commande"`);
if (texte !== avant) {
  writeFileSync(chemin, texte, "utf8");
  console.log("✓ Cartes du tableau de bord renommées « Analyse du chiffré »");
} else console.log("✓ Tableau de bord : rien à renommer");
console.log("\nTerminé.");
