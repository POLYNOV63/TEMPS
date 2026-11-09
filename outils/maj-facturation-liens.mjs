/* ===============================================================
   MAJ FACTURATION DU MOIS - UN CLIC SUR L'AFFAIRE (FACTURATION_LIENS)

   Dans le tableau « À facturer », le n° CBE devient cliquable : un petit
   menu propose
     📊 Bilan de l'affaire
     📅 Voir au planning (la commande, sinon sa commande de base)
     🧾 Relevé PE / PI du mois (lignes PE / PI, pour l'administration)
   Échap ou un clic ailleurs le referme.

   À lancer à la racine du projet :   node outils/maj-facturation-liens.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/facturation/page.tsx";
const MARQUEUR = "FACTURATION_LIENS";

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

const ETAT = `  const [recherche, setRecherche] = useState("");
  /* ${MARQUEUR} : menu d'une affaire (bilan, planning, relevé) et identifiants du planning */
  const [menuAffaire, setMenuAffaire] = useState<string | null>(null);
  const [idsPlanning, setIdsPlanning] = useState<Map<string, string>>(new Map());
  const numNorm = (s: string) => s.toUpperCase().replace(/^CBE/, "").replace(/^0+/, "");
  const numBase = (s: string) => numNorm(s).match(/^\\d+/)?.[0] ?? numNorm(s);
  useEffect(() => {
    let actif = true;
    supabase
      .from("pilotage_affaires")
      .select("id,numero")
      .eq("type", "CBE")
      .then(({ data }) => {
        if (actif) setIdsPlanning(new Map(((data ?? []) as { id: string; numero: string }[]).map((a) => [numNorm(a.numero), a.id])));
      });
    return () => {
      actif = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menuAffaire) return;
    const fermer = () => setMenuAffaire(null);
    const touche = (e: KeyboardEvent) => e.key === "Escape" && setMenuAffaire(null);
    document.addEventListener("click", fermer);
    document.addEventListener("keydown", touche);
    return () => {
      document.removeEventListener("click", fermer);
      document.removeEventListener("keydown", touche);
    };
  }, [menuAffaire]);
`;

const CELLULE_AVANT = `<td style={{ ...td, fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>{l.numero}</td>`;
const CELLULE_APRES = `<td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap", position: "relative" }}>
                          {(() => {
                            const cleMenu = \`\${l.type}-\${l.numero}-\${l.personne}-\${i}\`;
                            const ouvert = menuAffaire === cleMenu;
                            const idPlanning = idsPlanning.get(numNorm(l.numero)) ?? idsPlanning.get(numBase(l.numero));
                            const lien: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", color: "#1f2328", textDecoration: "none", fontWeight: 700, fontStyle: "normal", whiteSpace: "nowrap" };
                            return (
                              <>
                                <button
                                  type="button"
                                  aria-haspopup="menu"
                                  aria-expanded={ouvert}
                                  title="Bilan, planning ou relevé de cette affaire"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuAffaire(ouvert ? null : cleMenu);
                                  }}
                                  style={{ all: "unset", cursor: "pointer", color: C.rougeFonce, fontWeight: 800, textDecoration: "underline dotted", textUnderlineOffset: 3 }}
                                >
                                  {l.numero} <span style={{ fontSize: 10 }}>▾</span>
                                </button>
                                {ouvert && (
                                  <div
                                    role="menu"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ position: "absolute", top: "100%", left: 4, zIndex: 50, background: "#ffffff", border: \`1px solid \${C.ligne}\`, borderRadius: 10, boxShadow: "0 10px 24px rgba(0,0,0,.16)", padding: 4, minWidth: 220 }}
                                  >
                                    <Link role="menuitem" href={\`/affaires/bilan?affaire=CBE\${numBase(l.numero)}&commande=\${encodeURIComponent(numNorm(l.numero))}\`} style={lien}>
                                      📊 Bilan de l’affaire
                                    </Link>
                                    {idPlanning ? (
                                      <Link role="menuitem" href={\`/pilotage/affaires?ouvrir=\${idPlanning}\`} style={lien}>
                                        📅 Voir au planning
                                      </Link>
                                    ) : (
                                      <span style={{ ...lien, color: C.gris, fontWeight: 400 }}>📅 Pas au planning</span>
                                    )}
                                    {l.type === "PE / PI" && estAdmin && (
                                      <Link role="menuitem" href={\`/pilotage/prestations?mois=\${mois}\`} style={lien}>
                                        🧾 Relevé PE / PI du mois
                                      </Link>
                                    )}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </td>`;

const R = [
  ["état du menu", '  const [recherche, setRecherche] = useState("");\n', ETAT],
  ["cellule du n° CBE", CELLULE_AVANT, CELLULE_APRES],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ n° CBE cliquable : bilan, planning, relevé PE / PI");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
