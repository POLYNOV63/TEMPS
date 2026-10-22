/* ===============================================================
   Demi-journée de CP ou de RTT : l'alerte « entre 3 h et 4,5 h »
   s'affiche DÈS LA SAISIE des heures (et plus seulement à
   l'enregistrement), à la place de « Il reste … h à travailler ».
   Fichier : app/ma-semaine/MaSemaineContent.tsx
   Utilisation (à la racine du projet) :  node outils/maj-demi-conge-direct.mjs
   Il faut avoir lancé avant : maj-ma-semaine-rh.mjs puis maj-demi-conge.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/ma-semaine/MaSemaineContent.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8");
const original = texte;
let erreurs = 0;

if (texte.includes("function demiHorsPlage(")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

// pré-requis : les deux scripts précédents
if (!texte.includes("function ajusterRecuperation(")) {
  console.error("✗ Lancez d'abord : node outils/maj-ma-semaine-rh.mjs");
  erreurs++;
}
if (!/cpHeures\s*<\s*3\s*\|\|\s*cpHeures\s*>\s*4\.5/.test(texte)) {
  console.error("✗ Lancez d'abord : node outils/maj-demi-conge.mjs");
  erreurs++;
}

// 1. la règle, une seule fois
texte = texte.replace(
  "function ajusterRecuperation(",
  `/* DEMI_CONGE_DIRECT : une demi-journée de CP ou de RTT compte entre 3 h et 4,5 h */
function demiHorsPlage(valeur: string) {
  const h = convertirHeures(valeur);
  return h > 0 && (h < 3 || h > 4.5);
}

function ajusterRecuperation(`
);

// 2. l'alerte dès la saisie, à la place de « Il reste … h à travailler. »
const motif = /`Il reste \$\{formatHeures\(cibleTravailJour\(jour, codesImputation\)\)\} h à travailler\.`/g;
const nb = (texte.match(motif) ?? []).length;
if (nb === 0) {
  console.error("✗ Texte « Il reste … h à travailler. » introuvable");
  erreurs++;
} else {
  texte = texte.replace(
    motif,
    "(demiHorsPlage(jour.heuresAbsence) ? \"⚠ Une demi-journée compte entre 3 h et 4,5 h : corrigez les heures (en général 3,5 h ou 4 h).\" : `Il reste ${formatHeures(cibleTravailJour(jour, codesImputation))} h à travailler.`)"
  );
  console.log(`✓ Alerte dès la saisie (${nb} endroits)`);
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak2`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé.");
