/* ===============================================================
   Finances (app/analyse/finances/page.tsx) : montants cliquables.
   Dans le tableau mois par mois, un clic sur un montant des lignes
   « Réalisé par imputation » ou « Réalisé par activité » (dont
   « Non ventilé ») ouvre, sous le tableau, le détail : les affaires
   qui composent ce montant, leur source (livraison, échéance, relevé
   PE / PI, historique), client, imputation, montant, et pour le
   « Non ventilé » la raison et où la corriger.
   Utilisation (à la racine du projet) :  node outils/maj-finances-detail.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/analyse/finances/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("DETAIL_CLIQUABLE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;

const PANNEAU = `
              {/* DETAIL_CLIQUABLE : ce qui compose le montant cliqué */}
              {detail && (() => {
                const lignesDetail = mouvements
                  .filter((x) => x.date.startsWith(detail.mois))
                  .map((x) => ({ x, part: detail.groupe ? x.parGroupe[detail.groupe] : (x.imputation ?? "—") === detail.imputation ? x.montant : 0 }))
                  .filter((l) => Math.abs(l.part) > 0.5)
                  .sort((a, b) => Math.abs(b.part) - Math.abs(a.part));
                const total = lignesDetail.reduce((t, l) => t + l.part, 0);
                const sources: Record<string, string> = { LIVRAISON: "Forfait livré", ECHEANCE: "Échéance / lot livré", RELEVE: "Relevé PE / PI", HISTORIQUE: "Historique (ancien classeur)" };
                const raison: Record<string, string> = {
                  LIVRAISON: "Suivi d’affaire BE : aucune colonne « Montant Méca / Calcul / Elec-Pneu / Scan / Autre / Négoce » remplie pour cette ligne (ni pour ses échéances) : à compléter dans le classeur.",
                  ECHEANCE: "Suivi d’affaire BE : l’échéance (ou le lot) n’a pas de montant par discipline : à compléter dans le classeur.",
                  RELEVE: "Relevé PE / PI : la ligne n’a pas d’activité, ou son activité n’est rattachée à aucune colonne du Suivi d’affaire (correspondance des activités).",
                  HISTORIQUE: "Ancien classeur : le total ne correspond pas à Méca + Calcul + Elec.",
                };
                const moisLong = new Date(\`\${detail.mois}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
                return (
                  <div style={{ marginTop: 14, padding: 14, border: \`2px solid \${C.rouge}\`, borderRadius: 10, background: "#fffafa" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <strong style={{ fontSize: 16 }}>
                        {detail.groupe ?? detail.imputation} — {moisLong} : {total.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
                      </strong>
                      <span style={{ flex: 1 }} />
                      <button type="button" onClick={() => setDetail(null)} style={page.btnSecondaire}>Fermer ✕</button>
                    </div>
                    {lignesDetail.length === 0 ? (
                      <p style={{ margin: 0, color: C.gris }}>Aucune ligne.</p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                          <thead>
                            <tr>
                              <th style={thG}>Affaire</th>
                              <th style={thG}>Source</th>
                              <th style={thG}>Client</th>
                              <th style={thG}>Imputation</th>
                              <th style={th}>Montant du mouvement</th>
                              <th style={th}>{detail.groupe ? \`Dont \${detail.groupe}\` : "Montant"}</th>
                              {detail.groupe === "Non ventilé" && <th style={thG}>Pourquoi / où corriger</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {lignesDetail.map(({ x, part }, i) => (
                              <tr key={i}>
                                <td style={{ ...tdG, fontWeight: 800 }}>{x.base_affaire}</td>
                                <td style={tdG}>{sources[x.source] ?? x.source}</td>
                                <td style={tdG}>{x.client ?? "—"}</td>
                                <td style={tdG}>{x.imputation ?? "—"}</td>
                                <td style={td}>{x.montant.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                                <td style={{ ...td, fontWeight: 800 }}>{part.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                                {detail.groupe === "Non ventilé" && <td style={{ ...tdG, fontSize: 12, color: "#7a3e00", whiteSpace: "normal", minWidth: 260 }}>{raison[x.source] ?? ""}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}
`;

const changements = [
  ["État du détail", "  const [voirAffaires, setVoirAffaires] = useState(false);",
   "  const [voirAffaires, setVoirAffaires] = useState(false);\n  // montant cliqué dans le tableau mois par mois (activité ou imputation)\n  const [detail, setDetail] = useState<{ mois: string; groupe?: Groupe; imputation?: string } | null>(null);"],
  ["Cases cliquables",
   `  const ligneValeurs = (libelle: string, valeurs: number[], style?: CSSProperties) => (
    <tr key={libelle}>
      <td style={{ ...tdG, ...style }}>{libelle}</td>
      {valeurs.map((v, i) => (
        <td key={i} style={{ ...td, ...style }}>{Math.abs(v) > 0.5 ? keuros(v) : "—"}</td>
      ))}`,
   `  const ligneValeurs = (libelle: string, valeurs: number[], style?: CSSProperties, surClic?: (i: number) => void) => (
    <tr key={libelle}>
      <td style={{ ...tdG, ...style }}>{libelle}</td>
      {valeurs.map((v, i) => (
        <td key={i} style={{ ...td, ...style }}>
          {Math.abs(v) > 0.5 && surClic ? (
            <button
              type="button"
              title="Voir le détail de ce montant"
              onClick={() => surClic(i)}
              style={{ all: "unset", cursor: "pointer", textDecoration: "underline dotted", color: libelle === "Non ventilé" ? "#7a3e00" : undefined, fontWeight: libelle === "Non ventilé" ? 800 : undefined }}
            >
              {keuros(v)}
            </button>
          ) : Math.abs(v) > 0.5 ? (
            keuros(v)
          ) : (
            "—"
          )}
        </td>
      ))}`],
  ["Imputations cliquables", "{vue.parImputation.map((r) => ligneValeurs(r.cle, r.valeurs))}",
   "{vue.parImputation.map((r) => ligneValeurs(r.cle, r.valeurs, undefined, (i) => setDetail({ mois: mois[i], imputation: r.cle })))}"],
  ["Activités cliquables", "{vue.parActivite.map((r) => ligneValeurs(r.cle, r.valeurs))}",
   "{vue.parActivite.map((r) => ligneValeurs(r.cle, r.valeurs, undefined, (i) => setDetail({ mois: mois[i], groupe: r.cle })))}"],
];

for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

// le panneau, juste sous le tableau mois par mois (avant « Remplir le prévisionnel »)
const ancre = /(\{vue\.parActivite\.map[^\n]*\n\s*<\/tbody>\n\s*<\/table>\n)/;
if (!ancre.test(texte)) {
  console.error("✗ Fin du tableau mois par mois introuvable");
  erreurs++;
} else {
  texte = texte.replace(ancre, (m) => m + PANNEAU);
  console.log("✓ Panneau de détail");
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : montants cliquables dans Finances.");
