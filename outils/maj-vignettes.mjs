/* ===============================================================
   Vignettes plus parlantes :
   - Portefeuille : Commandes en cours (forfaits / PE PI), Devis à rendre
     (dont en retard), Intentions de commande, Reste à faire des forfaits
     (% du chiffré, pointé / chiffré), Dépassements (heures, % des
     affaires actives) ;
   - Finances : vignettes « Fait, facturé plus tard » et « Prix de vente
     obtenu » retirées (le détail reste dans le tableau des 12 mois).
   Utilisation (à la racine du projet) :  node outils/maj-vignettes.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-vignettes.json"), "utf8"));
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier] !== undefined) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
if (Object.values(fichiers).every((t) => t.includes("TUILES_PORTEFEUILLE") || t.includes("VIGNETTES_ALLEGEES"))) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
for (const ch of changements) {
  let t = fichiers[ch.fichier];
  if (t.includes("TUILES_PORTEFEUILLE") && ch.fichier.endsWith("pilotage/page.tsx")) continue;
  if (ch.cherche.startsWith("@@DEBUT@@")) {
    const [debut, fin] = ch.cherche.slice(9).split("@@FIN@@");
    const n = t.split(debut).length - 1;
    const i = t.indexOf(debut);
    const j = i < 0 ? -1 : t.indexOf(fin, i);
    if (n !== 1 || j < 0) {
      // la vignette « Fait, facturé plus tard » n'existe que si les scripts Finances du report sont installés
      if (ch.inclusif && n === 0) {
        console.log(`✓ ${ch.nom} : absente, rien à retirer`);
        continue;
      }
      console.error(`✗ ${ch.nom} : passage trouvé ${n} fois${j < 0 ? ", fin introuvable" : ""}`);
      erreurs++;
      continue;
    }
    fichiers[ch.fichier] = t.slice(0, i) + ch.remplace + t.slice(ch.inclusif ? j + fin.length : j);
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
console.log("\nTerminé : vignettes du portefeuille et de Finances.");
