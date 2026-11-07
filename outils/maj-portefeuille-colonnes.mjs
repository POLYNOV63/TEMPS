/* ===============================================================
   MAJ PORTEFEUILLE - « RÉALISÉ / CHIFFRÉ » ET TOLÉRANCE (PORTEFEUILLE_V2)

   - Chiffré et Réalisé regroupés en une colonne « Réalisé / Chiffré »,
     plus large, avec une barre bien visible et le % (tri sur le %) ;
   - colonne « Reste » supprimée (doublon de « À affecter ») ;
   - même tolérance que le planning (6 h au plus, sans dépasser 10 % du
     chiffré) : plus de « 0,3 h non affectées », ni dans l'état, ni dans
     les alertes ; « À affecter » reste affiché, en gris dans la tolérance.

   Fichiers : app/pilotage/page.tsx et lib/pilotageCalculs.ts
   À lancer à la racine du projet :   node outils/maj-portefeuille-colonnes.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "PORTEFEUILLE_V2";
const PAGE = "app/pilotage/page.tsx";
const CALCULS = "lib/pilotageCalculs.ts";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
for (const f of [PAGE, CALCULS]) if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);

let calc = readFileSync(CALCULS, "utf8").replace(/\r\n/g, "\n");
let page = readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n");
const ecritures = [];

/* ---------- lib/pilotageCalculs.ts : tolérance ---------- */
if (calc.includes("TOLERANCE_AFFECTATION")) console.log(`✓ ${CALCULS} : déjà à jour`);
else {
  const r = [
    [
      "export function etatAffaire(",
      "/* TOLERANCE_AFFECTATION : comme au planning, pas d'alerte pour quelques heures non affectées :\n" +
        "   6 h au plus, sans dépasser 10 % du chiffré */\n" +
        "export function toleranceAffectation(chiffre: number): number {\n" +
        "  return Math.min(6, 0.1 * Math.max(0, chiffre));\n" +
        "}\n\n" +
        "export function etatAffaire(",
    ],
    ["      if (nonAffecte > 0.01) {", "      if (nonAffecte > toleranceAffectation(t.chiffre)) {"],
  ];
  for (const [a] of r) if (compter(calc, a) !== 1) echec(`${CALCULS} : « ${a.trim().slice(0, 50)} » trouvé ${compter(calc, a)} fois (attendu : 1).`);
  for (const [a, b] of r) calc = calc.replace(a, () => b);
  ecritures.push([CALCULS, calc, "tolérance des heures non affectées"]);
}

/* ---------- app/pilotage/page.tsx ---------- */
if (page.includes(MARQUEUR)) console.log(`✓ ${PAGE} : déjà à jour`);
else {
  const r = [
    ["import", "  totauxAffaire,\n  type Collab,", "  toleranceAffectation,\n  totauxAffaire,\n  type Collab,"],
    [
      "tri sur le % consommé",
      '          case "realise": return l.totaux.realise;',
      '          // PORTEFEUILLE_V2 : tri sur le % du chiffré consommé\n          case "realise": {\n            const ch = l.famille ? l.famille.chiffre : l.totaux.chiffre;\n            return l.dansFamille ? -2 : ch > 0 ? l.totaux.realise / ch : -1;\n          }',
    ],
    [
      "titres de colonnes",
      '            <EnTeteTri col="chiffre" libelle="Chiffré" num />\n            <EnTeteTri col="realise" libelle="Réalisé" centre />\n            <EnTeteTri col="reste" libelle="Reste" num />',
      '            <EnTeteTri col="realise" libelle="Réalisé / Chiffré" centre />',
    ],
    ["nombre de colonnes", "    const nbColonnes = 10;", "    const nbColonnes = 8;"],
    [
      "« À affecter » : tolérance",
      "                    ) : aAffecter > 0.01 ? (\n                      <strong style={{ color: C.orangeTexte }}>{formatHeures(aAffecter)}</strong>\n                    ) : (\n                      gris(\"0 h\")\n                    )}",
      "                    ) : aAffecter > toleranceAffectation(l.famille ? l.famille.chiffre : totaux.chiffre) ? (\n                      <strong style={{ color: C.orangeTexte }}>{formatHeures(aAffecter)}</strong>\n                    ) : (\n                      <span title=\"Dans la tolérance (6 h au plus, 10 % du chiffré au plus) : pas d’alerte\">{gris(aAffecter > 0.01 ? formatHeures(aAffecter) : \"0 h\")}</span>\n                    )}",
    ],
  ];
  for (const [nom, a] of r) if (compter(page, a) !== 1) echec(`${PAGE} : passage « ${nom} » trouvé ${compter(page, a)} fois (attendu : 1).`);
  for (const [, a, b] of r) page = page.replace(a, () => b);

  // les trois cellules Chiffré, Réalisé, Reste -> une seule
  const DEBUT = "                  <td style={tdNum}>\n                    {l.famille ? (\n";
  const FIN = "                  <td style={tdNum}>\n                    {!planningActif || totaux.chiffre <= 0";
  if (compter(page, DEBUT) !== 1 || compter(page, FIN) !== 1) echec(`${PAGE} : cellules Chiffré / Réalisé / Reste introuvables.`);
  const i = page.indexOf(DEBUT);
  const j = page.indexOf(FIN);
  if (j < i) echec(`${PAGE} : cellules dans un ordre inattendu.`);
  const CELLULE = `                  {/* PORTEFEUILLE_V2 : réalisé / chiffré, en une colonne, avec la barre */}
                  <td style={{ ...tdNum, minWidth: 190, textAlign: "center" }}>
                    {l.dansFamille ? (
                      <span title="Les heures sont pointées sur la commande de base : le réalisé de toute la famille y est affiché">
                        {gris(\`dans \${l.dansFamille}\`)}
                        <div style={petit}>chiffré {totaux.chiffre > 0 ? formatHeures(totaux.chiffre) : "—"}</div>
                      </span>
                    ) : (
                      (() => {
                        const ch = l.famille ? l.famille.chiffre : totaux.chiffre;
                        if (ch <= 0) return totaux.realise > 0 ? <span>{formatHeures(totaux.realise)} {gris("/ —")}</span> : gris("—");
                        const r = totaux.realise / ch;
                        const couleur = r > 1.0001 ? "#c62828" : r > 0.9 ? "#e08a00" : "#2e7d32";
                        const detail = l.famille ? (l.famille.detail ?? []).map((d) => \`\${d.numero} : \${formatHeures(d.chiffre)}\`).join("\\n") : "";
                        return (
                          <div title={\`Réalisé \${formatHeures(totaux.realise)} sur \${formatHeures(ch)} chiffrées (\${Math.round(r * 100)} %) · reste \${formatHeures(totaux.reste)}\${detail ? \`\\n\${detail}\` : ""}\`}>
                            <div>
                              <strong>{formatHeures(totaux.realise)}</strong> <span style={{ color: C.gris }}>/ {formatHeures(ch)}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <span style={{ flex: 1, height: 8, background: "#eceef1", borderRadius: 4, overflow: "hidden", display: "inline-block" }}>
                                <span style={{ display: "block", width: \`\${Math.min(100, r * 100)}%\`, height: "100%", background: couleur }} />
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 800, minWidth: 36, textAlign: "right", color: r > 1.0001 ? C.rougeTexte : C.gris }}>{Math.round(r * 100)} %</span>
                            </div>
                            {l.famille && <div style={petit}>famille · {l.famille.numeros.length} commandes</div>}
                          </div>
                        );
                      })()
                    )}
                  </td>
`;
  page = page.slice(0, i) + CELLULE + page.slice(j);
  ecritures.push([PAGE, page, "colonne Réalisé / Chiffré, colonne Reste retirée, tolérance"]);
}

for (const [f, t, quoi] of ecritures) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : ${quoi}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
