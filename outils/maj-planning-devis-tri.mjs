/* ===============================================================
   Planning des affaires (app/pilotage/affaires/page.tsx) :
   - un devis envoyé (ou perdu) quitte le planning, même s'il avait des
     affectations : il ne reste plus dans « Affaires livrées » ;
   - les affaires les plus récentes en haut (n° le plus grand d'abord),
     chaque avenant restant juste sous sa commande de base.
   Utilisation (à la racine du projet) :  node outils/maj-planning-devis-tri.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/affaires/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("PLANNING_TRI_RECENT")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Devis envoyé ou perdu : hors du planning",
    `        const actives = af.filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE" || avecAffectations.has(a.id));`,
    `        // DEVIS_ENVOYE_HORS_PLANNING : un devis envoyé (ou perdu) quitte le planning, même avec des affectations
        const actives = af.filter((a) => a.statut === "EN_COURS" || a.statut === "EN_ATTENTE" || (avecAffectations.has(a.id) && a.type !== "DBE"));`,
  ],
  [
    "Affaires en cours : plus récentes en haut",
    `            // ORDRE_PAR_NUMERO : plus anciennes d'abord, avenant juste sous sa commande de base
            rangGroupe(a) - rangGroupe(b) ||
            (a.type === b.type ? 0 : a.type === "CBE" ? -1 : 1) ||
            a.numero.localeCompare(b.numero, "fr", { numeric: true })`,
    `            // PLANNING_TRI_RECENT : plus récentes d'abord (n° de base le plus grand), avenant juste sous sa commande de base
            rangGroupe(a) - rangGroupe(b) ||
            (a.type === b.type ? 0 : a.type === "CBE" ? -1 : 1) ||
            Number(b.numero.match(/^\\d+/)?.[0] ?? 0) - Number(a.numero.match(/^\\d+/)?.[0] ?? 0) ||
            a.numero.localeCompare(b.numero, "fr", { numeric: true })`,
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
console.log("\nTerminé : devis envoyés hors du planning, affaires les plus récentes en haut.");
