#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Profils horaires : créer ses rythmes « à volonté »

   Pourquoi la création échoue : la page affiche seulement « Impossible de créer le profil
   horaire » sans dire pourquoi, et envoie à la base des colonnes qui peuvent la bloquer.

   Ce script corrige les DEUX pages qui créent des profils horaires :
     app/admin/profils-horaires/page.tsx
       - affiche la VRAIE cause renvoyée par la base (en français) au lieu du message vague ;
       - n'envoie plus « total_hebdomadaire » (colonne inutile : le total se calcule à l'affichage,
         et une colonne calculée par la base refuse d'être écrite) ;
       - envoie explicitement samedi, dimanche et forfait à la création (colonnes obligatoires) ;
       - accepte les quarts d'heure (7,75 = 7 h 45) avec les flèches du clavier ;
       - refuse proprement un nom de profil déjà pris, avant d'interroger la base.
     app/admin/collaborateurs/page.tsx
       - création d'un profil personnalisé : mêmes colonnes explicites et vraie cause de l'erreur.

   Utilisation, depuis la racine du projet :
       node scripts/patch-profils-horaires.mjs

   Tout ou rien (les deux pages ou aucune). Sauvegardes : page.tsx.bak-profils. Sans effet si relancé.
=============================================================== */

import fs from "node:fs";
import path from "node:path";

const fichierProfils = path.resolve(process.argv[2] ?? "app/admin/profils-horaires/page.tsx");
const fichierCollabs = path.resolve(process.argv[3] ?? "app/admin/collaborateurs/page.tsx");

for (const f of [fichierProfils, fichierCollabs]) {
  if (!fs.existsSync(f)) {
    console.error(`Fichier introuvable : ${f}\nLancez ce script depuis la racine du projet.`);
    process.exit(1);
  }
}

function lire(f) {
  const original = fs.readFileSync(f, "utf8");
  return { crlf: original.includes("\r\n"), texte: original.replace(/\r\n/g, "\n") };
}

const P = lire(fichierProfils);
const C = lire(fichierCollabs);

if (P.texte.includes("PROFILS_HORAIRES_V2") && C.texte.includes("PROFILS_HORAIRES_V2")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

const echecs = [];

function remplacerExact(cible, nom, ancien, nouveau, attendu = 1) {
  const n = cible.texte.split(ancien).length - 1;

  if (n !== attendu) {
    echecs.push(`${nom} : ${n === 0 ? "introuvable" : `présent ${n} fois au lieu de ${attendu}`}`);
    return;
  }

  cible.texte = cible.texte.split(ancien).join(nouveau);
}

function remplacerRegex(cible, nom, motif, remplacement) {
  const m = [...cible.texte.matchAll(new RegExp(motif.source, motif.flags.includes("g") ? motif.flags : `${motif.flags}g`))];

  if (m.length !== 1) {
    echecs.push(`${nom} : ${m.length === 0 ? "introuvable" : `présent ${m.length} fois`}`);
    return;
  }

  cible.texte = cible.texte.replace(m[0][0], typeof remplacement === "function" ? remplacement(m[0]) : remplacement);
}

/* ======================= PAGE PROFILS HORAIRES ======================= */

if (!P.texte.includes("PROFILS_HORAIRES_V2")) {
  // 1) fonction qui traduit l'erreur de la base
  remplacerRegex(
    P,
    "emplacement de la fonction messageErreur",
    /function formatDecimal\(heures: number\) \{[\s\S]*?\n\}\n/,
    (m) => `${m[0]}
/* PROFILS_HORAIRES_V2 : cause réelle d'une erreur de la base, en français */
function messageErreur(erreur: unknown, defaut: string) {
  const e = erreur as { message?: string; code?: string; details?: string; hint?: string } | null;
  const texte = [e?.message, e?.details, e?.hint].filter(Boolean).join(" — ");

  if (!texte) return defaut;

  if (e?.code === "23505") return \`\${defaut} Cette valeur existe déjà dans la base : \${texte}\`;
  if (e?.code === "23514") return \`\${defaut} Une règle de la base refuse ces valeurs : \${texte}\`;
  if (e?.code === "23502") return \`\${defaut} Une colonne obligatoire n'est pas renseignée : \${texte}\`;
  if (e?.code === "22003") return \`\${defaut} Une valeur est trop grande ou trop précise pour sa colonne : \${texte}\`;
  if (e?.code === "42501") return \`\${defaut} Droits insuffisants : \${texte}\`;

  return \`\${defaut} Cause : \${texte}\`;
}
`
  );

  // 2) les messages d'erreur vagues deviennent précis
  for (const defaut of [
    "Impossible de charger les profils horaires.",
    "Impossible d'enregistrer le profil horaire.",
    "Impossible de créer le profil horaire.",
    "Impossible de modifier le statut du profil.",
  ]) {
    const echap = defaut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    remplacerRegex(
      P,
      `message « ${defaut} »`,
      new RegExp(`setErreur\\(\\s*"${echap}"\\s*\\);`),
      `setErreur(messageErreur(error, "${defaut}"));`
    );
  }

  // 3) la mise à jour n'envoie plus le total
  remplacerRegex(
    P,
    "mise à jour du profil (total)",
    /(\.update\(\{\s*nom: profil\.nom\.trim\(\),[\s\S]*?vendredi: Number\(profil\.vendredi\),)\n\s*total_hebdomadaire: total,(\n\s*actif: profil\.actif,)/,
    (m) => `${m[1]}${m[2]}`
  );

  // 4) la création : plus de total, colonnes obligatoires explicites
  remplacerRegex(
    P,
    "création du profil (total)",
    /\n(\s*)total_hebdomadaire: totalNouveau,\n(\s*)actif: true,/,
    (m) => `\n${m[1]}samedi: 0,\n${m[1]}dimanche: 0,\n${m[1]}forfait: false,\n${m[2]}actif: true,`
  );

  // 5) nom déjà pris : message clair avant d'interroger la base
  remplacerExact(
    P,
    "contrôle du nom déjà pris",
    '      setEnregistrement("nouveau");',
    `      if (profils.some((p) => p.nom.trim().toLowerCase() === nom.toLowerCase())) {
        setErreur(\`Un profil « \${nom} » existe déjà (actif ou inactif). Choisissez un autre nom.\`);
        return;
      }

      setEnregistrement("nouveau");`
  );

  // 6) quarts d'heure
  remplacerExact(P, "pas des champs d'heures", 'step="0.5"', 'step="0.25"', 3);
}

/* ======================= PAGE COLLABORATEURS ======================= */

if (!C.texte.includes("PROFILS_HORAIRES_V2")) {
  remplacerRegex(
    C,
    "création du profil personnalisé",
    /(\.insert\(\{\s*nom: nomProfil,[\s\S]*?vendredi: Number\(vendredi\),)(\s*)actif: true,/,
    (m) => `${m[1]}${m[2]}// PROFILS_HORAIRES_V2 : colonnes obligatoires explicites${m[2]}samedi: 0,${m[2]}dimanche: 0,${m[2]}forfait: false,${m[2]}actif: true,`
  );

  remplacerRegex(
    C,
    "message d'erreur du profil",
    /console\.error\(erreurProfil\);\s*setErreur\("Impossible de créer le profil horaire\."\);/,
    `console.error(erreurProfil);
      setErreur(
        erreurProfil?.message
          ? \`Impossible de créer le profil horaire. Cause : \${erreurProfil.message}\`
          : "Impossible de créer le profil horaire."
      );`
  );
}

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines pièces n'ont pas pu être repérées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nLes pages ont probablement évolué. Envoyez-moi ce résultat.");
  process.exit(1);
}

for (const [cible, nom, attendu] of [
  [P, "messageErreur(", 5],
  [P, "forfait: false", 1],
  [C, "forfait: false", 1],
]) {
  const n = cible.texte.split(nom).length - 1;

  if (n < attendu) {
    console.error(`Contrôle final : « ${nom} » trouvé ${n} fois (au moins ${attendu} attendu). Aucune modification n'a été faite.`);
    process.exit(1);
  }
}

if (P.texte.includes("total_hebdomadaire: totalNouveau")) {
  console.error("Contrôle final : le total est encore envoyé à la création. Aucune modification n'a été faite.");
  process.exit(1);
}

for (const [f, cible] of [
  [fichierProfils, P],
  [fichierCollabs, C],
]) {
  fs.copyFileSync(f, `${f}.bak-profils`);
  fs.writeFileSync(f, cible.crlf ? cible.texte.replace(/\n/g, "\r\n") : cible.texte, "utf8");
}

console.log("Profils horaires : la vraie cause des erreurs s'affiche, et la création est fiabilisée (deux pages modifiées).");
console.log("Sauvegardes : page.tsx.bak-profils. Lancez « npx tsc --noEmit » puis « npm run dev ».");
