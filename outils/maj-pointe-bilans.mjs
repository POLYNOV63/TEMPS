/* ===============================================================
   « Charge & pointage » séparé en deux pages indépendantes :
   - « Pointé / chiffré » (app/analyse/pointage) : affaire par affaire ;
   - « Bilans » (app/admin/bilans) : où part le temps de l'équipe sur une
     période.
   Plus de barre d'onglets commune ; le tableau de bord a une carte pour
   chacune.
   Utilisation (à la racine du projet) :  node outils/maj-pointe-bilans.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichiers = {
  pointage: "app/analyse/pointage/page.tsx",
  bilans: "app/admin/bilans/page.tsx",
  dashboard: "app/dashboard/page.tsx",
};
const textes = {};
for (const [k, f] of Object.entries(fichiers)) {
  if (!existsSync(f)) {
    console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  textes[k] = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
}
if (textes.dashboard.includes("POINTE_BILANS")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

let erreurs = 0;
function remplacer(k, nom, cherche, remplace, tous = false) {
  const n = textes[k].split(cherche).length - 1;
  if (n === 0 || (!tous && n !== 1)) {
    console.error(`✗ ${nom} : passage trouvé ${n} fois`);
    erreurs++;
    return;
  }
  textes[k] = textes[k].split(cherche).join(remplace);
  console.log(`✓ ${nom}${tous && n > 1 ? ` (${n} endroits)` : ""}`);
}

// 1. Les deux pages perdent la barre d'onglets commune et prennent leur nom
remplacer("pointage", "Pointé / chiffré : sans onglets", `<OngletsCharge actif="affaires" />`, "");
remplacer("pointage", "Pointé / chiffré : titre", `<h1 style={page.titre}>Charge &amp; pointage</h1>`, `<h1 style={page.titre}>Pointé / chiffré</h1>`);
remplacer("bilans", "Bilans : sans onglets", `<OngletsCharge actif="collaborateurs" />`, "");
remplacer("bilans", "Bilans : titre", `Pilotage de la charge`, `Bilans : où part le temps de l’équipe`);

// 2. Tableau de bord : les cartes portent les nouveaux noms
remplacer("dashboard", "Tableau de bord : « Charge & pointage » devient « Pointé / chiffré »", `titre="Charge & pointage"`, `titre="Pointé / chiffré"`, true);
if (textes.dashboard.includes(`titre="Analyse de charge"`)) remplacer("dashboard", "Tableau de bord : « Analyse de charge » devient « Bilans »", `titre="Analyse de charge"`, `titre="Bilans"`, true);

// 3. Carte des analyses : une carte par page
{
  const lignes = textes.dashboard.split("\n");
  const i = lignes.findIndex((l) => l.includes("par collaborateur : heures et taux d'occupation") && l.includes("CarteCompacte"));
  if (i < 0) {
    console.error("✗ Carte « Charge & pointage » du groupe Analyses introuvable");
    erreurs++;
  } else {
    const retrait = lignes[i].match(/^\s*/)?.[0] ?? "";
    lignes[i] = lignes[i].replace(/description="[^"]*"/, `description="Pointé face au chiffré, affaire par affaire"`);
    lignes.splice(
      i + 1,
      0,
      `${retrait}{/* POINTE_BILANS : le bilan du temps de l'équipe, page à part */}`,
      `${retrait}<CarteCompacte icone="📊" titre="Bilans" description="Où part le temps de l’équipe sur une période : vendu, devis, NI, formation, non expliqué" onClick={() => aller("/admin/bilans")} />`
    );
    textes.dashboard = lignes.join("\n");
    console.log("✓ Tableau de bord : une carte « Pointé / chiffré » et une carte « Bilans » dans Analyses");
  }
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [k, f] of Object.entries(fichiers)) writeFileSync(f, textes[k], "utf8");
console.log("\nTerminé : « Pointé / chiffré » et « Bilans » sont deux pages séparées.");
