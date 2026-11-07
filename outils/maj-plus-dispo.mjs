/* ===============================================================
   MAJ - « PLUS DISPO » AU LIEU DE « SORTIE » (PLUS_DISPO)

   Les libellés de la date de sortie deviennent « Plus dispo » :
   - fiche collaborateur : « Plus dispo après le (facultatif) », pastille
     « Plus dispo après le … » ;
   - planning par ressource : « plus dispo après le … » sous le nom,
     « Plus dispo » dans les jours grisés.
   (Rien ne change dans le calcul : c'est toujours le dernier jour travaillé.)

   À lancer à la racine du projet, APRÈS maj-date-sortie.mjs et
   maj-ressource-sortie.mjs :   node outils/maj-plus-dispo.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIERS = [
  {
    f: "app/admin/collaborateurs/page.tsx",
    marqueur: "DATE_SORTIE",
    r: [
      ["Date de sortie (facultatif)</label>", "Plus dispo après le (facultatif)</label>"],
      ["                            Sortie le {formatDate(c.date_sortie)}", "                            Plus dispo après le {formatDate(c.date_sortie)}"],
    ],
  },
  {
    f: "app/pilotage/planning-ressources/page.tsx",
    marqueur: "RESSOURCE_SORTIE",
    r: [
      [">sortie le {formatDate(l.collab.date_sortie)}</span>", ">plus dispo après le {formatDate(l.collab.date_sortie)}</span>"],
      ["title={`${nomCollab(l.collab)} : sorti(e) le ${formatDate(l.collab.date_sortie as string)}`}", "title={`${nomCollab(l.collab)} : plus dispo après le ${formatDate(l.collab.date_sortie as string)}`}"],
      ["                          Sorti\n                        </div>", "                          Plus dispo\n                        </div>"],
    ],
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

const resultats = [];
for (const { f, marqueur, r } of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (!t.includes(marqueur)) echec(`${f} : lancez d'abord le script qui ajoute la date de sortie (${marqueur}).`);
  const restants = r.filter(([a]) => t.includes(a));
  if (restants.length === 0) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  if (restants.length !== r.length) echec(`${f} : libellés dans un état inattendu (en partie modifiés).`);
  for (const [a] of r) if (t.split(a).length - 1 !== 1) echec(`${f} : « ${a.trim().slice(0, 40)} » trouvé plusieurs fois.`);
  for (const [a, b] of r) t = t.replace(a, () => b);
  resultats.push([f, t]);
}
for (const [f, t] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : « Plus dispo »`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
