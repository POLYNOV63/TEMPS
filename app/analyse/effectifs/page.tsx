"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerMoi, chargerTout } from "@/lib/pilotageDonnees";

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
  const [voirNoms, setVoirNoms] = useState(false); // NOMS_PAR_NIVEAU : ADMIN seulement
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  /* EQUIPE_PEPI : qui est en PE, en PI (heures saisies au relevé ce mois-ci), le reste au bureau d'études */
  const [prestataires, setPrestataires] = useState<Map<string, "PE" | "PI">>(new Map());
  useEffect(() => {
    let actif = true;
    const d = new Date();
    const debut = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const fin = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10);
    void (async () => {
      try {
        const [lp, pa, sa] = await Promise.all([
          supabase.from("prestation_lignes").select("id,collaborateur_id,affaire_id"),
          supabase.from("pilotage_affaires").select("id,imputation"),
          chargerTout<{ ligne_id: string; heures: number | string | null }>((a, b) =>
            supabase.from("prestation_saisies").select("ligne_id,heures").gte("jour", debut).lte("jour", fin).gt("heures", 0).order("ligne_id").range(a, b)
          ),
        ]);
        if (!actif || lp.error || pa.error) return;
        const imputation = new Map(((pa.data ?? []) as { id: string; imputation: string | null }[]).map((a) => [a.id, a.imputation]));
        const lignes = new Map(((lp.data ?? []) as { id: string; collaborateur_id: string; affaire_id: string }[]).map((l) => [l.id, l]));
        const heures = new Map<string, { PE: number; PI: number }>();
        for (const s of sa) {
          const l = lignes.get(s.ligne_id);
          if (!l) continue;
          const i = imputation.get(l.affaire_id);
          if (i !== "PE" && i !== "PI") continue;
          const v = heures.get(l.collaborateur_id) ?? { PE: 0, PI: 0 };
          v[i] += Number(s.heures) || 0;
          heures.set(l.collaborateur_id, v);
        }
        setPrestataires(new Map([...heures].map(([id, v]) => [id, v.PE >= v.PI ? "PE" : "PI"] as [string, "PE" | "PI"])));
      } catch {
        /* relevé illisible : tout le monde au bureau d'études */
      }
    })();
    return () => {
      actif = false;
    };
  }, []);

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
              {/* NIVEAUX_EN_LIGNE : la carte des niveaux, dans la ligne des vignettes */}
              <div
                {...(estAdmin
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-expanded": voirNoms,
                      title: voirNoms ? "Masquer les personnes" : "Voir qui est à quel niveau",
                      onClick: () => setVoirNoms((v) => !v),
                      onKeyDown: (e: { key: string }) => (e.key === "Enter" || e.key === " ") && setVoirNoms((v) => !v),
                    }
                  : {})}
                style={{ ...page.carte, padding: "12px 16px", flex: "2 1 380px", minWidth: 300, cursor: estAdmin ? "pointer" : "default", outline: voirNoms ? `2px solid ${C.rouge}` : undefined }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: C.gris }}>
                  Niveaux de l’équipe
                  {estAdmin && <span style={{ textTransform: "none", fontWeight: 700, color: C.rougeFonce, marginLeft: 8 }}>{voirNoms ? "▾ masquer les noms" : "▸ voir les noms"}</span>}
                </div>
                <div style={{ marginTop: 8 }}>
                  <BarreNiveaux nb={vue.niveauxEquipe} largeur="100%" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "12px 1fr auto auto", alignItems: "center", gap: "3px 8px", marginTop: 8, fontSize: 12.5 }}>
                  {NIVEAUX.map((nv, k) =>
                    nv.n === 0 && vue.niveauxEquipe[k] === 0 ? null : (
                      <Fragment key={nv.n}>
                        <i style={{ display: "inline-block", width: 12, height: 12, background: nv.couleur, borderRadius: 3, border: "1px solid #c9d1c9" }} />
                        <span>
                          <strong>{nv.n === 0 ? "Non renseigné" : `N${nv.n}`}</strong> <span style={{ color: C.gris }}>· {nv.aide}</span>
                        </span>
                        <strong style={{ textAlign: "right" }}>{vue.niveauxEquipe[k]}</strong>
                        <span style={{ textAlign: "right", color: C.gris, minWidth: 34 }}>{vue.equipe.length ? pct(vue.niveauxEquipe[k] / vue.equipe.length) : "—"}</span>
                      </Fragment>
                    )
                  )}
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

            {/* EQUIPE_PEPI : prestations (PE, PI) et bureau d'études, par niveau */}
            {(() => {
              const niveauDe = (id: string) => niveaux.get(id) ?? 0;
              const groupes = [
                { cle: "PE", lib: "En prestation externe (PE)", gens: vue.equipe.filter((m) => prestataires.get(m.id) === "PE") },
                { cle: "PI", lib: "En prestation interne (PI)", gens: vue.equipe.filter((m) => prestataires.get(m.id) === "PI") },
                { cle: "BE", lib: "Au bureau d’études (le reste)", gens: vue.equipe.filter((m) => !prestataires.has(m.id)) },
              ];
              const plus = Math.max(1, ...groupes.map((g) => g.gens.length));
              const moisNom = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
              return (
                <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Prestations et bureau d’études</h2>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: C.gris }}>
                    Qui travaille en PE, en PI et au bureau d’études, et à quel niveau. En PE / PI : les personnes qui ont des heures au relevé PE / PI en {moisNom} (quelqu’un sur les deux
                    est rangé là où il a le plus d’heures). La longueur de chaque barre suit le nombre de personnes.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(170px, 240px) minmax(0, 1fr) 90px", gap: "12px 14px", alignItems: "center" }}>
                    {groupes.map((g) => (
                      <Fragment key={g.cle}>
                        <span style={{ fontWeight: 800, fontSize: 14 }}>{g.lib}</span>
                        <span
                          title={estAdmin && g.gens.length > 0 ? g.gens.map((m) => nomPersonne(m)).sort((a, b) => a.localeCompare(b, "fr")).join(", ") : undefined}
                          style={{ display: "block", width: `${Math.max(10, (g.gens.length / plus) * 100)}%` }}
                        >
                          {g.gens.length > 0 ? (
                            <BarreNiveaux nb={NIVEAUX.map((nv) => g.gens.filter((m) => niveauDe(m.id) === nv.n).length)} largeur="100%" />
                          ) : (
                            <span style={{ fontSize: 13, color: C.gris }}>personne</span>
                          )}
                        </span>
                        <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <strong style={{ fontSize: 20 }}>{g.gens.length}</strong>{" "}
                          <span style={{ fontSize: 12, color: C.gris }}>{vue.equipe.length ? pct(g.gens.length / vue.equipe.length) : ""}</span>
                        </span>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.gris, marginTop: 12 }}>
                    {NIVEAUX.map((nv) => (
                      <span key={nv.n} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <i style={{ display: "inline-block", width: 12, height: 12, background: nv.couleur, borderRadius: 3, border: "1px solid #c9d1c9" }} />
                        {nv.n === 0 ? "niveau non renseigné" : `N${nv.n} · ${nv.aide}`}
                      </span>
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* NOMS_PAR_NIVEAU : qui est à quel niveau (ADMIN seulement) */}
            {estAdmin && voirNoms && (
              <section style={{ ...page.carte, padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <strong>Qui est à quel niveau</strong>
                  <span style={{ fontSize: 12, color: C.gris }}>visible de l’administration seulement · à modifier dans la fiche collaborateur</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => setVoirNoms(false)} aria-label="Fermer" style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer" }}>
                    ×
                  </button>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {[2, 1, 0, 3].map((k) => {
                    const nv = NIVEAUX[k];
                    const gens = vue.equipe.filter((m) => (niveaux.get(m.id) ?? 0) === nv.n).sort((a, b) => nomPersonne(a).localeCompare(nomPersonne(b), "fr"));
                    if (nv.n === 0 && gens.length === 0) return null;
                    return (
                      <div key={nv.n} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span style={{ minWidth: 150, fontSize: 13 }}>
                          <i style={{ display: "inline-block", width: 12, height: 12, background: nv.couleur, borderRadius: 3, border: "1px solid #c9d1c9", marginRight: 6, verticalAlign: "middle" }} />
                          <strong>{nv.n === 0 ? "Non renseigné" : `Niveau ${nv.n}`}</strong> ({gens.length})
                        </span>
                        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {gens.length === 0 ? (
                            <span style={{ color: C.gris, fontSize: 13 }}>personne</span>
                          ) : (
                            gens.map((m) => (
                              <span
                                key={m.id}
                                title={`${m.prenom ?? ""} ${m.nom ?? ""}`.trim()}
                                style={{ background: nv.couleur, color: nv.n === 3 ? "#ffffff" : "#13361a", borderRadius: 999, padding: "2px 10px", fontSize: 13, fontWeight: 800 }}
                              >
                                {nomPersonne(m)}
                              </span>
                            ))
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

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
