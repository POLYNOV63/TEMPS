/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - TAUX DE CHARGE GLOBAL (TAUX_GLOBAL)

   Ligne « Équipe BE » du tableau de détail : barre de charge et
   % de charge de l'équipe (affecté ÷ capacité, encadrement exclu).
   Rappel du % dans la tuile « Planifié ».

   À lancer à la racine du projet, APRÈS maj-ressources-detail-compact.mjs :
       node outils/maj-ressources-taux-global.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "TAUX_GLOBAL";

const remplacements = [
  {
    nom: "charge de l'équipe sur la ligne Équipe BE",
    cherche:
      '                  <td style={{ ...page.td, background: "#f8f9fa" }} />\n' +
      '                  <td style={{ ...page.td, background: "#f8f9fa" }}>{ecartPastille(totalAffecte - totalNet)}</td>',
    remplace:
      "                  {/* TAUX_GLOBAL : charge de l'équipe (affecté ÷ capacité, encadrement exclu) */}\n" +
      '                  <td style={{ ...page.td, background: "#f8f9fa" }}>\n' +
      "                    {totalNet > 0 && (() => {\n" +
      "                      const taux = totalAffecte / totalNet;\n" +
      "                      return (\n" +
      '                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>\n' +
      '                          <div role="img" aria-label={`Charge de l’équipe : ${Math.round(taux * 100)} %`} style={{ position: "relative", flex: 1, height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 100, overflow: "hidden" }}>\n' +
      '                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, taux * 100)}%`, background: taux > 1.001 ? "#b3261e" : "#34506b" }} />\n' +
      "                          </div>\n" +
      '                          <strong style={{ fontSize: 16, color: taux > 1.001 ? "#8f1010" : C.encre, whiteSpace: "nowrap" }}>{Math.round(taux * 100)} %</strong>\n' +
      "                        </div>\n" +
      "                      );\n" +
      "                    })()}\n" +
      "                  </td>\n" +
      '                  <td style={{ ...page.td, background: "#f8f9fa" }}>{ecartPastille(totalAffecte - totalNet)}</td>',
  },
  {
    nom: "% dans la tuile « Planifié »",
    cherche:
      '<Tuile libelle="Planifié" valeur={formatHeures(totalAffecte)} sous={nbSemDetail === 1 ? "affectations de la semaine" : `affectations des ${nbSemDetail} semaines`} />',
    remplace:
      '<Tuile libelle="Planifié" valeur={formatHeures(totalAffecte)} sous={`${totalNet > 0 ? `${Math.round((totalAffecte / totalNet) * 100)} % de la capacité · ` : ""}${nbSemDetail === 1 ? "la semaine" : `${nbSemDetail} semaines`}`} />',
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
if (!t.includes("DETAIL_COMPACT")) echec("lancez d'abord : node outils/maj-ressources-detail.mjs; node outils/maj-ressources-detail-compact.mjs");
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
