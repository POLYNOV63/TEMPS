/* ===============================================================
   MAJ CARTOGRAPHIE DE L'ÉQUIPE - PE, PI ET LE RESTE (EQUIPE_PEPI)

   Un graphique « Prestations et bureau d'études » : combien de personnes
   en PE, en PI et au bureau d'études (le reste), et à quel niveau.
   - En PE / en PI : les personnes qui ont des heures saisies ce mois-ci au
     relevé PE / PI ; quelqu'un sur les deux est rangé là où il a le plus
     d'heures ;
   - au bureau d'études : le reste de l'équipe (hors encadrement).
   Une barre par groupe, de longueur proportionnelle au nombre de
   personnes, découpée par niveau (mêmes couleurs que les niveaux de
   l'équipe) ; l'administration voit les trigrammes au survol.

   À lancer à la racine du projet :   node outils/maj-equipe-pepi.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/effectifs/page.tsx";
const MARQUEUR = "EQUIPE_PEPI";

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

const ETAT = `  const [erreur, setErreur] = useState("");
  /* ${MARQUEUR} : qui est en PE, en PI (heures saisies au relevé ce mois-ci), le reste au bureau d'études */
  const [prestataires, setPrestataires] = useState<Map<string, "PE" | "PI">>(new Map());
  useEffect(() => {
    let actif = true;
    const d = new Date();
    const debut = \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, "0")}-01\`;
    const fin = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10);
    void (async () => {
      try {
        const [lp, pa, sa] = await Promise.all([
          supabase.from("prestation_lignes").select("id,collaborateur_id,affaire_id"),
          supabase.from("pilotage_affaires").select("id,imputation"),
          chargerTout<{ ligne_id: string; heures: number | string | null }>((a, b) =>
            supabase.from("prestation_saisies").select("ligne_id,heures").gte("jour", debut).lte("jour", fin).gt("heures", 0).order("ligne_id").range(a, b)
          ),
        ]);
        if (!actif || lp.error || pa.error) return;
        const imputation = new Map(((pa.data ?? []) as { id: string; imputation: string | null }[]).map((a) => [a.id, a.imputation]));
        const lignes = new Map(((lp.data ?? []) as { id: string; collaborateur_id: string; affaire_id: string }[]).map((l) => [l.id, l]));
        const heures = new Map<string, { PE: number; PI: number }>();
        for (const s of sa) {
          const l = lignes.get(s.ligne_id);
          if (!l) continue;
          const i = imputation.get(l.affaire_id);
          if (i !== "PE" && i !== "PI") continue;
          const v = heures.get(l.collaborateur_id) ?? { PE: 0, PI: 0 };
          v[i] += Number(s.heures) || 0;
          heures.set(l.collaborateur_id, v);
        }
        setPrestataires(new Map([...heures].map(([id, v]) => [id, v.PE >= v.PI ? "PE" : "PI"] as [string, "PE" | "PI"])));
      } catch {
        /* relevé illisible : tout le monde au bureau d'études */
      }
    })();
    return () => {
      actif = false;
    };
  }, []);
`;

const SECTION = `            {/* ${MARQUEUR} : prestations (PE, PI) et bureau d'études, par niveau */}
            {(() => {
              const niveauDe = (id: string) => niveaux.get(id) ?? 0;
              const groupes = [
                { cle: "PE", lib: "En prestation externe (PE)", gens: vue.equipe.filter((m) => prestataires.get(m.id) === "PE") },
                { cle: "PI", lib: "En prestation interne (PI)", gens: vue.equipe.filter((m) => prestataires.get(m.id) === "PI") },
                { cle: "BE", lib: "Au bureau d’études (le reste)", gens: vue.equipe.filter((m) => !prestataires.has(m.id)) },
              ];
              const plus = Math.max(1, ...groupes.map((g) => g.gens.length));
              const moisNom = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
              return (
                <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Prestations et bureau d’études</h2>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: C.gris }}>
                    Qui travaille en PE, en PI et au bureau d’études, et à quel niveau. En PE / PI : les personnes qui ont des heures au relevé PE / PI en {moisNom} (quelqu’un sur les deux
                    est rangé là où il a le plus d’heures). La longueur de chaque barre suit le nombre de personnes.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(170px, 240px) minmax(0, 1fr) 90px", gap: "12px 14px", alignItems: "center" }}>
                    {groupes.map((g) => (
                      <Fragment key={g.cle}>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>{g.lib}</span>
                        <span
                          title={estAdmin && g.gens.length > 0 ? g.gens.map((m) => nomPersonne(m)).sort((a, b) => a.localeCompare(b, "fr")).join(", ") : undefined}
                          style={{ display: "block", width: \`\${Math.max(10, (g.gens.length / plus) * 100)}%\` }}
                        >
                          {g.gens.length > 0 ? (
                            <BarreNiveaux nb={NIVEAUX.map((nv) => g.gens.filter((m) => niveauDe(m.id) === nv.n).length)} largeur="100%" />
                          ) : (
                            <span style={{ fontSize: 13, color: C.gris }}>personne</span>
                          )}
                        </span>
                        <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <strong style={{ fontSize: 20 }}>{g.gens.length}</strong>{" "}
                          <span style={{ fontSize: 12, color: C.gris }}>{vue.equipe.length ? pct(g.gens.length / vue.equipe.length) : ""}</span>
                        </span>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.gris, marginTop: 12 }}>
                    {NIVEAUX.map((nv) => (
                      <span key={nv.n} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <i style={{ display: "inline-block", width: 12, height: 12, background: nv.couleur, borderRadius: 3, border: "1px solid #c9d1c9" }} />
                        {nv.n === 0 ? "niveau non renseigné" : \`N\${nv.n} · \${nv.aide}\`}
                      </span>
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* NOMS_PAR_NIVEAU : qui est à quel niveau (ADMIN seulement) */}`;

const R = [
  ["import", 'import { chargerMoi } from "@/lib/pilotageDonnees";', 'import { chargerMoi, chargerTout } from "@/lib/pilotageDonnees";'],
  ["état", '  const [erreur, setErreur] = useState("");\n', ETAT],
  ["section", "            {/* NOMS_PAR_NIVEAU : qui est à quel niveau (ADMIN seulement) */}", SECTION],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ graphique « Prestations et bureau d’études » : PE, PI, le reste, par niveau");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
