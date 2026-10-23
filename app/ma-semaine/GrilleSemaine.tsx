"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  activiteRecente,
  alertesSemaine,
  cleAffaire,
  codeApresChangementActivite,
  ecartJour,
  estDiversType,
  etiquetteDivers,
  formaterHeures,
  normaliserCodeGrille,
  numeroSemaineISO,
  periodeCourte,
  problemesLigne,
  regrouperParAffaire,
  valeursParDefaut,
  type AffaireGrille,
  type CodeGrille,
  type GroupeActiviteGrille,
  type JourGrille,
  type LigneGrille,
  type PresenceGrille,
  type RangeeAffaire,
} from "@/lib/grilleSemaine";

/* ===============================================================
   MA SEMAINE - SAISIE EN GRILLE

   Une AFFAIRE par ligne, un JOUR par colonne. Dans chaque case : une ou plusieurs
   imputations, chacune avec son ACTIVITÉ, son CODE (filtré par l'activité) et ses
   HEURES, comme sur la feuille classique. Pour aller vite, une nouvelle ligne reprend
   l'activité de la précédente sur la même affaire (et le code quand l'activité n'en
   autorise qu'un).

   Les cartes « Objectif » restent collées en haut et passent au vert quand l'objectif
   du jour est atteint (ou dépassé). Les données manquantes sont signalées sur la ligne
   concernée et dans un encadré « À compléter ».

   Sur téléphone (< 760 px) : un jour à la fois, mêmes lignes en pleine largeur.

   Ce composant ne connaît ni Supabase ni les règles de validation : il
   affiche ce qu'on lui donne et appelle les fonctions reçues en propriétés.
================================================================ */

export type TypeAffaireChoix = { valeur: string; libelle: string; numeroRequis: boolean };

/* Affaire proposée par le « + » : prévue au planning cette semaine (prevu renseigné),
   ou de la semaine précédente, avec l'activité à proposer d'office */
export type AffaireRecenteGrille = AffaireGrille & { activiteId?: string | null; prevu?: string };

/* SOUS_DOSSIER : texte libre facultatif, précisant le sous-dossier de l'affaire */
export type ModificationLigne = Partial<Pick<LigneGrille, "activiteId" | "code" | "heures">> & { sousDossier?: string };

export type GrilleSemaineProps = {
  jours: JourGrille[];
  /* change quand on change de semaine : les choix locaux de la grille sont alors remis à zéro */
  cleSemaine?: string;
  lectureSeule?: boolean;

  /* activités et codes autorisés pour un type d'affaire */
  activitesEtCodes: (typeAffaire: string) => GroupeActiviteGrille[];

  typesAffaire?: TypeAffaireChoix[];
  affairesRecentes?: AffaireRecenteGrille[];
  codesAbsence: CodeGrille[];

  onModifierLigne: (date: string, ligneId: string, modification: ModificationLigne) => void;
  onAjouterLigne: (date: string, ligne: LigneGrille) => void;
  onSupprimerLigne: (date: string, ligneId: string) => void;
  onChangerDescription: (affaire: AffaireGrille, description: string) => void;
  onRetirerAffaire: (affaire: AffaireGrille) => void;
  onChangerPresence: (date: string, presence: PresenceGrille) => void;
  onChangerTicket: (date: string, ticket: boolean) => void;
  onChangerAbsence: (date: string, code: string) => void;

  /* augmente à chaque tentative d'enregistrer ou de valider la semaine : les alertes de données
     manquantes ne s'affichent qu'à ce moment-là (et seulement s'il y a quelque chose à corriger) */
  verificationDemandee?: number;

  /* champs complémentaires d'une absence (heures de RE, durée d'un CP…), fournis par la page */
  renderDetailAbsence?: (date: string) => ReactNode;

  /* téléphone : jour affiché piloté par la page (sa barre du bas change de jour) */
  jourSelectionne?: string;
  onSelectionnerJour?: (date: string) => void;
  masquerNavigationJour?: boolean;

  forcerMobile?: boolean;

  /* numéros d'affaire connus (Pilotage, Suivi d'affaire…) : null = numéro inconnu.
     Absent = pas de contrôle (repères indisponibles). */
  affaireConnue?: (typeAffaire: string, numero: string) => { designation: string } | null;

  /* heures prévues au planning cette semaine, par affaire (clé « CBE|1533 ») */
  prevuParAffaire?: Record<string, number>;
};

const TYPES_PAR_DEFAUT: TypeAffaireChoix[] = [
  { valeur: "CBE", libelle: "CBE", numeroRequis: true },
  { valeur: "DBE", libelle: "DBE", numeroRequis: true },
  { valeur: "DIVERS", libelle: "Divers", numeroRequis: false },
];

const C = {
  rouge: "#c00000",
  rougeFonce: "#8f0000",
  encre: "#1f2328",
  gris: "#5b6168",
  ligne: "#e1e4e8",
  separateur: "#b3b9c0",
  fond: "#f1f2f4",
  alerte: "#b3261e",
};

const STATUTS: Record<PresenceGrille, { nom: string; bg: string; bord: string; txt: string; ic: string }> = {
  PRESENTIEL: { nom: "Présentiel", bg: "#cdeedb", bord: "#00b050", txt: "#0b4a25", ic: "●" },
  TELETRAVAIL: { nom: "Télétravail", bg: "#fff6a8", bord: "#d4c400", txt: "#4d4400", ic: "⌂" },
  ABSENT: { nom: "Absent", bg: "#ffd9bf", bord: "#ff6600", txt: "#6b2a00", ic: "✕" },
};

const HACHURE = "repeating-linear-gradient(45deg,#e6e8eb,#e6e8eb 6px,#f3f4f6 6px,#f3f4f6 12px)";

const LARGEUR_AFFAIRE = 210;
const LARGEUR_TOTAL = 56;
const LARGEUR_JOUR_MIN = 170;

const nouvelId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function useEstMobile(forcer?: boolean) {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const maj = () => setMobile(window.innerWidth < 760);
    maj();
    window.addEventListener("resize", maj);
    return () => window.removeEventListener("resize", maj);
  }, []);

  return forcer ?? mobile;
}

const champ = (mobile: boolean): CSSProperties => ({
  boxSizing: "border-box",
  minHeight: mobile ? 46 : 38,
  fontSize: mobile ? 17 : 14,
  fontFamily: "inherit",
  color: C.encre,
  background: "#ffffff",
  border: "1.5px solid #b9bec5",
  borderRadius: 8,
});

const nomAffaire = (a: { typeAffaire: string; numeroAffaire: string }) =>
  estDiversType(a.typeAffaire) ? "Divers" : `${a.typeAffaire} ${a.numeroAffaire}`.trim();

/* ------------------------------ cartes objectif ------------------------------ */

function CarteObjectif({ jour, mobile }: { jour: JourGrille; mobile: boolean }) {
  const { manque, supplementaires } = ecartJour(jour);

  let style: CSSProperties;
  let ligne1: string;
  let ligne2: string;

  if (jour.etat === "FERIE" || jour.etat === "ABSENT") {
    style = { background: HACHURE, border: "2.5px solid #c9cdd2", color: "#4b5057" };
    ligne1 = jour.etat === "FERIE" ? "Férié" : jour.note || "Absent";
    ligne2 = "objectif 0 h";
  } else if (jour.etat === "COMPLET") {
    style = { background: "#e3f4e6", border: "2.5px solid #2e7d32", color: "#14532d" };
    ligne1 = `✓ ${formaterHeures(jour.saisi)} / ${formaterHeures(jour.objectif)} h`;
    ligne2 = supplementaires > 0 ? `+${formaterHeures(supplementaires)} h en plus` : "Objectif atteint";
  } else {
    style = { background: "#fff7ea", border: "2.5px solid #e9b877", color: "#7a3e00" };
    ligne1 = `▲ ${formaterHeures(jour.saisi)} / ${formaterHeures(jour.objectif)} h`;
    ligne2 = `Manque ${formaterHeures(manque)} h`;
  }

  return (
    <div
      role="status"
      aria-label={`Objectif du ${jour.libelleLong} : ${ligne1}, ${ligne2}`}
      style={{ ...style, borderRadius: 10, padding: mobile ? "10px 12px" : "6px 8px", textAlign: "center", lineHeight: 1.25 }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3px", opacity: 0.85 }}>
        OBJECTIF {jour.etat === "FERIE" || jour.etat === "ABSENT" ? "—" : `${formaterHeures(jour.objectif)} h`}
      </div>
      <div style={{ fontSize: mobile ? 22 : 17, fontWeight: 800 }}>{ligne1}</div>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{ligne2}</div>
    </div>
  );
}

/* ------------------------------ une ligne d'imputation ------------------------------ */

const rouge: CSSProperties = { border: `2px solid ${C.alerte}`, background: "#fff4f4" };

/* Activité, puis code (filtré par l'activité), puis heures : comme sur la feuille classique.
   Version REPLIEE (case vide au repos) : seules les heures sont visibles ; l'activité et le code
   sont simplement masqués (même éléments, donc le curseur reste dans le champ des heures). */
function Entree({
  jour,
  ligne,
  brouillon,
  montrerAlertes,
  replie,
  indication,
  nom,
  groupes,
  mobile,
  lectureSeule,
  onActivite,
  onCode,
  onHeures,
  sousDossier,
  onSousDossier,
  onSupprimer,
}: {
  jour: JourGrille;
  ligne: LigneGrille;
  brouillon: boolean;
  montrerAlertes: boolean;
  replie: boolean;
  indication: string;
  nom: string;
  groupes: GroupeActiviteGrille[];
  mobile: boolean;
  lectureSeule: boolean;
  onActivite: (activiteId: string | null) => void;
  onCode: (code: string) => void;
  onHeures: (texte: string) => void;
  sousDossier: string;
  onSousDossier: (texte: string) => void;
  onSupprimer: (() => void) | null;
}) {
  const divers = estDiversType(ligne.typeAffaire);
  const problemes = brouillon || !montrerAlertes ? [] : problemesLigne(ligne, groupes);
  const pbActivite = problemes.includes("activité manquante");
  const pbCode = problemes.some((p) => p.startsWith("code"));
  const pbHeures = problemes.some((p) => p.startsWith("heures"));

  const groupe = groupes.find((g) => g.activiteId === (divers ? null : ligne.activiteId));
  const codes = groupe?.codes ?? [];
  const codeInconnu = ligne.code !== "" && !codes.some((c) => normaliserCodeGrille(c.code) === normaliserCodeGrille(ligne.code));
  const activiteInconnue = !divers && ligne.activiteId !== null && !groupes.some((g) => g.activiteId === ligne.activiteId);
  const sansActivite = !divers && !ligne.activiteId;
  const titre = problemes.length > 0 ? `À corriger : ${problemes.join(", ")}` : undefined;
  const masque: CSSProperties = replie ? { display: "none" } : {};

  return (
    <div style={replie ? undefined : { marginBottom: 8, paddingBottom: 6, borderBottom: `1px dotted ${problemes.length > 0 ? "#e5a3a3" : "#d5d9de"}` }}>
      {!divers && (
        <select
          aria-label={`Activité, ${nom}, ${jour.libelle}`}
          aria-invalid={pbActivite}
          title={titre}
          value={ligne.activiteId ?? ""}
          disabled={lectureSeule}
          onChange={(e) => onActivite(e.target.value || null)}
          style={{
            ...champ(mobile),
            width: "100%",
            minHeight: mobile ? 40 : 28,
            fontSize: mobile ? 15 : 12,
            fontWeight: 800,
            padding: "0 4px",
            marginBottom: 4,
            background: "#f6f7f8",
            borderColor: "#d5d9de",
            color: sansActivite ? C.gris : C.encre,
            ...(pbActivite ? rouge : {}),
            ...masque,
          }}
        >
          <option value="">Activité…</option>
          {activiteInconnue && <option value={ligne.activiteId ?? ""}>Activité (non proposée)</option>}
          {groupes.map((g) => (
            <option key={g.activiteId ?? "d"} value={g.activiteId ?? ""}>
              {g.nom}
            </option>
          ))}
        </select>
      )}

      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <select
          aria-label={`Code, ${nom}, ${jour.libelle}`}
          aria-invalid={pbCode}
          title={sansActivite ? "Choisissez d'abord l'activité" : titre ?? codes.find((c) => normaliserCodeGrille(c.code) === normaliserCodeGrille(ligne.code))?.libelle}
          value={ligne.code}
          disabled={lectureSeule || sansActivite}
          onChange={(e) => onCode(e.target.value)}
          style={{ ...champ(mobile), width: mobile ? 130 : 70, flex: "none", padding: "0 2px", fontWeight: 800, color: ligne.code ? C.rougeFonce : C.gris, ...(pbCode ? rouge : {}), ...masque }}
        >
          <option value="">Code</option>
          {codeInconnu && <option value={ligne.code}>{ligne.code} ⚠</option>}
          {codes.map((c) => (
            <option key={c.code} value={c.code}>
              {mobile ? `${c.code} — ${c.libelle}` : c.code}
            </option>
          ))}
        </select>

        <input
          aria-label={`Heures, ${nom}, ${jour.libelle}`}
          aria-invalid={pbHeures}
          title={titre ?? (replie ? indication : undefined)}
          inputMode="decimal"
          placeholder={replie ? "—" : "h"}
          disabled={lectureSeule}
          value={ligne.heures}
          onChange={(e) => onHeures(e.target.value.replace(/[^0-9.,]/g, ""))}
          style={{
            ...champ(mobile),
            flex: 1,
            minWidth: 0,
            padding: "0 8px",
            textAlign: "right",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            ...(replie ? { borderColor: "#e3e6ea", background: "#fbfbfc", minHeight: mobile ? 46 : 34 } : {}),
            ...(pbHeures ? rouge : {}),
          }}
        />

        {onSupprimer && !lectureSeule && (
          <button
            type="button"
            aria-label={`Retirer cette ligne, ${nom}, ${jour.libelle}`}
            title="Retirer cette ligne"
            onClick={onSupprimer}
            style={{ flex: "none", width: mobile ? 44 : 24, height: mobile ? 44 : 34, border: "none", background: "transparent", color: C.gris, fontSize: 17, cursor: "pointer", padding: 0 }}
          >
            ×
          </button>
        )}
      </div>

      {!replie && !brouillon && !divers && (
        <input
          aria-label={`Sous-dossier, ${nom}, ${jour.libelle}`}
          title="Sous-dossier de l'affaire sur lequel vous avez travaillé (facultatif)"
          placeholder="Sous-dossier (facultatif)"
          value={sousDossier}
          disabled={lectureSeule}
          onChange={(e) => onSousDossier(e.target.value)}
          style={{
            ...champ(mobile),
            width: "100%",
            minHeight: mobile ? 40 : 28,
            fontSize: mobile ? 15 : 12,
            marginTop: 4,
            padding: "0 6px",
            borderColor: "#d5d9de",
            background: "#fcfcfd",
          }}
        />
      )}
    </div>
  );
}

/* Le contenu d'une case (affaire × jour). Une case vide propose déjà des champs, pré-remplis
   avec l'activité de l'affaire : on ne crée l'imputation que quand on saisit quelque chose. */
function CelluleJour({
  rangee,
  jour,
  mobile,
  props,
  groupes,
  activiteParDefaut,
  montrerAlertes,
}: {
  rangee: RangeeAffaire;
  jour: JourGrille;
  mobile: boolean;
  props: GrilleSemaineProps;
  groupes: GroupeActiviteGrille[];
  activiteParDefaut: string | null;
  montrerAlertes: boolean;
}) {
  const lectureSeule = Boolean(props.lectureSeule);
  const lignes = rangee.lignesParDate.get(jour.date) ?? [];
  const idPrevu = useRef("");
  if (!idPrevu.current) idPrevu.current = nouvelId();
  const [actif, setActif] = useState(false); // le curseur est dans la case

  if (jour.fige) {
    return <div aria-hidden="true" style={{ minHeight: mobile ? 52 : 44, background: HACHURE, borderRadius: 8 }} />;
  }

  const brouillon = lignes.length === 0;
  const nom = nomAffaire(rangee);

  const defauts = valeursParDefaut(rangee.typeAffaire, activiteParDefaut, groupes);
  const nomDefaut = groupes.find((g) => g.activiteId === defauts.activiteId)?.nom;
  const indication =
    defauts.activiteId && nomDefaut
      ? `Saisissez des heures : ${nomDefaut}${defauts.code ? ` · ${defauts.code}` : ""} (cliquez pour modifier)`
      : estDiversType(rangee.typeAffaire)
        ? "Cliquez pour choisir le code, puis saisissez les heures"
        : "Cliquez pour choisir l'activité et le code, puis saisissez les heures";

  const modele: LigneGrille = {
    id: idPrevu.current,
    typeAffaire: rangee.typeAffaire,
    numeroAffaire: rangee.numeroAffaire,
    description: rangee.description,
    activiteId: defauts.activiteId,
    code: defauts.code,
    heures: "",
  };

  const entrees = brouillon ? [modele] : lignes;

  // sous-dossier de la ligne (porté par l'imputation de la feuille)
  const sousDossierDe = (id: string) => {
    const trouvee = [...(jour.imputations as unknown as { id: string; sousDossier?: string }[]), ...(lignes as unknown as { id: string; sousDossier?: string }[])].find((l) => l.id === id);
    return String(trouvee?.sousDossier ?? "");
  };

  const modifier = (ligne: LigneGrille, patch: ModificationLigne) => {
    if (brouillon) props.onAjouterLigne(jour.date, { ...ligne, ...patch });
    else props.onModifierLigne(jour.date, ligne.id, patch);
  };

  return (
    <div
      style={{ minWidth: 0 }}
      onFocus={() => setActif(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActif(false);
      }}
    >
      {entrees.map((ligne) => (
        <Entree
          key={ligne.id}
          jour={jour}
          ligne={ligne}
          brouillon={brouillon}
          montrerAlertes={montrerAlertes}
          replie={brouillon && !actif}
          indication={indication}
          nom={nom}
          groupes={groupes}
          mobile={mobile}
          lectureSeule={lectureSeule}
          onActivite={(activiteId) =>
            modifier(ligne, { activiteId, code: codeApresChangementActivite(ligne.code, activiteId, groupes) })
          }
          onCode={(code) => modifier(ligne, { code })}
          onHeures={(heures) => modifier(ligne, { heures })}
          sousDossier={sousDossierDe(ligne.id)}
          onSousDossier={(sousDossier) => modifier(ligne, { sousDossier })}
          onSupprimer={!brouillon ? () => props.onSupprimerLigne(jour.date, ligne.id) : null}
        />
      ))}

      {!brouillon && !lectureSeule && (
        <button
          type="button"
          aria-label={`Ajouter une ligne, ${nom}, ${jour.libelle}`}
          onClick={() => {
            const derniere = lignes[lignes.length - 1];
            const suite = valeursParDefaut(rangee.typeAffaire, derniere?.activiteId ?? activiteParDefaut, groupes);

            props.onAjouterLigne(jour.date, {
              id: nouvelId(),
              typeAffaire: rangee.typeAffaire,
              numeroAffaire: rangee.numeroAffaire,
              description: rangee.description,
              activiteId: suite.activiteId,
              code: suite.code,
              heures: "",
            });
          }}
          style={{ minHeight: mobile ? 44 : 24, width: "100%", border: "none", background: "transparent", color: C.gris, fontWeight: 700, fontSize: 12, fontFamily: "inherit", textAlign: "left", padding: "0 2px", cursor: "pointer" }}
        >
          + ligne
        </button>
      )}
    </div>
  );
}

const Puce = ({ children }: { children: ReactNode }) => (
  <span style={{ background: "#fde1e1", color: "#8f1010", border: "1px solid #e5a3a3", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>
    {children}
  </span>
);

/* En-tête d'une affaire : type, numéro, croix, description modifiable directement */
function EnteteAffaire({ rangee, props, mobile, montrerAlertes }: { rangee: RangeeAffaire; props: GrilleSemaineProps; mobile: boolean; montrerAlertes: boolean }) {
  const divers = estDiversType(rangee.typeAffaire);
  const lectureSeule = Boolean(props.lectureSeule);
  const nom = nomAffaire(rangee);
  const numeroInvalide = montrerAlertes && !divers && !/^\d{4}$/.test(rangee.numeroAffaire.trim());
  const numeroInconnu =
    !divers && /^\d{4}$/.test(rangee.numeroAffaire.trim()) && props.affaireConnue
      ? props.affaireConnue(rangee.typeAffaire, rangee.numeroAffaire.trim()) === null
      : false;
  const prevu = props.prevuParAffaire?.[cleAffaire(rangee)] ?? 0;
  const descriptionManquante = montrerAlertes && divers && !rangee.description.trim();

  const badge: CSSProperties = {
    background: rangee.typeAffaire === "CBE" ? "#f3c9c9" : rangee.typeAffaire === "DBE" ? "#f2bfd0" : "#e9edf2",
    color: rangee.typeAffaire === "CBE" ? "#4a0f0f" : rangee.typeAffaire === "DBE" ? "#4a0f28" : "#333a42",
    fontWeight: 800,
    fontSize: 12,
    padding: "3px 8px",
    borderRadius: 5,
  };

  function retirer() {
    if (rangee.total > 0 || rangee.lignesParDate.size > 0) {
      if (!window.confirm(`Retirer ${nom} de cette semaine ? Les heures saisies sur cette affaire seront supprimées.`)) return;
    }

    props.onRetirerAffaire(rangee);
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={badge}>{divers ? "Divers" : rangee.typeAffaire}</span>
        {!divers && <strong style={{ fontSize: 18 }}>{rangee.numeroAffaire || "—"}</strong>}
        {numeroInvalide && <Puce>numéro à 4 chiffres</Puce>}
        {numeroInconnu && (
          <span
            title="Ce numéro n'existe ni dans le Pilotage ni dans le Suivi d'affaire : vérifiez-le (ses heures ne seraient comptées sur aucune affaire)."
            style={{ background: "#fff1df", color: "#7a3e00", border: "1px solid #e9b877", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}
          >
            n° inconnu
          </span>
        )}
        <span style={{ flex: 1 }} />

        {!lectureSeule && (
          <button
            type="button"
            aria-label={`Retirer ${nom} de la semaine`}
            title="Retirer cette affaire de la semaine"
            onClick={retirer}
            style={{ flex: "none", width: mobile ? 44 : 32, height: mobile ? 44 : 32, border: "none", background: "transparent", color: C.gris, fontSize: 20, lineHeight: 1, cursor: "pointer" }}
          >
            ×
          </button>
        )}
      </div>

      <input
        aria-label={`Description de ${nom}`}
        aria-invalid={descriptionManquante}
        placeholder={divers ? "Description (obligatoire)" : "Description (facultative)"}
        value={rangee.description}
        disabled={lectureSeule}
        onChange={(e) => props.onChangerDescription(rangee, e.target.value)}
        style={{
          ...champ(mobile),
          width: "100%",
          minHeight: mobile ? 44 : 34,
          fontSize: 13,
          marginTop: 6,
          padding: "0 8px",
          ...(descriptionManquante ? rouge : {}),
        }}
      />
      {prevu > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: "#34506b" }} title="Heures prévues pour vous sur cette affaire au planning de la semaine">
          📅 {formaterHeures(prevu)} h prévues au planning
        </div>
      )}
    </div>
  );
}

/* « + » de la colonne Affaire : affaires de la semaine précédente, ou autre affaire */
function PanneauAjout({
  rangees,
  props,
  mobile,
  onAjouter,
  onFermer,
}: {
  rangees: RangeeAffaire[];
  props: GrilleSemaineProps;
  mobile: boolean;
  onAjouter: (a: AffaireRecenteGrille) => void;
  onFermer: () => void;
}) {
  const types = props.typesAffaire ?? TYPES_PAR_DEFAUT;
  const [type, setType] = useState(types[0]?.valeur ?? "CBE");
  const [numero, setNumero] = useState("");
  const [description, setDescription] = useState("");
  const [erreur, setErreur] = useState("");

  const presentes = new Set(rangees.map((r) => r.cle));
  const proposees = (props.affairesRecentes ?? []).filter((a) => !presentes.has(cleAffaire(a)));
  const prevues = proposees.filter((a) => a.prevu);
  const recentes = proposees.filter((a) => !a.prevu);
  const choix = types.find((t) => t.valeur === type);
  const divers = estDiversType(type);

  // Numéro saisi : connu (désignation proposée) ou inconnu (avertissement, on peut ajouter quand même)
  const n4 = /^[0-9]{4}$/.test(numero.trim()) ? numero.trim() : "";
  const connue = n4 && props.affaireConnue ? props.affaireConnue(type, n4) : undefined;

  function ajouterAutre() {
    const n = numero.trim();
    const d = description.trim() || (connue?.designation ?? "");

    if (choix?.numeroRequis && !/^[0-9]{4}$/.test(n)) {
      setErreur("Le numéro d’affaire a 4 chiffres.");
      return;
    }

    if (divers && !d) {
      setErreur("Une ligne Divers doit avoir une description (ex. « Formation SolidWorks », « Réunion d’équipe »).");
      return;
    }

    if (divers && presentes.has(cleAffaire({ typeAffaire: type, numeroAffaire: etiquetteDivers(d) }))) {
      setErreur("Cette ligne Divers existe déjà dans la semaine.");
      return;
    }

    onAjouter({
      typeAffaire: type,
      numeroAffaire: divers ? etiquetteDivers(d) : choix?.numeroRequis ? n : "",
      description: d,
    });
    setNumero("");
    setDescription("");
    setErreur("");
  }

  const boutonProposition = (a: AffaireRecenteGrille) => (
    <button
      key={cleAffaire(a)}
      type="button"
      onClick={() => onAjouter(a)}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 48, padding: "6px 14px", border: "none", borderBottom: `1px solid ${C.ligne}`, background: "#ffffff", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
    >
      <strong>{nomAffaire(a)}</strong>
      <span style={{ flex: 1, fontSize: 13, color: "#3b4046", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.description}</span>
      {a.prevu && <span style={{ fontSize: 12, fontWeight: 700, color: "#34506b", whiteSpace: "nowrap" }}>{a.prevu}</span>}
      <span style={{ fontWeight: 800, color: C.rougeFonce, fontSize: 13 }}>+ ajouter</span>
    </button>
  );

  return (
    <div style={{ border: "1.5px solid #b9bec5", borderRadius: 12, background: "#ffffff", boxShadow: "0 8px 22px rgba(0,0,0,.12)", maxWidth: 520, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", fontWeight: 800, background: C.fond, borderBottom: `1px solid ${C.ligne}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Ajouter une affaire
        <button type="button" onClick={onFermer} aria-label="Fermer" style={{ minWidth: 44, minHeight: 44, border: "none", background: "transparent", fontSize: 20, cursor: "pointer" }}>
          ×
        </button>
      </div>

      {prevues.length > 0 && (
        <div>
          <div style={{ padding: "8px 14px 2px", fontSize: 12, fontWeight: 800, letterSpacing: ".3px", color: "#34506b" }}>📅 PRÉVU POUR MOI AU PLANNING CETTE SEMAINE</div>
          {prevues.map(boutonProposition)}
        </div>
      )}

      {recentes.length > 0 && (
        <div>
          <div style={{ padding: "8px 14px 2px", fontSize: 12, fontWeight: 800, letterSpacing: ".3px", color: C.gris }}>MES AFFAIRES DE LA SEMAINE PRÉCÉDENTE</div>
          {recentes.map(boutonProposition)}
        </div>
      )}

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".3px", color: C.gris }}>UNE AUTRE AFFAIRE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select aria-label="Type d'affaire" value={type} onChange={(e) => setType(e.target.value)} style={{ ...champ(mobile), padding: "0 8px", fontWeight: 700 }}>
            {types.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.libelle}
              </option>
            ))}
          </select>
          {choix?.numeroRequis && (
            <input aria-label="Numéro d'affaire" inputMode="numeric" maxLength={4} placeholder="N° (4 chiffres)" value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^0-9]/g, ""))} style={{ ...champ(mobile), width: 150, padding: "0 10px" }} />
          )}
          <input
            aria-label={divers ? "Description (obligatoire)" : "Description (facultative)"}
            placeholder={divers ? "Description (obligatoire)" : connue?.designation ? connue.designation : "Description (facultative)"}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...champ(mobile), flex: 1, minWidth: 140, padding: "0 10px" }}
          />
        </div>
        {!divers && n4 && connue && (
          <div style={{ fontSize: 13, color: "#14532d", fontWeight: 700 }}>✓ {type} {n4} : {connue.designation || "affaire connue"}</div>
        )}
        {!divers && n4 && connue === null && (
          <div style={{ fontSize: 13, color: "#7a3e00", fontWeight: 700 }}>
            ⚠ {type} {n4} n’existe ni dans le Pilotage ni dans le Suivi d’affaire. Vérifiez le numéro : vous pouvez l’ajouter quand même.
          </div>
        )}
        {erreur && <div role="alert" style={{ color: C.alerte, fontSize: 13, fontWeight: 700 }}>{erreur}</div>}
        <div>
          <button type="button" onClick={ajouterAutre} style={{ minHeight: 44, padding: "0 18px", border: `1.5px solid ${C.rouge}`, background: C.rouge, color: "#ffffff", fontWeight: 700, fontSize: 15, fontFamily: "inherit", borderRadius: 8, cursor: "pointer" }}>
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuPresence({ jour, mobile, lectureSeule, onChange }: { jour: JourGrille; mobile: boolean; lectureSeule: boolean; onChange: (p: PresenceGrille) => void }) {
  const st = STATUTS[jour.presence];
  const style: CSSProperties = { ...champ(mobile), width: "100%", minHeight: 44, padding: "0 8px", fontSize: 14, fontWeight: 800, background: st.bg, color: st.txt, border: `2px solid ${st.bord}` };

  if (jour.presence === "ABSENT" || !jour.presenceModifiable || lectureSeule) {
    return (
      <select aria-label={`Présence du ${jour.libelleLong}`} disabled style={style} value={jour.presence} onChange={() => undefined}>
        <option value={jour.presence}>{`${st.ic} ${st.nom}`}</option>
      </select>
    );
  }

  return (
    <select aria-label={`Présence du ${jour.libelleLong}`} value={jour.presence} onChange={(e) => onChange(e.target.value as PresenceGrille)} style={style}>
      <option value="PRESENTIEL">{`${STATUTS.PRESENTIEL.ic} ${STATUTS.PRESENTIEL.nom}`}</option>
      <option value="TELETRAVAIL">{`${STATUTS.TELETRAVAIL.ic} ${STATUTS.TELETRAVAIL.nom}`}</option>
    </select>
  );
}

/* ------------------------------ composant principal ------------------------------ */

export default function GrilleSemaine(props: GrilleSemaineProps) {
  const mobile = useEstMobile(props.forcerMobile);
  const lectureSeule = Boolean(props.lectureSeule);
  const jours = props.jours;
  const cleSemaine = props.cleSemaine ?? jours[0]?.date ?? "";

  const [ajoutees, setAjoutees] = useState<AffaireGrille[]>([]);
  const [activitesInitiales, setActivitesInitiales] = useState<Record<string, string | null>>({});
  const [panneauAjout, setPanneauAjout] = useState(false);
  const [jourMobile, setJourMobile] = useState("");
  const [alertesVisibles, setAlertesVisibles] = useState(false);

  // Autre semaine : les choix locaux ne s'appliquent plus.
  useEffect(() => {
    setAjoutees([]);
    setActivitesInitiales({});
    setPanneauAjout(false);
    setAlertesVisibles(false);
  }, [cleSemaine]);

  const largeurRequise = LARGEUR_AFFAIRE + LARGEUR_TOTAL + jours.length * LARGEUR_JOUR_MIN;
  const [ecranEtroit, setEcranEtroit] = useState(false);

  useEffect(() => {
    const maj = () => setEcranEtroit(window.innerWidth < largeurRequise + 48);
    maj();
    window.addEventListener("resize", maj);
    return () => window.removeEventListener("resize", maj);
  }, [largeurRequise]);

  const rangees = useMemo(() => regrouperParAffaire(jours, ajoutees), [jours, ajoutees]);
  const alertes = alertesSemaine(jours, props.activitesEtCodes);

  // Les alertes n'apparaissent qu'après une tentative d'enregistrer ou de valider, et disparaissent
  // d'elles-mêmes dès que tout est corrigé (elles ne réapparaissent pas à chaque nouvelle saisie).
  const verification = props.verificationDemandee ?? 0;

  useEffect(() => {
    if (verification > 0) setAlertesVisibles(true);
  }, [verification]);

  useEffect(() => {
    if (alertes.length === 0 && alertesVisibles) setAlertesVisibles(false);
  });

  const montrerAlertes = alertesVisibles && alertes.length > 0;

  function ajouterAffaire(a: AffaireRecenteGrille) {
    const cle = cleAffaire(a);

    setAjoutees((liste) => (liste.some((x) => cleAffaire(x) === cle) ? liste : [...liste, { typeAffaire: a.typeAffaire, numeroAffaire: a.numeroAffaire, description: a.description }]));

    if (a.activiteId) setActivitesInitiales((m) => ({ ...m, [cle]: a.activiteId ?? null }));

    setPanneauAjout(false);
  }

  const propsInternes: GrilleSemaineProps = {
    ...props,
    onChangerDescription: (a, description) => {
      setAjoutees((liste) => liste.map((x) => (cleAffaire(x) === cleAffaire(a) ? { ...x, description } : x)));
      props.onChangerDescription(a, description);
    },
    onRetirerAffaire: (a) => {
      setAjoutees((liste) => liste.filter((x) => cleAffaire(x) !== cleAffaire(a)));
      props.onRetirerAffaire(a);
    },
  };

  const activitePar = (r: RangeeAffaire) => activiteRecente(r) ?? activitesInitiales[r.cle] ?? null;

  const optionsAbsence = (jour: JourGrille) => (
    <div style={{ minWidth: 0 }}>
      <select
        aria-label={`Absence du ${jour.libelleLong}`}
        value={jour.absence}
        disabled={lectureSeule}
        onChange={(e) => props.onChangerAbsence(jour.date, e.target.value)}
        style={{ ...champ(mobile), width: "100%", minHeight: 44, padding: "0 8px", fontSize: 14, fontWeight: 700 }}
      >
        <option value="">— aucune —</option>
        {props.codesAbsence.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.libelle}
          </option>
        ))}
      </select>
      {props.renderDetailAbsence?.(jour.date)}
    </div>
  );

  const ticket = (jour: JourGrille) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, cursor: jour.ticketModifiable && !lectureSeule ? "pointer" : "default", opacity: jour.ticketModifiable ? 1 : 0.5 }}>
      <input
        type="checkbox"
        checked={jour.ticket}
        disabled={!jour.ticketModifiable || lectureSeule}
        onChange={(e) => props.onChangerTicket(jour.date, e.target.checked)}
        style={{ width: 22, height: 22, margin: 0 }}
      />
      <span style={{ fontSize: 14 }}>Ticket restaurant</span>
    </label>
  );

  const libelleDates = (dates: string[]) => dates.map((d) => jours.find((j) => j.date === d)?.libelle ?? d).join(", ");

  const encadreAlertes =
    montrerAlertes ? (
      <div role="alert" style={{ border: `2px solid ${C.alerte}`, background: "#fff4f4", borderRadius: 10, padding: "10px 14px", marginBottom: 12, color: "#5c0a0a", fontSize: 14 }}>
        <strong>⚠ À compléter avant d’enregistrer</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 2 }}>
          {alertes.slice(0, 8).map((a) => (
            <li key={`${a.affaire}|${a.message}`}>
              <strong>{a.affaire}</strong> : {a.message} <span style={{ color: C.gris }}>({libelleDates(a.dates)})</span>
            </li>
          ))}
          {alertes.length > 8 && <li>… et {alertes.length - 8} autre(s)</li>}
        </ul>
      </div>
    ) : null;

  /* ------------------------------ téléphone : un jour à la fois ------------------------------ */
  if (mobile) {
    const courant = jours.find((j) => j.date === (props.jourSelectionne ?? jourMobile)) ?? jours[0];
    const index = courant ? jours.indexOf(courant) : -1;
    const choisirJour = (date: string) => (props.onSelectionnerJour ? props.onSelectionnerJour(date) : setJourMobile(date));

    if (!courant) return null;

    return (
      <section aria-label="Saisie de la semaine" style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 130 }}>
        {!props.masquerNavigationJour && (
          <div style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr) 48px", alignItems: "center", gap: 8 }}>
            <button type="button" aria-label="Jour précédent" disabled={index <= 0} onClick={() => choisirJour(jours[index - 1].date)} style={{ ...champ(true), height: 48, fontSize: 18, fontWeight: 800, color: C.rougeFonce, opacity: index <= 0 ? 0.35 : 1 }}>◀</button>
            <div style={{ textAlign: "center", fontWeight: 800, fontSize: 18 }}>{courant.libelleLong}</div>
            <button type="button" aria-label="Jour suivant" disabled={index >= jours.length - 1} onClick={() => choisirJour(jours[index + 1].date)} style={{ ...champ(true), height: 48, fontSize: 18, fontWeight: 800, color: C.rougeFonce, opacity: index >= jours.length - 1 ? 0.35 : 1 }}>▶</button>
          </div>
        )}

        {encadreAlertes}

        <CarteObjectif jour={courant} mobile />

        {rangees.map((r) => (
          <div key={r.cle} style={{ border: `1.5px solid ${C.ligne}`, borderRadius: 12, padding: 12, background: "#ffffff" }}>
            <EnteteAffaire rangee={r} props={propsInternes} mobile montrerAlertes={montrerAlertes} />
            <div style={{ marginTop: 8 }}>
              <CelluleJour rangee={r} jour={courant} mobile props={propsInternes} groupes={props.activitesEtCodes(r.typeAffaire)} activiteParDefaut={activitePar(r)} montrerAlertes={montrerAlertes} />
            </div>
          </div>
        ))}

        {!lectureSeule && (
          <div>
            {panneauAjout ? (
              <PanneauAjout rangees={rangees} props={propsInternes} mobile onAjouter={ajouterAffaire} onFermer={() => setPanneauAjout(false)} />
            ) : (
              <button type="button" onClick={() => setPanneauAjout(true)} style={{ minHeight: 48, padding: "0 18px", border: `2px solid ${C.rouge}`, background: "#ffffff", color: C.rouge, fontWeight: 800, fontSize: 16, fontFamily: "inherit", borderRadius: 999, cursor: "pointer" }}>
                + Ajouter une affaire
              </button>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: `1.5px solid ${C.ligne}`, borderRadius: 12, background: "#ffffff" }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Absence</div>
            {optionsAbsence(courant)}
          </div>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Présence</div>
            <MenuPresence jour={courant} mobile lectureSeule={lectureSeule} onChange={(p) => props.onChangerPresence(courant.date, p)} />
          </div>
          {ticket(courant)}
        </div>
      </section>
    );
  }

  /* ------------------------------ ordinateur : la grille ------------------------------ */
  const nbJours = jours.length;
  const gabarit = `${LARGEUR_AFFAIRE}px repeat(${nbJours}, minmax(${LARGEUR_JOUR_MIN}px, 1fr)) ${LARGEUR_TOTAL}px`;
  const bordJour = (i: number): CSSProperties => (i === 0 ? {} : { borderLeft: `1px solid ${C.separateur}` });
  const bordTotal: CSSProperties = { borderLeft: "2px solid #6b7076" };
  const rangeeStyle = (extra?: CSSProperties): CSSProperties => ({ display: "grid", gridTemplateColumns: gabarit, ...extra });

  return (
    <section
      aria-label="Saisie de la semaine en grille"
      // Fenêtre étroite : la grille défile dans son cadre, dans les deux sens, pour que la ligne des jours reste fixe
      style={ecranEtroit ? { overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 16px)" } : { overflowX: "visible" }}
    >
      {encadreAlertes}

      <div style={{ minWidth: largeurRequise }}>
        {/* ligne des jours et cartes objectif : reste FIXE en haut quand on fait défiler */}
        <div
          data-ligne-jours
          style={rangeeStyle({ position: "sticky", top: 0, zIndex: 5, background: "#ffffff", borderBottom: `1px solid ${C.ligne}`, boxShadow: "0 4px 6px -4px rgba(0,0,0,.28)" })}
        >
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, padding: "0 8px 8px" }}>
            {jours.length > 0 && (
              <div title="Semaine affichée" style={{ lineHeight: 1.15 }}>
                <strong style={{ fontSize: 24, color: C.rouge }}>S{String(numeroSemaineISO(jours[0].date)).padStart(2, "0")}</strong>{" "}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#3b4046" }}>{periodeCourte(jours[0].date, jours[jours.length - 1].date)}</span>
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris }}>Affaire</div>
          </div>
          {jours.map((j, i) => (
            <div key={j.date} style={{ padding: "6px 6px 8px", ...bordJour(i) }}>
              <div style={{ textAlign: "center", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{j.libelle}</div>
              <CarteObjectif jour={j} mobile={false} />
            </div>
          ))}
          <div title="Total de la semaine par affaire" style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 8px", fontSize: 12, fontWeight: 800, color: C.gris, ...bordTotal }}>Σ h</div>
        </div>

        {rangees.map((r) => {
          const groupes = props.activitesEtCodes(r.typeAffaire);
          const defaut = activitePar(r);

          return (
            <div key={r.cle} style={rangeeStyle({ borderBottom: `1px solid ${C.ligne}` })}>
              <div style={{ padding: "10px 8px" }}>
                <EnteteAffaire rangee={r} props={propsInternes} mobile={false} montrerAlertes={montrerAlertes} />
              </div>
              {jours.map((j, i) => (
                <div key={j.date} style={{ padding: 6, ...bordJour(i) }}>
                  <CelluleJour rangee={r} jour={j} mobile={false} props={propsInternes} groupes={groupes} activiteParDefaut={defaut} montrerAlertes={montrerAlertes} />
                </div>
              ))}
              <div style={{ padding: "14px 4px", textAlign: "center", fontWeight: 800, fontSize: 15, fontVariantNumeric: "tabular-nums", ...bordTotal }}>{r.total > 0 ? formaterHeures(r.total) : ""}</div>
            </div>
          );
        })}

        {/* « + » de la colonne Affaire */}
        {!lectureSeule && (
          <div style={rangeeStyle({ borderBottom: `1px solid ${C.ligne}` })}>
            <div style={{ padding: "8px" }}>
              <button
                type="button"
                aria-label="Ajouter une affaire"
                aria-expanded={panneauAjout}
                title="Ajouter une affaire"
                onClick={() => setPanneauAjout((v) => !v)}
                style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${C.rouge}`, background: "#ffffff", color: C.rouge, fontSize: 28, fontWeight: 700, lineHeight: 1, fontFamily: "inherit", cursor: "pointer" }}
              >
                +
              </button>
            </div>
            <div style={{ gridColumn: `2 / ${nbJours + 3}`, padding: "10px 8px", color: C.gris, fontSize: 13 }}>
              {panneauAjout ? "" : "Ajouter une affaire à la feuille"}
            </div>
          </div>
        )}

        {panneauAjout && !lectureSeule && (
          <div style={{ padding: "12px 8px" }}>
            <PanneauAjout rangees={rangees} props={propsInternes} mobile={false} onAjouter={ajouterAffaire} onFermer={() => setPanneauAjout(false)} />
          </div>
        )}

        {/* absence, présence, ticket */}
        <div style={rangeeStyle({ borderTop: `2px solid ${C.ligne}`, borderBottom: `1px solid ${C.ligne}` })}>
          <div style={{ padding: "12px 8px", fontWeight: 800 }}>
            Absence
            <div style={{ fontSize: 12, fontWeight: 600, color: C.gris }}>déclarée ici, comme avant</div>
          </div>
          {jours.map((j, i) => (
            <div key={j.date} style={{ padding: 6, minWidth: 0, ...bordJour(i) }}>{optionsAbsence(j)}</div>
          ))}
          <div style={bordTotal} />
        </div>

        <div style={rangeeStyle({ borderBottom: `1px solid ${C.ligne}` })}>
          <div style={{ padding: "12px 8px", fontWeight: 800 }}>
            Présence
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", marginTop: 4 }}>
              {(Object.keys(STATUTS) as PresenceGrille[]).map((k) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#3b4046" }}>
                  <i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: STATUTS[k].bg, border: `2px solid ${STATUTS[k].bord}`, boxSizing: "border-box" }} />
                  {STATUTS[k].nom}
                </span>
              ))}
            </div>
          </div>
          {jours.map((j, i) => (
            <div key={j.date} style={{ padding: 6, ...bordJour(i) }}>
              <MenuPresence jour={j} mobile={false} lectureSeule={lectureSeule} onChange={(p) => props.onChangerPresence(j.date, p)} />
            </div>
          ))}
          <div style={bordTotal} />
        </div>

        <div style={rangeeStyle({ borderBottom: `1px solid ${C.ligne}` })}>
          <div style={{ padding: "6px 8px", fontWeight: 800, display: "flex", alignItems: "center" }}>Ticket restaurant</div>
          {jours.map((j, i) => (
            <div key={j.date} style={{ padding: "0 10px", display: "flex", alignItems: "center", ...bordJour(i) }}>{ticket(j)}</div>
          ))}
          <div style={bordTotal} />
        </div>
      </div>
    </section>
  );
}
