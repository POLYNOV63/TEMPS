/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - BANDEAU « ÉQUIPE BE » (BANDEAU_EQUIPE)

   Les quatre tuiles du haut et la ligne « Équipe BE » du bas du tableau
   sont remplacées par un bandeau en tête de page, sur la période choisie
   (1, 2 ou 4 semaines), toutes activités, encadrement exclu :
   affecté / capacité, barre et % de charge, heures disponibles réparties
   par NIVEAU (fiche collaborateur, SQL 86 ; 1 clair → 3 foncé), personnes
   en surcharge.

   À lancer à la racine du projet, APRÈS maj-ressources-specialite.mjs :
       node outils/maj-ressources-bandeau-equipe.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "BANDEAU_EQUIPE";

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
if (!t.includes("ACTIVITE_SPECIALITE")) echec("lancez d'abord les scripts précédents du tableau (jusqu'à maj-ressources-specialite.mjs).");

/* 1. niveaux des collaborateurs */
const ETAT = "  const [toutDeplie, setToutDeplie] = useState(false);\n";
if (compter(t, ETAT) !== 1) echec("repère « toutDeplie » introuvable.");
t = t.replace(
  ETAT,
  (x) =>
    x +
    `  // BANDEAU_EQUIPE : niveau de chacun (SQL 86 ; sans la table, tout est « non renseigné »)
  const [niveauxCollab, setNiveauxCollab] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    void supabase
      .from("collaborateurs_niveaux")
      .select("collaborateur_id,niveau")
      .then(({ data }) => setNiveauxCollab(new Map(((data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0]))));
  }, []);
`
);

/* 2. les tuiles -> le bandeau */
const DEBUT_TUILES = '        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>\n          <Tuile libelle="Capacité disponible"';
const FIN_TUILES = "            accent={surcharges.length > 0}\n          />\n        </div>\n";
if (compter(t, DEBUT_TUILES) !== 1 || compter(t, FIN_TUILES) !== 1) echec("tuiles du haut introuvables.");
const i = t.indexOf(DEBUT_TUILES);
const j = t.indexOf(FIN_TUILES, i) + FIN_TUILES.length;
const BANDEAU = `        {/* BANDEAU_EQUIPE : l'équipe BE en un coup d'œil, sur la période du détail */}
        {(() => {
          const NIV = [
            { n: 1, lib: "N1", aide: "niveau 1 : exécute sous supervision", couleur: "#c8e6c9" },
            { n: 2, lib: "N2", aide: "niveau 2 : autonome sur une affaire courante", couleur: "#66bb6a" },
            { n: 3, lib: "N3", aide: "niveau 3 : expert ou référent", couleur: "#2e7d32" },
            { n: 0, lib: "non renseigné", aide: "niveau à saisir dans la fiche collaborateur", couleur: "#e3e7e3" },
          ];
          const libres = NIV.map((nv) =>
            equipe.filter((l) => (niveauxCollab.get(l.collab.id) ?? 0) === nv.n).reduce((s, l) => s + Math.max(0, l.semaine.net - l.semaine.affecte), 0)
          );
          const libreTotal = libres.reduce((s, x) => s + x, 0);
          const taux = totalNet > 0 ? totalAffecte / totalNet : 0;
          const etiquette: CSSProperties = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris, marginBottom: 4 };
          return (
            <section style={{ ...page.carte, padding: "14px 18px", marginBottom: 20, borderLeft: \`5px solid \${C.rouge}\` }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: "14px 30px" }}>
                <div style={{ minWidth: 150 }}>
                  <div style={etiquette}>Équipe BE · toutes activités</div>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>
                    {nbSemDetail === 1 ? \`Semaine S\${numeroSemaine(lundi)}\` : \`S\${numeroSemaine(lundi)} à S\${numeroSemaine(ajouterJours(lundi, 7 * (nbSemDetail - 1)))}\`}
                  </div>
                  <div style={{ fontSize: 12, color: C.gris }}>{equipe.length} personnes · hors encadrement</div>
                </div>
                <div>
                  <div style={etiquette}>Affecté / capacité</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>
                    {formatHeures(totalAffecte)} <span style={{ fontSize: 16, color: C.gris, fontWeight: 600 }}>/ {formatHeures(totalNet)}</span>
                  </div>
                  {totalTheorique - totalNet > 0.01 && <div style={{ fontSize: 12, color: C.gris }}>− {formatHeures(totalTheorique - totalNet)} fériés et absences</div>}
                </div>
                <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                  <div style={etiquette}>Charge</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 14, borderRadius: 4, background: "#eef0f3", overflow: "hidden" }}>
                      <div style={{ width: \`\${Math.min(100, taux * 100)}%\`, height: "100%", background: taux > 1.001 ? "#b3261e" : taux >= 0.8 ? "#34506b" : "#8fb0d6" }} />
                    </div>
                    <strong style={{ fontSize: 24, color: taux > 1.001 ? "#8f1010" : C.encre }}>{Math.round(taux * 100)} %</strong>
                  </div>
                </div>
                <div style={{ minWidth: 220 }}>
                  <div style={etiquette}>Disponible</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: libreTotal >= 0.5 ? "#1b5e20" : C.gris }}>{formatHeures(libreTotal)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {NIV.map((nv, k) =>
                      nv.n === 0 && libres[k] < 0.5 ? null : (
                        <span key={nv.n} title={nv.aide} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#3b4046" }}>
                          <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: nv.couleur, border: "1px solid #c9d1c9" }} />
                          {nv.lib} {formatHeures(libres[k])}
                        </span>
                      )
                    )}
                  </div>
                </div>
                <div style={{ minWidth: 150, maxWidth: 260 }}>
                  <div style={etiquette}>En surcharge</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: surcharges.length > 0 ? "#8f1010" : "#1b5e20" }}>
                    {surcharges.length > 0 ? \`\${surcharges.length} pers.\` : "personne"}
                  </div>
                  {surcharges.length > 0 && (
                    <div style={{ fontSize: 12, color: C.gris }}>{surcharges.map((l) => \`\${nomCollab(l.collab)} +\${formatHeures(l.semaine.ecart)}\`).join(" · ")}</div>
                  )}
                </div>
              </div>
            </section>
          );
        })()}
`;
t = t.slice(0, i) + BANDEAU + t.slice(j);

/* 3. la ligne « Équipe BE » du bas du tableau disparaît */
const LIGNE = '<td style={{ ...page.td, background: "#f8f9fa" }}><strong>Équipe BE</strong>';
if (compter(t, LIGNE) !== 1) echec("ligne « Équipe BE » du tableau introuvable.");
const k = t.indexOf(LIGNE);
const debutLigne = t.lastIndexOf("                <tr>\n", k);
const finLigne = t.indexOf("              </tbody>", k);
if (debutLigne < 0 || finLigne < 0 || k - debutLigne > 40) echec("limites de la ligne « Équipe BE » introuvables.");
t = t.slice(0, debutLigne) + t.slice(finLigne);

/* 4. CSSProperties disponible */
if (!/type CSSProperties/.test(t)) {
  const IMP = 'import { Fragment, useEffect, useMemo, useState } from "react";';
  if (compter(t, IMP) !== 1) echec("import de React introuvable.");
  t = t.replace(IMP, () => 'import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";');
}

writeFileSync(FICHIER, t, "utf8");
console.log("✓ niveaux des collaborateurs lus");
console.log("✓ tuiles remplacées par le bandeau « Équipe BE »");
console.log("✓ ligne « Équipe BE » retirée du bas du tableau");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
