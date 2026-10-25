"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { exporterExcelPolynov } from "@/lib/excelPolynov";

/* ===============================================================
   SYNCHRONISATION DU SUIVI D'AFFAIRE BE - CONTRÔLE POUR LA FACTURATION

   Après chaque import, on relit la copie du classeur et on liste, ligne
   Excel par ligne Excel, ce qui empêche la facturation et les finances
   d'être justes :
   - Livrée sans date de livraison (le forfait ne tombe dans aucun mois) ;
   - Livrée sans n° ARC Louxor ;
   - Commande reçue sans n° ARC Louxor ;
   - commande reçue / intention sans date de livraison estimée (absente
     du CA attendu de Finances) ;
   - Livrée sans aucun montant.
   Export Excel pour corriger le classeur au calme.
================================================================ */

type Ligne = {
  id: string;
  cle: string;
  genre: string;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  numero_affaire: string | null;
  base_affaire: string | null;
  date_livraison: string | null;
  date_livraison_estimee: string | null;
  numero_arc_louxor: string | null;
  ligne_excel: number | null;
  disparue: boolean;
};

type Controle = { code: string; libelle: string; aRemplir: string; grave: boolean };

const CONTROLES: Controle[] = [
  { code: "LIVREE_SANS_DATE", libelle: "Livrée sans date de livraison", aRemplir: "Date de livraison", grave: true },
  { code: "LIVREE_SANS_LOUXOR", libelle: "Livrée sans n° ARC Louxor", aRemplir: "N°ARC Louxor", grave: true },
  { code: "LIVREE_SANS_MONTANT", libelle: "Livrée sans montant", aRemplir: "Montant (ou Montant échéances)", grave: true },
  { code: "RECUE_SANS_LOUXOR", libelle: "Commande reçue sans n° ARC Louxor", aRemplir: "N°ARC Louxor", grave: false },
  { code: "EN_COURS_SANS_ESTIMEE", libelle: "En cours sans date de livraison estimée", aRemplir: "Date de livraison estimée", grave: false },
];

type Probleme = {
  controle: Controle;
  ligne: number | null;
  numero: string;
  statut: string;
  imputation: string;
  designation: string;
};

const prestation = (imp: string | null) => imp === "PE" || imp === "PI";
const commandes = ["BASE", "AVENANT", "ECHEANCE", "LOT"];

export default function ControleSuiviAffaire({ actualisation }: { actualisation?: string }) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [montants, setMontants] = useState<Map<string, number>>(new Map());
  const [erreur, setErreur] = useState("");
  const [filtre, setFiltre] = useState<string>("");

  useEffect(() => {
    let actif = true;
    setLignes(null);
    Promise.all([
      chargerTout<Ligne>((a, b) =>
        supabase
          .from("suivi_lignes")
          .select("id,cle,genre,statut,imputation,designation,numero_affaire,base_affaire,date_livraison,date_livraison_estimee,numero_arc_louxor,ligne_excel,disparue")
          .order("cle")
          .range(a, b)
      ),
      chargerTout<{ ligne_id: string; montant: number | string | null; montant_echeances: number | string | null }>((a, b) =>
        supabase.from("suivi_lignes_montants").select("ligne_id,montant,montant_echeances").order("ligne_id").range(a, b)
      ),
    ])
      .then(([l, m]) => {
        if (!actif) return;
        setLignes(l);
        setMontants(new Map(m.map((x) => [x.ligne_id, (Number(x.montant) || 0) + (Number(x.montant_echeances) || 0)])));
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Contrôle impossible."));
    return () => {
      actif = false;
    };
  }, [actualisation]);

  const problemes = useMemo<Probleme[]>(() => {
    if (!lignes) return [];
    // l'imputation d'un avenant ou d'un découpage est celle de sa commande de base
    const parBase = new Map<string, Ligne>();
    for (const l of lignes) if (l.genre === "BASE" && l.base_affaire) parBase.set(l.base_affaire, l);
    const res: Probleme[] = [];
    for (const l of lignes) {
      if (l.disparue || !commandes.includes(l.genre)) continue;
      const imputation = l.imputation ?? (l.base_affaire ? parBase.get(l.base_affaire)?.imputation ?? null : null);
      const pp = prestation(imputation);
      const ajouter = (code: string) =>
        res.push({
          controle: CONTROLES.find((c) => c.code === code)!,
          ligne: l.ligne_excel,
          numero: l.genre === "BASE" || l.genre === "AVENANT" ? l.numero_affaire ?? l.cle : l.cle,
          statut: l.statut ?? "",
          imputation: imputation ?? "",
          designation: l.designation ?? (l.base_affaire ? parBase.get(l.base_affaire)?.designation ?? "" : ""),
        });
      const louxor = Boolean(l.numero_arc_louxor?.trim());
      if (l.statut === "Livrée") {
        if (!l.date_livraison) ajouter("LIVREE_SANS_DATE");
        if (!louxor) ajouter("LIVREE_SANS_LOUXOR");
        if (!pp && (montants.get(l.id) ?? 0) <= 0.004) ajouter("LIVREE_SANS_MONTANT");
      } else if (l.statut === "Commande reçue") {
        if (!louxor) ajouter("RECUE_SANS_LOUXOR");
        if (!pp && !l.date_livraison_estimee) ajouter("EN_COURS_SANS_ESTIMEE");
      } else if (l.statut === "Intention de commande") {
        if (!pp && !l.date_livraison_estimee) ajouter("EN_COURS_SANS_ESTIMEE");
      }
    }
    return res.sort((a, b) => (a.ligne ?? 1e9) - (b.ligne ?? 1e9) || a.controle.libelle.localeCompare(b.controle.libelle, "fr"));
  }, [lignes, montants]);

  const visibles = filtre ? problemes.filter((p) => p.controle.code === filtre) : problemes;

  function exporter() {
    void exporterExcelPolynov(`Controle_Suivi_affaire_${new Date().toISOString().slice(0, 10)}`, [
      {
        nom: "À corriger",
        titre: "Suivi d’affaire BE — données à compléter pour la facturation",
        sousTitre: `Espace POLYNOV · contrôle du ${new Date().toLocaleDateString("fr-FR")} · ${problemes.length} point(s)`,
        colonnes: [
          { titre: "Ligne Excel", cle: "ligne", largeur: 11 },
          { titre: "N°", cle: "numero", largeur: 16 },
          { titre: "Problème", cle: "probleme", largeur: 40 },
          { titre: "À remplir", cle: "aRemplir", largeur: 30 },
          { titre: "Statut", cle: "statut", largeur: 18 },
          { titre: "Imputation", cle: "imputation", largeur: 11 },
          { titre: "Désignation", cle: "designation", largeur: 46 },
        ],
        lignes: problemes.map((p) => ({ ligne: p.ligne ?? "", numero: p.numero, probleme: p.controle.libelle, aRemplir: p.controle.aRemplir, statut: p.statut, imputation: p.imputation, designation: p.designation, grave: p.controle.grave ? "oui" : "" })),
        alerte: (l) => l.grave === "oui",
        notes: ["En jaune : bloque la facturation (livrée). Les autres lignes faussent le CA attendu de Finances ou le point avec la compta."],
      },
    ]);
  }

  const tuile = (actif: boolean, grave: boolean): CSSProperties => ({
    all: "unset",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 14px",
    borderRadius: 10,
    border: `2px solid ${actif ? C.rouge : grave ? "#f2caca" : "#e3e6ea"}`,
    background: grave ? "#fdf3f3" : "#ffffff",
    minWidth: 160,
  });

  return (
    <section style={{ ...page.carte, padding: 16, marginTop: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>Contrôle pour la facturation</h2>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={exporter} disabled={!lignes || problemes.length === 0} style={page.btnPrimaire}>
          Exporter en Excel
        </button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: C.gris }}>
        Ce qu’il manque dans le classeur pour que la facturation et les finances tiennent la route, ligne Excel par ligne Excel. Recalculé après
        chaque synchronisation.
      </p>

      {erreur && <Message genre="erreur">{erreur}</Message>}
      {!lignes && !erreur && <Message genre="info">Contrôle en cours…</Message>}

      {lignes && problemes.length === 0 && <Message genre="ok">✓ Rien à compléter : toutes les commandes livrées ont leur date, leur montant et leur n° ARC Louxor.</Message>}

      {lignes && problemes.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            {CONTROLES.map((c) => {
              const n = problemes.filter((p) => p.controle.code === c.code).length;
              if (n === 0) return null;
              return (
                <button key={c.code} type="button" onClick={() => setFiltre(filtre === c.code ? "" : c.code)} style={tuile(filtre === c.code, c.grave)} aria-pressed={filtre === c.code}>
                  <strong style={{ fontSize: 22, color: c.grave ? "#a51d1d" : "#7a3e00" }}>{n}</strong>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{c.libelle}</span>
                </button>
              );
            })}
            {filtre && (
              <button type="button" onClick={() => setFiltre("")} style={{ ...page.btnSecondaire, alignSelf: "center" }}>
                Tout voir
              </button>
            )}
          </div>

          <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  {["Ligne Excel", "N°", "Problème", "À remplir", "Statut", "Imputation", "Désignation"].map((t) => (
                    <th key={t} style={{ ...page.th, position: "sticky", top: 0, background: "#f4f5f7", whiteSpace: "nowrap" }}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((p, i) => (
                  <tr key={`${p.numero}-${p.controle.code}-${i}`} style={p.controle.grave ? { background: "#fff7c2" } : undefined}>
                    <td style={{ ...page.td, fontWeight: 800, textAlign: "right" }}>{p.ligne ?? "—"}</td>
                    <td style={{ ...page.td, fontWeight: 800, whiteSpace: "nowrap" }}>{p.numero}</td>
                    <td style={page.td}>{p.controle.libelle}</td>
                    <td style={{ ...page.td, fontWeight: 700 }}>{p.controle.aRemplir}</td>
                    <td style={{ ...page.td, whiteSpace: "nowrap" }}>{p.statut}</td>
                    <td style={page.td}>{p.imputation || "—"}</td>
                    <td style={{ ...page.td, fontSize: 13 }}>{p.designation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: C.gris }}>
            En jaune : bloque la facturation. Corrigez le classeur, puis relancez la synchronisation : la liste se met à jour.
          </p>
        </>
      )}
    </section>
  );
}
