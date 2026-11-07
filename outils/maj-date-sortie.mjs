/* ===============================================================
   MAJ COLLABORATEURS - DATE DE SORTIE (DATE_SORTIE)

   Fiche collaborateur : « Date de sortie » (dernier jour travaillé),
   facultative, avec pastille « Sortie le … » sur la carte.
   La capacité s'arrête déjà à cette date côté base (pilotage_capacites
   tient compte de collaborateurs.date_sortie) : après elle, la personne
   n'a plus de capacité au planning, dans la charge ni dans les
   disponibilités. Elle garde son accès jusqu'à sa désactivation.

   À lancer à la racine du projet :   node outils/maj-date-sortie.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/admin/collaborateurs/page.tsx";
const MARQUEUR = "DATE_SORTIE";

const remplacements = [
  {
    nom: "type Collaborateur",
    cherche: "  compteur_recuperation?: number | null;\n  inclus_statistiques?: boolean | null;\n};",
    remplace: "  compteur_recuperation?: number | null;\n  inclus_statistiques?: boolean | null;\n  date_sortie?: string | null; // DATE_SORTIE\n};",
  },
  {
    nom: "formulaire : valeur par défaut",
    cherche: '    role: "COLLABORATEUR",\n    inclusStatistiques: true,\n  });',
    remplace: '    role: "COLLABORATEUR",\n    inclusStatistiques: true,\n    dateSortie: "",\n  });',
  },
  {
    nom: "formulaire : valeur de la fiche",
    cherche: "      inclusStatistiques: c.inclus_statistiques !== false,\n    });",
    remplace: '      inclusStatistiques: c.inclus_statistiques !== false,\n      dateSortie: c.date_sortie ?? "",\n    });',
  },
  {
    nom: "enregistrement",
    cherche: "        inclus_statistiques: estDirection(editForm.role) ? false : editForm.inclusStatistiques,\n",
    remplace:
      "        inclus_statistiques: estDirection(editForm.role) ? false : editForm.inclusStatistiques,\n" +
      "        date_sortie: estDirection(editForm.role) ? null : editForm.dateSortie || null,\n",
  },
  {
    nom: "champ dans la fiche",
    cherche: "            {!estDirection(editForm.role) && (\n            <label\n",
    remplace: (x) =>
      `            {/* DATE_SORTIE : dernier jour travaillé ; après, plus de capacité au planning */}
            {!estDirection(editForm.role) && (
              <div style={{ marginTop: 16 }}>
                <label style={{ ...labelStyle, marginTop: 0 }}>Date de sortie (facultatif)</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="date"
                    value={editForm.dateSortie}
                    onChange={(e) => setEditForm((f) => ({ ...f, dateSortie: e.target.value }))}
                    style={{ ...inputStyle, maxWidth: 200 }}
                  />
                  {editForm.dateSortie && (
                    <button type="button" onClick={() => setEditForm((f) => ({ ...f, dateSortie: "" }))} style={secondaryButtonStyle}>
                      Effacer
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                  Dernier jour travaillé. Après cette date, la personne n’a plus de capacité dans le planning, la charge et les disponibilités. Elle garde
                  son accès (dernière feuille d’heures…) jusqu’à ce que vous la désactiviez.
                </div>
              </div>
            )}

` + x,
  },
  {
    nom: "pastille sur la carte",
    cherche: "                        {c.inclus_statistiques === false && (\n",
    remplace: (x) =>
      `                        {c.date_sortie && (
                          <span
                            title="Dernier jour travaillé : plus de capacité au planning après cette date"
                            style={{ background: "#fff4e5", color: "#7a3e00", border: "1px solid #e9b877", padding: "3px 8px", borderRadius: 4, fontSize: 13, fontWeight: 700 }}
                          >
                            Sortie le {formatDate(c.date_sortie)}
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
  t = t.replace(r.cherche, (x) => (typeof r.remplace === "function" ? r.remplace(x) : r.remplace));
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
