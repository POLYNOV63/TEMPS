/* ===============================================================
   MAJ FINANCES - GRAPHIQUE PLUS SOBRE (FINANCES_GRAPHIQUE_V2)

   Graphique « Chiffre d'affaires mois par mois » :
   - seulement N-1 (plus de N-2) ;
   - la barre du mois en un seul rouge (réalisé) + l'attendu hachuré ;
     la répartition par activité ne se voit plus qu'au survol.

   À installer APRÈS maj-finances-graphique.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-graphique-v2.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_GRAPHIQUE_V2";

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
if (!t.includes("FINANCES_GRAPHIQUE :")) echec(`${FICHIER} : installez d’abord maj-finances-graphique.zip.`);

const R = [
  ["échelle sans N-2", "const haut = Math.max(1, ...atterrissage, ...vue.realiseN1, ...n2, ...vue.prevu);", `const haut = Math.max(1, ...atterrissage, ...vue.realiseN1, ...vue.prevu); // ${MARQUEUR}`],
  [
    "légende",
    `                    {presents.map((g) => (
                      <span key={g}>
                        {pastille(ROUGES[g] ?? "#d9534f")}
                        {g}
                      </span>
                    ))}
`,
    `                    <span>{pastille("#b3261e")}réalisé</span>
`,
  ],
  ["légende N-2", `                    <span>{pastille("#e3e6ea")}N-2</span>\n`, ""],
  [
    "info-bulle",
    " · N-1 ${euros(vue.realiseN1[i])} · N-2 ${euros(n2[i])}\\nCliquer pour voir ce mois`}",
    " · N-1 ${euros(vue.realiseN1[i])}${parAct[i].length > 0 ? `\\n${parAct[i].map(({ g, v }) => `${g} ${euros(v)}`).join(\" · \")}` : \"\"}\\nCliquer pour voir ce mois`}",
  ],
  ["barre N-2", `                          <div style={{ width: "12%", height: \`\${(n2[i] / haut) * 100}%\`, background: "#e3e6ea", borderRadius: "2px 2px 0 0" }} />\n`, ""],
  ['barre N-1', `<div style={{ width: "18%", height: \`\${(vue.realiseN1[i] / haut) * 100}%\`, background: "#c3c8ce", borderRadius: "2px 2px 0 0" }} />`, `<div style={{ width: "26%", height: \`\${(vue.realiseN1[i] / haut) * 100}%\`, background: "#c3c8ce", borderRadius: "2px 2px 0 0" }} />`],
  ["largeur de la barre du mois", `<div style={{ width: "42%", height:`, `<div style={{ width: "46%", height:`],
  [
    "réalisé d'un seul rouge",
    `                            {parAct[i].map(({ g, v }) => (
                              <div key={g} style={{ height: \`\${att > 0 ? (v / att) * 100 : 0}%\`, background: ROUGES[g] ?? "#d9534f", borderTop: "1px solid #ffffff" }} />
                            ))}
`,
    `                            <div style={{ height: \`\${att > 0 ? (Math.max(0, vue.realise[i]) / att) * 100 : 0}%\`, background: "#b3261e" }} />
`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ graphique : N-1 seulement, réalisé d’un seul rouge, activités au survol");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
