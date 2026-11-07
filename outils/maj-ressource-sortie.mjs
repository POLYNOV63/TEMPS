/* ===============================================================
   MAJ PLANNING - RESSOURCE SORTIE (RESSOURCE_SORTIE)

   - lib/pilotageCalculs.ts : la date de sortie dans l'annuaire (SQL 89) ;
   - planning par ressource : jours après la date de sortie grisés
     (« Sorti »), nom grisé avec « sortie le … », ligne estompée une fois
     la date passée ;
   - fenêtres d'affectation (Affecter, Événement / Prévisionnel, Fiche
     ressource) : une personne dont la date de sortie est passée n'est
     plus proposée (sauf si elle est déjà sur l'affectation modifiée).

   À lancer à la racine du projet, APRÈS le SQL 89 :
       node outils/maj-ressource-sortie.mjs
   Tout ou rien (les cinq fichiers sont vérifiés avant d'écrire).
   Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "RESSOURCE_SORTIE";
const AUJ = "new Date().toISOString().slice(0, 10)";

const FICHIERS = [
  {
    f: "lib/pilotageCalculs.ts",
    r: [
      [
        "date de sortie dans l'annuaire",
        "  nom: string | null;\n  inclus_statistiques: boolean;\n};",
        "  nom: string | null;\n  inclus_statistiques: boolean;\n  date_sortie?: string | null; // RESSOURCE_SORTIE : dernier jour travaillé (SQL 89)\n};",
      ],
    ],
  },
  {
    f: "components/pilotage/AffectationDialog.tsx",
    r: [
      [
        "personnes sorties retirées du choix",
        "            {annuaire.map((c) => (\n              <button\n                key={c.id}",
        `            {/* RESSOURCE_SORTIE : une personne sortie n'est plus proposée */}\n            {annuaire.filter((c) => !c.date_sortie || c.date_sortie >= ${AUJ} || ressources.includes(c.id)).map((c) => (\n              <button\n                key={c.id}`,
      ],
    ],
  },
  {
    f: "components/pilotage/AffecterDialog.tsx",
    r: [
      [
        "personnes sorties retirées du choix",
        "{annuaire.map((c) => (",
        `{/* RESSOURCE_SORTIE */ annuaire.filter((c) => !c.date_sortie || c.date_sortie >= ${AUJ} || c.id === collab).map((c) => (`,
      ],
    ],
  },
  {
    f: "components/pilotage/FicheRessourceDialog.tsx",
    r: [
      [
        "personnes sorties retirées du choix",
        "{annuaire.map((c) => (",
        `{/* RESSOURCE_SORTIE */ annuaire.filter((c) => !c.date_sortie || c.date_sortie >= ${AUJ} || c.id === collab).map((c) => (`,
      ],
    ],
  },
  {
    f: "app/pilotage/planning-ressources/page.tsx",
    r: [
      [
        "ligne estompée une fois la date passée",
        "rowGap: 2, padding: \"6px 0\", borderBottom: `1px solid ${C.ligne}` }}>",
        "rowGap: 2, padding: \"6px 0\", borderBottom: `1px solid ${C.ligne}`, opacity: l.collab.date_sortie && l.collab.date_sortie < aujourdhui ? 0.5 : 1 /* RESSOURCE_SORTIE */ }}>",
      ],
      [
        "nom grisé, date de sortie",
        "                    <strong style={{ fontSize: 15 }}>{nomCollab(l.collab)}</strong>\n                    <span style={{ fontSize: 11, color: C.gris, overflow: \"hidden\", textOverflow: \"ellipsis\", whiteSpace: \"nowrap\" }}>{`${l.collab.prenom ?? \"\"} ${l.collab.nom ?? \"\"}`.trim()}</span>",
        "                    <strong style={{ fontSize: 15, color: l.collab.date_sortie && l.collab.date_sortie < aujourdhui ? C.gris : undefined }}>{nomCollab(l.collab)}</strong>\n" +
          "                    <span style={{ fontSize: 11, color: C.gris, overflow: \"hidden\", textOverflow: \"ellipsis\", whiteSpace: \"nowrap\" }}>{`${l.collab.prenom ?? \"\"} ${l.collab.nom ?? \"\"}`.trim()}</span>\n" +
          "                    {l.collab.date_sortie && (\n" +
          "                      <span style={{ fontSize: 11, fontWeight: 700, color: \"#7a3e00\", whiteSpace: \"nowrap\" }}>sortie le {formatDate(l.collab.date_sortie)}</span>\n" +
          "                    )}",
      ],
      [
        "jours après la sortie grisés",
        "                  {/* ABSENT_ECRIT : jour de congé validé (capacité nulle un jour normalement travaillé) */}\n",
        `                  {/* RESSOURCE_SORTIE : jours après la date de sortie */}
                  {l.collab.date_sortie &&
                    colonnes.map((j, i) =>
                      j > (l.collab.date_sortie as string) ? (
                        <div
                          key={\`so-\${j}\`}
                          title={\`\${nomCollab(l.collab)} : sorti(e) le \${formatDate(l.collab.date_sortie as string)}\`}
                          style={{
                            gridColumn: col(i),
                            gridRow: \`1 / span \${Math.max(2, l.voies)}\`,
                            margin: "-6px 0",
                            background: "repeating-linear-gradient(45deg,#d5d8dc,#d5d8dc 4px,#eceef1 4px,#eceef1 8px)",
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
                          Sorti
                        </div>
                      ) : null
                    )}
`,
        "avant",
      ],
    ],
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

const resultats = [];
for (const { f, r } of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  for (const [nom, a] of r) {
    const n = t.split(a).length - 1;
    if (n !== 1) echec(`${f} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const [, a, b, avant] of r) t = t.replace(a, () => (avant ? b + a : b));
  resultats.push([f, t, r.map(([nom]) => nom)]);
}
for (const [f, t, noms] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : ${noms.join(", ")}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
