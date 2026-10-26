/* ===============================================================
   Fiche commande PE / PI - version 3 (FICHE_COMMANDE_V3) : une simple
   soustraction.
   La commande est un MONTANT. Avec le taux des lignes du relevé :
   - quantité commandée = montant ÷ taux (18,34 j est une réponse normale) ;
   - consommé = heures saisies × taux de chaque ligne, ramené en jours ou
     en heures avec ce même taux ;
   - reste = commandé − consommé, en jours (ou heures) et en euros.
   Plus de conversion 7 h / 7,5 h, plus d'alerte « le taux ne correspond
   pas ». Le total d'heures du Suivi d'affaire ne sert plus que si une
   commande n'a pas encore de taux.
   S'installe après la fiche commande (avec ou sans le correctif v2).
   Utilisation (à la racine du projet) :  node outils/maj-fiche-commande-v3.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("FICHE_COMMANDE_V3")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("FICHE_COMMANDE")) {
  console.error("✗ La fiche commande n'est pas installée : lancez d'abord node outils/maj-fiche-commande.mjs.");
  process.exit(1);
}
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  // une expression régulière se compte avec le drapeau « g » (sinon ses groupes faussent le compte)
  const nb = typeof cherche === "string" ? texte.split(cherche).length - 1 : (texte.match(new RegExp(cherche.source, "g")) ?? []).length;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, () => remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "Quantité tirée des heures : seulement en secours",
  "      const quantite = heuresCmd > 0 ? heuresCmd / k : null;",
  "      const quantiteHeures = heuresCmd > 0 ? heuresCmd / k : null;"
);
remplacer(
  "Taux et quantité : montant ÷ taux des lignes",
  "      const taux = quantite && montant > 0 ? montant / quantite : null;",
  `      // FICHE_COMMANDE_V3 : la commande est un MONTANT ; quantité = montant ÷ taux des lignes (décimales comprises)
      const premiere = lignesCmd.find((l) => l.taux !== null);
      const tauxLignes =
        premiere && premiere.taux !== null
          ? premiere.unite === unite
            ? premiere.taux
            : premiere.unite === "JOUR"
              ? premiere.taux / premiere.base_horaire
              : premiere.taux * premiere.base_horaire
          : null;
      const taux = tauxLignes ?? (quantiteHeures && montant > 0 ? montant / quantiteHeures : null);
      const quantite = montant > 0 && taux ? montant / taux : quantiteHeures;`
);
remplacer(
  "Consommé : euros ÷ taux",
  /        consomme: (consoU|consoH \/ k),/,
  "        consomme: montant > 0 && taux ? consoE / taux : consoH / k,"
);
remplacer(
  "Reste : commandé − consommé",
  /        reste: quantite === null \? null : quantite - (consoU|consoH \/ k),/,
  "        reste: quantite === null ? null : quantite - (montant > 0 && taux ? consoE / taux : consoH / k),"
);
remplacer(
  "Fiche : la quantité s'explique",
  "f.unite === \"JOUR\" ? `${formatHeures(f.heuresCmd)} ÷ ${deux(f.base)} h` : undefined)}",
  "\"Montant de la commande ÷ taux des lignes\")}"
);
remplacer("Fiche : le taux s'explique", `"Montant ÷ quantité commandée")}`, `"Taux des lignes du relevé (celui de la première, s’il y en a plusieurs)")}`);
remplacer("Fiche : plus d'alerte sur le taux", "                {tousPropres && (", "                {false && tousPropres && (");

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : fiche commande, une simple soustraction.");
