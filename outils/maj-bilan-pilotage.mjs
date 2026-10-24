/* ===============================================================
   Bilan affaire (app/affaires/bilan/page.tsx) : la fiche du Pilotage y
   est intégrée (panneau « Pilotage » : responsable, délai, historique,
   affectations), sous l'en-tête de l'affaire. Le lien « Fiche dans le
   Pilotage » disparaît : il n'y a plus qu'une page par affaire.
   Utilisation (à la racine du projet) :  node outils/maj-bilan-pilotage.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/affaires/bilan/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin}`);
  process.exit(1);
}
if (!existsSync("components/pilotage/PanneauPilotageAffaire.tsx")) {
  console.error("✗ Décompressez d'abord le zip à la racine du projet (PanneauPilotageAffaire.tsx manque).");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("PanneauPilotageAffaire")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "Import du panneau",
  `import BilanFinancierAffaire from "@/components/BilanFinancierAffaire";`,
  `import BilanFinancierAffaire from "@/components/BilanFinancierAffaire";
import PanneauPilotageAffaire from "@/components/pilotage/PanneauPilotageAffaire";`
);
remplacer(
  "Lien vers l'ancienne fiche retiré",
  `                {pilotage && (
                  <Link href={\`/pilotage/affaire/\${pilotage.id}\`} style={{ marginLeft: "auto", fontWeight: 700, color: C.rougeFonce }}>
                    Fiche dans le Pilotage →
                  </Link>
                )}
`,
  ``
);
remplacer(
  "Panneau Pilotage sous l'en-tête",
  `            {lignesExcel.length === 0 && bilan.sourceChiffre === "AUCUN" && (`,
  `            {/* FICHE_FUSIONNEE : responsable, délai et historique, affectations (ancienne fiche du Pilotage) */}
            <PanneauPilotageAffaire type={affaire.type} base={affaire.numero} />

            {lignesExcel.length === 0 && bilan.sourceChiffre === "AUCUN" && (`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : la fiche affaire est intégrée au Bilan affaire.");
