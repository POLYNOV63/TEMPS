"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";

/* ===============================================================
   FICHE AFFAIRE - LES MONTANTS (MONTANTS_FICHE_AFFAIRE)

   Pour une affaire CBE (commande de base + avenants), d'après le Suivi
   d'affaire BE et le relevé PE / PI :
   - commande par commande (mère, filles) : statut, montant, études,
     négoce, achats, facturé, reste à facturer ;
   - par activité : montant commandé, heures commandées, prix vendu
     (€ / h), heures pointées, € / h obtenu ;
   - le négoce : vendu, acheté, marge.

   Visible seulement des rôles qui ont la fonction « Montants des
   affaires » (Paramétrage › Droits d'accès ; à l'origine l'ADMIN).
   La base ne livre les montants qu'à l'administration, aux responsables
   et à la Direction : un autre rôle n'en verrait aucun.
================================================================ */

type Ligne = {
  id: string;
  cle: string;
  genre: string;
  parent_cle: string | null;
  numero_affaire: string | null;
  statut: string | null;
  disparue: boolean;
  date_livraison: string | null;
  heures_meca: number | string | null;
  heures_calcul: number | string | null;
  heures_elec: number | string | null;
  heures_pneu: number | string | null;
  heures_scan: number | string | null;
  heures_autre: number | string | null;
};
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
type Commande = { numero: string; statut: string; montant: number; etudes: number; negoce: number; achats: number; facture: number; parReleve: boolean };
type Discipline = { cle: string; libelle: string; montant: number; heures: number | null; colonnes: string[] };

const n = (v: unknown) => Number(v) || 0;
const euros = (v: number) => v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const heures = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} h`;
const INACTIF = /perdu|annul/i;

export default function BilanFinancierAffaire({
  type,
  numero,
  realiseParActivite,
  correspondance,
}: {
  type: string;
  numero: string;
  /* heures pointées par activité (id d'activité), et colonne du Suivi d'affaire -> activité */
  realiseParActivite?: Map<string, number>;
  correspondance?: Map<string, string>;
}) {
  const [autorise, setAutorise] = useState(false);
  const [message, setMessage] = useState("");
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);

  useEffect(() => {
    let actif = true;
    setCommandes(null);
    setMessage("");
    setAutorise(false);
    const base = numero.match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
    if (type !== "CBE" || !base) return;

    (async () => {
      // le droit « Montants des affaires »
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: moi }] = await Promise.all([supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).maybeSingle(), chargerDroitsRoles()]);
      if (!actif || !peut(moi?.role ?? null, "montantsAffaires")) return;
      setAutorise(true);

      const { data: lignes, error: el } = await supabase
        .from("suivi_lignes")
        .select("id,cle,genre,parent_cle,numero_affaire,statut,disparue,date_livraison,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre")
        .eq("base_affaire", base);
      if (el) return actif && setMessage(`Lecture du Suivi d’affaire impossible : ${el.message}`);
      const ls = ((lignes ?? []) as Ligne[]).filter((l) => !l.disparue && !INACTIF.test(l.statut ?? ""));
      if (ls.length === 0) return actif && setMessage(`CBE${base} n’est pas (ou plus) dans le Suivi d’affaire BE : pas de montant à afficher.`);

      const [{ data: mts, error: em }, { data: afs }] = await Promise.all([
        supabase.from("suivi_lignes_montants").select("*").in("ligne_id", ls.map((l) => l.id)),
        supabase.from("pilotage_affaires").select("id,numero").eq("type", "CBE"),
      ]);
      if (em) return actif && setMessage(`Lecture des montants impossible : ${em.message}`);
      const montants = new Map(((mts ?? []) as Montant[]).map((m) => [m.ligne_id, m]));
      if (montants.size === 0) return actif && setMessage(`Aucun montant lisible pour CBE${base} (droits de la base, ou synchronisation du Suivi d’affaire à refaire).`);

      // PE / PI : facturé au relevé (mois clôturés), par commande
      const famille = ((afs ?? []) as { id: string; numero: string }[]).filter((a) => (a.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "") === base);
      const releve = new Map<string, number>();
      if (famille.length > 0) {
        const { data: pl } = await supabase.from("prestation_lignes").select("id,affaire_id").in("affaire_id", famille.map((a) => a.id));
        const lignesP = (pl ?? []) as { id: string; affaire_id: string }[];
        if (lignesP.length > 0) {
          const { data: pm } = await supabase.from("prestation_mois").select("ligne_id,montant_fige").eq("valide", true).in("ligne_id", lignesP.map((l) => l.id));
          const numeroDe = new Map(famille.map((a) => [a.id, a.numero.toUpperCase().replace(/^0+/, "")]));
          const affaireDe = new Map(lignesP.map((l) => [l.id, l.affaire_id]));
          for (const x of (pm ?? []) as { ligne_id: string; montant_fige: number | string | null }[]) {
            const k = numeroDe.get(affaireDe.get(x.ligne_id) ?? "") ?? "";
            if (k) releve.set(k, (releve.get(k) ?? 0) + n(x.montant_fige));
          }
        }
      }

      // échéances et lots : ils portent parfois la ventilation, et se livrent (donc se facturent) à part
      const enfants = (cle: string) => ls.filter((d) => (d.genre === "ECHEANCE" || d.genre === "LOT") && d.parent_cle === cle);
      const ventilation = (m: Montant | undefined) => ({
        meca: n(m?.montant_meca),
        calcul: n(m?.montant_calcul),
        elec: n(m?.montant_elec_pneu),
        scan: n(m?.montant_scan),
        autre: n(m?.montant_autre),
        negoce: n(m?.montant_negoce),
        achats: n(m?.montant_achats),
      });

      const totalD = { meca: 0, calcul: 0, elec: 0, scan: 0, autre: 0, negoce: 0, hMeca: 0, hCalcul: 0, hElec: 0, hScan: 0, hAutre: 0 };
      const res: Commande[] = ls
        .filter((l) => l.genre === "BASE" || l.genre === "AVENANT")
        .map((l) => {
          const m = montants.get(l.id);
          let v = ventilation(m);
          if (v.meca + v.calcul + v.elec + v.scan + v.autre + v.negoce + v.achats === 0) {
            // ventilation portée par les échéances / lots de la commande
            v = enfants(l.cle).reduce((t, d) => {
              const x = ventilation(montants.get(d.id));
              return { meca: t.meca + x.meca, calcul: t.calcul + x.calcul, elec: t.elec + x.elec, scan: t.scan + x.scan, autre: t.autre + x.autre, negoce: t.negoce + x.negoce, achats: t.achats + x.achats };
            }, v);
          }
          totalD.meca += v.meca;
          totalD.calcul += v.calcul;
          totalD.elec += v.elec;
          totalD.scan += v.scan;
          totalD.autre += v.autre;
          totalD.negoce += v.negoce;
          totalD.hMeca += n(l.heures_meca);
          totalD.hCalcul += n(l.heures_calcul);
          totalD.hElec += n(l.heures_elec) + n(l.heures_pneu);
          totalD.hScan += n(l.heures_scan);
          totalD.hAutre += n(l.heures_autre);
          const num = String(l.numero_affaire ?? l.cle).toUpperCase().replace(/^CBE\s*/, "").replace(/^0+/, "");
          const viaReleve = releve.get(num);
          const facture =
            viaReleve !== undefined
              ? viaReleve
              : l.date_livraison
                ? n(m?.montant)
                : enfants(l.cle)
                    .filter((d) => d.date_livraison)
                    .reduce((t, d) => {
                      const md = montants.get(d.id);
                      return t + (md ? n(md.montant_echeances) || n(md.montant) : 0);
                    }, 0);
          return {
            numero: l.numero_affaire ?? l.cle,
            statut: l.statut ?? "",
            montant: n(m?.montant),
            etudes: v.meca + v.calcul + v.elec + v.scan + v.autre,
            negoce: v.negoce,
            achats: v.achats,
            facture,
            parReleve: viaReleve !== undefined,
          };
        })
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));

      if (!actif) return;
      setCommandes(res);
      setDisciplines([
        { cle: "meca", libelle: "Méca", montant: totalD.meca, heures: totalD.hMeca, colonnes: ["Méca"] },
        { cle: "calcul", libelle: "Calcul", montant: totalD.calcul, heures: totalD.hCalcul, colonnes: ["Calcul"] },
        { cle: "elec", libelle: "Elec / Pneu", montant: totalD.elec, heures: totalD.hElec, colonnes: ["Elec", "Pneu"] },
        { cle: "scan", libelle: "Scan", montant: totalD.scan, heures: totalD.hScan, colonnes: ["Scan"] },
        { cle: "autre", libelle: "Autre", montant: totalD.autre, heures: totalD.hAutre, colonnes: ["Autre"] },
        { cle: "negoce", libelle: "Négoce", montant: totalD.negoce, heures: null, colonnes: [] },
      ]);
    })().catch(() => undefined);

    return () => {
      actif = false;
    };
  }, [type, numero]);

  if (!autorise) return null;

  const carte: CSSProperties = { background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, marginBottom: 16 };
  const th: CSSProperties = { textAlign: "left", padding: "8px 8px", fontSize: 12.5, background: "#f4f5f7", borderBottom: "2px solid #d5d9de", whiteSpace: "nowrap" };
  const thN: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { padding: "8px 8px", borderBottom: "1px solid #eceef1", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const gris = "#5b6168";

  if (message || !commandes) {
    return message ? (
      <section aria-label="Montants de l'affaire" style={carte}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>💶 Montants de l’affaire</h2>
        <p style={{ margin: 0, color: gris }}>{message}</p>
      </section>
    ) : null;
  }

  const somme = (f: (c: Commande) => number) => commandes.reduce((t, c) => t + f(c), 0);
  const pointeDe = (d: Discipline) => {
    if (!realiseParActivite || !correspondance) return null;
    const ids = new Set(d.colonnes.map((c) => correspondance.get(c)).filter((x): x is string => Boolean(x)));
    if (ids.size === 0) return null;
    return [...ids].reduce((t, id) => t + (realiseParActivite.get(id) ?? 0), 0);
  };
  const vendu = somme((c) => c.negoce);
  const achete = somme((c) => c.achats);

  return (
    <section aria-label="Montants de l'affaire" style={carte}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>💶 Montants de l’affaire</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: gris }}>
        D’après le Suivi d’affaire BE (commande et avenants) et, pour les PE / PI, les mois clôturés du relevé. Visible selon la fonction « Montants des affaires » (Droits d’accès).
      </p>

      {/* commande par commande : mère et filles */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Commande</th>
              <th style={th}>Statut</th>
              <th style={thN}>Montant</th>
              <th style={thN}>dont études</th>
              <th style={thN}>dont négoce</th>
              <th style={thN}>Achats</th>
              <th style={thN}>Livré, facturé</th>
              <th style={thN}>Reste à facturer</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => (
              <tr key={c.numero}>
                <td style={{ ...td, fontWeight: 800, color: "#a30000", whiteSpace: "nowrap" }}>{c.numero}</td>
                <td style={td}>{c.statut || "—"}</td>
                <td style={{ ...tdN, fontWeight: 800 }}>{c.montant > 0.5 ? euros(c.montant) : "—"}</td>
                <td style={tdN}>{c.etudes > 0.5 ? euros(c.etudes) : "—"}</td>
                <td style={tdN}>{c.negoce > 0.5 ? euros(c.negoce) : "—"}</td>
                <td style={{ ...tdN, color: "#7a3e00" }}>{c.achats > 0.5 ? euros(c.achats) : "—"}</td>
                <td style={{ ...tdN, color: "#1b5e20" }} title={c.parReleve ? "Mois clôturés du relevé PE / PI" : "Commande livrée, ou échéances / lots livrés"}>
                  {c.facture > 0.5 ? euros(c.facture) : "—"}
                </td>
                <td style={{ ...tdN, fontWeight: 700 }}>{c.montant - c.facture > 0.5 ? euros(c.montant - c.facture) : c.montant > 0.5 ? "✓" : "—"}</td>
              </tr>
            ))}
            {commandes.length > 1 && (
              <tr>
                <td colSpan={2} style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>
                  Toute la famille
                </td>
                <td style={{ ...tdN, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{euros(somme((c) => c.montant))}</td>
                <td style={{ ...tdN, borderTop: "2px solid #d5d9de" }}>{euros(somme((c) => c.etudes))}</td>
                <td style={{ ...tdN, borderTop: "2px solid #d5d9de" }}>{euros(vendu)}</td>
                <td style={{ ...tdN, color: "#7a3e00", borderTop: "2px solid #d5d9de" }}>{euros(achete)}</td>
                <td style={{ ...tdN, color: "#1b5e20", fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{euros(somme((c) => c.facture))}</td>
                <td style={{ ...tdN, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{euros(somme((c) => c.montant - c.facture))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* par activité : montant et heures commandés, prix vendu, heures pointées, € / h obtenu */}
      {disciplines.some((d) => d.montant > 0.5) && (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <strong style={{ fontSize: 15 }}>Par activité</strong>
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
            <thead>
              <tr>
                <th style={th}>Activité</th>
                <th style={thN}>Montant commandé</th>
                <th style={thN}>Heures commandées</th>
                <th style={thN}>Prix vendu</th>
                <th style={thN}>Heures pointées</th>
                <th style={thN}>€ / h obtenu</th>
              </tr>
            </thead>
            <tbody>
              {disciplines
                .filter((d) => d.montant > 0.5 || (d.heures ?? 0) > 0.05)
                .map((d) => {
                  const p = pointeDe(d);
                  const vendu = d.heures && d.heures > 0.05 ? d.montant / d.heures : null;
                  const obtenu = p && p > 0.05 ? d.montant / p : null;
                  return (
                    <tr key={d.cle}>
                      <td style={{ ...td, fontWeight: 800 }}>{d.libelle}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{d.montant > 0.5 ? euros(d.montant) : "—"}</td>
                      <td style={tdN}>{d.heures && d.heures > 0.05 ? heures(d.heures) : "—"}</td>
                      <td style={tdN}>{vendu !== null ? `${euros(vendu)} / h` : "—"}</td>
                      <td style={tdN}>{p !== null && p > 0.05 ? heures(p) : "—"}</td>
                      <td style={{ ...tdN, fontWeight: 700, color: obtenu !== null && vendu !== null && obtenu < vendu * 0.9 ? "#b3261e" : undefined }}>
                        {obtenu !== null ? `${euros(obtenu)} / h` : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
            Prix vendu = montant ÷ heures commandées. € / h obtenu = montant ÷ heures pointées (en rouge s’il est inférieur de plus de 10 % au prix vendu).
          </p>
        </div>
      )}

      {/* le négoce */}
      {(vendu > 0.5 || achete > 0.5) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 28px", marginTop: 14, paddingTop: 10, borderTop: "1px solid #eceef1", fontSize: 15 }}>
          <strong>Négoce</strong>
          <span>
            Vendu : <strong>{euros(vendu)}</strong>
          </span>
          <span>
            Acheté : <strong style={{ color: "#7a3e00" }}>{euros(achete)}</strong>
          </span>
          <span>
            Marge : <strong style={{ color: vendu - achete < 0 ? "#b3261e" : "#1b5e20" }}>{euros(vendu - achete)}</strong>
            {vendu > 0 && <span style={{ color: gris, fontSize: 13 }}> ({Math.round(((vendu - achete) / vendu) * 100)} %)</span>}
          </span>
        </div>
      )}
    </section>
  );
}
