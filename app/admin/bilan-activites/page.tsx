"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Activite = {
  id: string;
  code: string;
  nom: string;
  actif: boolean;
  ordre_affichage: number;
};

type Collaborateur = {
  id: string;
  trigramme: string;
  prenom: string;
  nom: string;
  actif: boolean;
};

type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  statut: string | null;
};

type Jour = {
  id: string;
  feuille_id: string;
  date_jour: string;
};

type Imputation = {
  id: string;
  jour_id: string;
  type_affaire: string | null;
  activite_id: string | null;
  code: string | null;
  heures: number | string | null;
  numero_affaire: string | null;
};

type LigneActivite = {
  id: string;
  code: string;
  nom: string;
  heures: number;
  pourcentage: number;
  collaborateurs: number;
  lignes: number;
  cbe: number;
  dbe: number;
};

type LigneCollaborateur = {
  collaborateurId: string;
  trigramme: string;
  nom: string;
  total: number;
  heuresParActivite: Record<string, number>;
};

type LigneSemaine = {
  semaineDebut: string;
  semaine: number;
  total: number;
  heuresParActivite: Record<string, number>;
};

type Periode = "ANNEE" | "SEMAINE";
type StatutFiltre = "A_TRAITER" | "BROUILLON" | "TOUS";

function numeroSemaine(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));

  const semaine1 = new Date(d.getFullYear(), 0, 4);

  return (
    1 +
    Math.round(
      (((d.getTime() - semaine1.getTime()) / 86400000 -
        3 +
        ((semaine1.getDay() + 6) % 7)) /
        7)
    )
  );
}

function anneeISO(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  return d.getFullYear();
}

function lundiSemaineISO(annee: number, semaine: number) {
  const jeudi = new Date(annee, 0, 4);
  jeudi.setHours(12, 0, 0, 0);
  const jour = jeudi.getDay() || 7;
  jeudi.setDate(jeudi.getDate() + (semaine - 1) * 7 + (1 - jour));
  return jeudi;
}

function dateISO(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function debutAnneeISO(annee: number) {
  return dateISO(lundiSemaineISO(annee, 1));
}

function formatHeures(value: number) {
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR");
}

function parseHeures(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normaliserNom(prenom: string, nom: string) {
  return `${prenom ?? ""} ${nom ?? ""}`.trim();
}

export default function BilanActivitesPage() {
  const anneeCourante = new Date().getFullYear();
  const semaineCourante = numeroSemaine(new Date());

  const [periode, setPeriode] = useState<Periode>("ANNEE");
  const [annee, setAnnee] = useState(anneeCourante);
  const [semaine, setSemaine] = useState(semaineCourante);
  const [statut, setStatut] = useState<StatutFiltre>("TOUS");
  const [collaborateurId, setCollaborateurId] = useState("TOUS");
  const [activiteId, setActiviteId] = useState("TOUTES");

  const [activites, setActivites] = useState<Activite[]>([]);
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [lignesActivites, setLignesActivites] = useState<LigneActivite[]>([]);
  const [lignesCollaborateurs, setLignesCollaborateurs] = useState<LigneCollaborateur[]>([]);
  const [lignesSemaines, setLignesSemaines] = useState<LigneSemaine[]>([]);

  const [heuresTotalAffaires, setHeuresTotalAffaires] = useState(0);
  const [heuresSansActivite, setHeuresSansActivite] = useState(0);
  const [nombreImputations, setNombreImputations] = useState(0);
  const [nombreSemaines, setNombreSemaines] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const anneesDisponibles = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => anneeCourante - 4 + index),
    [anneeCourante]
  );

  const activitesAffichees = useMemo(() => {
    const source = activites
      .filter(a => a.actif || lignesActivites.some(l => l.id === a.id))
      .sort((a, b) => {
        if (a.ordre_affichage !== b.ordre_affichage) {
          return a.ordre_affichage - b.ordre_affichage;
        }
        return a.nom.localeCompare(b.nom, "fr");
      });

    if (activiteId === "TOUTES") {
      return source;
    }

    return source.filter(a => a.id === activiteId);
  }, [activiteId, activites, lignesActivites]);

  const chargerDonnees = useCallback(async () => {
    setChargement(true);
    setErreur("");

    try {
      const {
        data: userData,
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      if (!userData.user) {
        throw new Error("Aucun utilisateur connecté.");
      }

      const { data: profil, error: profilError } = await supabase
        .from("collaborateurs")
        .select("role, actif")
        .eq("auth_user_id", userData.user.id)
        .maybeSingle();

      if (profilError) throw profilError;

      if (!profil || String(profil.role ?? "").toUpperCase() !== "ADMIN" || profil.actif === false) {
        throw new Error("Accès réservé aux administrateurs.");
      }

      const [activitesResult, collaborateursResult] = await Promise.all([
        supabase
          .from("activites")
          .select("id, code, nom, actif, ordre_affichage")
          .order("ordre_affichage", { ascending: true })
          .order("nom", { ascending: true }),
        supabase
          .from("collaborateurs")
          .select("id, trigramme, prenom, nom, actif")
          .order("actif", { ascending: false })
          .order("nom", { ascending: true })
          .order("prenom", { ascending: true }),
      ]);

      if (activitesResult.error) throw activitesResult.error;
      if (collaborateursResult.error) throw collaborateursResult.error;

      const activitesData = (activitesResult.data ?? []) as Activite[];
      const collaborateursData = (collaborateursResult.data ?? []) as Collaborateur[];

      setActivites(activitesData);
      setCollaborateurs(collaborateursData);
      let debut = debutAnneeISO(annee);
      let fin = debutAnneeISO(annee + 1);

      if (periode === "SEMAINE") {
        debut = dateISO(lundiSemaineISO(annee, semaine));
        const finDate = lundiSemaineISO(annee, semaine);
        finDate.setDate(finDate.getDate() + 7);
        fin = dateISO(finDate);
      }

      let feuillesQuery = supabase
        .from("feuilles_heures")
        .select("id, collaborateur_id, semaine_debut, statut")
        .gte("semaine_debut", debut)
        .lt("semaine_debut", fin);

      if (statut === "A_TRAITER") {
        feuillesQuery = feuillesQuery.eq("statut", "A_TRAITER");
      } else if (statut === "BROUILLON") {
        feuillesQuery = feuillesQuery.eq("statut", "BROUILLON");
      } else {
        feuillesQuery = feuillesQuery.in("statut", ["A_TRAITER", "BROUILLON"]);
      }

      if (collaborateurId !== "TOUS") {
        feuillesQuery = feuillesQuery.eq("collaborateur_id", collaborateurId);
      }

      const { data: feuillesData, error: feuillesError } = await feuillesQuery.order(
        "semaine_debut",
        { ascending: true }
      );

      if (feuillesError) throw feuillesError;

      const feuilles = (feuillesData ?? []) as Feuille[];
      setNombreSemaines(new Set(feuilles.map(f => `${f.collaborateur_id}|${f.semaine_debut}`)).size);

      if (feuilles.length === 0) {
        setLignesActivites([]);
        setLignesCollaborateurs([]);
        setLignesSemaines([]);
        setHeuresTotalAffaires(0);
        setHeuresSansActivite(0);
        setNombreImputations(0);
        setChargement(false);
        return;
      }

      const feuilleIds = feuilles.map(f => f.id);

      const { data: joursData, error: joursError } = await supabase
        .from("feuilles_heures_jours")
        .select("id, feuille_id, date_jour")
        .in("feuille_id", feuilleIds);

      if (joursError) throw joursError;

      const jours = (joursData ?? []) as Jour[];
      const jourIds = jours.map(j => j.id);

      if (jourIds.length === 0) {
        setLignesActivites([]);
        setLignesCollaborateurs([]);
        setLignesSemaines([]);
        setHeuresTotalAffaires(0);
        setHeuresSansActivite(0);
        setNombreImputations(0);
        setChargement(false);
        return;
      }

      const { data: imputationsData, error: imputationsError } = await supabase
        .from("feuilles_heures_imputations")
        .select("id, jour_id, type_affaire, activite_id, code, heures, numero_affaire")
        .in("jour_id", jourIds);

      if (imputationsError) throw imputationsError;

      const imputations = (imputationsData ?? []) as Imputation[];
      const feuillesMap = new Map(feuilles.map(f => [f.id, f]));
      const joursMap = new Map(jours.map(j => [j.id, j]));
      const collaborateursMap = new Map(collaborateursData.map(c => [c.id, c]));
      const activitesMap = new Map(activitesData.map(a => [a.id, a]));

      const activiteStats = new Map<string, {
        heures: number;
        collaborateurs: Set<string>;
        lignes: number;
        cbe: number;
        dbe: number;
      }>();
      const collaborateurStats = new Map<string, Map<string, number>>();
      const semaineStats = new Map<string, Map<string, number>>();

      let totalAffaires = 0;
      let sansActivite = 0;
      let nbLignesActivite = 0;

      for (const imputation of imputations) {
        if (imputation.type_affaire !== "CBE" && imputation.type_affaire !== "DBE") {
          continue;
        }

        const heures = parseHeures(imputation.heures);
        const jour = joursMap.get(imputation.jour_id);
        if (!jour) continue;

        const feuille = feuillesMap.get(jour.feuille_id);
        if (!feuille) continue;

        totalAffaires += heures;

        if (!imputation.activite_id) {
          sansActivite += heures;
          continue;
        }

        const activite = activitesMap.get(imputation.activite_id);
        if (!activite) {
          sansActivite += heures;
          continue;
        }

        if (activiteId !== "TOUTES" && imputation.activite_id !== activiteId) {
          continue;
        }

        nbLignesActivite += 1;

        if (!activiteStats.has(activite.id)) {
          activiteStats.set(activite.id, {
            heures: 0,
            collaborateurs: new Set<string>(),
            lignes: 0,
            cbe: 0,
            dbe: 0,
          });
        }

        const stat = activiteStats.get(activite.id)!;
        stat.heures += heures;
        stat.collaborateurs.add(feuille.collaborateur_id);
        stat.lignes += 1;
        if (imputation.type_affaire === "CBE") stat.cbe += heures;
        if (imputation.type_affaire === "DBE") stat.dbe += heures;

        if (!collaborateurStats.has(feuille.collaborateur_id)) {
          collaborateurStats.set(feuille.collaborateur_id, new Map<string, number>());
        }
        const collabMap = collaborateurStats.get(feuille.collaborateur_id)!;
        collabMap.set(
          activite.id,
          (collabMap.get(activite.id) ?? 0) + heures
        );

        const semaineKey = feuille.semaine_debut;
        if (!semaineStats.has(semaineKey)) {
          semaineStats.set(semaineKey, new Map<string, number>());
        }
        const semaineMap = semaineStats.get(semaineKey)!;
        semaineMap.set(
          activite.id,
          (semaineMap.get(activite.id) ?? 0) + heures
        );
      }

      const totalAvecActivite = Array.from(activiteStats.values()).reduce(
        (sum, item) => sum + item.heures,
        0
      );

      const lignesActiviteData: LigneActivite[] = activitesData
        .filter(a => activiteStats.has(a.id))
        .map(a => {
          const stat = activiteStats.get(a.id)!;
          return {
            id: a.id,
            code: a.code,
            nom: a.nom,
            heures: stat.heures,
            pourcentage:
              totalAvecActivite > 0
                ? (stat.heures / totalAvecActivite) * 100
                : 0,
            collaborateurs: stat.collaborateurs.size,
            lignes: stat.lignes,
            cbe: stat.cbe,
            dbe: stat.dbe,
          };
        })
        .sort((a, b) => b.heures - a.heures);

      const lignesCollaborateursData: LigneCollaborateur[] = Array.from(
        collaborateurStats.entries()
      )
        .map(([collabId, stats]) => {
          const collab = collaborateursMap.get(collabId);
          const heuresParActivite: Record<string, number> = {};
          let total = 0;

          for (const [id, hours] of stats.entries()) {
            heuresParActivite[id] = hours;
            total += hours;
          }

          return {
            collaborateurId: collabId,
            trigramme: collab?.trigramme ?? "???",
            nom: collab
              ? normaliserNom(collab.prenom, collab.nom)
              : "Collaborateur inconnu",
            total,
            heuresParActivite,
          };
        })
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

      const lignesSemainesData: LigneSemaine[] = Array.from(
        semaineStats.entries()
      )
        .map(([semaineDebutValue, stats]) => {
          const d = new Date(`${semaineDebutValue}T12:00:00`);
          const heuresParActivite: Record<string, number> = {};
          let total = 0;

          for (const [id, hours] of stats.entries()) {
            heuresParActivite[id] = hours;
            total += hours;
          }

          return {
            semaineDebut: semaineDebutValue,
            semaine: numeroSemaine(d),
            total,
            heuresParActivite,
          };
        })
        .sort((a, b) => a.semaineDebut.localeCompare(b.semaineDebut));

      setLignesActivites(lignesActiviteData);
      setLignesCollaborateurs(lignesCollaborateursData);
      setLignesSemaines(lignesSemainesData);
      setHeuresTotalAffaires(totalAffaires);
      setHeuresSansActivite(sansActivite);
      setNombreImputations(nbLignesActivite);
      setChargement(false);
    } catch (error) {
      console.error("Erreur bilan activités", error);
      const e = error as { message?: string };
      setErreur(e.message ?? "Impossible de charger le bilan activités.");
      setChargement(false);
    }
  }, [annee, anneeCourante, activiteId, collaborateurId, periode, semaine, statut]);

  useEffect(() => {
    chargerDonnees();
  }, [chargerDonnees]);

  const heuresActivites = useMemo(
    () => lignesActivites.reduce((sum, ligne) => sum + ligne.heures, 0),
    [lignesActivites]
  );

  const pourcentageActivites =
    heuresTotalAffaires > 0
      ? (heuresActivites / heuresTotalAffaires) * 100
      : 0;

  const titrePeriode = useMemo(() => {
    if (periode === "SEMAINE") {
      return `S${String(semaine).padStart(2, "0")} ${annee}`;
    }
    return `Année ${annee}`;
  }, [annee, periode, semaine]);

  if (chargement) {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <div>
            <div style={styles.logo}>POLYNOV</div>
            <div style={styles.headerTitle}>Bilan activités</div>
          </div>
        </header>
        <div style={styles.loadingCard}>
          <div style={styles.spinner} />
          <div>Chargement du bilan activités...</div>
        </div>
      </main>
    );
  }

  if (erreur) {
    return (
      <main style={styles.page}>
        <header style={styles.header}>
          <div>
            <div style={styles.logo}>POLYNOV</div>
            <div style={styles.headerTitle}>Bilan activités</div>
          </div>
          <button
            style={styles.headerButton}
            onClick={() => {
              window.location.href = "/dashboard";
            }}
          >
            ← Dashboard
          </button>
        </header>

        <div style={{ ...styles.errorBox, margin: 24 }}>
          <strong>Impossible de charger le bilan</strong>
          <div style={{ marginTop: 8 }}>{erreur}</div>
          <button style={styles.primaryButton} onClick={chargerDonnees}>
            Réessayer
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>POLYNOV</div>
          <div style={styles.headerTitle}>Bilan activités</div>
        </div>

        <button
          style={styles.headerButton}
          onClick={() => {
            window.location.href = "/dashboard";
          }}
        >
          ← Retour au tableau de bord
        </button>
      </header>

      <div style={styles.main}>
        <section style={styles.hero}>
          <div>
            <div style={styles.eyebrow}>NOUVEAU SYSTÈME</div>
            <h1 style={styles.heroTitle}>Répartition des heures par activité</h1>
            <p style={styles.heroSubtitle}>
              Analyse des heures CBE / DBE enregistrées avec une activité dans
              « Ma semaine ».
            </p>
          </div>

          <div style={styles.heroPeriod}>
            <div style={styles.heroPeriodLabel}>Période analysée</div>
            <strong>{titrePeriode}</strong>
          </div>
        </section>

        <section style={styles.filtersCard}>
          <div style={styles.filtersTitle}>Filtres</div>

          <div style={styles.filtersGrid}>
            <label style={styles.fieldLabel}>
              <span>Vue</span>
              <select
                value={periode}
                onChange={e => setPeriode(e.target.value as Periode)}
                style={styles.select}
              >
                <option value="ANNEE">Année</option>
                <option value="SEMAINE">Semaine</option>
              </select>
            </label>

            <label style={styles.fieldLabel}>
              <span>Année</span>
              <select
                value={annee}
                onChange={e => setAnnee(Number(e.target.value))}
                style={styles.select}
              >
                {anneesDisponibles.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.fieldLabel}>
              <span>Semaine</span>
              <select
                value={semaine}
                disabled={periode !== "SEMAINE"}
                onChange={e => setSemaine(Number(e.target.value))}
                style={styles.select}
              >
                {Array.from({ length: 53 }, (_, index) => index + 1).map(value => (
                  <option key={value} value={value}>
                    S{String(value).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.fieldLabel}>
              <span>Statut des feuilles</span>
              <select
                value={statut}
                onChange={e => setStatut(e.target.value as StatutFiltre)}
                style={styles.select}
              >
                <option value="TOUS">Toutes : brouillons + transmises</option>
                <option value="A_TRAITER">Transmises uniquement</option>
                <option value="BROUILLON">Brouillons uniquement</option>
              </select>
            </label>

            <label style={styles.fieldLabel}>
              <span>Collaborateur</span>
              <select
                value={collaborateurId}
                onChange={e => setCollaborateurId(e.target.value)}
                style={styles.select}
              >
                <option value="TOUS">Tous les collaborateurs</option>
                {collaborateurs.map(collab => (
                  <option key={collab.id} value={collab.id}>
                    {collab.trigramme} — {normaliserNom(collab.prenom, collab.nom)}
                    {!collab.actif ? " (inactif)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.fieldLabel}>
              <span>Activité</span>
              <select
                value={activiteId}
                onChange={e => setActiviteId(e.target.value)}
                style={styles.select}
              >
                <option value="TOUTES">Toutes les activités</option>
                {activites
                  .filter(a => a.actif)
                  .map(activite => (
                    <option key={activite.id} value={activite.id}>
                      {activite.nom}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div style={styles.filterHint}>
            Les heures de type Divers / absence ne sont pas rattachées à une
            activité et ne sont donc pas incluses dans les totaux par activité.
          </div>
        </section>

        <section style={styles.cardsGrid}>
          <div style={styles.card}>
            <div style={styles.cardLabel}>HEURES CBE / DBE</div>
            <div style={styles.cardValue}>{formatHeures(heuresTotalAffaires)} h</div>
            <div style={styles.cardHint}>Heures d'affaires sur la période sélectionnée.</div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>HEURES AVEC ACTIVITÉ</div>
            <div style={styles.cardValue}>{formatHeures(heuresActivites)} h</div>
            <div style={styles.cardHint}>
              {pourcentageActivites.toLocaleString("fr-FR", {
                maximumFractionDigits: 1,
              })}% des heures CBE / DBE analysées.
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>SANS ACTIVITÉ</div>
            <div
              style={{
                ...styles.cardValue,
                color: heuresSansActivite > 0.01 ? "#c00000" : "#138113",
              }}
            >
              {formatHeures(heuresSansActivite)} h
            </div>
            <div style={styles.cardHint}>
              CBE / DBE non rattachées à une activité.
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>IMP. ANALYSÉES</div>
            <div style={styles.cardValue}>{nombreImputations}</div>
            <div style={styles.cardHint}>
              {nombreSemaines} feuille{nombreSemaines > 1 ? "s" : ""} dans le périmètre.
            </div>
          </div>
        </section>

        {heuresSansActivite > 0.01 && (
          <div style={styles.warningBox}>
            <strong>⚠ Des heures CBE / DBE ne sont pas rattachées à une activité.</strong>
            <div style={{ marginTop: 5 }}>
              Elles sont conservées dans le chiffre « Sans activité » et ne sont
              pas réparties dans les activités ci-dessous.
            </div>
          </div>
        )}

        <section style={styles.sectionCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionEyebrow}>RÉPARTITION</div>
              <h2 style={styles.sectionTitle}>Heures par activité</h2>
            </div>
            <div style={styles.sectionTotal}>{formatHeures(heuresActivites)} h</div>
          </div>

          {lignesActivites.length === 0 ? (
            <div style={styles.emptyState}>Aucune heure d'activité sur la sélection.</div>
          ) : (
            <div style={styles.activityList}>
              {lignesActivites.map(ligne => (
                <div key={ligne.id} style={styles.activityRow}>
                  <div style={styles.activityName}>
                    <strong>{ligne.nom}</strong>
                    <span>{ligne.code}</span>
                  </div>

                  <div style={styles.activityBarTrack}>
                    <div
                      style={{
                        ...styles.activityBar,
                        width: `${Math.min(100, ligne.pourcentage)}%`,
                      }}
                    />
                  </div>

                  <div style={styles.activityNumber}>
                    <strong>{formatHeures(ligne.heures)} h</strong>
                    <span>
                      {ligne.pourcentage.toLocaleString("fr-FR", {
                        maximumFractionDigits: 1,
                      })}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {lignesActivites.length > 0 && (
            <div style={styles.detailGrid}>
              {lignesActivites.map(ligne => (
                <div key={ligne.id} style={styles.detailBox}>
                  <div style={styles.detailTitle}>{ligne.nom}</div>
                  <div style={styles.detailLine}>
                    <span>CBE</span>
                    <strong>{formatHeures(ligne.cbe)} h</strong>
                  </div>
                  <div style={styles.detailLine}>
                    <span>DBE</span>
                    <strong>{formatHeures(ligne.dbe)} h</strong>
                  </div>
                  <div style={styles.detailLine}>
                    <span>Collaborateurs</span>
                    <strong>{ligne.collaborateurs}</strong>
                  </div>
                  <div style={styles.detailLine}>
                    <span>Lignes</span>
                    <strong>{ligne.lignes}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={styles.sectionCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionEyebrow}>COLLABORATEURS</div>
              <h2 style={styles.sectionTitle}>Répartition des heures par collaborateur</h2>
            </div>
          </div>

          {lignesCollaborateurs.length === 0 ? (
            <div style={styles.emptyState}>Aucun collaborateur avec des heures d'activité.</div>
          ) : (
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.thLeft}>Collaborateur</th>
                    {activitesAffichees.map(activite => (
                      <th key={activite.id} style={styles.thRight}>
                        {activite.nom}
                      </th>
                    ))}
                    <th style={styles.thRight}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesCollaborateurs.map(ligne => (
                    <tr key={ligne.collaborateurId}>
                      <td style={styles.tdLeft}>
                        <strong>{ligne.trigramme}</strong>
                        <span style={styles.personName}>{ligne.nom}</span>
                      </td>
                      {activitesAffichees.map(activite => (
                        <td key={activite.id} style={styles.tdRight}>
                          {formatHeures(ligne.heuresParActivite[activite.id] ?? 0)}
                        </td>
                      ))}
                      <td style={{ ...styles.tdRight, fontWeight: 800 }}>
                        {formatHeures(ligne.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {periode === "ANNEE" && (
          <section style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionEyebrow}>ÉVOLUTION</div>
                <h2 style={styles.sectionTitle}>Répartition par semaine</h2>
              </div>
            </div>

            {lignesSemaines.length === 0 ? (
              <div style={styles.emptyState}>Aucune heure d'activité enregistrée.</div>
            ) : (
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.thLeft}>Semaine</th>
                      {activitesAffichees.map(activite => (
                        <th key={activite.id} style={styles.thRight}>
                          {activite.nom}
                        </th>
                      ))}
                      <th style={styles.thRight}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesSemaines.map(ligne => (
                      <tr key={ligne.semaineDebut}>
                        <td style={styles.tdLeft}>
                          <strong>S{String(ligne.semaine).padStart(2, "0")}</strong>
                          <span style={styles.personName}>
                            {formatDate(ligne.semaineDebut)}
                          </span>
                        </td>
                        {activitesAffichees.map(activite => (
                          <td key={activite.id} style={styles.tdRight}>
                            {formatHeures(ligne.heuresParActivite[activite.id] ?? 0)}
                          </td>
                        ))}
                        <td style={{ ...styles.tdRight, fontWeight: 800 }}>
                          {formatHeures(ligne.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <div style={styles.footerNote}>
          Le bilan repose sur l'activité enregistrée dans chaque imputation du
          nouveau système. Une ancienne ligne sans activité n'est pas
          reconstruite automatiquement.
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f4f5f6",
    color: "#222",
    fontFamily: "Calibri, Arial, sans-serif",
  },
  header: {
    background: "#c00000",
    color: "#fff",
    padding: "16px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    boxShadow: "0 2px 8px rgba(0,0,0,.12)",
  },
  logo: {
    fontWeight: 900,
    fontSize: 24,
    letterSpacing: 1,
    lineHeight: 1,
  },
  headerTitle: {
    marginTop: 5,
    fontSize: 14,
    fontWeight: 600,
    opacity: 0.96,
  },
  headerButton: {
    border: "1px solid rgba(255,255,255,.65)",
    background: "transparent",
    color: "#fff",
    borderRadius: 7,
    padding: "9px 13px",
    cursor: "pointer",
    fontWeight: 700,
    fontFamily: "inherit",
  },
  main: {
    width: "min(1500px, calc(100% - 36px))",
    margin: "0 auto",
    padding: "28px 0 48px",
  },
  loadingCard: {
    width: "min(560px, calc(100% - 36px))",
    margin: "48px auto",
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 10,
    padding: 28,
    display: "flex",
    alignItems: "center",
    gap: 14,
    boxShadow: "0 2px 8px rgba(0,0,0,.06)",
  },
  spinner: {
    width: 22,
    height: 22,
    border: "3px solid #e7e7e7",
    borderTopColor: "#c00000",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  errorBox: {
    background: "#fff4f4",
    border: "1px solid #e4b1b1",
    borderRadius: 10,
    padding: 20,
    color: "#8f0000",
  },
  primaryButton: {
    marginTop: 16,
    border: "none",
    background: "#c00000",
    color: "#fff",
    borderRadius: 7,
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 800,
    fontFamily: "inherit",
  },
  hero: {
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 12,
    padding: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
    boxShadow: "0 2px 8px rgba(0,0,0,.05)",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 900,
    color: "#c00000",
    letterSpacing: ".6px",
  },
  heroTitle: {
    margin: "6px 0 8px",
    fontSize: 30,
    lineHeight: 1.1,
  },
  heroSubtitle: {
    margin: 0,
    color: "#666",
    fontSize: 14,
    maxWidth: 800,
    lineHeight: 1.45,
  },
  heroPeriod: {
    minWidth: 190,
    padding: "12px 14px",
    borderRadius: 9,
    background: "#f8f8f8",
    border: "1px solid #ececec",
    textAlign: "right",
  },
  heroPeriodLabel: {
    fontSize: 11,
    color: "#777",
    textTransform: "uppercase",
    letterSpacing: ".5px",
    marginBottom: 5,
  },
  filtersCard: {
    marginTop: 18,
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 2px 8px rgba(0,0,0,.04)",
  },
  filtersTitle: {
    fontSize: 16,
    fontWeight: 900,
    marginBottom: 15,
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    fontWeight: 800,
    color: "#555",
  },
  select: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cfcfcf",
    borderRadius: 7,
    background: "#fff",
    color: "#222",
    padding: "9px 10px",
    fontFamily: "inherit",
    fontSize: 13,
  },
  filterHint: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #eee",
    color: "#777",
    fontSize: 12,
  },
  cardsGrid: {
    marginTop: 18,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  card: {
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 10,
    padding: 17,
    boxShadow: "0 2px 7px rgba(0,0,0,.04)",
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: 900,
    color: "#777",
    letterSpacing: ".55px",
  },
  cardValue: {
    marginTop: 7,
    fontSize: 28,
    fontWeight: 900,
  },
  cardHint: {
    marginTop: 4,
    color: "#777",
    fontSize: 12,
    lineHeight: 1.35,
  },
  warningBox: {
    marginTop: 16,
    background: "#fff8e8",
    border: "1px solid #e3c67d",
    borderRadius: 9,
    padding: 14,
    color: "#6d5300",
    fontSize: 13,
  },
  sectionCard: {
    marginTop: 18,
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0,0,0,.04)",
  },
  sectionHeader: {
    padding: "18px 20px",
    borderBottom: "1px solid #ececec",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
  },
  sectionEyebrow: {
    fontSize: 10,
    color: "#c00000",
    fontWeight: 900,
    letterSpacing: ".55px",
  },
  sectionTitle: {
    margin: "4px 0 0",
    fontSize: 19,
  },
  sectionTotal: {
    fontSize: 20,
    fontWeight: 900,
  },
  emptyState: {
    padding: 28,
    color: "#777",
    textAlign: "center",
  },
  activityList: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  activityRow: {
    display: "grid",
    gridTemplateColumns: "210px minmax(150px, 1fr) 110px",
    gap: 14,
    alignItems: "center",
  },
  activityName: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  activityBarTrack: {
    height: 16,
    borderRadius: 99,
    background: "#ececec",
    overflow: "hidden",
  },
  activityBar: {
    height: "100%",
    borderRadius: 99,
    background: "#c00000",
    minWidth: 2,
  },
  activityNumber: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 10,
    padding: "0 20px 20px",
  },
  detailBox: {
    background: "#fafafa",
    border: "1px solid #ececec",
    borderRadius: 9,
    padding: 13,
  },
  detailTitle: {
    fontWeight: 900,
    marginBottom: 8,
  },
  detailLine: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 12,
    padding: "4px 0",
    borderTop: "1px solid #ededed",
  },
  tableScroll: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 720,
    fontSize: 13,
  },
  thLeft: {
    padding: "10px 12px",
    textAlign: "left",
    background: "#f7f8f9",
    color: "#626970",
    borderBottom: "1px solid #e2e5e9",
    whiteSpace: "nowrap",
  },
  thRight: {
    padding: "10px 12px",
    textAlign: "right",
    background: "#f7f8f9",
    color: "#626970",
    borderBottom: "1px solid #e2e5e9",
    whiteSpace: "nowrap",
  },
  tdLeft: {
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: "1px solid #eceeef",
    whiteSpace: "nowrap",
  },
  tdRight: {
    padding: "10px 12px",
    textAlign: "right",
    borderBottom: "1px solid #eceeef",
    whiteSpace: "nowrap",
  },
  personName: {
    display: "block",
    color: "#777",
    fontSize: 11,
    marginTop: 2,
  },
  footerNote: {
    marginTop: 18,
    color: "#777",
    fontSize: 11,
    lineHeight: 1.45,
    textAlign: "center",
  },
};
