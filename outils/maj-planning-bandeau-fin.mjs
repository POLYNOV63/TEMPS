/* ===============================================================
   MAJ PLANNING - BANDEAU MOINS HAUT (BANDEAU_FIN)

   Le bandeau bleu (client, description, totaux) passe sur une seule
   ligne serrée, à peu près deux fois moins haute ; une description trop
   longue est coupée (« … », visible en entier au survol).

   À lancer à la racine du projet, APRÈS maj-planning-bandeaux-partout.mjs :
       node outils/maj-planning-bandeau-fin.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "BANDEAU_FIN";

const remplacements = [
  {
    nom: "bandeau sur une ligne serrée",
    cherche:
      '<div style={{ marginTop: 12, padding: "6px 10px", background: "#eef3f9", borderTop: "2px solid #9fb6cf", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 16px", fontSize: 13 }}>',
    remplace:
      '{/* BANDEAU_FIN : une seule ligne serrée */}\n                        <div style={{ marginTop: 12, padding: "1px 10px", background: "#eef3f9", borderTop: "2px solid #9fb6cf", display: "flex", flexWrap: "nowrap", alignItems: "baseline", gap: "0 12px", fontSize: 12, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden" }}>',
  },
  {
    nom: "n° toujours visible",
    cherche: '<strong style={{ color: "#34506b" }}>\n                            {famille ? "⧉ " : ""}',
    remplace: '<strong style={{ color: "#34506b", flexShrink: 0 }}>\n                            {famille ? "⧉ " : ""}',
  },
  {
    nom: "description coupée si trop longue",
    cherche: '<span style={{ color: "#3b4046" }}>\n                            {clientsParBase.get(cle)',
    remplace:
      '<span title={`${clientsParBase.get(cle) ? `${clientsParBase.get(cle)} · ` : ""}${laBase.designation ?? ""}`} style={{ color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>\n                            {clientsParBase.get(cle)',
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
if (!t.includes("BANDEAU_PARTOUT"))
  echec("lancez d'abord : node outils/maj-planning-familles-discret.mjs; node outils/maj-planning-bandeaux.mjs; node outils/maj-planning-bandeaux-partout.mjs");
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
