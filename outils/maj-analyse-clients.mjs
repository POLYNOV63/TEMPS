// ANALYSE_CLIENTS : déclare la page « Analyse par client » dans les droits d'accès et dans le bandeau du Pilotage.
// Relançable sans risque : ne change que ce qui manque.
import { readFileSync, writeFileSync } from "node:fs";

function inserer(fichier, deja, repere, ligne, nom) {
  let texte = readFileSync(fichier, "utf8");
  if (texte.includes(deja)) {
    console.log(`Déjà fait : ${nom}.`);
    return;
  }
  const lignes = texte.split("\n");
  const i = lignes.findIndex((l) => l.includes(repere));
  if (i < 0) {
    console.error(`ÉCHEC : repère introuvable dans ${fichier} (${nom}). Rien n'a été modifié dans ce fichier.`);
    process.exitCode = 1;
    return;
  }
  const retrait = lignes[i].match(/^\s*/)[0];
  lignes.splice(i + 1, 0, retrait + ligne);
  writeFileSync(fichier, lignes.join("\n"), "utf8");
  console.log(`OK : ${nom}.`);
}

inserer(
  "lib/droits.ts",
  '"/analyse/clients"',
  'href: "/admin/bilans"',
  '{ href: "/analyse/clients", libelle: "Analyse par client", groupe: "Analyse", droit: "administration" },',
  "page déclarée dans les droits d'accès"
);
inserer(
  "components/pilotage/OngletsPilotage.tsx",
  'cle: "clients"',
  'cle: "capacite"',
  '{ cle: "clients", groupe: 4, court: "Clients", libelle: "Analyse par client", href: "/analyse/clients", droit: "administration" },',
  "onglet « Clients » dans le bandeau"
);
