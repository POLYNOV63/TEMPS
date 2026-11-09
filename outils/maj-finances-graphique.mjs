/* ===============================================================
   MAJ FINANCES - LE GRAPHIQUE MOIS PAR MOIS EN TÊTE (FINANCES_GRAPHIQUE)

   Onglet « CA de l'exercice » :
   - le graphique « Chiffre d'affaires mois par mois » remonte en tête,
     plus bas (150 px), refait comme la barre : chaque mois découpé par
     activité en nuances de rouge, l'attendu hachuré au-dessus, un trait
     pour l'objectif, et à côté le même mois N-1 (gris) et N-2 (gris clair) ;
   - un clic sur un mois le choisit pour les vignettes (le mois choisi est
     surligné) ; les flèches des vignettes restent ;
   - la barre du mois disparaît : les vignettes sont collées au tableau.

   À installer APRÈS maj-finances-mois-nav.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-graphique.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_GRAPHIQUE";

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
if (!t.includes("FINANCES_MOIS_NAV")) echec(`${FICHIER} : installez d’abord maj-finances-mois-nav.zip (flèches du mois).`);

/* 1. l'ancien graphique est retiré */
const G = "            {/* ---------- graphique 12 mois ---------- */}\n";
if (compter(t, G) !== 1) echec(`${FICHIER} : graphique introuvable.`);
const gi = t.indexOf(G);
const gj = t.indexOf("            </section>\n", gi);
if (gj < 0) echec(`${FICHIER} : fin du graphique introuvable.`);
t = t.slice(0, gi) + t.slice(gj + "            </section>\n".length);

/* 2. la barre n'est plus passée à la trame */
const B = "                barre={blocMois.barre}\n";
if (compter(t, B) !== 1) echec(`${FICHIER} : barre du mois introuvable.`);
t = t.replace(B, "");

/* 3. le nouveau graphique, en tête de l'onglet */
const GRAPHIQUE = `            {/* ${MARQUEUR} : CA mois par mois, par activité, avec N-1 et N-2 ; un clic choisit le mois */}
            {(() => {
              const ROUGES: Record<string, string> = { "Méca": "#8e0000", Calcul: "#b3261e", "Elec / Pneu": "#d9534f", Scan: "#e57f7a", "Négoce": "#efa29d", Autre: "#f4c3bf", "Non ventilé": "#f6d6d3" };
              const anMoins = (m: string, n: number) => \`\${Number(m.slice(0, 4)) - n}\${m.slice(4)}\`;
              const sommeMois = (m: string) => mouvements.filter((x) => x.date.startsWith(m)).reduce((s, x) => s + x.montant, 0);
              const parAct = mois.map((m) => {
                const du = mouvements.filter((x) => x.date.startsWith(m));
                return GROUPES.map((g) => ({ g, v: du.reduce((s, x) => s + x.parGroupe[g], 0) })).filter((x) => x.v > 0.5);
              });
              const n2 = mois.map((m) => sommeMois(anMoins(m, 2)));
              const haut = Math.max(1, ...atterrissage, ...vue.realiseN1, ...n2, ...vue.prevu);
              const auto = Math.max(0, mois.findIndex((m) => m.slice(5, 7) === moisCourant.slice(5, 7)));
              const choisi = moisVu ?? auto;
              const presents = GROUPES.filter((g) => parAct.some((l) => l.some((x) => x.g === g)));
              const pastille = (fond: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: fond, marginRight: 5, verticalAlign: "middle" }} />;
              return (
                <section style={{ ...page.carte, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", marginBottom: 8, fontSize: 12, color: "#3b4046" }}>
                    <h2 style={{ margin: 0, fontSize: 16, marginRight: 8 }}>Chiffre d’affaires mois par mois</h2>
                    {presents.map((g) => (
                      <span key={g}>
                        {pastille(ROUGES[g] ?? "#d9534f")}
                        {g}
                      </span>
                    ))}
                    <span>{pastille("repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 3px,#fbe6e6 3px,#fbe6e6 6px)")}attendu</span>
                    <span>
                      <i style={{ display: "inline-block", width: 14, borderTop: "3px solid #1f2328", marginRight: 5, verticalAlign: "middle" }} />
                      objectif
                    </span>
                    <span>{pastille("#c3c8ce")}N-1</span>
                    <span>{pastille("#e3e6ea")}N-2</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150, borderBottom: \`1px solid \${C.ligne}\` }}>
                    {mois.map((m, i) => {
                      const att = atterrissage[i];
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMoisVu(i)}
                          title={\`\${libMois(m)} : facturé \${euros(vue.realise[i])}\${vue.attendu[i] > 0.5 ? \` + attendu \${euros(vue.attendu[i])}\` : ""}\${vue.prevu[i] > 0 ? \` · objectif \${euros(vue.prevu[i])}\` : ""} · N-1 \${euros(vue.realiseN1[i])} · N-2 \${euros(n2[i])}\\nCliquer pour voir ce mois\`}
                          style={{ all: "unset", cursor: "pointer", flex: 1, height: "100%", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, borderRadius: 4, background: i === choisi ? "#fff1f1" : undefined, outline: i === choisi ? \`1.5px solid \${C.rouge}\` : undefined }}
                        >
                          <div style={{ width: "12%", height: \`\${(n2[i] / haut) * 100}%\`, background: "#e3e6ea", borderRadius: "2px 2px 0 0" }} />
                          <div style={{ width: "18%", height: \`\${(vue.realiseN1[i] / haut) * 100}%\`, background: "#c3c8ce", borderRadius: "2px 2px 0 0" }} />
                          <div style={{ width: "42%", height: \`\${(Math.max(0, att) / haut) * 100}%\`, display: "flex", flexDirection: "column-reverse", borderRadius: "3px 3px 0 0", overflow: "hidden" }}>
                            {parAct[i].map(({ g, v }) => (
                              <div key={g} style={{ height: \`\${att > 0 ? (v / att) * 100 : 0}%\`, background: ROUGES[g] ?? "#d9534f", borderTop: "1px solid #ffffff" }} />
                            ))}
                            {vue.attendu[i] > 0.5 && (
                              <div style={{ height: \`\${att > 0 ? (vue.attendu[i] / att) * 100 : 0}%\`, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 4px,#fbe6e6 4px,#fbe6e6 8px)" }} />
                            )}
                          </div>
                          {vue.prevu[i] > 0 && (
                            <div style={{ position: "absolute", left: "10%", right: "10%", bottom: \`\${(vue.prevu[i] / haut) * 100}%\`, borderTop: "3px solid #1f2328" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {mois.map((m, i) => (
                      <div key={m} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: i === choisi ? 800 : 400, color: i === choisi ? C.rougeFonce : C.gris }}>
                        {libMois(m)}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}

`;
const C_DEBUT = '            {onglet === "CA" && (\n              <>\n';
if (compter(t, C_DEBUT) !== 1) echec(`${FICHIER} : début de l’onglet CA introuvable.`);
t = t.replace(C_DEBUT, () => C_DEBUT + GRAPHIQUE);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ graphique mois par mois en tête, par activité, avec N-1 et N-2 ; un clic choisit le mois");
console.log("✓ barre du mois retirée : vignettes collées au tableau");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
