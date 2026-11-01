/* ===============================================================
   Planning par ressource : le titre de chaque activité dit clairement
   ce que mesure sa charge (« du 26/10 au 18/12 : 2 614 h planifiées sur
   3 539 h disponibles · 74 % de charge »), avec une explication au survol.
   Utilisation (à la racine du projet) :  node outils/maj-charge-groupe.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chemin = "app/pilotage/planning-ressources/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
const { ancien, nouveau } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-charge-groupe.json"), "utf8"));
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("CHARGE_GROUPE_EXPLIQUEE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (texte.split(ancien).length !== 2) {
  console.error("✗ Titre des activités introuvable (installez d'abord maj-plannings-releve.mjs). Rien n'a été modifié.");
  process.exit(1);
}
writeFileSync(chemin, texte.replace(ancien, () => nouveau), "utf8");
console.log("✓ Titre des activités : charge expliquée\n\nTerminé.");
