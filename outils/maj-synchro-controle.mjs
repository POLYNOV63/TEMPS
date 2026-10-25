/* ===============================================================
   Synchronisation du Suivi d'affaire (app/admin/synchro-suivi-affaires/
   page.tsx) : bloc « Contrôle pour la facturation » en bas de page
   (composant components/ControleSuiviAffaire.tsx), recalculé après
   chaque synchronisation.
   Utilisation (à la racine du projet) :  node outils/maj-synchro-controle.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/admin/synchro-suivi-affaires/page.tsx";
if (!existsSync(chemin) || !existsSync("components/ControleSuiviAffaire.tsx")) {
  console.error("✗ Fichier introuvable : décompressez le zip à la racine du projet, puis relancez.");
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("ControleSuiviAffaire")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}
let erreurs = 0;
function remplacer(nom, cherche, remplace) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    return;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}
remplacer(
  "Import du contrôle",
  `import GardeAcces from "@/components/GardeAcces";`,
  `import GardeAcces from "@/components/GardeAcces";
import ControleSuiviAffaire from "@/components/ControleSuiviAffaire";`
);
remplacer(
  "Bloc en bas de page",
  `          )}
        </section>
      </div>
    </main>
  );
}`,
  `          )}
        </section>

        {/* contrôle pour la facturation, recalculé après chaque synchronisation */}
        <ControleSuiviAffaire actualisation={journal[0]?.id ?? ""} />
      </div>
    </main>
  );
}`
);
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : contrôle pour la facturation sur la page de synchronisation.");
