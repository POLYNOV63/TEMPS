/* ===============================================================
   MAJ FINANCES - DEUX ONGLETS (FINANCES_ONGLETS)

   La page Finances répond à deux questions, séparées en deux onglets :
   - 💶 CA de l'exercice (ouvert par défaut) : réalisé, attendu,
     atterrissage, retards et forfaits à dater, CA mois par mois, trame CA
     avec le prévisionnel ;
   - 🧩 Par activité : marge du négoce, taux de vente des PE / PI,
     activités × imputations, lien vers la Rentabilité.
   Les exports (Excel, en-cours) et « Comment sont calculés ces chiffres »
   restent communs.

   À lancer à la racine du projet :   node outils/maj-finances-onglets.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_ONGLETS";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const BARRE = `        {/* ${MARQUEUR} : deux onglets */}
        {!chargement && (
          <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: \`2px solid \${C.ligne}\` }}>
            {(
              [
                ["CA", "💶 CA de l’exercice", "Où en est-on : réalisé, attendu, atterrissage, mois par mois"],
                ["ACTIVITES", "🧩 Par activité", "D’où vient le CA : activités, imputations, négoce, PE / PI"],
              ] as const
            ).map(([cle, libelle, aide]) => (
              <button
                key={cle}
                type="button"
                role="tab"
                aria-selected={onglet === cle}
                title={aide}
                onClick={() => setOnglet(cle)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "10px 16px",
                  fontWeight: 800,
                  fontSize: 15,
                  color: onglet === cle ? C.rougeFonce : "#3b4046",
                  borderBottom: \`3px solid \${onglet === cle ? C.rouge : "transparent"}\`,
                  marginBottom: -2,
                }}
              >
                {libelle}
              </button>
            ))}
          </div>
        )}

`;

const R = [
  ["état de l'onglet", '  const [info, setInfo] = useState("");\n', '  const [info, setInfo] = useState("");\n  const [onglet, setOnglet] = useState<"CA" | "ACTIVITES">("CA"); // ' + MARQUEUR + "\n"],
  [
    "barre d'onglets et vignettes du CA",
    '        {chargement && <Message genre="info">Chargement…</Message>}\n\n        {!chargement && (\n          <>\n            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>\n',
    '        {chargement && <Message genre="info">Chargement…</Message>}\n\n' + BARRE + '        {!chargement && (\n          <>\n            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>\n              {onglet === "CA" && (\n                <>\n',
  ],
  [
    "vignette du négoce",
    "              {/* VIGNETTES_ALLEGEES : le détail du travail facturé plus tard reste dans le tableau (ligne cliquable) */}\n              {(() => {\n",
    "                </>\n              )}\n              {/* VIGNETTES_ALLEGEES : le détail du travail facturé plus tard reste dans le tableau (ligne cliquable) */}\n              {onglet === \"ACTIVITES\" && (() => {\n",
  ],
  ["début de l'onglet CA", "            {(attendus.aDater.length > 0 || attendus.enRetard.length > 0) && (", '            {onglet === "CA" && (\n              <>\n            {(attendus.aDater.length > 0 || attendus.enRetard.length > 0) && ('],
  [
    "onglet Par activité",
    "            {/* ---------- taux de vente moyen des PE / PI ---------- */}",
    '              </>\n            )}\n\n            {onglet === "ACTIVITES" && (\n              <>\n            {/* ---------- taux de vente moyen des PE / PI ---------- */}',
  ],
  ["fin de l'onglet Par activité", '            <details style={{ fontSize: 13, color: "#3b4046" }}>', '              </>\n            )}\n\n            <details style={{ fontSize: 13, color: "#3b4046" }}>'],
  [
    "sous-titre",
    "Exercice du 1er novembre {exercice} au 31 octobre {exercice + 1} : chiffre d’affaires réalisé face au prévisionnel, par\n              imputation et par activité, et rentabilité.",
    "Exercice du 1er novembre {exercice} au 31 octobre {exercice + 1} : où en est le chiffre d’affaires, et d’où il vient.",
  ],
  [
    "définition des activités",
    "(Méca, Calcul, Elec / Pneu, Scan, Autre, Négoce)",
    "(Méca, Calcul, Elec / Pneu, Scan, Négoce, celui-ci avec le « Montant heures négoce »)",
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ onglet « CA de l’exercice » : vignettes, retards, graphique, trame CA");
console.log("✓ onglet « Par activité » : négoce, taux PE / PI, activités × imputations, rentabilité");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
