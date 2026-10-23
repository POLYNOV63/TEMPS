/* ===============================================================
   Feuilles d'heures : champ « Sous-dossier » (texte libre, facultatif)
   sur chaque ligne d'imputation d'une affaire (CBE / DBE).
   - app/ma-semaine/GrilleSemaine.tsx : le champ sous les heures ;
   - app/ma-semaine/MaSemaineContent.tsx : lecture et enregistrement
     (colonne sous_dossier, créée par le SQL 55).
   Utilisation (à la racine du projet) :  node outils/maj-sous-dossier.mjs
   Le script vérifie tout avant d'écrire ; copies .bak gardées.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const fichiers = {
  grille: "app/ma-semaine/GrilleSemaine.tsx",
  page: "app/ma-semaine/MaSemaineContent.tsx",
};
for (const f of Object.values(fichiers)) {
  if (!existsSync(f)) {
    console.error(`✗ Fichier introuvable : ${f} (lancez le script depuis la racine du projet)`);
    process.exit(1);
  }
}
const textes = Object.fromEntries(Object.entries(fichiers).map(([k, f]) => [k, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));
const originaux = { ...textes };
if (textes.grille.includes("SOUS_DOSSIER") && textes.page.includes("SOUS_DOSSIER")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(cible, nom, cherche, remplace) {
  const nb = textes[cible].split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  textes[cible] = textes[cible].replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}

/* ---------------- GrilleSemaine.tsx ---------------- */
remplacer(
  "grille",
  "Grille : type de modification",
  `export type ModificationLigne = Partial<Pick<LigneGrille, "activiteId" | "code" | "heures">>;`,
  `/* SOUS_DOSSIER : texte libre facultatif, précisant le sous-dossier de l'affaire */
export type ModificationLigne = Partial<Pick<LigneGrille, "activiteId" | "code" | "heures">> & { sousDossier?: string };`
);
remplacer(
  "grille",
  "Grille : propriétés de la ligne",
  `  onHeures,
  onSupprimer,
}: {`,
  `  onHeures,
  sousDossier,
  onSousDossier,
  onSupprimer,
}: {`
);
remplacer(
  "grille",
  "Grille : types des propriétés",
  `  onHeures: (texte: string) => void;
  onSupprimer: (() => void) | null;
}) {`,
  `  onHeures: (texte: string) => void;
  sousDossier: string;
  onSousDossier: (texte: string) => void;
  onSupprimer: (() => void) | null;
}) {`
);
remplacer(
  "grille",
  "Grille : champ Sous-dossier",
  `            ×
          </button>
        )}
      </div>
    </div>
  );
}`,
  `            ×
          </button>
        )}
      </div>

      {!replie && !brouillon && !divers && (
        <input
          aria-label={\`Sous-dossier, \${nom}, \${jour.libelle}\`}
          title="Sous-dossier de l'affaire sur lequel vous avez travaillé (facultatif)"
          placeholder="Sous-dossier (facultatif)"
          value={sousDossier}
          disabled={lectureSeule}
          onChange={(e) => onSousDossier(e.target.value)}
          style={{
            ...champ(mobile),
            width: "100%",
            minHeight: mobile ? 40 : 28,
            fontSize: mobile ? 15 : 12,
            marginTop: 4,
            padding: "0 6px",
            borderColor: "#d5d9de",
            background: "#fcfcfd",
          }}
        />
      )}
    </div>
  );
}`
);
remplacer(
  "grille",
  "Grille : lecture du sous-dossier",
  `  const entrees = brouillon ? [modele] : lignes;`,
  `  const entrees = brouillon ? [modele] : lignes;

  // sous-dossier de la ligne (porté par l'imputation de la feuille)
  const sousDossierDe = (id: string) => {
    const trouvee = [...(jour.imputations as unknown as { id: string; sousDossier?: string }[]), ...(lignes as unknown as { id: string; sousDossier?: string }[])].find((l) => l.id === id);
    return String(trouvee?.sousDossier ?? "");
  };`
);
remplacer(
  "grille",
  "Grille : saisie du sous-dossier",
  `          onHeures={(heures) => modifier(ligne, { heures })}`,
  `          onHeures={(heures) => modifier(ligne, { heures })}
          sousDossier={sousDossierDe(ligne.id)}
          onSousDossier={(sousDossier) => modifier(ligne, { sousDossier })}`
);

/* ---------------- MaSemaineContent.tsx ---------------- */
remplacer(
  "page",
  "Feuille : type de ligne",
  `  code: string;
  heures: string;
};

type JourSemaine = {`,
  `  code: string;
  heures: string;
  /* SOUS_DOSSIER : sous-dossier de l'affaire (texte libre, facultatif) */
  sousDossier?: string;
};

type JourSemaine = {`
);
remplacer(
  "page",
  "Feuille : lecture",
  `              description:
                i.description ??
                "",
`,
  `              description:
                i.description ??
                "",

              sousDossier: i.sous_dossier ?? "",
`
);
remplacer(
  "page",
  "Feuille : type d'enregistrement",
  `        description: string | null;
        code: string;
        heures: number;
      }[] = [];`,
  `        description: string | null;
        code: string;
        heures: number;
        sous_dossier: string | null;
      }[] = [];`
);
remplacer(
  "page",
  "Feuille : enregistrement",
  `            description: ligne.description || null,
            code: ligne.code,
            heures: convertirHeures(ligne.heures),
          });`,
  `            description: ligne.description || null,
            code: ligne.code,
            heures: convertirHeures(ligne.heures),
            sous_dossier:
              ligne.typeAffaire === "Divers"
                ? null
                : ligne.sousDossier?.trim() || null,
          });`
);

if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
for (const [k, f] of Object.entries(fichiers)) {
  writeFileSync(`${f}.bak`, originaux[k], "utf8");
  writeFileSync(f, textes[k], "utf8");
}
console.log("\nTerminé : champ « Sous-dossier » dans les feuilles d'heures.");
