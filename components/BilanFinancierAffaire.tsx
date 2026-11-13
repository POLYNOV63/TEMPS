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
   - le négoce : vendu, acheté, marge brute, temps passé (heures pointées
     × coût de structure) et marge résiduelle (NEGOCE_RECAP) ;
   - la facturation ligne par ligne : commande, avenants, échéances et
     lots, mois du relevé ; facturé le… ou à facturer (ECHEANCIER_FICHE).

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
  delai: string | null;
  date_livraison_estimee: string | null;
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
/* ECHEANCIER_FICHE : chaque ligne facturable de la famille (commande, avenant, échéance, lot, mois du relevé) */
type LigneFacture = { cle: string; niveau: 0 | 1; numero: string; nature: string; statut: string; montant: number; facturee: string | null; prevue: string | null; releve?: boolean; parent?: string };
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
  heuresNegoce = 0,
  depassementPrevu = 0,
}: {
  type: string;
  numero: string;
  /* heures pointées par activité (id d'activité), et colonne du Suivi d'affaire -> activité */
  realiseParActivite?: Map<string, number>;
  correspondance?: Map<string, string>;
  /* heures pointées sur le négoce (activité Négoce), pour la marge résiduelle */
  heuresNegoce?: number;
  /* heures de dépassement prévu (pointé + planifié − chiffré), pour en chiffrer le coût */
  depassementPrevu?: number;
}) {
  const [autorise, setAutorise] = useState(false);
  const [message, setMessage] = useState("");
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [echeancier, setEcheancier] = useState<LigneFacture[]>([]);
  const [coutHoraire, setCoutHoraire] = useState<number | null>(null);
  const [achatsRecus, setAchatsRecus] = useState<number | null>(null);

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
        .select("id,cle,genre,parent_cle,numero_affaire,statut,disparue,date_livraison,delai,date_livraison_estimee,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre")
        .eq("base_affaire", base);
      if (el) return actif && setMessage(`Lecture du Suivi d’affaire impossible : ${el.message}`);
      const ls = ((lignes ?? []) as Ligne[]).filter((l) => !l.disparue && !INACTIF.test(l.statut ?? ""));
      if (ls.length === 0) return actif && setMessage(`CBE${base} n’est pas (ou plus) dans le Suivi d’affaire BE : pas de montant à afficher.`);

      const [{ data: mts, error: em }, { data: afs }, { data: couts }] = await Promise.all([
        supabase.from("suivi_lignes_montants").select("*").in("ligne_id", ls.map((l) => l.id)),
        supabase.from("pilotage_affaires").select("id,numero,achats_recus").eq("type", "CBE"),
        supabase.from("indicateurs_couts").select("annee,cout_horaire"),
      ]);
      // coût horaire de structure de l'exercice en cours (sinon le plus récent saisi)
      {
        const d = new Date();
        const ex = d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
        const liste = ((couts ?? []) as { annee: number; cout_horaire: number | string }[]).map((c) => ({ annee: Number(c.annee), cout: Number(c.cout_horaire) || 0 })).filter((c) => c.cout > 0);
        const c = liste.find((x) => x.annee === ex) ?? liste.sort((a, b) => b.annee - a.annee)[0];
        if (actif) setCoutHoraire(c ? c.cout : null);
      }
      if (em) return actif && setMessage(`Lecture des montants impossible : ${em.message}`);
      const montants = new Map(((mts ?? []) as Montant[]).map((m) => [m.ligne_id, m]));
      if (montants.size === 0) return actif && setMessage(`Aucun montant lisible pour CBE${base} (droits de la base, ou synchronisation du Suivi d’affaire à refaire).`);

      // PE / PI : facturé au relevé (mois clôturés), par commande
      const famille = ((afs ?? []) as { id: string; numero: string; achats_recus?: number | string | null }[]).filter((a) => (a.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "") === base);
      {
        const b = famille.find((a) => a.numero.replace(/^0+/, "") === base);
        if (actif) setAchatsRecus(b && b.achats_recus !== null && b.achats_recus !== undefined ? Number(b.achats_recus) || 0 : null);
      }
      const releve = new Map<string, number>();
      const releveMois = new Map<string, { mois: string; montant: number }[]>();
      if (famille.length > 0) {
        const { data: pl } = await supabase.from("prestation_lignes").select("id,affaire_id").in("affaire_id", famille.map((a) => a.id));
        const lignesP = (pl ?? []) as { id: string; affaire_id: string }[];
        if (lignesP.length > 0) {
          const { data: pm } = await supabase.from("prestation_mois").select("ligne_id,mois,montant_fige").eq("valide", true).in("ligne_id", lignesP.map((l) => l.id));
          const numeroDe = new Map(famille.map((a) => [a.id, a.numero.toUpperCase().replace(/^0+/, "")]));
          const affaireDe = new Map(lignesP.map((l) => [l.id, l.affaire_id]));
          for (const x of (pm ?? []) as { ligne_id: string; mois: string; montant_fige: number | string | null }[]) {
            const k = numeroDe.get(affaireDe.get(x.ligne_id) ?? "") ?? "";
            if (!k) continue;
            releve.set(k, (releve.get(k) ?? 0) + n(x.montant_fige));
            const liste = releveMois.get(k) ?? [];
            const m = String(x.mois).slice(0, 7);
            const e = liste.find((y) => y.mois === m);
            if (e) e.montant += n(x.montant_fige);
            else liste.push({ mois: m, montant: n(x.montant_fige) });
            releveMois.set(k, liste);
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

      // ECHEANCIER_FICHE : chaque commande ou avenant, puis ses échéances / lots (ou ses mois de relevé)
      const ech: LigneFacture[] = [];
      const nature = (g: string) => (g === "BASE" ? "Commande" : g === "AVENANT" ? "Avenant" : g === "ECHEANCE" ? "Échéance" : g === "LOT" ? "Lot" : g);
      for (const l of ls.filter((x) => x.genre === "BASE" || x.genre === "AVENANT").sort((a, b) => String(a.numero_affaire ?? a.cle).localeCompare(String(b.numero_affaire ?? b.cle), "fr", { numeric: true }))) {
        const num = String(l.numero_affaire ?? l.cle).toUpperCase().replace(/^CBE\s*/, "").replace(/^0+/, "");
        ech.push({ cle: l.cle, niveau: 0, numero: l.numero_affaire ?? l.cle, nature: nature(l.genre), statut: l.statut ?? "", montant: n(montants.get(l.id)?.montant), facturee: l.date_livraison, prevue: l.delai ?? l.date_livraison_estimee });
        for (const d of enfants(l.cle).sort((a, b) => a.cle.localeCompare(b.cle, "fr", { numeric: true }))) {
          const md = montants.get(d.id);
          ech.push({ parent: l.cle, cle: d.cle, niveau: 1, numero: d.numero_affaire ?? d.cle, nature: nature(d.genre), statut: d.statut ?? "", montant: md ? n(md.montant_echeances) || n(md.montant) : 0, facturee: d.date_livraison, prevue: d.delai ?? d.date_livraison_estimee });
        }
        for (const m of (releveMois.get(num) ?? []).sort((a, b) => a.mois.localeCompare(b.mois)))
          ech.push({ parent: l.cle, cle: `${l.cle}|${m.mois}`, niveau: 1, numero: `Relevé ${m.mois.slice(5, 7)}/${m.mois.slice(0, 4)}`, nature: "Mois clôturé (PE / PI)", statut: "Clôturé", montant: m.montant, facturee: `${m.mois}-01`, prevue: null, releve: true });
      }

      if (!actif) return;
      setEcheancier(ech);
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
        <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#a30000" }}>③ L’argent</h2>
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
      <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "#a30000" }}>③ L’argent <span style={{ fontSize: 14, fontWeight: 400, color: gris }}>montants, facturation, négoce</span></h2>
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

      {/* COUT_DEPASSEMENT : le dépassement prévu, chiffré au coût de structure */}
      {depassementPrevu > 0.5 && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: "#fdecec", border: "1px solid #e5a3a3", borderRadius: 8, fontSize: 14, color: "#7a1d1d" }}>
          ⚠ Dépassement prévu : <strong>{heures(depassementPrevu)}</strong>
          {coutHoraire !== null ? (
            <>
              {" "}× {euros(coutHoraire)} / h = <strong>{euros(depassementPrevu * coutHoraire)}</strong> de coût non vendu
            </>
          ) : (
            " (coût de structure de l’exercice non saisi dans les Finances)"
          )}
          .
        </div>
      )}

      {/* ECHEANCIER_FICHE : ce qui est facturé, et quand ; ce qui reste à facturer */}
      {echeancier.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <strong style={{ fontSize: 15 }}>Facturation, ligne par ligne</strong>
          <span style={{ fontSize: 13, color: gris }}> · commande, avenants, et leurs échéances ou lots ; pour une PE / PI, les mois clôturés du relevé</span>
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
            <thead>
              <tr>
                <th style={th}>N°</th>
                <th style={th}>Nature</th>
                <th style={th}>Statut</th>
                <th style={thN}>Montant</th>
                <th style={th}>Facturé le</th>
              </tr>
            </thead>
            <tbody>
              {echeancier.map((e) => {
                const enfantsE = echeancier.filter((x) => x.parent === e.cle);
                const aDesEnfants = e.niveau === 0 && enfantsE.length > 0;
                const date = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR", e.releve ? { month: "long", year: "numeric" } : undefined) : "");
                return (
                  <tr key={e.cle} style={{ background: e.niveau === 0 ? "#fafbfc" : undefined }}>
                    <td style={{ ...td, paddingLeft: e.niveau === 1 ? 26 : 8, fontWeight: e.niveau === 0 ? 800 : 600, color: e.niveau === 0 ? "#a30000" : "#3b4046", whiteSpace: "nowrap" }}>
                      {e.niveau === 1 ? "↳ " : ""}
                      {e.numero}
                    </td>
                    <td style={{ ...td, color: gris, fontSize: 13 }}>{e.nature}</td>
                    <td style={td}>{e.statut || "—"}</td>
                    <td style={{ ...tdN, fontWeight: e.niveau === 0 ? 800 : 600 }}>{e.montant > 0.5 ? euros(e.montant) : "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {e.facturee ? (
                        <span style={{ color: "#1b5e20", fontWeight: 700 }}>✓ {date(e.facturee)}</span>
                      ) : aDesEnfants ? (
                        <span style={{ color: gris, fontSize: 13 }}>{enfantsE.some((x) => x.releve) ? "au relevé, mois par mois" : "par ses échéances"}</span>
                      ) : (
                        <span style={{ color: "#8a6500" }}>à facturer{e.prevue ? ` · prévu le ${date(e.prevue)}` : ""}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* par activité : montant et heures commandés, prix vendu, heures pointées, € / h obtenu */}
      {disciplines.some((d) => d.montant > 0.5) && (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <strong style={{ fontSize: 15 }}>Chiffré par activité, et taux de vente</strong>
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
              {(() => {
                // total des études (hors négoce) : montant, heures, taux moyen
                const etudes = disciplines.filter((d) => d.cle !== "negoce");
                const m = etudes.reduce((t, d) => t + d.montant, 0);
                const h = etudes.reduce((t, d) => t + (d.heures ?? 0), 0);
                const ps = etudes.map(pointeDe);
                const p = ps.every((x) => x === null) ? null : ps.reduce<number>((t, x) => t + (x ?? 0), 0);
                const bord = { borderTop: "2px solid #d5d9de" };
                return (
                  <tr>
                    <td style={{ ...td, ...bord, fontWeight: 800 }}>Total des études</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{euros(m)}</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{h > 0.05 ? heures(h) : "—"}</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{h > 0.05 ? `${euros(m / h)} / h` : "—"}</td>
                    <td style={{ ...tdN, ...bord }}>{p !== null && p > 0.05 ? heures(p) : "—"}</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{p !== null && p > 0.05 ? `${euros(m / p)} / h` : "—"}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
            Prix vendu = montant ÷ heures commandées. € / h obtenu = montant ÷ heures pointées (en rouge s’il est inférieur de plus de 10 % au prix vendu).
          </p>
        </div>
      )}

      {/* NEGOCE_RECAP : vendu, acheté, marge brute, temps passé et marge résiduelle */}
      {(vendu > 0.5 || achete > 0.5) &&
        (() => {
          const brute = vendu - achete;
          const coutTemps = coutHoraire !== null && heuresNegoce > 0.05 ? heuresNegoce * coutHoraire : null;
          const residuelle = coutTemps !== null ? brute - coutTemps : null;
          const pc = (x: number) => (vendu > 0 ? ` (${Math.round((x / vendu) * 100)} %)` : "");
          const ligne = (lib: string, valeur: string, couleur?: string, aide?: string, gras?: boolean) => (
            <tr title={aide}>
              <td style={{ ...td, fontWeight: gras ? 800 : 400 }}>{lib}</td>
              <td style={{ ...tdN, fontWeight: gras ? 800 : 600, color: couleur }}>{valeur}</td>
            </tr>
          );
          return (
            <div style={{ marginTop: 16, maxWidth: 560 }}>
              <strong style={{ fontSize: 15 }}>Négoce</strong>
              <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
                <tbody>
                  {ligne("Vendu", euros(vendu), undefined, undefined, true)}
                  {ligne("Acheté (prévu au Suivi d’affaire)", `− ${euros(achete)}`, "#7a3e00")}
                  {achatsRecus !== null && ligne("dont déjà reçu (saisi)", euros(achatsRecus), gris, "Achats reçus saisis dans l’analyse du chiffré")}
                  {ligne("Marge brute", `${euros(brute)}${pc(brute)}`, brute < 0 ? "#b3261e" : "#1b5e20", "Vendu − acheté", true)}
                  {heuresNegoce > 0.05 &&
                    ligne(
                      `Temps passé sur le négoce : ${heures(heuresNegoce)}${coutHoraire !== null ? ` × ${euros(coutHoraire)} / h` : ""}`,
                      coutTemps !== null ? `− ${euros(coutTemps)}` : "coût horaire non saisi",
                      "#7a3e00",
                      "Heures pointées sur l’activité Négoce × coût de structure de l’exercice"
                    )}
                  {residuelle !== null && ligne("Marge résiduelle", `${euros(residuelle)}${pc(residuelle)}`, residuelle < 0 ? "#b3261e" : "#1b5e20", "Marge brute − coût du temps passé", true)}
                </tbody>
              </table>
            </div>
          );
        })()}
    </section>
  );
}
