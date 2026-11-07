/* ===============================================================
   MAJ PLANNING - TOLÉRANCE EN HEURES (TOLERANCE_6H)

   Remplace la règle des 95 % (PLANIFIE_95) par une tolérance en heures :
   une commande au forfait est « tout est planifié » quand il reste
   AU PLUS 6 h à planifier (pointé + planifié à venir face au chiffré),
   sans dépasser 10 % du chiffré pour les petites commandes.
   Même tolérance pour « au-delà du chiffré », la barre verte, le
   bandeau des familles et l'alerte « … encore à mettre au planning ».

   À lancer à la racine du projet, APRÈS maj-planning-seuil-95.mjs :
       node outils/maj-planning-tolerance-6h.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "TOLERANCE_6H";

const remplacements = [
  {
    nom: "tolérance",
    cherche:
      "// PLANIFIE_95 : « tout est planifié » dès 95 % du chiffré (pointé + planifié à venir), « au-delà » après 105 %\n" +
      "const SEUIL_PLANIFIE = 0.95;\n" +
      "const SEUIL_AU_DELA = 1.05;\n",
    remplace:
      "// TOLERANCE_6H : « tout est planifié » quand il reste au plus 6 h à planifier (pointé + planifié à venir face au chiffré),\n" +
      "// sans dépasser 10 % du chiffré ; même tolérance pour « au-delà du chiffré »\n" +
      "const TOLERANCE_H = 6;\n" +
      "const TOLERANCE_PART = 0.1;\n" +
      "const tolerance = (chiffre: number) => Math.min(TOLERANCE_H, TOLERANCE_PART * chiffre);\n",
  },
  {
    nom: "barre verte",
    cherche:
      "    const couvert = !env && (rp ? rp.chiffre > 0 && rp.pointe + rp.planifie >= SEUIL_PLANIFIE * rp.chiffre : chiffre > 0 && affecte >= SEUIL_PLANIFIE * chiffre);",
    remplace:
      "    const couvert = !env && (rp ? rp.chiffre > 0 && rp.chiffre - rp.pointe - rp.planifie <= tolerance(rp.chiffre) : chiffre > 0 && chiffre - affecte <= tolerance(chiffre));",
  },
  {
    nom: "couleur du message",
    cherche: '                  const genre: Genre = finTardive || taux > SEUIL_AU_DELA ? "crit" : taux >= SEUIL_PLANIFIE ? "ok" : "warn";',
    remplace:
      "                  const tol = tolerance(r.chiffre);\n" +
      '                  const genre: Genre = finTardive || fait - r.chiffre > tol ? "crit" : r.chiffre - fait <= tol ? "ok" : "warn";',
  },
  {
    nom: "texte du message (au-delà)",
    cherche: "                    : taux > SEUIL_AU_DELA\n",
    remplace: "                    : fait - r.chiffre > tol\n",
  },
  {
    nom: "texte du message (tout est planifié)",
    cherche: "                      : taux >= SEUIL_PLANIFIE\n",
    remplace: "                      : r.chiffre - fait <= tol\n",
  },
  {
    nom: "aide au survol",
    cherche: "« Tout est planifié » de 95 % à 105 % du chiffré.",
    remplace: "« Tout est planifié » à ${formatHeures(tol)} près (6 h au plus, 10 % du chiffré au plus).",
  },
  {
    nom: "bandeau des familles",
    cherche:
      "                              const tauxF = ch > 0 ? (pt + pl) / ch : 1;\n" +
      "                              return (\n" +
      '                                <strong style={{ color: tauxF > SEUIL_AU_DELA ? C.rougeTexte : tauxF >= SEUIL_PLANIFIE ? "#1b5e20" : "#7a3e00" }}>\n' +
      "                                  {tauxF > SEUIL_AU_DELA ? `+${formatHeures(-rs)} au-delà` : tauxF >= SEUIL_PLANIFIE ? \"tout est planifié\" : `reste ${formatHeures(rs)} à planifier`}",
    remplace:
      "                              const tolF = tolerance(ch);\n" +
      "                              return (\n" +
      '                                <strong style={{ color: -rs > tolF ? C.rougeTexte : rs <= tolF ? "#1b5e20" : "#7a3e00" }}>\n' +
      "                                  {-rs > tolF ? `+${formatHeures(-rs)} au-delà` : rs <= tolF ? \"tout est planifié\" : `reste ${formatHeures(rs)} à planifier`}",
  },
  {
    nom: "alerte « encore à mettre au planning » (total)",
    cherche: "      if (affichees.has(id) && r.reste > 0.5) {",
    remplace: "      if (affichees.has(id) && r.reste > tolerance(r.chiffre)) {",
  },
  {
    nom: "alerte « encore à mettre au planning » (liste)",
    cherche: "                  .filter((x) => x.rp && x.rp.reste > 0.5)",
    remplace: "                  .filter((x) => x.rp && x.rp.reste > tolerance(x.rp.chiffre))",
  },
  {
    nom: "légende",
    cherche: "verte dès 95 % du chiffré (« Tout est planifié »)",
    remplace: "verte quand il reste au plus 6 h à planifier (« Tout est planifié »)",
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
if (!t.includes("PLANIFIE_95")) echec("lancez d'abord : node outils/maj-planning-seuil-95.mjs");
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
if (/SEUIL_(PLANIFIE|AU_DELA)/.test(t)) echec("il reste des traces de la règle des 95 %.");
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
