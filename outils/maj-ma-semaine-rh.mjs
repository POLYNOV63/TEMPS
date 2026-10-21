/* ===============================================================
   Mise à jour de 2 fichiers trop longs pour être renvoyés en entier :
     app/ma-semaine/MaSemaineContent.tsx
     app/RH/page.tsx

   1. RE sur toute la journée (ex. 7,5 h) : présence « Absent », ticket décoché.
   2. Demi-journée de CP ou de RTT : entre 3 h et 5 h (en général 3,5 h ou 4 h).
   3. Compteur de récupération : plus de blocage au-delà de +30 h
      (la limite basse de -30 h reste) ; l'espace RH prévient le collaborateur.

   Utilisation (à la racine du projet) :  node outils/maj-ma-semaine-rh.mjs
   Le script vérifie TOUT avant d'écrire : si un passage n'est pas trouvé,
   il n'écrit rien et le dit. Une copie .bak de chaque fichier est gardée.
================================================================ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

/* texte -> expression souple (les espaces et retours à la ligne peuvent varier) */
const souple = (texte) =>
  new RegExp(
    texte
      .trim()
      .split(/\s+/)
      .map((morceau) => morceau.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*")
  );

const FICHIERS = [
  {
    chemin: "app/ma-semaine/MaSemaineContent.tsx",
    changements: [
      {
        nom: "RE sur toute la journée : présence Absent, ticket décoché (fonction)",
        cherche: souple(`/* ============================================================
   ABSENCES
============================================================ */`),
        remplace: `/* ============================================================
   ABSENCES
============================================================ */

/* RE_JOURNEE_ENTIERE : une récupération qui couvre toute la journée (ex. 7,5 h) rend le
   collaborateur absent ce jour-là (présence « Absent », pas de ticket restaurant). Si la
   récupération redevient partielle, la présence et le ticket reviennent. */
function ajusterRecuperation(jour: JourSemaine): JourSemaine {
  if (jour.absence !== CODE_RE || jour.estWeekend || jour.estFerie) return jour;

  const heures = convertirHeures(jour.heuresRE);
  const journeeEntiere = jour.heuresTheoriques > 0 && heures >= jour.heuresTheoriques - 0.01;

  if (journeeEntiere) {
    return { ...jour, presence: "ABSENT", ticketRestaurant: false, imputations: [] };
  }

  if (jour.presence === "ABSENT") {
    return { ...jour, presence: "PRESENTIEL", ticketRestaurant: true };
  }

  return jour;
}`,
      },
      {
        nom: "RE sur toute la journée : appliqué à chaque modification du jour",
        cherche: souple(`jour.date === date
              ? {
                  ...jour,
                  ...modification,
                }
              : jour`),
        remplace: `jour.date === date
              ? ajusterRecuperation({
                  ...jour,
                  ...modification,
                })
              : jour`,
      },
      {
        nom: "Demi-journée de CP entre 3 h et 5 h",
        cherche: souple(`if (cpHeures > jour.heuresTheoriques) {`),
        remplace: `if (cpHeures < 3 || cpHeures > 5) {
          setMessage(
            \`Le \${jour.jour} \${dateAffichage(
              jour.date
            )} : une demi-journée de CP compte entre 3 h et 5 h (en général 3,5 h ou 4 h).\`
          );
          setMessageType("DANGER");
          return false;
        }

        if (cpHeures > jour.heuresTheoriques) {`,
      },
      {
        nom: "Demi-journée de RTT entre 3 h et 5 h",
        cherche: souple(`if (heuresRTT >= jour.heuresTheoriques) {`),
        remplace: `if (heuresRTT < 3 || heuresRTT > 5) {
          setMessage(
            \`Le \${jour.jour} \${dateAffichage(
              jour.date
            )} : une demi-journée de RTT compte entre 3 h et 5 h (en général 3,5 h ou 4 h).\`
          );
          setMessageType("DANGER");
          return false;
        }

        if (heuresRTT >= jour.heuresTheoriques) {`,
      },
      {
        nom: "Note de la demi-journée de CP (grille)",
        cherche: souple(`: "Renseignez les heures de CP."`),
        remplace: `: "Renseignez les heures de CP : entre 3 h et 5 h (en général 3,5 h ou 4 h)."`,
      },
      {
        nom: "Note de la demi-journée de RTT (grille)",
        cherche: souple(`: "Renseignez les heures de RTT."`),
        remplace: `: "Renseignez les heures de RTT : entre 3 h et 5 h (en général 3,5 h ou 4 h)."`,
      },
      {
        nom: "Compteur : plus de blocage au-delà de +30 h à la validation",
        cherche: /if\s*\(\s*validationFinale\s*&&\s*compteurApresEnregistrement\s*>\s*30\.01\s*\)\s*\{[\s\S]*?return;\s*\}/,
        remplace: `/* COMPTEUR_SANS_PLAFOND : au-delà de +30 h, la feuille se valide ; l'espace RH prévient le collaborateur */`,
      },
      {
        nom: "Compteur : plus de blocage au-delà de +30 h sur les semaines suivantes",
        cherche: souple(`if (apres < -30 || apres > 30) {`),
        remplace: `if (apres < -30) {`,
      },
      {
        nom: "Compteur : la clôture mensuelle peut mettre toutes les heures sup au compteur",
        cherche: /Math\.min\(\s*totalHeuresSupMensuelles,\s*30\s*-\s*compteurApresRE\s*\)/,
        remplace: `totalHeuresSupMensuelles`,
      },
    ],
  },
  {
    chemin: "app/RH/page.tsx",
    changements: [
      {
        nom: "Espace RH : message quand le compteur dépasse 30 h",
        cherche: /<BarreCompteur\s+valeur=\{\s*compteur\s*\}\s*\/>/,
        remplace: `<BarreCompteur
            valeur={compteur}
          />

          {compteur > 30 && (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: "#fff4e5",
                border: "1px solid #e9b877",
                color: "#7a3e00",
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.45,
              }}
            >
              ⚠ Votre compteur dépasse la limite de 30 h. Pensez à poser des
              récupérations pour revenir sous 30 h.
            </div>
          )}`,
      },
    ],
  },
];

let erreurs = 0;
const resultats = [];

for (const f of FICHIERS) {
  if (!existsSync(f.chemin)) {
    console.error(`✗ Fichier introuvable : ${f.chemin} (lancez le script depuis la racine du projet)`);
    erreurs++;
    continue;
  }
  let texte = readFileSync(f.chemin, "utf8");
  const original = texte;
  for (const c of f.changements) {
    const trouves = texte.match(new RegExp(c.cherche.source, "g"));
    if (!trouves || trouves.length !== 1) {
      console.error(`✗ ${f.chemin} — « ${c.nom} » : passage ${!trouves ? "introuvable" : `trouvé ${trouves.length} fois`}`);
      erreurs++;
      continue;
    }
    texte = texte.replace(c.cherche, c.remplace);
    console.log(`✓ ${c.nom}`);
  }
  resultats.push({ chemin: f.chemin, original, texte });
}

if (erreurs > 0) {
  console.error(`\nRien n'a été modifié (${erreurs} problème(s)). Copiez ce message à Claude.`);
  process.exit(1);
}

for (const r of resultats) {
  writeFileSync(`${r.chemin}.bak`, r.original, "utf8");
  writeFileSync(r.chemin, r.texte, "utf8");
}
console.log("\nTerminé : fichiers mis à jour (copies .bak gardées à côté).");
