/* ===============================================================
   MAJ SUIVI DES DEVIS (SUIVI_DEVIS)

   À lancer à la racine du projet, APRÈS avoir décompressé le ZIP :
       node outils/maj-suivi-devis.mjs

   - lib/droits.ts : nouveau droit « suiviDevis » (ADMIN, RESPONSABLE,
     DIRECTION) pour ouvrir la page Suivi des devis.
   - components/pilotage/OngletsPilotage.tsx : « Suivi des devis » juste
     après « Suivi des affaires » ; « Indicateurs » retiré.
   - app/pilotage/page.tsx (Suivi des affaires) : le filtre DBE est retiré,
     les devis n'y sont plus en alerte (ils se gèrent dans le Suivi des devis),
     plus de couleur « Devis envoyé ».
   - app/pilotage/prestations/page.tsx (Relevé PE / PI) : l'encadré des
     reports est replié par défaut (REPORTS_REPLIES).
   - app/ma-semaine/MaSemaineContent.tsx : « Enregistrer le brouillon » et
     « Envoyer aux RH » au lieu de « Enregistrer » et « Valider ».
   - app/admin/bilan-rh/page.tsx : « Marquer comme envoyé aux RH », et
     ouverture sur un mois (?mois=2026-11).
   - app/admin/suivi-rh/page.tsx : colonnes RE+, RE− et HS payées ; les CP
     comptés sur leur période légale (1er juin → 31 mai) et non sur l'exercice.
   - app/ma-feuille-de-route/page.tsx : les relances de devis prévues pour
     la personne (encart « Devis à relancer » et jour de la relance).
     Bouton « ✓ faite » sur chaque relance (RELANCE_FAITE_FDR).
   - components/EnTetePage.tsx : bandeau RH ou Exports dans l'en-tête des
     pages RH et Exports (ONGLETS_SECTION).

   Tout ou rien : tout est vérifié avant d'écrire quoi que ce soit.
   Relançable sans risque : ce qui est déjà fait est sauté.
================================================================ */

import fs from "node:fs";
import path from "node:path";

const racine = process.cwd();
const MARQUEUR = "SUIVI_DEVIS";
const erreurs = [];
const ecritures = [];

function echec(message) {
  erreurs.push(message);
}

function lire(rel) {
  const p = path.join(racine, rel);
  if (!fs.existsSync(p)) {
    echec(`Fichier introuvable : ${rel}`);
    return null;
  }
  const brut = fs.readFileSync(p, "utf8");
  return { p, rel, crlf: brut.includes("\r\n"), texte: brut.replace(/\r\n/g, "\n") };
}

function remplacer(fichier, cherche, remplace, libelle) {
  const n = fichier.texte.split(cherche).length - 1;
  if (n !== 1) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : 1 fois).`);
    return;
  }
  fichier.texte = fichier.texte.replace(cherche, () => remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

function remplacerRe(fichier, re, remplace, libelle) {
  const n = (fichier.texte.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? []).length;
  if (n !== 1) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : 1 fois).`);
    return;
  }
  fichier.texte = fichier.texte.replace(re, remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

/* passage cherché mot à mot, les espaces et retours à la ligne pouvant varier */
function remplacerSouple(fichier, cherche, remplace, libelle) {
  const motif = cherche.trim().split(/\s+/).map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  remplacerRe(fichier, new RegExp(motif), () => remplace, libelle);
}

/* 0. Bon dossier, ZIP bien décompressé */
if (!fs.existsSync(path.join(racine, "package.json")) || !fs.existsSync(path.join(racine, "app"))) {
  console.error("✗ Lancez ce script à la racine du projet (le dossier qui contient package.json).");
  process.exit(1);
}
for (const rel of [
  "lib/suiviDevis.ts",
  "components/pilotage/devis/ListeDevis.tsx",
  "components/pilotage/devis/StatistiquesDevis.tsx",
  "app/pilotage/devis/page.tsx",
  "supabase/91_suivi_devis_relances.sql",
  "supabase/92_suivi_devis_relances_prevues.sql",
  "components/pilotage/RelanceFaite.tsx",
  "components/dashboard/VignetteFacturation.tsx",
  "components/analyse/GraphiquesDisponibilites.tsx",
  "lib/disponibilitesActivites.ts",
  "components/OngletsSection.tsx",
  "supabase/93_suivi_devis_relances_historique.sql",
  "supabase/94_notifications_relances.sql",
  "supabase/95_bilan_rh_envoye.sql",
  "lib/clotureMensuelle.ts",
  "components/rh/BilanRHEnvoi.tsx",
]) {
  if (!fs.existsSync(path.join(racine, rel))) echec(`Fichier du ZIP absent : ${rel} (le ZIP a-t-il bien été décompressé à la racine du projet ?)`);
}
const redirection = lire("app/pilotage/indicateurs/page.tsx");
if (redirection && !redirection.texte.includes(MARQUEUR)) {
  echec("app/pilotage/indicateurs/page.tsx n'est pas la nouvelle redirection : décompressez le ZIP en acceptant de remplacer les fichiers.");
}

console.log("Vérifications…");

/* 1. lib/droits.ts */
const droits = lire("lib/droits.ts");
if (droits) {
  if (droits.texte.includes("suiviDevis:")) {
    console.log("  = lib/droits.ts : déjà à jour");
  } else {
    remplacer(
      droits,
      'const DROITS_DIRECTION: ReadonlySet<string> = new Set(["voirPlanning", "chargeRessources", "indicateurs"]);',
      'const DROITS_DIRECTION: ReadonlySet<string> = new Set(["voirPlanning", "chargeRessources", "indicateurs", "suiviDevis"]); // SUIVI_DEVIS',
      "la Direction ouvre le Suivi des devis (onglet Statistiques)"
    );
    remplacer(
      droits,
      "  indicateurs: 2, // indicateurs et finances\n",
      "  indicateurs: 2, // indicateurs et finances\n  suiviDevis: 1, // SUIVI_DEVIS : page Suivi des devis (liste : ADMIN, RESPONSABLE ; statistiques : ADMIN, DIRECTION)\n",
      "nouveau droit suiviDevis"
    );
    ecritures.push(droits);
  }
}

/* 2. components/pilotage/OngletsPilotage.tsx */
const onglets = lire("components/pilotage/OngletsPilotage.tsx");
if (onglets) {
  if (onglets.texte.includes('cle: "devis"')) {
    console.log("  = components/pilotage/OngletsPilotage.tsx : déjà à jour");
  } else {
    const ligneAffaires =
      '  { cle: "portefeuille", groupe: 1, court: "Suivi des affaires", libelle: "Suivi des affaires", href: "/pilotage", droit: "voirPlanning" },\n';
    remplacer(
      onglets,
      ligneAffaires,
      ligneAffaires +
        '  { cle: "devis", groupe: 1, court: "Suivi des devis", libelle: "Suivi des devis", href: "/pilotage/devis", droit: "suiviDevis" }, // SUIVI_DEVIS\n',
      "onglet « Suivi des devis » après « Suivi des affaires »"
    );
    remplacer(
      onglets,
      '  { cle: "indicateurs", groupe: 2, court: "Indicateurs", libelle: "Indicateurs commerciaux", href: "/pilotage/indicateurs", droit: "indicateurs" },\n',
      "",
      "onglet « Indicateurs » retiré"
    );
    ecritures.push(onglets);
  }
}


/* 3. app/pilotage/page.tsx : Suivi des affaires sans le filtre DBE */
const affaires = lire("app/pilotage/page.tsx");
if (affaires) {
  if (affaires.texte.includes("DEVIS_HORS_SUIVI_AFFAIRES")) {
    console.log("  = app/pilotage/page.tsx : déjà à jour");
  } else {
    remplacerRe(affaires, /\n[ \t]*\["DBE", "DBE"\],[ \t]*(?=\n)/, "", "bouton de filtre « DBE » retiré");
    remplacerRe(
      affaires,
      /(\/\/ seulement les affaires actives : une affaire livrée ou abandonnée n'alerte plus\n[ \t]*)const actives = lignes\.filter\(\(l\) => l\.affaire\.statut === "EN_COURS" \|\| l\.affaire\.statut === "EN_ATTENTE"\);/,
      '$1// DEVIS_HORS_SUIVI_AFFAIRES : les devis (DBE) se gèrent dans le Suivi des devis\n    const actives = lignes.filter((l) => l.affaire.type === "CBE" && (l.affaire.statut === "EN_COURS" || l.affaire.statut === "EN_ATTENTE"));',
      "plus d'alertes sur les devis"
    );
    remplacerRe(affaires, /Affaires DBE et CBE : heures chiffrées/, "Affaires CBE (forfaits, PE / PI ; les devis se gèrent dans le Suivi des devis) : heures chiffrées", "sous-titre");
    ecritures.push(affaires);
  }
}

/* 3 bis. app/pilotage/page.tsx : plus de couleur « Devis envoyé » (les devis sont dans le Suivi des devis) */
if (affaires && !erreurs.length) {
  if (!/"Devis envoyé": \{ background: "#d6e6fb"/.test(affaires.texte)) {
    console.log("  = app/pilotage/page.tsx : couleur « Devis envoyé » déjà retirée");
  } else {
    remplacerRe(
      affaires,
      /\n[ \t]*"Devis envoyé": \{ background: "#d6e6fb", borderRadius: 3, padding: "0 3px" \},[ \t]*(?=\n)/,
      "",
      "couleur « Devis envoyé » retirée (SURLIGNE_SANS_DEVIS)"
    );
    if (!ecritures.includes(affaires)) ecritures.push(affaires);
  }
}

/* 3 ter. app/pilotage/prestations/page.tsx : l'encadré des reports est replié par défaut (REPORTS_REPLIES) */
const releve = lire("app/pilotage/prestations/page.tsx");
if (releve && !erreurs.length) {
  if (releve.texte.includes("REPORTS_REPLIES")) {
    console.log("  = app/pilotage/prestations/page.tsx : reports déjà repliés");
  } else {
    remplacerRe(
      releve,
      /<details open style=\{\{ \.\.\.page\.carte, padding: "10px 14px", marginBottom: 10, borderLeft: "5px solid #7a3e00" \}\}>/,
      '<details style={{ ...page.carte, padding: "10px 14px", marginBottom: 10, borderLeft: "5px solid #7a3e00" }} /* REPORTS_REPLIES : replié par défaut */>',
      "reports repliés par défaut"
    );
    ecritures.push(releve);
  }
}

/* 3 quater. app/ma-semaine/MaSemaineContent.tsx : « Enregistrer le brouillon » et « Envoyer aux RH » (ENVOI_RH_LIBELLES) */
const semaineF = lire("app/ma-semaine/MaSemaineContent.tsx");
if (semaineF && !erreurs.length) {
  if (semaineF.texte.includes("📤 Envoyer aux RH")) {
    console.log("  = app/ma-semaine/MaSemaineContent.tsx : libellés déjà à jour");
  } else {
    const libelles = [
      [/: "💾 Enregistrer"\}/, ': "💾 Enregistrer le brouillon"}', "bouton « Enregistrer le brouillon »"],
      [/\? "✓ Semaine validée"(\s*): "✓ Valider ma semaine"/, '? "✓ Envoyée aux RH"$1: "📤 Envoyer aux RH"', "bouton « Envoyer aux RH »"],
      [/<strong>Enregistrer<\/strong> garde votre saisie en brouillon\./, "<strong>Enregistrer le brouillon</strong> garde votre saisie, que vous pouvez encore modifier.", "explication du brouillon"],
      [/<strong>Valider ma semaine<\/strong> contrôle chaque journée puis transmet la feuille à POLYNOV\./, "<strong>Envoyer aux RH</strong> contrôle chaque journée puis transmet la feuille aux RH.", "explication de l’envoi"],
      [/la validation est définitive et verrouille la semaine pour le collaborateur\./, "l’envoi est définitif : la semaine n’est ensuite plus modifiable.", "avertissement"],
      [/Valider définitivement la semaine \?/, "Envoyer la semaine aux RH ?", "titre de la confirmation"],
      [/<strong>Attention : cette validation est définitive\.<\/strong>/, "<strong>Attention : l’envoi est définitif.</strong>", "confirmation, avertissement"],
      [/Après validation, vous ne pourrez plus modifier cette semaine\./, "Après l’envoi, vous ne pourrez plus modifier cette semaine.", "confirmation, texte"],
      [/🔒 Valider définitivement/, "📤 Envoyer aux RH", "confirmation, bouton"],
      [/"✓ Semaine validée — transmise"/, '"✓ Envoyée aux RH"', "état de la semaine"],
      [/"✓ validée, transmise"/, '"✓ envoyée aux RH"', "état de la semaine (téléphone)"],
      [/validée et transmise à POLYNOV\./, "envoyée aux RH.", "message après l’envoi"],
      [/<strong>La validation est définitive\.<\/strong>/, "<strong>L’envoi aux RH est définitif.</strong>", "encart d’avertissement"],
      [/Une fois votre semaine validée, vous ne pourrez plus la modifier\./, "Une fois votre semaine envoyée, vous ne pourrez plus la modifier.", "encart d’avertissement, texte"],
      [/Cette semaine est <strong>validée<\/strong>\./, "Cette semaine est <strong>envoyée aux RH</strong>.", "message de semaine envoyée"],
    ];
    for (const [re, rempl, lib] of libelles) remplacerRe(semaineF, re, rempl, lib);
    ecritures.push(semaineF);
  }
  /* CORRECTION_ADMIN : l'ADMIN qui modifie la feuille d'un autre enregistre une correction (la feuille garde son état) */
  if (!erreurs.length && !semaineF.texte.includes("💾 Enregistrer la correction")) {
    remplacerRe(semaineF, /: "💾 Enregistrer le brouillon"\}/, ': modeAdmin ? "💾 Enregistrer la correction" : "💾 Enregistrer le brouillon"}', "bouton « Enregistrer la correction » pour l’ADMIN");
    if (!ecritures.includes(semaineF)) ecritures.push(semaineF);
  }
}

/* 3 quinquies. app/admin/bilan-rh/page.tsx : « Marquer comme envoyé aux RH », ouverture sur un mois (?mois=) (BILAN_RH_RAPPEL) */
const bilanRH = lire("app/admin/bilan-rh/page.tsx");
if (bilanRH && !erreurs.length) {
  if (bilanRH.texte.includes("BILAN_RH_RAPPEL")) {
    console.log("  = app/admin/bilan-rh/page.tsx : déjà à jour");
  } else {
    remplacerRe(
      bilanRH,
      /(import \{ peut \} from "@\/lib\/droits";\n)/,
      '$1import { BoutonBilanEnvoye } from "@/components/rh/BilanRHEnvoi"; // BILAN_RH_RAPPEL\n',
      "import du bouton « envoyé aux RH »"
    );
    remplacerRe(
      bilanRH,
      /const \[periodeIndex, setPeriodeIndex\] = useState\(0\);/,
      'const [periodeIndex, setPeriodeIndex] = useState(() => {\n    // BILAN_RH_RAPPEL : ouvert sur un mois précis (?mois=2026-11)\n    const m = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mois") : null;\n    const i = m ? periodes.findIndex((p) => `${p.annee}-${String(p.moisZeroBase + 1).padStart(2, "0")}` === m.slice(0, 7)) : -1;\n    return i >= 0 ? i : 0;\n  });',
      "ouverture sur le mois demandé"
    );
    remplacerRe(
      bilanRH,
      /(\{exportation \? "Export en cours…" : "📊 Exporter Excel"\}\n([ \t]*)<\/button>)/,
      "$1\n$2{periode && <BoutonBilanEnvoye annee={periode.annee} moisZeroBase={periode.moisZeroBase} />}",
      "bouton « Marquer comme envoyé aux RH »"
    );
    ecritures.push(bilanRH);
  }
}

/* 3 sexies. app/admin/suivi-rh/page.tsx : RE+ / RE− / HS payées, CP sur leur période légale (CP_PERIODE_LEGALE) */
const suiviRH = lire("app/admin/suivi-rh/page.tsx");
if (suiviRH && !erreurs.length) {
  if (suiviRH.texte.includes("CP_PERIODE_LEGALE")) {
    console.log("  = app/admin/suivi-rh/page.tsx : déjà à jour");
  } else {
    remplacerSouple(suiviRH, ".gte(\"date_debut\", debutEx).lte(\"date_debut\", finEx)", ".gte(\"date_debut\", `${exercice - 1}-01-01`).lte(\"date_debut\", `${exercice + 2}-12-31`) /* CP_PERIODE_LEGALE : de quoi couvrir la période CP de chacun */", "demandes lues sur une période plus large");
    remplacerSouple(suiviRH, "const ds = demandes.filter((x) => x.collaborateur_id === c.id);", "const ds = demandes.filter((x) => x.collaborateur_id === c.id);\n        // CP_PERIODE_LEGALE : les CP se comptent sur leur période d'acquisition (1er juin → 31 mai par défaut, réglable dans les droits),\n        // les RTT sur l'exercice (novembre → octobre)\n        const cpDu = d?.cp_periode_debut ?? `${exercice}-06-01`;\n        const cpAu = d?.cp_periode_fin ?? `${exercice + 1}-05-31`;\n        const dansCP = (x: Demande) => x.date_debut >= cpDu && x.date_debut <= cpAu;\n        const dansEx = (x: Demande) => x.date_debut >= debutEx && x.date_debut <= finEx;", "période CP de chacun");
    remplacerSouple(suiviRH, "const cpPris = somme((x) => estCP(x.type_demande) && ACCORDEE.includes(x.statut));", "const cpPris = somme((x) => estCP(x.type_demande) && dansCP(x) && ACCORDEE.includes(x.statut));", "CP pris sur la période CP");
    remplacerSouple(suiviRH, "const cpAttente = somme((x) => estCP(x.type_demande) && x.statut === \"EN_ATTENTE\");", "const cpAttente = somme((x) => estCP(x.type_demande) && dansCP(x) && x.statut === \"EN_ATTENTE\");", "CP en attente sur la période CP");
    remplacerSouple(suiviRH, "const rttPris = somme((x) => x.type_demande === \"RTT\" && ACCORDEE.includes(x.statut));", "const rttPris = somme((x) => x.type_demande === \"RTT\" && dansEx(x) && ACCORDEE.includes(x.statut));", "RTT pris sur l'exercice");
    remplacerSouple(suiviRH, "const rttAttente = somme((x) => x.type_demande === \"RTT\" && x.statut === \"EN_ATTENTE\");", "const rttAttente = somme((x) => x.type_demande === \"RTT\" && dansEx(x) && x.statut === \"EN_ATTENTE\");", "RTT en attente sur l'exercice");
    remplacerSouple(suiviRH, "cpDroits, cpPris,", "cpDroits, cpDu, cpAu, cpPris,", "période CP gardée sur la ligne");
    remplacerSouple(suiviRH, "}, [collabs, droits, demandes, feuilles, regs, recherche, debutEx, finEx]);", "}, [collabs, droits, demandes, feuilles, regs, recherche, debutEx, finEx, exercice]);", "dépendances du calcul");
    remplacerSouple(suiviRH, "for (const x of demandes.filter((x) => x.collaborateur_id === id)) {", "const dr = droits.find((x) => x.collaborateur_id === id);\n      const cpDu = dr?.cp_periode_debut ?? `${exercice}-06-01`;\n      const cpAu = dr?.cp_periode_fin ?? `${exercice + 1}-05-31`;\n      for (const x of demandes.filter(\n        (x) => x.collaborateur_id === id && (estCP(x.type_demande) ? x.date_debut >= cpDu && x.date_debut <= cpAu : x.date_debut >= debutEx && x.date_debut <= finEx)\n      )) {", "historique : CP sur leur période");
    remplacerSouple(suiviRH, "[demandes, feuilles, regs, collabs, debutEx, finEx]", "[demandes, feuilles, regs, collabs, debutEx, finEx, droits, exercice]", "dépendances de l'historique");
    remplacerSouple(suiviRH, "hs ? `+${fmt(hs)} h sup au compteur` : \"\"", "hs ? `RE+ ${fmt(hs)} h (heures sup mises au compteur)` : \"\"", "historique : RE+");
    remplacerSouple(suiviRH, "re ? `−${fmt(re)} h de RE` : \"\"", "re ? `RE− ${fmt(re)} h` : \"\"", "historique : RE−");
    remplacerSouple(suiviRH, "Congés, RTT et compteur de récupération de chaque collaborateur sur l’exercice : soldes et historique des mouvements.", "Congés payés sur leur période légale d’acquisition (1er juin → 31 mai, réglable dans les droits de chacun) ; RTT, compteur de récupération et heures sup sur l’exercice (novembre → octobre).", "sous-titre");
    remplacerSouple(suiviRH, "<strong style={{ fontSize: 17 }}>Exercice {exercice}-{exercice + 1}</strong>", "<strong style={{ fontSize: 17, textAlign: \"center\" }}>Exercice {exercice}-{exercice + 1}<div style={{ fontSize: 12, fontWeight: 600, color: C.gris }}>CP : {libellePeriodeCP}</div></strong>", "période CP sous l'exercice");
    remplacerSouple(suiviRH, "const th: CSSProperties = { ...page.th, textAlign: \"right\", whiteSpace: \"nowrap\", padding: \"8px 6px\" };", "/* CP_PERIODE_LEGALE : la période CP affichée (celle de tous, sinon « période de chacun ») */\n  const moisAn = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(\"fr-FR\", { month: \"long\", year: \"numeric\" });\n  const periodesCP = [...new Set(lignes.map((l) => `${l.cpDu}|${l.cpAu}`))];\n  const libellePeriodeCP =\n    periodesCP.length === 1 ? `${moisAn(periodesCP[0].split(\"|\")[0])} → ${moisAn(periodesCP[0].split(\"|\")[1])}` : periodesCP.length === 0 ? `juin ${exercice} → mai ${exercice + 1}` : \"période de chacun\";\n  const th: CSSProperties = { ...page.th, textAlign: \"right\", whiteSpace: \"nowrap\", padding: \"8px 6px\" };", "libellé de la période CP");
    remplacerSouple(suiviRH, "<th style={{ ...th, ...sep, textAlign: \"center\" }} colSpan={4}>Congés payés (j)</th>", "<th style={{ ...th, ...sep, textAlign: \"center\" }} colSpan={4} title=\"Sur la période d’acquisition des CP (1er juin → 31 mai par défaut, réglable dans les droits de chacun)\">Congés payés (j) · {libellePeriodeCP}</th>", "en-tête CP");
    remplacerSouple(suiviRH, "<th style={{ ...th, ...sep, textAlign: \"center\" }} colSpan={5}>Compteur de récupération (h)</th>", "<th style={{ ...th, ...sep, textAlign: \"center\" }} colSpan={5}>Compteur de récupération (h)</th>\n                    <th style={{ ...th, ...sep, textAlign: \"center\" }} rowSpan={2} title=\"Heures sup payées sur l’exercice : la part que le collaborateur n’a pas mise au compteur, à la clôture du mois\">HS payées (h)</th>", "colonne HS payées");
    remplacerSouple(suiviRH, "<th style={th} title=\"Heures sup mises au compteur sur l’exercice\">+ HS</th>", "<th style={th} title=\"RE+ : heures sup mises au compteur sur l’exercice (choix du collaborateur à la clôture du mois)\">RE+</th>", "colonne RE+");
    remplacerSouple(suiviRH, "<th style={th} title=\"Récupérations prises sur l’exercice\">− RE</th>", "<th style={th} title=\"RE− : récupérations prises sur l’exercice\">RE−</th>", "colonne RE−");
    remplacerSouple(suiviRH, "{l.compteur > 30 && \" ⚠\"}\n</td>", "{l.compteur > 30 && \" ⚠\"}\n</td>\n<td style={{ ...td, ...sep, color: \"#5b6168\" }}>{l.hsPayees ? fmt(l.hsPayees) : \"—\"}</td>", "valeur HS payées");
    remplacerSouple(suiviRH, "<td colSpan={13}", "<td colSpan={14}", "largeur du détail");
    ecritures.push(suiviRH);
  }
}

/* 4. app/ma-feuille-de-route/page.tsx : les relances prévues */
const fdr = lire("app/ma-feuille-de-route/page.tsx");
if (fdr) {
  if (fdr.texte.includes("RELANCES_FDR")) {
    console.log("  = app/ma-feuille-de-route/page.tsx : déjà à jour");
  } else {
    remplacerRe(
      fdr,
      /(type Devis = \{ affaire_id: string; numero: string; designation: string \| null; date_debut: string \| null; echeance: string \| null \};\n)/,
      "$1\n/* RELANCES_FDR : relances de devis prévues pour la personne (Suivi des devis, SQL 92) */\ntype RelanceFdr = { id: string; numero_devis: string; prevue_le: string; commentaire: string | null; designation: string | null; client: string | null };\n",
      "type des relances"
    );
    remplacerRe(
      fdr,
      /(\n([ \t]*)const \[devis, setDevis\] = useState<Devis\[\]>\(\[\]\);\n)/,
      "$1$2const [relancesFdr, setRelancesFdr] = useState<RelanceFdr[]>([]); // RELANCES_FDR\n",
      "liste des relances"
    );
    remplacerRe(
      fdr,
      /(supabase\.rpc\("ma_feuille_de_route_devis", \{ p_collaborateur_id: cible \}\),\n)([ \t]*)\]\)\n([ \t]*)\.then\(\(\[r, c, d\]\) => \{/,
      '$1$2  supabase.rpc("ma_feuille_de_route_relances", { p_collaborateur_id: cible }),\n$2])\n$3.then(([r, c, d, rl]) => {',
      "chargement des relances"
    );
    remplacerRe(
      fdr,
      /(\n([ \t]*)setDevis\(d\.error \? \[\] : \(\(d\.data \?\? \[\]\) as Devis\[\]\)\);\n)/,
      "$1$2setRelancesFdr(rl.error ? [] : ((rl.data ?? []) as RelanceFdr[]));\n",
      "relances reçues"
    );
    remplacerRe(
      fdr,
      /(\n[ \t]*)return \{ debut, jours, lignes: lignesSemaine, congesJour, totalJour, total: totalJour\.reduce\(\(t, x\) => t \+ x, 0\), aRendre \};(\n[ \t]*\}\);\n[ \t]*\}, \[lignes, conges, activites, lundi, nbSemaines, devis)\]\);/,
      "$1// relances prévues cette semaine (ou déjà en retard, sur la semaine en cours)$1const aRelancer = relancesFdr.filter((r) => (r.prevue_le >= debut && r.prevue_le <= plus(debut, 6)) || (k === 0 && r.prevue_le < debut));$1return { debut, jours, lignes: lignesSemaine, congesJour, totalJour, total: totalJour.reduce((t, x) => t + x, 0), aRendre, aRelancer };$2, relancesFdr]);",
      "relances semaine par semaine"
    );
    remplacerRe(fdr, /s\.aRendre\.length === 0 \? \(/, "s.aRendre.length === 0 && s.aRelancer.length === 0 ? (", "semaine non vide s'il y a une relance");
    remplacerRe(
      fdr,
      /(\n([ \t]*))\{s\.congesJour\.some\(Boolean\) && \(/,
      `$1{s.aRelancer.map((r) => {
$2  const aujourd = iso(new Date());
$2  const retard = r.prevue_le < aujourd;
$2  const bleu = retard ? "#b3261e" : "#1f4e8c";
$2  return (
$2    <tr key={\`relance-\${r.id}\`} style={{ background: retard ? "#fdecec" : undefined }}>
$2      <td style={td}>
$2        <strong style={{ color: bleu }}>📞 Relancer DBE {r.numero_devis}</strong>
$2        <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: retard ? bleu : C.gris }}>{retard ? "relance en retard" : "relance client"}</span>
$2        <div style={{ fontSize: 13 }}>{[r.client, r.designation].filter(Boolean).join(" · ")}</div>
$2        {r.commentaire && <div style={{ fontSize: 12, color: C.gris }}>{r.commentaire}</div>}
$2      </td>
$2      {s.jours.map((j) => (
$2        <td key={j} style={{ ...tdJour, background: r.prevue_le === j ? (retard ? "#f7c6c6" : "#e3eefb") : undefined, color: bleu, fontWeight: 800 }}>
$2          {r.prevue_le === j ? "📞 relance" : retard && j === aujourd ? "⚠ à relancer" : ""}
$2        </td>
$2      ))}
$2      <td style={{ ...td, textAlign: "right", fontSize: 12, color: retard ? bleu : C.gris, fontWeight: retard ? 800 : 400, whiteSpace: "nowrap" }}>
$2        {retard ? \`prévue le \${dateCourte(r.prevue_le)}\` : ""}
$2      </td>
$2    </tr>
$2  );
$2})}$1{s.congesJour.some(Boolean) && (`,
      "relances dans le tableau de la semaine"
    );
    remplacerRe(
      fdr,
      /(\n([ \t]*))\{!chargement &&(\s*)!erreur &&(\s*)semaines\.map\(\(s, k\) => \(/,
      `$1{/* RELANCES_FDR : les devis à relancer */}$1{!chargement && !erreur && relancesFdr.length > 0 && (
$2  <section style={{ ...page.carte, padding: 14, marginBottom: 14, borderLeft: "5px solid #1f4e8c" }}>
$2    <strong style={{ fontSize: 17 }}>📞 Devis à relancer</strong>
$2    <span style={{ marginLeft: 8, fontSize: 13, color: C.gris }}>relances prévues dans le Suivi des devis</span>
$2    <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
$2      {relancesFdr.map((r) => {
$2        const jours = Math.round((new Date(\`\${r.prevue_le}T00:00:00\`).getTime() - new Date(\`\${iso(new Date())}T00:00:00\`).getTime()) / 86400000);
$2        return (
$2          <li key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
$2            <strong style={{ color: "#1f4e8c" }}>DBE {r.numero_devis}</strong>
$2            <span>{[r.client, r.designation].filter(Boolean).join(" · ")}</span>
$2            {r.commentaire && <span style={{ fontSize: 13, color: C.gris }}>« {r.commentaire} »</span>}
$2            <span style={{ marginLeft: "auto", fontWeight: 800, color: jours < 0 ? "#b3261e" : jours <= 3 ? "#c76500" : "#1b5e20" }}>
$2              {\`le \${dateCourte(r.prevue_le)}\${jours < 0 ? \` · en retard de \${-jours} j\` : jours === 0 ? " · aujourd’hui" : \` · dans \${jours} j\`}\`}
$2            </span>
$2          </li>
$2        );
$2      })}
$2    </ul>
$2  </section>
$2)}$1{!chargement &&$3!erreur &&$4semaines.map((s, k) => (`,
      "encart « Devis à relancer »"
    );
    ecritures.push(fdr);
  }
}

/* 4 bis. app/ma-feuille-de-route/page.tsx : « ✓ faite » sur chaque relance */
if (fdr && !erreurs.length) {
  if (fdr.texte.includes("RELANCE_FAITE_FDR")) {
    console.log("  = app/ma-feuille-de-route/page.tsx : « ✓ faite » déjà là");
  } else {
    remplacerRe(
      fdr,
      /(import OngletsPilotage from "@\/components\/pilotage\/OngletsPilotage";\n)/,
      '$1import RelanceFaite from "@/components/pilotage/RelanceFaite"; // RELANCE_FAITE_FDR\n',
      "import du bouton « ✓ faite »"
    );
    remplacerRe(
      fdr,
      /(`le \$\{dateCourte\(r\.prevue_le\)\}[^\n]*\n([ \t]*)<\/span>)/,
      "$1\n$2<RelanceFaite numero={r.numero_devis} relanceId={r.id} onFait={() => setRelancesFdr((l) => l.filter((x) => x.id !== r.id))} />",
      "bouton « ✓ faite » sur chaque relance"
    );
    if (!ecritures.includes(fdr)) ecritures.push(fdr);
  }
  /* RELANCES_HISTORIQUE : « ✓ faite » vise la relance précise (pas de doublon) */
  if (!fdr.texte.includes("relanceId={r.id}")) {
    remplacerRe(fdr, /<RelanceFaite numero=\{r\.numero_devis\} onFait=/, "<RelanceFaite numero={r.numero_devis} relanceId={r.id} onFait=", "« ✓ faite » sur la relance précise");
    if (!ecritures.includes(fdr)) ecritures.push(fdr);
  }
}

/* 4 ter. components/EnTetePage.tsx : bandeaux RH et Exports */
const entete = lire("components/EnTetePage.tsx");
if (entete) {
  if (entete.texte.includes("ONGLETS_SECTION")) {
    console.log("  = components/EnTetePage.tsx : déjà à jour");
  } else {
    remplacerRe(
      entete,
      /(import \{ useRouter \} from "next\/navigation";\n)/,
      '$1import OngletsSection from "@/components/OngletsSection"; // ONGLETS_SECTION\n',
      "import du bandeau RH / Exports"
    );
    remplacerRe(entete, /\n([ \t]*)<\/header>/, "\n$1  <OngletsSection />\n$1</header>", "bandeau RH / Exports dans l'en-tête");
    ecritures.push(entete);
  }
}

/* 5. Aucune autre page ne doit encore se déclarer sur l'onglet « indicateurs » (il n'existe plus) */
function parcourir(dossier, liste = []) {
  const abs = path.join(racine, dossier);
  if (!fs.existsSync(abs)) return liste;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) parcourir(rel, liste);
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) liste.push(rel);
  }
  return liste;
}
for (const rel of [...parcourir("app"), ...parcourir("components")]) {
  const t = fs.readFileSync(path.join(racine, rel), "utf8");
  if (/actif=\{?["']indicateurs["']\}?/.test(t)) {
    echec(`${rel.replace(/\\/g, "/")} utilise encore l'onglet « indicateurs » (supprimé) : copiez ce message à Claude.`);
  }
}

/* 6. Tout ou rien */
if (erreurs.length > 0) {
  console.error("\n✗ RIEN N'A ÉTÉ MODIFIÉ. Problème(s) :");
  for (const e of erreurs) console.error(`  - ${e}`);
  console.error("\nCopiez ce message à Claude.");
  process.exit(1);
}

for (const f of ecritures) {
  fs.writeFileSync(f.p, f.crlf ? f.texte.replace(/\n/g, "\r\n") : f.texte, "utf8");
}

console.log(
  ecritures.length > 0
    ? `\n✓ Terminé : ${ecritures.length} fichier(s) mis à jour. Étape suivante : npm run build`
    : "\n✓ Rien à faire : tout était déjà à jour. Étape suivante : npm run build"
);
