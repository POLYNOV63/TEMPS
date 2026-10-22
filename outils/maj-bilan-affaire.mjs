/* ===============================================================
   Bilan affaire : ajoute le bloc « Vendu et achats » (composant
   components/BilanFinancierAffaire.tsx) au-dessus des résultats.
   Fichier : app/affaires/bilan/page.tsx
   Utilisation (à la racine du projet) :  node outils/maj-bilan-affaire.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/affaires/bilan/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
if (!existsSync("components/BilanFinancierAffaire.tsx")) {
  console.error("✗ components/BilanFinancierAffaire.tsx manque : décompressez d'abord le zip à la racine du projet.");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8");
if (texte.includes("BilanFinancierAffaire")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;

// 1. l'import, après celui de l'en-tête des pages
const imp = /import EnTetePage from "@\/components\/EnTetePage";/;
if (!imp.test(texte)) {
  console.error("✗ Ligne d'import de EnTetePage introuvable");
  erreurs++;
} else {
  texte = texte.replace(imp, (m) => `${m}\nimport BilanFinancierAffaire from "@/components/BilanFinancierAffaire";`);
  console.log("✓ Import ajouté");
}

// 2. le bloc, juste avant les résultats de la recherche
const ancre = /\{\s*rechercheFaite\s*&&\s*\(/;
if (!ancre.test(texte)) {
  console.error("✗ Début des résultats (« rechercheFaite && ( ») introuvable");
  erreurs++;
} else {
  texte = texte.replace(
    ancre,
    (m) => `{/* VENDU_ACHATS : partie financière de l'affaire (visible des responsables, de l'administration et de la Direction) */}
        {rechercheFaite && numero.trim() !== "" && <BilanFinancierAffaire type={typeAffaire} numero={numero.trim()} />}

        ${m}`
  );
  console.log("✓ Bloc « Vendu et achats » ajouté");
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé.");
