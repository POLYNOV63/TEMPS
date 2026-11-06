"use client";

/* ===============================================================
   FINANCES - TRAME CA (TRAME_CA_V3, après TRAME_CA_V2)

   Le tableau du classeur « trame_CA.xlsm », rempli par l'application,
   sur les 12 mois de l'exercice (novembre → octobre) :
   - CA réalisé par imputation (BE, PI, IG, PE) et par activité
     (Méca, Calcul, Elec), Négoce, Scan, achats sur affaires,
     CA BE sans / avec achats, CA PE, frais annexes (= ajustements) ;
   - prévisionnel du mois (saisi ici par l'ADMIN), réalisé, attendu,
     fait / facturé plus tard, atterrissage, cumuls, écarts, N-1, objectif
     (V2 : remplace le tableau « Les 12 mois de l'exercice ») ;
   - remplir le prévisionnel (ADMIN) : un % du réalisé N-1 mois par
     mois, ou un total annuel réparti (V3, remplace le bandeau de la page).
   (V3 : « Commandes et devis » retirés, ils sont dans les Indicateurs.)

   Les montants viennent des mêmes calculs que le reste de la page
   (mouvements de lib/finances.ts) : le « Total CA mensuel » est égal
   au « Réalisé » du tableau des 12 mois.
================================================================ */

import { useMemo, useState, type CSSProperties } from "react";
import { C, Tuile, page } from "@/components/pilotage/ui";
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
      saisie?: boolean; // prévisionnel : case modifiable (ADMIN)
      clic?: (i: number) => void; // montant cliquable : son détail
    };

export default function TrameCA(props: {
  exercice: number;
  mois: string[];
  moisN1: string[];
  mouvements: MouvementCA[];
  prevu: number[];
  attendu?: number[];
  faitPlusTard?: number[];
  estAdmin?: boolean;
  onPrevu?: (mois: string, valeur: number) => void;
  onDetail?: (i: number, ligne: "REALISE" | "ATTENDU" | "ATTERRISSAGE") => void;
  onDetailReport?: (i: number) => void;
  onPrevuTous?: (valeurs: Map<string, number>) => unknown;
}) {
  const { exercice, mois, moisN1, mouvements, prevu, estAdmin, onPrevu, onDetail, onDetailReport, onPrevuTous } = props;
  const attendu = props.attendu ?? mois.map(() => 0);
  const faitPlusTard = props.faitPlusTard ?? mois.map(() => 0);
  const [afficherPct, setAfficherPct] = useState(false);
  const [pctN1, setPctN1] = useState("100");
  const [totalSaisi, setTotalSaisi] = useState("");
  const [message, setMessage] = useState("");
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
    const atterrissage = total.map((v, i) => v + attendu[i]);
    let ca2 = 0;
    const cumulAtter = atterrissage.map((v) => (ca2 += v));

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
      { kind: "valeurs", libelle: "Prévisionnel du mois", valeurs: prevu, total: objectif, moyenne: objectif / 12, saisie: true },
      {
        kind: "valeurs",
        libelle: "TOTAL CA MENSUEL (réalisé)",
        valeurs: total,
        total: totalAnnuel,
        moyenne: totalAnnuel / 12,
        style: "total",
        clic: onDetail ? (i) => onDetail(i, "REALISE") : undefined,
      },
      {
        kind: "valeurs",
        libelle: "Attendu (pas encore livré ou facturé)",
        valeurs: attendu,
        total: tot(attendu),
        style: "info",
        clic: onDetail ? (i) => onDetail(i, "ATTENDU") : undefined,
      },
      ...(nonNul(faitPlusTard)
        ? [
            {
              kind: "valeurs" as const,
              libelle: "Fait, facturé plus tard (hors atterrissage)",
              valeurs: faitPlusTard,
              total: tot(faitPlusTard),
              style: "info" as const,
              clic: onDetailReport,
            },
          ]
        : []),
      {
        kind: "valeurs",
        libelle: "ATTERRISSAGE (réalisé + attendu)",
        valeurs: atterrissage,
        total: tot(atterrissage),
        moyenne: tot(atterrissage) / 12,
        style: "total",
        clic: onDetail ? (i) => onDetail(i, "ATTERRISSAGE") : undefined,
      },
      {
        kind: "valeurs",
        libelle: "Écart atterrissage − prévisionnel",
        valeurs: atterrissage.map((v, i) => (prevu[i] > 0 ? v - prevu[i] : null)),
        total: objectif > 0 ? tot(atterrissage) - objectif : null,
        style: "ecart",
      },
      { kind: "valeurs", libelle: "TOTAL CUMULÉ (réalisé)", valeurs: jusquA(cumul), total: cumulADate, style: "sous-total" },
      { kind: "valeurs", libelle: "PRÉVISIONNEL (cumulé)", valeurs: prevuCumul, total: objectif },
      {
        kind: "valeurs",
        libelle: "ÉCART CA / PRÉVI CUMULÉ",
        valeurs: jusquA(cumul.map((v, i) => v - prevuCumul[i])),
        total: objectif > 0 ? totalAnnuel - objectif : null,
        style: "ecart",
      },
      { kind: "valeurs", libelle: "Cumul atterrissage", valeurs: cumulAtter, total: tot(atterrissage) },
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

    return { lignes, total, total1, cumulADate, objectif, achatsTotal: tot(r.achats), totalAnnuel };
  }, [mouvements, mois, moisN1, prevu, attendu, faitPlusTard, exercice, moisCourant, onDetail, onDetailReport]);

  /* ------------------------------ remplir le prévisionnel ------------------------------ */

  const lireNombre = (x: string) => Number(x.replace(/\s/g, "").replace(",", "."));
  async function remplir(valeurs: number[], texte: string) {
    if (!onPrevuTous) return;
    if (trame.objectif > 0 && !window.confirm(`Remplacer le prévisionnel actuel (${euros(trame.objectif)}) sur les 12 mois ?`)) return;
    await onPrevuTous(new Map(mois.map((m, i) => [m, Math.max(0, Math.round(valeurs[i]))])));
    setMessage(texte);
  }
  function pourcentN1() {
    const k = lireNombre(pctN1);
    if (!Number.isFinite(k) || k <= 0) return setMessage("Saisissez un pourcentage (ex. 105).");
    const base = trame.total1.reduce((t, v) => t + v, 0);
    if (base <= 0) return setMessage(`Pas de réalisé sur ${exercice - 1}-${exercice} : impossible de partir de N-1.`);
    void remplir(trame.total1.map((v) => (v * k) / 100), `Prévisionnel = ${k} % du réalisé ${exercice - 1}-${exercice}, mois par mois : ${euros((base * k) / 100)}.`);
  }
  function repartir(mode: "EGAL" | "N1") {
    const total = lireNombre(totalSaisi);
    if (!Number.isFinite(total) || total <= 0) return setMessage("Saisissez un total annuel.");
    const base = trame.total1.reduce((t, v) => t + v, 0);
    if (mode === "N1" && base <= 0) return setMessage(`Pas de réalisé sur ${exercice - 1}-${exercice} pour répartir au prorata.`);
    void remplir(
      mois.map((_, i) => (mode === "EGAL" ? total / 12 : (total * trame.total1[i]) / base)),
      `Prévisionnel de ${euros(total)} réparti ${mode === "EGAL" ? "en 12 parts égales" : "comme l’exercice précédent"}.`
    );
  }

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
        return [o];
      });
    await exporterExcelPolynov(`Trame_CA_${exercice}-${exercice + 1}`, [
      {
        nom: "Trame CA",
        titre: `Trame CA — exercice ${exercice}-${exercice + 1}`,
        sousTitre: `Du 1er novembre ${exercice} au 31 octobre ${exercice + 1} · en date du ${new Date().toLocaleDateString("fr-FR")} · montants réalisés (facturés), en €`,
        colonnes,
        lignes: [
          ...versExcel(trame.lignes),
        ],
        alerte: (l) => String(l.poste).startsWith("ÉCART") && Number(l.total ?? 0) < 0,
        notes: [
          "Réalisé = forfaits livrés, échéances / lots livrés, PE / PI des mois clôturés du relevé (et l’historique importé de l’ancien Suivi des prestations).",
          "Frais annexes de refacturation = ajustements saisis à la main pour coller à la comptabilité.",
          "Attendu = forfaits pas encore livrés (au mois de leur délai estimé) et PE / PI prévues ; atterrissage = réalisé + attendu.",
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
            <td key={`v${i}`} style={{ ...td, fontWeight: poids, color: couleur(v), background: mois[i] === moisCourant ? "#fffafa" : undefined, padding: l.saisie && estAdmin ? 2 : td.padding }}>
              {l.saisie && estAdmin && onPrevu ? (
                <input
                  key={`${mois[i]}-${v}`}
                  defaultValue={v ? String(Math.round(v)) : ""}
                  inputMode="decimal"
                  aria-label={`Prévisionnel ${nomMois(mois[i])}`}
                  onBlur={(e) => {
                    const x = Number(e.currentTarget.value.replace(/\s/g, "").replace(",", ".")) || 0;
                    if (x !== v) onPrevu(mois[i], x);
                  }}
                  style={{ width: 72, textAlign: "right", border: "1px solid #c9cdd2", borderRadius: 4, padding: 3, fontFamily: "inherit", fontSize: 12 }}
                />
              ) : l.clic && v !== null && Math.abs(v) >= 0.5 ? (
                <button
                  type="button"
                  title="Voir le détail de ce montant"
                  onClick={() => l.clic?.(i)}
                  style={{ all: "unset", cursor: "pointer", textDecoration: "underline dotted" }}
                >
                  {affiche(v)}
                </button>
              ) : (
                affiche(v)
              )}
            </td>,
            afficherPct ? <td key={`p${i}`} style={tdPct}>{part(v, l.base?.[i])}</td> : null,
          ])}
          <td style={{ ...td, fontWeight: 800, color: couleur(l.total), borderLeft: `2px solid ${C.ligne}` }}>
            {affiche(l.total)}
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

      {estAdmin && onPrevuTous && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12, padding: 10, background: "#f6f9ff", border: `1px solid ${C.ligne}`, borderRadius: 8, fontSize: 13 }}>
          <strong>Remplir le prévisionnel :</strong>
          <span>réalisé {exercice - 1}-{exercice} ×</span>
          <input value={pctN1} onChange={(e) => setPctN1(e.target.value)} inputMode="decimal" aria-label="Pourcentage du réalisé N-1" style={{ ...page.entrees, width: 70, minHeight: 34, fontSize: 14 }} />
          <span>%</span>
          <button type="button" style={page.btnSecondaire} onClick={pourcentN1}>Appliquer mois par mois</button>
          <span style={{ width: 16 }} />
          <span>ou un total annuel</span>
          <input value={totalSaisi} onChange={(e) => setTotalSaisi(e.target.value)} placeholder="€" inputMode="decimal" aria-label="Total annuel prévu" style={{ ...page.entrees, width: 120, minHeight: 34, fontSize: 14 }} />
          <button type="button" style={page.btnSecondaire} onClick={() => repartir("EGAL")}>en 12 parts égales</button>
          <button type="button" style={page.btnSecondaire} onClick={() => repartir("N1")}>comme N-1</button>
          {message && <span style={{ flexBasis: "100%", color: C.bleuTexte, fontWeight: 600 }}>{message}</span>}
        </div>
      )}

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
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: C.gris, margin: "8px 0 0" }}>
        Mêmes montants que le tableau des 12 mois : le « Total CA mensuel » est le Réalisé. Frais annexes = ajustements saisis pour coller à la compta.
        Les montants soulignés s’ouvrent sur leur détail.
      </p>
    </section>
  );
}
