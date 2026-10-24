/* ===============================================================
   Portefeuille : l'affectation d'un DBE passe le changement de date par
   la fonction prévue pour les délais (pilotage_changer_echeance), qui
   garde l'historique avec un motif : « Date de rendu du devis fixée
   depuis le portefeuille ». La colonne « Échéance » devient « Délai ».
   Prérequis : maj-portefeuille-dbe.mjs (et -v2) déjà lancés.
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-dbe-delai.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin}`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("DELAI_PAR_FONCTION")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("AFFECTER_DBE")) {
  console.error("✗ Lancez d'abord : node outils/maj-portefeuille-dbe.mjs");
  process.exit(1);
}
const original = texte;
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
  "Date de rendu enregistrée avec son historique",
  `    const { error } = await supabase
      .from("pilotage_affaires")
      .update({ responsable_id: edDbe.resp, echeance: edDbe.date })
      .eq("id", edDbe.id);`,
  `    // DELAI_PAR_FONCTION : le rédacteur d'abord ; la date passe par la fonction des délais,
    // qui garde l'historique (motif obligatoire, rempli automatiquement)
    let { error } = await supabase.from("pilotage_affaires").update({ responsable_id: edDbe.resp }).eq("id", edDbe.id);
    if (!error) {
      const avant = affaires.find((a) => a.id === edDbe.id)?.echeance ?? null;
      if (avant !== edDbe.date) {
        ({ error } = await supabase.rpc("pilotage_changer_echeance", {
          p_affaire_id: edDbe.id,
          p_nouvelle_date: edDbe.date,
          p_motif: "Date de rendu du devis fixée depuis le portefeuille",
        }));
      }
    }`
);
remplacer("Colonne « Délai »", `<EnTeteTri col="echeance" libelle="Échéance" />`, `<EnTeteTri col="echeance" libelle="Délai" />`);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : la date de rendu d'un DBE s'enregistre (avec son historique).");
