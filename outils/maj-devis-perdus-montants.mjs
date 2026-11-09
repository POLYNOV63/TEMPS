/* ===============================================================
   MAJ SYNCHRONISATION - MONTANTS DES DEVIS PERDUS (DEVIS_PERDU_MONTANTS)

   Dans le Suivi d'affaire BE, un devis perdu a ses heures et montants à 0
   dans les colonnes habituelles ; ils sont recopiés dans les colonnes
   « … DEVIS PERDU » (BX à CL) :
     Heures méca / calcul / élec / pneu / scan / Autre DEVIS PERDU,
     Total heures DEVIS PERDU, Montant DEVIS PERDU,
     Montant méca / calcul / Elec/pneu / Scan / autre / achats / négoce DEVIS PERDU.
   À la lecture du classeur, pour une ligne « Devis perdu », chaque valeur
   à 0 (ou vide) est prise dans sa colonne « DEVIS PERDU ». Les devis
   perdus gardent ainsi leur montant et leur activité (indicateurs
   commerciaux : taux de transformation en montant, activités).

   Deux fichiers, la même lecture :
   - lib/suiviAffaires.ts (aperçu dans l'application) ;
   - supabase/functions/synchroniser-suivi-affaires/index.ts (fonction Edge,
     À RECOLLER dans Supabase › Edge Functions › Code, puis Deploy).

   À lancer à la racine du projet :   node outils/maj-devis-perdus-montants.mjs
   Tout ou rien (les deux fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "DEVIS_PERDU_MONTANTS";
const FICHIERS = ["lib/suiviAffaires.ts", "supabase/functions/synchroniser-suivi-affaires/index.ts"];

const CHAMPS = `  | "m_achats" | "m_negoce"
  // ${MARQUEUR} : colonnes « … DEVIS PERDU » (BX à CL)
  | "hp_meca" | "hp_calcul" | "hp_elec" | "hp_pneu" | "hp_scan" | "hp_autre" | "hp_total"
  | "mp_montant" | "mp_meca" | "mp_calcul" | "mp_elec_pneu" | "mp_scan" | "mp_autre" | "mp_achats" | "mp_negoce"`;

const COLONNES = `  montantautre: "m_autre", montantachats: "m_achats", montantnegoce: "m_negoce",
  // ${MARQUEUR}
  heuresmecadevisperdu: "hp_meca", heurescalculdevisperdu: "hp_calcul", heureselecdevisperdu: "hp_elec",
  heurespneudevisperdu: "hp_pneu", heuresscandevisperdu: "hp_scan", heuresautredevisperdu: "hp_autre",
  totalheuresdevisperdu: "hp_total", montantdevisperdu: "mp_montant", montantmecadevisperdu: "mp_meca",
  montantcalculdevisperdu: "mp_calcul", montantelecpneudevisperdu: "mp_elec_pneu", montantscandevisperdu: "mp_scan",
  montantautredevisperdu: "mp_autre", montantachatsdevisperdu: "mp_achats", montantnegocedevisperdu: "mp_negoce",`;

const LIREP = `    // ${MARQUEUR} : un devis perdu porte ses heures et montants dans les colonnes « … DEVIS PERDU »
    const perdu = statut === "Devis perdu";
    const lireP = (champ: Champ, champPerdu: Champ, nom: string): number => {
      const x = lireN(champ, nom);
      return perdu && x === 0 ? lireN(champPerdu, \`\${nom} DEVIS PERDU\`) : x;
    };
`;

const APPELS = [
  ['lireN("h_meca", "Heures méca")', 'lireP("h_meca", "hp_meca", "Heures méca")'],
  ['lireN("h_calcul", "Heures calcul")', 'lireP("h_calcul", "hp_calcul", "Heures calcul")'],
  ['lireN("h_elec", "Heures élec")', 'lireP("h_elec", "hp_elec", "Heures élec")'],
  ['lireN("h_pneu", "Heures pneu")', 'lireP("h_pneu", "hp_pneu", "Heures pneu")'],
  ['lireN("h_scan", "Heures scan")', 'lireP("h_scan", "hp_scan", "Heures scan")'],
  ['lireN("h_autre", "Heures autre")', 'lireP("h_autre", "hp_autre", "Heures autre")'],
  ['lireN("m_montant", "Montant")', 'lireP("m_montant", "mp_montant", "Montant")'],
  ['lireN("m_meca", "Montant méca")', 'lireP("m_meca", "mp_meca", "Montant méca")'],
  ['lireN("m_calcul", "Montant calcul")', 'lireP("m_calcul", "mp_calcul", "Montant calcul")'],
  ['lireN("m_elec_pneu", "Montant Elec/pneu")', 'lireP("m_elec_pneu", "mp_elec_pneu", "Montant Elec/pneu")'],
  ['lireN("m_scan", "Montant Scan")', 'lireP("m_scan", "mp_scan", "Montant Scan")'],
  ['lireN("m_autre", "Montant autre")', 'lireP("m_autre", "mp_autre", "Montant autre")'],
  ['lireN("m_achats", "Montant achats")', 'lireP("m_achats", "mp_achats", "Montant achats")'],
  ['lireN("m_negoce", "Montant négoce")', 'lireP("m_negoce", "mp_negoce", "Montant négoce")'],
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

const resultats = [];
for (const f of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  const r = [
    ["liste des champs", '  | "m_achats" | "m_negoce"', CHAMPS],
    ["titres des colonnes", '  montantautre: "m_autre", montantachats: "m_achats", montantnegoce: "m_negoce",', COLONNES],
    ["lecture des heures", "    const h = {\n", LIREP + "    const h = {\n"],
    [
      "total des heures",
      '    const vTotal = v.h_total;\n    let heures_total = lireN("h_total", "Total heures");',
      '    const vTotal = perdu && !lireNombre(v.h_total).valeur ? v.hp_total : v.h_total;\n    let heures_total = lireP("h_total", "hp_total", "Total heures");',
    ],
    ...APPELS.map(([a, b]) => [a, a, b]),
  ];
  for (const [nom, a] of r) if (compter(t, a) !== 1) echec(`${f} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
  for (const [, a, b] of r) t = t.replace(a, () => b);
  resultats.push([f, t]);
}
for (const [f, t] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : colonnes « DEVIS PERDU » lues`);
}
console.log("\n✓ Terminé. Puis : npm run build, et recoller la fonction Edge dans Supabase (voir les explications).");
