#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Ma semaine : saisie en GRILLE (version 5 : alertes seulement à l'enregistrement / à la validation)

   A lancer APRES avoir copié les fichiers de l'archive dans le projet :
     - lib/grilleSemaine.ts
     - app/ma-semaine/GrilleSemaine.tsx
     - scripts/ma-semaine-grille.snippets.txt (ce dossier)

   Par insertions ciblées, le script :
     - ajoute dans app/ma-semaine/MaSemaineContent.tsx l'adaptateur qui branche
       la grille sur les fonctions EXISTANTES de la page, et la grille ;
     - masque l'ancien tableau (son code reste dans le fichier, inutilisé) ;
     - ajoute à app/ma-semaine/AssistantSaisie.tsx deux options du bandeau
       (non collant, sans pastilles de jours) utilisées avec la grille.

   MISE A JOUR : si une version précédente (1 à 4) est déjà installée, le
   script repart de la sauvegarde *.bak-grille (les fichiers d'origine) et
   installe la version 5.

   Le calcul des heures, l'enregistrement, la validation et les heures
   supplémentaires ne sont pas touchés.

   Utilisation, depuis la racine du projet :
       node scripts/patch-ma-semaine-grille.mjs

   Tout ou rien : si une insertion échoue, AUCUN fichier n'est modifié.
   Sauvegardes : *.bak-grille. Sans effet si relancé.
=============================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dossierScript = path.dirname(fileURLToPath(import.meta.url));
const racine = process.cwd();

const cibleContenu = path.resolve(process.argv[2] ?? "app/ma-semaine/MaSemaineContent.tsx");
const cibleAssistant = path.join(path.dirname(cibleContenu), "AssistantSaisie.tsx");

function arret(message) {
  console.error(message);
  process.exit(1);
}

for (const fichier of [cibleContenu, cibleAssistant]) {
  if (!fs.existsSync(fichier)) {
    arret(`Fichier introuvable : ${fichier}\nLancez ce script depuis la racine du projet.`);
  }
}

if (!fs.existsSync(path.join(racine, "lib", "grilleSemaine.ts"))) {
  arret("lib/grilleSemaine.ts est absent : copiez d'abord le contenu de l'archive dans le projet.");
}

if (!fs.existsSync(path.join(path.dirname(cibleContenu), "GrilleSemaine.tsx"))) {
  arret("app/ma-semaine/GrilleSemaine.tsx est absent : copiez d'abord le contenu de l'archive dans le projet.");
}

function lireExtraits() {
  const texte = fs
    .readFileSync(path.join(dossierScript, "ma-semaine-grille.snippets.txt"), "utf8")
    .replace(/\r\n/g, "\n");

  const extraits = {};
  let nom = null;
  let lignes = [];

  for (const ligne of texte.split("\n")) {
    const m = /^@@@ (\w+)$/.exec(ligne);

    if (m) {
      if (nom) extraits[nom] = lignes.join("\n").replace(/\n+$/, "");
      nom = m[1];
      lignes = [];
    } else {
      lignes.push(ligne);
    }
  }

  if (nom) extraits[nom] = lignes.join("\n").replace(/\n+$/, "");

  return extraits;
}

const X = lireExtraits();

/* ---------------- lecture des deux fichiers ---------------- */

const lire = (fichier) => {
  const original = fs.readFileSync(fichier, "utf8");
  return { original, crlf: original.includes("\r\n"), source: original.replace(/\r\n/g, "\n") };
};

const contenu = lire(cibleContenu);
const assistant = lire(cibleAssistant);

if (contenu.source.includes("GRILLE_SEMAINE_V5") && assistant.source.includes("sansPuces")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

// Version précédente déjà installée : on repart des fichiers d'origine sauvegardés.
let miseAJour = false;

if (/GRILLE_SEMAINE_V[1234]/.test(contenu.source)) {
  const sauvegardes = [cibleContenu, cibleAssistant].map((f) => `${f}.bak-grille`);

  if (!sauvegardes.every((f) => fs.existsSync(f))) {
    arret(
      "Une version précédente est installée mais les sauvegardes *.bak-grille sont introuvables.\n" +
        "Remettez les fichiers d'origine (ou envoyez-moi MaSemaineContent.tsx) avant de relancer."
    );
  }

  const origineContenu = lire(sauvegardes[0]);
  const origineAssistant = lire(sauvegardes[1]);

  if (origineContenu.source.includes("GRILLE_SEMAINE") || origineAssistant.source.includes("sansPuces")) {
    arret("Les sauvegardes *.bak-grille contiennent déjà la grille : impossible de repartir proprement.");
  }

  Object.assign(contenu, { source: origineContenu.source, crlf: origineContenu.crlf });
  Object.assign(assistant, { source: origineAssistant.source, crlf: origineAssistant.crlf });
  miseAJour = true;
  console.log("Version précédente détectée : mise à jour vers la version 5 à partir des fichiers d'origine.");
}

for (const marque of ["ASSISTANT_SAISIE_V1", "SAISIE_MOBILE_V1", "BLOCS_IMPUTATION_V1"]) {
  if (!contenu.source.includes(marque)) {
    arret(`MaSemaineContent.tsx ne contient pas ${marque} : les patchs précédents (blocs, assistant, mobile) doivent être installés d'abord.`);
  }
}

/* ---------------- outils d'insertion ---------------- */

const echecs = [];

function indentationAvant(texte, index) {
  const debut = texte.lastIndexOf("\n", index - 1) + 1;
  return texte.slice(debut, index).match(/^\s*/)[0];
}

function indenter(texte, ind) {
  return texte
    .split("\n")
    .map((ligne, i) => (i === 0 || ligne.trim() === "" ? ligne : ind + ligne))
    .join("\n");
}

function remplacer(fichier, nom, re, fabrique, attendu = 1) {
  const trouves = [...fichier.source.matchAll(re)];

  if (trouves.length !== attendu) {
    echecs.push(`${nom} : ${trouves.length} occurrence(s) trouvée(s), ${attendu} attendue(s)`);
    return;
  }

  const source = fichier.source;

  fichier.source = source.replace(re, (...args) => {
    const correspondance = args[0];
    const decalage = args[args.length - 2];
    const ind = indentationAvant(source, decalage);

    return fabrique(correspondance, ind);
  });
}

const avant = (extrait) => (correspondance, ind) =>
  `${indenter(extrait, ind)}\n\n${ind}${correspondance}`;

const apres = (extrait) => (correspondance, ind) =>
  `${correspondance}\n\n${ind}${indenter(extrait, ind)}`;

/* ---------------- MaSemaineContent.tsx ---------------- */

remplacer(
  contenu,
  "import de la barre mobile",
  /import \{ BarreActionsMobile \} from "\.\/SaisieMobile";/g,
  apres(X.IMPORTS)
);

remplacer(
  contenu,
  "état des alertes de la grille",
  /aideOuverte,\s*setAideOuverte,\s*\]\s*=\s*useState\(false\);/g,
  apres(X.ETATS)
);

remplacer(
  contenu,
  "adaptateur de la grille",
  /if \(chargement \|\| !codesCharges \|\| !activitesCharges\) \{/g,
  avant(X.ADAPTATEUR)
);

remplacer(contenu, "barre du week-end", /<fieldset\s+disabled=\{/g, avant(X.BASCULE));

remplacer(
  contenu,
  "grille et masquage du tableau classique",
  /<div style=\{styles\.table\}>/g,
  (_correspondance, ind) =>
    `${indenter(X.GRILLE, ind)}\n\n${ind}<div style={{ ...styles.table, display: "none" }}>`
);

remplacer(
  contenu,
  "bandeau : options du mode grille",
  /compact=\{estMobile\}/g,
  (correspondance, ind) =>
    `${correspondance}\n${ind}collant={estMobile}\n${ind}sansPuces={!estMobile}`
);

remplacer(
  contenu,
  "bandeau : lien « premier jour incomplet »",
  /premierIncomplet=\{premierJourIncomplet\}/g,
  () => "premierIncomplet={estMobile ? premierJourIncomplet : null}"
);

// Les alertes de la grille s'affichent quand on tente d'enregistrer ou de valider la semaine.
remplacer(
  contenu,
  "alertes : tentative de validation",
  /function demanderValidationFinale\(\) \{/g,
  (correspondance, ind) => `${correspondance}\n${ind}  setVerifGrille((n) => n + 1);\n`
);

remplacer(
  contenu,
  "alertes : tentative d'enregistrement",
  /async function enregistrerBrouillon\(\) \{/g,
  (correspondance, ind) => `${correspondance}\n${ind}  setVerifGrille((n) => n + 1);\n`
);

/* ---------------- AssistantSaisie.tsx ---------------- */

remplacer(
  assistant,
  "bandeau : paramètres",
  /compact = false,\s*jourSelectionne,\s*\}: \{/g,
  () => "compact = false,\n  jourSelectionne,\n  collant = true,\n  sansPuces = false,\n}: {"
);

remplacer(
  assistant,
  "bandeau : types",
  /jourSelectionne\?: string;\s*\}\) \{/g,
  () => "jourSelectionne?: string;\n  /* Mode grille : bandeau non collant, sans les pastilles de jours (la grille a ses cartes) */\n  collant?: boolean;\n  sansPuces?: boolean;\n}) {"
);

remplacer(
  assistant,
  "bandeau : position",
  /<div style=\{styles\.bandeau\}>/g,
  () => '<div style={{ ...styles.bandeau, ...(collant ? {} : { position: "static" as const }) }}>'
);

remplacer(
  assistant,
  "bandeau : pastilles masquées",
  /<div style=\{styles\.ligne\}>/g,
  () => '<div style={{ ...styles.ligne, ...(sansPuces ? { display: "none" as const } : {}) }}>'
);

/* ---------------- bilan ---------------- */

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines insertions n'ont pas pu être placées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nLe fichier a probablement évolué depuis la dernière mise à jour. Envoyez-moi le résultat ci-dessus.");
  process.exit(1);
}

for (const [fichier, etat] of [
  [cibleContenu, contenu],
  [cibleAssistant, assistant],
]) {
  if (!fs.existsSync(`${fichier}.bak-grille`)) fs.copyFileSync(fichier, `${fichier}.bak-grille`);
  fs.writeFileSync(fichier, etat.crlf ? etat.source.replace(/\n/g, "\r\n") : etat.source, "utf8");
}

console.log(miseAJour ? "Saisie en grille mise à jour (version 5)." : "Saisie en grille installée (version 5).");
console.log(" - app/ma-semaine/MaSemaineContent.tsx");
console.log(" - app/ma-semaine/AssistantSaisie.tsx");
console.log("Sauvegardes : *.bak-grille. Relancez « npx tsc --noEmit » puis « npm run dev ».");
