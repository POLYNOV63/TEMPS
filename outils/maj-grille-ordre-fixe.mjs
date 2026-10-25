/* ===============================================================
   Ma semaine, saisie en grille (GrilleSemaine.tsx) : chaque affaire
   GARDE SA PLACE de haut en bas pendant la saisie. Une affaire (ou une
   ligne Divers) ajoutée se met en bas ; rien d'autre ne bouge. L'ordre
   repart de zéro quand on change de semaine.
   Utilisation (à la racine du projet) :  node outils/maj-grille-ordre-fixe.mjs
================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function chercher(dossier) {
  for (const nom of readdirSync(dossier)) {
    if (nom === "node_modules" || nom.startsWith(".")) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      const trouve = chercher(chemin);
      if (trouve) return trouve;
    } else if (nom === "GrilleSemaine.tsx") return chemin;
  }
  return null;
}
const chemin = chercher("app") ?? chercher("components");
if (!chemin) {
  console.error("✗ GrilleSemaine.tsx introuvable (lancez le script depuis la racine du projet)");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ORDRE_FIXE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const cherche = `  const rangees = useMemo(() => regrouperParAffaire(jours, ajoutees), [jours, ajoutees]);`;
if (texte.split(cherche).length !== 2) {
  console.error(`✗ ${chemin} : passage introuvable. Rien n'a été modifié. Copiez ce message à Claude.`);
  process.exit(1);
}
texte = texte.replace(
  cherche,
  `  /* ORDRE_FIXE : chaque affaire garde sa place pendant la saisie ; une nouvelle se met en bas.
     L'ordre est retenu pour la semaine affichée, et repart de zéro sur une autre semaine. */
  const ordre = useRef<{ semaine: string; cles: string[] }>({ semaine: "", cles: [] });
  const rangeesBrutes = useMemo(() => regrouperParAffaire(jours, ajoutees), [jours, ajoutees]);
  const rangees = useMemo(() => {
    if (ordre.current.semaine !== cleSemaine) ordre.current = { semaine: cleSemaine, cles: [] };
    const cles = ordre.current.cles;
    for (const r of rangeesBrutes) if (!cles.includes(r.cle)) cles.push(r.cle);
    return [...rangeesBrutes].sort((a, b) => cles.indexOf(a.cle) - cles.indexOf(b.cle));
  }, [rangeesBrutes, cleSemaine]);`
);
writeFileSync(chemin, texte, "utf8");
console.log(`✓ ${chemin} : les affaires gardent leur place`);
console.log("\nTerminé.");
