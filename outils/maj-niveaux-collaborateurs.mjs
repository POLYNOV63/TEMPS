/* ===============================================================
   MAJ COLLABORATEURS - NIVEAU (NIVEAUX_COLLAB)

   Fiche collaborateur : choix du niveau (1, 2, 3 ou non renseigné),
   enregistré dans collaborateurs_niveaux (SQL 86) ; petite pastille
   « N2 » sur la carte de la personne (page réservée à l'ADMIN).

   À lancer à la racine du projet, APRÈS le SQL 86 :
       node outils/maj-niveaux-collaborateurs.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/admin/collaborateurs/page.tsx";
const MARQUEUR = "NIVEAUX_COLLAB";

const remplacements = [
  {
    nom: "définition des niveaux",
    cherche: 'const estExterne = (email?: string | null) => !/@polynov\\.fr$/i.test(String(email ?? "").trim());\n',
    remplace: (x) =>
      x +
      `
/* NIVEAUX_COLLAB : niveau de la personne (SQL 86). Sert aux disponibilités par activité,
   qui n'en affichent que des totaux, jamais nominativement. */
const NIVEAUX_COLLAB = [
  { n: 1, libelle: "Niveau 1", aide: "Exécute sous supervision : dessin, mise en plan, calculs simples" },
  { n: 2, libelle: "Niveau 2", aide: "Autonome sur une affaire courante" },
  { n: 3, libelle: "Niveau 3", aide: "Expert ou référent : conçoit, pilote une affaire, valide le travail des autres" },
];
`,
  },
  {
    nom: "état du niveau",
    cherche: "  const [editCompet, setEditCompet] = useState<Set<string>>(new Set());\n",
    remplace: (x) =>
      x +
      "  // NIVEAUX_COLLAB : niveau de chacun, et celui choisi dans la fiche en cours de modification\n" +
      "  const [niveaux, setNiveaux] = useState<Map<string, number>>(new Map());\n" +
      "  const [editNiveau, setEditNiveau] = useState<number | null>(null);\n",
  },
  {
    nom: "lecture des niveaux",
    cherche: "      setPredominances(m);\n      setCompetences(mc);\n    }\n",
    remplace: (x) =>
      x +
      "\n    {\n" +
      "      // NIVEAUX_COLLAB (sans la table, SQL 86 pas encore passé : aucun niveau)\n" +
      '      const { data: niv } = await supabase.from("collaborateurs_niveaux").select("collaborateur_id,niveau");\n' +
      "      setNiveaux(new Map(((niv ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau)])));\n" +
      "    }\n",
  },
  {
    nom: "niveau repris à l'ouverture de la fiche",
    cherche: "    setEditCompet(new Set(competences.get(c.id) ?? []));\n",
    remplace: (x) => x + "    setEditNiveau(niveaux.get(c.id) ?? null);\n",
  },
  {
    nom: "enregistrement du niveau",
    cherche: "    setEditModal(null);\n    await chargerDonnees();\n  }\n\n  function ouvrirAjout(",
    remplace: () =>
      "    // NIVEAUX_COLLAB : le niveau (supprimé s'il n'est plus renseigné)\n" +
      "    if (!estDirection(editForm.role)) {\n" +
      "      const { error: en } =\n" +
      "        editNiveau === null\n" +
      '          ? await supabase.from("collaborateurs_niveaux").delete().eq("collaborateur_id", editModal.id)\n' +
      "          : await supabase\n" +
      '              .from("collaborateurs_niveaux")\n' +
      '              .upsert({ collaborateur_id: editModal.id, niveau: editNiveau, maj_le: new Date().toISOString() }, { onConflict: "collaborateur_id" });\n' +
      "      if (en) {\n" +
      "        setErreur(`Fiche enregistrée, mais niveau non enregistré : ${en.message}`);\n" +
      "        return;\n" +
      "      }\n" +
      "    }\n\n" +
      "    setEditModal(null);\n    await chargerDonnees();\n  }\n\n  function ouvrirAjout(",
  },
  {
    nom: "choix du niveau dans la fiche",
    cherche: "            {!estDirection(editForm.role) && (\n            <label\n",
    remplace: (x) =>
      `            {/* NIVEAUX_COLLAB : niveau de la personne */}
            {!estDirection(editForm.role) && (
              <div style={{ marginTop: 16 }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Niveau</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {[...NIVEAUX_COLLAB, { n: 0, libelle: "Non renseigné", aide: "" }].map((nv) => {
                    const coche = (editNiveau ?? 0) === nv.n;
                    return (
                      <label
                        key={nv.n}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: \`1.5px solid \${coche ? "#1f4e79" : "#ddd"}\`, background: coche ? "#eef4fb" : "white", fontSize: 14 }}
                      >
                        <input type="radio" name="niveau-collab" checked={coche} onChange={() => setEditNiveau(nv.n === 0 ? null : nv.n)} />
                        <strong>{nv.libelle}</strong>
                        {nv.aide && <span style={{ color: "#666" }}>· {nv.aide}</span>}
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                  Sert aux disponibilités par activité, qui n’en montrent que des totaux : le niveau d’une personne n’est affiché nulle part ailleurs
                  qu’ici.
                </div>
              </div>
            )}

` + x,
  },
  {
    nom: "pastille du niveau sur la carte",
    cherche: "                        {c.inclus_statistiques === false && (\n",
    remplace: (x) =>
      `                        {niveaux.has(c.id) && (
                          <span
                            title={NIVEAUX_COLLAB.find((nv) => nv.n === niveaux.get(c.id))?.aide}
                            style={{ background: "#f4f7f4", color: "#2e5e32", border: "1px solid #c8dcc9", padding: "3px 8px", borderRadius: 4, fontSize: 13, fontWeight: 700 }}
                          >
                            N{niveaux.get(c.id)}
                          </span>
                        )}

` + x,
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour (${MARQUEUR}), rien à faire.`);
  process.exit(0);
}
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, (x) => r.remplace(x));
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
