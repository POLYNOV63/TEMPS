"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   BILAN AFFAIRE - LA PARTIE FINANCIÈRE (vendu, achats)

   Pour une affaire CBE (commande de base + avenants), d'après le Suivi
   d'affaire BE : ce qui est VENDU (montant de chaque commande, réparti
   études / négoce), les ACHATS, et ce qui reste une fois les achats
   déduits ; rapporté aux heures pointées, la valeur produite par heure.

   Les montants sont protégés : seuls l'administration, les responsables
   et la Direction les voient. Pour un collaborateur, la base ne renvoie
   aucun montant et ce bloc ne s'affiche pas.
================================================================ */

type Ligne = { id: string; cle: string; genre: string; parent_cle: string | null; numero_affaire: string | null; statut: string | null; disparue: boolean };
type Montant = {
  ligne_id: string;
  montant: number;
  montant_echeances: number;
  montant_meca: number;
  montant_calcul: number;
  montant_elec_pneu: number;
  montant_scan: number;
  montant_autre: number;
  montant_achats: number;
  montant_negoce: number;
};
type Commande = { numero: string; statut: string; vendu: number; etudes: number; negoce: number; achats: number };

const n = (v: unknown) => Number(v) || 0;
const euros = (v: number) => v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const INACTIF = /perdu|annul/i;

export default function BilanFinancierAffaire({ type, numero }: { type: string; numero: string }) {
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [heures, setHeures] = useState(0);

  useEffect(() => {
    let actif = true;
    setCommandes(null);
    const base = numero.match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
    if (type !== "CBE" || !base) return;

    (async () => {
      const { data: lignes } = await supabase
        .from("suivi_lignes")
        .select("id,cle,genre,parent_cle,numero_affaire,statut,disparue")
        .eq("base_affaire", base);
      const ls = ((lignes ?? []) as Ligne[]).filter((l) => !l.disparue && !INACTIF.test(l.statut ?? ""));
      if (ls.length === 0) return;

      const { data: mts } = await supabase.from("suivi_lignes_montants").select("*").in("ligne_id", ls.map((l) => l.id));
      const montants = new Map(((mts ?? []) as Montant[]).map((m) => [m.ligne_id, m]));
      if (montants.size === 0) return; // pas le droit de voir les montants : on n'affiche rien

      // les échéances / lots portent parfois la ventilation à la place de leur commande
      const decoupages = new Map<string, { etudes: number; negoce: number; achats: number }>();
      for (const l of ls) {
        if ((l.genre !== "ECHEANCE" && l.genre !== "LOT") || !l.parent_cle) continue;
        const m = montants.get(l.id);
        if (!m) continue;
        const d = decoupages.get(l.parent_cle) ?? { etudes: 0, negoce: 0, achats: 0 };
        d.etudes += n(m.montant_meca) + n(m.montant_calcul) + n(m.montant_elec_pneu) + n(m.montant_scan) + n(m.montant_autre);
        d.negoce += n(m.montant_negoce);
        d.achats += n(m.montant_achats);
        decoupages.set(l.parent_cle, d);
      }

      const res: Commande[] = ls
        .filter((l) => l.genre === "BASE" || l.genre === "AVENANT")
        .map((l) => {
          const m = montants.get(l.id);
          const d = decoupages.get(l.cle);
          const etudes = m ? n(m.montant_meca) + n(m.montant_calcul) + n(m.montant_elec_pneu) + n(m.montant_scan) + n(m.montant_autre) : 0;
          return {
            numero: l.numero_affaire ?? l.cle,
            statut: l.statut ?? "",
            vendu: n(m?.montant),
            etudes: etudes || d?.etudes || 0,
            negoce: n(m?.montant_negoce) || d?.negoce || 0,
            achats: n(m?.montant_achats) || d?.achats || 0,
          };
        })
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));

      // heures pointées sur l'affaire (feuilles + historique), quand on a le droit de les voir
      const { data: re } = await supabase.rpc("pilotage_realise").eq("type_affaire", "CBE").eq("numero", base);
      const h = ((re ?? []) as { numero: string; heures: number | string }[])
        .filter((r) => String(r.numero).replace(/^0+/, "") === base)
        .reduce((t, r) => t + n(r.heures), 0);

      if (!actif) return;
      setCommandes(res);
      setHeures(h);
    })().catch(() => undefined);

    return () => {
      actif = false;
    };
  }, [type, numero]);

  if (!commandes || commandes.length === 0) return null;

  const total = commandes.reduce(
    (t, c) => ({ vendu: t.vendu + c.vendu, etudes: t.etudes + c.etudes, negoce: t.negoce + c.negoce, achats: t.achats + c.achats }),
    { vendu: 0, etudes: 0, negoce: 0, achats: 0 }
  );
  const horsAchats = total.vendu - total.achats;

  const carte: CSSProperties = { background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 18, marginBottom: 20 };
  const tuile: CSSProperties = { flex: "1 1 170px", background: "#f7f8fa", borderRadius: 10, padding: "10px 14px" };
  const th: CSSProperties = { textAlign: "right", padding: "8px 8px", fontSize: 12, color: "#5b6168", textTransform: "uppercase", borderBottom: "1px solid #e3e6ea", whiteSpace: "nowrap" };
  const td: CSSProperties = { textAlign: "right", padding: "8px 8px", borderBottom: "1px solid #f0f1f3", whiteSpace: "nowrap" };

  return (
    <section style={carte} aria-label="Partie financière de l'affaire">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Vendu et achats</div>
      <div style={{ fontSize: 13, color: "#5b6168", marginBottom: 14 }}>
        D’après le Suivi d’affaire BE, commande de base et avenants (hors commandes annulées). Visible par l’administration, les responsables et la
        Direction.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div style={tuile}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6168" }}>VENDU</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{euros(total.vendu)}</div>
          <div style={{ fontSize: 12, color: "#5b6168" }}>
            études {euros(total.etudes)}
            {total.negoce > 0 ? ` · négoce ${euros(total.negoce)}` : ""}
          </div>
        </div>
        <div style={tuile}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6168" }}>ACHATS</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: total.achats > 0 ? "#7a3e00" : undefined }}>{euros(total.achats)}</div>
          <div style={{ fontSize: 12, color: "#5b6168" }}>{total.vendu > 0 ? `${Math.round((total.achats / total.vendu) * 100)} % du vendu` : ""}</div>
        </div>
        <div style={tuile}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6168" }}>VENDU − ACHATS</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#1b5e20" }}>{euros(horsAchats)}</div>
          <div style={{ fontSize: 12, color: "#5b6168" }}>ce que rapporte le travail du BE</div>
        </div>
        {heures > 0 && (
          <div style={tuile}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6168" }}>PAR HEURE POINTÉE</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{euros(horsAchats / heures)}</div>
            <div style={{ fontSize: 12, color: "#5b6168" }}>
              (vendu − achats) ÷ {heures.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h pointées
            </div>
          </div>
        )}
      </div>

      {commandes.length > 1 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Commande</th>
                <th style={{ ...th, textAlign: "left" }}>Statut</th>
                <th style={th}>Vendu</th>
                <th style={th}>dont études</th>
                <th style={th}>dont négoce</th>
                <th style={th}>Achats</th>
                <th style={th}>Vendu − achats</th>
              </tr>
            </thead>
            <tbody>
              {commandes.map((c) => (
                <tr key={c.numero}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 800, color: "#8f0000" }}>{c.numero}</td>
                  <td style={{ ...td, textAlign: "left", color: "#5b6168" }}>{c.statut}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{euros(c.vendu)}</td>
                  <td style={td}>{euros(c.etudes)}</td>
                  <td style={td}>{c.negoce ? euros(c.negoce) : "—"}</td>
                  <td style={td}>{c.achats ? euros(c.achats) : "—"}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{euros(c.vendu - c.achats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
