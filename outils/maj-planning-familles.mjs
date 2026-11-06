/* ===============================================================
   MAJ PLANNING - FAMILLES (FAMILLE_CADRE)

   Planning des affaires : une commande et ses avenants se détachent
   nettement du reste :
   - en-tête de famille plus marqué (bleu, barre à gauche) ;
   - barre bleue à gauche sur toute la hauteur de la famille, colonne
     des noms légèrement teintée ;
   - trait de fermeture et espace après le dernier membre.
   Rien ne bouge dans la grille : les dates restent alignées.

   À lancer à la racine du projet :   node outils/maj-planning-familles.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "FAMILLE_CADRE";

const remplacements = [
  {
    nom: "couleur des familles",
    cherche: 'const ROUGE_HACHURE = "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#f0b4b0 4px,#f0b4b0 8px)";',
    remplace:
      'const ROUGE_HACHURE = "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#f0b4b0 4px,#f0b4b0 8px)";\n' +
      "// FAMILLE_CADRE : couleur du cadre d'une famille (commande + avenants)\n" +
      'const COULEUR_FAMILLE = "#4a6f96";',
  },
  {
    nom: "dernier membre de la famille",
    cherche: "                const premierDeFamille = enFamille && (premierDuGroupe || baseDe(lignes[indexLigne - 1]) !== cle);",
    remplace:
      "                const premierDeFamille = enFamille && (premierDuGroupe || baseDe(lignes[indexLigne - 1]) !== cle);\n" +
      "                const suivante = lignes[indexLigne + 1];\n" +
      "                const dernierDeFamille = enFamille && (!suivante || rangGroupe(suivante) !== groupe || baseDe(suivante) !== cle);",
  },
  {
    nom: "en-tête de famille plus marqué",
    cherche: '<div style={{ marginTop: 6, padding: "6px 10px", background: "#eef3f9", borderTop: "2px solid #9fb6cf", display: "flex",',
    remplace:
      '<div style={{ marginTop: 16, padding: "7px 10px", background: "#dfe8f2", borderTop: `3px solid ${COULEUR_FAMILLE}`, borderLeft: `5px solid ${COULEUR_FAMILLE}`, borderRadius: "4px 4px 0 0", display: "flex",',
  },
  {
    nom: "cadre sur les commandes de la famille et trait de fermeture",
    cherche: '                    <div style={{ boxShadow: "inset 4px 0 0 #9fb6cf" }}>{rendreAffaire(affaire, null, false)}</div>',
    remplace: `                    {/* FAMILLE_CADRE : barre à gauche sur toute la famille, colonne des noms teintée */}
                    <div style={{ position: "relative" }}>
                      {rendreAffaire(affaire, null, false)}
                      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: LARGEUR_NOM, background: "rgba(74,111,150,0.08)", pointerEvents: "none" }} />
                      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: COULEUR_FAMILLE, borderBottomLeftRadius: dernierDeFamille ? 4 : 0, pointerEvents: "none", zIndex: 5 }} />
                    </div>
                    {/* fin de la famille : trait de fermeture et espace avant l'affaire suivante */}
                    {dernierDeFamille && <div aria-hidden="true" style={{ borderTop: \`3px solid \${COULEUR_FAMILLE}\`, borderRadius: "0 0 0 4px", marginBottom: 16 }} />}`,
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
