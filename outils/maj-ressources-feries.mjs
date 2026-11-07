/* ===============================================================
   MAJ PLANNING PAR RESSOURCE - JOURS FÉRIÉS GRISÉS (FERIES_GRISES)

   Les jours fériés sont grisés dans l'en-tête des dates et sur toute la
   hauteur de chaque personne, avec la mention « Férié ».

   À lancer à la racine du projet :   node outils/maj-ressources-feries.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/planning-ressources/page.tsx";
const MARQUEUR = "FERIES_GRISES";

const remplacements = [
  {
    nom: "import du calendrier des fériés",
    cherche: 'import { ajouterJours, construireCapacites, estWeekend, lundiDe, numeroSemaine, type Affectation, type Capacites, type JourRow } from "@/lib/pilotagePlanning";',
    remplace: () =>
      'import { ajouterJours, construireCapacites, estFerie, estWeekend, lundiDe, numeroSemaine, type Affectation, type Capacites, type JourRow } from "@/lib/pilotagePlanning";',
  },
  {
    nom: "en-tête : date du férié grisée",
    cherche:
      '<div key={j} style={{ gridColumn: col(i), gridRow: 3, textAlign: "center", fontSize: nbSemaines > 8 ? 9 : 11, fontWeight: 700, color: j === aujourdhui ? C.rougeFonce : C.gris, background: j === aujourdhui ? "#fff4f4" : "#ffffff",',
    remplace: () =>
      '<div key={j} title={estFerie(j) ? "Jour férié" : undefined} style={{ gridColumn: col(i), gridRow: 3, textAlign: "center", fontSize: nbSemaines > 8 ? 9 : 11, fontWeight: 700, color: j === aujourdhui ? C.rougeFonce : C.gris, background: estFerie(j) ? "#dfe2e6" : j === aujourdhui ? "#fff4f4" : "#ffffff",',
  },
  {
    nom: "lignes : colonne du férié grisée",
    cherche: "                  {/* ABSENT_ECRIT : jour de congé validé (capacité nulle un jour normalement travaillé) */}\n",
    remplace: (x) =>
      `                  {/* FERIES_GRISES : jour férié grisé sur toute la hauteur de la personne */}
                  {colonnes.map((j, i) =>
                    estFerie(j) ? (
                      <div
                        key={\`fe-\${j}\`}
                        title={\`Jour férié (\${formatDate(j)})\`}
                        style={{
                          gridColumn: col(i),
                          gridRow: \`1 / span \${Math.max(2, l.voies)}\`,
                          margin: "-6px 0",
                          background: "#e3e6ea",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          fontSize: 9,
                          fontWeight: 800,
                          color: "#6b7178",
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          zIndex: 0,
                        }}
                      >
                        Férié
                      </div>
                    ) : null
                  )}
` + x,
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
  t = t.replace(r.cherche, (x) => r.remplace(x));
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
