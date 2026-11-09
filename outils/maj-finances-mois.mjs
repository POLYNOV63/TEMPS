/* ===============================================================
   MAJ FINANCES - LE MOIS EN COURS, LE TABLEAU PLUS HAUT (FINANCES_MOIS)

   Onglet « CA de l'exercice » :
   - les vignettes Réalisé / Attendu / Atterrissage disparaissent ;
   - à leur place, une seule ligne sur le MOIS EN COURS : déjà facturé,
     encore attendu, prévu, avec une barre (sans comparaison à N-1) ;
   - la trame CA (le tableau) remonte juste dessous ; le graphique des
     12 mois passe sous le tableau.

   À installer APRÈS maj-finances-onglets.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-mois.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_MOIS";

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
if (!t.includes("FINANCES_ONGLETS")) echec(`${FICHIER} : installez d’abord maj-finances-onglets.zip (les deux onglets).`);

/* 1. les vignettes du CA disparaissent */
const V_DEBUT = '              {onglet === "CA" && (\n                <>\n';
const V_FIN = "                </>\n              )}\n              {/* VIGNETTES_ALLEGEES";
if (compter(t, V_DEBUT) !== 1 || compter(t, V_FIN) !== 1) echec(`${FICHIER} : vignettes du CA introuvables.`);
{
  const i = t.indexOf(V_DEBUT);
  const j = t.indexOf(V_FIN);
  if (j < i) echec(`${FICHIER} : vignettes dans un ordre inattendu.`);
  t = t.slice(0, i) + "              {/* " + MARQUEUR + " : vignettes du CA retirées (voir le mois en cours) */}\n              {/* VIGNETTES_ALLEGEES" + t.slice(j + V_FIN.length);
}

/* 2. le graphique passe sous la trame */
const G_DEBUT = "            {/* ---------- graphique 12 mois ---------- */}\n";
const G_FIN = "            </section>\n\n            {/* ---------- TRAME_CA_V2 : la trame CA remplace le tableau des 12 mois ---------- */}";
const T_FIN = "              {/* TRAME_CA_V3 : « Remplir le prévisionnel » est dans la trame */}\n            </div>\n";
for (const [nom, a] of [["graphique", G_DEBUT], ["fin du graphique", G_FIN], ["fin de la trame", T_FIN]])
  if (compter(t, a) !== 1) echec(`${FICHIER} : ${nom} introuvable.`);
const gi = t.indexOf(G_DEBUT);
const gj = t.indexOf(G_FIN) + "            </section>\n".length;
const graphique = t.slice(gi, gj);
t = t.slice(0, gi) + t.slice(gj);
t = t.replace(T_FIN, () => `${T_FIN}\n${graphique}`);

/* 3. le mois en cours, en tête de l'onglet */
const MOIS_EN_COURS = `            {/* ${MARQUEUR} : le mois en cours, sans comparaison à N-1 */}
            {(() => {
              const k = mois.indexOf(moisCourant);
              const i = k >= 0 ? k : mois[11] < moisCourant ? 11 : 0;
              const prevuM = vue.prevu[i];
              const fait = vue.realise[i];
              const attenduM = vue.attendu[i];
              const echelle = Math.max(prevuM, fait + attenduM, 1);
              const nomMois = new Date(\`\${mois[i]}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
              return (
                <section style={{ ...page.carte, padding: "12px 16px", marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 20px" }}>
                  <strong style={{ fontSize: 17, textTransform: "capitalize" }}>{nomMois}</strong>
                  <span>
                    déjà facturé <strong>{euros(fait)}</strong>
                  </span>
                  <span>
                    encore attendu <strong>{euros(attenduM)}</strong>
                  </span>
                  <span>
                    prévu <strong>{prevuM > 0 ? euros(prevuM) : "—"}</strong>
                  </span>
                  <div
                    title={\`Facturé \${euros(fait)} · attendu \${euros(attenduM)}\${prevuM > 0 ? \` · prévu \${euros(prevuM)}\` : ""}\`}
                    style={{ flex: "1 1 260px", position: "relative", height: 14, background: "#eef0f3", borderRadius: 7, overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: \`\${(fait / echelle) * 100}%\`, background: "#34506b" }} />
                    <div
                      style={{
                        position: "absolute",
                        left: \`\${(fait / echelle) * 100}%\`,
                        top: 0,
                        bottom: 0,
                        width: \`\${(attenduM / echelle) * 100}%\`,
                        background: "repeating-linear-gradient(45deg,#9fb6cf,#9fb6cf 4px,#dbe5f0 4px,#dbe5f0 8px)",
                      }}
                    />
                    {prevuM > 0 && <div style={{ position: "absolute", left: \`calc(\${(prevuM / echelle) * 100}% - 1px)\`, top: 0, bottom: 0, width: 2, background: "#1f2328" }} />}
                  </div>
                </section>
              );
            })()}

`;
const C_DEBUT = '            {onglet === "CA" && (\n              <>\n';
if (compter(t, C_DEBUT) !== 1) echec(`${FICHIER} : début de l’onglet CA introuvable.`);
t = t.replace(C_DEBUT, () => C_DEBUT + MOIS_EN_COURS);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ vignettes du CA retirées");
console.log("✓ le mois en cours : déjà facturé, encore attendu, prévu");
console.log("✓ la trame CA juste dessous, le graphique sous la trame");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
