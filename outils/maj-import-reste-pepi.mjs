/* ===============================================================
   Import du Suivi des prestations : lit aussi « Jours/heures en commande
   initiale » et « Jours/heures restant sur la commande » (colonnes AV et
   AW, repérées par leur titre), et les garde dans le relevé (SQL 64).
   Même un mois déjà validé reçoit ces deux valeurs (rien d'autre n'y
   change : ni heures, ni montant).
   Fichiers : lib/importSuiviPrestations.ts, app/admin/import-prestations/page.tsx
   Utilisation (à la racine du projet) :  node outils/maj-import-reste-pepi.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichiers = { lib: "lib/importSuiviPrestations.ts", page: "app/admin/import-prestations/page.tsx" };
for (const f of Object.values(fichiers))
  if (!existsSync(f)) {
    console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
const textes = Object.fromEntries(Object.entries(fichiers).map(([k, f]) => [k, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));
if (textes.lib.includes("reste_commande")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(cible, nom, cherche, remplace) {
  const nb = textes[cible].split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  textes[cible] = textes[cible].replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

/* ---- lecture du classeur ---- */
remplacer(
  "lib",
  "Champs commande et reste",
  `  montant: number; // total facturé de la ligne = Méca + Calcul + Elec (heures sup comprises)`,
  `  montant: number; // total facturé de la ligne = Méca + Calcul + Elec (heures sup comprises)
  commande_initiale: number | null; // « Jours/heures en commande initiale » (unité du bloc)
  reste_commande: number | null; // « Jours/heures restant sur la commande » (unité du bloc)`
);
remplacer(
  "lib",
  "Colonnes repérées par leur titre",
  `    else if (t === "elec" && c.elec === undefined) c.elec = i;`,
  `    else if (t === "elec" && c.elec === undefined) c.elec = i;
    else if (t.startsWith("jours/heures en commande")) c.commande = i;
    else if (t.startsWith("jours/heures restant")) c.reste = i;`
);
remplacer(
  "lib",
  "Valeurs lues sur chaque ligne",
  `        montant: meca + calcul + elec,`,
  `        montant: meca + calcul + elec,
        commande_initiale: v(r, "commande"),
        reste_commande: v(r, "reste"),`
);

/* ---- enregistrement dans le relevé ---- */
remplacer(
  "page",
  "Mois validé : commande et reste quand même mis à jour",
  `          if (ligneId && c.valides.has(\`\${ligneId}|\${m.slice(0, 7)}\`)) {
            bilan.verrouilles++;`,
  `          if (ligneId && c.valides.has(\`\${ligneId}|\${m.slice(0, 7)}\`)) {
            // mois validé : seuls la commande et le reste du classeur sont mis à jour (ni heures, ni montant)
            const idValide = ligneId;
            const { error: er } = await reessayer(() =>
              supabase
                .from("prestation_mois")
                .update({
                  commande_import: g.source.find((l) => l.commande_initiale !== null)?.commande_initiale ?? null,
                  reste_import: g.source.find((l) => l.reste_commande !== null)?.reste_commande ?? null,
                })
                .eq("ligne_id", idValide)
                .eq("mois", m)
            );
            if (er) throw new Error(er.message);
            bilan.verrouilles++;`
);
remplacer(
  "page",
  "Commande et reste enregistrés avec le mois",
  `              montant_fige: passe ? montant : null,`,
  `              montant_fige: passe ? montant : null,
              commande_import: g.source.find((l) => l.commande_initiale !== null)?.commande_initiale ?? null,
              reste_import: g.source.find((l) => l.reste_commande !== null)?.reste_commande ?? null,`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [k, f] of Object.entries(fichiers)) writeFileSync(f, textes[k], "utf8");
console.log("\nTerminé : l'import lit la commande initiale et le reste du classeur.");
