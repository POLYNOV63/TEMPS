/* ===============================================================
   MAJ PLANNING - PRÉVISIONNEL SÉPARÉ DU HORS AFFAIRE (PREVISIONNEL_PLANNING)

   - lib/pilotageDonnees.ts, lib/pilotagePlanning.ts : la colonne
     « previsionnel » des affectations (SQL 87) ;
   - components/pilotage/AffectationDialog.tsx : mode « prévisionnel » ;
   - app/pilotage/affaires/page.tsx : bloc « Prévisionnel (non confirmé) »
     à part du « Hors affaire », barres hachurées.
   La page Disponibilités (fournie dans le ZIP) le montre à part.

   À lancer à la racine du projet, APRÈS le SQL 87 :
       node outils/maj-previsionnel.mjs
   Tout ou rien (les quatre fichiers sont vérifiés avant toute écriture).
   Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "PREVISIONNEL_PLANNING";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

const rouge = "repeating-linear-gradient(45deg,#8e9aa8,#8e9aa8 5px,#c3cad3 5px,#c3cad3 10px)";

const fichiers = [
  {
    f: "lib/pilotageDonnees.ts",
    r: [
      {
        nom: "colonne « previsionnel » chargée",
        cherche: '  "id,groupe_id,affaire_id,activite_id,code,libelle,collaborateur_id,date_debut,date_fin,commentaire";',
        remplace: () => '  "id,groupe_id,affaire_id,activite_id,code,libelle,collaborateur_id,date_debut,date_fin,commentaire,previsionnel"; // PREVISIONNEL_PLANNING (SQL 87)',
      },
    ],
  },
  {
    f: "lib/pilotagePlanning.ts",
    r: [
      {
        nom: "type Affectation",
        cherche: "  commentaire: string | null;\n};\n\nexport type JourRow = {",
        remplace: () =>
          "  commentaire: string | null;\n  previsionnel?: boolean | null; // PREVISIONNEL_PLANNING : charge probable, non confirmée (SQL 87)\n};\n\nexport type JourRow = {",
      },
    ],
  },
  {
    f: "components/pilotage/AffectationDialog.tsx",
    r: [
      {
        nom: "propriété « previsionnel »",
        cherche: "  edition?: { affectation: Affectation; jours: JourRow[] };\n};",
        remplace: () =>
          "  edition?: { affectation: Affectation; jours: JourRow[] };\n  /* PREVISIONNEL_PLANNING : événement prévisionnel (charge probable, non confirmée) */\n  previsionnel?: boolean;\n};",
      },
      {
        nom: "paramètre « previsionnel »",
        cherche: "  prefill,\n  edition,\n}: Props) {",
        remplace: () => "  prefill,\n  edition,\n  previsionnel = false,\n}: Props) {",
      },
      {
        nom: "identifiant de l'affectation enregistrée",
        cherche: '      const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {',
        remplace: () => '      const { data: idEnregistre, error } = await supabase.rpc("pilotage_enregistrer_affectation", {',
      },
      {
        nom: "marquage prévisionnel après l'enregistrement",
        cherche: "      if (error) {\n        setEnCours(false);\n        setErreur(traduireErreur(error.message));\n        return;\n      }\n    }\n\n    setEnCours(false);\n    onSaved(",
        remplace: () =>
          "      if (error) {\n        setEnCours(false);\n        setErreur(traduireErreur(error.message));\n        return;\n      }\n\n" +
          "      // PREVISIONNEL_PLANNING : l'événement est marqué prévisionnel\n" +
          "      if (previsionnel && idEnregistre) {\n" +
          '        const { error: ep } = await supabase.from("pilotage_affectations").update({ previsionnel: true }).eq("id", idEnregistre as string);\n' +
          "        if (ep) {\n          setEnCours(false);\n          setErreur(traduireErreur(ep.message));\n          return;\n        }\n      }\n" +
          "    }\n\n    setEnCours(false);\n    onSaved(",
      },
      {
        nom: "titre de la fenêtre",
        cherche: '<Modal titre={enEdition ? "Modifier l’affectation" : "Ajouter une affectation"}',
        remplace: () =>
          '<Modal titre={previsionnel ? (enEdition ? "Modifier le prévisionnel" : "Ajouter du prévisionnel (non confirmé)") : enEdition ? "Modifier l’affectation" : "Ajouter une affectation"}',
      },
      {
        nom: "pas de choix affaire / libre en prévisionnel",
        cherche: '      {!enEdition && (\n        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>',
        remplace: () => '      {!enEdition && !previsionnel && (\n        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>',
      },
      {
        nom: "aide de l'intitulé",
        cherche: "<div style={page.aide}>Salon, déplacement, formation, journée interne… tout ce qui n’est pas une affaire.</div>",
        remplace: () =>
          "<div style={page.aide}>\n                {previsionnel\n                  ? \"Charge probable mais pas encore confirmée : prolongation de PE sans commande, affaire attendue… Elle compte dans la charge, montrée à part du certain. Supprimez-la quand la commande arrive (ou si elle ne vient pas).\"\n                  : \"Salon, déplacement, formation, journée interne… tout ce qui n’est pas une affaire.\"}\n              </div>",
      },
    ],
  },
  {
    f: "app/pilotage/affaires/page.tsx",
    r: [
      {
        nom: "état de la fenêtre d'événement",
        cherche: "  const [evenement, setEvenement] = useState<null | {\n    prefill?: { collaborateurId?: string; debut?: string };",
        remplace: () =>
          "  const [evenement, setEvenement] = useState<null | {\n    previsionnel?: boolean; // PREVISIONNEL_PLANNING\n    prefill?: { collaborateurId?: string; debut?: string };",
      },
      {
        nom: "bloc Prévisionnel ouvert par défaut",
        cherche: "  const [horsAffaireOuvert, setHorsAffaireOuvert] = useState(true);\n",
        remplace: (x) => x + "  const [prevOuvert, setPrevOuvert] = useState(true);\n",
      },
      {
        nom: "événements : prévisionnel ou non",
        cherche: "    const groupes = new Map<string, { libelle: string; code: string | null; blocs: Bloc[] }>();",
        remplace: () => "    const groupes = new Map<string, { libelle: string; code: string | null; prev: boolean; blocs: Bloc[] }>();",
      },
      {
        nom: "regroupement des événements",
        cherche: "      const g = groupes.get(cle) ?? { libelle, code: b.affectation.code, blocs: [] };",
        remplace: () =>
          "      const prev = Boolean(b.affectation.previsionnel);\n" +
          '      const g = groupes.get(`${prev ? "P" : "H"}|${cle}`) ?? { libelle, code: b.affectation.code, prev, blocs: [] };',
      },
      {
        nom: "clé de regroupement",
        cherche: "      g.blocs.push(b);\n      groupes.set(cle, g);",
        remplace: () => '      g.blocs.push(b);\n      groupes.set(`${g.prev ? "P" : "H"}|${cle}`, g);',
      },
      {
        nom: "compteur Hors affaire",
        cherche: "Hors affaire ({evenements.length})",
        remplace: () => "Hors affaire ({evenements.filter((e) => !e.prev).length})",
      },
      {
        nom: "Hors affaire vide",
        cherche: "{horsAffaireOuvert && evenements.length === 0 && (",
        remplace: () => "{horsAffaireOuvert && evenements.filter((e) => !e.prev).length === 0 && (",
      },
      {
        nom: "lignes Hors affaire",
        cherche: "              {horsAffaireOuvert &&\n                evenements.map((ev) => (",
        remplace: () => "              {horsAffaireOuvert &&\n                evenements.filter((e) => !e.prev).map((ev) => (",
      },
      {
        nom: "barre hachurée pour le prévisionnel",
        cherche: '    const fond = libre ? "#7b8189" : pe ?',
        remplace: () => `    const prevision = Boolean(b.affectation.previsionnel);\n    const fond = prevision ? "${rouge}" : libre ? "#7b8189" : pe ?`,
      },
      {
        nom: "bord pointillé pour le prévisionnel",
        cherche: ": `1.5px solid ${libre ? \"#4b5057\"",
        remplace: () => ": `1.5px ${prevision ? \"dashed\" : \"solid\"} ${libre ? \"#4b5057\"",
      },
      {
        nom: "fenêtre en mode prévisionnel",
        cherche: '          prefill={{ onglet: "LIBRE", ...evenement.prefill }}\n          edition={evenement.edition}',
        remplace: () =>
          '          prefill={{ onglet: "LIBRE", ...evenement.prefill }}\n          edition={evenement.edition}\n          previsionnel={Boolean(evenement.previsionnel ?? evenement.edition?.affectation.previsionnel)}',
      },
      {
        nom: "légende",
        cherche: "événement hors affaire (salon, formation, absence connue…)</span>",
        remplace: (x) =>
          x +
          `\n              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ display: "inline-block", width: 20, height: 12, background: "${rouge}", border: "1px dashed #4b5057" }} />prévisionnel (non confirmé)</span>`,
      },
    ],
  },
];

/* bloc « Prévisionnel », placé juste avant le bloc Hors affaire */
const BLOC = `              {/* PREVISIONNEL_PLANNING : charge probable, non confirmée (à part du hors affaire) */}
              <div style={{ marginTop: 18, padding: "6px 8px", background: "#eef1f5", border: "1px dashed #8e9aa8", borderRadius: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  aria-expanded={prevOuvert}
                  onClick={() => setPrevOuvert((v) => !v)}
                  style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: "#3b4046", minHeight: 30, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span aria-hidden="true">{prevOuvert ? "▾" : "▸"}</span>
                  Prévisionnel ({evenements.filter((e) => e.prev).length})
                  <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: C.gris }}>charge probable, pas encore confirmée : prolongation de PE, affaire attendue…</span>
                </button>
                {peutAgir && referentiel && (
                  <button
                    type="button"
                    onClick={() => setEvenement({ previsionnel: true, prefill: { debut: colonnes.includes(aujourdhui) ? aujourdhui : colonnes[0] } })}
                    style={{ marginLeft: "auto", minHeight: 30, padding: "0 10px", border: "1.5px dashed #8e9aa8", background: "#ffffff", borderRadius: 8, fontWeight: 700, fontSize: 13, color: "#3b4046", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    + Prévisionnel
                  </button>
                )}
              </div>
              {prevOuvert && evenements.filter((e) => e.prev).length === 0 && (
                <p style={{ margin: "6px 8px", fontSize: 13, color: C.gris }}>Aucun prévisionnel sur cette période.</p>
              )}
              {prevOuvert &&
                evenements
                  .filter((e) => e.prev)
                  .map((ev) => (
                    <div key={\`p-\${ev.cle}\`}>
                      <div style={{ borderTop: \`1px solid \${C.ligne}\` }} />
                      {ev.blocs.map((b, k) => (
                        <div
                          key={b.affectation.id}
                          data-ligne
                          onDoubleClick={(e) => {
                            if (!peutAgir || !referentiel || (e.target as HTMLElement).closest("button, a, [data-barre]")) return;
                            const jour = jourSousLaSouris(e.currentTarget as HTMLElement, e.clientX);
                            if (jour) setEvenement({ previsionnel: true, prefill: { debut: jour } });
                          }}
                          style={{ display: "grid", gridTemplateColumns: gabarit, gridTemplateRows: "36px", borderTop: k > 0 ? \`1px dashed \${C.ligne}\` : "none", position: "relative", background: "#fafbfc" }}
                        >
                          <div style={{ gridColumn: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 6px 0 12px", lineHeight: 1.2, minWidth: 0 }}>
                            {k === 0 ? (
                              <strong style={{ fontSize: 13, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ev.libelle}
                                {ev.code && <span style={{ fontWeight: 600, color: C.gris }}> · {ev.code}</span>}
                              </strong>
                            ) : null}
                            <span style={{ fontSize: 12, color: "#3b4046" }}>
                              {nomCollab(annuaire.find((c) => c.id === b.affectation.collaborateur_id))} · {formatHeures(b.heures)}
                            </span>
                          </div>
                          {fonds()}
                          {rendreBloc(b, null)}
                          <div style={{ gridColumn: colonnes.length + 2, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 12, fontWeight: 700 }}>
                            {formatDate(b.jours[0].jour)} → {formatDate(b.jours[b.jours.length - 1].jour)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}

`;
const ANCRES_BLOC = ["              {/* HORS_AFFAIRE_BAS :", "              {/* événements hors affaire : salons, formations, absences connues… */}"];

/* ---------- vérifications, puis écriture ---------- */
const resultats = [];
for (const { f, r } of fichiers) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  for (const x of r) {
    const n = t.split(x.cherche).length - 1;
    if (n !== 1) echec(`${f} : passage « ${x.nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const x of r) t = t.replace(x.cherche, (m) => x.remplace(m));
  if (f === "app/pilotage/affaires/page.tsx") {
    const ancre = ANCRES_BLOC.find((a) => t.split(a).length - 1 === 1);
    if (!ancre) echec(`${f} : emplacement du bloc Hors affaire introuvable.`);
    t = t.replace(ancre, (m) => BLOC + m);
  }
  resultats.push([f, t, r.length]);
}
for (const [f, t, n] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} (${n} modification${n > 1 ? "s" : ""})`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
