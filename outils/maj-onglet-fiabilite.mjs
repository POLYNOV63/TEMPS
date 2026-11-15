// ONGLET_FIABILITE : ajoute « Fiabilité chiffrage » au bandeau de navigation du Pilotage, après « Capacité ».
// Relançable sans risque : ne fait rien si l'onglet y est déjà.
import { readFileSync, writeFileSync } from "node:fs";

const fichier = "components/pilotage/OngletsPilotage.tsx";
let texte = readFileSync(fichier, "utf8");

if (texte.includes("/analyse/fiabilite-chiffrage")) {
  console.log("Déjà fait : l'onglet Fiabilité du chiffrage est dans le bandeau.");
  process.exit(0);
}

const lignes = texte.split("\n");
const i = lignes.findIndex((l) => l.includes('cle: "capacite"'));
if (i < 0) {
  console.error(`ÉCHEC : l'onglet « Capacité » est introuvable dans ${fichier}. Rien n'a été modifié.`);
  process.exit(1);
}
const retrait = lignes[i].match(/^\s*/)[0];
lignes.splice(
  i + 1,
  0,
  `${retrait}{ cle: "fiabilite", groupe: 4, court: "Fiabilité chiffrage", libelle: "Fiabilité du chiffrage", href: "/analyse/fiabilite-chiffrage", droit: "indicateurs" },`
);
writeFileSync(fichier, lignes.join("\n"), "utf8");
console.log("OK : « Fiabilité chiffrage » ajouté au bandeau, après « Capacité ».");
