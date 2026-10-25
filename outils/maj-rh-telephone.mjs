/* ===============================================================
   Mon espace RH (app/RH/page.tsx) sur téléphone :
   - compteur, congés et RTT en pleine largeur, petites tuiles par deux ;
   - formulaire de demande sur une colonne, gros bouton d'envoi ;
   - « Mes demandes » en fiches (plus de tableau à faire défiler).
   Rien ne change sur ordinateur.
   Utilisation (à la racine du projet) :  node outils/maj-rh-telephone.mjs
================================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chemin = "app/RH/page.tsx";
if (!existsSync(chemin)) {
  console.error(`✗ Fichier introuvable : ${chemin} (lancez le script depuis la racine du projet)`);
  process.exit(1);
}
let texte = readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
if (texte.includes("RH_TELEPHONE")) {
  console.log("✓ Déjà à jour : rien à faire.");
  process.exit(0);
}

const CSS = `
@media (max-width: 760px) {
  .rh-page { padding: 12px 10px 40px !important; }
  .rh-grille { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; margin-bottom: 10px !important; }
  .rh-grille > div { grid-column: auto !important; padding: 14px !important; min-width: 0; }
  .rh-grille > .rh-large { grid-column: 1 / -1 !important; }
  .rh-page > section:not(.rh-grille) { padding: 14px !important; }
  .rh-cp { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .rh-formulaire, .rh-periode { grid-template-columns: 1fr !important; }
  .rh-periode { grid-column: auto !important; }
  .rh-formulaire input, .rh-formulaire select, .rh-formulaire textarea { min-height: 46px; font-size: 16px !important; box-sizing: border-box; width: 100%; }
  .rh-envoyer { width: 100%; min-height: 52px; font-size: 17px !important; }
  .rh-table, .rh-table tbody, .rh-table tr, .rh-table td { display: block; width: 100%; box-sizing: border-box; }
  .rh-table thead { display: none; }
  .rh-table tr { border-bottom: 6px solid #f1f3f5; padding: 8px 2px; }
  .rh-table td { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 5px 0; text-align: right; }
  .rh-table td::before { font-weight: 700; color: #777; font-size: 13px; text-align: left; flex-shrink: 0; }
  .rh-table td:nth-child(1) { font-weight: 800; font-size: 16px; justify-content: flex-start; text-align: left; }
  .rh-table td:nth-child(2)::before { content: "Période"; }
  .rh-table td:nth-child(3)::before { content: "Durée"; }
  .rh-table td:nth-child(4)::before { content: "Statut"; }
  .rh-table td:nth-child(5)::before { content: "Validation"; }
  .rh-table td:nth-child(6)::before { content: "Transmission"; }
  .rh-table td:nth-child(7) button { width: 100%; min-height: 46px; font-size: 15px; }
}
`;

const changements = [
  [
    "Page",
    `  return (
    <main style={styles.page}>
      <EnTetePage
        forme="encadre"
        section="Espace collaborateur"
        titre="Mon espace RH"
        description=`,
    `  return (
    <main className="rh-page" style={styles.page}>
      {/* RH_TELEPHONE : affichage téléphone */}
      <style>{\`${CSS}\`}</style>
      <EnTetePage
        forme="encadre"
        section="Espace collaborateur"
        titre="Mon espace RH"
        description=`,
  ],
  [
    "Compteur et tuiles",
    `      <section
        style={{
          ...styles.grid,
          gridTemplateColumns:
            "repeat(5,minmax(0,1fr))",
        }}
      >
        <div
          style={{
            ...styles.card,
            gridColumn: "span 2",
          }}
        >`,
    `      <section
        className="rh-grille"
        style={{
          ...styles.grid,
          gridTemplateColumns:
            "repeat(5,minmax(0,1fr))",
        }}
      >
        <div
          className="rh-large"
          style={{
            ...styles.card,
            gridColumn: "span 2",
          }}
        >`,
  ],
  [
    "Congés payés",
    `      <section style={styles.grid}>
        <div
          style={{
            ...styles.card,
            gridColumn: "span 3",
          }}
        >`,
    `      <section className="rh-grille" style={styles.grid}>
        <div
          className="rh-large"
          style={{
            ...styles.card,
            gridColumn: "span 3",
          }}
        >`,
  ],
  [
    "RTT",
    `        <div style={styles.card}>
          <div style={styles.cardTitle}>
            📅 RTT`,
    `        <div className="rh-large" style={styles.card}>
          <div style={styles.cardTitle}>
            📅 RTT`,
  ],
  ["Détail des CP", `<div style={styles.cpGrid}>`, `<div className="rh-cp" style={styles.cpGrid}>`],
  ["Formulaire", `<div style={styles.formGrid}>`, `<div className="rh-formulaire" style={styles.formGrid}>`],
  ["Dates de la période", `<div style={styles.periodeGrid}>`, `<div className="rh-periode" style={styles.periodeGrid}>`],
  [
    "Bouton d'envoi",
    `          <button
            disabled={envoi}`,
    `          <button
            className="rh-envoyer"
            disabled={envoi}`,
  ],
  [
    "Mes demandes en fiches",
    `            <table
              style={styles.table}
            >`,
    `            <table
              className="rh-table"
              style={styles.table}
            >`,
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
console.log("\nTerminé : Mon espace RH sur téléphone.");
