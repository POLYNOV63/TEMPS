"use client";

import { useMemo, useState } from "react";
import EnTetePage from "@/components/EnTetePage";
import GrilleSemaine, { type AffaireRecenteGrille } from "../GrilleSemaine";
import {
  etatDuJour,
  totalLignes,
  type CodeGrille,
  type GroupeActiviteGrille,
  type JourGrille,
  type LigneGrille,
  type PresenceGrille,
} from "@/lib/grilleSemaine";

/* ===============================================================
   MA SEMAINE - ESSAI DE LA GRILLE

   Page d'essai : de fausses données, rien n'est enregistré, aucune feuille
   réelle n'est lue ni modifiée. Elle sert à voir et manipuler la grille
   (ordinateur et téléphone) avant de la brancher sur la vraie saisie.
================================================================ */

const GROUPES: Record<string, GroupeActiviteGrille[]> = {
  CBE: [
    {
      activiteId: "meca",
      nom: "Mécanique",
      codes: [
        { code: "EM", libelle: "Études de mécanique" },
        { code: "MP", libelle: "Mise en plan" },
        { code: "DM", libelle: "Dossier de modifications" },
      ],
    },
    {
      activiteId: "elec",
      nom: "Électricité",
      codes: [
        { code: "EE", libelle: "Études d’électricité" },
        { code: "EP", libelle: "Plans électriques" },
      ],
    },
    { activiteId: "calc", nom: "Calcul", codes: [{ code: "CM", libelle: "Calcul" }] },
  ],
  DBE: [{ activiteId: "devis", nom: "Devis", codes: [{ code: "DT", libelle: "Devis technique" }] }],
  DIVERS: [
    {
      activiteId: null,
      nom: "Divers",
      codes: [
        { code: "RN", libelle: "Réunion" },
        { code: "FO", libelle: "Formation" },
        { code: "NI", libelle: "Non imputable" },
      ],
    },
  ],
};

const CODES_ABSENCE: CodeGrille[] = [
  { code: "CP", libelle: "Congé payé" },
  { code: "RT", libelle: "RTT" },
  { code: "ML", libelle: "Maladie" },
];

const JOURS_BASE = [
  { date: "2026-10-19", libelle: "Lun 19", libelleLong: "Lundi 19 octobre", objectif: 7.5 },
  { date: "2026-10-20", libelle: "Mar 20", libelleLong: "Mardi 20 octobre", objectif: 7.5 },
  { date: "2026-10-21", libelle: "Mer 21", libelleLong: "Mercredi 21 octobre", objectif: 7.5 },
  { date: "2026-10-22", libelle: "Jeu 22", libelleLong: "Jeudi 22 octobre", objectif: 7.5 },
  { date: "2026-10-23", libelle: "Ven 23", libelleLong: "Vendredi 23 octobre", objectif: 5 },
];

const L = (id: string, typeAffaire: string, numeroAffaire: string, code: string, heures: string, description = "", activiteId: string | null = null): LigneGrille => ({
  id,
  typeAffaire,
  activiteId,
  numeroAffaire,
  description,
  code,
  heures,
});

type EtatDemo = {
  date: string;
  absence: string;
  presence: PresenceGrille;
  ticket: boolean;
  imputations: LigneGrille[];
};

const DEPART: EtatDemo[] = [
  {
    date: "2026-10-19",
    absence: "",
    presence: "PRESENTIEL",
    ticket: true,
    imputations: [L("a1", "CBE", "1716", "EM", "4,5", "Machine de palettisation", "meca"), L("a2", "CBE", "1716", "MP", "1,5", "Machine de palettisation", "meca"), L("a3", "CBE", "1721", "EE", "2", "Extension de ligne de convoyage", "elec")],
  },
  {
    date: "2026-10-20",
    absence: "",
    presence: "TELETRAVAIL",
    ticket: true,
    imputations: [L("b1", "CBE", "1716", "EM", "3", "Machine de palettisation", "meca"), L("b2", "CBE", "1716", "MP", "2", "Machine de palettisation", "meca"), L("b3", "DBE", "2971", "DT", "2,5", "Offre — modification de ligne", "devis")],
  },
  { date: "2026-10-21", absence: "CP", presence: "ABSENT", ticket: false, imputations: [] },
  {
    date: "2026-10-22",
    absence: "",
    presence: "PRESENTIEL",
    ticket: true,
    imputations: [L("d1", "CBE", "1716", "EM", "4", "Machine de palettisation", "meca"), L("d2", "CBE", "1721", "EE", "2", "Extension de ligne de convoyage", "elec"), L("d3", "DIVERS", "", "RN", "1", "Réunions, administratif…")],
  },
  {
    date: "2026-10-23",
    absence: "",
    presence: "TELETRAVAIL",
    ticket: true,
    imputations: [L("e1", "CBE", "1716", "EM", "2", "Machine de palettisation", "meca"), L("e2", "CBE", "1721", "EE", "3", "Extension de ligne de convoyage", "elec")],
  },
];

const RECENTES: AffaireRecenteGrille[] = [
  { typeAffaire: "CBE", numeroAffaire: "1716", description: "Machine de palettisation", activiteId: "meca" },
  { typeAffaire: "CBE", numeroAffaire: "1721", description: "Extension de ligne de convoyage", activiteId: "elec" },
  { typeAffaire: "CBE", numeroAffaire: "1730", description: "Poste de contrôle dimensionnel", activiteId: "meca" },
  { typeAffaire: "DBE", numeroAffaire: "2975", description: "Offre — poste d’emballage", activiteId: "devis" },
];

const ABSENCES_JOURNEE = new Set(["CP", "RT", "ML"]);

export default function GrilleDemoPage() {
  const [etat, setEtat] = useState<EtatDemo[]>(DEPART);
  const [telephone, setTelephone] = useState(false);
  const [lectureSeule, setLectureSeule] = useState(false);
  const [verification, setVerification] = useState(0);

  const jours: JourGrille[] = useMemo(
    () =>
      JOURS_BASE.map((b) => {
        const e = etat.find((x) => x.date === b.date) as EtatDemo;
        const fige = ABSENCES_JOURNEE.has(e.absence);
        const objectif = fige ? 0 : b.objectif;
        const saisi = totalLignes(e.imputations);

        return {
          date: b.date,
          libelle: b.libelle,
          libelleLong: b.libelleLong,
          estWeekend: false,
          estFerie: false,
          fige,
          objectif,
          saisi,
          etat: etatDuJour(objectif, saisi, fige, false),
          note: CODES_ABSENCE.find((c) => c.code === e.absence)?.libelle ?? "",
          absence: e.absence,
          presence: fige ? "ABSENT" : e.presence === "ABSENT" ? "PRESENTIEL" : e.presence,
          presenceModifiable: !fige,
          ticket: fige ? false : e.ticket,
          ticketModifiable: !fige,
          imputations: e.imputations,
        };
      }),
    [etat]
  );

  const majJour = (date: string, f: (j: EtatDemo) => EtatDemo) => setEtat((liste) => liste.map((j) => (j.date === date ? f(j) : j)));
  const majLigne = (date: string, id: string, patch: Partial<LigneGrille>) =>
    majJour(date, (j) => ({ ...j, imputations: j.imputations.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  return (
    <main style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "Calibri, Arial, sans-serif", color: "#1f2328" }}>
      <EnTetePage section="Essai de la grille" />

      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 16px 40px" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 28 }}>Ma semaine — essai de la grille</h1>
        <p style={{ margin: "0 0 14px", color: "#5b6168" }}>
          Page d’essai : ce sont de fausses données, rien n’est enregistré et vos vraies feuilles ne sont pas touchées. Les alertes de données manquantes n’apparaissent qu’après « Simuler Valider ma semaine ».
        </p>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44 }}>
            <input type="checkbox" checked={telephone} onChange={(e) => setTelephone(e.target.checked)} style={{ width: 22, height: 22 }} />
            Afficher comme sur un téléphone
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44 }}>
            <input type="checkbox" checked={lectureSeule} onChange={(e) => setLectureSeule(e.target.checked)} style={{ width: 22, height: 22 }} />
            Feuille verrouillée (lecture seule)
          </label>
          <button type="button" onClick={() => setVerification((n) => n + 1)} style={{ minHeight: 44, padding: "0 16px", border: "1.5px solid #138113", background: "#138113", color: "#ffffff", borderRadius: 8, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>
            Simuler « Valider ma semaine »
          </button>
          <button type="button" onClick={() => setEtat(DEPART)} style={{ minHeight: 44, padding: "0 16px", border: "1.5px solid #b9bec5", background: "#ffffff", borderRadius: 8, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            Remettre les données de départ
          </button>
        </div>

        <div style={{ background: "#ffffff", borderRadius: 14, border: "1px solid #e1e4e8", padding: telephone ? 12 : 18, maxWidth: telephone ? 420 : undefined }}>
          <GrilleSemaine
            jours={jours}
            lectureSeule={lectureSeule}
            forcerMobile={telephone || undefined}
            affairesRecentes={RECENTES}
            codesAbsence={CODES_ABSENCE}
            activitesEtCodes={(type) => GROUPES[type.toUpperCase()] ?? GROUPES.CBE}
            cleSemaine="2026-10-19"
            verificationDemandee={verification}
            onModifierLigne={(date, id, modification) => majLigne(date, id, modification)}
            onAjouterLigne={(date, ligne) => majJour(date, (j) => ({ ...j, imputations: [...j.imputations, ligne] }))}
            onSupprimerLigne={(date, id) => majJour(date, (j) => ({ ...j, imputations: j.imputations.filter((l) => l.id !== id) }))}
            onChangerDescription={(a, description) =>
              setEtat((liste) =>
                liste.map((j) => ({
                  ...j,
                  imputations: j.imputations.map((l) => (l.typeAffaire === a.typeAffaire && l.numeroAffaire === a.numeroAffaire ? { ...l, description } : l)),
                }))
              )
            }
            onRetirerAffaire={(a) =>
              setEtat((liste) =>
                liste.map((j) => ({
                  ...j,
                  imputations: j.imputations.filter((l) => !(l.typeAffaire === a.typeAffaire && l.numeroAffaire === a.numeroAffaire)),
                }))
              )
            }
            onChangerPresence={(date, presence) => majJour(date, (j) => ({ ...j, presence }))}
            onChangerTicket={(date, ticket) => majJour(date, (j) => ({ ...j, ticket }))}
            onChangerAbsence={(date, absence) => majJour(date, (j) => ({ ...j, absence, imputations: ABSENCES_JOURNEE.has(absence) ? [] : j.imputations }))}
          />
        </div>
      </div>
    </main>
  );
}
