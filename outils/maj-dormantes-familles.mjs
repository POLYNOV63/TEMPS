/* ===============================================================
   - PE / PI ouvertes sans activité depuis 3 mois (« dormantes », SQL 71,
     lib/dormantes.ts) : encadré replié dans le relevé (hors « à staffer »
     et des blocs), pastille et filtre dans le portefeuille, pastille dans
     Charge & pointage ;
   - familles : chiffré de la famille (base + avenants) dans le portefeuille,
     chiffré par commande dans Charge & pointage ;
   - Charge & pointage : colonne Client ;
   - Ma semaine : les codes affichés avec leur libellé (EM — Étude mécanique).
   Utilisation (à la racine du projet) :  node outils/maj-dormantes-familles.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (!existsSync("lib/dormantes.ts")) {
  console.error("✗ lib/dormantes.ts introuvable : décompressez tout le zip à la racine du projet, puis relancez.");
  process.exit(1);
}
const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-dormantes-familles.json"), "utf8"));
const marqueurs = {
  "app/pilotage/prestations/page.tsx": "DORMANTES_RELEVE",
  "app/pilotage/page.tsx": "DORMANTES_PORTEFEUILLE",
  "app/analyse/pointage/page.tsx": "CLIENT_POINTAGE",
  "app/ma-semaine/GrilleSemaine.tsx": "CODES_EXPLIQUES",
};
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
  const n = t.split(ch.cherche).length - 1;
  if (n !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${n} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  fichiers[ch.fichier] = t.replace(ch.cherche, () => ch.remplace);
  console.log(`✓ ${ch.nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [f, t] of Object.entries(fichiers)) if (!dejaFaits.has(f)) writeFileSync(f, t, "utf8");
console.log("\nTerminé. N'oubliez pas le SQL 71 (supabase/71_pepi_activite.sql) dans Supabase.");
