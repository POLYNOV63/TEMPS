/* ===============================================================
   MAJ RENTABILITÉ - LOTS REGROUPÉS (LOTS_REGROUPES)

   Une commande découpée en lots (CBE1627LOT1, LOT2…) porte souvent son
   détail par activité sur ses lots, pas sur sa ligne. La rentabilité la
   prenait alors pour « montant non ventilé ». Désormais, quand la ligne
   de la commande n'a pas de détail (montants ou heures par activité), on
   prend celui de ses lots et échéances (et des échéances d'un lot),
   additionnés : l'affaire est rangée dans ses vraies activités.

   Fichier : lib/finances.ts (sert à la Rentabilité).
   À lancer à la racine du projet :   node outils/maj-rentabilite-lots.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "lib/finances.ts";
const MARQUEUR = "LOTS_REGROUPES";

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

const AIDE = `/* ${MARQUEUR} : le détail d'une commande, sinon celui de ses découpages (lots, échéances, échéances d'un lot), additionnés */
function detailAvecDecoupages(l: LigneFin, f: LigneFin[]): { m: Montants; heures: Record<Discipline, number> } {
  const sommeM = (m: Montants) => m.meca + m.calcul + m.elec_pneu + m.scan + m.autre + m.negoce;
  const sommeH = (h: Record<Discipline, number>) => Object.values(h).reduce((x, v) => x + v, 0);
  const enfants = f.filter((e) => estDecoupage(e) && e.parent_cle === l.cle && !e.disparue);
  const m: Montants = { ...l.m };
  const heures: Record<Discipline, number> = { ...l.heures };
  if (enfants.length === 0) return { m, heures };
  const sous = enfants.map((e) => detailAvecDecoupages(e, f));
  if (sommeM(l.m) <= 0)
    for (const k of ["meca", "calcul", "elec_pneu", "scan", "autre", "negoce"] as const) m[k] = sous.reduce((x, s) => x + s.m[k], 0);
  if (sommeH(l.heures) <= 0) for (const d of Object.keys(heures) as Discipline[]) heures[d] = sous.reduce((x, s) => x + (s.heures[d] ?? 0), 0);
  return { m, heures };
}

export function affairesTerminees(`;

const R = [
  ["fonction", "export function affairesTerminees(", AIDE],
  [
    "répartition",
    "      const r = repartir(l.m, l.m.montant);\n      for (const g of GROUPES) parGroupe[g] += r[g];\n      for (const d of Object.keys(GROUPE_DISCIPLINE) as Discipline[]) heuresChiffrees[GROUPE_DISCIPLINE[d]] += l.heures[d];",
    "      const det = detailAvecDecoupages(l, f);\n      const r = repartir(det.m, l.m.montant);\n      for (const g of GROUPES) parGroupe[g] += r[g];\n      for (const d of Object.keys(GROUPE_DISCIPLINE) as Discipline[]) heuresChiffrees[GROUPE_DISCIPLINE[d]] += det.heures[d];",
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ commandes en lots : détail pris sur leurs lots et échéances");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
