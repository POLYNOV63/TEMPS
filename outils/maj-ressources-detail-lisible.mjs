/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - DÉTAIL HOMOGÈNE (DETAIL_LISIBLE)

   Tableau « Détail » :
   - toutes les lignes à la même hauteur (une ligne de texte par
     personne), une ligne sur deux légèrement teintée ;
   - affectations repliées : « ▸ CBE1741 + 2 », un clic déplie la
     personne, « tout déplier » dans le titre de la colonne ;
   - barre de charge aux couleurs des autres tableaux (bleu clair sous
     80 %, bleu foncé au-delà, hachuré rouge en surcharge) et % de charge
     de chacun à côté.

   À lancer à la racine du projet, APRÈS maj-ressources-taux-global.mjs :
       node outils/maj-ressources-detail-lisible.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "DETAIL_LISIBLE";

const remplacements = [
  {
    nom: "affectations repliées par défaut",
    cherche: "  const [nbSemDetail, setNbSemDetail] = useState(1);\n",
    remplace: (x) =>
      x +
      "  // DETAIL_LISIBLE : affectations repliées ; dépliées personne par personne, ou toutes\n" +
      "  const [affOuvertes, setAffOuvertes] = useState<Set<string>>(new Set());\n" +
      "  const [toutDeplie, setToutDeplie] = useState(false);\n",
  },
  {
    nom: "index des lignes",
    cherche: "                {lignes.map((l) => {\n                  const encadrement = !l.collab.inclus_statistiques;",
    remplace: () => "                {lignes.map((l, idx) => {\n                  const encadrement = !l.collab.inclus_statistiques;",
  },
  {
    nom: "une ligne sur deux teintée",
    cherche: "                    <tr key={l.collab.id}>",
    remplace: () => '                    <tr key={l.collab.id} style={{ background: idx % 2 ? "#fafbfc" : "#ffffff" }}>',
  },
  {
    nom: "nom sur une seule ligne",
    cherche:
      "                      <td style={page.td}>\n" +
      "                        <strong style={{ fontSize: 18 }}>{nomCollab(l.collab)}</strong>\n" +
      "                        {encadrement && <div style={{ fontSize: 12, color: C.gris }}>Encadrement</div>}\n" +
      "                      </td>",
    remplace: () =>
      '                      <td style={{ ...page.td, whiteSpace: "nowrap" }}>\n' +
      "                        <strong style={{ fontSize: 15 }}>{nomCollab(l.collab)}</strong>\n" +
      '                        {encadrement && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: C.gris }}>encadrement</span>}\n' +
      "                      </td>",
  },
  {
    nom: "fériés et absences sur la même ligne",
    cherche:
      "                        {s.ferie + s.absence > 0 && (\n" +
      '                          <div style={{ fontSize: 12, color: C.gris }}>\n' +
      '                            − {formatHeures(s.ferie + s.absence)} {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "absence" : ""].filter(Boolean).join(" + ")}\n' +
      "                          </div>\n" +
      "                        )}\n",
    remplace: () =>
      "                        {s.ferie + s.absence > 0 && (\n" +
      '                          <span\n' +
      '                            title={`Capacité réduite de ${formatHeures(s.ferie + s.absence)} : ${[s.ferie > 0 ? `férié ${formatHeures(s.ferie)}` : "", s.absence > 0 ? `absence ${formatHeures(s.absence)}` : ""].filter(Boolean).join(", ")}`}\n' +
      '                            style={{ marginLeft: 4, fontSize: 11, color: C.gris }}\n' +
      "                          >\n" +
      '                            (−{formatHeures(s.ferie + s.absence)} {[s.ferie > 0 ? "férié" : "", s.absence > 0 ? "abs." : ""].filter(Boolean).join("+")})\n' +
      "                          </span>\n" +
      "                        )}\n",
  },
  {
    nom: "barre et % de charge (début)",
    cherche: '                      <td style={{ ...page.td, width: "20%" }}>\n                        {!encadrement && (',
    remplace: () =>
      '                      <td style={{ ...page.td, width: "22%" }}>\n' +
      '                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>\n' +
      "                        <div style={{ flex: 1 }}>\n" +
      "                        {!encadrement && (",
  },
  {
    nom: "couleur de la barre selon la charge",
    cherche: 'width: `${(normal / echelle) * 100}%`, background: "#34506b" }} />',
    remplace: () => 'width: `${(normal / echelle) * 100}%`, background: s.net > 0 && s.affecte / s.net >= 0.8 ? "#34506b" : "#8fb0d6" }} />',
  },
  {
    nom: "barre et % de charge (fin)",
    cherche:
      "                        )}\n" +
      "                      </td>\n" +
      '                      <td style={page.td}>{encadrement ? <Pastille genre="info">Pas de seuil</Pastille> : ecartPastille(s.ecart)}</td>',
    remplace: () =>
      "                        )}\n" +
      "                        </div>\n" +
      "                        {!encadrement && s.net > 0 && (\n" +
      '                          <strong style={{ fontSize: 13, minWidth: 42, textAlign: "right", color: s.affecte > s.net + 0.01 ? "#8f1010" : C.encre }}>\n' +
      "                            {Math.round((s.affecte / s.net) * 100)} %\n" +
      "                          </strong>\n" +
      "                        )}\n" +
      "                        </div>\n" +
      "                      </td>\n" +
      '                      <td style={{ ...page.td, whiteSpace: "nowrap" }}>{encadrement ? <Pastille genre="info">Pas de seuil</Pastille> : ecartPastille(s.ecart)}</td>',
  },
  {
    nom: "affectations repliables",
    cherche:
      "                      <td style={{ ...page.td, fontSize: 14 }}>\n" +
      "                        {l.details.length === 0 ? (\n" +
      "                          <span style={{ color: C.gris }}>—</span>\n" +
      "                        ) : (\n" +
      "                          l.details.map((d) => (\n" +
      '                            <div key={d.id} style={{ whiteSpace: "nowrap" }}>\n' +
      "                              <strong>{d.etiquette}</strong> · {formatHeures(d.heures)}\n" +
      "                            </div>\n" +
      "                          ))\n" +
      "                        )}\n" +
      "                      </td>",
    remplace: () =>
      "                      <td style={{ ...page.td, fontSize: 13 }}>\n" +
      "                        {l.details.length === 0 ? (\n" +
      "                          <span style={{ color: C.gris }}>—</span>\n" +
      "                        ) : (\n" +
      "                          (() => {\n" +
      "                            const ouvert = toutDeplie || affOuvertes.has(l.collab.id);\n" +
      "                            const tries = [...l.details].sort((a, b) => b.heures - a.heures);\n" +
      "                            return (\n" +
      "                              <>\n" +
      "                                <button\n" +
      '                                  type="button"\n' +
      "                                  aria-expanded={ouvert}\n" +
      "                                  onClick={() =>\n" +
      "                                    setAffOuvertes((x) => {\n" +
      "                                      const n = new Set(x);\n" +
      "                                      if (n.has(l.collab.id)) n.delete(l.collab.id);\n" +
      "                                      else n.add(l.collab.id);\n" +
      "                                      return n;\n" +
      "                                    })\n" +
      "                                  }\n" +
      '                                  title={tries.map((d) => `${d.etiquette} · ${formatHeures(d.heures)}`).join("\\n")}\n' +
      '                                  style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap", color: "#3b4046" }}\n' +
      "                                >\n" +
      '                                  <span style={{ color: C.rougeFonce, fontWeight: 800 }}>{ouvert ? "▾" : "▸"}</span> <strong>{tries[0].etiquette}</strong>\n' +
      '                                  {tries.length > 1 && <span style={{ color: C.gris }}> + {tries.length - 1}</span>}\n' +
      "                                </button>\n" +
      "                                {ouvert &&\n" +
      "                                  tries.map((d) => (\n" +
      '                                    <div key={d.id} style={{ whiteSpace: "nowrap", paddingLeft: 14, color: d.libre ? C.gris : undefined }}>\n' +
      "                                      {d.etiquette} · {formatHeures(d.heures)}\n" +
      "                                    </div>\n" +
      "                                  ))}\n" +
      "                              </>\n" +
      "                            );\n" +
      "                          })()\n" +
      "                        )}\n" +
      "                      </td>",
  },
  {
    nom: "« tout déplier » dans le titre",
    cherche: '<th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }}>Affectations</th>',
    remplace: () =>
      '<th style={{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4" }}>\n' +
      "                    Affectations{\" \"}\n" +
      "                    <button\n" +
      '                      type="button"\n' +
      "                      onClick={() => {\n" +
      "                        setToutDeplie((v) => !v);\n" +
      "                        setAffOuvertes(new Set());\n" +
      "                      }}\n" +
      '                      style={{ all: "unset", cursor: "pointer", fontSize: 11, fontWeight: 700, color: C.rougeFonce, textTransform: "none", textDecoration: "underline" }}\n' +
      "                    >\n" +
      '                      {toutDeplie ? "tout replier" : "tout déplier"}\n' +
      "                    </button>\n" +
      "                  </th>",
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
if (!t.includes("TAUX_GLOBAL"))
  echec("lancez d'abord : node outils/maj-ressources-detail.mjs; node outils/maj-ressources-detail-compact.mjs; node outils/maj-ressources-taux-global.mjs");
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
