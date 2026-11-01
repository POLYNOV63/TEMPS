/* ===============================================================
   Relevé PE / PI : titres des colonnes plus visibles (plus grands, plus
   foncés, bordure basse marquée).
   Utilisation (à la racine du projet) :  node outils/maj-entetes-releve.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ENTETES_VISIBLES")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const cherche = `          const entete: CSSProperties = { ...th, position: "sticky", top: HAUT, zIndex: 3, background: "#f1f2f4", padding: "5px 4px", fontSize: 11 };`;
if (texte.split(cherche).length !== 2) {
  console.error("✗ Style des titres introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
texte = texte.replace(
  cherche,
  () =>
    `          // ENTETES_VISIBLES : titres de colonnes plus grands et plus foncés
          const entete: CSSProperties = { ...th, position: "sticky", top: HAUT, zIndex: 3, background: "#f1f2f4", padding: "6px 4px", fontSize: 13, fontWeight: 800, color: "#1f2328", letterSpacing: ".3px", borderBottom: "2px solid #b3b9c0" };`
);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Titres des colonnes plus visibles\n\nTerminé.");
