/* ===============================================================
   Planning des affaires (app/pilotage/affaires/page.tsx) :
   - la date du jour est entourée dans le calendrier ;
   - un clic sur le trait rouge « aujourd'hui » de la barre de
     déplacement ramène le planning à la semaine en cours ;
   - plus de bouton « ✓ Livrée » sur les DBE : un devis suit le Suivi
     d'affaire BE (il passe en livré quand le devis est envoyé).
   Utilisation (à la racine du projet) :  node outils/maj-planning-aujourdhui.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/affaires/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("AUJOURDHUI_ENTOURE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "Date du jour entourée",
  `                    <div style={{ color: j === aujourdhui ? C.rougeFonce : C.encre }}>{nbSemaines > 12 ? "" : Number(j.slice(8))}</div>`,
  `                    {/* AUJOURDHUI_ENTOURE */}
                    <div style={{ color: j === aujourdhui ? C.rougeFonce : C.encre }}>
                      {nbSemaines > 12 ? (
                        ""
                      ) : j === aujourdhui ? (
                        <span
                          title="Aujourd’hui"
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", border: \`2px solid \${C.rouge}\`, boxSizing: "border-box", fontWeight: 800 }}
                        >
                          {Number(j.slice(8))}
                        </span>
                      ) : (
                        Number(j.slice(8))
                      )}
                    </div>`
);
remplacer(
  "Clic sur le trait rouge : retour à aujourd'hui",
  "                <span title=\"Aujourd’hui\" style={{ position: \"absolute\", left: `${(26 / nbPas) * 100}%`, top: -4, width: 2, height: 18, background: C.rouge }} />",
  `                <button
                  type="button"
                  title="Revenir à aujourd’hui"
                  aria-label="Revenir à aujourd’hui"
                  onClick={() => setLundi(ajouterJours(lundiDe(aujourdhui), -7))}
                  style={{ position: "absolute", left: \`calc(\${(26 / nbPas) * 100}% - 6px)\`, top: -6, width: 14, height: 22, padding: 0, border: "none", background: "transparent", cursor: "pointer", display: "flex", justifyContent: "center" }}
                >
                  <span aria-hidden="true" style={{ width: 2, height: "100%", background: C.rouge }} />
                </button>`
);
remplacer(
  "Pas de bouton « Livrée » sur les DBE",
  "{peutAgir && !(affaire as Affaire & { suivi_maj_le?: string | null }).suivi_maj_le && (",
  `{peutAgir && affaire.type !== "DBE" && !(affaire as Affaire & { suivi_maj_le?: string | null }).suivi_maj_le && (`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : date du jour entourée, retour à aujourd'hui, DBE sans « Livrée ».");
