"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import * as XLSX from "xlsx-js-style";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Collaborateur = {
  id: string;
  prenom: string | null;
  nom: string | null;
  trigramme: string | null;
  actif: boolean;
  date_entree: string | null;
  date_sortie: string | null;
};

type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  statut: string | null;
  total_heures: number | null;
  total_theorique: number | null;
  heures_supplementaires: number | null;
  heures_supplementaires_compteur: number | null;
  heures_supplementaires_payees: number | null;
  compteur_apres: number | null;
  cloture_mensuelle: boolean | null;
};

type Jour = {
  id: string;
  feuille_id: string;
  date_jour: string;
  presence: string | null;
  absence: string | null;
  ticket_restaurant: boolean | null;
};

type PeriodeMensuelle = {
  annee: number;
  moisZeroBase: number;
  libelle: string;
  debutCycle: string;
  dateCloture: string;
  semaineCloture: string;
};

type LigneBilan = {
  collaborateur: Collaborateur;
  feuillesAttendues: number;
  feuillesValidees: number;
  feuillesManquantes: number;
  brouillons: number;
  ticketsRestaurant: number;
  teletravail: number;
  heuresSupplementaires: number;
  heuresCompteur: number;
  heuresPayees: number;
  compteurFin: number | null;
  absencesJustifier: number;
  codesAbsence: string[];
};

const EPSILON = 0.01;

function dateISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateISO(value: string) {
  const [annee, mois, jour] = value.split("-").map(Number);
  return new Date(annee, mois - 1, jour);
}

function ajouterJoursISO(value: string, nombre: number) {
  const date = parseDateISO(value);
  date.setDate(date.getDate() + nombre);
  return dateISO(date);
}

function debutSemaineISO(value: string) {
  const date = parseDateISO(value);
  const jourSemaine = date.getDay();
  const decalage = jourSemaine === 0 ? -6 : 1 - jourSemaine;
  date.setDate(date.getDate() + decalage);
  return dateISO(date);
}

function dernierJourDuMois(annee: number, moisZeroBase: number) {
  return new Date(annee, moisZeroBase + 1, 0);
}

function dateClotureMensuelle(annee: number, moisZeroBase: number) {
  const dernier = dernierJourDuMois(annee, moisZeroBase);
  const jourSemaine = dernier.getDay();
  const vendredi = new Date(dernier);

  if (jourSemaine >= 1 && jourSemaine <= 4) {
    vendredi.setDate(dernier.getDate() + (5 - jourSemaine));
  } else if (jourSemaine === 5) {
    vendredi.setDate(dernier.getDate());
  } else if (jourSemaine === 6) {
    vendredi.setDate(dernier.getDate() - 1);
  } else {
    vendredi.setDate(dernier.getDate() - 2);
  }

  return dateISO(vendredi);
}

function construirePeriodes(nombre = 24): PeriodeMensuelle[] {
  const aujourdHui = new Date();
  const periodes: PeriodeMensuelle[] = [];

  for (let i = 0; i < nombre; i += 1) {
    const mois = new Date(
      aujourdHui.getFullYear(),
      aujourdHui.getMonth() - i,
      1
    );

    const annee = mois.getFullYear();
    const moisZeroBase = mois.getMonth();
    const dateCloture = dateClotureMensuelle(annee, moisZeroBase);

    const moisPrecedent = new Date(annee, moisZeroBase - 1, 1);
    const cloturePrecedente = dateClotureMensuelle(
      moisPrecedent.getFullYear(),
      moisPrecedent.getMonth()
    );

    const debutCycle = ajouterJoursISO(cloturePrecedente, 3);

    periodes.push({
      annee,
      moisZeroBase,
      libelle: mois.toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      }),
      debutCycle,
      dateCloture,
      semaineCloture: debutSemaineISO(dateCloture),
    });
  }

  return periodes;
}

function formatHeures(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return parseDateISO(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function nomCollaborateur(collaborateur: Collaborateur) {
  return [collaborateur.prenom, collaborateur.nom]
    .filter(Boolean)
    .join(" ") || "Collaborateur";
}

function estFeuilleValidee(feuille: Feuille) {
  return (feuille.statut ?? "").trim().toUpperCase() === "A_TRAITER";
}

function codeAbsenceNormalise(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

function absenceDoitEtreJustifiee(jour: Jour) {
  const absence = codeAbsenceNormalise(jour.absence);

  // FE correspond au jour férié/hors bilan : pas de justificatif RH.
  if (absence === "FE") return false;

  if (absence) return true;

  return String(jour.presence ?? "").trim().toUpperCase() === "ABSENT";
}

function heuresEntreDates(
  debutInclus: string,
  finInclus: string,
  valeur: string
) {
  return valeur >= debutInclus && valeur <= finInclus;
}

export default function BilanRHPage() {
  const router = useRouter();
  const periodes = useMemo(() => construirePeriodes(), []);

  const [periodeIndex, setPeriodeIndex] = useState(0);
  const [lignes, setLignes] = useState<LigneBilan[]>([]);
  const [chargement, setChargement] = useState(true);
  const [exportation, setExportation] = useState(false);
  const [erreur, setErreur] = useState("");
  const [estAdmin, setEstAdmin] = useState(false);

  const periode = periodes[periodeIndex];

  useEffect(() => {
    async function charger() {
      try {
        setChargement(true);
        setErreur("");

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        const { data: moi, error: erreurMoi } = await supabase
          .from("collaborateurs")
          .select("role")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (erreurMoi) throw erreurMoi;

        const admin = String(moi?.role ?? "").trim().toUpperCase() === "ADMIN";
        setEstAdmin(admin);

        if (!admin) {
          router.push("/dashboard");
          return;
        }

        const { data: collaborateurs, error: erreurCollaborateurs } =
          await supabase
            .from("collaborateurs")
            .select("id, prenom, nom, trigramme, actif, date_entree, date_sortie")
            .eq("actif", true)
            .order("nom", { ascending: true })
            .order("prenom", { ascending: true });

        if (erreurCollaborateurs) throw erreurCollaborateurs;

        const premierJourSemaineCloture = periode.semaineCloture;
        const { data: feuilles, error: erreurFeuilles } = await supabase
          .from("feuilles_heures")
          .select(
            "id, collaborateur_id, semaine_debut, statut, total_heures, total_theorique, heures_supplementaires, heures_supplementaires_compteur, heures_supplementaires_payees, compteur_apres, cloture_mensuelle"
          )
          .gte("semaine_debut", periode.debutCycle)
          .lte("semaine_debut", premierJourSemaineCloture)
          .order("semaine_debut", { ascending: true });

        if (erreurFeuilles) throw erreurFeuilles;

        const toutesLesFeuilles = (feuilles ?? []) as Feuille[];
        const feuilleIds = toutesLesFeuilles.map((item) => item.id);

        let jours: Jour[] = [];

        if (feuilleIds.length > 0) {
          const { data: joursData, error: erreurJours } = await supabase
            .from("feuilles_heures_jours")
            .select(
              "id, feuille_id, date_jour, presence, absence, ticket_restaurant"
            )
            .in("feuille_id", feuilleIds);

          if (erreurJours) throw erreurJours;
          jours = (joursData ?? []) as Jour[];
        }

        const aujourdHui = dateISO(new Date());
        const semaineCourante = debutSemaineISO(aujourdHui);
        const periodeEstCourante =
          aujourdHui >= periode.debutCycle && aujourdHui <= periode.dateCloture;

        const derniereSemaineAttendue = periodeEstCourante
          ? semaineCourante < periode.semaineCloture
            ? semaineCourante
            : periode.semaineCloture
          : periode.semaineCloture;

        const semainesAttendues: string[] = [];
        let semaine = debutSemaineISO(periode.debutCycle);

        while (semaine <= derniereSemaineAttendue) {
          semainesAttendues.push(semaine);
          semaine = ajouterJoursISO(semaine, 7);
        }

        const joursPeriode = jours.filter((jour) =>
          heuresEntreDates(periode.debutCycle, periode.dateCloture, jour.date_jour)
        );

        const feuillesParCollaborateur = new Map<string, Feuille[]>();
        for (const feuille of toutesLesFeuilles) {
          const liste = feuillesParCollaborateur.get(feuille.collaborateur_id) ?? [];
          liste.push(feuille);
          feuillesParCollaborateur.set(feuille.collaborateur_id, liste);
        }

        const joursParFeuille = new Map<string, Jour[]>();
        for (const jour of joursPeriode) {
          const liste = joursParFeuille.get(jour.feuille_id) ?? [];
          liste.push(jour);
          joursParFeuille.set(jour.feuille_id, liste);
        }

        const resultats: LigneBilan[] = ((collaborateurs ?? []) as Collaborateur[]).map(
          (collaborateur) => {
            const feuillesCollaborateur =
              feuillesParCollaborateur.get(collaborateur.id) ?? [];

            const feuilleParSemaine = new Map(
              feuillesCollaborateur.map((item) => [item.semaine_debut, item])
            );

            const feuillesValidees = feuillesCollaborateur.filter(estFeuilleValidee);

            const semainesAttenduesCollaborateur = semainesAttendues.filter((semaineAttendues) => {
              const entre = collaborateur.date_entree;
              const sortie = collaborateur.date_sortie;

              if (entre && semaineAttendues < debutSemaineISO(entre)) return false;
              if (sortie && semaineAttendues > debutSemaineISO(sortie)) return false;
              return true;
            });

            const feuillesManquantes = semainesAttenduesCollaborateur.filter(
              (semaineAttendues) => !feuilleParSemaine.has(semaineAttendues)
            ).length;

            const brouillons = semainesAttenduesCollaborateur.filter((semaineAttendues) => {
              const feuille = feuilleParSemaine.get(semaineAttendues);
              return Boolean(feuille && !estFeuilleValidee(feuille));
            }).length;

            const feuillesValideesDuCycle = feuillesValidees.filter((feuille) =>
              heuresEntreDates(
                periode.debutCycle,
                periode.semaineCloture,
                feuille.semaine_debut
              )
            );

            let ticketsRestaurant = 0;
            let teletravail = 0;
            let absencesJustifier = 0;
            const codesAbsence = new Set<string>();

            for (const feuille of feuillesValideesDuCycle) {
              for (const jour of joursParFeuille.get(feuille.id) ?? []) {
                if (jour.ticket_restaurant) ticketsRestaurant += 1;
                if (String(jour.presence ?? "").trim().toUpperCase() === "TELETRAVAIL") {
                  teletravail += 1;
                }
                if (absenceDoitEtreJustifiee(jour)) {
                  absencesJustifier += 1;
                  const code = codeAbsenceNormalise(jour.absence);
                  codesAbsence.add(code || "ABSENT");
                }
              }
            }

            const heuresSupplementaires = feuillesValideesDuCycle.reduce(
              (total, feuille) => total + Number(feuille.heures_supplementaires ?? 0),
              0
            );

            const heuresCompteur = feuillesValideesDuCycle.reduce(
              (total, feuille) =>
                total + Number(feuille.heures_supplementaires_compteur ?? 0),
              0
            );

            const heuresPayees = feuillesValideesDuCycle.reduce(
              (total, feuille) =>
                total + Number(feuille.heures_supplementaires_payees ?? 0),
              0
            );

            const feuilleCloture = feuilleParSemaine.get(periode.semaineCloture);
            const compteurFin = feuilleCloture?.compteur_apres == null
              ? null
              : Number(feuilleCloture.compteur_apres);

            return {
              collaborateur,
              feuillesAttendues: semainesAttenduesCollaborateur.length,
              feuillesValidees: feuillesValideesDuCycle.length,
              feuillesManquantes,
              brouillons,
              ticketsRestaurant,
              teletravail,
              heuresSupplementaires,
              heuresCompteur,
              heuresPayees,
              compteurFin,
              absencesJustifier,
              codesAbsence: Array.from(codesAbsence).sort(),
            };
          }
        );

        setLignes(resultats);
      } catch (error) {
        console.error(error);
        setErreur(
          error instanceof Error
            ? error.message
            : "Impossible de charger le bilan RH."
        );
      } finally {
        setChargement(false);
      }
    }

    if (periode) charger();
  }, [periode, router]);

  const totaux = useMemo(() => {
    return lignes.reduce(
      (acc, ligne) => {
        acc.tr += ligne.ticketsRestaurant;
        acc.tt += ligne.teletravail;
        acc.hs += ligne.heuresSupplementaires;
        acc.compteur += ligne.heuresCompteur;
        acc.payees += ligne.heuresPayees;
        acc.absences += ligne.absencesJustifier;
        acc.incompletes += ligne.feuillesManquantes + ligne.brouillons;
        return acc;
      },
      {
        tr: 0,
        tt: 0,
        hs: 0,
        compteur: 0,
        payees: 0,
        absences: 0,
        incompletes: 0,
      }
    );
  }, [lignes]);

  const clotureAtteinte = useMemo(() => {
    if (!periode) return false;
    return dateISO(new Date()) >= periode.dateCloture;
  }, [periode]);

  const bilanPret = useMemo(() => {
    // Le bilan RH n'est prêt que si chaque collaborateur concerné
    // a au moins une semaine attendue et que toutes ces semaines sont validées.
    return (
      lignes.length > 0 &&
      lignes.every(
        (ligne) =>
          ligne.feuillesAttendues > 0 &&
          ligne.feuillesManquantes === 0 &&
          ligne.brouillons === 0 &&
          ligne.feuillesValidees >= ligne.feuillesAttendues
      )
    );
  }, [lignes]);

  async function exporterExcel() {
    if (!periode || exportation) return;

    try {
      setExportation(true);

      const workbook = XLSX.utils.book_new();

      const data = [
        ["BILAN RH MENSUEL — POLYNOV"],
        ["Période", periode.libelle],
        ["Cycle", `${formatDate(periode.debutCycle)} → ${formatDate(periode.dateCloture)}`],
        ["Date de clôture", formatDate(periode.dateCloture)],
        [],
        [
          "Collaborateur",
          "Trigramme",
          "TR",
          "Télétravail",
          "HS total",
          "HS compteur",
          "HS payées",
          "Compteur fin de mois",
          "Absences à justifier",
          "État",
        ],
        ...lignes.map((ligne) => [
          nomCollaborateur(ligne.collaborateur),
          ligne.collaborateur.trigramme ?? "",
          ligne.ticketsRestaurant,
          ligne.teletravail,
          Number(ligne.heuresSupplementaires.toFixed(2)),
          Number(ligne.heuresCompteur.toFixed(2)),
          Number(ligne.heuresPayees.toFixed(2)),
          ligne.compteurFin == null ? "" : Number(ligne.compteurFin.toFixed(2)),
          ligne.absencesJustifier,
          ligne.feuillesAttendues === 0
            ? "NON CONCERNE"
            : ligne.feuillesManquantes > 0
              ? "FEUILLE MANQUANTE"
              : ligne.brouillons > 0
                ? "BROUILLON"
                : ligne.feuillesValidees < ligne.feuillesAttendues
                  ? "A VERIFIER"
                  : "COMPLET",
        ]),
        [],
        ["TOTAL", "", totaux.tr, totaux.tt, totaux.hs, totaux.compteur, totaux.payees, "", totaux.absences, ""],
      ];

      const feuille = XLSX.utils.aoa_to_sheet(data);
      feuille["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      ];
      feuille["A1"] = {
        v: "BILAN RH MENSUEL — POLYNOV",
        t: "s",
        s: {
          font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "C00000" } },
          alignment: { horizontal: "center", vertical: "center" },
        },
      };

      feuille["A2"].s = { font: { bold: true } };
      feuille["A3"].s = { font: { bold: true } };
      feuille["A4"].s = { font: { bold: true } };

      for (let col = 0; col <= 9; col += 1) {
        const address = XLSX.utils.encode_cell({ r: 5, c: col });
        if (feuille[address]) {
          feuille[address].s = {
            font: { bold: true, color: { rgb: "FFFFFF" } },
            fill: { fgColor: { rgb: "C00000" } },
            alignment: { horizontal: "center", vertical: "center", wrapText: true },
            border: {
              top: { style: "thin", color: { rgb: "B0B0B0" } },
              bottom: { style: "thin", color: { rgb: "B0B0B0" } },
              left: { style: "thin", color: { rgb: "B0B0B0" } },
              right: { style: "thin", color: { rgb: "B0B0B0" } },
            },
          };
        }
      }

      const lastRow = 5 + lignes.length;
      for (let r = 6; r <= lastRow; r += 1) {
        for (let c = 0; c <= 9; c += 1) {
          const address = XLSX.utils.encode_cell({ r, c });
          if (!feuille[address]) continue;
          feuille[address].s = {
            alignment: {
              horizontal: c === 0 ? "left" : "center",
              vertical: "center",
            },
            border: {
              bottom: { style: "hair", color: { rgb: "D9D9D9" } },
            },
          };
        }
      }

      const totalRow = lastRow + 2;
      for (let c = 0; c <= 9; c += 1) {
        const address = XLSX.utils.encode_cell({ r: totalRow, c });
        if (!feuille[address]) continue;
        feuille[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E2EFDA" } },
          alignment: { horizontal: c === 0 ? "left" : "center" },
          border: {
            top: { style: "thin", color: { rgb: "B7B7B7" } },
          },
        };
      }

      feuille["!cols"] = [
        { wch: 28 },
        { wch: 11 },
        { wch: 9 },
        { wch: 15 },
        { wch: 11 },
        { wch: 13 },
        { wch: 11 },
        { wch: 18 },
        { wch: 20 },
        { wch: 20 },
      ];

      feuille["!rows"] = [
        { hpt: 28 },
      ];

      XLSX.utils.book_append_sheet(workbook, feuille, `RH-${periode.annee}-${String(periode.moisZeroBase + 1).padStart(2, "0")}`);
      XLSX.writeFile(
        workbook,
        `Bilan_RH_${periode.libelle.replace(/\s+/g, "_")}.xlsx`
      );
    } catch (error) {
      console.error(error);
      setErreur(
        error instanceof Error
          ? error.message
          : "Impossible de générer le fichier Excel."
      );
    } finally {
      setExportation(false);
    }
  }

  if (!estAdmin && !chargement) return null;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              style={styles.backButton}
            >
              ← Tableau de bord
            </button>
            <div style={styles.kicker}>ESPACE RH</div>
            <h1 style={styles.title}>Bilan RH mensuel</h1>
            <p style={styles.subtitle}>
              Synthèse des TR, télétravail, heures supplémentaires et compteur de récupération.
            </p>
          </div>

          <button
            type="button"
            onClick={exporterExcel}
            disabled={exportation || chargement || lignes.length === 0}
            style={{
              ...styles.exportButton,
              opacity: exportation || chargement || lignes.length === 0 ? 0.6 : 1,
            }}
          >
            {exportation ? "Export en cours…" : "📊 Exporter Excel"}
          </button>
        </div>

        <section style={styles.periodCard}>
          <div>
            <div style={styles.periodLabel}>Période analysée</div>
            <div style={styles.periodTitle}>
              {periode?.libelle ?? "—"}
            </div>
            <div style={styles.periodMeta}>
              Cycle {formatDate(periode?.debutCycle)} → {formatDate(periode?.dateCloture)}
              {periode && (
                <>
                  <br />
                  Semaine de clôture : <strong>{formatDate(periode.semaineCloture)}</strong> au <strong>{formatDate(periode.dateCloture)}</strong>
                </>
              )}
            </div>
          </div>

          <select
            value={periodeIndex}
            onChange={(event) => setPeriodeIndex(Number(event.target.value))}
            style={styles.select}
          >
            {periodes.map((item, index) => (
              <option key={`${item.annee}-${item.moisZeroBase}`} value={index}>
                {item.libelle.charAt(0).toUpperCase() + item.libelle.slice(1)}
              </option>
            ))}
          </select>
        </section>

        {erreur && (
          <div style={styles.errorBox}>
            ⚠️ {erreur}
          </div>
        )}

        {!erreur && periode && (
          <>
            <div style={styles.kpiGrid}>
              <Kpi label="TR" value={String(totaux.tr)} icon="🍽️" />
              <Kpi label="Télétravail" value={String(totaux.tt)} icon="🏠" />
              <Kpi label="HS total" value={`${formatHeures(totaux.hs)} h`} icon="＋" />
              <Kpi label="HS compteur" value={`${formatHeures(totaux.compteur)} h`} icon="⏱️" />
              <Kpi label="HS payées" value={`${formatHeures(totaux.payees)} h`} icon="💶" />
              <Kpi label="Absences à justifier" value={String(totaux.absences)} icon="⚠️" />
            </div>

            <section style={styles.statusBanner}>
              <div>
                <div style={styles.statusTitle}>
                  {clotureAtteinte ? "📅 Clôture mensuelle atteinte" : "⏳ Mois en cours"}
                </div>
                <div style={styles.statusText}>
                  La date de clôture est le <strong>{formatDate(periode.dateCloture)}</strong>.
                  {bilanPret
                    ? " Toutes les feuilles attendues sont transmises."
                    : ` Il reste ${totaux.incompletes} élément(s) à compléter ou transmettre.`}
                </div>
              </div>
              <div style={{
                ...styles.statusPill,
                background: bilanPret ? "#edf8ef" : "#fff7e6",
                color: bilanPret ? "#137a2a" : "#8a5a00",
                borderColor: bilanPret ? "#cfe8d4" : "#f0d28a",
              }}>
                {bilanPret ? "PRÊT RH" : "À SURVEILLER"}
              </div>
            </section>

            <section style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <h2 style={styles.cardTitle}>Synthèse collaborateurs</h2>
                  <p style={styles.cardSubtitle}>
                    Une ligne par collaborateur actif, avec les données du cycle mensuel.
                  </p>
                </div>
                <div style={styles.smallNote}>
                  {lignes.length} collaborateur{lignes.length > 1 ? "s" : ""}
                </div>
              </div>

              {chargement ? (
                <div style={styles.loading}>Chargement du bilan…</div>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.thLeft}>Collaborateur</th>
                        <th style={styles.th}>TR</th>
                        <th style={styles.th}>Télétravail</th>
                        <th style={styles.th}>HS total</th>
                        <th style={styles.th}>HS compteur</th>
                        <th style={styles.th}>HS payées</th>
                        <th style={styles.th}>Compteur fin</th>
                        <th style={styles.th}>Absences</th>
                        <th style={styles.th}>État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((ligne) => {
                        const aucuneFeuilleAttendue = ligne.feuillesAttendues === 0;
                        const incomplet =
                          !aucuneFeuilleAttendue &&
                          (ligne.feuillesManquantes > 0 || ligne.brouillons > 0 ||
                            ligne.feuillesValidees < ligne.feuillesAttendues);

                        const etat = aucuneFeuilleAttendue
                          ? "Non concerné"
                          : ligne.feuillesManquantes > 0
                            ? "Feuille manquante"
                            : ligne.brouillons > 0
                              ? "Brouillon"
                              : ligne.feuillesValidees < ligne.feuillesAttendues
                                ? "À vérifier"
                                : "Complet";

                        return (
                          <tr key={ligne.collaborateur.id}>
                            <td style={styles.tdLeft}>
                              <div style={styles.name}>{nomCollaborateur(ligne.collaborateur)}</div>
                              <div style={styles.trigramme}>{ligne.collaborateur.trigramme ?? ""}</div>
                            </td>
                            <td style={styles.td}>{ligne.ticketsRestaurant}</td>
                            <td style={styles.td}>{ligne.teletravail}</td>
                            <td style={styles.tdStrong}>{formatHeures(ligne.heuresSupplementaires)} h</td>
                            <td style={styles.td}>{formatHeures(ligne.heuresCompteur)} h</td>
                            <td style={styles.td}>{formatHeures(ligne.heuresPayees)} h</td>
                            <td style={styles.td}>
                              {ligne.compteurFin == null ? "—" : `${formatHeures(ligne.compteurFin)} h`}
                            </td>
                            <td style={styles.td}>
                              {ligne.absencesJustifier > 0 ? (
                                <span style={styles.absencePill} title={ligne.codesAbsence.join(", ")}>
                                  ⚠ {ligne.absencesJustifier}
                                </span>
                              ) : (
                                "0"
                              )}
                            </td>
                            <td style={styles.td}>
                              <span style={{
                                ...styles.statePill,
                                ...(incomplet ? styles.stateIncomplete : styles.stateComplete),
                              }}>
                                {etat}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={styles.totalTd}>TOTAL</td>
                        <td style={styles.totalTd}>{totaux.tr}</td>
                        <td style={styles.totalTd}>{totaux.tt}</td>
                        <td style={styles.totalTd}>{formatHeures(totaux.hs)} h</td>
                        <td style={styles.totalTd}>{formatHeures(totaux.compteur)} h</td>
                        <td style={styles.totalTd}>{formatHeures(totaux.payees)} h</td>
                        <td style={styles.totalTd}>—</td>
                        <td style={styles.totalTd}>{totaux.absences}</td>
                        <td style={styles.totalTd}>{bilanPret ? "OK" : "À surveiller"}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            <section style={styles.infoGrid}>
              <div style={styles.infoCard}>
                <div style={styles.infoTitle}>📌 Heures supplémentaires</div>
                <div style={styles.infoText}>
                  Le total des HS est cumulé sur tout le cycle. La répartition entre compteur et heures payées est prise en compte sur la semaine de clôture mensuelle.
                </div>
              </div>
              <div style={styles.infoCard}>
                <div style={styles.infoTitle}>⚠️ Absences</div>
                <div style={styles.infoText}>
                  Toute absence saisie hors FE est remontée ici pour permettre au service RH de vérifier qu'elle a bien été justifiée dans les outils RH.
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiIcon}>{icon}</div>
      <div>
        <div style={styles.kpiValue}>{value}</div>
        <div style={styles.kpiLabel}>{label}</div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f6f8",
    fontFamily: "Calibri, Arial, sans-serif",
    color: "#222",
    padding: "28px 24px 50px",
  },
  container: {
    maxWidth: 1500,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 20,
    marginBottom: 22,
  },
  backButton: {
    border: "none",
    background: "transparent",
    color: "#777",
    padding: 0,
    cursor: "pointer",
    fontSize: 13,
    marginBottom: 12,
  },
  kicker: {
    fontSize: 12,
    fontWeight: 800,
    color: "#c00000",
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  title: {
    margin: 0,
    fontSize: 32,
    lineHeight: 1.1,
  },
  subtitle: {
    margin: "8px 0 0",
    color: "#6d6d72",
    fontSize: 14,
  },
  exportButton: {
    background: "#c00000",
    border: "1px solid #c00000",
    color: "white",
    borderRadius: 9,
    padding: "11px 17px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px rgba(0,0,0,.08)",
  },
  periodCard: {
    background: "white",
    border: "1px solid #e4e4e7",
    borderRadius: 14,
    padding: 18,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 18,
    marginBottom: 16,
  },
  periodLabel: {
    color: "#888",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  periodTitle: {
    fontSize: 22,
    fontWeight: 800,
    marginTop: 2,
    textTransform: "capitalize",
  },
  periodMeta: {
    color: "#666",
    fontSize: 13,
    lineHeight: 1.5,
    marginTop: 5,
  },
  select: {
    minWidth: 220,
    border: "1px solid #d7d7dc",
    borderRadius: 8,
    background: "white",
    padding: "10px 12px",
    fontSize: 14,
  },
  errorBox: {
    background: "#fff0ef",
    border: "1px solid #efc1bc",
    color: "#a3332a",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 16,
  },
  kpi: {
    background: "white",
    border: "1px solid #e4e4e7",
    borderRadius: 12,
    padding: "14px 15px",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  kpiIcon: {
    fontSize: 22,
  },
  kpiValue: {
    fontSize: 21,
    fontWeight: 800,
    lineHeight: 1,
  },
  kpiLabel: {
    color: "#777",
    fontSize: 11,
    marginTop: 4,
  },
  statusBanner: {
    background: "white",
    border: "1px solid #e4e4e7",
    borderRadius: 12,
    padding: 15,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 15,
    marginBottom: 16,
  },
  statusTitle: {
    fontWeight: 800,
    fontSize: 15,
  },
  statusText: {
    color: "#666",
    fontSize: 13,
    marginTop: 4,
  },
  statusPill: {
    border: "1px solid",
    borderRadius: 999,
    padding: "7px 11px",
    fontWeight: 800,
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  card: {
    background: "white",
    border: "1px solid #e4e4e7",
    borderRadius: 14,
    overflow: "hidden",
  },
  cardHeader: {
    padding: "17px 18px 13px",
    display: "flex",
    justifyContent: "space-between",
    gap: 15,
    alignItems: "flex-start",
  },
  cardTitle: {
    margin: 0,
    fontSize: 18,
  },
  cardSubtitle: {
    margin: "5px 0 0",
    color: "#777",
    fontSize: 13,
  },
  smallNote: {
    color: "#888",
    fontSize: 12,
  },
  loading: {
    padding: 24,
    color: "#777",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: 1050,
    borderCollapse: "collapse",
  },
  th: {
    background: "#f7f7f8",
    borderTop: "1px solid #e8e8eb",
    borderBottom: "1px solid #e8e8eb",
    padding: "10px 9px",
    textAlign: "center",
    fontSize: 11,
    color: "#666",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  thLeft: {
    background: "#f7f7f8",
    borderTop: "1px solid #e8e8eb",
    borderBottom: "1px solid #e8e8eb",
    padding: "10px 12px",
    textAlign: "left",
    fontSize: 11,
    color: "#666",
    fontWeight: 800,
  },
  td: {
    borderBottom: "1px solid #efeff1",
    padding: "10px 9px",
    textAlign: "center",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  tdStrong: {
    borderBottom: "1px solid #efeff1",
    padding: "10px 9px",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  tdLeft: {
    borderBottom: "1px solid #efeff1",
    padding: "10px 12px",
    textAlign: "left",
    fontSize: 12,
  },
  name: {
    fontWeight: 800,
  },
  trigramme: {
    color: "#999",
    fontSize: 10,
    marginTop: 2,
  },
  totalTd: {
    background: "#e2efda",
    borderTop: "1px solid #b7b7b7",
    padding: "11px 9px",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 800,
  },
  statePill: {
    display: "inline-block",
    borderRadius: 999,
    padding: "5px 8px",
    fontSize: 10,
    fontWeight: 800,
  },
  stateComplete: {
    background: "#edf8ef",
    border: "1px solid #cfe8d4",
    color: "#14782a",
  },
  stateIncomplete: {
    background: "#fff6e5",
    border: "1px solid #f0d29b",
    color: "#875900",
  },
  absencePill: {
    display: "inline-block",
    minWidth: 26,
    padding: "4px 7px",
    borderRadius: 999,
    background: "#fff0ef",
    border: "1px solid #efc1bc",
    color: "#a3332a",
    fontWeight: 800,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 16,
  },
  infoCard: {
    background: "#fafafa",
    border: "1px solid #e6e6e8",
    borderRadius: 12,
    padding: 14,
  },
  infoTitle: {
    fontWeight: 800,
    fontSize: 13,
  },
  infoText: {
    marginTop: 6,
    color: "#6d6d72",
    fontSize: 12,
    lineHeight: 1.45,
  },
};
