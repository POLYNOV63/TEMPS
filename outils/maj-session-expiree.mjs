/* ===============================================================
   Tableau de bord (app/dashboard/page.tsx) : session expirée ou absente
   (« Auth session missing! ») -> retour à la page de connexion, au lieu
   d'un message d'erreur.
   Utilisation (à la racine du projet) :  node outils/maj-session-expiree.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/dashboard/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("SESSION_EXPIREE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const cherche = `        if (erreurUtilisateur) throw erreurUtilisateur;

        if (!user) {
          router.push("/login");
          return;
        }`;
if (texte.split(cherche).length !== 2) {
  console.error("✗ Passage introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
texte = texte.replace(
  cherche,
  `        /* SESSION_EXPIREE : pas (ou plus) de session -> page de connexion, sans message d'erreur */
        if (!user || (erreurUtilisateur && /session|jwt|token/i.test(erreurUtilisateur.message ?? ""))) {
          router.push("/login");
          return;
        }

        if (erreurUtilisateur) throw erreurUtilisateur;`
);
writeFileSync(chemin, texte, "utf8");
console.log("✓ Session expirée : retour à la connexion\n\nTerminé.");
