/* ===============================================================
   MAJ TRAME CA V6 : les frais annexes saisis dans la trame mettent à
   jour les ajustements de la page (réalisé, atterrissage, tuiles).

   À lancer à la racine du projet, APRÈS les versions 2, 3 et 4 :
       node outils/maj-trame-ca-v6.mjs

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
if (!existsSync(COMPOSANT) || !readFileSync(COMPOSANT, "utf8").includes("TRAME_CA_V6"))
  echec(`${COMPOSANT} absent ou ancien : décompressez d'abord le ZIP à la racine du projet.`);

let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
const NOUVEAU = "                onAjustementsModifies={setAjustements}\n";
if (t.includes(NOUVEAU)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
const REPERE = "                onPrevuTous={(valeurs) => enregistrerPrevus(valeurs)}\n";
if (compter(t, REPERE) !== 1)
  echec("repère « onPrevuTous » introuvable : lancez d'abord  node outils/maj-trame-ca-v2.mjs; node outils/maj-trame-ca-v3.mjs; node outils/maj-trame-ca-v4.mjs");
t = t.replace(REPERE, () => REPERE + NOUVEAU);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ les frais annexes de la trame mettent à jour les ajustements de la page");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
