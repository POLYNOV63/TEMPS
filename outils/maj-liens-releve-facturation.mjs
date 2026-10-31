/* ===============================================================
   Liens croisés, sur le même mois :
   - Relevé PE / PI : bouton « Facturation du mois → » ;
   - Facturation du mois : bouton « Relevé PE / PI → », réservé à
     l'administration (la Direction n'a pas accès au relevé) ; la
     Facturation s'ouvre sur le mois demandé (?mois=AAAA-MM).
   Utilisation (à la racine du projet) :  node outils/maj-liens-releve-facturation.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function preparer(chemin, marqueur, changements) {
  if (!existsSync(chemin)) {
    console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
  if (texte.includes(marqueur)) {
    console.log(`✓ ${chemin} : déjà à jour`);
    return null;
  }
  for (const [nom, cherche, remplace] of changements) {
    const nb = texte.split(cherche).length - 1;
    if (nb !== 1) {
      console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1). Rien n'a été modifié. Copiez ce message à Claude.`);
      process.exit(1);
    }
    texte = texte.replace(cherche, () => remplace);
    console.log(`✓ ${nom}`);
  }
  return texte;
}

const style = `{{ ...page.btnSecondaire, textDecoration: "none", display: "inline-flex", alignItems: "center" }}`;

const fF = "app/analyse/facturation/page.tsx";
const tF = preparer(fF, "LIEN_RELEVE", [
  ["Facturation : outil « qui suis-je »", `import { chargerTout } from "@/lib/pilotageDonnees";`, `import { chargerMoi, chargerTout } from "@/lib/pilotageDonnees";`],
  [
    "Facturation : mois demandé dans l'adresse, et rôle",
    `  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7));`,
    `  // LIEN_RELEVE : le mois peut venir de l'adresse (?mois=AAAA-MM), depuis le relevé PE / PI
  const [mois, setMois] = useState(() => {
    const m = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mois") : null;
    return m && /^\\d{4}-\\d{2}/.test(m) ? m.slice(0, 7) : new Date().toISOString().slice(0, 7);
  });
  const [estAdmin, setEstAdmin] = useState(false);
  useEffect(() => {
    chargerMoi()
      .then((m) => setEstAdmin(Boolean(m?.estAdmin)))
      .catch(() => setEstAdmin(false));
  }, []);`,
  ],
  [
    "Facturation : bouton vers le relevé (administration)",
    `<button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>`,
    `{estAdmin && (
              <Link href={\`/pilotage/prestations?mois=\${mois}\`} title="Le relevé PE / PI de ce mois" style=${style}>
                Relevé PE / PI →
              </Link>
            )}
            <button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>`,
  ],
  [
    "Facturation : lien du tableau réservé à l'administration",
    `<Link href="/pilotage/prestations" style={{ fontSize: 14, fontWeight: 700, color: C.rougeFonce }}>ouvrir le relevé PE / PI →</Link>`,
    `{estAdmin && <Link href={\`/pilotage/prestations?mois=\${mois}\`} style={{ fontSize: 14, fontWeight: 700, color: C.rougeFonce }}>ouvrir le relevé PE / PI →</Link>}`,
  ],
]);

const fR = "app/pilotage/prestations/page.tsx";
const tR = preparer(fR, "LIEN_FACTURATION_RELEVE", [
  [
    "Relevé : bouton vers la Facturation du mois",
    `<button type="button" style={page.btnSecondaire} onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">▶</button>`,
    `<button type="button" style={page.btnSecondaire} onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">▶</button>
            {/* LIEN_FACTURATION_RELEVE */}
            <Link href={\`/analyse/facturation?mois=\${mois.slice(0, 7)}\`} title="La facturation de ce mois" style=${style}>
              Facturation du mois →
            </Link>`,
  ],
]);

if (tF !== null) writeFileSync(fF, tF, "utf8");
if (tR !== null) writeFileSync(fR, tR, "utf8");
console.log("\nTerminé : relevé PE / PI et Facturation reliés, sur le même mois.");
