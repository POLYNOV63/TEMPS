/* ===============================================================
   Indicateurs commerciaux : sous le délai de réponse, la part des devis
   envoyés le jour même de leur ouverture (« 43 % envoyés le jour même »).
   Fichiers : lib/indicateurs.ts et app/pilotage/indicateurs/page.tsx
   Utilisation (à la racine du projet) :  node outils/maj-delai-jour-meme.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichiers = { lib: "lib/indicateurs.ts", page: "app/pilotage/indicateurs/page.tsx" };
for (const f of Object.values(fichiers))
  if (!existsSync(f)) {
    console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
const textes = Object.fromEntries(Object.entries(fichiers).map(([k, f]) => [k, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));
const originaux = { ...textes };
if (textes.lib.includes("partJourMeme")) {
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

remplacer("lib", "Type : part envoyée le jour même", `  delaiMoyen: number | null;`, `  delaiMoyen: number | null;
  partJourMeme: number | null; // part des devis envoyés le jour de leur ouverture (0 à 1)`);
remplacer(
  "lib",
  "Calcul de la part envoyée le jour même",
  `    delaiMoyen: delais.length ? delais.reduce((t, x) => t + x, 0) / delais.length : null,`,
  `    delaiMoyen: delais.length ? delais.reduce((t, x) => t + x, 0) / delais.length : null,
    partJourMeme: delais.length ? delais.filter((x) => x === 0).length / delais.length : null,`
);
remplacer(
  "page",
  "Affichage sous le délai",
  "sous={`médian, de l’ouverture à l’envoi${s.delaiMoyen !== null ? ` · moyen ${Math.round(s.delaiMoyen)} j` : \"\"}`}",
  "sous={`médian, de l’ouverture à l’envoi${s.delaiMoyen !== null ? ` · moyen ${Math.round(s.delaiMoyen)} j` : \"\"}${s.partJourMeme !== null ? ` · ${Math.round(s.partJourMeme * 100)} % envoyés le jour même` : \"\"}`}"
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [k, f] of Object.entries(fichiers)) {
  writeFileSync(`${f}.bak`, originaux[k], "utf8");
  writeFileSync(f, textes[k], "utf8");
}
console.log("\nTerminé : part des devis envoyés le jour même affichée.");
