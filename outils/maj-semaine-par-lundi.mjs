/* ===============================================================
   Analyse de capacité : une semaine entière est rattachée à la période
   qui contient son LUNDI (avant : à toute période qu'elle touchait, d'où
   la semaine du 26/10 au 01/11/2026 comptée dans l'exercice 2026-2027
   parce que son dimanche est le 1er novembre). Plus de double compte
   d'une période à l'autre ; la capacité d'une semaine historique est
   alors celle de la semaine entière (35 h).
   Utilisation (à la racine du projet) :  node outils/maj-semaine-par-lundi.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/admin/bilans/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("SEMAINE_PAR_LUNDI")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Une semaine appartient à la période de son lundi",
    `    return (
      dimanche >=
        new Date(
          periodeActive.debut.getFullYear(),
          periodeActive.debut.getMonth(),
          periodeActive.debut.getDate()
        ) &&
      lundi <=
        periodeActive.fin
    );`,
    `    // SEMAINE_PAR_LUNDI : une semaine entière appartient à la période qui contient son lundi
    void dimanche;
    return (
      lundi >=
        new Date(
          periodeActive.debut.getFullYear(),
          periodeActive.debut.getMonth(),
          periodeActive.debut.getDate()
        ) &&
      lundi <=
        periodeActive.fin
    );`,
  ],
  [
    "Capacité historique : la semaine entière",
    `    if (modePeriode === "EXERCICE") {
      return 35;
    }`,
    `    const semaineEntiere: boolean = true; // SEMAINE_PAR_LUNDI : les heures de la semaine sont comptées en entier
    if (modePeriode === "EXERCICE" || semaineEntiere) {
      return 35;
    }`,
  ],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const n = texte.split(cherche).length - 1;
  if (n !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${n} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, () => remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé.");
