/* ===============================================================
   Correctif : les nouvelles vignettes du portefeuille.
   Le calcul avait été remplacé mais pas l'affichage (anciennes vignettes
   « Affaires en cours », « En attente »… encore présentes), d'où l'échec
   du build sur Vercel. Ce script remplace l'ancien bloc d'affichage.
   Utilisation (à la racine du projet) :  node outils/maj-vignettes-portefeuille.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chemin = "app/pilotage/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
const { tuiles } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-vignettes-portefeuille.json"), "utf8"));
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
const repere = texte.indexOf(`libelle="Affaires en cours"`);
if (repere < 0) {
  console.log(texte.includes(`libelle="Commandes en cours"`) ? "✓ Déjà à jour : rien à faire." : "✗ Vignettes introuvables. Copiez ce message à Claude.");
  process.exit(0);
}
const debut = texte.lastIndexOf(`<div style={{ display: "flex", flexWrap: "wrap", gap: 14`, repere);
const fin = texte.indexOf(`{(alertes.critiques.length > 0`, repere);
if (debut < 0 || fin < 0 || fin - debut > 3000) {
  console.error("✗ Début ou fin du bloc des vignettes introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
const debutLigne = texte.lastIndexOf("\n", debut) + 1;
const finLigne = texte.lastIndexOf("\n", fin) + 1;
texte = texte.slice(0, debutLigne) + tuiles + texte.slice(finLigne);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Anciennes vignettes remplacées par les nouvelles\n\nTerminé.");
