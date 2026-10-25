/* ===============================================================
   Ma semaine sur TÉLÉPHONE, plus compacte (SAISIE_MOBILE_V2) :
   - la semaine tient sur une ligne (◀ S44 31 / 37,5 h ▶) ;
   - les 4 cartes (HS, récupération, tickets…) deviennent un résumé
     repliable, avec le bouton du week-end ;
   - les 5 jours tiennent dans la largeur, sans défiler ;
   - l'objectif du jour tient sur une ligne ; présence, absence et ticket
     sont en haut, sur une ligne ;
   - une ligne par affaire, avec un grand champ d'heures : l'activité et le
     code s'affichent en résumé (« Méca · ET ✎ ») et se changent d'un appui ;
   - la barre du bas tient sur une ligne.
   Rien ne change sur ordinateur.
   Les modifications sont décrites dans maj-semaine-mobile.json (même dossier).
   Utilisation (à la racine du projet) :  node outils/maj-semaine-mobile.mjs
================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const changements = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "maj-semaine-mobile.json"), "utf8"));

function chercher(dossier, nom) {
  for (const n of readdirSync(dossier)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const c = join(dossier, n);
    if (statSync(c).isDirectory()) {
      const t = chercher(c, nom);
      if (t) return t;
    } else if (n === nom) return c;
  }
  return null;
}

const fichiers = {};
for (const nom of ["GrilleSemaine.tsx", "MaSemaineContent.tsx", "AssistantSaisie.tsx", "SaisieMobile.tsx"]) {
  const c = chercher("app", nom);
  if (!c) {
    console.error(`✗ ${nom} introuvable (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  fichiers[nom] = { chemin: c, texte: readFileSync(c, "utf8").replace(/\r\n/g, "\n") };
}
if (fichiers["GrilleSemaine.tsx"].texte.includes("SAISIE_MOBILE_V2")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

// un passage « @@DEBUT@@ … @@FIN@@ » remplace tout ce qui va du début jusqu'à la fin (exclue) ;
// les lignes « ==== » des commentaires peuvent avoir une longueur différente
const motif = (t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/=+/g, "=+"), "g");

let erreurs = 0;
for (const ch of changements) {
  const f = fichiers[ch.fichier];
  if (ch.ecrire !== undefined) {
    f.texte = ch.ecrire;
    console.log(`✓ ${ch.nom}`);
    continue;
  }
  if (ch.cherche.startsWith("@@DEBUT@@")) {
    const [debut, fin] = ch.cherche.slice(9).split("@@FIN@@");
    const md = [...f.texte.matchAll(motif(debut))];
    if (md.length !== 1) {
      console.error(`✗ ${ch.nom} : début trouvé ${md.length} fois (attendu 1)`);
      erreurs++;
      continue;
    }
    const i = md[0].index;
    const rf = motif(fin);
    rf.lastIndex = i + md[0][0].length;
    const mf = rf.exec(f.texte);
    if (!mf) {
      console.error(`✗ ${ch.nom} : fin introuvable`);
      erreurs++;
      continue;
    }
    f.texte = f.texte.slice(0, i) + ch.remplace + f.texte.slice(mf.index);
    console.log(`✓ ${ch.nom}`);
    continue;
  }
  const nb = f.texte.split(ch.cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${ch.nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  f.texte = f.texte.replace(ch.cherche, () => ch.remplace);
  console.log(`✓ ${ch.nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const f of Object.values(fichiers)) writeFileSync(f.chemin, f.texte, "utf8");
console.log("\nTerminé : Ma semaine plus compacte sur téléphone.");
