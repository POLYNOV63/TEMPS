/* ===============================================================
   Indicateurs commerciaux : bouton « Exercice » avec un menu pour choisir
   l'exercice analysé (en cours ou un des trois précédents). La page des
   indicateurs est retrouvée d'elle-même dans app/.
   Utilisation (à la racine du projet) :  node outils/maj-exercice-choisi.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function chercher(dossier) {
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) {
      const r = chercher(p);
      if (r) return r;
    } else if (nom === "page.tsx" && readFileSync(p, "utf8").includes("PILOTAGE BE - INDICATEURS")) return p;
  }
  return null;
}
const chemin = chercher("app");
if (!chemin) {
  console.error("✗ Page des indicateurs commerciaux introuvable dans app/ (lancez le script depuis la racine du projet).");
  process.exit(1);
}
console.log(`  page des indicateurs : ${chemin}`);
const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-exercice-choisi.json"), "utf8"));
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("EXERCICE_CHOISI")) {
  console.log("✓ Indicateurs : déjà à jour");
} else {
  let erreurs = 0;
  for (const ch of changements) {
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
}

console.log("\nTerminé : choix de l’exercice dans les indicateurs commerciaux.");
