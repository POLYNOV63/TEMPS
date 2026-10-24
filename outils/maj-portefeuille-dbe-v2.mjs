/* ===============================================================
   Portefeuille : le formulaire « affecter » d'un DBE (rédacteur, date
   de rendu) s'ouvre sur une ligne à part, sous le devis, en largeur :
   il ne déborde plus sur les colonnes voisines.
   Prérequis : node outils/maj-portefeuille-dbe.mjs déjà lancé.
   Utilisation (à la racine du projet) :  node outils/maj-portefeuille-dbe-v2.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/pilotage/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("AFFECTER_DBE_V2")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
if (!texte.includes("AFFECTER_DBE")) {
  console.error("✗ Lancez d'abord : node outils/maj-portefeuille-dbe.mjs");
  process.exit(1);
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

remplacer("Colonne Resp. allégée", "                  <td style={tdCourt}>\n                    {edDbe?.id === affaire.id ? (\n                      <div style={{ display: \"flex\", flexDirection: \"column\", gap: 4, minWidth: 170 }}>\n                        <select\n                          aria-label=\"Rédacteur du devis\"\n                          value={edDbe.resp}\n                          onChange={(e) => setEdDbe({ ...edDbe, resp: e.target.value })}\n                          style={{ ...page.entrees, minHeight: 34, padding: \"0 6px\" }}\n                        >\n                          {[...annuaire]\n                            .sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), \"fr\"))\n                            .map((c) => (\n                              <option key={c.id} value={c.id}>\n                                {nomCollab(c)} — {`${c.prenom ?? \"\"} ${c.nom ?? \"\"}`.trim()}\n                              </option>\n                            ))}\n                        </select>\n                        <label style={{ fontSize: 12, color: C.gris }}>\n                          à rendre le\n                          <input\n                            type=\"date\"\n                            value={edDbe.date}\n                            onChange={(e) => setEdDbe({ ...edDbe, date: e.target.value })}\n                            style={{ ...page.entrees, minHeight: 34, padding: \"0 6px\", marginTop: 2 }}\n                          />\n                        </label>\n                        <div style={{ display: \"flex\", gap: 4 }}>\n                          <button type=\"button\" onClick={() => void enregistrerDbe()} disabled={enregDbe} style={{ ...page.btnPrimaire, minHeight: 32, padding: \"0 12px\" }}>\n                            {enregDbe ? \"…\" : \"OK\"}\n                          </button>\n                          <button type=\"button\" onClick={() => setEdDbe(null)} style={{ ...page.btnSecondaire, minHeight: 32, padding: \"0 10px\" }}>\n                            ✕\n                          </button>\n                        </div>\n                      </div>\n                    ) : (\n                      <>\n                        <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>\n                        {affaire.type === \"DBE\" && !estInactive(affaire) && (\n                          <button\n                            type=\"button\"\n                            title=\"Choisir le rédacteur du devis et sa date cible de rendu\"\n                            onClick={() => setEdDbe({ id: affaire.id, resp: affaire.responsable_id, date: affaire.echeance ?? \"\" })}\n                            style={{ all: \"unset\", cursor: \"pointer\", display: \"block\", fontSize: 12, fontWeight: 700, color: C.rougeFonce, marginTop: 2 }}\n                          >\n                            ✏️ affecter\n                          </button>\n                        )}\n                      </>\n                    )}\n                  </td>", "                  <td style={tdCourt}>\n                    <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>\n                    {affaire.type === \"DBE\" && !estInactive(affaire) && edDbe?.id !== affaire.id && (\n                      <button\n                        type=\"button\"\n                        title=\"Choisir le rédacteur du devis et sa date cible de rendu\"\n                        onClick={() => setEdDbe({ id: affaire.id, resp: affaire.responsable_id, date: affaire.echeance ?? \"\" })}\n                        style={{ all: \"unset\", cursor: \"pointer\", display: \"block\", fontSize: 12, fontWeight: 700, color: C.rougeFonce, marginTop: 2 }}\n                      >\n                        ✏️ affecter\n                      </button>\n                    )}\n                  </td>");
remplacer("Formulaire sur une ligne à part", "                  </td>\n                </tr>\n                {ouverte && (", "                  </td>\n                </tr>\n                {/* AFFECTER_DBE_V2 : le formulaire s'ouvre sur une ligne à part, sous le devis */}\n                {edDbe?.id === affaire.id && (\n                  <tr>\n                    <td colSpan={nbColonnes} style={{ ...page.td, background: \"#fff6fa\", padding: \"10px 16px 12px 40px\" }}>\n                      <div style={{ display: \"flex\", flexWrap: \"wrap\", alignItems: \"flex-end\", gap: 12 }}>\n                        <strong style={{ alignSelf: \"center\", color: \"#a3245a\" }}>DBE {affaire.numero} :</strong>\n                        <label style={{ display: \"flex\", flexDirection: \"column\", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>\n                          Rédacteur\n                          <select\n                            value={edDbe.resp}\n                            onChange={(e) => setEdDbe({ ...edDbe, resp: e.target.value })}\n                            style={{ ...page.entrees, minHeight: 38, width: 240 }}\n                          >\n                            {[...annuaire]\n                              .sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), \"fr\"))\n                              .map((c) => (\n                                <option key={c.id} value={c.id}>\n                                  {nomCollab(c)} — {`${c.prenom ?? \"\"} ${c.nom ?? \"\"}`.trim()}\n                                </option>\n                              ))}\n                          </select>\n                        </label>\n                        <label style={{ display: \"flex\", flexDirection: \"column\", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>\n                          À rendre le\n                          <input\n                            type=\"date\"\n                            value={edDbe.date}\n                            onChange={(e) => setEdDbe({ ...edDbe, date: e.target.value })}\n                            style={{ ...page.entrees, minHeight: 38, width: 170 }}\n                          />\n                        </label>\n                        <button type=\"button\" onClick={() => void enregistrerDbe()} disabled={enregDbe} style={{ ...page.btnPrimaire, minHeight: 38 }}>\n                          {enregDbe ? \"Enregistrement…\" : \"Enregistrer\"}\n                        </button>\n                        <button type=\"button\" onClick={() => setEdDbe(null)} style={{ ...page.btnSecondaire, minHeight: 38 }}>\n                          Annuler\n                        </button>\n                      </div>\n                    </td>\n                  </tr>\n                )}\n                {ouverte && (");

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : formulaire « affecter » sur une ligne à part.");
