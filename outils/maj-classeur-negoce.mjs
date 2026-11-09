/* ===============================================================
   MAJ - NOUVELLES COLONNES DU SUIVI D'AFFAIRE BE (NEGOCE_INTERGROUPE)

   Le classeur change :
     Autre (case F)            -> Négoce
     Heures autre              -> Heures négoce
     Montant autre             -> Montant heures négoce
     (devis perdus)            -> Heures négoce DEVIS PERDU, Montant heure négoce DEVIS PERDU
     + colonne Intergroupe (Oui) ; imputations : BE (ou Forfait), PE, PI.
   L'application comprend les DEUX formats (anciens titres gardés).

   1. Lecture du classeur (lib/suiviAffaires.ts et fonction Edge) :
      - les nouveaux titres sont lus dans les champs existants (heures /
        montant « autre », qui portent désormais le négoce) ;
      - « Forfait » vaut BE ; une ligne au forfait cochée « Intergroupe »
        reste IG pour l'application (trame CA, Finances inchangées).
   2. lib/finances.ts : heures et montant de négoce vont dans le groupe
      « Négoce » (plus de groupe « Autre » rempli).
   3. Indicateurs commerciaux : idem ; « Autre / non ventilé » devient
      « Non ventilé ».

   À lancer à la racine du projet :   node outils/maj-classeur-negoce.mjs
   Tout ou rien. Relançable sans risque.
   PUIS recoller la fonction Edge dans Supabase (comme d'habitude).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "NEGOCE_INTERGROUPE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};

/* ---------- 1. lecture du classeur ---------- */
const LECTEURS = ["lib/suiviAffaires.ts", "supabase/functions/synchroniser-suivi-affaires/index.ts"];
const R_LECTEUR = [
  ["champ Intergroupe", '  | "numero_arc_louxor";', '  | "numero_arc_louxor"\n  | "intergroupe"; // ' + MARQUEUR],
  [
    "nouveaux titres",
    "  narclouxor: \"numero_arc_louxor\",\n};",
    `  narclouxor: "numero_arc_louxor",
  // ${MARQUEUR} : nouveaux titres du classeur (les anciens restent compris)
  negoce: "ind_autre", heuresnegoce: "h_autre", montantheuresnegoce: "m_autre",
  heuresnegocedevisperdu: "hp_autre", montantheurenegocedevisperdu: "mp_autre", montantheuresnegocedevisperdu: "mp_autre",
  intergroupe: "intergroupe",
};`,
  ],
  [
    "imputation Forfait / Intergroupe",
    "    let imputation = texte(v.imputation);\n",
    `    let imputation = texte(v.imputation);
    // ${MARQUEUR} : « Forfait » vaut BE ; une ligne au forfait cochée « Intergroupe » reste IG pour l'application
    if (imputation && sansAccent(imputation) === "forfait") imputation = "BE";
    if (["oui", "o", "x", "1", "vrai", "yes", "true"].includes(sansAccent(texte(v.intergroupe) ?? "")) && (!imputation || sansAccent(imputation) === "be")) imputation = "IG";
`,
  ],
  ["libellé des heures", 'lireP("h_autre", "hp_autre", "Heures autre")', 'lireP("h_autre", "hp_autre", "Heures négoce")'],
  ["libellé du montant", 'lireP("m_autre", "mp_autre", "Montant autre")', 'lireP("m_autre", "mp_autre", "Montant heures négoce")'],
];

/* ---------- 2. lib/finances ---------- */
const FIN = "lib/finances.ts";
const R_FIN = [
  ["heures de négoce", '  scan: "Scan",\n  autre: "Autre",\n};', `  scan: "Scan",\n  autre: "Négoce", // ${MARQUEUR} : la colonne « Heures négoce » (ex-« Heures autre »)\n};`],
  ["montant de négoce", '  g.Autre = m.autre * k;\n  g["Négoce"] = m.negoce * k;', '  // « Montant heures négoce » (ex-« Montant autre ») va avec le négoce\n  g["Négoce"] = (m.negoce + m.autre) * k;'],
];

/* ---------- 3. indicateurs ---------- */
const IND = "app/pilotage/indicateurs/page.tsx";
const R_IND = [
  ["libellé", '  autre: { nom: "Autre / non ventilé", couleur: "#9aa0a6" },', `  autre: { nom: "Non ventilé", couleur: "#9aa0a6" }, // ${MARQUEUR}`],
  ["montants", "negoce: n(m.montant_negoce), autre: n(m.montant_autre) },", "negoce: n(m.montant_negoce) + n(m.montant_autre), autre: 0 },"],
  ["heures", "scan: l.heures.scan, negoce: 0, autre: l.heures.autre };", "scan: l.heures.scan, negoce: l.heures.autre, autre: 0 };"],
];

const sorties = [];
const traiter = (f, regles, optionnel = false) => {
  if (optionnel && !existsSync(f)) return console.log(`– ${f} : absent, passé`);
  let t = lire(f);
  if (t.includes(MARQUEUR)) return console.log(`✓ ${f} : déjà à jour`);
  for (const [nom, a] of regles) if (compter(t, a) !== 1) echec(`${f} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
  for (const [, a, b] of regles) t = t.replace(a, () => b);
  sorties.push([f, t]);
};
for (const f of LECTEURS) traiter(f, R_LECTEUR);
traiter(FIN, R_FIN);
traiter(IND, R_IND, true);

for (const [f, t] of sorties) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} mis à jour`);
}
console.log("\n✓ Terminé. Puis : npm run build, et recoller la fonction Edge dans Supabase.");
