/* ===============================================================
   MAJ PLANNING - « TOUT EST PLANIFIÉ » DÈS 95 % (PLANIFIE_95)

   Pour une commande au forfait : taux = (déjà pointé + planifié à venir) ÷ chiffré
   - moins de 95 %   : orange « Reste X h à planifier » ;
   - de 95 % à 105 % : barre VERTE et « Tout est planifié » ;
   - plus de 105 %   : rouge « +X h au-delà du chiffré ».
   « Fin après le délai » reste prioritaire. Même règle pour le bandeau
   des familles. Plus de coches en double.

   À lancer à la racine du projet :   node outils/maj-planning-seuil-95.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/affaires/page.tsx";
const MARQUEUR = "PLANIFIE_95";

const remplacements = [
  {
    nom: "seuils",
    cherche: 'const ROUGE_HACHURE = "repeating-linear-gradient(45deg,#b3261e,#b3261e 4px,#f0b4b0 4px,#f0b4b0 8px)";\n',
    remplace: (x) =>
      x +
      "// PLANIFIE_95 : « tout est planifié » dès 95 % du chiffré (pointé + planifié à venir), « au-delà » après 105 %\n" +
      "const SEUIL_PLANIFIE = 0.95;\n" +
      "const SEUIL_AU_DELA = 1.05;\n",
  },
  {
    nom: "barre verte dès 95 %",
    cherche: "    const couvert = !env && (rp ? rp.chiffre > 0 && rp.reste <= 0.5 : chiffre > 0 && affecte >= chiffre - 0.5);",
    remplace: () =>
      "    const couvert = !env && (rp ? rp.chiffre > 0 && rp.pointe + rp.planifie >= SEUIL_PLANIFIE * rp.chiffre : chiffre > 0 && affecte >= SEUIL_PLANIFIE * chiffre);",
  },
  {
    nom: "plus de coche dans la barre",
    cherche: '            {libelle && ` · ${libelle}`}\n            {couvert && " ✓"}\n',
    remplace: () => "            {libelle && ` · ${libelle}`}\n",
  },
  {
    nom: "pas de coche en double dans l'état",
    cherche: 'return { genre: "ok", texte: "✓ Chiffré couvert" };',
    remplace: () => 'return { genre: "ok", texte: "Tout est planifié" };',
  },
  {
    nom: "message de droite, règle des 95 %",
    cherche:
      '                  if (!r || r.chiffre <= 0 || etat.genre === "crit") return <Pastille genre={etat.genre}>{etat.texte}</Pastille>;\n' +
      "                  return (\n" +
      "                    <span title={`Chiffré ${formatHeures(r.chiffre)} − déjà pointé ${formatHeures(r.pointe)} − planifié à venir ${formatHeures(r.planifie)}`}>\n" +
      '                      <Pastille genre={r.reste > 0.5 ? "warn" : "ok"}>{r.reste > 0.5 ? `Reste ${formatHeures(r.reste)} à planifier` : "✓ Tout est planifié"}</Pastille>\n' +
      "                    </span>\n" +
      "                  );",
    remplace: () =>
      '                  if (!r || r.chiffre <= 0) return <Pastille genre={etat.genre}>{etat.texte}</Pastille>;\n' +
      "                  const fait = r.pointe + r.planifie;\n" +
      "                  const taux = fait / r.chiffre;\n" +
      "                  const finTardive = Boolean(affaire.echeance && total?.fin && total.fin > affaire.echeance);\n" +
      '                  const genre: Genre = finTardive || taux > SEUIL_AU_DELA ? "crit" : taux >= SEUIL_PLANIFIE ? "ok" : "warn";\n' +
      "                  const texte = finTardive\n" +
      '                    ? "Fin après le délai"\n' +
      "                    : taux > SEUIL_AU_DELA\n" +
      "                      ? `+${formatHeures(fait - r.chiffre)} au-delà du chiffré`\n" +
      "                      : taux >= SEUIL_PLANIFIE\n" +
      '                        ? "Tout est planifié"\n' +
      "                        : `Reste ${formatHeures(r.chiffre - fait)} à planifier`;\n" +
      "                  return (\n" +
      "                    <span\n" +
      "                      title={`Chiffré ${formatHeures(r.chiffre)} : déjà pointé ${formatHeures(r.pointe)} + planifié à venir ${formatHeures(r.planifie)}, soit ${Math.round(taux * 100)} %${finTardive ? ` · la dernière affectation finit après le délai (${formatDate(affaire.echeance)})` : \"\"}\\n« Tout est planifié » de 95 % à 105 % du chiffré.`}\n" +
      "                    >\n" +
      "                      <Pastille genre={genre}>{texte}</Pastille>\n" +
      "                    </span>\n" +
      "                  );",
  },
  {
    nom: "bandeau des familles, même règle",
    cherche:
      '                            <strong style={{ color: rs < -0.5 ? C.rougeTexte : rs > 0.5 ? "#7a3e00" : "#1b5e20" }}>\n' +
      '                              {rs < -0.5 ? `+${formatHeures(-rs)} au-delà` : rs > 0.5 ? `reste à planifier ${formatHeures(rs)}` : "✓ tout est planifié"}\n' +
      "                            </strong>",
    remplace: () =>
      "                            {(() => {\n" +
      "                              const tauxF = ch > 0 ? (pt + pl) / ch : 1;\n" +
      "                              return (\n" +
      '                                <strong style={{ color: tauxF > SEUIL_AU_DELA ? C.rougeTexte : tauxF >= SEUIL_PLANIFIE ? "#1b5e20" : "#7a3e00" }}>\n' +
      "                                  {tauxF > SEUIL_AU_DELA ? `+${formatHeures(-rs)} au-delà` : tauxF >= SEUIL_PLANIFIE ? \"tout est planifié\" : `reste ${formatHeures(rs)} à planifier`}\n" +
      "                                </strong>\n" +
      "                              );\n" +
      "                            })()}",
  },
  {
    nom: "légende",
    cherche: "affaire : la partie foncée est le chiffré déjà affecté (verte quand tout est affecté)",
    remplace: () => "affaire : partie foncée = déjà pointé, claire = planifié à venir ; verte dès 95 % du chiffré (« Tout est planifié »)",
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
