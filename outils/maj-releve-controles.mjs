/* ===============================================================
   Relevé PE / PI : quatre améliorations.
   1. « Avenant à prévoir » : bandeau des commandes épuisées, dépassées ou
      sous 20 % de reste (clic = fiche commande) ;
   2. contrôle avant de clôturer le mois : lignes sans taux, écarts avec
      les feuilles d'heures, intentions facturées, commandes dépassées ;
   3. « Aligner sur les feuilles » : reprend les heures pointées (colonne
      Mois, ou ⚙) ;
   4. temps réel : collègues qui ont le relevé ouvert, et bandeau
      « ↻ Actualiser » quand l'un d'eux enregistre.
   Prérequis : la FICHE COMMANDE installée (maj-fiche-commande.mjs) et le
   SQL 66 passé.
   Utilisation (à la racine du projet) :  node outils/maj-releve-controles.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-releve-controles.json"), "utf8"));
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("CONTROLE_CLOTURE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

if (!texte.includes("FICHE_COMMANDE")) {
  console.error("✗ Installez d'abord la fiche commande (node outils/maj-fiche-commande.mjs), puis relancez ce script.");
  process.exit(1);
}

let erreurs = 0;
for (const ch of changements) {
  if (ch.cherche.startsWith("@@DEBUT@@")) {
    const [debut, fin] = ch.cherche.slice(9).split("@@FIN@@");
    const i = texte.indexOf(debut);
    const n = texte.split(debut).length - 1;
    const j = i < 0 ? -1 : texte.indexOf(fin, i + debut.length);
    if (n !== 1 || j < 0) {
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois${j < 0 ? ", fin introuvable" : ""}`);
      erreurs++;
      continue;
    }
    texte = texte.slice(0, i) + ch.remplace + texte.slice(j);
    console.log(`✓ ${ch.nom}`);
    continue;
  }
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
console.log("\nTerminé : alertes, contrôle de clôture, alignement et temps réel dans le relevé.");
