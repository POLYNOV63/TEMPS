/* ===============================================================
   MAJ FACTURATION DU MOIS - VIGNETTE « SI TOUT ÉTAIT FACTURABLE »
   (FACTURATION_POTENTIEL_V2)

   Une 4e vignette : tout ce qui est à facturer ce mois-ci si rien ne
   bloquait = total facturable + PE / PI sans commande reçue (non
   facturables). Sous le montant : la part en INTENTION de commande, et la
   part SANS N° ARC Louxor. Le reporté n'y est pas.
   (Remplace la première version de cette vignette si elle a été installée.)

   À lancer à la racine du projet :   node outils/maj-facturation-potentiel.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/facturation/page.tsx";
const MARQUEUR = "FACTURATION_POTENTIEL_V2";

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

// la première version, si elle a été installée, est retirée
const V1 = "              {/* FACTURATION_POTENTIEL : si rien ne bloquait */}\n";
if (t.includes(V1)) {
  const i = t.indexOf(V1);
  const j = t.indexOf("              />\n", i);
  if (j < 0) echec(`${FICHIER} : première version de la vignette illisible.`);
  t = t.slice(0, i) + t.slice(j + "              />\n".length);
}

const A = '              <Tuile libelle="Reste à facturer" valeur={euros(resteAFacturer)} sous="forfaits prévus + PE / PI non clôturés" accent={resteAFacturer > 0.5} />\n';
const B =
  A +
  `              {/* ${MARQUEUR} : tout ce qui est à facturer ce mois-ci si rien ne bloquait (intentions et n° Louxor manquants compris) */}
              {(() => {
                const enIntention = lignes.filter((l) => l.statut === "Intention de commande" || l.statutBase === "Intention de commande").reduce((s, l) => s + l.montant, 0);
                const sansLouxor = lignes.filter((l) => l.alerteLouxor).reduce((s, l) => s + l.montant, 0);
                return (
                  <Tuile
                    libelle="Si tout était facturable"
                    valeur={euros(totalFacturable + totalNonFacturable)}
                    sous={[enIntention > 0.5 ? \`dont \${euros(enIntention)} en intention de commande\` : "", sansLouxor > 0.5 ? \`dont \${euros(sansLouxor)} sans n° Louxor\` : ""].filter(Boolean).join(" · ") || "rien ne bloque ce mois-ci"}
                  />
                );
              })()}
`;
if (compter(t, A) !== 1) echec(`${FICHIER} : vignettes introuvables.`);
t = t.replace(A, () => B);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ vignette « Si tout était facturable » : dont intentions, dont sans n° Louxor");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
