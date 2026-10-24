/* ===============================================================
   Indicateurs commerciaux : le DÉLAI DE RÉPONSE ne compte plus les
   avenants. Un avenant (R1, R2…) est souvent ouvert et envoyé le même
   jour : il tirait le délai médian à 0 jour. On ne mesure plus que les
   vraies offres : devis et commandes de base.
   Fichier : lib/indicateurs.ts
   Utilisation (à la racine du projet) :  node outils/maj-delai-reponse.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "lib/indicateurs.ts";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("DELAI_SANS_AVENANTS")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const avant = `    if (l.date_ouverture && l.date_envoi) {
      const d = joursEntre(l.date_ouverture, l.date_envoi);`;
const apres = `    // DELAI_SANS_AVENANTS : un avenant (souvent ouvert et envoyé le même jour) ne mesure pas
    // le temps de réponse à une demande : seuls les devis et les commandes de base comptent
    if (l.genre !== "AVENANT" && l.date_ouverture && l.date_envoi) {
      const d = joursEntre(l.date_ouverture, l.date_envoi);`;
const nb = texte.split(avant).length - 1;
if (nb !== 1) {
  console.error(`✗ Calcul du délai trouvé ${nb} fois (attendu 1). Rien n'a été modifié : copiez ce message à Claude.`);
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, texte, "utf8");
writeFileSync(chemin, texte.replace(avant, apres), "utf8");
console.log("✓ Délai de réponse sans les avenants\n\nTerminé.");
