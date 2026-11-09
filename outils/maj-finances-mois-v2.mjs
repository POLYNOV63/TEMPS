/* ===============================================================
   MAJ FINANCES - LE MOIS EN COURS, EN VALEUR (FINANCES_MOIS_V2)

   Onglet « CA de l'exercice », juste au-dessus du tableau :
   - le CA facturé du mois et le même HORS ACHATS, côte à côte, en deux
     couleurs (rouge et gris bleuté) ;
   - l'attendu et le prévu du mois ;
   - une barre rouge, plus haute, découpée par activité (nuances de rouge),
     puis l'attendu hachuré, et un trait pour le prévu ; légende chiffrée.

   À installer APRÈS maj-finances-mois.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-mois-v2.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_MOIS_V2";

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

/* 1. l'ancienne ligne du mois est retirée */
const D = "            {/* FINANCES_MOIS : le mois en cours, sans comparaison à N-1 */}\n";
if (compter(t, D) !== 1) echec(`${FICHIER} : installez d’abord maj-finances-mois.zip (ligne du mois en cours).`);
const i = t.indexOf(D);
const FIN = "            })()}\n\n";
const j = t.indexOf(FIN, i);
if (j < 0) echec(`${FICHIER} : fin de la ligne du mois introuvable.`);
t = t.slice(0, i) + t.slice(j + FIN.length);

/* 2. la nouvelle, juste au-dessus du tableau */
const BLOC = `            {/* ${MARQUEUR} : le mois en cours, juste au-dessus du tableau */}
            {(() => {
              const k = mois.indexOf(moisCourant);
              const i = k >= 0 ? k : mois[11] < moisCourant ? 11 : 0;
              const duMois = mouvements.filter((x) => x.date.startsWith(mois[i]));
              const attMois = attendus.mouvements.filter((x) => x.date.startsWith(mois[i]));
              const fait = duMois.reduce((s, x) => s + x.montant, 0);
              const achatsFait = duMois.reduce((s, x) => s + x.achats, 0);
              const attenduM = attMois.reduce((s, x) => s + x.montant, 0);
              const achatsAtt = attMois.reduce((s, x) => s + x.achats, 0);
              const prevuM = vue.prevu[i];
              const parAct = GROUPES.map((g) => ({ g, v: duMois.reduce((s, x) => s + x.parGroupe[g], 0) })).filter((x) => x.v > 0.5);
              const echelle = Math.max(prevuM, fait + Math.max(0, attenduM), 1);
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
              const pastille = (fond: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: fond, marginRight: 5, verticalAlign: "middle" }} />;
              return (
                <section style={{ ...page.carte, padding: "14px 18px", marginBottom: 12, borderLeft: \`5px solid \${C.rouge}\` }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 26px", marginBottom: 10 }}>
                    <strong style={{ fontSize: 19, textTransform: "capitalize", color: C.rougeFonce }}>{nomMois}</strong>
                    <span style={{ fontSize: 15 }}>
                      CA facturé <strong style={{ fontSize: 21, color: "#b3261e" }}>{euros(fait)}</strong>
                    </span>
                    <span style={{ fontSize: 15 }} title="CA facturé moins les achats revendus (négoce, sous-traitance)">
                      hors achats <strong style={{ fontSize: 21, color: "#5d6b78" }}>{euros(fait - achatsFait)}</strong>
                    </span>
                    <span style={{ fontSize: 14, color: C.gris }}>
                      encore attendu <strong style={{ color: "#3b4046" }}>{euros(attenduM)}</strong>
                      {achatsAtt > 0.5 ? \` (\${euros(attenduM - achatsAtt)} hors achats)\` : ""}
                    </span>
                    <span style={{ fontSize: 14, color: C.gris }}>
                      prévu <strong style={{ color: "#3b4046" }}>{prevuM > 0 ? euros(prevuM) : "—"}</strong>
                    </span>
                  </div>
                  <div style={{ position: "relative", height: 26, background: "#f3f4f6", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                    {parAct.map(({ g, v }) => (
                      <div key={g} title={\`\${g} : \${euros(v)}\`} style={{ width: \`\${(v / echelle) * 100}%\`, background: ROUGES[g] ?? "#d9534f", borderRight: "1px solid #ffffff" }} />
                    ))}
                    {attenduM > 0.5 && (
                      <div
                        title={\`Encore attendu : \${euros(attenduM)}\`}
                        style={{ width: \`\${(attenduM / echelle) * 100}%\`, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 5px,#fbe6e6 5px,#fbe6e6 10px)" }}
                      />
                    )}
                    {prevuM > 0 && (
                      <div title={\`Prévu : \${euros(prevuM)}\`} style={{ position: "absolute", left: \`calc(\${(prevuM / echelle) * 100}% - 1.5px)\`, top: 0, bottom: 0, width: 3, background: "#1f2328" }} />
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
                    {prevuM > 0 && (
                      <span>
                        <i style={{ display: "inline-block", width: 3, height: 12, background: "#1f2328", marginRight: 6, verticalAlign: "middle" }} />
                        prévu
                      </span>
                    )}
                  </div>
                </section>
              );
            })()}

`;
const TRAME = "            {/* ---------- TRAME_CA_V2 : la trame CA remplace le tableau des 12 mois ---------- */}";
if (compter(t, TRAME) !== 1) echec(`${FICHIER} : tableau (trame CA) introuvable.`);
t = t.replace(TRAME, () => BLOC + TRAME);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ le mois en cours juste au-dessus du tableau : CA facturé et hors achats, barre par activité");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
