/* ===============================================================
   - Charge & pointage : boutons CBE / DBE / CBE + DBE (CBE par défaut) ;
     dans « Par activité », un clic sur une activité montre les affaires
     qui la composent (chiffré, pointé, écart, consommé).
   - Portefeuille : une barre de progression (pointé / chiffré) sous le
     réalisé de chaque commande.
   Les modifications sont décrites dans maj-pointage-cbe.json.
   Utilisation (à la racine du projet) :  node outils/maj-pointage-cbe.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-pointage-cbe.json"), "utf8"));
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier] !== undefined) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
const marqueurs = { "app/analyse/pointage/page.tsx": "POINTAGE_CBE", "app/pilotage/page.tsx": "BARRE_PROGRESSION" };
// fichiers déjà modifiés par ce script (repère présent AVANT de commencer) : on n'y touche plus
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
    if (n !== 1 || j < 0) {
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois${j < 0 ? ", fin introuvable" : ""}`);
      erreurs++;
      continue;
    }
    fichiers[ch.fichier] = t.slice(0, i) + ch.remplace + t.slice(j);
    console.log(`✓ ${ch.nom}`);
    continue;
  }
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
for (const [f, t] of Object.entries(fichiers)) writeFileSync(f, t, "utf8");
console.log("\nTerminé : Charge & pointage (CBE, activités) et barre de progression du portefeuille.");
