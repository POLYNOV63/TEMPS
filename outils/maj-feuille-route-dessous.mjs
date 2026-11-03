/* ===============================================================
   Tableau de bord des collaborateurs et des responsables : la feuille de
   route dépliée passe SOUS les cartes (après « Mon espace », le planning
   et le suivi des équipes).
   Utilisation (à la racine du projet) :  node outils/maj-feuille-route-dessous.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "app/dashboard/page.tsx";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const dessus = `            <FeuilleDeRouteDashboard />\n\n            <BlocMonEspace`;
const fin = `              accesExportExcel={accesExportExcel}
            />
          </>`;
if (t.includes(`accesExportExcel={accesExportExcel}\n            />\n\n            <FeuilleDeRouteDashboard />`)) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (t.split(dessus).length !== 2 || t.split(fin).length !== 2) {
  console.error("✗ Passages attendus introuvables (installez d'abord maj-dashboard-feuille-route.mjs). Rien n'a été modifié.");
  process.exit(1);
}
t = t
  .replace(dessus, () => `            <BlocMonEspace`)
  .replace(fin, () => `              accesExportExcel={accesExportExcel}\n            />\n\n            <FeuilleDeRouteDashboard />\n          </>`);
writeFileSync(f, t, "utf8");
console.log("✓ Feuille de route dépliée placée sous les cartes\n\nTerminé.");
