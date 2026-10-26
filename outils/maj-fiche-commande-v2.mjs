/* ===============================================================
   Fiche commande PE / PI - correctif (FICHE_COMMANDE_V2).
   La « journée » de la fiche (7 h ou 7,5 h) ne sert qu'à lire le total
   d'heures du Suivi d'affaire en jours vendus. Elle ne doit pas changer la
   base de facturation des lignes du relevé (souvent 7,5 h chez le client).
   - changer la journée dans la fiche ne touche plus la base des lignes ;
   - le consommé et le reste se comptent en jours avec la base de CHAQUE
     ligne (comme la facturation), et non avec celle de la fiche.
   Utilisation (à la racine du projet) :  node outils/maj-fiche-commande-v2.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("FICHE_COMMANDE_V2")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("FICHE_COMMANDE")) {
  console.error("✗ La fiche commande n'est pas installée : lancez d'abord node outils/maj-fiche-commande.mjs.");
  process.exit(1);
}
const changements = [
  ["Consommé compté ligne par ligne (déclaration)", "      let consoH = 0;\n      let consoE = 0;", "      // FICHE_COMMANDE_V2 : consommé dans l'unité de la commande, avec la base de chaque ligne\n      let consoH = 0;\n      let consoU = 0;\n      let consoE = 0;"],
  ["Consommé compté ligne par ligne (calcul)", "        consoH += h;\n", "        consoH += h;\n        consoU += unite === \"JOUR\" ? h / (l.base_horaire || base) : h;\n"],
  ["Consommé de la commande", "        consomme: consoH / k,", "        consomme: consoU,"],
  ["Reste de la commande", "        reste: quantite === null ? null : quantite - consoH / k,", "        reste: quantite === null ? null : quantite - consoU,"],
  [
    "La journée de la fiche ne change plus la base des lignes",
    "        if (taux !== null && l.unite !== unite) taux = Math.round((unite === \"HEURE\" ? taux / l.base_horaire : taux * base) * 100) / 100;\n        return { l, patch: { unite, base_horaire: base, taux } };",
    "        if (taux !== null && l.unite !== unite) taux = Math.round((unite === \"HEURE\" ? taux / l.base_horaire : taux * l.base_horaire) * 100) / 100;\n        return { l, patch: { unite, taux } };",
  ],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
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
console.log("\nTerminé : fiche commande corrigée.");
