/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - DÉTAIL EN PREMIER, SUR 1, 2 OU 4 SEMAINES
   (DETAIL_PERIODE)

   - le tableau « Détail de la semaine » passe en tête de page (sous les
     tuiles) ;
   - boutons 1 / 2 / 4 semaines : capacité, absences, affecté, écart et
     affectations totalisés sur la période ; « Déplacer… » reste
     disponible sur 1 semaine.

   À lancer à la racine du projet :   node outils/maj-ressources-detail.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "DETAIL_PERIODE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}

const remplacements = [
  {
    nom: "durée du détail",
    cherche: "  const finSemaine = ajouterJours(lundi, 6);\n",
    remplace:
      "  // DETAIL_PERIODE : le détail porte sur 1, 2 ou 4 semaines à partir de la semaine affichée\n" +
      "  const [nbSemDetail, setNbSemDetail] = useState(1);\n" +
      "  const finSemaine = ajouterJours(lundi, 7 * nbSemDetail - 1);\n",
  },
  {
    nom: "charge totalisée sur la période",
    cherche: "          const s = chargeParSemaine(capacites, joursAffectes, c.id, lundi);\n",
    remplace:
      "          const s = Array.from({ length: nbSemDetail }, (_, w) => chargeParSemaine(capacites, joursAffectes, c.id, ajouterJours(lundi, 7 * w))).reduce((t, x) => ({\n" +
      "            ...t,\n" +
      "            theorique: t.theorique + x.theorique,\n" +
      "            ferie: t.ferie + x.ferie,\n" +
      "            absence: t.absence + x.absence,\n" +
      "            net: t.net + x.net,\n" +
      "            affecte: t.affecte + x.affecte,\n" +
      "            ecart: t.ecart + x.ecart,\n" +
      "          }));\n",
  },
  {
    nom: "recalcul quand la durée change",
    cherche: "    [annuaire, capacites, joursAffectes, jours, affectationsParId, affairesParId, lundi, finSemaine]\n",
    remplace: "    [annuaire, capacites, joursAffectes, jours, affectationsParId, affairesParId, lundi, finSemaine, nbSemDetail]\n",
  },
  {
    nom: "tuile « Planifié »",
    cherche: '<Tuile libelle="Planifié" valeur={formatHeures(totalAffecte)} sous="affectations de la semaine" />',
    remplace:
      '<Tuile libelle="Planifié" valeur={formatHeures(totalAffecte)} sous={nbSemDetail === 1 ? "affectations de la semaine" : `affectations des ${nbSemDetail} semaines`} />',
  },
  {
    nom: "« Déplacer… » sur une semaine seulement",
    cherche: "                        {!encadrement && s.ecart > 0.01 && l.details.length > 0 && (",
    remplace: "                        {nbSemDetail === 1 && !encadrement && s.ecart > 0.01 && l.details.length > 0 && (",
  },
  {
    nom: "carte du détail espacée",
    cherche: "        <section style={{ ...page.carte, padding: 16 }}>\n",
    remplace: "        <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>\n",
  },
];
for (const r of remplacements) {
  const n = compter(t, r.cherche);
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) t = t.replace(r.cherche, () => r.remplace);

/* déplacement du bloc « Détail » en tête, avec son nouveau titre */
const TITRE = '        <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Détail de la semaine S{numeroSemaine(lundi)}</h2>\n';
const FIN = "              Voir le planning visuel →\n            </Link>\n          </div>\n        </section>\n";
const DESTINATION = "        {/* Vue d'ensemble : charge de chaque personne sur 12 semaines */}\n";
for (const [nom, x] of [["titre du détail", TITRE], ["fin du détail", FIN], ["vue d'ensemble", DESTINATION]])
  if (compter(t, x) !== 1) echec(`${FICHIER} : repère « ${nom} » trouvé ${compter(t, x)} fois (attendu : 1).`);
const i = t.indexOf(TITRE);
const j = t.indexOf(FIN, i) + FIN.length;
if (j < FIN.length || t.indexOf(DESTINATION) > i) echec(`${FICHIER} : blocs dans un ordre inattendu.`);
let bloc = t.slice(i, j);
t = t.slice(0, i) + t.slice(j);
bloc = bloc.replace(
  TITRE,
  () => `        {/* DETAIL_PERIODE : le détail en premier, sur 1, 2 ou 4 semaines */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 10px" }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {nbSemDetail === 1
              ? \`Détail de la semaine S\${numeroSemaine(lundi)}\`
              : \`Détail de S\${numeroSemaine(lundi)} à S\${numeroSemaine(ajouterJours(lundi, 7 * (nbSemDetail - 1)))}\`}
          </h2>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={nbSemDetail === n}
                onClick={() => setNbSemDetail(n)}
                style={{ ...page.btnSecondaire, minHeight: 32, padding: "0 10px", background: nbSemDetail === n ? C.rouge : "#ffffff", color: nbSemDetail === n ? "#ffffff" : C.rougeFonce, borderColor: nbSemDetail === n ? C.rouge : undefined }}
              >
                {n === 1 ? "1 semaine" : \`\${n} semaines\`}
              </button>
            ))}
          </span>
          {nbSemDetail > 1 && <span style={{ fontSize: 13, color: C.gris }}>totaux sur la période · « Déplacer… » se fait semaine par semaine</span>}
        </div>
`
);
const d = t.indexOf(DESTINATION);
t = t.slice(0, d) + bloc + "\n" + t.slice(d);

writeFileSync(FICHIER, t, "utf8");
for (const r of remplacements) console.log(`✓ ${r.nom}`);
console.log("✓ détail placé en tête de page");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
