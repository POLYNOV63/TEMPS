/* ===============================================================
   MAJ SUIVI DES AFFAIRES - STATUT EN COULEUR (STATUT_SURLIGNE)

   Le n° de chaque commande ou devis est surligné selon son statut dans le
   Suivi d'affaire BE :
     jaune : Intention de commande ;
     vert  : Livrée ;
     bleu  : Devis envoyé.
   Une famille (base + avenants) dont un avenant est en intention reste
   surlignée en jaune sur sa ligne. Dans le détail d'une famille (▸),
   chaque commande a son propre surlignage, son statut du Suivi d'affaire
   et son propre délai (estimé, et client en petit). Légende sous le titre.

   À installer APRÈS maj-suivi-delai-estime.mjs (zip maj-bandeau-delai).
   À lancer à la racine du projet :   node outils/maj-suivi-statuts-couleurs.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/page.tsx";
const MARQUEUR = "STATUT_SURLIGNE";

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
if (!t.includes("DELAI_ESTIME")) echec(`${FICHIER} : installez d’abord maj-bandeau-delai.zip (délai estimé).`);

const R = [
  [
    "couleurs",
    "/* MONTANT_HORS_COMPARAISON : activités vendues au montant (scan, négoce) */",
    `/* ${MARQUEUR} : surlignage du n° selon le statut du Suivi d'affaire BE */
const SURLIGNE: Record<string, { background: string; borderRadius: number; padding: string }> = {
  "Intention de commande": { background: "#ffe58a", borderRadius: 3, padding: "0 3px" },
  "Livrée": { background: "#c8ecc9", borderRadius: 3, padding: "0 3px" },
  "Devis envoyé": { background: "#d6e6fb", borderRadius: 3, padding: "0 3px" },
};

/* MONTANT_HORS_COMPARAISON : activités vendues au montant (scan, négoce) */`,
  ],
  [
    "état",
    "  const [delaisSuivi, setDelaisSuivi] = useState<Map<string, { estime: string | null; client: string | null }>>(new Map());\n",
    "  const [delaisSuivi, setDelaisSuivi] = useState<Map<string, { estime: string | null; client: string | null; statut?: string | null }>>(new Map());\n  const [statutsDevis, setStatutsDevis] = useState<Map<string, string>>(new Map()); // " + MARQUEUR + "\n",
  ],
  [
    "lecture",
    'numero_affaire: string | null; delai: string | null; date_livraison_estimee: string | null }>((de, a) =>\n              supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id,numero_affaire,delai,date_livraison_estimee").order("cle").range(de, a)',
    'numero_affaire: string | null; delai: string | null; date_livraison_estimee: string | null; statut: string | null }>((de, a) =>\n              supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id,numero_affaire,delai,date_livraison_estimee,statut").order("cle").range(de, a)',
  ],
  [
    "statuts par commande",
    "          const delais = new Map<string, { estime: string | null; client: string | null }>();\n",
    "          const delais = new Map<string, { estime: string | null; client: string | null; statut?: string | null }>();\n          const devisStatuts = new Map<string, string>();\n          for (const l of sl) if (l.genre === \"DEVIS\" && l.base_devis && l.statut) devisStatuts.set(String(l.base_devis).replace(/^DBE/i, \"\").replace(/^0+/, \"\"), l.statut);\n          setStatutsDevis(devisStatuts);\n",
  ],
  [
    "statut enregistré",
    "{ estime: l.date_livraison_estimee?.slice(0, 10) ?? null, client: l.delai?.slice(0, 10) ?? null });",
    "{ estime: l.date_livraison_estimee?.slice(0, 10) ?? null, client: l.delai?.slice(0, 10) ?? null, statut: l.statut });",
  ],
  [
    "fonction de surlignage",
    "  const planningActif = planifies.size > 0;\n",
    `  const planningActif = planifies.size > 0;

  /* ${MARQUEUR} : statut d'une commande (Suivi d'affaire BE), et son surlignage */
  const statutSuivi = (a: AffaireP): string | null =>
    (a.type === "DBE" ? statutsDevis.get(a.numero.replace(/^0+/, "")) : delaisSuivi.get(a.numero.toUpperCase().replace(/^0+/, ""))?.statut) ??
    (a.statut === "EN_ATTENTE" ? "Intention de commande" : a.statut === "LIVREE" ? "Livrée" : null);
  const surlignage = (a: AffaireP) => {
    const s = statutSuivi(a);
    return s ? SURLIGNE[s] ?? null : null;
  };
`,
  ],
  [
    "n° de la ligne",
    '...((affaire.statut === "EN_ATTENTE" || lignes.some((x) => x.dansFamille === affaire.numero && x.affaire.statut === "EN_ATTENTE")) ? { background: "#ffe58a", borderRadius: 3, padding: "0 3px" } : {}) /* INTENTION_FAMILLE */',
    '...(lignes.some((x) => x.dansFamille === affaire.numero && x.affaire.statut === "EN_ATTENTE") ? SURLIGNE["Intention de commande"] : surlignage(affaire) ?? {}) /* INTENTION_FAMILLE, STATUT_SURLIGNE */',
  ],
  [
    "n° dans la famille",
    '<Link href={`/pilotage/affaire/${m.affaire.id}`} style={{ fontWeight: 800, color: C.rougeFonce, ...(m.affaire.statut === "EN_ATTENTE" ? { background: "#ffe58a", borderRadius: 3, padding: "0 3px" } : {}) }}>',
    '<Link href={`/pilotage/affaire/${m.affaire.id}`} style={{ fontWeight: 800, color: C.rougeFonce, ...(surlignage(m.affaire) ?? {}) }}>',
  ],
  ["statut dans la famille", "<td style={{ ...tdCourt, padding: \"6px 8px\" }}>{libStatut(m.affaire.statut)}</td>", "<td style={{ ...tdCourt, padding: \"6px 8px\" }}>{statutSuivi(m.affaire) ?? libStatut(m.affaire.statut)}</td>"],
  [
    "délai dans la famille",
    "                                      {formatDate(m.affaire.statut === \"LIVREE\" && m.affaire.date_livraison ? m.affaire.date_livraison : m.affaire.echeance)}\n                                    </td>",
    `                                      {formatDate(m.affaire.statut === "LIVREE" && m.affaire.date_livraison ? m.affaire.date_livraison : m.affaire.echeance)}
                                      {m.delaiClient && m.delaiClient !== m.affaire.echeance && m.affaire.statut !== "LIVREE" && <div style={petit}>client : {formatDate(m.delaiClient)}</div>}
                                    </td>`,
  ],
  [
    "légende",
    '{recherche.trim() ? "Résultats de la recherche, tous statuts" : "Affaires actives"} <span style={{ color: C.gris, fontWeight: 600 }}>({actives.length})</span>\n              </h2>\n',
    `{recherche.trim() ? "Résultats de la recherche, tous statuts" : "Affaires actives"} <span style={{ color: C.gris, fontWeight: 600 }}>({actives.length})</span>
              </h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.gris, margin: "-2px 0 8px" }}>
                {Object.entries(SURLIGNE).map(([s, st]) => (
                  <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <i style={{ display: "inline-block", width: 14, height: 12, borderRadius: 3, background: st.background, border: "1px solid #d5d9de" }} /> {s}
                  </span>
                ))}
              </div>
`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ n° surligné : jaune intention, vert livrée, bleu devis envoyé");
console.log("✓ détail de la famille : statut et délai de chaque commande");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
