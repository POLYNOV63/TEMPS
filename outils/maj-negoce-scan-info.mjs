/* ===============================================================
   MAJ - NÉGOCE ET SCAN : TEMPS PASSÉ, SANS ALERTE (TEMPS_PASSE_INFO)

   Négoce et Scan (vendus au montant) : jamais d'alerte de dépassement,
   seulement l'information du temps passé, même s'ils ont des heures
   chiffrées.
   - lib/pilotageCalculs.ts : plus d'alerte d'heures (portefeuille, alertes) ;
   - Analyse du chiffré : pastille « X h passées » au lieu de la jauge et
     de « +X h » ; hors de la tuile « Au-delà du chiffré » ;
   - Analyse du chiffré : le bloc « Avancement accompli / Achats reçus »
     du détail d'une affaire est retiré (les valeurs déjà saisies restent
     en base et continuent de servir aux en-cours).

   À lancer à la racine du projet, APRÈS maj-scan-a-part.mjs :
       node outils/maj-negoce-scan-info.mjs
   Tout ou rien (les deux fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "TEMPS_PASSE_INFO";
const FICHIERS = [
  {
    f: "lib/pilotageCalculs.ts",
    r: [
      [
        "négoce et scan : jamais d'alerte d'heures",
        '  if (a.type === "CBE" && estNegoceImp(a.imputation) && t.chiffre === 0) {',
        '  // TEMPS_PASSE_INFO : chiffré ou non, le négoce et le scan n\'ont que l\'information du temps passé\n  if (a.type === "CBE" && estNegoceImp(a.imputation)) {',
      ],
    ],
  },
  {
    f: "app/analyse/pointage/page.tsx",
    r: [
      [
        "tuile « Au-delà du chiffré » sans négoce ni scan",
        "      if (v.chiffre > 0 && v.fin > v.chiffre + 0.5) t.depassees++;",
        "      if (v.chiffre > 0 && v.fin > v.chiffre + 0.5 && !estNegoceImp(f.imputation)) t.depassees++; // TEMPS_PASSE_INFO",
      ],
      ["boucle des totaux", "    for (const { v } of lignes) {\n      t.chiffre += v.chiffre;", "    for (const { f, v } of lignes) {\n      t.chiffre += v.chiffre;"],
      [
        "filtre « au-delà » sans négoce ni scan",
        "!seulementAlertes || (v.chiffre > 0 ? v.fin > v.chiffre + 0.5 : v.fin > 0.5 && !estNegoceImp(f.imputation))",
        "!seulementAlertes || (!estNegoceImp(f.imputation) && (v.chiffre > 0 ? v.fin > v.chiffre + 0.5 : v.fin > 0.5))",
      ],
      [
        "jauge remplacée par « temps passé »",
        "                          <td style={td}>{jauge(v.chiffre, v.fin)}</td>",
        '                          <td style={td}>{estNegoceImp(f.imputation) ? <span style={{ fontSize: 12, color: C.gris }}>temps passé</span> : jauge(v.chiffre, v.fin)}</td>',
      ],
      [
        "pas de « +X h » pour négoce et scan",
        '{v.chiffre > 0 && v.fin > v.chiffre + 0.5 && <Pastille genre="crit">+{formatHeures(v.fin - v.chiffre)}</Pastille>}',
        '{v.chiffre > 0 && v.fin > v.chiffre + 0.5 && !estNegoceImp(f.imputation) && <Pastille genre="crit">+{formatHeures(v.fin - v.chiffre)}</Pastille>}',
      ],
      [
        "pastille « X h passées »",
        '{v.chiffre === 0 && v.fin > 0.5 && (estNegoceImp(f.imputation) ? <Pastille genre="info">vendu au montant</Pastille> : <Pastille genre="warn">non chiffré</Pastille>)}',
        '{estNegoceImp(f.imputation)\n                                ? v.fin > 0.5 && <Pastille genre="info">{formatHeures(v.fin)} passées</Pastille>\n                                : v.chiffre === 0 && v.fin > 0.5 && <Pastille genre="warn">non chiffré</Pastille>}',
      ],
      [
        "détail par activité",
        '{va.chiffre > 0 ? jauge(va.chiffre, va.fin) : <Pastille genre="warn">non chiffré</Pastille>}',
        '{estNegoceImp(f.imputation) ? <span style={{ color: C.gris }}>{formatHeures(va.fin)} passées</span> : va.chiffre > 0 ? jauge(va.chiffre, va.fin) : <Pastille genre="warn">non chiffré</Pastille>}',
      ],
    ],
  },
];

/* bloc « Avancement accompli / Achats reçus » retiré du détail */
const DEBUT_BLOC =
  "                                {(() => {\n" +
  "                                  const baseId = (f.membres.find((m) => /^\\d+$/.test(m.numero)) ?? f.membres[0])?.id;\n" +
  "                                  if (!baseId) return null;\n" +
  "                                  const av = avancements.get(baseId);\n";
const FIN_BLOC = "                                {f.membres.length > 1 && (\n";

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
  if (!t.includes("SCAN_A_PART")) echec(`${f} : lancez d'abord maj-scan-a-part.mjs.`);
  for (const [nom, a] of r) {
    const n = t.split(a).length - 1;
    if (n !== 1) echec(`${f} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const [, a, b] of r) t = t.replace(a, () => b);
  if (f.endsWith("pointage/page.tsx")) {
    if (t.split(DEBUT_BLOC).length - 1 !== 1 || t.split(FIN_BLOC).length - 1 !== 1) echec(`${f} : bloc « Avancement accompli / Achats reçus » introuvable.`);
    const i = t.indexOf(DEBUT_BLOC);
    const j = t.indexOf(FIN_BLOC, i);
    if (j < 0) echec(`${f} : fin du bloc « Avancement accompli » introuvable.`);
    t = t.slice(0, i) + "                                {/* TEMPS_PASSE_INFO : avancement et achats reçus ne se saisissent plus ici */}\n" + t.slice(j);
  }
  resultats.push([f, t]);
}
for (const [f, t] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
