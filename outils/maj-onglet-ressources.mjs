/* ===============================================================
   Onglets du Pilotage : « Planning par ressource » visible de tous
   (droit « voirPlanning », comme la page elle-même).
   Utilisation (à la racine du projet) :  node outils/maj-onglet-ressources.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "components/pilotage/OngletsPilotage.tsx";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const avant = `{ cle: "ressources-planning", libelle: "Planning par ressource", href: "/pilotage/planning-ressources", droit: "chargeRessources" },`;
const apres = `{ cle: "ressources-planning", libelle: "Planning par ressource", href: "/pilotage/planning-ressources", droit: "voirPlanning" },`;
if (t.includes(apres)) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (t.split(avant).length !== 2) {
  console.error("✗ Onglet « Planning par ressource » introuvable. Rien n'a été modifié.");
  process.exit(1);
}
writeFileSync(f, t.replace(avant, () => apres), "utf8");
console.log("✓ Onglet « Planning par ressource » visible de tous\n\nTerminé.");
