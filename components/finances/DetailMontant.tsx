"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { C, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { exporterExcelPolynov } from "@/lib/excelPolynov";
import type { Groupe, MouvementCA } from "@/lib/finances";
import { baseAffaire, chargerFacturationMois, type LigneFacturationMois } from "@/lib/facturationMois";

/* ===============================================================
   FINANCES - DÉTAIL D'UN MONTANT CLIQUÉ

   Ce qui compose un montant du tableau mois par mois (Réalisé, Attendu,
   une imputation ou une activité, dont « Non ventilé ») : une ligne par
   mouvement, avec le n° ARC Louxor (Suivi d'affaire BE), la source et,
   pour le non ventilé, la raison et où corriger. Colonnes triables,
   export Excel aux couleurs de POLYNOV.
================================================================ */

export type DetailDemande = { mois: string; groupe?: Groupe; imputation?: string; ligne?: "REALISE" | "ATTENDU" | "ATTERRISSAGE" };

const SOURCES: Record<string, string> = {
  LIVRAISON: "Forfait livré",
  ECHEANCE: "Échéance / lot livré",
  RELEVE: "Relevé PE / PI",
  HISTORIQUE: "Historique (ancien classeur)",
};
const RAISONS: Record<string, string> = {
  LIVRAISON: "Suivi d’affaire BE : aucune colonne « Montant Méca / Calcul / Elec-Pneu / Scan / Autre / Négoce » remplie pour cette ligne (ni pour ses échéances) : à compléter dans le classeur.",
  ECHEANCE: "Suivi d’affaire BE : l’échéance (ou le lot) n’a pas de montant par discipline : à compléter dans le classeur.",
  RELEVE: "Relevé PE / PI : la ligne n’a pas d’activité, ou son activité n’est rattachée à aucune colonne du Suivi d’affaire (correspondance des activités).",
  HISTORIQUE: "Ancien classeur : le total ne correspond pas à Méca + Calcul + Elec.",
};

function libelleSource(x: MouvementCA) {
  if (x.source !== "ATTENDU") return SOURCES[x.source] ?? x.source;
  if (x.retard) return "Attendu — délai dépassé, reporté sur ce mois";
  if (x.imputation === "PE" || x.imputation === "PI") return "Attendu — prestation prévue (relevé / Suivi des prestations)";
  return "Attendu — forfait à son délai estimé";
}

/* « CBE1604 », « 1604 », « 01604R2 » -> « 1604 » */
const baseDe = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/^(CBE|DBE)/, "").match(/\d+/)?.[0]?.replace(/^0+/, "") ?? "";

type Ligne = {
  affaire: string;
  louxor: string;
  source: string;
  client: string;
  imputation: string;
  montant: number;
  part: number;
  raison: string;
};

/* clic sur l'atterrissage : rapprochement avec la page Facturation ; sinon, le détail du montant */
export default function DetailMontant(props: { detail: DetailDemande; mouvements: MouvementCA[]; attendus: MouvementCA[]; onFermer: () => void }) {
  return props.detail.ligne === "ATTERRISSAGE" ? <Rapprochement {...props} /> : <DetailListe {...props} />;
}

function DetailListe({
  detail,
  mouvements,
  attendus,
  onFermer,
}: {
  detail: DetailDemande;
  mouvements: MouvementCA[];
  attendus: MouvementCA[];
  onFermer: () => void;
}) {
  const [louxor, setLouxor] = useState<Map<string, string[]>>(new Map());
  const [tri, setTri] = useState<{ cle: keyof Ligne; sens: 1 | -1 }>({ cle: "part", sens: -1 });

  // n° ARC Louxor du Suivi d'affaire BE, par affaire (commande, avenants, échéances)
  useEffect(() => {
    let actif = true;
    chargerTout<{ base_affaire: string | null; numero_arc_louxor: string | null }>((a, b) =>
      supabase.from("suivi_lignes").select("base_affaire,numero_arc_louxor").not("numero_arc_louxor", "is", null).order("base_affaire").range(a, b)
    )
      .then((lignes) => {
        if (!actif) return;
        const m = new Map<string, string[]>();
        for (const l of lignes) {
          const b = baseDe(l.base_affaire);
          const n = String(l.numero_arc_louxor ?? "").trim();
          if (!b || !n) continue;
          const liste = m.get(b) ?? [];
          if (!liste.includes(n)) liste.push(n);
          m.set(b, liste);
        }
        setLouxor(m);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, []);

  const lignes = useMemo<Ligne[]>(() => {
    const source = detail.ligne === "ATTENDU" ? attendus : mouvements;
    return source
      .filter((x) => x.date.startsWith(detail.mois))
      .map((x) => {
        const part = detail.ligne ? x.montant : detail.groupe ? x.parGroupe[detail.groupe] : (x.imputation ?? "—") === detail.imputation ? x.montant : 0;
        return {
          affaire: x.base_affaire,
          louxor: (louxor.get(baseDe(x.base_affaire)) ?? []).join(", "),
          source: libelleSource(x),
          client: x.client ?? "",
          imputation: x.imputation ?? "",
          montant: x.montant,
          part,
          raison: detail.groupe === "Non ventilé" ? RAISONS[x.source] ?? "" : "",
        };
      })
      .filter((l) => Math.abs(l.part) > 0.5);
  }, [detail, mouvements, attendus, louxor]);

  const triees = useMemo(
    () =>
      [...lignes].sort((a, b) => {
        const va = a[tri.cle];
        const vb = b[tri.cle];
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * tri.sens;
        return String(va).localeCompare(String(vb), "fr", { numeric: true }) * tri.sens;
      }),
    [lignes, tri]
  );

  const total = lignes.reduce((t, l) => t + l.part, 0);
  const nonVentile = detail.groupe === "Non ventilé";
  const intitule = detail.groupe ?? detail.imputation ?? (detail.ligne === "ATTENDU" ? "Attendu" : "Réalisé");
  const moisLong = new Date(`${detail.mois}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const colonnes: { cle: keyof Ligne; titre: string; droite?: boolean }[] = [
    { cle: "affaire", titre: "Affaire" },
    { cle: "louxor", titre: "N° ARC Louxor" },
    { cle: "source", titre: "Source" },
    { cle: "client", titre: "Client" },
    { cle: "imputation", titre: "Imputation" },
    { cle: "montant", titre: "Montant du mouvement", droite: true },
    { cle: "part", titre: detail.groupe ? `Dont ${detail.groupe}` : "Montant", droite: true },
    ...(nonVentile ? [{ cle: "raison" as const, titre: "Pourquoi / où corriger" }] : []),
  ];

  function exporter() {
    void exporterExcelPolynov(`Finances_${intitule}_${detail.mois}`.replace(/[^\w-]+/g, "_"), [
      {
        nom: "Détail",
        titre: `${intitule} — ${moisLong}`,
        sousTitre: "Espace POLYNOV · Finances · détail du montant",
        colonnes: [
          { titre: "Affaire", cle: "affaire", largeur: 14 },
          { titre: "N° ARC Louxor", cle: "louxor", largeur: 18 },
          { titre: "Source", cle: "source", largeur: 34 },
          { titre: "Client", cle: "client", largeur: 18 },
          { titre: "Imputation", cle: "imputation", largeur: 12 },
          { titre: "Montant du mouvement", cle: "montant", format: "euros", largeur: 18 },
          { titre: detail.groupe ? `Dont ${detail.groupe}` : "Montant", cle: "part", format: "euros", largeur: 16, total: true },
          ...(nonVentile ? [{ titre: "Pourquoi / où corriger", cle: "raison", largeur: 60 }] : []),
        ],
        lignes: triees,
        alerte: (l) => !l.louxor && (l.source === SOURCES.LIVRAISON || l.source === SOURCES.ECHEANCE),
        notes: ["En jaune : forfait livré sans n° ARC Louxor dans le Suivi d'affaire BE."],
      },
    ]);
  }

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px 8px" };
  const td: CSSProperties = { ...page.td, padding: "8px 8px" };

  return (
    <div style={{ marginTop: 14, padding: 14, border: `2px solid ${C.rouge}`, borderRadius: 10, background: "#fffafa" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 16 }}>
          {intitule} — {moisLong} : {euros(total)}
        </strong>
        <span style={{ color: C.gris, fontSize: 13 }}>{lignes.length} ligne{lignes.length > 1 ? "s" : ""}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={exporter} disabled={lignes.length === 0} style={page.btnPrimaire}>
          Exporter en Excel
        </button>
        <button type="button" onClick={onFermer} style={page.btnSecondaire}>
          Fermer ✕
        </button>
      </div>

      {lignes.length === 0 ? (
        <p style={{ margin: 0, color: C.gris }}>Aucune ligne.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr>
                {colonnes.map((c) => (
                  <th key={c.cle} style={{ ...th, textAlign: c.droite ? "right" : "left" }} aria-sort={tri.cle === c.cle ? (tri.sens === 1 ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      title="Trier"
                      onClick={() => setTri({ cle: c.cle, sens: tri.cle === c.cle ? (tri.sens === 1 ? -1 : 1) : c.droite ? -1 : 1 })}
                      style={{ all: "unset", cursor: "pointer", fontWeight: 800 }}
                    >
                      {c.titre} <span style={{ color: tri.cle === c.cle ? C.rouge : "#b3b9c0" }}>{tri.cle === c.cle ? (tri.sens === 1 ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {triees.map((l, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>{l.affaire}</td>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {l.louxor || ((l.source === SOURCES.LIVRAISON || l.source === SOURCES.ECHEANCE) ? <span style={{ color: "#b3261e" }}>⚠ manquant</span> : <span style={{ color: C.gris }}>—</span>)}
                  </td>
                  <td style={td}>{l.source}</td>
                  <td style={td}>{l.client || "—"}</td>
                  <td style={td}>{l.imputation || "—"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{euros(l.montant)}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontWeight: 800 }}>{euros(l.part)}</td>
                  {nonVentile && <td style={{ ...td, fontSize: 12, color: "#7a3e00", minWidth: 260 }}>{l.raison}</td>}
                </tr>
              ))}
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: "right", fontWeight: 800 }}>
                  Total
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>{euros(total)}</td>
                {nonVentile && <td style={td} />}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


/* ===============================================================
   RAPPROCHEMENT : ATTERRISSAGE DE FINANCES  ↔  PAGE FACTURATION

   Pour le mois cliqué, affaire par affaire : ce que compte Finances
   (réalisé + attendu) et ce que compte Facturation (livré, prévu, PE / PI),
   l'écart et sa raison. Par défaut, seules les affaires en écart.
================================================================ */

type LigneRappro = {
  base: string;
  client: string;
  finances: number;
  sourcesFinances: string;
  facturation: number; // facturable (livré + prévu + PE / PI facturables)
  nonFacturable: number;
  typesFacturation: string;
  ecart: number; // Finances − Facturation (facturable)
  raison: string;
};

function Rapprochement({ detail, mouvements, attendus, onFermer }: { detail: DetailDemande; mouvements: MouvementCA[]; attendus: MouvementCA[]; onFermer: () => void }) {
  const [fact, setFact] = useState<LigneFacturationMois[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [toutes, setToutes] = useState(false);

  useEffect(() => {
    let actif = true;
    setFact(null);
    chargerFacturationMois(detail.mois)
      .then((l) => actif && setFact(l))
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Chargement de la facturation impossible."));
    return () => {
      actif = false;
    };
  }, [detail.mois]);

  const lignes = useMemo<LigneRappro[]>(() => {
    if (!fact) return [];
    const m = new Map<string, LigneRappro & { _sources: Set<string>; _types: Set<string> }>();
    const prendre = (base: string) => {
      const e = m.get(base) ?? { base, client: "", finances: 0, sourcesFinances: "", facturation: 0, nonFacturable: 0, typesFacturation: "", ecart: 0, raison: "", _sources: new Set<string>(), _types: new Set<string>() };
      m.set(base, e);
      return e;
    };
    for (const x of [...mouvements, ...attendus]) {
      if (!x.date.startsWith(detail.mois)) continue;
      const e = prendre(baseAffaire(x.base_affaire) || x.base_affaire);
      e.finances += x.montant;
      e._sources.add(libelleSource(x));
      if (!e.client && x.client) e.client = x.client;
    }
    for (const f of fact) {
      const e = prendre(f.base || f.numero);
      if (f.facturable) e.facturation += f.montant;
      else e.nonFacturable += f.montant;
      e._types.add(f.facturable ? f.type : `${f.type} non facturable`);
      if (!e.client && f.client) e.client = f.client;
    }
    return [...m.values()]
      .map((e) => {
        const ecart = Math.round((e.finances - e.facturation) * 100) / 100;
        let raison = "✓ identique";
        if (Math.abs(ecart) >= 1) {
          if (e.facturation === 0 && e.nonFacturable === 0) {
            raison = [...e._sources].some((s) => s.startsWith("Historique"))
              ? "Absent de Facturation : ligne du classeur non rattachée au relevé (historique)"
              : [...e._sources].some((s) => s.includes("prestation prévue"))
                ? "Absent de Facturation : PE / PI prévue dans Finances mais rien dans le relevé du mois"
                : "Absent de Facturation";
          } else if (e.finances === 0) raison = "Absent de Finances";
          else if (Math.abs(ecart - e.nonFacturable) < 1) raison = "Non facturable : compté dans Finances, exclu de Facturation";
          else raison = "Montant différent";
        }
        return { base: e.base, client: e.client, finances: e.finances, sourcesFinances: [...e._sources].join(" + "), facturation: e.facturation, nonFacturable: e.nonFacturable, typesFacturation: [...e._types].join(" + "), ecart, raison };
      })
      .sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart) || a.base.localeCompare(b.base, "fr", { numeric: true }));
  }, [fact, mouvements, attendus, detail.mois]);

  const visibles = toutes ? lignes : lignes.filter((l) => Math.abs(l.ecart) >= 1);
  const totalFin = lignes.reduce((t, l) => t + l.finances, 0);
  const totalFact = lignes.reduce((t, l) => t + l.facturation, 0);
  const parRaison = new Map<string, number>();
  for (const l of lignes) if (Math.abs(l.ecart) >= 1) parRaison.set(l.raison, (parRaison.get(l.raison) ?? 0) + l.ecart);
  const moisLong = new Date(`${detail.mois}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "8px 8px" };
  const td: CSSProperties = { ...page.td, padding: "8px 8px" };
  const tdD: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  function exporter() {
    void exporterExcelPolynov(`Rapprochement_${detail.mois}`, [
      {
        nom: "Rapprochement",
        titre: `Rapprochement Finances ↔ Facturation — ${moisLong}`,
        sousTitre: "Finances = réalisé + attendu (atterrissage). Facturation = livré + prévu + PE / PI facturables. Écart = Finances − Facturation.",
        colonnes: [
          { titre: "Affaire", cle: "base", largeur: 10 },
          { titre: "Client", cle: "client", largeur: 18 },
          { titre: "Finances", cle: "finances", format: "euros", largeur: 14, total: true },
          { titre: "Sources Finances", cle: "sourcesFinances", largeur: 40 },
          { titre: "Facturation", cle: "facturation", format: "euros", largeur: 14, total: true },
          { titre: "Non facturable", cle: "nonFacturable", format: "euros", largeur: 14, total: true },
          { titre: "Lignes Facturation", cle: "typesFacturation", largeur: 28 },
          { titre: "Écart", cle: "ecart", format: "euros", largeur: 12, total: true },
          { titre: "Raison", cle: "raison", largeur: 50 },
        ],
        lignes,
        alerte: (l) => Math.abs(Number(l.ecart)) >= 1,
      },
    ]);
  }

  return (
    <div style={{ marginTop: 14, padding: 14, border: `2px solid ${C.rouge}`, borderRadius: 10, background: "#fffafa" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 16 }}>Rapprochement avec la page Facturation — {moisLong}</strong>
        <span style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} /> voir aussi les affaires identiques
        </label>
        <button type="button" onClick={exporter} disabled={!fact} style={page.btnPrimaire}>Exporter en Excel</button>
        <button type="button" onClick={onFermer} style={page.btnSecondaire}>Fermer ✕</button>
      </div>

      {erreur && <p style={{ color: "#b3261e", fontWeight: 700 }}>{erreur}</p>}
      {!fact && !erreur && <p style={{ color: C.gris }}>Calcul de la facturation du mois…</p>}

      {fact && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", marginBottom: 10, fontSize: 15 }}>
            <span>Atterrissage Finances : <strong>{euros(totalFin)}</strong></span>
            <span>Facturation (facturable) : <strong>{euros(totalFact)}</strong></span>
            <span>Écart : <strong style={{ color: Math.abs(totalFin - totalFact) >= 1 ? "#b3261e" : "#1b5e20" }}>{euros(totalFin - totalFact)}</strong></span>
          </div>
          {parRaison.size > 0 && (
            <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 14 }}>
              {[...parRaison.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([r, v]) => (
                <li key={r}>
                  {r} : <strong>{euros(v)}</strong>
                </li>
              ))}
            </ul>
          )}
          {visibles.length === 0 ? (
            <p style={{ margin: 0, color: "#1b5e20", fontWeight: 700 }}>✓ Aucune différence : les deux pages comptent les mêmes affaires, pour les mêmes montants.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                <thead>
                  <tr>
                    <th style={th}>Affaire</th>
                    <th style={th}>Client</th>
                    <th style={{ ...th, textAlign: "right" }}>Finances</th>
                    <th style={th}>Sources Finances</th>
                    <th style={{ ...th, textAlign: "right" }}>Facturation</th>
                    <th style={th}>Lignes Facturation</th>
                    <th style={{ ...th, textAlign: "right" }}>Écart</th>
                    <th style={th}>Raison</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((l) => (
                    <tr key={l.base} style={Math.abs(l.ecart) >= 1 ? { background: "#fff7c2" } : undefined}>
                      <td style={{ ...td, fontWeight: 800 }}>{l.base}</td>
                      <td style={td}>{l.client || "—"}</td>
                      <td style={tdD}>{l.finances ? euros(l.finances) : "—"}</td>
                      <td style={{ ...td, fontSize: 12, color: C.gris }}>{l.sourcesFinances || "—"}</td>
                      <td style={tdD}>
                        {l.facturation ? euros(l.facturation) : "—"}
                        {l.nonFacturable > 0 && <div style={{ fontSize: 11, color: "#7a3e00" }}>+ {euros(l.nonFacturable)} non facturable</div>}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: C.gris }}>{l.typesFacturation || "—"}</td>
                      <td style={{ ...tdD, fontWeight: 800, color: Math.abs(l.ecart) >= 1 ? "#b3261e" : "#1b5e20" }}>{euros(l.ecart)}</td>
                      <td style={{ ...td, fontSize: 12.5 }}>{l.raison}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
