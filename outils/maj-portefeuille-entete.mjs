/* ===============================================================
   Portefeuille (app/pilotage/page.tsx) : l'en-tête du tableau (N°,
   Descriptif, Client…) reste visible en haut de l'écran quand on
   fait défiler, juste sous les onglets du Pilotage.
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-entete.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("portefeuille-entete")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "En-tête du tableau repéré",
  `        <thead>
          <tr>
            <EnTeteTri col="numero" libelle="N°" />`,
  `        <thead className="portefeuille-entete">
          <tr>
            <EnTeteTri col="numero" libelle="N°" />`
);
remplacer(
  "En-tête fixe sous les onglets",
  `<OngletsPilotage actif="portefeuille" />`,
  `<OngletsPilotage actif="portefeuille" />
      {/* l'en-tête du tableau reste visible, juste sous les onglets (49 px) */}
      <style>{\`
        .portefeuille-entete th {
          position: sticky;
          top: 49px;
          z-index: 5;
          background: #f4f5f7;
          box-shadow: inset 0 -2px 0 #d5d9de;
        }
      \`}</style>`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : en-tête du portefeuille fixe.");
