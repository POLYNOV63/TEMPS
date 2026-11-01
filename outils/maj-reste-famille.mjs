/* ===============================================================
   Relevé PE / PI, encadré « Commandes ouvertes sans activité » : pour une
   commande avec avenants, le reste affiché est celui de toute la famille
   en cours (base + avenants), avec le détail au survol ; le total
   « reste disponible » aussi.
   S'installe après maj-dormantes-familles.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-reste-famille.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-reste-famille.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("RESTE_FAMILLE_DORMANTE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("DORMANTES_RELEVE")) {
  console.error("✗ Installez d’abord maj-dormantes-familles.mjs, puis relancez ce script.");
  process.exit(1);
}

let erreurs = 0;
for (const ch of changements) {
  const nb = texte.split(ch.cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(ch.cherche, () => ch.remplace);
  console.log(`✓ ${ch.nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : reste de la famille dans les commandes sans activité.");
