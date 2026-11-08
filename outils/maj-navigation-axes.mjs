/* ===============================================================
   MAJ - NAVIGATION PAR AXES (NAVIGATION_AXES)

   - components/pilotage/OngletsPilotage.tsx (fourni dans le ZIP) : le
     bandeau du haut est rangé en axes (Affaires · Charge · Analyses), puis
     les pages de l'axe ; on y trouve toutes les pages accessibles ;
   - ce bandeau est ajouté aux pages qui ne l'avaient pas : Bilan affaire,
     Disponibilités par activité, Analyse de capacité, Cartographie,
     Rentabilité, Finances, Facturation du mois ;
   - Suivi des affaires : « Cumul » devient « Depuis l'ouverture ».

   À lancer à la racine du projet :   node outils/maj-navigation-axes.mjs
   Relançable sans risque (une page introuvable ou déjà faite est passée).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "NAVIGATION_AXES";
const COMPOSANT = "components/pilotage/OngletsPilotage.tsx";
const PAGES = [
  ["app/affaires/bilan/page.tsx", "bilan"],
  ["app/analyse/charge-activites/page.tsx", "charge-activites"],
  ["app/admin/bilans/page.tsx", "capacite"],
  ["app/analyse/effectifs/page.tsx", "effectifs"],
  ["app/analyse/rentabilite/page.tsx", "rentabilite"],
  ["app/analyse/finances/page.tsx", "finances"],
  ["app/analyse/facturation/page.tsx", "facturation"],
];
const IMPORT_ENTETE = 'import EnTetePage from "@/components/EnTetePage";';
const IMPORT_ONGLETS = 'import OngletsPilotage from "@/components/pilotage/OngletsPilotage";';

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Copiez ce message à Claude.\n`);
  process.exit(1);
}
if (!existsSync(COMPOSANT) || !readFileSync(COMPOSANT, "utf8").includes(MARQUEUR))
  echec(`${COMPOSANT} n'est pas la nouvelle version : décompressez d'abord le ZIP à la racine du projet.`);

for (const [f, cle] of PAGES) {
  if (!existsSync(f)) {
    console.log(`– ${f} : absente, passée`);
    continue;
  }
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes("<OngletsPilotage")) {
    console.log(`✓ ${f} : a déjà le bandeau`);
    continue;
  }
  const balises = t.match(/<EnTetePage section="[^"]*" \/>/g) ?? [];
  if (balises.length === 0 || !t.includes(IMPORT_ENTETE)) {
    console.log(`⚠ ${f} : en-tête introuvable, page passée (à me signaler)`);
    continue;
  }
  t = t.replace(IMPORT_ENTETE, () => `${IMPORT_ENTETE}\n${IMPORT_ONGLETS}`);
  t = t.replace(/(\n([ \t]*)<EnTetePage section="[^"]*" \/>)/g, (m, tout, indent) => `${tout}\n${indent}{/* ${MARQUEUR} */}<OngletsPilotage actif="${cle}" />`);
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : bandeau ajouté (${balises.length} endroit${balises.length > 1 ? "s" : ""})`);
}

/* Suivi des affaires : « Cumul » → « Depuis l'ouverture » */
const SUIVI = "app/pilotage/page.tsx";
if (existsSync(SUIVI)) {
  let t = readFileSync(SUIVI, "utf8").replace(/\r\n/g, "\n");
  const a = '                    ["CUMUL", "Cumul"],';
  if (t.includes(a)) {
    t = t
      .replace(a, () => '                    ["CUMUL", "Depuis l’ouverture"],')
      .replace('<strong style={{ fontSize: 14 }}>Pointé :</strong>', () => '<strong style={{ fontSize: 14 }}>Heures pointées :</strong>');
    writeFileSync(SUIVI, t, "utf8");
    console.log(`✓ ${SUIVI} : « Cumul » devient « Depuis l’ouverture »`);
  } else console.log(`✓ ${SUIVI} : rien à changer`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
