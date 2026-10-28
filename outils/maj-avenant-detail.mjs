/* ===============================================================
   Relevé PE / PI : le bandeau « Avenant à prévoir » liste chaque commande
   sur sa ligne, avec son client et sa description.
   Utilisation (à la racine du projet) :  node outils/maj-avenant-detail.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-avenant-detail.json"), "utf8"));
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("AVENANT_DETAIL")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

let erreurs = 0;
for (const ch of changements) {
  if (ch.cherche.startsWith("@@DEBUT@@")) {
    const [debut, fin] = ch.cherche.slice(9).split("@@FIN@@");
    const i = texte.indexOf(debut);
    const n = texte.split(debut).length - 1;
    const j = i < 0 ? -1 : texte.indexOf(fin, i + debut.length);
    if (n !== 1 || j < 0) {
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois${j < 0 ? ", fin introuvable" : ""}`);
      erreurs++;
      continue;
    }
    texte = texte.slice(0, i) + ch.remplace + texte.slice(j);
    console.log(`✓ ${ch.nom}`);
    continue;
  }
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
console.log("\nTerminé : client et description dans « Avenant à prévoir ».");
