/* ===============================================================
   Planning des affaires : le n° d'une affaire ouvre le BILAN D'AFFAIRE
   pour tout le monde (avant : la fiche de l'affaire, réservée, qui
   renvoyait les collaborateurs au tableau de bord).
   Utilisation (à la racine du projet) :  node outils/maj-lien-bilan.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const f = "app/pilotage/affaires/page.tsx";
if (!existsSync(f)) {
  console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
if (t.includes("LIEN_BILAN")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const avant = '<Link href={`/pilotage/affaire/${affaire.id}`} style={{ fontWeight: 800, fontSize: 15, color: C.rougeFonce }}>';
const apres =
  '{/* LIEN_BILAN : le bilan d\'affaire, ouvert à tous */}\n' +
  '                <Link href={`/affaires/bilan?affaire=${affaire.type}${affaire.numero.match(/^\\d+/)?.[0] ?? affaire.numero}&commande=${encodeURIComponent(affaire.numero)}`} title="Bilan de l’affaire" style={{ fontWeight: 800, fontSize: 15, color: C.rougeFonce }}>';
if (t.split(avant).length !== 2) {
  console.error("✗ Lien du n° d'affaire introuvable. Rien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(f, t.replace(avant, () => apres), "utf8");
console.log("✓ Planning des affaires : le n° ouvre le bilan d'affaire\n\nTerminé.");
