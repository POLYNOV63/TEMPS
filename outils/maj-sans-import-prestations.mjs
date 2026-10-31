/* ===============================================================
   Bascule du 2 novembre 2026 : le relevé PE / PI fait foi, l'import du
   classeur « Suivi des prestations » ne sert plus.
   - Tableau de bord : lien « Import Suivi des prestations » retiré du
     Paramétrage ;
   - Relevé PE / PI : bouton « ⇪ Importer le Suivi des prestations » retiré.
   La page /admin/import-prestations existe toujours (adresse à taper), au
   cas où il faudrait reprendre un mois passé.
   Utilisation (à la racine du projet) :  node outils/maj-sans-import-prestations.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

let fait = 0;
function retirer(chemin, morceaux, nom) {
  if (!existsSync(chemin)) {
    console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
  const avant = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
  let texte = avant;
  for (const m of morceaux) texte = texte.split(m).join("");
  if (texte === avant) {
    console.log(`✓ ${nom} : déjà retiré`);
    return;
  }
  writeFileSync(chemin, texte, "utf8");
  fait++;
  console.log(`✓ ${nom} : retiré`);
}

retirer(
  "app/dashboard/page.tsx",
  [
    `        ["🧾", "Import Suivi des prestations", "/admin/import-prestations"],\n`,
    `          <CarteCompacte icone="🧾" titre="Import Suivi des prestations" description="Le classeur fait foi : ses mois remplissent le relevé PE / PI (mois passés validés)" onClick={() => aller("/admin/import-prestations")} />\n`,
  ],
  "Tableau de bord, lien d'import"
);

// bouton du relevé : on retire le bloc <Link href="/admin/import-prestations" …>…</Link>
{
  const chemin = "app/pilotage/prestations/page.tsx";
  if (!existsSync(chemin)) {
    console.error(`✗ Fichier introuvable : ${chemin}`);
    process.exit(1);
  }
  let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
  const debut = texte.indexOf(`            <Link href="/admin/import-prestations"`);
  if (debut < 0) console.log("✓ Relevé, bouton d'import : déjà retiré");
  else {
    const fin = texte.indexOf("</Link>\n", debut);
    if (fin < 0 || fin - debut > 800) {
      console.error("✗ Relevé : fin du bouton introuvable. Rien n'a été modifié dans le relevé. Copiez ce message à Claude.");
      process.exit(1);
    }
    texte = texte.slice(0, debut) + texte.slice(fin + "</Link>\n".length);
    writeFileSync(chemin, texte, "utf8");
    fait++;
    console.log("✓ Relevé, bouton d'import : retiré");
  }
}
console.log(`\nTerminé (${fait} fichier(s) modifié(s)).`);
