/* ===============================================================
   MAJ TABLEAU DE BORD - TUILE « CARTOGRAPHIE DE L'ÉQUIPE » (CARTO_TUILE)

   La page Analyse des effectifs devient la cartographie de l'équipe
   (app/analyse/effectifs/page.tsx, fournie en entier dans le ZIP) :
   la tuile du tableau de bord (ADMIN et Direction) change de nom.

   À lancer à la racine du projet :   node outils/maj-cartographie-tuile.mjs
   Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/dashboard/page.tsx";
const AVANT = 'titre="Analyse des effectifs" description="Prédominances, activités pointées et méthodes de vente (PE / PI / BE)"';
const APRES = 'titre="Cartographie de l’équipe" description="Activités, niveaux, relève et polyvalence du bureau d’études"';

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
if (!existsSync("app/analyse/effectifs/page.tsx") || !readFileSync("app/analyse/effectifs/page.tsx", "utf8").includes("EFFECTIFS_CARTO"))
  echec("la nouvelle page app/analyse/effectifs/page.tsx n'est pas en place : décompressez d'abord le ZIP à la racine du projet.");
if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
const n = t.split(AVANT).length - 1;
if (n === 0) {
  console.log(t.includes(APRES) ? `✓ ${FICHIER} : déjà à jour, rien à faire.` : `✓ ${FICHIER} : tuile introuvable, rien de changé (la page fonctionne quand même).`);
  process.exit(0);
}
t = t.split(AVANT).join(APRES);
writeFileSync(FICHIER, t, "utf8");
console.log(`✓ ${FICHIER} : tuile renommée « Cartographie de l’équipe » (${n} endroit${n > 1 ? "s" : ""})`);
console.log("✓ nouvelle page : app/analyse/effectifs/page.tsx");
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
