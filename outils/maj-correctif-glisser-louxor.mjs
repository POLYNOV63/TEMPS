/* ===============================================================
   1. Planning par ressource : retire le commentaire placé au mauvais
      endroit (il cassait le build sur Vercel : « Expected '</' »).
   2. Facturation : la vérification des n° ARC Louxor en double ignore
      les commandes livrées.
   Utilisation (à la racine du projet) :  node outils/maj-correctif-glisser-louxor.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function corriger(chemin, nom, cherche, remplace) {
  if (!existsSync(chemin)) {
    console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  const texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
  if (!texte.includes(cherche)) {
    console.log(texte.includes(remplace.trim() || "§§§") ? `✓ ${nom} : déjà fait` : `✓ ${nom} : rien à corriger`);
    return;
  }
  writeFileSync(chemin, texte.split(cherche).join(remplace), "utf8");
  console.log(`✓ ${nom}`);
}

corriger(
  "app/pilotage/planning-ressources/page.tsx",
  "Planning par ressource : commentaire mal placé retiré",
  "          {/* RESSOURCES_GLISSER : largeur minimale (22 px par jour), la page se fait glisser de côté sur téléphone */}\n",
  ""
);
corriger(
  "app/analyse/facturation/page.tsx",
  "Facturation : doublons Louxor, commandes livrées ignorées",
  `      if (l.disparue || !(l.genre === "BASE" || l.genre === "AVENANT")) continue;\n      const arc = l.numero_arc_louxor?.trim().toUpperCase();`,
  `      // LOUXOR_SANS_LIVREES : une commande livrée n'entre plus dans la vérification
      if (l.disparue || l.statut === "Livrée" || !(l.genre === "BASE" || l.genre === "AVENANT")) continue;\n      const arc = l.numero_arc_louxor?.trim().toUpperCase();`
);
console.log("\nTerminé.");
