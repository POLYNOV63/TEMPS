/* ===============================================================
   Planning des affaires (app/pilotage/affaires/page.tsx) : affaires
   classées par NUMÉRO croissant, de la plus ancienne à la plus récente.
   Un avenant se range juste sous sa commande de base (1604, 1604R1,
   1604R2, puis 1605…). Les groupes restent : affaires, puis PI, puis PE ;
   dans le groupe des affaires, les CBE d'abord, puis les DBE.
   Utilisation (à la racine du projet) :  node outils/maj-planning-ordre.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/affaires/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ORDRE_PAR_NUMERO")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const avant = `            rangGroupe(a) - rangGroupe(b) ||
            (a.echeance ?? "9999").localeCompare(b.echeance ?? "9999") ||
            b.numero.localeCompare(a.numero, "fr", { numeric: true })`;
const apres = `            // ORDRE_PAR_NUMERO : plus anciennes d'abord, avenant juste sous sa commande de base
            rangGroupe(a) - rangGroupe(b) ||
            (a.type === b.type ? 0 : a.type === "CBE" ? -1 : 1) ||
            a.numero.localeCompare(b.numero, "fr", { numeric: true })`;
const nb = texte.split(avant).length - 1;
if (nb !== 1) {
  console.error(`✗ Tri des affaires trouvé ${nb} fois (attendu 1). Rien n'a été modifié : copiez ce message à Claude.`);
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, texte, "utf8");
writeFileSync(chemin, texte.replace(avant, apres), "utf8");
console.log("✓ Affaires classées par numéro croissant\n\nTerminé.");
