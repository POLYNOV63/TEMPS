"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";
import { peut } from "@/lib/droits";

export const dynamic = "force-dynamic";

/* ===============================================================
   ADMINISTRATION - COMPTEURS DE RECUPERATION

   Corriger ou accorder des heures de récupération « de force ».
   Chaque ajustement est daté, motivé et tracé (script SQL 17).

   Le compteur se construit de feuille en feuille. Un ajustement
   s'ajoute à la dernière feuille validée de la personne ; s'il n'existe
   encore aucune feuille validée, il modifie le compteur initial des Droits RH.
================================================================ */

const LIMITE = 30;

type Collab = {
  id: string;
  prenom: string | null;
  nom: string | null;
  trigramme: string | null;
  actif: boolean;
  compteur_recuperation: number | null;
};

type Ligne = {
  collab: Collab;
  compteur: number;
  origine: string;
};

type Ajustement = {
  id: string;
  created_at: string;
  collaborateur_id: string;
  heures: number;
  compteur_avant: number;
  compteur_apres: number;
  motif: string;
  created_by: string | null;
};

function exercicePOLYNOV(date: Date) {
  return date.getMonth() >= 10 ? date.getFullYear() : date.getFullYear() - 1;
}

function formatHeures(valeur: number) {
  return String(Math.round(valeur * 100) / 100).replace(".", ",");
}

function avecSigne(valeur: number) {
  return `${valeur > 0 ? "+" : ""}${formatHeures(valeur)} h`;
}

function lireHeures(texte: string): number | null {
  const t = texte.trim().replace(",", ".").replace(/\s+/g, "");
  if (t === "" || t === "-" || t === "+") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function nom(c: Pick<Collab, "prenom" | "nom" | "trigramme"> | undefined) {
  if (!c) return "—";
  const complet = `${c.prenom ?? ""} ${c.nom ?? ""}`.trim();
  return c.trigramme ? `${c.trigramme} — ${complet}` : complet || "—";
}

function dateHeure(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function libelleSemaine(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debut = Date.UTC(d.getUTCFullYear(), 0, 1);
  const n = Math.ceil(((d.getTime() - debut) / 86400000 + 1) / 7);
  return `S${String(n).padStart(2, "0")}`;
}

export default function CompteursPage() {
  const router = useRouter();

  const [chargement, setChargement] = useState(true);
  const [aAcces, setAAcces] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [historique, setHistorique] = useState<Ajustement[]>([]);

  const [cible, setCible] = useState<Ligne | null>(null);
  const [heuresTexte, setHeuresTexte] = useState("");
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreurModale, setErreurModale] = useState("");

  const charger = useCallback(async () => {
    try {
      setChargement(true);
      setErreur("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: moi, error: erreurMoi } = await supabase
        .from("collaborateurs")
        .select("role")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (erreurMoi) throw erreurMoi;

      const autorise = peut(moi?.role, "administration");
      setAAcces(autorise);

      if (!autorise) {
        router.push("/dashboard");
        return;
      }

      const { data: tous, error: erreurCollabs } = await supabase
        .from("collaborateurs")
        .select("id, prenom, nom, trigramme, actif, compteur_recuperation")
        .order("nom", { ascending: true })
        .order("prenom", { ascending: true });

      if (erreurCollabs) throw erreurCollabs;

      const liste = (tous ?? []) as Collab[];
      setCollabs(liste);

      // Compteur actuel = compteur après de la dernière feuille validée, sinon compteur initial des Droits RH
      const { data: feuilles, error: erreurFeuilles } = await supabase
        .from("feuilles_heures")
        .select("collaborateur_id, semaine_debut, compteur_apres")
        .eq("statut", "A_TRAITER")
        .order("semaine_debut", { ascending: false })
        .limit(5000);

      if (erreurFeuilles) throw erreurFeuilles;

      const derniere = new Map<string, { semaine: string; compteur: number }>();
      for (const f of feuilles ?? []) {
        if (!derniere.has(f.collaborateur_id) && f.compteur_apres !== null && f.compteur_apres !== undefined) {
          derniere.set(f.collaborateur_id, { semaine: f.semaine_debut, compteur: Number(f.compteur_apres) });
        }
      }

      const exercice = exercicePOLYNOV(new Date());
      const { data: droits, error: erreurDroits } = await supabase
        .from("rh_droits")
        .select("collaborateur_id, exercice, compteur_recuperation_initial");

      if (erreurDroits) throw erreurDroits;

      const initial = new Map<string, number>();
      for (const d of droits ?? []) {
        if (Number(d.exercice) === exercice && d.compteur_recuperation_initial !== null) {
          initial.set(d.collaborateur_id, Number(d.compteur_recuperation_initial));
        }
      }

      setLignes(
        liste
          .filter((c) => c.actif)
          .map((c) => {
            const feuille = derniere.get(c.id);
            if (feuille) return { collab: c, compteur: feuille.compteur, origine: `Feuille ${libelleSemaine(feuille.semaine)} validée` };
            if (initial.has(c.id)) return { collab: c, compteur: initial.get(c.id) ?? 0, origine: "Compteur initial (Droits RH)" };
            return { collab: c, compteur: Number(c.compteur_recuperation ?? 0), origine: "Fiche collaborateur (aucun Droit RH)" };
          })
      );

      const { data: ajustements, error: erreurAjustements } = await supabase
        .from("rh_compteur_regularisations")
        .select("id, created_at, collaborateur_id, heures, compteur_avant, compteur_apres, motif, created_by")
        .order("created_at", { ascending: false })
        .limit(100);

      if (erreurAjustements) throw erreurAjustements;

      setHistorique((ajustements ?? []) as Ajustement[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : (e as { message?: string })?.message;
      setErreur(message ? `Impossible de charger les compteurs : ${message}` : "Impossible de charger les compteurs.");
    } finally {
      setChargement(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  // Échap ferme la fenêtre d'ajustement (sauf pendant l'enregistrement)
  useEffect(() => {
    if (!cible) return;

    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enCours) setCible(null);
    };

    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [cible, enCours]);

  const parId = useMemo(() => new Map(collabs.map((c) => [c.id, c])), [collabs]);

  const heures = lireHeures(heuresTexte);
  const nouveau = cible && heures !== null ? cible.compteur + heures : null;
  const horsLimite = nouveau !== null && (nouveau < -LIMITE || nouveau > LIMITE);
  const motifOk = motif.trim().length >= 3;
  const peutValider = Boolean(cible) && heures !== null && heures !== 0 && !horsLimite && motifOk && !enCours;

  function ouvrir(ligne: Ligne) {
    setCible(ligne);
    setHeuresTexte("");
    setMotif("");
    setErreurModale("");
    setInfo("");
  }

  function fermer() {
    if (!enCours) setCible(null);
  }

  async function appliquer() {
    if (!cible || heures === null || !peutValider) return;

    setEnCours(true);
    setErreurModale("");

    const { error } = await supabase.rpc("rh_regulariser_compteur", {
      p_collaborateur_id: cible.collab.id,
      p_heures: heures,
      p_motif: motif.trim(),
    });

    setEnCours(false);

    if (error) {
      setErreurModale(error.message || "L'ajustement a été refusé.");
      return;
    }

    setInfo(`Compteur de ${nom(cible.collab)} ajusté : ${avecSigne(heures)}.`);
    setCible(null);
    await charger();
  }

  if (!aAcces && !chargement) return null;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <EnTetePage forme="encadre" section="Compteurs de récupération" />

        <div style={styles.titreBloc}>
          <div style={styles.kicker}>ADMINISTRATION</div>
          <h1 style={styles.titre}>Compteurs de récupération</h1>
          <p style={styles.sousTitre}>
            Corriger ou accorder des heures « de force ». Chaque ajustement est daté, motivé et conservé dans l’historique ci-dessous.
          </p>
        </div>

        {erreur && <div role="alert" style={styles.erreur}>{erreur}</div>}
        {info && <div role="status" style={styles.info}>{info}</div>}

        <div style={styles.explication}>
          <strong>Comment ça marche.</strong> L’ajustement s’ajoute à la <strong>dernière feuille validée</strong> de la personne : les semaines suivantes
          repartent du nouveau compteur. S’il n’existe encore aucune feuille validée, c’est le <strong>compteur initial</strong> des Droits RH qui est modifié.
          Le compteur reste toujours entre −{LIMITE} h et +{LIMITE} h. Les heures supplémentaires, elles, ne passent toujours au compteur que par la décision de fin de mois.
        </div>

        <section style={styles.carte} aria-label="Compteurs actuels">
          <h2 style={styles.titreCarte}>Compteurs actuels</h2>

          {chargement && <div style={styles.vide}>Chargement…</div>}

          {!chargement && (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Collaborateur</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Compteur</th>
                    <th style={styles.th}>Origine</th>
                    <th style={styles.th} />
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.collab.id}>
                      <td style={styles.td}>{nom(l.collab)}</td>
                      <td style={{ ...styles.td, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                        {formatHeures(l.compteur)} h
                      </td>
                      <td style={{ ...styles.td, color: "#5b6168" }}>{l.origine}</td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <button type="button" style={styles.boutonSecondaire} onClick={() => ouvrir(l)}>
                          Ajuster…
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lignes.length === 0 && (
                    <tr>
                      <td style={styles.td} colSpan={4}>Aucun collaborateur actif.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section style={styles.carte} aria-label="Historique des ajustements">
          <h2 style={styles.titreCarte}>Historique des ajustements</h2>

          {historique.length === 0 ? (
            <div style={styles.vide}>Aucun ajustement pour l’instant.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Collaborateur</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Ajustement</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Compteur</th>
                    <th style={styles.th}>Motif</th>
                    <th style={styles.th}>Par</th>
                  </tr>
                </thead>
                <tbody>
                  {historique.map((a) => (
                    <tr key={a.id}>
                      <td style={styles.td}>{dateHeure(a.created_at)}</td>
                      <td style={styles.td}>{nom(parId.get(a.collaborateur_id))}</td>
                      <td style={{ ...styles.td, textAlign: "right", fontWeight: 800, color: a.heures > 0 ? "#1b6b2d" : "#8f0000" }}>
                        {avecSigne(Number(a.heures))}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {formatHeures(Number(a.compteur_avant))} → <strong>{formatHeures(Number(a.compteur_apres))} h</strong>
                      </td>
                      <td style={styles.td}>{a.motif}</td>
                      <td style={styles.td}>{a.created_by ? parId.get(a.created_by)?.trigramme ?? "—" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {cible && (
        <div style={styles.voile} onClick={fermer} role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Ajuster le compteur de ${nom(cible.collab)}`}
            style={styles.modale}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Ajuster le compteur</h2>
            <div style={{ color: "#5b6168", marginBottom: 14 }}>{nom(cible.collab)}</div>

            {erreurModale && <div role="alert" style={styles.erreur}>{erreurModale}</div>}

            <div style={styles.ligneChamp}>
              <label htmlFor="cpt-h" style={styles.etiquette}>Heures à ajouter ou retirer</label>
              <input
                id="cpt-h"
                type="text"
                inputMode="decimal"
                autoFocus
                placeholder="ex. +2 ou -1,5"
                value={heuresTexte}
                onChange={(e) => setHeuresTexte(e.target.value.replace(/[^0-9,.+\-]/g, ""))}
                style={styles.champ}
              />
              <div style={styles.aide}>Positif pour accorder des heures, négatif pour en retirer.</div>
            </div>

            <div style={styles.apercu} role="status">
              Compteur actuel <strong>{formatHeures(cible.compteur)} h</strong>
              {nouveau !== null && heures !== 0 && (
                <>
                  {" "}→ après ajustement{" "}
                  <strong style={{ color: horsLimite ? "#b3261e" : "#14532d" }}>{formatHeures(nouveau)} h</strong>
                </>
              )}
              {horsLimite && <div style={{ color: "#b3261e", fontWeight: 700, marginTop: 4 }}>Le compteur doit rester entre −{LIMITE} h et +{LIMITE} h.</div>}
            </div>

            <div style={styles.ligneChamp}>
              <label htmlFor="cpt-m" style={styles.etiquette}>Motif (obligatoire)</label>
              <input
                id="cpt-m"
                type="text"
                placeholder="ex. Erreur de reprise à l'ouverture du compteur"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                style={styles.champ}
              />
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" style={styles.boutonSecondaire} onClick={fermer} disabled={enCours}>Annuler</button>
              <button
                type="button"
                style={{ ...styles.boutonPrincipal, opacity: peutValider ? 1 : 0.5 }}
                disabled={!peutValider}
                onClick={appliquer}
              >
                {enCours ? "Enregistrement…" : "Appliquer l’ajustement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#f4f4f4", fontFamily: "Calibri, Arial, sans-serif", color: "#222222", padding: "20px 16px 60px" },
  container: { maxWidth: 1200, margin: "0 auto" },
  titreBloc: { margin: "18px 0 14px" },
  kicker: { color: "#c00000", fontWeight: 800, fontSize: 12, letterSpacing: ".6px" },
  titre: { margin: "2px 0 4px", fontSize: 30 },
  sousTitre: { margin: 0, color: "#5b6168", fontSize: 15 },
  erreur: { background: "#fde1e1", color: "#5c0a0a", border: "1px solid #e5a3a3", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontWeight: 600 },
  info: { background: "#e3f4e6", color: "#14532d", border: "1px solid #9fd4a7", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontWeight: 600 },
  explication: { background: "#fff8e1", border: "1px solid #ecd58a", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 14, lineHeight: 1.5 },
  carte: { background: "#ffffff", border: "1px solid #e3e3e3", borderRadius: 11, boxShadow: "0 2px 8px rgba(0,0,0,.06)", padding: "14px 16px", marginBottom: 16 },
  titreCarte: { margin: "0 0 10px", fontSize: 18 },
  vide: { color: "#5b6168", padding: "8px 0" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e3e3e3", fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px", color: "#5b6168" },
  td: { padding: "9px 10px", borderBottom: "1px solid #eeeeee", verticalAlign: "top" },
  boutonPrincipal: { minHeight: 44, padding: "0 18px", border: "1.5px solid #c00000", background: "#c00000", color: "#ffffff", borderRadius: 8, fontWeight: 700, fontSize: 15, fontFamily: "inherit", cursor: "pointer" },
  boutonSecondaire: { minHeight: 40, padding: "0 14px", border: "1.5px solid #b9bec5", background: "#ffffff", color: "#222222", borderRadius: 8, fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" },
  voile: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 100 },
  modale: { width: "100%", maxWidth: 520, background: "#ffffff", borderRadius: 12, padding: 20, boxShadow: "0 12px 40px rgba(0,0,0,.3)" },
  ligneChamp: { marginBottom: 12 },
  etiquette: { display: "block", fontWeight: 700, marginBottom: 5 },
  champ: { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 10px", fontSize: 16, fontFamily: "inherit", border: "1.5px solid #b9bec5", borderRadius: 8 },
  aide: { fontSize: 12, color: "#5b6168", marginTop: 3 },
  apercu: { background: "#f1f6fc", border: "1px solid #c9d9ee", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 15 },
};
