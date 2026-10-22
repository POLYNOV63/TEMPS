/* ===============================================================
   Demi-journée de CP ou de RTT : entre 3 h et 4,5 h (au lieu de 5 h).
   Fichier : app/ma-semaine/MaSemaineContent.tsx
   Utilisation (à la racine du projet) :  node outils/maj-demi-conge.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/ma-semaine/MaSemaineContent.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8");
const original = texte;

const changements = [
  ["CP : plafond à 4,5 h", /cpHeures\s*<\s*3\s*\|\|\s*cpHeures\s*>\s*5\b/, "cpHeures < 3 || cpHeures > 4.5"],
  ["RTT : plafond à 4,5 h", /heuresRTT\s*<\s*3\s*\|\|\s*heuresRTT\s*>\s*5\b/, "heuresRTT < 3 || heuresRTT > 4.5"],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const n = (texte.match(new RegExp(cherche.source, "g")) ?? []).length;
  if (n !== 1) {
    console.error(`✗ ${nom} : passage ${n === 0 ? "introuvable (le script maj-ma-semaine-rh a-t-il été lancé ?)" : `trouvé ${n} fois`}`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}
// messages et notes : « entre 3 h et 5 h » devient « entre 3 h et 4,5 h »
const nbTextes = (texte.match(/entre 3 h et 5 h/g) ?? []).length;
if (nbTextes === 0) {
  console.error("✗ Messages « entre 3 h et 5 h » introuvables");
  erreurs++;
} else {
  texte = texte.replace(/entre 3 h et 5 h/g, "entre 3 h et 4,5 h");
  console.log(`✓ Messages et notes mis à jour (${nbTextes})`);
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : demi-journée de congé entre 3 h et 4,5 h.");
