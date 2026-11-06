/* ===============================================================
   MAJ PLANNING - FAMILLES, VERSION DISCRÈTE (FAMILLE_DISCRET)

   Remplace l'encadrement trop chargé (FAMILLE_CADRE) par une version
   légère :
   - en-tête de famille comme avant, juste un peu plus d'air au-dessus ;
   - un fin liseré bleu clair à gauche des commandes de la famille ;
   - un espace après le dernier membre, avant l'affaire suivante.

   Fonctionne que maj-planning-familles.mjs ait été lancé ou non.
   À lancer à la racine du projet :   node outils/maj-planning-familles-discret.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "FAMILLE_DISCRET";

const ROUGE = 'const ROUGE_HACHURE = "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#f0b4b0 4px,#f0b4b0 8px)";';
const PREMIER = "                const premierDeFamille = enFamille && (premierDuGroupe || baseDe(lignes[indexLigne - 1]) !== cle);";
const DERNIER =
  "                const suivante = lignes[indexLigne + 1];\n" +
  "                const dernierDeFamille = enFamille && (!suivante || rangGroupe(suivante) !== groupe || baseDe(suivante) !== cle);";

const ENTETE_NOUVEAU = '<div style={{ marginTop: 12, padding: "6px 10px", background: "#eef3f9", borderTop: "2px solid #9fb6cf", display: "flex",';
const MEMBRE_NOUVEAU = `                    {/* FAMILLE_DISCRET : fin liseré à gauche des commandes de la famille, espace après la dernière */}
                    <div style={{ position: "relative" }}>
                      {rendreAffaire(affaire, null, false)}
                      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#9fb6cf", borderBottomLeftRadius: dernierDeFamille ? 3 : 0, pointerEvents: "none", zIndex: 5 }} />
                    </div>
                    {dernierDeFamille && <div aria-hidden="true" style={{ height: 12 }} />}`;

/* deux points de départ possibles : la page d'origine, ou la version encadrée (FAMILLE_CADRE) */
const depuisOrigine = [
  { nom: "dernier membre de la famille", cherche: PREMIER, remplace: `${PREMIER}\n${DERNIER}` },
  {
    nom: "en-tête de famille aéré",
    cherche: '<div style={{ marginTop: 6, padding: "6px 10px", background: "#eef3f9", borderTop: "2px solid #9fb6cf", display: "flex",',
    remplace: ENTETE_NOUVEAU,
  },
  {
    nom: "liseré et espace de fin de famille",
    cherche: '                    <div style={{ boxShadow: "inset 4px 0 0 #9fb6cf" }}>{rendreAffaire(affaire, null, false)}</div>',
    remplace: MEMBRE_NOUVEAU,
  },
];
const depuisCadre = [
  {
    nom: "couleur du cadre retirée",
    cherche: `${ROUGE}\n// FAMILLE_CADRE : couleur du cadre d'une famille (commande + avenants)\nconst COULEUR_FAMILLE = "#4a6f96";`,
    remplace: ROUGE,
  },
  {
    nom: "en-tête de famille allégé",
    cherche:
      '<div style={{ marginTop: 16, padding: "7px 10px", background: "#dfe8f2", borderTop: `3px solid ${COULEUR_FAMILLE}`, borderLeft: `5px solid ${COULEUR_FAMILLE}`, borderRadius: "4px 4px 0 0", display: "flex",',
    remplace: ENTETE_NOUVEAU,
  },
  {
    nom: "cadre remplacé par un liseré et un espace",
    cherche: `                    {/* FAMILLE_CADRE : barre à gauche sur toute la famille, colonne des noms teintée */}
                    <div style={{ position: "relative" }}>
                      {rendreAffaire(affaire, null, false)}
                      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: LARGEUR_NOM, background: "rgba(74,111,150,0.08)", pointerEvents: "none" }} />
                      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: COULEUR_FAMILLE, borderBottomLeftRadius: dernierDeFamille ? 4 : 0, pointerEvents: "none", zIndex: 5 }} />
                    </div>
                    {/* fin de la famille : trait de fermeture et espace avant l'affaire suivante */}
                    {dernierDeFamille && <div aria-hidden="true" style={{ borderTop: \`3px solid \${COULEUR_FAMILLE}\`, borderRadius: "0 0 0 4px", marginBottom: 16 }} />}`,
    remplace: MEMBRE_NOUVEAU,
  },
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
const remplacements = t.includes("FAMILLE_CADRE") ? depuisCadre : depuisOrigine;
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
if (t.includes("COULEUR_FAMILLE") || t.includes("FAMILLE_CADRE")) echec("il reste des morceaux de l'ancien encadrement.");
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
