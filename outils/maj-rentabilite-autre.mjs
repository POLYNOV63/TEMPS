/* ===============================================================
   MAJ RENTABILITÉ - HEURES SANS ACTIVITÉ RECONNUE (HEURES_SANS_GROUPE)

   La ligne « Autre » de la Rentabilité recevait les heures pointées sur
   une affaire sans activité reconnue (pointage sans activité, historique
   importé, ou activité absente de la correspondance du Suivi d'affaire) :
   un coût sans prix en face, donc une perte artificielle.

   Désormais, ces heures sont réparties sur les activités de la même
   affaire, au prorata de ses autres heures passées (à défaut, de ses
   heures chiffrées) : le coût reste entier, mais dans les bonnes lignes.
   Ne reste en « Autre » que le pointage d'une affaire qui n'a aucune
   autre heure ni aucun chiffrage par activité.

   À lancer à la racine du projet :   node outils/maj-rentabilite-autre.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/rentabilite/page.tsx";
const MARQUEUR = "HEURES_SANS_GROUPE";

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

const A = "      const rg = realiseParBase.get(base) ?? groupesVides();\n";
const B = `      // ${MARQUEUR} : heures sans activité reconnue, réparties sur les activités de l'affaire
      // (au prorata de ses autres heures passées, à défaut de ses heures chiffrées)
      const rg: ParGroupe = { ...(realiseParBase.get(base) ?? groupesVides()) };
      if (rg["Autre"] > 0.01) {
        const cibles = GROUPES.filter((g) => g !== "Autre" && g !== "Non ventilé");
        let poids = cibles.map((g) => [g, rg[g]] as const);
        if (poids.reduce((s, [, x]) => s + x, 0) <= 0.01) poids = cibles.map((g) => [g, a.heuresChiffrees[g]] as const);
        const tot = poids.reduce((s, [, x]) => s + x, 0);
        if (tot > 0.01) {
          for (const [g, x] of poids) rg[g] += rg["Autre"] * (x / tot);
          rg["Autre"] = 0;
        }
      }
`;
if (compter(t, A) !== 1) echec(`${FICHIER} : heures passées de l’affaire introuvables.`);
t = t.replace(A, () => B);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ heures sans activité réparties sur les activités de leur affaire");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
