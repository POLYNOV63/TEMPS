/* ===============================================================
   Tableau de bord : la carte « Guide » n'est plus proposée aux
   collaborateurs (le guide est réservé aux responsables et à
   l'administration, qui l'ont dans leur bandeau ou leur espace).
   Utilisation (à la racine du projet) :  node outils/maj-guide-responsables.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/dashboard/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("GUIDE_RESPONSABLES")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const cherche = `        <CarteCompacte
          icone="📘"
          titre="Guide"
          description="Comment fonctionne l’Espace POLYNOV, pas à pas"
          onClick={() => aller("/guide")}
        />`;
if (texte.split(cherche).length !== 2) {
  console.error("✗ Carte « Guide » introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
texte = texte.replace(
  cherche,
  `        {/* GUIDE_RESPONSABLES : le guide est réservé aux responsables (avecBilanAffaire = faux pour eux) */}
        {!avecBilanAffaire && (
          <CarteCompacte
            icone="📘"
            titre="Guide"
            description="Comment fonctionne l’Espace POLYNOV, pour les responsables"
            onClick={() => aller("/guide")}
          />
        )}`
);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Carte « Guide » réservée aux responsables\n\nTerminé.");
