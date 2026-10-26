/* ===============================================================
   Option A : l'application ne propose plus ce que le classeur annule.
   - Bilan affaire (panneau Pilotage) : le délai d'une COMMANDE venue du
     Suivi d'affaire est en lecture seule (« se modifie dans le Suivi
     d'affaire BE ») ; plus de « Supprimer du Pilotage » pour une affaire
     venue d'Excel. Le responsable et la date de rendu d'un devis restent
     modifiables.
   - Planning des affaires : le 📌 d'un devis se GLISSE pour changer sa
     date de rendu (historisée) ; le ⚑ d'une commande rappelle que son
     délai se change dans Excel.
   Les modifications sont décrites dans maj-excel-pilote.json.
   Utilisation (à la racine du projet) :  node outils/maj-excel-pilote.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-excel-pilote.json"), "utf8"));
const fichiers = {};
for (const ch of changements) {
  if (fichiers[ch.fichier]) continue;
  if (!existsSync(ch.fichier)) {
    console.error(`✗ Fichier introuvable : ${ch.fichier} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[ch.fichier] = readFileSync(ch.fichier, "utf8").replace(/\r\n/g, "\n");
}
if (Object.values(fichiers).every((t) => t.includes("EXCEL_PILOTE") || t.includes("JALON_DBE_GLISSE"))) {
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
console.log("\nTerminé : option A (Excel pilote, 📌 des devis à glisser).");
