/* ===============================================================
   MAJ - LE NÉGOCE À PART (NEGOCE_A_PART)

   Les affaires de négoce pur (imputation « Négoce ») ont des heures non
   chiffrées, couvertes par la marge. Pour qu'elles ne faussent plus la
   Mécanique :
   - lib/pilotageCalculs.ts : une affaire de négoce sans heures chiffrées
     n'alerte plus (« pas de charge chiffrée », « non affectées ») ; son
     état affiche « Négoce · X h passées » (portefeuille, alertes) ;
   - app/analyse/finances/page.tsx : rentabilité, une affaire de négoce pur
     compte entière dans « Négoce », avec le coût de ses heures (plus dans
     Méca) ; tuile « Marge du négoce » : brute (revente − achats) et
     nette (après les heures passées × coût de structure) ;
   - la page Fiabilité du chiffrage (fournie dans le ZIP) les met à part.

   À lancer à la racine du projet :   node outils/maj-negoce-a-part.mjs
   Tout ou rien (les deux fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "NEGOCE_A_PART";
const FICHIERS = [
  {
    f: "lib/pilotageCalculs.ts",
    r: [
      [
        "type de l'affaire (imputation)",
        "  a: Pick<Affaire, \"type\" | \"statut\" | \"echeance\">,\n  t: Totaux,\n  aujourdhui: string,\n  planning?: PlanningAffaire\n): { genre: Genre; texte: string } {",
        "  a: Pick<Affaire, \"type\" | \"statut\" | \"echeance\"> & { imputation?: string | null },\n  t: Totaux,\n  aujourdhui: string,\n  planning?: PlanningAffaire\n): { genre: Genre; texte: string } {",
      ],
      [
        "état d'une affaire de négoce",
        "  if (a.statut === \"LIVREE\") return { genre: \"info\", texte: \"Livrée\" };\n",
        "  if (a.statut === \"LIVREE\") return { genre: \"info\", texte: \"Livrée\" };\n\n" +
          "  /* NEGOCE_A_PART : négoce pur sans heures chiffrées (elles sont dans la marge) : ni « pas de charge chiffrée »,\n" +
          "     ni heures non affectées ; on affiche les heures passées */\n" +
          "  if (a.type === \"CBE\" && a.imputation === \"Négoce\" && t.chiffre === 0) {\n" +
          "    if (a.statut === \"EN_ATTENTE\") return { genre: \"info\", texte: \"En attente\" };\n" +
          "    if (a.echeance && a.echeance < aujourdhui) return { genre: \"crit\", texte: \"Délai dépassé\" };\n" +
          "    return { genre: \"info\", texte: t.realise > 0 ? `Négoce · ${formatHeures(t.realise)} passées` : \"Négoce\" };\n" +
          "  }\n",
      ],
    ],
  },
  {
    f: "app/analyse/finances/page.tsx",
    r: [
      [
        "rentabilité : négoce pur dans « Négoce »",
        "    for (const a of terminees) {\n      const c = coutHoraire(couts, a.date_fin);\n",
        "    // NEGOCE_A_PART : une affaire de négoce pur compte entière dans « Négoce », avec le coût de ses heures\n" +
          "    const basesNegoce = new Set(\n" +
          "      lignesFin.filter((l) => l.genre === \"BASE\" && l.imputation === \"Négoce\" && l.base_affaire).map((l) => String(l.base_affaire).replace(/^0+/, \"\"))\n" +
          "    );\n" +
          "    for (const a of terminees) {\n      const c = coutHoraire(couts, a.date_fin);\n" +
          "      if (basesNegoce.has(a.base_affaire.replace(/^0+/, \"\"))) {\n" +
          "        const h = GROUPES.reduce((t, g) => t + a.realiseG[g], 0);\n" +
          "        ajouter(\"Négoce\", a.montant, 0, h, c === null ? null : a.achats + h * c);\n" +
          "        continue;\n" +
          "      }\n",
      ],
      [
        "tuile « Marge du négoce » brute et nette",
        '              <Tuile libelle="Marge du négoce" valeur={vue.negoce > 0 ? `${Math.round(((vue.negoce - vue.achats) / vue.negoce) * 100)} %` : "—"} sous={`revente ${keuros(vue.negoce)} · achats ${keuros(vue.achats)}`} />',
        `              {(() => {
                // NEGOCE_A_PART : marge brute (revente − achats) et nette (après les heures passées × coût de structure)
                const ng = vue.parGroupeRenta.find(([g]) => g === "Négoce")?.[1];
                const brute = vue.negoce > 0 ? (vue.negoce - vue.achats) / vue.negoce : null;
                const nette = ng && ng.cout !== null && ng.ca > 0 ? (ng.ca - ng.cout) / ng.ca : null;
                return (
                  <Tuile
                    libelle="Marge du négoce"
                    valeur={brute === null ? "—" : \`\${Math.round(brute * 100)} %\`}
                    sous={\`revente \${keuros(vue.negoce)} · achats \${keuros(vue.achats)}\${nette !== null ? \` · nette \${Math.round(nette * 100)} % après \${formatHeures(ng?.heuresRealisees ?? 0)} passées\` : ""}\`}
                    accent={nette !== null && nette < 0}
                  />
                );
              })()}`,
      ],
    ],
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
if (!existsSync("app/analyse/fiabilite-chiffrage/page.tsx") || !readFileSync("app/analyse/fiabilite-chiffrage/page.tsx", "utf8").includes(MARQUEUR))
  echec("la nouvelle page Fiabilité du chiffrage n'est pas en place : décompressez d'abord le ZIP à la racine du projet.");
const resultats = [];
for (const { f, r } of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  for (const [nom, a] of r) {
    const n = t.split(a).length - 1;
    if (n !== 1) echec(`${f} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const [, a, b] of r) t = t.replace(a, () => b);
  resultats.push([f, t, r.map(([nom]) => nom)]);
}
for (const [f, t, noms] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : ${noms.join(", ")}`);
}
console.log("✓ app/analyse/fiabilite-chiffrage/page.tsx : négoce pur à part");
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
