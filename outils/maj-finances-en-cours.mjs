/* ===============================================================
   Finances : bouton « Exporter les en-cours » (travail fait et pas encore
   facturé, à la date du jour). Onglets : Synthèse · Forfaits en cours
   (à l'avancement des heures, négoce et achats à part) · PE PI à facturer.
   S'installe après maj-finances-export.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-finances-en-cours.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-finances-en-cours.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("EN_COURS : les en-cours")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("EXPORT_FINANCES_V2")) {
  console.error("✗ Installez d’abord maj-finances-export.mjs, puis relancez ce script.");
  process.exit(1);
}
let erreurs = 0;
for (const ch of changements) {
  if (ch.cherche.startsWith("@@DEBUT@@")) {
    const [debut, fin] = ch.cherche.slice(9).split("@@FIN@@");
    const n = texte.split(debut).length - 1;
    const i = texte.indexOf(debut);
    const j = i < 0 ? -1 : texte.indexOf(fin, i);
    if (n !== 1 || j < 0) {
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois${j < 0 ? ", fin introuvable" : ""}`);
      erreurs++;
      continue;
    }
    texte = texte.slice(0, i) + ch.remplace + texte.slice(j);
    console.log(`✓ ${ch.nom}`);
    continue;
  }
  const n = texte.split(ch.cherche).length - 1;
  if (n !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${n} fois (attendu 1)`);
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
console.log("\nTerminé : export des en-cours dans Finances.");
