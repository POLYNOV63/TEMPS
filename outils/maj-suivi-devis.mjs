/* ===============================================================
   MAJ SUIVI DES DEVIS (SUIVI_DEVIS)

   À lancer à la racine du projet, APRÈS avoir décompressé le ZIP :
       node outils/maj-suivi-devis.mjs

   - lib/droits.ts : nouveau droit « suiviDevis » (ADMIN, RESPONSABLE,
     DIRECTION) pour ouvrir la page Suivi des devis.
   - components/pilotage/OngletsPilotage.tsx : « Suivi des devis » juste
     après « Suivi des affaires » ; « Indicateurs » retiré.

   Tout ou rien : tout est vérifié avant d'écrire quoi que ce soit.
   Relançable sans risque : ce qui est déjà fait est sauté.
================================================================ */

import fs from "node:fs";
import path from "node:path";

const racine = process.cwd();
const MARQUEUR = "SUIVI_DEVIS";
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

/* 0. Bon dossier, ZIP bien décompressé */
if (!fs.existsSync(path.join(racine, "package.json")) || !fs.existsSync(path.join(racine, "app"))) {
  console.error("✗ Lancez ce script à la racine du projet (le dossier qui contient package.json).");
  process.exit(1);
}
for (const rel of [
  "lib/suiviDevis.ts",
  "components/pilotage/devis/ListeDevis.tsx",
  "components/pilotage/devis/StatistiquesDevis.tsx",
  "app/pilotage/devis/page.tsx",
  "supabase/91_suivi_devis_relances.sql",
]) {
  if (!fs.existsSync(path.join(racine, rel))) echec(`Fichier du ZIP absent : ${rel} (le ZIP a-t-il bien été décompressé à la racine du projet ?)`);
}
const redirection = lire("app/pilotage/indicateurs/page.tsx");
if (redirection && !redirection.texte.includes(MARQUEUR)) {
  echec("app/pilotage/indicateurs/page.tsx n'est pas la nouvelle redirection : décompressez le ZIP en acceptant de remplacer les fichiers.");
}

console.log("Vérifications…");

/* 1. lib/droits.ts */
const droits = lire("lib/droits.ts");
if (droits) {
  if (droits.texte.includes("suiviDevis:")) {
    console.log("  = lib/droits.ts : déjà à jour");
  } else {
    remplacer(
      droits,
      'const DROITS_DIRECTION: ReadonlySet<string> = new Set(["voirPlanning", "chargeRessources", "indicateurs"]);',
      'const DROITS_DIRECTION: ReadonlySet<string> = new Set(["voirPlanning", "chargeRessources", "indicateurs", "suiviDevis"]); // SUIVI_DEVIS',
      "la Direction ouvre le Suivi des devis (onglet Statistiques)"
    );
    remplacer(
      droits,
      "  indicateurs: 2, // indicateurs et finances\n",
      "  indicateurs: 2, // indicateurs et finances\n  suiviDevis: 1, // SUIVI_DEVIS : page Suivi des devis (liste : ADMIN, RESPONSABLE ; statistiques : ADMIN, DIRECTION)\n",
      "nouveau droit suiviDevis"
    );
    ecritures.push(droits);
  }
}

/* 2. components/pilotage/OngletsPilotage.tsx */
const onglets = lire("components/pilotage/OngletsPilotage.tsx");
if (onglets) {
  if (onglets.texte.includes('cle: "devis"')) {
    console.log("  = components/pilotage/OngletsPilotage.tsx : déjà à jour");
  } else {
    const ligneAffaires =
      '  { cle: "portefeuille", groupe: 1, court: "Suivi des affaires", libelle: "Suivi des affaires", href: "/pilotage", droit: "voirPlanning" },\n';
    remplacer(
      onglets,
      ligneAffaires,
      ligneAffaires +
        '  { cle: "devis", groupe: 1, court: "Suivi des devis", libelle: "Suivi des devis", href: "/pilotage/devis", droit: "suiviDevis" }, // SUIVI_DEVIS\n',
      "onglet « Suivi des devis » après « Suivi des affaires »"
    );
    remplacer(
      onglets,
      '  { cle: "indicateurs", groupe: 2, court: "Indicateurs", libelle: "Indicateurs commerciaux", href: "/pilotage/indicateurs", droit: "indicateurs" },\n',
      "",
      "onglet « Indicateurs » retiré"
    );
    ecritures.push(onglets);
  }
}

/* 3. Aucune autre page ne doit encore se déclarer sur l'onglet « indicateurs » (il n'existe plus) */
function parcourir(dossier, liste = []) {
  const abs = path.join(racine, dossier);
  if (!fs.existsSync(abs)) return liste;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) parcourir(rel, liste);
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) liste.push(rel);
  }
  return liste;
}
for (const rel of [...parcourir("app"), ...parcourir("components")]) {
  const t = fs.readFileSync(path.join(racine, rel), "utf8");
  if (/actif=\{?["']indicateurs["']\}?/.test(t)) {
    echec(`${rel.replace(/\\/g, "/")} utilise encore l'onglet « indicateurs » (supprimé) : copiez ce message à Claude.`);
  }
}

/* 4. Tout ou rien */
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
