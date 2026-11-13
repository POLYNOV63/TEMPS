/* ===============================================================
   PERSONNES INACTIVES : GARDER LEUR PASSÉ VISIBLE (INACTIFS_VISIBLES)

   Une fiche désactivée ne disparaît plus des affichages :
   - lib/pilotageCalculs.ts : une personne porte « actif » ;
   - relevé PE / PI : ses lignes gardent son nom ; elle n'est plus
     proposée dans les listes de choix ;
   - planning des affaires : ses affectations passées gardent son nom ;
     elle n'est plus proposée (affecter, panneau des ressources, « Voir
     une personne ») ;
   - planning ressources : elle va dans une zone « Personnes inactives »,
     en bas, tant qu'elle a des affectations sur la période affichée.
   À lancer APRÈS le SQL 99.
   Tout ou rien, relançable.
================================================================ */

import fs from "node:fs";
import path from "node:path";

const racine = process.cwd();
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



function remplacerTous(fichier, cherche, remplace, attendu, libelle) {
  const n = fichier.texte.split(cherche).length - 1;
  if (n !== attendu) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : ${attendu} fois).`);
    return;
  }
  fichier.texte = fichier.texte.split(cherche).join(remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

/* 0. Le chargement de l'annuaire */
const donnees = lire("lib/pilotageDonnees.ts");
if (donnees && donnees.texte.includes("INACTIFS_VISIBLES")) console.log("  = lib/pilotageDonnees.ts : déjà à jour");
else if (donnees) {
  remplacerSouple(donnees, "export async function chargerAnnuaire(): Promise<Collab[]> { const { data, error } = await supabase.rpc(\"pilotage_annuaire\");", "/* INACTIFS_VISIBLES : { inactifs: true } renvoie aussi les fiches désactivées (actif = false), pour afficher leur passé ;\n   sans option, seulement les personnes actives (listes de choix) */\nexport async function chargerAnnuaire(options: { inactifs?: boolean } = {}): Promise<Collab[]> {\n  const { data, error } = options.inactifs ? await supabase.rpc(\"pilotage_annuaire\", { p_inactifs: true }) : await supabase.rpc(\"pilotage_annuaire\");", "annuaire : option « avec les inactifs »");
  ecritures.push(donnees);
}

/* 1. Le type d'une personne */
const calculs = lire("lib/pilotageCalculs.ts");
if (calculs && calculs.texte.includes("INACTIFS_VISIBLES")) console.log("  = lib/pilotageCalculs.ts : déjà à jour");
else if (calculs) {
  remplacerSouple(calculs, "date_sortie?: string | null; // RESSOURCE_SORTIE : dernier jour travaillé (SQL 89)", "date_sortie?: string | null; // RESSOURCE_SORTIE : dernier jour travaillé (SQL 89)\n  actif?: boolean; // INACTIFS_VISIBLES : false pour une fiche désactivée (annuaire avec les inactifs, SQL 99)", "type : personne active ou non");
  ecritures.push(calculs);
}

/* 2. Relevé PE / PI */
const releve = erreurs.length ? null : lire("app/pilotage/prestations/page.tsx");
if (releve && releve.texte.includes("INACTIFS_VISIBLES")) console.log("  = app/pilotage/prestations/page.tsx : déjà à jour");
else if (releve) {
  remplacerSouple(releve, "const [annuaire, setAnnuaire] = useState<Collab[]>([]);", "const [annuaire, setAnnuaire] = useState<Collab[]>([]);\n  // INACTIFS_VISIBLES : toutes les personnes, inactives comprises, pour afficher les noms ; « annuaire » sert aux choix\n  const [annuaireTous, setAnnuaireTous] = useState<Collab[]>([]);", "relevé : liste complète des personnes");
  remplacerSouple(releve, "chargerAnnuaire(),", "chargerAnnuaire({ inactifs: true }),", "relevé : charger aussi les inactifs");
  remplacerSouple(releve, "setAnnuaire(an);", "setAnnuaire(an.filter((c) => c.actif !== false));\n        setAnnuaireTous(an);", "relevé : les choix sans les inactifs");
  remplacerSouple(releve, "const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);", "const collabs = useMemo(() => new Map((annuaireTous.length ? annuaireTous : annuaire).map((c) => [c.id, c])), [annuaire, annuaireTous]);", "relevé : les noms des inactifs");
  ecritures.push(releve);
}

/* 3. Planning des affaires */
const planning = erreurs.length ? null : lire("app/pilotage/affaires/page.tsx");
if (planning && planning.texte.includes("INACTIFS_VISIBLES")) console.log("  = app/pilotage/affaires/page.tsx : déjà à jour");
else if (planning) {
  remplacerSouple(planning, "chargerAnnuaire(),", "chargerAnnuaire({ inactifs: true }),", "planning : charger aussi les inactifs");
  remplacerSouple(planning, "const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);", "const affairesParId = useMemo(() => new Map(affaires.map((a) => [a.id, a])), [affaires]);\n  // INACTIFS_VISIBLES : les noms des inactifs restent affichés ; les choix ne proposent que les personnes actives\n  const annuaireActif = useMemo(() => annuaire.filter((c) => c.actif !== false), [annuaire]);", "planning : personnes actives");
  remplacerSouple(planning, "<option value=\"\">Voir une personne…</option> {annuaire.map((c) => (", "<option value=\"\">Voir une personne…</option>\n                    {annuaireActif.map((c) => (", "planning : « Voir une personne » sans les inactifs");
  remplacerSouple(planning, "return annuaire .filter((c) => c.inclus_statistiques)", "return annuaireActif\n      .filter((c) => c.inclus_statistiques)", "planning : panneau des ressources sans les inactifs");
  remplacerSouple(planning, "}, [annuaire, nbSemaines, lundi, capacites, joursAffectes, chezLeClient, aujourdhui]);", "}, [annuaireActif, nbSemaines, lundi, capacites, joursAffectes, chezLeClient, aujourdhui]);", "planning : dépendances du panneau");
  remplacerTous(planning, "annuaire={annuaire}", "annuaire={annuaireActif}", 3, "planning : fenêtres d’affectation sans les inactifs");
  ecritures.push(planning);
}

/* 4. Planning ressources */
const ressources = erreurs.length ? null : lire("app/pilotage/planning-ressources/page.tsx");
if (ressources && ressources.texte.includes("INACTIFS_VISIBLES")) console.log("  = app/pilotage/planning-ressources/page.tsx : déjà à jour");
else if (ressources) {
  remplacerSouple(ressources, "Promise.all([chargerAnnuaire(), chargerAffaires({ horsPlanning: true }),", "Promise.all([chargerAnnuaire({ inactifs: true }), chargerAffaires({ horsPlanning: true }),", "ressources : charger aussi les inactifs");
  remplacerSouple(ressources, ".filter((c) => avecEncadrement || c.inclus_statistiques !== false)", "// INACTIFS_VISIBLES : une personne inactive n'apparaît que si elle a des affectations sur la période\n      .filter((c) => c.actif !== false || parPersonne.has(c.id))\n      .filter((c) => avecEncadrement || c.inclus_statistiques !== false || c.actif === false)", "ressources : les inactifs qui ont des affectations");
  remplacerSouple(ressources, "const g = predo.size > 0 ? predo.get(c.id) ?? { nom: \"Sans prédominance\", ordre: 9999 } : { nom: \"\", ordre: 0 };", "const g =\n          c.actif === false\n            ? { nom: \"Personnes inactives\", ordre: 99999 }\n            : predo.size > 0\n              ? predo.get(c.id) ?? { nom: \"Sans prédominance\", ordre: 9999 }\n              : { nom: \"\", ordre: 0 };", "ressources : zone « Personnes inactives » en bas");
  remplacerSouple(ressources, "opacity: l.collab.date_sortie && l.collab.date_sortie < aujourdhui ? 0.5 : 1 /* RESSOURCE_SORTIE */", "opacity: l.collab.actif === false || (l.collab.date_sortie && l.collab.date_sortie < aujourdhui) ? 0.5 : 1 /* RESSOURCE_SORTIE */", "ressources : inactifs estompés");
  ecritures.push(ressources);
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
