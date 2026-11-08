/* ===============================================================
   MAJ - SCAN ET NÉGOCE DANS LES AFFAIRES MIXTES (MONTANT_HORS_COMPARAISON)

   Dans une affaire au forfait (BE) qui contient du scan ou du négoce, les
   heures pointées en activité Scan ou Négoce SANS chiffré correspondant
   ne comptent plus dans la comparaison au chiffré (plus de faux
   dépassement de la Méca) ; elles restent affichées en information.
   Si le devis a chiffré du scan, il est comparé normalement.
   Une affaire entièrement Négoce / Scan (imputation) n'a que le temps passé.

   Fichiers : app/pilotage/page.tsx (portefeuille et alertes),
   app/analyse/pointage/page.tsx (Analyse du chiffré),
   app/analyse/fiabilite-chiffrage/page.tsx, app/affaires/bilan/page.tsx.

   À lancer à la racine du projet, APRÈS maj-negoce-scan-info.mjs :
       node outils/maj-montant-hors-comparaison.mjs
   Tout ou rien (les quatre fichiers sont vérifiés avant d'écrire).
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "MONTANT_HORS_COMPARAISON";
const NORMALISE = '(nom ?? "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().trim()';

const FICHIERS = [
  {
    f: "app/pilotage/page.tsx",
    prerequis: "PORTEFEUILLE_V2",
    r: [
      [
        "aide",
        "function PortefeuilleContenu() {",
        `/* MONTANT_HORS_COMPARAISON : activités vendues au montant (scan, négoce) */\nconst estActiviteMontant = (nom?: string) => /^(negoce|scan)/.test(${NORMALISE});\n\nfunction PortefeuilleContenu() {`,
      ],
      [
        "totaux d'une commande",
        "      const totaux = totauxAffaire(\n        parAffaireCharges.get(affaire.id) ?? [],\n        parAffaireRealise.get(cleAffaire(affaire.type, affaire.numero)) ?? []\n      );",
        "      // MONTANT_HORS_COMPARAISON : scan / négoce pointés sans chiffré correspondant : hors comparaison au chiffré\n" +
          "      const actChiffrees = new Set((parAffaireCharges.get(affaire.id) ?? []).filter((c) => (Number(c.heures) || 0) > 0).map((c) => c.activite_id));\n" +
          "      const totaux = totauxAffaire(\n" +
          "        parAffaireCharges.get(affaire.id) ?? [],\n" +
          "        (parAffaireRealise.get(cleAffaire(affaire.type, affaire.numero)) ?? []).filter(\n" +
          "          (r) => !(r.activite_id && !actChiffrees.has(r.activite_id) && estActiviteMontant(nomsActivites.get(r.activite_id)?.nom))\n" +
          "        )\n" +
          "      );",
      ],
      [
        "réalisé d'une famille",
        '      const realiseFamille = totauxAffaire([], parAffaireRealise.get(cleAffaire("CBE", base)) ?? []).realise',
        "      const actFamille = new Set(membres.flatMap((m) => (parAffaireCharges.get(m.affaire.id) ?? []).filter((c) => (Number(c.heures) || 0) > 0).map((c) => c.activite_id)));\n" +
          "      const realiseFamille = totauxAffaire(\n" +
          "        [],\n" +
          '        (parAffaireRealise.get(cleAffaire("CBE", base)) ?? []).filter((r) => !(r.activite_id && !actFamille.has(r.activite_id) && estActiviteMontant(nomsActivites.get(r.activite_id)?.nom)))\n' +
          "      ).realise",
      ],
    ],
  },
  {
    f: "app/analyse/pointage/page.tsx",
    prerequis: "TEMPS_PASSE_INFO",
    r: [
      ["type Famille", "  ids: string[];\n};", "  ids: string[];\n  horsIds: string[]; // MONTANT_HORS_COMPARAISON : scan / négoce pointés sans chiffré\n};"],
      [
        "activités hors comparaison",
        "      const pointe = activites.reduce((t, d) => t + d.pointe, 0);",
        "      // MONTANT_HORS_COMPARAISON : scan / négoce pointés sans chiffré : hors comparaison (information)\n" +
          "      const horsIds = activites.filter((d) => d.chiffre <= 0 && estNegoceImp(d.nom)).map((d) => d.activite);\n" +
          "      const pointe = activites.filter((d) => !horsIds.includes(d.activite)).reduce((t, d) => t + d.pointe, 0);",
      ],
      ["famille : liste hors comparaison", "        ids: retenus.map((m) => m.id),\n      });", "        ids: retenus.map((m) => m.id),\n        horsIds,\n      });"],
      [
        "valeurs hors comparaison",
        "    const periodeH = act ? p?.parAct.get(act) ?? 0 : p?.total ?? 0;\n    const dep = depuisDebut ? depuisDebut.get(f.base) : p;\n    const depuisH = act ? dep?.parAct.get(act) ?? 0 : dep?.total ?? 0;",
        "    const hors = (x?: Agregat) => f.horsIds.reduce((t, id) => t + (x?.parAct.get(id) ?? 0), 0);\n" +
          "    const periodeH = act ? p?.parAct.get(act) ?? 0 : (p?.total ?? 0) - hors(p);\n" +
          "    const dep = depuisDebut ? depuisDebut.get(f.base) : p;\n" +
          "    const depuisH = act ? dep?.parAct.get(act) ?? 0 : (dep?.total ?? 0) - hors(dep);",
      ],
      [
        "pastille d'information",
        '{dormance && <Pastille genre="info">💤 {libelleDormance(dormance)}</Pastille>}',
        '{dormance && <Pastille genre="info">💤 {libelleDormance(dormance)}</Pastille>}\n' +
          "                              {f.horsIds.length > 0 && !estNegoceImp(f.imputation) && (\n" +
          '                                <Pastille genre="info">+{formatHeures(f.activites.filter((d) => f.horsIds.includes(d.activite)).reduce((t, d) => t + d.pointe, 0))} scan / négoce</Pastille>\n' +
          "                              )}",
      ],
    ],
  },
  {
    f: "app/analyse/fiabilite-chiffrage/page.tsx",
    prerequis: "SCAN_A_PART",
    r: [
      [
        "réalisé comparable d'une affaire",
        "      parAffaire.push({ base, designation: laBase.designation, fin: dateFin, chiffre: totalCh, realise: totalRe });",
        "      // MONTANT_HORS_COMPARAISON : scan / négoce pointés sans chiffré : hors comparaison\n" +
          "      const totalReCompare = [...re.entries()].filter(([id]) => (ch.get(id) ?? 0) > 0 || !estNegoceImp(nomAct.get(id)?.nom)).reduce((t, [, x]) => t + x, 0);\n" +
          "      parAffaire.push({ base, designation: laBase.designation, fin: dateFin, chiffre: totalCh, realise: totalReCompare });",
      ],
    ],
  },
  {
    f: "app/affaires/bilan/page.tsx",
    prerequis: null,
    r: [
      [
        "activités au montant",
        "    const ids = new Set([...chiffre.keys(), ...realise.keys()]);",
        "    // MONTANT_HORS_COMPARAISON : négoce et scan sont vendus au montant\n" +
          `    const auMontantNom = (nom?: string) => /^(negoce|scan)/.test(${NORMALISE});\n` +
          "    const imputationBase = (lignesExcel.find((l) => l.genre === \"BASE\") ?? lignesExcel[0])?.imputation ?? undefined;\n" +
          "    const toutAuMontant = auMontantNom(imputationBase);\n" +
          "    const auMontant = new Set([...realise.keys()].filter((id) => auMontantNom(activites.get(id)?.nom)));\n" +
          "    const horsComparaison = toutAuMontant ? 0 : [...auMontant].filter((id) => (chiffre.get(id) ?? 0) <= 0).reduce((t, id) => t + (realise.get(id) ?? 0), 0);\n" +
          "    const ids = new Set([...chiffre.keys(), ...realise.keys()]);",
      ],
      [
        "valeurs renvoyées",
        "    return {\n      sourceChiffre,\n",
        "    return {\n      toutAuMontant,\n      auMontant,\n      horsComparaison,\n      realiseCompare: totalRealise - horsComparaison,\n      sourceChiffre,\n",
      ],
      [
        "recalcul",
        "  }, [comptees, chiffrePilotage, correspondance, imputations, activites, nomActivite, noms]);",
        "  }, [comptees, chiffrePilotage, correspondance, imputations, activites, nomActivite, noms, lignesExcel]);",
      ],
      [
        "écart sur le réalisé comparable",
        "  const ecart = bilan.totalChiffre - bilan.totalRealise;\n  const part = bilan.totalChiffre > 0 ? bilan.totalRealise / bilan.totalChiffre : 0;",
        "  const ecart = bilan.totalChiffre - bilan.realiseCompare;\n  const part = bilan.totalChiffre > 0 ? bilan.realiseCompare / bilan.totalChiffre : 0;",
      ],
      [
        "tuile Reste / Dépassement",
        '              <Tuile\n                libelle={ecart >= 0 ? "Reste" : "Dépassement"}\n                valeur={bilan.totalChiffre > 0 ? formatHeures(Math.abs(ecart)) : "—"}\n                sous={bilan.totalChiffre > 0 ? `${Math.round(part * 100)} % du chiffré consommé` : ""}\n                accent={ecart < 0 && bilan.totalChiffre > 0}\n              />',
        "              {bilan.toutAuMontant ? (\n" +
          '                <Tuile libelle="Temps passé" valeur={formatHeures(bilan.totalRealise)} sous="vendu au montant : pas de comparaison au chiffré" />\n' +
          "              ) : (\n" +
          "                <Tuile\n" +
          '                  libelle={ecart >= 0 ? "Reste" : "Dépassement"}\n' +
          '                  valeur={bilan.totalChiffre > 0 ? formatHeures(Math.abs(ecart)) : "—"}\n' +
          '                  sous={bilan.totalChiffre > 0 ? `${Math.round(part * 100)} % du chiffré consommé${bilan.horsComparaison > 0.01 ? ` · hors ${formatHeures(bilan.horsComparaison)} scan / négoce` : ""}` : ""}\n' +
          "                  accent={ecart < 0 && bilan.totalChiffre > 0}\n" +
          "                />\n" +
          "              )}",
      ],
      [
        "ligne d'activité : information",
        "                      const p = a.chiffre > 0 ? a.realise / a.chiffre : 0;\n",
        "                      const p = a.chiffre > 0 ? a.realise / a.chiffre : 0;\n                      const info = bilan.toutAuMontant || (bilan.auMontant.has(a.id) && a.chiffre <= 0);\n",
      ],
      [
        "écart d'une activité",
        '                          <td style={{ ...tdN, color: e < -0.01 ? C.rougeTexte : undefined, fontWeight: e < -0.01 ? 800 : 400 }}>\n                            {a.chiffre > 0 ? (e < 0 ? `+${formatHeures(-e)} dépassé` : `${formatHeures(e)} restant`) : a.realise > 0 ? "non chiffré" : "—"}\n                          </td>',
        '                          <td style={{ ...tdN, color: info ? C.gris : e < -0.01 ? C.rougeTexte : undefined, fontWeight: !info && e < -0.01 ? 800 : 400 }}>\n' +
          '                            {info ? (a.realise > 0 ? "temps passé · vendu au montant" : "—") : a.chiffre > 0 ? (e < 0 ? `+${formatHeures(-e)} dépassé` : `${formatHeures(e)} restant`) : a.realise > 0 ? "non chiffré" : "—"}\n' +
          "                          </td>",
      ],
      ["barre d'une activité", "                            {a.chiffre > 0 ? (\n                              <>", "                            {a.chiffre > 0 && !info ? (\n                              <>"],
      [
        "écart total",
        '                      <td style={{ ...tdN, fontWeight: 800, color: ecart < -0.01 && bilan.totalChiffre > 0 ? C.rougeTexte : undefined }}>\n                        {bilan.totalChiffre > 0 ? (ecart < 0',
        '                      <td style={{ ...tdN, fontWeight: 800, color: ecart < -0.01 && bilan.totalChiffre > 0 && !bilan.toutAuMontant ? C.rougeTexte : undefined }}>\n                        {bilan.totalChiffre > 0 && !bilan.toutAuMontant ? (ecart < 0',
      ],
      [
        "barre totale",
        "                      <td style={td}>{bilan.totalChiffre > 0 && <Barre part={part} depasse={ecart < -0.01} />}</td>",
        "                      <td style={td}>{bilan.totalChiffre > 0 && !bilan.toutAuMontant && <Barre part={part} depasse={ecart < -0.01} />}</td>",
      ],
      [
        "note sous le tableau",
        "              {bilan.codesSans.length > 0 && (\n                <p style={{ fontSize: 13, color: C.orangeTexte, margin: \"10px 0 0\" }}>",
        "              {(bilan.toutAuMontant || bilan.horsComparaison > 0.01) && (\n" +
          '                <p style={{ fontSize: 13, color: C.gris, margin: "10px 0 0" }}>\n' +
          "                  {bilan.toutAuMontant\n" +
          '                    ? "Affaire de négoce ou de scan, vendue au montant : on suit le temps passé, sans le comparer au chiffré."\n' +
          "                    : `Dont ${formatHeures(bilan.horsComparaison)} de scan / négoce non chiffrées (vendues au montant) : comptées dans le réalisé, mais hors comparaison au chiffré.`}\n" +
          "                </p>\n" +
          "              )}\n" +
          "              {bilan.codesSans.length > 0 && (\n                <p style={{ fontSize: 13, color: C.orangeTexte, margin: \"10px 0 0\" }}>",
      ],
      ["répartition sur les commandes", "                let restant = bilan.totalRealise;", "                let restant = bilan.toutAuMontant ? bilan.totalRealise : bilan.realiseCompare;"],
      ["reste de la famille", "                const resteFamille = chiffreFamille - bilan.totalRealise;", "                const resteFamille = chiffreFamille - bilan.realiseCompare;"],
      ["reste : rien au montant", "                const reste = (h: number) =>\n                  h < -0.01 ?", "                const reste = (h: number) =>\n                  bilan.toutAuMontant ? \"—\" : h < -0.01 ?"],
      [
        "jauge : rien au montant",
        "                const jauge = (chiffre: number, pointe: number, prevu: number) => {\n                  const total = pointe + prevu;",
        "                const jauge = (chiffre: number, pointe: number, prevu: number) => {\n                  if (bilan.toutAuMontant) return null;\n                  const total = pointe + prevu;",
      ],
      ["jauge de la famille", "jauge(chiffreFamille, bilan.totalRealise, planifieFamille)", "jauge(chiffreFamille, bilan.realiseCompare, planifieFamille)"],
      [
        "mois par mois",
        "<span style={{ color: m.cumul > bilan.totalChiffre && bilan.totalChiffre > 0 ? C.rougeTexte : C.gris, fontSize: 12 }}>",
        "<span style={{ color: !bilan.toutAuMontant && m.cumul > bilan.totalChiffre && bilan.totalChiffre > 0 ? C.rougeTexte : C.gris, fontSize: 12 }}>",
      ],
      [
        "mois par mois (%)",
        "{bilan.totalChiffre > 0 ? ` (${Math.round((m.cumul / bilan.totalChiffre) * 100)} %)` : \"\"}",
        "{bilan.totalChiffre > 0 && !bilan.toutAuMontant ? ` (${Math.round((m.cumul / bilan.totalChiffre) * 100)} %)` : \"\"}",
      ],
    ],
  },
];

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

const resultats = [];
for (const { f, prerequis, r } of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  let t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  if (prerequis && !t.includes(prerequis)) echec(`${f} : il manque une mise à jour précédente (${prerequis}).`);
  for (const [nom, a] of r) {
    const n = t.split(a).length - 1;
    if (n !== 1) echec(`${f} : passage « ${nom} » trouvé ${n} fois (attendu : 1).`);
  }
  for (const [, a, b] of r) t = t.replace(a, () => b);
  resultats.push([f, t, r.length]);
}
for (const [f, t, n] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} (${n} modification${n > 1 ? "s" : ""})`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
