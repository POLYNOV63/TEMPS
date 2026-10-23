"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { C, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { exporterExcelPolynov } from "@/lib/excelPolynov";
import type { Groupe, MouvementCA } from "@/lib/finances";

/* ===============================================================
   FINANCES - DÉTAIL D'UN MONTANT CLIQUÉ

   Ce qui compose un montant du tableau mois par mois (Réalisé, Attendu,
   une imputation ou une activité, dont « Non ventilé ») : une ligne par
   mouvement, avec le n° ARC Louxor (Suivi d'affaire BE), la source et,
   pour le non ventilé, la raison et où corriger. Colonnes triables,
   export Excel aux couleurs de POLYNOV.
================================================================ */

export type DetailDemande = { mois: string; groupe?: Groupe; imputation?: string; ligne?: "REALISE" | "ATTENDU" };

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

export default function DetailMontant({
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
