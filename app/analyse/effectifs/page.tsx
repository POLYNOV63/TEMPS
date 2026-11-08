"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerMoi } from "@/lib/pilotageDonnees";

/* ===============================================================
   ANALYSE - CARTOGRAPHIE DE L'ÉQUIPE (EFFECTIFS_CARTO)
   ADMIN et Direction (droit « indicateurs »). Encadrement exclu.

   Qui compose le bureau d'études, sans heures ni production :
   - par activité : nombre de personnes en activité principale, part de
     l'effectif (une personne à deux activités principales compte pour
     moitié dans chacune), niveaux N1 / N2 / N3 (fiche collaborateur,
     SQL 86), relève (compétence d'appoint), points d'attention ;
   - niveaux de toute l'équipe, polyvalence ;
   - fiches à compléter (les noms ne sont montrés qu'à l'ADMIN).
   Aucun niveau individuel n'est affiché : seulement des nombres.
   Données : analyse_effectifs_collaborateurs() (SQL 67), activites,
   collaborateurs_niveaux.
================================================================ */

type Activite = { id: string; nom: string; actif: boolean; ordre_affichage: number };
type Membre = { id: string; prenom: string | null; nom: string | null; trigramme: string | null; inclus_statistiques: boolean; predominances: string[]; competences: string[] };

const NIVEAUX = [
  { n: 1, lib: "N1", aide: "exécute sous supervision", couleur: "#c8e6c9" },
  { n: 2, lib: "N2", aide: "autonome sur une affaire courante", couleur: "#66bb6a" },
  { n: 3, lib: "N3", aide: "expert ou référent", couleur: "#2e7d32" },
  { n: 0, lib: "?", aide: "niveau non renseigné", couleur: "#e3e7e3" },
];
const pct = (x: number) => `${Math.round(x * 100)} %`;

/* BARRE_LISIBLE : barre épaisse, le niveau et le nombre écrits dans chaque part */
function BarreNiveaux({ nb, largeur = 260 }: { nb: number[]; largeur?: number | string }) {
  const total = nb.reduce((t, x) => t + x, 0);
  return (
    <span style={{ display: "inline-flex", height: 26, width: largeur, borderRadius: 6, overflow: "hidden", background: "#eef0f3", verticalAlign: "middle" }}>
      {NIVEAUX.map((nv, k) => {
        if (nb[k] <= 0) return null;
        const part = nb[k] / Math.max(1, total);
        return (
          <span
            key={nv.n}
            title={`${nv.lib} (${nv.aide}) : ${nb[k]} personne${nb[k] > 1 ? "s" : ""}`}
            style={{
              width: `${part * 100}%`,
              background: nv.couleur,
              color: nv.n === 3 ? "#ffffff" : "#13361a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              borderRight: "2px solid #ffffff",
            }}
          >
            {part >= 0.16 ? `${nv.lib} · ${nb[k]}` : nb[k]}
          </span>
        );
      })}
    </span>
  );
}

function CartographieContenu() {
  const [activites, setActivites] = useState<Activite[]>([]);
  const [membres, setMembres] = useState<Membre[]>([]);
  const [niveaux, setNiveaux] = useState<Map<string, number>>(new Map());
  const [estAdmin, setEstAdmin] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;
    Promise.all([
      supabase.from("activites").select("id,nom,actif,ordre_affichage").order("ordre_affichage"),
      supabase.rpc("analyse_effectifs_collaborateurs"),
      supabase.from("collaborateurs_niveaux").select("collaborateur_id,niveau"),
      chargerMoi().catch(() => null),
    ])
      .then(([a, m, n, moi]) => {
        if (!actif) return;
        const e = a.error ?? m.error;
        if (e) throw new Error(e.message);
        setActivites((a.data ?? []) as Activite[]);
        setMembres(((m.data ?? []) as Membre[]).map((x) => ({ ...x, predominances: x.predominances ?? [], competences: x.competences ?? [] })));
        // sans la table des niveaux (SQL 86 pas encore passé) : tout le monde « non renseigné »
        setNiveaux(new Map(((n.data ?? []) as { collaborateur_id: string; niveau: number }[]).map((x) => [x.collaborateur_id, Number(x.niveau) || 0])));
        setEstAdmin(Boolean(moi?.estAdmin));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger la cartographie."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, []);

  const vue = useMemo(() => {
    // l'encadrement (exclu des statistiques, fiche collaborateur) n'entre pas dans la cartographie
    const equipe = membres.filter((m) => m.inclus_statistiques);
    const niveauDe = (m: Membre) => niveaux.get(m.id) ?? 0;
    const compte = (liste: Membre[]) => NIVEAUX.map((nv) => liste.filter((m) => niveauDe(m) === nv.n).length);
    const avecPredo = equipe.filter((m) => m.predominances.length > 0);

    const utilisees = new Set(equipe.flatMap((m) => [...m.predominances, ...m.competences]));
    const parActivite = activites
      .filter((a) => a.actif || utilisees.has(a.id))
      .map((a) => {
        const titulaires = equipe.filter((m) => m.predominances.includes(a.id));
        const releve = equipe.filter((m) => !m.predominances.includes(a.id) && m.competences.includes(a.id));
        const part = avecPredo.length ? titulaires.reduce((t, m) => t + 1 / m.predominances.length, 0) / avecPredo.length : 0;
        const nb = compte(titulaires);
        const [n1, , n3, inconnus] = nb;
        const attention: string[] = [];
        if (titulaires.length > 0 && titulaires.length <= 2) attention.push(`repose sur ${titulaires.length} personne${titulaires.length > 1 ? "s" : ""}`);
        if (inconnus > 0) attention.push(`${inconnus} niveau${inconnus > 1 ? "x" : ""} à renseigner`);
        else if (titulaires.length > 0) {
          if (n3 === 0) attention.push("aucun référent (N3)");
          else if (n3 === 1 && titulaires.length > 1) attention.push("un seul référent (N3)");
          if (n3 > 0 && n1 > 2 * n3) attention.push("peu de référents pour encadrer les N1");
        }
        if (titulaires.length > 0 && releve.length === 0) attention.push("pas de relève en appoint");
        return { a, titulaires: titulaires.length, releve: releve.length, part, nb, attention };
      })
      .filter((x) => x.titulaires > 0 || x.releve > 0);

    // polyvalence : nombre d'activités maîtrisées (principales et appoint)
    const polyvalence = [1, 2, 3].map((k) =>
      equipe.filter((m) => {
        const n = new Set([...m.predominances, ...m.competences]).size;
        return k === 3 ? n >= 3 : n === k;
      }).length
    );

    return {
      equipe,
      niveauxEquipe: compte(equipe),
      parActivite,
      polyvalence,
      sansPredo: equipe.filter((m) => m.predominances.length === 0),
      sansNiveau: equipe.filter((m) => niveauDe(m) === 0),
    };
  }, [membres, activites, niveaux]);

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px", textAlign: "center" };
  const td: CSSProperties = { ...page.td, padding: "8px", fontSize: 14 };
  const nomPersonne = (m: Membre) => m.trigramme || `${m.prenom ?? ""} ${m.nom ?? ""}`.trim();
  const fragiles = vue.parActivite.filter((x) => x.attention.some((t) => t.startsWith("repose") || t.startsWith("aucun") || t.startsWith("un seul")));

  return (
    <main style={page.fond}>
      <EnTetePage section="Analyse" />
      {/* NAVIGATION_AXES */}<OngletsPilotage actif="effectifs" />
      <div style={{ ...page.contenu, maxWidth: 1200 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Cartographie de l’équipe</h1>
            <p style={page.sousTitre}>Qui compose le bureau d’études : activités, niveaux, relève et polyvalence. Des nombres, aucun classement de personnes.</p>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && !erreur && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="Effectif" valeur={String(vue.equipe.length)} sous="personnes actives, hors encadrement" />
              {/* BARRE_LISIBLE : la tuile des niveaux montre la barre */}
              <div style={{ ...page.carte, padding: "12px 16px", flex: "1 1 240px", minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>Niveaux de l’équipe</div>
                <div style={{ marginTop: 10 }}>
                  <BarreNiveaux nb={vue.niveauxEquipe} largeur="100%" />
                </div>
                <div style={{ fontSize: 12, color: C.gris, marginTop: 6 }}>
                  {vue.niveauxEquipe[2]} référent{vue.niveauxEquipe[2] > 1 ? "s" : ""} (N3) sur {vue.equipe.length}
                  {vue.niveauxEquipe[3] > 0 ? ` · ${vue.niveauxEquipe[3]} à renseigner` : ""}
                </div>
              </div>
              <Tuile libelle="Polyvalents" valeur={String(vue.polyvalence[1] + vue.polyvalence[2])} sous="personnes qui maîtrisent au moins 2 activités" />
              <Tuile
                libelle="Activités fragiles"
                valeur={String(fragiles.length)}
                sous={fragiles.length > 0 ? fragiles.map((x) => x.a.nom).join(", ") : "aucune ne repose sur trop peu de monde"}
                accent={fragiles.length > 0}
              />
            </div>

            {(vue.sansPredo.length > 0 || vue.sansNiveau.length > 0) && (
              <Message genre="info">
                Fiches à compléter :{" "}
                {vue.sansPredo.length > 0 && (
                  <strong>
                    {vue.sansPredo.length} sans activité principale{estAdmin ? ` (${vue.sansPredo.map(nomPersonne).join(", ")})` : ""}
                  </strong>
                )}
                {vue.sansPredo.length > 0 && vue.sansNiveau.length > 0 && " · "}
                {vue.sansNiveau.length > 0 && (
                  <strong>
                    {vue.sansNiveau.length} sans niveau{estAdmin ? ` (${vue.sansNiveau.map(nomPersonne).join(", ")})` : ""}
                  </strong>
                )}
                {estAdmin && (
                  <>
                    {" "}
                    — à renseigner dans{" "}
                    <Link href="/admin/collaborateurs" style={{ fontWeight: 800, color: C.rougeFonce }}>
                      Collaborateurs
                    </Link>
                    .
                  </>
                )}
              </Message>
            )}

            {/* ---------- par activité ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par activité</h2>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
                <strong>En principale</strong> : les personnes dont c’est l’activité principale. <strong>Part de l’effectif</strong> : une personne à deux activités
                principales compte pour moitié dans chacune. <strong>Relève</strong> : celles qui ont la compétence en appoint et peuvent prendre le relais.
              </p>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Activité</th>
                    <th style={th}>En principale</th>
                    <th style={th}>Part de l’effectif</th>
                    <th style={th}>Niveaux</th>
                    <th style={th}>Relève</th>
                    <th style={{ ...th, textAlign: "left" }}>Points d’attention</th>
                  </tr>
                </thead>
                <tbody>
                  {vue.parActivite.map((x) => (
                    <tr key={x.a.id}>
                      <td style={{ ...td, fontWeight: 800 }}>{x.a.nom}</td>
                      <td style={{ ...td, textAlign: "center", fontWeight: 800, fontSize: 16 }}>{x.titulaires || "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {x.titulaires > 0 ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "inline-block", width: 120, height: 10, background: "#eef0f3", borderRadius: 5, overflow: "hidden" }}>
                              <span style={{ display: "block", width: `${Math.min(100, x.part * 100)}%`, height: "100%", background: "#1f4e79" }} />
                            </span>
                            <strong style={{ minWidth: 40, textAlign: "right" }}>{pct(x.part)}</strong>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {x.titulaires > 0 ? (
                          <>
                            <BarreNiveaux nb={x.nb} />
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>{x.releve || "—"}</td>
                      <td style={td}>
                        {x.titulaires === 0 ? (
                          <span style={{ color: C.gris, fontSize: 13 }}>en appoint seulement</span>
                        ) : x.attention.length === 0 ? (
                          <span style={{ color: "#1b5e20", fontWeight: 700, fontSize: 13 }}>✓ rien à signaler</span>
                        ) : (
                          x.attention.map((t) => (
                            <span key={t} style={{ display: "inline-block", margin: "1px 4px 1px 0", background: "#fff1df", color: "#7a3e00", borderRadius: 999, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>
                              {t}
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

            {/* ---------- équipe : niveaux et polyvalence ---------- */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <section style={{ ...page.carte, padding: 16, flex: "1 1 380px", minWidth: 0 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Niveaux de l’équipe</h2>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: C.gris }}>Tout le bureau d’études hors encadrement, toutes activités confondues.</p>
                <BarreNiveaux nb={vue.niveauxEquipe} largeur="100%" />
                <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                  {NIVEAUX.map((nv, k) =>
                    nv.n === 0 && vue.niveauxEquipe[k] === 0 ? null : (
                      <div key={nv.n} style={{ display: "grid", gridTemplateColumns: "16px 1fr 50px 50px", alignItems: "center", gap: 8, fontSize: 14 }}>
                        <i style={{ display: "inline-block", width: 14, height: 14, background: nv.couleur, borderRadius: 3, border: "1px solid #c9d1c9" }} />
                        <span>
                          <strong>{nv.n === 0 ? "Non renseigné" : `Niveau ${nv.n}`}</strong> <span style={{ color: C.gris }}>· {nv.aide}</span>
                        </span>
                        <strong style={{ textAlign: "right" }}>{vue.niveauxEquipe[k]}</strong>
                        <span style={{ textAlign: "right", color: C.gris }}>{vue.equipe.length ? pct(vue.niveauxEquipe[k] / vue.equipe.length) : "—"}</span>
                      </div>
                    )
                  )}
                </div>
              </section>

              <section style={{ ...page.carte, padding: 16, flex: "1 1 380px", minWidth: 0 }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Polyvalence</h2>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: C.gris }}>Nombre d’activités maîtrisées par chacun, en principale ou en appoint.</p>
                {(["1 activité", "2 activités", "3 activités ou plus"] as const).map((lib, k) => {
                  const n = vue.polyvalence[k];
                  return (
                    <div key={lib} style={{ display: "grid", gridTemplateColumns: "150px 1fr 40px 50px", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 14 }}>
                      <strong>{lib}</strong>
                      <span style={{ display: "inline-block", height: 10, background: "#eef0f3", borderRadius: 5, overflow: "hidden" }}>
                        <span style={{ display: "block", width: `${vue.equipe.length ? (n / vue.equipe.length) * 100 : 0}%`, height: "100%", background: ["#9fb6cf", "#5b7fa6", "#1f4e79"][k] }} />
                      </span>
                      <strong style={{ textAlign: "right" }}>{n}</strong>
                      <span style={{ textAlign: "right", color: C.gris }}>{vue.equipe.length ? pct(n / vue.equipe.length) : "—"}</span>
                    </div>
                  );
                })}
              </section>
            </div>

            <details style={{ fontSize: 13, color: "#3b4046" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>D’où viennent ces informations ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li>
                  <strong>Activité principale</strong> et <strong>compétences d’appoint</strong> : la fiche de chaque collaborateur (Paramétrage › Collaborateurs).
                </li>
                <li>
                  <strong>Niveau</strong> : la fiche collaborateur (N1 exécute sous supervision, N2 autonome sur une affaire courante, N3 expert ou référent). Il
                  n’est jamais affiché par personne, seulement compté.
                </li>
                <li>
                  <strong>Points d’attention</strong> : activité qui repose sur 1 ou 2 personnes, sans référent ou avec un seul, plus de deux N1 par N3, ou sans
                  relève en appoint.
                </li>
                <li>
                  <strong>Liste des activités</strong> : « Gestion des activités » ; une activité créée plus tard apparaît d’elle-même.
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
      <CartographieContenu />
    </GardeAcces>
  );
}
