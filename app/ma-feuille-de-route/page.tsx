"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";

/* ===============================================================
   MA FEUILLE DE ROUTE

   Ce qui est prévu pour moi au planning, semaine par semaine : une ligne
   par affaire (numéro, désignation, activité), une colonne par jour, avec
   les heures prévues et le délai de l'affaire. Mes congés apparaissent
   aussi. Par défaut, la semaine en cours et les 3 suivantes ; on peut
   voir plus loin.
   L'administration et les responsables peuvent consulter la feuille de
   route d'un collègue.
================================================================ */

type LigneRoute = {
  jour: string;
  affaire_id: string | null;
  type: string | null;
  numero: string | null;
  designation: string | null;
  imputation: string | null;
  echeance: string | null;
  activite_id: string | null;
  libelle: string | null;
  heures: number | string;
};

type Conge = { type_demande: string; date_debut: string; date_fin: string; statut: string; duree_jours: number | null };

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

function FeuilleDeRouteContenu() {
  const [moi, setMoi] = useState<{ id: string; role: string | null; prenom: string | null } | null>(null);
  const [cible, setCible] = useState<string>("");
  const [equipe, setEquipe] = useState<{ id: string; trigramme: string | null; prenom: string | null; nom: string | null }[]>([]);
  const [nbSemaines, setNbSemaines] = useState(4);
  const [lignes, setLignes] = useState<LigneRoute[]>([]);
  const [conges, setConges] = useState<Conge[]>([]);
  const [activites, setActivites] = useState<Map<string, string>>(new Map());
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const lundi = useMemo(() => lundiDe(new Date()), []);
  const fin = plus(lundi, nbSemaines * 7 - 1);
  const consultant = moi ? peut(moi.role, "piloterBE") : false;

  // qui suis-je, et la liste de l'équipe pour l'administration et les responsables
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("collaborateurs").select("id,role,prenom").eq("auth_user_id", user.id).maybeSingle();
      if (!data) return;
      setMoi(data as { id: string; role: string | null; prenom: string | null });
      setCible((data as { id: string }).id);
      if (peut((data as { role: string | null }).role, "piloterBE")) {
        const { data: eq } = await supabase.from("collaborateurs").select("id,trigramme,prenom,nom,actif").eq("actif", true).order("trigramme");
        setEquipe((eq ?? []) as { id: string; trigramme: string | null; prenom: string | null; nom: string | null }[]);
      }
      const { data: act } = await supabase.from("activites").select("id,nom");
      setActivites(new Map(((act ?? []) as { id: string; nom: string }[]).map((a) => [a.id, a.nom])));
    })().catch((e) => setErreur(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  // ce qui est prévu, et les congés, sur la période
  useEffect(() => {
    if (!cible) return;
    let actif = true;
    setChargement(true);
    setErreur("");
    Promise.all([
      supabase.rpc("ma_feuille_de_route", { p_collaborateur_id: cible, p_debut: lundi, p_fin: fin }),
      supabase
        .from("rh_demandes")
        .select("type_demande,date_debut,date_fin,statut,duree_jours")
        .eq("collaborateur_id", cible)
        .in("statut", ["VALIDEE", "ENVOYEE_RH", "EN_ATTENTE"])
        .lte("date_debut", fin)
        .gte("date_fin", lundi),
    ])
      .then(([r, c]) => {
        if (!actif) return;
        if (r.error) throw new Error(r.error.message);
        setLignes((r.data ?? []) as LigneRoute[]);
        setConges(((c.data ?? []) as Conge[]) || []);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [cible, lundi, fin]);

  /* semaine par semaine : une ligne par affaire (et activité), les heures jour par jour */
  const semaines = useMemo(() => {
    return Array.from({ length: nbSemaines }, (_, k) => {
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
      return { debut, jours, lignes: lignesSemaine, congesJour, totalJour, total: totalJour.reduce((t, x) => t + x, 0) };
    });
  }, [lignes, conges, activites, lundi, nbSemaines]);

  const nomCible = cible === moi?.id ? "moi" : (() => {
    const c = equipe.find((x) => x.id === cible);
    return c ? `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.trigramme || "" : "";
  })();

  const th: CSSProperties = { ...page.th, padding: "8px 8px", whiteSpace: "nowrap" };
  const td: CSSProperties = { ...page.td, padding: "8px 8px" };
  const tdJour: CSSProperties = { ...td, textAlign: "center", whiteSpace: "nowrap", width: 64 };

  return (
    <main style={page.fond}>
      <EnTetePage section="Ma feuille de route" />
      <div style={{ ...page.contenu, maxWidth: 1100 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div>
            <h1 style={page.titre}>Ma feuille de route</h1>
            <p style={page.sousTitre}>
              Ce qui est prévu {nomCible === "moi" ? "pour vous" : `pour ${nomCible}`} au planning, semaine par semaine : les affaires, les heures
              prévues chaque jour et leur délai.
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {consultant && equipe.length > 0 && (
              <select value={cible} onChange={(e) => setCible(e.target.value)} aria-label="Collaborateur" style={{ ...page.entrees, width: "auto", minWidth: 200 }}>
                {equipe.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id === moi?.id ? "Moi" : `${c.trigramme ?? ""} — ${c.prenom ?? ""} ${c.nom ?? ""}`}
                  </option>
                ))}
              </select>
            )}
            {[4, 8, 12].map((n) => (
              <button key={n} type="button" onClick={() => setNbSemaines(n)} style={nbSemaines === n ? page.btnPrimaire : page.btnSecondaire}>
                {n === 4 ? "4 semaines" : n === 8 ? "2 mois" : "3 mois"}
              </button>
            ))}
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && !erreur && <Message genre="info">Chargement…</Message>}

        {!chargement &&
          !erreur &&
          semaines.map((s, k) => (
            <section
              key={s.debut}
              style={{ ...page.carte, padding: 14, marginBottom: 14, borderLeft: `5px solid ${k === 0 ? C.rouge : "#d5d9de"}` }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                <strong style={{ fontSize: 20, color: k === 0 ? C.rouge : undefined }}>S{numeroSemaine(s.debut)}</strong>
                <span style={{ color: C.gris }}>
                  du {dateCourte(s.debut)} au {dateCourte(plus(s.debut, 4))}
                  {k === 0 ? " · cette semaine" : k === 1 ? " · la semaine prochaine" : ""}
                </span>
                <span style={{ flex: 1 }} />
                <strong>{s.total > 0 ? `${h(s.total)} prévues` : ""}</strong>
                {k === 0 && cible === moi?.id && (
                  <Link href="/ma-semaine" style={{ fontWeight: 700, color: C.rougeFonce }}>
                    Saisir ma semaine →
                  </Link>
                )}
              </div>

              {s.lignes.length === 0 && s.congesJour.every((c) => !c) ? (
                <p style={{ margin: 0, color: C.gris }}>Rien de prévu au planning pour l’instant.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={th}>Affaire</th>
                        {s.jours.map((j, i) => (
                          <th key={j} style={{ ...th, textAlign: "center" }}>
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
                            <strong style={{ color: C.rougeFonce }}>{l.titre}</strong>
                            {l.activite && <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: C.gris }}>{l.activite}</span>}
                            {l.designation && <div style={{ fontSize: 13 }}>{l.designation}</div>}
                            {l.echeance && <div style={{ fontSize: 12, color: l.echeance < s.debut ? "#b3261e" : C.gris }}>délai : {dateCourte(l.echeance)}/{l.echeance.slice(2, 4)}</div>}
                          </td>
                          {l.parJour.map((v, i) => (
                            <td key={i} style={{ ...tdJour, background: v > 0 ? "#fdecec" : undefined, fontWeight: v > 0 ? 700 : 400 }}>
                              {v > 0 ? h(v) : ""}
                            </td>
                          ))}
                          <td style={{ ...td, textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{h(l.total)}</td>
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
            </section>
          ))}

        <p style={{ fontSize: 13, color: C.gris }}>
          Prévu d’après le planning du bureau d’études : il peut encore bouger. « ? » : congé demandé, pas encore validé. Une question sur une affaire ?
          Voyez votre responsable.
        </p>
      </div>
    </main>
  );
}

export default function FeuilleDeRoutePage() {
  return (
    <GardeAcces droit={null}>
      <FeuilleDeRouteContenu />
    </GardeAcces>
  );
}
