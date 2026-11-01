/* ===============================================================
   Relevé PE / PI : titres de colonnes centrés et sur deux lignes si
   besoin (plus de « RESTE COMMA… ») ; colonne des boutons élargie (la
   croix « vider » n'est plus masquée par « ↦ reste »).
   S'installe après maj-entetes-releve.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-entetes-releve-v2.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ENTETES_CENTRES")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Titres centrés, à la ligne",
    `borderBottom: "2px solid #b3b9c0" };`,
    `borderBottom: "2px solid #b3b9c0", textAlign: "center", whiteSpace: "normal", lineHeight: 1.15, overflow: "visible", textOverflow: "clip" }; // ENTETES_CENTRES`,
    false,
  ],
  ["Colonne des boutons élargie", `          const L_OUTILS = 98;`, `          const L_OUTILS = 128;`, false],
  ["Titre « Pers. » centré", `zIndex: 5, textAlign: "left" }}>Pers.</th>`, `zIndex: 5, textAlign: "center" }}>Pers.</th>`, false],
  ["Titres Mois, Montant, Reste centrés", `, zIndex: 5, textAlign: "right" }}`, `, zIndex: 5, textAlign: "center" }}`, true],
];
let erreurs = 0;
for (const [nom, cherche, remplace, tous] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (tous ? nb < 1 : nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois`);
    erreurs++;
    continue;
  }
  texte = tous ? texte.split(cherche).join(remplace) : texte.replace(cherche, () => remplace);
  console.log(`✓ ${nom}${tous ? ` (${nb} titres)` : ""}`);
}
if (erreurs > 0) {
  console.error(
    texte.includes("ENTETES_VISIBLES")
      ? "\nRien n'a été modifié. Copiez ce message à Claude."
      : "\nInstallez d'abord maj-entetes-releve.mjs. Rien n'a été modifié."
  );
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé.");
