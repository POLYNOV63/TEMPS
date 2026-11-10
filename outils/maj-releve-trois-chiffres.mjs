/* ===============================================================
   MAJ RELEVÉ PE / PI - COLONNE COMMANDE EN TROIS CHIFFRES (RESTE_TROIS_CHIFFRES)

   La colonne « Reste commande » perd sa pastille de couleur (bleu, orange,
   rouge) et donne seulement trois chiffres, dans l'unité de la commande :
     commande  : ce qui est commandé ;
     planifié  : tout ce qui est saisi au relevé (fait et à venir) ;
     reste     : ce qui reste à planifier (« dépassé » en rouge si négatif).
   Un clic ouvre toujours la fiche commande.

   À lancer à la racine du projet :   node outils/maj-releve-trois-chiffres.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/prestations/page.tsx";
const MARQUEUR = "RESTE_TROIS_CHIFFRES";

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

const DEBUT = '                                          <Pastille genre={f.reste <= 0 ? "crit" : f.quantite && f.reste / f.quantite < 0.2 ? "warn" : "ok"}>';
const FIN = "                                          })()}\n                                        </button>";
const NOUVEAU = `                                          {/* ${MARQUEUR} : commandé, planifié (fait et à venir), reste à planifier */}
                                          {(() => {
                                            const futurU = lignes
                                              .filter((x) => x.affaire_id === a.id)
                                              .reduce((s, x) => s + (planif.futur.get(x.id)?.heures ?? 0) / (f.unite === "JOUR" ? x.base_horaire || f.base : 1), 0);
                                            const q = f.quantite ?? 0;
                                            const planifie = f.consomme + futurU;
                                            const restant = q - planifie;
                                            const n = (v: number) => texteHeures(Math.round(v * 10) / 10);
                                            return (
                                              <div style={{ fontSize: 12, lineHeight: 1.4, textAlign: "right", whiteSpace: "nowrap" }}>
                                                <div>
                                                  commande <strong>{n(q)} {u}</strong>
                                                </div>
                                                <div>
                                                  planifié <strong>{n(planifie)} {u}</strong>
                                                </div>
                                                <div style={{ fontWeight: 800, color: restant < -0.05 ? "#b3261e" : "#1f2328" }}>
                                                  {restant < -0.05 ? \`dépassé \${n(-restant)} \${u}\` : \`reste \${n(Math.max(0, restant))} \${u}\`}
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </button>`;

if (compter(t, DEBUT) !== 1) echec(`${FICHIER} : pastille du reste introuvable.`);
const i = t.indexOf(DEBUT);
const j = t.indexOf(FIN, i);
if (j < 0) echec(`${FICHIER} : fin de la cellule du reste introuvable.`);
t = t.slice(0, i) + NOUVEAU + t.slice(j + FIN.length);

const R = [
  [
    "titre de la colonne",
    'title="Reste sur la commande à la fin du mois affiché, consommé sur commandé, et ce qui reste à planifier après"',
    'title="Ce qui est commandé, ce qui est planifié au relevé (fait et à venir), et ce qui reste à planifier"',
  ],
  ["libellé de la colonne", "                      Reste commande\n", "                      Commande\n"],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ colonne Commande : commande / planifié / reste, sans pastille de couleur");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
