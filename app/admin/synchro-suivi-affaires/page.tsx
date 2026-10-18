"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { extraireColonnesAutorisees, type Anomalie, type LigneBrute } from "@/lib/suiviAffaires";

/* ===============================================================
   ADMINISTRATION - SYNCHRONISATION DU « SUIVI D'AFFAIRE BE »

   1. On choisit le classeur (.xlsm) : il est lu DANS LE NAVIGATEUR,
      les macros ne sont jamais exécutées. Seules les colonnes autorisées
      sont gardées (aucune donnée client sauf le nom abrégé et le N° client,
      aucun commentaire) avant tout envoi.
   2. Aperçu : la fonction « synchroniser-suivi-affaires » compare avec
      la base SANS RIEN MODIFIER (créées, modifiées, disparues, anomalies).
   3. « Appliquer » enregistre et écrit une ligne dans le journal.
   + Correspondance des colonnes Méca… Autre avec les activités.
   + Journal des dernières synchronisations.
================================================================ */

const FEUILLE = "Suivi d'affaire BE";

type Resultat = {
  ok: boolean;
  error?: string;
  mode: "apercu" | "appliquer";
  stats: {
    lignes_lues: number; lignes_retenues: number; lignes_hors_perimetre: number; lignes_ignorees: number;
    par_genre: Record<string, number>; erreurs: number; attentions: number; infos: number;
    dates_texte_converties: number; nombres_texte_convertis: number;
  };
  plan: {
    a_creer: number; a_modifier: number; inchangees: number; disparues: number;
    creees: string[];
    modifiees: { cle: string; ancienne_cle: string; raison: string }[];
    disparues_cles: string[];
  };
  affaires: { total: number; par_statut: Record<string, number> };
  anomalies: Anomalie[];
  alerte_disparues: string | null;
  pilotage?: {
    creees?: number; mises_a_jour?: number; inchangees?: number;
    liste_creees?: string[];
    ignorees?: { numero: string; raison: string }[];
    responsable_par_defaut?: string[];
    erreur?: string;
  } | null;
};

type Synchro = {
  id: string; demarree_le: string; terminee_le: string | null; source: string; statut: string;
  fichier_nom: string | null; nb_lignes_lues: number; nb_creees: number; nb_modifiees: number;
  nb_inchangees: number; nb_disparues: number; nb_anomalies: number; message_erreur: string | null;
  lancee_par: string | null;
};

type Correspondance = { colonne_excel: string; activite_id: string | null; ordre: number };
type Activite = { id: string; code: string; nom: string; actif: boolean };

const LIBELLE_STATUT: Record<string, string> = {
  LIVREE: "livrées", EN_COURS: "en cours", INTENTION: "en intention", ANNULEE: "annulées", A_VERIFIER: "à vérifier",
};
const LIBELLE_RAISON: Record<string, string> = {
  CHANGEE: "modifiée", DEVIS_DEVENU_COMMANDE: "devis devenu commande", REAPPARUE: "réapparue",
};

function nombre(n: number) {
  return n.toLocaleString("fr-FR");
}

function dateHeure(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function ilYa(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} minutes`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} heure${heures > 1 ? "s" : ""}`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} jour${jours > 1 ? "s" : ""}`;
}

/* Lit le message d'erreur renvoyé par la fonction Edge. */
async function messageErreur(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const j = await ctx.json();
      if (j?.error) return String(j.error);
    } catch {
      /* corps illisible : message générique ci-dessous */
    }
  }
  return error instanceof Error ? error.message : "La synchronisation a échoué.";
}

/* Lit le classeur dans le navigateur et ne garde que les colonnes autorisées. */
async function lireClasseur(fichier: File): Promise<LigneBrute[]> {
  const buffer = await fichier.arrayBuffer();
  // cellDates: false -> les dates arrivent en numéros de série Excel, convertis sans décalage par le moteur.
  const wb = XLSX.read(buffer, { type: "array", cellDates: false, bookVBA: false });
  const nomFeuille = wb.SheetNames.includes(FEUILLE) ? FEUILLE : wb.SheetNames[0];
  if (!nomFeuille) throw new Error("Le classeur ne contient aucune feuille.");
  const lignes = XLSX.utils.sheet_to_json(wb.Sheets[nomFeuille], { header: 1, raw: true, defval: null }) as unknown[][];
  if (lignes.length < 2) throw new Error("La feuille est vide.");

  const titres = (lignes[0] ?? []).map((t) => (t === null || t === undefined ? "" : String(t).trim()));
  const objets: Record<string, unknown>[] = [];
  for (let i = 1; i < lignes.length; i++) {
    const l = lignes[i] ?? [];
    const o: Record<string, unknown> = { __ligne: i + 1 };
    titres.forEach((t, c) => {
      if (t) o[t] = l[c] ?? null;
    });
    objets.push(o);
  }
  return extraireColonnesAutorisees(objets);
}

function SynchroContenu() {
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState("");

  const [fichier, setFichier] = useState<File | null>(null);
  const [lignes, setLignes] = useState<LigneBrute[] | null>(null);
  const [apercu, setApercu] = useState<Resultat | null>(null);
  const [voirInfos, setVoirInfos] = useState(false);
  const [confirmeDisparues, setConfirmeDisparues] = useState(false);

  const [journal, setJournal] = useState<Synchro[]>([]);
  const [noms, setNoms] = useState<Map<string, string>>(new Map());
  const [corresp, setCorresp] = useState<Correspondance[]>([]);
  const [activites, setActivites] = useState<Activite[]>([]);

  const charger = useCallback(async () => {
    const [j, c, a, p] = await Promise.all([
      supabase.from("suivi_synchronisations").select("*").order("demarree_le", { ascending: false }).limit(15),
      supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id,ordre").order("ordre"),
      supabase.from("activites").select("id,code,nom,actif").order("ordre_affichage"),
      supabase.from("collaborateurs").select("id,prenom,nom"),
    ]);
    const e = j.error || c.error || a.error || p.error;
    if (e) {
      setErreur(e.message);
      return;
    }
    setJournal((j.data ?? []) as Synchro[]);
    setCorresp((c.data ?? []) as Correspondance[]);
    setActivites((a.data ?? []) as Activite[]);
    setNoms(new Map(((p.data ?? []) as { id: string; prenom: string | null; nom: string | null }[])
      .map((x) => [x.id, `${x.prenom ?? ""} ${x.nom ?? ""}`.trim()])));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  async function appeler(mode: "apercu" | "appliquer", l: LigneBrute[], f: File): Promise<Resultat | null> {
    const { data, error } = await supabase.functions.invoke("synchroniser-suivi-affaires", {
      body: {
        mode,
        lignes: l,
        fichier_nom: f.name,
        fichier_modifie_le: new Date(f.lastModified).toISOString(),
        confirmer_disparues: confirmeDisparues,
      },
    });
    if (error) {
      setErreur(await messageErreur(error));
      return null;
    }
    const r = data as Resultat;
    if (!r?.ok) {
      setErreur(r?.error ?? "Réponse inattendue de la fonction.");
      return null;
    }
    return r;
  }

  async function choisirFichier(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    setErreur("");
    setInfo("");
    setApercu(null);
    setLignes(null);
    setConfirmeDisparues(false);
    setFichier(f);
    if (!f) return;

    setEnCours("lecture");
    try {
      const l = await lireClasseur(f);
      if (l.length === 0) throw new Error("Aucune ligne avec un N° de devis n'a été trouvée dans le classeur.");
      setLignes(l);
      setEnCours("apercu");
      const r = await appeler("apercu", l, f);
      if (r) setApercu(r);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Lecture du classeur impossible.");
    } finally {
      setEnCours("");
    }
  }

  async function appliquer() {
    if (!lignes || !fichier || !apercu) return;
    if (apercu.alerte_disparues && !confirmeDisparues) {
      setErreur("Cochez la case de confirmation avant d'appliquer.");
      return;
    }
    if (!window.confirm("Appliquer la synchronisation ? Les données du classeur remplaceront celles de l'application.")) return;
    setErreur("");
    setInfo("");
    setEnCours("appliquer");
    const r = await appeler("appliquer", lignes, fichier);
    setEnCours("");
    if (r) {
      const p = r.pilotage;
      let pilotage = "";
      if (p?.erreur) {
        setErreur(`Classeur synchronisé, mais la mise à jour du Pilotage BE a échoué : ${p.erreur}`);
      } else if (p) {
        pilotage =
          ` Pilotage BE : ${p.creees ?? 0} affaire(s) créée(s), ${p.mises_a_jour ?? 0} mise(s) à jour, ${p.inchangees ?? 0} inchangée(s).` +
          ((p.responsable_par_defaut ?? []).length > 0
            ? ` Rédacteur non reconnu, responsable à vérifier : ${(p.responsable_par_defaut ?? []).join(", ")}.`
            : "") +
          ((p.ignorees ?? []).length > 0
            ? ` Non créées : ${(p.ignorees ?? []).map((i) => `${i.numero} (${i.raison})`).join(", ")}.`
            : "");
      }
      setInfo(
        `Synchronisation appliquée : ${r.plan.a_creer} ligne(s) créée(s), ${r.plan.a_modifier} modifiée(s), ` +
          `${r.plan.inchangees} inchangée(s), ${r.plan.disparues} disparue(s).` + pilotage
      );
      setApercu(null);
      setLignes(null);
      setFichier(null);
    }
    await charger();
  }

  async function enregistrerCorresp(colonne: string, activiteId: string) {
    setErreur("");
    setInfo("");
    const { error } = await supabase
      .from("suivi_correspondance_activites")
      .update({ activite_id: activiteId || null })
      .eq("colonne_excel", colonne);
    if (error) {
      setErreur(error.message);
      return;
    }
    setInfo(`Correspondance « ${colonne} » enregistrée.`);
    await charger();
  }

  const derniere = journal.find((s) => s.statut === "APPLIQUEE") ?? null;
  const anomaliesVisibles = (apercu?.anomalies ?? []).filter((a) => voirInfos || a.gravite !== "INFO");

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />

      <div style={page.contenu}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={page.titre}>Synchronisation du Suivi d’affaire BE</h1>
          <p style={page.sousTitre}>
            Le classeur Excel reste la référence : l’application en garde une copie (devis, commandes, avenants, heures
            chiffrées, montants). Rien n’est modifié dans Excel.
          </p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        {/* ---------- Dernière synchronisation ---------- */}
        <section style={{ ...page.carte, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Dernière synchronisation</h2>
          {derniere ? (
            <p style={{ margin: 0 }}>
              <strong>{ilYa(derniere.terminee_le ?? derniere.demarree_le)}</strong> ({dateHeure(derniere.terminee_le)}),{" "}
              {derniere.source === "AGENT" ? "par l’agent du serveur" : `dépôt manuel${derniere.lancee_par ? ` par ${noms.get(derniere.lancee_par) ?? "?"}` : ""}`}
              {derniere.fichier_nom ? ` — ${derniere.fichier_nom}` : ""}.
            </p>
          ) : (
            <p style={{ margin: 0, color: C.gris }}>Aucune synchronisation pour l’instant.</p>
          )}
        </section>

        {/* ---------- 1. Classeur ---------- */}
        <section style={{ ...page.carte, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>1. Choisir le classeur</h2>
          <p style={{ margin: "0 0 12px", color: C.gris }}>
            Le fichier est lu sur votre poste, sans exécuter ses macros. Seules les colonnes utiles partent vers
            l’application : aucune coordonnée client (seulement le nom abrégé et le N° client), aucun commentaire.
          </p>
          <label style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }}>
            {enCours === "lecture" ? "Lecture du classeur…" : enCours === "apercu" ? "Comparaison en cours…" : "Choisir le fichier Excel…"}
            <input
              type="file"
              accept=".xlsm,.xlsx,.xls"
              onChange={choisirFichier}
              disabled={Boolean(enCours)}
              style={{ display: "none" }}
            />
          </label>
          {fichier && (
            <span style={{ marginLeft: 12, color: C.gris }}>
              {fichier.name}
              {lignes ? ` — ${nombre(lignes.length)} lignes avec un N° de devis` : ""}
            </span>
          )}
        </section>

        {/* ---------- 2. Aperçu ---------- */}
        {apercu && (
          <section style={{ ...page.carte, marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>2. Aperçu (rien n’est encore modifié)</h2>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <Tuile libelle="Lignes lues" valeur={nombre(apercu.stats.lignes_retenues)}
                sous={`${apercu.stats.par_genre.DEVIS ?? 0} devis, ${apercu.stats.par_genre.BASE ?? 0} commandes, ${apercu.stats.par_genre.AVENANT ?? 0} avenants`} />
              <Tuile libelle="À créer" valeur={nombre(apercu.plan.a_creer)} />
              <Tuile libelle="À modifier" valeur={nombre(apercu.plan.a_modifier)} />
              <Tuile libelle="Inchangées" valeur={nombre(apercu.plan.inchangees)} />
              <Tuile libelle="Disparues" valeur={nombre(apercu.plan.disparues)} accent={apercu.plan.disparues > 0} />
              <Tuile libelle="À corriger dans Excel" valeur={nombre(apercu.stats.erreurs + apercu.stats.attentions)}
                accent={apercu.stats.erreurs > 0} sous={`+ ${apercu.stats.infos} pour mémoire`} />
            </div>

            <p style={{ margin: "0 0 12px" }}>
              {apercu.affaires.total} affaires :{" "}
              {Object.entries(apercu.affaires.par_statut)
                .map(([s, n]) => `${n} ${LIBELLE_STATUT[s] ?? s}`)
                .join(", ")}
              .
              {apercu.stats.lignes_hors_perimetre > 0 &&
                ` ${apercu.stats.lignes_hors_perimetre} ligne(s) antérieures au 01/11/2024 ne sont pas reprises.`}
              {(apercu.stats.dates_texte_converties > 0 || apercu.stats.nombres_texte_convertis > 0) &&
                ` ${apercu.stats.dates_texte_converties} date(s) et ${apercu.stats.nombres_texte_convertis} nombre(s) écrits en texte ont été convertis.`}
            </p>

            {(apercu.plan.creees.length > 0 || apercu.plan.modifiees.length > 0 || apercu.plan.disparues_cles.length > 0) && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Voir le détail des changements</summary>
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
                  {apercu.plan.creees.length > 0 && (
                    <p style={{ margin: "4px 0" }}><strong>Créées :</strong> {apercu.plan.creees.join(", ")}</p>
                  )}
                  {apercu.plan.modifiees.length > 0 && (
                    <p style={{ margin: "4px 0" }}>
                      <strong>Modifiées :</strong>{" "}
                      {apercu.plan.modifiees
                        .map((m) => (m.ancienne_cle !== m.cle ? `${m.ancienne_cle} → ${m.cle}` : m.cle) +
                          (m.raison !== "CHANGEE" ? ` (${LIBELLE_RAISON[m.raison] ?? m.raison})` : ""))
                        .join(", ")}
                    </p>
                  )}
                  {apercu.plan.disparues_cles.length > 0 && (
                    <p style={{ margin: "4px 0" }}>
                      <strong>Disparues du classeur</strong> (gardées dans l’application, marquées « disparue ») :{" "}
                      {apercu.plan.disparues_cles.join(", ")}
                    </p>
                  )}
                </div>
              </details>
            )}

            {apercu.alerte_disparues && (
              <div style={{ background: C.orangeFond, color: C.orangeTexte, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
                <strong>Attention :</strong> {apercu.alerte_disparues}
                <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={confirmeDisparues} onChange={(e) => setConfirmeDisparues(e.target.checked)}
                    style={{ width: 22, height: 22 }} />
                  Je confirme : ces lignes ont bien été retirées du classeur.
                </label>
              </div>
            )}

            <h3 style={{ margin: "8px 0", fontSize: 17 }}>Anomalies</h3>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <input type="checkbox" checked={voirInfos} onChange={(e) => setVoirInfos(e.target.checked)} style={{ width: 20, height: 20 }} />
              Afficher aussi les remarques « pour mémoire »
            </label>
            {anomaliesVisibles.length === 0 ? (
              <p style={{ color: C.gris }}>Aucune anomalie à corriger.</p>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: `1px solid ${C.ligne}`, borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ ...page.th, width: 140 }}>Gravité</th>
                      <th style={{ ...page.th, width: 80 }}>Ligne</th>
                      <th style={{ ...page.th, width: 150 }}>N°</th>
                      <th style={page.th}>Problème</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomaliesVisibles.map((a, i) => (
                      <tr key={i}>
                        <td style={page.td}>
                          <Pastille genre={a.gravite === "ERREUR" ? "crit" : a.gravite === "ATTENTION" ? "warn" : "info"}>
                            {a.gravite === "ERREUR" ? "Ignorée" : a.gravite === "ATTENTION" ? "À corriger" : "Pour mémoire"}
                          </Pastille>
                        </td>
                        <td style={page.td}>{a.ligne_excel ?? "—"}</td>
                        <td style={page.td}>{a.cle ?? "—"}</td>
                        <td style={page.td}>{a.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={appliquer}
                disabled={Boolean(enCours) || (Boolean(apercu.alerte_disparues) && !confirmeDisparues)}
                style={{ ...page.btnPrimaire, opacity: enCours || (apercu.alerte_disparues && !confirmeDisparues) ? 0.5 : 1 }}
              >
                {enCours === "appliquer" ? "Application en cours…" : "Appliquer la synchronisation"}
              </button>
              <button
                type="button"
                onClick={() => { setApercu(null); setLignes(null); setFichier(null); }}
                disabled={Boolean(enCours)}
                style={page.btnSecondaire}
              >
                Annuler
              </button>
            </div>
          </section>
        )}

        {/* ---------- Correspondance des activités ---------- */}
        <section style={{ ...page.carte, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Correspondance des activités</h2>
          <p style={{ margin: "0 0 12px", color: C.gris }}>
            À quelle activité de l’application correspondent les heures de chaque colonne du classeur. Une colonne sans
            activité garde ses heures dans le total de l’affaire, sans les rattacher à une activité.
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...page.th, width: 160 }}>Colonne Excel</th>
                <th style={page.th}>Activité</th>
              </tr>
            </thead>
            <tbody>
              {corresp.map((c) => (
                <tr key={c.colonne_excel}>
                  <td style={page.td}><strong>{c.colonne_excel}</strong></td>
                  <td style={page.td}>
                    <select
                      aria-label={`Activité pour la colonne ${c.colonne_excel}`}
                      value={c.activite_id ?? ""}
                      onChange={(e) => enregistrerCorresp(c.colonne_excel, e.target.value)}
                      style={page.entrees}
                    >
                      <option value="">— aucune —</option>
                      {activites
                        .filter((a) => a.actif || a.id === c.activite_id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>{a.nom} ({a.code})</option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ---------- Journal ---------- */}
        <section style={{ ...page.carte, padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Journal des synchronisations</h2>
          {journal.length === 0 ? (
            <p style={{ color: C.gris, margin: 0 }}>Aucune synchronisation.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={page.th}>Date</th>
                    <th style={page.th}>Origine</th>
                    <th style={page.th}>Résultat</th>
                    <th style={page.th}>Créées</th>
                    <th style={page.th}>Modifiées</th>
                    <th style={page.th}>Inchangées</th>
                    <th style={page.th}>Disparues</th>
                    <th style={page.th}>À corriger</th>
                    <th style={page.th}>Fichier</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((s) => (
                    <tr key={s.id}>
                      <td style={page.td}>{dateHeure(s.demarree_le)}</td>
                      <td style={page.td}>
                        {s.source === "AGENT" ? "Agent" : `Manuel${s.lancee_par ? ` (${noms.get(s.lancee_par) ?? "?"})` : ""}`}
                      </td>
                      <td style={page.td}>
                        {s.statut === "APPLIQUEE" ? (
                          <Pastille genre="ok">Appliquée</Pastille>
                        ) : s.statut === "ECHEC" ? (
                          <span title={s.message_erreur ?? ""}><Pastille genre="crit">Échec</Pastille></span>
                        ) : (
                          <Pastille genre="info">{s.statut === "EN_COURS" ? "Interrompue" : s.statut}</Pastille>
                        )}
                        {s.statut === "ECHEC" && s.message_erreur && (
                          <div style={{ fontSize: 13, color: C.rougeTexte, marginTop: 4 }}>{s.message_erreur}</div>
                        )}
                      </td>
                      <td style={page.td}>{s.nb_creees}</td>
                      <td style={page.td}>{s.nb_modifiees}</td>
                      <td style={page.td}>{s.nb_inchangees}</td>
                      <td style={page.td}>{s.nb_disparues}</td>
                      <td style={page.td}>{s.nb_anomalies}</td>
                      <td style={page.td}>{s.fichier_nom ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function SynchroSuiviAffairesPage() {
  return (
    <GardeAcces droit="administration">
      <SynchroContenu />
    </GardeAcces>
  );
}
