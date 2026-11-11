/* ===============================================================
   MAJ CARTOGRAPHIE - LES TRIGRAMMES AU CLIC (EQUIPE_PEPI_NOMS)

   Graphique « Prestations et bureau d'études » : pour l'administration,
   un clic sur une barre (PE, PI, bureau d'études) affiche dessous les
   trigrammes du groupe, en pastilles de la couleur de leur niveau ; un
   second clic les masque.

   À installer APRÈS maj-equipe-pepi.mjs.
   À lancer à la racine du projet :   node outils/maj-equipe-pepi-noms.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/effectifs/page.tsx";
const MARQUEUR = "EQUIPE_PEPI_NOMS";

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
if (!t.includes("EQUIPE_PEPI")) echec(`${FICHIER} : installez d’abord maj-equipe-pepi.zip.`);

const R = [
  [
    "état",
    '  const [prestataires, setPrestataires] = useState<Map<string, "PE" | "PI">>(new Map());\n',
    `  const [prestataires, setPrestataires] = useState<Map<string, "PE" | "PI">>(new Map());\n  const [groupeOuvert, setGroupeOuvert] = useState<string | null>(null); // ${MARQUEUR}\n`,
  ],
  [
    "barre cliquable",
    '                        <span\n                          title={estAdmin && g.gens.length > 0 ? g.gens.map((m) => nomPersonne(m)).sort((a, b) => a.localeCompare(b, "fr")).join(", ") : undefined}\n                          style={{ display: "block", width: `${Math.max(10, (g.gens.length / plus) * 100)}%` }}\n                        >',
    `                        <span
                          {...(estAdmin && g.gens.length > 0
                            ? {
                                role: "button",
                                tabIndex: 0,
                                "aria-expanded": groupeOuvert === g.cle,
                                title: groupeOuvert === g.cle ? "Masquer les personnes" : "Voir les personnes",
                                onClick: () => setGroupeOuvert((x) => (x === g.cle ? null : g.cle)),
                                onKeyDown: (e: { key: string }) => (e.key === "Enter" || e.key === " ") && setGroupeOuvert((x) => (x === g.cle ? null : g.cle)),
                              }
                            : {})}
                          style={{ display: "block", width: \`\${Math.max(10, (g.gens.length / plus) * 100)}%\`, cursor: estAdmin && g.gens.length > 0 ? "pointer" : "default", outline: groupeOuvert === g.cle ? \`2px solid \${C.rouge}\` : undefined, borderRadius: 6 }}
                        >`,
  ],
  [
    "liste des personnes",
    '                    ))}\n                  </div>\n                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.gris, marginTop: 12 }}>\n',
    `                    ))}
                  </div>
                  {/* ${MARQUEUR} : les personnes du groupe cliqué (administration seulement) */}
                  {estAdmin &&
                    groupeOuvert &&
                    (() => {
                      const g = groupes.find((x) => x.cle === groupeOuvert);
                      if (!g) return null;
                      return (
                        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#fafbfc", border: \`1px solid \${C.ligne}\` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <strong style={{ fontSize: 14 }}>{g.lib}</strong>
                            <span style={{ fontSize: 12, color: C.gris }}>{g.gens.length} personne{g.gens.length > 1 ? "s" : ""} · visible de l’administration seulement</span>
                            <span style={{ flex: 1 }} />
                            <button type="button" onClick={() => setGroupeOuvert(null)} aria-label="Fermer" style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>
                              ×
                            </button>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {[...g.gens]
                              .sort((a, b) => niveauDe(b.id) - niveauDe(a.id) || nomPersonne(a).localeCompare(nomPersonne(b), "fr"))
                              .map((m) => {
                                const nv = NIVEAUX.find((x) => x.n === niveauDe(m.id)) ?? NIVEAUX[NIVEAUX.length - 1];
                                return (
                                  <span
                                    key={m.id}
                                    title={\`\${\`\${m.prenom ?? ""} \${m.nom ?? ""}\`.trim()} · \${nv.n === 0 ? "niveau non renseigné" : \`N\${nv.n}\`}\`}
                                    style={{ background: nv.couleur, color: nv.n === 3 ? "#ffffff" : "#13361a", borderRadius: 999, padding: "2px 10px", fontSize: 13, fontWeight: 800 }}
                                  >
                                    {nomPersonne(m)}
                                  </span>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })()}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.gris, marginTop: 12 }}>
`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ un clic sur une barre affiche les trigrammes du groupe");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
