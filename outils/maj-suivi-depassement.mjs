/* ===============================================================
   MAJ SUIVI DES AFFAIRES - COLONNE DÉPASSEMENT (DEPASSEMENT_COLONNE)

   Nouvelle colonne « Dépassement », après « Réalisé / Chiffré » :
   - en gros, le dépassement CONSTATÉ : heures pointées au-delà du chiffré
     (« +42 h (+18 %) »), en rouge ;
   - en petit dessous, le dépassement PRÉVU : pointé + planifié à venir
     au-delà du chiffré (« +55 h prévues »), quand il dit plus ;
   - « — » dans la tolérance habituelle (6 h, 10 % du chiffré au plus),
     sans chiffré, et pour les PE / PI ; une famille (base + avenants) est
     comptée en entier sur sa ligne ;
   - triable (les plus gros dépassements d'abord), et dans l'export Excel.
   Avec un filtre d'activité, seul le constaté de l'activité est donné.

   À lancer à la racine du projet :   node outils/maj-suivi-depassement.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/page.tsx";
const MARQUEUR = "DEPASSEMENT_COLONNE";

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

const CELLULE = `                  {/* ${MARQUEUR} : constaté (pointé − chiffré) et prévu (pointé + planifié − chiffré) */}
                  <td style={tdNum}>
                    {(() => {
                      const prest = affaire.imputation === "PE" || affaire.imputation === "PI";
                      const ch = vl.chiffre;
                      if (l.dansFamille || prest || ch <= 0) return gris("—");
                      const tol = toleranceAffectation(ch);
                      const constate = vl.realise - ch;
                      const baseNum = affaire.numero.match(/^\\d+/)?.[0] ?? "";
                      const planifie = activiteFiltre
                        ? null
                        : l.famille
                          ? lignes.filter((x) => x.affaire.type === "CBE" && (x.affaire.numero.match(/^\\d+/)?.[0] ?? "") === baseNum).reduce((s, x) => s + x.planning.planifie, 0)
                          : planning.planifie;
                      const prevu = planifie === null ? null : vl.realise + planifie - ch;
                      return (
                        <>
                          {constate > tol ? (
                            <strong style={{ color: C.rougeTexte }} title={\`\${formatHeures(vl.realise)} pointées pour \${formatHeures(ch)} chiffrées\`}>
                              +{formatHeures(constate)} <span style={{ fontWeight: 600, fontSize: 12 }}>(+{Math.round((constate / ch) * 100)} %)</span>
                            </strong>
                          ) : (
                            gris("—")
                          )}
                          {prevu !== null && prevu > tol && prevu - Math.max(0, constate) > 0.5 && (
                            <div style={{ ...petit, color: "#b35c00", fontWeight: 700 }} title={\`Pointé \${formatHeures(vl.realise)} + planifié à venir \${formatHeures(planifie ?? 0)}, pour \${formatHeures(ch)} chiffrées\`}>
                              +{formatHeures(prevu)} prévues
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </td>
`;

const R = [
  ["colonne de tri", '| "chiffre" | "realise" | "reste";', '| "chiffre" | "realise" | "reste" | "depassement";'],
  [
    "valeur de tri",
    '          case "reste": return l.totaux.reste;',
    `          case "reste": return l.totaux.reste;
          case "depassement": {
            if (l.dansFamille || l.affaire.imputation === "PE" || l.affaire.imputation === "PI") return -1e9;
            const v = valeursLigne(l);
            return v.chiffre > 0 ? v.realise - v.chiffre : -1e9;
          }`,
  ],
  ["dépendances du tri", "    [tri, collabs]\n  );", "    // eslint-disable-next-line react-hooks/exhaustive-deps\n    [tri, collabs, activiteFiltre, surPeriode]\n  );"],
  [
    "sens du tri",
    "    setTri((t) => (t.col === col ? { col, sens: t.sens === 1 ? -1 : 1 } : { col, sens: 1 }));",
    '    setTri((t) => (t.col === col ? { col, sens: t.sens === 1 ? -1 : 1 } : { col, sens: col === "depassement" ? -1 : 1 }));',
  ],
  ["nombre de colonnes", "    const nbColonnes = bornes ? 9 : 8;", "    const nbColonnes = bornes ? 10 : 9;"],
  ["en-tête", '            <EnTeteTri col="realise" libelle="Réalisé / Chiffré" centre />', '            <EnTeteTri col="realise" libelle="Réalisé / Chiffré" centre />\n            <EnTeteTri col="depassement" libelle="Dépassement" num />'],
  ["cellule", "                  {bornes && (\n                    <td style={tdNum}>{l.dansFamille ? gris(\"—\") : vl.periode", CELLULE + "                  {bornes && (\n                    <td style={tdNum}>{l.dansFamille ? gris(\"—\") : vl.periode"],
  [
    "export",
    '        "Consommé (%)": v.chiffre > 0 ? Math.round((v.realise / v.chiffre) * 100) : "",',
    '        "Consommé (%)": v.chiffre > 0 ? Math.round((v.realise / v.chiffre) * 100) : "",\n        "Dépassement (h)": v.chiffre > 0 && !(l.affaire.imputation === "PE" || l.affaire.imputation === "PI") && v.realise - v.chiffre > toleranceAffectation(v.chiffre) ? arrondi(v.realise - v.chiffre) : "",',
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ colonne « Dépassement » : constaté, et prévu avec le planifié");
console.log("✓ triable, et dans l’export Excel");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
