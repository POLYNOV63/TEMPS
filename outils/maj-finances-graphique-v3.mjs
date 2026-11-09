/* ===============================================================
   MAJ FINANCES - GRAPHIQUE PAR ACTIVITÉ, COULEURS DES INDICATEURS
   (FINANCES_GRAPHIQUE_V3)

   Graphique « Chiffre d'affaires mois par mois » : le réalisé de chaque
   mois est de nouveau découpé par activité, avec les couleurs des
   Indicateurs commerciaux (Méca rouge, Calcul violet, Elec / Pneu bleu,
   Scan orange, Négoce brun, Non ventilé gris) ; N-1 seulement.

   À installer APRÈS maj-finances-graphique-v2.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-graphique-v3.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_GRAPHIQUE_V3";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
if (!t.includes("FINANCES_GRAPHIQUE_V2")) echec(`${FICHIER} : installez d’abord maj-finances-graphique-v2.zip.`);

const R = [
  [
    "couleurs",
    'const ROUGES: Record<string, string> = { "Méca": "#8e0000", Calcul: "#b3261e", "Elec / Pneu": "#d9534f", Scan: "#e57f7a", "Négoce": "#efa29d", Autre: "#f4c3bf", "Non ventilé": "#f6d6d3" };\n              const anMoins',
    `// ${MARQUEUR} : couleurs des activités des Indicateurs commerciaux
              const ROUGES: Record<string, string> = { "Méca": "#c00000", Calcul: "#6b58a8", "Elec / Pneu": "#34506b", Scan: "#e08a1e", "Négoce": "#8d6e63", Autre: "#9aa0a6", "Non ventilé": "#9aa0a6" };
              const anMoins`,
  ],
  [
    "légende",
    '                    <span>{pastille("#b3261e")}réalisé</span>\n',
    `                    {presents.map((g) => (
                      <span key={g}>
                        {pastille(ROUGES[g] ?? "#9aa0a6")}
                        {g}
                      </span>
                    ))}
`,
  ],
  [
    "réalisé par activité",
    '                            <div style={{ height: `${att > 0 ? (Math.max(0, vue.realise[i]) / att) * 100 : 0}%`, background: "#b3261e" }} />\n',
    `                            {parAct[i].map(({ g, v }) => (
                              <div key={g} style={{ height: \`\${att > 0 ? (v / att) * 100 : 0}%\`, background: ROUGES[g] ?? "#9aa0a6", borderTop: "1px solid #ffffff" }} />
                            ))}
`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ graphique : réalisé par activité, couleurs des Indicateurs commerciaux");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
