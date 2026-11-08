/* ===============================================================
   MAJ PORTEFEUILLE - PÉRIODE, ACTIVITÉ, EXPORT (PORTEFEUILLE_PERIODE)

   Le Portefeuille reprend ce qu'apportait l'Analyse du chiffré :
   - « Pointé : Cumul · Exercice · Mois · Dates libres » : hors « Cumul »,
     une colonne « Sur la période » montre les heures pointées sur la
     période, et une case permet de ne garder que les affaires pointées ;
   - menu d'activité : réalisé / chiffré d'une seule activité (Méca…) ;
   - « Exporter en Excel » : les affaires affichées.

   À lancer à la racine du projet, APRÈS maj-montant-hors-comparaison.mjs :
       node outils/maj-portefeuille-periode.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/page.tsx";
const MARQUEUR = "PORTEFEUILLE_PERIODE";

const ETATS = `
  /* PORTEFEUILLE_PERIODE : pointé sur une période (fonction pointage_periode, SQL 73), filtre d'activité */
  const [periode, setPeriode] = useState<{ mode: "CUMUL" | "EXERCICE" | "MOIS" | "LIBRE"; exercice: number; mois: string; du: string; au: string }>(() => {
    const d = new Date();
    return { mode: "CUMUL", exercice: d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1, mois: d.toISOString().slice(0, 7), du: "", au: "" };
  });
  const bornes = (() => {
    if (periode.mode === "EXERCICE") return { du: \`\${periode.exercice}-11-01\`, au: \`\${periode.exercice + 1}-10-31\` };
    if (periode.mode === "MOIS" && periode.mois) {
      const [a, m] = periode.mois.split("-").map(Number);
      return { du: \`\${periode.mois}-01\`, au: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) };
    }
    if (periode.mode === "LIBRE" && periode.du && periode.au && periode.du <= periode.au) return { du: periode.du, au: periode.au };
    return null;
  })();
  const [surPeriode, setSurPeriode] = useState<Map<string, { total: number; parAct: Map<string, number> }>>(new Map());
  const [calculPeriode, setCalculPeriode] = useState(false);
  const [seulementPeriode, setSeulementPeriode] = useState(false);
  const [activiteFiltre, setActiviteFiltre] = useState("");
  useEffect(() => {
    if (!bornes) {
      setSurPeriode(new Map());
      return;
    }
    let actif = true;
    setCalculPeriode(true);
    void (async () => {
      const data: { type_affaire: string; numero: string; activite_id: string | null; heures: number | string }[] = [];
      for (let a = 0; a < 200000; a += 1000) {
        const r = await supabase.rpc("pointage_periode", { p_debut: bornes.du, p_fin: bornes.au }).range(a, a + 999);
        if (r.error || !r.data) break;
        data.push(...(r.data as typeof data));
        if (r.data.length < 1000) break;
      }
      if (!actif) return;
      const m = new Map<string, { total: number; parAct: Map<string, number> }>();
      for (const x of data) {
        if (x.type_affaire !== "CBE") continue;
        const k = String(x.numero ?? "").replace(/^0+/, "");
        const v = m.get(k) ?? { total: 0, parAct: new Map<string, number>() };
        const h = Number(x.heures) || 0;
        v.total += h;
        v.parAct.set(x.activite_id ?? "?", (v.parAct.get(x.activite_id ?? "?") ?? 0) + h);
        m.set(k, v);
      }
      setSurPeriode(m);
      setCalculPeriode(false);
    })();
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bornes?.du, bornes?.au]);
`;

const VALEURS = `  /* PORTEFEUILLE_PERIODE : chiffré, réalisé et pointé sur la période d'une ligne, toutes activités ou une seule */
  const valeursLigne = (l: Ligne) => {
    const base = (l.affaire.numero.match(/^\\d+/)?.[0] ?? l.affaire.numero).replace(/^0+/, "");
    const p = surPeriode.get(base);
    if (activiteFiltre) {
      const d = l.activites.find((x) => x.id === activiteFiltre);
      return { chiffre: d?.chiffre ?? 0, realise: d?.realise ?? 0, periode: p?.parAct.get(activiteFiltre) ?? 0 };
    }
    return { chiffre: l.famille ? l.famille.chiffre : l.totaux.chiffre, realise: l.totaux.realise, periode: p?.total ?? 0 };
  };

`;

const EXPORT = `  /* PORTEFEUILLE_PERIODE : export des affaires affichées */
  function exporter() {
    const arrondi = (x: number) => Math.round(x * 10) / 10;
    const lignesExport = [...actives, ...dormantesListe].map((l) => {
      const v = valeursLigne(l);
      return {
        Affaire: \`\${l.affaire.type}\${l.affaire.numero}\`,
        Client: l.client ?? "",
        Descriptif: l.affaire.designation,
        Imputation: l.affaire.imputation ?? "",
        Responsable: nomCollab(collabs.get(l.affaire.responsable_id)),
        Délai: l.affaire.echeance ?? "",
        Activité: activiteFiltre ? nomsActivites.get(activiteFiltre)?.nom ?? "" : "Toutes",
        "Chiffré (h)": arrondi(v.chiffre),
        "Réalisé (h)": arrondi(v.realise),
        ...(bornes ? { "Sur la période (h)": arrondi(v.periode) } : {}),
        "Consommé (%)": v.chiffre > 0 ? Math.round((v.realise / v.chiffre) * 100) : "",
        "À affecter (h)": arrondi(l.aAffecter),
        État: l.etat.texte,
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignesExport), "Portefeuille");
    XLSX.writeFile(wb, \`Portefeuille_\${bornes ? \`\${bornes.du}_\${bornes.au}\` : new Date().toISOString().slice(0, 10)}.xlsx\`);
  }

`;

const CONTROLES = `              {/* PORTEFEUILLE_PERIODE : période, activité, export (ce qu'apportait l'Analyse du chiffré) */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Pointé :</strong>
                {(
                  [
                    ["CUMUL", "Cumul"],
                    ["EXERCICE", "Exercice"],
                    ["MOIS", "Mois"],
                    ["LIBRE", "Dates libres"],
                  ] as const
                ).map(([v, lib]) => (
                  <button key={v} type="button" aria-pressed={periode.mode === v} onClick={() => setPeriode({ ...periode, mode: v })} style={{ ...bouton(periode.mode === v), minHeight: 38, padding: "0 12px" }}>
                    {lib}
                  </button>
                ))}
                {periode.mode === "EXERCICE" && (
                  <select value={periode.exercice} onChange={(e) => setPeriode({ ...periode, exercice: Number(e.target.value) })} style={{ ...selectFiltre, minHeight: 38 }} aria-label="Exercice">
                    {[0, 1, 2, 3].map((k) => {
                      const d = new Date();
                      const ex = (d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1) - k;
                      return (
                        <option key={ex} value={ex}>
                          {ex}-{ex + 1}
                        </option>
                      );
                    })}
                  </select>
                )}
                {periode.mode === "MOIS" && (
                  <input type="month" value={periode.mois} onChange={(e) => setPeriode({ ...periode, mois: e.target.value })} style={{ ...selectFiltre, minHeight: 38 }} aria-label="Mois" />
                )}
                {periode.mode === "LIBRE" && (
                  <>
                    <input type="date" value={periode.du} onChange={(e) => setPeriode({ ...periode, du: e.target.value })} style={{ ...selectFiltre, minHeight: 38 }} aria-label="Du" />
                    <input type="date" value={periode.au} onChange={(e) => setPeriode({ ...periode, au: e.target.value })} style={{ ...selectFiltre, minHeight: 38 }} aria-label="Au" />
                  </>
                )}
                {bornes && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                    <input type="checkbox" checked={seulementPeriode} onChange={(e) => setSeulementPeriode(e.target.checked)} style={{ width: 18, height: 18 }} />
                    seulement les affaires pointées sur la période
                  </label>
                )}
                {calculPeriode && <span style={{ fontSize: 13, color: C.gris }}>calcul de la période…</span>}
                <select
                  value={activiteFiltre}
                  onChange={(e) => setActiviteFiltre(e.target.value)}
                  aria-label="Activité"
                  style={{ ...selectFiltre, minHeight: 38, borderColor: activiteFiltre ? C.rouge : undefined }}
                >
                  <option value="">Toutes les activités</option>
                  {[...nomsActivites.entries()]
                    .filter(([id]) => lignes.some((l) => l.activites.some((d) => d.id === id)))
                    .sort((a, b) => a[1].ordre - b[1].ordre)
                    .map(([id, a]) => (
                      <option key={id} value={id}>
                        {a.nom}
                      </option>
                    ))}
                </select>
                <button type="button" onClick={exporter} style={{ ...page.btnSecondaire, minHeight: 38, marginLeft: "auto" }}>
                  Exporter en Excel
                </button>
              </div>

`;

const remplacements = [
  ["import xlsx", 'import { chargerDormantes, libelleDormance, type Dormance } from "@/lib/dormantes";', (x) => x + '\nimport * as XLSX from "xlsx";'],
  ["états de la période", "  const [toutesAlertes, setToutesAlertes] = useState(false);\n", (x) => x + ETATS],
  ["valeurs d'une ligne", "  // Filtres communs aux deux tableaux (actives et inactives)\n", (x) => VALEURS + x],
  ["filtre : champs", "    return lignes.filter(({ affaire, totaux, client, famille }) => {", () => "    return lignes.filter((ligneF) => {\n      const { affaire, totaux, client, famille } = ligneF;"],
  [
    "filtre : activité et période",
    "      if (depassementSeul && !(totaux.depassement > 0)) return false;\n      return true;",
    () =>
      "      if (depassementSeul && !(totaux.depassement > 0)) return false;\n" +
      "      if (activiteFiltre && !ligneF.activites.some((d) => d.id === activiteFiltre)) return false;\n" +
      "      if (bornes && seulementPeriode && valeursLigne(ligneF).periode <= 0.01) return false;\n" +
      "      return true;",
  ],
  [
    "filtre : recalcul",
    "  }, [lignes, filtreType, recherche, filtreImputation, filtreClient, filtreResp, filtrePlanning, depassementSeul, dormantesSeules, dormantes, devisParCbe]);",
    () =>
      "    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [lignes, filtreType, recherche, filtreImputation, filtreClient, filtreResp, filtrePlanning, depassementSeul, dormantesSeules, dormantes, devisParCbe, activiteFiltre, seulementPeriode, surPeriode, bornes?.du]);",
  ],
  ["export", "  function basculerDetail(id: string) {", (x) => EXPORT + x],
  ["nombre de colonnes", "    const nbColonnes = 8;", () => "    const nbColonnes = bornes ? 9 : 8;"],
  [
    "titre « Sur la période »",
    '            <EnTeteTri col="realise" libelle="Réalisé / Chiffré" centre />',
    (x) => x + '\n            {bornes && <th style={thNum} title="Heures pointées sur la période choisie">Sur la période</th>}',
  ],
  ["valeurs de la ligne", "            const aAffecter = l.aAffecter;", (x) => x + "\n            const vl = valeursLigne(l);"],
  [
    "cellule « Sur la période »",
    "                  <td style={tdNum}>\n                    {!planningActif || totaux.chiffre <= 0",
    (x) =>
      "                  {bornes && (\n" +
      "                    <td style={tdNum}>{l.dansFamille ? gris(\"—\") : vl.periode > 0.01 ? <strong style={{ color: C.rougeFonce }}>{formatHeures(vl.periode)}</strong> : gris(\"—\")}</td>\n" +
      "                  )}\n" +
      x,
  ],
  ["contrôles", "              {erreurPlanning && <Message genre=\"erreur\">{erreurPlanning}</Message>}", (x) => CONTROLES + x],
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
if (!t.includes("PORTEFEUILLE_V2")) echec("lancez d'abord maj-portefeuille-colonnes.mjs.");
for (const [nom, a] of remplacements) {
  const n = t.split(a).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const [, a, f] of remplacements) t = t.replace(a, (x) => f(x));

/* la colonne Réalisé / Chiffré suit l'activité choisie */
const D = "                  {/* PORTEFEUILLE_V2 : réalisé / chiffré, en une colonne, avec la barre */}\n";
const F = "                  {bornes && (\n                    <td style={tdNum}>";
const i = t.indexOf(D);
const j = t.indexOf(F, i);
if (i < 0 || j < 0) echec(`${FICHIER} : colonne « Réalisé / Chiffré » introuvable.`);
let cellule = t.slice(i, j);
if (cellule.split("const ch = l.famille ? l.famille.chiffre : totaux.chiffre;").length !== 2) echec(`${FICHIER} : calcul du chiffré introuvable dans la colonne.`);
cellule = cellule
  .replace("const ch = l.famille ? l.famille.chiffre : totaux.chiffre;", "const ch = vl.chiffre;")
  .split("formatHeures(totaux.reste)").join("formatHeures(Math.max(0, ch - vl.realise))")
  .split("totaux.realise").join("vl.realise");
t = t.slice(0, i) + cellule + t.slice(j);

writeFileSync(FICHIER, t, "utf8");
for (const [nom] of remplacements) console.log(`✓ ${nom}`);
console.log("✓ colonne Réalisé / Chiffré selon l'activité");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
