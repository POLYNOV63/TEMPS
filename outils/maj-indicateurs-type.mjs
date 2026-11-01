/* ===============================================================
   Indicateurs commerciaux : corrige l'erreur signalée par Visual Studio
   Code (« 'calcul' is possibly 'null' ») sur le Top 10 clients, en
   donnant directement le type de la ligne (LigneInd).
   La page est retrouvée d'elle-même dans app/.
   Utilisation (à la racine du projet) :  node outils/maj-indicateurs-type.mjs
================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
  console.error("✗ Page des indicateurs introuvable dans app/ (lancez le script depuis la racine du projet).");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8");
const cherche = "(l: (typeof calcul.commandes)[number])";
if (!texte.includes(cherche)) {
  console.log("✓ Déjà corrigé : rien à faire.");
  process.exit(0);
}
texte = texte.split(cherche).join("(l: LigneInd)");
writeFileSync(chemin, texte, "utf8");
console.log(`✓ ${chemin} : type de la ligne corrigé\n\nTerminé.`);
