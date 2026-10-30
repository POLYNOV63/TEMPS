/* ===============================================================
   Relevé PE / PI : les commandes les plus récentes en haut (n° le plus
   grand d'abord), dans « à staffer » et dans chaque bloc.
   Utilisation (à la racine du projet) :  node outils/maj-releve-tri-recent.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("TRI_RECENT")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Blocs PE / PI : n° le plus grand d'abord",
    `              (affairesParId.get(x.affaire_id)?.numero ?? "").localeCompare(affairesParId.get(y.affaire_id)?.numero ?? "", "fr", { numeric: true }) ||`,
    `              // TRI_RECENT : les commandes les plus récentes (n° le plus grand) en haut
              (affairesParId.get(y.affaire_id)?.numero ?? "").localeCompare(affairesParId.get(x.affaire_id)?.numero ?? "", "fr", { numeric: true }) ||`,
  ],
  [
    "À staffer : n° le plus grand d'abord",
    `          .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));`,
    `          .sort((x, y) => y.numero.localeCompare(x.numero, "fr", { numeric: true }));`,
  ],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, () => remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : relevé trié des plus récentes aux plus anciennes.");
