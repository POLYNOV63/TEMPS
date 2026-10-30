/* ===============================================================
   - Planning des affaires : champ de recherche (n°, client, description,
     imputation, personne affectée ou responsable).
   - Planning par ressource : la semaine en cours encadrée de rouge ; un
     devis envoyé ou perdu n'y apparaît plus (comme au planning des affaires).
   Les modifications sont décrites dans maj-recherche-semaine.json.
   Utilisation (à la racine du projet) :  node outils/maj-recherche-semaine.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-recherche-semaine.json"), "utf8"));
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier] !== undefined) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
if (Object.values(fichiers).some((t) => t.includes("RECHERCHE_PLANNING") || t.includes("SEMAINE_ENCADREE"))) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
for (const ch of changements) {
  const t = fichiers[ch.fichier];
  const nb = t.split(ch.cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${nb} fois (attendu 1)`);
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
console.log("\nTerminé : recherche au planning, semaine encadrée, devis remis retirés.");
