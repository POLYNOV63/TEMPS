/* ===============================================================
   Relevé PE / PI : retire pour de bon l'ancienne alerte « le taux des
   lignes ne correspond pas… » de la fiche commande (la version 3 l'avait
   seulement désactivée, ce que TypeScript refuse au build sur Vercel).
   Utilisation (à la racine du projet) :  node outils/maj-fiche-sans-alerte-taux.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
const debut = "{false && tousPropres && (";
const i = texte.indexOf(debut);
if (i < 0) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const fin = "\n                )}";
const j = texte.indexOf(fin, i);
if (j < 0 || texte.slice(i, j).length > 1500) {
  console.error("✗ Fin du bloc introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
// on retire aussi les espaces qui précèdent le bloc sur sa ligne
const debutLigne = texte.lastIndexOf("\n", i) + 1;
texte = texte.slice(0, debutLigne) + texte.slice(j + fin.length + 1);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Ancienne alerte sur le taux retirée de la fiche commande\n\nTerminé.");
