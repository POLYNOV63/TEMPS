/* ===============================================================
   MAJ PLANNING - AFFICHAGE PAR DÉFAUT ET SEMAINES (SEMAINE_ENCADREE)

   Planning des affaires :
   - s'ouvre sur les affaires au forfait, sur 8 semaines ;
   - traits de séparation des semaines plus épais ;
   - semaine en cours encadrée en rouge, de l'en-tête jusqu'en bas.

   À lancer à la racine du projet :   node outils/maj-planning-semaines.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "SEMAINE_ENCADREE";
const TRAIT = "#c4c9cf"; // séparation des semaines

const remplacements = [
  {
    nom: "8 semaines par défaut",
    cherche: "  const [nbSemaines, setNbSemaines] = useState(4);",
    remplace: "  const [nbSemaines, setNbSemaines] = useState(8); // SEMAINE_ENCADREE : 8 semaines par défaut",
  },
  {
    nom: "affaires au forfait par défaut",
    cherche: '  const [filtreType, setFiltreType] = useState<"TOUS" | "CBE" | "DBE" | "PE" | "PI">("TOUS");',
    remplace: '  const [filtreType, setFiltreType] = useState<"TOUS" | "CBE" | "DBE" | "PE" | "PI">("CBE"); // forfaits par défaut',
  },
  {
    nom: "position de la semaine en cours",
    cherche: "  const fonds = (nbLignes = 1) => (",
    remplace:
      "  // SEMAINE_ENCADREE : colonnes de la semaine en cours (si elle est affichée)\n" +
      "  const lundiCourant = lundiDe(aujourdhui);\n" +
      "  const debutSemaineCourante = colonnes.findIndex((j) => lundiDe(j) === lundiCourant);\n" +
      "  const nbJoursSemaineCourante = colonnes.filter((j) => lundiDe(j) === lundiCourant).length;\n\n" +
      "  const fonds = (nbLignes = 1) => (",
  },
  {
    nom: "traits des semaines plus épais",
    cherche:
      "          backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(100% / ${nbSemaines} - 1px), ${C.ligne} calc(100% / ${nbSemaines} - 1px), ${C.ligne} calc(100% / ${nbSemaines}))`,",
    remplace:
      "          backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent calc(100% / ${nbSemaines} - 2px), " +
      TRAIT +
      " calc(100% / ${nbSemaines} - 2px), " +
      TRAIT +
      " calc(100% / ${nbSemaines}))`,",
  },
  {
    nom: "semaine en cours encadrée sur chaque ligne",
    cherche: "      {colonnes.includes(aujourdhui) && (\n        <div aria-hidden=\"true\" style={{ gridColumn: col(colonnes.indexOf(aujourdhui)),",
    remplace:
      "      {debutSemaineCourante >= 0 && (\n" +
      "        <div aria-hidden=\"true\" style={{ gridColumn: `${col(debutSemaineCourante)} / span ${nbJoursSemaineCourante}`, gridRow: `1 / span ${nbLignes}`, borderLeft: `2px solid ${C.rouge}`, borderRight: `2px solid ${C.rouge}`, background: \"rgba(192,0,0,0.035)\", pointerEvents: \"none\" }} />\n" +
      "      )}\n" +
      "      {colonnes.includes(aujourdhui) && (\n        <div aria-hidden=\"true\" style={{ gridColumn: col(colonnes.indexOf(aujourdhui)),",
  },
  {
    nom: "en-tête des semaines : trait épais, semaine en cours en rouge",
    cherche: 'background: "#f1f2f4", borderLeft: `1px solid ${C.ligne}`, fontSize: nbSemaines > 26 ? 10 : 13,',
    remplace:
      'background: l === lundiCourant ? "#fff4f4" : "#f1f2f4", color: l === lundiCourant ? C.rougeFonce : undefined, borderLeft: `2px solid ' +
      TRAIT +
      '`, fontSize: nbSemaines > 26 ? 10 : 13,',
  },
  {
    nom: "cadre de la semaine en cours dans l'en-tête",
    cherche: "                {colonnes.map((j, i) => (\n                  <div key={j} style={{ gridColumn: col(i), gridRow: 3,",
    remplace:
      "                {debutSemaineCourante >= 0 && (\n" +
      "                  <div aria-hidden=\"true\" title=\"Semaine en cours\" style={{ gridColumn: `${col(debutSemaineCourante)} / span ${nbJoursSemaineCourante}`, gridRow: \"2 / span 2\", border: `2px solid ${C.rouge}`, borderBottom: \"none\", borderRadius: \"5px 5px 0 0\", pointerEvents: \"none\", zIndex: 1 }} />\n" +
      "                )}\n" +
      "                {colonnes.map((j, i) => (\n                  <div key={j} style={{ gridColumn: col(i), gridRow: 3,",
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
