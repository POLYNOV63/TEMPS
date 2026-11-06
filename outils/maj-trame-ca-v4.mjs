/* ===============================================================
   MAJ TRAME CA V4 : la trame reçoit les mouvements ATTENDUS, pour
   afficher l'attendu sous le réalisé de chaque ligne.

   À lancer à la racine du projet, APRÈS maj-trame-ca-v2.mjs et v3 :
       node outils/maj-trame-ca-v4.mjs

   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const COMPOSANT = "components/finances/TrameCA.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (texte, x) => texte.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
if (!existsSync(COMPOSANT) || !readFileSync(COMPOSANT, "utf8").includes("TRAME_CA_V4"))
  echec(`${COMPOSANT} absent ou ancien : décompressez d'abord le ZIP à la racine du projet.`);

let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
const NOUVEAU = "                attendus={attendus.mouvements}\n";
if (t.includes(NOUVEAU)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
if (!t.includes("TRAME_CA_V3")) echec("lancez d'abord : node outils/maj-trame-ca-v2.mjs; node outils/maj-trame-ca-v3.mjs");

const REPERE = "                attendu={vue.attendu}\n";
if (compter(t, REPERE) !== 1) echec(`repère « attendu={vue.attendu} » trouvé ${compter(t, REPERE)} fois (attendu : 1).`);
t = t.replace(REPERE, () => REPERE + NOUVEAU);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ la trame reçoit les montants attendus");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
