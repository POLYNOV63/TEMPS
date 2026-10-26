/* ===============================================================
   Relevé PE / PI : fond de couleur sur les absences.
   - bleu clair : un code d'absence saisi (CP, RTT, RE, FO…) ou un congé
     validé dans la Validation RH (même sans saisie) ;
   - rose : maladie et accident (ML, MA, AT…).
   Compatible avec les autres scripts du relevé, installés avant ou après.
   Utilisation (à la racine du projet) :  node outils/maj-releve-absences.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("FOND_ABSENCE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const cherche = `background: choisi ? "#fff3c4" : ferme ? "#eceef1" : "#ffffff",`;
if (texte.split(cherche).length !== 2) {
  console.error("✗ Fond des cases introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
texte = texte.replace(
  cherche,
  `// FOND_ABSENCE : absence saisie ou congé validé en bleu clair, maladie / accident en rose
                                      background: choisi
                                        ? "#fff3c4"
                                        : s?.code || conge
                                          ? /^(ML|MA|AT|MP)/i.test(s?.code ?? "")
                                            ? "#fde2e2"
                                            : "#dbe8fd"
                                          : ferme
                                            ? "#eceef1"
                                            : "#ffffff",`
);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Absences en couleur dans le relevé\n\nTerminé.");
