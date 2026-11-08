/* ===============================================================
   MAJ ANALYSE DU CHIFFRÉ - LE NÉGOCE À PART (NEGOCE_A_PART_CHIFFRE)

   - « Forfaits » ne montre plus le négoce pur (imputation « Négoce ») ;
     nouveau bouton « Négoce » pour le voir seul ; « Tout » réunit tout ;
   - un négoce sans heures chiffrées affiche « négoce · dans la marge »
     (info) au lieu de l'alerte « non chiffré », et ne compte pas dans
     « Seulement au-delà du chiffré ».

   À lancer à la racine du projet :   node outils/maj-analyse-chiffre-negoce.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/pointage/page.tsx";
const MARQUEUR = "NEGOCE_A_PART_CHIFFRE";

const remplacements = [
  [
    "périmètre « Négoce »",
    '  const [perimetre, setPerimetre] = useState<"FORFAITS" | "PEPI" | "TOUT">("FORFAITS");',
    '  // NEGOCE_A_PART_CHIFFRE : le négoce pur (imputation « Négoce ») a son propre périmètre\n  const [perimetre, setPerimetre] = useState<"FORFAITS" | "PEPI" | "NEGOCE" | "TOUT">("FORFAITS");',
  ],
  [
    "filtre du périmètre",
    '        const pepi = f.imputation === "PE" || f.imputation === "PI";\n        return perimetre === "TOUT" || (perimetre === "PEPI" ? pepi : !pepi);',
    '        const pepi = f.imputation === "PE" || f.imputation === "PI";\n' +
      '        const negoce = f.imputation === "Négoce";\n' +
      '        if (perimetre === "TOUT") return true;\n' +
      '        if (perimetre === "PEPI") return pepi;\n' +
      '        if (perimetre === "NEGOCE") return negoce;\n' +
      "        return !pepi && !negoce;",
  ],
  [
    "« Seulement au-delà du chiffré » sans le négoce non chiffré",
    "      .filter(({ v }) => !seulementAlertes || (v.chiffre > 0 ? v.fin > v.chiffre + 0.5 : v.fin > 0.5))",
    '      .filter(({ f, v }) => !seulementAlertes || (v.chiffre > 0 ? v.fin > v.chiffre + 0.5 : v.fin > 0.5 && f.imputation !== "Négoce"))',
  ],
  [
    "boutons du périmètre",
    '                    ["PEPI", "PE / PI"],\n                    ["TOUT", "Forfaits + PE / PI"],',
    '                    ["PEPI", "PE / PI"],\n                    ["NEGOCE", "Négoce"],\n                    ["TOUT", "Tout"],',
  ],
  [
    "texte « Ce que vous regardez »",
    '{perimetre === "FORFAITS" ? "au forfait" : perimetre === "PEPI" ? "en PE / PI" : "au forfait et en PE / PI"}',
    '{perimetre === "FORFAITS" ? "au forfait (hors négoce)" : perimetre === "PEPI" ? "en PE / PI" : perimetre === "NEGOCE" ? "de négoce" : "de tous types"}',
  ],
  [
    "alerte du négoce non chiffré",
    '{v.chiffre === 0 && v.fin > 0.5 && <Pastille genre="warn">non chiffré</Pastille>}',
    '{v.chiffre === 0 && v.fin > 0.5 && (f.imputation === "Négoce" ? <Pastille genre="info">négoce · dans la marge</Pastille> : <Pastille genre="warn">non chiffré</Pastille>)}',
  ],
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}
for (const [nom, a] of remplacements) {
  const n = t.split(a).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const [nom, a, b] of remplacements) {
  t = t.replace(a, () => b);
  console.log(`✓ ${nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
