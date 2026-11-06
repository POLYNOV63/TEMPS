"use client";

/* ===============================================================
   FINANCES - TRAME CA (TRAME_CA_V1)

   Le tableau du classeur « trame_CA.xlsm », rempli par l'application,
   sur les 12 mois de l'exercice (novembre → octobre) :
   - CA réalisé par imputation (BE, PI, IG, PE) et par activité
     (Méca, Calcul, Elec), Négoce, Scan, achats sur affaires,
     CA BE sans / avec achats, CA PE, frais annexes (= ajustements) ;
   - total mensuel, cumul, prévisionnel cumulé, écarts, N-1, objectif ;
   - suivi d'activité (BE = BE + PI + IG, AS = PE) ;
   - prises de commande et devis envoyés (montant et nombre).

   Les montants viennent des mêmes calculs que le reste de la page
   (mouvements de lib/finances.ts) : le « Total CA mensuel » est égal
   au « Réalisé » du tableau des 12 mois.
   Prises de commande et devis : mêmes règles que les Indicateurs
   commerciaux (lib/indicateurs.ts).
================================================================ */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { C, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { exporterExcelPolynov, type ColonneExcel } from "@/lib/excelPolynov";
import type { MouvementCA } from "@/lib/finances";

const MOIS_LONGS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const nomMois = (m: string) => MOIS_LONGS[Number(m.slice(5, 7)) - 1];
const nombre = (v: number) => Math.round(v).toLocaleString("fr-FR");
const euros = (v: number) => `${nombre(v)} €`;
const pourcent = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)} %`);

type Cle =
  | "be_meca" | "be_calcul" | "be_elec"
  | "pi_meca" | "pi_calcul" | "pi_elec"
  | "ig_meca" | "ig_calcul" | "ig_elec"
  | "negoce" | "scan" | "autre" | "achats"
  | "pe_meca" | "pe_calcul" | "pe_elec" | "pe_autre"
  | "fa_pos" | "fa_neg";

const CLES: Cle[] = [
  "be_meca", "be_calcul", "be_elec", "pi_meca", "pi_calcul", "pi_elec", "ig_meca", "ig_calcul", "ig_elec",
  "negoce", "scan", "autre", "achats", "pe_meca", "pe_calcul", "pe_elec", "pe_autre", "fa_pos", "fa_neg",
];

/* Répartit le réalisé (mouvements) dans les lignes de la trame, mois par mois */
function agreger(mouvements: MouvementCA[], mois: string[]): Record<Cle, number[]> {
  const r = Object.fromEntries(CLES.map((c) => [c, mois.map(() => 0)])) as Record<Cle, number[]>;
  const index = new Map(mois.map((m, i) => [m, i]));
  for (const x of mouvements) {
    const i = index.get(x.date.slice(0, 7));
    if (i === undefined) continue;
    const g = x.parGroupe;
    // ajustements saisis à la main (écart avec la compta) = frais annexes de refacturation
    if (x.base_affaire === "Ajustement" && x.imputation === "Ajustement") {
      if (x.montant >= 0) r.fa_pos[i] += x.montant;
      else r.fa_neg[i] += -x.montant;
      continue;
    }
    if (x.imputation === "PE") {
      r.pe_meca[i] += g["Méca"];
      r.pe_calcul[i] += g.Calcul;
      r.pe_elec[i] += g["Elec / Pneu"];
      r.pe_autre[i] += g.Scan + g.Autre + g["Négoce"] + g["Non ventilé"];
      continue;
    }
    const p = x.imputation === "PI" ? "pi" : x.imputation === "IG" ? "ig" : "be";
    r[`${p}_meca` as Cle][i] += g["Méca"];
    r[`${p}_calcul` as Cle][i] += g.Calcul;
    r[`${p}_elec` as Cle][i] += g["Elec / Pneu"];
    r.negoce[i] += g["Négoce"];
    r.scan[i] += g.Scan;
    r.autre[i] += g.Autre + g["Non ventilé"];
    r.achats[i] += x.achats;
  }
  return r;
}

type LigneCom = {
  id: string;
  genre: string;
  statut: string | null;
  imputation: string | null;
  base_affaire: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  disparue: boolean;
};

type Ligne =
  | { kind: "titre"; libelle: string }
  | {
      kind: "valeurs";
      libelle: string;
      valeurs: (number | null)[];
      total: number | null;
      moyenne?: number | null;
      style?: "sous-total" | "total" | "info" | "ecart";
      format?: "euros" | "pct";
      base?: number[]; // dénominateur du % de chaque mois
      baseTotal?: number; // dénominateur du % du total
      nb?: number[]; // nombre (prises de commande, devis)
      nbTotal?: number;
    };

export default function TrameCA(props: { exercice: number; mois: string[]; moisN1: string[]; mouvements: MouvementCA[]; prevu: number[] }) {
  const { exercice, mois, moisN1, mouvements, prevu } = props;
  const [afficherPct, setAfficherPct] = useState(false);
  const [com, setCom] = useState<{ lignes: LigneCom[]; montants: Map<string, number> } | null>(null);
  const [erreurCom, setErreurCom] = useState("");

  useEffect(() => {
    (async () => {
      const [lignes, montants] = await Promise.all([
        chargerTout<LigneCom>((a, b) =>
          supabase
            .from("suivi_lignes")
            .select("id,genre,statut,imputation,base_affaire,date_ouverture,date_envoi,date_reception_commande,disparue")
            .order("id")
            .range(a, b)
        ),
        chargerTout<{ ligne_id: string; montant: number | string | null }>((a, b) =>
          supabase.from("suivi_lignes_montants").select("ligne_id,montant").order("ligne_id").range(a, b)
        ),
      ]);
      setCom({ lignes, montants: new Map(montants.map((m) => [m.ligne_id, Number(m.montant) || 0])) });
    })().catch((e) => setErreurCom(e instanceof Error ? e.message : "Prises de commande et devis indisponibles."));
  }, []);

  const moisCourant = new Date().toISOString().slice(0, 7);

  const trame = useMemo(() => {
    const n = mois.map(() => 0);
    const somme = (...listes: number[][]) => n.map((_, i) => listes.reduce((t, l) => t + l[i], 0));
    const tot = (v: number[]) => v.reduce((t, x) => t + x, 0);
    const r = agreger(mouvements, mois);
    const r1 = agreger(mouvements, moisN1);

    const caBE = somme(r.be_meca, r.be_calcul, r.be_elec, r.pi_meca, r.pi_calcul, r.pi_elec, r.ig_meca, r.ig_calcul, r.ig_elec, r.negoce, r.scan, r.autre);
    const caBEnet = n.map((_, i) => caBE[i] - r.achats[i]);
    const caPE = somme(r.pe_meca, r.pe_calcul, r.pe_elec, r.pe_autre);
    const total = n.map((_, i) => caBE[i] + caPE[i] + r.fa_pos[i] - r.fa_neg[i]);
    const caBE1 = somme(r1.be_meca, r1.be_calcul, r1.be_elec, r1.pi_meca, r1.pi_calcul, r1.pi_elec, r1.ig_meca, r1.ig_calcul, r1.ig_elec, r1.negoce, r1.scan, r1.autre);
    const total1 = n.map((_, i) => caBE1[i] + r1.pe_meca[i] + r1.pe_calcul[i] + r1.pe_elec[i] + r1.pe_autre[i] + r1.fa_pos[i] - r1.fa_neg[i]);

    const ecoule = mois.map((m) => m <= moisCourant);
    const nbEcoules = ecoule.filter(Boolean).length;
    let c = 0;
    const cumul = total.map((v) => (c += v));
    let p = 0;
    const prevuCumul = prevu.map((v) => (p += v));
    const objectif = tot(prevu);
    const totalAnnuel = tot(total);
    const cumulADate = nbEcoules > 0 ? cumul[nbEcoules - 1] : 0;

    const ca = (libelle: string, valeurs: number[], style?: "sous-total" | "info"): Ligne => ({
      kind: "valeurs",
      libelle,
      valeurs,
      total: tot(valeurs),
      moyenne: tot(valeurs) / 12,
      style,
      base: style === "info" ? undefined : total,
      baseTotal: style === "info" ? undefined : totalAnnuel,
    });
    const nonNul = (v: number[]) => v.some((x) => Math.abs(x) >= 0.5);
    const jusquA = (v: number[]) => v.map((x, i) => (ecoule[i] ? x : null));

    const lignes: Ligne[] = [
      { kind: "titre", libelle: "BE — Chiffrage sur CDC" },
      ca("Méca BE", r.be_meca),
      ca("Calcul BE", r.be_calcul),
      ca("Elec BE", r.be_elec),
      { kind: "titre", libelle: "PI — Prestation interne" },
      ca("Méca PI", r.pi_meca),
      ca("Calcul PI", r.pi_calcul),
      ca("Elec PI", r.pi_elec),
      { kind: "titre", libelle: "IG — Intergroupe" },
      ca("Méca IG", r.ig_meca),
      ca("Calcul IG", r.ig_calcul),
      ca("Elec IG", r.ig_elec),
      { kind: "titre", libelle: "Négoce, scan, achats" },
      ca("Négoce", r.negoce),
      ca("CA Scan", r.scan),
      ...(nonNul(r.autre) ? [ca("Autre / non ventilé (hors PE)", r.autre)] : []),
      ca("Achats sur affaires", r.achats, "info"),
      ca("CA BE sans HA", caBE, "sous-total"),
      { kind: "valeurs", libelle: "CA BE avec HA (achats déduits)", valeurs: caBEnet, total: tot(caBEnet), moyenne: tot(caBEnet) / 12, style: "sous-total" },
      { kind: "titre", libelle: "PE — Prestation externe" },
      ca("Méca PE", r.pe_meca),
      ca("Calcul PE", r.pe_calcul),
      ca("Elec PE", r.pe_elec),
      ...(nonNul(r.pe_autre) ? [ca("Autre / non ventilé PE", r.pe_autre)] : []),
      ca("CA PE", caPE, "sous-total"),
      { kind: "titre", libelle: "Frais annexes de refacturation (ajustements)" },
      ca("Positif", r.fa_pos),
      ca("Négatif", r.fa_neg),
      { kind: "titre", libelle: "Totaux" },
      { kind: "valeurs", libelle: "TOTAL CA MENSUEL", valeurs: total, total: totalAnnuel, moyenne: totalAnnuel / 12, style: "total" },
      { kind: "valeurs", libelle: "TOTAL CUMULÉ", valeurs: jusquA(cumul), total: cumulADate, style: "sous-total" },
      { kind: "valeurs", libelle: "PRÉVISIONNEL (cumulé)", valeurs: prevuCumul, total: objectif },
      {
        kind: "valeurs",
        libelle: "ÉCART CA / PRÉVI CUMULÉ",
        valeurs: jusquA(cumul.map((v, i) => v - prevuCumul[i])),
        total: objectif > 0 ? totalAnnuel - objectif : null,
        style: "ecart",
      },
      {
        kind: "valeurs",
        libelle: `ÉCART MENSUEL N-1 (${exercice - 1}-${exercice})`,
        valeurs: jusquA(total.map((v, i) => v - total1[i])),
        total: tot(total.slice(0, nbEcoules || 12)) - tot(total1.slice(0, nbEcoules || 12)),
        style: "ecart",
      },
      {
        kind: "valeurs",
        libelle: "Évolution vs N-1",
        valeurs: jusquA(total.map((v, i) => (total1[i] > 0 ? v / total1[i] - 1 : NaN))),
        total: (() => {
          const a = tot(total1.slice(0, nbEcoules || 12));
          return a > 0 ? tot(total.slice(0, nbEcoules || 12)) / a - 1 : null;
        })(),
        format: "pct",
        style: "ecart",
      },
      {
        kind: "valeurs",
        libelle: "Écart / objectif (cumul ÷ prévi annuel)",
        valeurs: jusquA(cumul.map((v) => (objectif > 0 ? v / objectif : NaN))),
        total: objectif > 0 ? cumulADate / objectif : null,
        format: "pct",
      },
    ];

    // suivi d'activité : BE = BE + PI + IG, AS = PE
    const meca = { be: somme(r.be_meca, r.pi_meca, r.ig_meca), as: r.pe_meca };
    const calcul = { be: somme(r.be_calcul, r.pi_calcul, r.ig_calcul), as: r.pe_calcul };
    const elec = { be: somme(r.be_elec, r.pi_elec, r.ig_elec), as: r.pe_elec };
    const totMeca = somme(meca.be, meca.as);
    const totCalc = somme(calcul.be, calcul.as);
    const totElec = somme(elec.be, elec.as);
    const troisTotaux = somme(totMeca, totCalc, totElec);
    const activite = (nom: string, d: { be: number[]; as: number[] }, t: number[]): Ligne[] => [
      { kind: "titre", libelle: nom },
      { kind: "valeurs", libelle: `${nom} — BE (BE + PI + IG)`, valeurs: d.be, total: tot(d.be), moyenne: tot(d.be) / 12, base: t, baseTotal: tot(t) },
      { kind: "valeurs", libelle: `${nom} — AS (PE)`, valeurs: d.as, total: tot(d.as), moyenne: tot(d.as) / 12, base: t, baseTotal: tot(t) },
      { kind: "valeurs", libelle: `${nom} — TOTAL`, valeurs: t, total: tot(t), moyenne: tot(t) / 12, style: "sous-total", base: troisTotaux, baseTotal: tot(troisTotaux) },
    ];
    const suivi: Ligne[] = [
      ...activite("MÉCA", meca, totMeca),
      ...activite("CALCUL", calcul, totCalc),
      ...activite("ELEC", elec, totElec),
      { kind: "titre", libelle: "SCAN" },
      ca("CA Scan", r.scan),
    ];

    return { lignes, suivi, total, cumulADate, objectif, achatsTotal: tot(r.achats), totalAnnuel };
  }, [mouvements, mois, moisN1, prevu, exercice, moisCourant]);

  /* prises de commande et devis envoyés : mêmes règles que les Indicateurs commerciaux */
  const commercial = useMemo((): Ligne[] => {
    if (!com) return [];
    const impBase = new Map<string, string | null>();
    for (const l of com.lignes) if (l.genre === "BASE" && l.base_affaire) impBase.set(l.base_affaire, l.imputation);
    const pepi = (l: LigneCom) => {
      const imp = l.imputation ?? (l.base_affaire ? impBase.get(l.base_affaire) ?? null : null);
      return imp === "PE" || imp === "PI";
    };
    const montantDe = (l: LigneCom) => com.montants.get(l.id) ?? 0;
    const compter = (liste: LigneCom[], date: (l: LigneCom) => string | null) => {
      const res = { hors: { m: mois.map(() => 0), n: mois.map(() => 0) }, pepi: { m: mois.map(() => 0), n: mois.map(() => 0) } };
      const index = new Map(mois.map((m, i) => [m, i]));
      for (const l of liste) {
        const d = date(l);
        const i = d ? index.get(d.slice(0, 7)) : undefined;
        if (i === undefined) continue;
        const cible = pepi(l) ? res.pepi : res.hors;
        cible.m[i] += montantDe(l);
        cible.n[i] += 1;
      }
      return res;
    };
    const commandes = compter(
      com.lignes.filter((l) => !l.disparue && (l.genre === "BASE" || l.genre === "AVENANT") && !["Devis perdu", "Commande annulée"].includes(l.statut ?? "")),
      (l) => l.date_reception_commande
    );
    const devis = compter(
      com.lignes.filter((l) => !l.disparue && (l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT") && l.statut !== "Devis ouvert"),
      (l) => l.date_envoi ?? l.date_ouverture
    );
    const tot = (v: number[]) => v.reduce((t, x) => t + x, 0);
    const bloc = (titre: string, x: typeof commandes): Ligne[] => {
      const m = mois.map((_, i) => x.hors.m[i] + x.pepi.m[i]);
      const nb = mois.map((_, i) => x.hors.n[i] + x.pepi.n[i]);
      return [
        { kind: "titre", libelle: titre },
        { kind: "valeurs", libelle: "Hors PE et PI", valeurs: x.hors.m, total: tot(x.hors.m), moyenne: tot(x.hors.m) / 12, nb: x.hors.n, nbTotal: tot(x.hors.n) },
        { kind: "valeurs", libelle: "PE et PI", valeurs: x.pepi.m, total: tot(x.pepi.m), moyenne: tot(x.pepi.m) / 12, nb: x.pepi.n, nbTotal: tot(x.pepi.n) },
        { kind: "valeurs", libelle: "TOTAL", valeurs: m, total: tot(m), moyenne: tot(m) / 12, nb, nbTotal: tot(nb), style: "sous-total" },
      ];
    };
    return [...bloc("Prise de commande (date de réception)", commandes), ...bloc("Devis envoyés (date d’envoi)", devis)];
  }, [com, mois]);

  /* ------------------------------ export ------------------------------ */

  async function exporter() {
    type L = Record<string, string | number | null | undefined>;
    const colonnes: ColonneExcel[] = [
      { titre: "", cle: "poste", largeur: 42 },
      ...mois.map((m, i) => ({ titre: `${nomMois(m)} ${m.slice(2, 4)}`, cle: `m${i}`, format: "euros" as const, largeur: 13 })),
      { titre: "Totaux", cle: "total", format: "euros", largeur: 15 },
      { titre: "Moyenne sur 12 mois", cle: "moy", format: "euros", largeur: 15 },
    ];
    const versExcel = (liste: Ligne[]): L[] =>
      liste.flatMap((l): L[] => {
        if (l.kind === "titre") return [{ _style: "groupe", poste: l.libelle }];
        const val = (v: number | null) => (v === null || !Number.isFinite(v) ? null : l.format === "pct" ? `${Math.round(v * 100)} %` : Math.round(v));
        const o: L = { _style: l.style === "total" || l.style === "sous-total" ? "groupe" : "", poste: l.libelle, total: val(l.total), moy: l.moyenne === undefined ? null : val(l.moyenne) };
        l.valeurs.forEach((v, i) => (o[`m${i}`] = val(v)));
        if (!l.nb) return [o];
        const nb: L = { _style: "detail", poste: `${l.libelle} — nombre`, total: l.nbTotal ?? null };
        l.nb.forEach((v, i) => (nb[`m${i}`] = v || null));
        return [o, nb];
      });
    await exporterExcelPolynov(`Trame_CA_${exercice}-${exercice + 1}`, [
      {
        nom: "Trame CA",
        titre: `Trame CA — exercice ${exercice}-${exercice + 1}`,
        sousTitre: `Du 1er novembre ${exercice} au 31 octobre ${exercice + 1} · en date du ${new Date().toLocaleDateString("fr-FR")} · montants réalisés (facturés), en €`,
        colonnes,
        lignes: [
          ...versExcel(trame.lignes),
          { poste: "" },
          { _style: "groupe", poste: "SUIVI D’ACTIVITÉ" },
          ...versExcel(trame.suivi),
          { poste: "" },
          ...versExcel(commercial),
        ],
        alerte: (l) => String(l.poste).startsWith("ÉCART") && Number(l.total ?? 0) < 0,
        notes: [
          "Réalisé = forfaits livrés, échéances / lots livrés, PE / PI des mois clôturés du relevé (et l’historique importé de l’ancien Suivi des prestations).",
          "Frais annexes de refacturation = ajustements saisis à la main pour coller à la comptabilité.",
          "Suivi d’activité : BE = BE + PI + IG ; AS = PE.",
        ],
      },
    ]);
  }

  /* ------------------------------ rendu ------------------------------ */

  const th: CSSProperties = { ...page.th, textAlign: "right", padding: "6px", fontSize: 11 };
  const td: CSSProperties = { textAlign: "right", whiteSpace: "nowrap", padding: "4px 6px", fontSize: 12, borderBottom: `1px solid ${C.ligne}` };
  const tdPct: CSSProperties = { ...td, color: C.gris, fontSize: 11 };
  const colPoste: CSSProperties = { position: "sticky", left: 0, background: "#ffffff", zIndex: 1, textAlign: "left", minWidth: 230 };
  const nbCol = 1 + (mois.length + 1) * (afficherPct ? 2 : 1) + 1;

  const rendre = (liste: Ligne[], prefixe: string) =>
    liste.map((l, k) => {
      if (l.kind === "titre")
        return (
          <tr key={`${prefixe}-${k}`}>
            <td colSpan={nbCol} style={{ ...td, textAlign: "left", fontWeight: 800, background: "#eef0f3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", position: "sticky", left: 0 }}>
              {l.libelle}
            </td>
          </tr>
        );
      const fond = l.style === "total" ? "#fff4f4" : l.style === "sous-total" ? "#f6f7f9" : undefined;
      const poids = l.style === "total" || l.style === "sous-total" ? 800 : 400;
      const couleur = (v: number | null) =>
        l.style === "ecart" && v !== null && Number.isFinite(v) && Math.abs(v) >= (l.format === "pct" ? 0.005 : 0.5) ? (v < 0 ? C.rougeTexte : "#1b5e20") : l.style === "info" ? C.gris : undefined;
      const affiche = (v: number | null) => {
        if (v === null || !Number.isFinite(v)) return "—";
        if (l.format === "pct") return `${v > 0 && l.style === "ecart" ? "+" : ""}${Math.round(v * 100)} %`;
        if (Math.abs(v) < 0.5) return "—";
        return `${v > 0 && l.style === "ecart" ? "+" : ""}${nombre(v)}`;
      };
      const part = (v: number | null, b: number | undefined) => (l.base && v !== null && b && b > 0 ? pourcent(v / b) : "");
      return (
        <tr key={`${prefixe}-${k}`} style={{ background: fond }}>
          <td style={{ ...td, ...colPoste, background: fond ?? "#ffffff", fontWeight: poids, fontStyle: l.style === "info" ? "italic" : undefined }}>{l.libelle}</td>
          {l.valeurs.map((v, i) => [
            <td key={`v${i}`} style={{ ...td, fontWeight: poids, color: couleur(v), background: mois[i] === moisCourant ? "#fffafa" : undefined }}>
              {affiche(v)}
              {l.nb && l.nb[i] > 0 && <div style={{ fontSize: 10, color: C.gris, fontWeight: 400 }}>{l.nb[i]} ligne{l.nb[i] > 1 ? "s" : ""}</div>}
            </td>,
            afficherPct ? <td key={`p${i}`} style={tdPct}>{part(v, l.base?.[i])}</td> : null,
          ])}
          <td style={{ ...td, fontWeight: 800, color: couleur(l.total), borderLeft: `2px solid ${C.ligne}` }}>
            {affiche(l.total)}
            {l.nbTotal !== undefined && l.nbTotal > 0 && <div style={{ fontSize: 10, color: C.gris, fontWeight: 400 }}>{l.nbTotal} lignes</div>}
          </td>
          {afficherPct && <td style={tdPct}>{part(l.total, l.baseTotal)}</td>}
          <td style={{ ...td, color: C.gris }}>{l.moyenne === undefined || l.moyenne === null ? "" : affiche(l.moyenne)}</td>
        </tr>
      );
    });

  const ecartPrevi = trame.objectif > 0 ? trame.cumulADate - trame.objectif : null;

  return (
    <section style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Trame CA — exercice {exercice}-{exercice + 1}</h2>
        <span style={{ fontSize: 13, color: C.gris }}>la présentation du classeur « trame_CA », remplie automatiquement</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={afficherPct} onChange={(e) => setAfficherPct(e.target.checked)} /> Afficher les %
        </label>
        <button type="button" style={page.btnSecondaire} onClick={() => void exporter()}>
          Exporter la trame en Excel
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <Tuile libelle="Total CA en cours" valeur={euros(trame.cumulADate)} sous={`en date du ${new Date().toLocaleDateString("fr-FR")}`} />
        <Tuile
          libelle="Écart CA / prévi"
          valeur={ecartPrevi === null ? "—" : euros(ecartPrevi)}
          sous={trame.objectif > 0 ? `prévisionnel annuel ${euros(trame.objectif)}` : "prévisionnel non saisi"}
          accent={ecartPrevi !== null && ecartPrevi < 0}
        />
        <Tuile
          libelle="Écart CA / prévi avec achats"
          valeur={ecartPrevi === null ? "—" : euros(ecartPrevi - trame.achatsTotal)}
          sous={`achats sur affaires ${euros(trame.achatsTotal)}`}
          accent={ecartPrevi !== null && ecartPrevi - trame.achatsTotal < 0}
        />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, ...colPoste, background: "#f1f2f4" }}>En €</th>
              {mois.map((m) => [
                <th key={m} style={{ ...th, background: m === moisCourant ? "#fff4f4" : undefined }}>
                  {nomMois(m)} {m.slice(2, 4)}
                </th>,
                afficherPct ? <th key={`${m}-p`} style={th}>%</th> : null,
              ])}
              <th style={{ ...th, borderLeft: `2px solid ${C.ligne}` }}>Totaux</th>
              {afficherPct && <th style={th}>%</th>}
              <th style={th}>Moyenne / 12</th>
            </tr>
          </thead>
          <tbody>
            {rendre(trame.lignes, "ca")}
            <tr>
              <td colSpan={nbCol} style={{ ...td, textAlign: "left", fontWeight: 800, fontSize: 15, paddingTop: 16, position: "sticky", left: 0 }}>
                Suivi d’activité
              </td>
            </tr>
            {rendre(trame.suivi, "act")}
            <tr>
              <td colSpan={nbCol} style={{ ...td, textAlign: "left", fontWeight: 800, fontSize: 15, paddingTop: 16, position: "sticky", left: 0 }}>
                Commandes et devis
              </td>
            </tr>
            {erreurCom ? (
              <tr>
                <td colSpan={nbCol} style={{ ...td, textAlign: "left", color: C.rougeTexte }}>{erreurCom}</td>
              </tr>
            ) : !com ? (
              <tr>
                <td colSpan={nbCol} style={{ ...td, textAlign: "left", color: C.gris }}>Chargement…</td>
              </tr>
            ) : (
              rendre(commercial, "com")
            )}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: C.gris, margin: "8px 0 0" }}>
        Mêmes montants que le tableau des 12 mois : le « Total CA mensuel » est le Réalisé. Frais annexes = ajustements saisis pour coller à la compta.
        Suivi d’activité : BE = BE + PI + IG, AS = PE. Commandes et devis : mêmes règles que les Indicateurs commerciaux (lignes de commande et avenants
        comptés séparément).
      </p>
    </section>
  );
}
