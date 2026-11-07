/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - PLANNING DE CHARGE PAR ACTIVITÉ
   (CHARGE_PAR_ACTIVITE)

   Ajoute un tableau sur 12 semaines : une ligne par activité, les
   heures planifiées (activité de l'affectation) face à la capacité des
   personnes dont c'est l'activité principale ; clic sur une case :
   affaires et personnes concernées.

   À lancer à la racine du projet :   node outils/maj-charge-par-activite.mjs
   (les fichiers bloc_*.txt du ZIP doivent être dans outils/)
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "CHARGE_PAR_ACTIVITE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const lire = (n) => {
  const p = join(ICI, n);
  if (!existsSync(p)) echec(`fichier ${n} introuvable dans outils/ (décompressez tout le ZIP).`);
  return readFileSync(p, "utf8").replace(/\r\n/g, "\n");
};

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}

const remplacements = [
  {
    nom: "calcul de la charge par activité",
    cherche: "  }, [semaines12, equipe12, capacites, joursAffectes, jours, affectationsParId, affairesParId, realiseRep, groupesRep, lundiActuelRep]);\n",
    remplace: (x) => x + lire("bloc_hooks.txt"),
  },
  {
    nom: "tableau « Planning de charge par activité »",
    cherche: '        <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Détail de la semaine S{numeroSemaine(lundi)}</h2>\n',
    remplace: (x) => lire("bloc_section.txt") + x,
  },
];
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, (x) => r.remplace(x));
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
