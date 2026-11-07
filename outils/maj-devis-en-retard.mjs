/* ===============================================================
   MAJ FEUILLE DE ROUTE - DEVIS EN RETARD EN ROUGE (DEVIS_EN_RETARD)

   Un devis (DBE) dont la date de rendu (📌) est dépassée et qui n'est
   toujours pas envoyé reste dans la feuille de route, sur la semaine en
   cours, EN ROUGE : « devis en retard, pas encore envoyé », « ⚠ à
   envoyer » sur le jour d'aujourd'hui, « en retard depuis le … ».
   Il disparaît quand le devis passe au statut envoyé.
   Page « Ma feuille de route » et encart du tableau de bord.

   À lancer à la racine du projet :   node outils/maj-devis-en-retard.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "DEVIS_EN_RETARD";
const FICHIERS = [
  { f: "app/ma-feuille-de-route/page.tsx", auj: "iso(new Date())", taille: 12 },
  { f: "components/FeuilleDeRouteDashboard.tsx", auj: "aujourdhui", taille: 11 },
];
// le bloc des devis de chaque semaine, de « {s.aRendre.map((d) => ( » jusqu'à sa fermeture
const BLOC = /\{s\.aRendre\.map\(\(d\) => \(\n[\s\S]*?<\/tr>\n\s*\)\)\}/g;

const nouveau = (auj, taille) => `{s.aRendre.map((d) => {
                        // DEVIS_EN_RETARD : rendu dépassé et devis pas encore envoyé : en rouge, jusqu'à l'envoi
                        const aujourd = ${auj};
                        const retard = Boolean(d.echeance && d.echeance < aujourd);
                        const rouge = "#b3261e";
                        return (
                          <tr key={\`devis-\${d.affaire_id}\`} style={{ background: retard ? "#fdecec" : undefined }}>
                            <td style={td}>
                              <Link href={lienAffaire("DBE", d.numero)} title="Ouvrir la page du devis" style={{ fontWeight: 800, color: retard ? rouge : "#a3245a" }}>
                                📝 DBE {d.numero}
                              </Link>
                              <span style={{ marginLeft: 6, fontSize: ${taille}, fontWeight: 700, color: retard ? rouge : C.gris }}>
                                {retard ? "devis en retard, pas encore envoyé" : "devis à rendre"}
                              </span>
                              {d.designation && <div style={{ fontSize: ${taille + 1} }}>{d.designation}</div>}
                            </td>
                            {s.jours.map((j) => (
                              <td key={j} style={{ ...tdJour, background: d.echeance === j ? (retard ? "#f7c6c6" : "#fbe3ee") : undefined, color: retard ? rouge : "#a3245a", fontWeight: 800 }}>
                                {d.echeance === j ? "📌 rendu" : retard && j === aujourd ? "⚠ à envoyer" : ""}
                              </td>
                            ))}
                            <td style={{ ...td, textAlign: "right", fontSize: ${taille}, color: retard ? rouge : C.gris, fontWeight: retard ? 800 : 400, whiteSpace: "nowrap" }}>
                              {retard && d.echeance ? \`en retard depuis le \${dateCourte(d.echeance)}\` : ""}
                            </td>
                          </tr>
                        );
                      })}`;

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}

const resultats = [];
for (const { f, auj, taille } of FICHIERS) {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  const t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  const n = (t.match(BLOC) ?? []).length;
  if (n !== 1) echec(`${f} : bloc des devis de la semaine trouvé ${n} fois (attendu : 1).`);
  resultats.push([f, t.replace(BLOC, () => nouveau(auj, taille))]);
}
for (const [f, t] of resultats) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} : devis en retard en rouge`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
