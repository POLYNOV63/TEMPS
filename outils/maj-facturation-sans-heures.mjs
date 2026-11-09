/* ===============================================================
   MAJ FACTURATION DU MOIS - PE / PI SANS HEURES (PEPI_SANS_HEURES)

   Une PE / PI sans aucune heure au relevé ce mois-ci (ni report, ni heures
   sup) n'a plus de ligne dans le tableau « À facturer ». Elle n'y figurait
   que parce que le classeur Suivi des prestations, importé, lui donnait un
   montant : ce cas est désormais signalé à part, dans un encadré « Le
   classeur prévoit un montant, le relevé est vide », pour vérification.

   À lancer à la racine du projet :   node outils/maj-facturation-sans-heures.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/facturation/page.tsx";
const MARQUEUR = "PEPI_SANS_HEURES";

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

const R = [
  [
    "état",
    "  const [reportes, setReportes] = useState<Reporte[]>([]);\n",
    `  const [reportes, setReportes] = useState<Reporte[]>([]);
  // ${MARQUEUR} : montant du classeur Suivi des prestations alors que le relevé est vide ce mois-ci
  const [classeurSeul, setClasseurSeul] = useState<{ numero: string; client: string | null; personne: string; montant: number }[]>([]);
`,
  ],
  ["liste", "        const reportes: Reporte[] = [];\n", "        const reportes: Reporte[] = [];\n        const classeurSeul: { numero: string; client: string | null; personne: string; montant: number }[] = [];\n"],
  [
    "lignes sans heures",
    "          if (montant <= 0.004 && facturees <= 0 && !(classeur !== null && classeur > 0.5)) continue;\n",
    `          // ${MARQUEUR} : rien au relevé ce mois-ci : pas de ligne ; un montant venu du classeur seul est signalé à part
          if (montant <= 0.004 && facturees <= 0) {
            if (classeur !== null && classeur > 0.5) {
              const slC = parNumero.get(a.numero.toUpperCase());
              const baseC = slC ? baseDe(slC) : undefined;
              const idC = slC?.client_id ?? baseC?.client_id;
              classeurSeul.push({ numero: \`CBE\${a.numero}\`, client: idC ? clients.get(idC) ?? null : null, personne: trig.get(l.collaborateur_id) ?? "?", montant: classeur });
            }
            continue;
          }
`,
  ],
  [
    "enregistrement",
    '        setReportes(reportes.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true })));\n',
    '        setReportes(reportes.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true })));\n        setClasseurSeul(classeurSeul.sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true })));\n',
  ],
  [
    "encadré",
    "            {reportes.length > 0 && (\n",
    `            {classeurSeul.length > 0 && (
              <details style={{ ...page.carte, padding: "10px 14px", marginTop: 14, borderLeft: "5px solid #c76500" }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, color: "#7a3e00" }}>
                  Le classeur prévoit un montant, le relevé est vide ({classeurSeul.length}) · {euros(classeurSeul.reduce((s, x) => s + x.montant, 0))}, compté nulle part
                </summary>
                <p style={{ margin: "6px 0", fontSize: 13, color: C.gris }}>
                  Ces PE / PI n’ont aucune heure au relevé ce mois-ci : elles ne sont donc pas à facturer. Le Suivi des prestations leur donne
                  pourtant un montant : vérifiez le relevé (heures oubliées ?) ou le classeur.
                </p>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                  <thead>
                    <tr>
                      <th style={th}>Client</th>
                      <th style={th}>N° CBE</th>
                      <th style={th}>Pers.</th>
                      <th style={thD}>Montant du classeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classeurSeul.map((x, i) => (
                      <tr key={\`\${x.numero}-\${x.personne}-\${i}\`}>
                        <td style={{ ...td, fontWeight: 700 }}>{x.client ?? "—"}</td>
                        <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>
                          {estAdmin ? (
                            <Link href={\`/pilotage/prestations?mois=\${mois}&affaire=\${encodeURIComponent(x.numero.replace(/^CBE/i, ""))}\`} style={{ color: C.rougeFonce }}>
                              {x.numero}
                            </Link>
                          ) : (
                            x.numero
                          )}
                        </td>
                        <td style={{ ...td, fontWeight: 800 }}>{x.personne}</td>
                        <td style={tdD}>{euros(x.montant)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {reportes.length > 0 && (
`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ PE / PI sans heures retirées du tableau");
console.log("✓ montants du classeur sans heures signalés à part");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
