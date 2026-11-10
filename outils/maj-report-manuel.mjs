/* ===============================================================
   MAJ - LE REPORT N'EST PLUS AUTOMATIQUE, LIVRÉE EN VERT (REPORT_MANUEL)

   Un mois de PE / PI n'est plus « reporté » d'office quand la commande
   n'est qu'une intention : le report ne se fait qu'à la main (« ↪ » dans
   les réglages ⚙ de la ligne), quand on ne peut pas facturer le mois et
   qu'on décale sa facturation au mois suivant. Une PE / PI sans commande
   reçue reste signalée NON FACTURABLE (Facturation du mois, et contrôle à
   la clôture du relevé).
   Fichiers : relevé PE / PI, Facturation du mois, Finances (même règle).

   Relevé : le n° d'une commande LIVRÉE est surligné en vert.

   À lancer à la racine du projet :   node outils/maj-report-manuel.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "REPORT_MANUEL";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const FICHIERS = {
  "app/pilotage/prestations/page.tsx": [
    ["report automatique", '      return ml ? ml.reporte : affairesParId.get(l.affaire_id)?.statut === "EN_ATTENTE";', `      return ml ? ml.reporte : false; // ${MARQUEUR} : le report ne se fait qu'à la main`],
    [
      "n° en vert",
      'style={{ fontWeight: 800, color: C.rougeFonce, ...(nonFacturable ? { background: "#ffe94d", padding: "0 4px", borderRadius: 3 } : {}) }}',
      'style={{ fontWeight: 800, color: C.rougeFonce, ...(nonFacturable ? { background: "#ffe94d", padding: "0 4px", borderRadius: 3 } : a.statut === "LIVREE" ? { background: "#c8ecc9", padding: "0 4px", borderRadius: 3 } : {}) }}',
    ],
    [
      "info-bulle livrée",
      'title={nonFacturable ? "Commande pas encore reçue : NON FACTURABLE en l’état" : undefined}',
      'title={nonFacturable ? "Commande pas encore reçue : NON FACTURABLE en l’état" : a.statut === "LIVREE" ? `Commande livrée${a.date_livraison ? ` le ${new Date(`${a.date_livraison.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR")}` : ""}` : undefined}',
    ],
  ],
  "app/analyse/facturation/page.tsx": [
    ["report automatique", '          const reporte = m ? Boolean(m.reporte) : a.statut === "EN_ATTENTE";', `          const reporte = m ? Boolean(m.reporte) : false; // ${MARQUEUR}`],
  ],
  "app/analyse/finances/page.tsx": [
    ["report automatique", '        return row ? row.reporte : a.statut === "EN_ATTENTE";', `        return row ? row.reporte : false; // ${MARQUEUR}`],
  ],
};

const sorties = [];
for (const [f, regles] of Object.entries(FICHIERS)) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  for (const [nom, a] of regles) if (compter(t, a) !== 1) echec(`${f} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
  for (const [, a, b] of regles) t = t.replace(a, () => b);
  sorties.push([f, t]);
}
for (const [f, t] of sorties) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} mis à jour`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
