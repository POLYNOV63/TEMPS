/* ===============================================================
   MAJ FACTURATION DU MOIS - SYNTHÈSE EN 3 COLONNES (FACTURATION_SYNTHESE)

   Bouton « Synthèse (Excel) » : un tableau Excel tout simple, une ligne,
   trois colonnes, en k€ HT :
   - <Mois> – Déjà facturé : forfaits livrés + PE / PI des mois clôturés
     (le « Facturé » de la page) ;
   - <Mois> – Restant estimé à facturer : forfaits prévus + PE / PI pas
     encore clôturés (le « Reste à facturer » de la page) ;
   - <Mois + 1> – Prévision totale : forfaits attendus le mois suivant
     (date de livraison estimée du Suivi d'affaire, commande reçue ou
     intention) + PE / PI prévues ce mois-là (comme l'attendu de Finances).

   À lancer à la racine du projet :   node outils/maj-facturation-synthese.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/facturation/page.tsx";
const MARQUEUR = "FACTURATION_SYNTHESE";

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

const FONCTION = `  /* ${MARQUEUR} : une ligne, trois colonnes, en k€ HT */
  async function exporterSynthese() {
    const suivant = decaler(mois, 1);
    const nomDe = (m: string) => {
      const n = NOMS_MOIS[Number(m.slice(5, 7)) - 1];
      return \`\${n.charAt(0).toUpperCase()}\${n.slice(1)} \${m.slice(0, 4)}\`;
    };
    // forfaits attendus le mois suivant, à leur date de livraison estimée
    const enAttente = (l: LigneSuivi) => l.statut === "Commande reçue" || l.statut === "Intention de commande";
    const couverts = new Map<string, number>();
    for (const l of suivi) {
      if ((l.genre !== "ECHEANCE" && l.genre !== "LOT") || !l.parent_cle || l.disparue) continue;
      if (l.statut !== "Livrée" && !(enAttente(l) && l.date_livraison_estimee)) continue;
      const m = montants.get(l.id);
      couverts.set(l.parent_cle, (couverts.get(l.parent_cle) ?? 0) + ((m?.echeances || m?.montant) ?? 0));
    }
    let forfaitsSuivant = 0;
    for (const l of suivi) {
      if (l.disparue || !["BASE", "AVENANT", "ECHEANCE", "LOT"].includes(l.genre) || !enAttente(l)) continue;
      if (!l.date_livraison_estimee?.startsWith(suivant)) continue;
      const b = baseDe(l);
      if (prestation(b.imputation ?? l.imputation)) continue;
      const m = montants.get(l.id);
      forfaitsSuivant +=
        l.genre === "ECHEANCE" || l.genre === "LOT" ? (m?.echeances || m?.montant) ?? 0 : Math.max(0, (m?.montant ?? 0) - (couverts.get(l.cle) ?? 0));
    }
    // PE / PI prévues le mois suivant (relevé non clôturé, sinon Suivi des prestations importé)
    let pepiSuivant = 0;
    const { data } = await supabase.rpc("prestation_montants_prevus");
    for (const x of ((data ?? []) as { mois: string; montant: number | string }[])) if (String(x.mois).startsWith(suivant)) pepiSuivant += Number(x.montant) || 0;

    const k = (v: number) => Math.round(v / 100) / 10;
    await exporterExcelPolynov(\`Facturation_synthese_\${mois}\`, [
      {
        nom: "Synthèse",
        titre: \`Facturation — \${nomDe(mois)}\`,
        sousTitre: \`en k€ HT · au \${new Date().toLocaleDateString("fr-FR")}\`,
        colonnes: [
          { titre: \`\${nomDe(mois)} – Déjà facturé (k€ HT)\`, cle: "facture", largeur: 30 },
          { titre: \`\${nomDe(mois)} – Restant estimé à facturer (k€ HT)\`, cle: "reste", largeur: 34 },
          { titre: \`\${nomDe(suivant)} – Prévision totale (k€ HT)\`, cle: "prevision", largeur: 32 },
        ],
        lignes: [{ facture: k(totalFacture), reste: k(resteAFacturer), prevision: k(forfaitsSuivant + pepiSuivant) }],
        notes: [
          "Déjà facturé : forfaits livrés dans le mois + PE / PI des mois clôturés.",
          "Restant estimé : forfaits attendus dans le mois (date de livraison estimée) + PE / PI pas encore clôturées. Non facturable exclu.",
          \`Prévision \${nomDe(suivant)} : forfaits attendus ce mois-là + PE / PI prévues (\${k(forfaitsSuivant)} k€ de forfaits, \${k(pepiSuivant)} k€ de PE / PI).\`,
        ],
      },
    ]);
  }

  async function exporter() {`;

const R = [
  ["fonction d'export", "  async function exporter() {", FONCTION],
  [
    "bouton",
    '<button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>',
    '<button type="button" style={page.btnPrimaire} onClick={() => void exporter()} disabled={chargement}>Exporter en Excel</button>\n            <button type="button" style={page.btnSecondaire} onClick={() => void exporterSynthese()} disabled={chargement} title="Une ligne, trois colonnes en k€ HT : déjà facturé, restant estimé à facturer, prévision du mois suivant">\n              Synthèse (Excel)\n            </button>',
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ bouton « Synthèse (Excel) » : déjà facturé, restant estimé, prévision du mois suivant");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
