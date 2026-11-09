/* ===============================================================
   MAJ FINANCES - VIGNETTES DU MOIS, PUIS LA BARRE (FINANCES_MOIS_V3)

   Onglet « CA de l'exercice », au-dessus du tableau :
   - une rangée de vignettes : CA facturé du mois (avec achats en rouge,
     hors achats en gris bleuté, dans la même vignette), Encore attendu,
     Objectif ;
   - puis la barre rouge par activité, entre les vignettes et le tableau ;
   - « prévu » devient « Objectif ».

   À installer APRÈS maj-finances-mois-v2.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-mois-v3.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_MOIS_V3";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
const D = "            {/* FINANCES_MOIS_V2 : le mois en cours, juste au-dessus du tableau */}\n";
const F = "            {/* ---------- TRAME_CA_V2 : la trame CA remplace le tableau des 12 mois ---------- */}";
const i = t.indexOf(D);
const j = t.indexOf(F);
if (i < 0 || j < 0 || j < i) echec(`${FICHIER} : installez d’abord maj-finances-mois-v2.zip (le mois en cours).`);

const BLOC = `            {/* ${MARQUEUR} : vignettes du mois, puis la barre, juste au-dessus du tableau */}
            {(() => {
              const k = mois.indexOf(moisCourant);
              const i = k >= 0 ? k : mois[11] < moisCourant ? 11 : 0;
              const duMois = mouvements.filter((x) => x.date.startsWith(mois[i]));
              const attMois = attendus.mouvements.filter((x) => x.date.startsWith(mois[i]));
              const fait = duMois.reduce((s, x) => s + x.montant, 0);
              const achatsFait = duMois.reduce((s, x) => s + x.achats, 0);
              const attenduM = attMois.reduce((s, x) => s + x.montant, 0);
              const achatsAtt = attMois.reduce((s, x) => s + x.achats, 0);
              const objectif = vue.prevu[i];
              const parAct = GROUPES.map((g) => ({ g, v: duMois.reduce((s, x) => s + x.parGroupe[g], 0) })).filter((x) => x.v > 0.5);
              const echelle = Math.max(objectif, fait + Math.max(0, attenduM), 1);
              const ROUGES: Record<string, string> = {
                "Méca": "#8e0000",
                Calcul: "#b3261e",
                "Elec / Pneu": "#d9534f",
                Scan: "#e57f7a",
                "Négoce": "#efa29d",
                Autre: "#f4c3bf",
                "Non ventilé": "#f6d6d3",
              };
              const nomMois = new Date(\`\${mois[i]}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
              const etiquette: CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris };
              const vignette: CSSProperties = { ...page.carte, padding: "12px 16px", minWidth: 0 };
              const pastille = (fond: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: fond, marginRight: 5, verticalAlign: "middle" }} />;
              return (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
                    <div style={{ ...vignette, flex: "2 1 360px", borderTop: \`4px solid \${C.rouge}\` }}>
                      <div style={etiquette}>
                        CA facturé · <span style={{ textTransform: "capitalize" }}>{nomMois}</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 28px", marginTop: 6 }}>
                        <span>
                          <strong style={{ fontSize: 26, color: "#b3261e" }}>{euros(fait)}</strong> <span style={{ fontSize: 13, color: C.gris }}>avec achats</span>
                        </span>
                        <span title="CA facturé moins les achats revendus (négoce, sous-traitance)">
                          <strong style={{ fontSize: 26, color: "#5d6b78" }}>{euros(fait - achatsFait)}</strong> <span style={{ fontSize: 13, color: C.gris }}>hors achats</span>
                        </span>
                      </div>
                    </div>
                    <div style={{ ...vignette, flex: "1 1 200px" }}>
                      <div style={etiquette}>Encore attendu</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{euros(attenduM)}</div>
                      {achatsAtt > 0.5 && <div style={{ fontSize: 12, color: C.gris }}>{euros(attenduM - achatsAtt)} hors achats</div>}
                    </div>
                    <div style={{ ...vignette, flex: "1 1 200px" }}>
                      <div style={etiquette}>Objectif</div>
                      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{objectif > 0 ? euros(objectif) : "—"}</div>
                      {objectif > 0 && (
                        <div style={{ fontSize: 12, color: C.gris }}>
                          facturé + attendu : {Math.round(((fait + attenduM) / objectif) * 100)} %
                        </div>
                      )}
                    </div>
                  </div>
                  <section style={{ ...page.carte, padding: "12px 16px", marginBottom: 12 }}>
                    <div style={{ position: "relative", height: 28, background: "#f3f4f6", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                      {parAct.map(({ g, v }) => (
                        <div key={g} title={\`\${g} : \${euros(v)}\`} style={{ width: \`\${(v / echelle) * 100}%\`, background: ROUGES[g] ?? "#d9534f", borderRight: "1px solid #ffffff" }} />
                      ))}
                      {attenduM > 0.5 && (
                        <div
                          title={\`Encore attendu : \${euros(attenduM)}\`}
                          style={{ width: \`\${(attenduM / echelle) * 100}%\`, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 5px,#fbe6e6 5px,#fbe6e6 10px)" }}
                        />
                      )}
                      {objectif > 0 && (
                        <div title={\`Objectif : \${euros(objectif)}\`} style={{ position: "absolute", left: \`calc(\${(objectif / echelle) * 100}% - 1.5px)\`, top: 0, bottom: 0, width: 3, background: "#1f2328" }} />
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5, marginTop: 8, color: "#3b4046" }}>
                      {parAct.map(({ g, v }) => (
                        <span key={g}>
                          {pastille(ROUGES[g] ?? "#d9534f")}
                          {g} <strong>{keuros(v)}</strong>
                        </span>
                      ))}
                      {attenduM > 0.5 && (
                        <span>
                          {pastille("repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 3px,#fbe6e6 3px,#fbe6e6 6px)")}
                          attendu <strong>{keuros(attenduM)}</strong>
                        </span>
                      )}
                      {objectif > 0 && (
                        <span>
                          <i style={{ display: "inline-block", width: 3, height: 12, background: "#1f2328", marginRight: 6, verticalAlign: "middle" }} />
                          objectif
                        </span>
                      )}
                    </div>
                  </section>
                </>
              );
            })()}

`;
t = t.slice(0, i) + BLOC + t.slice(j);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ vignettes du mois (CA avec et hors achats, attendu, objectif), puis la barre, puis le tableau");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
