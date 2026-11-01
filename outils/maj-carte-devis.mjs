/* ===============================================================
   Tableau de bord : carte « Analyse des devis » (groupe Analyses), juste
   après « Pointé / chiffré ». La page est app/analyse/devis/page.tsx
   (fournie dans le zip).
   Utilisation (à la racine du projet) :  node outils/maj-carte-devis.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (!existsSync("app/analyse/devis/page.tsx")) {
  console.error("✗ app/analyse/devis/page.tsx introuvable : décompressez tout le zip à la racine du projet, puis relancez.");
  process.exit(1);
}
const chemin = "app/dashboard/page.tsx";
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("CARTE_DEVIS")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const lignes = texte.split("\n");
const i = lignes.findIndex((l) => l.includes("CarteCompacte") && l.includes(`description="Pointé face au chiffré, affaire par affaire"`));
if (i < 0) {
  console.error("✗ Carte « Pointé / chiffré » du groupe Analyses introuvable (installez d'abord maj-pointe-bilans.mjs). Rien n'a été modifié.");
  process.exit(1);
}
const retrait = lignes[i].match(/^\s*/)?.[0] ?? "";
lignes.splice(
  i + 1,
  0,
  `${retrait}{/* CARTE_DEVIS */}`,
  `${retrait}<CarteCompacte icone="📝" titre="Analyse des devis" description="Heures passées sur les devis, par qui, et devis devenus commandes" onClick={() => aller("/analyse/devis")} />`
);
writeFileSync(chemin, lignes.join("\n"), "utf8");
console.log("✓ Carte « Analyse des devis » ajoutée au groupe Analyses\n\nTerminé.");
