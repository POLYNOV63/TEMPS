/* ===============================================================
   Contexte IA : ajoute (ou remplace) dans docs/AI_PROJECT_CONTEXT.md la
   section « Mises à jour des sessions 9 et 10 », tirée de
   docs/AI_CONTEXT_SESSIONS_9_10.md. Sans toucher au reste du document.
   Indique la taille finale : l'export « léger » n'en garde que 30 000
   caractères (le « complet » 60 000).
   Utilisation (à la racine du projet) :  node outils/maj-contexte-ia.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const cible = "docs/AI_PROJECT_CONTEXT.md";
const source = "docs/AI_CONTEXT_SESSIONS_9_10.md";
if (!existsSync(source)) {
  console.error(`✗ ${source} introuvable : décompressez tout le zip à la racine du projet.`);
  process.exit(1);
}
const section = readFileSync(source, "utf8").replace(/\r\n/g, "\n").trim();
let doc = existsSync(cible) ? readFileSync(cible, "utf8").replace(/\r\n/g, "\n") : "# POLYNOV - Contexte métier\n";

const debut = "<!-- SESSIONS_9_10 : début";
const fin = "<!-- SESSIONS_9_10 : fin -->";
if (doc.includes(debut) && doc.includes(fin)) {
  const a = doc.indexOf(debut);
  const b = doc.indexOf(fin) + fin.length;
  doc = doc.slice(0, a) + section + doc.slice(b);
  console.log("✓ Section des sessions 9 et 10 remplacée");
} else {
  doc = doc.trimEnd() + "\n\n" + section + "\n";
  console.log("✓ Section des sessions 9 et 10 ajoutée à la fin");
}
writeFileSync(cible, doc, "utf8");

const n = doc.length;
console.log(`\n${cible} : ${n.toLocaleString("fr-FR")} caractères.`);
if (n > 30000) console.log("⚠ Plus de 30 000 caractères : l'export LÉGER coupera la fin du document. Envoyez-le à Claude pour le condenser.");
else console.log("✓ Tient entièrement dans l'export léger (30 000 caractères).");
console.log("\nTerminé.");
