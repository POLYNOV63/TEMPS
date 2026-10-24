/* ===============================================================
   Portefeuille : si l'enregistrement d'un DBE (rédacteur, date de rendu)
   échoue, la raison s'affiche DANS la ligne du formulaire (et plus
   seulement en haut du tableau, hors de vue).
   Prérequis : maj-portefeuille-dbe.mjs puis maj-portefeuille-dbe-v2.mjs.
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-dbe-erreur.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin}`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ERREUR_DBE_VISIBLE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("AFFECTER_DBE_V2")) {
  console.error("✗ Lancez d'abord : node outils/maj-portefeuille-dbe-v2.mjs");
  process.exit(1);
}
const avant = `                        <button type="button" onClick={() => setEdDbe(null)} style={{ ...page.btnSecondaire, minHeight: 38 }}>
                          Annuler
                        </button>
                      </div>`;
const apres = `                        <button type="button" onClick={() => setEdDbe(null)} style={{ ...page.btnSecondaire, minHeight: 38 }}>
                          Annuler
                        </button>
                      </div>
                      {/* ERREUR_DBE_VISIBLE */}
                      {erreurPlanning && <div role="alert" style={{ color: "#b3261e", fontWeight: 700, marginTop: 8 }}>{erreurPlanning}</div>}`;
const nb = texte.split(avant).length - 1;
if (nb !== 1) {
  console.error(`✗ Formulaire du DBE trouvé ${nb} fois (attendu 1). Rien n'a été modifié : copiez ce message à Claude.`);
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, texte, "utf8");
writeFileSync(chemin, texte.replace(avant, apres), "utf8");
console.log("✓ Message d'erreur dans la ligne du formulaire\n\nTerminé.");
