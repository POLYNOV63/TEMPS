/* ===============================================================
   Facturation du mois : les PE / PI reportées.
   - une ligne dont le mois est reporté (commande pas encore reçue, ou
     report enregistré dans le relevé) ne figure plus dans le tableau à
     facturer ni dans « Ce qui empêche de facturer » : elle est listée dans
     un encadré « Reporté au mois suivant », avec son montant estimé ;
   - le mois où elles se facturent, les heures reportées s'ajoutent au
     montant de la ligne, comme dans le relevé.
   Les modifications sont décrites dans maj-facturation-reports.json.
   Utilisation (à la racine du projet) :  node outils/maj-facturation-reports.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-facturation-reports.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("REPORT_FACTURATION")) {
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
console.log("\nTerminé : PE / PI reportées à part dans la Facturation.");
