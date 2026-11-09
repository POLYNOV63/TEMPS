/* ===============================================================
   MAJ PLANNING - UNE SEULE NAVIGATION, FIGÉE (PLANNING_NAV_UNIQUE)

   1. Planning des affaires : le bandeau figé du haut porte toute la
      navigation : ◀ semaine ▶, les dates (S45 à S52), « Aujourd'hui », la
      durée affichée, la frise des mois et « Voir une personne ». Le second
      sélecteur de période (qui défilait avec la page) disparaît ; la
      recherche et les filtres restent dessous.
   2. Les éléments figés (bandeau, ligne des dates, en-têtes de tableaux) se
      placent sous la navigation du haut quelle que soit sa hauteur (elle
      fait maintenant deux lignes) : variable --hauteur-nav mesurée par
      components/pilotage/OngletsPilotage.tsx. Pages : Planning des
      affaires, Planning par ressource, Charge par ressource, Suivi des
      affaires.

   À lancer à la racine du projet :   node outils/maj-planning-navigation.mjs
   Tout ou rien pour le planning des affaires et le bandeau ; les autres
   pages sont ajustées si elles sont trouvées. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "PLANNING_NAV_UNIQUE";
const NAV = "var(--hauteur-nav, 50px)";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

/* ---------- 1. le bandeau de navigation mesure sa hauteur ---------- */
const ONGLETS = "components/pilotage/OngletsPilotage.tsx";
if (!existsSync(ONGLETS)) echec(`Fichier introuvable : ${ONGLETS}.`);
let on = lire(ONGLETS);
if (!on.includes("NAVIGATION_AXES")) echec(`${ONGLETS} : installez d'abord la navigation par axes (maj-navigation-axes.zip).`);
const ecritures = [];
if (!on.includes(MARQUEUR)) {
  const r = [
    ['import { useEffect, useState } from "react";', 'import { useEffect, useRef, useState } from "react";'],
    [
      "  const courant = ONGLETS.find((o) => o.cle === actif);",
      `  /* ${MARQUEUR} : la hauteur du bandeau, pour que les éléments figés des pages se placent juste dessous */
  const refNav = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = refNav.current;
    if (!el) return;
    const maj = () => document.documentElement.style.setProperty("--hauteur-nav", \`\${Math.round(el.getBoundingClientRect().height)}px\`);
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const courant = ONGLETS.find((o) => o.cle === actif);`,
    ],
    ['    <nav\n      aria-label="Navigation"', '    <nav\n      ref={refNav}\n      aria-label="Navigation"'],
  ];
  for (const [a] of r) if (compter(on, a) !== 1) echec(`${ONGLETS} : repère introuvable (${a.slice(0, 40)}…).`);
  for (const [a, b] of r) on = on.replace(a, () => b);
  ecritures.push([ONGLETS, on, "mesure de la hauteur du bandeau"]);
}

/* ---------- 2. planning des affaires ---------- */
const PLANNING = "app/pilotage/affaires/page.tsx";
if (!existsSync(PLANNING)) echec(`Fichier introuvable : ${PLANNING}.`);
let pl = lire(PLANNING);
if (!pl.includes(MARQUEUR)) {
  const r = [
    [
      "dates dans le bandeau",
      `                <span>
                  {formatDate(lundi)} → {formatDate(colonnes[colonnes.length - 1])}
                  <span style={{ color: C.gris, fontWeight: 600 }}> · S{numeroSemaine(lundi)}</span>
                </span>`,
      `                {/* ${MARQUEUR} : toute la navigation dans ce bandeau figé */}
                <span>
                  {formatDate(lundi)} → {formatDate(colonnes[colonnes.length - 1])}
                  <span style={{ color: C.gris, fontWeight: 600 }}>
                    {" "}
                    · S{numeroSemaine(lundi)} à S{numeroSemaine(colonnes[colonnes.length - 1] ?? lundi)}
                  </span>
                </span>`,
    ],
    [
      "« Aujourd'hui » et durée dans le bandeau",
      `<button type="button" aria-label="Semaine suivante" onClick={() => setLundi(ajouterJours(lundi, 7))} style={{ ...fleche, minWidth: 30, minHeight: 26, padding: "0 6px" }}>▶</button>`,
      `<button type="button" aria-label="Semaine suivante" onClick={() => setLundi(ajouterJours(lundi, 7))} style={{ ...fleche, minWidth: 30, minHeight: 26, padding: "0 6px" }}>▶</button>
                <button
                  type="button"
                  onClick={() => setLundi(ajouterJours(lundiDe(aujourdhui), -7))}
                  style={{ all: "unset", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#1f4e99", textDecoration: "underline" }}
                >
                  Aujourd’hui
                </button>
                <select
                  value={nbSemaines}
                  onChange={(e) => setNbSemaines(Number(e.target.value))}
                  aria-label="Durée affichée"
                  style={{ minHeight: 28, borderRadius: 6, border: "1.5px solid #c9cdd2", fontFamily: "inherit", fontWeight: 700, padding: "0 6px" }}
                >
                  {[2, 4, 8, 12, 26, 52].map((n) => (
                    <option key={n} value={n}>
                      {n === 52 ? "1 an" : \`\${n} semaines\`}
                    </option>
                  ))}
                </select>`,
    ],
    [
      "durée retirée de la seconde ligne",
      `            <span style={{ width: 8 }} />
            {[2, 4, 8, 12, 26, 52].map((n) => (
              <button key={n} type="button" aria-pressed={nbSemaines === n} style={bouton(nbSemaines === n)} onClick={() => setNbSemaines(n)}>
                {n === 52 ? "1 an" : \`\${n} sem.\`}
              </button>
            ))}
`,
      "",
    ],
    ["bandeau sous la navigation", `                position: "sticky",\n                top: 50,\n                zIndex: 20,`, `                position: "sticky",\n                top: "${NAV}",\n                zIndex: 20,`],
    ["dates sous le bandeau", `                  position: "sticky",\n                  top: 128,\n                  zIndex: 15,`, `                  position: "sticky",\n                  top: "calc(${NAV} + 78px)",\n                  zIndex: 15,`],
    ["barre sélectionnée", `<div style={{ position: "sticky", top: 56, zIndex: 30, marginBottom: 10 }}>`, `<div style={{ position: "sticky", top: "calc(${NAV} + 6px)", zIndex: 30, marginBottom: 10 }}>`],
  ];
  for (const [nom, a] of r) if (compter(pl, a) !== 1) echec(`${PLANNING} : passage « ${nom} » trouvé ${compter(pl, a)} fois (attendu : 1).`);
  for (const [, a, b] of r) pl = pl.replace(a, () => b);

  // le second sélecteur de période (◀ dates ▶ Aujourd'hui) disparaît
  const D = `          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>\n            <button type="button" aria-label="Période précédente"`;
  const F = `          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>\n            <input\n              type="search"`;
  if (compter(pl, D) !== 1 || compter(pl, F) !== 1) echec(`${PLANNING} : second sélecteur de période introuvable.`);
  const i = pl.indexOf(D);
  const j = pl.indexOf(F);
  if (j < i) echec(`${PLANNING} : blocs dans un ordre inattendu.`);
  pl = pl.slice(0, i) + pl.slice(j);
  ecritures.push([PLANNING, pl, "une seule navigation, figée"]);
}

/* ---------- 3. autres pages : leurs éléments figés sous la navigation ---------- */
const AUTRES = [
  ["app/pilotage/planning-ressources/page.tsx", [[/position: "sticky", top: 50,/g, `position: "sticky", top: "${NAV}",`], [/position: "sticky", top: 112,/g, `position: "sticky", top: "calc(${NAV} + 62px)",`]]],
  ["app/pilotage/ressources/page.tsx", [[/position: "sticky", top: 50,/g, `position: "sticky", top: "${NAV}",`]]],
  ["app/pilotage/page.tsx", [[/top: 49px;/g, `top: ${NAV.replace("50px", "49px")};`]]],
];

for (const [f, t, quoi] of ecritures) writeFileSync(f, t, "utf8"), console.log(`✓ ${f} : ${quoi}`);
for (const [f, regles] of AUTRES) {
  if (!existsSync(f)) continue;
  let t = lire(f);
  let n = 0;
  for (const [re, par] of regles) t = t.replace(re, () => (n++, par));
  if (n > 0) {
    writeFileSync(f, t, "utf8");
    console.log(`✓ ${f} : ${n} élément${n > 1 ? "s" : ""} figé${n > 1 ? "s" : ""} placé${n > 1 ? "s" : ""} sous la navigation`);
  } else console.log(`✓ ${f} : rien à changer`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
