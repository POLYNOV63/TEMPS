"use client";

import { useEffect, useState } from "react";
import { C, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   BILAN AFFAIRE - HEURES PAR SOUS-DOSSIER
   Les sous-dossiers sont saisis librement dans les feuilles d'heures
   (« Lot 2 - châssis »…). Le bloc ne s'affiche que si au moins une
   heure de l'affaire porte un sous-dossier.
================================================================ */

type Ligne = { sous_dossier: string; heures: number | string; personnes: number; premier_jour: string | null; dernier_jour: string | null };

const h = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")} h`;
const date = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "");

export default function SousDossiersAffaire({ type, numero }: { type: string; numero: string }) {
  const [lignes, setLignes] = useState<Ligne[]>([]);

  useEffect(() => {
    let actif = true;
    supabase
      .rpc("bilan_affaire_sous_dossiers", { p_type: type, p_numero: numero.match(/^\d+/)?.[0] ?? numero })
      .then(({ data, error }) => {
        if (actif) setLignes(error ? [] : ((data ?? []) as Ligne[]));
      });
    return () => {
      actif = false;
    };
  }, [type, numero]);

  // rien à montrer tant qu'aucune heure ne porte de sous-dossier
  if (!lignes.some((l) => l.sous_dossier !== "(non précisé)")) return null;

  const total = lignes.reduce((t, l) => t + (Number(l.heures) || 0), 0);
  const max = Math.max(1, ...lignes.map((l) => Number(l.heures) || 0));

  return (
    <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Par sous-dossier</h2>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>Précisé par les collaborateurs dans leurs feuilles d’heures (champ libre).</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={page.th}>Sous-dossier</th>
              <th style={{ ...page.th, textAlign: "right" }}>Heures</th>
              <th style={page.th} />
              <th style={{ ...page.th, textAlign: "right" }}>Personnes</th>
              <th style={page.th}>Période</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const v = Number(l.heures) || 0;
              const nonPrecise = l.sous_dossier === "(non précisé)";
              return (
                <tr key={l.sous_dossier}>
                  <td style={{ ...page.td, fontWeight: nonPrecise ? 400 : 800, color: nonPrecise ? C.gris : undefined, fontStyle: nonPrecise ? "italic" : undefined }}>{l.sous_dossier}</td>
                  <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{h(v)}</td>
                  <td style={{ ...page.td, width: "30%" }}>
                    <span style={{ display: "block", height: 10, borderRadius: 5, background: "#eef0f3", position: "relative" }}>
                      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(v / max) * 100}%`, borderRadius: 5, background: nonPrecise ? "#c9cdd2" : C.rouge }} />
                    </span>
                  </td>
                  <td style={{ ...page.td, textAlign: "right" }}>{l.personnes}</td>
                  <td style={{ ...page.td, whiteSpace: "nowrap", fontSize: 13, color: C.gris }}>
                    {date(l.premier_jour)} → {date(l.dernier_jour)}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...page.td, fontWeight: 800 }}>Total</td>
              <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{h(total)}</td>
              <td style={page.td} colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
