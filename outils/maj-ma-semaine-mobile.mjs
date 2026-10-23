/* ===============================================================
   Ma semaine (app/ma-semaine/MaSemaineContent.tsx) : téléphone plus
   compact. Seul l'affichage sur téléphone change :
   - titre réduit, texte d'introduction masqué ;
   - navigation des semaines sur une ligne (◀ Préc. · S43 · Suiv. ▶) ;
   - les 4 compteurs (saisies, heures sup, compteur, tickets) plus serrés,
     sans les textes d'explication ;
   - aide sur une colonne ; fenêtres de validation et de clôture
     mensuelle qui tiennent dans l'écran (défilement si besoin).
   Utilisation (à la racine du projet) :  node outils/maj-ma-semaine-mobile.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/ma-semaine/MaSemaineContent.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("MOBILE_COMPACT_V2")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;

const changements = [
  [
    "Navigation des semaines sur une ligne",
    `    navigation: {
      ...base.navigation,
      gridTemplateColumns: "1fr",
      gap: 10,
      padding: 12,
    },`,
    `    navigation: {
      ...base.navigation,
      gridTemplateColumns: "auto minmax(0, 1fr) auto",
      gap: 6,
      padding: 10,
    },`,
  ],
  [
    "Styles téléphone plus compacts",
    `    deleteButton: { ...base.deleteButton, width: 44, height: 44 },
  };
}`,
    `    deleteButton: { ...base.deleteButton, width: 44, height: 44 },

    /* MOBILE_COMPACT_V2 : moins de place perdue avant la saisie */
    intro: { ...base.intro, marginBottom: 10 },
    eyebrow: { ...base.eyebrow, display: "none" },
    pageTitle: { ...base.pageTitle, fontSize: 22 },
    pageDescription: { ...base.pageDescription, display: "none" },
    weekBadge: { ...base.weekBadge, fontSize: 24 },
    navigationDates: { ...base.navigationDates, fontSize: 12, marginTop: 2 },
    cards: { ...base.cards, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 },
    card: { ...base.card, padding: "8px 10px", minHeight: 0 },
    cardLabel: { ...base.cardLabel, marginBottom: 2 },
    cardValue: { ...base.cardValue, fontSize: 20 },
    cardHint: { ...base.cardHint, display: "none" },
    finalValidationWarning: { ...base.finalValidationWarning, fontSize: 12, padding: "10px 12px" },
    helpGrid: { ...base.helpGrid, gridTemplateColumns: "1fr" },
  };
}`,
  ],
  ["Bouton « semaine précédente » court", "            ← Semaine précédente\n", "            ◀ Préc.\n"],
  ["Bouton « semaine suivante » court", "            Semaine suivante →\n", "            Suiv. ▶\n"],
  [
    "Fenêtre de validation",
    `              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,.28)",`,
    `              padding: estMobile ? 18 : 28,
              maxHeight: "92vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,.28)",`,
  ],
  [
    "Fenêtre de clôture mensuelle",
    `              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",`,
    `              padding: estMobile ? 18 : 28,
              maxHeight: "92vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",`,
  ],
];

for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : Ma semaine plus compacte sur téléphone.");
