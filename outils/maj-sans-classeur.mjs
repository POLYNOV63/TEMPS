/* ===============================================================
   Relevé PE / PI : retire le repère « ⚠ classeur 27 » (et la mention
   « Suivi des prestations » au survol du reste). Depuis le 2 novembre 2026
   le relevé fait foi et l'import du classeur des prestations est retiré :
   son reste est figé et ne peut plus que semer le doute.
   Utilisation (à la racine du projet) :  node outils/maj-sans-classeur.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
let fait = 0;

// 1. le repère sous la pastille du reste
const repere = /\n[ \t]*\{ecartClasseur && <div[^\n]*classeur \{texteHeures\(resteClasseur \?\? 0\)\}<\/div>\}/g;
const n1 = (texte.match(repere) ?? []).length;
texte = texte.replace(repere, "");
fait += n1;
console.log(n1 ? `✓ Repère « ⚠ classeur » retiré (${n1})` : "• Repère « ⚠ classeur » : déjà absent");

// 2. la mention au survol
const survol = /\$\{resteClasseur !== null \? ` · Suivi des prestations : \$\{texteHeures\(resteClasseur\)\} \$\{u\}` : ""\}/g;
const n2 = (texte.match(survol) ?? []).length;
texte = texte.replace(survol, "");
fait += n2;
console.log(n2 ? `✓ Mention « Suivi des prestations » au survol retirée (${n2})` : "• Mention au survol : déjà absente");

if (fait > 0) writeFileSync(chemin, texte, "utf8");
const reste = (texte.match(/Suivi des prestations/g) ?? []).length;
if (reste > 0) console.log(`\n• Il reste ${reste} mention(s) « Suivi des prestations » ailleurs dans la page (texte d'aide ou fiche) : rien de gênant, dites-le à Claude si vous en voyez une à l'écran.`);
console.log("\nTerminé.");
