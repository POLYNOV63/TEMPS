/* ===============================================================
   Planning par ressource :
   - la charge de chaque activité est donnée SEMAINE PAR SEMAINE (une
     case par semaine sous le nom de l'activité), et ne bouge donc plus
     quand on recule ou avance ;
   - le réalisé est lu en entier (il était tronqué à 1 000 lignes quand on
     reculait de plusieurs semaines : % vendu et charge faux) ;
   - une barre de réalisé ne déborde plus sur la semaine suivante.
   Analyse du chiffré : même lecture complète du pointé de la période.
   S'installe après maj-realise-compact.mjs et maj-charge-groupe.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-charge-semaine.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-charge-semaine.json"), "utf8"));
const marqueurs = { "app/pilotage/planning-ressources/page.tsx": "CHARGE_SEMAINE", "app/analyse/pointage/page.tsx": "POINTE_PAGINE" };
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
console.log("\nTerminé : charge semaine par semaine, réalisé complet.");
