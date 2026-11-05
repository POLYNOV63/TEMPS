/* ===============================================================
   Suivi RH : tableaux classés par nom de famille (puis prénom), au lieu du
   trigramme (saisie des soldes et tableau principal).
   Utilisation (à la racine du projet) :  node outils/maj-suivi-rh-nom.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "app/admin/suivi-rh/page.tsx";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
if (t.includes("TRI_NOM_FAMILLE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const avant = `      .sort((x, y) => (x.c.trigramme ?? "").localeCompare(y.c.trigramme ?? ""));`;
const apres = `      // TRI_NOM_FAMILLE : par nom de famille, puis prénom
      .sort((x, y) => (x.c.nom ?? "").localeCompare(y.c.nom ?? "", "fr", { sensitivity: "base" }) || (x.c.prenom ?? "").localeCompare(y.c.prenom ?? "", "fr", { sensitivity: "base" }));`;
if (t.split(avant).length !== 2) {
  console.error("✗ Tri des collaborateurs introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(f, t.replace(avant, () => apres), "utf8");
console.log("✓ Suivi RH classé par nom de famille\n\nTerminé.");
