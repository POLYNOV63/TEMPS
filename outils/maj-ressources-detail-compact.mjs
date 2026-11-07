/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - DÉTAIL COMPACT (DETAIL_COMPACT)

   Tableau « Détail » :
   - une seule colonne « Affecté / capacité » (fériés et absences
     indiqués dessous) au lieu de trois ;
   - plus d'ascenseur horizontal ;
   - ligne de titres figée quand on descend.
   (Les accès Direction disparaissent du Pilotage avec le SQL 88.)

   À lancer à la racine du projet, APRÈS maj-ressources-detail.mjs :
       node outils/maj-ressources-detail-compact.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "DETAIL_COMPACT";
const TH = (extra = "") => `{{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4"${extra} }}`;

const remplacements = [
  {
    nom: "plus d'ascenseur horizontal",
    cherche: '          <div style={{ overflowX: "auto" }}>\n            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1020 }}>',
    remplace:
      "          {/* DETAIL_COMPACT : sans ascenseur horizontal, titres figés */}\n" +
      "          <div>\n" +
      '            <table style={{ borderCollapse: "collapse", width: "100%" }}>',
  },
  {
    nom: "titres figés, colonnes regroupées",
    cherche:
      '                  <th style={{ ...page.th, width: 120 }}>Ressource</th>\n' +
      '                  <th style={{ ...page.th, textAlign: "right" }}>Théorique</th>\n' +
      '                  <th style={{ ...page.th, textAlign: "right" }}>Fériés et absences</th>\n' +
      '                  <th style={{ ...page.th, textAlign: "right" }}>Disponible</th>\n' +
      '                  <th style={{ ...page.th, textAlign: "right" }}>Affecté</th>\n' +
      "                  <th style={page.th}>Charge</th>\n" +
      "                  <th style={page.th}>Écart</th>\n" +
      "                  <th style={page.th}>Affectations de la semaine</th>\n" +
      "                  <th style={page.th} />",
    remplace:
      `                  <th style=${TH(", width: 110")}>Ressource</th>\n` +
      `                  <th style=${TH(', textAlign: "right"')}>Théorique</th>\n` +
      `                  <th style=${TH(', textAlign: "right"')} title="Heures affectées / capacité disponible (fériés et absences déduits)">Affecté / capacité</th>\n` +
      `                  <th style=${TH()}>Charge</th>\n` +
      `                  <th style=${TH()}>Écart</th>\n` +
      `                  <th style=${TH()}>Affectations</th>\n` +
      `                  <th style=${TH()} />`,
  },
  {
    nom: "cellule « Affecté / capacité »",
    cherche:
      '                      <td style={{ ...page.td, textAlign: "right" }}>\n' +
      "                        {s.ferie + s.absence > 0 ? (\n" +
      "                          <>\n" +
      "                            <strong>{formatHeures(s.ferie + s.absence)}</strong>\n" +
      '                            <div style={{ fontSize: 12, color: C.gris }}>\n' +
      '                              {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "absence RH" : ""].filter(Boolean).join(" + ")}\n' +
      "                            </div>\n" +
      "                          </>\n" +
      "                        ) : (\n" +
      '                          "—"\n' +
      "                        )}\n" +
      "                      </td>\n" +
      '                      <td style={{ ...page.td, textAlign: "right" }}>\n' +
      '                        <strong>{encadrement ? "hors capacité" : formatHeures(s.net)}</strong>\n' +
      "                      </td>\n" +
      '                      <td style={{ ...page.td, textAlign: "right" }}>\n' +
      "                        <strong>{formatHeures(s.affecte)}</strong>\n" +
      "                      </td>\n",
    remplace:
      '                      <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>\n' +
      "                        <strong>{formatHeures(s.affecte)}</strong>\n" +
      '                        <span style={{ color: C.gris }}> / {encadrement ? "hors capacité" : formatHeures(s.net)}</span>\n' +
      "                        {s.ferie + s.absence > 0 && (\n" +
      '                          <div style={{ fontSize: 12, color: C.gris }}>\n' +
      '                            − {formatHeures(s.ferie + s.absence)} {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "absence" : ""].filter(Boolean).join(" + ")}\n' +
      "                          </div>\n" +
      "                        )}\n" +
      "                      </td>\n",
  },
  {
    nom: "barre de charge plus étroite",
    cherche: 'style={{ position: "relative", height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 180 }}',
    remplace: 'style={{ position: "relative", height: 16, borderRadius: 3, background: "#eef0f3", minWidth: 100 }}',
  },
  {
    nom: "ligne Équipe BE",
    cherche:
      '                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalTheorique - totalNet)}</strong></td>\n' +
      '                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalNet)}</strong></td>\n' +
      '                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right" }}><strong>{formatHeures(totalAffecte)}</strong></td>\n',
    remplace:
      '                  <td style={{ ...page.td, background: "#f8f9fa", textAlign: "right", whiteSpace: "nowrap" }}>\n' +
      "                    <strong>{formatHeures(totalAffecte)}</strong>\n" +
      '                    <span style={{ color: C.gris }}> / {formatHeures(totalNet)}</span>\n' +
      "                  </td>\n",
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
if (!t.includes("DETAIL_PERIODE")) echec("lancez d'abord : node outils/maj-ressources-detail.mjs");
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
