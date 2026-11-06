/* ===============================================================
   MAJ TRAME CA : ajoute la « Trame CA » (présentation du classeur
   trame_CA.xlsm) dans la page Finances.

   À lancer à la racine du projet :   node outils/maj-trame-ca.mjs

   Tout ou rien : vérifie chaque passage avant d'écrire. Relançable
   sans risque (marqueur TRAME_CA_V1).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const COMPOSANT = "components/finances/TrameCA.tsx";
const MARQUEUR = "TRAME_CA_V1";

const remplacements = [
  {
    nom: "import du composant TrameCA",
    cherche: 'import DetailMontant, { type DetailDemande } from "@/components/finances/DetailMontant";',
    remplace:
      'import DetailMontant, { type DetailDemande } from "@/components/finances/DetailMontant";\nimport TrameCA from "@/components/finances/TrameCA"; // TRAME_CA_V1',
  },
  {
    nom: "Trame CA placée sous le tableau des 12 mois",
    cherche: "{/* ---------- taux de vente moyen des PE / PI ---------- */}",
    remplace:
      "{/* ---------- TRAME_CA_V1 : la présentation du classeur trame_CA ---------- */}\n" +
      "            <TrameCA exercice={exercice} mois={mois} moisN1={moisN1} mouvements={mouvements} prevu={vue.prevu} />\n\n" +
      "            {/* ---------- taux de vente moyen des PE / PI ---------- */}",
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
if (!existsSync(COMPOSANT)) echec(`Fichier introuvable : ${COMPOSANT} (décompressez d'abord le ZIP à la racine du projet).`);

let texte = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (texte.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}

for (const r of remplacements) {
  const n = texte.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  texte = texte.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, texte, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
