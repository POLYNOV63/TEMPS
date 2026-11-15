// RESSOURCES_FUSION : une seule page « Ressources » à la place de Planning par ressource,
// Charge par ressource, Disponibilités par activité et Cartographie de l'équipe.
// Met à jour le bandeau d'onglets et la liste des pages des droits.
// Relançable : ce qui est déjà fait est sauté. Tout ou rien : rien n'est écrit si un repère manque.
import { readFileSync, writeFileSync } from "node:fs";

const fichiers = [
  {
    chemin: "components/pilotage/OngletsPilotage.tsx",
    retirer: [/^.*\{ cle: "ressources", groupe:.*"\/pilotage\/ressources".*\r?\n/m, /^.*\{ cle: "charge-activites", groupe:.*\r?\n/m, /^.*\{ cle: "effectifs", groupe:.*\r?\n/m],
    renommer: [[/court: "Planning ressources", libelle: "Planning par ressource"/, 'court: "Ressources", libelle: "Ressources : planning, charge, équipe"']],
    fait: /court: "Ressources", libelle: "Ressources : planning, charge, équipe"/,
  },
  {
    chemin: "lib/droits.ts",
    retirer: [/^.*\{ href: "\/analyse\/effectifs",.*\r?\n/m, /^.*\{ href: "\/pilotage\/ressources",.*\r?\n/m, /^.*\{ href: "\/analyse\/charge-activites",.*\r?\n/m],
    renommer: [[/\{ href: "\/pilotage\/planning-ressources", libelle: "Planning par ressource"/, '{ href: "/pilotage/planning-ressources", libelle: "Ressources (planning, charge, équipe)"']],
    fait: /libelle: "Ressources \(planning, charge, équipe\)"/,
  },
];

const resultats = [];
let echec = false;
for (const f of fichiers) {
  let texte;
  try {
    texte = readFileSync(f.chemin, "utf8");
  } catch {
    console.log(`ÉCHEC : fichier introuvable ${f.chemin} (lancez le script depuis le dossier du projet)`);
    echec = true;
    continue;
  }
  let nouveau = texte;
  let modifs = 0;
  for (const r of f.retirer) {
    if (r.test(nouveau)) {
      nouveau = nouveau.replace(r, "");
      modifs++;
    }
  }
  for (const [r, remplacement] of f.renommer) {
    if (r.test(nouveau)) {
      nouveau = nouveau.replace(r, remplacement);
      modifs++;
    }
  }
  if (!f.fait.test(nouveau)) {
    console.log(`ÉCHEC : repère introuvable dans ${f.chemin} (« Planning par ressource »)`);
    echec = true;
    continue;
  }
  resultats.push({ f, nouveau, modifs });
}

if (echec) {
  console.log("Rien n'a été modifié.");
  process.exit(1);
}
for (const { f, nouveau, modifs } of resultats) {
  if (modifs === 0) console.log(`Déjà fait : ${f.chemin}`);
  else {
    writeFileSync(f.chemin, nouveau, "utf8");
    console.log(`OK : ${f.chemin} (${modifs} modification${modifs > 1 ? "s" : ""})`);
  }
}
