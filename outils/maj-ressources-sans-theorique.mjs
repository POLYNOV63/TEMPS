/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - SANS LA COLONNE « THÉORIQUE »

   Retire la colonne « Théorique » du tableau de détail (titre, lignes,
   ligne Équipe BE).

   À lancer à la racine du projet, APRÈS maj-ressources-detail-compact.mjs :
       node outils/maj-ressources-sans-theorique.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";

const retraits = [
  ["titre", '                  <th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4", textAlign: "right" }}>Théorique</th>\n'],
  ["cellule des personnes", '                      <td style={{ ...page.td, textAlign: "right" }}>{formatHeures(s.theorique)}</td>\n'],
  ["cellule Équipe BE", '                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalTheorique)}</strong></td>\n'],
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (!t.includes("DETAIL_COMPACT")) echec("lancez d'abord : node outils/maj-ressources-detail.mjs; node outils/maj-ressources-detail-compact.mjs");
const presents = retraits.map(([, x]) => t.split(x).length - 1);
if (presents.every((n) => n === 0)) {
  console.log(`✓ ${FICHIER} : colonne « Théorique » déjà retirée, rien à faire.`);
  process.exit(0);
}
retraits.forEach(([nom], k) => {
  if (presents[k] !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${presents[k]} fois (attendu : 1).`);
});
for (const [nom, x] of retraits) {
  t = t.replace(x, "");
  console.log(`✓ ${nom} retiré(e)`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
