/* ===============================================================
   MAJ TRAME CA V2 : dans la page Finances, la « Trame CA » remplace
   le tableau « Les 12 mois de l'exercice » (prévisionnel saisi,
   attendu, atterrissage et détails cliquables passent dans la trame).
   La partie « Suivi d'activité » de la trame est retirée.

   À lancer à la racine du projet :   node outils/maj-trame-ca-v2.mjs

   Fonctionne que maj-trame-ca.mjs (V1) ait été lancé ou non.
   Tout ou rien : vérifie tout avant d'écrire. Relançable sans risque
   (marqueur TRAME_CA_V2).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const COMPOSANT = "components/finances/TrameCA.tsx";
const MARQUEUR = "TRAME_CA_V2";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (texte, x) => texte.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
if (!existsSync(COMPOSANT) || !readFileSync(COMPOSANT, "utf8").includes(MARQUEUR))
  echec(`${COMPOSANT} absent ou ancien : décompressez d'abord le ZIP à la racine du projet.`);

let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}

/* 1. import du composant (s'il n'y est pas déjà) */
const IMPORT_DETAIL = 'import DetailMontant, { type DetailDemande } from "@/components/finances/DetailMontant";';
if (!t.includes('import TrameCA from "@/components/finances/TrameCA"')) {
  if (compter(t, IMPORT_DETAIL) !== 1) echec("import de DetailMontant introuvable.");
  t = t.replace(IMPORT_DETAIL, () => `${IMPORT_DETAIL}\nimport TrameCA from "@/components/finances/TrameCA";`);
  console.log("✓ import du composant TrameCA");
}

/* 2. le tableau des 12 mois est remplacé par la trame */
const DEBUT = "{/* ---------- tableau 12 mois ---------- */}";
const FIN = "{/* DETAIL_MONTANT_V3 : ce qui compose le montant cliqué */}";
if (compter(t, DEBUT) !== 1) echec(`repère « tableau 12 mois » trouvé ${compter(t, DEBUT)} fois (attendu : 1).`);
if (compter(t, FIN) !== 1) echec(`repère « DETAIL_MONTANT_V3 » trouvé ${compter(t, FIN)} fois (attendu : 1).`);
const iDebut = t.indexOf(DEBUT);
const iFin = t.indexOf(FIN);
if (iFin < iDebut) echec("repères du tableau des 12 mois dans le mauvais ordre.");
const NOUVEAU = `{/* ---------- TRAME_CA_V2 : la trame CA remplace le tableau des 12 mois ---------- */}
            <div>
              <TrameCA
                exercice={exercice}
                mois={mois}
                moisN1={moisN1}
                mouvements={mouvements}
                prevu={vue.prevu}
                attendu={vue.attendu}
                faitPlusTard={faitPlusTard}
                estAdmin={estAdmin}
                onPrevu={(m, v) => void enregistrerPrevus(new Map([[m, v]]))}
                onDetail={(i, ligne) => setDetail({ mois: mois[i], ligne })}
                onDetailReport={(i) => setDetailReport(mois[i])}
              />

              `;

/* 3. fin du bloc : le </section> juste avant le taux PE / PI (et l'ancienne trame V1 s'il y en a une) */
const TAUX = "{/* ---------- taux de vente moyen des PE / PI ---------- */}";
if (compter(t, TAUX) !== 1) echec(`repère « taux de vente moyen » trouvé ${compter(t, TAUX)} fois (attendu : 1).`);
const iTaux = t.indexOf(TAUX);
const iSection = t.lastIndexOf("</section>", iTaux);
if (iSection < iFin) echec("fin du bloc des 12 mois introuvable.");
const entre = t.slice(iSection + "</section>".length, iTaux);
if (entre.replace(/\{\/\*[^]*?\*\/\}|<TrameCA[^]*?\/>|\s/g, "") !== "") echec("contenu inattendu entre le bloc des 12 mois et le taux PE / PI.");

t = t.slice(0, iDebut) + NOUVEAU + t.slice(iFin, iSection) + "</div>\n\n            " + t.slice(iTaux);
console.log("✓ tableau « Les 12 mois de l'exercice » remplacé par la trame CA");

/* 4. « Remplir le prévisionnel » : dans sa propre carte */
const STYLE_REMPLIR = 'style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.ligne}` }}';
if (compter(t, STYLE_REMPLIR) === 1) {
  t = t.replace(STYLE_REMPLIR, () => 'style={{ ...page.carte, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: 12, marginBottom: 14 }}');
  console.log("✓ « Remplir le prévisionnel » mis dans une carte");
} else {
  console.log("• « Remplir le prévisionnel » : mise en forme inchangée (sans conséquence)");
}

writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
