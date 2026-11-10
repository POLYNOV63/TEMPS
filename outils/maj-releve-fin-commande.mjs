/* ===============================================================
   MAJ RELEVÉ PE / PI - LE JOUR EN JAUNE = FIN DE LA COMMANDE
   (FIN_COMMANDE_JAUNE)

   Le jour en jaune n'est plus le dernier jour saisi de la ligne, mais le
   jour où la commande est ÉPUISÉE : en suivant les jours saisis dans
   l'ordre (mois passés compris, toutes personnes de la commande), c'est
   le jour où l'on atteint ce qui est commandé (le montant, au taux des
   lignes ; à défaut, les jours ou les heures commandés). L'info-bulle dit
   combien il restait de commande ce jour-là (une commande à l'heure peut
   s'épuiser au milieu d'une journée). Rien en jaune si la commande n'est
   pas épuisée dans le mois affiché.

   À lancer à la racine du projet :   node outils/maj-releve-fin-commande.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/prestations/page.tsx";
const MARQUEUR = "FIN_COMMANDE_JAUNE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const CALCUL = `  /* ${MARQUEUR} : jour où chaque commande est épuisée (dans le mois affiché), par ligne, et ce qu'il en restait ce jour-là (en heures) */
  const finCommande = useMemo(() => {
    const m = new Map<string, { jour: string; resteH: number }>();
    for (const a of affaires) {
      const ls = lignes.filter((l) => l.affaire_id === a.id);
      if (ls.length === 0) continue;
      const f = ficheDe(a);
      if (f.quantite === null || f.quantite <= 0) continue;
      const tauxH = (l: Ligne) => (l.taux === null ? null : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux);
      const enEuros = f.montant > 0 && ls.every((l) => tauxH(l) !== null);
      const valeur = (l: Ligne, h: number) => (enEuros ? h * (tauxH(l) as number) : h);
      const plafond = enEuros ? f.montant : f.quantite * (f.unite === "JOUR" ? f.base : 1);
      let cumul = ls.reduce((s, l) => s + valeur(l, consoLigneAvant.get(l.id) ?? 0), 0);
      if (cumul >= plafond - 0.01) continue; // déjà épuisée avant ce mois
      let trouve = false;
      for (const j of jours) {
        for (const l of ls) {
          const h = saisieParCle.get(\`\${l.id}|\${j.date}\`)?.heures ?? 0;
          if (h <= 0) continue;
          const avant = cumul;
          cumul += valeur(l, h);
          if (cumul >= plafond - 0.01) {
            const resteV = plafond - avant;
            m.set(l.id, { jour: j.date, resteH: Math.max(0, enEuros ? resteV / (tauxH(l) as number) : resteV) });
            trouve = true;
            break;
          }
        }
        if (trouve) break;
      }
    }
    return m;
  }, [affaires, lignes, ficheDe, consoLigneAvant, jours, saisieParCle]);

  /* Unité ou base de la commande : ses lignes suivent ;`;

const R = [
  ["calcul", "  /* Unité ou base de la commande : ses lignes suivent ;", CALCUL],
  ["jour en jaune", "                                const dernierPlanifie = j.date === dernierJourLigne(l);", "                                const fin = finCommande.get(l.id);\n                                const dernierPlanifie = fin?.jour === j.date;"],
  [
    "info-bulle",
    ': dernierPlanifie ? "Dernier jour planifié de cette ligne" :',
    ": dernierPlanifie ? `Fin de la commande : ce qui est commandé est consommé ce jour-là (il en restait ${texteHeures(Math.round((fin?.resteH ?? 0) * 100) / 100)} h)` :",
  ],
  [
    "explication",
    'jour <span style={{ background: "#ffe94d", padding: "0 3px" }}>en jaune</span> = dernier jour planifié',
    'jour <span style={{ background: "#ffe94d", padding: "0 3px" }}>en jaune</span> = fin de la commande (tout ce qui est commandé est consommé)',
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ le jour en jaune est celui où la commande est épuisée");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
