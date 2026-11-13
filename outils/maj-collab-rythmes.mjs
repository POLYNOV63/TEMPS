/* ===============================================================
   RYTHMES HORAIRES : SUPPRESSION · COLLABORATEURS : RECHERCHE

   - app/admin/profils-horaires/page.tsx : bouton « Supprimer » sur
     chaque rythme ; refusé (avec l'explication) si une fiche l'utilise
     ou s'il figure dans l'historique des rythmes (RYTHMES_SUPPRESSION) ;
   - app/admin/collaborateurs/page.tsx : moteur de recherche par
     trigramme, prénom, nom ou e-mail, sur l'équipe, les inactifs et les
     accès Direction (COLLAB_RECHERCHE).
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


const rythmes = lire("app/admin/profils-horaires/page.tsx");
if (rythmes && rythmes.texte.includes("RYTHMES_SUPPRESSION")) console.log("  = app/admin/profils-horaires/page.tsx : déjà à jour");
else if (rythmes) {
  remplacerSouple(rythmes, "const statistiques = useMemo(() => {", "/* RYTHMES_SUPPRESSION : supprimer un rythme qui ne sert à personne (ni fiche, ni historique des rythmes) */\n  async function supprimerProfil(profil: Profil) {\n    setErreur(\"\");\n    setMessage(\"\");\n    const [fiches, histo] = await Promise.all([\n      supabase.from(\"collaborateurs\").select(\"id\", { count: \"exact\", head: true }).eq(\"profil_horaire_id\", profil.id),\n      supabase.from(\"historique_profils_horaires\").select(\"id\", { count: \"exact\", head: true }).eq(\"profil_horaire_id\", profil.id),\n    ]);\n    if (fiches.error || histo.error) {\n      setErreur(messageErreur(fiches.error ?? histo.error, \"Impossible de vérifier si le rythme est utilisé.\"));\n      return;\n    }\n    const nbFiches = fiches.count ?? 0;\n    const nbHisto = histo.count ?? 0;\n    if (nbFiches > 0 || nbHisto > 0) {\n      setErreur(\n        `« ${profil.nom} » ne peut pas être supprimé : ${nbFiches} fiche${nbFiches > 1 ? \"s\" : \"\"} l’utilise${nbFiches > 1 ? \"nt\" : \"\"} et il figure ${nbHisto} fois dans l’historique des rythmes (il a servi à calculer des feuilles passées). Désactivez-le : il disparaîtra des listes, l’historique restera juste.`\n      );\n      return;\n    }\n    if (!window.confirm(`Supprimer définitivement le rythme « ${profil.nom} » ?\\n\\nIl ne sert à personne : rien d’autre n’est touché.`)) return;\n    setEnregistrement(profil.id);\n    const { error } = await supabase.from(\"profils_horaires\").delete().eq(\"id\", profil.id);\n    setEnregistrement(null);\n    if (error) {\n      setErreur(messageErreur(error, \"Impossible de supprimer le rythme.\"));\n      return;\n    }\n    setProfils((anciens) => anciens.filter((p) => p.id !== profil.id));\n    setMessage(`Rythme « ${profil.nom} » supprimé.`);\n  }\n\n  const statistiques = useMemo(() => {", "rythmes : fonction de suppression");
  remplacerSouple(rythmes, "<button type=\"button\" onClick={() => setEdition( profil.id ) } className=\"rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 transition hover:border-[#c00000] hover:text-[#c00000]\" > Modifier </button>", "<div className=\"flex justify-end gap-2\">\n                              <button\n                                type=\"button\"\n                                onClick={() => setEdition(profil.id)}\n                                className=\"rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 transition hover:border-[#c00000] hover:text-[#c00000]\"\n                              >\n                                Modifier\n                              </button>\n                              {/* RYTHMES_SUPPRESSION */}\n                              <button\n                                type=\"button\"\n                                disabled={enregistrement === profil.id}\n                                onClick={() => void supprimerProfil(profil)}\n                                title=\"Supprimer ce rythme (seulement s’il ne sert à personne)\"\n                                className=\"rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-500 transition hover:border-[#c00000] hover:text-[#c00000] disabled:opacity-50\"\n                              >\n                                Supprimer\n                              </button>\n                            </div>", "rythmes : bouton « Supprimer » (ordinateur)");
  remplacerSouple(rythmes, "<button type=\"button\" onClick={() => setEdition( profil.id ) } className=\"rounded-lg border px-4 py-2 text-sm font-bold hover:border-[#c00000] hover:text-[#c00000]\" > Modifier </button>", "<div className=\"flex gap-2\">\n                          <button\n                            type=\"button\"\n                            onClick={() => setEdition(profil.id)}\n                            className=\"rounded-lg border px-4 py-2 text-sm font-bold hover:border-[#c00000] hover:text-[#c00000]\"\n                          >\n                            Modifier\n                          </button>\n                          <button\n                            type=\"button\"\n                            disabled={enregistrement === profil.id}\n                            onClick={() => void supprimerProfil(profil)}\n                            className=\"rounded-lg border px-3 py-2 text-sm font-bold text-gray-500 hover:border-[#c00000] hover:text-[#c00000] disabled:opacity-50\"\n                          >\n                            Supprimer\n                          </button>\n                        </div>", "rythmes : bouton « Supprimer » (téléphone)");
  ecritures.push(rythmes);
}

const collab = erreurs.length ? null : lire("app/admin/collaborateurs/page.tsx");
if (collab && collab.texte.includes("COLLAB_RECHERCHE")) console.log("  = app/admin/collaborateurs/page.tsx : déjà à jour");
else if (collab) {
  remplacerSouple(collab, "const [chargement, setChargement] = useState(true);", "const [chargement, setChargement] = useState(true);\n  const [recherche, setRecherche] = useState(\"\"); // COLLAB_RECHERCHE", "recherche : état");
  remplacerSouple(collab, "const equipe = collaborateurs.filter((c) => c.actif && !estDirection(c.role)); const direction = collaborateurs.filter((c) => estDirection(c.role));", "// COLLAB_RECHERCHE : chaque mot cherché dans le trigramme, le prénom, le nom et l'e-mail (accents ignorés)\n  const sansAccents = (t: string) => t.normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g, \"\").toLowerCase();\n  const mots = sansAccents(recherche).split(/\\s+/).filter(Boolean);\n  const correspond = (c: Collaborateur) => {\n    if (mots.length === 0) return true;\n    const texte = sansAccents(`${c.trigramme ?? \"\"} ${c.prenom ?? \"\"} ${c.nom ?? \"\"} ${c.email ?? \"\"}`);\n    return mots.every((m) => texte.includes(m));\n  };\n  const equipe = collaborateurs.filter((c) => c.actif && !estDirection(c.role) && correspond(c));\n  const direction = collaborateurs.filter((c) => estDirection(c.role) && correspond(c));", "recherche : filtre de l’équipe et de la Direction");
  remplacerSouple(collab, "Collaborateurs </h1>", "Collaborateurs\n        </h1>\n\n        {/* COLLAB_RECHERCHE : par trigramme, prénom, nom ou e-mail */}\n        <div style={{ display: \"flex\", gap: 10, alignItems: \"center\", flexWrap: \"wrap\", marginBottom: 18 }}>\n          <input\n            type=\"search\"\n            value={recherche}\n            onChange={(e) => setRecherche(e.target.value)}\n            placeholder=\"Rechercher : trigramme, prénom, nom…\"\n            aria-label=\"Rechercher un collaborateur\"\n            autoFocus\n            style={{ ...inputStyle, maxWidth: 360, fontSize: 15 }}\n          />\n          {recherche.trim() && (\n            <>\n              <span style={{ color: \"#666\", fontSize: 14 }}>\n                {equipe.length + direction.length + collaborateurs.filter((c) => !c.actif && !estDirection(c.role) && correspond(c)).length} résultat(s)\n              </span>\n              <button type=\"button\" onClick={() => setRecherche(\"\")} style={secondaryButtonStyle}>\n                Effacer\n              </button>\n            </>\n          )}\n        </div>", "recherche : le champ");
  remplacerTous(collab, "c => !c.actif && !estDirection(c.role))", "c => !c.actif && !estDirection(c.role) && correspond(c))", 3, "recherche : filtre des inactifs");
  ecritures.push(collab);
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
