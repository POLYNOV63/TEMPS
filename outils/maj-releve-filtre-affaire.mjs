/* ===============================================================
   MAJ RELEVÉ PE / PI - OUVERT SUR UNE AFFAIRE (RELEVE_FILTRE_AFFAIRE)

   - Relevé PE / PI : l'adresse peut porter ?affaire=1604R2 ; le relevé
     s'ouvre alors filtré sur cette commande (la recherche est pré-remplie :
     « Effacer » pour tout revoir).
   - Facturation du mois : le menu du n° d'affaire « 🧾 Relevé PE / PI du
     mois » ouvre le relevé filtré sur la commande.

   À installer APRÈS maj-facturation-liens.mjs.
   À lancer à la racine du projet :   node outils/maj-releve-filtre-affaire.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "RELEVE_FILTRE_AFFAIRE";
const RELEVE = "app/pilotage/prestations/page.tsx";
const FACTURATION = "app/analyse/facturation/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};

const sorties = [];

let r = lire(RELEVE);
if (!r.includes(MARQUEUR)) {
  const a = '  const [recherche, setRecherche] = useState("");\n';
  if (compter(r, a) !== 1) echec(`${RELEVE} : recherche introuvable.`);
  r = r.replace(
    a,
    () => `${a}  /* ${MARQUEUR} : ouvert depuis une autre page (?affaire=1604R2) : le relevé est filtré sur cette commande */
  useEffect(() => {
    const cible = new URLSearchParams(window.location.search).get("affaire");
    if (cible) setRecherche(cible.replace(/^CBE/i, ""));
  }, []);
`
  );
  sorties.push([RELEVE, r, "s’ouvre filtré sur ?affaire="]);
} else console.log(`✓ ${RELEVE} : déjà à jour`);

let f = lire(FACTURATION);
if (!f.includes(MARQUEUR)) {
  if (!f.includes("FACTURATION_LIENS")) echec(`${FACTURATION} : installez d’abord maj-facturation-liens.zip (menu du n° d’affaire).`);
  const a = "<Link role=\"menuitem\" href={`/pilotage/prestations?mois=${mois}`} style={lien}>";
  if (compter(f, a) !== 1) echec(`${FACTURATION} : lien vers le relevé introuvable.`);
  f = f.replace(a, () => `<Link role="menuitem" href={/* ${MARQUEUR} */ \`/pilotage/prestations?mois=\${mois}&affaire=\${encodeURIComponent(numNorm(l.numero))}\`} style={lien}>`);
  sorties.push([FACTURATION, f, "le lien ouvre le relevé filtré sur la commande"]);
} else console.log(`✓ ${FACTURATION} : déjà à jour`);

for (const [fi, t, quoi] of sorties) {
  writeFileSync(fi, t, "utf8");
  console.log(`✓ ${fi} : ${quoi}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
