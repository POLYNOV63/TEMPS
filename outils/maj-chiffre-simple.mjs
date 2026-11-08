/* ===============================================================
   MAJ - NÉGOCE RECONNU QUELLE QUE SOIT L'ÉCRITURE + ANALYSE DU CHIFFRÉ
   SIMPLIFIÉE (NEGOCE_ROBUSTE)

   1. Le négoce pur est reconnu que l'imputation s'écrive « Négoce »,
      « NEGOCE » ou « Negoce » (accents et majuscules ignorés), dans :
      lib/pilotageCalculs.ts, Finances, Fiabilité du chiffrage, Analyse du
      chiffré.
   2. Analyse du chiffré, moins de filtres :
      - plus de « En cours / Toutes » : on voit toujours les affaires en
        cours ET celles pointées sur la période ;
      - type : Forfaits · PE / PI · Négoce (plus de « Tout ») ;
      - plus de case « Seulement au-delà du chiffré » : on clique sur la
        tuile « Au-delà du chiffré » pour ne voir qu'elles (et re-cliquer
        pour tout revoir).

   À lancer à la racine du projet, APRÈS maj-negoce-a-part.mjs et
   maj-analyse-chiffre-negoce.mjs :   node outils/maj-chiffre-simple.mjs
   Tout ou rien (les quatre fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "NEGOCE_ROBUSTE";
const AIDE =
  "/* NEGOCE_ROBUSTE : « Négoce », « NEGOCE », « Negoce »… (accents et majuscules ignorés) */\n" +
  'const estNegoceImp = (imp: string | null | undefined) => /^negoce/.test((imp ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim());\n';

const FICHIERS = [
  {
    f: "lib/pilotageCalculs.ts",
    r: [
      ["aide", "export function toleranceAffectation(", (x) => AIDE + "\n" + x],
      ["état d'une affaire de négoce", 'a.imputation === "Négoce"', () => "estNegoceImp(a.imputation)"],
    ],
  },
  {
    f: "app/analyse/finances/page.tsx",
    r: [
      ["aide", "const libMois = (m: string) =>", (x) => AIDE + x],
      ["rentabilité du négoce", 'l.imputation === "Négoce"', () => "estNegoceImp(l.imputation)"],
    ],
  },
  {
    f: "app/analyse/fiabilite-chiffrage/page.tsx",
    r: [
      ["aide", 'const SANS = "__sans__";\n', (x) => x + AIDE],
      ["négoce à part", '(imputationBase.get(base) ?? laBase.imputation) === "Négoce"', () => "estNegoceImp(imputationBase.get(base) ?? laBase.imputation)"],
    ],
  },
  {
    f: "app/analyse/pointage/page.tsx",
    r: [
      ["aide", 'const sansZeros = (n: string) => String(n ?? "").replace(/^0+/, "");\n', (x) => x + AIDE],
      ["périmètre négoce", '        const negoce = f.imputation === "Négoce";', () => "        const negoce = estNegoceImp(f.imputation);"],
      ["filtre au-delà", 'v.fin > 0.5 && f.imputation !== "Négoce"', () => "v.fin > 0.5 && !estNegoceImp(f.imputation)"],
      ["pastille négoce", '(f.imputation === "Négoce" ? <Pastille genre="info">', () => '(estNegoceImp(f.imputation) ? <Pastille genre="info">'],
      ["vue par défaut", '  const [vue, setVue] = useState<"EN_COURS" | "TOUTES">("EN_COURS");', () => '  const [vue, setVue] = useState<"EN_COURS" | "TOUTES">("TOUTES"); // en cours + pointées sur la période'],
      [
        "plus de « En cours / Toutes »",
        '                {(\n                  [\n                    ["EN_COURS", "En cours"],\n                    ["TOUTES", "Toutes"],\n                  ] as const\n                ).map(([v, l]) => (\n                  <button key={v} type="button" aria-pressed={vue === v} onClick={() => setVue(v)} style={vue === v ? page.btnPrimaire : page.btnSecondaire}>\n                    {l}\n                  </button>\n                ))}\n                <span style={{ width: 10 }} />\n',
        () => "",
      ],
      ["plus de « Tout »", '                    ["NEGOCE", "Négoce"],\n                    ["TOUT", "Tout"],\n', () => '                    ["NEGOCE", "Négoce"],\n'],
      [
        "plus de case « Seulement au-delà »",
        '                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>\n                  <input type="checkbox" checked={seulementAlertes} onChange={(e) => setSeulementAlertes(e.target.checked)} style={{ width: 18, height: 18 }} />\n                  Seulement au-delà du chiffré\n                </label>\n',
        () => "",
      ],
      [
        "tuile « Au-delà du chiffré » cliquable",
        '              <Tuile\n                libelle="Au-delà du chiffré"\n                valeur={calculPeriode ? "…" : String(totaux.depassees)}\n                sous={bornes ? `affaires dont le cumul au ${frDate(bornes.au < aujourdhui ? bornes.au : aujourdhui)} dépasse le chiffré` : ""}\n                accent={!calculPeriode && totaux.depassees > 0}\n              />',
        () =>
          '              {/* NEGOCE_ROBUSTE : la tuile sert de filtre (un clic : seulement ces affaires ; un autre : toutes) */}\n' +
          "              <div\n" +
          '                role="button"\n' +
          "                tabIndex={0}\n" +
          "                aria-pressed={seulementAlertes}\n" +
          '                title={seulementAlertes ? "Cliquer pour revoir toutes les affaires" : "Cliquer pour ne voir que les affaires au-delà du chiffré"}\n' +
          "                onClick={() => setSeulementAlertes((x) => !x)}\n" +
          '                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSeulementAlertes((x) => !x)}\n' +
          '                style={{ display: "flex", cursor: "pointer", borderRadius: 12, outline: seulementAlertes ? `3px solid ${C.rouge}` : undefined }}\n' +
          "              >\n" +
          "                <Tuile\n" +
          '                  libelle="Au-delà du chiffré"\n' +
          '                  valeur={calculPeriode ? "…" : String(totaux.depassees)}\n' +
          '                  sous={seulementAlertes ? "filtre actif : seulement ces affaires · cliquer pour tout revoir" : "affaires qui dépassent le chiffré · cliquer pour ne voir qu’elles"}\n' +
          "                  accent={!calculPeriode && totaux.depassees > 0}\n" +
          "                />\n" +
          "              </div>",
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
  if (!t.includes("NEGOCE_A_PART")) echec(`${f} : lancez d'abord maj-negoce-a-part.mjs et maj-analyse-chiffre-negoce.mjs.`);
  for (const [nom, a] of r) {
    const n = t.split(a).length - 1;
    if (n !== 1) echec(`${f} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const [, a, g] of r) t = t.replace(a, (x) => g(x));
  if (t.includes('"Négoce"') && /imputation\)? ?[!=]== "Négoce"/.test(t)) echec(`${f} : il reste une comparaison stricte à « Négoce ».`);
  resultats.push([f, t, r.length]);
}
for (const [f, t, n] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} (${n} modification${n > 1 ? "s" : ""})`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
