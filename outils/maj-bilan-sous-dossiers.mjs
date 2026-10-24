/* ===============================================================
   Bilan affaire : bloc « Par sous-dossier », sous le tableau par activité
   (composant components/SousDossiersAffaire.tsx, SQL 63).
   Utilisation (à la racine du projet) :  node outils/maj-bilan-sous-dossiers.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/affaires/bilan/page.tsx";
if (!existsSync(chemin) || !existsSync("components/SousDossiersAffaire.tsx")) {
  console.error("✗ Fichier introuvable : décompressez le zip à la racine du projet, puis relancez.");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("SousDossiersAffaire")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
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
  "Import du bloc",
  `import BilanFinancierAffaire from "@/components/BilanFinancierAffaire";`,
  `import BilanFinancierAffaire from "@/components/BilanFinancierAffaire";
import SousDossiersAffaire from "@/components/SousDossiersAffaire";`
);
remplacer(
  "Bloc sous le tableau par activité",
  `            {/* ---------- négoce : vendu et acheté (administration, responsables, Direction) ---------- */}`,
  `            {/* ---------- heures par sous-dossier (saisi dans les feuilles d'heures) ---------- */}
            <SousDossiersAffaire type={affaire.type} numero={affaire.numero} />

            {/* ---------- négoce : vendu et acheté (administration, responsables, Direction) ---------- */}`
);
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : heures par sous-dossier dans le Bilan affaire.");
