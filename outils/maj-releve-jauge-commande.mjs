/* ===============================================================
   MAJ RELEVÉ PE / PI - COLONNE COMMANDE EN JAUGE (JAUGE_COMMANDE)

   Les trois lignes « commande / planifié / reste » deviennent :
     62,5 / 62,5 h        (planifié / commandé)
     ▬▬▬▬▬▬▬▬▬▬           (jauge fine, bleu ardoise ; rouge si dépassé)
     ✓ tout planifié      (ou « reste 18 j », ou « dépassé 3 j » en rouge)
   Le détail complet reste au survol, et un clic ouvre la fiche commande.

   À installer APRÈS maj-releve-trois-chiffres.mjs.
   À lancer à la racine du projet :   node outils/maj-releve-jauge-commande.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/prestations/page.tsx";
const MARQUEUR = "JAUGE_COMMANDE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
if (!t.includes("RESTE_TROIS_CHIFFRES")) echec(`${FICHIER} : installez d’abord maj-releve-trois-chiffres.zip.`);

const DEBUT = '                                            return (\n                                              <div style={{ fontSize: 12, lineHeight: 1.4, textAlign: "right", whiteSpace: "nowrap" }}>';
const FIN = "                                            );\n                                          })()}\n                                        </button>";
const i = t.indexOf(DEBUT);
const j = i < 0 ? -1 : t.indexOf(FIN, i);
if (i < 0 || j < 0) echec(`${FICHIER} : cellule « Commande » introuvable.`);

const NOUVEAU = `                                            // ${MARQUEUR} : planifié / commandé, une jauge fine, et ce qui reste
                                            const depasse = restant < -0.05;
                                            const part = q > 0 ? Math.min(1, planifie / q) : 0;
                                            return (
                                              <div
                                                title={\`Commande \${n(q)} \${u} · planifié \${n(planifie)} \${u} (fait et à venir) · \${depasse ? \`dépassé de \${n(-restant)} \${u}\` : \`reste \${n(Math.max(0, restant))} \${u} à planifier\`}\`}
                                                style={{ width: 92, marginLeft: "auto", textAlign: "right", fontSize: 12, lineHeight: 1.25, whiteSpace: "nowrap" }}
                                              >
                                                <div>
                                                  <strong style={{ fontSize: 13, color: "#1f2328" }}>{n(planifie)}</strong>
                                                  <span style={{ color: C.gris }}> / {n(q)} {u}</span>
                                                </div>
                                                <div style={{ height: 5, background: "#e6e8eb", borderRadius: 3, margin: "4px 0 3px", overflow: "hidden" }}>
                                                  <div style={{ width: \`\${part * 100}%\`, height: "100%", background: depasse ? "#b3261e" : "#34506b", borderRadius: 3 }} />
                                                </div>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: depasse ? "#b3261e" : C.gris }}>
                                                  {depasse ? \`dépassé \${n(-restant)} \${u}\` : restant <= 0.05 ? "✓ tout planifié" : \`reste \${n(restant)} \${u}\`}
                                                </div>
                                              </div>
`;
t = t.slice(0, i) + NOUVEAU + t.slice(j);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ colonne Commande : planifié / commandé, jauge, reste");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
