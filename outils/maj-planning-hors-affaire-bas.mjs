/* ===============================================================
   MAJ PLANNING - « HORS AFFAIRE » EN BAS (HORS_AFFAIRE_BAS)

   Le bloc « Hors affaire » (salons, formations, absences connues…)
   passe sous les affaires, juste avant « Affaires livrées ».

   À lancer à la racine du projet :   node outils/maj-planning-hors-affaire-bas.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "HORS_AFFAIRE_BAS";

const DEBUT = "{/* événements hors affaire : salons, formations, absences connues… */}";
const FIN = "{lignes.length === 0 && !chargement && (";
const LIVREES = "{/* affaires livrées restées au planning */}";
const ENTETE_AVANT = '<div style={{ marginTop: 8, padding: "6px 8px", background: "#eef0f3", borderRadius: 4, display: "flex"';
const ENTETE_APRES = '<div style={{ marginTop: 18, padding: "6px 8px", background: "#eef0f3", borderRadius: 4, display: "flex"';

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (texte, x) => texte.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}
for (const [nom, x] of [["début du bloc Hors affaire", DEBUT], ["liste des affaires", FIN], ["Affaires livrées", LIVREES], ["en-tête Hors affaire", ENTETE_AVANT]]) {
  if (compter(t, x) !== 1) echec(`repère « ${nom} » trouvé ${compter(t, x)} fois (attendu : 1).`);
}
const iDebut = t.indexOf(DEBUT);
const iFin = t.indexOf(FIN);
const iLivrees = t.indexOf(LIVREES);
if (!(iDebut < iFin && iFin < iLivrees)) echec("les blocs ne sont pas dans l'ordre attendu.");

// le bloc, de son commentaire jusqu'au début de la ligne qui précède la liste des affaires
const finBloc = t.lastIndexOf("\n", iFin) + 1;
const debutBloc = t.lastIndexOf("\n", iDebut) + 1;
let bloc = t.slice(debutBloc, finBloc);
if (compter(bloc, ENTETE_AVANT) !== 1) echec("en-tête Hors affaire introuvable dans le bloc.");
bloc = bloc
  .replace(DEBUT, `{/* ${MARQUEUR} : événements hors affaire, sous les affaires (salons, formations, absences connues…) */}`)
  .replace(ENTETE_AVANT, () => ENTETE_APRES);

t = t.slice(0, debutBloc) + t.slice(finBloc);
const iL = t.indexOf(LIVREES);
const debutLigneLivrees = t.lastIndexOf("\n", iL) + 1;
t = t.slice(0, debutLigneLivrees) + bloc + "\n" + t.slice(debutLigneLivrees);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ « Hors affaire » déplacé sous les affaires, avant « Affaires livrées »");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
