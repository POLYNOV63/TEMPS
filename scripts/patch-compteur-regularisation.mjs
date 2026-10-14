#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Ma semaine : protéger les ajustements forcés du compteur

   Quand un administrateur ajuste le compteur de récupération
   (Administration > Compteurs de récupération), l'ajustement est mémorisé sur
   la dernière feuille validée (colonne feuilles_heures.compteur_regularisation,
   script SQL 17). Ce script fait en sorte que « Ma semaine » le CONSERVE quand
   cette feuille est corrigée par un administrateur ou quand les feuilles
   suivantes sont recalculées : sans lui, ces recalculs repartiraient de la
   formule « avant - récupérations + heures sup au compteur » et perdraient
   l'ajustement.

   A lancer APRES le script SQL 17.

   Utilisation, depuis la racine du projet :
       node scripts/patch-compteur-regularisation.mjs

   Tout ou rien : si une pièce du fichier a changé, rien n'est modifié.
   Sauvegarde : MaSemaineContent.tsx.bak-compteur. Sans effet si relancé.
=============================================================== */

import fs from "node:fs";
import path from "node:path";

const cible = path.resolve(process.argv[2] ?? "app/ma-semaine/MaSemaineContent.tsx");

if (!fs.existsSync(cible)) {
  console.error(`Fichier introuvable : ${cible}\nLancez ce script depuis la racine du projet.`);
  process.exit(1);
}

const original = fs.readFileSync(cible, "utf8");
const crlf = original.includes("\r\n");
let source = original.replace(/\r\n/g, "\n");

if (source.includes("compteur_regularisation")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

const echecs = [];

function remplacer(nom, ancien, nouveau) {
  const n = source.split(ancien).length - 1;

  if (n !== 1) {
    echecs.push(`${nom} : ${n === 0 ? "introuvable" : `présent ${n} fois`}`);
    return;
  }

  source = source.replace(ancien, nouveau);
}

/* 1) la feuille existante : lire son ajustement */
remplacer(
  "lecture de la feuille existante",
  '.select("id, statut, verrouillee, mode_heures_supplementaires")',
  '.select("id, statut, verrouillee, mode_heures_supplementaires, compteur_regularisation")'
);

/* 2) à l'enregistrement : le compteur après garde l'ajustement de cette feuille */
{
  const re = /( *)compteur_apres: validationFinale\n( *)\? compteurApresEnregistrement\n( *): compteurAvantEnregistrement,/;
  const m = re.exec(source);

  if (!m || source.split("compteur_apres: validationFinale").length - 1 !== 1) {
    echecs.push("compteur après à l'enregistrement : introuvable ou présent plusieurs fois");
  } else {
    const ind = m[1];

    source = source.replace(
      re,
      `${ind}// Un ajustement forcé du compteur (Administration > Compteurs de récupération) est conservé\n` +
        `${ind}compteur_apres:\n` +
        `${ind}  (validationFinale\n` +
        `${ind}    ? compteurApresEnregistrement\n` +
        `${ind}    : compteurAvantEnregistrement) +\n` +
        `${ind}  Number(feuilleExistante?.compteur_regularisation ?? 0),`
    );
  }
}

/* 3) recalcul des feuilles suivantes : départ, lecture et formule */
remplacer(
  "départ du recalcul des feuilles suivantes",
  "let compteurCourant = compteurApresEnregistrement;",
  "let compteurCourant =\n          compteurApresEnregistrement +\n          Number(feuilleExistante?.compteur_regularisation ?? 0);"
);

remplacer(
  "lecture des feuilles suivantes",
  '"id, semaine_debut, heures_supplementaires, mode_heures_supplementaires, total_re, cloture_mensuelle, heures_supplementaires_compteur"',
  '"id, semaine_debut, heures_supplementaires, mode_heures_supplementaires, total_re, cloture_mensuelle, heures_supplementaires_compteur, compteur_regularisation"'
);

remplacer(
  "formule des feuilles suivantes",
  "const apres = compteurCourant + hsCompteur - re;",
  "const apres =\n            compteurCourant +\n            hsCompteur -\n            re +\n            Number(suivante.compteur_regularisation ?? 0);"
);

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines pièces n'ont pas pu être repérées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nLe fichier a probablement évolué. Envoyez-moi ce résultat.");
  process.exit(1);
}

const attendu = source.split("compteur_regularisation").length - 1;

if (attendu !== 5) {
  console.error(`Contrôle final : « compteur_regularisation » trouvé ${attendu} fois au lieu de 5. Aucune modification n'a été faite.`);
  process.exit(1);
}

fs.copyFileSync(cible, `${cible}.bak-compteur`);
fs.writeFileSync(cible, crlf ? source.replace(/\n/g, "\r\n") : source, "utf8");

console.log("Ma semaine conserve désormais les ajustements forcés du compteur.");
console.log("Sauvegarde : MaSemaineContent.tsx.bak-compteur. Lancez « npx tsc --noEmit » puis « npm run dev ».");
