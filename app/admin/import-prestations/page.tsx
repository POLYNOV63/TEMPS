"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { lireSuiviPrestations, type ResultatHisto } from "@/lib/importSuiviPrestations";

/* ===============================================================
   ADMINISTRATION - IMPORT DU CLASSEUR « SUIVI DES PRESTATIONS »

   Reprise UNIQUE des mois PE / PI / IG déjà facturés dans l'ancien
   classeur (un onglet par mois). Lecture dans le navigateur, aperçu mois
   par mois avec contrôle des totaux du classeur, puis enregistrement dans
   prestation_historique. Ré-importer remplace les mois du fichier.
   La page Finances s'en sert pour le CA des mois que le relevé de
   l'application ne couvre pas.
================================================================ */

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function ImportContenu() {
  const [nomFichier, setNomFichier] = useState("");
  const [resultat, setResultat] = useState<ResultatHisto | null>(null);
  const [moisChoisis, setMoisChoisis] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function lire(fichier: File) {
    setErreur("");
    setInfo("");
    setResultat(null);
    setNomFichier(fichier.name);
    try {
      const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array" });
      const feuilles: Record<string, unknown[][]> = {};
      for (const nom of wb.SheetNames) {
        feuilles[nom] = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null }) as unknown[][];
      }
      const r = lireSuiviPrestations(feuilles);
      setResultat(r);
      setMoisChoisis(new Set(r.mois));
    } catch (e) {
      setErreur(e instanceof Error ? `Lecture impossible : ${e.message}` : "Lecture impossible.");
    }
  }

  async function importer() {
    if (!resultat) return;
    const mois = [...moisChoisis].sort();
    const lignes = resultat.lignes.filter((l) => moisChoisis.has(l.mois));
    if (!window.confirm(`Importer ${lignes.length} lignes sur ${mois.length} mois ? Les mois déjà importés seront remplacés.`)) return;

    setEnCours(true);
    setErreur("");
    try {
      const { error: e1 } = await supabase.from("prestation_historique").delete().in("mois", mois);
      if (e1) throw new Error(e1.message);
      for (let i = 0; i < lignes.length; i += 500) {
        const { error } = await supabase.from("prestation_historique").insert(lignes.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
      setInfo(`${lignes.length} lignes importées sur ${mois.length} mois. La page Finances les prend en compte.`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setEnCours(false);
    }
  }

  const parMois = resultat
    ? resultat.mois.map((m) => {
        const ls = resultat.lignes.filter((l) => l.mois === m);
        const cat = (c: string) => ls.filter((l) => l.categorie === c).reduce((t, l) => t + l.montant, 0);
        const ctrl = resultat.controles.find((c) => c.feuille === ls[0]?.feuille);
        const reclassees = ls.filter((l) => l.reclassee).map((l) => `${l.type}${l.numero}`);
        return {
          mois: m,
          feuille: ls[0]?.feuille ?? m,
          nb: ls.length,
          pe: cat("PE"),
          pi: cat("PI"),
          ig: cat("IG"),
          total: ls.reduce((t, l) => t + l.montant, 0),
          ecart: ctrl?.ecart ?? null,
          reclassees: [...new Set(reclassees)],
        };
      })
    : [];
  const choisis = parMois.filter((m) => moisChoisis.has(m.mois));

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />
      <div style={{ ...page.contenu, maxWidth: 1000 }}>
        <h1 style={page.titre}>Import du Suivi des prestations</h1>
        <p style={page.sousTitre}>
          Reprise unique des mois PE / PI / IG déjà facturés dans l’ancien classeur, pour que la page Finances ait le vrai chiffre
          d’affaires mois par mois. Les numéros CAS (ancienne désignation) comptent comme les CBE.
        </p>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
          <label style={{ fontWeight: 700 }}>
            Classeur (.xlsm ou .xlsx)
            <input type="file" accept=".xlsm,.xlsx" onChange={(e) => e.target.files?.[0] && void lire(e.target.files[0])} style={{ display: "block", marginTop: 8 }} />
          </label>
          {nomFichier && <p style={{ margin: "8px 0 0", fontSize: 13, color: C.gris }}>{nomFichier}</p>}
        </section>

        {resultat && (
          <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 17 }}>
              Aperçu : {resultat.lignes.length} lignes facturées sur {resultat.mois.length} mois
            </h2>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
              Décochez un mois pour ne pas l’importer (par exemple un mois déjà saisi dans le relevé de l’application). « Écart » compare la
              somme des lignes aux totaux du classeur : un écart signale une ligne hors des totaux de son onglet, à vérifier.
            </p>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  {["", "Onglet", "Lignes", "PE", "PI", "IG", "Total", "Écart"].map((t, i) => (
                    <th key={t || i} style={{ ...page.th, textAlign: i < 2 ? "left" : "right" }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parMois.map((m) => (
                  <tr key={m.mois}>
                    <td style={page.td}>
                      <input
                        type="checkbox"
                        checked={moisChoisis.has(m.mois)}
                        aria-label={`Importer ${m.feuille}`}
                        onChange={(e) =>
                          setMoisChoisis((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(m.mois);
                            else n.delete(m.mois);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td style={{ ...page.td, fontWeight: 700 }}>{m.feuille}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>{m.nb}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>{m.pe ? euros(m.pe) : "—"}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>{m.pi ? euros(m.pi) : "—"}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>{m.ig ? euros(m.ig) : "—"}</td>
                    <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{euros(m.total)}</td>
                    <td style={{ ...page.td, textAlign: "right", color: m.ecart ? C.rougeTexte : C.gris, fontWeight: m.ecart ? 800 : 400 }}>
                      {m.ecart ? euros(m.ecart) : "✓"}
                      {m.reclassees.length > 0 && (
                        <div style={{ fontSize: 11, color: C.gris, fontWeight: 400 }}>{m.reclassees.join(", ")} rangée en IG</div>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={page.td} />
                  <td style={{ ...page.td, fontWeight: 800 }}>Total importé</td>
                  <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{choisis.reduce((t, m) => t + m.nb, 0)}</td>
                  <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{euros(choisis.reduce((t, m) => t + m.pe, 0))}</td>
                  <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{euros(choisis.reduce((t, m) => t + m.pi, 0))}</td>
                  <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{euros(choisis.reduce((t, m) => t + m.ig, 0))}</td>
                  <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{euros(choisis.reduce((t, m) => t + m.total, 0))}</td>
                  <td style={page.td} />
                </tr>
              </tbody>
            </table>

            {parMois.some((m) => m.ecart) && (
              <Message genre="info">
                Les onglets en écart contiennent une ligne facturée que les totaux du classeur ne comptent pas (souvent une ligne posée sous la
                plage de la formule de total). Vérifiez-la dans le classeur : elle est importée telle quelle.
              </Message>
            )}

            <button type="button" style={{ ...page.btnPrimaire, marginTop: 12 }} disabled={enCours || moisChoisis.size === 0} onClick={() => void importer()}>
              {enCours ? "Import…" : `Importer ${moisChoisis.size} mois`}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

export default function ImportPrestationsPage() {
  return (
    <GardeAcces droit="administration">
      <ImportContenu />
    </GardeAcces>
  );
}
