/* ===============================================================
   Finances : le travail des PE / PI reportées n'entre plus du tout dans
   l'attendu (donc ni dans l'atterrissage) : il ne compte qu'une fois
   facturé, le mois où il est clôturé. La tuile « Fait, facturé plus tard »
   en donne le total, à part.
   S'installe après maj-finances-reports.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-finances-hors-report.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-finances-hors-report.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("HORS_ATTERRISSAGE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("FAIT_PLUS_TARD")) {
  console.error("✗ Installez d'abord maj-finances-reports.mjs, puis relancez ce script.");
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
console.log("\nTerminé : le travail facturé plus tard sort de l’attendu et de l’atterrissage.");
