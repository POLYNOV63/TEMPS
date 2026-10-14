#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Ma semaine : EN-TETE COMPACT (ordinateur) - version 2

   Sur ordinateur, le titre, la carte de la semaine, la ligne du week-end, les
   quatre grandes cartes de totaux ET la barre « Reprendre les affaires / Aide »
   (jusqu'à 700 px avant la saisie) sont réunis dans UNE seule carte : semaine,
   totaux, week-end, puis « Reprendre / Aide » juste dessous. Le détail des
   heures supplémentaires et du compteur est dans des pastilles « i ».
   Le téléphone garde l'affichage d'origine.

   Prérequis : la grille est installée (patch-ma-semaine-grille.mjs, version 5)
   et app/ma-semaine/EnteteSemaineCompact.tsx est présent.

   Fichiers modifiés : MaSemaineContent.tsx et AssistantSaisie.tsx.
   Utilisation, depuis la racine du projet :
       node scripts/patch-ma-semaine-compact.mjs

   Tout ou rien : si une pièce a changé, rien n'est modifié.
   Sauvegardes : *.bak-compact. Sans effet si relancé. Met à jour la version 1.
   A relancer après tout nouveau passage du script de la grille.
=============================================================== */

import fs from "node:fs";
import path from "node:path";

const dossier = path.resolve(process.argv[2] ?? "app/ma-semaine");
const contenu = path.join(dossier, "MaSemaineContent.tsx");
const assistant = path.join(dossier, "AssistantSaisie.tsx");

for (const f of [contenu, assistant, path.join(dossier, "EnteteSemaineCompact.tsx")]) {
  if (!fs.existsSync(f)) {
    console.error(`Fichier introuvable : ${f}\nLancez ce script depuis la racine du projet, après avoir copié EnteteSemaineCompact.tsx.`);
    process.exit(1);
  }
}

function lire(f) {
  const brut = fs.readFileSync(f, "utf8");
  return { crlf: brut.includes("\r\n"), texte: brut.replace(/\r\n/g, "\n") };
}

const c = lire(contenu);
const a = lire(assistant);
let source = c.texte;
let src2 = a.texte;

if (source.includes("MA_SEMAINE_COMPACT_V2") && src2.includes("integre = false")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

// Version 1 déjà installée : on repart du fichier d'origine sauvegardé.
let miseAJour = false;

if (source.includes("MA_SEMAINE_COMPACT_V1")) {
  const sauv = `${contenu}.bak-compact`;

  if (!fs.existsSync(sauv)) {
    console.error("La version 1 est installée mais la sauvegarde MaSemaineContent.tsx.bak-compact est introuvable.\nEnvoyez-moi ce message.");
    process.exit(1);
  }

  source = fs.readFileSync(sauv, "utf8").replace(/\r\n/g, "\n");
  miseAJour = true;
  console.log("Version 1 détectée : mise à jour vers la version 2 à partir du fichier d'origine.");
}

const echecs = [];

function unique(nom, marqueur, texte) {
  const premier = texte.indexOf(marqueur);
  const dernier = texte.lastIndexOf(marqueur);

  if (premier < 0 || premier !== dernier) {
    echecs.push(`${nom} : ${premier < 0 ? "introuvable" : "présent plusieurs fois"}`);
    return -1;
  }

  return premier;
}

const BANDE = "        {/* ====================================================\n";
const FIN_BANDE = "        ==================================================== */}\n";

/* ============ MaSemaineContent.tsx ============ */

/* 1) import du composant */
{
  const marque = 'import { BarreActionsMobile } from "./SaisieMobile";';
  if (unique("import de SaisieMobile", marque, source) >= 0) {
    source = source.replace(marque, `${marque}\nimport EnteteSemaineCompact from "./EnteteSemaineCompact";`);
  }
}

/* 2) introduction + navigation : gardées sur téléphone seulement */
{
  const debutMarque = `${BANDE}            INTRODUCTION\n${FIN_BANDE}`;
  const finMarque = `${BANDE}            COMPTEURS\n${FIN_BANDE}`;
  const i = unique("bloc INTRODUCTION", debutMarque, source);
  const j = unique("bloc COMPTEURS", finMarque, source);

  if (i >= 0 && j > i) {
    const ancien = source.slice(i, j);

    if (!ancien.includes("styles.intro") || !ancien.includes("styles.navigation")) {
      echecs.push("introduction / navigation : contenu inattendu");
    } else {
      source = `${source.slice(0, i)}        {estMobile && (\n          <>\n${ancien}          </>\n        )}\n\n${source.slice(j)}`;
    }
  } else if (i >= 0 && j >= 0) {
    echecs.push("les blocs INTRODUCTION et COMPTEURS sont dans un ordre inattendu");
  }
}

/* 3) la barre « Reprendre / Aide » entre dans la carte de l'en-tête compact */
{
  const debut = unique("élément BandeauSemaine", "        <BandeauSemaine\n", source);

  if (debut >= 0) {
    const finMarque = "\n        />\n";
    const f = source.indexOf(finMarque, debut);

    if (f < 0) {
      echecs.push("fin de l'élément BandeauSemaine : introuvable");
    } else {
      const fin = f + finMarque.length;
      const bloc = source.slice(debut, fin);

      if (!bloc.includes("onReprendre=") || !bloc.includes("onBasculerAide=")) {
        echecs.push("élément BandeauSemaine : contenu inattendu");
      } else {
        const interne = bloc
          .replace(/\n        \/>\n$/, "\n          integre={!estMobile}\n        />\n")
          .split("\n")
          .map((ligne) => (ligne ? `  ${ligne}` : ligne))
          .join("\n");

        const enveloppe = `        {/* MA_SEMAINE_COMPACT_V2 : en-tête compact sur ordinateur (totaux, week-end, « Reprendre / Aide » dans une seule carte ; détail des totaux dans les « i ») ; le téléphone garde l'affichage d'origine */}
        <EnteteSemaineCompact
          actif={!estMobile}
          debut={semaine[0].date}
          fin={semaine[6].date}
          saisies={formatHeures(totalHeuresSemaine)}
          prevues={formatHeures(totalHeuresTheoriques)}
          heuresSup={formatHeures(heuresSupplementaires)}
          heuresSupPositives={heuresSupplementaires > 0.01}
          supMensuelles={totalHeuresSupMensuelles > 0.01 ? formatHeures(totalHeuresSupMensuelles) : null}
          cloture={Boolean(semaineEstClotureMensuelle)}
          libellePeriode={String(libellePeriodeMensuelle ?? "")}
          repartitionCompteur={repartitionCompteurMensuelle !== null ? formatHeures(repartitionCompteurMensuelle) : null}
          repartitionPayee={formatHeures(repartitionPayeeMensuelle ?? 0)}
          compteur={formatHeures(totalCompteurChoisi)}
          compteurAlerte={totalCompteurChoisi > 30.01 || totalCompteurChoisi < -30}
          compteurBase={formatHeures(compteurBaseSemaine)}
          recuperation={totalRE > 0.01 ? formatHeures(totalRE) : null}
          tickets={Number(totalTickets)}
          statutTexte={
            semaineModifiee
              ? "● Modifications non enregistrées"
              : semaineValidee
                ? "✓ Semaine validée — transmise"
                : semaineEnregistree
                  ? "✓ Brouillon enregistré"
                  : "○ Semaine non enregistrée"
          }
          statutStyle={
            semaineModifiee
              ? styles.unsavedStatus
              : semaineValidee
                ? styles.validatedStatus
                : semaineEnregistree
                  ? styles.savedStatus
                  : styles.notSavedStatus
          }
          weekendOuvert={weekendOuvert}
          onBasculerWeekend={() => setWeekendOuvert((valeur) => !valeur)}
          onPrecedente={semainePrecedente}
          onSuivante={semaineSuivante}
        >
${interne}        </EnteteSemaineCompact>
`;

        source = source.slice(0, debut) + enveloppe + source.slice(fin);
      }
    }
  }
}

/* 4) ligne du week-end : gardée sur téléphone (le bouton est dans la barre sur ordinateur) */
{
  const debutMarque =
    "        {/* GRILLE_SEMAINE_V5 : la saisie se fait en grille ; seul le week-end est à afficher à la demande */}\n";
  const finMarque = "\n        <fieldset\n";
  const i = unique("ligne du week-end (version 5 de la grille)", debutMarque, source);
  const j = unique("début du fieldset", finMarque, source);

  if (i >= 0 && j > i) {
    const ancien = source.slice(i, j);

    if (!ancien.includes("setWeekendOuvert")) {
      echecs.push("ligne du week-end : contenu inattendu");
    } else {
      source = `${source.slice(0, i)}        {estMobile && (\n          <>\n${ancien}          </>\n        )}\n${source.slice(j)}`;
    }
  }
}

/* 5) cartes de totaux : gardées sur téléphone ; les messages (consultation, validée, verrouillée) restent partout */
{
  const ouverture = "        <div style={styles.cards}>\n          {modeConsultationGestionnaire && (";

  if (unique("conteneur des cartes", ouverture, source) >= 0) {
    source = source.replace(
      ouverture,
      '        <div style={estMobile ? styles.cards : { ...styles.cards, display: "block", marginBottom: 0 }}>\n          {modeConsultationGestionnaire && ('
    );
  }

  const debutMarque = "          {/* HEURES SAISIES */}\n";
  const finMarque = `        </div>\n\n${BANDE}            ACTIONS`;
  const i = unique("carte HEURES SAISIES", debutMarque, source);
  const j = unique("fin des cartes (avant ACTIONS)", finMarque, source);

  if (i >= 0 && j > i) {
    const ancien = source.slice(i, j);

    if (!ancien.includes("TICKETS RESTAURANT")) {
      echecs.push("cartes de totaux : contenu inattendu");
    } else {
      source = `${source.slice(0, i)}          {estMobile && (\n            <>\n${ancien}            </>\n          )}\n${source.slice(j)}`;
    }
  }
}

/* ============ AssistantSaisie.tsx : le bandeau peut être « intégré » (sans cadre propre) ============ */

if (!src2.includes("integre = false")) {
  const remplacements = [
    ["paramètre sansPuces", "  sansPuces = false,\n}: {", "  sansPuces = false,\n  integre = false,\n}: {"],
    [
      "type sansPuces",
      "  sansPuces?: boolean;\n}) {",
      "  sansPuces?: boolean;\n  /* Dans l'en-tête compact : sans cadre propre (il est déjà dans la carte) */\n  integre?: boolean;\n}) {",
    ],
    [
      "style du bandeau",
      '<div style={{ ...styles.bandeau, ...(collant ? {} : { position: "static" as const }) }}>',
      '<div style={{ ...styles.bandeau, ...(collant ? {} : { position: "static" as const }), ...(integre ? styles.bandeauIntegre : {}) }}>',
    ],
    [
      "styles du bandeau",
      '  ligne: {\n    display: "flex",\n    justifyContent: "space-between",',
      '  bandeauIntegre: {\n    position: "static",\n    background: "transparent",\n    border: "none",\n    boxShadow: "none",\n    borderRadius: 0,\n    padding: 0,\n    margin: 0,\n  },\n\n  ligne: {\n    display: "flex",\n    justifyContent: "space-between",',
    ],
  ];

  for (const [nom, ancien, nouveau] of remplacements) {
    if (unique(`AssistantSaisie : ${nom}`, ancien, src2) >= 0) src2 = src2.replace(ancien, nouveau);
  }
}

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines pièces n'ont pas pu être repérées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nUn fichier a probablement évolué. Envoyez-moi ce résultat.");
  process.exit(1);
}

const attendus = [
  [source, "<EnteteSemaineCompact", 1], // balise ouvrante
  [source, "</EnteteSemaineCompact>", 1], // balise fermante
  [source, "MA_SEMAINE_COMPACT_V2", 1],
  [source, "integre={!estMobile}", 1],
  [src2, "integre = false", 1],
  [src2, "styles.bandeauIntegre", 1],
];

for (const [texte, motif, n] of attendus) {
  const trouves = texte.split(motif).length - 1;

  if (trouves !== n) {
    console.error(`Contrôle final : « ${motif} » trouvé ${trouves} fois au lieu de ${n}. Aucune modification n'a été faite.`);
    process.exit(1);
  }
}

if (!miseAJour) fs.copyFileSync(contenu, `${contenu}.bak-compact`);
if (!fs.existsSync(`${assistant}.bak-compact`)) fs.copyFileSync(assistant, `${assistant}.bak-compact`);

fs.writeFileSync(contenu, c.crlf ? source.replace(/\n/g, "\r\n") : source, "utf8");
fs.writeFileSync(assistant, a.crlf ? src2.replace(/\n/g, "\r\n") : src2, "utf8");

console.log(miseAJour ? "En-tête compact mis à jour (version 2)." : "En-tête compact installé (version 2) : tout dans une seule carte sur ordinateur.");
console.log("Le téléphone est inchangé. Sauvegardes : *.bak-compact. Lancez « npx tsc --noEmit » puis « npm run dev ».");
