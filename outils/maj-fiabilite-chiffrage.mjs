/* ===============================================================
   MAJ - TUILE « FIABILITÉ DU CHIFFRAGE » (FIABILITE_CHIFFRAGE)

   Nouvelle page app/analyse/fiabilite-chiffrage (fournie dans le ZIP) ;
   tuile ajoutée au tableau de bord, à côté de « Analyse du chiffré » :
   groupe Analyses (ADMIN) et groupe Charge du bureau d'études (DIRECTION).

   À lancer à la racine du projet :   node outils/maj-fiabilite-chiffrage.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PAGE = "app/analyse/fiabilite-chiffrage/page.tsx";
const TABLEAU = "app/dashboard/page.tsx";
const MARQUEUR = "FIABILITE_CHIFFRAGE";
const CHIFFRE =
  '<CarteCompacte icone="🎯" titre="Analyse du chiffré" description="Heures produites face aux heures chiffrées, par commande" onClick={() => aller("/analyse/pointage")} />\n';
const tuile = (indent) =>
  `${indent}{/* ${MARQUEUR} */}\n${indent}<CarteCompacte icone="📐" titre="Fiabilité du chiffrage" description="Chiffré face au réalisé, par activité, sur les forfaits livrés" onClick={() => aller("/analyse/fiabilite-chiffrage")} />\n`;

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(PAGE)) echec(`${PAGE} introuvable : décompressez d'abord le ZIP à la racine du projet.`);
if (!existsSync(TABLEAU)) echec(`Fichier introuvable : ${TABLEAU} (lancez la commande à la racine du projet).`);
let t = readFileSync(TABLEAU, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${TABLEAU} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}
const ADMIN = "\n        " + CHIFFRE;
const DIRECTION = "\n          " + CHIFFRE;
const n1 = t.split(ADMIN).length - 1;
const n2 = t.split(DIRECTION).length - 1;
if (n1 !== 1) echec(`tuile « Analyse du chiffré » du groupe Analyses trouvée ${n1} fois (attendu : 1).`);
if (n2 !== 1) echec(`tuile « Analyse du chiffré » de la Direction trouvée ${n2} fois (attendu : 1).`);
t = t.replace(ADMIN, (x) => x + tuile("        ")).replace(DIRECTION, (x) => x + tuile("          "));
writeFileSync(TABLEAU, t, "utf8");
console.log("✓ tuile « Fiabilité du chiffrage » ajoutée (Analyses pour l’ADMIN, Charge du bureau d’études pour la Direction)");
console.log(`✓ nouvelle page : ${PAGE}`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
