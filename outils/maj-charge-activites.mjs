/* ===============================================================
   MAJ - DISPONIBILITÉS PAR ACTIVITÉ, PAGE À PART (CHARGE_ACTIVITES)

   - nouvelle page app/analyse/charge-activites (fournie dans le ZIP) ;
   - tableau de bord : tuile « Disponibilités par activité » dans « Analyses »
     (ADMIN) et dans « Charge du bureau d'études » (DIRECTION) ;
   - Charge par ressource : retire le planning par activité s'il y avait
     été ajouté (version 1 ou 2).

   À lancer à la racine du projet :   node outils/maj-charge-activites.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const PAGE = "app/analyse/charge-activites/page.tsx";
const TABLEAU = "app/dashboard/page.tsx";
const RESSOURCES = "app/pilotage/ressources/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const lireFichier = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const lireOutil = (n) => {
  const p = join(ICI, n);
  if (!existsSync(p)) echec(`fichier ${n} introuvable dans outils/ (décompressez tout le ZIP).`);
  return lireFichier(p);
};
const compter = (texte, x) => texte.split(x).length - 1;

for (const f of [PAGE, TABLEAU, RESSOURCES]) if (!existsSync(f)) echec(`Fichier introuvable : ${f} (décompressez le ZIP et lancez la commande à la racine du projet).`);

/* ---------- 1. tableau de bord ---------- */
let tb = lireFichier(TABLEAU);
const ecritures = [];
const ANCIEN = 'titre="Charge et compétences" description="Compétences disponibles et activités en tension, sur 12 semaines"';
if (tb.includes("CHARGE_ACTIVITES")) {
  if (tb.includes(ANCIEN)) {
    tb = tb.split(ANCIEN).join('titre="Disponibilités par activité" description="Méca, Elec, Calcul : capacité, heures occupées et disponibles sur 12 semaines"');
    ecritures.push([TABLEAU, tb, "✓ tableau de bord : tuile renommée « Disponibilités par activité »"]);
  } else console.log("✓ tableau de bord : déjà à jour");
} else {
  const ADMIN =
    '\n        <CarteCompacte icone="🧑‍🔧" titre="Analyse des effectifs" description="Prédominances, activités pointées et méthodes de vente (PE / PI / BE)" onClick={() => aller("/analyse/effectifs")} />\n';
  const DIRECTION =
    '          <CarteCompacte icone="👥" titre="Charge par ressource" description="Charge prévue de chacun, semaine par semaine" onClick={() => aller("/pilotage/ressources")} />\n';
  if (compter(tb, ADMIN) !== 1) echec(`tableau de bord : tuile « Analyse des effectifs » (groupe Analyses) trouvée ${compter(tb, ADMIN)} fois (attendu : 1).`);
  if (compter(tb, DIRECTION) !== 1) echec(`tableau de bord : tuile « Charge par ressource » (Direction) trouvée ${compter(tb, DIRECTION)} fois (attendu : 1).`);
  const tuile = (indent) =>
    `${indent}{/* CHARGE_ACTIVITES : charge et compétences disponibles par activité (ADMIN, DIRECTION) */}\n` +
    `${indent}<CarteCompacte icone="🧭" titre="Disponibilités par activité" description="Méca, Elec, Calcul : capacité, heures occupées et disponibles sur 12 semaines" onClick={() => aller("/analyse/charge-activites")} />\n`;
  tb = tb.replace(ADMIN, (x) => x + tuile("        ")).replace(DIRECTION, (x) => x + tuile("          "));
  ecritures.push([TABLEAU, tb, "✓ tableau de bord : tuile ajoutée (Analyses pour l’ADMIN, Charge du bureau d’études pour la Direction)"]);
}

/* ---------- 2. Charge par ressource : retrait du planning par activité ---------- */
let rs = lireFichier(RESSOURCES);
if (!rs.includes("CHARGE_PAR_ACTIVITE")) {
  console.log("✓ Charge par ressource : rien à retirer");
} else {
  const versions = [
    ["bloc_hooks_v2.txt", "bloc_section_v2.txt"],
    ["bloc_hooks_v1.txt", "bloc_section_v1.txt"],
  ];
  let fait = false;
  for (const [h, s] of versions) {
    const H = lireOutil(h);
    const S = lireOutil(s);
    if (compter(rs, H) === 1 && compter(rs, S) === 1) {
      rs = rs.replace(H, "").replace(S, "");
      fait = true;
      break;
    }
  }
  if (!fait) echec("Charge par ressource : le planning par activité a été modifié depuis son ajout, retrait impossible automatiquement.");
  if (rs.includes("CHARGE_PAR_ACTIVITE")) echec("Charge par ressource : il reste des morceaux du planning par activité.");
  ecritures.push([RESSOURCES, rs, "✓ Charge par ressource : planning par activité retiré"]);
}

for (const [f, t, msg] of ecritures) {
  writeFileSync(f, t, "utf8");
  console.log(msg);
}
console.log(`✓ nouvelle page : ${PAGE}`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
