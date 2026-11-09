/* ===============================================================
   MAJ TABLEAU DE BORD - FINITIONS (TABLEAU_FINITIONS)

   - « Facturation du mois » n'apparaît plus qu'une fois pour l'ADMIN :
     dans Exports (c'est le point de fin de mois avec la compta) ;
   - « Rentabilité » (une seule tuile) rejoint le chiffre d'affaires :
     groupe « Rentabilité et chiffre d'affaires » ;
   - description des Indicateurs commerciaux mise à jour (page resserrée).

   À lancer à la racine du projet, APRÈS maj-tableau-par-axes.mjs :
       node outils/maj-tableau-final.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/dashboard/page.tsx";
const MARQUEUR = "TABLEAU_FINITIONS";

const AVANT = `      <Groupe titre="Rentabilité" description="Ce qu'ont rapporté les affaires livrées, face au coût d'une heure">
        <div style={stylesV2.grille}>
          {/* RENTABILITE_V1 FIABILITE_CHIFFRAGE : la fiabilité du chiffrage est reprise dans la rentabilité */}
          <CarteCompacte principale icone="💹" titre="Rentabilité" description="Taux vendu, taux obtenu et coût de structure, par activité et par affaire" onClick={() => aller("/analyse/rentabilite")} />
        </div>
      </Groupe>
      <Groupe titre="Chiffre d'affaires et commercial" description="Facturé, attendu, prévisionnel, devis et commandes">
        <div style={stylesV2.grille}>
          <CarteCompacte principale icone="💶" titre="Finances" description="CA de l'exercice : réalisé, attendu, atterrissage face au prévisionnel" onClick={() => aller("/analyse/finances")} />
          <CarteCompacte icone="🧾" titre="Facturation du mois" description="Le point de fin de mois avec la compta" onClick={() => aller("/analyse/facturation")} />
          <CarteCompacte icone="📈" titre="Indicateurs commerciaux" description="Devis, prise de commande, top 10 clients, carnet" onClick={() => aller("/pilotage/indicateurs")} />
        </div>
      </Groupe>`;

const APRES = `      {/* TABLEAU_FINITIONS : rentabilité et chiffre d'affaires réunis ; la facturation du mois est dans Exports */}
      <Groupe titre="Rentabilité et chiffre d'affaires" description="Ce qu'ont rapporté les affaires, le CA de l'exercice, les consultations">
        <div style={stylesV2.grille}>
          {/* RENTABILITE_V1 FIABILITE_CHIFFRAGE : la fiabilité du chiffrage est reprise dans la rentabilité */}
          <CarteCompacte principale icone="💹" titre="Rentabilité" description="Taux vendu, taux obtenu et coût de structure, par activité et par affaire" onClick={() => aller("/analyse/rentabilite")} />
          <CarteCompacte principale icone="💶" titre="Finances" description="CA de l'exercice : réalisé, attendu, atterrissage face au prévisionnel" onClick={() => aller("/analyse/finances")} />
          <CarteCompacte icone="📈" titre="Indicateurs commerciaux" description="Consultations, taux de transformation, top 10 clients, comparatif sur 3 ans" onClick={() => aller("/pilotage/indicateurs")} />
        </div>
      </Groupe>`;

const DIR_AVANT = 'description="Devis émis et chiffrés, transformation, CBE vendu, carnet de commandes" onClick={() => aller("/pilotage/indicateurs")}';
const DIR_APRES = 'description="Consultations, taux de transformation, top 10 clients, comparatif sur 3 ans" onClick={() => aller("/pilotage/indicateurs")}';

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}
if (t.split(AVANT).length - 1 !== 1) echec(`${FICHIER} : groupes Rentabilité / Chiffre d'affaires introuvables (le tableau de bord par axes est-il installé ?).`);
t = t.replace(AVANT, () => APRES);
const nDir = t.split(DIR_AVANT).length - 1;
t = t.split(DIR_AVANT).join(DIR_APRES);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ « Rentabilité et chiffre d'affaires » réunis ; « Facturation du mois » seulement dans Exports");
console.log(`✓ description des Indicateurs commerciaux mise à jour${nDir ? " (Direction comprise)" : ""}`);
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
