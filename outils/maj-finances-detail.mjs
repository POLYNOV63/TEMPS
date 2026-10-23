/* ===============================================================
   Finances (app/analyse/finances/page.tsx) : montants cliquables.
   Dans le tableau mois par mois, un clic sur un montant des lignes
   « Réalisé », « Attendu », « Réalisé par imputation » ou « Réalisé par
   activité » (dont « Non ventilé ») ouvre, sous le tableau, le détail : les affaires
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
if (texte.includes("DETAIL_CLIQUABLE_V2")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
// première version déjà installée : on la met à niveau
const dejaV1 = texte.includes("DETAIL_CLIQUABLE");
const original = texte;
let erreurs = 0;

const PANNEAU = `
              {/* DETAIL_CLIQUABLE_V2 : ce qui compose le montant cliqué (réalisé, attendu, imputation, activité) */}
              {detail && (() => {
                const lignesDetail = (detail.ligne === "ATTENDU" ? attendus.mouvements : mouvements)
                  .filter((x) => x.date.startsWith(detail.mois))
                  .map((x) => ({ x, part: detail.ligne ? x.montant : detail.groupe ? x.parGroupe[detail.groupe] : (x.imputation ?? "—") === detail.imputation ? x.montant : 0 }))
                  .filter((l) => Math.abs(l.part) > 0.5)
                  .sort((a, b) => Math.abs(b.part) - Math.abs(a.part));
                const total = lignesDetail.reduce((t, l) => t + l.part, 0);
                const sources: Record<string, string> = { LIVRAISON: "Forfait livré", ECHEANCE: "Échéance / lot livré", RELEVE: "Relevé PE / PI", HISTORIQUE: "Historique (ancien classeur)" };
                const libelleSource = (x: (typeof lignesDetail)[number]["x"]) =>
                  x.source !== "ATTENDU"
                    ? sources[x.source] ?? x.source
                    : x.retard
                      ? "Attendu — délai dépassé, reporté sur ce mois"
                      : x.imputation === "PE" || x.imputation === "PI"
                        ? "Attendu — prestation prévue (relevé / Suivi des prestations)"
                        : "Attendu — forfait à son délai estimé";
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
                        {detail.groupe ?? detail.imputation ?? (detail.ligne === "ATTENDU" ? "Attendu" : "Réalisé")} — {moisLong} : {total.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
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
                                <td style={tdG}>{libelleSource(x)}</td>
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
   '  const [voirAffaires, setVoirAffaires] = useState(false);\n  // montant cliqué dans le tableau mois par mois (réalisé, attendu, imputation, activité)\n  const [detail, setDetail] = useState<{ mois: string; groupe?: Groupe; imputation?: string; ligne?: "REALISE" | "ATTENDU" } | null>(null);'],
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

const changementsCommuns = [
  ["Réalisé cliquable", '{ligneValeurs("Réalisé", vue.realise, { fontWeight: 800 })}',
   '{ligneValeurs("Réalisé", vue.realise, { fontWeight: 800 }, (i) => setDetail({ mois: mois[i], ligne: "REALISE" }))}'],
  ["Attendu cliquable", '{ligneValeurs("Attendu", vue.attendu, { color: "#a33a3a", fontStyle: "italic" })}',
   '{ligneValeurs("Attendu", vue.attendu, { color: "#a33a3a", fontStyle: "italic" }, (i) => setDetail({ mois: mois[i], ligne: "ATTENDU" }))}'],
];

if (dejaV1) {
  // mise à niveau : on remplace le panneau et le type de l'état
  const debutPanneau = texte.indexOf("              {/* DETAIL_CLIQUABLE : ce qui compose le montant cliqué */}");
  const finPanneau = debutPanneau < 0 ? -1 : texte.indexOf("              })()}\n", debutPanneau);
  if (debutPanneau < 0 || finPanneau < 0) {
    console.error("✗ Ancien panneau de détail introuvable");
    erreurs++;
  } else {
    texte = texte.slice(0, debutPanneau) + PANNEAU.replace(/^\n/, "") + texte.slice(finPanneau + "              })()}\n".length);
    console.log("✓ Panneau de détail mis à niveau");
  }
  changements.length = 0;
  changements.push([
    "État du détail",
    "useState<{ mois: string; groupe?: Groupe; imputation?: string } | null>(null);",
    'useState<{ mois: string; groupe?: Groupe; imputation?: string; ligne?: "REALISE" | "ATTENDU" } | null>(null);',
  ]);
}

for (const [nom, cherche, remplace] of [...changements, ...changementsCommuns]) {
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
if (dejaV1) {
  // déjà en place
} else if (!ancre.test(texte)) {
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
