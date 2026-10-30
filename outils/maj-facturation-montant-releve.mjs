/* ===============================================================
   Facturation du mois : les PE / PI prennent le MÊME montant que le relevé
   (figé si le mois est clôturé, sinon heures × taux + heures sup + reports).
   Le montant importé du Suivi des prestations n'est plus qu'un contrôle :
   « ⚠ classeur : … » sous le montant quand il diffère.
   Utilisation (à la racine du projet) :  node outils/maj-facturation-montant-releve.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-facturation-montant-releve.json"), "utf8"));
const chemin = changements[0].fichier;
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("MONTANT_RELEVE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
for (const ch of changements) {
  const nb = texte.split(ch.cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(ch.cherche, () => ch.remplace);
  console.log(`✓ ${ch.nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : la Facturation prend le montant du relevé.");
