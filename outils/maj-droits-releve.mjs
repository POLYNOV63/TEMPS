/* ===============================================================
   Droits d'accès : relevé PE / PI ouvert aux RESPONSABLES (en plus des
   ADMIN). La charge par ressource reste ADMIN et Direction.
   Utilisation (à la racine du projet) :  node outils/maj-droits-releve.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "lib/droits.ts";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const avant = "  relevePrestations: 2, // relevé PE / PI (taux, heures facturées) : il alimente le planning des PE / PI";
const apres = "  relevePrestations: 1, // relevé PE / PI (taux, heures facturées) : ADMIN et RESPONSABLE ; il alimente le planning des PE / PI";
if (t.includes(apres)) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (t.split(avant).length !== 2) {
  console.error("✗ Ligne du relevé introuvable dans lib/droits.ts. Rien n'a été modifié.");
  process.exit(1);
}
writeFileSync(f, t.replace(avant, () => apres), "utf8");
console.log("✓ Relevé PE / PI ouvert aux responsables\n\nTerminé.");
