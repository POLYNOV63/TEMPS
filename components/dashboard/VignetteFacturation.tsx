"use client";

import { useEffect, useState } from "react";
import { chargerFacturationMois, type LigneFacturationMois } from "@/lib/facturationMois";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   TABLEAU DE BORD - VIGNETTE « À FACTURER » (DASHBOARD_SIMPLIFIE)

   Le total prévu au mois en cours et au mois suivant, comme si tout
   était facturable : même calcul que la page Facturation du mois
   (lib/facturationMois.ts) :
     - forfaits livrés dans le mois ;
     - forfaits prévus (commande reçue / intention, date de livraison
       estimée dans le mois ; déjà dépassée : au mois en cours) ;
     - PE / PI du relevé.
   En petit : la part des PE / PI pas encore facturable (affaire ni en
   cours ni livrée). Un clic ouvre la Facturation du mois.
   VIGNETTE_PREVISIONNEL : face au prévisionnel du mois (finances_previsionnel,
   saisi dans la page Finances) : montant, part atteinte et écart.
================================================================ */

type Synthese = { mois: string; total: number; livre: number; prevu: number; pepi: number; nonFacturable: number; previsionnel: number | null };

const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const keuros = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n));

function synthese(mois: string, lignes: LigneFacturationMois[], previsionnel: number | null): Synthese {
  const s = (f: (l: LigneFacturationMois) => boolean) => lignes.filter(f).reduce((t, l) => t + l.montant, 0);
  return {
    mois,
    total: s(() => true),
    livre: s((l) => l.type === "Forfait"),
    prevu: s((l) => l.type === "Forfait prévu"),
    pepi: s((l) => l.type === "PE / PI"),
    nonFacturable: s((l) => !l.facturable),
    previsionnel,
  };
}

export default function VignetteFacturation({ onOuvrir }: { onOuvrir: () => void }) {
  const [donnees, setDonnees] = useState<Synthese[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;
    const d = new Date();
    const courant = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const s = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const suivant = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}`;
    Promise.all([
      chargerFacturationMois(courant),
      chargerFacturationMois(suivant),
      // le prévisionnel des deux mois (sans droit de lecture ou sans saisie : pas de prévisionnel affiché)
      supabase.from("finances_previsionnel").select("mois,montant").gte("mois", `${courant}-01`).lte("mois", `${suivant}-28`),
    ])
      .then(([a, b, p]) => {
        if (!actif) return;
        const prev = new Map<string, number>();
        for (const x of ((p.error ? [] : p.data ?? []) as { mois: string; montant: number | string }[])) prev.set(String(x.mois).slice(0, 7), (prev.get(String(x.mois).slice(0, 7)) ?? 0) + (Number(x.montant) || 0));
        setDonnees([synthese(courant, a, prev.get(courant) ?? null), synthese(suivant, b, prev.get(suivant) ?? null)]);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Facturation indisponible."));
    return () => {
      actif = false;
    };
  }, []);

  const nomMois = (m: string) => `${NOMS_MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

  return (
    <div
      role="button"
      tabIndex={0}
      title="Ouvrir la Facturation du mois"
      onClick={onOuvrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOuvrir();
        }
      }}
      style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #e3e6ea", borderLeft: "5px solid #1b5e20", padding: "12px 16px", marginBottom: 14, cursor: "pointer", boxShadow: "0 1px 5px rgba(0,0,0,0.06)" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 16 }}>🧾 À facturer</strong>
        <span style={{ fontSize: 12.5, color: "#6b7076" }}>si tout était facturable : forfaits livrés et prévus, PE / PI du relevé</span>
      </div>
      {erreur && <div style={{ color: "#b3261e", fontSize: 13 }}>{erreur}</div>}
      {!erreur && !donnees && <div style={{ color: "#6b7076", fontSize: 13 }}>Calcul en cours…</div>}
      {donnees && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {donnees.map((d, k) => (
            <div key={d.mois} style={{ background: k === 0 ? "#f2faf3" : "#f7f8f9", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: "#6b7076" }}>
                {k === 0 ? "Ce mois-ci" : "Mois prochain"} · {nomMois(d.mois)}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#1f2328" }}>{euros(d.total)}</div>
              <div style={{ fontSize: 12.5, color: "#5b6168" }}>
                {[d.livre > 0 ? `livré ${keuros(d.livre)}` : "", d.prevu > 0 ? `prévu ${keuros(d.prevu)}` : "", d.pepi > 0 ? `PE / PI ${keuros(d.pepi)}` : ""].filter(Boolean).join(" · ") || "rien de prévu"}
              </div>
              {d.nonFacturable > 0.5 && <div style={{ fontSize: 12.5, color: "#c76500", fontWeight: 700 }}>dont {keuros(d.nonFacturable)} pas encore facturable</div>}
              {/* VIGNETTE_PREVISIONNEL */}
              {d.previsionnel !== null && d.previsionnel > 0 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #dfe3e7", fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: "#5b6168" }}>Prévisionnel {keuros(d.previsionnel)}</span>
                    <strong style={{ color: d.total >= d.previsionnel ? "#1b5e20" : "#c76500" }}>
                      {Math.round((d.total / d.previsionnel) * 100)} % · {d.total >= d.previsionnel ? "+" : "−"}
                      {keuros(Math.abs(d.total - d.previsionnel))}
                    </strong>
                  </div>
                  <div style={{ height: 6, background: "#e6e8eb", borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, (d.total / d.previsionnel) * 100)}%`, height: "100%", background: d.total >= d.previsionnel ? "#2e7d32" : "#e08a00" }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
