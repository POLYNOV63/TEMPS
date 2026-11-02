/* ===============================================================
   Indicateurs commerciaux : réécrit plus simplement les deux calculs
   « imputation d'une commande (ou de sa commande de base) » que Visual
   Studio Code soulignait en rouge (Top 10 clients, Devis et commandes au
   forfait). Même résultat, sans ambiguïté pour TypeScript.
   Utilisation (à la racine du projet) :  node outils/maj-indicateurs-imputation.mjs
================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function chercher(dossier) {
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) {
      const r = chercher(p);
      if (r) return r;
    } else if (nom === "page.tsx" && readFileSync(p, "utf8").includes("PILOTAGE BE - INDICATEURS")) return p;
  }
  return null;
}
const chemin = chercher("app");
if (!chemin) {
  console.error("✗ Page des indicateurs introuvable dans app/ (lancez le script depuis la racine du projet).");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
const ancienneBase = `const impBase = new Map(lignes.filter((l) => l.genre === "BASE" && l.base_affaire).map((l) => [l.base_affaire as string, l.imputation]));`;
const nouvelleBase = `const impBase = new Map<string, string | null>();
              for (const x of lignes) if (x.genre === "BASE" && x.base_affaire) impBase.set(x.base_affaire, x.imputation);`;
const fonction = (nom) => [
  `const ${nom} = (l: LigneInd) => l.imputation ?? (l.base_affaire ? impBase.get(l.base_affaire) ?? null : null) ?? "Sans imputation";`,
  `const ${nom} = (l: LigneInd): string => {
                if (l.imputation) return l.imputation;
                const b = l.base_affaire ? impBase.get(l.base_affaire) : undefined;
                return b || "Sans imputation";
              };`,
];
let fait = 0;
const nb = texte.split(ancienneBase).length - 1;
if (nb > 0) {
  texte = texte.split(ancienneBase).join(nouvelleBase);
  fait += nb;
}
for (const nom of ["imputationDe", "imp"]) {
  const [ancien, nouveau] = fonction(nom);
  const n = texte.split(ancien).length - 1;
  if (n > 0) {
    texte = texte.split(ancien).join(nouveau);
    fait += n;
  }
}
if (fait === 0) {
  console.log("✓ Rien à corriger (déjà fait, ou passage différent : copiez à Claude le texte du panneau Problèmes).");
  process.exit(0);
}
writeFileSync(chemin, texte, "utf8");
console.log(`✓ ${chemin} : ${fait} passage(s) réécrit(s)\n\nTerminé.`);
