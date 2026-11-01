/* ===============================================================
   Indicateurs commerciaux : partie « Coût des devis » (devis ouverts sur
   la période, heures passées, par devis gagné / perdu, heures de devis
   pour 1 000 € gagnés, liste des devis avec ce qu'ils sont devenus).
   Retire la page « Analyse des devis » et sa carte, devenues inutiles.
   La page des indicateurs est retrouvée d'elle-même dans app/.
   Utilisation (à la racine du projet) :  node outils/maj-cout-devis.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function chercher(dossier) {
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) {
      const r = chercher(p);
      if (r) return r;
    } else if (nom === "page.tsx" && readFileSync(p, "utf8").includes("PILOTAGE BE - INDICATEURS")) return p;
  }
  return null;
}
const chemin = chercher("app");
if (!chemin) {
  console.error("✗ Page des indicateurs commerciaux introuvable dans app/ (lancez le script depuis la racine du projet).");
  process.exit(1);
}
console.log(`  page des indicateurs : ${chemin}`);
const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-cout-devis.json"), "utf8"));
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("COUT_DEVIS")) {
  console.log("✓ Indicateurs : déjà à jour");
} else {
  let erreurs = 0;
  for (const ch of changements) {
    const n = texte.split(ch.cherche).length - 1;
    if (n !== 1) {
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois (attendu 1)`);
      erreurs++;
      continue;
    }
    texte = texte.replace(ch.cherche, () => ch.remplace);
    console.log(`✓ ${ch.nom}`);
  }
  if (erreurs > 0) {
    console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
    process.exit(1);
  }
  writeFileSync(chemin, texte, "utf8");
}

// la page « Analyse des devis » et sa carte disparaissent
if (existsSync("app/analyse/devis")) {
  rmSync("app/analyse/devis", { recursive: true, force: true });
  console.log("✓ Page « Analyse des devis » retirée");
}
const dash = "app/dashboard/page.tsx";
const d = readFileSync(dash, "utf8").replace(/\r\n/g, "\n");
const lignes = d.split("\n");
const i = lignes.findIndex((l) => l.includes("CARTE_DEVIS"));
if (i >= 0 && lignes[i + 1]?.includes(`aller("/analyse/devis")`)) {
  lignes.splice(i, 2);
  writeFileSync(dash, lignes.join("\n"), "utf8");
  console.log("✓ Carte « Analyse des devis » retirée du tableau de bord");
}
console.log("\nTerminé : « Coût des devis » dans les indicateurs commerciaux.");
