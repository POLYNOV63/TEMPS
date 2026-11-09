/* ===============================================================
   MAJ RENTABILITÉ - LE NÉGOCE AVEC SES HEURES CHIFFRÉES (RENTABILITE_NEGOCE)

   Depuis la colonne « Heures négoce » du Suivi d'affaire, le temps de
   négoce est chiffré. Dans la page Rentabilité :
   - « Négoce » : affaires dont les heures de négoce sont chiffrées ; taux
     vendu = (prix négoce − achats) ÷ heures négoce chiffrées, taux obtenu
     = (prix − achats) ÷ heures négoce passées, comme les autres activités ;
   - « Négoce au montant » : les autres (anciennes affaires, sans heures
     chiffrées), comme avant, à part pour ne pas fausser le taux ;
   - une affaire imputée NEGOCE / SCAN qui a des heures chiffrées n'est
     plus « au montant » : elle se compare comme les autres.

   À lancer à la racine du projet :   node outils/maj-rentabilite-negoce.mjs
   (après maj-classeur-negoce.mjs). Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/rentabilite/page.tsx";
const MARQUEUR = "RENTABILITE_NEGOCE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
if (existsSync("lib/finances.ts") && !readFileSync("lib/finances.ts", "utf8").includes("NEGOCE_INTERGROUPE"))
  echec("lib/finances.ts : installez d’abord maj-classeur-negoce.zip (heures de négoce rangées dans le groupe Négoce).");
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const R = [
  [
    "affaire au montant seulement sans heures chiffrées",
    "      const montant = venteAuMontant(a.imputation);\n",
    `      // ${MARQUEUR} : une affaire de négoce / scan qui a des heures chiffrées se compare comme les autres
      const montant = venteAuMontant(a.imputation) && hc <= 0.01;
      const hcNegoce = a.heuresChiffrees["Négoce"];
      const cleNegoce = hcNegoce > 0.01 ? "Négoce" : "Négoce au montant";
`,
  ],
  [
    "négoce pur au montant",
    '        ajouter(/^scan/.test(sansAccents(a.imputation)) ? "Scan" : "Négoce", a.montant, a.achats, 0, hr, c === null ? null : a.achats + hr * c, true);',
    '        ajouter(/^scan/.test(sansAccents(a.imputation)) ? "Scan" : "Négoce au montant", a.montant, a.achats, 0, hr, c === null ? null : a.achats + hr * c, true);',
  ],
  [
    "ligne Négoce",
    '        ajouter("Négoce", pg["Négoce"], a.achats, 0, rg["Négoce"], c === null ? null : a.achats + rg["Négoce"] * c, true);',
    '        ajouter(cleNegoce, pg["Négoce"], a.achats, hcNegoce > 0.01 ? hcNegoce : 0, rg["Négoce"], c === null ? null : a.achats + rg["Négoce"] * c, hcNegoce <= 0.01);',
  ],
  ["ordre des lignes", '    const ordre = [...GROUPES, "Scan", "PE", "PI"];', '    const ordre = [...GROUPES, "Négoce au montant", "Scan", "PE", "PI"];'],
  [
    "explication du tableau",
    "Les achats sont portés par la ligne\n                    Négoce ; négoce et scan purs comptent entiers dans leur ligne.",
    "Les achats sont portés par la ligne\n                    Négoce ; le négoce sans heures chiffrées est à part (« Négoce au montant »), comme le scan pur.",
  ],
  [
    "définition",
    "<strong>Négoce et scan</strong> (imputation NEGOCE / SCAN) : vendus au montant, sans taux vendu ; leurs heures passées comptent dans leur coût.",
    "<strong>Négoce</strong> : avec des heures de négoce chiffrées (colonne « Heures négoce » du Suivi d’affaire), il a un taux vendu et un taux obtenu comme les autres activités ; sans heures chiffrées (anciennes affaires), il est sur la ligne « Négoce au montant », sans taux vendu. <strong>Scan</strong> pur (imputation SCAN, sans heures chiffrées) : au montant, de même. Leurs heures passées comptent toujours dans leur coût.",
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ Négoce : taux vendu sur ses heures chiffrées");
console.log("✓ « Négoce au montant » à part pour les affaires sans heures chiffrées");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
