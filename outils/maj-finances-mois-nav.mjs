/* ===============================================================
   MAJ FINANCES - SE PROMENER DE MOIS EN MOIS (FINANCES_MOIS_NAV)

   Les vignettes et la barre du mois (dans la trame CA) :
   - flèches ◀ ▶ pour passer d'un mois à l'autre (on change d'exercice en
     passant octobre / novembre) ; par défaut le mois en cours ; en
     changeant d'exercice, on reste sur le même mois (novembre → novembre) ;
   - sous la barre du mois regardé, celles du même mois N-1 et N-2, à la
     même échelle, plus discrètes, avec leur montant : la comparaison
     d'un coup d'œil.

   À installer APRÈS maj-finances-trame.mjs.
   À lancer à la racine du projet :   node outils/maj-finances-mois-nav.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FICHIER = "app/analyse/finances/page.tsx";
const MARQUEUR = "FINANCES_MOIS_NAV";

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

const D = "  /* FINANCES_TRAME : vignettes et barre du mois en cours, affichées dans la trame CA */\n";
const F = "    return { vignettes, barre };\n  })();\n";
const i = t.indexOf(D);
const j = t.indexOf(F, i);
if (i < 0 || j < 0) echec(`${FICHIER} : installez d’abord maj-finances-trame.zip (vignettes et barre dans la trame).`);

const BLOC = `  /* ${MARQUEUR} : vignettes et barre du mois regardé (flèches), comparé au même mois N-1 et N-2 */
  const blocMois = (() => {
    const auto = Math.max(0, mois.findIndex((m) => m.slice(5, 7) === moisCourant.slice(5, 7)));
    const i = moisVu ?? auto;
    const anMoins = (m: string, n: number) => \`\${Number(m.slice(0, 4)) - n}\${m.slice(4)}\`;
    const stats = (m: string) => {
      const du = mouvements.filter((x) => x.date.startsWith(m));
      return {
        m,
        fait: du.reduce((s, x) => s + x.montant, 0),
        achats: du.reduce((s, x) => s + x.achats, 0),
        parAct: GROUPES.map((g) => ({ g, v: du.reduce((s, x) => s + x.parGroupe[g], 0) })).filter((x) => x.v > 0.5),
      };
    };
    const cur = stats(mois[i]);
    const n1 = stats(anMoins(mois[i], 1));
    const n2 = stats(anMoins(mois[i], 2));
    const attMois = attendus.mouvements.filter((x) => x.date.startsWith(mois[i]));
    const attenduM = attMois.reduce((s, x) => s + x.montant, 0);
    const achatsAtt = attMois.reduce((s, x) => s + x.achats, 0);
    const objectif = vue.prevu[i];
    const echelle = Math.max(objectif, cur.fait + Math.max(0, attenduM), n1.fait, n2.fait, 1);
    const ROUGES: Record<string, string> = { "Méca": "#8e0000", Calcul: "#b3261e", "Elec / Pneu": "#d9534f", Scan: "#e57f7a", "Négoce": "#efa29d", Autre: "#f4c3bf", "Non ventilé": "#f6d6d3" };
    const nomLong = (m: string) => new Date(\`\${m}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const nomCourt = (m: string) => new Date(\`\${m}-01T00:00:00\`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    const aller = (sens: 1 | -1) => {
      const k = i + sens;
      if (k < 0) {
        setExercice((e) => e - 1);
        setMoisVu(11);
      } else if (k > 11) {
        setExercice((e) => e + 1);
        setMoisVu(0);
      } else setMoisVu(k);
    };
    const etiquette: CSSProperties = { fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris };
    const vignette: CSSProperties = { ...page.carte, padding: "12px 16px", minWidth: 0 };
    const fleche: CSSProperties = { border: \`1.5px solid \${C.ligne}\`, background: "#ffffff", borderRadius: 6, minWidth: 28, height: 26, cursor: "pointer", color: C.rougeFonce, fontWeight: 800, fontFamily: "inherit" };
    const pastille = (fond: string) => <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: fond, marginRight: 5, verticalAlign: "middle" }} />;
    const barreDe = (s: ReturnType<typeof stats>, hauteur: number, principale: boolean) => (
      <div style={{ position: "relative", height: hauteur, background: "#f3f4f6", borderRadius: 6, overflow: "hidden", display: "flex", opacity: principale ? 1 : 0.55 }}>
        {s.parAct.map(({ g, v }) => (
          <div key={g} title={\`\${g} : \${euros(v)}\`} style={{ width: \`\${(v / echelle) * 100}%\`, background: ROUGES[g] ?? "#d9534f", borderRight: "1px solid #ffffff" }} />
        ))}
        {principale && attenduM > 0.5 && (
          <div title={\`Encore attendu : \${euros(attenduM)}\`} style={{ width: \`\${(attenduM / echelle) * 100}%\`, background: "repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 5px,#fbe6e6 5px,#fbe6e6 10px)" }} />
        )}
        {principale && objectif > 0 && (
          <div title={\`Objectif : \${euros(objectif)}\`} style={{ position: "absolute", left: \`calc(\${(objectif / echelle) * 100}% - 1.5px)\`, top: 0, bottom: 0, width: 3, background: "#1f2328" }} />
        )}
      </div>
    );
    const vignettes = (
      <>
        <div style={{ ...vignette, flex: "2 1 360px", borderTop: \`4px solid \${C.rouge}\` }}>
          <div style={{ ...etiquette, display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={fleche} onClick={() => aller(-1)} aria-label="Mois précédent" title="Mois précédent">
              ◀
            </button>
            <span>
              CA facturé · <span style={{ textTransform: "capitalize" }}>{nomLong(cur.m)}</span>
            </span>
            <button type="button" style={fleche} onClick={() => aller(1)} aria-label="Mois suivant" title="Mois suivant">
              ▶
            </button>
            {((moisVu !== null && i !== auto) || exercice !== exerciceCourant()) && (
              <button
                type="button"
                onClick={() => {
                  setMoisVu(null);
                  setExercice(exerciceCourant());
                }} style={{ all: "unset", cursor: "pointer", fontSize: 12, textTransform: "none", color: "#1f4e99", textDecoration: "underline" }}>
                mois en cours
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 26px", marginTop: 6 }}>
            <span>
              <strong style={{ fontSize: 24, color: "#b3261e" }}>{euros(cur.fait)}</strong> <span style={{ fontSize: 12, color: C.gris }}>avec achats</span>
            </span>
            <span title="CA facturé moins les achats revendus (négoce, sous-traitance)">
              <strong style={{ fontSize: 24, color: "#5d6b78" }}>{euros(cur.fait - cur.achats)}</strong> <span style={{ fontSize: 12, color: C.gris }}>hors achats</span>
            </span>
          </div>
        </div>
        <div style={{ ...vignette, flex: "1 1 190px" }}>
          <div style={etiquette}>Encore attendu</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{euros(attenduM)}</div>
          {achatsAtt > 0.5 && <div style={{ fontSize: 12, color: C.gris }}>{euros(attenduM - achatsAtt)} hors achats</div>}
        </div>
      </>
    );
    const ligneBarre = (s: ReturnType<typeof stats>, libelle: string, principale: boolean) => (
      <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 96px", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: principale ? 13 : 12, fontWeight: principale ? 800 : 600, color: principale ? C.rougeFonce : C.gris, textTransform: "capitalize" }}>{libelle}</span>
        {barreDe(s, principale ? 28 : 12, principale)}
        <span style={{ textAlign: "right", fontSize: principale ? 14 : 12, fontWeight: principale ? 800 : 600, color: principale ? "#1f2328" : C.gris }}>{keuros(s.fait)}</span>
      </div>
    );
    const barre = (
      <div style={{ margin: "0 0 14px", display: "grid", gap: 6 }}>
        {ligneBarre(cur, nomCourt(cur.m), true)}
        {ligneBarre(n1, \`N-1 · \${nomCourt(n1.m)}\`, false)}
        {ligneBarre(n2, \`N-2 · \${nomCourt(n2.m)}\`, false)}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5, marginTop: 4, color: "#3b4046" }}>
          {cur.parAct.map(({ g, v }) => (
            <span key={g}>
              {pastille(ROUGES[g] ?? "#d9534f")}
              {g} <strong>{keuros(v)}</strong>
            </span>
          ))}
          {attenduM > 0.5 && (
            <span>
              {pastille("repeating-linear-gradient(45deg,#f4c2c2,#f4c2c2 3px,#fbe6e6 3px,#fbe6e6 6px)")}
              attendu <strong>{keuros(attenduM)}</strong>
            </span>
          )}
          {objectif > 0 && (
            <span>
              <i style={{ display: "inline-block", width: 3, height: 12, background: "#1f2328", marginRight: 6, verticalAlign: "middle" }} />
              objectif <strong>{keuros(objectif)}</strong>
            </span>
          )}
        </div>
      </div>
    );
`;
t = t.slice(0, i) + BLOC + t.slice(j);

const ETAT = '  const [onglet, setOnglet] = useState<"CA" | "ACTIVITES">("CA"); // FINANCES_ONGLETS\n';
if (compter(t, ETAT) !== 1) echec(`${FICHIER} : état des onglets introuvable (installez maj-finances-onglets).`);
t = t.replace(ETAT, () => ETAT + `  const [moisVu, setMoisVu] = useState<number | null>(null); // ${MARQUEUR} : rang du mois regardé (null = mois en cours)\n`);

writeFileSync(FICHIER, t, "utf8");
console.log("✓ flèches pour passer de mois en mois (le même mois en changeant d’exercice)");
console.log("✓ sous la barre du mois : le même mois N-1 et N-2, à la même échelle");
console.log(`\n✓ ${FICHIER} mis à jour. Lancez maintenant : npm run build`);
