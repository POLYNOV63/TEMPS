/* ===============================================================
   Relevé PE / PI :
   - colonne « Reste commande » : le reste, le consommé sur le commandé,
     et « ✓ tout planifié » ou « 12 j à planifier » (mois suivants compris) ;
   - bouton « ↦ reste » : planifie le reste de la commande sur la personne,
     jour ouvré par jour ouvré, à partir du dernier jour saisi ;
   - le dernier jour planifié d'une ligne est surligné en jaune ;
   - bandeau « Avenant à prévoir » retiré.
   Portefeuille : s'ouvre sur les CBE.
   S'installe après maj-plannings-releve.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-releve-planifie.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-releve-planifie.json"), "utf8"));
const marqueurs = { "app/pilotage/prestations/page.tsx": "PLANIFIER_RESTE", "app/pilotage/page.tsx": "CBE_PAR_DEFAUT" };
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier] !== undefined) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
if (!fichiers["app/pilotage/prestations/page.tsx"].includes("REMPLIR_TEXTE") && !fichiers["app/pilotage/prestations/page.tsx"].includes("PLANIFIER_RESTE")) {
  console.error("✗ Installez d’abord maj-plannings-releve.mjs, puis relancez ce script.");
  process.exit(1);
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
console.log("\nTerminé : relevé (planifier le reste, consommé et planifié visibles) et portefeuille (CBE par défaut).");
