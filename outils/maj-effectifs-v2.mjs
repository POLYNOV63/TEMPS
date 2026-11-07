/* ===============================================================
   MAJ ANALYSE DES EFFECTIFS (EFFECTIFS_V2)

   - « Niveaux et dépendance » : pour Méca, Elec et Calcul, la pyramide des
     niveaux (N1 / N2 / N3, fiche collaborateur, SQL 86), la relève
     (compétences d'appoint) et les points d'attention : activité qui repose
     sur 1 ou 2 personnes, pas ou un seul référent (N3), trop de N1 pour
     les référents. Que des nombres, aucun nom.
   - « Temps vendu, mois par mois » : part des heures vendues (BE, PE, PI,
     intergroupe), du temps de devis et du hors affaire, sur l'exercice.
   - « Par collaborateur » : réservé à l'ADMIN (la Direction ne voit que
     les totaux).

   À lancer à la racine du projet :   node outils/maj-effectifs-v2.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/effectifs/page.tsx";
const MARQUEUR = "EFFECTIFS_V2";

const ETATS = `
  // EFFECTIFS_V2 : niveaux (SQL 86), droits (le détail par personne est réservé à l'ADMIN), heures mois par mois
  const [niveaux, setNiveaux] = useState<Map<string, number>>(new Map());
  const [estAdmin, setEstAdmin] = useState(false);
  const [mensuel, setMensuel] = useState<{ mois: string; heures: Heure[] }[]>([]);
  useEffect(() => {
    void supabase
      .from("collaborateurs_niveaux")
      .select("collaborateur_id,niveau")
      .then(({ data }) => setNiveaux(new Map(((data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0]))));
    chargerMoi()
      .then((m) => setEstAdmin(Boolean(m?.estAdmin)))
      .catch(() => setEstAdmin(false));
  }, []);
  useEffect(() => {
    let actif = true;
    const moisCourant = new Date().toISOString().slice(0, 7);
    const moisListe = Array.from({ length: 12 }, (_, k) => new Date(Date.UTC(exercice, 10 + k, 1)).toISOString().slice(0, 7)).filter((m) => m <= moisCourant);
    const finMois = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    Promise.all(
      moisListe.map(async (m) => {
        const { data } = await supabase.rpc("analyse_effectifs", { p_debut: \`\${m}-01\`, p_fin: finMois(m) });
        return { mois: m, heures: ((data ?? []) as Heure[]).map((x) => ({ ...x, heures: Number(x.heures) || 0 })) };
      })
    )
      .then((r) => actif && setMensuel(r))
      .catch(() => actif && setMensuel([]));
    return () => {
      actif = false;
    };
  }, [exercice]);
`;

const CALCULS = `
  /* EFFECTIFS_V2 : pyramide des niveaux et dépendance, pour Méca, Elec et Calcul */
  const NIVEAUX = [
    { n: 1, lib: "N1", aide: "exécute sous supervision", couleur: "#c8e6c9" },
    { n: 2, lib: "N2", aide: "autonome sur une affaire courante", couleur: "#66bb6a" },
    { n: 3, lib: "N3", aide: "expert ou référent", couleur: "#2e7d32" },
    { n: 0, lib: "?", aide: "niveau non renseigné", couleur: "#e3e7e3" },
  ];
  const estActiviteBE = (nom: string) => /^(meca|elec|calcul)/.test(nom.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim());
  const pyramide = activites
    .filter((a) => estActiviteBE(a.nom))
    .sort((x, y) => x.ordre_affichage - y.ordre_affichage)
    .map((a) => {
      const titulaires = vue.equipe.filter((m) => m.predominances.includes(a.id));
      const releve = vue.equipe.filter((m) => !m.predominances.includes(a.id) && m.competences.includes(a.id));
      const nb = NIVEAUX.map((nv) => titulaires.filter((m) => (niveaux.get(m.id) ?? 0) === nv.n).length);
      const [n1, , n3, inconnus] = nb;
      const attention: string[] = [];
      if (titulaires.length <= 2) attention.push(titulaires.length === 0 ? "personne en activité principale" : \`repose sur \${titulaires.length} personne\${titulaires.length > 1 ? "s" : ""}\`);
      if (inconnus > 0) attention.push(\`\${inconnus} niveau\${inconnus > 1 ? "x" : ""} à renseigner\`);
      else if (titulaires.length > 0) {
        if (n3 === 0) attention.push("aucun référent (N3)");
        else if (n3 === 1) attention.push("un seul référent (N3)");
        if (n3 > 0 && n1 > 2 * n3) attention.push("peu de référents pour encadrer les N1");
      }
      if (releve.length === 0 && titulaires.length > 0) attention.push("pas de relève en appoint");
      return { a, titulaires: titulaires.length, releve: releve.length, nb, attention };
    });

  /* EFFECTIFS_V2 : temps vendu, devis et hors affaire, mois par mois */
  const idsEquipe = new Set(vue.equipe.map((m) => m.id));
  const parMois = mensuel.map(({ mois, heures: hs }) => {
    const siennes = hs.filter((h) => idsEquipe.has(h.collaborateur_id));
    const somme = (f: (h: Heure) => boolean) => siennes.filter(f).reduce((t, h) => t + h.heures, 0);
    const total = somme(() => true);
    return {
      mois,
      total,
      vendu: somme((h) => ["BE", "PE", "PI", "IG"].includes(h.methode)),
      devis: somme((h) => h.methode === "DEVIS"),
      hors: somme((h) => h.methode === "HORS_AFFAIRE"),
    };
  });
  const libMois = (m: string) => new Date(\`\${m}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "short" });
`;

const SECTION_PYRAMIDE = `
            {/* ---------- EFFECTIFS_V2 : niveaux et dépendance ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Niveaux et dépendance</h2>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                Pour chaque activité, les personnes qui l’ont en activité principale, par niveau (fiche collaborateur), et la <strong>relève</strong> : celles qui
                ont cette compétence en appoint. Les <strong>points d’attention</strong> signalent une activité fragile : qui repose sur une ou deux personnes, sans
                référent, ou avec trop de débutants par référent. Aucun nom n’est affiché.
              </p>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={th}>Activité</th>
                    <th style={{ ...thN, textAlign: "center" }}>En principale</th>
                    <th style={th}>Niveaux</th>
                    <th style={{ ...thN, textAlign: "center" }}>Relève (appoint)</th>
                    <th style={th}>Points d’attention</th>
                  </tr>
                </thead>
                <tbody>
                  {pyramide.map((p) => (
                    <tr key={p.a.id}>
                      <td style={{ ...td, fontWeight: 800 }}>{p.a.nom}</td>
                      <td style={{ ...tdN, textAlign: "center", fontWeight: 800 }}>{p.titulaires}</td>
                      <td style={td}>
                        <div style={{ display: "flex", height: 14, width: 220, borderRadius: 4, overflow: "hidden", background: "#eef0f3" }}>
                          {NIVEAUX.map((nv, k) =>
                            p.nb[k] > 0 ? (
                              <div key={nv.n} title={\`\${nv.lib} (\${nv.aide}) : \${p.nb[k]}\`} style={{ width: \`\${(p.nb[k] / Math.max(1, p.titulaires)) * 100}%\`, background: nv.couleur }} />
                            ) : null
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#3b4046", marginTop: 3 }}>
                          {NIVEAUX.filter((nv, k) => nv.n > 0 || p.nb[k] > 0)
                            .map((nv) => \`\${nv.lib} \${p.nb[NIVEAUX.indexOf(nv)]}\`)
                            .join(" · ")}
                        </div>
                      </td>
                      <td style={{ ...tdN, textAlign: "center" }}>{p.releve || "—"}</td>
                      <td style={td}>
                        {p.attention.length === 0 ? (
                          <span style={{ color: "#1b5e20", fontWeight: 700, fontSize: 13 }}>✓ rien à signaler</span>
                        ) : (
                          p.attention.map((x) => (
                            <span key={x} style={{ display: "inline-block", margin: "1px 4px 1px 0", background: "#fff1df", color: "#7a3e00", borderRadius: 999, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>
                              {x}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 14, fontSize: 12, marginTop: 8, color: "#3b4046", flexWrap: "wrap" }}>
                {NIVEAUX.map((nv) => (
                  <span key={nv.n}>
                    <i style={{ display: "inline-block", width: 12, height: 10, background: nv.couleur, borderRadius: 2, border: "1px solid #c9d1c9" }} /> {nv.lib} : {nv.aide}
                  </span>
                ))}
              </div>
            </section>

`;

const SECTION_MENSUEL = `            {/* ---------- EFFECTIFS_V2 : temps vendu, mois par mois ---------- */}
            {parMois.length > 0 && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Temps vendu, mois par mois</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  Part des heures pointées chaque mois : <span style={{ color: C.rouge, fontWeight: 800 }}>vendu</span> (BE, PE, PI, intergroupe),{" "}
                  <span style={{ color: "#d98aa6", fontWeight: 800 }}>devis</span>, <span style={{ color: "#9aa0a6", fontWeight: 800 }}>hors affaire</span>. Le % au-dessus
                  de chaque mois est le taux de temps vendu.
                </p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 170 }}>
                  {parMois.map((m) => {
                    const t = m.total || 1;
                    return (
                      <div
                        key={m.mois}
                        title={\`\${libMois(m.mois)} : \${heuresTxt(m.total)} pointées · vendu \${pct(m.vendu / t)} · devis \${pct(m.devis / t)} · hors affaire \${pct(m.hors / t)}\`}
                        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}
                      >
                        <strong style={{ fontSize: 12, marginBottom: 3 }}>{m.total > 0.5 ? pct(m.vendu / t) : "—"}</strong>
                        <div style={{ flex: 1, width: "70%", display: "flex", flexDirection: "column-reverse", background: "#eef0f3", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
                          <div style={{ height: \`\${(m.vendu / t) * 100}%\`, background: C.rouge }} />
                          <div style={{ height: \`\${(m.devis / t) * 100}%\`, background: "#d98aa6" }} />
                          <div style={{ height: \`\${(m.hors / t) * 100}%\`, background: "#9aa0a6" }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.gris, marginTop: 3 }}>{libMois(m.mois)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

`;

const remplacements = [
  ["import", 'import { supabase } from "@/lib/supabase";\n', (x) => x + 'import { chargerMoi } from "@/lib/pilotageDonnees";\n'],
  ["états", "  const [seulementStats, setSeulementStats] = useState(true);\n", (x) => x + ETATS],
  ["calculs", "  const partPEPI = vue.parMethode.filter((m) => [\"PE\", \"PI\", \"IG\"].includes(m.code)).reduce((t, m) => t + m.part, 0);\n", (x) => x + CALCULS],
  ["section niveaux", "            {/* ---------- méthodes de vente ---------- */}\n", (x) => SECTION_PYRAMIDE + x],
  [
    "section temps vendu et détail réservé à l'ADMIN",
    "            {/* ---------- par collaborateur ---------- */}\n            <section",
    () => SECTION_MENSUEL + "            {/* ---------- par collaborateur (ADMIN seulement, EFFECTIFS_V2) ---------- */}\n            {estAdmin && (\n            <section",
  ],
  ["fin du détail par collaborateur", "            </section>\n\n            <details style={{ fontSize: 13, color: \"#3b4046\" }}>", () => "            </section>\n            )}\n\n            <details style={{ fontSize: 13, color: \"#3b4046\" }}>"],
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
for (const [nom, a] of remplacements) {
  const n = t.split(a).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const [nom, a, f] of remplacements) {
  t = t.replace(a, (x) => f(x));
  console.log(`✓ ${nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
