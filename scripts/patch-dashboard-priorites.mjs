#!/usr/bin/env node
/* ===============================================================
   POLYNOV-TEMPS - Tableau de bord : cartes par priorité, plus petites

   ADMIN (de haut en bas) :
     1. Pilotage BE : planning des affaires et nouvelle affaire en tête
     2. Validations RH : validation RH, compteurs de récupération, feuilles à relancer
     3. Mon espace
     4. Analyse : analyse de charge, bilan activités, bilan RH mensuel, export Excel, feuilles collaborateurs
     5. Paramétrage de l'application : replié par défaut (codes, activités, collaborateurs,
        rythmes, imputations des affaires, export IA, import)
   Les cartes sont compactes (une page tient sans défiler), le suivi rapide devient une
   ligne de pastilles, « À traiter » devient la carte « Feuilles à relancer ».
   RESPONSABLE et COLLABORATEUR : même contenu qu'avant (Mon espace en premier).

   Version 2 : bouton « Afficher » du paramétrage bien visible ; Portefeuille et Charge par
   ressource retirés (accessibles par les onglets du planning) ; Bilan affaire en haut ;
   cloche avec le nombre de demandes RH à valider (ADMIN), actualisée chaque minute ;
   retrait des alert() et console.log de mise au point. Met à jour la version 1.

   Ne modifie PAS le chargement des données : seulement l'affichage.

   Utilisation, depuis la racine du projet :
       node scripts/patch-dashboard-priorites.mjs

   Tout ou rien. Sauvegarde : page.tsx.bak-dashboard. Sans effet si relancé.
=============================================================== */

import fs from "node:fs";
import path from "node:path";

const cible = path.resolve(process.argv[2] ?? "app/dashboard/page.tsx");

if (!fs.existsSync(cible)) {
  console.error(`Fichier introuvable : ${cible}\nLancez ce script depuis la racine du projet.`);
  process.exit(1);
}

const original = fs.readFileSync(cible, "utf8");
const crlf = original.includes("\r\n");
let source = original.replace(/\r\n/g, "\n");

if (source.includes("MA_DASHBOARD_PRIORITES_V2")) {
  console.log("Déjà appliqué : rien à faire.");
  process.exit(0);
}

// Version 1 déjà installée : on repart du fichier d'origine sauvegardé.
let miseAJour = false;

if (source.includes("MA_DASHBOARD_PRIORITES_V1")) {
  const sauvegarde = `${cible}.bak-dashboard`;

  if (!fs.existsSync(sauvegarde)) {
    console.error("La version 1 est installée mais la sauvegarde page.tsx.bak-dashboard est introuvable.\nEnvoyez-moi ce message.");
    process.exit(1);
  }

  source = fs.readFileSync(sauvegarde, "utf8").replace(/\r\n/g, "\n");
  miseAJour = true;
  console.log("Version 1 détectée : mise à jour vers la version 2 à partir du fichier d'origine.");
}

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

const BANDE = "/* ===============================================================\n";

/* ------------------------------------------------------------------ 0) import du type ReactNode */
{
  const ancien = 'import { useEffect, useMemo, useState, type CSSProperties } from "react";';

  if (unique("import de react", ancien) >= 0) {
    source = source.replace(ancien, 'import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";');
  }
}

/* ------------------------------------------------------------------ 1) état du groupe « Paramétrage » */
{
  const ancien = "  const [monCollaborateurId, setMonCollaborateurId] =\n    useState<string | null>(null);\n";

  if (unique("état monCollaborateurId", ancien) >= 0) {
    source = source.replace(
      ancien,
      `${ancien}
  // Groupe « Paramétrage de l'application » : replié par défaut, choix mémorisé dans le navigateur
  const [parametrageOuvert, setParametrageOuvert] = useState(false);

  useEffect(() => {
    try {
      setParametrageOuvert(window.localStorage.getItem("polynov_dashboard_parametrage") === "1");
    } catch {
      /* navigateur sans stockage : on garde la valeur par défaut */
    }
  }, []);

  function basculerParametrage() {
    setParametrageOuvert((valeur) => {
      const suivant = !valeur;

      try {
        window.localStorage.setItem("polynov_dashboard_parametrage", suivant ? "1" : "0");
      } catch {
        /* sans stockage : le choix ne sera pas mémorisé */
      }

      return suivant;
    });
  }

  // Cloche : demandes RH en attente de validation (ADMIN), actualisées chaque minute et au retour sur l'onglet
  const [demandesCloche, setDemandesCloche] = useState<DemandeCloche[]>([]);

  useEffect(() => {
    if (role !== "ADMIN") return;

    let actif = true;

    async function rafraichir() {
      try {
        const { count } = await supabase
          .from("rh_demandes")
          .select("id", { count: "exact", head: true })
          .eq("statut", "EN_ATTENTE");

        const { data } = await supabase
          .from("rh_demandes_admin")
          .select("id, prenom, nom, trigramme, type_demande, date_debut, date_fin")
          .eq("statut", "EN_ATTENTE")
          .order("date_debut", { ascending: true })
          .limit(5);

        if (!actif) return;

        if (typeof count === "number") setNombreDemandesRH(count);
        setDemandesCloche((data ?? []) as DemandeCloche[]);
      } catch {
        /* la cloche garde sa dernière valeur : on réessaiera à la prochaine actualisation */
      }
    }

    void rafraichir();

    const minuteur = window.setInterval(rafraichir, 60000);
    const auRetour = () => {
      if (document.visibilityState === "visible") void rafraichir();
    };

    document.addEventListener("visibilitychange", auRetour);

    return () => {
      actif = false;
      window.clearInterval(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [role]);
`
    );
  }
}

/* ------------------------------------------------------------------ 2) « à relancer » : le nombre exact, plus plafonné à 8 */
{
  const ancien = "        .filter((ligne): ligne is LigneSurveillance => ligne !== null)\n        .slice(0, 8);";

  if (unique("liste des feuilles à relancer", ancien) >= 0) {
    source = source.replace(ancien, "        .filter((ligne): ligne is LigneSurveillance => ligne !== null);");
  }
}

/* ------------------------------------------------------------------ 3) le contenu de la page */
{
  const debutMarque =
    "      {/* =======================================================\n          CONTENU\n      ======================================================= */}\n";
  const debut = unique("bloc CONTENU", debutMarque);
  const finMarque = "\n      </div>\n\n      <style jsx>{`\n        @keyframes spin {";
  const fin = source.lastIndexOf(finMarque);

  if (debut >= 0 && fin > debut) {
    const apres = source.slice(fin, fin + 400);

    if (!apres.includes("@media (max-width: 800px)")) {
      echecs.push("fin du contenu : la feuille de style finale n'a pas été reconnue");
    } else {
      const ancien = source.slice(debut, fin + "\n      </div>\n".length);

      if (!ancien.includes("MON ESPACE") || !ancien.includes("Pilotage BE") || !ancien.includes("Import historique")) {
        echecs.push("contenu de la page : contenu inattendu");
      } else {
        const nouveau = `      {/* MA_DASHBOARD_PRIORITES_V2 : cartes par priorité et plus petites (ADMIN : Pilotage BE, Validations RH, Mon espace, Analyse, Paramétrage replié) */}
      <div style={{ ...styles.container, padding: "14px 30px 32px 30px" }}>
        <div style={stylesV2.accueil}>
          <div>
            <h1 style={stylesV2.bonjour}>
              Bonjour {prenom || ""}
              {" 👋"}
            </h1>

            <div style={stylesV2.semaine}>
              {semaineCourante
                ? \`Semaine S\${numeroSemaine(semaineCourante)} · \${formaterSemaine(semaineCourante)}\`
                : "—"}
            </div>
          </div>

          {role === "ADMIN" && (
            <div style={stylesV2.chips} title={\`Feuilles de la semaine du \${formaterDateLongue(semaineCourante)}\`}>
              <ChipSuivi icone="👥" valeur={String(statistiques.collaborateurs)} label="actifs" />
              <ChipSuivi
                icone="✓"
                valeur={\`\${statistiques.feuillesCompletes} / \${statistiques.feuillesTotal}\`}
                label="feuilles complètes"
                ton={statistiques.feuillesCompletes >= statistiques.feuillesTotal ? "ok" : "neutre"}
              />
              <ChipSuivi icone="⏱️" valeur={\`\${formatHeures(statistiques.heures)} h\`} label="saisies" />
              <ChipSuivi icone="＋" valeur={\`\${formatHeures(statistiques.heuresSupplementaires)} h\`} label="heures sup" ton="alerte" />
            </div>
          )}
        </div>

        {role === "ADMIN" ? (
          <>
            <BlocPilotage aller={(url) => router.push(url)} />

            <BlocValidationsRH
              aller={(url) => router.push(url)}
              nombreDemandesRH={nombreDemandesRH}
              aRelancer={surveillance}
            />

            <BlocMonEspace
              aller={(url) => router.push(url)}
              statut={maFeuille ? (estFeuilleComplete(maFeuille) ? "complete" : "incomplete") : "absente"}
              libelle={maFeuille ? \`Semaine du \${formaterDateLongue(semaineCourante)}\` : "Ma feuille de la semaine courante"}
              avecBilanAffaire={false}
            />

            <BlocAnalyse
              aller={(url) => router.push(url)}
              admin
              accesFeuilles={accesFeuilles}
              accesBilanRH={accesBilanRH}
              accesExportExcel={accesExportExcel}
            />

            <BlocParametrage
              aller={(url) => router.push(url)}
              ouvert={parametrageOuvert}
              onBasculer={basculerParametrage}
            />
          </>
        ) : (
          <>
            <BlocMonEspace
              aller={(url) => router.push(url)}
              statut={maFeuille ? (estFeuilleComplete(maFeuille) ? "complete" : "incomplete") : "absente"}
              libelle={maFeuille ? \`Semaine du \${formaterDateLongue(semaineCourante)}\` : "Ma feuille de la semaine courante"}
              avecBilanAffaire={!peut(role, "piloterBE")}
            />

            {peut(role, "piloterBE") && <BlocPilotage aller={(url) => router.push(url)} />}

            <BlocAnalyse
              aller={(url) => router.push(url)}
              admin={false}
              accesFeuilles={accesFeuilles}
              accesBilanRH={accesBilanRH}
              accesExportExcel={accesExportExcel}
            />
          </>
        )}
      </div>
`;

        source = source.slice(0, debut) + nouveau + source.slice(debut + ancien.length);
      }
    }
  } else if (debut >= 0) {
    echecs.push("fin du contenu de la page : introuvable");
  }
}

/* ------------------------------------------------------------------ 3b) cloche dans l'en-tête de la page */
{
  const bannière = "          HEADER\n      ======================================================= */}\n";
  const debut = unique("bandeau HEADER", bannière);

  if (debut >= 0) {
    const motif = /\{role && \(\s*<div\s+style=\{\s*styles\.headerRole\s*\}\s*>\s*\{role\}\s*<\/div>\s*\)\}/;
    const reste = source.slice(debut);
    const m = motif.exec(reste);

    if (!m) {
      echecs.push("en-tête : pastille du rôle introuvable");
    } else {
      const a = debut + m.index;

      source =
        source.slice(0, a) +
        `<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {role === "ADMIN" && (
              <ClocheDemandesRH nombre={nombreDemandesRH} demandes={demandesCloche} onAller={(url) => router.push(url)} />
            )}

            {role && <div style={styles.headerRole}>{role}</div>}
          </div>` +
        source.slice(a + m[0].length);
    }
  }
}

/* ------------------------------------------------------------------ 3c) nettoyage : alert() et console.log de mise au point */
{
  const retraits = [
    ["console.log USER DASHBOARD", /[ \t]*console\.log\("USER DASHBOARD", user\);\n/],
    ["console.log ERREUR DASHBOARD", /[ \t]*console\.log\("ERREUR DASHBOARD", erreurUtilisateur\);\n/],
    ["alert utilisateur non connecté", /[ \t]*alert\("Dashboard : utilisateur non connecté"\);\n/],
    ["console.log USER ID", /[ \t]*console\.log\("USER ID", user\.id\);\n/],
    ["console.log COLLABORATEUR", /[ \t]*console\.log\("COLLABORATEUR", collaborateur\);\n/],
    ["alert collaborateur introuvable", /[ \t]*alert\(\s*"Collaborateur introuvable pour : " \+\s*user\.id\s*\);\n/],
  ];

  for (const [nom, motif] of retraits) {
    if (motif.test(source)) source = source.replace(motif, "");
    else echecs.push(`nettoyage : ${nom} introuvable`);
  }
}

/* ------------------------------------------------------------------ 4) composants : on remplace SectionTitre, Carte et Kpi */
{
  const debutMarque = `${BANDE}   SECTION TITRE\n`;
  const finMarque = `${BANDE}   UTILITAIRES\n`;
  const a = unique("composants SectionTitre / Carte / Kpi", debutMarque);
  const b = unique("bloc UTILITAIRES", finMarque);

  if (a >= 0 && b > a) {
    const ancien = source.slice(a, b);

    if (!ancien.includes("function SectionTitre") || !ancien.includes("function Carte(") || !ancien.includes("function Kpi(")) {
      echecs.push("composants SectionTitre / Carte / Kpi : contenu inattendu");
    } else {
      const composants = `${BANDE}   COMPOSANTS DU TABLEAU DE BORD (cartes compactes, par priorité)
================================================================ */

type Ton = "neutre" | "alerte" | "ok";

function Pastille({ texte, ton = "neutre" }: { texte: string; ton?: Ton }) {
  return <span style={{ ...stylesV2.pastille, ...stylesV2[\`pastille_\${ton}\`] }}>{texte}</span>;
}

function ChipSuivi({
  icone,
  valeur,
  label,
  ton = "neutre",
}: {
  icone: string;
  valeur: string;
  label: string;
  ton?: Ton;
}) {
  return (
    <div style={stylesV2.chip}>
      <span aria-hidden="true">{icone}</span>
      <strong style={{ color: ton === "ok" ? "#26712b" : ton === "alerte" ? "#c76500" : "#222222" }}>{valeur}</strong>
      <span style={{ color: "#777777" }}>{label}</span>
    </div>
  );
}

function Groupe({
  titre,
  description,
  children,
  droite,
  surClic,
  deplie,
}: {
  titre: string;
  description?: string;
  children?: ReactNode;
  droite?: ReactNode;
  /* groupe repliable : toute la ligne de titre est cliquable */
  surClic?: () => void;
  deplie?: boolean;
}) {
  const cliquable = Boolean(surClic);

  return (
    <section style={stylesV2.groupe} aria-label={titre}>
      <div
        style={{ ...stylesV2.groupeEntete, ...(cliquable ? stylesV2.groupeEnteteCliquable : {}) }}
        {...(cliquable
          ? {
              role: "button",
              tabIndex: 0,
              "aria-expanded": deplie,
              onClick: surClic,
              onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  surClic?.();
                }
              },
            }
          : {})}
      >
        <h2 style={stylesV2.groupeTitre}>{titre}</h2>
        {description && <span style={stylesV2.groupeDescription}>{description}</span>}
        {droite}
      </div>

      {children}
    </section>
  );
}

function CarteCompacte({
  icone,
  titre,
  description,
  onClick,
  badge,
  ton = "neutre",
  principale = false,
}: {
  icone: string;
  titre: string;
  description: string;
  onClick: () => void;
  badge?: string | null;
  ton?: Ton;
  principale?: boolean;
}) {
  const [survol, setSurvol] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={titre}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        ...stylesV2.carte,
        ...(principale ? stylesV2.cartePrincipale : {}),
        boxShadow: survol ? "0 6px 16px rgba(0,0,0,0.14)" : "0 1px 5px rgba(0,0,0,0.08)",
        transform: survol ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <div style={{ ...stylesV2.carteIcone, ...(principale ? stylesV2.carteIconePrincipale : {}) }}>{icone}</div>

      <div style={stylesV2.carteTexte}>
        <div style={stylesV2.carteTitreLigne}>
          <h3 style={stylesV2.carteTitre}>{titre}</h3>
          {badge && <Pastille texte={badge} ton={ton} />}
        </div>

        <p style={stylesV2.carteDescription}>{description}</p>
      </div>
    </div>
  );
}

type DemandeCloche = {
  id: string;
  prenom: string | null;
  nom: string | null;
  trigramme: string | null;
  type_demande: string | null;
  date_debut: string | null;
  date_fin: string | null;
};

const LIBELLES_DEMANDE: Record<string, string> = {
  RE: "Récupération",
  CP: "Congés payés",
  RTT: "RTT",
};

function ClocheDemandesRH({
  nombre,
  demandes,
  onAller,
}: {
  nombre: number;
  demandes: DemandeCloche[];
  onAller: (url: string) => void;
}) {
  const [ouverte, setOuverte] = useState(false);

  useEffect(() => {
    if (!ouverte) return;

    const fermerClavier = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOuverte(false);
    };
    const fermerClic = (e: MouseEvent) => {
      const cible = e.target as HTMLElement | null;
      if (!cible?.closest("[data-cloche]")) setOuverte(false);
    };

    document.addEventListener("keydown", fermerClavier);
    document.addEventListener("mousedown", fermerClic);

    return () => {
      document.removeEventListener("keydown", fermerClavier);
      document.removeEventListener("mousedown", fermerClic);
    };
  }, [ouverte]);

  const dateFR = (valeur: string | null) => (valeur ? new Date(\`\${valeur}T00:00:00\`).toLocaleDateString("fr-FR") : "");

  return (
    <div data-cloche style={stylesV2.clocheZone}>
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        aria-label={
          nombre > 0
            ? \`Notifications : \${nombre} demande\${nombre > 1 ? "s" : ""} RH à valider\`
            : "Notifications : aucune demande RH à valider"
        }
        title={nombre > 0 ? \`\${nombre} demande\${nombre > 1 ? "s" : ""} RH à valider\` : "Aucune demande RH à valider"}
        style={stylesV2.cloche}
      >
        <span aria-hidden="true" style={{ fontSize: 20 }}>🔔</span>
        {nombre > 0 && <span style={stylesV2.clocheBadge}>{nombre > 99 ? "99+" : nombre}</span>}
      </button>

      {ouverte && (
        <div role="dialog" aria-label="Demandes RH à valider" style={stylesV2.clochePanneau}>
          <div style={stylesV2.clocheTitre}>
            {nombre > 0 ? \`Demandes RH à valider (\${nombre})\` : "Aucune demande RH en attente ✓"}
          </div>

          {demandes.map((d) => (
            <div key={d.id} style={stylesV2.clocheLigne}>
              <strong>{[d.prenom, d.nom].filter(Boolean).join(" ") || d.trigramme || "—"}</strong>
              <span style={{ color: "#666666", fontSize: 12.5 }}>
                {LIBELLES_DEMANDE[String(d.type_demande ?? "")] ?? d.type_demande ?? "Demande"}
                {d.date_debut ? \` · \${dateFR(d.date_debut)}\` : ""}
                {d.date_fin && d.date_fin !== d.date_debut ? \` → \${dateFR(d.date_fin)}\` : ""}
              </span>
            </div>
          ))}

          {nombre > demandes.length && demandes.length > 0 && (
            <div style={{ color: "#666666", fontSize: 12.5, padding: "6px 14px" }}>… et {nombre - demandes.length} autre(s)</div>
          )}

          <button
            type="button"
            onClick={() => {
              setOuverte(false);
              onAller("/admin/Valid_RH");
            }}
            style={stylesV2.clocheBouton}
          >
            Ouvrir la validation RH →
          </button>
        </div>
      )}
    </div>
  );
}

function BlocPilotage({ aller }: { aller: (url: string) => void }) {
  return (
    <Groupe titre="Pilotage BE" description="Portefeuille et charge : onglets en haut du planning">
      <div style={stylesV2.grille}>
        <CarteCompacte
          principale
          icone="📅"
          titre="Planning des affaires"
          description="Affecter les ressources en glissant et en étirant, comparer au chiffré"
          onClick={() => aller("/pilotage/affaires")}
        />
        <CarteCompacte
          principale
          icone="＋"
          titre="Nouvelle affaire"
          description="Déclarer un DBE, un CBE, une PE ou une PI"
          onClick={() => aller("/pilotage/nouvelle")}
        />
        <CarteCompacte
          icone="📊"
          titre="Bilan affaire"
          description="Heures imputées par affaire et bilans d'affaires"
          onClick={() => aller("/affaires/bilan")}
        />
      </div>
    </Groupe>
  );
}

function BlocValidationsRH({
  aller,
  nombreDemandesRH,
  aRelancer,
}: {
  aller: (url: string) => void;
  nombreDemandesRH: number;
  aRelancer: LigneSurveillance[];
}) {
  const noms = aRelancer.map((ligne) => ligne.collaborateur.prenom || ligne.collaborateur.nom || "—");

  return (
    <Groupe titre="Validations RH" description="Demandes, compteurs et feuilles à relancer">
      <div style={stylesV2.grille}>
        <CarteCompacte
          icone="🧑‍💼"
          titre="Validation RH"
          description="Valider les demandes nécessitant la double validation PLG / AMA"
          badge={nombreDemandesRH > 0 ? \`\${nombreDemandesRH} en attente\` : null}
          ton="alerte"
          onClick={() => aller("/admin/Valid_RH")}
        />
        <CarteCompacte
          icone="⏱️"
          titre="Compteurs de récupération"
          description="Ajuster un compteur, avec motif et historique"
          onClick={() => aller("/admin/compteurs")}
        />
        <CarteCompacte
          icone="📋"
          titre="Feuilles à relancer"
          description={
            aRelancer.length === 0
              ? "Toutes les feuilles de la semaine dernière sont validées"
              : \`\${noms.slice(0, 4).join(", ")}\${noms.length > 4 ? \` +\${noms.length - 4}\` : ""} : feuille non validée\`
          }
          badge={aRelancer.length === 0 ? "✓" : String(aRelancer.length)}
          ton={aRelancer.length === 0 ? "ok" : "alerte"}
          onClick={() => aller("/admin/feuilles")}
        />
      </div>
    </Groupe>
  );
}

function BlocMonEspace({
  aller,
  statut,
  libelle,
  avecBilanAffaire,
}: {
  aller: (url: string) => void;
  statut: "complete" | "incomplete" | "absente";
  libelle: string;
  avecBilanAffaire: boolean;
}) {
  return (
    <Groupe titre="Mon espace" description="Mes feuilles, mes affaires et mes demandes RH">
      <div style={stylesV2.grille}>
        <CarteCompacte
          icone="📅"
          titre="Ma semaine"
          description={libelle}
          badge={statut === "complete" ? "✓ Complète" : statut === "incomplete" ? "⚠ À compléter" : "⚠ Non saisie"}
          ton={statut === "complete" ? "ok" : "alerte"}
          onClick={() => aller("/ma-semaine")}
        />
        <CarteCompacte
          icone="📄"
          titre="Mes feuilles"
          description="Mes feuilles de temps enregistrées"
          onClick={() => aller("/mes-feuilles")}
        />
        {avecBilanAffaire && (
          <CarteCompacte
            icone="📊"
            titre="Bilan affaire"
            description="Mes imputations et mes bilans d'affaires"
            onClick={() => aller("/affaires/bilan")}
          />
        )}
        <CarteCompacte
          icone="🧑‍💼"
          titre="RH"
          description="Mes demandes de congés, RTT et récupération"
          onClick={() => aller("/RH")}
        />
      </div>
    </Groupe>
  );
}

function BlocAnalyse({
  aller,
  admin,
  accesFeuilles,
  accesBilanRH,
  accesExportExcel,
}: {
  aller: (url: string) => void;
  admin: boolean;
  accesFeuilles: boolean;
  accesBilanRH: boolean;
  accesExportExcel: boolean;
}) {
  if (!admin && !accesFeuilles && !accesBilanRH && !accesExportExcel) return null;

  return (
    <Groupe
      titre={admin ? "Analyse" : "Suivi des équipes"}
      description={
        admin
          ? "Charge, activités, bilan RH mensuel, exports et feuilles des collaborateurs"
          : "Feuilles de temps, bilan RH mensuel et export Excel"
      }
    >
      <div style={stylesV2.grille}>
        {admin && (
          <CarteCompacte
            icone="📈"
            titre="Analyse de charge"
            description="Heures, activité et taux d'occupation de chaque collaborateur"
            onClick={() => aller("/admin/bilans")}
          />
        )}
        {admin && (
          <CarteCompacte
            icone="🧩"
            titre="Bilan activités"
            description="Heures CBE / DBE réparties par activité"
            onClick={() => aller("/admin/bilan-activites")}
          />
        )}
        {accesBilanRH && (
          <CarteCompacte
            icone="🧑‍💼"
            titre="Bilan RH mensuel"
            description="TR, télétravail, heures supplémentaires et compteur"
            onClick={() => aller("/admin/bilan-rh")}
          />
        )}
        {accesExportExcel && (
          <CarteCompacte
            icone="📊"
            titre="Export Excel"
            description="Fichier hebdomadaire compatible avec l'ancien système"
            onClick={() => aller("/admin/export-excel")}
          />
        )}
        {accesFeuilles && (
          <CarteCompacte
            icone="📋"
            titre="Feuilles collaborateurs"
            description="Consulter les feuilles de temps de tous les collaborateurs"
            onClick={() => aller("/admin/feuilles")}
          />
        )}
      </div>
    </Groupe>
  );
}

function BlocParametrage({
  aller,
  ouvert,
  onBasculer,
}: {
  aller: (url: string) => void;
  ouvert: boolean;
  onBasculer: () => void;
}) {
  return (
    <Groupe
      titre="⚙️ Paramétrage de l'application"
      description="Codes, activités, collaborateurs, rythmes, imputations, export IA, import"
      surClic={onBasculer}
      deplie={ouvert}
      droite={
        <span style={stylesV2.boutonGroupe}>{ouvert ? "Replier ▴" : "Afficher les 7 réglages ▾"}</span>
      }
    >
      {ouvert && (
        <div style={stylesV2.grille}>
          <CarteCompacte icone="🏷️" titre="Gestion des codes" description="Codes, contextes d'utilisation et classement dans les bilans" onClick={() => aller("/admin/Gestion-codes")} />
          <CarteCompacte icone="🧩" titre="Gestion des activités" description="Activités du BE et codes d'imputation associés" onClick={() => aller("/admin/Gestion-activites")} />
          <CarteCompacte icone="👥" titre="Collaborateurs" description="Créer, modifier et gérer les collaborateurs" onClick={() => aller("/admin/collaborateurs")} />
          <CarteCompacte icone="⏰" titre="Rythmes horaires" description="Profils, rythmes et bases horaires" onClick={() => aller("/admin/profils-horaires")} />
          <CarteCompacte icone="🏷️" titre="Imputations des affaires" description="Liste BE, PE, PI, Scan, Négoce, IG… du Pilotage BE" onClick={() => aller("/admin/imputations-pilotage")} />
          <CarteCompacte icone="🧠" titre="Export IA" description="Contexte complet du projet : code, base, droits, fonctions SQL" onClick={() => aller("/admin/Export-IA")} />
          <CarteCompacte icone="📥" titre="Import historique" description="Importer les anciennes imputations depuis un fichier" onClick={() => aller("/import-historique-v2")} />
        </div>
      )}
    </Groupe>
  );
}

`;

      source = source.slice(0, a) + composants + source.slice(b);
    }
  }
}

/* ------------------------------------------------------------------ 5) styles des nouvelles cartes (en fin de fichier) */
source =
  source.replace(/\n+$/, "\n") +
  `
/* ===============================================================
   STYLES DES CARTES COMPACTES
================================================================ */

const stylesV2: Record<string, CSSProperties> = {
  accueil: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", margin: "0 0 10px" },
  bonjour: { margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.3px", color: "#222222" },
  semaine: { color: "#777777", fontSize: 13, marginTop: 2 },
  chips: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: { background: "#ffffff", border: "1px solid #e5e5e5", borderRadius: 10, padding: "6px 12px", display: "flex", alignItems: "center", gap: 7, fontSize: 13, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  groupe: { marginBottom: 12 },
  groupeEntete: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 },
  groupeEnteteCliquable: { cursor: "pointer", background: "#ffffff", border: "1px solid #dddddd", borderRadius: 10, padding: "8px 12px", boxShadow: "0 1px 5px rgba(0,0,0,0.08)" },
  groupeTitre: { margin: 0, fontSize: 18, fontWeight: 800, color: "#222222" },
  groupeDescription: { color: "#777777", fontSize: 13 },
  boutonGroupe: { marginLeft: "auto", background: "#333333", color: "#ffffff", borderRadius: 8, padding: "8px 16px", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap" },
  clocheZone: { position: "relative" },
  cloche: { position: "relative", width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.15)", color: "#ffffff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "inherit" },
  clocheBadge: { position: "absolute", top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 999, background: "#ffffff", color: "#c00000", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #c00000", boxSizing: "border-box" },
  clochePanneau: { position: "absolute", top: 54, right: 0, width: 340, maxWidth: "90vw", background: "#ffffff", color: "#222222", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", zIndex: 60, overflow: "hidden", textAlign: "left" },
  clocheTitre: { padding: "12px 14px", fontWeight: 800, fontSize: 15, borderBottom: "1px solid #eeeeee" },
  clocheLigne: { display: "flex", flexDirection: "column", gap: 1, padding: "9px 14px", borderBottom: "1px solid #f3f3f3", fontSize: 14 },
  clocheBouton: { width: "100%", border: "none", background: "#c00000", color: "#ffffff", padding: "12px 14px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  grille: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 },
  carte: { background: "#ffffff", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", borderLeft: "4px solid #c00000", minHeight: 62, transition: "all 0.15s ease", outline: "none" },
  cartePrincipale: { background: "#fff6f6" },
  carteIcone: { width: 38, height: 38, borderRadius: 9, background: "#f8e8e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 },
  carteIconePrincipale: { background: "#c00000", color: "#ffffff" },
  carteTexte: { flex: 1, minWidth: 0 },
  carteTitreLigne: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  carteTitre: { margin: 0, fontSize: 16, fontWeight: 800, color: "#222222" },
  carteDescription: { margin: "2px 0 0", color: "#666666", fontSize: 12.5, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  pastille: { borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap" },
  pastille_neutre: { background: "#f0f0f0", color: "#555555" },
  pastille_alerte: { background: "#fff1df", color: "#c76500" },
  pastille_ok: { background: "#e9f6eb", color: "#26712b" },
};
`;

if (echecs.length > 0) {
  console.error("Aucune modification n'a été faite : certaines pièces du fichier n'ont pas pu être repérées.\n");
  for (const echec of echecs) console.error(` - ${echec}`);
  console.error("\nLe fichier a probablement évolué. Envoyez-moi ce résultat.");
  process.exit(1);
}

const attendus = [
  ["MA_DASHBOARD_PRIORITES_V2", 1],
  ["function BlocPilotage", 1],
  ["function CarteCompacte", 1],
  ["const stylesV2", 1],
  ["parametrageOuvert", 2],
  ["function ClocheDemandesRH", 1],
  ["<ClocheDemandesRH", 1],
  ["avecBilanAffaire", 4],
];

for (const interdit of ["alert(", "console.log("]) {
  if (source.includes(interdit)) {
    console.error(`Contrôle final : « ${interdit} » est encore présent. Aucune modification n'a été faite.`);
    process.exit(1);
  }
}

for (const [texte, n] of attendus) {
  const trouves = source.split(texte).length - 1;

  if (trouves < n) {
    console.error(`Contrôle final : « ${texte} » trouvé ${trouves} fois (au moins ${n} attendu). Aucune modification n'a été faite.`);
    process.exit(1);
  }
}

if (!miseAJour) fs.copyFileSync(cible, `${cible}.bak-dashboard`);
fs.writeFileSync(cible, crlf ? source.replace(/\n/g, "\r\n") : source, "utf8");

console.log("Tableau de bord réorganisé : cartes par priorité et plus petites.");
console.log("Sauvegarde : page.tsx.bak-dashboard. Lancez « npx tsc --noEmit » puis « npm run dev ».");
