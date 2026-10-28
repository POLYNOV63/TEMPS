/* ===============================================================
   Analyse des effectifs : ce qui change dans les pages existantes.
   - Collaborateurs : dans « Modifier », des cases « Prédominance » (une ou
     plusieurs activités, la liste suit « Gestion des activités ») ; les
     prédominances s'affichent sur la carte de chacun ;
   - Tableau de bord : la carte « Analyse des effectifs » (administration
     et Direction).
   La page /analyse/effectifs elle-même est fournie complète dans le zip.
   Prérequis : SQL 67 passé.
   Utilisation (à la racine du projet) :  node outils/maj-analyse-effectifs.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-analyse-effectifs.json"), "utf8"));
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier]) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
if (Object.values(fichiers).every((t) => t.includes("PREDOMINANCES") || t.includes("analyse/effectifs"))) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
for (const ch of changements) {
  const t = fichiers[ch.fichier];
  const nb = t.split(ch.cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  fichiers[ch.fichier] = t.replace(ch.cherche, () => ch.remplace);
  console.log(`✓ ${ch.nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [f, t] of Object.entries(fichiers)) writeFileSync(f, t, "utf8");
console.log("\nTerminé : prédominances dans la fiche, carte « Analyse des effectifs » au tableau de bord.");
