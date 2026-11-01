/* ===============================================================
   Onglets de « Charge & pointage » : l'onglet « Par collaborateur »
   s'appelle désormais « Bilans » (c'est le bilan de la capacité :
   où part le temps disponible, sur une période choisie).
   Utilisation (à la racine du projet) :  node outils/maj-onglet-bilans.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "components/analyse/OngletsCharge.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ONGLET_BILANS")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const candidats = ["Par collaborateur", "Par collaborateurs", "Collaborateurs"];
const trouve = candidats.find((c) => texte.split(`"${c}"`).length === 2 || texte.split(`>${c}<`).length === 2);
if (!trouve) {
  console.error("✗ Libellé de l'onglet introuvable. Rien n'a été modifié. Envoyez à Claude le contenu de components/analyse/OngletsCharge.tsx.");
  process.exit(1);
}
texte = texte.includes(`"${trouve}"`) ? texte.replace(`"${trouve}"`, `"Bilans"`) : texte.replace(`>${trouve}<`, ">Bilans<");
texte = `/* ONGLET_BILANS : « ${trouve} » renommé « Bilans » */\n` + texte;
writeFileSync(chemin, texte, "utf8");
console.log(`✓ Onglet « ${trouve} » renommé « Bilans »\n\nTerminé.`);
