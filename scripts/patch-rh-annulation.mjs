#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Espace RH : bouton « Annuler la demande » et justificatif soigné

   1. Le champ « Justificatif » du navigateur devient un vrai bouton
      « 📎 Joindre un justificatif » : zone où l'on peut aussi glisser le fichier, nom
      et taille affichés, boutons « Remplacer » et « Retirer », taille limitée à 10 Mo.
      Changer de type de demande retire le justificatif choisi.
   2. Dans « Mes demandes », une demande En attente ou Validée dont la période n'est pas
      terminée a un bouton « Annuler ». Une fenêtre demande confirmation et un motif
      facultatif, puis : la demande passe au statut Annulée (script SQL 18), les absences
      sont retirées des feuilles non validées, AMA, PLG, le service RH (si la demande lui
      avait été transmise) et le collaborateur sont prévenus par e-mail (fonction
      notifier-annulation-rh). Une demande refusée peut aussi être annulée (archivée, sans e-mail).

   Version 2 : l'annulation vaut pour TOUS les statuts (en attente, validée, refusée). Une
   demande refusée qu'on annule est archivée sans e-mail. Met à jour la version 1.

   Prérequis : script SQL 18 (version à jour) exécuté et fonction notifier-annulation-rh déployée.

   Utilisation, depuis la racine du projet :
       node scripts/patch-rh-annulation.mjs

   Tout ou rien. Sauvegarde : page.tsx.bak-rh-annulation. Sans effet si relancé.
=============================================================== */

import fs from "node:fs";
import path from "node:path";

const cible = path.resolve(process.argv[2] ?? "app/RH/page.tsx");

if (!fs.existsSync(cible)) {
  console.error(`Fichier introuvable : ${cible}\nLancez ce script depuis la racine du projet.`);
  process.exit(1);
}

const original = fs.readFileSync(cible, "utf8");
const crlf = original.includes("\r\n");
let source = original.replace(/\r\n/g, "\n");

if (source.includes("RH_ANNULATION_V2")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

// Version 1 déjà installée : on met à jour sur place les trois blocs qui changent.
const versionUn = source.includes("RH_ANNULATION_V1");

const echecs = [];

function unique(nom, marqueur) {
  const premier = source.indexOf(marqueur);
  const dernier = source.lastIndexOf(marqueur);

  if (premier < 0 || premier !== dernier) {
    echecs.push(`${nom} : ${premier < 0 ? "introuvable" : "présent plusieurs fois"}`);
    return -1;
  }

  return premier;
}

function uniqueRegex(nom, motif) {
  const trouves = [...source.matchAll(new RegExp(motif.source, motif.flags.includes("g") ? motif.flags : `${motif.flags}g`))];

  if (trouves.length !== 1) {
    echecs.push(`${nom} : ${trouves.length === 0 ? "introuvable" : `présent ${trouves.length} fois`}`);
    return null;
  }

  return trouves[0];
}


/* Blocs de code ajoutés à la page (version 2 : l'annulation vaut pour tous les statuts) */
const BLOC_FENETRE = `function FenetreAnnulation({
  demande,
  motif,
  onMotif,
  enCours,
  erreur,
  onConfirmer,
  onFermer,
}: {
  demande: Demande;
  motif: string;
  onMotif: (valeur: string) => void;
  enCours: boolean;
  erreur: string;
  onConfirmer: () => void;
  onFermer: () => void;
}) {
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enCours) onFermer();
    };

    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [enCours, onFermer]);

  const periode =
    demande.date_debut === demande.date_fin
      ? dateFR(demande.date_debut)
      : \`\${dateFR(demande.date_debut)} → \${dateFR(demande.date_fin)}\`;

  const duree =
    demande.type_demande === "RE"
      ? \`\${fmt(demande.heures_re || 0)} h\`
      : \`\${fmt(demande.duree_jours)} jour\${Number(demande.duree_jours) > 1 ? "s" : ""}\`;

  const dejaTransmise = Boolean(demande.rh_transmise);
  const refusee = demande.statut === "REFUSEE";
  const validee = demande.statut === "VALIDEE" || demande.statut === "ENVOYEE_RH";

  return (
    <div style={stylesAnnulation.voile} role="presentation" onClick={() => !enCours && onFermer()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Annuler la demande"
        style={stylesAnnulation.fenetre}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>{refusee ? "Annuler cette demande refusée ?" : "Annuler cette demande ?"}</h2>
        <div style={{ color: "#6d737a", marginBottom: 14 }}>
          {libelleType(demande.type_demande)} · {periode} · {duree}
        </div>

        {erreur && <div role="alert" style={styles.alert}>{erreur}</div>}

        <div style={stylesAnnulation.consequences}>
          {refusee ? (
            <>
              <strong>Cette demande a déjà été refusée.</strong>
              <div style={{ marginTop: 6, lineHeight: 1.5 }}>
                L'annuler la retire de votre liste active et la garde dans l'historique avec le statut « Annulée ».
                Personne n'est prévenu par e-mail.
              </div>
            </>
          ) : (
            <>
              <strong>Ce qui va se passer :</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.5 }}>
                <li>
                  AMA et PLG seront prévenus par e-mail
                  {dejaTransmise ? ", ainsi que le service RH (la demande lui avait été transmise)" : ""}.
                </li>
                <li>La demande n'est plus comptée dans vos soldes ni dans le planning.</li>
                {validee && <li>Les jours d'absence sont retirés de vos feuilles d'heures non validées.</li>}
                <li>Elle reste visible ici avec le statut « Annulée ».</li>
              </ul>
            </>
          )}
        </div>

        <label style={{ ...styles.field, marginTop: 14 }}>
          <span>Motif (facultatif)</span>
          <textarea
            style={{ ...styles.input, minHeight: 64 }}
            value={motif}
            onChange={(e) => onMotif(e.target.value)}
            placeholder="ex. Changement de planning"
            autoFocus
          />
        </label>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 18 }}>
          <button type="button" style={styles.secondary} onClick={onFermer} disabled={enCours}>
            Garder la demande
          </button>

          <button
            type="button"
            style={{ ...styles.button, opacity: enCours ? 0.65 : 1 }}
            onClick={onConfirmer}
            disabled={enCours}
          >
            {enCours ? "Annulation…" : "Annuler la demande"}
          </button>
        </div>
      </div>
    </div>
  );
}

`;

const BLOC_FONCTIONS = `  // Une demande peut être annulée quel que soit son statut (en attente, validée, refusée).
  // Un congé validé dont la période est terminée doit être annulé par un administrateur.
  function peutAnnuler(d: Demande) {
    if (d.statut === "EN_ATTENTE" || d.statut === "REFUSEE") return true;

    return ["VALIDEE", "ENVOYEE_RH"].includes(d.statut) && d.date_fin >= dateISO(new Date());
  }

  function ouvrirAnnulation(d: Demande) {
    setAAnnuler(d);
    setMotifAnnulation("");
    setErreurAnnulation("");
  }

  async function confirmerAnnulation() {
    if (!aAnnuler) return;

    // Décidé avant l'appel à la base : une demande déjà refusée est simplement archivée (aucun e-mail)
    const dejaRefusee = aAnnuler.statut === "REFUSEE";

    setAnnulationEnCours(true);
    setErreurAnnulation("");
    setErreur("");
    setMessage("");

    try {
      const { data, error } = await supabase.rpc("rh_annuler_demande", {
        p_demande_id: aAnnuler.id,
        p_motif: motifAnnulation.trim() || null,
      });

      if (error) throw error;

      const resultat = Array.isArray(data) ? data[0] : data;

      const notification = dejaRefusee
        ? { error: null }
        : await supabase.functions.invoke("notifier-annulation-rh", {
            body: { demande_id: aAnnuler.id },
          });

      setAAnnuler(null);
      setMotifAnnulation("");

      let texte = dejaRefusee
        ? "Demande annulée. Elle était déjà refusée : personne n’a été prévenu par e-mail."
        : notification.error
        ? "Demande annulée, mais l’e-mail d’information n’a pas pu être envoyé : prévenez AMA et PLG."
        : resultat?.rh_deja_transmise
          ? "Demande annulée. AMA, PLG et le service RH ont été prévenus par e-mail."
          : "Demande annulée. AMA et PLG ont été prévenus par e-mail.";

      if (!dejaRefusee && resultat?.feuilles_a_corriger) {
        texte += \` Attention : les feuilles déjà validées des semaines du \${resultat.feuilles_a_corriger} contiennent encore cette absence : un administrateur doit les corriger.\`;
      }

      setMessage(texte);
      await charger();
    } catch (e: any) {
      setErreurAnnulation(e?.message || "Impossible d'annuler la demande.");
    } finally {
      setAnnulationEnCours(false);
    }
  }

`;

const BLOC_CELLULE = `{peutAnnuler(d) ? (
                        <button
                          type="button"
                          style={stylesAnnulation.boutonAnnuler}
                          onClick={() => ouvrirAnnulation(d)}
                          title="Annuler cette demande"
                        >
                          Annuler
                        </button>
                      ) : d.statut === "VALIDEE" || d.statut === "ENVOYEE_RH" ? (
                        <span
                          title="La période est terminée : demandez l'annulation à un administrateur"
                          style={{ color: "#999", fontSize: 12 }}
                        >
                          Période passée
                        </span>
                      ) : (
                        "—"
                      )}`;

if (!versionUn) {
/* 1) import de useRef */
{
  const ancien = 'import React, { useEffect, useMemo, useState } from "react";';

  if (unique("import de React", ancien) >= 0) {
    source = source.replace(ancien, 'import React, { useEffect, useMemo, useRef, useState } from "react";');
  }
}

/* 2) composants : justificatif et fenêtre d'annulation, avant la page */
{
  const ancien = "export default function RHPage() {";

  if (unique("début de la page RHPage", ancien) >= 0) {
    const composants = `/* RH_ANNULATION_V2 : justificatif soigné et annulation d'une demande */

const TAILLE_MAX_JUSTIFICATIF = 10 * 1024 * 1024;

function tailleLisible(octets: number) {
  if (octets < 1024) return \`\${octets} o\`;
  if (octets < 1024 * 1024) return \`\${Math.round(octets / 1024)} Ko\`;
  return \`\${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo\`;
}

function ChampJustificatif({
  fichier,
  onChoisir,
}: {
  fichier: File | null;
  onChoisir: (fichier: File | null) => void;
}) {
  const entree = useRef<HTMLInputElement | null>(null);
  const [survol, setSurvol] = useState(false);
  const [probleme, setProbleme] = useState("");

  function accepter(f: File | null | undefined) {
    if (!f) return;

    if (f.size === 0) {
      setProbleme("Ce fichier est vide.");
      return;
    }

    if (f.size > TAILLE_MAX_JUSTIFICATIF) {
      setProbleme(\`Ce fichier fait \${tailleLisible(f.size)} : la taille maximale est de 10 Mo.\`);
      return;
    }

    setProbleme("");
    onChoisir(f);
  }

  return (
    <div style={styles.field}>
      <span>Justificatif</span>

      <input
        ref={entree}
        type="file"
        aria-label="Choisir un justificatif"
        style={{ display: "none" }}
        onChange={(e) => {
          accepter(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {fichier ? (
        <div style={stylesAnnulation.fichierChoisi}>
          <span aria-hidden="true" style={{ fontSize: 22 }}>📄</span>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={stylesAnnulation.fichierNom} title={fichier.name}>{fichier.name}</div>
            <div style={stylesAnnulation.fichierTaille}>{tailleLisible(fichier.size)} · prêt à être envoyé</div>
          </div>

          <button type="button" style={stylesAnnulation.boutonDiscret} onClick={() => entree.current?.click()}>
            Remplacer
          </button>

          <button
            type="button"
            aria-label="Retirer le justificatif"
            title="Retirer le justificatif"
            style={stylesAnnulation.boutonRetirer}
            onClick={() => {
              setProbleme("");
              onChoisir(null);
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <div
          style={{ ...stylesAnnulation.zoneDepot, ...(survol ? stylesAnnulation.zoneDepotActive : {}) }}
          onDragOver={(e: React.DragEvent) => {
            e.preventDefault();
            setSurvol(true);
          }}
          onDragLeave={() => setSurvol(false)}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            setSurvol(false);
            accepter(e.dataTransfer?.files?.[0]);
          }}
        >
          <button type="button" style={stylesAnnulation.boutonJoindre} onClick={() => entree.current?.click()}>
            <span aria-hidden="true">📎</span> Joindre un justificatif
          </button>

          <span style={stylesAnnulation.aideDepot}>ou glissez le fichier ici</span>
          <span style={stylesAnnulation.aideDepot}>PDF, image, Word ou Excel · 10 Mo maximum</span>
        </div>
      )}

      {probleme && (
        <span role="alert" style={stylesAnnulation.problemeFichier}>{probleme}</span>
      )}
    </div>
  );
}

${BLOC_FENETRE}`;

    source = source.replace(ancien, composants + ancien);
  }
}

/* 3) états de l'annulation */
{
  const m = uniqueRegex("état « envoi »", /const \[envoi, setEnvoi\] =\s*useState\(false\);\n/);

  if (m) {
    source = source.replace(
      m[0],
      `${m[0]}
  const [aAnnuler, setAAnnuler] = useState<Demande | null>(null);
  const [motifAnnulation, setMotifAnnulation] = useState("");
  const [annulationEnCours, setAnnulationEnCours] = useState(false);
  const [erreurAnnulation, setErreurAnnulation] = useState("");
`
    );
  }
}

/* 4) changer de type retire le justificatif choisi */
{
  const ancien = "    setType(nouveauType);\n";

  if (unique("changement de type", ancien) >= 0) {
    source = source.replace(
      ancien,
      `${ancien}    if (nouveauType !== "CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF") setFichier(null);\n`
    );
  }
}

/* 5) fonctions d'annulation, avant l'envoi d'une demande */
{
  const ancien = "  async function envoyerDemande(";

  if (unique("fonction envoyerDemande", ancien) >= 0) {
    source = source.replace(
      ancien,
      `${BLOC_FONCTIONS}${ancien}`
    );
  }
}

/* 6) le champ justificatif du formulaire */
{
  const m = uniqueRegex(
    "champ « Justificatif »",
    /\{type ===\s*"CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF" && \(\s*<Field label="Justificatif">\s*<input\s+type="file"\s+style=\{styles\.input\}\s+onChange=\{\(e\) =>\s*setFichier\(\s*e\.target\.files\?\.\[0\] \|\|\s*null\s*\)\s*\}\s*\/>\s*<\/Field>\s*\)\}/
  );

  if (m) {
    source = source.replace(
      m[0],
      `{type === "CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF" && (
              <ChampJustificatif fichier={fichier} onChoisir={setFichier} />
            )}`
    );
  }
}

/* 7) la colonne « Action » de « Mes demandes » */
{
  const m = uniqueRegex(
    "colonne Action",
    /\{\(d\.statut === "EN_ATTENTE" \|\| d\.statut === "REFUSEE"\) \? \(\s*<button\s+style=\{\s*styles\.deleteButton\s*\}\s+onClick=\{\(\) =>\s*supprimerDemande\(\s*d\s*\)\s*\}\s+title="Supprimer"\s*>\s*×\s*<\/button>\s*\) : \(\s*"—"\s*\)\}/
  );

  if (m) {
    source = source.replace(
      m[0],
      `${BLOC_CELLULE}`
    );
  }
}

/* 8) la fenêtre d'annulation, à la fin de la page */
{
  const ancien = "    </main>\n  );\n}\n\nconst styles: Record<";

  if (unique("fin de la page", ancien) >= 0) {
    source = source.replace(
      ancien,
      `
      {aAnnuler && (
        <FenetreAnnulation
          demande={aAnnuler}
          motif={motifAnnulation}
          onMotif={setMotifAnnulation}
          enCours={annulationEnCours}
          erreur={erreurAnnulation}
          onConfirmer={confirmerAnnulation}
          onFermer={() => setAAnnuler(null)}
        />
      )}
    </main>
  );
}

const styles: Record<`
    );
  }
}

/* 9) styles des nouveaux éléments, en fin de fichier */
source =
  source.replace(/\n+$/, "\n") +
  `
const stylesAnnulation: Record<string, React.CSSProperties> = {
  zoneDepot: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, border: "2px dashed #c9ced4", borderRadius: 10, background: "#fafbfc", padding: "12px 14px" },
  zoneDepotActive: { borderColor: rouge, background: "#fff5f5" },
  boutonJoindre: { display: "inline-flex", alignItems: "center", gap: 8, minHeight: 42, padding: "0 16px", border: \`2px solid \${rouge}\`, background: "#ffffff", color: rouge, borderRadius: 9, fontWeight: 800, fontSize: 14, fontFamily: "inherit", cursor: "pointer" },
  aideDepot: { fontSize: 12, fontWeight: 400, color: "#6d737a" },
  fichierChoisi: { display: "flex", alignItems: "center", gap: 10, border: "1.5px solid #9fd4a7", background: "#f2faf3", borderRadius: 10, padding: "9px 12px" },
  fichierNom: { fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fichierTaille: { fontWeight: 400, fontSize: 12, color: "#4f6b53" },
  boutonDiscret: { border: "1px solid #c9ced4", background: "#ffffff", color: "#252525", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: 12, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" },
  boutonRetirer: { width: 32, height: 32, border: "1px solid #e1bcbc", background: "#ffffff", color: rouge, borderRadius: 8, fontSize: 20, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 },
  problemeFichier: { color: "#a51d1d", fontSize: 12, fontWeight: 700 },
  boutonAnnuler: { border: \`1.5px solid \${rouge}\`, background: "#ffffff", color: rouge, borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 13, fontFamily: "inherit", cursor: "pointer" },
  voile: { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 100 },
  fenetre: { width: "100%", maxWidth: 560, background: "#ffffff", borderRadius: 14, padding: 22, boxShadow: "0 14px 44px rgba(0,0,0,.3)", maxHeight: "92vh", overflow: "auto" },
  consequences: { background: "#fff8e1", border: "1px solid #ecd58a", borderRadius: 10, padding: "10px 14px", fontSize: 14 },
};
`;

} else {
  /* Mise à jour de la version 1 : on remplace les trois blocs qui changent */
  const a1 = source.indexOf("function FenetreAnnulation({");
  const b1 = source.indexOf("export default function RHPage() {");

  if (a1 < 0 || b1 < a1) echecs.push("fenêtre d'annulation : introuvable");
  else source = source.slice(0, a1) + BLOC_FENETRE + source.slice(b1);

  const a2 = source.indexOf("  // Une demande en attente ou validée peut être annulée");
  const b2 = source.indexOf("  async function envoyerDemande(");

  if (a2 < 0 || b2 < a2) echecs.push("fonctions d'annulation : introuvables");
  else source = source.slice(0, a2) + BLOC_FONCTIONS + source.slice(b2);

  const m3 = /\{peutAnnuler\(d\) \? \([\s\S]*?"—"\s*\)\}/.exec(source);

  if (!m3) echecs.push("colonne Action : introuvable");
  else source = source.slice(0, m3.index) + BLOC_CELLULE + source.slice(m3.index + m3[0].length);

  source = source.replace("RH_ANNULATION_V1", "RH_ANNULATION_V2");
}

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines pièces du fichier n'ont pas pu être repérées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nLe fichier a probablement évolué. Envoyez-moi ce résultat.");
  process.exit(1);
}

const attendus = [
  ["RH_ANNULATION_V2", 1],
  ["function ChampJustificatif", 1],
  ["<ChampJustificatif", 1],
  ["function FenetreAnnulation", 1],
  ["<FenetreAnnulation", 1],
  ["rh_annuler_demande", 1],
  ["notifier-annulation-rh", 1],
  ["const stylesAnnulation", 1],
];

for (const [texte, n] of attendus) {
  const trouves = source.split(texte).length - 1;

  if (trouves !== n) {
    console.error(`Contrôle final : « ${texte} » trouvé ${trouves} fois au lieu de ${n}. Aucune modification n'a été faite.`);
    process.exit(1);
  }
}

if (!versionUn) fs.copyFileSync(cible, `${cible}.bak-rh-annulation`);
fs.writeFileSync(cible, crlf ? source.replace(/\n/g, "\r\n") : source, "utf8");

console.log("Espace RH : justificatif soigné et bouton « Annuler la demande » installés.");
console.log(versionUn ? "Mise à jour de la version 1 faite. Lancez « npx tsc --noEmit » puis « npm run dev »." : "Sauvegarde : page.tsx.bak-rh-annulation. Lancez « npx tsc --noEmit » puis « npm run dev ».");
