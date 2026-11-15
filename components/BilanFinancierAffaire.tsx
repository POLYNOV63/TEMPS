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
     lots, mois du relevé ; facturé le… ou à facturer, prévu au délai
     ESTIMÉ (délai client pour mémoire, DELAIS_FICHE) (ECHEANCIER_FICHE).

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
type Commande = { numero: string; statut: string; montant: number; etudes: number; negoce: number; achats: number; facture: number; parReleve: boolean; parMois: Map<string, number> };
/* ECHEANCIER_FICHE : chaque ligne facturable de la famille (commande, avenant, échéance, lot, mois du relevé) */
type LigneFacture = { cle: string; niveau: 0 | 1; numero: string; nature: string; statut: string; montant: number; facturee: string | null; prevue: string | null; client?: string | null; releve?: boolean; parent?: string };
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

  pointeParMois,
  pointeTotal = 0,
  planifie = 0,
  chiffre = 0,
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
  /* MARGES_FICHE : heures pointées mois par mois (« 2026-11 »), au total, planifiées à venir, chiffrées */
  pointeParMois?: Map<string, number>;
  pointeTotal?: number;
  planifie?: number;
  chiffre?: number;
}) {
  const [autorise, setAutorise] = useState(false);
  const [message, setMessage] = useState("");
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [, setEcheancier] = useState<LigneFacture[]>([]);
  const [coutHoraire, setCoutHoraire] = useState<number | null>(null);
  const [coutAnnee, setCoutAnnee] = useState<number | null>(null);
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
        if (actif) {
          setCoutHoraire(c ? c.cout : null);
          setCoutAnnee(c ? c.annee : null);
        }
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
          /* FACTURE_MOIS : relevé clôturé mois par mois ; sinon échéances / lots livrés à leur mois, et le solde
             de la commande au mois de sa livraison */
          const parMois = new Map<string, number>();
          const ajoute = (date: string | null, v: number) => {
            if (!date || Math.abs(v) < 0.5) return;
            const m = date.slice(0, 7);
            parMois.set(m, (parMois.get(m) ?? 0) + v);
          };
          if (viaReleve !== undefined) {
            for (const x of releveMois.get(num) ?? []) ajoute(`${x.mois}-01`, x.montant);
          } else {
            let dejaEch = 0;
            for (const d of enfants(l.cle).filter((x) => x.date_livraison)) {
              const md = montants.get(d.id);
              const v = md ? n(md.montant_echeances) || n(md.montant) : 0;
              dejaEch += v;
              ajoute(d.date_livraison, v);
            }
            if (l.date_livraison) ajoute(l.date_livraison, n(m?.montant) - dejaEch);
          }
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
            parMois,
          };
        })
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));

      // ECHEANCIER_FICHE : chaque commande ou avenant, puis ses échéances / lots (ou ses mois de relevé)
      const ech: LigneFacture[] = [];
      const nature = (g: string) => (g === "BASE" ? "Commande" : g === "AVENANT" ? "Avenant" : g === "ECHEANCE" ? "Échéance" : g === "LOT" ? "Lot" : g);
      for (const l of ls.filter((x) => x.genre === "BASE" || x.genre === "AVENANT").sort((a, b) => String(a.numero_affaire ?? a.cle).localeCompare(String(b.numero_affaire ?? b.cle), "fr", { numeric: true }))) {
        const num = String(l.numero_affaire ?? l.cle).toUpperCase().replace(/^CBE\s*/, "").replace(/^0+/, "");
        ech.push({ cle: l.cle, niveau: 0, numero: l.numero_affaire ?? l.cle, nature: nature(l.genre), statut: l.statut ?? "", montant: n(montants.get(l.id)?.montant), facturee: l.date_livraison, prevue: l.date_livraison_estimee ?? l.delai, client: l.delai });
        for (const d of enfants(l.cle).sort((a, b) => a.cle.localeCompare(b.cle, "fr", { numeric: true }))) {
          const md = montants.get(d.id);
          ech.push({ parent: l.cle, cle: d.cle, niveau: 1, numero: d.numero_affaire ?? d.cle, nature: nature(d.genre), statut: d.statut ?? "", montant: md ? n(md.montant_echeances) || n(md.montant) : 0, facturee: d.date_livraison, prevue: d.date_livraison_estimee ?? d.delai, client: d.delai });
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
        <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#a30000" }}>Financier</h2>
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
      <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "#a30000" }}>Financier <span style={{ fontSize: 14, fontWeight: 400, color: gris }}>facturé, marges, taux de vente</span></h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: gris }}>
        D’après le Suivi d’affaire BE (commande et avenants) et, pour les PE / PI, les mois clôturés du relevé. Visible selon la fonction « Montants des affaires » (Droits d’accès).
      </p>

      {/* MARGES_FICHE : où on en est, et où ça mène */}
      {(() => {
        const M = somme((c) => c.montant);
        const F = somme((c) => c.facture);
        const A = achete;
        const mois = [...new Set(commandes.flatMap((c) => [...c.parMois.keys()]))].sort();
        const dernierMois = mois[mois.length - 1] ?? null;
        const heuresAuFacture = dernierMois && pointeParMois ? [...pointeParMois.entries()].filter(([m]) => m <= dernierMois).reduce((t, [, h]) => t + h, 0) : 0;
        const achatsFactures = M > 0.5 ? A * Math.min(1, F / M) : 0;
        const margeFacturee = coutHoraire !== null && F > 0.5 ? F - heuresAuFacture * coutHoraire - achatsFactures : null;
        const heuresFin = pointeTotal + planifie;
        const margePrevue = coutHoraire !== null && M > 0.5 ? M - heuresFin * coutHoraire - A : null;
        const margeSiChiffre = coutHoraire !== null && M > 0.5 && chiffre > heuresFin + 0.5 ? M - chiffre * coutHoraire - A : null;
        const pc = (v: number, base: number) => (base > 0.5 ? ` · ${Math.round((v / base) * 100)} %` : "");
        const tuile = (titre: string, valeur: string, sous: string, couleur = "#1f2328") => (
          <div style={{ flex: "1 1 170px", border: "1px solid #e3e6ea", borderLeft: `4px solid ${couleur}`, borderRadius: 10, padding: "8px 12px", background: "#fcfcfd" }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: gris }}>{titre}</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: couleur }}>{valeur}</div>
            <div style={{ fontSize: 12, color: gris }}>{sous}</div>
          </div>
        );
        const couleurMarge = (v: number | null) => (v === null ? "#5b6168" : v < 0 ? "#b3261e" : "#1b5e20");
        const thM: CSSProperties = { ...thN, textAlign: "right" };
        const ligneTotal: CSSProperties = { borderTop: "2px solid #d5d9de", fontWeight: 800 };
        let cumul = 0;
        return (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
              {tuile("Commandé", euros(M), `${commandes.length} commande${commandes.length > 1 ? "s" : ""}${A > 0.5 ? ` · dont achats ${euros(A)}` : ""}`)}
              {tuile("Facturé à ce jour", euros(F), dernierMois ? `jusqu’à ${new Date(`${dernierMois}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}` : "rien encore", "#1b5e20")}
              {tuile("Reste à facturer", euros(Math.max(0, M - F)), M - F < -0.5 ? `facturé au-delà de la commande : ${euros(F - M)}` : "commandé − facturé", "#8a6500")}
              {tuile(
                "Marge sur le facturé",
                margeFacturee === null ? "—" : euros(margeFacturee),
                coutHoraire === null ? "coût de structure non saisi" : F <= 0.5 ? "rien de facturé pour l’instant" : `${euros(F)} − ${heures(heuresAuFacture)} × ${euros(coutHoraire)}${achatsFactures > 0.5 ? " − achats" : ""}${pc(margeFacturee ?? 0, F)}`,
                couleurMarge(margeFacturee)
              )}
              {tuile(
                "Marge prévue",
                margePrevue === null ? "—" : euros(margePrevue),
                coutHoraire === null
                  ? "coût de structure non saisi"
                  : `pointé + planifié : ${heures(heuresFin)}${pc(margePrevue ?? 0, M)}${margeSiChiffre !== null ? ` · si tout le chiffré est consommé : ${euros(margeSiChiffre)}` : ""}`,
                couleurMarge(margePrevue)
              )}
            </div>

            {/* FACTURE_MOIS : chaque mois, ce qui est facturé sur chaque commande ; en bas, le commandé et le reste */}
            <strong style={{ fontSize: 16, color: "#a30000" }}>Facturé mois par mois</strong>
            <span style={{ fontSize: 13, color: gris }}> · face à chaque commande et avenant</span>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Mois</th>
                    {commandes.map((c) => (
                      <th key={c.numero} style={thM} title={c.statut}>
                        CBE{c.numero.replace(/^CBE\s*/i, "")}
                        <div style={{ fontSize: 11, fontWeight: 600, color: c.statut === "Intention de commande" ? "#8a6500" : gris }}>{c.statut || "—"}</div>
                      </th>
                    ))}
                    {commandes.length > 1 && <th style={thM}>Total du mois</th>}
                    <th style={thM}>Cumul</th>
                  </tr>
                </thead>
                <tbody>
                  {mois.length === 0 ? (
                    <tr>
                      <td colSpan={commandes.length + 3} style={{ ...td, color: gris }}>
                        Rien de facturé pour l’instant.
                      </td>
                    </tr>
                  ) : (
                    mois.map((m) => {
                      const totalMois = commandes.reduce((t, c) => t + (c.parMois.get(m) ?? 0), 0);
                      cumul += totalMois;
                      return (
                        <tr key={m}>
                          <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}</td>
                          {commandes.map((c) => (
                            <td key={c.numero} style={tdN}>
                              {c.parMois.get(m) ? euros(c.parMois.get(m)!) : ""}
                            </td>
                          ))}
                          {commandes.length > 1 && <td style={{ ...tdN, fontWeight: 700 }}>{euros(totalMois)}</td>}
                          <td style={{ ...tdN, color: gris }}>{euros(cumul)}</td>
                        </tr>
                      );
                    })
                  )}
                  <tr>
                    <td style={{ ...td, ...ligneTotal, color: "#1b5e20" }}>Facturé</td>
                    {commandes.map((c) => (
                      <td key={c.numero} style={{ ...tdN, ...ligneTotal, color: "#1b5e20" }}>
                        {c.facture > 0.5 ? euros(c.facture) : "—"}
                      </td>
                    ))}
                    {commandes.length > 1 && <td style={{ ...tdN, ...ligneTotal, color: "#1b5e20" }}>{euros(F)}</td>}
                    <td style={{ ...tdN, ...ligneTotal }} />
                  </tr>
                  <tr>
                    <td style={{ ...td, fontWeight: 800 }}>Commandé</td>
                    {commandes.map((c) => (
                      <td key={c.numero} style={{ ...tdN, fontWeight: 800 }}>
                        {c.montant > 0.5 ? euros(c.montant) : "—"}
                      </td>
                    ))}
                    {commandes.length > 1 && <td style={{ ...tdN, fontWeight: 800 }}>{euros(M)}</td>}
                    <td style={tdN} />
                  </tr>
                  <tr>
                    <td style={{ ...td, fontWeight: 800, color: "#8a6500" }}>Reste à facturer</td>
                    {commandes.map((c) => {
                      const r = c.montant - c.facture;
                      return (
                        <td key={c.numero} style={{ ...tdN, fontWeight: 800, color: r < -0.5 ? "#b3261e" : r > 0.5 ? "#8a6500" : "#1b5e20" }}>
                          {r > 0.5 ? euros(r) : r < -0.5 ? `− ${euros(-r)}` : c.montant > 0.5 ? "✓ soldé" : "—"}
                        </td>
                      );
                    })}
                    {commandes.length > 1 && <td style={{ ...tdN, fontWeight: 800, color: "#8a6500" }}>{euros(M - F)}</td>}
                    <td style={tdN} />
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: gris, margin: "6px 0 16px" }}>
              Forfait : facturé au mois de livraison de chaque échéance, lot ou commande (Suivi d’affaire BE). PE / PI : mois clôturés du relevé. Marge sur le facturé = facturé − heures pointées jusqu’au dernier mois facturé × coût de structure
              {coutAnnee ? ` (${euros(coutHoraire ?? 0)} / h, exercice ${coutAnnee}-${coutAnnee + 1})` : ""}
              {A > 0.5 ? " − la part des achats correspondant au facturé" : ""}. Marge prévue = commandé − (pointé + planifié) × coût
              {A > 0.5 ? " − achats" : ""}.
            </p>
          </>
        );
      })()}

      {/* par activité : montant et heures commandés, prix vendu, heures pointées, € / h obtenu */}
      {disciplines.some((d) => d.montant > 0.5) && (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          {/* MARGE_ACTIVITE : taux de vente et marge face au coût de structure (Finances) */}
          <strong style={{ fontSize: 15 }}>Chiffré par activité : taux de vente et marge</strong>
          <span style={{ fontSize: 13, color: gris }}>
            {" "}
            · coût de structure {coutHoraire !== null ? `${euros(coutHoraire)} / h${coutAnnee ? ` (exercice ${coutAnnee}-${coutAnnee + 1})` : ""}` : "non saisi dans les Finances"}
          </span>
          {(() => {
            const pcCout = (taux: number | null) => (taux !== null && coutHoraire ? Math.round((taux / coutHoraire - 1) * 100) : null);
            const tauxCellule = (taux: number | null, gras: boolean, plus: CSSProperties = {}) => {
              if (taux === null) return <td style={{ ...tdN, ...plus }}>—</td>;
              const pc = pcCout(taux);
              return (
                <td style={{ ...tdN, fontWeight: gras ? 800 : 600, ...plus }}>
                  {euros(taux)} / h
                  {pc !== null && <span style={{ fontSize: 12, fontWeight: 700, color: pc < 0 ? "#b3261e" : pc < 15 ? "#8a4b00" : "#1b5e20" }}> {pc >= 0 ? "+" : ""}{pc} %</span>}
                </td>
              );
            };
            const margeCellule = (montant: number, h: number | null, gras: boolean, plus: CSSProperties = {}) => {
              if (coutHoraire === null || !h || h <= 0.05 || montant <= 0.5) return <td style={{ ...tdN, ...plus }}>—</td>;
              const m = montant - h * coutHoraire;
              return (
                <td style={{ ...tdN, fontWeight: gras ? 800 : 700, color: m < 0 ? "#b3261e" : "#1b5e20", ...plus }}>
                  {euros(m)}
                  <span style={{ fontSize: 12, fontWeight: 600 }}> · {Math.round((m / montant) * 100)} %</span>
                </td>
              );
            };
            const etudes = disciplines.filter((d) => d.cle !== "negoce");
            const mE = etudes.reduce((t, d) => t + d.montant, 0);
            const hE = etudes.reduce((t, d) => t + (d.heures ?? 0), 0);
            const psE = etudes.map(pointeDe);
            const pE = psE.every((x) => x === null) ? null : psE.reduce<number>((t, x) => t + (x ?? 0), 0);
            const bord: CSSProperties = { borderTop: "2px solid #d5d9de" };
            return (
              <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
                <thead>
                  <tr>
                    <th style={th}>Activité</th>
                    <th style={thN}>Montant commandé</th>
                    <th style={thN}>Heures commandées</th>
                    <th style={thN} title="Montant ÷ heures commandées, et écart au coût de structure">Taux de vente</th>
                    <th style={thN} title="Montant − heures commandées × coût de structure">Marge prévue</th>
                    <th style={thN}>Heures pointées</th>
                    <th style={thN} title="Montant ÷ heures pointées, et écart au coût de structure">Taux obtenu</th>
                    <th style={thN} title="Montant − heures pointées × coût de structure">Marge sur le pointé</th>
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
                          {tauxCellule(vendu, false)}
                          {margeCellule(d.montant, d.heures, false)}
                          <td style={tdN}>{p !== null && p > 0.05 ? heures(p) : "—"}</td>
                          {tauxCellule(obtenu, false)}
                          {margeCellule(d.montant, p, false)}
                        </tr>
                      );
                    })}
                  <tr>
                    <td style={{ ...td, ...bord, fontWeight: 800 }}>Total des études</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{euros(mE)}</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{hE > 0.05 ? heures(hE) : "—"}</td>
                    {tauxCellule(hE > 0.05 ? mE / hE : null, true, bord)}
                    {margeCellule(mE, hE, true, bord)}
                    <td style={{ ...tdN, ...bord }}>{pE !== null && pE > 0.05 ? heures(pE) : "—"}</td>
                    {tauxCellule(pE !== null && pE > 0.05 ? mE / pE : null, true, bord)}
                    {margeCellule(mE, pE, true, bord)}
                  </tr>
                </tbody>
              </table>
            );
          })()}
          <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
            Taux de vente = montant ÷ heures commandées ; taux obtenu = montant ÷ heures pointées ; le % à côté du taux = écart au coût de structure (rouge en dessous, orange moins de 15 % au-dessus). Marge = montant − heures × coût de structure ; tant que l’affaire n’est pas finie, la marge sur le pointé baisse à mesure qu’on pointe.
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
