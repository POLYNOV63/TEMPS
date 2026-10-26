/* ===============================================================
   Bilan affaire (app/affaires/bilan/page.tsx) : moins déroutant.
   - le bouton de recherche dit ce qu'il fait : « Ouvrir », puis « Ouvrir
     une autre affaire » quand une affaire est déjà affichée ;
   - choisir un numéro dans la liste proposée l'ouvre aussitôt ;
   - plus de doublons : le responsable et le délai ne sont plus répétés
     dans l'en-tête quand le panneau Pilotage les affiche déjà (pour les
     collaborateurs, le délai du classeur reste dans l'en-tête).
   Utilisation (à la racine du projet) :  node outils/maj-bilan-recherche.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/affaires/bilan/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("BILAN_RECHERCHE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Bouton : « Ouvrir » / « Ouvrir une autre affaire »",
    `{chargement ? "Chargement…" : "Afficher le bilan"}`,
    `{/* BILAN_RECHERCHE */}{chargement ? "Chargement…" : affaire ? "Ouvrir une autre affaire" : "Ouvrir"}`,
  ],
  [
    "Un numéro choisi dans la liste s'ouvre aussitôt",
    `            onChange={(e) => setSaisie(e.target.value)}`,
    `            onChange={(e) => {
              const v = e.target.value;
              setSaisie(v);
              // numéro choisi dans la liste proposée : on l'ouvre sans passer par le bouton
              if (suggestions.some((s) => s.cle === v)) {
                const m = v.toUpperCase().replace(/\\s/g, "").match(/^(CBE|DBE)?(\\d+)/);
                if (m) {
                  const cible = { type: ((m[1] as TypeAffaire) || type) as TypeAffaire, numero: m[2] };
                  setType(cible.type);
                  setAffaire(cible);
                  window.history.replaceState(null, "", \`?affaire=\${cible.type}\${cible.numero}\`);
                }
              }
            }}`,
  ],
  [
    "En-tête : responsable plus répété (il est dans le panneau Pilotage)",
    `                {pilotage?.responsable_id && <span>Responsable : <strong>{noms.get(pilotage.responsable_id) ?? "—"}</strong></span>}\n`,
    ``,
  ],
  [
    "En-tête : délai seulement quand le panneau Pilotage n'est pas visible",
    `{echeance && <span>Délai : <strong>{formatDate(echeance)}</strong></span>}`,
    `{echeance && !pilotage && <span>Délai : <strong>{formatDate(echeance)}</strong></span>}`,
  ],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, () => remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : recherche du bilan plus claire.");
