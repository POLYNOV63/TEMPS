/* ===============================================================
   LISTE DES PAGES À L'EN-TÊTE NON STANDARD (ENTETE_STANDARD)

   Affiche les pages qui posent l'en-tête dans un cadre
   (forme="encadre" ou "joint") ou qui n'utilisent pas l'en-tête commun.
   Ne modifie rien : copiez le résultat à Claude.
================================================================ */

import fs from "node:fs";
import path from "node:path";

const racine = process.cwd();
const encadre = [];
const sansEntete = [];

function parcourir(dossier) {
  const abs = path.join(racine, dossier);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) parcourir(rel);
    } else if (e.name === "page.tsx") {
      const t = fs.readFileSync(path.join(racine, rel), "utf8");
      const r = rel.replace(/\\/g, "/");
      if (/forme=["'](encadre|joint)["']/.test(t)) encadre.push(r);
      else if (!t.includes("EnTetePage") && !/import\s+\w+\s+from\s+["']\.\//.test(t)) sansEntete.push(r);
    }
  }
}
parcourir("app");

console.log("\nPages dont l'en-tête est posé dans un cadre :");
for (const r of encadre) console.log(`  - ${r}`);
if (encadre.length === 0) console.log("  (aucune)");
console.log("\nPages sans l'en-tête commun (à vérifier, certaines n'en ont pas besoin, ex. connexion) :");
for (const r of sansEntete) console.log(`  - ${r}`);
if (sansEntete.length === 0) console.log("  (aucune)");
console.log("\nCopiez ce résultat à Claude.");
