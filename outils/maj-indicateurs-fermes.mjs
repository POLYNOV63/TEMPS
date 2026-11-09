/* ===============================================================
   MAJ INDICATEURS COMMERCIAUX - DEVIS FERMÉS SANS DEVIS (DEVIS_FERMES)

   Un « Devis perdu » SANS montant ni heures n'a jamais été chiffré ni
   envoyé : consultation fermée (client injoignable, périmètre changé…).
   Ce n'est pas un devis perdu :
   - il ne compte plus comme perdu dans le taux de transformation ;
   - il sort des activités (donc de « Non ventilé ») ;
   - il reste compté dans les consultations, à part : colonne « Fermées »,
     vignette (« dont N fermées sans devis »), et en gris clair dans le
     graphique par mois.
   Un vrai devis perdu a ses montants (colonnes « … DEVIS PERDU »).

   À lancer à la racine du projet :   node outils/maj-indicateurs-fermes.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/indicateurs/page.tsx";
const MARQUEUR = "DEVIS_FERMES";
const GRIS = "#dfe2e6";

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

const R = [
  ["type de l'issue", "  issue: Issue;\n", `  issue: Issue | "FERME"; // ${MARQUEUR} : « Devis perdu » sans montant ni heures = fermé sans devis\n`],
  ["compteur", "type Stat = { n: number; g: number; p: number; a: number; v: number; vg: number; vp: number };", "type Stat = { n: number; g: number; p: number; a: number; f: number; v: number; vg: number; vp: number };"],
  ["compteur vide", "const vide = (): Stat => ({ n: 0, g: 0, p: 0, a: 0, v: 0, vg: 0, vp: 0 });", "const vide = (): Stat => ({ n: 0, g: 0, p: 0, a: 0, f: 0, v: 0, vg: 0, vp: 0 });"],
  [
    "issue d'une consultation",
    "      res.push({ numero, l, ouverture, issue: issueDevis(l), principale, parts, source });",
    `      const issue0 = issueDevis(l);
      const ferme = issue0 === "PERDU" && !(l.montant > 0) && !(l.heures_total > 0);
      res.push({ numero, l, ouverture, issue: ferme ? "FERME" : issue0, principale, parts, source });`,
  ],
  ["comptage", "        else if (c.issue === \"PERDU\") s.p++;\n        else s.a++;", "        else if (c.issue === \"PERDU\") s.p++;\n        else if (c.issue === \"FERME\") s.f++;\n        else s.a++;"],
  ["activités sans les fermées", "    const parAct = new Map<Discipline, Stat>();\n    for (const c of periode)\n", "    const parAct = new Map<Discipline, Stat>();\n    for (const c of periode.filter((x) => x.issue !== \"FERME\"))\n"],
  [
    "mois",
    "const mois: { cle: string; label: string; parAct: Record<Discipline, number>; n: number }[] = [];",
    "const mois: { cle: string; label: string; parAct: Record<Discipline, number>; n: number; fermes: number }[] = [];",
  ],
  ["mois vides", "as Record<Discipline, number>, n: 0 });", "as Record<Discipline, number>, n: 0, fermes: 0 });"],
  ["mois des fermées", "      m.parAct[c.principale]++;\n      m.n++;", "      if (c.issue === \"FERME\") m.fermes++;\n      else m.parAct[c.principale]++;\n      m.n++;"],
  [
    "graphique",
    "                          <div key={d} title={`${m.label} · ${ACTIVITES[d].nom} : ${m.parAct[d]}`} style={{ flex: m.parAct[d], background: ACTIVITES[d].couleur }} />\n                        ) : null\n                      )}\n",
    `                          <div key={d} title={\`\${m.label} · \${ACTIVITES[d].nom} : \${m.parAct[d]}\`} style={{ flex: m.parAct[d], background: ACTIVITES[d].couleur }} />
                        ) : null
                      )}
                      {m.fermes > 0 && <div title={\`\${m.label} · fermées sans devis : \${m.fermes}\`} style={{ flex: m.fermes, background: "${GRIS}" }} />}
`,
  ],
  [
    "légende",
    "                {DISCIPLINES.filter((d) => vue.parAct.has(d)).map((d) => (\n                  <span key={d}>\n                    {pastille(ACTIVITES[d].couleur)}\n                    {ACTIVITES[d].nom}\n                  </span>\n                ))}\n              </div>\n            </section>",
    `                {DISCIPLINES.filter((d) => vue.parAct.has(d)).map((d) => (
                  <span key={d}>
                    {pastille(ACTIVITES[d].couleur)}
                    {ACTIVITES[d].nom}
                  </span>
                ))}
                {vue.mois.some((m) => m.fermes > 0) && (
                  <span>
                    {pastille("${GRIS}")}
                    fermées sans devis
                  </span>
                )}
              </div>
            </section>`,
  ],
  ["colonne", "        <th style={thD}>Sans réponse</th>\n", "        <th style={thD}>Sans réponse</th>\n        <th style={thD} title=\"Classées « Devis perdu » sans montant ni heures : jamais chiffrées ni envoyées\">Fermées</th>\n"],
  ["cellule", "      <td style={{ ...tdD, color: C.gris }}>{s.a}</td>\n", "      <td style={{ ...tdD, color: C.gris }}>{s.a}</td>\n      <td style={{ ...tdD, color: C.gris }}>{s.f || \"—\"}</td>\n"],
  ["vignette", "sous={`devis ouverts · ${evol(t.n, tN1.n)}`}", "sous={`devis ouverts${t.f ? ` · dont ${t.f} fermées sans devis` : \"\"} · ${evol(t.n, tN1.n)}`}"],
  ["détail du non ventilé", 'const autres = vue.periode.filter((c) => c.principale === "autre")', 'const autres = vue.periode.filter((c) => c.principale === "autre" && c.issue !== "FERME")'],
  ["export", 'const issueTexte = { GAGNE: "Remporté", PERDU: "Perdu", INTENTION: "Intention de commande", ATTENTE: "Sans réponse" } as const;', 'const issueTexte = { GAGNE: "Remporté", PERDU: "Perdu", INTENTION: "Intention de commande", ATTENTE: "Sans réponse", FERME: "Fermé sans devis" } as const;'],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ « Devis perdu » sans montant ni heures = fermé sans devis");
console.log("✓ hors taux de transformation et hors activités (plus de faux « Non ventilé »)");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
