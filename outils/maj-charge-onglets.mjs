/* ===============================================================
   Charge & pointage : une barre d'onglets commune
   « Par affaire » (app/analyse/pointage) · « Par collaborateur »
   (app/admin/bilans). Composant : components/analyse/OngletsCharge.tsx
   Utilisation (à la racine du projet) :  node outils/maj-charge-onglets.mjs
   Le script vérifie tout avant d'écrire ; copies .bak gardées.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (!existsSync("components/analyse/OngletsCharge.tsx")) {
  console.error("✗ Décompressez d'abord le zip à la racine du projet (OngletsCharge.tsx manque).");
  process.exit(1);
}

const travaux = [
  {
    fichier: "app/analyse/pointage/page.tsx",
    actif: "affaires",
    importApres: 'import GardeAcces from "@/components/GardeAcces";',
    ancre: '<EnTetePage section="Analyse technique" />',
    remplace: '<EnTetePage section="Analyse technique" />\n      <OngletsCharge actif="affaires" />',
  },
  {
    fichier: "app/admin/bilans/page.tsx",
    actif: "collaborateurs",
    importApres: 'import GardeAcces from "@/components/GardeAcces";',
    ancre: '<EnTetePage section="Bilans & pilotage" />\n\n      <main style={styles.main}>',
    remplace: '<EnTetePage section="Bilans & pilotage" />\n      <OngletsCharge actif="collaborateurs" />\n\n      <main style={styles.main}>',
  },
];

let erreurs = 0;
const resultats = [];
for (const t of travaux) {
  if (!existsSync(t.fichier)) {
    console.error(`✗ Fichier introuvable : ${t.fichier}`);
    erreurs++;
    continue;
  }
  const original = readFileSync(t.fichier, "utf8").replace(/\r\n/g, "\n");
  if (original.includes("OngletsCharge")) {
    console.log(`✓ ${t.fichier} : déjà à jour`);
    continue;
  }
  let texte = original;
  if (texte.split(t.importApres).length - 1 !== 1) {
    console.error(`✗ ${t.fichier} : ligne d'import de GardeAcces introuvable`);
    erreurs++;
    continue;
  }
  texte = texte.replace(t.importApres, `${t.importApres}\nimport OngletsCharge from "@/components/analyse/OngletsCharge";`);
  const nb = texte.split(t.ancre).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${t.fichier} : en-tête de la page trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(t.ancre, t.remplace);
  resultats.push({ fichier: t.fichier, original, texte });
  console.log(`✓ ${t.fichier} : onglets ajoutés`);
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const r of resultats) {
  writeFileSync(`${r.fichier}.bak`, r.original, "utf8");
  writeFileSync(r.fichier, r.texte, "utf8");
}
console.log("\nTerminé : Charge & pointage, par affaire et par collaborateur.");
