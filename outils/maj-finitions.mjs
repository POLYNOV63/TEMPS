/* ===============================================================
   Finitions :
   1. Planning (app/pilotage/affaires/page.tsx) : 📌 sur le jour de rendu
      d'un devis (DBE), avec le rédacteur au survol.
   2. Fiche affaire (app/pilotage/affaire/[id]/page.tsx) : « Délai modifié »
      au lieu d'« Échéance modifiée » ; lien « Voir le planning » réparé ;
      bouton obsolète « Créer le CBE de ce DBE » retiré.
   3. Mes feuilles (app/mes-feuilles/page.tsx) : affichage téléphone
      (une fiche par semaine au lieu d'un tableau).
   Utilisation (à la racine du projet) :  node outils/maj-finitions.mjs
   Le script vérifie tout avant d'écrire ; un fichier déjà à jour est sauté.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CSS_MF = `
@media (max-width: 760px) {
  .mf-contenu { padding: 12px 10px 40px !important; }
  .mf-table { min-width: 0 !important; }
  .mf-table thead { display: none; }
  .mf-table, .mf-table tbody, .mf-table tr, .mf-table td { display: block; width: 100%; box-sizing: border-box; }
  .mf-table tr { border-bottom: 6px solid #f1f3f5; padding: 8px 14px; }
  .mf-table td { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 6px 0 !important; border: none !important; text-align: right !important; }
  .mf-table td::before { font-weight: 700; color: #777; font-size: 13px; text-align: left; }
  .mf-table td:nth-child(1)::before { content: "Semaine"; }
  .mf-table td:nth-child(2)::before { content: "Heures"; }
  .mf-table td:nth-child(3)::before { content: "Théorique"; }
  .mf-table td:nth-child(4)::before { content: "Écart"; }
  .mf-table td:nth-child(5)::before { content: "État"; }
  .mf-table td:nth-child(6) button { width: 100%; min-height: 46px; font-size: 15px; }
}
`;

const travaux = [
  {
    fichier: "app/pilotage/affaires/page.tsx",
    marque: "RENDU_DBE_EPINGLE",
    changements: [
      [
        "Planning : 📌 sur le jour de rendu",
        `{affaire.type === "DBE" ? "◆" : "⚑"}`,
        `{/* RENDU_DBE_EPINGLE */}{affaire.type === "DBE" ? "📌" : "⚑"}`,
      ],
      [
        "Planning : rédacteur au survol",
        "title={`${affaire.type === \"DBE\" ? \"Remise de l’offre\" : \"Livraison souhaitée\"} : ${formatDate(affaire.echeance)}`}",
        "title={`${affaire.type === \"DBE\" ? `Rendu du devis par ${nomCollab(annuaire.find((c) => c.id === affaire.responsable_id))}` : \"Livraison souhaitée\"} : ${formatDate(affaire.echeance)}`}",
      ],
      ["Planning : légende", "<span>▸ replié · ⚑ livraison souhaitée · ◆ remise d’un DBE</span>", "<span>▸ replié · ⚑ livraison souhaitée · 📌 rendu d’un devis (DBE)</span>"],
    ],
  },
  {
    fichier: "app/pilotage/affaire/[id]/page.tsx",
    marque: "FICHE_DELAI",
    changements: [
      [
        "Fiche : « Délai modifié »",
        `setInfo("Échéance modifiée et historisée.");`,
        `setInfo(affaire.type === "DBE" ? "Date de rendu modifiée et historisée." : "Délai modifié et historisé."); // FICHE_DELAI`,
      ],
      ["Fiche : lien vers le planning", `<Link href="/pilotage/planning" style={{ fontWeight: 700, color: C.rougeFonce }}>`, "<Link href={`/pilotage/affaires?ouvrir=${affaire.id}`} style={{ fontWeight: 700, color: C.rougeFonce }}>"],
      [
        "Fiche : bouton « Créer le CBE » retiré",
        `        {peutModifier && affaire.type === "DBE" && (
          <div style={{ marginTop: 16 }}>
            <Link href={\`/pilotage/nouvelle?origine=\${affaire.id}\`} style={page.btnSecondaire}>
              Créer le CBE de ce DBE
            </Link>
          </div>
        )}
`,
        ``,
      ],
    ],
  },
  {
    fichier: "app/mes-feuilles/page.tsx",
    marque: "mf-table",
    changements: [
      [
        "Mes feuilles : styles téléphone",
        `        description="Retrouvez vos feuilles de temps classées par année."
      />`,
        `        description="Retrouvez vos feuilles de temps classées par année."
      />
      {/* téléphone : une fiche par semaine au lieu d'un tableau */}
      <style>{\`${CSS_MF}\`}</style>`,
      ],
      ["Mes feuilles : contenu", `<div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 24px 50px" }}>`, `<div className="mf-contenu" style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 24px 50px" }}>`],
      ["Mes feuilles : tableau", `<table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>`, `<table className="mf-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>`],
    ],
  },
];

let erreurs = 0;
const aEcrire = [];
for (const t of travaux) {
  if (!existsSync(t.fichier)) {
    console.error(`✗ Fichier introuvable : ${t.fichier}`);
    erreurs++;
    continue;
  }
  const original = readFileSync(t.fichier, "utf8").replace(/\r\n/g, "\n");
  if (original.includes(t.marque)) {
    console.log(`✓ ${t.fichier} : déjà à jour`);
    continue;
  }
  let texte = original;
  for (const [nom, cherche, remplace] of t.changements) {
    const nb = texte.split(cherche).length - 1;
    if (nb !== 1) {
      console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
      erreurs++;
      continue;
    }
    texte = texte.replace(cherche, remplace);
    console.log(`✓ ${nom}`);
  }
  aEcrire.push({ fichier: t.fichier, texte });
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const e of aEcrire) writeFileSync(e.fichier, e.texte, "utf8");
console.log("\nTerminé : finitions planning, fiche affaire et Mes feuilles.");
