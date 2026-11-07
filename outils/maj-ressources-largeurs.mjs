/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - LARGEURS DES COLONNES (LARGEURS_DETAIL)

   Tableau « Détail » à largeurs fixes : Ressource étroite, Affecté /
   capacité, Charge et Écart à leur juste taille, Affectations prend le
   reste ; la colonne « Déplacer… » n'occupe de place que sur 1 semaine.

   À lancer à la racine du projet, APRÈS maj-ressources-detail-lisible.mjs :
       node outils/maj-ressources-largeurs.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "LARGEURS_DETAIL";

const remplacements = [
  {
    nom: "largeurs fixes des colonnes",
    cherche: '            <table style={{ borderCollapse: "collapse", width: "100%" }}>\n              <thead>',
    remplace:
      '            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>\n' +
      "              {/* LARGEURS_DETAIL : Ressource, Affecté / capacité, Charge, Écart, Affectations (le reste), Déplacer */}\n" +
      "              <colgroup>\n" +
      "                <col style={{ width: 76 }} />\n" +
      "                <col style={{ width: 200 }} />\n" +
      "                <col style={{ width: 210 }} />\n" +
      "                <col style={{ width: 165 }} />\n" +
      "                <col />\n" +
      "                <col style={{ width: nbSemDetail === 1 ? 110 : 8 }} />\n" +
      "              </colgroup>\n" +
      "              <thead>",
  },
  {
    nom: "titre Ressource sans largeur imposée",
    cherche: '<th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4", width: 110 }}>Ressource</th>',
    remplace: '<th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }}>Ressource</th>',
  },
  {
    nom: "colonne Charge sans pourcentage imposé",
    cherche: '                      <td style={{ ...page.td, width: "22%" }}>',
    remplace: "                      <td style={page.td}>",
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
if (!t.includes("DETAIL_LISIBLE")) echec("lancez d'abord les scripts précédents du tableau (jusqu'à maj-ressources-detail-lisible.mjs).");
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
