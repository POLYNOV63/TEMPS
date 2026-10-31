/* ===============================================================
   Liens croisés : un bouton « Finances → » dans la Facturation du mois,
   et un bouton « Facturation du mois → » dans Finances.
   Utilisation (à la racine du projet) :  node outils/maj-liens-finances-facturation.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function modifier(chemin, changements, marqueur) {
  if (!existsSync(chemin)) {
    console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
  if (texte.includes(marqueur)) {
    console.log(`✓ ${chemin} : déjà à jour`);
    return null;
  }
  for (const [nom, cherche, remplace] of changements) {
    if (cherche === null) continue;
    const nb = texte.split(cherche).length - 1;
    if (nb !== 1) {
      console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1). Rien n'a été modifié. Copiez ce message à Claude.`);
      process.exit(1);
    }
    texte = texte.replace(cherche, () => remplace);
    console.log(`✓ ${nom}`);
  }
  return texte;
}

const bouton = (href, libelle, titre) =>
  `<Link href="${href}" title="${titre}" style={{ ...page.btnSecondaire, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>\n              ${libelle}\n            </Link>\n            `;

// Facturation -> Finances
const f1 = "app/analyse/facturation/page.tsx";
const t1 = modifier(
  f1,
  [
    [
      "Facturation : bouton vers Finances",
      `<button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>`,
      `{/* LIEN_FINANCES */}\n            ${bouton("/analyse/finances", "Finances →", "Le chiffre d’affaires de l’exercice, mois par mois")}<button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>`,
    ],
  ],
  "LIEN_FINANCES"
);

// Finances -> Facturation
const f2 = "app/analyse/finances/page.tsx";
let t2 = existsSync(f2) ? readFileSync(f2, "utf8").replace(/\r\n/g, "\n") : "";
const importLink = t2.includes(`import Link from "next/link";`) ? null : `import EnTetePage from "@/components/EnTetePage";`;
t2 = modifier(
  f2,
  [
    ["Finances : import du lien", importLink, `import Link from "next/link";\nimport EnTetePage from "@/components/EnTetePage";`],
    [
      "Finances : bouton vers la Facturation",
      `<button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>`,
      `{/* LIEN_FACTURATION */}\n            ${bouton("/analyse/facturation", "Facturation du mois →", "Le point de fin de mois avec la comptabilité")}<button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">◀</button>`,
    ],
  ],
  "LIEN_FACTURATION"
);

if (t1 !== null) writeFileSync(f1, t1, "utf8");
if (t2 !== null) writeFileSync(f2, t2, "utf8");
console.log("\nTerminé : Finances et Facturation reliées.");
