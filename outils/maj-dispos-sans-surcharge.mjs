/* ===============================================================
   MAJ - DISPONIBILITÉS SANS SURCHARGE, PRÉVISIONNEL EN GRIS,
         ORDRE DES ANALYSES (DISPOS_SANS_SURCHARGE)

   1. Disponibilités par activité :
      - la surcharge disparaît du graphique, de sa légende et du tableau
        (elle reste visible, personne par personne, dans le détail d'une
        semaine et dans Charge par ressource) ;
      - le prévisionnel est en gris hachuré (comme au planning), au lieu
        de la couleur de l'activité.
   2. Navigation, axe Analyses : Finances, Facturation du mois,
      Rentabilité, Indicateurs commerciaux, Cartographie de l'équipe, puis
      Analyse de capacité en dernier (la plus longue à charger).

   À lancer à la racine du projet :   node outils/maj-dispos-sans-surcharge.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "DISPOS_SANS_SURCHARGE";
const PAGE = "app/analyse/charge-activites/page.tsx";
const NAV = "components/pilotage/OngletsPilotage.tsx";
const GRIS_PREV = "repeating-linear-gradient(45deg,#8e9aa8,#8e9aa8 3px,#c3cad3 3px,#c3cad3 6px)";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};

const sorties = [];

/* ---------- 1. la page ---------- */
let p = lire(PAGE);
if (!p.includes(MARQUEUR)) {
  const R = [
    ["info-bulle sans surcharge", '}${d.prev[w] >= 0.5 ? ` · dont prévisionnel ${h(d.prev[w])}` : ""}${exces >= 0.5 ? ` · surcharge ${h(exces)}` : ""}`}', '}${d.prev[w] >= 0.5 ? ` · dont prévisionnel ${h(d.prev[w])}` : ""}`}'],
    ["variable de surcharge", "                    const exces = d.surcharge[w];\n", `                    // ${MARQUEUR} : plus de surcharge dans le graphique\n`],
    [
      "prévisionnel en gris",
      "background: `repeating-linear-gradient(45deg,${d.couleur},${d.couleur} 3px,#ffffff 3px,#ffffff 6px)`, opacity: 0.6 }} />",
      `background: "${GRIS_PREV}" }} />`,
    ],
    [
      "surcharge retirée du graphique",
      "                        {exces > 0 && <div style={{ height: `${(exces / max) * 100}%`, background: `repeating-linear-gradient(45deg,${ROUGE},${ROUGE} 3px,#f3b1ae 3px,#f3b1ae 6px)` }} />}\n",
      "",
    ],
    [
      "légende du prévisionnel",
      'background: "repeating-linear-gradient(45deg,#7b8189,#7b8189 3px,#ffffff 3px,#ffffff 6px)", verticalAlign: "middle", opacity: 0.7 }} /> dont prévisionnel (non confirmé)',
      `background: "${GRIS_PREV}", verticalAlign: "middle" }} /> dont prévisionnel (non confirmé)`,
    ],
    [
      "légende de la surcharge",
      "          <span><i style={{ display: \"inline-block\", width: 12, height: 12, background: `repeating-linear-gradient(45deg,${ROUGE},${ROUGE} 3px,#f3b1ae 3px,#f3b1ae 6px)`, verticalAlign: \"middle\" }} /> surcharge</span>\n",
      "",
    ],
    [
      "ligne Surcharge du tableau",
      '                        ...(d.surcharge.some((x) => x >= 0.5) ? [["Surcharge", d.surcharge.map((x) => -x), null] as [string, number[], null]] : []),\n',
      "",
    ],
    [
      "explication",
      "Disponibles : les heures libres de chacun, détaillées par niveau (fiche collaborateur) ; surcharge :\n          ce qui dépasse la capacité de certains. Capacité − occupées = disponibles − surcharge.",
      "Disponibles : les heures libres de chacun, détaillées par niveau (fiche collaborateur).\n          Ce qui est planifié au-delà de la capacité d’une personne n’est pas montré ici (voir le détail d’une semaine).",
    ],
  ];
  for (const [nom, a] of R) if (compter(p, a) !== 1) echec(`${PAGE} : « ${nom} » trouvé ${compter(p, a)} fois (attendu : 1).`);
  for (const [, a, b] of R) p = p.replace(a, () => b);
  if (/\bexces\b/.test(p)) echec(`${PAGE} : il reste un usage de la surcharge dans le graphique.`);
  sorties.push([PAGE, p, "surcharge retirée, prévisionnel en gris"]);
} else console.log(`✓ ${PAGE} : déjà à jour`);

/* ---------- 2. l'ordre des analyses ---------- */
let n = lire(NAV);
if (!n.includes(MARQUEUR)) {
  const ordre = ["finances", "facturation", "rentabilite", "indicateurs", "effectifs", "capacite"];
  const lignes = {};
  for (const cle of ordre) {
    const re = new RegExp(`^  \\{ cle: "${cle}", axe: "analyses",.*\\},\\n`, "m");
    const m = n.match(re);
    if (!m) echec(`${NAV} : page « ${cle} » introuvable dans l'axe Analyses.`);
    lignes[cle] = m[0];
  }
  const debut = "  // Analyses : ce qui a été fait, ce que ça a rapporté\n";
  if (compter(n, debut) !== 1) echec(`${NAV} : début de l'axe Analyses introuvable.`);
  for (const cle of ordre) n = n.replace(lignes[cle], "");
  n = n.replace(debut, () => `${debut}  // ${MARQUEUR} : Analyse de capacité en dernier (la plus longue à charger)\n${ordre.map((c) => lignes[c]).join("")}`);
  sorties.push([NAV, n, "Analyses : Finances en premier, Analyse de capacité en dernier"]);
} else console.log(`✓ ${NAV} : déjà à jour`);

for (const [f, t, quoi] of sorties) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : ${quoi}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
