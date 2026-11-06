/* ===============================================================
   MAJ PLANNING - BANDEAU POUR TOUTES LES COMMANDES (BANDEAU_TOUTES)

   Planning des affaires, commandes au forfait :
   - chaque commande a son bandeau bleu (seule ou en famille) avec le
     n° de base, le client et la description ; une famille y garde ses
     totaux d'heures ;
   - sous le bandeau, la ligne de la commande ne montre plus que son n°
     (CBE 1741R1, responsable, XLS…) ; sa description n'y reste que si
     elle diffère de celle du bandeau ;
   - liseré à gauche et espace après chaque bloc.
   DBE et PE / PI ne changent pas.

   À lancer à la racine du projet, APRÈS maj-planning-familles-discret.mjs :
       node outils/maj-planning-bandeaux.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "BANDEAU_TOUTES";

const remplacements = [
  {
    nom: "la ligne d'une commande sait si elle est sous un bandeau",
    cherche: "  function rendreAffaire(affaire: Affaire, titreGroupe: string | null, premiere: boolean): ReactNode {\n",
    remplace:
      "  function rendreAffaire(affaire: Affaire, titreGroupe: string | null, premiere: boolean, sousBandeau?: string): ReactNode {\n" +
      "    // BANDEAU_TOUTES : sous un bandeau, la description n'est répétée que si elle diffère de celle du bandeau\n" +
      "    const designationAffichee = sousBandeau === undefined || (affaire.designation ?? \"\").trim().toLowerCase() !== sousBandeau.trim().toLowerCase();\n",
  },
  {
    nom: "ligne plus basse quand elle ne montre que le n°",
    cherche: 'gridTemplateRows: "46px", background: livree ? "#f1f2f4" : "#f8f9fa", position: "relative" }}',
    remplace: 'gridTemplateRows: designationAffichee ? "46px" : "36px", background: livree ? "#f1f2f4" : "#f8f9fa", position: "relative" }}',
  },
  {
    nom: "description masquée sous le bandeau",
    cherche:
      '              <div style={{ fontSize: 12, color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={affaire.designation}>\n',
    remplace:
      "              {designationAffichee && (\n" +
      '              <div style={{ fontSize: 12, color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={affaire.designation}>\n',
  },
  {
    nom: "client masqué sous le bandeau (il y est déjà)",
    cherche: "                  return client ? <strong style={{ fontWeight: 800 }}>{client} · </strong> : null;",
    remplace: "                  return client && sousBandeau === undefined ? <strong style={{ fontWeight: 800 }}>{client} · </strong> : null;",
  },
  {
    nom: "fin de la description",
    cherche: "                {affaire.designation}\n              </div>\n            </div>\n          </div>\n",
    remplace: "                {affaire.designation}\n              </div>\n              )}\n            </div>\n          </div>\n",
  },
  {
    nom: "toute commande au forfait a son bandeau",
    cherche: "                const enFamille = affaire.type === \"CBE\" && !estPrestation(affaire) && membres.length > 1;\n",
    remplace:
      "                // BANDEAU_TOUTES : toute commande au forfait a son bandeau ; « famille » quand il y a des avenants\n" +
      "                const enFamille = affaire.type === \"CBE\" && !estPrestation(affaire);\n" +
      "                const famille = membres.length > 1;\n",
  },
  {
    nom: "titre du bandeau (famille ou commande seule)",
    cherche:
      "                            ⧉ CBE {laBase.numero.match(/^\\d+/)?.[0] ?? laBase.numero} · famille de {membres.length} commandes\n",
    remplace:
      "                            {famille ? \"⧉ \" : \"\"}CBE {laBase.numero.match(/^\\d+/)?.[0] ?? laBase.numero}\n" +
      "                            {famille ? ` · famille de ${membres.length} commandes` : \"\"}\n",
  },
  {
    nom: "totaux d'heures dans le bandeau des familles seulement",
    cherche: '                          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>\n                            chiffré {formatHeures(ch)}',
    remplace: '                          {famille && (\n                          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>\n                            chiffré {formatHeures(ch)}',
  },
  {
    nom: "fin des totaux du bandeau",
    cherche: "                            </strong>\n                          </span>\n                        </div>\n                      </>\n",
    remplace: "                            </strong>\n                          </span>\n                          )}\n                        </div>\n                      </>\n",
  },
  {
    nom: "la commande sous son bandeau",
    cherche: "                      {rendreAffaire(affaire, null, false)}\n",
    remplace: "                      {rendreAffaire(affaire, null, false, laBase.designation ?? \"\")}\n",
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
if (!t.includes("FAMILLE_DISCRET")) echec("lancez d'abord : node outils/maj-planning-familles-discret.mjs");
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
