/* ===============================================================
   Planning par ressource ouvert à TOUS (droit « voirPlanning », comme le
   planning des affaires ; il était réservé à « chargeRessources »), et sans
   pourcentage : la colonne de droite ne montre plus que les heures
   (affecté / disponible), sans % coloré.
   Utilisation (à la racine du projet) :  node outils/maj-planning-ressources-tous.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "app/pilotage/planning-ressources/page.tsx";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
if (t.includes(`<GardeAcces droit="voirPlanning">`)) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  ["Ouvert à tous", `<GardeAcces droit="chargeRessources">`, `<GardeAcces droit="voirPlanning">`],
  [
    "Colonne de droite sans pourcentage",
    `                    <strong style={{ color: ratio > 1.01 ? "#b3261e" : ratio > 0.9 ? "#7a3e00" : "#1b5e20" }}>{Math.round(ratio * 100)} %</strong>
                    <span style={{ color: C.gris }}>
                      {formatHeures(l.totalAffecte)} / {formatHeures(l.totalNet)}
                    </span>`,
    `                    <span style={{ color: C.gris }} title={\`\${formatHeures(l.totalAffecte)} affectées pour \${formatHeures(l.totalNet)} disponibles sur la période\`}>
                      {formatHeures(l.totalAffecte)} / {formatHeures(l.totalNet)}
                    </span>`,
  ],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  if (t.split(cherche).length !== 2) {
    console.error(`✗ ${nom} : passage introuvable`);
    erreurs++;
    continue;
  }
  t = t.replace(cherche, () => remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(f, t, "utf8");
console.log("\nTerminé.");
