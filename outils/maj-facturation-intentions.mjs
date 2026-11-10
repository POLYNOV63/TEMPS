/* ===============================================================
   MAJ FACTURATION DU MOIS - LES INTENTIONS DANS « CE QUI EMPÊCHE DE
   FACTURER » (FORFAITS_INTENTION)

   Un forfait (commande, avenant, échéance, lot) attendu ce mois-ci mais
   encore en « Intention de commande » (lui, ou sa commande) apparaît
   désormais dans « Ce qui empêche de facturer » : pas de facture sans bon
   de commande. Que faire : passer la ligne en « Commande reçue » dans le
   Suivi d'affaire BE à réception du bon de commande.

   À lancer à la racine du projet :   node outils/maj-facturation-intentions.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/facturation/page.tsx";
const MARQUEUR = "FORFAITS_INTENTION";

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

const A = "              for (const l of livreesSansDate) {\n";
const B = `              // ${MARQUEUR} : forfait (ou échéance, lot) attendu ce mois-ci, mais encore en intention de commande
              for (const f of forfaitsPrevus) {
                if (f.statut !== "Intention de commande" && f.statutBase !== "Intention de commande") continue;
                ajouter(f.numero, {
                  bloque:
                    f.statut === "Intention de commande"
                      ? "Pas encore de commande du client (« Intention de commande »), alors que la livraison est prévue ce mois-ci"
                      : "Prévue ce mois-ci, mais sa commande est encore en « Intention de commande »",
                  faire: "À réception du bon de commande : passer la commande en « Commande reçue » dans le Suivi d’affaire BE (et renseigner son n° ARC Louxor).",
                });
              }
${A}`;
if (compter(t, A) !== 1) echec(`${FICHIER} : liste « Ce qui empêche de facturer » introuvable.`);
t = t.replace(A, () => B);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ forfaits et échéances en intention de commande : dans « Ce qui empêche de facturer »");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
