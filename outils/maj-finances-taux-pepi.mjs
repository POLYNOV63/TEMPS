/* ===============================================================
   Finances (app/analyse/finances/page.tsx) : TAUX DE VENTE MOYEN des PE
   et des PI, mois par mois sur l'exercice, en € / h et en € / jour :
   montant facturé ÷ heures facturées des mois clôturés du relevé.
   Utilisation (à la racine du projet) :  node outils/maj-finances-taux-pepi.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/analyse/finances/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("TAUX_PEPI")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "Heures et jours facturés dans le relevé (type)",
  `type Releve = { base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null };`,
  `type Releve = { base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null; heures?: number; jours?: number };`
);
remplacer("Base horaire des lignes", `supabase.from("prestation_lignes").select("id,affaire_id,activite_id"),`, `supabase.from("prestation_lignes").select("id,affaire_id,activite_id,base_horaire"),`);
remplacer("Heures facturées des mois clôturés", `supabase.from("prestation_mois").select("ligne_id,mois,montant_fige").eq("valide", true),`, `supabase.from("prestation_mois").select("ligne_id,mois,montant_fige,heures_fige").eq("valide", true),`);
remplacer(
  "Lignes du relevé (type)",
  `const lignesPrest = new Map(((pl.data ?? []) as { id: string; affaire_id: string; activite_id: string | null }[]).map((x) => [x.id, x]));`,
  `const lignesPrest = new Map(((pl.data ?? []) as { id: string; affaire_id: string; activite_id: string | null; base_horaire: number | string | null }[]).map((x) => [x.id, x]));`
);
remplacer(
  "Mois clôturés (type)",
  `for (const x of (pm.data ?? []) as { ligne_id: string; mois: string; montant_fige: number | string | null }[]) {`,
  `for (const x of (pm.data ?? []) as { ligne_id: string; mois: string; montant_fige: number | string | null; heures_fige: number | string | null }[]) {`
);
remplacer(
  "Heures et jours facturés",
  `            imputation: a.imputation,
            client: clientDeBase.get(base) ?? null,
          });`,
  `            imputation: a.imputation,
            client: clientDeBase.get(base) ?? null,
            heures: Number(x.heures_fige) || 0,
            jours: (Number(x.heures_fige) || 0) / (Number(lp.base_horaire) || 7),
          });`
);
remplacer(
  "Calcul du taux moyen",
  `    const negoce = dansEx.reduce((t, x) => t + x.negoce, 0);`,
  `    // TAUX_PEPI : taux de vente moyen des PE et des PI = montant facturé ÷ heures (ou jours) facturés, mois clôturés
    const tauxPEPI = (["PE", "PI"] as const).map((imp) => {
      const somme = (liste: Releve[]) => ({
        montant: liste.reduce((t, r) => t + r.montant, 0),
        heures: liste.reduce((t, r) => t + (r.heures ?? 0), 0),
        jours: liste.reduce((t, r) => t + (r.jours ?? 0), 0),
      });
      const duType = releve.filter((r) => r.imputation === imp && (r.heures ?? 0) > 0);
      return {
        imp,
        parMois: mois.map((m) => somme(duType.filter((r) => r.mois.startsWith(m)))),
        exercice: somme(duType.filter((r) => r.mois >= debut && r.mois <= fin)),
        n1: somme(duType.filter((r) => r.mois >= \`\${moisN1[0]}-01\` && r.mois <= \`\${moisN1[11]}-31\`)),
      };
    });

    const negoce = dansEx.reduce((t, x) => t + x.negoce, 0);`
);
remplacer(
  "Taux moyen transmis à l'affichage",
  `      negoce,
      achats,
    };`,
  `      negoce,
      achats,
      tauxPEPI,
    };`
);
remplacer(
  "Tableau du taux moyen",
  `            {/* ---------- activités × imputations ---------- */}`,
  `            {/* ---------- taux de vente moyen des PE / PI ---------- */}
            {vue.tauxPEPI.some((t) => t.exercice.heures > 0 || t.n1.heures > 0) && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>Taux de vente moyen des PE / PI</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  Montant facturé ÷ heures (ou jours) facturées, sur les mois clôturés du relevé des prestations. Le jour se compte avec la base horaire de chaque ligne (7 h ou 7,5 h).
                </p>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={thG} />
                      {mois.map((m) => (
                        <th key={m} style={th}>{libMois(m)}</th>
                      ))}
                      <th style={th}>Exercice</th>
                      <th style={th}>N-1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vue.tauxPEPI.flatMap((t) =>
                      (["h", "j"] as const).map((u) => {
                        const taux = (s: { montant: number; heures: number; jours: number }) => {
                          const q = u === "h" ? s.heures : s.jours;
                          return q > 0 ? \`\${Math.round(s.montant / q).toLocaleString("fr-FR")} €\` : "—";
                        };
                        return (
                          <tr key={\`\${t.imp}-\${u}\`} style={u === "h" ? { borderTop: \`2px solid \${C.ligne}\` } : undefined}>
                            <td style={tdG}>{u === "h" ? \`\${t.imp} · € / h\` : <span style={{ fontWeight: 400, paddingLeft: 12 }}>€ / jour</span>}</td>
                            {t.parMois.map((s, i) => (
                              <td key={i} style={{ ...td, fontWeight: u === "h" ? 700 : 400, color: u === "j" ? C.gris : undefined }} title={s.heures > 0 ? \`\${euros(s.montant)} pour \${formatHeures(s.heures)}\` : undefined}>
                                {taux(s)}
                              </td>
                            ))}
                            <td style={{ ...td, fontWeight: 800 }} title={t.exercice.heures > 0 ? \`\${euros(t.exercice.montant)} pour \${formatHeures(t.exercice.heures)}\` : undefined}>
                              {taux(t.exercice)}
                            </td>
                            <td style={{ ...td, color: C.gris }}>{taux(t.n1)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </section>
            )}

            {/* ---------- activités × imputations ---------- */}`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : taux de vente moyen des PE / PI dans Finances.");
