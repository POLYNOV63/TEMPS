/* ===============================================================
   MAJ - LE SCAN À PART, COMME LE NÉGOCE (SCAN_A_PART)

   Les commandes en imputation « SCAN » sont vendues au montant, sans
   nombre d'heures attendu : comme le négoce, elles sortent des
   comparaisons chiffré / réalisé.
   - lib/pilotageCalculs.ts : pas d'alerte d'heures ; état « Scan · X h
     passées » ;
   - Analyse du chiffré : bouton « Négoce / Scan » (« Forfaits » les
     exclut) ; pastille « vendu au montant » ;
   - Fiabilité du chiffrage : bloc « Négoce et Scan, à part » ;
   - Finances, rentabilité : une affaire de scan compte entière dans
     « Scan », avec le coût de ses heures.

   À lancer à la racine du projet, APRÈS maj-chiffre-simple.mjs :
       node outils/maj-scan-a-part.mjs
   Tout ou rien (les quatre fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "SCAN_A_PART";
const REGEX_AVANT = 'const estNegoceImp = (imp: string | null | undefined) => /^negoce/.test(';
const REGEX_APRES =
  '// SCAN_A_PART : le scan, vendu au montant, est traité comme le négoce\nconst estNegoceImp = (imp: string | null | undefined) => /^(negoce|scan)/.test(';

const FICHIERS = [
  {
    f: "lib/pilotageCalculs.ts",
    r: [
      ["négoce ou scan", REGEX_AVANT, () => REGEX_APRES],
      [
        "libellé de l'état",
        'return { genre: "info", texte: t.realise > 0 ? `Négoce · ${formatHeures(t.realise)} passées` : "Négoce" };',
        () =>
          'const genreVente = /scan/i.test(a.imputation ?? "") ? "Scan" : "Négoce";\n    return { genre: "info", texte: t.realise > 0 ? `${genreVente} · ${formatHeures(t.realise)} passées` : genreVente };',
      ],
    ],
  },
  {
    f: "app/analyse/pointage/page.tsx",
    r: [
      ["négoce ou scan", REGEX_AVANT, () => REGEX_APRES],
      ["bouton « Négoce / Scan »", '                    ["NEGOCE", "Négoce"],\n', () => '                    ["NEGOCE", "Négoce / Scan"],\n'],
      ["texte du périmètre", 'perimetre === "NEGOCE" ? "de négoce"', () => 'perimetre === "NEGOCE" ? "de négoce et de scan"'],
      ["pastille", '<Pastille genre="info">négoce · dans la marge</Pastille>', () => '<Pastille genre="info">vendu au montant</Pastille>'],
    ],
  },
  {
    f: "app/analyse/fiabilite-chiffrage/page.tsx",
    r: [
      ["négoce ou scan", REGEX_AVANT, () => REGEX_APRES],
      ["titre du bloc", "                      Négoce, à part : ", () => "                      Négoce et Scan, à part : "],
      [
        "texte du bloc",
        "Les affaires de négoce pur ne comptent pas dans le tableau par activité : leurs heures (consultation, commandes, suivi fournisseur) ne sont\n                      en général pas chiffrées, elles sont couvertes par la marge.",
        () =>
          "Les affaires de négoce et de scan, vendues au montant, ne comptent pas dans le tableau par activité : leurs heures ne sont en général\n                      pas chiffrées, elles sont couvertes par le prix.",
      ],
      [
        "aide",
        "<strong>Négoce pur</strong> (imputation « Négoce ») : à part, avec ses heures passées ; il ne pèse pas sur la Mécanique.",
        () => "<strong>Négoce et Scan</strong> (vendus au montant) : à part, avec leurs heures passées ; ils ne pèsent pas sur la Mécanique.",
      ],
    ],
  },
  {
    f: "app/analyse/finances/page.tsx",
    r: [
      [
        "affaires de scan",
        "    for (const a of terminees) {\n      const c = coutHoraire(couts, a.date_fin);\n      if (basesNegoce.has(",
        () =>
          "    // SCAN_A_PART : une affaire de scan compte entière dans « Scan », avec le coût de ses heures\n" +
          "    const basesScan = new Set(\n" +
          '      lignesFin.filter((l) => l.genre === "BASE" && /^scan/i.test(l.imputation ?? "") && l.base_affaire).map((l) => String(l.base_affaire).replace(/^0+/, ""))\n' +
          "    );\n" +
          "    for (const a of terminees) {\n      const c = coutHoraire(couts, a.date_fin);\n" +
          '      if (basesScan.has(a.base_affaire.replace(/^0+/, ""))) {\n' +
          "        const hs = GROUPES.reduce((t, g) => t + a.realiseG[g], 0);\n" +
          '        ajouter("Scan", a.montant, 0, hs, c === null ? null : a.achats + hs * c);\n' +
          "        continue;\n" +
          "      }\n" +
          "      if (basesNegoce.has(",
      ],
    ],
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

const resultats = [];
for (const { f, r } of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  if (!t.includes("NEGOCE_ROBUSTE")) echec(`${f} : lancez d'abord maj-chiffre-simple.mjs.`);
  for (const [nom, a] of r) {
    const n = t.split(a).length - 1;
    if (n !== 1) echec(`${f} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const [, a, g] of r) t = t.replace(a, () => g());
  resultats.push([f, t, r.length]);
}
for (const [f, t, n] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} (${n} modification${n > 1 ? "s" : ""})`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
