/* ===============================================================
   MAJ PLANNING - BANDEAU AUSSI POUR LES DBE, PI ET PE (BANDEAU_PARTOUT)

   Même présentation que les commandes au forfait : un bandeau par devis
   ou par commande (client, description), le n° seul en dessous.
   Les totaux d'heures du bandeau restent réservés aux familles de
   commandes au forfait (pour une PE / PI, ils se suivent dans le relevé
   des prestations).

   À lancer à la racine du projet, APRÈS maj-planning-bandeaux.mjs :
       node outils/maj-planning-bandeaux-partout.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "BANDEAU_PARTOUT";

const remplacements = [
  {
    nom: "bandeau pour toutes les lignes (DBE, PI, PE comprises)",
    cherche: '                const enFamille = affaire.type === "CBE" && !estPrestation(affaire);\n',
    remplace: "                // BANDEAU_PARTOUT : DBE, PI et PE ont aussi leur bandeau\n                const enFamille = true;\n",
  },
  {
    nom: "type affiché dans le bandeau (CBE ou DBE)",
    cherche: '{famille ? "⧉ " : ""}CBE {laBase.numero',
    remplace: '{famille ? "⧉ " : ""}{laBase.type} {laBase.numero',
  },
  {
    nom: "totaux d'heures : familles au forfait seulement",
    cherche: '{famille && (\n                          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>',
    remplace: '{famille && laBase.type === "CBE" && !estPrestation(laBase) && (\n                          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>',
  },
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
if (!t.includes("BANDEAU_TOUTES")) echec("lancez d'abord : node outils/maj-planning-familles-discret.mjs; node outils/maj-planning-bandeaux.mjs");
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
