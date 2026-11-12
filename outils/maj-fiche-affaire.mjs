/* ===============================================================
   FICHE AFFAIRE (MONTANTS_FICHE_AFFAIRE)

   Modifie :
   - app/affaires/bilan/page.tsx : la page s'appelle « Fiche affaire » ;
     le bloc des montants reçoit les heures pointées par activité ;
   - components/pilotage/OngletsPilotage.tsx : l'onglet « Bilan affaire »
     devient « Fiche affaire ».
   Tout ou rien, relançable.
================================================================ */

import fs from "node:fs";
import path from "node:path";

const racine = process.cwd();
const erreurs = [];
const ecritures = [];

function echec(message) {
  erreurs.push(message);
}

function lire(rel) {
  const p = path.join(racine, rel);
  if (!fs.existsSync(p)) {
    echec(`Fichier introuvable : ${rel}`);
    return null;
  }
  const brut = fs.readFileSync(p, "utf8");
  return { p, rel, crlf: brut.includes("\r\n"), texte: brut.replace(/\r\n/g, "\n") };
}

function remplacer(fichier, cherche, remplace, libelle) {
  const n = fichier.texte.split(cherche).length - 1;
  if (n !== 1) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : 1 fois).`);
    return;
  }
  fichier.texte = fichier.texte.replace(cherche, () => remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

function remplacerRe(fichier, re, remplace, libelle) {
  const n = (fichier.texte.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? []).length;
  if (n !== 1) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : 1 fois).`);
    return;
  }
  fichier.texte = fichier.texte.replace(re, remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

/* passage cherché mot à mot, les espaces et retours à la ligne pouvant varier */
function remplacerSouple(fichier, cherche, remplace, libelle) {
  const motif = cherche.trim().split(/\s+/).map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  remplacerRe(fichier, new RegExp(motif), () => remplace, libelle);
}


const bilan = lire("app/affaires/bilan/page.tsx");
if (bilan && bilan.texte.includes("MONTANTS_FICHE_AFFAIRE")) {
  console.log("  = app/affaires/bilan/page.tsx : déjà à jour");
} else if (bilan) {
  remplacerSouple(bilan, "{affaire.type === \"CBE\" && <BilanFinancierAffaire type={affaire.type} numero={affaire.numero} />}", "{/* MONTANTS_FICHE_AFFAIRE : montants (droit « Montants des affaires »), avec les heures pointées par activité */}\n            {affaire.type === \"CBE\" && (\n              <BilanFinancierAffaire\n                type={affaire.type}\n                numero={affaire.numero}\n                realiseParActivite={new Map(bilan.parActivite.map((a) => [a.id, a.realise]))}\n                correspondance={correspondance}\n              />\n            )}", "bloc des montants : heures pointées par activité");
  remplacerSouple(bilan, "<h1 style={page.titre}>Bilan affaire</h1>", "<h1 style={page.titre}>Fiche affaire</h1>", "titre « Fiche affaire »");
  remplacerSouple(bilan, "<EnTetePage section=\"Bilan affaire\" />", "<EnTetePage section=\"Pilotage BE\" />", "en-tête");
  ecritures.push(bilan);
}

const onglets = erreurs.length ? null : lire("components/pilotage/OngletsPilotage.tsx");
if (onglets && onglets.texte.includes('court: "Fiche affaire"')) {
  console.log("  = components/pilotage/OngletsPilotage.tsx : déjà à jour");
} else if (onglets) {
  remplacerSouple(onglets, "court: \"Bilan affaire\", libelle: \"Bilan affaire\"", "court: \"Fiche affaire\", libelle: \"Fiche affaire\"", "onglet « Fiche affaire »");
  ecritures.push(onglets);
}

/* 6. Tout ou rien */
if (erreurs.length > 0) {
  console.error("\n✗ RIEN N'A ÉTÉ MODIFIÉ. Problème(s) :");
  for (const e of erreurs) console.error(`  - ${e}`);
  console.error("\nCopiez ce message à Claude.");
  process.exit(1);
}

for (const f of ecritures) {
  fs.writeFileSync(f.p, f.crlf ? f.texte.replace(/\n/g, "\r\n") : f.texte, "utf8");
}

console.log(
  ecritures.length > 0
    ? `\n✓ Terminé : ${ecritures.length} fichier(s) mis à jour. Étape suivante : npm run build`
    : "\n✓ Rien à faire : tout était déjà à jour. Étape suivante : npm run build"
);
