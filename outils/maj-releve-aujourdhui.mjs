/* ===============================================================
   Relevé PE / PI : le numéro du jour d'aujourd'hui est entouré d'un petit
   cercle rouge dans le calendrier (comme au Planning des affaires).
   Compatible avec les autres scripts du relevé, installés avant ou après.
   Utilisation (à la racine du projet) :  node outils/maj-releve-aujourdhui.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/prestations/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("AUJOURDHUI_RELEVE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const cherche = `<div style={{ fontSize: j.weekend || j.ferie ? 8 : 11, lineHeight: "15px" }}>{j.jour}</div>`;
if (texte.split(cherche).length !== 2) {
  console.error("✗ Numéro des jours introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
texte = texte.replace(
  cherche,
  `{/* AUJOURDHUI_RELEVE : le jour d'aujourd'hui, entouré */}
                        {(() => {
                          const d = new Date();
                          const auj = \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, "0")}-\${String(d.getDate()).padStart(2, "0")}\`;
                          return j.date === auj ? (
                            <div style={{ lineHeight: "15px" }}>
                              <span
                                title="Aujourd’hui"
                                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", border: \`2px solid \${C.rouge}\`, boxSizing: "border-box", fontSize: 10, fontWeight: 800, color: C.rougeFonce }}
                              >
                                {j.jour}
                              </span>
                            </div>
                          ) : (
                            <div style={{ fontSize: j.weekend || j.ferie ? 8 : 11, lineHeight: "15px" }}>{j.jour}</div>
                          );
                        })()}`
);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Aujourd'hui entouré dans le calendrier\n\nTerminé.");
