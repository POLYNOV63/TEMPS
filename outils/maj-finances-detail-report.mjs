/* ===============================================================
   Finances : le détail du travail « Fait, facturé plus tard », dans une
   fenêtre comme les autres montants : clic sur un montant de la ligne du
   tableau (le mois), ou sur la tuile (tout ce qui reste à facturer sur
   l'exercice). Commande, mois du travail, heures, montant estimé,
   pourquoi, et quand c'est facturé.
   S'installe après maj-finances-reports.mjs et maj-finances-hors-report.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-finances-detail-report.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-finances-detail-report.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("DETAIL_FAIT_PLUS_TARD")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("HORS_ATTERRISSAGE")) {
  console.error("✗ Installez d’abord maj-finances-reports.mjs puis maj-finances-hors-report.mjs, puis relancez ce script.");
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
console.log("\nTerminé : détail du travail facturé plus tard.");
