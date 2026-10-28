/* ===============================================================
   Synchronisation du Suivi d'affaire : périmètre élargi aux devis ouverts
   depuis le 01/11/2023 (au lieu du 01/11/2024), pour que les affaires plus
   anciennes livrées en 2024-2025 entrent dans Finances et la Facturation.
   Fichiers : lib/suiviAffaires.ts (aperçu de la page Synchronisation),
   supabase/functions/synchroniser-suivi-affaires/index.ts (copie de la
   fonction, à redéployer dans Supabase), et le message de la page.
   Utilisation (à la racine du projet) :  node outils/maj-perimetre-2023.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichiers = [
  ["lib/suiviAffaires.ts", 'const dateMin = options.dateMin ?? "2024-11-01";', 'const dateMin = options.dateMin ?? "2023-11-01"; // PERIMETRE_2023'],
  ["supabase/functions/synchroniser-suivi-affaires/index.ts", 'const dateMin = options.dateMin ?? "2024-11-01";', 'const dateMin = options.dateMin ?? "2023-11-01"; // PERIMETRE_2023'],
  ["app/admin/synchro-suivi-affaires/page.tsx", "ligne(s) antérieures au 01/11/2024 ne sont pas reprises.", "ligne(s) antérieures au 01/11/2023 ne sont pas reprises."],
];
let erreurs = 0;
const resultats = [];
for (const [chemin, cherche, remplace] of fichiers) {
  if (!existsSync(chemin)) {
    console.error(`✗ Fichier introuvable : ${chemin}`);
    erreurs++;
    continue;
  }
  const texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
  if (texte.includes("PERIMETRE_2023") || texte.includes("antérieures au 01/11/2023")) {
    console.log(`✓ ${chemin} : déjà à jour`);
    continue;
  }
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${chemin} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  resultats.push([chemin, texte.replace(cherche, remplace)]);
  console.log(`✓ ${chemin}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [chemin, texte] of resultats) writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : périmètre élargi au 01/11/2023 (pensez à redéployer la fonction dans Supabase).");
