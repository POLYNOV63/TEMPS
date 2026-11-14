// HEURES_EXACTES : le planning place exactement les heures demandées (92,4 h → 92,4 h),
// journées pleines puis l'appoint sur le dernier jour. Avant, le total était arrondi au quart d'heure (92,5 h).
// Relançable sans risque : ne touche le fichier que si l'ancienne ligne est encore là.
import { readFileSync, writeFileSync } from "node:fs";

const fichier = "lib/pilotagePlanning.ts";
let texte = readFileSync(fichier, "utf8");

if (texte.includes("HEURES_EXACTES")) {
  console.log("Déjà fait : rien à changer.");
  process.exit(0);
}

const ancien = "let reste = Math.max(0, arrondi025(options.quantiteHeures));";
const nouveau = "let reste = Math.max(0, arrondi2(options.quantiteHeures)); // HEURES_EXACTES : pas d'arrondi au quart d'heure du total";

const nb = texte.split(ancien).length - 1;
if (nb !== 1) {
  console.error(`ÉCHEC : la ligne à corriger a été trouvée ${nb} fois dans ${fichier} (1 attendue). Rien n'a été modifié.`);
  process.exit(1);
}

texte = texte.replace(ancien, nouveau);
writeFileSync(fichier, texte, "utf8");
console.log("OK : lib/pilotagePlanning.ts corrigé (heures exactes).");
