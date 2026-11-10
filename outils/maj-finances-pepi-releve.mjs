/* ===============================================================
   MAJ FINANCES - L'ATTENDU DES PE / PI CALCULÉ COMME LA FACTURATION
   (FINANCES_PEPI_RELEVE)

   Pour les PE / PI pas encore clôturées, Finances ne passe plus par la
   fonction SQL « prestation_montants_prevus » (heures × taux, sans les
   reports ni les heures sup) : elle prend les montants calculés comme la
   Facturation du mois et le relevé (lib/facturationMois.ts, livré dans le
   même ZIP). L'atterrissage d'un mois tombe ainsi juste avec la
   Facturation du mois.

   À lancer à la racine du projet, APRÈS avoir décompressé le ZIP
   (il remplace lib/facturationMois.ts) :
       node outils/maj-finances-pepi-releve.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_PEPI_RELEVE";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync("lib/facturationMois.ts") || !readFileSync("lib/facturationMois.ts", "utf8").includes("chargerPrestationsMois"))
  echec("lib/facturationMois.ts n'est pas à jour : décompressez tout le ZIP à la racine du projet (il remplace ce fichier).");
if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const IMPORT = 'import TrameCA from "@/components/finances/TrameCA"; // TRAME_CA_V1';
const DEBUT = "        setPrevusReleve(\n          ((mp.data ?? []) as";
const FIN = "        setHistorique(\n";
if (compter(t, IMPORT) !== 1) echec(`${FICHIER} : import de la trame introuvable.`);
if (compter(t, DEBUT) !== 1) echec(`${FICHIER} : prévisions du relevé introuvables.`);
t = t.replace(IMPORT, () => `${IMPORT}\nimport { chargerPrestationsMois } from "@/lib/facturationMois"; // ${MARQUEUR}`);
const i = t.indexOf(DEBUT);
const j = t.indexOf(FIN, i);
if (j < 0) echec(`${FICHIER} : fin des prévisions du relevé introuvable.`);
const NOUVEAU = `        // ${MARQUEUR} : PE / PI pas encore clôturées, calculées comme la Facturation du mois et le relevé
        // (12 mois en arrière, 18 en avant) ; les mois clôturés sont dans le réalisé
        void mp;
        const moisPrevus: string[] = [];
        for (let k = -12; k <= 18; k++) {
          const d = new Date();
          d.setUTCDate(1);
          d.setUTCMonth(d.getUTCMonth() + k);
          moisPrevus.push(d.toISOString().slice(0, 7));
        }
        const prestationsParMois = await chargerPrestationsMois(moisPrevus);
        if (!actif) return;
        const prevus: { base: string; mois: string; montant: number; groupe: Groupe; imputation: string | null; client: string | null }[] = [];
        for (const [m, liste] of prestationsParMois)
          for (const x of liste) {
            if (x.cloture || x.montant <= 0.004) continue;
            prevus.push({
              base: x.base,
              mois: \`\${m}-01\`,
              montant: x.montant,
              groupe: (x.activite_id && groupeActivite.get(x.activite_id)) || "Non ventilé",
              imputation: x.imputation ?? null,
              client: clientDeBase.get(x.base) ?? null,
            });
          }
        setPrevusReleve(prevus);
`;
t = t.slice(0, i) + NOUVEAU + t.slice(j);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ attendu des PE / PI : même calcul que la Facturation du mois");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
