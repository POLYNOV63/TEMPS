"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";
import type { CommandePEPI } from "@/components/HistoriquePEPI";

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
  date_reception_commande: string | null;
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
type Commande = {
  numero: string;
  statut: string;
  montant: number;
  etudes: number;
  negoce: number;
  achats: number;
  facture: number;
  parReleve: boolean;
  parMois: Map<string, number>;
  heures: number; // heures chiffrées de la ligne du Suivi d'affaire
  livree: boolean;
  prevue: string | null; // délai estimé, sinon délai client
};
/* ECHEANCIER_FICHE : chaque ligne facturable de la famille (commande, avenant, échéance, lot, mois du relevé) */
type LigneFacture = {
  cle: string;
  niveau: 0 | 1;
  numero: string;
  nature: string;
  statut: string;
  montant: number;
  facturee: string | null;
  prevue: string | null;
  client?: string | null;
  releve?: boolean;
  parent?: string;
  recue?: string | null; // RYTHME_FACTURATION : réception de la commande (celle de la mère pour une échéance)
  livraisonMere?: string | null; // livraison de la commande mère : une échéance facturée avant est un acompte
};
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
  heuresTrajets = 0,

  pointeTotal = 0,
  planifie = 0,
  chiffre = 0,
  pointeParMois,
  pepi = null,
  planifieParActivite,
  planifieNegoce = 0,
}: {
  type: string;
  numero: string;
  /* heures pointées par activité (id d'activité), et colonne du Suivi d'affaire -> activité */
  realiseParActivite?: Map<string, number>;
  correspondance?: Map<string, string>;
  /* heures pointées sur le négoce (activité Négoce), pour la marge résiduelle */
  heuresNegoce?: number;
  heuresTrajets?: number; // TRAJETS_A_PART : heures de trajet (code HT), comprises dans pointeTotal
  /* heures de dépassement prévu (pointé + planifié − chiffré), pour en chiffrer le coût */
  depassementPrevu?: number;
  /* MARGES_FICHE : heures pointées mois par mois (« 2026-11 »), au total, planifiées à venir, chiffrées */
  pointeParMois?: Map<string, number>;
  pointeTotal?: number;
  planifie?: number;
  chiffre?: number;
  /* MARGES_DETAIL : heures planifiées à venir, mois par mois ; PE / PI ou forfait */
  planifieParMois?: Map<string, number>;
  prestation?: boolean;
  /* PE / PI : le relevé commande par commande, mois par mois (FACTURE_PEPI) */
  pepi?: CommandePEPI[] | null;
  /* MARGE_UNIQUE : heures planifiées à venir par activité (id), et sur le négoce */
  planifieParActivite?: Map<string, number>;
  planifieNegoce?: number;
}) {
  const [autorise, setAutorise] = useState(false);
  const [message, setMessage] = useState("");
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [echeancier, setEcheancier] = useState<LigneFacture[]>([]);
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
        .select("id,cle,genre,parent_cle,numero_affaire,statut,disparue,date_livraison,date_reception_commande,delai,date_livraison_estimee,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre")
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
            heures: n(l.heures_meca) + n(l.heures_calcul) + n(l.heures_elec) + n(l.heures_pneu) + n(l.heures_scan) + n(l.heures_autre),
            livree: Boolean(l.date_livraison) || /livr/i.test(l.statut ?? ""),
            prevue: l.date_livraison_estimee ?? l.delai,
          };
        })
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));

      // ECHEANCIER_FICHE : chaque commande ou avenant, puis ses échéances / lots (ou ses mois de relevé)
      const ech: LigneFacture[] = [];
      const nature = (g: string) => (g === "BASE" ? "Commande" : g === "AVENANT" ? "Avenant" : g === "ECHEANCE" ? "Échéance" : g === "LOT" ? "Lot" : g);
      for (const l of ls.filter((x) => x.genre === "BASE" || x.genre === "AVENANT").sort((a, b) => String(a.numero_affaire ?? a.cle).localeCompare(String(b.numero_affaire ?? b.cle), "fr", { numeric: true }))) {
        const num = String(l.numero_affaire ?? l.cle).toUpperCase().replace(/^CBE\s*/, "").replace(/^0+/, "");
        ech.push({ cle: l.cle, niveau: 0, numero: l.numero_affaire ?? l.cle, nature: nature(l.genre), statut: l.statut ?? "", montant: n(montants.get(l.id)?.montant), facturee: l.date_livraison, prevue: l.date_livraison_estimee ?? l.delai, client: l.delai, recue: l.date_reception_commande });
        for (const d of enfants(l.cle).sort((a, b) => a.cle.localeCompare(b.cle, "fr", { numeric: true }))) {
          const md = montants.get(d.id);
          ech.push({ parent: l.cle, cle: d.cle, niveau: 1, numero: d.numero_affaire ?? d.cle, nature: nature(d.genre), statut: d.statut ?? "", montant: md ? n(md.montant_echeances) || n(md.montant) : 0, facturee: d.date_livraison, prevue: d.date_livraison_estimee ?? d.delai, client: d.delai, recue: l.date_reception_commande, livraisonMere: l.date_livraison });
        }
        for (const m of (releveMois.get(num) ?? []).sort((a, b) => a.mois.localeCompare(b.mois)))
          ech.push({ parent: l.cle, cle: `${l.cle}|${m.mois}`, niveau: 1, numero: `Relevé ${m.mois.slice(5, 7)}/${m.mois.slice(0, 4)}`, nature: "Mois clôturé (PE / PI)", statut: "Clôturé", montant: m.montant, facturee: `${m.mois}-01`, prevue: null, releve: true, recue: l.date_reception_commande });
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
      <h2 style={{ margin: "0 0 4px", fontSize: 20, color: "#a30000" }}>Financier <span style={{ fontSize: 14, fontWeight: 400, color: gris }}>facturation, rentabilité, négoce</span></h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: gris }}>
        D’après le Suivi d’affaire BE (commande et avenants) et, pour les PE / PI, les mois clôturés du relevé. Visible selon la fonction « Montants des affaires » (Droits d’accès).
      </p>

      {/* MARGE_PROJETEE : où va la marge, en € et en %, avec le pointé et le planifié */}
      {(() => {
        const M = somme((c) => c.montant);
        const A = achete;
        const toutesLivrees = commandes.length > 0 && commandes.every((c) => /livr/i.test(c.statut));
        const F = somme((c) => c.facture);
        const recette = toutesLivrees ? F : M;
        const engage = coutHoraire !== null ? pointeTotal * coutHoraire : null;
        const aEngager = coutHoraire !== null ? (toutesLivrees ? 0 : planifie * coutHoraire) : null;
        const marge = engage !== null && aEngager !== null && recette > 0.5 ? recette - engage - aEngager - A : null;
        const reste = !toutesLivrees && chiffre > pointeTotal + planifie + 0.5 ? chiffre - pointeTotal - planifie : 0;
        const siChiffre = marge !== null && reste > 0 && coutHoraire !== null ? marge - reste * coutHoraire : null;
        const couleur = marge === null ? gris : marge < 0 ? "#b3261e" : "#1b5e20";
        const tuile = (titre: string, valeur: string, sousT: string) => (
          <div style={{ flex: "1 1 160px", border: "1px solid #e3e6ea", borderRadius: 10, padding: "8px 12px", background: "#fcfcfd" }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: gris }}>{titre}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{valeur}</div>
            <div style={{ fontSize: 12, color: gris }}>{sousT}</div>
          </div>
        );
        return (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div style={{ flex: "1 1 260px", border: `1px solid ${couleur}55`, borderLeft: `6px solid ${couleur}`, borderRadius: 10, padding: "10px 14px", background: marge !== null && marge < 0 ? "#fdecec" : "#f3faf3" }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: couleur }}>{toutesLivrees ? "Marge réelle (affaire livrée)" : "Marge projetée à la fin"}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: couleur }}>
                  {marge === null ? "—" : `${marge >= 0 ? "+ " : "− "}${euros(Math.abs(marge))}`}
                  {marge !== null && recette > 0.5 && <span style={{ fontSize: 20 }}> · {Math.round((marge / recette) * 100)} %</span>}
                </div>
                <div style={{ fontSize: 12.5, color: gris }}>
                  {coutHoraire === null ? "coût de structure non saisi dans les Finances" : toutesLivrees ? "facturé − pointé × coût − achats" : "commandé − (pointé + planifié) × coût − achats"}
                </div>
              </div>
              {tuile(toutesLivrees ? "Facturé" : "Commandé", euros(recette), `${commandes.length} commande${commandes.length > 1 ? "s" : ""}`)}
              {/* BANQUE : ce qu'on a facturé face à ce qu'on a déjà engagé */}
              {!toutesLivrees && (
                <div style={{ flex: "1 1 190px", border: "1px solid #e3e6ea", borderRadius: 10, padding: "8px 12px", background: "#fcfcfd" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: gris }}>Facturé à ce jour</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {euros(F)}
                    {M > 0.5 && <span style={{ fontSize: 14, color: gris }}> · {Math.round((F / M) * 100)} %</span>}
                  </div>
                  {engage !== null && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: engage - F > 0.5 ? "#b3261e" : "#1b5e20" }}>
                      {engage - F > 0.5 ? `on fait la banque : ${euros(engage - F)} engagés pas encore facturés` : `facturé d’avance : ${euros(F - engage)}`}
                    </div>
                  )}
                </div>
              )}
              {tuile("Déjà engagé", engage !== null ? euros(engage) : "—", `${heures(pointeTotal)} pointées${coutHoraire !== null ? ` × ${euros(coutHoraire)}` : ""}`)}
              {!toutesLivrees && tuile("Encore à engager", aEngager !== null ? euros(aEngager) : "—", `${heures(planifie)} planifiées`)}
              {A > 0.5 && tuile("Achats", euros(A), "scan, négoce")}
            </div>
            {siChiffre !== null && (
              <p style={{ fontSize: 13, color: "#8a4b00", margin: "8px 0 0" }}>
                Si le chiffré pas encore planifié est aussi consommé ({heures(reste)}) : {siChiffre >= 0 ? "+ " : "− "}
                {euros(Math.abs(siChiffre))}
                {recette > 0.5 ? ` · ${Math.round((siChiffre / recette) * 100)} %` : ""}.
              </p>
            )}
            <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
              Coût de structure {coutHoraire !== null ? `${euros(coutHoraire)} / h${coutAnnee ? ` (exercice ${coutAnnee}-${coutAnnee + 1})` : ""}` : "non saisi"}. La marge projetée baisse dès qu’on pointe ou planifie au-delà du chiffré.
            </p>
          </div>
        );
      })()}

      {/* FACTURE_PEPI : PE / PI : chaque mois, ce qui est facturé (ou à facturer, ou prévu) sur chaque commande ; face au pointé */}
      {pepi && pepi.length > 0 && (() => {
        const enJours = pepi.every((c) => c.unite === "JOUR");
        const bj = pepi[0].base || 7;
        const q = (h: number, c?: CommandePEPI) => (enJours ? `${(Math.round((h / (c?.base || bj)) * 10) / 10).toLocaleString("fr-FR")} j` : heures(h));
        const tousMois = [...new Set(pepi.flatMap((c) => [...c.mois.keys()].map((k) => k.slice(0, 7))))].sort();
        const cellule = (c: CommandePEPI, m: string) => {
          const xs = [...c.mois.entries()].filter(([k]) => k.startsWith(m)).map(([, x]) => x);
          return { h: xs.reduce((t, x) => t + x.heures, 0), e: xs.reduce((t, x) => t + x.montant, 0) };
        };
        let cumPt = 0;
        let cumFait = 0;
        let cumE = 0;
        const totalCmdE = pepi.reduce((t, c) => t + c.montant, 0);
        return (
          <>
            <strong style={{ fontSize: 16, color: "#a30000" }}>Facturation, mois par mois</strong>
            <span style={{ fontSize: 13, color: gris }}> · avenant par avenant, face au pointé</span>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Mois</th>
                    {pepi.map((c) => (
                      <th key={c.id} style={thN}>
                        CBE{c.numero}
                        {c.heuresCmd !== null && <span style={{ fontWeight: 600, color: gris }}> ({q(c.heuresCmd, c)})</span>}
                      </th>
                    ))}
                    <th style={thN}>Total</th>
                    <th style={th}>État</th>
                    <th style={thN}>Pointé</th>
                    <th style={th} title="Pointé − relevé, en cumul, sans le prévu">Écart pointé / relevé</th>
                  </tr>
                </thead>
                <tbody>
                  {tousMois.map((m) => {
                    const cs = pepi.map((c) => ({ c, ...cellule(c, m) }));
                    const totE = cs.reduce((t, x) => t + x.e, 0);
                    const etats = new Set(pepi.flatMap((c) => [...c.mois.entries()].filter(([k]) => k.startsWith(m)).map(([, x]) => x.etat)));
                    const fait = pepi.reduce((t, c) => t + [...c.mois.entries()].filter(([k, x]) => k.startsWith(m) && x.etat !== "PREVU").reduce((u, [, x]) => u + x.heures, 0), 0);
                    const pt = pointeParMois?.get(m) ?? 0;
                    const futur = etats.size === 1 && etats.has("PREVU");
                    cumPt += pt;
                    cumFait += fait;
                    cumE += totE;
                    const ecart = cumPt - cumFait;
                    const tol = bj * 0.05;
                    return (
                      <tr key={m} style={{ fontStyle: futur ? "italic" : undefined, background: futur ? "#fbfbfc" : undefined }}>
                        <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}</td>
                        {cs.map(({ c, h, e }) => (
                          <td key={c.id} style={tdN}>
                            {h > 0.05 ? (
                              <>
                                {q(h, c)}
                                {e > 0.5 && <span style={{ color: gris }}> · {euros(e)}</span>}
                              </>
                            ) : (
                              ""
                            )}
                          </td>
                        ))}
                        <td style={{ ...tdN, fontWeight: 800 }}>{totE > 0.5 ? euros(totE) : "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: futur ? gris : etats.has("A_FACTURER") ? "#8a6500" : "#1b5e20" }}>
                          {futur ? "prévu" : etats.has("A_FACTURER") ? (etats.has("PREVU") ? "à facturer + prévu" : "à facturer") : "facturé"}
                        </td>
                        <td style={tdN}>{pt > 0.05 ? q(pt) : futur ? "" : "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", color: Math.abs(ecart) <= tol ? "#1b5e20" : ecart > 0 ? "#b3261e" : "#7a3e00" }}>
                          {futur ? "" : Math.abs(ecart) <= tol ? "= à jour" : ecart > 0 ? `+ ${q(ecart)} pointés en plus` : `− ${q(-ecart)} pointés en moins`}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>Commandé</td>
                    {pepi.map((c) => (
                      <td key={c.id} style={{ ...tdN, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>
                        {c.heuresCmd !== null ? q(c.heuresCmd, c) : "—"}
                        {c.montant > 0.5 && <span style={{ color: gris, fontWeight: 600 }}> · {euros(c.montant)}</span>}
                      </td>
                    ))}
                    <td style={{ ...tdN, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{euros(totalCmdE)}</td>
                    <td colSpan={3} style={{ ...td, borderTop: "2px solid #d5d9de", color: gris, fontSize: 13 }}>
                      relevé, prévu compris : {euros(cumE)}
                      {Math.abs(totalCmdE - cumE) > 0.5 ? (totalCmdE > cumE ? ` · ${euros(totalCmdE - cumE)} pas encore au relevé` : ` · ${euros(cumE - totalCmdE)} au-delà du commandé`) : " · raccord ✓"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: gris, margin: "6px 0 16px" }}>
              En italique, le prévu au relevé (mois à venir). Mois non clôturés : montants estimés (heures × taux de la ligne). Écart pointé / relevé : + on a pointé plus que ce qui est facturé ou à facturer ; − moins.
            </p>
          </>
        );
      })()}

      {/* RYTHME_FACTURATION : chaque commande, échéance ou lot : reçue le, facturée le, en combien de jours */}
      {!(pepi && pepi.length > 0) && (() => {
        const M = somme((c) => c.montant);
        const F = somme((c) => c.facture);
        const jours = (a: string | null | undefined, b: string | null | undefined) =>
          a && b ? Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00`) - Date.parse(`${a.slice(0, 10)}T00:00:00`)) / 86400000) : null;
        const date = (d: string | null | undefined, mois = false) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR", mois ? { month: "long", year: "numeric" } : undefined) : "");
        const delais = echeancier.filter((e) => e.facturee && !e.releve).map((e) => jours(e.recue, e.facturee)).filter((x): x is number => x !== null && x >= 0);
        const moyenne = delais.length ? Math.round(delais.reduce((t, x) => t + x, 0) / delais.length) : null;
        return (
          <>
            <strong style={{ fontSize: 16, color: "#a30000" }}>Rythme de facturation</strong>
            <span style={{ fontSize: 13, color: gris }}>
              {" "}
              · facturé {euros(F)} sur {euros(M)}
              {moyenne !== null ? ` · en moyenne ${moyenne} jours de la commande reçue à sa facture` : ""}
            </span>
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>N°</th>
                    <th style={th}>Nature</th>
                    <th style={thN}>Montant</th>
                    <th style={th}>Reçue le</th>
                    <th style={th}>Facturée le</th>
                    <th style={thN} title="Nombre de jours entre la réception de la commande et sa facture (date de livraison au Suivi d’affaire)">Commande → facture</th>
                  </tr>
                </thead>
                <tbody>
                  {echeancier.map((e) => {
                    const enfantsE = echeancier.filter((x) => x.parent === e.cle);
                    const parSesEnfants = e.niveau === 0 && enfantsE.length > 0;
                    const j = e.facturee && !e.releve ? jours(e.recue, e.facturee) : null;
                    const acompte = e.niveau === 1 && !e.releve && e.facturee && (!e.livraisonMere || e.facturee < e.livraisonMere);
                    return (
                      <tr key={e.cle} style={{ background: e.niveau === 0 ? "#fafbfc" : undefined }}>
                        <td style={{ ...td, paddingLeft: e.niveau === 1 ? 26 : 8, fontWeight: e.niveau === 0 ? 800 : 600, color: e.niveau === 0 ? "#a30000" : "#3b4046", whiteSpace: "nowrap" }}>
                          {e.niveau === 1 ? "↳ " : ""}
                          {e.niveau === 0 ? `CBE${e.numero.replace(/^CBE\s*/i, "")}` : e.numero}{" "}
                          <span style={{ fontSize: 12, fontWeight: 600, color: e.statut === "Intention de commande" ? "#8a6500" : gris }}>{e.niveau === 0 ? e.statut : ""}</span>
                        </td>
                        <td style={{ ...td, color: gris, fontSize: 13 }}>{e.nature}</td>
                        <td style={{ ...tdN, fontWeight: e.niveau === 0 ? 800 : 600 }}>{e.montant > 0.5 ? euros(e.montant) : "—"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", color: e.niveau === 1 ? gris : undefined }}>{e.niveau === 0 ? date(e.recue) || "—" : ""}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {e.facturee ? (
                            <span style={{ color: "#1b5e20", fontWeight: 700 }}>✓ {date(e.facturee, e.releve)}</span>
                          ) : parSesEnfants ? (
                            <span style={{ color: gris, fontSize: 13 }}>{enfantsE.some((x) => x.releve) ? "au relevé, mois par mois" : "par ses échéances"}</span>
                          ) : (
                            <span style={{ color: "#8a6500" }}>à facturer{e.prevue ? ` · prévu le ${date(e.prevue)}` : ""}</span>
                          )}
                        </td>
                        <td style={{ ...tdN, fontWeight: 700 }}>
                          {acompte ? <span style={{ color: "#1f5fbf" }} title="Facturée avant la livraison de la commande">acompte{j !== null ? ` · ${j} j` : ""}</span> : j !== null ? `${j} j` : e.releve ? <span style={{ color: gris, fontWeight: 400 }}>mois clôturé</span> : ""}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={2} style={{ ...td, fontWeight: 800, color: "#8a6500", borderTop: "2px solid #d5d9de" }}>
                      Reste à facturer
                    </td>
                    <td style={{ ...tdN, fontWeight: 800, color: M - F < -0.5 ? "#b3261e" : "#8a6500", borderTop: "2px solid #d5d9de" }}>{M - F < -0.5 ? `− ${euros(F - M)}` : euros(Math.max(0, M - F))}</td>
                    <td colSpan={3} style={{ ...td, borderTop: "2px solid #d5d9de" }} />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {/* par activité : montant et heures commandés, prix vendu, heures pointées, € / h obtenu */}
      {disciplines.some((d) => d.montant > 0.5) && (
        <div style={{ overflowX: "auto", marginTop: 18 }}>
          {/* MARGE_UNIQUE : par activité, la même marge projetée que la grande tuile (pointé + planifié × coût) ;
              le total « Toute l'affaire » retombe exactement sur la tuile */}
          <strong style={{ fontSize: 16, color: "#a30000" }}>Taux de vente et marge projetée, par activité</strong>
          {(() => {
            const M = somme((c) => c.montant);
            const F = somme((c) => c.facture);
            const toutesLivrees = commandes.length > 0 && commandes.every((c) => /livr/i.test(c.statut));
            const C = coutHoraire;
            const planDe = (d: Discipline) => {
              if (toutesLivrees || !planifieParActivite || !correspondance) return 0;
              const ids = new Set(d.colonnes.map((c) => correspondance.get(c)).filter((x): x is string => Boolean(x)));
              return [...ids].reduce((t, id) => t + (planifieParActivite.get(id) ?? 0), 0);
            };
            const pcCout = (taux: number | null) => (taux !== null && C ? Math.round((taux / C - 1) * 100) : null);
            const taux = (t: number | null) => {
              if (t === null) return <td style={tdN}>—</td>;
              const pc = pcCout(t);
              return (
                <td style={{ ...tdN, fontWeight: 600 }}>
                  {euros(t)} / h
                  {pc !== null && <span style={{ fontSize: 12, fontWeight: 700, color: pc < 0 ? "#b3261e" : pc < 15 ? "#8a4b00" : "#1b5e20" }}> {pc >= 0 ? "+" : ""}{pc} %</span>}
                </td>
              );
            };
            const marge = (m: number, base: number, gras = false, plus: CSSProperties = {}) => (
              <td style={{ ...tdN, fontWeight: gras ? 800 : 700, color: m < 0 ? "#b3261e" : "#1b5e20", ...plus }}>
                {m >= 0 ? "+ " : "− "}
                {euros(Math.abs(m))}
                {base > 0.5 && <span style={{ fontSize: 12, fontWeight: 600 }}> · {Math.round((m / base) * 100)} %</span>}
              </td>
            );
            if (C === null) return <p style={{ color: gris, margin: "6px 0" }}>Coût de structure non saisi dans les Finances : pas de marge calculable.</p>;
            const etudes = disciplines.filter((d) => d.cle !== "negoce" && (d.montant > 0.5 || (d.heures ?? 0) > 0.05 || (pointeDe(d) ?? 0) > 0.05));
            const lignes = etudes.map((d) => {
              const h = (pointeDe(d) ?? 0) + planDe(d);
              return { d, h, m: d.montant - h * C };
            });
            const hNeg = heuresNegoce + (toutesLivrees ? 0 : planifieNegoce);
            const avecNegoce = vendu > 0.5 || achete > 0.5 || hNeg > 0.05;
            const mNeg = vendu - achete - hNeg * C;
            const hTotal = pointeTotal + (toutesLivrees ? 0 : planifie);
            const hTrajets = heuresTrajets > 0.05 ? heuresTrajets : 0;
            const hAutres = hTotal - lignes.reduce((t, x) => t + x.h, 0) - (avecNegoce ? hNeg : 0) - hTrajets;
            const nonVentile = M - lignes.reduce((t, x) => t + x.d.montant, 0) - (avecNegoce ? vendu : 0);
            const ecartFacture = toutesLivrees ? F - M : 0;
            const total = lignes.reduce((t, x) => t + x.m, 0) + (avecNegoce ? mNeg : 0) - hTrajets * C - (Math.abs(hAutres) > 0.05 ? hAutres * C : 0) + (Math.abs(nonVentile) > 0.5 ? nonVentile : 0) + ecartFacture;
            const recette = toutesLivrees ? F : M;
            const bord: CSSProperties = { borderTop: "2px solid #d5d9de" };
            return (
              <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
                <thead>
                  <tr>
                    <th style={th}>Activité</th>
                    <th style={thN}>Montant commandé</th>
                    <th style={thN}>Heures commandées</th>
                    <th style={thN} title="Montant ÷ heures commandées, et écart au coût de structure">Taux de vente</th>
                    <th style={thN}>{toutesLivrees ? "Heures pointées" : "Pointé + planifié"}</th>
                    <th style={thN} title="Montant ÷ (pointé + planifié)">Taux obtenu</th>
                    <th style={thN} title="Montant − (pointé + planifié) × coût de structure">{toutesLivrees ? "Marge réelle" : "Marge projetée"}</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map(({ d, h, m }) => (
                    <tr key={d.cle}>
                      <td style={{ ...td, fontWeight: 800 }}>{d.libelle}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{d.montant > 0.5 ? euros(d.montant) : "—"}</td>
                      <td style={tdN}>{d.heures && d.heures > 0.05 ? heures(d.heures) : "—"}</td>
                      {taux(d.heures && d.heures > 0.05 ? d.montant / d.heures : null)}
                      <td style={tdN}>{h > 0.05 ? heures(h) : "—"}</td>
                      {taux(h > 0.05 && d.montant > 0.5 ? d.montant / h : null)}
                      {marge(m, d.montant)}
                    </tr>
                  ))}
                  {avecNegoce && (
                    <tr>
                      <td style={{ ...td, fontWeight: 800 }}>
                        Négoce <span style={{ fontSize: 12, fontWeight: 400, color: gris }}>vendu − achats − temps</span>
                      </td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{vendu > 0.5 ? euros(vendu) : "—"}</td>
                      <td style={tdN}>—</td>
                      <td style={tdN}>{achete > 0.5 ? <span style={{ color: "#7a3e00" }}>achats − {euros(achete)}</span> : "—"}</td>
                      <td style={tdN}>{hNeg > 0.05 ? heures(hNeg) : "—"}</td>
                      <td style={tdN}>—</td>
                      {marge(mNeg, vendu)}
                    </tr>
                  )}
                  {hTrajets > 0 && (
                    <tr>
                      <td style={{ ...td, fontWeight: 800 }} colSpan={4}>
                        Trajets <span style={{ fontSize: 12, fontWeight: 400, color: gris }}>code HT : coût de l’affaire, non vendu en heures</span>
                      </td>
                      <td style={tdN}>{heures(hTrajets)}</td>
                      <td style={tdN} />
                      {marge(-hTrajets * C, 0)}
                    </tr>
                  )}
                  {Math.abs(hAutres) > 0.05 && (
                    <tr>
                      <td style={{ ...td, color: gris }} colSpan={4}>
                        Temps hors de ces activités (pointé ou planifié sans activité chiffrée)
                      </td>
                      <td style={tdN}>{heures(hAutres)}</td>
                      <td style={tdN} />
                      {marge(-hAutres * C, 0)}
                    </tr>
                  )}
                  {Math.abs(nonVentile) > 0.5 && (
                    <tr>
                      <td style={{ ...td, color: gris }} colSpan={6}>
                        Montant de la commande non ventilé par activité au Suivi d’affaire
                      </td>
                      {marge(nonVentile, 0)}
                    </tr>
                  )}
                  {Math.abs(ecartFacture) > 0.5 && (
                    <tr>
                      <td style={{ ...td, color: gris }} colSpan={6}>
                        Écart entre facturé et commandé
                      </td>
                      {marge(ecartFacture, 0)}
                    </tr>
                  )}
                  <tr>
                    <td style={{ ...td, ...bord, fontWeight: 800 }}>Toute l’affaire</td>
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{euros(recette)}</td>
                    <td style={{ ...tdN, ...bord }} colSpan={2} />
                    <td style={{ ...tdN, ...bord, fontWeight: 800 }}>{heures(hTotal)}</td>
                    <td style={{ ...tdN, ...bord }} />
                    {marge(total, recette, true, bord)}
                  </tr>
                </tbody>
              </table>
            );
          })()}
          <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
            Taux de vente = montant ÷ heures commandées ; taux obtenu = montant ÷ (pointé + planifié) ; le % à côté du taux = écart au coût de structure. La marge de chaque ligne = montant − (pointé + planifié) × coût de structure : le total « Toute l’affaire » est la marge de la grande case en haut.
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
