/* ===============================================================
   MISE À JOUR DU RELEVÉ PE / PI (RELEVE_AERE)

   Modifie app/pilotage/prestations/page.tsx :
   - l'étiquette « INT. » disparaît : l'intention de commande se voit au
     surlignage jaune du n° (ajouté aussi aux commandes à staffer) ;
   - le tableau est plus aéré, la première colonne (commande) plus large ;
   - réglages (⚙) d'une ligne : « Ajouter une personne » sur la même
     commande (RELEVE_AJOUT_PERSONNE), « Retirer de la commande » pour une
     ligne sans heures ; dans une commande, la personne d'origine (celle
     qui a le plus d'heures) reste en tête (RELEVE_ORDRE_ORIGINE) ;
   - fiche commande : chaque commande de la famille (base, avenants) se
     déplie et montre ses quantités et montants commandés, livrés (faits
     au relevé), facturés (mois clôturés, mois par mois) et le reste à
     facturer ; total de la famille.

   Tout ou rien : tout est vérifié avant d'écrire quoi que ce soit.
   Relançable sans risque : ce qui est déjà fait est sauté.
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


const f = lire("app/pilotage/prestations/page.tsx");
if (f && f.texte.includes("RELEVE_AERE")) {
  console.log("  = app/pilotage/prestations/page.tsx : déjà à jour");
} else if (f) {
  // INT. : retiré (deux endroits : commandes à staffer, lignes du relevé)
  const nInt = f.texte.split("{a.statut === \"EN_ATTENTE\" && <span style={{ fontSize: 11, color: \"#7a3e00\", fontWeight: 800 }}>INT.</span>}").length - 1;
  if (nInt !== 2) echec(`app/pilotage/prestations/page.tsx : étiquette « INT. » trouvée ${nInt} fois (attendu : 2).`);
  else {
    f.texte = f.texte.split("{a.statut === \"EN_ATTENTE\" && <span style={{ fontSize: 11, color: \"#7a3e00\", fontWeight: 800 }}>INT.</span>}").join("");
    console.log("  ✓ app/pilotage/prestations/page.tsx : étiquette « INT. » retirée");
  }
  remplacerSouple(f, "title=\"Voir la fiche commande : ce qui est commandé, le taux, le montant\"\n                            style={{ all: \"unset\", cursor: \"pointer\", fontWeight: 800, color: C.rougeFonce, textDecoration: \"underline dotted\" }}", "title={a.statut === \"EN_ATTENTE\" ? \"Intention de commande (commande pas encore reçue). Voir la fiche commande\" : \"Voir la fiche commande : ce qui est commandé, le taux, le montant\"}\n                            style={{ all: \"unset\", cursor: \"pointer\", fontWeight: 800, color: C.rougeFonce, textDecoration: \"underline dotted\", ...(a.statut === \"EN_ATTENTE\" ? { background: \"#ffe94d\", padding: \"0 4px\", borderRadius: 3 } : {}) }}", "commande à staffer : n° surligné en jaune si intention");
  remplacerSouple(f, "const L_CMD = 180;", "const L_CMD = 250; // RELEVE_AERE : première colonne plus large", "première colonne plus large");
  remplacerSouple(f, "const L_PERS = 62;", "const L_PERS = 72;", "colonne des personnes");
  remplacerSouple(f, "const cellule: CSSProperties = { ...td, padding: \"3px 4px\", fontSize: 13,", "const cellule: CSSProperties = { ...td, padding: \"7px 6px\", fontSize: 13,", "lignes plus aérées");
  remplacerSouple(f, "padding: \"7px 0\",\n cursor: verrou ? \"default\" : \"cell\",", "padding: \"10px 0\",\n cursor: verrou ? \"default\" : \"cell\",", "cases des jours plus hautes");
  remplacerSouple(f, "const [fiche, setFiche] = useState<string | null>(null);", "const [fiche, setFiche] = useState<string | null>(null);\n  /* FICHE_FAMILLE_CHIFFRES : pour chaque commande de la famille (base, avenants), ses lignes, ce qui est fait au relevé\n     (jusqu'à aujourd'hui) et ses mois clôturés (facturés) */\n  type ChiffresFamille = {\n    lignes: { id: string; unite: \"JOUR\" | \"HEURE\"; taux: number | null; base: number }[];\n    faitH: Map<string, number>;\n    mois: { ligne_id: string; mois: string; heures: number; montant: number }[];\n  };\n  const [famOuvertes, setFamOuvertes] = useState<Set<string>>(new Set());\n  const [familleData, setFamilleData] = useState<Map<string, ChiffresFamille> | null>(null);\n  useEffect(() => {\n    setFamOuvertes(new Set(fiche ? [fiche] : []));\n    setFamilleData(null);\n    if (!fiche) return;\n    const a = affaires.find((x) => x.id === fiche);\n    if (!a) return;\n    const base = (a.numero.match(/^\\d+/)?.[0] ?? a.numero).replace(/^0+/, \"\");\n    const ids = affaires.filter((x) => (x.numero.match(/^\\d+/)?.[0] ?? x.numero).replace(/^0+/, \"\") === base).map((x) => x.id);\n    let actif = true;\n    void (async () => {\n      const { data: ls } = await supabase.from(\"prestation_lignes\").select(\"id,affaire_id,unite,taux,base_horaire\").in(\"affaire_id\", ids);\n      const lignesF = ((ls ?? []) as { id: string; affaire_id: string; unite: \"JOUR\" | \"HEURE\"; taux: number | string | null; base_horaire: number | string | null }[]).map((l) => ({\n        id: l.id,\n        affaire_id: l.affaire_id,\n        unite: l.unite,\n        taux: l.taux === null ? null : Number(l.taux),\n        base: Number(l.base_horaire) || 7,\n      }));\n      const lids = lignesF.map((l) => l.id);\n      const d = new Date();\n      const auj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, \"0\")}-${String(d.getDate()).padStart(2, \"0\")}`;\n      let pm: { ligne_id: string; mois: string; heures_fige: number | string | null; montant_fige: number | string | null }[] = [];\n      let sa: { ligne_id: string; heures: number | string | null }[] = [];\n      if (lids.length > 0)\n        [pm, sa] = await Promise.all([\n          chargerTout<{ ligne_id: string; mois: string; heures_fige: number | string | null; montant_fige: number | string | null }>((x, y) =>\n            supabase.from(\"prestation_mois\").select(\"ligne_id,mois,heures_fige,montant_fige\").in(\"ligne_id\", lids).eq(\"valide\", true).order(\"mois\").range(x, y)\n          ),\n          chargerTout<{ ligne_id: string; heures: number | string | null }>((x, y) =>\n            supabase.from(\"prestation_saisies\").select(\"ligne_id,heures\").in(\"ligne_id\", lids).lte(\"jour\", auj).order(\"jour\").range(x, y)\n          ),\n        ]);\n      if (!actif) return;\n      const faitH = new Map<string, number>();\n      for (const s of sa) faitH.set(s.ligne_id, (faitH.get(s.ligne_id) ?? 0) + (Number(s.heures) || 0));\n      const m = new Map<string, ChiffresFamille>();\n      for (const id of ids) {\n        const lsA = lignesF.filter((l) => l.affaire_id === id);\n        const lidsA = new Set(lsA.map((l) => l.id));\n        m.set(id, {\n          lignes: lsA,\n          faitH,\n          mois: pm.filter((x) => lidsA.has(x.ligne_id)).map((x) => ({ ligne_id: x.ligne_id, mois: String(x.mois).slice(0, 7), heures: Number(x.heures_fige) || 0, montant: Number(x.montant_fige) || 0 })),\n        });\n      }\n      setFamilleData(m);\n    })();\n    return () => {\n      actif = false;\n    };\n  }, [fiche, affaires]);", "fiche : chiffres des commandes de la famille");
  remplacerSouple(f, "const frD = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(\"fr-FR\") : \"—\");", "const frD = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(\"fr-FR\") : \"—\");\n                  /* FICHE_FAMILLE_CHIFFRES : commandé, livré (fait au relevé), facturé (mois clôturés), reste à facturer, dans l'unité de la commande */\n                  const chiffres = (x: AffaireP) => {\n                    const fx = ficheDe(x);\n                    const dx = familleData?.get(x.id);\n                    if (!dx) return null;\n                    const k = (lid: string) => (fx.unite === \"JOUR\" ? dx.lignes.find((l) => l.id === lid)?.base || fx.base : 1);\n                    let faitU = 0;\n                    let faitE = 0;\n                    for (const l of dx.lignes) {\n                      const h = dx.faitH.get(l.id) ?? 0;\n                      faitU += h / k(l.id);\n                      const tH = l.taux === null ? null : l.unite === \"JOUR\" ? l.taux / l.base : l.taux;\n                      if (tH !== null) faitE += h * tH;\n                    }\n                    const parMois = new Map<string, { q: number; e: number }>();\n                    for (const mm of dx.mois) {\n                      const v = parMois.get(mm.mois) ?? { q: 0, e: 0 };\n                      v.q += mm.heures / k(mm.ligne_id);\n                      v.e += mm.montant;\n                      parMois.set(mm.mois, v);\n                    }\n                    const factureU = [...parMois.values()].reduce((t, v) => t + v.q, 0);\n                    const factureE = [...parMois.values()].reduce((t, v) => t + v.e, 0);\n                    return { fx, u: fx.unite === \"JOUR\" ? \"j\" : \"h\", faitU, faitE, factureU, factureE, parMois: [...parMois.entries()].sort((p, q) => p[0].localeCompare(q[0])) };\n                  };\n                  const n2 = (v: number) => v.toLocaleString(\"fr-FR\", { maximumFractionDigits: 2 });\n                  const ligneChiffre = (lib: string, q: number | null, u: string, e: number | null, aide?: string, couleur?: string) => (\n                    <div title={aide} style={{ display: \"flex\", justifyContent: \"space-between\", gap: 10, padding: \"3px 0\", borderBottom: `1px dotted ${C.ligne}` }}>\n                      <span style={{ color: C.gris }}>{lib}</span>\n                      <strong style={{ color: couleur }}>\n                        {q === null ? \"—\" : `${n2(Math.round(q * 100) / 100)} ${u}`}\n                        {e !== null && Math.abs(e) >= 0.5 ? ` · ${euros(e)}` : \"\"}\n                      </strong>\n                    </div>\n                  );", "fiche : calcul commandé / livré / facturé");
  remplacerSouple(f, "return (\n                              <tr key={x.id} style={x.id === a.id ? { background: \"#fff7e0\" } : undefined}>\n                                <td style={{ ...page.td, padding: \"4px 6px\", fontWeight: 800 }}>{x.numero}</td>", "return (\n                              <Fragment key={x.id}>\n                              <tr\n                                onClick={() =>\n                                  setFamOuvertes((s) => {\n                                    const n = new Set(s);\n                                    if (n.has(x.id)) n.delete(x.id);\n                                    else n.add(x.id);\n                                    return n;\n                                  })\n                                }\n                                title=\"Déplier : quantités et montants commandés, livrés, facturés\"\n                                style={{ cursor: \"pointer\", ...(x.id === a.id ? { background: \"#fff7e0\" } : {}) }}\n                              >\n                                <td style={{ ...page.td, padding: \"4px 6px\", fontWeight: 800, whiteSpace: \"nowrap\" }}>\n                                  <span style={{ color: C.gris, marginRight: 4 }}>{famOuvertes.has(x.id) ? \"▾\" : \"▸\"}</span>\n                                  {x.numero}\n                                </td>", "fiche : commande dépliable");
  remplacerSouple(f, "<td style={{ ...page.td, padding: \"4px 6px\", whiteSpace: \"nowrap\" }}>{frD(d?.livraison ?? null)}</td>\n                              </tr>\n                            );", "<td style={{ ...page.td, padding: \"4px 6px\", whiteSpace: \"nowrap\" }}>{frD(d?.livraison ?? null)}</td>\n                              </tr>\n                              {famOuvertes.has(x.id) && (\n                                <tr>\n                                  <td colSpan={5} style={{ ...page.td, padding: \"6px 10px 10px 24px\", background: \"#fafbfc\", fontSize: 13 }}>\n                                    {(() => {\n                                      const cx = chiffres(x);\n                                      if (!cx) return <span style={{ color: C.gris }}>Chargement…</span>;\n                                      const resteQ = cx.fx.quantite === null ? null : cx.fx.quantite - cx.factureU;\n                                      const resteE = cx.fx.montant > 0 ? cx.fx.montant - cx.factureE : null;\n                                      return (\n                                        <>\n                                          {ligneChiffre(\"Commandé\", cx.fx.quantite, cx.u, cx.fx.montant > 0 ? cx.fx.montant : null)}\n                                          {ligneChiffre(\"Livré (fait au relevé, à ce jour)\", cx.faitU, cx.u, cx.faitE, \"Heures saisies au relevé jusqu’à aujourd’hui, au taux de chaque ligne\")}\n                                          {ligneChiffre(\"Facturé (mois clôturés)\", cx.factureU, cx.u, cx.factureE, \"Mois clôturés du relevé : heures et montants figés\", \"#1b5e20\")}\n                                          {ligneChiffre(\"Livré, pas encore facturé\", cx.faitU - cx.factureU, cx.u, cx.faitE - cx.factureE, \"Fait au relevé moins facturé (mois en cours, mois non clôturés, reports)\")}\n                                          {ligneChiffre(\"Reste à facturer sur la commande\", resteQ, cx.u, resteE, \"Commandé moins facturé\", resteQ !== null && resteQ < -0.01 ? \"#b3261e\" : undefined)}\n                                          {cx.parMois.length > 0 && (\n                                            <div style={{ marginTop: 6, fontSize: 12, color: \"#3b4046\", lineHeight: 1.6 }}>\n                                              <span style={{ color: C.gris, fontWeight: 700 }}>Facturé mois par mois : </span>\n                                              {cx.parMois.map(([mo, v]) => (\n                                                <span key={mo} style={{ display: \"inline-block\", marginRight: 12, whiteSpace: \"nowrap\" }}>\n                                                  {NOMS_MOIS[Number(mo.slice(5, 7)) - 1].slice(0, 4)}. {mo.slice(2, 4)} : <strong>{n2(Math.round(v.q * 100) / 100)} {cx.u}</strong> · {euros(v.e)}\n                                                </span>\n                                              ))}\n                                            </div>\n                                          )}\n                                        </>\n                                      );\n                                    })()}\n                                  </td>\n                                </tr>\n                              )}\n                              </Fragment>\n                            );", "fiche : détail déplié");
  remplacerSouple(f, "})}\n                        </tbody>\n                      </table>\n                    </>\n                  );\n                })()}\n\n                {titreSection(\"Personnes\")}", "})}\n                          {/* FICHE_FAMILLE_CHIFFRES : total de la famille */}\n                          {famille.length > 1 &&\n                            (() => {\n                              const cs = famille.map(chiffres);\n                              if (cs.some((x) => x === null)) return null;\n                              const ok = cs as NonNullable<ReturnType<typeof chiffres>>[];\n                              const memeUnite = ok.every((x) => x.u === ok[0].u);\n                              const s = (f: (x: (typeof ok)[number]) => number) => ok.reduce((t, x) => t + f(x), 0);\n                              const q = (v: number) => (memeUnite ? `${n2(Math.round(v * 100) / 100)} ${ok[0].u} · ` : \"\");\n                              return (\n                                <tr>\n                                  <td colSpan={5} style={{ ...page.td, padding: \"6px 6px\", fontSize: 13, background: \"#f1f2f4\", borderTop: `2px solid ${C.ligne}` }}>\n                                    <strong>Famille</strong> · commandé {q(s((x) => x.fx.quantite ?? 0))}\n                                    {euros(s((x) => x.fx.montant))} · livré {q(s((x) => x.faitU))}\n                                    {euros(s((x) => x.faitE))} · <span style={{ color: \"#1b5e20\" }}>facturé {q(s((x) => x.factureU))}\n                                    {euros(s((x) => x.factureE))}</span>\n                                  </td>\n                                </tr>\n                              );\n                            })()}\n                        </tbody>\n                      </table>\n                      <div style={{ fontSize: 12, color: C.gris, marginBottom: 6 }}>Cliquer sur une commande pour voir ses quantités et montants commandés, livrés et facturés.</div>\n                    </>\n                  );\n                })()}\n\n                {titreSection(\"Personnes\")}", "fiche : total de la famille");
  ecritures.push(f);
}


/* 2. Ajouter une personne depuis les réglages (⚙) d'une ligne (RELEVE_AJOUT_PERSONNE) */
const f2 = erreurs.length ? null : lire("app/pilotage/prestations/page.tsx");
if (f2) {
  const source = ecritures.find((x) => x.rel === f2.rel) ?? f2;
  if (source.texte.includes("RELEVE_AJOUT_PERSONNE")) {
    console.log("  = app/pilotage/prestations/page.tsx : ajout d’une personne déjà en place");
  } else {
    remplacerSouple(source, "onChange={(e) => void changerPersonne(l, e.target.value)} style={champ}>\n                                        {annuaire.map((p) => (\n                                          <option key={p.id} value={p.id}>\n                                            {nomCollab(p)}\n                                          </option>\n                                        ))}\n                                      </select>\n                                    </label>", "onChange={(e) => void changerPersonne(l, e.target.value)} style={champ}>\n                                        {annuaire.map((p) => (\n                                          <option key={p.id} value={p.id}>\n                                            {nomCollab(p)}\n                                          </option>\n                                        ))}\n                                      </select>\n                                    </label>\n                                    {/* RELEVE_AJOUT_PERSONNE : une personne de plus sur la même commande (nouvelle ligne, avec la vente de la commande) */}\n                                    {peutAgir && (\n                                      <label style={{ ...etiquette, width: 190 }} title=\"Ajoute une ligne pour cette personne sur la même commande, avec l’unité, la base et le taux de la commande\">\n                                        Ajouter une personne\n                                        <select\n                                          value=\"\"\n                                          onChange={(e) => {\n                                            if (e.target.value) void staffer(l.affaire_id, e.target.value);\n                                          }}\n                                          style={champ}\n                                        >\n                                          <option value=\"\">+ sur cette commande…</option>\n                                          {annuaire\n                                            .filter((p) => !lignes.some((x) => x.affaire_id === l.affaire_id && x.collaborateur_id === p.id))\n                                            .map((p) => (\n                                              <option key={p.id} value={p.id}>\n                                                {nomCollab(p)}\n                                              </option>\n                                            ))}\n                                        </select>\n                                      </label>\n                                    )}", "réglages (⚙) : ajouter une personne sur la commande");
    if (!ecritures.includes(source)) ecritures.push(source);
  }
}


/* 3. La personne d'origine reste en tête de la commande ; retirer une personne sans heures (RELEVE_ORDRE_ORIGINE) */
if (!erreurs.length) {
  const source3 = ecritures.find((x) => x.rel === "app/pilotage/prestations/page.tsx") ?? lire("app/pilotage/prestations/page.tsx");
  if (source3 && source3.texte.includes("RELEVE_ORDRE_ORIGINE")) {
    console.log("  = app/pilotage/prestations/page.tsx : ordre des personnes et « Retirer » déjà en place");
  } else if (source3) {
    remplacerSouple(source3, "const titres = { PE: \"Prestations externes (PE)\",", "// RELEVE_ORDRE_ORIGINE : dans une commande, la personne qui a le plus d'heures (celle d'origine) en tête, les ajouts dessous\n    const poidsLigne = (l: Ligne) =>\n      (consoLigneAvant.get(l.id) ?? 0) + (planif.futur.get(l.id)?.heures ?? 0) + saisies.filter((s) => s.ligne_id === l.id).reduce((t, s) => t + (s.heures ?? 0), 0);\n    const titres = { PE: \"Prestations externes (PE)\",", "ordre : la personne d’origine en tête de la commande");
    remplacerSouple(source3, "nomCollab(collabs.get(x.collaborateur_id)).localeCompare(nomCollab(collabs.get(y.collaborateur_id))) ); if (ls.length) res.push(", "poidsLigne(y) - poidsLigne(x) || nomCollab(collabs.get(x.collaborateur_id)).localeCompare(nomCollab(collabs.get(y.collaborateur_id)))\n          );\n        if (ls.length) res.push(", "ordre : tri des lignes d’une commande");
    remplacerSouple(source3, "}, [lignes, categorie, affairesParId, collabs, dort]);", "}, [lignes, categorie, affairesParId, collabs, dort, consoLigneAvant, planif, saisies]);", "ordre : dépendances");
    remplacerSouple(source3, "async function modifierLigne(l: Ligne, patch: Partial<Ligne>) {", "/* RELEVE_RETIRER_PERSONNE : une ligne sans aucune heure saisie quitte la commande (elle est désactivée) */\n  async function retirerLigne(l: Ligne) {\n    const qui = nomCollab(collabs.get(l.collaborateur_id));\n    const cmd = affairesParId.get(l.affaire_id)?.numero ?? \"la commande\";\n    if (!window.confirm(`Retirer ${qui} de ${cmd} ?`)) return;\n    setErreur(\"\");\n    const { error } = await supabase.from(\"prestation_lignes\").update({ actif: false }).eq(\"id\", l.id);\n    if (error) return setErreur(traduireErreur(error.message));\n    setDetails((d) => {\n      const n = new Set(d);\n      n.delete(l.id);\n      return n;\n    });\n    setInfo(`${qui} retiré(e) de ${cmd}.`);\n    setRechargement((n) => n + 1);\n  }\n\n  async function modifierLigne(l: Ligne, patch: Partial<Ligne>) {", "retirer une personne : fonction");
    remplacerSouple(source3, "{/* RELEVE_AJOUT_PERSONNE : une personne de plus sur la même commande (nouvelle ligne, avec la vente de la commande) */}", "{/* RELEVE_RETIRER_PERSONNE : retirer la personne de la commande, tant qu'elle n'a aucune heure saisie */}\n                                    {peutAgir &&\n                                      (() => {\n                                        const h = (consoLigneAvant.get(l.id) ?? 0) + c.heures + (planif.futur.get(l.id)?.heures ?? 0);\n                                        const occupe = h > 0.001;\n                                        return (\n                                          <button\n                                            type=\"button\"\n                                            disabled={occupe}\n                                            onClick={() => void retirerLigne(l)}\n                                            title={occupe ? `${formatHeures(h)} saisies sur cette ligne : videz d’abord ses jours (✕), pour pouvoir la retirer` : \"Retirer cette personne de la commande : sa ligne disparaît du relevé\"}\n                                            style={{ ...outil, alignSelf: \"flex-end\", height: 38, fontSize: 13, color: occupe ? C.gris : \"#b3261e\", borderColor: occupe ? \"#d5d9de\" : \"#e5a3a3\", cursor: occupe ? \"not-allowed\" : \"pointer\" }}\n                                          >\n                                            Retirer de la commande\n                                          </button>\n                                        );\n                                      })()}\n                                    {/* RELEVE_AJOUT_PERSONNE : une personne de plus sur la même commande (nouvelle ligne, avec la vente de la commande) */}", "retirer une personne : bouton dans ⚙");
    remplacerSouple(source3, ".filter((p) => !lignes.some((x) => x.affaire_id === l.affaire_id && x.collaborateur_id === p.id))", ".filter((p) => !lignes.some((x) => x.actif && x.affaire_id === l.affaire_id && x.collaborateur_id === p.id))", "ajouter : une personne retirée peut revenir");
    if (!ecritures.includes(source3)) ecritures.push(source3);
  }
}


/* 4. Les deux fiches du relevé, nommées : « Fiche de paramétrage PI / PE » (⚙) et « Fiche d'information PI / PE »
      (lecture seule : on n'y ajoute plus de personne et on n'y règle plus la vente) (RELEVE_FICHES_NOMMEES) */
if (!erreurs.length) {
  const f4 = ecritures.find((x) => x.rel === "app/pilotage/prestations/page.tsx") ?? lire("app/pilotage/prestations/page.tsx");
  if (f4 && f4.texte.includes("RELEVE_FICHES_NOMMEES")) {
    console.log("  = app/pilotage/prestations/page.tsx : fiches déjà nommées");
  } else if (f4) {
    remplacerSouple(f4, "aria-label=\"Fiche commande\"", "aria-label=\"Fiche d’information PI / PE\"", "fiche d’information : nom de la fenêtre");
    remplacerSouple(f4, "<div style={{ ...page.carte, padding: 20, width: 540, maxWidth: \"94vw\", maxHeight: \"90vh\", overflowY: \"auto\" }} onClick={(e) => e.stopPropagation()}>", "<div style={{ ...page.carte, padding: 20, width: 540, maxWidth: \"94vw\", maxHeight: \"90vh\", overflowY: \"auto\" }} onClick={(e) => e.stopPropagation()}>\n                {/* RELEVE_FICHES_NOMMEES */}\n                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: \".4px\", textTransform: \"uppercase\", color: C.gris, marginBottom: 4 }}>Fiche d’information PI / PE</div>", "fiche d’information : titre");
    remplacerRe(
      f4,
      /\{titreSection\("La vente"\)\}[\s\S]*?(\{info\("Quantité commandée")/,
      (_m, suite) =>
        `{titreSection("La vente")}\n                {info("Vendue", f.unite === "JOUR" ? \`au jour (journée de \${deux(f.base)} h)\` : "à l’heure", "Se règle dans la fiche de paramétrage (⚙) des lignes")}\n                ${suite}`,
      "fiche d’information : la vente en lecture seule"
    );
    remplacerRe(
      f4,
      /Personne n’est encore staffé\.\s*\{peutAgir && \([\s\S]*?\n\s*\)\}\s*(\{f\.taux !== null)/,
      (_m, suite) => `Personne n’est encore staffé : utilisez « ⚙ Paramétrer » dans le relevé.\n                    ${suite}`,
      "fiche d’information : plus de staffage depuis la fiche"
    );
    remplacerRe(
      f4,
      /\{\/\* AJOUT_DANS_FICHE[\s\S]*?\n\s*\)\}\n(\s*\{\(f\.montant <= 0)/,
      (_m, suite) => `\n${suite}`,
      "fiche d’information : plus d’ajout de personne (il se fait dans ⚙)"
    );
    remplacerSouple(f4, "title=\"Fiche commande : commandé, taux, consommé, reste\" aria-label={`Fiche commande ${a.numero}`}", "title=\"Fiche d’information PI / PE : commandé, consommé, reste, commandes de la famille\" aria-label={`Fiche d’information ${a.numero}`}", "bouton de la fiche d’information");
    remplacerSouple(f4, "{/* BOUTON_FICHE : un mot plutôt qu'un petit i */}\n fiche", "{/* BOUTON_FICHE : un mot plutôt qu'un petit i */}\n infos", "bouton « infos »");
    remplacerSouple(f4, "<div style={{ position: \"sticky\", left: 0, display: \"flex\", flexWrap: \"wrap\", alignItems: \"flex-end\", gap: 12, padding: \"10px 12px\", maxWidth: \"min(100vw - 80px, 1300px)\", boxSizing: \"border-box\" }}>", "<div style={{ position: \"sticky\", left: 0, display: \"flex\", flexWrap: \"wrap\", alignItems: \"flex-end\", gap: 12, padding: \"10px 12px\", maxWidth: \"min(100vw - 80px, 1300px)\", boxSizing: \"border-box\" }}>\n                                    <div style={{ flexBasis: \"100%\", fontSize: 12, fontWeight: 800, letterSpacing: \".4px\", textTransform: \"uppercase\", color: C.gris }}>\n                                      ⚙ Fiche de paramétrage PI / PE · {nomCollab(collabs.get(l.collaborateur_id))} sur {a?.numero}\n                                    </div>", "fiche de paramétrage : titre");
    remplacerSouple(f4, "title=\"Réglages de la ligne : personne, activité, unité, taux, base, intergroupe, report, heures sup\"", "title=\"Fiche de paramétrage PI / PE : personne, ajout d’une personne, activité, unité, taux, base, intergroupe, report, heures sup\"", "bouton ⚙ : info-bulle");
    if (!ecritures.includes(f4)) ecritures.push(f4);
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
