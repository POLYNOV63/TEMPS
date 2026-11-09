/* ===============================================================
   MAJ BILAN RH MENSUEL - ÉTATS JUSTES (BILAN_RH_ETATS)

   1. La semaine en cours n'est attendue qu'à partir de son vendredi :
      avant, elle comptait déjà en « Brouillon » ou « Feuille manquante »
      pour tout le monde.
   2. « Non concerné » dit pourquoi (entrée après la période, ou « plus
      dispo après le … » renseigné dans la fiche collaborateur), et une
      personne non concernée n'empêche plus le bilan d'être « PRÊT RH ».
   3. Les jours des feuilles sont lus par paquets de 1 000 (au-delà, des
      tickets restaurant pouvaient manquer).

   À lancer à la racine du projet :   node outils/maj-bilan-rh-etats.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MARQUEUR = "BILAN_RH_ETATS";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

// la page du Bilan RH mensuel : celle qui exporte « BILAN RH MENSUEL — POLYNOV »
function chercher(dossier) {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) {
      const r = chercher(chemin);
      if (r) return r;
    } else if (nom === "page.tsx" && readFileSync(chemin, "utf8").includes("BILAN RH MENSUEL — POLYNOV")) return chemin;
  }
  return null;
}
if (!existsSync("app")) echec("Dossier app introuvable (lancez la commande à la racine du projet).");
const FICHIER = chercher("app");
if (!FICHIER) echec("Page du Bilan RH mensuel introuvable.");

let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const R = [
  [
    "semaine en cours attendue à partir du vendredi",
    `        const derniereSemaineAttendue = periodeEstCourante
          ? semaineCourante < periode.semaineCloture
            ? semaineCourante
            : periode.semaineCloture
          : periode.semaineCloture;`,
    `        // ${MARQUEUR} : la semaine en cours n'est attendue qu'à partir de son vendredi
        const derniereSemaineFinie = aujourdHui >= ajouterJoursISO(semaineCourante, 4) ? semaineCourante : ajouterJoursISO(semaineCourante, -7);
        const derniereSemaineAttendue = periodeEstCourante
          ? derniereSemaineFinie < periode.semaineCloture
            ? derniereSemaineFinie
            : periode.semaineCloture
          : periode.semaineCloture;`,
  ],
  [
    "lecture des jours par paquets de 1 000",
    `          const { data: joursData, error: erreurJours } = await supabase
            .from("feuilles_heures_jours")
            .select(
              "id, feuille_id, date_jour, presence, absence, ticket_restaurant"
            )
            .in("feuille_id", feuilleIds);

          if (erreurJours) throw erreurJours;
          jours = (joursData ?? []) as Jour[];`,
    `          // lecture par paquets de 1 000 (limite de Supabase)
          for (let debut = 0; ; debut += 1000) {
            const { data: joursData, error: erreurJours } = await supabase
              .from("feuilles_heures_jours")
              .select("id, feuille_id, date_jour, presence, absence, ticket_restaurant")
              .in("feuille_id", feuilleIds)
              .order("id")
              .range(debut, debut + 999);

            if (erreurJours) throw erreurJours;
            jours.push(...((joursData ?? []) as Jour[]));
            if ((joursData ?? []).length < 1000) break;
          }`,
  ],
  [
    "« PRÊT RH » sans les non concernés",
    `    return (
      lignes.length > 0 &&
      lignes.every(
        (ligne) =>
          ligne.feuillesAttendues > 0 &&
          ligne.feuillesManquantes === 0 &&`,
    `    // les personnes non concernées (aucune semaine attendue) n'empêchent pas le bilan d'être prêt
    const concernees = lignes.filter((ligne) => ligne.feuillesAttendues > 0);
    return (
      concernees.length > 0 &&
      concernees.every(
        (ligne) =>
          ligne.feuillesManquantes === 0 &&`,
  ],
  [
    "raison du « Non concerné »",
    `                        const etat = aucuneFeuilleAttendue
                          ? "Non concerné"`,
    `                        const c = ligne.collaborateur;
                        const raison =
                          c.date_sortie && periode && c.date_sortie < periode.debutCycle
                            ? \` · plus dispo après le \${formatDate(c.date_sortie)}\`
                            : c.date_entree && periode && c.date_entree > periode.dateCloture
                              ? \` · entrée le \${formatDate(c.date_entree)}\`
                              : " · aucune semaine terminée";
                        const etat = aucuneFeuilleAttendue
                          ? \`Non concerné\${raison}\``,
  ],
  [
    "note sous le tableau",
    `                  Toute absence saisie hors FE est remontée ici pour permettre au service RH de vérifier qu'elle a bien été justifiée dans les outils RH.`,
    `                  Toute absence saisie hors FE est remontée ici pour permettre au service RH de vérifier qu'elle a bien été justifiée dans les outils RH.
                  La semaine en cours n'est attendue qu'à partir de son vendredi.`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [nom, a, b] of R) {
  t = t.replace(a, () => b);
  console.log(`✓ ${nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
