/* ===============================================================
   Droits d'accès :
   - relevé PE / PI : ADMIN et RESPONSABLE (au lieu d'ADMIN seul) ;
   - bilan d'affaire : ouvert à tous (nouveau droit « voirBilanAffaire »,
     niveau 0, et Direction) : le clic sur un n° d'affaire au planning
     ouvre le bilan au lieu de renvoyer au tableau de bord. Les montants
     restent protégés par la base (invisibles des collaborateurs).
   - charge par ressource : inchangé (ADMIN et Direction).
   Utilisation (à la racine du projet) :  node outils/maj-droits.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichierDroits = "lib/droits.ts";
const fichierBilan = "app/affaires/bilan/page.tsx";
for (const f of [fichierDroits, fichierBilan]) {
  if (!existsSync(f)) {
    console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
}
let droits = readFileSync(fichierDroits, "utf8").replace(/\r\n/g, "\n");
let bilan = readFileSync(fichierBilan, "utf8").replace(/\r\n/g, "\n");
if (droits.includes("voirBilanAffaire") && bilan.includes('"voirBilanAffaire"')) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(nom, texte, cherche, remplace) {
  if (texte.split(cherche).length !== 2) {
    console.error(`✗ ${nom} : passage introuvable`);
    erreurs++;
    return texte;
  }
  console.log(`✓ ${nom}`);
  return texte.replace(cherche, () => remplace);
}

droits = remplacer(
  "Relevé PE / PI ouvert aux responsables",
  droits,
  "  relevePrestations: 2, // relevé PE / PI (taux, heures facturées) : il alimente le planning des PE / PI",
  "  relevePrestations: 1, // relevé PE / PI (taux, heures facturées) : ADMIN et RESPONSABLE ; il alimente le planning des PE / PI"
);
droits = remplacer(
  "Nouveau droit : bilan d'affaire pour tous",
  droits,
  "  voirPlanning: 0, // Planning des affaires : lecture pour tous",
  "  voirPlanning: 0, // Planning des affaires : lecture pour tous\n  voirBilanAffaire: 0, // Bilan d'affaire (chiffré, pointé, avancement) : lecture pour tous ; les montants restent protégés par la base"
);
droits = remplacer(
  "Bilan d'affaire pour la Direction",
  droits,
  'new Set(["voirPlanning", "chargeRessources", "indicateurs"])',
  'new Set(["voirPlanning", "voirBilanAffaire", "chargeRessources", "indicateurs"])'
);

const garde = bilan.match(/<GardeAcces droit=\{?"(\w+)"\}?>/);
if (!garde) {
  console.error("✗ Bilan d'affaire : garde d'accès introuvable");
  erreurs++;
} else {
  bilan = bilan.replace(garde[0], '<GardeAcces droit="voirBilanAffaire">');
  console.log(`✓ Bilan d'affaire : droit « ${garde[1]} » remplacé par « voirBilanAffaire »`);
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(fichierDroits, droits, "utf8");
writeFileSync(fichierBilan, bilan, "utf8");
console.log("\nTerminé.");
