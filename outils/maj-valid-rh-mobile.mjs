/* ===============================================================
   Validation RH (app/admin/Valid_RH/page.tsx) sur téléphone :
   - les demandes deviennent des fiches (plus de tableau à faire défiler) ;
   - la fenêtre d'une demande prend tout l'écran, « Valider pour moi » en
     premier, gros boutons ;
   - une demande s'ouvre directement depuis la cloche du tableau de bord
     (adresse /admin/Valid_RH?demande=<id>).
   Utilisation (à la racine du projet) :  node outils/maj-valid-rh-mobile.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/admin/Valid_RH/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("VALID_RH_MOBILE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

const CSS = `
@media (max-width: 760px) {
  .vr-outils > label, .vr-outils input, .vr-outils select { width: 100% !important; min-width: 0 !important; box-sizing: border-box; }
  .vr-table, .vr-table tbody, .vr-table tr, .vr-table td { display: block; width: 100%; box-sizing: border-box; }
  .vr-table thead { display: none; }
  .vr-table tr { border-bottom: 6px solid #f1f3f5; padding: 8px 12px; text-align: left; }
  .vr-table td { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 5px 0; text-align: right; }
  .vr-table td::before { font-weight: 700; color: #777; font-size: 13px; text-align: left; }
  .vr-table td:nth-child(2)::before { content: "Demande"; }
  .vr-table td:nth-child(3)::before { content: "Date"; }
  .vr-table td:nth-child(4)::before { content: "Durée"; }
  .vr-table td:nth-child(5)::before { content: "Créée le"; }
  .vr-table td:nth-child(6)::before { content: "Statut"; }
  .vr-table td:nth-child(7)::before { content: "Validateur"; }
  .vr-table td:nth-child(8)::before { content: "Transmission"; }
  .vr-table td:nth-child(1) { font-size: 16px; justify-content: flex-start; text-align: left; }
  .vr-table td:nth-child(9) button { min-height: 46px; flex: 1; font-size: 15px; }
  .vr-fond { padding: 0 !important; align-items: stretch !important; }
  .vr-modal { width: 100% !important; max-height: 100vh !important; min-height: 100vh; border-radius: 0 !important; padding: 16px !important; box-sizing: border-box; }
  .vr-grille { grid-template-columns: 1fr !important; }
  .vr-actions { flex-direction: column; }
  .vr-actions > button, .vr-actions > input { width: 100% !important; min-height: 50px; font-size: 16px; box-sizing: border-box; }
  .vr-actions .vr-valider { order: -1; }
}
`;

const changements = [
  [
    "Styles téléphone",
    `    description="Les demandes sont conservées et classées automatiquement par année puis par mois."
  />`,
    `    description="Les demandes sont conservées et classées automatiquement par année puis par mois."
  />
  {/* VALID_RH_MOBILE : affichage téléphone */}
  <style>{\`${CSS}\`}</style>`,
  ],
  ["Barre d'outils", `<section style={styles.toolbar}>`, `<section className="vr-outils" style={styles.toolbar}>`],
  ["Tableau en fiches", `<table style={styles.table}>`, `<table className="vr-table" style={styles.table}>`],
  ["Fenêtre plein écran", `<div style={styles.overlay}><div style={styles.modal}>`, `<div className="vr-fond" style={styles.overlay}><div className="vr-modal" style={styles.modal}>`],
  ["Détails sur une colonne", `<div style={styles.detailGrid}>`, `<div className="vr-grille" style={styles.detailGrid}>`],
  ["Gros boutons", `<div style={styles.actions}>`, `<div className="vr-actions" style={styles.actions}>`],
  [
    "« Valider » en premier",
    `<button style={styles.primary} disabled={!!action} onClick={()=>valider(selection)}>Valider pour moi</button>`,
    `<button className="vr-valider" style={styles.primary} disabled={!!action} onClick={()=>valider(selection)}>Valider pour moi</button>`,
  ],
  [
    "Ouverture depuis la cloche (mémoire)",
    `const [emailEnvoi,setEmailEnvoi]=useState("");`,
    `const [emailEnvoi,setEmailEnvoi]=useState("");
 // ouverture directe d'une demande depuis la cloche du tableau de bord (?demande=<id>), une seule fois
 const ouvertureFaite=React.useRef(false);`,
  ],
  [
    "Ouverture depuis la cloche",
    `setDemandes((data||[]) as Demande[]);`,
    `setDemandes((data||[]) as Demande[]);
  if(!ouvertureFaite.current){
   ouvertureFaite.current=true;
   const voulu=new URLSearchParams(window.location.search).get("demande");
   const d=voulu?((data||[]) as Demande[]).find(x=>x.id===voulu):undefined;
   if(d){setSelection(d);if(d.statut!=="EN_ATTENTE")setFiltre("TOUTES");window.history.replaceState(null,"","/admin/Valid_RH");}
  }`,
  ],
];

let erreurs = 0;
for (const [nom, cherche, remplace] of changements) {
  const nb = texte.split(cherche).length - 1;
  if (nb !== 1) {
    console.error(`✗ ${nom} : passage trouvé ${nb} fois (attendu 1)`);
    erreurs++;
    continue;
  }
  texte = texte.replace(cherche, remplace);
  console.log(`✓ ${nom}`);
}
if (erreurs > 0) {
  console.error("\nRien n'a été modifié. Copiez ce message à Claude.");
  process.exit(1);
}
writeFileSync(chemin, texte, "utf8");
console.log("\nTerminé : Validation RH sur téléphone.");
