/* ===============================================================
   Portefeuille (app/pilotage/page.tsx) : sur chaque DBE en cours, un
   bouton « ✏️ affecter » dans la colonne Resp. pour choisir le rédacteur
   et la date cible de rendu. Le devis apparaît alors dans la feuille de
   route de la personne, jusqu'à ce qu'il passe « Devis envoyé ».
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-dbe.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("AFFECTER_DBE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

remplacer(
  "Enregistrement du rédacteur et de la date",
  `  const [toutesAlertes, setToutesAlertes] = useState(false);`,
  `  const [toutesAlertes, setToutesAlertes] = useState(false);

  // AFFECTER_DBE : rédacteur et date cible de rendu d'un devis, depuis le portefeuille
  const [edDbe, setEdDbe] = useState<{ id: string; resp: string; date: string } | null>(null);
  const [enregDbe, setEnregDbe] = useState(false);

  async function enregistrerDbe() {
    if (!edDbe) return;
    if (!edDbe.date) {
      setErreurPlanning("Indiquez la date cible de rendu du devis.");
      return;
    }
    setEnregDbe(true);
    setErreurPlanning("");
    const { error } = await supabase
      .from("pilotage_affaires")
      .update({ responsable_id: edDbe.resp, echeance: edDbe.date })
      .eq("id", edDbe.id);
    setEnregDbe(false);
    if (error) {
      setErreurPlanning(\`Affectation du devis impossible : \${error.message}\`);
      return;
    }
    const fait = edDbe;
    setAffaires((liste) => liste.map((a) => (a.id === fait.id ? { ...a, responsable_id: fait.resp, echeance: fait.date } : a)));
    setEdDbe(null);
  }`
);

remplacer(
  "Bouton « affecter » sur les DBE",
  `                  <td style={tdCourt}>
                    <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>
                  </td>`,
  `                  <td style={tdCourt}>
                    {edDbe?.id === affaire.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170 }}>
                        <select
                          aria-label="Rédacteur du devis"
                          value={edDbe.resp}
                          onChange={(e) => setEdDbe({ ...edDbe, resp: e.target.value })}
                          style={{ ...page.entrees, minHeight: 34, padding: "0 6px" }}
                        >
                          {[...annuaire]
                            .sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), "fr"))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {nomCollab(c)} — {\`\${c.prenom ?? ""} \${c.nom ?? ""}\`.trim()}
                              </option>
                            ))}
                        </select>
                        <label style={{ fontSize: 12, color: C.gris }}>
                          à rendre le
                          <input
                            type="date"
                            value={edDbe.date}
                            onChange={(e) => setEdDbe({ ...edDbe, date: e.target.value })}
                            style={{ ...page.entrees, minHeight: 34, padding: "0 6px", marginTop: 2 }}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" onClick={() => void enregistrerDbe()} disabled={enregDbe} style={{ ...page.btnPrimaire, minHeight: 32, padding: "0 12px" }}>
                            {enregDbe ? "…" : "OK"}
                          </button>
                          <button type="button" onClick={() => setEdDbe(null)} style={{ ...page.btnSecondaire, minHeight: 32, padding: "0 10px" }}>
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>
                        {affaire.type === "DBE" && !estInactive(affaire) && (
                          <button
                            type="button"
                            title="Choisir le rédacteur du devis et sa date cible de rendu"
                            onClick={() => setEdDbe({ id: affaire.id, resp: affaire.responsable_id, date: affaire.echeance ?? "" })}
                            style={{ all: "unset", cursor: "pointer", display: "block", fontSize: 12, fontWeight: 700, color: C.rougeFonce, marginTop: 2 }}
                          >
                            ✏️ affecter
                          </button>
                        )}
                      </>
                    )}
                  </td>`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : les DBE s'affectent depuis le portefeuille.");
