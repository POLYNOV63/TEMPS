/* ===============================================================
   Page Synchronisation : ajoute le bloc « Dates impossibles dans le
   classeur » (components/DatesIncoherentes.tsx, fourni dans le zip),
   sous le contrôle pour la facturation.
   Utilisation (à la racine du projet) :  node outils/maj-dates-incoherentes.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (!existsSync("components/DatesIncoherentes.tsx")) {
  console.error("✗ components/DatesIncoherentes.tsx introuvable : décompressez tout le zip à la racine, puis relancez.");
  process.exit(1);
}
function chercher(dossier) {
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) {
      const r = chercher(p);
      if (r) return r;
    } else if (nom === "page.tsx" && readFileSync(p, "utf8").includes("SYNCHRONISATION DU « SUIVI D'AFFAIRE BE »")) return p;
  }
  return null;
}
const chemin = chercher("app");
if (!chemin) {
  console.error("✗ Page de synchronisation introuvable dans app/.");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("DatesIncoherentes")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const imp = `import ControleSuiviAffaire from "@/components/ControleSuiviAffaire";`;
const bloc = `        <ControleSuiviAffaire actualisation={journal[0]?.id ?? ""} />`;
if (texte.split(imp).length !== 2 || texte.split(bloc).length !== 2) {
  console.error("✗ Passages attendus introuvables. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
texte = texte
  .replace(imp, () => `${imp}\nimport DatesIncoherentes from "@/components/DatesIncoherentes";`)
  .replace(bloc, () => `${bloc}\n        <DatesIncoherentes actualisation={journal[0]?.id ?? ""} />`);
writeFileSync(chemin, texte, "utf8");
console.log(`✓ ${chemin} : bloc « Dates impossibles » ajouté\n\nTerminé.`);
