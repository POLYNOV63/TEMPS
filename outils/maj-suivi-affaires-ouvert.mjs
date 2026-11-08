/* ===============================================================
   MAJ - « SUIVI DES AFFAIRES » OUVERT À TOUS (SUIVI_OUVERT)

   Le Portefeuille devient le « Suivi des affaires », consultable par
   tout le monde (collaborateurs, responsables, Direction, ADMIN) : des
   heures seulement, aucun montant. Seuls les responsables et les
   administrateurs gardent les actions (✏️ affecter un devis).
   - app/pilotage/page.tsx : accès ouvert, bouton d'action réservé, titre ;
   - app/dashboard/page.tsx : tuile « Suivi des affaires » pour les
     collaborateurs et la Direction ; « Portefeuille » renommé ;
   - app/analyse/pointage/page.tsx : l'ancienne Analyse du chiffré
     renvoie vers le Suivi des affaires (qui la reprend entièrement).

   À lancer à la racine du projet, APRÈS maj-portefeuille-periode.mjs et
   maj-tableau-par-axes.mjs :   node outils/maj-suivi-affaires-ouvert.mjs
   Tout ou rien.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "SUIVI_OUVERT";
const PORTEFEUILLE = "app/pilotage/page.tsx";
const TABLEAU = "app/dashboard/page.tsx";
const POINTAGE = "app/analyse/pointage/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
for (const f of [PORTEFEUILLE, TABLEAU, POINTAGE]) if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);

let pf = readFileSync(PORTEFEUILLE, "utf8").replace(/\r\n/g, "\n");
let tb = readFileSync(TABLEAU, "utf8").replace(/\r\n/g, "\n");
if (pf.includes(MARQUEUR) && tb.includes(MARQUEUR)) {
  console.log("✓ déjà à jour, rien à faire.");
  process.exit(0);
}
if (!pf.includes("PORTEFEUILLE_PERIODE")) echec("lancez d'abord maj-portefeuille-periode.mjs.");
if (!tb.includes("TABLEAU_PAR_AXES")) echec("lancez d'abord maj-tableau-par-axes.mjs.");

const rPf = [
  ["accès ouvert à tous", '    <GardeAcces droit="piloterBE">\n      <PortefeuilleContenu />', '    <GardeAcces droit={null}>\n      {/* SUIVI_OUVERT : consultation pour tous, actions pour les responsables et administrateurs */}\n      <PortefeuilleContenu />'],
  ["✏️ affecter réservé", '{affaire.type === "DBE" && !estInactive(affaire) && edDbe?.id !== affaire.id && (', '{moi?.peutModifier && affaire.type === "DBE" && !estInactive(affaire) && edDbe?.id !== affaire.id && ('],
  ["titre", "<h1 style={page.titre}>Portefeuille des affaires</h1>", "<h1 style={page.titre}>Suivi des affaires</h1>"],
  [
    "sous-titre",
    "Affaires DBE et CBE : chiffré, réalisé et dépassements. Réservé aux responsables et aux administrateurs.",
    "Affaires DBE et CBE : heures chiffrées, réalisées et planifiées, pour voir l’avancement et anticiper les dérives. Les responsables et les administrateurs y font aussi les affectations.",
  ],
];
for (const [nom, a] of rPf) if (compter(pf, a) !== 1) echec(`${PORTEFEUILLE} : passage « ${nom} » trouvé ${compter(pf, a)} fois (attendu : 1).`);
for (const [, a, b] of rPf) pf = pf.replace(a, () => b);

const rTb = [
  [
    "tuile pour les collaborateurs",
    '        {avecPlanning && (\n          <CarteCompacte\n            icone="🗓️"\n            titre="Planning des affaires"',
    '        {/* SUIVI_OUVERT : l\'avancement des affaires, en heures, pour tous */}\n' +
      "        {avecPlanning && (\n" +
      '          <CarteCompacte icone="🗂️" titre="Suivi des affaires" description="Chiffré, réalisé et planifié de chaque affaire, en heures" onClick={() => aller("/pilotage")} />\n' +
      "        )}\n" +
      '        {avecPlanning && (\n          <CarteCompacte\n            icone="🗓️"\n            titre="Planning des affaires"',
  ],
  [
    "tuile pour la Direction",
    '          <CarteCompacte icone="🎯" titre="Analyse du chiffré" description="Heures produites face aux heures chiffrées, par commande" onClick={() => aller("/analyse/pointage")} />',
    '          <CarteCompacte icone="🗂️" titre="Suivi des affaires" description="Chiffré, réalisé et planifié de chaque affaire, sur une période, par activité" onClick={() => aller("/pilotage")} />',
  ],
];
for (const [nom, a] of rTb) if (compter(tb, a) !== 1) echec(`${TABLEAU} : passage « ${nom} » trouvé ${compter(tb, a)} fois (attendu : 1).`);
for (const [, a, b] of rTb) tb = tb.replace(a, () => b);
const nPort = compter(tb, 'titre="Portefeuille"');
tb = tb.split('titre="Portefeuille"').join('titre="Suivi des affaires"');

const REDIRECTION = `import { redirect } from "next/navigation";

/* SUIVI_OUVERT : l'Analyse du chiffré est reprise par le Suivi des affaires (période, activité, export).
   Repères des anciennes mises à jour : NEGOCE_A_PART_CHIFFRE NEGOCE_ROBUSTE SCAN_A_PART TEMPS_PASSE_INFO MONTANT_HORS_COMPARAISON */
export default function AnalyseChiffrePage() {
  redirect("/pilotage");
}
`;

writeFileSync(PORTEFEUILLE, pf, "utf8");
writeFileSync(TABLEAU, tb, "utf8");
writeFileSync(POINTAGE, REDIRECTION, "utf8");
console.log(`✓ ${PORTEFEUILLE} : « Suivi des affaires », ouvert à tous, actions réservées`);
console.log(`✓ ${TABLEAU} : tuiles collaborateurs et Direction, « Portefeuille » renommé (${nPort} tuile${nPort > 1 ? "s" : ""})`);
console.log(`✓ ${POINTAGE} : renvoie vers le Suivi des affaires`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
