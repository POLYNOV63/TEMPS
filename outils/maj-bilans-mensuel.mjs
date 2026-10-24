/* ===============================================================
   Charge & pointage, par collaborateur (app/admin/bilans/page.tsx) :
   l'histogramme « Charge dans le temps » s'affiche PAR MOIS par défaut,
   avec un bouton pour revenir à l'affichage PAR SEMAINE.
   Une barre de mois = la somme de ses semaines (semaine rangée dans le
   mois de son lundi), toujours ramenée à 100 % de la capacité du mois.
   Utilisation (à la racine du projet) :  node outils/maj-bilans-mensuel.mjs
   Le script vérifie tout avant d'écrire ; copie .bak gardée.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/admin/bilans/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("HISTOGRAMME_MENSUEL")) {
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

// 1. l'ancien graphique devient « ChargeTimelineBrut » ; un nouveau ChargeTimeline regroupe par mois
const debutFonction = texte.indexOf("function ChargeTimeline({");
const debutCourbe = texte.indexOf("const MOIS_COURTS = [");
if (debutFonction < 0 || debutCourbe < 0 || debutCourbe < debutFonction) {
  ko("Graphique « Charge dans le temps » introuvable");
} else {
  let bloc = texte.slice(debutFonction, debutCourbe);
  bloc = bloc.replace("function ChargeTimeline({", "function ChargeTimelineBrut({");

  // étiquette sous chaque barre : « S43 » ou « oct. 26 »
  const etiquette = /S\s*\{\s*s\.semaine\s*\}/;
  if (!etiquette.test(bloc)) ko("Étiquette « S{semaine} » du graphique introuvable");
  else {
    bloc = bloc.replace(etiquette, "{(s as SemaineConsolidee & { libelle?: string }).libelle ?? `S${s.semaine}`}");
    ok("Étiquettes des barres");
  }

  // titre : une barre n'est plus forcément une semaine
  const titre = /Chaque semaine = 100 % de\s*capacité/;
  if (titre.test(bloc)) {
    bloc = bloc.replace(titre, "Chaque barre = 100 % de capacité");
    ok("Titre du graphique");
  }

  const nouveau = `/* HISTOGRAMME_MENSUEL : par mois (par défaut) ou par semaine */
function ChargeTimeline({
  semaines,
}: {
  semaines: SemaineConsolidee[];
}) {
  const [regroupement, setRegroupement] = useState<"MOIS" | "SEMAINE">("MOIS");

  const colonnes = useMemo(() => {
    if (regroupement === "SEMAINE") return semaines;

    const parMois = new Map<string, SemaineConsolidee & { libelle: string }>();
    for (const s of [...semaines].sort((a, b) => a.annee - b.annee || a.semaine - b.semaine)) {
      const lundi = lundiSemaine(s.annee, s.semaine);
      const annee = lundi.getUTCFullYear();
      const mois = lundi.getUTCMonth();
      const cle = \`\${annee}-\${String(mois + 1).padStart(2, "0")}\`;
      const m = parMois.get(cle) ?? {
        ...s,
        annee,
        semaine: 100 + mois, // sert seulement de clé
        libelle: \`\${MOIS_COURTS[mois]} \${String(annee).slice(2)}\`,
        capacite: 0,
        cbe: 0,
        dbe: 0,
        ni: 0,
        cn: 0,
        formation: 0,
        autres: 0,
        ignorees: 0,
        affairesSansType: 0,
        heuresAbsence: 0,
        totalTravaille: 0,
        nonExplique: 0,
        collaborateurs: {},
      };
      m.capacite += s.capacite;
      m.cbe += s.cbe;
      m.dbe += s.dbe;
      m.ni += s.ni;
      m.cn += s.cn;
      m.formation += s.formation;
      m.autres += s.autres;
      m.ignorees += s.ignorees;
      m.affairesSansType += s.affairesSansType;
      m.heuresAbsence += s.heuresAbsence;
      m.totalTravaille += s.totalTravaille;
      m.nonExplique += s.nonExplique;
      parMois.set(cle, m);
    }
    return [...parMois.values()];
  }, [semaines, regroupement]);

  return (
    <>
      <div style={{ ...styles.periodButtons, marginTop: 18, marginBottom: -8 }}>
        {(["MOIS", "SEMAINE"] as const).map((valeur) => (
          <button
            key={valeur}
            type="button"
            onClick={() => setRegroupement(valeur)}
            style={{ ...styles.periodButton, ...(regroupement === valeur ? styles.periodButtonActive : {}) }}
          >
            {valeur === "MOIS" ? "Barres par mois" : "Barres par semaine"}
          </button>
        ))}
      </div>
      <ChargeTimelineBrut semaines={colonnes} />
    </>
  );
}

`;
  texte = texte.slice(0, debutFonction) + nouveau + bloc + texte.slice(debutCourbe);
  ok("Bouton Mois / Semaine, mois par défaut");
}

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(`${chemin}.bak`, original, "utf8");
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : histogramme par mois (ou par semaine).");
