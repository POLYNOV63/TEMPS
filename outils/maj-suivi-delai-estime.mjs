/* ===============================================================
   MAJ SUIVI DES AFFAIRES - LE DÉLAI ESTIMÉ FAIT FOI (DELAI_ESTIME)

   Dans le Suivi des affaires, la colonne « Délai » d'une commande (CBE)
   devient le DÉLAI ESTIMÉ (« Date de livraison estimée » du Suivi
   d'affaire BE, celle qu'on tient à jour dans Excel), et c'est lui qui
   sert à l'état (en retard, critique…) et au tri. Le délai CLIENT (celui
   de la commande, colonne « Délai ») s'affiche en petit dessous, pour
   mémoire, quand il est différent. Sans délai estimé, on garde le délai
   connu jusqu'ici.

   À lancer à la racine du projet :   node outils/maj-suivi-delai-estime.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/page.tsx";
const MARQUEUR = "DELAI_ESTIME";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;

if (!existsSync(FICHIER)) echec(`Fichier introuvable : ${FICHIER} (lancez la commande à la racine du projet).`);
let t = readFileSync(FICHIER, "utf8").replace(/\r\n/g, "\n");
if (t.includes(MARQUEUR)) {
  console.log(`✓ ${FICHIER} : déjà à jour, rien à faire.`);
  process.exit(0);
}

const R = [
  ["type de ligne", "  aAffecter: number; // heures de CETTE commande restant à mettre au planning\n", `  aAffecter: number; // heures de CETTE commande restant à mettre au planning\n  delaiClient?: string | null; // ${MARQUEUR} : délai de la commande (client), pour mémoire\n`],
  [
    "état des délais",
    "  const [recherche, setRecherche] = useState(\"\");\n",
    `  const [recherche, setRecherche] = useState("");\n  /* ${MARQUEUR} : délai estimé et délai client de chaque commande (Suivi d'affaire BE), par n° (« 1604R2 ») */\n  const [delaisSuivi, setDelaisSuivi] = useState<Map<string, { estime: string | null; client: string | null }>>(new Map());\n`,
  ],
  [
    "lecture du Suivi d'affaire",
    '            chargerTout<{ base_affaire: string | null; base_devis: string | null; genre: string; client_id: string }>((de, a) =>\n              supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id").order("cle").range(de, a)\n            ),',
    '            chargerTout<{ base_affaire: string | null; base_devis: string | null; genre: string; client_id: string; numero_affaire: string | null; delai: string | null; date_livraison_estimee: string | null }>((de, a) =>\n              supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id,numero_affaire,delai,date_livraison_estimee").order("cle").range(de, a)\n            ),',
  ],
  [
    "délais par commande",
    "          setClientsParAffaire({ cbe, dbe });\n",
    `          setClientsParAffaire({ cbe, dbe });
          const delais = new Map<string, { estime: string | null; client: string | null }>();
          for (const l of sl)
            if (l.numero_affaire && (l.genre === "BASE" || l.genre === "AVENANT"))
              delais.set(l.numero_affaire.toUpperCase().replace(/^\\s*CBE\\s*/, "").replace(/^0+/, ""), { estime: l.date_livraison_estimee?.slice(0, 10) ?? null, client: l.delai?.slice(0, 10) ?? null });
          setDelaisSuivi(delais);
`,
  ],
  [
    "délai estimé de chaque commande",
    "    const brut: Ligne[] = affaires.map((affaire) => {\n",
    `    const brut: Ligne[] = affaires.map((affaireBrute) => {
      // ${MARQUEUR} : le délai estimé (Excel) fait foi pour l'état et le tri ; le délai client reste pour mémoire
      const dsE = affaireBrute.type === "CBE" ? delaisSuivi.get(affaireBrute.numero.toUpperCase().replace(/^0+/, "")) : undefined;
      const affaire = dsE?.estime ? { ...affaireBrute, echeance: dsE.estime } : affaireBrute;
`,
  ],
  ["délai client dans la ligne", "        aAffecter: totaux.reste - p.planifie,\n      } as Ligne;", "        aAffecter: totaux.reste - p.planifie,\n        delaiClient: dsE?.client ?? null,\n      } as Ligne;"],
  ["dépendances", "  }, [affaires, charges, realise, planifies, imputations, clientsParAffaire, nomsActivites]);", "  }, [affaires, charges, realise, planifies, imputations, clientsParAffaire, nomsActivites, delaisSuivi]);"],
  ["titre de la colonne", '            <EnTeteTri col="echeance" libelle="Délai" />', '            <EnTeteTri col="echeance" libelle="Délai estimé" />'],
  [
    "délai client sous le délai",
    '                          : ""}\n                    </div>\n                  </td>\n                  {/* PORTEFEUILLE_V2',
    `                          : ""}
                    </div>
                    {l.delaiClient && l.delaiClient !== affaire.echeance && affaire.statut !== "LIVREE" && (
                      <div style={petit} title="Délai client : celui de la commande (colonne « Délai » du Suivi d’affaire BE)">
                        client : {formatDate(l.delaiClient)}
                      </div>
                    )}
                  </td>
                  {/* PORTEFEUILLE_V2`,
  ],
];
for (const [nom, a] of R) if (compter(t, a) !== 1) echec(`${FICHIER} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
for (const [, a, b] of R) t = t.replace(a, () => b);
writeFileSync(FICHIER, t, "utf8");
console.log("✓ Suivi des affaires : le délai estimé fait foi, le délai client en petit dessous");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
