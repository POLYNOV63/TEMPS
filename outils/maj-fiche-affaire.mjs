/* ===============================================================
   FICHE AFFAIRE (MONTANTS_FICHE_AFFAIRE)

   Modifie :
   - app/affaires/bilan/page.tsx : la page s'appelle « Fiche affaire » ;
     le bloc des montants reçoit les heures pointées par activité ;
   - components/pilotage/OngletsPilotage.tsx : l'onglet « Bilan affaire »
     devient « Fiche affaire ».
   Tout ou rien, relançable.
================================================================ */

import fs from "node:fs";
import path from "node:path";

const racine = process.cwd();
const erreurs = [];
const ecritures = [];

function echec(message) {
  erreurs.push(message);
}

function lire(rel) {
  const p = path.join(racine, rel);
  if (!fs.existsSync(p)) {
    echec(`Fichier introuvable : ${rel}`);
    return null;
  }
  const brut = fs.readFileSync(p, "utf8");
  return { p, rel, crlf: brut.includes("\r\n"), texte: brut.replace(/\r\n/g, "\n") };
}

function remplacer(fichier, cherche, remplace, libelle) {
  const n = fichier.texte.split(cherche).length - 1;
  if (n !== 1) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : 1 fois).`);
    return;
  }
  fichier.texte = fichier.texte.replace(cherche, () => remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

function remplacerRe(fichier, re, remplace, libelle) {
  const n = (fichier.texte.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? []).length;
  if (n !== 1) {
    echec(`${fichier.rel} : passage « ${libelle} » trouvé ${n} fois (attendu : 1 fois).`);
    return;
  }
  fichier.texte = fichier.texte.replace(re, remplace);
  console.log(`  ✓ ${fichier.rel} : ${libelle}`);
}

/* passage cherché mot à mot, les espaces et retours à la ligne pouvant varier */
function remplacerSouple(fichier, cherche, remplace, libelle) {
  const motif = cherche.trim().split(/\s+/).map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  remplacerRe(fichier, new RegExp(motif), () => remplace, libelle);
}


const bilan = lire("app/affaires/bilan/page.tsx");
if (bilan && bilan.texte.includes("heuresNegoce")) {
  console.log("  = app/affaires/bilan/page.tsx : déjà à jour");
} else if (bilan && bilan.texte.includes("MONTANTS_FICHE_AFFAIRE")) {
  // version précédente déjà installée : on ajoute les heures pointées sur le négoce
  remplacerSouple(bilan, "correspondance={correspondance}\n />", "correspondance={correspondance}\n                heuresNegoce={bilan.parActivite.filter((a) => /^n[ée]goce/i.test(a.nom)).reduce((t, a) => t + a.realise, 0)}\n              />", "bloc des montants : heures passées sur le négoce");
  ecritures.push(bilan);
} else if (bilan) {
  remplacerSouple(bilan, "{affaire.type === \"CBE\" && <BilanFinancierAffaire type={affaire.type} numero={affaire.numero} />}", "{/* MONTANTS_FICHE_AFFAIRE : montants (droit « Montants des affaires »), avec les heures pointées par activité */}\n            {affaire.type === \"CBE\" && (\n              <BilanFinancierAffaire\n                type={affaire.type}\n                numero={affaire.numero}\n                realiseParActivite={new Map(bilan.parActivite.map((a) => [a.id, a.realise]))}\n                correspondance={correspondance}\n                heuresNegoce={bilan.parActivite.filter((a) => /^n[ée]goce/i.test(a.nom)).reduce((t, a) => t + a.realise, 0)}\n              />\n            )}", "bloc des montants : heures pointées par activité");
  remplacerSouple(bilan, "<h1 style={page.titre}>Bilan affaire</h1>", "<h1 style={page.titre}>Fiche affaire</h1>", "titre « Fiche affaire »");
  remplacerSouple(bilan, "<EnTetePage section=\"Bilan affaire\" />", "<EnTetePage section=\"Pilotage BE\" />", "en-tête");
  ecritures.push(bilan);
}

const onglets = erreurs.length ? null : lire("components/pilotage/OngletsPilotage.tsx");
if (onglets && onglets.texte.includes('court: "Fiche affaire"')) {
  console.log("  = components/pilotage/OngletsPilotage.tsx : déjà à jour");
} else if (onglets) {
  remplacerSouple(onglets, "court: \"Bilan affaire\", libelle: \"Bilan affaire\"", "court: \"Fiche affaire\", libelle: \"Fiche affaire\"", "onglet « Fiche affaire »");
  ecritures.push(onglets);
}

/* 3. La Fiche affaire en trois parties : la commande, les heures, l'argent (ORDRE_FICHE) */
if (!erreurs.length && bilan && !bilan.texte.includes("ORDRE_FICHE")) {
  const t = bilan.texte;
  const reperes = [
    ["entete", "{/* ---------- en-tête de l'affaire ---------- */}"],
    ["panneau", "{/* FICHE_FUSIONNEE"],
    ["messages", '{lignesExcel.length === 0 && bilan.sourceChiffre === "AUCUN"'],
    ["tuiles", "{/* ---------- tuiles ---------- */}"],
    ["activite", "{/* ---------- par activité ---------- */}"],
    ["code", "{/* ---------- par code d'imputation ---------- */}"],
    ["sous", "{/* ---------- heures par sous-dossier"],
    ["argent", "{/* ---------- négoce : vendu et acheté"],
    ["commande", "{/* ---------- commande et avenants ---------- */}"],
    ["personnes", '<div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>'],
    ["detail", "{/* ---------- détail ---------- */}"],
  ];
  const pos = reperes.map(([nom, r]) => [nom, t.indexOf(r)]);
  const finRe = /\n\s*<\/>\n\s*\)\}\n\s*<\/div>\n\s*<\/main>/;
  const fin = t.search(finRe);
  const manquants = pos.filter(([, p]) => p < 0).map(([nom]) => nom);
  const croissant = pos.every(([, p], i) => i === 0 || p > pos[i - 1][1]);
  if (manquants.length || !croissant || fin < 0 || fin < pos[pos.length - 1][1]) {
    echec(`app/affaires/bilan/page.tsx : blocs de la page introuvables ou dans un autre ordre (${manquants.join(", ") || "ordre"}) : réorganisation impossible.`);
  } else {
    const seg = {};
    pos.forEach(([nom, p], i) => {
      seg[nom] = t.slice(p, i + 1 < pos.length ? pos[i + 1][1] : fin).trimEnd();
    });
    const titre = (texte, aide) =>
      `{/* ORDRE_FICHE */}\n            <h2 style={{ margin: "28px 0 12px", fontSize: 22, color: C.rougeFonce, borderBottom: \`2px solid \${C.rouge}\`, paddingBottom: 4 }}>\n              ${texte} <span style={{ fontSize: 14, fontWeight: 400, color: C.gris }}>${aide}</span>\n            </h2>`;
    const commandesHeures = `{/* ORDRE_FICHE : les commandes (mère, filles, échéances), leurs dates, statuts et heures commandées par activité */}
            {lignesExcel.length > 0 &&
              (() => {
                const cols = COLONNES_EXCEL.filter(({ champ }) => lignesExcel.some((l) => (Number(l[champ]) || 0) > 0));
                const nature = (l: LigneExcel) => (l.genre === "BASE" ? "Commande" : l.genre === "AVENANT" ? "Avenant" : l.genre === "LOT" ? "Lot" : l.genre === "ECHEANCE" ? "Échéance" : "Devis");
                const ordreL = [...lignesExcel].sort((a, b) => (a.numero_affaire ?? a.cle).localeCompare(b.numero_affaire ?? b.cle, "fr", { numeric: true }));
                const meres = ordreL.filter((l) => l.genre !== "LOT" && l.genre !== "ECHEANCE");
                const filles = (l: LigneExcel) => ordreL.filter((d) => (d.genre === "LOT" || d.genre === "ECHEANCE") && (d.numero_affaire ?? d.cle).toUpperCase().startsWith(String(l.numero_affaire ?? l.cle).toUpperCase()) && !meres.some((m) => m !== l && String(m.numero_affaire ?? m.cle).length > String(l.numero_affaire ?? l.cle).length && (d.numero_affaire ?? d.cle).toUpperCase().startsWith(String(m.numero_affaire ?? m.cle).toUpperCase())));
                const ligne = (l: LigneExcel, fille: boolean) => {
                  const compte = comptees.includes(l);
                  const intention = l.statut === "Intention de commande";
                  return (
                    <tr key={l.cle} style={{ opacity: l.disparue || (!fille && !compte && l.genre !== "DEVIS") ? 0.55 : 1, background: fille ? undefined : "#fafbfc" }}>
                      <td style={{ ...td, whiteSpace: "nowrap", paddingLeft: fille ? 26 : 8 }}>
                        {fille ? "↳ " : ""}
                        <span style={{ fontWeight: fille ? 600 : 800, color: C.rougeFonce, ...(intention ? { background: "#ffe58a", borderRadius: 3, padding: "0 4px" } : {}) }}>{l.numero_affaire ?? l.numero_devis ?? l.cle}</span>
                        <div style={{ fontSize: 12, color: C.gris }}>{nature(l)}</div>
                      </td>
                      <td style={td}>{l.statut ?? "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(l.date_reception_commande)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(l.delai ?? l.date_livraison_estimee)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: l.date_livraison ? "#1b5e20" : undefined }}>{l.date_livraison ? \`✓ \${formatDate(l.date_livraison)}\` : "—"}</td>
                      {cols.map(({ colonne, champ }) => (
                        <td key={colonne} style={tdN}>{fille ? "" : (Number(l[champ]) || 0) > 0 ? formatHeures(Number(l[champ])) : "—"}</td>
                      ))}
                      <td style={{ ...tdN, fontWeight: 800 }}>{fille || l.genre === "DEVIS" ? "" : formatHeures(l.heures_total)}</td>
                    </tr>
                  );
                };
                return (
                  <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
                    <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Les commandes et leurs heures</h2>
                    <p style={{ fontSize: 13, color: C.gris, margin: "0 0 10px" }}>Commande, avenants, échéances et lots : statut, dates, et heures commandées par activité (Suivi d’affaire BE).</p>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                      <thead>
                        <tr>
                          <th style={th}>N°</th>
                          <th style={th}>Statut</th>
                          <th style={th}>Reçue le</th>
                          <th style={th}>Délai</th>
                          <th style={th}>Livrée le</th>
                          {cols.map(({ colonne }) => (
                            <th key={colonne} style={thN}>{colonne}</th>
                          ))}
                          <th style={thN}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {meres.flatMap((l) => [ligne(l, false), ...filles(l).map((d) => ligne(d, true))])}
                        {comptees.length > 1 && (
                          <tr>
                            <td colSpan={5} style={{ ...td, fontWeight: 800, borderTop: \`2px solid \${C.ligne}\` }}>Toute la famille (commandes retenues)</td>
                            {cols.map(({ colonne, champ }) => (
                              <td key={colonne} style={{ ...tdN, fontWeight: 800, borderTop: \`2px solid \${C.ligne}\` }}>{formatHeures(comptees.reduce((s, l) => s + (Number(l[champ]) || 0), 0))}</td>
                            ))}
                            <td style={{ ...tdN, fontWeight: 800, borderTop: \`2px solid \${C.ligne}\` }}>{formatHeures(comptees.reduce((s, l) => s + l.heures_total, 0))}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </section>
                );
              })()}`;
    const aVenirBloc = `{/* ORDRE_FICHE : ce qui est planifié à venir : qui, quand */}
            {aVenir.length > 0 && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Planifié à venir : qui, quand</h2>
                <p style={{ fontSize: 13, color: C.gris, margin: "0 0 10px" }}>Planning des affaires, à partir d’aujourd’hui.</p>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={th}>Personne</th>
                      <th style={th}>Activité</th>
                      <th style={th}>Commande</th>
                      <th style={th}>Du</th>
                      <th style={th}>Au</th>
                      <th style={thN}>Heures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aVenir.map((x) => (
                      <tr key={x.id}>
                        <td style={{ ...td, fontWeight: 800 }}>{x.personne}</td>
                        <td style={td}>{x.activite}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{x.numero}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(x.du)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(x.au)}</td>
                        <td style={{ ...tdN, fontWeight: 800 }}>{formatHeures(x.heures)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={5} style={{ ...td, fontWeight: 800, borderTop: \`2px solid \${C.ligne}\` }}>Total planifié à venir</td>
                      <td style={{ ...tdN, fontWeight: 800, borderTop: \`2px solid \${C.ligne}\` }}>{formatHeures(aVenir.reduce((s, x) => s + x.heures, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            )}`;
    const corps = [
      titre("1 · La commande", "numéros, dates, statuts, heures commandées"),
      seg.entete,
      seg.messages,
      commandesHeures,
      titre("2 · Les heures", "consommées, planifiées : quand, qui"),
      seg.tuiles,
      seg.activite,
      seg.commande,
      seg.panneau,
      aVenirBloc,
      seg.personnes,
      seg.code,
      seg.sous,
      seg.detail,
      seg.argent,
    ].join("\n\n            ");
    bilan.texte = t.slice(0, pos[0][1]) + corps + t.slice(fin);
    console.log("  ✓ app/affaires/bilan/page.tsx : en trois parties (la commande, les heures, l’argent)");

    // les affectations à venir de la famille, par personne
    remplacerSouple(
      bilan,
      "const [planifie, setPlanifie] = useState<Map<string, number>>(new Map());",
      `const [planifie, setPlanifie] = useState<Map<string, number>>(new Map());
  /* ORDRE_FICHE : planifié à venir, affectation par affectation (qui, quelle activité, du… au…) */
  const [aVenir, setAVenir] = useState<{ id: string; personne: string; activite: string; numero: string; du: string; au: string; heures: number }[]>([]);
  useEffect(() => {
    if (!affaire) return;
    let actif = true;
    void (async () => {
      const d = new Date();
      const auj = \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, "0")}-\${String(d.getDate()).padStart(2, "0")}\`;
      const base = affaire.numero.replace(/^0+/, "");
      const { data: afs } = await supabase.from("pilotage_affaires").select("id,numero").eq("type", affaire.type);
      const famille = new Map(
        ((afs ?? []) as { id: string; numero: string }[]).filter((a) => (a.numero.match(/^\\d+/)?.[0] ?? "").replace(/^0+/, "") === base).map((a) => [a.id, a.numero])
      );
      if (famille.size === 0) {
        if (actif) setAVenir([]);
        return;
      }
      const pl = await chargerPlanifie(auj);
      const res: { id: string; personne: string; activite: string; numero: string; du: string; au: string; heures: number }[] = [];
      for (const a of pl.affectations) {
        if (!a.affaire_id || !famille.has(a.affaire_id)) continue;
        const js = pl.jours.filter((j) => j.affectation_id === a.id && j.jour >= auj && (Number(j.heures) || 0) > 0);
        if (js.length === 0) continue;
        const dates = js.map((j) => j.jour).sort();
        const x = a as unknown as { collaborateur_id?: string | null; activite_id?: string | null };
        res.push({
          id: a.id,
          personne: (x.collaborateur_id && noms.get(x.collaborateur_id)) || "—",
          activite: (x.activite_id && activites.get(x.activite_id)?.nom) || "—",
          numero: famille.get(a.affaire_id) ?? "",
          du: dates[0],
          au: dates[dates.length - 1],
          heures: js.reduce((s, j) => s + (Number(j.heures) || 0), 0),
        });
      }
      res.sort((p, q) => p.du.localeCompare(q.du) || p.personne.localeCompare(q.personne, "fr"));
      if (actif) setAVenir(res);
    })().catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [affaire, noms, activites]);`,
      "planifié à venir : qui, quand"
    );
    if (!ecritures.includes(bilan)) ecritures.push(bilan);
  }
}

/* 6. Tout ou rien */
if (erreurs.length > 0) {
  console.error("\n✗ RIEN N'A ÉTÉ MODIFIÉ. Problème(s) :");
  for (const e of erreurs) console.error(`  - ${e}`);
  console.error("\nCopiez ce message à Claude.");
  process.exit(1);
}

for (const f of ecritures) {
  fs.writeFileSync(f.p, f.crlf ? f.texte.replace(/\n/g, "\r\n") : f.texte, "utf8");
}

console.log(
  ecritures.length > 0
    ? `\n✓ Terminé : ${ecritures.length} fichier(s) mis à jour. Étape suivante : npm run build`
    : "\n✓ Rien à faire : tout était déjà à jour. Étape suivante : npm run build"
);
