/* ===============================================================
   MAJ - PLUS DE « SUIVI DES PRESTATIONS » (SANS_CLASSEUR_PRESTATIONS)

   Le relevé PE / PI fait foi ; l'ancien classeur « Suivi des
   prestations » n'est plus tenu. Ce qui en venait encore est retiré :
   - Facturation du mois : l'encadré « Le classeur prévoit un montant, le
     relevé est vide », le « ⚠ classeur : … € » sous les montants, et le
     « reste (classeur) » des PE / PI (le reste vient du relevé) ;
   - Finances : les mois À VENIR de l'ancien classeur ne comptent plus
     dans l'attendu (seul le relevé prévoit les PE / PI). Les mois PASSÉS
     de l'historique (avant le relevé) restent dans le réalisé.

   À lancer à la racine du projet :   node outils/maj-sans-classeur-prestations.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "SANS_CLASSEUR_PRESTATIONS";
const FACT = "app/analyse/facturation/page.tsx";
const FIN = "app/analyse/finances/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};
const couper = (f, t, debut, fin, nom) => {
  if (compter(t, debut) !== 1) echec(`${f} : « ${nom} » introuvable.`);
  const i = t.indexOf(debut);
  const j = t.indexOf(fin, i);
  if (j < 0) echec(`${f} : fin de « ${nom} » introuvable.`);
  return [t.slice(0, i), t.slice(j)];
};

const sorties = [];

/* ---------- Facturation ---------- */
let f = lire(FACT);
if (!f.includes(MARQUEUR)) {
  // 1. l'encadré
  if (f.includes("PEPI_SANS_HEURES")) {
    const [a, b] = couper(FACT, f, "            {classeurSeul.length > 0 && (\n", "            {reportes.length > 0 && (\n", "encadré du classeur");
    f = `${a}            {/* ${MARQUEUR} : plus d'encadré du classeur */}\n${b}`;
  }
  // 2. le « ⚠ classeur » sous les montants
  const D = "                          {!l.cloture && l.classeurMontant !== null && l.classeurMontant !== undefined && Math.abs(l.classeurMontant - l.montant) > 0.5 && (\n";
  const F = "⚠ classeur : {euros(l.classeurMontant)}\n                            </div>\n                          )}\n";
  if (compter(f, D) === 1) {
    const i = f.indexOf(D);
    const j = f.indexOf(F, i);
    if (j < 0) echec(`${FACT} : fin du « ⚠ classeur » introuvable.`);
    f = f.slice(0, i) + f.slice(j + F.length);
  }
  // 3. le reste des PE / PI : celui du relevé
  const R = "          if (p.resteClasseur !== null) {";
  if (compter(f, R) !== 1) echec(`${FACT} : reste des PE / PI introuvable.`);
  f = f.replace(R, () => `          // ${MARQUEUR} : le reste vient du relevé (le classeur n'est plus tenu)\n          if (LIRE_CLASSEUR && p.resteClasseur !== null) {`);
  const T = "const prestation = (imp: string | null) => imp === \"PE\" || imp === \"PI\";";
  if (compter(f, T) !== 1) echec(`${FACT} : repère des déclarations introuvable.`);
  f = f.replace(T, () => `${T}\nconst LIRE_CLASSEUR = false as boolean; // ${MARQUEUR}`);
  sorties.push([FACT, f, "encadré, « ⚠ classeur » et reste du classeur retirés"]);
} else console.log(`✓ ${FACT} : déjà à jour`);

/* ---------- Finances ---------- */
let n = lire(FIN);
if (!n.includes(MARQUEUR)) {
  const A = "        .filter((h) => h.mois.slice(0, 7) >= moisCourantIso)\n";
  if (compter(n, A) !== 1) echec(`${FIN} : mois à venir de l'historique introuvables.`);
  n = n.replace(A, () => `        // ${MARQUEUR} : l'ancien classeur n'est plus tenu : ses mois à venir ne comptent plus dans l'attendu\n        .filter((h) => h.mois.slice(0, 7) >= moisCourantIso && false)\n`);
  sorties.push([FIN, n, "mois à venir de l'ancien classeur hors attendu"]);
} else console.log(`✓ ${FIN} : déjà à jour`);

for (const [fi, t, quoi] of sorties) {
  writeFileSync(fi, t, "utf8");
  console.log(`✓ ${fi} : ${quoi}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
