"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   ANALYSE - EFFECTIFS (administration et Direction)

   Mieux connaître le bureau d'études :
   - COMPOSITION : pour chaque activité (Elec, Méca, Calcul, Scan…), qui
     l'a comme prédominance (fiche Collaborateurs) et quelle part de
     l'effectif cela représente (une personne à deux prédominances compte
     pour moitié dans chacune) ;
   - RÉALITÉ : la part des heures pointées sur l'exercice dans chaque
     activité, face à la part de l'effectif ;
   - MÉTHODES DE VENTE : la part des heures en PE, PI, IG et BE (forfaits,
     toutes activités du BE), plus les devis et le hors affaire ;
   - PAR COLLABORATEUR : prédominances, heures, activités réellement
     pointées, part du temps passé dans ses prédominances, méthodes.
   La liste des activités vient de « Gestion des activités » : une
   nouvelle activité apparaît d'elle-même.
   Données : fonctions SQL analyse_effectifs_collaborateurs() et
   analyse_effectifs(début, fin) (SQL 67).
================================================================ */

type Activite = { id: string; nom: string; code: string; actif: boolean; ordre_affichage: number };
type Membre = { id: string; prenom: string | null; nom: string | null; trigramme: string | null; inclus_statistiques: boolean; predominances: string[]; competences: string[] };
type Heure = { collaborateur_id: string; activite_id: string | null; methode: string; heures: number };

const METHODES: { code: string; libelle: string; couleur: string; aide: string }[] = [
  { code: "BE", libelle: "BE (forfaits)", couleur: "#c00000", aide: "Affaires au forfait du bureau d'études : Méca, Elec, Calcul, Scan, Négoce…" },
  { code: "PE", libelle: "PE", couleur: "#6f8fb3", aide: "Prestations externes, chez le client" },
  { code: "PI", libelle: "PI", couleur: "#6b58a8", aide: "Prestations internes, au BE" },
  { code: "IG", libelle: "Intergroupe", couleur: "#2e7d6b", aide: "Prestations facturées à une société du groupe" },
  { code: "DEVIS", libelle: "Devis (DBE)", couleur: "#d98aa6", aide: "Temps passé à préparer les devis" },
  { code: "HORS_AFFAIRE", libelle: "Hors affaire", couleur: "#9aa0a6", aide: "Divers : formation, réunions, administratif…" },
];
const SANS = "__sans__";

function exerciceCourant() {
  const d = new Date();
  return d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
}
const heuresTxt = (h: number) => `${Math.round(h).toLocaleString("fr-FR")} h`;
const pct = (x: number) => `${Math.round(x * 100)} %`;

function Barre({ part, couleur, largeur = 160 }: { part: number; couleur: string; largeur?: number }) {
  return (
    <span style={{ display: "inline-block", width: largeur, height: 10, background: "#eef0f3", borderRadius: 5, position: "relative", verticalAlign: "middle" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.max(0, part * 100))}%`, background: couleur, borderRadius: 5 }} />
    </span>
  );
}

function EffectifsContenu() {
  const [exercice, setExercice] = useState(exerciceCourant);
  const [activites, setActivites] = useState<Activite[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [heures, setHeures] = useState<Heure[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [seulementStats, setSeulementStats] = useState(true);

  // EFFECTIFS_V2 : niveaux (SQL 86), droits (le détail par personne est réservé à l'ADMIN), heures mois par mois
  const [niveaux, setNiveaux] = useState<Map<string, number>>(new Map());
  const [estAdmin, setEstAdmin] = useState(false);
  const [mensuel, setMensuel] = useState<{ mois: string; heures: Heure[] }[]>([]);
  useEffect(() => {
    void supabase
      .from("collaborateurs_niveaux")
      .select("collaborateur_id,niveau")
      .then(({ data }) => setNiveaux(new Map(((data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0]))));
    chargerMoi()
      .then((m) => setEstAdmin(Boolean(m?.estAdmin)))
      .catch(() => setEstAdmin(false));
  }, []);
  useEffect(() => {
    let actif = true;
    const moisCourant = new Date().toISOString().slice(0, 7);
    const moisListe = Array.from({ length: 12 }, (_, k) => new Date(Date.UTC(exercice, 10 + k, 1)).toISOString().slice(0, 7)).filter((m) => m <= moisCourant);
    const finMois = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    Promise.all(
      moisListe.map(async (m) => {
        const { data } = await supabase.rpc("analyse_effectifs", { p_debut: `${m}-01`, p_fin: finMois(m) });
        return { mois: m, heures: ((data ?? []) as Heure[]).map((x) => ({ ...x, heures: Number(x.heures) || 0 })) };
      })
    )
      .then((r) => actif && setMensuel(r))
      .catch(() => actif && setMensuel([]));
    return () => {
      actif = false;
    };
  }, [exercice]);

  const debut = `${exercice}-11-01`;
  const fin = `${exercice + 1}-10-31`;

  useEffect(() => {
    let actif = true;
    setChargement(true);
    setErreur("");
    Promise.all([
      supabase.from("activites").select("id,nom,code,actif,ordre_affichage").order("ordre_affichage"),
      supabase.rpc("analyse_effectifs_collaborateurs"),
      supabase.rpc("analyse_effectifs", { p_debut: debut, p_fin: fin }),
    ])
      .then(([a, m, h]) => {
        if (!actif) return;
        const e = a.error ?? m.error ?? h.error;
        if (e) throw new Error(e.message);
        setActivites((a.data ?? []) as Activite[]);
        setMembres(((m.data ?? []) as Membre[]).map((x) => ({ ...x, predominances: x.predominances ?? [], competences: x.competences ?? [] })));
        setHeures(((h.data ?? []) as Heure[]).map((x) => ({ ...x, heures: Number(x.heures) || 0 })));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger l’analyse."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [debut, fin]);

  const vue = useMemo(() => {
    const equipe = membres.filter((m) => !seulementStats || m.inclus_statistiques);
    const ids = new Set(equipe.map((m) => m.id));
    const hs = heures.filter((h) => ids.has(h.collaborateur_id));
    const nomAct = new Map(activites.map((a) => [a.id, a.nom]));

    // activités affichées : actives, plus celles qui ont des heures ou des prédominances
    const utilisees = new Set<string>([...hs.map((h) => h.activite_id ?? SANS), ...equipe.flatMap((m) => [...m.predominances, ...m.competences])]);
    const listeAct = [
      ...activites.filter((a) => a.actif || utilisees.has(a.id)).map((a) => ({ id: a.id, nom: a.nom })),
      ...(utilisees.has(SANS) ? [{ id: SANS, nom: "Sans activité (code non rattaché)" }] : []),
    ];

    // heures « métier » (affaires et devis) : la base des parts par activité
    const metier = hs.filter((h) => h.methode !== "HORS_AFFAIRE");
    const totalMetier = metier.reduce((t, h) => t + h.heures, 0);
    const totalTout = hs.reduce((t, h) => t + h.heures, 0);
    const heuresParAct = new Map<string, number>();
    for (const h of metier) heuresParAct.set(h.activite_id ?? SANS, (heuresParAct.get(h.activite_id ?? SANS) ?? 0) + h.heures);

    // part de l'effectif : une personne à k prédominances compte 1/k dans chacune
    const avecPredo = equipe.filter((m) => m.predominances.length > 0);
    const partEffectif = new Map<string, number>();
    const personnes = new Map<string, Membre[]>();
    for (const m of avecPredo)
      for (const a of m.predominances) {
        partEffectif.set(a, (partEffectif.get(a) ?? 0) + 1 / m.predominances.length);
        personnes.set(a, [...(personnes.get(a) ?? []), m]);
      }
    // compétences d'appoint : qui sait aussi le faire (sans peser dans la composition)
    const appoint = new Map<string, Membre[]>();
    for (const m of equipe) for (const a of m.competences) if (!m.predominances.includes(a)) appoint.set(a, [...(appoint.get(a) ?? []), m]);

    const composition = listeAct
      .map((a) => ({
        ...a,
        personnes: personnes.get(a.id) ?? [],
        appoint: appoint.get(a.id) ?? [],
        partEffectif: avecPredo.length ? (partEffectif.get(a.id) ?? 0) / avecPredo.length : 0,
        heures: heuresParAct.get(a.id) ?? 0,
        partHeures: totalMetier ? (heuresParAct.get(a.id) ?? 0) / totalMetier : 0,
      }))
      .filter((a) => a.personnes.length > 0 || a.appoint.length > 0 || a.heures > 0.5);

    // méthodes de vente
    const parMethode = METHODES.map((m) => {
      const h = hs.filter((x) => x.methode === m.code).reduce((t, x) => t + x.heures, 0);
      return { ...m, heures: h, part: totalTout ? h / totalTout : 0 };
    }).filter((m) => m.heures > 0.5);
    const totalVendu = hs.filter((x) => ["BE", "PE", "PI", "IG"].includes(x.methode)).reduce((t, x) => t + x.heures, 0);
    // le BE par activité
    const beParAct = listeAct
      .map((a) => ({ ...a, heures: hs.filter((x) => x.methode === "BE" && (x.activite_id ?? SANS) === a.id).reduce((t, x) => t + x.heures, 0) }))
      .filter((a) => a.heures > 0.5)
      .sort((x, y) => y.heures - x.heures);
    const totalBE = beParAct.reduce((t, a) => t + a.heures, 0);

    // par collaborateur
    const parCollab = equipe
      .map((m) => {
        const siennes = hs.filter((h) => h.collaborateur_id === m.id);
        const total = siennes.reduce((t, h) => t + h.heures, 0);
        const sesMetier = siennes.filter((h) => h.methode !== "HORS_AFFAIRE");
        const totalM = sesMetier.reduce((t, h) => t + h.heures, 0);
        const parAct = new Map<string, number>();
        for (const h of sesMetier) parAct.set(h.activite_id ?? SANS, (parAct.get(h.activite_id ?? SANS) ?? 0) + h.heures);
        const top = [...parAct.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
        const dansPredo = m.predominances.reduce((t, a) => t + (parAct.get(a) ?? 0), 0);
        const meth = new Map<string, number>();
        for (const h of siennes) meth.set(h.methode, (meth.get(h.methode) ?? 0) + h.heures);
        return { m, total, totalM, top, partPredo: m.predominances.length && totalM ? dansPredo / totalM : null, meth };
      })
      .sort((x, y) => `${x.m.nom ?? ""}`.localeCompare(`${y.m.nom ?? ""}`, "fr"));

    return { equipe, avecPredo, composition, parMethode, totalTout, totalMetier, totalVendu, beParAct, totalBE, parCollab, nomAct };
  }, [membres, heures, activites, seulementStats]);

  const nomPersonne = (m: Membre) => m.trigramme || `${m.prenom ?? ""} ${m.nom ?? ""}`.trim();
  const nomAct = (id: string) => (id === SANS ? "Sans activité" : vue.nomAct.get(id) ?? "Activité");
  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px" };
  const thN: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "8px", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const sansPredo = vue.equipe.filter((m) => m.predominances.length === 0);
  const partBE = vue.parMethode.find((m) => m.code === "BE")?.part ?? 0;
  const partPEPI = vue.parMethode.filter((m) => ["PE", "PI", "IG"].includes(m.code)).reduce((t, m) => t + m.part, 0);

  /* EFFECTIFS_V2 : pyramide des niveaux et dépendance, pour Méca, Elec et Calcul */
  const NIVEAUX = [
    { n: 1, lib: "N1", aide: "exécute sous supervision", couleur: "#c8e6c9" },
    { n: 2, lib: "N2", aide: "autonome sur une affaire courante", couleur: "#66bb6a" },
    { n: 3, lib: "N3", aide: "expert ou référent", couleur: "#2e7d32" },
    { n: 0, lib: "?", aide: "niveau non renseigné", couleur: "#e3e7e3" },
  ];
  const estActiviteBE = (nom: string) => /^(meca|elec|calcul)/.test(nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());
  const pyramide = activites
    .filter((a) => estActiviteBE(a.nom))
    .sort((x, y) => x.ordre_affichage - y.ordre_affichage)
    .map((a) => {
      const titulaires = vue.equipe.filter((m) => m.predominances.includes(a.id));
      const releve = vue.equipe.filter((m) => !m.predominances.includes(a.id) && m.competences.includes(a.id));
      const nb = NIVEAUX.map((nv) => titulaires.filter((m) => (niveaux.get(m.id) ?? 0) === nv.n).length);
      const [n1, , n3, inconnus] = nb;
      const attention: string[] = [];
      if (titulaires.length <= 2) attention.push(titulaires.length === 0 ? "personne en activité principale" : `repose sur ${titulaires.length} personne${titulaires.length > 1 ? "s" : ""}`);
      if (inconnus > 0) attention.push(`${inconnus} niveau${inconnus > 1 ? "x" : ""} à renseigner`);
      else if (titulaires.length > 0) {
        if (n3 === 0) attention.push("aucun référent (N3)");
        else if (n3 === 1) attention.push("un seul référent (N3)");
        if (n3 > 0 && n1 > 2 * n3) attention.push("peu de référents pour encadrer les N1");
      }
      if (releve.length === 0 && titulaires.length > 0) attention.push("pas de relève en appoint");
      return { a, titulaires: titulaires.length, releve: releve.length, nb, attention };
    });

  /* EFFECTIFS_V2 : temps vendu, devis et hors affaire, mois par mois */
  const idsEquipe = new Set(vue.equipe.map((m) => m.id));
  const parMois = mensuel.map(({ mois, heures: hs }) => {
    const siennes = hs.filter((h) => idsEquipe.has(h.collaborateur_id));
    const somme = (f: (h: Heure) => boolean) => siennes.filter(f).reduce((t, h) => t + h.heures, 0);
    const total = somme(() => true);
    return {
      mois,
      total,
      vendu: somme((h) => ["BE", "PE", "PI", "IG"].includes(h.methode)),
      devis: somme((h) => h.methode === "DEVIS"),
      hors: somme((h) => h.methode === "HORS_AFFAIRE"),
    };
  });
  const libMois = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short" });

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Analyse des effectifs</h1>
            <p style={page.sousTitre}>
              Comment est constitué le bureau d’études : prédominances de chacun, heures réellement pointées par activité, et méthodes de vente
              (PE, PI, BE). Exercice du 1er novembre {exercice} au 31 octobre {exercice + 1}.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice - 1)} aria-label="Exercice précédent">
              ◀
            </button>
            <strong style={{ fontSize: 18, minWidth: 110, textAlign: "center" }}>
              {exercice}-{exercice + 1}
            </strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice(exercice + 1)} aria-label="Exercice suivant">
              ▶
            </button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, marginLeft: 8 }} title="Décocher pour inclure l'encadrement (exclu des statistiques de productivité)">
              <input type="checkbox" checked={seulementStats} onChange={(e) => setSeulementStats(e.target.checked)} style={{ width: 18, height: 18 }} />
              Sans l’encadrement
            </label>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && !erreur && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Effectif" valeur={String(vue.equipe.length)} sous={`${vue.avecPredo.length} avec une prédominance renseignée`} accent={sansPredo.length > 0} />
              <Tuile libelle="Heures pointées" valeur={heuresTxt(vue.totalTout)} sous={`dont ${heuresTxt(vue.totalMetier)} sur affaires et devis`} />
              <Tuile libelle="Part BE (forfaits)" valeur={pct(partBE)} sous="des heures de l’exercice" />
              <Tuile libelle="Part PE / PI" valeur={pct(partPEPI)} sous="prestations au temps passé (intergroupe compris)" />
            </div>

            {sansPredo.length > 0 && (
              <Message genre="info">
                <strong>{sansPredo.length} collaborateur(s) sans prédominance</strong> : {sansPredo.map(nomPersonne).join(", ")}. Renseignez-la dans{" "}
                <Link href="/admin/collaborateurs" style={{ fontWeight: 800, color: C.rougeFonce }}>
                  Collaborateurs
                </Link>{" "}
                (bouton Modifier) pour qu’ils comptent dans la composition.
              </Message>
            )}

            {/* ---------- composition ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Composition du bureau d’études</h2>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                <strong>Part de l’effectif</strong> : d’après les prédominances, les activités principales (une personne à deux prédominances compte pour moitié dans chacune). Les{" "}
                <strong>compétences d’appoint</strong> (ce qu’une personne sait aussi faire, comme le Scan) sont listées à part et ne pèsent pas dans
                cette part.{" "}
                <strong>Part des heures</strong> : heures pointées sur affaires et devis dans l’activité, sur l’exercice. Un écart important veut dire que
                l’équipe travaille ailleurs que là où sont ses compétences, ou l’inverse.
              </p>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={th}>Activité</th>
                    <th style={th}>Prédominance chez</th>
                    <th style={th}>Aussi en appoint</th>
                    <th style={thN}>Part de l’effectif</th>
                    <th style={thN}>Heures pointées</th>
                    <th style={thN}>Part des heures</th>
                    <th style={th}>Effectif / heures</th>
                  </tr>
                </thead>
                <tbody>
                  {vue.composition.map((a) => {
                    const ecart = a.partHeures - a.partEffectif;
                    return (
                      <tr key={a.id}>
                        <td style={{ ...td, fontWeight: 800 }}>{a.nom}</td>
                        <td style={{ ...td, fontSize: 13 }}>{a.personnes.length ? `${a.personnes.length} : ${a.personnes.map(nomPersonne).join(", ")}` : "—"}</td>
                        <td style={{ ...td, fontSize: 13, color: C.gris }}>{a.appoint.length ? `${a.appoint.length} : ${a.appoint.map(nomPersonne).join(", ")}` : "—"}</td>
                        <td style={tdN}>{a.personnes.length ? pct(a.partEffectif) : "—"}</td>
                        <td style={tdN}>{a.heures > 0.5 ? heuresTxt(a.heures) : "—"}</td>
                        <td style={tdN}>{a.heures > 0.5 ? pct(a.partHeures) : "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <div title={`Part de l’effectif : ${pct(a.partEffectif)}`}>
                            <Barre part={a.partEffectif} couleur="#1f4e79" />
                          </div>
                          <div title={`Part des heures : ${pct(a.partHeures)}`} style={{ marginTop: 3 }}>
                            <Barre part={a.partHeures} couleur={C.rouge} />
                            {a.personnes.length > 0 && a.heures > 0.5 && Math.abs(ecart) >= 0.1 && (
                              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 800, color: ecart > 0 ? "#b35c00" : "#1f4e79" }}>
                                {ecart > 0 ? `+${pct(ecart)} d’heures` : `${pct(ecart)} d’heures`}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 16, fontSize: 12, marginTop: 8, color: "#3b4046", flexWrap: "wrap" }}>
                <span>
                  <i style={{ display: "inline-block", width: 14, height: 8, background: "#1f4e79", borderRadius: 3 }} /> part de l’effectif
                </span>
                <span>
                  <i style={{ display: "inline-block", width: 14, height: 8, background: C.rouge, borderRadius: 3 }} /> part des heures pointées
                </span>
              </div>
            </section>


            {/* ---------- EFFECTIFS_V2 : niveaux et dépendance ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Niveaux et dépendance</h2>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                Pour chaque activité, les personnes qui l’ont en activité principale, par niveau (fiche collaborateur), et la <strong>relève</strong> : celles qui
                ont cette compétence en appoint. Les <strong>points d’attention</strong> signalent une activité fragile : qui repose sur une ou deux personnes, sans
                référent, ou avec trop de débutants par référent. Aucun nom n’est affiché.
              </p>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={th}>Activité</th>
                    <th style={{ ...thN, textAlign: "center" }}>En principale</th>
                    <th style={th}>Niveaux</th>
                    <th style={{ ...thN, textAlign: "center" }}>Relève (appoint)</th>
                    <th style={th}>Points d’attention</th>
                  </tr>
                </thead>
                <tbody>
                  {pyramide.map((p) => (
                    <tr key={p.a.id}>
                      <td style={{ ...td, fontWeight: 800 }}>{p.a.nom}</td>
                      <td style={{ ...tdN, textAlign: "center", fontWeight: 800 }}>{p.titulaires}</td>
                      <td style={td}>
                        <div style={{ display: "flex", height: 14, width: 220, borderRadius: 4, overflow: "hidden", background: "#eef0f3" }}>
                          {NIVEAUX.map((nv, k) =>
                            p.nb[k] > 0 ? (
                              <div key={nv.n} title={`${nv.lib} (${nv.aide}) : ${p.nb[k]}`} style={{ width: `${(p.nb[k] / Math.max(1, p.titulaires)) * 100}%`, background: nv.couleur }} />
                            ) : null
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#3b4046", marginTop: 3 }}>
                          {NIVEAUX.filter((nv, k) => nv.n > 0 || p.nb[k] > 0)
                            .map((nv) => `${nv.lib} ${p.nb[NIVEAUX.indexOf(nv)]}`)
                            .join(" · ")}
                        </div>
                      </td>
                      <td style={{ ...tdN, textAlign: "center" }}>{p.releve || "—"}</td>
                      <td style={td}>
                        {p.attention.length === 0 ? (
                          <span style={{ color: "#1b5e20", fontWeight: 700, fontSize: 13 }}>✓ rien à signaler</span>
                        ) : (
                          p.attention.map((x) => (
                            <span key={x} style={{ display: "inline-block", margin: "1px 4px 1px 0", background: "#fff1df", color: "#7a3e00", borderRadius: 999, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>
                              {x}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 14, fontSize: 12, marginTop: 8, color: "#3b4046", flexWrap: "wrap" }}>
                {NIVEAUX.map((nv) => (
                  <span key={nv.n}>
                    <i style={{ display: "inline-block", width: 12, height: 10, background: nv.couleur, borderRadius: 2, border: "1px solid #c9d1c9" }} /> {nv.lib} : {nv.aide}
                  </span>
                ))}
              </div>
            </section>

            {/* ---------- méthodes de vente ---------- */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <section style={{ ...page.carte, padding: 16, flex: "1 1 420px", minWidth: 0 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Méthodes de vente</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  Part des heures de l’exercice. Une commande compte selon l’imputation de sa commande de base au Pilotage : PE, PI, intergroupe, ou BE
                  pour tout le reste (forfaits).
                </p>
                {vue.parMethode.map((m) => (
                  <div key={m.code} title={m.aide} style={{ display: "grid", gridTemplateColumns: "130px 1fr 90px 60px", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 14 }}>
                    <strong>{m.libelle}</strong>
                    <Barre part={m.part} couleur={m.couleur} largeur={260} />
                    <span style={{ textAlign: "right" }}>{heuresTxt(m.heures)}</span>
                    <strong style={{ textAlign: "right" }}>{pct(m.part)}</strong>
                  </div>
                ))}
                {vue.totalVendu > 0 && (
                  <p style={{ margin: "10px 0 0", fontSize: 13, color: "#3b4046" }}>
                    Sur le seul temps vendu (BE, PE, PI, intergroupe) : BE{" "}
                    <strong>{pct((vue.parMethode.find((m) => m.code === "BE")?.heures ?? 0) / vue.totalVendu)}</strong>, PE / PI / intergroupe{" "}
                    <strong>
                      {pct(vue.parMethode.filter((m) => ["PE", "PI", "IG"].includes(m.code)).reduce((t, m) => t + m.heures, 0) / vue.totalVendu)}
                    </strong>
                    .
                  </p>
                )}
              </section>

              <section style={{ ...page.carte, padding: 16, flex: "1 1 360px", minWidth: 0 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Le BE (forfaits), par activité</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>Elec, Méca, Calcul, Scan, Négoce… : de quoi est fait le temps passé sur les forfaits.</p>
                {vue.beParAct.length === 0 ? (
                  <p style={{ margin: 0, color: C.gris }}>Aucune heure sur forfait.</p>
                ) : (
                  vue.beParAct.map((a) => (
                    <div key={a.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr 80px 50px", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 14 }}>
                      <strong>{a.nom}</strong>
                      <Barre part={vue.totalBE ? a.heures / vue.totalBE : 0} couleur={C.rouge} largeur={200} />
                      <span style={{ textAlign: "right" }}>{heuresTxt(a.heures)}</span>
                      <strong style={{ textAlign: "right" }}>{pct(vue.totalBE ? a.heures / vue.totalBE : 0)}</strong>
                    </div>
                  ))
                )}
              </section>
            </div>

            {/* ---------- EFFECTIFS_V2 : temps vendu, mois par mois ---------- */}
            {parMois.length > 0 && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Temps vendu, mois par mois</h2>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                  Part des heures pointées chaque mois : <span style={{ color: C.rouge, fontWeight: 800 }}>vendu</span> (BE, PE, PI, intergroupe),{" "}
                  <span style={{ color: "#d98aa6", fontWeight: 800 }}>devis</span>, <span style={{ color: "#9aa0a6", fontWeight: 800 }}>hors affaire</span>. Le % au-dessus
                  de chaque mois est le taux de temps vendu.
                </p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 170 }}>
                  {parMois.map((m) => {
                    const t = m.total || 1;
                    return (
                      <div
                        key={m.mois}
                        title={`${libMois(m.mois)} : ${heuresTxt(m.total)} pointées · vendu ${pct(m.vendu / t)} · devis ${pct(m.devis / t)} · hors affaire ${pct(m.hors / t)}`}
                        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}
                      >
                        <strong style={{ fontSize: 12, marginBottom: 3 }}>{m.total > 0.5 ? pct(m.vendu / t) : "—"}</strong>
                        <div style={{ flex: 1, width: "70%", display: "flex", flexDirection: "column-reverse", background: "#eef0f3", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
                          <div style={{ height: `${(m.vendu / t) * 100}%`, background: C.rouge }} />
                          <div style={{ height: `${(m.devis / t) * 100}%`, background: "#d98aa6" }} />
                          <div style={{ height: `${(m.hors / t) * 100}%`, background: "#9aa0a6" }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.gris, marginTop: 3 }}>{libMois(m.mois)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ---------- par collaborateur (ADMIN seulement, EFFECTIFS_V2) ---------- */}
            {estAdmin && (
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par collaborateur</h2>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                <strong>Dans sa prédominance</strong> : part de ses heures d’affaires et de devis passées dans ses activités dominantes.
              </p>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={th}>Collaborateur</th>
                    <th style={th}>Prédominance</th>
                    <th style={thN}>Heures</th>
                    <th style={th}>Activités pointées (top 3)</th>
                    <th style={thN}>Dans sa prédominance</th>
                    <th style={th}>Méthodes</th>
                  </tr>
                </thead>
                <tbody>
                  {vue.parCollab.map(({ m, total, totalM, top, partPredo, meth }) => (
                    <tr key={m.id}>
                      <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>
                        {`${m.prenom ?? ""} ${m.nom ?? ""}`.trim()} <span style={{ color: C.gris, fontWeight: 400 }}>{m.trigramme}</span>
                      </td>
                      <td style={td}>
                        {m.predominances.length === 0 ? (
                          <span style={{ color: "#b35c00", fontSize: 13 }}>à renseigner</span>
                        ) : (
                          m.predominances.map((a) => (
                            <span key={a} style={{ display: "inline-block", margin: "1px 4px 1px 0", background: "#eef4fb", color: "#1f4e79", border: "1px solid #c9d9ec", borderRadius: 4, padding: "1px 6px", fontSize: 12, fontWeight: 700 }}>
                              {nomAct(a)}
                            </span>
                          ))
                        )}
                        {m.competences
                          .filter((a) => !m.predominances.includes(a))
                          .map((a) => (
                            <span key={`c-${a}`} title="Compétence d’appoint" style={{ display: "inline-block", margin: "1px 4px 1px 0", background: "#f3f4f6", color: "#5b6168", border: "1px dashed #b9bec5", borderRadius: 4, padding: "1px 6px", fontSize: 12, fontWeight: 700 }}>
                              + {nomAct(a)}
                            </span>
                          ))}
                      </td>
                      <td style={tdN}>{total > 0.5 ? heuresTxt(total) : "—"}</td>
                      <td style={{ ...td, fontSize: 13 }}>{totalM > 0.5 ? top.map(([a, h]) => `${nomAct(a)} ${pct(h / totalM)}`).join(" · ") : "—"}</td>
                      <td style={{ ...tdN, fontWeight: 800, color: partPredo !== null && partPredo < 0.5 ? "#b35c00" : undefined }}>{partPredo === null ? "—" : pct(partPredo)}</td>
                      <td style={{ ...td, fontSize: 13 }}>
                        {total > 0.5
                          ? METHODES.filter((x) => (meth.get(x.code) ?? 0) > 0.5)
                              .map((x) => `${x.code === "HORS_AFFAIRE" ? "Hors aff." : x.code === "DEVIS" ? "Devis" : x.code} ${pct((meth.get(x.code) ?? 0) / total)}`)
                              .join(" · ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            )}

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces chiffres ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Heures</strong> : feuilles d’heures de l’exercice, et historique importé pour les semaines sans feuille (sans double compte).
                </li>
                <li>
                  <strong>Activité</strong> d’une heure : celle choisie dans la feuille, sinon celle à laquelle son code est rattaché dans « Gestion des
                  activités ».
                </li>
                <li>
                  <strong>Méthode de vente</strong> : l’imputation de la commande de base au Pilotage (PE, PI, IG) ; toute autre commande compte en BE. Les
                  heures de devis (DBE) et le hors affaire (Divers) sont à part.
                </li>
                <li>
                  <strong>Prédominance</strong> (activité principale) et <strong>compétence d’appoint</strong> (ce que la personne sait aussi faire) :
                  renseignées dans la fiche de chaque collaborateur. Seule la prédominance compte dans la part de l’effectif.
                </li>
                <li>
                  <strong>Liste des activités</strong> : celle de « Gestion des activités ». Toute activité de « Gestion des activités » peut être
                  choisie, y compris une activité créée plus tard.
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function AnalyseEffectifsPage() {
  return (
    <GardeAcces droit="indicateurs">
      <EffectifsContenu />
    </GardeAcces>
  );
}
