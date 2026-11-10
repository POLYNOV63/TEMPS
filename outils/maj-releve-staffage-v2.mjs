/* ===============================================================
   MAJ RELEVÉ PE / PI - PARAMÉTRER UNE COMMANDE À STAFFER, N° DE DEVIS
   (STAFFAGE_V2)

   1. Une PE / PI « à staffer » a un bouton « ⚙ Paramétrer » (au lieu du
      menu des personnes), qui ouvre une fenêtre : personne, vendue au jour
      ou à l'heure, base (7 h, 7,5 h, autre), taux (ou prestation du
      contrat cadre), RYTHME du lundi au vendredi (celui du contrat, sinon
      la base chaque jour, modifiable), date de DÉBUT (à la suite de la
      commande sœur pour un avenant), et la date de FIN calculée : jours
      ouvrés, fériés et ABSENCES de la personne évités, jusqu'à épuisement
      de la commande (son montant au taux choisi). « Valider » crée la
      ligne et remplit ces jours (planning compris).
   2. Le n° de devis (DBE) s'affiche à côté du n° de commande dans tout le
      relevé, dans la fiche et dans la fenêtre.

   À installer APRÈS maj-releve-staffage.mjs.
   À lancer à la racine du projet :   node outils/maj-releve-staffage-v2.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FICHIER = "app/pilotage/prestations/page.tsx";
const MARQUEUR = "STAFFAGE_V2";
const ICI = join(dirname(fileURLToPath(import.meta.url)), "staffage2");

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const morceau = (n) => {
  const f = join(ICI, `${n}.txt`);
  if (!existsSync(f)) echec(`Morceau introuvable : outils/staffage2/${n}.txt (décompressez tout le ZIP).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};
/* remplace du début (compris) jusqu'à la fin (comprise si inclure) */
const remplacerEntre = (t, debut, fin, par, nom, inclure) => {
  if (compter(t, debut) !== 1) echec(`${FICHIER} : début de « ${nom} » trouvé ${compter(t, debut)} fois (attendu : 1).`);
  const i = t.indexOf(debut);
  const j = t.indexOf(fin, i + debut.length);
  if (j < 0) echec(`${FICHIER} : fin de « ${nom} » introuvable.`);
  return t.slice(0, i) + par + t.slice(inclure ? j + fin.length : j);
};

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
if (!t.includes("STAFFAGE_CONTRATS")) echec(`${FICHIER} : installez d’abord maj-releve-staffage.zip (staffage guidé et contrats cadres).`);

// 1. l'état du staffage (avec le rythme) et les absences de la personne
t = remplacerEntre(t, "  const [staffage, setStaffage] = useState<null | {\n", "  }>(null);\n", morceau("etat"), "état du staffage", true);
// 2. ouvrir, simuler, valider
t = remplacerEntre(t, "  /* STAFFAGE_CONTRATS : staffer une PE / PI : personne", "  /* STAFFAGE_CONTRATS : enregistrer les contrats cadres */", morceau("fonctions"), "fonctions du staffage", false);
// 3. la fenêtre
t = remplacerEntre(t, "      {/* STAFFAGE_CONTRATS : fenêtre de staffage d'une PE / PI */}", "      {/* STAFFAGE_CONTRATS : paramétrage des contrats cadres */}", morceau("fenetre"), "fenêtre de staffage", false);
// 4. « à staffer » : un bouton plutôt que le menu des personnes
t = remplacerEntre(t, '<select\n                              value=""\n                              onChange={(e) => void ouvrirStaffage(a, e.target.value)}', "</select>", morceau("bouton").trimEnd(), "menu « à staffer »", true);

// 5. le n° de devis
const DEVIS = (expr, taille) => `{${expr} && <span title="Devis d’origine (Suivi d’affaire BE)" style={{ fontSize: ${taille}, fontWeight: 700, color: C.gris }}>DBE{String(${expr}).replace(/^DBE/i, "")}</span>}`;
const R = [
  ["n° de la commande", "                                        {nf?.numero}\n                                      </Link>\n", `                                        {nf?.numero}\n                                      </Link>\n                                      ${DEVIS("nf?.devis", 11)}\n`],
  ["n° à staffer", "                            {numeroFacture(a).numero}\n                          </button>\n", `                            {numeroFacture(a).numero}\n                          </button>\n                          ${DEVIS("numeroFacture(a).devis", 11)}\n`],
  ["n° de la fiche", "<strong style={{ fontSize: 20, color: C.rougeFonce }}>{nf.numero}</strong>\n                  <span style={{ fontSize: 12, fontWeight: 800, color: C.gris }}>{a.imputation}</span>", `<strong style={{ fontSize: 20, color: C.rougeFonce }}>{nf.numero}</strong>\n                  ${DEVIS("nf.devis", 13)}\n                  <span style={{ fontSize: 12, fontWeight: 800, color: C.gris }}>{a.imputation}</span>`],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ « ⚙ Paramétrer » : personne, taux, rythme, début, fin calculée (absences évitées)");
console.log("✓ n° de devis dans le relevé, la fiche et la fenêtre");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
