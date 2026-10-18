"use client";

import { useCallback, useEffect, useState } from "react";
import JSZip from "jszip";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   ADMINISTRATION - SAUVEGARDE TÉLÉCHARGEABLE

   Un clic : toutes les tables de l'application sont récupérées (fonction
   SQL polynov_export_table, ADMIN seulement) et rangées dans un fichier
   ZIP enregistré où l'on veut (clé USB, disque, dossier du serveur) :
   - excel/<table>.csv : lisible dans Excel (séparateur « ; », accents) ;
   - donnees/<table>.json : copie exacte, pour une éventuelle restauration ;
   - LISEZMOI.txt : date, nombre de lignes par table.
   Ne modifie rien dans la base.
================================================================ */

const PAQUET = 2000;

type Table = { nom: string; lignes: number };

/* Valeur -> cellule CSV (Excel français) */
function cellule(v: unknown): string {
  if (v === null || v === undefined) return "";
  const texte = typeof v === "object" ? JSON.stringify(v) : typeof v === "number" ? String(v).replace(".", ",") : String(v);
  return /[;"\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

function versCsv(lignes: Record<string, unknown>[]): string {
  if (lignes.length === 0) return "\ufeff";
  const colonnes = [...new Set(lignes.flatMap((l) => Object.keys(l)))];
  const corps = lignes.map((l) => colonnes.map((c) => cellule(l[c])).join(";"));
  return "\ufeff" + [colonnes.join(";"), ...corps].join("\r\n");
}

function taille(octets: number): string {
  return octets > 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(octets / 1024))} Ko`;
}

type FenetreAvecEnregistrement = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
};

function SauvegardeContenu() {
  const [tables, setTables] = useState<Table[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [progression, setProgression] = useState<{ table: string; fait: number; total: number } | null>(null);

  const lister = useCallback(async () => {
    const { data, error } = await supabase.rpc("polynov_tables_sauvegarde");
    if (error) setErreur(error.message);
    else setTables(((data ?? []) as { nom: string; lignes: number | string }[]).map((t) => ({ nom: t.nom, lignes: Number(t.lignes) || 0 })));
  }, []);

  useEffect(() => {
    void lister();
  }, [lister]);

  async function sauvegarder() {
    if (!tables) return;
    setErreur("");
    setInfo("");

    const maintenant = new Date();
    const horodatage = `${maintenant.toISOString().slice(0, 10)} ${String(maintenant.getHours()).padStart(2, "0")}h${String(maintenant.getMinutes()).padStart(2, "0")}`;
    const nomFichier = `Sauvegarde POLYNOV-TEMPS ${horodatage}.zip`;

    // Choisir l'emplacement d'abord (Chrome / Edge) : on ne lance la récupération qu'une fois l'endroit choisi
    const fenetre = window as FenetreAvecEnregistrement;
    let destination: Awaited<ReturnType<NonNullable<FenetreAvecEnregistrement["showSaveFilePicker"]>>> | null = null;
    if (fenetre.showSaveFilePicker) {
      try {
        destination = await fenetre.showSaveFilePicker({
          suggestedName: nomFichier,
          types: [{ description: "Archive ZIP", accept: { "application/zip": [".zip"] } }],
        });
      } catch {
        return; // l'utilisateur a annulé
      }
    }

    try {
      const zip = new JSZip();
      const total = tables.reduce((t, x) => t + x.lignes, 0);
      let fait = 0;
      const recap: string[] = [];

      for (const t of tables) {
        const lignes: Record<string, unknown>[] = [];
        for (let debut = 0; ; debut += PAQUET) {
          setProgression({ table: t.nom, fait: fait + lignes.length, total });
          const { data, error } = await supabase.rpc("polynov_export_table", { p_table: t.nom, p_debut: debut, p_nombre: PAQUET });
          if (error) throw new Error(`${t.nom} : ${error.message}`);
          const paquet = (data ?? []) as Record<string, unknown>[];
          lignes.push(...paquet);
          if (paquet.length < PAQUET) break;
        }
        fait += lignes.length;
        zip.file(`donnees/${t.nom}.json`, JSON.stringify(lignes, null, 1));
        zip.file(`excel/${t.nom}.csv`, versCsv(lignes));
        recap.push(`${t.nom.padEnd(36)} ${String(lignes.length).padStart(8)} lignes`);
      }

      zip.file(
        "LISEZMOI.txt",
        [
          "SAUVEGARDE POLYNOV-TEMPS",
          `Faite le ${maintenant.toLocaleString("fr-FR")}`,
          "",
          "excel/   : un fichier par table, à ouvrir dans Excel (séparateur « ; »).",
          "donnees/ : copie exacte de chaque table (JSON), pour une restauration.",
          "",
          "Ce fichier contient des données personnelles (collaborateurs, heures, RH) :",
          "rangez-le dans un endroit protégé.",
          "",
          ...recap,
          "",
          `TOTAL ${fait} lignes`,
        ].join("\r\n")
      );

      setProgression({ table: "compression", fait: total, total });
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });

      if (destination) {
        const flux = await destination.createWritable();
        await flux.write(blob);
        await flux.close();
      } else {
        const lien = document.createElement("a");
        lien.href = URL.createObjectURL(blob);
        lien.download = nomFichier;
        lien.click();
        setTimeout(() => URL.revokeObjectURL(lien.href), 5000);
      }

      setInfo(`Sauvegarde enregistrée : ${nomFichier} (${taille(blob.size)}, ${fait.toLocaleString("fr-FR")} lignes, ${tables.length} tables).`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Sauvegarde impossible.");
    } finally {
      setProgression(null);
    }
  }

  const total = tables?.reduce((t, x) => t + x.lignes, 0) ?? 0;
  const pourcent = progression && progression.total > 0 ? Math.round((progression.fait / progression.total) * 100) : 0;

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />
      <div style={{ ...page.contenu, maxWidth: 900 }}>
        <h1 style={page.titre}>Sauvegarde</h1>
        <p style={page.sousTitre}>
          Copie de toutes les tables de l’application dans un fichier ZIP, enregistré où vous voulez : clé USB, disque, dossier du
          serveur. Rien n’est modifié dans la base.
        </p>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        <section style={{ ...page.carte, padding: 18, marginBottom: 16 }}>
          <button type="button" onClick={() => void sauvegarder()} disabled={!tables || progression !== null} style={{ ...page.btnPrimaire, fontSize: 17, minHeight: 50, padding: "0 24px" }}>
            {progression ? "Sauvegarde en cours…" : "💾 Télécharger une sauvegarde"}
          </button>
          <p style={{ margin: "10px 0 0", fontSize: 13, color: C.gris }}>
            Chrome et Edge vous demandent d’abord où enregistrer le fichier. Les autres navigateurs le mettent dans « Téléchargements ».
          </p>

          {progression && (
            <div style={{ marginTop: 14 }}>
              <div style={{ background: "#eef0f3", borderRadius: 6, height: 14, overflow: "hidden" }}>
                <div style={{ width: `${pourcent}%`, height: "100%", background: C.rouge, transition: "width .2s" }} />
              </div>
              <div style={{ fontSize: 13, color: C.gris, marginTop: 4 }}>
                {progression.table === "compression" ? "Compression du fichier…" : `${progression.table} — ${pourcent} %`}
              </div>
            </div>
          )}
        </section>

        <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>Ce que contient la sauvegarde</h2>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
            <li><strong>excel/</strong> : un fichier par table, à ouvrir dans Excel ;</li>
            <li><strong>donnees/</strong> : la copie exacte de chaque table, qui servira en cas de restauration ;</li>
            <li><strong>LISEZMOI.txt</strong> : la date et le nombre de lignes de chaque table.</li>
          </ul>
          {tables && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>
                {tables.length} tables, {total.toLocaleString("fr-FR")} lignes
              </summary>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, marginTop: 6 }}>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.nom}>
                      <td style={{ ...page.td, padding: "3px 6px" }}>{t.nom}</td>
                      <td style={{ ...page.td, padding: "3px 6px", textAlign: "right" }}>{t.lignes.toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>

        <Message genre="info">
          Le fichier contient des données personnelles (collaborateurs, heures, RH) : rangez-le dans un dossier protégé. Faites une
          sauvegarde chaque semaine et toujours avant une opération risquée (remise à zéro, import).
        </Message>
      </div>
    </main>
  );
}

export default function SauvegardePage() {
  return (
    <GardeAcces droit="administration">
      <SauvegardeContenu />
    </GardeAcces>
  );
}
