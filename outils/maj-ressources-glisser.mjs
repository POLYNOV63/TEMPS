/* ===============================================================
   Planning par ressource sur téléphone : comme le planning des affaires,
   il garde une largeur minimale et se fait glisser de côté (au lieu
   d'écraser les jours dans l'écran) ; la colonne des noms reste fixe à
   gauche pendant qu'on glisse.
   Utilisation (à la racine du projet) :  node outils/maj-ressources-glisser.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/ressources/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("RESSOURCES_GLISSER")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const fixe = `position: "sticky", left: 0, zIndex: 4, background: "#ffffff", `;
const changements = [
  [
    "Largeur minimale : la page glisse de côté",
    `          <section style={{ ...page.carte, padding: 10 }}>`,
    `          {/* RESSOURCES_GLISSER : largeur minimale (22 px par jour), la page se fait glisser de côté sur téléphone */}
          <section style={{ ...page.carte, padding: 10, minWidth: LARGEUR_NOM + 96 + colonnes.length * 22 }}>`,
  ],
  [
    "En-tête « Personne » fixe à gauche",
    `<div style={{ gridColumn: 1, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: C.gris }}>Personne</div>`,
    `<div style={{ ${fixe}gridColumn: 1, gridRow: "1 / span 3", display: "flex", alignItems: "flex-end", padding: "0 0 6px 4px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: C.gris }}>Personne</div>`,
  ],
  [
    "Noms fixes à gauche",
    "<div style={{ gridColumn: 1, gridRow: `1 / span ${l.voies + 1}`, display: \"flex\", flexDirection: \"column\", justifyContent: \"center\", paddingLeft: 4 }}>",
    "<div style={{ " + fixe + "gridColumn: 1, gridRow: `1 / span ${l.voies + 1}`, display: \"flex\", flexDirection: \"column\", justifyContent: \"center\", paddingLeft: 4, boxShadow: \"4px 0 6px -5px rgba(0,0,0,.25)\" }}>",
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
console.log("\nTerminé : le planning par ressource se fait glisser sur téléphone.");
