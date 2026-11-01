/* ===============================================================
   Portefeuille, familles plus lisibles :
   - Chiffré : le total de la famille seul (le détail est dans ▸) ;
   - Reste : plus de rappel du chiffré ;
   - À affecter : reste de la famille − ce qui est planifié sur ses commandes ;
   - détail par activité : toute la famille (le pointé est sur la base),
     avec un titre au-dessus de chaque tableau.
   S'installe après maj-portefeuille-familles.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-fluide.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-portefeuille-fluide.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("FAMILLE_FLUIDE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("FAMILLE_DETAIL")) {
  console.error("✗ Installez d’abord maj-portefeuille-familles.mjs, puis relancez ce script.");
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
console.log("\nTerminé : portefeuille plus lisible pour les familles.");
