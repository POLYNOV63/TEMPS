"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";
import { chargerTout } from "@/lib/pilotageDonnees";

/* ===============================================================
   FICHE AFFAIRE - HISTORIQUE D'UNE PE / PI (HISTORIQUE_PEPI_V3)

   Trois mesures, à ne pas confondre :
   - COMMANDÉ : ce que le client a commandé (base + avenants), en
     quantité = montant ÷ taux de vente (comme la fiche d'information du
     relevé), à partir du mois de réception de chaque commande ;
   - RELEVÉ : ce qu'on facture, d'après le relevé PE / PI : FACTURÉ (mois
     clôturés), À FACTURER (mois passés ou en cours pas encore clôturés)
     et PRÉVU (mois à venir) ;
   - POINTÉ : le travail réellement saisi dans les feuilles d'heures.
   La page montre, mois par mois et en cumul : le commandé, le relevé, le
   pointé, et le RESTE de la commande (commandé − relevé, prévu compris),
   en courbes puis en tableau ; puis commande par commande.
   Les quantités et les montants viennent des mêmes chiffres : un
   dépassement en jours et en euros se correspondent.
   Base horaire (BASE_HORAIRE) : la journée de chaque commande (« Journée de »
   du relevé, sinon les lignes, sinon 7 h). Vendue au jour, une commande vaut
   jours vendus × cette journée (HEURES_COMMANDEES).
   Unité (UNITE_FACTUREE) : celle de la facturation au relevé (réglage de la
   commande, sinon lignes actives), sinon l'unité vendue. Facturée au jour :
   jours vendus (quantité en jours, sinon montant ÷ taux au jour, sinon heures
   du Suivi d'affaire ÷ 7 h) × journée de la commande.
   Le graphique (GRAPHE_ANNOTE) porte les graduations dans cette unité, et
   chaque commande reçue avec sa quantité et le nouveau cumul.
   Montants et taux : seulement avec la fonction « Montants des affaires ».
================================================================ */

type LigneP = { id: string; affaire_id: string; unite: "JOUR" | "HEURE"; taux: number | null; base_horaire: number | null; actif: boolean };
type Etat = "FACTURE" | "A_FACTURER" | "PREVU";
type Mois = { heures: number; montant: number; etat: Etat };
type Commande = {
  id: string;
  numero: string;
  statut: string;
  recue: string | null; // AAAA-MM de réception (ou premier mois au relevé)
  montant: number; // commandé, en €
  heuresCmd: number | null; // commandé, en heures (montant ÷ taux, sinon heures du Suivi d'affaire)
  unite: "JOUR" | "HEURE";
  base: number;
  mois: Map<string, Mois>;
  finPrevue: string | null;
};

const n = (v: unknown) => Number(v) || 0;
const euros = (v: number) => v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const NOMS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const libMois = (m: string) => `${NOMS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
/* le classeur Suivi d'affaire BE compte ses jours à 7 h */
const BASE_CHIFFRAGE = 7;
const moisSuivant = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);

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

      const { data: afs } = await supabase
        .from("pilotage_affaires")
        .select("id,numero,statut,prestation_quantite,prestation_unite,releve_unite,releve_base_horaire")
        .eq("type", "CBE");
      type AffP = { id: string; numero: string; statut: string; prestation_quantite: number | string | null; prestation_unite: string | null; releve_unite: string | null; releve_base_horaire: number | string | null };
      const famille = ((afs ?? []) as AffP[])
        .filter((a) => (a.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "") === b)
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
      if (famille.length === 0) return;

      const { data: pl, error: ep } = await supabase.from("prestation_lignes").select("id,affaire_id,unite,taux,base_horaire,actif").in("affaire_id", famille.map((a) => a.id));
      if (ep) return actif && setMessage("Le relevé PE / PI de cette affaire ne vous est pas ouvert.");
      const lignes = ((pl ?? []) as { id: string; affaire_id: string; unite: "JOUR" | "HEURE"; taux: number | string | null; base_horaire: number | string | null; actif: boolean | null }[]).map(
        (l): LigneP => ({ id: l.id, affaire_id: l.affaire_id, unite: l.unite, taux: l.taux === null ? null : n(l.taux), base_horaire: n(l.base_horaire) || null, actif: l.actif !== false })
      );
      if (lignes.length === 0) return actif && setMessage("Aucune ligne au relevé PE / PI pour cette affaire.");
      const ids = lignes.map((l) => l.id);

      const [pm, sa, sl] = await Promise.all([
        chargerTout<{ ligne_id: string; mois: string; valide: boolean | null; heures_fige: number | string | null; montant_fige: number | string | null }>((x, y) =>
          supabase.from("prestation_mois").select("ligne_id,mois,valide,heures_fige,montant_fige").in("ligne_id", ids).order("mois").range(x, y)
        ),
        chargerTout<{ ligne_id: string; jour: string; heures: number | string | null }>((x, y) =>
          supabase.from("prestation_saisies").select("ligne_id,jour,heures").in("ligne_id", ids).order("jour").range(x, y)
        ),
        supabase.from("suivi_lignes").select("id,numero_affaire,genre,statut,heures_total,date_reception_commande").eq("base_affaire", b).in("genre", ["BASE", "AVENANT"]),
      ]);
      const etats = new Map(pm.map((x) => [`${x.ligne_id}|${String(x.mois).slice(0, 7)}`, x]));
      const suivi = (sl.data ?? []) as { id: string; numero_affaire: string | null; genre: string; statut: string | null; heures_total: number | string | null; date_reception_commande: string | null }[];
      // le montant commandé sert à la quantité commandée (montant ÷ taux) ; il n'est AFFICHÉ qu'avec le droit aux montants
      const montants = new Map<string, number>();
      if (suivi.length > 0) {
        const { data: mts } = await supabase.from("suivi_lignes_montants").select("ligne_id,montant").in("ligne_id", suivi.map((s) => s.id));
        for (const m of (mts ?? []) as { ligne_id: string; montant: number | string | null }[]) montants.set(m.ligne_id, n(m.montant));
      }

      const moisCourant = new Date().toISOString().slice(0, 7);
      const auj = new Date().toISOString().slice(0, 10);
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
      const cles = new Set<string>([...saisi.keys(), ...etats.keys()]);

      /* BASE_HORAIRE : la journée d'une commande (7 h, 7,5 h…) :
         1. celle réglée au relevé pour la commande (« Journée de ») ;
         2. sinon la plus fréquente des lignes actives qui ont des heures, puis des lignes actives ;
         3. sinon 7 h. */
      const plusFrequente = (vals: number[]) => {
        const c = new Map<number, number>();
        for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1);
        return [...c.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      };
      const baseDe = (affaireId: string): number => {
        const a = famille.find((x) => x.id === affaireId);
        if (!a) return 7;
        if (n(a.releve_base_horaire) > 0) return n(a.releve_base_horaire);
        const ls = lignes.filter((l) => l.affaire_id === affaireId && l.base_horaire);
        const avecHeures = ls.filter((l) => l.actif && [...saisi.keys()].some((k) => k.startsWith(`${l.id}|`)));
        const propre = plusFrequente(avecHeures.map((l) => l.base_horaire as number)) ?? plusFrequente(ls.filter((l) => l.actif).map((l) => l.base_horaire as number)) ?? plusFrequente(ls.map((l) => l.base_horaire as number));
        if (propre) return propre;
        // un avenant sans réglage ni ligne propre prend la journée du reste de la famille
        const reglee = famille.map((x) => n(x.releve_base_horaire)).find((v) => v > 0);
        return reglee ?? plusFrequente(lignes.filter((l) => l.actif && l.base_horaire).map((l) => l.base_horaire as number)) ?? 7;
      };

      const res: Commande[] = famille.map((a) => {
        const ls = lignes.filter((l) => l.affaire_id === a.id);
        const mois = new Map<string, Mois>();
        for (const cle of cles) {
          const [lid, m] = cle.split("|");
          const l = ls.find((x) => x.id === lid);
          if (!l) continue;
          const e = etats.get(cle);
          const tauxH = l.taux === null ? 0 : l.unite === "JOUR" ? l.taux / (l.base_horaire ?? baseDe(a.id)) : l.taux;
          const valide = Boolean(e?.valide);
          const h = valide && e?.heures_fige !== null && e?.heures_fige !== undefined ? n(e.heures_fige) : saisi.get(cle) ?? 0;
          const mt = valide && e?.montant_fige !== null && e?.montant_fige !== undefined ? n(e.montant_fige) : h * tauxH;
          if (h <= 0.001 && mt <= 0.5) continue;
          const etat: Etat = valide ? "FACTURE" : m > moisCourant ? "PREVU" : "A_FACTURER";
          const c = mois.get(m) ?? { heures: 0, montant: 0, etat };
          c.heures += h;
          c.montant += mt;
          if (etat !== "FACTURE" && c.etat === "FACTURE") c.etat = etat;
          mois.set(m, c);
        }
        const s = suivi.find((x) => String(x.numero_affaire ?? "").toUpperCase().replace(/^CBE\s*/, "").replace(/^0+/, "") === a.numero.toUpperCase().replace(/^0+/, ""));
        const montant = s ? montants.get(s.id) ?? 0 : 0;
        const l0 = ls.find((l) => l.taux !== null && l.actif) ?? ls.find((l) => l.taux !== null);
        const tauxH0 = l0 && l0.taux !== null ? (l0.unite === "JOUR" ? l0.taux / (l0.base_horaire ?? baseDe(a.id)) : l0.taux) : null;
        /* UNITE_FACTUREE : jours ou heures, d'après la façon dont on FACTURE : le réglage de vente du relevé pour
           la commande, sinon l'unité des lignes actives, sinon l'unité vendue au Suivi d'affaire */
        const actives = ls.filter((l) => l.actif);
        const uniteReleve = a.releve_unite === "JOUR" || a.releve_unite === "HEURE" ? a.releve_unite : null;
        const uniteLignes = actives.length > 0 ? (actives.some((l) => l.unite === "JOUR") ? "JOUR" : "HEURE") : null;
        const uniteVendue = a.prestation_unite === "JOURS" ? "JOUR" : a.prestation_unite === "HEURES" ? "HEURE" : null;
        const unite: "JOUR" | "HEURE" = uniteReleve ?? uniteLignes ?? uniteVendue ?? (ls[0]?.unite ?? "HEURE");
        const baseH = baseDe(a.id);
        /* HEURES_COMMANDEES : facturée au jour, la commande vaut JOURS vendus × journée de la commande (7,5 h…).
           Les jours vendus : la quantité vendue si elle est en jours ; sinon montant ÷ taux au jour ; sinon les
           heures du Suivi d'affaire ÷ 7 h (le classeur compte ses jours à 7 h : 371 h = 53 j). Facturée à
           l'heure : la quantité vendue, sinon les heures du Suivi d'affaire, sinon montant ÷ taux. */
        const qte = n(a.prestation_quantite);
        const hSuivi = n(s?.heures_total);
        const lJour = actives.find((l) => l.unite === "JOUR" && l.taux) ?? ls.find((l) => l.unite === "JOUR" && l.taux);
        let joursVendus: number | null = null;
        if (unite === "JOUR") {
          if (qte > 0 && a.prestation_unite === "JOURS") joursVendus = qte;
          else if (montant > 0 && lJour?.taux) joursVendus = montant / lJour.taux;
          else if (qte > 0 && a.prestation_unite === "HEURES") joursVendus = qte / BASE_CHIFFRAGE;
          else if (hSuivi > 0) joursVendus = hSuivi / BASE_CHIFFRAGE;
        }
        const heuresCmd =
          unite === "JOUR" && joursVendus !== null
            ? joursVendus * baseH
            : qte > 0 && a.prestation_unite !== "JOURS"
              ? qte
              : hSuivi > 0
                ? hSuivi
                : montant > 0 && tauxH0
                  ? montant / tauxH0
                  : null;
        const premierMois = [...mois.keys()].sort()[0] ?? null;
        return {
          id: a.id,
          numero: a.numero,
          statut: s?.statut ?? a.statut,
          recue: s?.date_reception_commande ? String(s.date_reception_commande).slice(0, 7) : premierMois,
          montant,
          heuresCmd,
          unite,
          base: baseH,
          mois,
          finPrevue: dernier.get(a.id) ?? null,
        };
      });
      if (!actif) return;
      setCommandes(res.filter((c) => c.mois.size > 0 || (c.heuresCmd ?? 0) > 0));
    })().catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [base]);

  /* la famille, mois par mois, avec les cumuls */
  const serie = useMemo(() => {
    if (!commandes || commandes.length === 0) return null;
    const moisCourant = new Date().toISOString().slice(0, 7);
    const tous = new Set<string>([...pointeParMois.keys()]);
    for (const c of commandes) {
      for (const m of c.mois.keys()) tous.add(m);
      if (c.recue) tous.add(c.recue);
    }
    const liste = [...tous].sort();
    if (liste.length === 0) return null;
    // mois continus du premier au dernier
    const mois: string[] = [];
    for (let m = liste[0]; m <= liste[liste.length - 1]; m = moisSuivant(m)) mois.push(m);
    let cCmd = 0;
    let cCmdE = 0;
    let cRel = 0;
    let cRelE = 0;
    let cPt = 0;
    const lignes = mois.map((m) => {
      const recues = commandes.filter((c) => c.recue === m);
      cCmd += recues.reduce((t, c) => t + (c.heuresCmd ?? 0), 0);
      cCmdE += recues.reduce((t, c) => t + c.montant, 0);
      let f = 0;
      let af = 0;
      let pr = 0;
      let mt = 0;
      for (const c of commandes) {
        const x = c.mois.get(m);
        if (!x) continue;
        if (x.etat === "FACTURE") f += x.heures;
        else if (x.etat === "A_FACTURER") af += x.heures;
        else pr += x.heures;
        mt += x.montant;
      }
      cRel += f + af + pr;
      cRelE += mt;
      const passe = m <= moisCourant;
      const pt = passe ? pointeParMois.get(m) ?? 0 : 0;
      if (passe) cPt += pt;
      return { m, recues, f, af, pr, mt, cCmd, cCmdE, cRel, cRelE, pt, cPt: passe ? cPt : null, reste: cCmd - cRel, resteE: cCmdE - cRelE, futur: !passe, courant: m === moisCourant };
    });
    return lignes;
  }, [commandes, pointeParMois]);

  if (message)
    return (
      <section style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Historique de la PE / PI</h2>
        <p style={{ margin: 0, color: "#5b6168" }}>{message}</p>
      </section>
    );
  if (!commandes || commandes.length === 0 || !serie) return null;

  // unité d'affichage : celle des commandes si elles ont toutes la même, sinon l'heure
  const enJours = commandes.every((c) => c.unite === "JOUR");
  const baseJ = (() => {
    const poids = new Map<number, number>();
    for (const c of commandes) poids.set(c.base, (poids.get(c.base) ?? 0) + (c.heuresCmd ?? 0) + [...c.mois.values()].reduce((t, x) => t + x.heures, 0));
    return [...poids.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 7;
  })();
  const bases = [...new Set(commandes.map((c) => c.base))];
  const q = (h: number) => (enJours ? `${(Math.round((h / baseJ) * 10) / 10).toLocaleString("fr-FR")} j` : `${(Math.round(h * 10) / 10).toLocaleString("fr-FR")} h`);
  const qc = (c: Commande, h: number) => (c.unite === "JOUR" ? `${(Math.round((h / c.base) * 10) / 10).toLocaleString("fr-FR")} j` : `${(Math.round(h * 10) / 10).toLocaleString("fr-FR")} h`);
  const gris = "#5b6168";
  const VERT = "#1b5e20";
  const ROUGE = "#b3261e";

  // la synthèse, à ce jour
  const der = serie.filter((x) => !x.futur).slice(-1)[0] ?? serie[0];
  const fin = serie[serie.length - 1];
  const commande = commandes.reduce((t, c) => t + (c.heuresCmd ?? 0), 0);
  const commandeE = commandes.reduce((t, c) => t + c.montant, 0);
  const facture = serie.reduce((t, x) => t + x.f, 0);
  const aFacturer = serie.reduce((t, x) => t + x.af, 0);
  const prevu = serie.reduce((t, x) => t + x.pr, 0);
  const pointe = der.cPt ?? 0;
  const releve = facture + aFacturer;
  const resteFinal = commande - facture - aFacturer - prevu;
  const resteFinalE = commandeE - fin.cRelE;
  const factureE = commandes.reduce((t, c) => t + [...c.mois.values()].filter((x) => x.etat === "FACTURE").reduce((u, x) => u + x.montant, 0), 0);
  const finPrevue = commandes.map((c) => c.finPrevue).filter((x): x is string => Boolean(x)).sort().slice(-1)[0] ?? null;
  const tuile = (libelle: string, valeur: string, sous: string, couleur?: string) => (
    <div style={{ minWidth: 130, flex: "1 1 130px", border: "1px solid #e3e6ea", borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: gris }}>{libelle}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: couleur ?? "#1f2328" }}>{valeur}</div>
      <div style={{ fontSize: 12, color: gris }}>{sous}</div>
    </div>
  );

  // la courbe : commandé (marches), relevé cumulé (prévu en pointillé), pointé cumulé
  const W = 720;
  const H = 250;
  const max = Math.max(1, ...serie.map((x) => Math.max(x.cCmd, x.cRel, x.cPt ?? 0))) * 1.1;
  const X = (i: number) => (serie.length === 1 ? W / 2 : 46 + (i * (W - 150)) / (serie.length - 1));
  const Y = (v: number) => H - 26 - (v / max) * (H - 60);
  const poly = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v === null ? null : `${X(i)},${Y(v)}`))
      .filter(Boolean)
      .join(" ");
  const iCourant = serie.findIndex((x) => x.futur);
  const passeRel = serie.map((x, i) => (iCourant < 0 || i < iCourant ? x.cRel : null));
  const futurRel = serie.map((x, i) => (iCourant >= 0 && i >= iCourant - 1 ? x.cRel : null));
  const marches = serie.flatMap((x, i) => (i === 0 ? [`${X(0)},${Y(x.cCmd)}`] : [`${X(i)},${Y(serie[i - 1].cCmd)}`, `${X(i)},${Y(x.cCmd)}`])).join(" ");

  const th: CSSProperties = { textAlign: "right", padding: "6px 8px", fontSize: 12.5, background: "#f4f5f7", borderBottom: "2px solid #d5d9de", whiteSpace: "nowrap" };
  const thG: CSSProperties = { ...th, textAlign: "left" };
  const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #eceef1", fontSize: 14, textAlign: "right", whiteSpace: "nowrap" };
  const tdG: CSSProperties = { ...td, textAlign: "left" };
  const ecartTexte = (pt: number, rel: number) => {
    const e = pt - rel;
    if (Math.abs(e) < 0.5) return { texte: "à jour", couleur: VERT };
    return e > 0 ? { texte: `${q(e)} pointées pas au relevé`, couleur: ROUGE } : { texte: `${q(-e)} au relevé de plus que pointé`, couleur: "#7a3e00" };
  };

  return (
    <section style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, marginBottom: 16, overflowX: "auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Historique de la PE / PI</h2>
      <p style={{ margin: "0 0 4px", fontSize: 13.5 }}>
        Unité : <strong>{enJours ? `jours de ${baseJ.toLocaleString("fr-FR")} h` : "heures"}</strong>
        {enJours && bases.length > 1 && <span style={{ color: gris }}> (bases des commandes : {bases.map((b) => `${b.toLocaleString("fr-FR")} h`).join(", ")})</span>}
        <span style={{ color: gris }}> · se règle dans la fiche de paramétrage du relevé (« Journée de »)</span>
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: gris }}>
        <strong>Commandé</strong> : ce que le client a commandé (base et avenants). <strong>Relevé</strong> : ce qu’on facture, d’après le relevé PE / PI (facturé, à facturer, prévu).{" "}
        <strong>Pointé</strong> : le travail saisi dans les feuilles d’heures. <strong>Reste</strong> : commandé − relevé, prévu compris.
      </p>

      {/* à ce jour, et là où ça nous mène */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        {tuile("Commandé", q(commande), voitMontants && commandeE > 0.5 ? euros(commandeE) : `${commandes.length} commande${commandes.length > 1 ? "s" : ""}`)}
        {tuile("Facturé", q(facture), voitMontants ? euros(factureE) : "mois clôturés", VERT)}
        {tuile("À facturer", q(aFacturer), "au relevé, pas encore clôturé", "#8a6500")}
        {tuile("Pointé", q(pointe), (() => {
          const e = ecartTexte(pointe, releve);
          return e.texte;
        })())}
        {tuile("Prévu", q(prevu), finPrevue ? `jusqu’au ${new Date(`${finPrevue}T00:00:00`).toLocaleDateString("fr-FR")}` : "rien au relevé à venir", gris)}
        {tuile(
          resteFinal < -0.05 ? "Dépassement prévu" : "Reste après le prévu",
          q(Math.abs(resteFinal)),
          voitMontants && commandeE > 0.5 ? `${resteFinalE < 0 ? "− " : ""}${euros(Math.abs(resteFinalE))}` : "commandé − facturé − à facturer − prévu",
          resteFinal < -0.05 ? ROUGE : VERT
        )}
      </div>

      {/* COURBES_PEPI : la commande, le relevé et le pointé dans le temps */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 860, height: "auto" }} role="img" aria-label="Commandé, relevé et pointé cumulés, mois par mois">
        {iCourant > 0 && <rect x={X(iCourant) - (W - 150) / Math.max(1, serie.length - 1) / 2} y={10} width={W} height={H - 36} fill="#f6f7f9" />}
        <polyline points={marches} fill="none" stroke="#1f2328" strokeWidth={2} />
        <polyline points={poly(serie.map((x) => x.cPt))} fill="none" stroke="#e08a1e" strokeWidth={2} />
        <polyline points={poly(passeRel)} fill="none" stroke="#2e7d32" strokeWidth={3} />
        <polyline points={poly(futurRel)} fill="none" stroke="#2e7d32" strokeWidth={3} strokeDasharray="6 5" />
        {/* GRAPHE_ANNOTE : graduations dans l'unité vendue */}
        {(() => {
          const div = enJours ? baseJ : 1; // graduations rondes dans l'unité affichée
          const maxU = max / div;
          const brut = maxU / 4;
          const p10 = Math.pow(10, Math.floor(Math.log10(Math.max(brut, 0.0001))));
          const pasU = [1, 2, 5, 10].map((k) => k * p10).find((v) => v >= brut) ?? brut;
          const ticks: number[] = [];
          for (let v = 0; v <= maxU + 1e-9; v += pasU) ticks.push(v * div);
          return ticks.map((v) => (
            <g key={v}>
              <line x1={36} x2={W - 20} y1={Y(v)} y2={Y(v)} stroke="#eceef1" strokeWidth={1} />
              <text x={32} y={Y(v) + 4} textAnchor="end" fontSize={10.5} fill={gris}>
                {q(v).replace(/\s/g, " ")}
              </text>
            </g>
          ));
        })()}
        {/* chaque commande reçue : + quantité (n°) et le nouveau cumul */}
        {serie.map((x, i) =>
          x.recues.length > 0 ? (
            <g key={`cmd-${x.m}`}>
              <circle cx={X(i)} cy={Y(x.cCmd)} r={4} fill="#1f2328" />
              <text x={X(i) + 6} y={Y(x.cCmd) - 16} fontSize={11.5} fontWeight={800} fill="#1f2328">
                + {q(x.recues.reduce((t, c) => t + (c.heuresCmd ?? 0), 0))} ({x.recues.map((c) => c.numero).join(", ")})
              </text>
              <text x={X(i) + 6} y={Y(x.cCmd) - 4} fontSize={11} fill={gris}>
                = {q(x.cCmd)} commandés
              </text>
            </g>
          ) : null
        )}
        {/* en bout de courbe : le relevé (prévu compris) et le pointé */}
        <text x={X(serie.length - 1)} y={Y(fin.cRel) + (fin.cRel > fin.cCmd ? -8 : 16)} textAnchor="end" fontSize={11.5} fontWeight={800} fill="#2e7d32">
          relevé + prévu : {q(fin.cRel)}
        </text>
        {der.cPt !== null && (
          <text x={X(serie.indexOf(der))} y={Y(der.cPt) + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#b26100">
            pointé : {q(der.cPt)}
          </text>
        )}
        {serie.map((x, i) =>
          i % Math.max(1, Math.ceil(serie.length / 12)) === 0 || i === serie.length - 1 ? (
            <text key={x.m} x={X(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={gris}>
              {libMois(x.m)}
            </text>
          ) : null
        )}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12.5, color: "#3b4046", margin: "2px 0 14px" }}>
        <span><i style={{ display: "inline-block", width: 18, borderTop: "2px solid #1f2328", verticalAlign: "middle", marginRight: 5 }} />commandé (cumul, à chaque commande reçue)</span>
        <span><i style={{ display: "inline-block", width: 18, borderTop: "3px solid #2e7d32", verticalAlign: "middle", marginRight: 5 }} />relevé (facturé + à facturer)</span>
        <span><i style={{ display: "inline-block", width: 18, borderTop: "3px dashed #2e7d32", verticalAlign: "middle", marginRight: 5 }} />prévu</span>
        <span><i style={{ display: "inline-block", width: 18, borderTop: "2px solid #e08a1e", verticalAlign: "middle", marginRight: 5 }} />pointé</span>
      </div>

      {/* mois par mois */}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={thG}>Mois</th>
            <th style={th}>Commande reçue</th>
            <th style={th}>Pointé</th>
            <th style={th}>Au relevé</th>
            {voitMontants && <th style={th}>Montant</th>}
            <th style={th}>Cumul pointé</th>
            <th style={th}>Cumul relevé</th>
            <th style={thG}>Pointé face au relevé</th>
            <th style={th}>Reste de la commande</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((x) => {
            const rel = x.f + x.af + x.pr;
            const etat = x.pr > 0 ? "prévu" : x.af > 0 ? "à facturer" : x.f > 0 ? "facturé" : "";
            const couleurEtat = x.pr > 0 ? gris : x.af > 0 ? "#8a6500" : VERT;
            const e = x.cPt !== null ? ecartTexte(x.cPt, x.cRel) : null;
            return (
              <tr key={x.m} style={{ fontStyle: x.futur ? "italic" : undefined, background: x.courant ? "#fffafa" : undefined }}>
                <td style={{ ...tdG, fontWeight: 700 }}>{libMois(x.m)}</td>
                <td style={{ ...td, color: "#1f2328" }}>
                  {x.recues.length > 0 ? (
                    <>
                      <strong>+ {q(x.recues.reduce((t, c) => t + (c.heuresCmd ?? 0), 0))}</strong>
                      <div style={{ fontSize: 11.5, color: gris }}>{x.recues.map((c) => c.numero).join(", ")}</div>
                    </>
                  ) : (
                    ""
                  )}
                </td>
                <td style={td}>{x.futur ? "" : x.pt > 0.05 ? q(x.pt) : "—"}</td>
                <td style={{ ...td, fontWeight: 700 }}>
                  {rel > 0.05 ? (
                    <>
                      {q(rel)}
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: couleurEtat }}>{etat}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                {voitMontants && <td style={td}>{x.mt > 0.5 ? euros(x.mt) : "—"}</td>}
                <td style={td}>{x.cPt !== null ? q(x.cPt) : ""}</td>
                <td style={{ ...td, fontWeight: 700 }}>{q(x.cRel)}</td>
                <td style={{ ...tdG, fontSize: 12.5, color: e?.couleur }}>{e ? e.texte : ""}</td>
                <td style={{ ...td, fontWeight: 800, color: x.reste < -0.05 ? ROUGE : VERT }}>
                  {x.cCmd <= 0.05 && x.cRel <= 0.05 ? "—" : x.reste < -0.05 ? `dépassé de ${q(-x.reste)}` : q(x.reste)}
                  {voitMontants && x.cCmdE > 0.5 && <div style={{ fontSize: 11.5, fontWeight: 400, color: gris }}>{x.resteE < 0 ? `− ${euros(-x.resteE)}` : euros(x.resteE)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: gris, margin: "6px 0 14px" }}>
        « Pointé face au relevé », en cumul : <span style={{ color: ROUGE }}>en rouge, du travail pointé qui n’est pas (encore) au relevé</span> ; <span style={{ color: "#7a3e00" }}>en ocre, plus au relevé que pointé</span>. Les heures
        sont pointées sur le n° de base : la comparaison se fait pour toute la famille.
      </p>

      {/* commande par commande */}
      <strong style={{ fontSize: 15 }}>Commande par commande</strong>
      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6 }}>
        <thead>
          <tr>
            <th style={thG}>Commande</th>
            <th style={th}>Reçue</th>
            <th style={th}>Commandé</th>
            <th style={th}>Facturé</th>
            <th style={th}>À facturer</th>
            <th style={th}>Prévu</th>
            <th style={th}>Reste après le prévu</th>
            <th style={th}>Fin du prévu</th>
          </tr>
        </thead>
        <tbody>
          {commandes.map((c) => {
            const vals = [...c.mois.values()];
            const s = (etat: Etat) => vals.filter((x) => x.etat === etat).reduce((t, x) => t + x.heures, 0);
            const sE = (etat: Etat) => vals.filter((x) => x.etat === etat).reduce((t, x) => t + x.montant, 0);
            const reste = c.heuresCmd !== null ? c.heuresCmd - s("FACTURE") - s("A_FACTURER") - s("PREVU") : null;
            const resteE = c.montant - sE("FACTURE") - sE("A_FACTURER") - sE("PREVU");
            const cel = (h: number, e: number, couleur?: string) => (
              <td style={{ ...td, color: couleur }}>
                {h > 0.05 ? qc(c, h) : "—"}
                {voitMontants && e > 0.5 && <div style={{ fontSize: 11.5, color: gris }}>{euros(e)}</div>}
              </td>
            );
            return (
              <tr key={c.id}>
                <td style={tdG}>
                  <strong style={{ color: "#a30000" }}>{c.numero}</strong> <span style={{ fontSize: 12, color: gris }}>{c.statut}</span>
                </td>
                <td style={td}>
                  {c.recue ? libMois(c.recue) : "—"}
                  {c.unite === "JOUR" && <div style={{ fontSize: 11, color: gris }}>jour de {c.base.toLocaleString("fr-FR")} h</div>}
                </td>
                {cel(c.heuresCmd ?? 0, c.montant)}
                {cel(s("FACTURE"), sE("FACTURE"), VERT)}
                {cel(s("A_FACTURER"), sE("A_FACTURER"), "#8a6500")}
                {cel(s("PREVU"), sE("PREVU"), gris)}
                <td style={{ ...td, fontWeight: 800, color: reste === null ? gris : reste < -0.05 ? ROUGE : VERT }}>
                  {reste === null ? "—" : reste < -0.05 ? `dépassé de ${qc(c, -reste)}` : reste <= 0.05 ? "✓ soldé" : qc(c, reste)}
                  {voitMontants && c.montant > 0.5 && Math.abs(resteE) > 0.5 && <div style={{ fontSize: 11.5, fontWeight: 400, color: gris }}>{resteE < 0 ? `− ${euros(-resteE)}` : euros(resteE)}</div>}
                </td>
                <td style={td}>{c.finPrevue ? new Date(`${c.finPrevue}T00:00:00`).toLocaleDateString("fr-FR") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: gris, margin: "6px 0 0" }}>
        Quantité commandée = montant de la commande ÷ taux de vente des lignes du relevé (comme dans la fiche d’information) : le reste en jours et le reste en euros se correspondent. Hors mois
        clôturés, les montants sont estimés (heures × taux de la ligne).
      </p>
    </section>
  );
}
