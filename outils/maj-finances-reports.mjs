/* ===============================================================
   Finances : le travail des PE / PI reportées (fait, facturé plus tard).
   - ligne « Fait, facturé plus tard » au mois où le travail a été fait ;
   - réalisé et atterrissage restent le FACTURÉ ;
   - l'attendu compte un mois reporté au mois où il sera facturé ;
   - tuile « Fait, facturé après le 31/10 » pour le rapprochement avec la
     comptabilité (factures à établir), avec la production de l'exercice.
   Les modifications sont décrites dans maj-finances-reports.json.
   Utilisation (à la racine du projet) :  node outils/maj-finances-reports.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-finances-reports.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("FAIT_PLUS_TARD")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
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
console.log("\nTerminé : Finances, travail fait et facturé plus tard.");
