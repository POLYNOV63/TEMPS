/* ===============================================================
   MAJ INDICATEURS - LIBELLÉS « NON VENTILÉ » (LIBELLES_NON_VENTILE)
   Les derniers « Autre / non ventilé » deviennent « Non ventilé » (la
   colonne Autre du classeur est devenue Négoce).
   À lancer à la racine du projet :   node outils/maj-indicateurs-libelles.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/indicateurs/page.tsx";
if (!existsSync(FICHIER)) {
  console.error(`\n✗ Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).\n`);
  process.exit(1);
}
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
const avant = t;
t = t
  .replace("consultations « Autre / non ventilé » ?", "consultations « Non ventilé » ?")
  .replace("« Autre / non ventilé » : la colonne « Autre » du classeur, et les consultations sans aucun détail.", "« Non ventilé » : les consultations sans aucun détail par activité (ni montants, ni heures, ni imputation parlante).")
  .replace("sinon « Autre / non ventilé » */", "sinon « Non ventilé » */");
if (t === avant) console.log(`✓ ${FICHIER} : rien à changer.`);
else {
  writeFileSync(FICHIER, t, "utf8");
  console.log(`✓ ${FICHIER} : libellés « Non ventilé » mis à jour.`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
