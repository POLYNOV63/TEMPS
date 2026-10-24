/* ===============================================================
   Portefeuille : plus d'alertes sur les affaires livrées ; « Délai
   dépassé » au lieu de « Objectif dépassé ».
   Fichiers : lib/pilotageCalculs.ts et app/pilotage/page.tsx
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-alertes.mjs
   Le script vérifie tout avant d'écrire ; copies .bak gardées.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichiers = { calculs: "lib/pilotageCalculs.ts", page: "app/pilotage/page.tsx" };
for (const f of Object.values(fichiers))
  if (!existsSync(f)) {
    console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
const textes = Object.fromEntries(Object.entries(fichiers).map(([k, f]) => [k, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));
const originaux = { ...textes };
if (textes.calculs.includes("LIVREE_SANS_ALERTE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(cible, nom, cherche, remplace) {
  const nb = textes[cible].split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  textes[cible] = textes[cible].replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

/* ---- lib/pilotageCalculs.ts ---- */
remplacer(
  "calculs",
  "Une affaire livrée n'a plus d'alerte",
  `  if (a.statut === "ABANDONNEE") return { genre: "info", texte: "Abandonnée" };

  // Contrôle de dépassement : valable aussi pour une affaire livrée
  if (t.chiffre > 0 && t.depassement > 0) {`,
  `  if (a.statut === "ABANDONNEE") return { genre: "info", texte: "Abandonnée" };

  /* LIVREE_SANS_ALERTE : une affaire livrée est terminée, plus d'alerte (ses chiffres restent
     dans le Bilan affaire et dans Charge & pointage) */
  if (a.statut === "LIVREE") return { genre: "info", texte: "Livrée" };

  if (t.chiffre > 0 && t.depassement > 0) {`
);
remplacer("calculs", "« Délai dépassé »", `a.type === "DBE" ? "Remise dépassée" : "Objectif dépassé"`, `a.type === "DBE" ? "Remise dépassée" : "Délai dépassé"`);
remplacer("calculs", "« Affectations finies après le délai »", `"Affectations finies après l’objectif"`, `"Affectations finies après le délai"`);
remplacer("calculs", "« Sans délai »", `"Sans date objectif"`, `"Sans délai"`);

/* ---- app/pilotage/page.tsx ---- */
remplacer(
  "page",
  "Alertes : affaires actives seulement",
  `    const actives = lignes.filter(
      (l) => l.affaire.statut === "EN_COURS" || l.totaux.depassement > 0
    );`,
  `    // seulement les affaires actives : une affaire livrée ou abandonnée n'alerte plus
    const actives = lignes.filter((l) => l.affaire.statut === "EN_COURS" || l.affaire.statut === "EN_ATTENTE");`
);
remplacer(
  "page",
  "Tuile Dépassements : affaires actives seulement",
  `      depassements: lignes.filter((l) => l.affaire.statut !== "ABANDONNEE" && l.totaux.depassement > 0).length,`,
  `      depassements: lignes.filter((l) => (l.affaire.statut === "EN_COURS" || l.affaire.statut === "EN_ATTENTE") && l.totaux.depassement > 0).length,`
);
remplacer("page", "Texte de la tuile", `sous="réalisé supérieur au chiffré"`, `sous="affaires actives : réalisé supérieur au chiffré"`);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [k, f] of Object.entries(fichiers)) {
  writeFileSync(`${f}.bak`, originaux[k], "utf8");
  writeFileSync(f, textes[k], "utf8");
}
console.log("\nTerminé : portefeuille sans alertes sur les affaires livrées.");
