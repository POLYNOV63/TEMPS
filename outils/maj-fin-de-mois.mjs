// FIN_DE_MOIS : la page « Export Excel » (/admin/export-excel) devient un bloc du Bilan RH mensuel.
// Retire la page de la liste des droits et des onglets de section.
// Relançable : ce qui est déjà fait est sauté. Tout ou rien : rien n'est écrit si un fichier manque.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const fichiers = [
  { chemin: "lib/droits.ts", retirer: /^.*\{ href: "\/admin\/export-excel",.*\r?\n/m, repere: '"/admin/bilan-rh"' },
  { chemin: "components/OngletsSection.tsx", retirer: /^.*\{ href: "\/admin\/export-excel",.*\r?\n/m, repere: '"/admin/bilan-rh"' },
];

const manquants = fichiers.filter((f) => !existsSync(f.chemin) || !readFileSync(f.chemin, "utf8").includes(f.repere));
if (manquants.length > 0) {
  for (const f of manquants) console.log(`ÉCHEC : ${f.chemin} introuvable ou sans le repère ${f.repere} (lancez le script depuis le dossier du projet)`);
  console.log("Rien n'a été modifié.");
  process.exit(1);
}
for (const f of fichiers) {
  const texte = readFileSync(f.chemin, "utf8");
  if (!f.retirer.test(texte)) {
    console.log(`Déjà fait : ${f.chemin}`);
    continue;
  }
  writeFileSync(f.chemin, texte.replace(f.retirer, ""), "utf8");
  console.log(`OK : ${f.chemin}`);
}
