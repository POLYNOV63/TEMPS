/* ===============================================================
   MAJ DISPONIBILITÉS PAR ACTIVITÉ - DÉTAIL SOUS LES GRAPHIQUES
   (DETAIL_SOUS_GRAPHIQUES)

   Un clic sur une barre de semaine ouvre le détail juste sous les
   graphiques (au lieu du bas de page), avec la page qui s'y place :
   - capacité, occupées (dont prévisionnel), disponibles par niveau,
     surcharge, en vignettes ;
   - un tableau personne par personne : capacité, occupé, libre ou
     surcharge (les plus libres d'abord), avec une barre.
   Re-cliquer sur la barre (ou ×) le referme.

   À lancer à la racine du projet :   node outils/maj-dispos-detail.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/charge-activites/page.tsx";
const MARQUEUR = "DETAIL_SOUS_GRAPHIQUES";

const DETAIL = `        {/* DETAIL_SOUS_GRAPHIQUES : le détail de la semaine cliquée, juste sous les graphiques */}
        {detail &&
          (() => {
            const d = donnees.find((x) => x.cle === detail.cle);
            if (!d) return null;
            const w = detail.w;
            const personnes = [...d.personnes].sort((a, b) => b.semaines[w].capa - b.semaines[w].occ - (a.semaines[w].capa - a.semaines[w].occ));
            const echelle = Math.max(1, ...personnes.map((p) => Math.max(p.semaines[w].capa, p.semaines[w].occ)));
            const vignette = (titre: string, valeur: string, couleur?: string, sous?: string) => (
              <div style={{ flex: "1 1 150px", border: \`1px solid \${C.ligne}\`, borderRadius: 10, padding: "8px 12px", background: "#ffffff" }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>{titre}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: couleur }}>{valeur}</div>
                {sous && <div style={{ fontSize: 12, color: C.gris }}>{sous}</div>}
              </div>
            );
            return (
              <section id="detail-semaine" style={{ ...page.carte, padding: 16, marginBottom: 16, borderLeft: \`5px solid \${d.couleur}\` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>
                    <span style={{ color: d.couleur }}>{d.libelle}</span> · semaine S{numeroSemaine(semaines[w])}
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.gris }}>
                      {" "}
                      · du {formatDate(semaines[w])} au {formatDate(ajouterJours(semaines[w], 4))}
                    </span>
                  </h2>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setDetail(null)} aria-label="Fermer le détail" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                    ×
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                  {vignette("Capacité", h(d.capa[w]), undefined, \`\${d.personnes.length} personne\${d.personnes.length > 1 ? "s" : ""}\`)}
                  {vignette("Occupées", h(d.occ[w]), undefined, d.prev[w] >= 0.5 ? \`dont prévisionnel \${h(d.prev[w])}\` : undefined)}
                  {vignette(
                    "Disponibles",
                    h(d.dispo[w]),
                    d.dispo[w] >= 0.5 ? "#1b5e20" : C.gris,
                    NIVEAUX.map((nv, k) => (d.parNiveau[k][w] >= 0.5 ? \`\${nv.libelle.replace("Niveau non renseigné", "non renseigné")} \${h(d.parNiveau[k][w])}\` : ""))
                      .filter(Boolean)
                      .join(" · ") || undefined
                  )}
                  {d.surcharge[w] >= 0.5 && vignette("Surcharge", h(d.surcharge[w]), ROUGE, "au-delà de la capacité de certains")}
                </div>
                {personnes.length === 0 ? (
                  <span style={{ color: C.gris }}>Personne n’a cette activité comme activité principale.</span>
                ) : (
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        {["Personne", "Capacité", "Occupé", "Charge", "Libre"].map((t) => (
                          <th key={t} style={{ ...page.th, textAlign: t === "Personne" ? "left" : "center", padding: "6px 8px" }}>
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {personnes.map((p, i) => {
                        const x = p.semaines[w];
                        const libre = x.capa - x.occ;
                        return (
                          <tr key={p.c.id} style={{ background: i % 2 ? "#fafbfc" : undefined }}>
                            <td style={{ ...page.td, padding: "6px 8px", whiteSpace: "nowrap" }}>
                              <strong>{nomCollab(p.c)}</strong>
                              {p.aussi.length > 0 && <span style={{ color: C.gris, fontSize: 12 }}> · aussi {p.aussi.join(", ")}</span>}
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", textAlign: "center" }}>{formatHeures(x.capa)}</td>
                            <td style={{ ...page.td, padding: "6px 8px", textAlign: "center" }}>{formatHeures(x.occ)}</td>
                            <td style={{ ...page.td, padding: "6px 8px", width: "35%" }}>
                              <div style={{ position: "relative", height: 14, background: "#eef0f3", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: \`\${(Math.min(x.occ, x.capa) / echelle) * 100}%\`, background: d.couleur, opacity: 0.85 }} />
                                {x.occ > x.capa && (
                                  <div style={{ position: "absolute", left: \`\${(x.capa / echelle) * 100}%\`, top: 0, bottom: 0, width: \`\${((x.occ - x.capa) / echelle) * 100}%\`, background: \`repeating-linear-gradient(45deg,\${ROUGE},\${ROUGE} 3px,#f3b1ae 3px,#f3b1ae 6px)\` }} />
                                )}
                                <div style={{ position: "absolute", left: \`\${(x.capa / echelle) * 100}%\`, top: 0, bottom: 0, width: 2, background: "#1f2328" }} />
                              </div>
                            </td>
                            <td style={{ ...page.td, padding: "6px 8px", textAlign: "center", fontWeight: 800, color: libre < -0.5 ? ROUGE : libre >= 0.5 ? "#1b5e20" : C.gris, whiteSpace: "nowrap" }}>
                              {libre < -0.5 ? \`surcharge \${formatHeures(-libre)}\` : libre >= 0.5 ? \`libre \${formatHeures(libre)}\` : "complet"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })()}
`;

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

// 1. l'ancien détail (en bas du tableau récapitulatif) est retiré
const ANCIEN_DEBUT = "          {detail &&\n            (() => {\n              const d = donnees.find((x) => x.cle === detail.cle);";
const ANCIEN_FIN = "            })()}\n        </section>\n";
if (compter(t, ANCIEN_DEBUT) !== 1) echec(`${FICHIER} : ancien détail introuvable.`);
const i = t.indexOf(ANCIEN_DEBUT);
const j = t.indexOf(ANCIEN_FIN, i);
if (j < 0) echec(`${FICHIER} : fin de l'ancien détail introuvable.`);
t = t.slice(0, i) + "        </section>\n" + t.slice(j + ANCIEN_FIN.length);

// 2. le nouveau détail, juste sous les graphiques (avant la légende)
const LEGENDE = '        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, margin: "-6px 0 16px" }}>\n';
if (compter(t, LEGENDE) !== 1) echec(`${FICHIER} : légende des graphiques introuvable.`);
t = t.replace(LEGENDE, (x) => x.replace('margin: "-6px 0 16px"', 'margin: "-6px 0 16px"') + "");
const k = t.indexOf(LEGENDE);
const finLegende = t.indexOf("        </div>\n", k) + "        </div>\n".length;
t = t.slice(0, finLegende) + "\n" + DETAIL + t.slice(finLegende);

// 3. la page vient se placer sur le détail quand on clique sur une barre
const ETAT = "  const [detail, setDetail] = useState<{ cle: string; w: number } | null>(null);\n";
if (compter(t, ETAT) !== 1) echec(`${FICHIER} : état du détail introuvable.`);
t = t.replace(
  ETAT,
  (x) =>
    x +
    '  useEffect(() => {\n    if (detail) window.setTimeout(() => document.getElementById("detail-semaine")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);\n  }, [detail]);\n'
);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ ancien détail (bas de page) retiré");
console.log("✓ détail de la semaine sous les graphiques");
console.log("✓ la page se place sur le détail au clic");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
