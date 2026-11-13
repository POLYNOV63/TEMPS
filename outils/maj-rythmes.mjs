/* ===============================================================
   COLLABORATEURS : LE RYTHME À LA CRÉATION (RYTHME_PROFILS)

   La fenêtre « Nouveau collaborateur » proposait les « bases horaires »
   (une ancienne table que plus aucune page ne remplit : liste vide), alors
   que les rythmes se gèrent dans Paramétrage › Rythmes horaires. Elle
   propose maintenant ces rythmes-là : la personne est rattachée au rythme
   choisi, sans en créer une copie. « Personnalisé » crée toujours un
   rythme propre à la personne.
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



const f = lire("app/admin/collaborateurs/page.tsx");
if (f && f.texte.includes("RYTHME_PROFILS")) {
  console.log("  = app/admin/collaborateurs/page.tsx : déjà à jour");
} else if (f) {
  remplacerSouple(f, "const base = bases.find((b) => b.id === baseId);", "const base = profils.find((b) => b.id === baseId); // RYTHME_PROFILS : les rythmes de « Rythmes horaires »", "le rythme choisi remplit la semaine");
  remplacerSouple(f, "{bases.map((base) => ( <option key={base.id} value={base.id}> {base.code} — {base.nom} </option> ))}", "{profils.map((p) => (\n                <option key={p.id} value={p.id}>\n                  {p.nom} · {(Number(p.lundi) + Number(p.mardi) + Number(p.mercredi) + Number(p.jeudi) + Number(p.vendredi)).toLocaleString(\"fr-FR\")} h\n                </option>\n              ))}", "la liste propose les rythmes horaires");
  remplacerSouple(f, "<option value=\"\">Sélectionner une base...</option>", "<option value=\"\">Choisir un rythme…</option>", "libellé de la liste");
  remplacerSouple(f, "<label style={labelStyle}>Base horaire</label>", "<label style={labelStyle}>Rythme horaire</label>", "titre du champ");
  remplacerSouple(f, "setErreur(\"Veuillez sélectionner une base horaire.\");", "setErreur(\"Veuillez choisir un rythme horaire (ou « Personnalisé »).\");", "message d’erreur");
  {
    const debut = f.texte.indexOf("const nomProfil = personnalise");
    const finRepere = f.texte.indexOf("const { data: collaborateur, error: erreurCollaborateur } =");
    if (debut < 0 || finRepere < 0 || finRepere < debut) echec("app/admin/collaborateurs/page.tsx : création du rythme introuvable.");
    else {
      f.texte = f.texte.slice(0, debut) + "// RYTHME_PROFILS : un rythme choisi dans la liste est celui de « Rythmes horaires » (partagé, rien n'est copié) ;\n    // seul « Personnalisé » crée un rythme propre à la personne\n    const modele = personnalise ? null : profils.find((p) => p.id === baseSelectionnee) ?? null;\n    let profil: { id: string } | null = modele ? { id: modele.id } : null;\n    const nomRythme = modele ? modele.nom : `Personnalisé - ${prenom} ${nom}`;\n    let profilCree = false;\n    if (!profil) {\n      const { data: cree, error: erreurProfil } = await supabase\n        .from(\"profils_horaires\")\n        .insert({\n          nom: nomRythme,\n          lundi: Number(lundi),\n          mardi: Number(mardi),\n          mercredi: Number(mercredi),\n          jeudi: Number(jeudi),\n          vendredi: Number(vendredi),\n          samedi: 0,\n          dimanche: 0,\n          forfait: false,\n          actif: true,\n        })\n        .select()\n        .single();\n      if (erreurProfil || !cree) {\n        console.error(erreurProfil);\n        setErreur(erreurProfil?.message ? `Impossible de créer le rythme personnalisé. Cause : ${erreurProfil.message}` : \"Impossible de créer le rythme personnalisé.\");\n        return;\n      }\n      profil = cree as { id: string };\n      profilCree = true;\n    }\n\n    " + f.texte.slice(finRepere);
      console.log("  ✓ app/admin/collaborateurs/page.tsx : plus de copie du rythme à chaque création");
    }
  }
  remplacerSouple(f, "await supabase.from(\"profils_horaires\").delete().eq(\"id\", profil.id);", "if (profilCree && profil) await supabase.from(\"profils_horaires\").delete().eq(\"id\", profil.id);", "en cas d’échec, seul un rythme personnalisé est retiré");
  remplacerSouple(f, "profil_horaire_id: profil.id, date_entree: dateEntree,", "profil_horaire_id: profil.id,\n          rythme: nomRythme,\n          date_entree: dateEntree,", "la fiche porte le nom de son rythme");
  ecritures.push(f);
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
