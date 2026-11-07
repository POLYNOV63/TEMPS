/* ===============================================================
   MAJ CHARGE PAR RESSOURCE - RECHERCHE, FILTRES, TRIS, ACTIVITÉS
   (CHARGE_TRI_FILTRE)

   Tableau « Détail » :
   - barre d'outils : recherche d'un collaborateur, filtre d'état
     (surcharge / disponible / complet), filtre d'activité ;
   - tri en cliquant sur les titres (Ressource, Charge, Écart), ou
     « par activité » (par défaut) : les personnes rangées sous leur
     activité principale, avec pour chaque activité affecté / capacité,
     % de charge et disponibilité ;
   - titres de colonnes centrés, colonne Charge plus large.

   À lancer à la racine du projet, APRÈS maj-ressources-largeurs.mjs :
       node outils/maj-ressources-tri-filtres.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/pilotage/ressources/page.tsx";
const MARQUEUR = "CHARGE_TRI_FILTRE";
const TH = '{{ ...page.th, position: "sticky", top: 50, zIndex: 5, background: "#f1f2f4"';

const CODE = `
  /* CHARGE_TRI_FILTRE : recherche, filtres d'état et d'activité, tri, regroupement par activité principale */
  const [rechDetail, setRechDetail] = useState("");
  const [filtreEtat, setFiltreEtat] = useState<"TOUS" | "SURCHARGE" | "DISPONIBLE" | "COMPLET">("TOUS");
  const [filtreAct, setFiltreAct] = useState("");
  const [triDetail, setTriDetail] = useState<{ cle: "ACTIVITE" | "NOM" | "CHARGE" | "ECART"; sens: 1 | -1 }>({ cle: "ACTIVITE", sens: 1 });
  const lignesDetail = useMemo(() => {
    const parId = new Map(groupesRep.activites.map((a) => [a.id, a]));
    const activiteDe = (id: string) => {
      const a = parId.get(groupesRep.predo.get(id) ?? "");
      return a ? { cle: a.id, nom: a.nom, ordre: a.ordre } : { cle: "_", nom: "Sans activité principale", ordre: 9999 };
    };
    const etat = (l: (typeof lignes)[number]) =>
      !l.collab.inclus_statistiques ? "ENCADREMENT" : l.semaine.ecart > 0.01 ? "SURCHARGE" : l.semaine.ecart < -0.01 ? "DISPONIBLE" : "COMPLET";
    const taux = (l: (typeof lignes)[number]) => (l.semaine.net > 0 ? l.semaine.affecte / l.semaine.net : 0);
    const q = rechDetail.trim().toLowerCase();
    const res = lignes
      .filter((l) => !q || \`\${l.collab.trigramme ?? ""} \${l.collab.prenom ?? ""} \${l.collab.nom ?? ""}\`.toLowerCase().includes(q))
      .filter((l) => filtreEtat === "TOUS" || etat(l) === filtreEtat)
      .map((l) => ({ ...l, activite: activiteDe(l.collab.id) }))
      .filter((l) => !filtreAct || l.activite.cle === filtreAct);
    const nom = (l: (typeof res)[number]) => nomCollab(l.collab);
    const s = triDetail.sens;
    res.sort((a, b) => {
      if (triDetail.cle === "NOM") return s * nom(a).localeCompare(nom(b), "fr");
      if (triDetail.cle === "CHARGE") return s * (taux(a) - taux(b)) || nom(a).localeCompare(nom(b), "fr");
      if (triDetail.cle === "ECART") return s * (a.semaine.ecart - b.semaine.ecart) || nom(a).localeCompare(nom(b), "fr");
      return (
        s * (a.activite.ordre - b.activite.ordre) ||
        a.activite.nom.localeCompare(b.activite.nom, "fr") ||
        Number(b.collab.inclus_statistiques) - Number(a.collab.inclus_statistiques) ||
        nom(a).localeCompare(nom(b), "fr")
      );
    });
    return res;
  }, [lignes, rechDetail, filtreEtat, filtreAct, triDetail, groupesRep]);
  const enteteTri = (cle: "NOM" | "CHARGE" | "ECART", libelle: string) => (
    <button
      type="button"
      title="Trier"
      onClick={() => setTriDetail((t) => ({ cle, sens: t.cle === cle ? (t.sens === 1 ? -1 : 1) : cle === "NOM" ? 1 : -1 }))}
      style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      {libelle} {triDetail.cle === cle ? (triDetail.sens === 1 ? "▲" : "▼") : <span style={{ color: "#b9bec5" }}>↕</span>}
    </button>
  );
`;

const BARRE = `          {/* CHARGE_TRI_FILTRE : recherche, filtres, regroupement */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              type="search"
              value={rechDetail}
              onChange={(e) => setRechDetail(e.target.value)}
              placeholder="Rechercher un collaborateur…"
              aria-label="Rechercher un collaborateur"
              style={{ ...page.entrees, width: 220, minHeight: 34 }}
            />
            {(
              [
                ["TOUS", "Tous"],
                ["SURCHARGE", "En surcharge"],
                ["DISPONIBLE", "Disponibles"],
                ["COMPLET", "Complets"],
              ] as const
            ).map(([v, lib]) => (
              <button
                key={v}
                type="button"
                aria-pressed={filtreEtat === v}
                onClick={() => setFiltreEtat(v)}
                style={{ ...page.btnSecondaire, minHeight: 34, padding: "0 10px", background: filtreEtat === v ? C.rouge : "#ffffff", color: filtreEtat === v ? "#ffffff" : C.rougeFonce, borderColor: filtreEtat === v ? C.rouge : undefined }}
              >
                {lib}
              </button>
            ))}
            <select
              value={filtreAct}
              onChange={(e) => setFiltreAct(e.target.value)}
              aria-label="Filtrer par activité"
              style={{ minHeight: 34, borderRadius: 8, border: "1.5px solid #b9bec5", fontFamily: "inherit", fontWeight: 700, padding: "0 6px" }}
            >
              <option value="">Toutes les activités</option>
              {[...groupesRep.activites]
                .sort((a, b) => a.ordre - b.ordre)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
            </select>
            <button
              type="button"
              aria-pressed={triDetail.cle === "ACTIVITE"}
              onClick={() => setTriDetail({ cle: "ACTIVITE", sens: 1 })}
              style={{ ...page.btnSecondaire, minHeight: 34, padding: "0 10px", background: triDetail.cle === "ACTIVITE" ? C.rouge : "#ffffff", color: triDetail.cle === "ACTIVITE" ? "#ffffff" : C.rougeFonce, borderColor: triDetail.cle === "ACTIVITE" ? C.rouge : undefined }}
            >
              Par activité
            </button>
            <span style={{ fontSize: 12, color: C.gris }}>
              {lignesDetail.length} personne{lignesDetail.length > 1 ? "s" : ""} · cliquez sur un titre de colonne pour trier
            </span>
          </div>

`;

const remplacements = [
  {
    nom: "recherche, filtres et tris",
    cherche: "  }, [semaines12, equipe12, capacites, joursAffectes, jours, affectationsParId, affairesParId, realiseRep, groupesRep, lundiActuelRep]);\n",
    remplace: (x) => x + CODE,
  },
  {
    nom: "barre d'outils au-dessus du tableau",
    cherche: "          {/* DETAIL_COMPACT : sans ascenseur horizontal, titres figés */}\n",
    remplace: (x) => BARRE + x,
  },
  {
    nom: "colonne Charge plus large",
    cherche: "                <col style={{ width: 210 }} />\n",
    remplace: () => "                <col style={{ width: 300 }} />\n",
  },
  {
    nom: "titre Ressource (tri)",
    cherche: `<th style=${TH} }}>Ressource</th>`,
    remplace: () => `<th style=${TH}, textAlign: "center" }}>{enteteTri("NOM", "Ressource")}</th>`,
  },
  {
    nom: "titre Affecté / capacité centré",
    cherche: `<th style=${TH}, textAlign: "right" }} title=`,
    remplace: () => `<th style=${TH}, textAlign: "center" }} title=`,
  },
  {
    nom: "titre Charge (tri)",
    cherche: `<th style=${TH} }}>Charge</th>`,
    remplace: () => `<th style=${TH}, textAlign: "center" }}>{enteteTri("CHARGE", "Charge")}</th>`,
  },
  {
    nom: "titre Écart (tri)",
    cherche: `<th style=${TH} }}>Écart</th>`,
    remplace: () => `<th style=${TH}, textAlign: "center" }}>{enteteTri("ECART", "Écart")}</th>`,
  },
  {
    nom: "titre Affectations centré",
    cherche: `<th style=${TH} }}>\n                    Affectations{" "}`,
    remplace: () => `<th style=${TH}, textAlign: "center" }}>\n                    Affectations{" "}`,
  },
  {
    nom: "lignes triées et filtrées",
    cherche: "                {lignes.map((l, idx) => {\n                  const encadrement = !l.collab.inclus_statistiques;",
    remplace: () => "                {lignesDetail.map((l, idx) => {\n                  const encadrement = !l.collab.inclus_statistiques;",
  },
  {
    nom: "en-tête de chaque activité",
    cherche: '                  return (\n                    <tr key={l.collab.id} style={{ background: idx % 2 ? "#fafbfc" : "#ffffff" }}>',
    remplace: () =>
      `                  const groupeNouveau = triDetail.cle === "ACTIVITE" && (idx === 0 || lignesDetail[idx - 1].activite.cle !== l.activite.cle);
                  return (
                    <Fragment key={l.collab.id}>
                    {groupeNouveau &&
                      (() => {
                        const du = lignesDetail.filter((x) => x.activite.cle === l.activite.cle && x.collab.inclus_statistiques);
                        const aff = du.reduce((t, x) => t + x.semaine.affecte, 0);
                        const net = du.reduce((t, x) => t + x.semaine.net, 0);
                        const dispo = net - aff;
                        return (
                          <tr>
                            <td colSpan={6} style={{ padding: "8px 8px 5px", background: "#eef0f3", borderTop: \`2px solid \${C.ligne}\` }}>
                              <strong style={{ color: C.rougeFonce, textTransform: "uppercase", fontSize: 13, letterSpacing: ".4px" }}>{l.activite.nom}</strong>
                              <span style={{ marginLeft: 12, fontSize: 13, color: "#3b4046" }}>
                                {du.length} pers. · {formatHeures(aff)} / {formatHeures(net)}
                                {net > 0 && <> · charge <strong>{Math.round((aff / net) * 100)} %</strong></>} ·{" "}
                                <strong style={{ color: dispo >= -0.01 ? "#1b5e20" : "#8f1010" }}>
                                  {dispo >= -0.01 ? \`disponible \${formatHeures(Math.max(0, dispo))}\` : \`surcharge \${formatHeures(-dispo)}\`}
                                </strong>
                              </span>
                            </td>
                          </tr>
                        );
                      })()}
                    <tr style={{ background: idx % 2 ? "#fafbfc" : "#ffffff" }}>`,
  },
  {
    nom: "fin de ligne",
    cherche:
      "                    </tr>\n                  );\n                })}\n                <tr>\n                  <td style={{ ...page.td, background: \"#f8f9fa\" }}><strong>Équipe BE</strong></td>",
    remplace: () =>
      "                    </tr>\n                    </Fragment>\n                  );\n                })}\n                <tr>\n                  <td style={{ ...page.td, background: \"#f8f9fa\" }}><strong>Équipe BE</strong></td>",
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
if (!t.includes("LARGEURS_DETAIL")) echec("lancez d'abord les scripts précédents du tableau (jusqu'à maj-ressources-largeurs.mjs).");
for (const r of remplacements) {
  const n = t.split(r.cherche).length - 1;
  if (n !== 1) echec(`${FICHIER} : passage « ${r.nom} » trouvé ${n} fois (attendu : 1).`);
}
for (const r of remplacements) {
  t = t.replace(r.cherche, (x) => r.remplace(x));
  console.log(`✓ ${r.nom}`);
}
writeFileSync(FICHIER, t, "utf8");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
