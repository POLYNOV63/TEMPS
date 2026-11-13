"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  heuresCmd: number | null; // heures commandées (Suivi d'affaire, ou montant ÷ taux)
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
        supabase.from("suivi_lignes").select("id,numero_affaire,genre,statut,heures_total").eq("base_affaire", b).in("genre", ["BASE", "AVENANT"]),
      ]);
      const etats = new Map<string, MoisP>(
        pm.map((x) => [
          `${x.ligne_id}|${String(x.mois).slice(0, 7)}`,
          { ligne_id: x.ligne_id, mois: String(x.mois).slice(0, 7), valide: Boolean(x.valide), reporte: Boolean(x.reporte), heures_fige: x.heures_fige === null ? null : n(x.heures_fige), montant_fige: x.montant_fige === null ? null : n(x.montant_fige) },
        ])
      );
      // montant commandé de chaque commande (Suivi d'affaire BE)
      const suivi = (sl.data ?? []) as { id: string; numero_affaire: string | null; genre: string; statut: string | null; heures_total: number | string | null }[];
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
        const commande = s ? montants.get(s.id) ?? 0 : 0;
        const l0 = ls.find((l) => l.taux !== null);
        const tauxH0 = l0 && l0.taux !== null ? (l0.unite === "JOUR" ? l0.taux / l0.base_horaire : l0.taux) : null;
        const hCmd = n(s?.heures_total);
        return {
          id: a.id,
          numero: a.numero,
          statut: s?.statut ?? a.statut,
          commande,
          heuresCmd: hCmd > 0 ? hCmd : commande > 0 && tauxH0 ? commande / tauxH0 : null,
          unite: ls[0]?.unite ?? "HEURE",
          base: ls[0]?.base_horaire ?? 7,
          mois,
          finPrevue: dernier.get(a.id) ?? null,
        };
      });
      if (!actif) return;
      setCommandes(res.filter((c) => c.mois.size > 0 || c.commande > 0));
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

  /* HISTORIQUE_PEPI_V2 : un seul tableau. Une ligne par mois ; une colonne par commande (base, avenants),
     avec en tête ce qui est commandé, et en pied ce qui est facturé, en cours, prévu, et le reste. */
  const th: CSSProperties = { textAlign: "center", padding: "6px 8px", fontSize: 12.5, background: "#f4f5f7", borderBottom: "1px solid #d5d9de", whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #eceef1", fontSize: 14, textAlign: "right", whiteSpace: "nowrap" };
  const sep: CSSProperties = { borderLeft: "2px solid #d5d9de" };
  const gris = "#5b6168";
  const qte = (c: Commande, h: number) => (c.unite === "JOUR" ? `${(Math.round((h / c.base) * 10) / 10).toLocaleString("fr-FR")} j` : heures(h));
  const etiquette = (e: Etat) => <span style={{ fontSize: 12, fontWeight: 800, color: LIBELLE_ETAT[e].couleur }}>{LIBELLE_ETAT[e].texte}</span>;
  const moisCourant = new Date().toISOString().slice(0, 7);
  const tot = (c: Commande, f: (x: Cellule) => number, filtre: (e: Etat) => boolean) => [...c.mois.values()].filter((x) => filtre(x.etat)).reduce((t, x) => t + f(x), 0);
  const estFacture = (e: Etat) => e === "CLOTURE";
  const estEnCours = (e: Etat) => e === "EN_COURS" || e === "A_FACTURER" || e === "REPORTE";
  const estPrevu = (e: Etat) => e === "PREVU";
  const nbColsFamille = voitMontants ? 5 : 3;
  const enTetePied: CSSProperties = { ...td, textAlign: "left", fontWeight: 800, background: "#fafbfc" };

  const ligneTotaux = (libelle: string, filtre: (e: Etat) => boolean, couleur: string, avecPointe: boolean) => {
    const lignes = famille.filter(([, x]) => filtre(x.etat));
    const h = lignes.reduce((t, [, x]) => t + x.heures, 0);
    const mt = lignes.reduce((t, [, x]) => t + x.montant, 0);
    const p = avecPointe ? lignes.reduce((t, [mo]) => t + (pointeParMois.get(mo) ?? 0), 0) : 0;
    return (
      <tr>
        <td style={{ ...enTetePied, color: couleur }} colSpan={2}>
          {libelle}
        </td>
        {commandes.map((c) => {
          const hc = tot(c, (x) => x.heures, filtre);
          const mc = tot(c, (x) => x.montant, filtre);
          return (
            <td key={c.id} style={{ ...td, ...sep, background: "#fafbfc", color: couleur, fontWeight: 700 }}>
              {hc > 0.05 ? qte(c, hc) : "—"}
              {voitMontants && mc > 0.5 && <div style={{ fontSize: 11.5, color: gris, fontWeight: 400 }}>{euros(mc)}</div>}
            </td>
          );
        })}
        <td style={{ ...td, ...sep, background: "#fafbfc", fontWeight: 800 }}>{h > 0.05 ? heures(h) : "—"}</td>
        {voitMontants && <td style={{ ...td, background: "#fafbfc" }}>{h > 0.05 && mt > 0.5 ? `${euros(mt / h)} / h` : ""}</td>}
        {voitMontants && <td style={{ ...td, background: "#fafbfc", fontWeight: 800 }}>{mt > 0.5 ? euros(mt) : "—"}</td>}
        <td style={{ ...td, background: "#fafbfc" }}>{avecPointe ? heures(p) : ""}</td>
        <td style={{ ...td, background: "#fafbfc", fontWeight: 700, color: avecPointe && h - p < -0.5 ? "#b3261e" : "#1b5e20" }}>
          {avecPointe ? (Math.abs(h - p) < 0.5 ? "=" : `${h - p > 0 ? "+" : "−"}${heures(Math.abs(h - p))}`) : ""}
        </td>
      </tr>
    );
  };

  return (
    <section style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, marginBottom: 16, overflowX: "auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Historique de la PE / PI</h2>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: gris }}>
        Une ligne par mois, une colonne par commande. En tête : ce qui est commandé. En pied : facturé, en cours, prévu, et le reste. Mois clôturés : figés à la facture ; autres mois : heures du relevé × taux de la ligne (estimation).
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }} rowSpan={2}>
              Mois
            </th>
            <th style={{ ...th, textAlign: "left" }} rowSpan={2}>
              État
            </th>
            {commandes.map((c) => (
              <th key={c.id} style={{ ...th, ...sep, color: "#a30000", fontSize: 14 }}>
                {c.numero}
                <div style={{ fontSize: 11, fontWeight: 600, color: gris }}>{c.statut}</div>
              </th>
            ))}
            <th style={{ ...th, ...sep }} colSpan={nbColsFamille}>
              Toute la famille
            </th>
          </tr>
          <tr>
            {/* ce qui est commandé, commande par commande */}
            {commandes.map((c) => (
              <th key={c.id} style={{ ...th, ...sep, background: "#eef4fb", fontWeight: 700 }} title="Commandé (Suivi d’affaire BE)">
                commandé {c.heuresCmd !== null ? qte(c, c.heuresCmd) : "?"}
                {voitMontants && c.commande > 0.5 && <div style={{ fontSize: 11.5, fontWeight: 400 }}>{euros(c.commande)}</div>}
              </th>
            ))}
            <th style={{ ...th, ...sep }}>Heures</th>
            {voitMontants && <th style={th}>Taux moyen</th>}
            {voitMontants && <th style={th}>Montant</th>}
            <th style={th}>Pointé</th>
            <th style={th}>Écart</th>
          </tr>
        </thead>
        <tbody>
          {famille.map(([mo, f]) => {
            const futur = mo > moisCourant;
            const p = pointeParMois.get(mo) ?? 0;
            const ecart = f.heures - p;
            return (
              <tr key={mo} style={{ fontStyle: futur ? "italic" : undefined, background: mo === moisCourant ? "#fffafa" : undefined }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{libMois(mo)}</td>
                <td style={{ ...td, textAlign: "left" }}>{etiquette(f.etat)}</td>
                {commandes.map((c) => {
                  const x = c.mois.get(mo);
                  return (
                    <td key={c.id} style={{ ...td, ...sep }} title={x && voitMontants && x.montant > 0.5 ? `${euros(x.montant)} · ${LIBELLE_ETAT[x.etat].texte}` : x ? LIBELLE_ETAT[x.etat].texte : undefined}>
                      {x && x.heures > 0.05 ? <span style={{ color: LIBELLE_ETAT[x.etat].couleur, fontWeight: 700 }}>{qte(c, x.heures)}</span> : ""}
                    </td>
                  );
                })}
                <td style={{ ...td, ...sep, fontWeight: 800 }}>{f.heures > 0.05 ? heures(f.heures) : "—"}</td>
                {voitMontants && <td style={td}>{f.heures > 0.05 && f.montant > 0.5 ? `${euros(f.montant / f.heures)} / h` : "—"}</td>}
                {voitMontants && <td style={{ ...td, fontWeight: 700 }}>{f.montant > 0.5 ? euros(f.montant) : "—"}</td>}
                <td style={td}>{futur ? "" : p > 0.05 ? heures(p) : "—"}</td>
                <td style={{ ...td, fontWeight: 700, color: futur || Math.abs(ecart) < 0.5 ? gris : ecart < 0 ? "#b3261e" : "#1b5e20" }}>
                  {futur ? "" : Math.abs(ecart) < 0.5 ? "=" : `${ecart > 0 ? "+" : "−"}${heures(Math.abs(ecart))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2 + commandes.length + nbColsFamille} style={{ padding: 0, borderTop: "2px solid #a30000" }} />
          </tr>
          {ligneTotaux("Facturé", estFacture, "#1b5e20", true)}
          {ligneTotaux("En cours, à clôturer", estEnCours, "#1f4e99", true)}
          {ligneTotaux("Prévu", estPrevu, gris, false)}
          {/* là où ça nous mène */}
          <tr>
            <td style={{ ...enTetePied, borderTop: "2px solid #d5d9de" }} colSpan={2}>
              Reste après le prévu
            </td>
            {commandes.map((c) => {
              const tout = tot(c, (x) => x.heures, () => true);
              const reste = c.heuresCmd !== null ? c.heuresCmd - tout : null;
              const resteE = voitMontants && c.commande > 0.5 ? c.commande - tot(c, (x) => x.montant, () => true) : null;
              return (
                <td key={c.id} style={{ ...td, ...sep, background: "#fafbfc", borderTop: "2px solid #d5d9de", fontWeight: 800, color: reste === null ? gris : reste < -0.05 ? "#b3261e" : "#1b5e20" }}>
                  {reste === null ? "—" : reste < -0.05 ? `dépassé de ${qte(c, -reste)}` : reste <= 0.05 ? "✓ soldé" : qte(c, reste)}
                  {resteE !== null && Math.abs(resteE) > 0.5 && <div style={{ fontSize: 11.5, fontWeight: 400, color: gris }}>{resteE < 0 ? `− ${euros(-resteE)}` : euros(resteE)}</div>}
                  {c.finPrevue && <div style={{ fontSize: 11.5, fontWeight: 400, color: gris }}>fin du prévu le {new Date(`${c.finPrevue}T00:00:00`).toLocaleDateString("fr-FR")}</div>}
                </td>
              );
            })}
            <td colSpan={nbColsFamille} style={{ ...td, ...sep, background: "#fafbfc", borderTop: "2px solid #d5d9de", fontSize: 12.5, color: gris, textAlign: "left", whiteSpace: "normal" }}>
              commandé − facturé − en cours − prévu, commande par commande
            </td>
          </tr>
        </tfoot>
      </table>
      <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
        Écart = heures facturées − heures pointées (toute la famille : les feuilles d’heures sont pointées sur le n° de base). En rouge, du travail pointé et pas facturé.
      </p>
    </section>
  );
}

/* le montant commandé ne se lit qu'avec le droit aux montants (la page ne l'affiche pas sinon) */
function voitMontantsAvant(role: string | null): boolean {
  return peut(role, "montantsAffaires");
}
