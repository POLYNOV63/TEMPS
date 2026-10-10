"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import {
  consoliderMonBilan,
  normaliserTexte,
  type CodeRef,
  type FeuilleNouvelle,
  type ImputationNouvelle,
  type JourNouveau,
  type LigneHistorique,
} from "@/lib/categoriesBilan";

/* ===============================================================
   MON BILAN

   Ma répartition du temps, avec EXACTEMENT les définitions de la page
   Bilans de l'équipe (voir lib/categoriesBilan.ts). Seules mes propres
   données sont lues et affichées.

   Ce que cette page ne reprend pas, car cela existe ailleurs :
     - saisie et compteur d'heures      -> Ma semaine
     - liste et statut de mes feuilles  -> Mes feuilles
     - congés, RTT et leurs soldes      -> RH
================================================================ */

type Periode = "MOIS" | "EXERCICE" | "ANNEE" | "GLISSANT";

type Moi = {
  id: string;
  prenom: string | null;
  nom: string | null;
  trigramme: string | null;
  inclus_statistiques: boolean | null;
};

type Donnees = {
  historique: LigneHistorique[];
  feuilles: FeuilleNouvelle[];
  jours: JourNouveau[];
  imputations: ImputationNouvelle[];
};

const COULEURS = {
  CBE: "#c00000",
  DBE: "#f2bfd0",
  CN: "#85ef57",
  PRODUCTION: "#f700cd",
  FORMATION: "#8b6bb1",
  AUTRES: "#d59b2a",
  NI: "#414040",
  NON_EXPLIQUE: "#e3e5e8",
};

const SEGMENTS = [
  { cle: "CBE", libelle: "CBE vendus", couleur: COULEURS.CBE },
  { cle: "DBE", libelle: "Devis / DBE", couleur: COULEURS.DBE },
  { cle: "CN", libelle: "CN (commercial)", couleur: COULEURS.CN },
  { cle: "PRODUCTION", libelle: "Divers de production", couleur: COULEURS.PRODUCTION },
  { cle: "FORMATION", libelle: "Formation", couleur: COULEURS.FORMATION },
  { cle: "AUTRES", libelle: "Autres (non classés)", couleur: COULEURS.AUTRES },
  { cle: "NI", libelle: "NI (non imputable)", couleur: COULEURS.NI },
  { cle: "NON_EXPLIQUE", libelle: "Non expliqué", couleur: COULEURS.NON_EXPLIQUE },
] as const;

const LIBELLES_PERIODE: Record<Periode, string> = {
  MOIS: "Mois",
  EXERCICE: "Exercice (nov. → oct.)",
  ANNEE: "Année",
  GLISSANT: "12 derniers mois",
};

const NOMS_MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/* ---------------------------------------------------------------
   OUTILS
--------------------------------------------------------------- */

function dateISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function dateDepuisISO(valeur: string) {
  const [a, m, j] = valeur.split("-").map(Number);
  return new Date(a, m - 1, j, 12, 0, 0);
}

function formaterDate(valeur: string) {
  return dateDepuisISO(valeur).toLocaleDateString("fr-FR");
}

function majuscule(texte: string) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function formatHeures(valeur: number) {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} h`;
}

function formatPourcent(valeur: number) {
  return `${valeur.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} %`;
}

function libelleMois(cle: string) {
  const [annee, mois] = cle.split("-").map(Number);
  return `${majuscule(NOMS_MOIS[mois - 1])} ${annee}`;
}

/* fin = borne exclue : une semaine appartient à la période si son lundi est
   dans [debut, fin[ */
function calculerPlage(periode: Periode, reference: string) {
  const ref = dateDepuisISO(reference);

  if (periode === "MOIS") {
    const debut = new Date(ref.getFullYear(), ref.getMonth(), 1, 12);
    const fin = new Date(ref.getFullYear(), ref.getMonth() + 1, 1, 12);

    return {
      debut: dateISO(debut),
      fin: dateISO(fin),
      titre: `${majuscule(NOMS_MOIS[ref.getMonth()])} ${ref.getFullYear()}`,
      detail: "semaines commençant ce mois-là",
    };
  }

  if (periode === "EXERCICE") {
    const annee = ref.getMonth() >= 10 ? ref.getFullYear() : ref.getFullYear() - 1;

    return {
      debut: `${annee}-11-01`,
      fin: `${annee + 1}-11-01`,
      titre: `Exercice ${annee}-${annee + 1}`,
      detail: `du 1er novembre ${annee} au 31 octobre ${annee + 1}`,
    };
  }

  if (periode === "ANNEE") {
    return {
      debut: `${ref.getFullYear()}-01-01`,
      fin: `${ref.getFullYear() + 1}-01-01`,
      titre: `Année ${ref.getFullYear()}`,
      detail: "du 1er janvier au 31 décembre",
    };
  }

  const aujourdhui = new Date();
  const debut = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - 11, 1, 12);
  const demain = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() + 1, 12);

  return {
    debut: dateISO(debut),
    fin: dateISO(demain),
    titre: "12 derniers mois",
    detail: `depuis le ${formaterDate(dateISO(debut))}`,
  };
}

async function chargerTout<T>(
  requete: (debut: number, fin: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const resultat: T[] = [];
  const taille = 1000;

  for (let page = 0; ; page++) {
    const { data, error } = await requete(page * taille, page * taille + taille - 1);

    if (error) throw new Error(error.message);
    if (!data) break;

    resultat.push(...data);

    if (data.length < taille) break;
  }

  return resultat;
}

async function parLots<T>(
  ids: string[],
  taille: number,
  requete: (lot: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const resultat: T[] = [];

  for (let i = 0; i < ids.length; i += taille) {
    const { data, error } = await requete(ids.slice(i, i + taille));

    if (error) throw new Error(error.message);

    resultat.push(...(data ?? []));
  }

  return resultat;
}

/* ===============================================================
   PAGE
================================================================ */

function MonBilanContenu() {
  const router = useRouter();

  const [moi, setMoi] = useState<Moi | null>(null);
  const [codes, setCodes] = useState<Map<string, CodeRef>>(new Map());
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [periode, setPeriode] = useState<Periode>("EXERCICE");
  const [reference, setReference] = useState(() => dateISO(new Date()));

  const plage = useMemo(() => calculerPlage(periode, reference), [periode, reference]);

  /* ---------------------- identité et référentiel ---------------------- */

  useEffect(() => {
    async function initialiser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Aucun utilisateur connecté.");
        }

        const { data: collaborateur, error } = await supabase
          .from("collaborateurs")
          .select("id,prenom,nom,trigramme,inclus_statistiques")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (error) throw new Error(error.message);

        if (!collaborateur) {
          throw new Error("Aucun collaborateur n'est associé à votre compte.");
        }

        const { data: lignesCodes, error: erreurCodes } = await supabase
          .from("codes_imputation")
          .select("code,libelle,categorie");

        if (erreurCodes) throw new Error(erreurCodes.message);

        const map = new Map<string, CodeRef>();

        (lignesCodes ?? []).forEach((c: CodeRef) => map.set(normaliserTexte(c.code), c));

        setCodes(map);
        setMoi(collaborateur as Moi);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Impossible de charger votre bilan.");
        setChargement(false);
      }
    }

    initialiser();
  }, []);

  /* ---------------------------- données de la période ---------------------------- */

  useEffect(() => {
    if (!moi) return;

    const idMoi = moi.id;
    let annule = false;

    async function charger() {
      setChargement(true);
      setErreur("");

      try {
        const anneeMin = Number(plage.debut.slice(0, 4)) - 1;
        const anneeMax = Number(plage.fin.slice(0, 4)) + 1;

        const historique = await chargerTout<LigneHistorique>((a, b) =>
          supabase
            .from("historique_imputations")
            .select("annee,semaine,affaire_code,code_imputation,heures,groupe_code")
            .eq("collaborateur_id", idMoi)
            .gte("annee", anneeMin)
            .lte("annee", anneeMax)
            .order("annee", { ascending: true })
            .order("semaine", { ascending: true })
            .order("id", { ascending: true })
            .range(a, b)
        );

        const { data: feuillesData, error: erreurFeuilles } = await supabase
          .from("feuilles_heures")
          .select("id,semaine_debut,total_theorique")
          .eq("collaborateur_id", idMoi)
          .gte("semaine_debut", plage.debut)
          .lt("semaine_debut", plage.fin);

        if (erreurFeuilles) throw new Error(erreurFeuilles.message);

        const feuilles = (feuillesData ?? []) as FeuilleNouvelle[];

        const jours = await parLots<JourNouveau>(
          feuilles.map((f) => f.id),
          40,
          (lot) => supabase.from("feuilles_heures_jours").select("id,feuille_id").in("feuille_id", lot)
        );

        const imputations = await parLots<ImputationNouvelle>(
          jours.map((j) => j.id),
          40,
          (lot) =>
            supabase
              .from("feuilles_heures_imputations")
              .select("jour_id,type_affaire,numero_affaire,code,heures")
              .in("jour_id", lot)
        );

        if (!annule) {
          setDonnees({ historique, feuilles, jours, imputations });
        }
      } catch (e) {
        if (!annule) {
          setErreur(e instanceof Error ? e.message : "Impossible de charger votre bilan.");
        }
      } finally {
        if (!annule) setChargement(false);
      }
    }

    charger();

    return () => {
      annule = true;
    };
  }, [moi, plage]);

  /* ------------------------------ consolidation ------------------------------ */

  const bilan = useMemo(() => {
    if (!donnees) return null;

    return consoliderMonBilan({
      ...donnees,
      codes,
      debut: plage.debut,
      fin: plage.fin,
    });
  }, [donnees, codes, plage]);

  const inclus = moi?.inclus_statistiques !== false;

  const travaille = bilan
    ? bilan.total.CBE +
      bilan.total.DBE +
      bilan.total.CN +
      bilan.total.PRODUCTION +
      bilan.total.NI +
      bilan.total.FORMATION +
      bilan.total.AUTRES
    : 0;

  const valeurs: Record<string, number> = bilan
    ? {
        CBE: bilan.total.CBE,
        DBE: bilan.total.DBE,
        CN: bilan.total.CN,
        PRODUCTION: bilan.total.PRODUCTION,
        FORMATION: bilan.total.FORMATION,
        AUTRES: bilan.total.AUTRES,
        NI: bilan.total.NI,
        NON_EXPLIQUE: bilan.nonExplique,
      }
    : {};

  const taux = (valeur: number) =>
    bilan && bilan.capacite > 0 ? (valeur / bilan.capacite) * 100 : 0;

  const lignesMois = useMemo(() => {
    if (!bilan) return [];

    const groupes = new Map<
      string,
      { cle: string; capacite: number; valeurs: Record<string, number> }
    >();

    bilan.semaines.forEach((semaine) => {
      const cle = semaine.lundi.slice(0, 7);
      const groupe = groupes.get(cle) ?? {
        cle,
        capacite: 0,
        valeurs: Object.fromEntries(SEGMENTS.map((s) => [s.cle, 0])) as Record<string, number>,
      };

      groupe.capacite += semaine.capacite;
      groupe.valeurs.CBE += semaine.cat.CBE;
      groupe.valeurs.DBE += semaine.cat.DBE;
      groupe.valeurs.CN += semaine.cat.CN;
      groupe.valeurs.PRODUCTION += semaine.cat.PRODUCTION;
      groupe.valeurs.FORMATION += semaine.cat.FORMATION;
      groupe.valeurs.AUTRES += semaine.cat.AUTRES;
      groupe.valeurs.NI += semaine.cat.NI;
      groupe.valeurs.NON_EXPLIQUE += semaine.nonExplique;

      groupes.set(cle, groupe);
    });

    return Array.from(groupes.values()).sort((a, b) => a.cle.localeCompare(b.cle));
  }, [bilan]);

  function decaler(sens: 1 | -1) {
    const ref = dateDepuisISO(reference);

    if (periode === "MOIS") {
      ref.setMonth(ref.getMonth() + sens, 15);
    } else {
      ref.setFullYear(ref.getFullYear() + sens);
    }

    setReference(dateISO(ref));
  }

  const nomComplet = moi ? `${moi.prenom ?? ""} ${moi.nom ?? ""}`.trim() : "";
  const segmentsVisibles = SEGMENTS.filter(
    (s) => (valeurs[s.cle] ?? 0) > 0.001 && (s.cle !== "AUTRES" || (valeurs.AUTRES ?? 0) > 0)
  );

  const totalBarre = bilan ? Math.max(bilan.capacite, travaille + (bilan.nonExplique ?? 0)) : 0;
  const donneesPresentes = Boolean(bilan && bilan.semaines.length > 0);

  /* ------------------------------------ rendu ------------------------------------ */

  return (
    <main style={styles.page}>
      <EnTetePage
        section="Mon bilan"
        titre="Mon bilan"
        description={
          nomComplet
            ? `${nomComplet} — ma répartition du temps, avec les mêmes définitions que le bilan de l'équipe.`
            : "Ma répartition du temps, avec les mêmes définitions que le bilan de l'équipe."
        }
      />

      <div style={styles.contenu}>
        {/* ------------ période ------------ */}
        <section style={styles.carte}>
          <div style={styles.titreCarte}>Période analysée</div>

          <div style={styles.ligne}>
            <div style={styles.segments} role="radiogroup" aria-label="Type de période">
              {(["MOIS", "EXERCICE", "ANNEE", "GLISSANT"] as Periode[]).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  role="radio"
                  aria-checked={periode === valeur}
                  onClick={() => setPeriode(valeur)}
                  style={{
                    ...styles.segment,
                    ...(periode === valeur ? styles.segmentActif : {}),
                  }}
                >
                  {LIBELLES_PERIODE[valeur]}
                </button>
              ))}
            </div>

            <div style={styles.navigation}>
              <button
                type="button"
                onClick={() => decaler(-1)}
                disabled={periode === "GLISSANT"}
                style={{ ...styles.fleche, opacity: periode === "GLISSANT" ? 0.35 : 1 }}
                aria-label="Période précédente"
              >
                ◀
              </button>

              <div style={styles.periodeActuelle}>
                <strong>{plage.titre}</strong>
                <span>{plage.detail}</span>
              </div>

              <button
                type="button"
                onClick={() => decaler(1)}
                disabled={periode === "GLISSANT"}
                style={{ ...styles.fleche, opacity: periode === "GLISSANT" ? 0.35 : 1 }}
                aria-label="Période suivante"
              >
                ▶
              </button>

              <button
                type="button"
                onClick={() => setReference(dateISO(new Date()))}
                style={styles.lien}
              >
                Aujourd'hui
              </button>
            </div>
          </div>
        </section>

        {erreur && <div style={styles.erreur}>⚠️ {erreur}</div>}

        {chargement && !erreur && <div style={styles.info}>Chargement de votre bilan…</div>}

        {!inclus && !chargement && (
          <div style={styles.info}>
            Vous ne figurez pas dans les statistiques de productivité de l'équipe (encadrement) :
            vos heures sont affichées sans taux ni capacité.
          </div>
        )}

        {!chargement && !erreur && bilan && !donneesPresentes && (
          <div style={styles.info}>Aucune heure enregistrée sur cette période.</div>
        )}

        {!chargement && !erreur && bilan && donneesPresentes && (
          <>
            {/* ------------ chiffres ------------ */}
            <section style={styles.grille}>
              {inclus && (
                <div style={{ ...styles.tuile, borderTop: "4px solid #252525" }}>
                  <div style={styles.tuileLibelle}>Capacité nette</div>
                  <div style={styles.tuileValeur}>{formatHeures(bilan.capacite)}</div>
                  <div style={styles.tuileSous}>après congés, fériés et absences</div>
                </div>
              )}

              {SEGMENTS.filter((s) => s.cle !== "AUTRES" || (valeurs.AUTRES ?? 0) > 0.001)
                .filter((s) => inclus || s.cle !== "NON_EXPLIQUE")
                .map((segment) => {
                  const valeur = valeurs[segment.cle] ?? 0;
                  const fi = bilan.formationParCode.FI ?? 0;
                  const fo = bilan.formationParCode.FO ?? 0;

                  const sous =
                    segment.cle === "FORMATION"
                      ? `${inclus ? `${formatPourcent(taux(valeur))} · ` : ""}FI ${formatHeures(fi)} · FO ${formatHeures(fo)}`
                      : inclus
                        ? `${formatPourcent(taux(valeur))} de ma capacité`
                        : "";

                  return (
                    <div
                      key={segment.cle}
                      style={{ ...styles.tuile, borderTop: `4px solid ${segment.couleur}` }}
                    >
                      <div style={styles.tuileLibelle}>{segment.libelle}</div>
                      <div style={styles.tuileValeur}>{formatHeures(valeur)}</div>
                      {sous && <div style={styles.tuileSous}>{sous}</div>}
                    </div>
                  );
                })}
            </section>

            {/* ------------ barre de répartition ------------ */}
            {inclus && totalBarre > 0 && (
              <section style={styles.carte}>
                <div style={styles.titreCarte}>Ma capacité nette, répartie</div>

                <div style={styles.barre} role="img" aria-label="Répartition de ma capacité nette">
                  {segmentsVisibles.map((segment) => {
                    const valeur = valeurs[segment.cle] ?? 0;
                    const largeur = (valeur / totalBarre) * 100;

                    return (
                      <div
                        key={segment.cle}
                        title={`${segment.libelle} : ${formatHeures(valeur)} (${formatPourcent(taux(valeur))})`}
                        style={{
                          width: `${largeur}%`,
                          background: segment.couleur,
                          color: segment.cle === "DBE" || segment.cle === "NON_EXPLIQUE" || segment.cle === "CN" ? "#222" : "#fff",
                          ...styles.partBarre,
                        }}
                      >
                        {largeur >= 7 ? formatPourcent(taux(valeur)) : ""}
                      </div>
                    );
                  })}
                </div>

                <div style={styles.legende}>
                  {segmentsVisibles.map((segment) => (
                    <span key={segment.cle} style={styles.legendeItem}>
                      <i style={{ ...styles.pastille, background: segment.couleur }} />
                      {segment.libelle}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* ------------ mes affaires ------------ */}
            <section style={styles.carte}>
              <div style={styles.titreCarte}>Mes affaires</div>

              {bilan.affaires.length === 0 ? (
                <div style={styles.sousTexte}>Aucune heure imputée sur une affaire CBE ou DBE sur cette période.</div>
              ) : (
                <>
                  <table style={styles.tableau}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Affaire</th>
                        <th style={{ textAlign: "left" }}>Type</th>
                        <th style={{ textAlign: "right" }}>Heures</th>
                        <th style={{ textAlign: "right" }}>Part de mes heures affaires</th>
                      </tr>
                    </thead>

                    <tbody>
                      {bilan.affaires.slice(0, 15).map((affaire) => {
                        const totalAffaires = bilan.affaires.reduce((t, a) => t + a.heures, 0);

                        return (
                          <tr key={affaire.libelle}>
                            <td>
                              <strong>{affaire.libelle}</strong>
                            </td>
                            <td>{affaire.type === "CBE" ? "Vendu (CBE)" : "Devis (DBE)"}</td>
                            <td style={{ textAlign: "right" }}>{formatHeures(affaire.heures)}</td>
                            <td style={{ textAlign: "right" }}>
                              {formatPourcent(totalAffaires > 0 ? (affaire.heures / totalAffaires) * 100 : 0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {bilan.affaires.length > 15 && (
                    <div style={styles.sousTexte}>
                      … et {bilan.affaires.length - 15} autre(s) affaire(s) de moindre volume.
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ------------ mois par mois ------------ */}
            {lignesMois.length > 1 && (
              <section style={styles.carte}>
                <div style={styles.titreCarte}>Mois par mois</div>

                <div style={{ display: "grid", gap: 8 }}>
                  {lignesMois.map((ligne) => {
                    const total = Math.max(
                      ligne.capacite,
                      Object.values(ligne.valeurs).reduce((t, v) => t + v, 0)
                    );

                    return (
                      <div key={ligne.cle} style={styles.ligneMois}>
                        <div style={{ fontWeight: 700 }}>{libelleMois(ligne.cle)}</div>

                        {inclus ? (
                          <div style={styles.barreMois}>
                            {SEGMENTS.map((segment) => {
                              const valeur = ligne.valeurs[segment.cle] ?? 0;

                              if (valeur <= 0.001 || total <= 0) return null;

                              return (
                                <div
                                  key={segment.cle}
                                  title={`${segment.libelle} : ${formatHeures(valeur)}`}
                                  style={{
                                    width: `${(valeur / total) * 100}%`,
                                    background: segment.couleur,
                                    height: "100%",
                                  }}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div />
                        )}

                        <div style={styles.texteMois}>
                          {inclus && ligne.capacite > 0
                            ? `CBE ${formatPourcent((ligne.valeurs.CBE / ligne.capacite) * 100)} · DBE ${formatPourcent(
                                (ligne.valeurs.DBE / ligne.capacite) * 100
                              )} · NI ${formatPourcent((ligne.valeurs.NI / ligne.capacite) * 100)}`
                            : `CBE ${formatHeures(ligne.valeurs.CBE)} · DBE ${formatHeures(ligne.valeurs.DBE)}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {/* ------------ définitions ------------ */}
        <section style={styles.carte}>
          <div style={styles.titreCarte}>Comment lire ces chiffres</div>

          <ul style={styles.liste}>
            <li>
              <strong>CBE vendus</strong> : heures imputées sur des affaires vendues.
            </li>
            <li>
              <strong>Devis / DBE</strong> : heures passées à chiffrer.
            </li>
            <li>
              <strong>CN</strong> : temps commercial.
            </li>
            <li>
              <strong>Divers de production</strong> : lignes « Divers » avec un code de production (préparation
              d'outils, achats d'une affaire de négoce…).
            </li>
            <li>
              <strong>NI</strong> : temps non imputable, faute de charge.
            </li>
            <li>
              <strong>Formation</strong> : FI (interne) et FO (externe).
            </li>
            <li>
              <strong>Capacité nette</strong> : 35 h moins congés, fériés et absences. <strong>Non expliqué</strong> :
              part de la capacité qui n'est rattachée à aucune catégorie.
            </li>
            <li>Les feuilles en brouillon sont incluses ; l'historique importé couvre la période avant la bascule.</li>
          </ul>
        </section>

        {/* ------------ liens (pas de doublon) ------------ */}
        <section style={styles.liens}>
          <button type="button" style={styles.boutonLien} onClick={() => router.push("/ma-semaine")}>
            ✏️ Saisir ma semaine
          </button>

          <button type="button" style={styles.boutonLien} onClick={() => router.push("/mes-feuilles")}>
            🗂️ Mes feuilles
          </button>

          <button type="button" style={styles.boutonLien} onClick={() => router.push("/RH")}>
            🧑‍💼 Mes congés et RTT
          </button>
        </section>
      </div>
    </main>
  );
}

export default function MonBilanPage() {
  return (
    <GardeAcces droit={null}>
      <MonBilanContenu />
    </GardeAcces>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f6f8",
    fontFamily: "Calibri, Arial, sans-serif",
    color: "#202020",
  },

  contenu: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "24px 24px 60px",
    display: "grid",
    gap: 16,
  },

  carte: {
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 2px 8px rgba(0,0,0,.04)",
  },

  titreCarte: {
    fontSize: 16,
    fontWeight: 900,
    marginBottom: 14,
  },

  ligne: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
  },

  segments: {
    display: "inline-flex",
    border: "1px solid #cfcfcf",
    borderRadius: 9,
    overflow: "hidden",
    background: "#fff",
  },

  segment: {
    border: "none",
    borderRight: "1px solid #e1e1e1",
    background: "#fff",
    color: "#444",
    padding: "10px 14px",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
  },

  segmentActif: {
    background: "#c00000",
    color: "#fff",
  },

  navigation: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  fleche: {
    width: 34,
    height: 34,
    border: "1px solid #cfcfcf",
    borderRadius: 8,
    background: "#fff",
    color: "#c00000",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  periodeActuelle: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: 210,
    fontSize: 13,
    color: "#666",
    lineHeight: 1.3,
  },

  lien: {
    background: "transparent",
    border: "none",
    color: "#1f4e99",
    fontWeight: 700,
    textDecoration: "underline",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  },

  grille: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 12,
  },

  tuile: {
    background: "#fff",
    border: "1px solid #e2e2e2",
    borderRadius: 10,
    padding: "14px 16px",
    boxShadow: "0 2px 8px rgba(0,0,0,.04)",
  },

  tuileLibelle: {
    fontSize: 12,
    fontWeight: 800,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: ".4px",
  },

  tuileValeur: {
    fontSize: 26,
    fontWeight: 800,
    marginTop: 6,
  },

  tuileSous: {
    marginTop: 4,
    fontSize: 12,
    color: "#777",
    lineHeight: 1.35,
  },

  barre: {
    display: "flex",
    height: 34,
    borderRadius: 8,
    overflow: "hidden",
    background: "#eef0f2",
  },

  partBarre: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 800,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },

  legende: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 18px",
    marginTop: 12,
    fontSize: 13,
    color: "#444",
  },

  legendeItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
  },

  pastille: {
    display: "inline-block",
    width: 13,
    height: 13,
    borderRadius: 4,
  },

  tableau: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  },

  ligneMois: {
    display: "grid",
    gridTemplateColumns: "150px minmax(0, 1fr) 280px",
    gap: 14,
    alignItems: "center",
    padding: "4px 0",
  },

  barreMois: {
    display: "flex",
    height: 20,
    borderRadius: 6,
    overflow: "hidden",
    background: "#eef0f2",
  },

  texteMois: {
    fontSize: 12,
    color: "#555",
  },

  sousTexte: {
    marginTop: 8,
    color: "#777",
    fontSize: 13,
  },

  liste: {
    margin: 0,
    paddingLeft: 20,
    display: "grid",
    gap: 5,
    fontSize: 14,
    lineHeight: 1.45,
    color: "#444",
  },

  info: {
    background: "#f3f7ff",
    border: "1px solid #b9c7e0",
    borderRadius: 10,
    padding: "12px 16px",
    color: "#243b66",
    fontWeight: 600,
  },

  erreur: {
    background: "#ffe9e9",
    border: "1px solid #ffbcbc",
    borderRadius: 10,
    padding: "12px 16px",
    color: "#a00000",
    fontWeight: 700,
  },

  liens: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },

  boutonLien: {
    background: "#fff",
    border: "1px solid #cfcfcf",
    borderRadius: 9,
    padding: "11px 16px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    color: "#333",
  },
};
