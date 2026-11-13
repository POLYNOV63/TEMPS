"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";
import { chargerTout } from "@/lib/pilotageDonnees";

/* ===============================================================
   FICHE AFFAIRE - HISTORIQUE D'UNE PE / PI (HISTORIQUE_PEPI)

   Pour une PE / PI (commande de base et avenants), d'après le relevé :
   - mois par mois, toute la famille : état (clôturé, en cours, à
     facturer, reporté, prévu), heures facturées, taux moyen, montant,
     face aux heures POINTÉES dans les feuilles d'heures (écart) ;
   - avenant par avenant : commandé, facturé, en cours, prévu, et là où
     ça nous mène (reste, ou dépassement, et date de fin du prévu), avec
     son détail mois par mois.
   Mois clôturé : heures et montant figés à la clôture. Autres mois :
   heures saisies au relevé × taux de la ligne (estimation).
   Les heures se voient selon les droits du relevé ; les montants et les
   taux, seulement avec la fonction « Montants des affaires ».
================================================================ */

type LigneP = { id: string; affaire_id: string; unite: "JOUR" | "HEURE"; taux: number | null; base_horaire: number };
type MoisP = { ligne_id: string; mois: string; valide: boolean; reporte: boolean; heures_fige: number | null; montant_fige: number | null };
type Etat = "CLOTURE" | "EN_COURS" | "A_FACTURER" | "REPORTE" | "PREVU";
type Cellule = { heures: number; montant: number; etat: Etat };
type Commande = {
  id: string;
  numero: string;
  statut: string;
  commande: number; // montant commandé (Suivi d'affaire)
  unite: "JOUR" | "HEURE";
  base: number;
  mois: Map<string, Cellule>;
  finPrevue: string | null;
};

const n = (v: unknown) => Number(v) || 0;
const euros = (v: number) => v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const heures = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} h`;
const NOMS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const libMois = (m: string) => `${NOMS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const LIBELLE_ETAT: Record<Etat, { texte: string; couleur: string }> = {
  CLOTURE: { texte: "facturé", couleur: "#1b5e20" },
  EN_COURS: { texte: "en cours", couleur: "#1f4e99" },
  A_FACTURER: { texte: "à clôturer", couleur: "#8a6500" },
  REPORTE: { texte: "reporté", couleur: "#7a3e00" },
  PREVU: { texte: "prévu", couleur: "#5b6168" },
};
const ORDRE_ETAT: Etat[] = ["CLOTURE", "REPORTE", "A_FACTURER", "EN_COURS", "PREVU"];

export default function HistoriquePEPI({ base, pointeParMois }: { base: string; pointeParMois: Map<string, number> }) {
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [voitMontants, setVoitMontants] = useState(false);
  const [message, setMessage] = useState("");
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let actif = true;
    setCommandes(null);
    setMessage("");
    const b = base.match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
    if (!b) return;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: moi }] = await Promise.all([supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).maybeSingle(), chargerDroitsRoles()]);
      if (actif) setVoitMontants(peut(moi?.role ?? null, "montantsAffaires"));

      const { data: afs } = await supabase.from("pilotage_affaires").select("id,numero,statut").eq("type", "CBE");
      const famille = ((afs ?? []) as { id: string; numero: string; statut: string }[])
        .filter((a) => (a.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "") === b)
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      if (famille.length === 0) return;

      const { data: pl, error: ep } = await supabase.from("prestation_lignes").select("id,affaire_id,unite,taux,base_horaire").in("affaire_id", famille.map((a) => a.id));
      if (ep) return actif && setMessage("Le relevé PE / PI de cette affaire ne vous est pas ouvert.");
      const lignes = ((pl ?? []) as { id: string; affaire_id: string; unite: "JOUR" | "HEURE"; taux: number | string | null; base_horaire: number | string | null }[]).map(
        (l): LigneP => ({ id: l.id, affaire_id: l.affaire_id, unite: l.unite, taux: l.taux === null ? null : n(l.taux), base_horaire: n(l.base_horaire) || 7 })
      );
      if (lignes.length === 0) return actif && setMessage("Aucune ligne au relevé PE / PI pour cette affaire.");
      const ids = lignes.map((l) => l.id);

      const [pm, sa, sl] = await Promise.all([
        chargerTout<{ ligne_id: string; mois: string; valide: boolean | null; reporte: boolean | null; heures_fige: number | string | null; montant_fige: number | string | null }>((x, y) =>
          supabase.from("prestation_mois").select("ligne_id,mois,valide,reporte,heures_fige,montant_fige").in("ligne_id", ids).order("mois").range(x, y)
        ),
        chargerTout<{ ligne_id: string; jour: string; heures: number | string | null }>((x, y) =>
          supabase.from("prestation_saisies").select("ligne_id,jour,heures").in("ligne_id", ids).order("jour").range(x, y)
        ),
        supabase.from("suivi_lignes").select("id,numero_affaire,genre,statut").eq("base_affaire", b).in("genre", ["BASE", "AVENANT"]),
      ]);
      const etats = new Map<string, MoisP>(
        pm.map((x) => [
          `${x.ligne_id}|${String(x.mois).slice(0, 7)}`,
          { ligne_id: x.ligne_id, mois: String(x.mois).slice(0, 7), valide: Boolean(x.valide), reporte: Boolean(x.reporte), heures_fige: x.heures_fige === null ? null : n(x.heures_fige), montant_fige: x.montant_fige === null ? null : n(x.montant_fige) },
        ])
      );
      // montant commandé de chaque commande (Suivi d'affaire BE)
      const suivi = (sl.data ?? []) as { id: string; numero_affaire: string | null; genre: string; statut: string | null }[];
      const montants = new Map<string, number>();
      if (voitMontantsAvant(moi?.role ?? null) && suivi.length > 0) {
        const { data: mts } = await supabase.from("suivi_lignes_montants").select("ligne_id,montant").in("ligne_id", suivi.map((s) => s.id));
        for (const m of (mts ?? []) as { ligne_id: string; montant: number | string | null }[]) montants.set(m.ligne_id, n(m.montant));
      }

      const moisCourant = new Date().toISOString().slice(0, 7);
      const auj = new Date().toISOString().slice(0, 10);
      // heures saisies par ligne et par mois, et dernier jour saisi par commande
      const saisi = new Map<string, number>();
      const dernier = new Map<string, string>();
      const affaireDe = new Map(lignes.map((l) => [l.id, l.affaire_id]));
      for (const s of sa) {
        const h = n(s.heures);
        if (h <= 0) continue;
        const k = `${s.ligne_id}|${s.jour.slice(0, 7)}`;
        saisi.set(k, (saisi.get(k) ?? 0) + h);
        const a = affaireDe.get(s.ligne_id) ?? "";
        if (s.jour >= auj && s.jour > (dernier.get(a) ?? "")) dernier.set(a, s.jour);
      }
      const moisDe = new Set<string>([...saisi.keys(), ...etats.keys()]);

      const res: Commande[] = famille.map((a) => {
        const ls = lignes.filter((l) => l.affaire_id === a.id);
        const mois = new Map<string, Cellule>();
        for (const cle of moisDe) {
          const [lid, m] = cle.split("|");
          const l = ls.find((x) => x.id === lid);
          if (!l) continue;
          const e = etats.get(cle);
          const tauxH = l.taux === null ? 0 : l.unite === "JOUR" ? l.taux / l.base_horaire : l.taux;
          let h: number;
          let mt: number;
          let etat: Etat;
          if (e?.valide) {
            h = e.heures_fige ?? saisi.get(cle) ?? 0;
            mt = e.montant_fige ?? h * tauxH;
            etat = "CLOTURE";
          } else {
            h = saisi.get(cle) ?? 0;
            mt = h * tauxH;
            etat = e?.reporte ? "REPORTE" : m > moisCourant ? "PREVU" : m === moisCourant ? "EN_COURS" : "A_FACTURER";
          }
          if (h <= 0.001 && mt <= 0.5) continue;
          const c = mois.get(m) ?? { heures: 0, montant: 0, etat };
          c.heures += h;
          c.montant += mt;
          // un mois partiellement clôturé garde l'état le moins avancé
          if (ORDRE_ETAT.indexOf(etat) > ORDRE_ETAT.indexOf(c.etat)) c.etat = etat;
          mois.set(m, c);
        }
        const s = suivi.find((x) => String(x.numero_affaire ?? "").toUpperCase().replace(/^CBE\s*/, "").replace(/^0+/, "") === a.numero.toUpperCase().replace(/^0+/, ""));
        return {
          id: a.id,
          numero: a.numero,
          statut: s?.statut ?? a.statut,
          commande: s ? montants.get(s.id) ?? 0 : 0,
          unite: ls[0]?.unite ?? "HEURE",
          base: ls[0]?.base_horaire ?? 7,
          mois,
          finPrevue: dernier.get(a.id) ?? null,
        };
      });
      if (!actif) return;
      setCommandes(res.filter((c) => c.mois.size > 0 || c.commande > 0));
      // la commande la plus récente dépliée d'office
      const der = res.filter((c) => c.mois.size > 0).slice(-1)[0];
      if (der) setOuvertes(new Set([der.id]));
    })().catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [base]);

  /* toute la famille, mois par mois */
  const famille = useMemo(() => {
    if (!commandes) return [];
    const m = new Map<string, Cellule>();
    for (const c of commandes)
      for (const [mo, v] of c.mois) {
        const t = m.get(mo) ?? { heures: 0, montant: 0, etat: v.etat };
        t.heures += v.heures;
        t.montant += v.montant;
        if (ORDRE_ETAT.indexOf(v.etat) > ORDRE_ETAT.indexOf(t.etat)) t.etat = v.etat;
        m.set(mo, t);
      }
    for (const mo of pointeParMois.keys()) if (!m.has(mo)) m.set(mo, { heures: 0, montant: 0, etat: mo > new Date().toISOString().slice(0, 7) ? "PREVU" : "A_FACTURER" });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [commandes, pointeParMois]);

  if (message)
    return (
      <section style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Historique de la PE / PI</h2>
        <p style={{ margin: 0, color: "#5b6168" }}>{message}</p>
      </section>
    );
  if (!commandes || commandes.length === 0) return null;

  const th: CSSProperties = { textAlign: "left", padding: "7px 8px", fontSize: 12.5, background: "#f4f5f7", borderBottom: "2px solid #d5d9de", whiteSpace: "nowrap" };
  const thN: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { padding: "7px 8px", borderBottom: "1px solid #eceef1", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const gris = "#5b6168";
  const taux = (montant: number, h: number) => (h > 0.05 && montant > 0.5 ? `${euros(montant / h)} / h` : "—");
  const etiquette = (e: Etat) => <span style={{ fontSize: 12, fontWeight: 800, color: LIBELLE_ETAT[e].couleur }}>{LIBELLE_ETAT[e].texte}</span>;
  const somme = (liste: [string, Cellule][], f: (c: Cellule) => number, filtre?: (e: Etat) => boolean) => liste.filter(([, c]) => !filtre || filtre(c.etat)).reduce((t, [, c]) => t + f(c), 0);

  return (
    <section style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, marginBottom: 16, overflowX: "auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Historique de la PE / PI</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: gris }}>
        D’après le relevé PE / PI : mois clôturés (figés à la facture), mois en cours ou à clôturer, mois prévus ; face aux heures pointées dans les feuilles d’heures. Hors mois clôturés, les montants sont estimés (heures × taux de la ligne).
      </p>

      {/* toute la famille, mois par mois */}
      <strong style={{ fontSize: 15 }}>Mois par mois, toute la famille</strong>
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
        <thead>
          <tr>
            <th style={th}>Mois</th>
            <th style={th}>État</th>
            <th style={thN}>Heures facturées</th>
            {voitMontants && <th style={thN}>Taux moyen</th>}
            {voitMontants && <th style={thN}>Montant</th>}
            <th style={thN}>Pointé (feuilles)</th>
            <th style={thN}>Écart</th>
          </tr>
        </thead>
        <tbody>
          {famille.map(([mo, c]) => {
            const p = pointeParMois.get(mo) ?? 0;
            const ecart = c.heures - p;
            const futur = c.etat === "PREVU";
            return (
              <tr key={mo} style={{ background: futur ? "#fafbfc" : undefined, fontStyle: futur ? "italic" : undefined }}>
                <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{libMois(mo)}</td>
                <td style={td}>{etiquette(c.etat)}</td>
                <td style={{ ...tdN, fontWeight: 800 }}>{c.heures > 0.05 ? heures(c.heures) : "—"}</td>
                {voitMontants && <td style={tdN}>{taux(c.montant, c.heures)}</td>}
                {voitMontants && <td style={{ ...tdN, fontWeight: 700 }}>{c.montant > 0.5 ? euros(c.montant) : "—"}</td>}
                <td style={tdN}>{futur ? "" : p > 0.05 ? heures(p) : "—"}</td>
                <td style={{ ...tdN, fontWeight: 700, color: futur || Math.abs(ecart) < 0.5 ? gris : ecart < 0 ? "#b3261e" : "#1b5e20" }}>
                  {futur ? "" : Math.abs(ecart) < 0.5 ? "=" : `${ecart > 0 ? "+" : "−"}${heures(Math.abs(ecart))}`}
                </td>
              </tr>
            );
          })}
          {(() => {
            const passe = (e: Etat) => e !== "PREVU";
            const h = somme(famille, (c) => c.heures, passe);
            const mt = somme(famille, (c) => c.montant, passe);
            const p = famille.filter(([, c]) => passe(c.etat)).reduce((t, [mo]) => t + (pointeParMois.get(mo) ?? 0), 0);
            const bord = { borderTop: "2px solid #d5d9de" };
            return (
              <tr>
                <td colSpan={2} style={{ ...td, ...bord, fontWeight: 800 }}>
                  Total à ce jour
                </td>
                <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{heures(h)}</td>
                {voitMontants && <td style={{ ...tdN, ...bord }}>{taux(mt, h)}</td>}
                {voitMontants && <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{euros(mt)}</td>}
                <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{heures(p)}</td>
                <td style={{ ...tdN, ...bord, fontWeight: 800, color: h - p < -0.5 ? "#b3261e" : "#1b5e20" }}>{Math.abs(h - p) < 0.5 ? "=" : `${h - p > 0 ? "+" : "−"}${heures(Math.abs(h - p))}`}</td>
              </tr>
            );
          })()}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
        Écart = heures facturées − heures pointées : en rouge, du travail pointé et pas facturé ; en vert, facturé au-delà du pointé. Les heures sont pointées sur la commande de base : la comparaison se fait pour toute la famille.
      </p>

      {/* avenant par avenant : là où ça nous mène */}
      <strong style={{ display: "block", fontSize: 15, marginTop: 16 }}>Commande par commande : là où ça nous mène</strong>
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
        <thead>
          <tr>
            <th style={th}>Commande</th>
            {voitMontants && <th style={thN}>Commandé</th>}
            <th style={thN}>Facturé</th>
            <th style={thN}>En cours, à clôturer</th>
            <th style={thN}>Prévu</th>
            {voitMontants && <th style={thN}>Reste après le prévu</th>}
            <th style={th}>Fin du prévu</th>
          </tr>
        </thead>
        <tbody>
          {commandes.map((c) => {
            const liste = [...c.mois.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            const fact = (f: (x: Cellule) => number) => somme(liste, f, (e) => e === "CLOTURE");
            const cours = (f: (x: Cellule) => number) => somme(liste, f, (e) => e === "EN_COURS" || e === "A_FACTURER" || e === "REPORTE");
            const prev = (f: (x: Cellule) => number) => somme(liste, f, (e) => e === "PREVU");
            const reste = c.commande - fact((x) => x.montant) - cours((x) => x.montant) - prev((x) => x.montant);
            const ouverte = ouvertes.has(c.id);
            const qte = (h: number) => (c.unite === "JOUR" ? `${(Math.round((h / c.base) * 10) / 10).toLocaleString("fr-FR")} j` : heures(h));
            const val = (h: number, mt: number) => (
              <>
                <strong>{h > 0.05 ? qte(h) : "—"}</strong>
                {voitMontants && mt > 0.5 && <div style={{ fontSize: 12, color: gris }}>{euros(mt)}</div>}
              </>
            );
            return (
              <Fragment key={c.id}>
                <tr
                  onClick={() =>
                    setOuvertes((s) => {
                      const nv = new Set(s);
                      if (nv.has(c.id)) nv.delete(c.id);
                      else nv.add(c.id);
                      return nv;
                    })
                  }
                  title="Déplier : le détail mois par mois"
                  style={{ cursor: "pointer", background: "#fafbfc" }}
                >
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{ color: gris, marginRight: 4 }}>{ouverte ? "▾" : "▸"}</span>
                    <strong style={{ color: "#a30000" }}>{c.numero}</strong>
                    <span style={{ fontSize: 12, color: gris }}> {c.statut}</span>
                  </td>
                  {voitMontants && <td style={{ ...tdN, fontWeight: 800 }}>{c.commande > 0.5 ? euros(c.commande) : "—"}</td>}
                  <td style={{ ...tdN, color: "#1b5e20" }}>{val(fact((x) => x.heures), fact((x) => x.montant))}</td>
                  <td style={{ ...tdN, color: "#1f4e99" }}>{val(cours((x) => x.heures), cours((x) => x.montant))}</td>
                  <td style={{ ...tdN, color: gris }}>{val(prev((x) => x.heures), prev((x) => x.montant))}</td>
                  {voitMontants && (
                    <td style={{ ...tdN, fontWeight: 800, color: c.commande <= 0.5 ? gris : reste < -0.5 ? "#b3261e" : "#1b5e20" }}>
                      {c.commande <= 0.5 ? "—" : reste < -0.5 ? `dépassé de ${euros(-reste)}` : euros(reste)}
                    </td>
                  )}
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{c.finPrevue ? new Date(`${c.finPrevue}T00:00:00`).toLocaleDateString("fr-FR") : "—"}</td>
                </tr>
                {ouverte && (
                  <tr>
                    <td colSpan={voitMontants ? 7 : 5} style={{ ...td, padding: "4px 8px 10px 30px", background: "#ffffff" }}>
                      {liste.length === 0 ? (
                        <span style={{ color: gris }}>Rien au relevé pour cette commande.</span>
                      ) : (
                        <table style={{ borderCollapse: "collapse", width: "100%" }}>
                          <thead>
                            <tr>
                              <th style={th}>Mois</th>
                              <th style={th}>État</th>
                              <th style={thN}>Quantité</th>
                              {voitMontants && <th style={thN}>Taux</th>}
                              {voitMontants && <th style={thN}>Montant</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {liste.map(([mo, x]) => (
                              <tr key={mo} style={{ fontStyle: x.etat === "PREVU" ? "italic" : undefined }}>
                                <td style={{ ...td, whiteSpace: "nowrap" }}>{libMois(mo)}</td>
                                <td style={td}>{etiquette(x.etat)}</td>
                                <td style={{ ...tdN, fontWeight: 700 }}>{qte(x.heures)}</td>
                                {voitMontants && (
                                  <td style={tdN}>
                                    {x.heures > 0.05 && x.montant > 0.5 ? (c.unite === "JOUR" ? `${euros((x.montant / x.heures) * c.base)} / j` : `${euros(x.montant / x.heures)} / h`) : "—"}
                                  </td>
                                )}
                                {voitMontants && <td style={{ ...tdN, fontWeight: 700 }}>{x.montant > 0.5 ? euros(x.montant) : "—"}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/* le montant commandé ne se lit qu'avec le droit aux montants (la page ne l'affiche pas sinon) */
function voitMontantsAvant(role: string | null): boolean {
  return peut(role, "montantsAffaires");
}
