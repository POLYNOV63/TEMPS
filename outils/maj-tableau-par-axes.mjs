/* ===============================================================
   MAJ - TABLEAU DE BORD RANGÉ PAR AXES + MÉNAGE (TABLEAU_PAR_AXES)

   1. Tableau de bord (ADMIN et Direction) : les tuiles sont rangées par
      question :
      - Avancement des affaires (heures)  - Charge à venir
      - Activité réalisée / Équipe        - Rentabilité
      - Chiffre d'affaires et commercial
      La tuile « Fiabilité du chiffrage » disparaît (la page Rentabilité la
      remplace ; l'ancienne page reste accessible par son adresse).
   2. Finances : la partie « Rentabilité » est retirée (elle a sa page),
      remplacée par un lien.

   À lancer à la racine du projet, APRÈS maj-rentabilite.mjs :
       node outils/maj-tableau-par-axes.mjs
   Tout ou rien (les deux fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "TABLEAU_PAR_AXES";

/* ---------------- tableau de bord ---------------- */
const BUREAU = `/* TABLEAU_PAR_AXES : le métier, en deux questions — où en sont les affaires, a-t-on les bras */
function BlocBureauEtudes({ aller, admin = false }: { aller: (url: string) => void; admin?: boolean }) {
  return (
    <>
      <Groupe titre="Avancement des affaires" description="Chiffré face aux heures consommées : où en est-on, va-t-on déraper ?">
        <div style={stylesV2.grille}>
          <CarteCompacte principale icone="🗂️" titre="Portefeuille" description="Toutes les affaires : réalisé / chiffré, sur une période, par activité, alertes" onClick={() => aller("/pilotage")} />
          <CarteCompacte icone="📋" titre="Bilan affaire" description="Une affaire en détail : par activité, par personne, mois par mois" onClick={() => aller("/affaires/bilan")} />
          <CarteCompacte icone="🧾" titre="Relevé PE / PI" description="Le relevé du mois des prestations au temps passé" onClick={() => aller("/pilotage/prestations")} />
        </div>
      </Groupe>
      <Groupe titre="Charge à venir" description="Le planifié face à la capacité : a-t-on les bras ?">
        <div style={stylesV2.grille}>
          <CarteCompacte principale icone="🗓️" titre="Planning des affaires" description="Affecter les ressources, voir le pointé et le reste à planifier" onClick={() => aller("/pilotage/affaires")} />
          <CarteCompacte icone="👥" titre="Charge par ressource" description="Qui est chargé, qui est disponible, semaine par semaine" onClick={() => aller("/pilotage/ressources")} />
          {/* CHARGE_ACTIVITES */}
          {admin && <CarteCompacte icone="🧭" titre="Disponibilités par activité" description="Méca, Elec, Calcul : capacité, occupé et disponible sur 12 semaines" onClick={() => aller("/analyse/charge-activites")} />}
        </div>
      </Groupe>
    </>
  );
}

`;

const ANALYSES = `/* TABLEAU_PAR_AXES : ce qui a été fait, ce que ça a rapporté, le chiffre d'affaires */
function BlocAnalyses({ aller }: { aller: (url: string) => void }) {
  return (
    <>
      <Groupe titre="Activité réalisée" description="Où est passé le temps, qui compose l'équipe">
        <div style={stylesV2.grille}>
          <CarteCompacte principale icone="📊" titre="Analyse de capacité" description="Où part le temps de l'équipe : vendu, devis, NI, formation, non expliqué" onClick={() => aller("/admin/bilans")} />
          <CarteCompacte icone="🧑‍🔧" titre="Cartographie de l’équipe" description="Activités, niveaux, relève et polyvalence du bureau d’études" onClick={() => aller("/analyse/effectifs")} />
        </div>
      </Groupe>
      <Groupe titre="Rentabilité" description="Ce qu'ont rapporté les affaires livrées, face au coût d'une heure">
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
      </Groupe>
    </>
  );
}

`;

const DIRECTION = `/* Direction (Président, adjoint) : consultation seule — TABLEAU_PAR_AXES */
function BlocDirection({ aller }: { aller: (url: string) => void }) {
  return (
    <>
      <Groupe titre="Charge à venir" description="Consultation">
        <div style={stylesV2.grille}>
          {/* CHARGE_ACTIVITES */}
          <CarteCompacte principale icone="🧭" titre="Disponibilités par activité" description="Méca, Elec, Calcul : capacité, occupé et disponible sur 12 semaines" onClick={() => aller("/analyse/charge-activites")} />
          <CarteCompacte icone="👥" titre="Charge par ressource" description="Charge prévue de chacun, semaine par semaine" onClick={() => aller("/pilotage/ressources")} />
          <CarteCompacte icone="🗓️" titre="Planning des affaires" description="Qui travaille sur quoi, semaine par semaine" onClick={() => aller("/pilotage/affaires")} />
        </div>
      </Groupe>
      <Groupe titre="Avancement des affaires et équipe" description="Consultation">
        <div style={stylesV2.grille}>
          <CarteCompacte icone="🎯" titre="Analyse du chiffré" description="Heures produites face aux heures chiffrées, par commande" onClick={() => aller("/analyse/pointage")} />
          <CarteCompacte icone="🧑‍🔧" titre="Cartographie de l’équipe" description="Activités, niveaux, relève et polyvalence du bureau d’études" onClick={() => aller("/analyse/effectifs")} />
        </div>
      </Groupe>
      <Groupe titre="Rentabilité et chiffre d'affaires" description="Consultation">
        <div style={stylesV2.grille}>
          {/* RENTABILITE_V1 FIABILITE_CHIFFRAGE */}
          <CarteCompacte principale icone="💹" titre="Rentabilité" description="Taux vendu, taux obtenu et coût de structure, par activité et par affaire" onClick={() => aller("/analyse/rentabilite")} />
          <CarteCompacte principale icone="💶" titre="Finances" description="CA de l'exercice : réalisé, attendu, atterrissage face au prévisionnel" onClick={() => aller("/analyse/finances")} />
          <CarteCompacte icone="🧾" titre="Facturation du mois" description="Point de fin de mois avec la compta : forfaits livrés et PE / PI, n° ARC Louxor" onClick={() => aller("/analyse/facturation")} />
          <CarteCompacte icone="📈" titre="Indicateurs commerciaux" description="Devis émis et chiffrés, transformation, CBE vendu, carnet de commandes" onClick={() => aller("/pilotage/indicateurs")} />
        </div>
      </Groupe>
    </>
  );
}

`;

const BLOCS = [
  ["bloc Bureau d'études", "/* Le métier : les affaires, leur planning et les prestations */\n", "/* Toutes les analyses au même endroit : l'argent, le commercial, la charge */\n", BUREAU],
  ["bloc Analyses", "/* Toutes les analyses au même endroit : l'argent, le commercial, la charge */\n", "/* Ce qui part chez la compta et la paie, chaque fin de mois */\n", ANALYSES],
  ["bloc Direction", "/* Direction (Président, adjoint) : consultation seule */\n", "/* Casquette « chiffre d'affaires » : ADMIN seulement */\n", DIRECTION],
];

/* ---------------- Finances : la rentabilité a sa page ---------------- */
const DEBUT_RENTA = "            {/* ---------- rentabilité ---------- */}\n";
const FIN_RENTA = '            <details style={{ fontSize: 13, color: "#3b4046" }}>';
const LIEN_RENTA = `            {/* TABLEAU_PAR_AXES : la rentabilité a sa propre page */}
            <section style={{ ...page.carte, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <strong>Rentabilité</strong>
              <span style={{ color: C.gris, fontSize: 14 }}>taux vendu, taux obtenu, coût de structure et marge, par activité et par affaire :</span>
              <Link href="/analyse/rentabilite" style={{ fontWeight: 800, color: C.rougeFonce }}>
                ouvrir la page Rentabilité →
              </Link>
            </section>

`;

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

const TABLEAU = "app/dashboard/page.tsx";
const FINANCES = "app/analyse/finances/page.tsx";
for (const f of [TABLEAU, FINANCES]) if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
if (!existsSync("app/analyse/rentabilite/page.tsx")) echec("la page Rentabilité n'est pas en place : installez d'abord maj-rentabilite.zip.");

const ecritures = [];
let tb = readFileSync(TABLEAU, "utf8").replace(/\r\n/g, "\n");
if (tb.includes(MARQUEUR)) console.log(`✓ ${TABLEAU} : déjà à jour`);
else {
  for (const [nom, debut, fin] of BLOCS) {
    if (compter(tb, debut) !== 1 || compter(tb, fin) !== 1) echec(`${TABLEAU} : ${nom} introuvable.`);
  }
  const APPEL = "<BlocBureauEtudes aller={aller} />";
  if (compter(tb, APPEL) !== 1) echec(`${TABLEAU} : affichage du bloc Bureau d'études introuvable.`);
  tb = tb.replace(APPEL, () => "<BlocBureauEtudes aller={aller} admin />");
  for (const [, debut, fin, nouveau] of BLOCS) {
    const i = tb.indexOf(debut);
    const j = tb.indexOf(fin, i);
    if (j < 0) echec(`${TABLEAU} : fin d'un bloc introuvable.`);
    tb = tb.slice(0, i) + nouveau + tb.slice(j);
  }
  ecritures.push([TABLEAU, tb, "tuiles rangées par axes"]);
}

let fi = readFileSync(FINANCES, "utf8").replace(/\r\n/g, "\n");
if (fi.includes(MARQUEUR)) console.log(`✓ ${FINANCES} : déjà à jour`);
else {
  if (compter(fi, DEBUT_RENTA) !== 1 || compter(fi, FIN_RENTA) !== 1) echec(`${FINANCES} : partie Rentabilité introuvable.`);
  const i = fi.indexOf(DEBUT_RENTA);
  const j = fi.indexOf(FIN_RENTA, i);
  if (j < 0) echec(`${FINANCES} : fin de la partie Rentabilité introuvable.`);
  fi = fi.slice(0, i) + LIEN_RENTA + fi.slice(j);
  ecritures.push([FINANCES, fi, "partie Rentabilité remplacée par un lien"]);
}

for (const [f, t, quoi] of ecritures) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : ${quoi}`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
