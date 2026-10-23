/* ===============================================================
   Finances : la ligne « Atterrissage » devient cliquable ; le clic sur
   un mois ouvre le RAPPROCHEMENT avec la page Facturation (même mois),
   affaire par affaire, avec l'écart et sa raison.
   Prérequis : node outils/maj-finances-detail.mjs déjà lancé.
   Utilisation (à la racine du projet) :  node outils/maj-finances-rapprochement.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/analyse/finances/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes('ligne: "ATTERRISSAGE"')) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("DETAIL_MONTANT_V3")) {
  console.error("✗ Lancez d'abord : node outils/maj-finances-detail.mjs");
  process.exit(1);
}
const avant = '{ligneValeurs("Atterrissage", atterrissage, { fontWeight: 800, background: "#fff4f4" })}';
const apres = '{ligneValeurs("Atterrissage", atterrissage, { fontWeight: 800, background: "#fff4f4" }, (i) => setDetail({ mois: mois[i], ligne: "ATTERRISSAGE" }))}';
const nb = texte.split(avant).length - 1;
if (nb !== 1) {
  console.error(`✗ Ligne « Atterrissage » trouvée ${nb} fois (attendu 1). Rien n'a été modifié : copiez ce message à Claude.`);
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, texte, "utf8");
writeFileSync(chemin, texte.replace(avant, apres), "utf8");
console.log("✓ Atterrissage cliquable\n\nTerminé : rapprochement Finances ↔ Facturation.");
