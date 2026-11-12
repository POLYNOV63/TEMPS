/* ===============================================================
   DROITS D'ACCÈS PAR RÔLE (DROITS_ROLES)

   Modifie :
   - components/pilotage/OngletsPilotage.tsx : les onglets suivent les
     pages ouvertes à chaque rôle (Paramétrage › Droits d'accès) ;
   - app/pilotage/page.tsx (Suivi des affaires) : colonne des montants
     (montant, facturé, reste à facturer, € / h réalisé) et export, pour
     qui a le droit « Suivi des affaires avec les montants »
     (MONTANTS_AFFAIRES).

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


/* 1. Onglets du Pilotage */
const onglets = lire("components/pilotage/OngletsPilotage.tsx");
if (onglets && onglets.texte.includes("DROITS_ROLES")) {
  console.log("  = components/pilotage/OngletsPilotage.tsx : déjà à jour");
} else if (onglets) {
  const nbPeut = onglets.texte.split("peut(").length - 1;
    remplacerSouple(onglets, "const visibles = ONGLETS.filter((o) => (role === undefined ? o.cle === actif : peut(role, o.droit)));", "const visibles = ONGLETS.filter((o) => (role === undefined ? o.cle === actif : pageAutorisee(role, o.href))); // DROITS_ROLES", "onglets : pages ouvertes au rôle");
  if (nbPeut === 1) remplacerSouple(onglets, 'import { peut, type Droit } from "@/lib/droits";', 'import { pageAutorisee, type Droit } from "@/lib/droits";\nimport { useDroitsRoles } from "@/lib/droitsRoles";', "onglets : import");
  else remplacerSouple(onglets, 'import { peut, type Droit } from "@/lib/droits";', 'import { pageAutorisee, peut, type Droit } from "@/lib/droits";\nimport { useDroitsRoles } from "@/lib/droitsRoles";', "onglets : import");
    remplacerSouple(onglets, "const [role, setRole] = useState<string | null | undefined>(undefined);", "const [role, setRole] = useState<string | null | undefined>(undefined);\n  useDroitsRoles(); // se redessine quand les réglages de droits arrivent", "onglets : suivre les réglages");
  ecritures.push(onglets);
}

/* 2. Suivi des affaires : les montants */
const suivi = erreurs.length ? null : lire("app/pilotage/page.tsx");
if (suivi && suivi.texte.includes("MONTANTS_AFFAIRES")) {
  console.log("  = app/pilotage/page.tsx : déjà à jour");
} else if (suivi) {
    remplacerSouple(suivi, "import * as XLSX from \"xlsx\";", "import * as XLSX from \"xlsx\";\nimport { peut } from \"@/lib/droits\";\nimport { chargerDroitsRoles } from \"@/lib/droitsRoles\";", "import des droits");
    remplacerSouple(suivi, "const [toutesAlertes, setToutesAlertes] = useState(false);", "const [toutesAlertes, setToutesAlertes] = useState(false);\n\n  /* MONTANTS_AFFAIRES : droit « Suivi des affaires avec les montants » (Paramétrage › Droits d'accès) :\n     montant, facturé et reste à facturer de chaque famille (base + avenants) */\n  const [voitMontants, setVoitMontants] = useState(false);\n  const [montantsFamille, setMontantsFamille] = useState<Map<string, { montant: number; facture: number; releve: boolean }>>(new Map());\n  useEffect(() => {\n    let actif = true;\n    void (async () => {\n      const {\n        data: { user },\n      } = await supabase.auth.getUser();\n      if (!user) return;\n      const [{ data: moiR }] = await Promise.all([supabase.from(\"collaborateurs\").select(\"role\").eq(\"auth_user_id\", user.id).maybeSingle(), chargerDroitsRoles()]);\n      if (!actif || !peut(moiR?.role ?? null, \"montantsAffaires\")) return;\n      setVoitMontants(true);\n      const n = (v: unknown) => Number(v) || 0;\n      const sansZ = (v: string | null | undefined) => String(v ?? \"\").replace(/^0+/, \"\");\n      const [sl, mt, pl, pm, pa] = await Promise.all([\n        chargerTout<{ id: string; cle: string; parent_cle: string | null; base_affaire: string | null; genre: string; date_livraison: string | null; disparue: boolean; statut: string | null }>((a, b) =>\n          supabase.from(\"suivi_lignes\").select(\"id,cle,parent_cle,base_affaire,genre,date_livraison,disparue,statut\").order(\"cle\").range(a, b)\n        ),\n        chargerTout<{ ligne_id: string; montant: number | string | null; montant_echeances: number | string | null }>((a, b) =>\n          supabase.from(\"suivi_lignes_montants\").select(\"ligne_id,montant,montant_echeances\").order(\"ligne_id\").range(a, b)\n        ),\n        chargerTout<{ id: string; affaire_id: string }>((a, b) => supabase.from(\"prestation_lignes\").select(\"id,affaire_id\").order(\"id\").range(a, b)),\n        chargerTout<{ ligne_id: string; montant_fige: number | string | null }>((a, b) => supabase.from(\"prestation_mois\").select(\"ligne_id,montant_fige\").eq(\"valide\", true).order(\"ligne_id\").range(a, b)),\n        chargerTout<{ id: string; numero: string }>((a, b) => supabase.from(\"pilotage_affaires\").select(\"id,numero\").eq(\"type\", \"CBE\").order(\"id\").range(a, b)),\n      ]);\n      if (!actif) return;\n      const montantDe = new Map(mt.map((m) => [m.ligne_id, { montant: n(m.montant), echeances: n(m.montant_echeances) }]));\n      const m = new Map<string, { montant: number; facture: number; releve: boolean }>();\n      const prendre = (b: string) => {\n        const v = m.get(b) ?? { montant: 0, facture: 0, releve: false };\n        m.set(b, v);\n        return v;\n      };\n      const valides = sl.filter((l) => !l.disparue && l.base_affaire && ![\"Devis perdu\", \"Commande annulée\"].includes(l.statut ?? \"\"));\n      // facturé au relevé (PE / PI) : mois clôturés, par famille\n      const baseAffaire = new Map(pa.map((a) => [a.id, sansZ(a.numero.match(/^\\d+/)?.[0] ?? a.numero)]));\n      const baseLigne = new Map(pl.map((l) => [l.id, baseAffaire.get(l.affaire_id) ?? \"\"]));\n      for (const x of pm) {\n        const b = baseLigne.get(x.ligne_id);\n        if (!b) continue;\n        const v = prendre(b);\n        v.facture += n(x.montant_fige);\n        v.releve = true;\n      }\n      for (const l of valides.filter((x) => x.genre === \"BASE\" || x.genre === \"AVENANT\")) {\n        const b = sansZ(l.base_affaire);\n        const v = prendre(b);\n        const mo = montantDe.get(l.id)?.montant ?? 0;\n        v.montant += mo;\n        if (v.releve) continue; // PE / PI : le facturé est celui du relevé\n        if (l.date_livraison) v.facture += mo;\n        else\n          for (const e of valides.filter((x) => (x.genre === \"ECHEANCE\" || x.genre === \"LOT\") && x.parent_cle === l.cle && x.date_livraison)) {\n            const me = montantDe.get(e.id);\n            v.facture += me ? me.echeances || me.montant : 0;\n          }\n      }\n      setMontantsFamille(m);\n    })();\n    return () => {\n      actif = false;\n    };\n  }, []);\n  const eurosA = (x: number) => x.toLocaleString(\"fr-FR\", { style: \"currency\", currency: \"EUR\", maximumFractionDigits: 0 });\n  const montantsDe = (a: AffaireP) => montantsFamille.get((a.numero.match(/^\\d+/)?.[0] ?? a.numero).replace(/^0+/, \"\"));", "chargement des montants (droit « montants »)");
    remplacerSouple(suivi, "<EnTeteTri col=\"depassement\" libelle=\"Dépassement\" num />", "<EnTeteTri col=\"depassement\" libelle=\"Dépassement\" num />\n            {voitMontants && <th style={thNum} title=\"Montant de la famille (commande et avenants), facturé, reste à facturer\">Montant · facturé</th>}", "colonne des montants : en-tête");
    remplacerSouple(suivi, "{bornes && ( <td style={tdNum}>{l.dansFamille ? gris(\"—\") : vl.periode > 0.01", "{/* MONTANTS_AFFAIRES : montant de la famille, facturé, reste à facturer, € / h réalisé */}\n                  {voitMontants && (\n                    <td style={tdNum}>\n                      {l.dansFamille ? (\n                        gris(`dans ${l.dansFamille}`)\n                      ) : (\n                        (() => {\n                          const mf = montantsDe(affaire);\n                          if (!mf || mf.montant <= 0.5) return gris(\"—\");\n                          const part = Math.min(1, mf.facture / mf.montant);\n                          const prest = affaire.imputation === \"PE\" || affaire.imputation === \"PI\";\n                          return (\n                            <div title={`Montant ${eurosA(mf.montant)} · facturé ${eurosA(mf.facture)} · reste à facturer ${eurosA(mf.montant - mf.facture)}${mf.releve ? \" (facturé au relevé PE / PI, mois clôturés)\" : \"\"}`} style={{ minWidth: 120 }}>\n                              <strong>{eurosA(mf.montant)}</strong>\n                              <div style={{ height: 5, background: \"#eceef1\", borderRadius: 3, margin: \"4px 0 2px\", overflow: \"hidden\" }}>\n                                <div style={{ width: `${part * 100}%`, height: \"100%\", background: \"#2e7d32\" }} />\n                              </div>\n                              <div style={petit}>\n                                facturé {eurosA(mf.facture)}\n                                {mf.montant - mf.facture > 0.5 ? ` · reste ${eurosA(mf.montant - mf.facture)}` : \" ✓\"}\n                              </div>\n                              {!prest && totaux.realise > 0.5 && <div style={petit}>{eurosA(mf.montant / totaux.realise)} / h réalisée</div>}\n                            </div>\n                          );\n                        })()\n                      )}\n                    </td>\n                  )}\n                  {bornes && (\n                    <td style={tdNum}>{l.dansFamille ? gris(\"—\") : vl.periode > 0.01", "colonne des montants : valeurs");
    remplacerSouple(suivi, "const nbColonnes = bornes ? 10 : 9;", "const nbColonnes = (bornes ? 10 : 9) + (voitMontants ? 1 : 0);", "colonne des montants : largeur du détail");
    remplacerSouple(suivi, "\"À affecter (h)\": arrondi(l.aAffecter),", "\"À affecter (h)\": arrondi(l.aAffecter),\n        ...(voitMontants\n          ? (() => {\n              const mf = l.dansFamille ? undefined : montantsDe(l.affaire);\n              return {\n                \"Montant (€)\": mf ? Math.round(mf.montant) : \"\",\n                \"Facturé (€)\": mf ? Math.round(mf.facture) : \"\",\n                \"Reste à facturer (€)\": mf ? Math.round(mf.montant - mf.facture) : \"\",\n                \"€ / h réalisée\": mf && l.totaux.realise > 0.5 && !(l.affaire.imputation === \"PE\" || l.affaire.imputation === \"PI\") ? Math.round(mf.montant / l.totaux.realise) : \"\",\n              };\n            })()\n          : {}),", "export : les montants");
  ecritures.push(suivi);
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
