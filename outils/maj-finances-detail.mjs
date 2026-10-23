/* ===============================================================
   Finances (app/analyse/finances/page.tsx) : montants cliquables (v3).
   Un clic sur un montant des lignes « Réalisé », « Attendu », « Réalisé
   par imputation » ou « Réalisé par activité » (dont « Non ventilé »)
   ouvre le détail sous le tableau : affaires, n° ARC Louxor, source,
   client, imputation, montants (et pour le non ventilé : pourquoi / où
   corriger). Colonnes triables, export Excel aux couleurs de POLYNOV
   (composant components/finances/DetailMontant.tsx).
   Fonctionne sur une page neuve comme sur une page qui a déjà reçu
   une version précédente de ce script.
   Utilisation (à la racine du projet) :  node outils/maj-finances-detail.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/analyse/finances/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
if (!existsSync("components/finances/DetailMontant.tsx") || !existsSync("lib/excelPolynov.ts")) {
  console.error("✗ Décompressez d'abord le zip à la racine du projet (DetailMontant.tsx et excelPolynov.ts manquent).");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("DETAIL_MONTANT_V3")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
const original = texte;
let erreurs = 0;
const ok = (m) => console.log(`✓ ${m}`);
const ko = (m) => {
  console.error(`✗ ${m}`);
  erreurs++;
};
const remplacerUneFois = (nom, cherche, remplace) => {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) return ko(`${nom} : passage trouvé ${nb} fois (attendu 1)`);
  texte = texte.replace(cherche, remplace);
  ok(nom);
};

// 1. import du composant
if (!texte.includes('from "@/components/finances/DetailMontant"')) {
  remplacerUneFois("Import du détail", 'import { supabase } from "@/lib/supabase";', 'import { supabase } from "@/lib/supabase";\nimport DetailMontant, { type DetailDemande } from "@/components/finances/DetailMontant";');
}

// 2. état du détail
const TYPE = "useState<DetailDemande | null>(null);";
if (texte.includes("const [detail, setDetail]")) {
  texte = texte.replace(/const \[detail, setDetail\] = useState<[^\n]*\| null>\(null\);/, `const [detail, setDetail] = ${TYPE}`);
  ok("État du détail (mis à niveau)");
} else {
  remplacerUneFois(
    "État du détail",
    "  const [voirAffaires, setVoirAffaires] = useState(false);",
    `  const [voirAffaires, setVoirAffaires] = useState(false);\n  // montant cliqué dans le tableau mois par mois (réalisé, attendu, imputation, activité)\n  const [detail, setDetail] = ${TYPE}`
  );
}

// 3. cases cliquables
if (!texte.includes("surClic?: (i: number) => void")) {
  remplacerUneFois(
    "Cases cliquables",
    `  const ligneValeurs = (libelle: string, valeurs: number[], style?: CSSProperties) => (
    <tr key={libelle}>
      <td style={{ ...tdG, ...style }}>{libelle}</td>
      {valeurs.map((v, i) => (
        <td key={i} style={{ ...td, ...style }}>{Math.abs(v) > 0.5 ? keuros(v) : "—"}</td>
      ))}`,
    `  const ligneValeurs = (libelle: string, valeurs: number[], style?: CSSProperties, surClic?: (i: number) => void) => (
    <tr key={libelle}>
      <td style={{ ...tdG, ...style }}>{libelle}</td>
      {valeurs.map((v, i) => (
        <td key={i} style={{ ...td, ...style }}>
          {Math.abs(v) > 0.5 && surClic ? (
            <button
              type="button"
              title="Voir le détail de ce montant"
              onClick={() => surClic(i)}
              style={{ all: "unset", cursor: "pointer", textDecoration: "underline dotted", color: libelle === "Non ventilé" ? "#7a3e00" : undefined, fontWeight: libelle === "Non ventilé" ? 800 : undefined }}
            >
              {keuros(v)}
            </button>
          ) : Math.abs(v) > 0.5 ? (
            keuros(v)
          ) : (
            "—"
          )}
        </td>
      ))}`
  );
}

// 4. lignes cliquables
const lignes = [
  ["Réalisé cliquable", '{ligneValeurs("Réalisé", vue.realise, { fontWeight: 800 })}', '{ligneValeurs("Réalisé", vue.realise, { fontWeight: 800 }, (i) => setDetail({ mois: mois[i], ligne: "REALISE" }))}'],
  ["Attendu cliquable", '{ligneValeurs("Attendu", vue.attendu, { color: "#a33a3a", fontStyle: "italic" })}', '{ligneValeurs("Attendu", vue.attendu, { color: "#a33a3a", fontStyle: "italic" }, (i) => setDetail({ mois: mois[i], ligne: "ATTENDU" }))}'],
  ["Imputations cliquables", "{vue.parImputation.map((r) => ligneValeurs(r.cle, r.valeurs))}", "{vue.parImputation.map((r) => ligneValeurs(r.cle, r.valeurs, undefined, (i) => setDetail({ mois: mois[i], imputation: r.cle })))}"],
  ["Activités cliquables", "{vue.parActivite.map((r) => ligneValeurs(r.cle, r.valeurs))}", "{vue.parActivite.map((r) => ligneValeurs(r.cle, r.valeurs, undefined, (i) => setDetail({ mois: mois[i], groupe: r.cle })))}"],
];
for (const [nom, avant, apres] of lignes) {
  if (texte.includes(apres)) ok(`${nom} (déjà fait)`);
  else remplacerUneFois(nom, avant, apres);
}

// 5. panneau : l'ancien (inline) est remplacé par le composant
const COMPOSANT = `
              {/* DETAIL_MONTANT_V3 : ce qui compose le montant cliqué */}
              {detail && <DetailMontant detail={detail} mouvements={mouvements} attendus={attendus.mouvements} onFermer={() => setDetail(null)} />}
`;
const debutAncien = texte.indexOf("              {/* DETAIL_CLIQUABLE");
if (debutAncien >= 0) {
  const fin = texte.indexOf("              })()}\n", debutAncien);
  if (fin < 0) ko("Ancien panneau de détail : fin introuvable");
  else {
    texte = texte.slice(0, debutAncien) + COMPOSANT.replace(/^\n/, "") + texte.slice(fin + "              })()}\n".length);
    ok("Panneau de détail remplacé");
  }
} else {
  const ancre = /(\{vue\.parActivite\.map[^\n]*\n\s*<\/tbody>\n\s*<\/table>\n)/;
  if (!ancre.test(texte)) ko("Fin du tableau mois par mois introuvable");
  else {
    texte = texte.replace(ancre, (m) => m + COMPOSANT);
    ok("Panneau de détail");
  }
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : montants cliquables dans Finances (Louxor, tri, export).");
