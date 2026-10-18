"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   ADMINISTRATION - REMISE À ZÉRO DES DONNÉES

   Efface toutes les données d'activité (affaires, planning, relevé des
   prestations, copie du classeur, feuilles d'heures, historique importé,
   demandes et droits RH) en GARDANT les collaborateurs et le paramétrage.
   Fonction SQL polynov_reinitialiser_donnees (script 35), ADMIN seulement,
   avec le mot REINITIALISER à taper. IRRÉVERSIBLE.
================================================================ */

const LIBELLES: Record<string, string> = {
  prestation_mois: "Relevé PE / PI : réglages mensuels",
  prestation_saisies: "Relevé PE / PI : heures",
  prestation_lignes: "Relevé PE / PI : lignes",
  pilotage_affectations_jours: "Planning : heures par jour",
  pilotage_affectations: "Planning : affectations (hors affaire compris)",
  pilotage_echeances_historique: "Historique des échéances",
  pilotage_charges: "Besoins chiffrés des affaires",
  pilotage_affaires: "Affaires du Pilotage (Excel et manuelles)",
  suivi_lignes_montants: "Suivi d’affaire : montants",
  suivi_lignes: "Suivi d’affaire : lignes",
  suivi_clients: "Suivi d’affaire : clients",
  suivi_synchronisations: "Journal des synchronisations",
  feuilles_heures_imputations: "Feuilles d’heures : imputations",
  feuilles_heures_jours: "Feuilles d’heures : jours",
  feuilles_heures: "Feuilles d’heures",
  heures_supplementaires: "Heures supplémentaires",
  historique_imputations: "Historique importé : imputations",
  historique_presence: "Historique importé : présence",
  rh_compteur_regularisations: "RH : régularisations de compteur",
  rh_demandes: "RH : demandes (congés, RTT, récupération)",
  demandes_absence: "RH : anciennes demandes d’absence",
  rh_droits: "RH : droits annuels (à ressaisir)",
  pilotage_archive_purge: "Archive des purges du Pilotage",
};

function ReinitialisationContenu() {
  const [comptes, setComptes] = useState<Record<string, number> | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [sauvegarde, setSauvegarde] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [resultat, setResultat] = useState<Record<string, number> | null>(null);

  const compter = useCallback(async () => {
    const { data, error } = await supabase.rpc("polynov_compter_donnees");
    if (error) setErreur(error.message);
    else setComptes(data as Record<string, number>);
  }, []);

  useEffect(() => {
    void compter();
  }, [compter]);

  async function reinitialiser() {
    if (confirmation !== "REINITIALISER" || !sauvegarde) return;
    if (!window.confirm("Dernière confirmation : effacer définitivement toutes ces données ?")) return;
    setEnCours(true);
    setErreur("");
    const { data, error } = await supabase.rpc("polynov_reinitialiser_donnees", { p_confirmation: confirmation });
    setEnCours(false);
    if (error) return setErreur(error.message);
    setResultat(data as Record<string, number>);
    setConfirmation("");
    void compter();
  }

  const total = comptes ? Object.values(comptes).reduce((t, v) => t + Number(v), 0) : 0;

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />
      <div style={{ ...page.contenu, maxWidth: 900 }}>
        <h1 style={page.titre}>Remise à zéro des données</h1>
        <p style={page.sousTitre}>
          Pour repartir proprement : toutes les données d’activité sont effacées, les collaborateurs et le paramétrage sont gardés.
          <strong> C’est irréversible.</strong>
        </p>

        {erreur && <Message genre="erreur">{erreur}</Message>}

        {resultat && (
          <Message genre="ok">
            Remise à zéro faite : {Object.values(resultat).reduce((t, v) => t + Number(v), 0).toLocaleString("fr-FR")} enregistrements effacés.
            Suivez maintenant les étapes ci-dessous.
          </Message>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
          <section style={{ ...page.carte, padding: 16, flex: "1 1 400px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 17, color: C.rougeTexte }}>Sera effacé</h2>
            {!comptes ? (
              <p style={{ color: C.gris }}>Comptage…</p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <tbody>
                  {Object.entries(comptes).map(([t, n]) => (
                    <tr key={t}>
                      <td style={{ ...page.td, padding: "4px 6px" }}>{LIBELLES[t] ?? t}</td>
                      <td style={{ ...page.td, padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>{Number(n).toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...page.td, padding: "6px", fontWeight: 800 }}>Total</td>
                    <td style={{ ...page.td, padding: "6px", textAlign: "right", fontWeight: 800 }}>{total.toLocaleString("fr-FR")}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          <section style={{ ...page.carte, padding: 16, flex: "1 1 300px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 17, color: "#1b5e20" }}>Sera gardé</h2>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
              <li>les collaborateurs, leurs rôles et leurs rythmes horaires</li>
              <li>les profils et bases horaires</li>
              <li>les codes d’imputation et les activités</li>
              <li>les imputations du Pilotage (BE, PE, PI…)</li>
              <li>les jours fériés</li>
              <li>la correspondance des colonnes Excel</li>
              <li>les coûts de structure et le prévisionnel financier</li>
            </ul>
            <p style={{ fontSize: 12, color: C.gris, margin: "10px 0 0" }}>
              Les fichiers joints aux demandes RH (justificatifs) restent dans le stockage Supabase.
            </p>
          </section>
        </div>

        <section style={{ ...page.carte, padding: 16, marginTop: 16, borderLeft: `5px solid ${C.rouge}` }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Confirmer</h2>
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input type="checkbox" checked={sauvegarde} onChange={(e) => setSauvegarde(e.target.checked)} style={{ width: 22, height: 22 }} />
            J’ai téléchargé une sauvegarde juste avant (
            <Link href="/admin/sauvegarde" style={{ color: C.rougeFonce, fontWeight: 700 }}>
              Paramétrage &gt; Sauvegarde
            </Link>
            ), ou je n’ai rien à garder.
          </label>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 12 }}>
            Tapez <code>REINITIALISER</code> pour confirmer
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value.toUpperCase())}
              aria-label="Mot de confirmation"
              style={{ ...page.entrees, marginTop: 4, maxWidth: 260 }}
            />
          </label>
          <button
            type="button"
            onClick={() => void reinitialiser()}
            disabled={confirmation !== "REINITIALISER" || !sauvegarde || enCours}
            style={{ ...page.btnPrimaire, opacity: confirmation !== "REINITIALISER" || !sauvegarde || enCours ? 0.5 : 1 }}
          >
            {enCours ? "Effacement…" : "Tout remettre à zéro"}
          </button>
        </section>

        <section style={{ ...page.carte, padding: 16, marginTop: 16 }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 17 }}>Ensuite, pour tout remettre à niveau</h2>
          <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.9, fontSize: 15 }}>
            <li>
              <strong>Droits RH de l’exercice</strong> (CP, RTT, compteur de récupération initial) pour chaque collaborateur :{" "}
              <Link href="/admin/collaborateurs" style={{ color: C.rougeFonce, fontWeight: 700 }}>Collaborateurs</Link>.
            </li>
            <li>
              <strong>Suivi d’affaire BE</strong> : déposer le classeur et appliquer :{" "}
              <Link href="/admin/synchro-suivi-affaires" style={{ color: C.rougeFonce, fontWeight: 700 }}>Synchronisation</Link>. Les affaires et les PE / PI réapparaissent.
            </li>
            <li>
              <strong>Récapitulatif d’heures</strong> (historique Excel) :{" "}
              <Link href="/import-historique-v2" style={{ color: C.rougeFonce, fontWeight: 700 }}>Import historique</Link>. Le réalisé des affaires revient.
            </li>
            <li>
              <strong>Prestations PE / PI</strong> : staffer, saisir les taux et remplir les mois :{" "}
              <Link href="/pilotage/prestations" style={{ color: C.rougeFonce, fontWeight: 700 }}>Relevé</Link>. Leur planning se remplit tout seul.
            </li>
            <li>
              <strong>Planning des forfaits</strong> : mettre les affaires au planning (portefeuille, « + Planifier ») puis affecter :{" "}
              <Link href="/pilotage/affaires" style={{ color: C.rougeFonce, fontWeight: 700 }}>Planning</Link>.
            </li>
            <li>
              <strong>Vérifier</strong> que tout est relié :{" "}
              <Link href="/admin/coherence" style={{ color: C.rougeFonce, fontWeight: 700 }}>Cohérence</Link>.
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}

export default function ReinitialisationPage() {
  return (
    <GardeAcces droit="administration">
      <ReinitialisationContenu />
    </GardeAcces>
  );
}
