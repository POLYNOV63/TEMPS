/* ===============================================================
   Tableau de bord des collaborateurs et des responsables : leur feuille
   de route, dépliée, sur 2 semaines (components/FeuilleDeRouteDashboard.tsx,
   fourni dans le zip), au-dessus de « Mon espace ». La carte « Ma feuille
   de route » reste (pour voir plus loin, et pour les responsables, voir
   celle d'un collègue). ADMIN et Direction : inchangés.
   Utilisation (à la racine du projet) :  node outils/maj-dashboard-feuille-route.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (!existsSync("components/FeuilleDeRouteDashboard.tsx")) {
  console.error("✗ components/FeuilleDeRouteDashboard.tsx introuvable : décompressez tout le zip à la racine, puis relancez.");
  process.exit(1);
}
const f = "app/dashboard/page.tsx";
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
if (t.includes("FeuilleDeRouteDashboard")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const imp = `import { useRouter } from "next/navigation";`;
const bloc = `          <>
            <BlocMonEspace`;
if (t.split(imp).length !== 2 || t.split(bloc).length !== 2) {
  console.error("✗ Passages attendus introuvables. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
t = t
  .replace(imp, () => `${imp}\nimport FeuilleDeRouteDashboard from "@/components/FeuilleDeRouteDashboard";`)
  .replace(bloc, () => `          <>\n            <FeuilleDeRouteDashboard />\n\n            <BlocMonEspace`);
writeFileSync(f, t, "utf8");
console.log("✓ Tableau de bord : feuille de route dépliée pour les collaborateurs et les responsables\n\nTerminé.");
