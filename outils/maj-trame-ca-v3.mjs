/* ===============================================================
   MAJ TRAME CA V3 : « Remplir le prévisionnel » passe dans la trame
   (avec le nouveau « % du réalisé N-1 ») ; l'ancien bandeau de la page
   est retiré. « Commandes et devis » sont retirés de la trame (fichier
   components/finances/TrameCA.tsx du ZIP).

   À lancer à la racine du projet, APRÈS maj-trame-ca-v2.mjs :
       node outils/maj-trame-ca-v3.mjs

   Tout ou rien. Relançable sans risque (marqueur TRAME_CA_V3).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const COMPOSANT = "components/finances/TrameCA.tsx";
const MARQUEUR = "TRAME_CA_V3";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (texte, x) => texte.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
if (!existsSync(COMPOSANT) || !readFileSync(COMPOSANT, "utf8").includes(MARQUEUR))
  echec(`${COMPOSANT} absent ou ancien : décompressez d'abord le ZIP à la racine du projet.`);

let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}
if (!t.includes("TRAME_CA_V2")) echec("lancez d'abord : node outils/maj-trame-ca-v2.mjs");

/* 1. la trame reçoit l'enregistrement de tout le prévisionnel */
const PROP = "                onDetailReport={(i) => setDetailReport(mois[i])}\n";
if (compter(t, PROP) !== 1) echec(`repère « onDetailReport » trouvé ${compter(t, PROP)} fois (attendu : 1).`);
t = t.replace(PROP, () => PROP + "                onPrevuTous={(valeurs) => enregistrerPrevus(valeurs)}\n");
console.log("✓ la trame peut remplir tout le prévisionnel");

/* 2. l'ancien bandeau « Remplir le prévisionnel » de la page est retiré */
const TEXTE = "<strong>Remplir le prévisionnel :</strong>";
if (compter(t, TEXTE) !== 1) echec(`bandeau « Remplir le prévisionnel » trouvé ${compter(t, TEXTE)} fois (attendu : 1).`);
const iTexte = t.indexOf(TEXTE);
const iDebut = t.lastIndexOf("{estAdmin && (", iTexte);
const iPct = t.indexOf("<span>%</span>", iTexte);
const iFin = iPct < 0 ? -1 : t.indexOf(")}", iPct);
if (iDebut < 0 || iTexte - iDebut > 400 || iPct < 0 || iFin < 0 || iFin - iPct > 200) echec("limites du bandeau « Remplir le prévisionnel » introuvables.");
t = t.slice(0, iDebut) + "{/* TRAME_CA_V3 : « Remplir le prévisionnel » est dans la trame */}" + t.slice(iFin + 2);
console.log("✓ ancien bandeau « Remplir le prévisionnel » retiré");

writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
