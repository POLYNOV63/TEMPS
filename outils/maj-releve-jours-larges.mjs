/* ===============================================================
   Relevé PE / PI : colonnes des jours 25 % plus larges (jours ouvrés
   26 -> 32 px, week-ends et fériés 10 -> 13 px), chiffres un peu plus grands.
   Ne touche qu'à ces largeurs : compatible avec la fiche commande et le
   décalage des jours, installés avant ou après.
   Utilisation (à la racine du projet) :  node outils/maj-releve-jours-larges.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("JOURS_LARGES")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Largeur des jours",
    "          const largeurJour = (j: { weekend: boolean; ferie: boolean }) => (j.weekend || j.ferie ? 10 : 26);",
    "          // JOURS_LARGES : jours ouvrés 32 px, week-ends et fériés 13 px\n          const largeurJour = (j: { weekend: boolean; ferie: boolean }) => (j.weekend || j.ferie ? 13 : 32);",
  ],
  ["Chiffres des cases", "                                        fontSize: ferme ? 9 : 12,", "                                        fontSize: ferme ? 10 : 13,"],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : jours plus larges dans le relevé.");
