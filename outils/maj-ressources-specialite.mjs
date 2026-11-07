/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - ACTIVITÉ DE SPÉCIALITÉ (ACTIVITE_SPECIALITE)

   Une personne peut avoir plusieurs activités principales (AMZ et MMO :
   Mécanique ET Calcul). Le tableau de détail la range maintenant dans la
   PLUS RARE de ses activités parmi Méca / Elec / Calcul, c'est-à-dire sa
   spécialité : AMZ et MMO passent en Calcul. FVI, MCO (Mécanique +
   Pneumatique), CBL, PLG (Mécanique + Négoce) restent en Mécanique.

   À lancer à la racine du projet, APRÈS maj-ressources-activites-be.mjs :
       node outils/maj-ressources-specialite.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "ACTIVITE_SPECIALITE";

const remplacements = [
  {
    nom: "toutes les activités principales de chacun",
    cherche: "  const lignesDetail = useMemo(() => {\n",
    remplace: `  // ACTIVITE_SPECIALITE : toutes les activités principales de chacun ; avec plusieurs, la personne est rangée dans
  // la plus rare parmi Méca / Elec / Calcul (sa spécialité)
  const [principales, setPrincipales] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    void supabase
      .from("collaborateurs_predominances")
      .select("collaborateur_id,activite_id")
      .eq("niveau", "PRINCIPALE")
      .then(({ data }) => {
        const m = new Map<string, string[]>();
        for (const x of (data ?? []) as { collaborateur_id: string; activite_id: string }[]) m.set(x.collaborateur_id, [...(m.get(x.collaborateur_id) ?? []), x.activite_id]);
        setPrincipales(m);
      });
  }, []);
  const lignesDetail = useMemo(() => {
`,
  },
  {
    nom: "activité de spécialité",
    cherche: '    const activiteDe = (id: string) => {\n      const a = parId.get(groupesRep.predo.get(id) ?? "");',
    remplace: `    const nbTitulaires = new Map<string, number>();
    for (const ids of principales.values()) for (const x of ids) nbTitulaires.set(x, (nbTitulaires.get(x) ?? 0) + 1);
    const activiteDe = (id: string) => {
      const be = (principales.get(id) ?? [])
        .filter((x) => estActiviteBE(parId.get(x)?.nom ?? ""))
        .sort((x, y) => (nbTitulaires.get(x) ?? 0) - (nbTitulaires.get(y) ?? 0));
      const a = parId.get(be[0] ?? groupesRep.predo.get(id) ?? "");`,
  },
  {
    nom: "recalcul quand les activités arrivent",
    cherche: "  }, [lignes, rechDetail, filtreEtat, filtreAct, triDetail, groupesRep]);",
    remplace: "  }, [lignes, rechDetail, filtreEtat, filtreAct, triDetail, groupesRep, principales]);",
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
if (!t.includes("ACTIVITES_BE")) echec("lancez d'abord : node outils/maj-ressources-activites-be.mjs");
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, () => r.remplace);
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
