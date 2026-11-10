/* ===============================================================
   MAJ RELEVÉ PE / PI - STAFFAGE GUIDÉ ET CONTRATS CADRES (STAFFAGE_CONTRATS)

   1. Staffer une PE / PI (« à staffer », ou « Staffer… » de la fiche) ouvre
      une fenêtre : personne, vendue au jour / à l'heure, base horaire en
      menu (7 h, 7,5 h, autre…), taux, et « Remplir la commande à partir
      du … » (jusqu'à épuisement, mois suivants compris).
   2. Avenant (R1, R2…) : personne, unité, base et taux repris de la
      commande sœur (la base pour un R1, R1 pour un R2…), et remplissage
      proposé à la suite de son dernier jour (le reste de la journée si
      elle n'est pas pleine) : on confirme.
   3. Contrats cadres (bouton « Contrats cadres ») : pour un client dont le
      nom contient MICHELIN (préfixe ou suffixe sans importance) : base de
      37,5 h, rythme PE 7,5/7,5/7,5/7,5/7,5, rythme PI 8/8/8/8/5,5, et les
      tarifs Etude, Mise en plan, Faisabilité, AMO, Calcul (par semaine, par
      jour ou par heure), à choisir au staffage.
   4. Le remplissage (↦ reste, et le remplissage au staffage) suit le
      rythme du contrat cadre.

   PRÉALABLE : script SQL supabase/90_prestation_contrats.sql.
   À lancer à la racine du projet :   node outils/maj-releve-staffage.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FICHIER = "app/pilotage/prestations/page.tsx";
const MARQUEUR = "STAFFAGE_CONTRATS";
const ICI = join(dirname(fileURLToPath(import.meta.url)), "staffage");

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const morceau = (n) => {
  const f = join(ICI, `${n}.txt`);
  if (!existsSync(f)) echec(`Morceau introuvable : outils/staffage/${n}.txt (décompressez tout le ZIP).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const NUM_FIN = "      return { numero: a.numero, client: client ? suivi.clients.get(client) ?? null : null, devis };\n    },\n    [suivi]\n  );\n";

const R = [
  ["types", 'const LETTRES = ["D", "L", "M", "M", "J", "V", "S"];', morceau("types") + 'const LETTRES = ["D", "L", "M", "M", "J", "V", "S"];'],
  ["état", "  const [reveillees, setReveillees] = useState<Set<string>>(new Set());\n", "  const [reveillees, setReveillees] = useState<Set<string>>(new Set());\n" + morceau("etat")],
  ["aides", NUM_FIN, NUM_FIN + morceau("aides")],
  [
    "remplissage d'une ligne",
    '      if (j.weekend || j.ferie) continue;\n      valeurs.push({ jour: j.date, valeur: absent(l.collaborateur_id, j.date) ? { heures: null, code: "CP" } : { heures: l.base_horaire, code: null } });',
    '      if (j.weekend || j.ferie) continue;\n      const hj = heuresDuJour(l, j.date); // rythme du contrat cadre, sinon la base de la ligne\n      if (hj <= 0) continue;\n      valeurs.push({ jour: j.date, valeur: absent(l.collaborateur_id, j.date) ? { heures: null, code: "CP" } : { heures: hj, code: null } });',
  ],
  ["planifier le reste : paramètres", "  async function planifierReste(l: Ligne) {", "  async function planifierReste(l: Ligne, depart?: { jour: string; dejaH: number }, sansConfirmer = false) {"],
  ["planifier le reste : départ", "    let jour = dernier && dernier >= debut ? lendemain(dernier) : debut;", "    let jour = depart?.jour ?? (dernier && dernier >= debut ? lendemain(dernier) : debut);"],
  [
    "planifier le reste : heures du jour",
    "      const h = Math.min(resteH, parJour);\n      ajouts.push({ jour, heures: Math.round(h * 100) / 100 });",
    "      const cap = heuresDuJour(l, jour) - (depart && jour === depart.jour ? depart.dejaH : 0);\n      if (cap <= 0.01) continue;\n      const h = Math.min(resteH, cap);\n      ajouts.push({ jour, heures: Math.round(h * 100) / 100 });",
  ],
  ["planifier le reste : confirmation", "    if (\n      !window.confirm(\n        `Planifier ", "    if (\n      !sansConfirmer &&\n      !window.confirm(\n        `Planifier "],
  [
    "planifier le reste : mois",
    "    const ceMois = ajouts.filter((x) => x.jour <= fin);\n    const ensuite = ajouts.filter((x) => x.jour > fin);",
    "    const ceMois = ajouts.filter((x) => x.jour >= debut && x.jour <= fin);\n    const ensuite = ajouts.filter((x) => x.jour < debut || x.jour > fin);",
  ],
  ["fonctions", "  async function ajouterLigne() {", morceau("fonctions") + "  async function ajouterLigne() {"],
  [
    "à staffer",
    '<select defaultValue="" onChange={(e) => void staffer(a.id, e.target.value)} style={{ ...champ, width: 120 }} aria-label={`Personne pour ${a.numero}`}>',
    '<select\n                              value=""\n                              onChange={(e) => void ouvrirStaffage(a, e.target.value)}\n                              style={{ ...champ, width: 120 }}\n                              aria-label={`Personne pour ${a.numero}`}\n                            >',
  ],
  ["staffer depuis la fiche", "                          void staffer(a.id, e.target.value);\n                          setFiche(null);", "                          setFiche(null);\n                          void ouvrirStaffage(a, e.target.value);"],
  ["bouton", "              Facturation du mois →\n            </Link>\n", "              Facturation du mois →\n            </Link>\n" + morceau("bouton")],
  ["fenêtres", "      {editeurReport && (", morceau("fenetres") + "      {editeurReport && ("],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ staffage guidé : personne, base (7 h, 7,5 h, autre), taux, remplissage");
console.log("✓ avenants : réglages et date de départ repris de la commande sœur");
console.log("✓ contrats cadres (MICHELIN) : tarifs et rythme PE / PI");
console.log(`\n✓ ${FICHIER} mis à jour. Installez le SQL 90 dans Supabase si ce n’est pas fait, puis : npm run build`);
