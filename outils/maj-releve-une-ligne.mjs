/* ===============================================================
   Relevé PE / PI (app/pilotage/prestations/page.tsx) : UNE LIGNE par
   commande × personne, comme le Suivi des prestations.
   - le calendrier du mois en en-tête, fixe quand on descend ;
   - la commande et la personne fixes à gauche, le mois (en jours ou en
     heures), le montant et le reste fixes à droite ;
   - ⚙ ouvre, sous la ligne, ses réglages (personne, activité, unité,
     taux, base, intergroupe, heures sup, report) ;
   - congé validé : « CP » proposé en grisé, on peut forcer une valeur ;
   - reste : celui du Suivi des prestations (SQL 64), sinon le calcul.
   Toutes les fonctions (saisie au clavier, sélection, ⤓, 📅, reports,
   clôture, export) sont inchangées.
   Prérequis : SQL 64 passé (colonnes commande_import / reste_import).
   Utilisation (à la racine du projet) :  node outils/maj-releve-une-ligne.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const chemin = "app/pilotage/prestations/page.tsx";
const bloc = join(dirname(fileURLToPath(import.meta.url)), "releve-une-ligne.txt");
if (!existsSync(chemin) || !existsSync(bloc)) {
  console.error("✗ Fichier introuvable : décompressez le zip à la racine du projet et lancez le script depuis cette racine.");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("RELEVE_UNE_LIGNE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const nouveauBloc = readFileSync(bloc, "utf8").replace(/\r\n/g, "\n");
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "Commande et reste du classeur (type)",
  `  heures_fige: number | null;
  montant_fige: number | null;
};
type SuiviLigne`,
  `  heures_fige: number | null;
  montant_fige: number | null;
  commande_import?: number | null; // Suivi des prestations, unité de la ligne (SQL 64)
  reste_import?: number | null;
};
type SuiviLigne`
);
remplacer(
  "Commande et reste du classeur (lecture)",
  `report_sortant,heures_fige,montant_fige").lte("mois", debut)`,
  `report_sortant,heures_fige,montant_fige,commande_import,reste_import").lte("mois", debut)`
);
remplacer(
  "Commande et reste du classeur (valeurs)",
  `          report_sortant: nb(x.report_sortant),
        }));`,
  `          report_sortant: nb(x.report_sortant),
          commande_import: nb(x.commande_import),
          reste_import: nb(x.reste_import),
        }));`
);
remplacer(
  "Lignes dépliées (⚙)",
  `  const [enCours, setEnCours] = useState("");`,
  `  const [enCours, setEnCours] = useState("");
  // lignes dont les réglages (⚙) sont ouverts
  const [details, setDetails] = useState<Set<string>>(new Set());`
);

const debutBloc = `        {!chargement && (blocsAffiches.length > 0 || aStafferAffiches.length > 0) && (`;
const finBloc = `        {!chargement && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 14 }}>`;
const i = texte.indexOf(debutBloc);
const j = texte.indexOf(finBloc);
if (i < 0 || j < 0 || j < i || texte.split(debutBloc).length !== 2) {
  console.error("✗ Tableau du relevé introuvable");
  erreurs++;
} else {
  texte = texte.slice(0, i) + nouveauBloc + texte.slice(j);
  console.log("✓ Tableau : une ligne par commande, calendrier fixe");
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : relevé PE / PI sur une ligne.");
