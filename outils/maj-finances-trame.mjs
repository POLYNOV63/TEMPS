/* ===============================================================
   MAJ FINANCES - TRAME CA ALLÉGÉE, BARRE DANS LA TRAME (FINANCES_TRAME)

   components/finances/TrameCA.tsx :
   - plus de titre « Trame CA — exercice… » ni de phrase d'explication ;
   - l'attendu est toujours affiché (plus de case à cocher) ;
   - « Afficher les % » : le pourcentage s'écrit sous chaque montant, dans
     la même case (plus de colonnes en plus) ;
   - vignettes : celles du mois (CA facturé avec / hors achats, encore
     attendu), « Total CA en cours », et une seule vignette « Écart CA /
     objectif » avec et hors achats, en deux couleurs ;
   - la barre rouge du mois (par activité) entre les vignettes et le
     tableau.
   app/analyse/finances/page.tsx : les vignettes et la barre du mois sont
   passées à la trame (plus de bloc séparé au-dessus).

   À installer APRÈS maj-finances-mois-v3.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-trame.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "FINANCES_TRAME";
const TRAME = "components/finances/TrameCA.tsx";
const PAGE = "app/analyse/finances/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};
const appliquer = (f, t, R) => {
  for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${f} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
  for (const [, a, b] of R) t = t.replace(a, () => b);
  return t;
};

/* =================== 1. TrameCA =================== */
let tr = lire(TRAME);
const trDeja = tr.includes(MARQUEUR);
if (!trDeja) {
  tr = appliquer(TRAME, tr, [
    ["import", 'import { useEffect, useMemo, useState, type CSSProperties } from "react";', 'import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";'],
    [
      "propriétés",
      "  onAjustementsModifies?: (liste: { mois: string; montant: number; motif: string }[]) => void;\n}) {",
      `  onAjustementsModifies?: (liste: { mois: string; montant: number; motif: string }[]) => void;\n  vignettes?: ReactNode; // ${MARQUEUR} : vignettes du mois, fournies par la page\n  barre?: ReactNode; // la barre du mois, entre les vignettes et le tableau\n}) {`,
    ],
    ["attendu toujours affiché", "  const [voirAttendu, setVoirAttendu] = useState(true);", "  const voirAttendu = true; // l'attendu est toujours affiché"],
    ["nombre de colonnes", "  const nbCol = 1 + (mois.length + 1) * (afficherPct ? 2 : 1) + 1;", "  const nbCol = 1 + mois.length + 1 + 1;"],
    [
      "% sous le montant du mois",
      "              {voirAttendu && l.attendu && Math.abs(l.attendu[i]) >= 0.5 && <div style={styleAttendu} title=\"Attendu : pas encore livré ou facturé\">+ {nombre(l.attendu[i])}</div>}\n            </td>,\n            afficherPct ? <td key={`p${i}`} style={tdPct}>{part(v, l.base?.[i])}</td> : null,\n          ])}",
      "              {voirAttendu && l.attendu && Math.abs(l.attendu[i]) >= 0.5 && <div style={styleAttendu} title=\"Attendu : pas encore livré ou facturé\">+ {nombre(l.attendu[i])}</div>}\n              {afficherPct && part(v, l.base?.[i]) && <div style={{ ...tdPct, border: \"none\", padding: 0 }}>{part(v, l.base?.[i])}</div>}\n            </td>,\n          ])}",
    ],
    [
      "% sous le total",
      "              <div style={styleAttendu}>+ {nombre(l.attendu.reduce((t, x) => t + x, 0))}</div>\n            )}\n          </td>\n          {afficherPct && <td style={tdPct}>{part(l.total, l.baseTotal)}</td>}",
      "              <div style={styleAttendu}>+ {nombre(l.attendu.reduce((t, x) => t + x, 0))}</div>\n            )}\n            {afficherPct && part(l.total, l.baseTotal) && <div style={{ ...tdPct, border: \"none\", padding: 0 }}>{part(l.total, l.baseTotal)}</div>}\n          </td>",
    ],
    [
      "en-tête des mois",
      "                  {nomMois(m)} {m.slice(2, 4)}\n                </th>,\n                afficherPct ? <th key={`${m}-p`} style={th}>%</th> : null,\n              ])}",
      "                  {nomMois(m)} {m.slice(2, 4)}\n                </th>,\n              ])}",
    ],
    ["en-tête du total", "              <th style={{ ...th, borderLeft: `2px solid ${C.ligne}` }}>Totaux</th>\n              {afficherPct && <th style={th}>%</th>}", "              <th style={{ ...th, borderLeft: `2px solid ${C.ligne}` }}>Totaux</th>"],
    [
      "titre et cases",
      '        <h2 style={{ margin: 0, fontSize: 17 }}>Trame CA — exercice {exercice}-{exercice + 1}</h2>\n        <span style={{ fontSize: 13, color: C.gris }}>la présentation du classeur « trame_CA », remplie automatiquement</span>\n        <span style={{ flex: 1 }} />\n        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", color: ROUGE_ATTENDU, fontWeight: 600 }}>\n          <input type="checkbox" checked={voirAttendu} onChange={(e) => setVoirAttendu(e.target.checked)} /> Afficher l’attendu\n        </label>\n',
      "        <span style={{ flex: 1 }} />\n",
    ],
    [
      "vignettes",
      `        <Tuile
          libelle="Écart CA / prévi"
          valeur={ecartPrevi === null ? "—" : euros(ecartPrevi)}
          sous={trame.objectif > 0 ? \`prévisionnel annuel \${euros(trame.objectif)}\` : "prévisionnel non saisi"}
          accent={ecartPrevi !== null && ecartPrevi < 0}
        />
        <Tuile
          libelle="Écart CA / prévi avec achats"
          valeur={ecartPrevi === null ? "—" : euros(ecartPrevi - trame.achatsTotal)}
          sous={\`achats sur affaires \${euros(trame.achatsTotal)}\`}
          accent={ecartPrevi !== null && ecartPrevi - trame.achatsTotal < 0}
        />
      </div>
`,
      `        <div style={{ ...page.carte, padding: "12px 16px", flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>Écart CA / objectif</div>
          {ecartPrevi === null ? (
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>—</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 22px", marginTop: 6 }}>
              <span>
                <strong style={{ fontSize: 22, color: "#b3261e" }}>{euros(ecartPrevi)}</strong> <span style={{ fontSize: 12, color: C.gris }}>avec achats</span>
              </span>
              <span>
                <strong style={{ fontSize: 22, color: "#5d6b78" }}>{euros(ecartPrevi - trame.achatsTotal)}</strong> <span style={{ fontSize: 12, color: C.gris }}>hors achats</span>
              </span>
            </div>
          )}
          <div style={{ fontSize: 12, color: C.gris }}>
            {trame.objectif > 0 ? \`objectif annuel \${euros(trame.objectif)}\` : "objectif non saisi"} · achats sur affaires {euros(trame.achatsTotal)}
          </div>
        </div>
      </div>
      {props.barre}
`,
    ],
    ["vignettes du mois en tête", "      <div style={{ display: \"flex\", flexWrap: \"wrap\", gap: 12, marginBottom: 12 }}>\n        <Tuile libelle=\"Total CA en cours\"", "      <div style={{ display: \"flex\", flexWrap: \"wrap\", gap: 12, marginBottom: 12 }}>\n        {props.vignettes}\n        <Tuile libelle=\"Total CA en cours\""],
  ]);
}

/* =================== 2. la page =================== */
let pg = lire(PAGE);
const pgDeja = pg.includes(MARQUEUR);
if (!pgDeja) {
  const D = "            {/* FINANCES_MOIS_V3 : vignettes du mois, puis la barre, juste au-dessus du tableau */}\n";
  const F = "            {/* ---------- TRAME_CA_V2 : la trame CA remplace le tableau des 12 mois ---------- */}";
  const i = pg.indexOf(D);
  const j = pg.indexOf(F);
  if (i < 0 || j < 0 || j < i) echec(`${PAGE} : installez d’abord maj-finances-mois-v3.zip.`);
  pg = pg.slice(0, i) + pg.slice(j);

  const BLOC = `  /* ${MARQUEUR} : vignettes et barre du mois en cours, affichées dans la trame CA */
  const blocMois = (() => {
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
    const ROUGES: Record<string, string> = { "Méca": "#8e0000", Calcul: "#b3261e", "Elec / Pneu": "#d9534f", Scan: "#e57f7a", "Négoce": "#efa29d", Autre: "#f4c3bf", "Non ventilé": "#f6d6d3" };
    const nomDuMois = new Date(\`\${mois[i]}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const etiquette: CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris };
    const vignette: CSSProperties = { ...page.carte, padding: "12px 16px", minWidth: 0 };
    const pastille = (fond: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: fond, marginRight: 5, verticalAlign: "middle" }} />;
    const vignettes = (
      <>
        <div style={{ ...vignette, flex: "2 1 340px", borderTop: \`4px solid \${C.rouge}\` }}>
          <div style={etiquette}>
            CA facturé · <span style={{ textTransform: "capitalize" }}>{nomDuMois}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 26px", marginTop: 6 }}>
            <span>
              <strong style={{ fontSize: 24, color: "#b3261e" }}>{euros(fait)}</strong> <span style={{ fontSize: 12, color: C.gris }}>avec achats</span>
            </span>
            <span title="CA facturé moins les achats revendus (négoce, sous-traitance)">
              <strong style={{ fontSize: 24, color: "#5d6b78" }}>{euros(fait - achatsFait)}</strong> <span style={{ fontSize: 12, color: C.gris }}>hors achats</span>
            </span>
          </div>
        </div>
        <div style={{ ...vignette, flex: "1 1 190px" }}>
          <div style={etiquette}>Encore attendu ce mois</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{euros(attenduM)}</div>
          {achatsAtt > 0.5 && <div style={{ fontSize: 12, color: C.gris }}>{euros(attenduM - achatsAtt)} hors achats</div>}
        </div>
      </>
    );
    const barre = (
      <div style={{ margin: "0 0 14px" }}>
        <div style={{ position: "relative", height: 28, background: "#f3f4f6", borderRadius: 8, overflow: "hidden", display: "flex" }}>
          {parAct.map(({ g, v }) => (
            <div key={g} title={\`\${g} : \${euros(v)}\`} style={{ width: \`\${(v / echelle) * 100}%\`, background: ROUGES[g] ?? "#d9534f", borderRight: "1px solid #ffffff" }} />
          ))}
          {attenduM > 0.5 && (
            <div title={\`Encore attendu : \${euros(attenduM)}\`} style={{ width: \`\${(attenduM / echelle) * 100}%\`, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 5px,#fbe6e6 5px,#fbe6e6 10px)" }} />
          )}
          {objectif > 0 && <div title={\`Objectif : \${euros(objectif)}\`} style={{ position: "absolute", left: \`calc(\${(objectif / echelle) * 100}% - 1.5px)\`, top: 0, bottom: 0, width: 3, background: "#1f2328" }} />}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5, marginTop: 8, color: "#3b4046" }}>
          <strong style={{ textTransform: "capitalize" }}>{nomDuMois} :</strong>
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
              objectif <strong>{keuros(objectif)}</strong>
            </span>
          )}
        </div>
      </div>
    );
    return { vignettes, barre };
  })();

  let cumR = 0;
`;
  pg = appliquer(PAGE, pg, [
    ["calculs du rendu", "  let cumR = 0;\n", BLOC],
    ["trame", "              <TrameCA\n                exercice={exercice}", "              <TrameCA\n                vignettes={blocMois.vignettes}\n                barre={blocMois.barre}\n                exercice={exercice}"],
  ]);
}

if (!trDeja) writeFileSync(TRAME, tr, "utf8"), console.log(`✓ ${TRAME} : titre retiré, attendu toujours affiché, % sous les montants, vignettes et barre`);
else console.log(`✓ ${TRAME} : déjà à jour`);
if (!pgDeja) writeFileSync(PAGE, pg, "utf8"), console.log(`✓ ${PAGE} : vignettes et barre du mois passées à la trame`);
else console.log(`✓ ${PAGE} : déjà à jour`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
