/* ===============================================================
   Portefeuille → planning :
   - le bouton devient une petite icône de calendrier grise ;
   - le planning s'ouvre FILTRÉ sur l'affaire (et ses avenants), par la
     recherche : la vider pour revoir tout le planning.
   S'installe après maj-vers-planning.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-planning-filtre.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-planning-filtre.json"), "utf8"));
const marqueurs = { "app/pilotage/page.tsx": "PLANNING_SOBRE", "app/pilotage/affaires/page.tsx": "FILTRE_AFFAIRE" };
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier] !== undefined) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
const dejaFaits = new Set(Object.entries(fichiers).filter(([f, t]) => t.includes(marqueurs[f])).map(([f]) => f));
for (const f of dejaFaits) console.log(`✓ ${f} : déjà à jour`);
let erreurs = 0;
for (const ch of changements) {
  if (dejaFaits.has(ch.fichier)) continue;
  const t = fichiers[ch.fichier];
  if (ch.cherche.startsWith("@@DEBUT@@")) {
    const [debut, fin] = ch.cherche.slice(9).split("@@FIN@@");
    const n = t.split(debut).length - 1;
    const i = t.indexOf(debut);
    const j = i < 0 ? -1 : t.indexOf(fin, i);
    if (n !== 1 || j < 0 || j - i > 3000) {
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois${j < 0 ? ", fin introuvable" : ""}`);
      erreurs++;
      continue;
    }
    fichiers[ch.fichier] = t.slice(0, i) + ch.remplace + t.slice(j);
    console.log(`✓ ${ch.nom}`);
    continue;
  }
  const n = t.split(ch.cherche).length - 1;
  if (ch.tous ? n < 1 : n !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${n} fois (attendu ${ch.tous ? "au moins 1" : "1"})`);
    erreurs++;
    continue;
  }
  fichiers[ch.fichier] = ch.tous ? t.split(ch.cherche).join(ch.remplace) : t.replace(ch.cherche, () => ch.remplace);
  console.log(`✓ ${ch.nom}${ch.tous ? ` (${n} endroits)` : ""}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [f, t] of Object.entries(fichiers)) if (!dejaFaits.has(f)) writeFileSync(f, t, "utf8");
console.log("\nTerminé : icône sobre, planning filtré sur l’affaire.");
