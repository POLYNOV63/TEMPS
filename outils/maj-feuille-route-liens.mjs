/* ===============================================================
   Ma feuille de route (app/ma-feuille-de-route/page.tsx) : un clic sur le
   n° d'une affaire ou d'un devis ouvre sa page (Bilan affaire, avec le
   panneau Pilotage pour les responsables).
   Utilisation (à la racine du projet) :  node outils/maj-feuille-route-liens.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/ma-feuille-de-route/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("LIEN_AFFAIRE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const changements = [
  [
    "Lien vers la page d'une affaire",
    "type LigneRoute = {",
    `/* LIEN_AFFAIRE : « CBE 1604R2 » -> page de l'affaire (Bilan affaire), sur la bonne commande */
function lienAffaire(type: string, numero: string): string {
  const base = (numero.match(/^\\d+/)?.[0] ?? numero).replace(/^0+/, "");
  return \`/affaires/bilan?affaire=\${type}\${base}&commande=\${encodeURIComponent(numero)}\`;
}

type LigneRoute = {`,
  ],
  [
    "Affaires de la semaine : n° cliquable",
    `<strong style={{ color: C.rougeFonce }}>{l.titre}</strong>`,
    `{(() => {
                              const m = l.affaireId ? l.titre.match(/^(CBE|DBE)\\s*(\\S+)$/i) : null;
                              return m ? (
                                <Link href={lienAffaire(m[1].toUpperCase(), m[2])} title="Ouvrir la page de l’affaire" style={{ fontWeight: 800, color: C.rougeFonce }}>
                                  {l.titre}
                                </Link>
                              ) : (
                                <strong style={{ color: C.rougeFonce }}>{l.titre}</strong>
                              );
                            })()}`,
  ],
  [
    "Devis à rédiger : n° cliquable",
    `<strong style={{ color: "#a3245a" }}>DBE {d.numero}</strong>`,
    `<Link href={lienAffaire("DBE", d.numero)} title="Ouvrir la page du devis" style={{ fontWeight: 800, color: "#a3245a" }}>
                      DBE {d.numero}
                    </Link>`,
  ],
  [
    "Devis à rendre dans la semaine : n° cliquable",
    `<strong style={{ color: "#a3245a" }}>📝 DBE {d.numero}</strong>`,
    `<Link href={lienAffaire("DBE", d.numero)} title="Ouvrir la page du devis" style={{ fontWeight: 800, color: "#a3245a" }}>
                              📝 DBE {d.numero}
                            </Link>`,
  ],
];
let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, () => remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : n° d'affaire cliquables dans la feuille de route.");
