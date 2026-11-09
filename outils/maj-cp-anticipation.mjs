/* ===============================================================
   MAJ CONGÉS - ANTICIPATION ET NOUVEAUX ARRIVANTS (CP_ANTICIPATION)

   Mon espace RH (app/RH/page.tsx) :
   - une demande de CP passe même si le solde est à 0 ou négatif : c'est
     une prise par anticipation ; elle est annoncée dans la confirmation
     et notée dans le commentaire de la demande (« ⚠ Prise par
     anticipation… »), que voient AMA / PLG à la validation ;
   - nouvel arrivant (moins d'un an d'ancienneté au dernier 1er juin) dont
     le service RH n'a pas encore saisi les droits CP : le solde n'est
     pas affiché (« Solde communiqué par le service RH »).
   Suivi RH (app/admin/suivi-rh/page.tsx) : ces personnes sont signalées
   « arrivée récente : solde CP à saisir ».

   La base accepte déjà les droits négatifs (SQL 81). RTT : inchangé.

   À lancer à la racine du projet :   node outils/maj-cp-anticipation.mjs
   Tout ou rien. Relançable sans risque.
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MARQUEUR = "CP_ANTICIPATION";
const RH = "app/RH/page.tsx";
const SUIVI = "app/admin/suivi-rh/page.tsx";

function echec(msg) {
  console.error(`\n✗ ${msg}\n  Rien n'a été modifié. Copiez ce message à Claude.\n`);
  process.exit(1);
}
const compter = (t, x) => t.split(x).length - 1;
const lire = (f) => {
  if (!existsSync(f)) echec(`Fichier introuvable : ${f} (lancez la commande à la racine du projet).`);
  return readFileSync(f, "utf8").replace(/\r\n/g, "\n");
};

const SEUIL = `/* ${MARQUEUR} : moins d'un an d'ancienneté au dernier 1er juin = droits CP pas encore connus */
function seuilAncienneteCP() {
  const d = new Date();
  const annee = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  return \`\${annee - 1}-06-01\`;
}
`;

/* ---------- Mon espace RH ---------- */
const R_RH = [
  ["type du collaborateur", "  compteur_recuperation: number | null;\n};", "  compteur_recuperation: number | null;\n  date_entree?: string | null;\n};"],
  [
    "lecture de la date d'entrée",
    `"id,auth_user_id,prenom,nom,email,trigramme,role,profil_horaire_id,actif,compteur_recuperation"`,
    `"id,auth_user_id,prenom,nom,email,trigramme,role,profil_horaire_id,actif,compteur_recuperation,date_entree"`,
  ],
  ["seuil d'ancienneté", "function exerciceActuel() {", `${SEUIL}\nfunction exerciceActuel() {`],
  [
    "solde masqué",
    "  const resteCP =\n    totalCP - prisesCP - attenteCP;\n",
    `  const resteCP =
    totalCP - prisesCP - attenteCP;

  // ${MARQUEUR} : nouvel arrivant dont le service RH n'a pas encore saisi les droits CP : solde non affiché
  const soldeMasque = Boolean(collab?.date_entree && collab.date_entree > seuilAncienneteCP()) && Math.abs(totalCP) < 0.001;
`,
  ],
  [
    "demande autorisée par anticipation",
    `    if (
      estCP(type) &&
      dureeDemandee > resteCP
    ) {
      setErreur(
        "Le solde disponible de CP est insuffisant en tenant compte des demandes déjà en validation."
      );
      return;
    }`,
    `    // ${MARQUEUR} : solde insuffisant = prise par anticipation (autorisée, signalée aux validateurs)
    const anticipation = estCP(type) && dureeDemandee > resteCP;
    const noteAnticipation = anticipation
      ? \`⚠ Prise par anticipation (\${soldeMasque ? "solde pas encore communiqué par le service RH" : \`solde disponible avant la demande : \${fmt(resteCP)} j\`})\`
      : "";`,
  ],
  [
    "avertissement dans la confirmation",
    "\\n\\nUne notification sera envoyée automatiquement aux administrateurs AMA / PLG.`",
    "${anticipation ? `\\n\\n${noteAnticipation} : la demande sera examinée par AMA / PLG.` : \"\"}\\n\\nUne notification sera envoyée automatiquement aux administrateurs AMA / PLG.`",
  ],
  [
    "note dans le commentaire",
    "            commentaire:\n              commentaire ||\n              null,",
    "            commentaire:\n              [noteAnticipation, commentaire].filter(Boolean).join(\" · \") ||\n              null,",
  ],
  [
    "affichage du solde",
    `              <div style={{ ...styles.big, color: resteCP < 0 ? rouge : undefined }}>
                {fmt(resteCP)} <span style={styles.unit}>j disponibles</span>
              </div>`,
    `              {soldeMasque ? (
                <div style={{ fontSize: 18, fontWeight: 800, color: "#6d737a", margin: "8px 0" }}>Solde communiqué par le service RH</div>
              ) : (
                <div style={{ ...styles.big, color: resteCP < 0 ? rouge : undefined }}>
                  {fmt(resteCP)} <span style={styles.unit}>j disponibles</span>
                </div>
              )}`,
  ],
  ["droits masqués", "                Droits : {fmt(totalCP)} j\n", "                {soldeMasque ? \"Arrivée récente : droits saisis par le service RH\" : <>Droits : {fmt(totalCP)} j</>}\n"],
];

/* ---------- Suivi RH ---------- */
const R_SUIVI = [
  [
    "type du collaborateur",
    "type Collab = { id: string; prenom: string | null; nom: string | null; trigramme: string | null; role: string | null; actif: boolean; inclus_statistiques: boolean | null };",
    "type Collab = { id: string; prenom: string | null; nom: string | null; trigramme: string | null; role: string | null; actif: boolean; inclus_statistiques: boolean | null; date_entree?: string | null };",
  ],
  ["lecture de la date d'entrée", `.select("id,prenom,nom,trigramme,role,actif,inclus_statistiques")`, `.select("id,prenom,nom,trigramme,role,actif,inclus_statistiques,date_entree")`],
  ["seuil d'ancienneté", "function SuiviRHContenu() {", `${SEUIL}\nfunction SuiviRHContenu() {`],
  [
    "repère « arrivée récente »",
    `{!l.d && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#7a3e00" }}>droits non saisis</span>}`,
    `{!l.d && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#7a3e00" }}>droits non saisis</span>}
                            {l.c.date_entree && l.c.date_entree > seuilAncienneteCP() && Math.abs(l.cpDroits) < 0.001 && (
                              <span title="Moins d'un an d'ancienneté au dernier 1er juin : son solde de CP est masqué dans son espace RH tant qu'il n'est pas saisi" style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#1f4e79" }}>
                                arrivée récente : solde CP à saisir
                              </span>
                            )}`,
  ],
];

const sorties = [];
for (const [f, regles] of [[RH, R_RH], [SUIVI, R_SUIVI]]) {
  let t = lire(f);
  if (t.includes(MARQUEUR)) {
    console.log(`✓ ${f} : déjà à jour`);
    continue;
  }
  for (const [nom, a] of regles) if (compter(t, a) !== 1) echec(`${f} : « ${nom} » trouvé ${compter(t, a)} fois (attendu : 1).`);
  for (const [, a, b] of regles) t = t.replace(a, () => b);
  sorties.push([f, t]);
}
for (const [f, t] of sorties) {
  writeFileSync(f, t, "utf8");
  console.log(`✓ ${f} mis à jour`);
}
console.log("\n✓ Terminé. Lancez maintenant : npm run build");
