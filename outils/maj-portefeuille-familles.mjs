/* ===============================================================
   Portefeuille :
   - une seule ligne par famille (commande de base et avenants), avec un
     repère « ⧉ 3 commandes » ; le détail (▸) liste chaque commande avec
     son statut, son délai et son chiffré ;
   - les PE / PI sans activité depuis 3 mois regroupées dans une rubrique
     repliée, comme les affaires inactives (plus de bouton de filtre) ;
   - le repère « sans activité » ne déborde plus de sa colonne.
   S'installe après maj-dormantes-familles.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-familles.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-portefeuille-familles.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("FAMILLE_UNE_LIGNE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("DORMANTES_PORTEFEUILLE")) {
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
console.log("\nTerminé : une ligne par famille, commandes sans activité regroupées.");
