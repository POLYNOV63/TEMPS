/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - SEULEMENT MÉCA, ELEC, CALCUL (ACTIVITES_BE)

   Tableau « Détail » : seules les personnes dont l'activité principale
   est Méca(nique), Élec(tricité) ou Calcul sont affichées ; le menu des
   activités ne propose qu'elles. La ligne « Équipe BE » garde le total de
   toute l'équipe (mention « toutes activités »).

   À lancer à la racine du projet, APRÈS maj-ressources-tri-filtres.mjs :
       node outils/maj-ressources-activites-be.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "ACTIVITES_BE";

const remplacements = [
  {
    nom: "reconnaissance de Méca, Elec, Calcul",
    cherche: "  const lignesDetail = useMemo(() => {\n",
    remplace:
      "  // ACTIVITES_BE : le tableau de détail ne montre que Méca, Elec et Calcul (d'après le nom de l'activité)\n" +
      '  const estActiviteBE = (nom: string) => /^(meca|elec|calcul)/.test(nom.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim());\n' +
      "  const lignesDetail = useMemo(() => {\n",
  },
  {
    nom: "personnes de Méca, Elec, Calcul seulement",
    cherche: "      .filter((l) => !filtreAct || l.activite.cle === filtreAct);\n",
    remplace: "      .filter((l) => estActiviteBE(l.activite.nom))\n      .filter((l) => !filtreAct || l.activite.cle === filtreAct);\n",
  },
  {
    nom: "menu des activités",
    cherche: "              {[...groupesRep.activites]\n                .sort((a, b) => a.ordre - b.ordre)\n",
    remplace: "              {[...groupesRep.activites]\n                .filter((a) => estActiviteBE(a.nom))\n                .sort((a, b) => a.ordre - b.ordre)\n",
  },
  {
    nom: "ligne Équipe BE",
    cherche: '<td style={{ ...page.td, background: "#f8f9fa" }}><strong>Équipe BE</strong></td>',
    remplace: '<td style={{ ...page.td, background: "#f8f9fa" }}><strong>Équipe BE</strong> <span style={{ fontSize: 11, color: C.gris }}>toutes activités</span></td>',
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
if (!t.includes("CHARGE_TRI_FILTRE")) echec("lancez d'abord : node outils/maj-ressources-tri-filtres.mjs");
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
