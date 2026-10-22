"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";

/* ===============================================================
   SUIVI RH (ADMIN)

   Tous les mouvements de congés et de compteur, collaborateur par
   collaborateur, sur un exercice (novembre → octobre) :
   - CP : droits (reportés, acquis, ancienneté, exceptionnels), pris,
     en attente, solde ; RTT : acquis, pris, en attente, solde ;
   - compteur de récupération : initial, heures sup mises au compteur,
     récupérations (RE), ajustements, compteur actuel ;
   - le détail (clic sur une ligne) : historique daté de tous les
     mouvements, et trois actions : saisir / modifier les droits de
     l'exercice, ajuster le compteur, ajouter des CP exceptionnels.
   C'est la SEULE page des droits RH (la page Collaborateurs ne sert qu'à
   créer la fiche). Les autres pages lisent ces droits sans changement :
   Mon espace RH (soldes), Ma semaine (compteur initial), Validation RH.
================================================================ */

type Collab = { id: string; prenom: string | null; nom: string | null; trigramme: string | null; role: string | null; actif: boolean; inclus_statistiques: boolean | null };
type Droit = {
  collaborateur_id: string;
  exercice: number;
  cp_reportes: number;
  cp_acquis: number;
  cp_anciennete: number;
  cp_exceptionnels_avec_justificatif: number;
  cp_exceptionnels_sans_justificatif: number;
  rtt_acquis: number;
  compteur_recuperation_initial: number;
  cp_periode_debut: string | null;
  cp_periode_fin: string | null;
};

const CHAMPS_DROITS: [keyof FormDroits, string, string][] = [
  ["cp_reportes", "CP reportés (année précédente)", "number"],
  ["cp_acquis", "CP acquis (année courante)", "number"],
  ["cp_anciennete", "CP d'ancienneté", "number"],
  ["rtt_acquis", "RTT acquis", "number"],
  ["cp_exceptionnels_avec_justificatif", "CP exceptionnels avec justificatif", "number"],
  ["cp_exceptionnels_sans_justificatif", "CP exceptionnels sans justificatif", "number"],
  ["compteur_recuperation_initial", "Compteur de récupération initial (h)", "number"],
  ["cp_periode_debut", "Début de la période CP", "date"],
  ["cp_periode_fin", "Fin de la période CP", "date"],
];
type FormDroits = {
  cp_reportes: string;
  cp_acquis: string;
  cp_anciennete: string;
  rtt_acquis: string;
  cp_exceptionnels_avec_justificatif: string;
  cp_exceptionnels_sans_justificatif: string;
  compteur_recuperation_initial: string;
  cp_periode_debut: string;
  cp_periode_fin: string;
};
type Demande = { id: string; collaborateur_id: string; type_demande: string; date_debut: string; date_fin: string; duree_jours: number; heures_re: number | null; statut: string; created_at: string };
type Feuille = {
  id: string;
  collaborateur_id: string;
  semaine_debut: string;
  statut: string;
  compteur_avant: number | null;
  compteur_apres: number | null;
  heures_supplementaires: number | null;
  heures_supplementaires_compteur: number | null;
  heures_supplementaires_payees: number | null;
  total_re: number | null;
  cloture_mensuelle: boolean | null;
};
type Regularisation = { id: string; collaborateur_id: string; created_at: string; heures: number; compteur_avant: number; compteur_apres: number; motif: string; created_by: string | null };

type Mouvement = { date: string; type: "CP" | "RTT" | "RE" | "HS" | "AJUSTEMENT" | "COMPTEUR"; libelle: string; valeur: string; detail?: string; couleur: string };

const n = (v: unknown) => Number(v) || 0;
const fmt = (v: number) => (Math.round(v * 100) / 100).toLocaleString("fr-FR");
const dateFR = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR");
const estCP = (t: string) => t === "CP" || t.startsWith("CP_EXCEPTIONNEL");
const ACCORDEE = ["VALIDEE", "ENVOYEE_RH"];
const exerciceDe = (iso: string) => (Number(iso.slice(5, 7)) >= 11 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);
const libelleType: Record<string, string> = {
  CP: "Congé payé",
  CP_EXCEPTIONNEL_AVEC_JUSTIFICATIF: "CP exceptionnel (justifié)",
  CP_EXCEPTIONNEL_SANS_JUSTIFICATIF: "CP exceptionnel",
  RTT: "RTT",
  RE: "Récupération",
};
const nomDe = (c?: Collab) => (c ? `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() : "");

function SuiviRHContenu() {
  const [exercice, setExercice] = useState(() => exerciceDe(new Date().toISOString().slice(0, 10)));
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [droits, setDroits] = useState<Droit[]>([]);
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [feuilles, setFeuilles] = useState<Feuille[]>([]);
  const [regs, setRegs] = useState<Regularisation[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [ajustement, setAjustement] = useState({ heures: "", motif: "" });
  const [ajoutCP, setAjoutCP] = useState({ jours: "", justificatif: true });
  const [rechargement, setRechargement] = useState(0);
  // formulaire des droits de l'exercice (ouvert pour une personne)
  const [formDroits, setFormDroits] = useState<{ id: string; f: FormDroits } | null>(null);

  // arrivée depuis Collaborateurs (« Suivi RH → » ou création) : la ligne de la personne s'ouvre
  const [depuisLien, setDepuisLien] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("collaborateur");
    if (id) {
      setOuvert(id);
      setDepuisLien(id);
    }
  }, []);

  const debutEx = `${exercice}-11-01`;
  const finEx = `${exercice + 1}-10-31`;

  useEffect(() => {
    let actif = true;
    setChargement(true);
    (async () => {
      try {
        const [co, dr, de, fe, rg] = await Promise.all([
          supabase.from("collaborateurs").select("id,prenom,nom,trigramme,role,actif,inclus_statistiques").order("nom"),
          supabase.from("rh_droits").select("*").eq("exercice", exercice),
          chargerTout<Demande>((a, b) =>
            supabase.from("rh_demandes").select("id,collaborateur_id,type_demande,date_debut,date_fin,duree_jours,heures_re,statut,created_at").gte("date_debut", debutEx).lte("date_debut", finEx).order("date_debut").range(a, b)
          ),
          chargerTout<Feuille>((a, b) =>
            supabase
              .from("feuilles_heures")
              .select("id,collaborateur_id,semaine_debut,statut,compteur_avant,compteur_apres,heures_supplementaires,heures_supplementaires_compteur,heures_supplementaires_payees,total_re,cloture_mensuelle")
              .lte("semaine_debut", finEx)
              .order("semaine_debut")
              .range(a, b)
          ),
          chargerTout<Regularisation>((a, b) => supabase.from("rh_compteur_regularisations").select("*").order("created_at").range(a, b)),
        ]);
        if (co.error) throw new Error(co.error.message);
        if (dr.error) throw new Error(dr.error.message);
        if (!actif) return;
        setCollabs(((co.data ?? []) as Collab[]).filter((c) => (c.role ?? "").toUpperCase() !== "DIRECTION"));
        setDroits((dr.data ?? []) as Droit[]);
        setDemandes(de);
        setFeuilles(fe);
        setRegs(rg);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Chargement impossible.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [exercice, debutEx, finEx, rechargement]);

  /* une ligne par collaborateur */
  const lignes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return collabs
      .filter((c) => c.actif)
      .filter((c) => !q || `${c.trigramme ?? ""} ${nomDe(c)}`.toLowerCase().includes(q))
      .map((c) => {
        const d = droits.find((x) => x.collaborateur_id === c.id);
        const ds = demandes.filter((x) => x.collaborateur_id === c.id);
        const cpDroits = d ? n(d.cp_reportes) + n(d.cp_acquis) + n(d.cp_anciennete) + n(d.cp_exceptionnels_avec_justificatif) + n(d.cp_exceptionnels_sans_justificatif) : 0;
        const somme = (filtre: (x: Demande) => boolean) => ds.filter(filtre).reduce((t, x) => t + n(x.duree_jours), 0);
        const cpPris = somme((x) => estCP(x.type_demande) && ACCORDEE.includes(x.statut));
        const cpAttente = somme((x) => estCP(x.type_demande) && x.statut === "EN_ATTENTE");
        const rttPris = somme((x) => x.type_demande === "RTT" && ACCORDEE.includes(x.statut));
        const rttAttente = somme((x) => x.type_demande === "RTT" && x.statut === "EN_ATTENTE");

        const fs = feuilles.filter((f) => f.collaborateur_id === c.id && f.statut === "A_TRAITER");
        const fsEx = fs.filter((f) => f.semaine_debut >= debutEx);
        const derniere = fs[fs.length - 1];
        const compteur = derniere?.compteur_apres !== null && derniere?.compteur_apres !== undefined ? n(derniere.compteur_apres) : n(d?.compteur_recuperation_initial);
        const hsCompteur = fsEx.reduce((t, f) => t + n(f.heures_supplementaires_compteur), 0);
        const hsPayees = fsEx.reduce((t, f) => t + n(f.heures_supplementaires_payees), 0);
        const re = fsEx.reduce((t, f) => t + n(f.total_re), 0);
        const ajust = regs.filter((r) => r.collaborateur_id === c.id && r.created_at.slice(0, 10) >= debutEx && r.created_at.slice(0, 10) <= finEx).reduce((t, r) => t + n(r.heures), 0);

        return {
          c,
          d,
          cpDroits,
          cpPris,
          cpAttente,
          cpSolde: cpDroits - cpPris - cpAttente,
          rttAcquis: n(d?.rtt_acquis),
          rttPris,
          rttAttente,
          rttSolde: n(d?.rtt_acquis) - rttPris - rttAttente,
          compteurInitial: n(d?.compteur_recuperation_initial),
          hsCompteur,
          hsPayees,
          re,
          ajust,
          compteur,
        };
      })
      .sort((x, y) => (x.c.trigramme ?? "").localeCompare(y.c.trigramme ?? ""));
  }, [collabs, droits, demandes, feuilles, regs, recherche, debutEx, finEx]);

  /* historique d'un collaborateur */
  const mouvementsDe = useCallback(
    (id: string): Mouvement[] => {
      const m: Mouvement[] = [];
      for (const x of demandes.filter((x) => x.collaborateur_id === id)) {
        const accordee = ACCORDEE.includes(x.statut);
        const statut = accordee ? "accordé" : x.statut === "EN_ATTENTE" ? "en attente" : x.statut === "REFUSEE" ? "refusé" : "annulé";
        const periode = x.date_debut === x.date_fin ? dateFR(x.date_debut) : `${dateFR(x.date_debut)} → ${dateFR(x.date_fin)}`;
        m.push({
          date: x.date_debut,
          type: x.type_demande === "RE" ? "RE" : x.type_demande === "RTT" ? "RTT" : "CP",
          libelle: `${libelleType[x.type_demande] ?? x.type_demande} · ${periode}`,
          valeur: x.type_demande === "RE" ? `${fmt(n(x.heures_re))} h` : `${accordee || x.statut === "EN_ATTENTE" ? "−" : ""}${fmt(n(x.duree_jours))} j`,
          detail: statut,
          couleur: accordee ? "#1f4e79" : x.statut === "EN_ATTENTE" ? "#8a6500" : "#8a9097",
        });
      }
      for (const f of feuilles.filter((f) => f.collaborateur_id === id && f.statut === "A_TRAITER" && f.semaine_debut >= debutEx)) {
        const hs = n(f.heures_supplementaires_compteur);
        const re = n(f.total_re);
        if (hs === 0 && re === 0 && !f.cloture_mensuelle) continue;
        const morceaux = [hs ? `+${fmt(hs)} h sup au compteur` : "", re ? `−${fmt(re)} h de RE` : "", n(f.heures_supplementaires_payees) ? `${fmt(n(f.heures_supplementaires_payees))} h sup payées` : ""].filter(Boolean);
        m.push({
          date: f.semaine_debut,
          type: "COMPTEUR",
          libelle: `Feuille de la semaine du ${dateFR(f.semaine_debut)}${f.cloture_mensuelle ? " (clôture du mois)" : ""}`,
          valeur: `${fmt(n(f.compteur_avant))} → ${fmt(n(f.compteur_apres))} h`,
          detail: morceaux.join(" · "),
          couleur: "#2e7d32",
        });
      }
      for (const r of regs.filter((r) => r.collaborateur_id === id && r.created_at.slice(0, 10) >= debutEx && r.created_at.slice(0, 10) <= finEx)) {
        m.push({
          date: r.created_at.slice(0, 10),
          type: "AJUSTEMENT",
          libelle: `Ajustement du compteur — ${r.motif}`,
          valeur: `${n(r.heures) > 0 ? "+" : ""}${fmt(n(r.heures))} h`,
          detail: `${fmt(n(r.compteur_avant))} → ${fmt(n(r.compteur_apres))} h${r.created_by ? ` · par ${collabs.find((c) => c.id === r.created_by)?.trigramme ?? "admin"}` : ""}`,
          couleur: "#7a3e00",
        });
      }
      return m.sort((x, y) => y.date.localeCompare(x.date));
    },
    [demandes, feuilles, regs, collabs, debutEx, finEx]
  );

  async function ajusterCompteur(id: string) {
    const h = Number(ajustement.heures.replace(",", ".").replace(/\s/g, ""));
    if (!Number.isFinite(h) || h === 0) return setErreur("Indiquez des heures à ajouter (ex. 3) ou à retirer (ex. -2,5).");
    if (!ajustement.motif.trim()) return setErreur("Le motif de l'ajustement est obligatoire.");
    setErreur("");
    const { error } = await supabase.rpc("rh_regulariser_compteur", { p_collaborateur_id: id, p_heures: h, p_motif: ajustement.motif.trim() });
    if (error) return setErreur(error.message);
    setAjustement({ heures: "", motif: "" });
    setInfo(`Compteur ajusté de ${h > 0 ? "+" : ""}${fmt(h)} h.`);
    setRechargement((x) => x + 1);
  }

  async function ajouterCP(id: string, d: Droit | undefined) {
    const j = Number(ajoutCP.jours.replace(",", "."));
    if (!Number.isFinite(j) || j <= 0) return setErreur("Indiquez le nombre de jours de CP exceptionnels à ajouter (ex. 1 ou 0,5).");
    const champ = ajoutCP.justificatif ? "cp_exceptionnels_avec_justificatif" : "cp_exceptionnels_sans_justificatif";
    setErreur("");
    const { error } = await supabase
      .from("rh_droits")
      .upsert({ collaborateur_id: id, exercice, [champ]: Math.round((n(d?.[champ]) + j) * 2) / 2 }, { onConflict: "collaborateur_id,exercice" });
    if (error) return setErreur(error.message);
    setAjoutCP({ jours: "", justificatif: ajoutCP.justificatif });
    setInfo(`${fmt(j)} j de CP exceptionnels ajoutés.`);
    setRechargement((x) => x + 1);
  }

  // nouvelle fiche sans droits : le formulaire s'ouvre directement
  useEffect(() => {
    if (!depuisLien || chargement) return;
    if (!droits.some((d) => d.collaborateur_id === depuisLien)) ouvrirDroits(depuisLien, undefined);
    setDepuisLien(null);
  }, [depuisLien, chargement, droits]); // eslint-disable-line react-hooks/exhaustive-deps

  function ouvrirDroits(id: string, d: Droit | undefined) {
    const v = (x: unknown) => String(n(x));
    setFormDroits({
      id,
      f: {
        cp_reportes: v(d?.cp_reportes),
        cp_acquis: v(d?.cp_acquis),
        cp_anciennete: v(d?.cp_anciennete),
        rtt_acquis: v(d?.rtt_acquis),
        cp_exceptionnels_avec_justificatif: v(d?.cp_exceptionnels_avec_justificatif),
        cp_exceptionnels_sans_justificatif: v(d?.cp_exceptionnels_sans_justificatif),
        compteur_recuperation_initial: v(d?.compteur_recuperation_initial),
        cp_periode_debut: d?.cp_periode_debut ?? `${exercice}-04-01`,
        cp_periode_fin: d?.cp_periode_fin ?? `${exercice + 1}-05-31`,
      },
    });
  }

  async function enregistrerDroits() {
    if (!formDroits) return;
    const f = formDroits.f;
    const nb = (x: string) => Number(String(x).replace(",", ".")) || 0;
    if (nb(f.compteur_recuperation_initial) < -30) return setErreur("Le compteur initial ne peut pas descendre sous -30 h.");
    setErreur("");
    const { error } = await supabase.from("rh_droits").upsert(
      {
        collaborateur_id: formDroits.id,
        exercice,
        cp_reportes: nb(f.cp_reportes),
        cp_acquis: nb(f.cp_acquis),
        cp_anciennete: nb(f.cp_anciennete),
        rtt_acquis: nb(f.rtt_acquis),
        cp_exceptionnels_avec_justificatif: nb(f.cp_exceptionnels_avec_justificatif),
        cp_exceptionnels_sans_justificatif: nb(f.cp_exceptionnels_sans_justificatif),
        compteur_recuperation_initial: nb(f.compteur_recuperation_initial),
        cp_periode_debut: f.cp_periode_debut || null,
        cp_periode_fin: f.cp_periode_fin || null,
      },
      { onConflict: "collaborateur_id,exercice" }
    );
    if (error) return setErreur(error.message);
    setFormDroits(null);
    setInfo(`Droits de l'exercice ${exercice}-${exercice + 1} enregistrés.`);
    setRechargement((x) => x + 1);
  }

  const totaux = useMemo(
    () => ({
      cpSolde: lignes.reduce((t, l) => t + l.cpSolde, 0),
      attente: lignes.reduce((t, l) => t + l.cpAttente + l.rttAttente, 0),
      compteur: lignes.reduce((t, l) => t + l.compteur, 0),
      auDela: lignes.filter((l) => l.compteur > 30).length,
      sansDroits: lignes.filter((l) => !l.d).length,
    }),
    [lignes]
  );

  const th: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap", padding: "8px 6px" };
  const thG: CSSProperties = { ...th, textAlign: "left" };
  const td: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap", padding: "8px 6px" };
  const tdG: CSSProperties = { ...td, textAlign: "left" };
  const sep: CSSProperties = { borderLeft: `2px solid ${C.ligne}` };
  const champ: CSSProperties = { ...page.entrees, minHeight: 38 };

  return (
    <main style={page.fond}>
      <EnTetePage section="RH" />
      <div style={{ ...page.contenu, maxWidth: 1400 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={page.titre}>Suivi RH</h1>
            <p style={page.sousTitre}>Congés, RTT et compteur de récupération de chaque collaborateur sur l’exercice : soldes et historique des mouvements.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice((e) => e - 1)} aria-label="Exercice précédent">◀</button>
            <strong style={{ fontSize: 17 }}>Exercice {exercice}-{exercice + 1}</strong>
            <button type="button" style={page.btnSecondaire} onClick={() => setExercice((e) => e + 1)} aria-label="Exercice suivant">▶</button>
          </div>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
              <Tuile libelle="CP restants" valeur={`${fmt(totaux.cpSolde)} j`} sous="toute l’équipe" />
              <Tuile libelle="Demandes en attente" valeur={`${fmt(totaux.attente)} j`} sous="CP et RTT à valider" accent={totaux.attente > 0} />
              <Tuile libelle="Compteurs cumulés" valeur={`${fmt(totaux.compteur)} h`} sous={`${totaux.auDela} au-delà de 30 h`} accent={totaux.auDela > 0} />
              <Tuile libelle="Droits non saisis" valeur={String(totaux.sansDroits)} sous="pour cet exercice" accent={totaux.sansDroits > 0} />
            </div>

            <section style={{ ...page.carte, padding: 14, overflowX: "auto" }}>
              <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un collaborateur…" aria-label="Rechercher" style={{ ...champ, maxWidth: 280, marginBottom: 10 }} />
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={thG} rowSpan={2}>Collaborateur</th>
                    <th style={{ ...th, ...sep, textAlign: "center" }} colSpan={4}>Congés payés (j)</th>
                    <th style={{ ...th, ...sep, textAlign: "center" }} colSpan={3}>RTT (j)</th>
                    <th style={{ ...th, ...sep, textAlign: "center" }} colSpan={5}>Compteur de récupération (h)</th>
                  </tr>
                  <tr>
                    <th style={{ ...th, ...sep }}>Droits</th>
                    <th style={th}>Pris</th>
                    <th style={th}>Attente</th>
                    <th style={th}>Solde</th>
                    <th style={{ ...th, ...sep }}>Acquis</th>
                    <th style={th}>Pris</th>
                    <th style={th}>Solde</th>
                    <th style={{ ...th, ...sep }}>Initial</th>
                    <th style={th} title="Heures sup mises au compteur sur l’exercice">+ HS</th>
                    <th style={th} title="Récupérations prises sur l’exercice">− RE</th>
                    <th style={th} title="Ajustements manuels sur l’exercice">± Ajust.</th>
                    <th style={th}>Actuel</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const ouverte = ouvert === l.c.id;
                    return (
                      <Fragment key={l.c.id}>
                        <tr onClick={() => { setOuvert(ouverte ? null : l.c.id); setInfo(""); setErreur(""); }} style={{ cursor: "pointer", background: ouverte ? "#fff7f7" : undefined }}>
                          <td style={tdG}>
                            <span style={{ color: C.gris, marginRight: 6 }}>{ouverte ? "▾" : "▸"}</span>
                            <strong>{l.c.trigramme}</strong> <span style={{ color: C.gris }}>{nomDe(l.c)}</span>
                            {!l.d && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "#7a3e00" }}>droits non saisis</span>}
                          </td>
                          <td style={{ ...td, ...sep }}>{fmt(l.cpDroits)}</td>
                          <td style={td}>{fmt(l.cpPris)}</td>
                          <td style={{ ...td, color: l.cpAttente ? "#8a6500" : C.gris }}>{l.cpAttente ? fmt(l.cpAttente) : "—"}</td>
                          <td style={{ ...td, fontWeight: 800, color: l.cpSolde < 0 ? C.rougeTexte : undefined }}>{fmt(l.cpSolde)}</td>
                          <td style={{ ...td, ...sep }}>{fmt(l.rttAcquis)}</td>
                          <td style={td}>{fmt(l.rttPris + l.rttAttente)}</td>
                          <td style={{ ...td, fontWeight: 800, color: l.rttSolde < 0 ? C.rougeTexte : undefined }}>{fmt(l.rttSolde)}</td>
                          <td style={{ ...td, ...sep }}>{fmt(l.compteurInitial)}</td>
                          <td style={{ ...td, color: "#2e7d32" }}>{l.hsCompteur ? `+${fmt(l.hsCompteur)}` : "—"}</td>
                          <td style={{ ...td, color: "#1f4e79" }}>{l.re ? `−${fmt(l.re)}` : "—"}</td>
                          <td style={{ ...td, color: "#7a3e00" }}>{l.ajust ? `${l.ajust > 0 ? "+" : ""}${fmt(l.ajust)}` : "—"}</td>
                          <td style={{ ...td, fontWeight: 800, color: l.compteur > 30 ? "#b3261e" : l.compteur < 0 ? "#7a3e00" : "#1b5e20" }}>
                            {fmt(l.compteur)}
                            {l.compteur > 30 && " ⚠"}
                          </td>
                        </tr>
                        {ouverte && (
                          <tr>
                            <td colSpan={13} style={{ ...tdG, background: "#fafbfc", padding: "12px 16px", whiteSpace: "normal" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                                <div style={{ flex: "2 1 520px", minWidth: 0 }}>
                                  <strong>Historique de l’exercice</strong>
                                  {(() => {
                                    const mv = mouvementsDe(l.c.id);
                                    return mv.length === 0 ? (
                                      <p style={{ color: C.gris }}>Aucun mouvement sur cet exercice.</p>
                                    ) : (
                                      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: 13 }}>
                                        <tbody>
                                          {mv.map((x, i) => (
                                            <tr key={i}>
                                              <td style={{ ...tdG, padding: "5px 6px", color: C.gris, width: 90 }}>{dateFR(x.date)}</td>
                                              <td style={{ ...tdG, padding: "5px 6px", whiteSpace: "normal" }}>
                                                <span style={{ display: "inline-block", minWidth: 92, fontSize: 11, fontWeight: 800, color: x.couleur }}>{x.type === "COMPTEUR" ? "FEUILLE" : x.type}</span>
                                                {x.libelle}
                                                {x.detail && <div style={{ fontSize: 12, color: C.gris, paddingLeft: 92 }}>{x.detail}</div>}
                                              </td>
                                              <td style={{ ...td, padding: "5px 6px", fontWeight: 800, color: x.couleur }}>{x.valeur}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    );
                                  })()}
                                </div>

                                <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
                                  <div style={{ border: `1px solid ${l.d ? C.ligne : "#e9b877"}`, background: l.d ? "#ffffff" : "#fff7ea", borderRadius: 8, padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                      <strong>Droits de l’exercice {exercice}-{exercice + 1}</strong>
                                      {formDroits?.id !== l.c.id && (
                                        <button type="button" style={page.btnSecondaire} onClick={() => ouvrirDroits(l.c.id, l.d)}>
                                          {l.d ? "✏️ Modifier" : "Saisir les droits"}
                                        </button>
                                      )}
                                    </div>
                                    {!l.d && formDroits?.id !== l.c.id && <div style={{ fontSize: 12, color: "#7a3e00", marginTop: 4 }}>Pas encore saisis : ses soldes restent à zéro.</div>}
                                    {formDroits?.id === l.c.id && (
                                      <div style={{ marginTop: 8 }}>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px" }}>
                                          {CHAMPS_DROITS.map(([cle, libelle, type]) => (
                                            <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, fontWeight: 700 }}>
                                              {libelle}
                                              <input
                                                type={type}
                                                step={type === "number" ? "0.5" : undefined}
                                                value={formDroits.f[cle]}
                                                onChange={(e) => setFormDroits((x) => (x ? { ...x, f: { ...x.f, [cle]: e.target.value } } : x))}
                                                style={{ ...champ, minHeight: 34 }}
                                              />
                                            </label>
                                          ))}
                                        </div>
                                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                                          <button type="button" style={page.btnSecondaire} onClick={() => setFormDroits(null)}>Annuler</button>
                                          <button type="button" style={page.btnPrimaire} onClick={() => void enregistrerDroits()}>Enregistrer</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ border: "1px solid #9fd4a7", background: "#f2faf3", borderRadius: 8, padding: 10 }}>
                                    <strong>Ajuster le compteur</strong>
                                    <div style={{ fontSize: 12, color: C.gris, margin: "2px 0 6px" }}>Compteur actuel : {fmt(l.compteur)} h. Ex. 3 ou -2,5, avec un motif.</div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      <input value={ajustement.heures} onChange={(e) => setAjustement((a) => ({ ...a, heures: e.target.value.replace(/[^0-9.,\-+]/g, "") }))} placeholder="heures (±)" inputMode="decimal" style={{ ...champ, width: 100 }} aria-label="Heures d'ajustement" />
                                      <input value={ajustement.motif} onChange={(e) => setAjustement((a) => ({ ...a, motif: e.target.value }))} placeholder="motif (obligatoire)" style={{ ...champ, flex: "1 1 140px" }} aria-label="Motif" />
                                      <button type="button" style={page.btnPrimaire} onClick={() => void ajusterCompteur(l.c.id)}>Ajuster</button>
                                    </div>
                                  </div>
                                  <div style={{ border: "1px solid #dbe5f5", background: "#f3f7ff", borderRadius: 8, padding: 10 }}>
                                    <strong>Ajouter des CP exceptionnels</strong>
                                    <div style={{ fontSize: 12, color: C.gris, margin: "2px 0 6px" }}>
                                      Déjà accordés cet exercice : {fmt(n(l.d?.cp_exceptionnels_avec_justificatif) + n(l.d?.cp_exceptionnels_sans_justificatif))} j.
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      <input value={ajoutCP.jours} onChange={(e) => setAjoutCP((a) => ({ ...a, jours: e.target.value.replace(/[^0-9.,]/g, "") }))} placeholder="jours" inputMode="decimal" style={{ ...champ, width: 80 }} aria-label="Jours" />
                                      <select value={ajoutCP.justificatif ? "AVEC" : "SANS"} onChange={(e) => setAjoutCP((a) => ({ ...a, justificatif: e.target.value === "AVEC" }))} style={{ ...champ, width: "auto" }} aria-label="Justificatif">
                                        <option value="AVEC">avec justificatif</option>
                                        <option value="SANS">sans justificatif</option>
                                      </select>
                                      <button type="button" style={page.btnPrimaire} onClick={() => void ajouterCP(l.c.id, l.d)}>+ Ajouter</button>
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 12, color: C.gris }}>
                                    Droits : reportés {fmt(n(l.d?.cp_reportes))} j · acquis {fmt(n(l.d?.cp_acquis))} j · ancienneté {fmt(n(l.d?.cp_anciennete))} j · RTT {fmt(n(l.d?.rtt_acquis))} j.
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function SuiviRHPage() {
  return (
    <GardeAcces droit="administration">
      <SuiviRHContenu />
    </GardeAcces>
  );
}
