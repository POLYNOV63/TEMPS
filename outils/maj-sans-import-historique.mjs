/* ===============================================================
   Tableau de bord : la carte « Import Récupération heures » est retirée
   du Paramétrage (bascule au 2 novembre 2026 : les heures d'avant viennent
   de l'historique déjà importé, celles d'après des feuilles de
   l'application). La page /import-historique-v2 existe toujours : on peut
   y revenir en tapant son adresse, pour corriger une semaine.
   Utilisation (à la racine du projet) :  node outils/maj-sans-import-historique.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/dashboard/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
const lien = `        ["📥", "Import Récupération heures", "/import-historique-v2"],\n`;
const carte = `          <CarteCompacte icone="📥" titre="Import Récupération heures" description="Importer les anciennes imputations depuis un fichier" onClick={() => aller("/import-historique-v2")} />\n`;
const avant = texte;
texte = texte.split(lien).join("").split(carte).join("");
if (texte === avant) {
  console.log("✓ Déjà à jour : la carte n'est plus au tableau de bord.");
  process.exit(0);
}
writeFileSync(chemin, texte, "utf8");
console.log("✓ Carte « Import Récupération heures » retirée du Paramétrage\n\nTerminé.");
