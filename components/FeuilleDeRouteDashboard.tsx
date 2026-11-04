"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   MA FEUILLE DE ROUTE, SUR LE TABLEAU DE BORD

   La feuille de route de la personne connectée, dépliée, sur 2 semaines
   (cette semaine et la suivante) : devis à rédiger, affaires prévues jour
   par jour, congés. Même source que la page « Ma feuille de route »
   (fonctions ma_feuille_de_route et ma_feuille_de_route_devis), qui reste
   là pour voir plus loin.
================================================================ */

type LigneRoute = {
  jour: string;
  affaire_id: string | null;
  type: string | null;
  numero: string | null;
  designation: string | null;
  echeance: string | null;
  activite_id: string | null;
  libelle: string | null;
  heures: number | string;
};
type Devis = { affaire_id: string; numero: string; designation: string | null; echeance: string | null };
type Conge = { type_demande: string; date_debut: string; date_fin: string; statut: string };

const NB_SEMAINES = 2;
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const LIB_CONGE: Record<string, string> = { CP: "CP", RTT: "RTT", RE: "Récup.", CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF: "CP exc.", CP_EXCEPTIONNEL_SANS_JUSTIFICATIF: "CP exc." };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (s: string, n: number) => {
  const [a, m, j] = s.split("-").map(Number);
  return iso(new Date(a, m - 1, j + n));
};
const lundiDe = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + (x.getDay() === 0 ? -6 : 1 - x.getDay()));
  return iso(x);
};
const numeroSemaine = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  const j = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - j);
  const debut = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - debut.getTime()) / 86400000 + 1) / 7);
};
const dateCourte = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const h = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")} h`;
function lienAffaire(type: string, numero: string): string {
  const base = (numero.match(/^\d+/)?.[0] ?? numero).replace(/^0+/, "");
  return `/affaires/bilan?affaire=${type}${base}&commande=${encodeURIComponent(numero)}`;
}

export default function FeuilleDeRouteDashboard() {
  const [moiId, setMoiId] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneRoute[]>([]);
  const [conges, setConges] = useState<Conge[]>([]);
  const [devis, setDevis] = useState<Devis[]>([]);
  const [activites, setActivites] = useState<Map<string, string>>(new Map());
  // RESPONSABLE_AFFAIRE : le responsable de chaque affaire de la feuille de route
  const [responsables, setResponsables] = useState<Map<string, { tri: string; nom: string }>>(new Map());
  // INTENTION_JAUNE : affaires en intention de commande
  const [intentions, setIntentions] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = [...new Set(lignes.map((l) => l.affaire_id).filter((x): x is string => Boolean(x)))];
    if (ids.length === 0) return;
    let actif = true;
    void (async () => {
      const { data: af } = await supabase.from("pilotage_affaires").select("id,responsable_id,statut").in("id", ids);
      const liste = (af ?? []) as { id: string; responsable_id: string | null; statut: string | null }[];
      const resp = [...new Set(liste.map((a) => a.responsable_id).filter((x): x is string => Boolean(x)))];
      const { data: co } = resp.length > 0 ? await supabase.from("collaborateurs").select("id,trigramme,prenom,nom").in("id", resp) : { data: [] };
      if (!actif) return;
      const personnes = new Map(
        ((co ?? []) as { id: string; trigramme: string | null; prenom: string | null; nom: string | null }[]).map((c) => [
          c.id,
          { tri: c.trigramme ?? "", nom: `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() },
        ])
      );
      const m = new Map<string, { tri: string; nom: string }>();
      for (const a of liste) {
        const p = a.responsable_id ? personnes.get(a.responsable_id) : undefined;
        if (p) m.set(a.id, p);
      }
      setResponsables(m);
      setIntentions(new Set(liste.filter((a) => a.statut === "EN_ATTENTE").map((a) => a.id)));
    })();
    return () => {
      actif = false;
    };
  }, [lignes]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const lundi = useMemo(() => lundiDe(new Date()), []);
  const fin = plus(lundi, NB_SEMAINES * 7 - 1);
  const aujourdhui = iso(new Date());

  useEffect(() => {
    let actif = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: c } = await supabase.from("collaborateurs").select("id").eq("auth_user_id", user.id).maybeSingle();
      if (!c || !actif) return;
      const id = (c as { id: string }).id;
      setMoiId(id);
      const [r, cg, d, act] = await Promise.all([
        supabase.rpc("ma_feuille_de_route", { p_collaborateur_id: id, p_debut: lundi, p_fin: fin }),
        supabase
          .from("rh_demandes")
          .select("type_demande,date_debut,date_fin,statut")
          .eq("collaborateur_id", id)
          .in("statut", ["VALIDEE", "ENVOYEE_RH", "EN_ATTENTE"])
          .lte("date_debut", fin)
          .gte("date_fin", lundi),
        supabase.rpc("ma_feuille_de_route_devis", { p_collaborateur_id: id }),
        supabase.from("activites").select("id,nom"),
      ]);
      if (!actif) return;
      if (r.error) throw new Error(r.error.message);
      setLignes((r.data ?? []) as LigneRoute[]);
      setConges((cg.data ?? []) as Conge[]);
      setDevis(d.error ? [] : ((d.data ?? []) as Devis[]));
      setActivites(new Map(((act.data ?? []) as { id: string; nom: string }[]).map((a) => [a.id, a.nom])));
    })()
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Feuille de route indisponible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [lundi, fin]);

  const semaines = useMemo(
    () =>
      Array.from({ length: NB_SEMAINES }, (_, k) => {
        const debut = plus(lundi, k * 7);
        const jours = JOURS.map((_, i) => plus(debut, i));
        const parAffaire = new Map<string, { cle: string; titre: string; designation: string; activite: string; echeance: string | null; affaireId: string | null; parJour: number[]; total: number }>();
        for (const l of lignes) {
          const i = jours.indexOf(l.jour);
          if (i < 0) continue;
          const titre = l.affaire_id ? `${l.type ?? ""} ${l.numero ?? ""}`.trim() : l.libelle ?? "Hors affaire";
          const activite = l.activite_id ? activites.get(l.activite_id) ?? "" : "";
          const cle = `${titre}|${activite}`;
          const e = parAffaire.get(cle) ?? { cle, titre, designation: l.affaire_id ? l.designation ?? "" : "", activite, echeance: l.echeance, affaireId: l.affaire_id, parJour: [0, 0, 0, 0, 0], total: 0 };
          const v = Number(l.heures) || 0;
          e.parJour[i] += v;
          e.total += v;
          parAffaire.set(cle, e);
        }
        const congesJour = jours.map((j) => conges.find((c) => c.date_debut <= j && c.date_fin >= j));
        const lignesSemaine = [...parAffaire.values()].sort((a, b) => b.total - a.total);
        const totalJour = jours.map((_, i) => lignesSemaine.reduce((t, l) => t + l.parJour[i], 0));
        const aRendre = devis.filter((d) => d.echeance && ((d.echeance >= debut && d.echeance <= plus(debut, 6)) || (k === 0 && d.echeance < debut)));
        return { debut, jours, lignes: lignesSemaine, congesJour, totalJour, total: totalJour.reduce((t, x) => t + x, 0), aRendre };
      }),
    [lignes, conges, activites, lundi, devis]
  );

  const th: CSSProperties = { ...page.th, padding: "6px 6px", whiteSpace: "nowrap", fontSize: 12 };
  const td: CSSProperties = { ...page.td, padding: "6px 6px", fontSize: 13 };
  const tdJour: CSSProperties = { ...td, textAlign: "center", whiteSpace: "nowrap", width: 58 };

  return (
    <section aria-label="Ma feuille de route" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#222222" }}>🗺️ Ma feuille de route</h2>
        <span style={{ color: "#777777", fontSize: 13 }}>cette semaine et la suivante, d’après le planning</span>
        <Link href="/ma-feuille-de-route" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14, color: C.rougeFonce }}>
          Voir plus loin →
        </Link>
      </div>

      {erreur && <Message genre="erreur">{erreur}</Message>}
      {chargement && !erreur && <p style={{ color: C.gris, margin: "4px 0" }}>Chargement de la feuille de route…</p>}

      {!chargement && !erreur && moiId && (
        <>
          {devis.length > 0 && (
            <div style={{ ...page.carte, padding: "10px 14px", marginBottom: 10, borderLeft: "5px solid #dc4f84" }}>
              <strong>📝 Devis à rédiger</strong>
              <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                {devis.map((d) => {
                  const jours = d.echeance ? Math.round((new Date(`${d.echeance}T00:00:00`).getTime() - new Date(`${aujourdhui}T00:00:00`).getTime()) / 86400000) : null;
                  return (
                    <div key={d.affaire_id} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline", fontSize: 14 }}>
                      <Link href={lienAffaire("DBE", d.numero)} style={{ fontWeight: 800, color: "#a3245a" }}>
                        DBE {d.numero}
                      </Link>
                      <span>{d.designation}</span>
                      <span style={{ marginLeft: "auto", fontWeight: 800, color: jours === null ? C.gris : jours < 0 ? "#b3261e" : jours <= 3 ? "#c76500" : "#1b5e20" }}>
                        {d.echeance ? `à rendre le ${dateCourte(d.echeance)}${jours !== null ? (jours < 0 ? ` · en retard de ${-jours} j` : jours === 0 ? " · aujourd’hui" : ` · dans ${jours} j`) : ""}` : "sans date de rendu"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {semaines.map((s, k) => (
            <div key={s.debut} style={{ ...page.carte, padding: "10px 14px", marginBottom: 10, borderLeft: `5px solid ${k === 0 ? C.rouge : "#d5d9de"}` }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                <strong style={{ fontSize: 17, color: k === 0 ? C.rouge : undefined }}>S{numeroSemaine(s.debut)}</strong>
                <span style={{ color: C.gris, fontSize: 13 }}>
                  du {dateCourte(s.debut)} au {dateCourte(plus(s.debut, 4))} · {k === 0 ? "cette semaine" : "la semaine prochaine"}
                </span>
                <span style={{ flex: 1 }} />
                <strong style={{ fontSize: 14 }}>{s.total > 0 ? `${h(s.total)} prévues` : ""}</strong>
              </div>
              {s.lignes.length === 0 && s.congesJour.every((c) => !c) && s.aRendre.length === 0 ? (
                <p style={{ margin: 0, color: C.gris, fontSize: 14 }}>Rien de prévu au planning pour l’instant.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={th}>Affaire</th>
                        {s.jours.map((j, i) => (
                          <th key={j} style={{ ...th, textAlign: "center", color: j === aujourdhui ? C.rougeFonce : undefined }}>
                            {JOURS[i]} <span style={{ fontWeight: 400, color: C.gris }}>{dateCourte(j)}</span>
                          </th>
                        ))}
                        <th style={{ ...th, textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lignes.map((l) => (
                        <tr key={l.cle}>
                          <td style={td}>
                            {(() => {
                              const m = l.affaireId ? l.titre.match(/^(CBE|DBE)\s*(\S+)$/i) : null;
                              return m ? (
                                <Link href={lienAffaire(m[1].toUpperCase(), m[2])} title={l.affaireId && intentions.has(l.affaireId) ? "Intention de commande : pas encore commandée" : undefined} style={{ fontWeight: 800, color: C.rougeFonce, ...(l.affaireId && intentions.has(l.affaireId) ? { background: "#ffe58a", borderRadius: 3, padding: "0 3px" } : {}) /* INTENTION_SURLIGNEE */ }}>
                                  {l.titre}
                                </Link>
                              ) : (
                                <strong style={{ color: C.rougeFonce }}>{l.titre}</strong>
                              );
                            })()}
                            {l.affaireId && responsables.get(l.affaireId) && (
                              <span
                                title={`Responsable d’affaire : ${responsables.get(l.affaireId)?.nom || responsables.get(l.affaireId)?.tri}`}
                                style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#34506b", background: "#eaf1fa", border: "1px solid #9fb6cf", borderRadius: 999, padding: "0 6px", whiteSpace: "nowrap" }}
                              >
                                👤 {responsables.get(l.affaireId)?.tri || responsables.get(l.affaireId)?.nom}
                              </span>
                            )}
                            {l.activite && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: C.gris }}>{l.activite}</span>}
                            {l.designation && <div style={{ fontSize: 12 }}>{l.designation}</div>}
                            {l.echeance && <div style={{ fontSize: 11, color: l.echeance < s.debut ? "#b3261e" : C.gris }}>délai : {dateCourte(l.echeance)}/{l.echeance.slice(2, 4)}</div>}
                          </td>
                          {l.parJour.map((v, i) => (
                            <td key={i} style={{ ...tdJour, background: v > 0 ? "#fdecec" : undefined, fontWeight: v > 0 ? 700 : 400 }}>
                              {v > 0 ? h(v) : ""}
                            </td>
                          ))}
                          <td style={{ ...td, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{h(l.total)}</td>
                        </tr>
                      ))}
                      {s.aRendre.map((d) => (
                        <tr key={`devis-${d.affaire_id}`}>
                          <td style={td}>
                            <Link href={lienAffaire("DBE", d.numero)} style={{ fontWeight: 800, color: "#a3245a" }}>
                              📝 DBE {d.numero}
                            </Link>
                            <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: C.gris }}>devis à rendre</span>
                          </td>
                          {s.jours.map((j) => (
                            <td key={j} style={{ ...tdJour, background: d.echeance === j ? "#fbe3ee" : undefined, color: "#a3245a", fontWeight: 800 }}>
                              {d.echeance === j ? "📌 rendu" : ""}
                            </td>
                          ))}
                          <td style={{ ...td, textAlign: "right", fontSize: 11, color: "#b3261e", whiteSpace: "nowrap" }}>
                            {d.echeance && d.echeance < s.debut ? `en retard (${dateCourte(d.echeance)})` : ""}
                          </td>
                        </tr>
                      ))}
                      {s.congesJour.some(Boolean) && (
                        <tr>
                          <td style={{ ...td, color: "#18713b", fontWeight: 700 }}>🏖 Congés</td>
                          {s.congesJour.map((c, i) => (
                            <td key={i} style={{ ...tdJour, background: c ? "#e8f6ea" : undefined, color: "#18713b", fontWeight: 700 }}>
                              {c ? `${LIB_CONGE[c.type_demande] ?? c.type_demande}${c.statut === "EN_ATTENTE" ? " ?" : ""}` : ""}
                            </td>
                          ))}
                          <td style={td} />
                        </tr>
                      )}
                      {s.lignes.length > 1 && (
                        <tr>
                          <td style={{ ...td, fontWeight: 800, textAlign: "right" }}>Total du jour</td>
                          {s.totalJour.map((v, i) => (
                            <td key={i} style={{ ...tdJour, fontWeight: 800 }}>
                              {v > 0 ? h(v) : ""}
                            </td>
                          ))}
                          <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>{h(s.total)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
