/* ===============================================================
   Export des en-cours : une commande dont l'acompte dépasse le travail
   fait (en-cours nul, « Acompte d'avance ») reste listée, au lieu d'être
   écartée avec les commandes à 0.
   Utilisation (à la racine du projet) :  node outils/maj-garder-acomptes.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "app/analyse/finances/page.tsx";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const avant = `    const garder = (l: L) => Number(l.enCours ?? 0) > 0.5 || l.avancement === "chiffré inconnu";`;
const apres = `    const garder = (l: L) => Number(l.enCours ?? 0) > 0.5 || Number(l.avance ?? 0) > 0.5 || l.avancement === "chiffré inconnu"; // GARDER_ACOMPTES`;
if (t.includes("GARDER_ACOMPTES")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (t.split(avant).length !== 2) {
  console.error("✗ Règle de tri des commandes introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
t = t.replace(avant, () => apres);
t = t.replace(
  "commande(s) en cours sans en-cours (aucun travail fait, ou déjà facturé) : non listées.",
  "commande(s) en cours sans en-cours ni acompte d’avance (aucun travail fait, ou facturé au plus juste) : non listées."
);
writeFileSync(f, t, "utf8");
console.log("✓ Les commandes avec un acompte d'avance restent listées\n\nTerminé.");
