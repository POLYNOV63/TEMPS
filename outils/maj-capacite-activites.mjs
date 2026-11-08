/* ===============================================================
   MAJ - LE BILAN ACTIVITÉS DEVIENT UN ONGLET DE L'ANALYSE DE CAPACITÉ
   (CAPACITE_ACTIVITES)

   - components/analyse/BilanActivites.tsx : le contenu de la page
     « Bilan activités », réutilisable (créé à partir de la page) ;
   - Analyse de capacité (app/admin/bilans) : nouvel onglet
     « 🧩 Par activité » qui l'affiche ;
   - l'ancienne adresse /admin/bilan-activites renvoie vers l'Analyse de
     capacité.

   À lancer à la racine du projet :   node outils/maj-capacite-activites.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const MARQUEUR = "CAPACITE_ACTIVITES";
const PAGE_ACT = "app/admin/bilan-activites/page.tsx";
const COMPOSANT = "components/analyse/BilanActivites.tsx";
const CAPACITE = "app/admin/bilans/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

for (const f of [CAPACITE]) if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
let cap = readFileSync(CAPACITE, "utf8").replace(/\r\n/g, "\n");
if (cap.includes(MARQUEUR) && existsSync(COMPOSANT)) {
  console.log("✓ déjà à jour, rien à faire.");
  process.exit(0);
}
if (!existsSync(PAGE_ACT)) echec(`Fichier introuvable : ${PAGE_ACT}.`);
let act = readFileSync(PAGE_ACT, "utf8").replace(/\r\n/g, "\n");
if (act.includes(MARQUEUR)) echec(`${PAGE_ACT} est déjà la redirection, mais ${COMPOSANT} manque : copiez-moi ce message.`);

/* 1. le composant */
const rc = [
  ["mode dynamique", 'export const dynamic = "force-dynamic";\n', ""],
  ["fonction", "export default function BilanActivitesPage() {", "/* CAPACITE_ACTIVITES : intégré dans l'Analyse de capacité (onglet « Par activité ») */\nexport default function BilanActivites({ integre = false }: { integre?: boolean }) {\n  const Conteneur = integre ? \"div\" : \"main\";"],
];
for (const [nom, a] of rc) if (compter(act, a) !== 1) echec(`${PAGE_ACT} : passage « ${nom} » trouvé ${compter(act, a)} fois (attendu : 1).`);
let comp = act;
for (const [, a, b] of rc) comp = comp.replace(a, () => b);
const nMain = compter(comp, "<main style={styles.page}>");
if (nMain !== 3 || compter(comp, "</main>") !== 3) echec(`${PAGE_ACT} : structure inattendue (${nMain} blocs principaux).`);
comp = comp
  .split("<main style={styles.page}>").join("<Conteneur style={integre ? undefined : styles.page}>")
  .split("</main>").join("</Conteneur>")
  .split('<EnTetePage section="Bilan activités" />').join('{!integre && <EnTetePage section="Bilan activités" />}');

/* 2. l'onglet dans l'Analyse de capacité */
const r = [
  ["import", 'import OngletsCharge from "@/components/analyse/OngletsCharge";\n', (x) => x + 'import BilanActivites from "@/components/analyse/BilanActivites";\n'],
  ["type d'onglet", '      "PILOTAGE" | "NON_EXPLIQUE" | "COLLABORATEURS"\n    >("PILOTAGE");', () => '      "PILOTAGE" | "NON_EXPLIQUE" | "COLLABORATEURS" | "ACTIVITES" // CAPACITE_ACTIVITES\n    >("PILOTAGE");'],
  [
    "onglet « Par activité »",
    "            👥 Collaborateurs\n          </button>\n        </div>\n",
    () =>
      "            👥 Collaborateurs\n          </button>\n\n" +
      "          <button\n" +
      "            style={{\n" +
      "              ...styles.tab,\n" +
      '              ...(onglet === "ACTIVITES" ? styles.tabActive : {}),\n' +
      "            }}\n" +
      '            onClick={() => setOnglet("ACTIVITES")}\n' +
      "          >\n" +
      "            🧩 Par activité\n" +
      "          </button>\n" +
      "        </div>\n\n" +
      "        {/* CAPACITE_ACTIVITES : l'ancien « Bilan activités » (heures CBE / DBE par activité, feuilles du nouveau système) */}\n" +
      '        {onglet === "ACTIVITES" && <BilanActivites integre />}\n',
  ],
];
for (const [nom, a] of r) if (compter(cap, a) !== 1) echec(`${CAPACITE} : passage « ${nom} » trouvé ${compter(cap, a)} fois (attendu : 1).`);
for (const [, a, f] of r) cap = cap.replace(a, (x) => f(x));

/* 3. l'ancienne adresse renvoie vers l'Analyse de capacité */
const REDIRECTION = `import { redirect } from "next/navigation";

/* CAPACITE_ACTIVITES : le Bilan activités est devenu l'onglet « Par activité » de l'Analyse de capacité */
export default function BilanActivitesPage() {
  redirect("/admin/bilans");
}
`;

mkdirSync("components/analyse", { recursive: true });
writeFileSync(COMPOSANT, comp, "utf8");
writeFileSync(CAPACITE, cap, "utf8");
writeFileSync(PAGE_ACT, REDIRECTION, "utf8");
console.log(`✓ ${COMPOSANT} créé`);
console.log(`✓ ${CAPACITE} : onglet « 🧩 Par activité »`);
console.log(`✓ ${PAGE_ACT} : renvoie vers l'Analyse de capacité`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
