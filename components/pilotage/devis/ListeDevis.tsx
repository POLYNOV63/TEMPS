"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerAnnuaire, chargerMoi, chargerTout, type Moi } from "@/lib/pilotageDonnees";
import { aujourdhuiISO, formatDate, formatHeures, nomCollab, type Collab, type Genre } from "@/lib/pilotageCalculs";
import {
  DELAI_RELANCE,
  construireDevis,
  debutExercice,
  joursEntre,
  numeroDevis,
  type CategorieDevis,
  type Devis,
  type LigneSuiviDevis,
  type Relance,
} from "@/lib/suiviDevis";

/* ===============================================================
   SUIVI DES DEVIS - ONGLET LISTE (SUIVI_DEVIS)

   Pendant commercial du Suivi des affaires : un devis (DBE) par ligne,
   ce qu'il est devenu, et les relances des devis envoyés.
   Règles de calcul : lib/suiviDevis.ts.
================================================================ */

/* même code couleur que le Suivi des affaires (STATUT_SURLIGNE) */
const SURLIGNE: Record<string, { background: string; borderRadius: number; padding: string }> = {
  "Intention de commande": { background: "#ffe58a", borderRadius: 3, padding: "0 3px" },
  "Livrée": { background: "#c8ecc9", borderRadius: 3, padding: "0 3px" },
  "Devis envoyé": { background: "#d6e6fb", borderRadius: 3, padding: "0 3px" },
};

type Filtre = "EN_COURS" | "OUVERT" | "ENVOYE" | "A_RELANCER" | "INTENTION" | "REMPORTE" | "PERDU" | "TOUS";
type ColonneTri = "numero" | "client" | "redacteur" | "ouverture" | "envoi" | "montant";

type Ligne = Devis & {
  client: string | null;
  redKey: string; // « id:… » ou « nom:… », pour le filtre
  redNom: string;
  rendu: string | null; // date de rendu prévue d'un devis ouvert
  dbeId: string | null; // le DBE au Pilotage, s'il existe
  joursOuvert: number | null;
  joursEnvoye: number | null;
  retard: number | null; // jours de retard sur la date de rendu (devis ouvert)
  exercice: number | null; // exercice d'ouverture
};

const ORDRE: Record<CategorieDevis, number> = { OUVERT: 2, ENVOYE: 3, INTENTION: 4, AUTRE: 5, REMPORTE: 6, PERDU: 7, FERME: 8 };
const EN_COURS: CategorieDevis[] = ["OUVERT", "ENVOYE", "INTENTION", "AUTRE"];
const CLOS: CategorieDevis[] = ["REMPORTE", "PERDU", "FERME"];

const normaliser = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const taux = (g: number, p: number) => (g + p > 0 ? `${Math.round((g / (g + p)) * 100)} %` : "—");

export default function ListeDevis() {
  const aujourdhui = aujourdhuiISO();
  const exerciceCourant = debutExercice(aujourdhui);

  const [lignesSuivi, setLignesSuivi] = useState<LigneSuiviDevis[]>([]);
  const [montants, setMontants] = useState<Map<string, number>>(new Map());
  const [montantsVisibles, setMontantsVisibles] = useState(false);
  const [clients, setClients] = useState<Map<string, string>>(new Map());
  const [dbes, setDbes] = useState<Map<string, { id: string; responsable_id: string | null; echeance: string | null }>>(new Map());
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [relances, setRelances] = useState<Relance[]>([]);
  const [erreurRelances, setErreurRelances] = useState("");
  const [moi, setMoi] = useState<Moi | null>(null);
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [exercice, setExercice] = useState(exerciceCourant);
  const [filtre, setFiltre] = useState<Filtre>("EN_COURS");
  const [recherche, setRecherche] = useState("");
  const [filtreRedacteur, setFiltreRedacteur] = useState("");
  const [filtreClient, setFiltreClient] = useState("");
  const [tri, setTri] = useState<{ col: ColonneTri; sens: 1 | -1 } | null>(null);

  const [edRelance, setEdRelance] = useState<{ numero: string; date: string; commentaire: string } | null>(null);
  const [enregRelance, setEnregRelance] = useState(false);
  const [erreurRelance, setErreurRelance] = useState("");
  const [historiques, setHistoriques] = useState<Set<string>>(new Set());

  const chargerRelances = useCallback(async () => {
    const { data, error } = await supabase
      .from("suivi_devis_relances")
      .select("id,numero_devis,relance_le,commentaire,saisi_par,cree_le")
      .order("relance_le", { ascending: false })
      .limit(10000);
    if (error) {
      setErreurRelances(
        /does not exist|schema cache|introuvable/i.test(error.message)
          ? "Les relances ne sont pas encore installées : lancez le script supabase/91_suivi_devis_relances.sql dans Supabase."
          : `Relances illisibles : ${error.message}`
      );
      return;
    }
    setErreurRelances("");
    setRelances((data ?? []) as Relance[]);
  }, []);

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [brutes, mts, cls, pil, an, m, synchro] = await Promise.all([
          chargerTout<LigneSuiviDevis>((a, b) =>
            supabase
              .from("suivi_lignes")
              .select(
                "id,genre,numero_devis,base_devis,numero_affaire,base_affaire,statut,designation,client_id,redacteur,redacteur_id,date_ouverture,date_envoi,date_reception_commande,delai,heures_total,disparue"
              )
              .order("cle")
              .range(a, b)
          ),
          chargerTout<{ ligne_id: string; montant: number | string }>((a, b) => supabase.from("suivi_lignes_montants").select("ligne_id,montant").order("ligne_id").range(a, b)),
          chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
          chargerTout<{ id: string; numero: string; responsable_id: string | null; echeance: string | null }>((a, b) =>
            supabase.from("pilotage_affaires").select("id,numero,responsable_id,echeance").eq("type", "DBE").order("id").range(a, b)
          ),
          chargerAnnuaire(),
          chargerMoi(),
          supabase.from("suivi_synchronisations").select("terminee_le").eq("statut", "APPLIQUEE").order("terminee_le", { ascending: false }).limit(1),
        ]);
        if (!actif) return;
        setLignesSuivi(brutes);
        setMontants(new Map(mts.map((x) => [x.ligne_id, Number(x.montant) || 0])));
        setMontantsVisibles(mts.length > 0);
        setClients(new Map(cls.map((c) => [c.id, c.nom_abrege])));
        const d = new Map<string, { id: string; responsable_id: string | null; echeance: string | null }>();
        for (const p of pil) {
          const n = numeroDevis(p.numero);
          if (n) d.set(n, { id: p.id, responsable_id: p.responsable_id, echeance: p.echeance });
        }
        setDbes(d);
        setAnnuaire(an);
        setMoi(m);
        setDerniereSynchro(synchro.data?.[0]?.terminee_le ?? null);
        await chargerRelances();
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger les devis.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [chargerRelances]);

  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);

  /* tous les devis, avec ce qu'il faut pour l'affichage */
  const tous: Ligne[] = useMemo(() => {
    return construireDevis(lignesSuivi, montants, relances, aujourdhui).map((d) => {
      const pil = dbes.get(d.numero);
      const redId = pil?.responsable_id ?? d.ligne.redacteur_id;
      const redNom = redId && collabs.has(redId) ? nomCollab(collabs.get(redId)) : d.ligne.redacteur?.trim() || "—";
      const rendu = (pil?.echeance ?? d.ligne.delai)?.slice(0, 10) ?? null;
      const depuisEnvoi = d.envoi ?? d.ouverture;
      return {
        ...d,
        client: d.ligne.client_id ? clients.get(d.ligne.client_id) ?? null : null,
        redKey: redId ? `id:${redId}` : d.ligne.redacteur ? `nom:${d.ligne.redacteur.trim()}` : "",
        redNom,
        rendu,
        dbeId: pil?.id ?? null,
        joursOuvert: d.ouverture ? joursEntre(d.ouverture, aujourdhui) : null,
        joursEnvoye: (d.categorie === "ENVOYE" || d.categorie === "INTENTION") && depuisEnvoi ? joursEntre(depuisEnvoi, aujourdhui) : null,
        retard: d.categorie === "OUVERT" && rendu ? joursEntre(rendu, aujourdhui) : null,
        exercice: d.ouverture ? debutExercice(d.ouverture) : null,
      };
    });
  }, [lignesSuivi, montants, relances, dbes, collabs, clients, aujourdhui]);

  /* ---------------------------- vignettes ---------------------------- */
  const synthese = useMemo(() => {
    const de = (c: CategorieDevis, exo = false) => tous.filter((d) => d.categorie === c && (!exo || d.exercice === exercice));
    const ouverts = de("OUVERT");
    const envoyes = de("ENVOYE");
    const remportes = de("REMPORTE", true);
    const perdus = de("PERDU", true);
    const fermes = de("FERME", true);
    const somme = (l: Ligne[]) => l.reduce((t, d) => t + (montantsVisibles ? d.montant : d.heures), 0);
    return {
      ouverts: ouverts.length,
      enRetard: ouverts.filter((d) => (d.retard ?? 0) > 0).length,
      sansDate: ouverts.filter((d) => !d.rendu).length,
      envoyes: envoyes.length,
      valeurEnvoyes: somme(envoyes),
      intentions: de("INTENTION").length,
      aRelancer: envoyes.filter((d) => d.aRelancer).length,
      remportes: remportes.length,
      valeurRemportes: somme(remportes),
      perdus: perdus.length,
      valeurPerdus: somme(perdus),
      fermes: fermes.length,
    };
  }, [tous, exercice, montantsVisibles]);

  const valeur = (n: number) => (montantsVisibles ? euros(n) : formatHeures(n));

  /* ---------------------------- liste filtrée ---------------------------- */
  const q = normaliser(recherche.trim());
  const liste = useMemo(() => {
    const garde = tous.filter((d) => {
      if (q) {
        const texte = normaliser(`dbe${d.numero} ${d.numero} ${d.client ?? ""} ${d.ligne.designation ?? ""} ${d.commande ?? ""} ${d.avenantDe ?? ""}`);
        if (!texte.includes(q)) return false;
      } else {
        const exo = d.exercice === exercice;
        switch (filtre) {
          case "EN_COURS":
            if (!EN_COURS.includes(d.categorie)) return false;
            break;
          case "OUVERT":
          case "ENVOYE":
          case "INTENTION":
            if (d.categorie !== filtre) return false;
            break;
          case "A_RELANCER":
            if (!d.aRelancer) return false;
            break;
          case "REMPORTE":
            if (d.categorie !== "REMPORTE" || !exo) return false;
            break;
          case "PERDU":
            if (!(d.categorie === "PERDU" || d.categorie === "FERME") || !exo) return false;
            break;
          case "TOUS":
            if (!EN_COURS.includes(d.categorie) && !(CLOS.includes(d.categorie) && exo)) return false;
            break;
        }
      }
      if (filtreRedacteur && d.redKey !== filtreRedacteur) return false;
      if (filtreClient && (d.client ?? "") !== filtreClient) return false;
      return true;
    });

    const comparer = (x: Ligne, y: Ligne): number => {
      if (tri) {
        const v = (d: Ligne): string | number => {
          switch (tri.col) {
            case "numero":
              return Number(d.numero) || 0;
            case "client":
              return normaliser(d.client ?? "~");
            case "redacteur":
              return normaliser(d.redNom);
            case "ouverture":
              return d.ouverture ?? "9999";
            case "envoi":
              return d.envoi ?? "9999";
            case "montant":
              return montantsVisibles ? d.montant : d.heures;
          }
        };
        const a = v(x);
        const b = v(y);
        const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "fr");
        return c * tri.sens || Number(y.numero) - Number(x.numero);
      }
      // tri par défaut : ce qui demande une action d'abord
      const rang = (d: Ligne) => (d.aRelancer ? 0 : d.categorie === "OUVERT" && (d.retard ?? 0) > 0 ? 1 : ORDRE[d.categorie]);
      const r = rang(x) - rang(y);
      if (r) return r;
      if (x.categorie === "OUVERT") return (x.rendu ?? "9999").localeCompare(y.rendu ?? "9999");
      if (x.categorie === "ENVOYE" || x.categorie === "INTENTION") return (x.envoi ?? x.ouverture ?? "").localeCompare(y.envoi ?? y.ouverture ?? "");
      return (y.ouverture ?? "").localeCompare(x.ouverture ?? "") || Number(y.numero) - Number(x.numero);
    };
    return garde.sort(comparer);
  }, [tous, q, filtre, exercice, filtreRedacteur, filtreClient, tri, montantsVisibles]);

  const choixRedacteurs = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of tous) if (d.redKey && EN_COURS.concat(CLOS).includes(d.categorie)) m.set(d.redKey, d.redNom);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [tous]);
  const choixClients = useMemo(() => [...new Set(tous.map((d) => d.client).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "fr")), [tous]);

  /* ---------------------------- relances ---------------------------- */
  async function enregistrer() {
    if (!edRelance) return;
    if (!edRelance.date) {
      setErreurRelance("Indiquez la date de la relance.");
      return;
    }
    if (edRelance.date > aujourdhui) {
      setErreurRelance("La date de relance ne peut pas être dans le futur.");
      return;
    }
    setEnregRelance(true);
    setErreurRelance("");
    const { error } = await supabase.rpc("suivi_devis_noter_relance", {
      p_numero: edRelance.numero,
      p_date: edRelance.date,
      p_commentaire: edRelance.commentaire.trim() || null,
    });
    setEnregRelance(false);
    if (error) {
      setErreurRelance(`Relance non enregistrée : ${error.message}`);
      return;
    }
    setEdRelance(null);
    await chargerRelances();
  }

  async function supprimer(r: Relance) {
    if (!window.confirm(`Supprimer la relance du ${formatDate(r.relance_le)} (DBE${r.numero_devis}) ?`)) return;
    const { error } = await supabase.rpc("suivi_devis_supprimer_relance", { p_id: r.id });
    if (error) {
      window.alert(`Suppression impossible : ${error.message}`);
      return;
    }
    await chargerRelances();
  }

  function basculerHistorique(numero: string) {
    setHistoriques((h) => {
      const n = new Set(h);
      if (n.has(numero)) n.delete(numero);
      else n.add(numero);
      return n;
    });
  }

  /* ---------------------------- affichage ---------------------------- */
  function ouEnEst(d: Ligne): { genre: Genre; texte: string; detail?: string } {
    switch (d.categorie) {
      case "OUVERT":
        if (!d.rendu) return { genre: "warn", texte: "Sans date de rendu" };
        if ((d.retard ?? 0) > 0) return { genre: "crit", texte: `En retard de ${d.retard} j`, detail: `à rendre le ${formatDate(d.rendu)}` };
        if (d.retard === 0) return { genre: "warn", texte: "À rendre aujourd’hui" };
        return { genre: "ok", texte: `À rendre dans ${-(d.retard ?? 0)} j`, detail: `le ${formatDate(d.rendu)}` };
      case "ENVOYE": {
        const der = d.relances[0];
        const derTexte = der ? `relancé le ${formatDate(der.relance_le)}` : "jamais relancé";
        if (d.aRelancer) return { genre: "crit", texte: "À relancer", detail: derTexte };
        return {
          genre: "info",
          texte: "Sans réponse",
          detail: d.prochaineRelance ? `à relancer à partir du ${formatDate(d.prochaineRelance)}${der ? ` · ${derTexte}` : ""}` : undefined,
        };
      }
      case "INTENTION":
        return { genre: "warn", texte: "Intention de commande", detail: "pas encore commandé" };
      case "REMPORTE":
        return { genre: "ok", texte: "Remporté", detail: d.statut ?? undefined };
      case "PERDU":
        return { genre: "info", texte: "Perdu" };
      case "FERME":
        return { genre: "info", texte: "Fermé sans devis", detail: "ni montant ni heures chiffrées" };
      default:
        return { genre: "warn", texte: "Statut à vérifier", detail: d.statut ? `« ${d.statut} »` : "statut vide dans le classeur" };
    }
  }

  function exporter() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        liste.map((d) => {
          const o = ouEnEst(d);
          return {
            Devis: `DBE${d.numero}`,
            "Statut (classeur)": d.statut ?? "",
            "Où en est-il": `${o.texte}${o.detail ? ` (${o.detail})` : ""}`,
            Client: d.client ?? "",
            Désignation: d.ligne.designation ?? "",
            Rédacteur: d.redNom,
            "Ouvert le": d.ouverture ?? "",
            "Envoyé le": d.envoi ?? "",
            "Jours depuis l'envoi": d.joursEnvoye ?? "",
            "À rendre le": d.categorie === "OUVERT" ? d.rendu ?? "" : "",
            "Dernière relance": d.relances[0]?.relance_le ?? "",
            "Commentaire de relance": d.relances[0]?.commentaire ?? "",
            "Avenant de": d.avenantDe ?? "",
            Commande: d.commande ?? "",
            "Heures chiffrées": d.heures,
            ...(montantsVisibles ? { "Montant (€)": d.montant } : {}),
          };
        })
      ),
      "Devis"
    );
    XLSX.writeFile(wb, `Suivi_des_devis_${aujourdhui}.xlsx`);
  }

  const thC: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "12px 12px" };
  const thN: CSSProperties = { ...thC, textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "12px 12px" };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const petit: CSSProperties = { fontSize: 12, color: C.gris, marginTop: 2 };
  const gris = (t: string) => <span style={{ color: C.gris }}>{t}</span>;
  const selectFiltre: CSSProperties = { ...page.entrees, width: "auto", minWidth: 150, maxWidth: 240, minHeight: 40 };

  const boutonFiltre = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#c9cdd2"}`,
    minHeight: 40,
    padding: "0 12px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  function choisir(f: Filtre) {
    setFiltre(f);
    setRecherche("");
    setTri(null);
  }

  function Vignette({ f, libelle, valeur: v, sous, accent }: { f: Filtre; libelle: string; valeur: string; sous: string; accent?: boolean }) {
    const actif = filtre === f && !q;
    return (
      <button
        type="button"
        onClick={() => choisir(f)}
        aria-pressed={actif}
        title="Afficher ces devis dans la liste"
        style={{ all: "unset", cursor: "pointer", flex: "1 1 0", minWidth: 165, display: "flex", borderRadius: 12, boxShadow: actif ? `0 0 0 2px ${C.rouge}` : undefined }}
      >
        <Tuile libelle={libelle} valeur={v} sous={sous} accent={accent} />
      </button>
    );
  }

  function EnTeteTri({ col, libelle, num }: { col: ColonneTri; libelle: string; num?: boolean }) {
    const actif = tri?.col === col;
    return (
      <th style={num ? thN : thC} aria-sort={actif ? (tri?.sens === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          title="Trier (un troisième clic revient au tri par défaut)"
          onClick={() => setTri((t) => (t?.col !== col ? { col, sens: col === "montant" ? -1 : 1 } : t.sens === (col === "montant" ? -1 : 1) ? { col, sens: t.sens === 1 ? -1 : 1 } : null))}
          style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap", color: actif ? C.rougeFonce : "inherit" }}
        >
          {libelle} {actif ? (tri?.sens === 1 ? "↑" : "↓") : <span style={{ opacity: 0.35 }}>↕</span>}
        </button>
      </th>
    );
  }

  const titreListe: Record<Filtre, string> = {
    EN_COURS: "Devis en cours (ouverts, envoyés, intentions)",
    OUVERT: "Devis ouverts (en rédaction)",
    ENVOYE: "Devis envoyés, en attente de réponse",
    A_RELANCER: "Devis à relancer",
    INTENTION: "Intentions de commande",
    REMPORTE: `Devis remportés (ouverts sur l’exercice ${exercice}-${exercice + 1})`,
    PERDU: `Devis perdus (ouverts sur l’exercice ${exercice}-${exercice + 1})`,
    TOUS: `Tous : en cours, et remportés ou perdus de l’exercice ${exercice}-${exercice + 1}`,
  };

  const filtresActifs = filtre !== "EN_COURS" || recherche !== "" || filtreRedacteur !== "" || filtreClient !== "" || tri !== null;
  const nbColonnes = 9;
  const s = synthese;

  let contenu: ReactNode = null;
  if (!chargement && !erreur)
    contenu = (
      <>
        {/* ---------- vignettes ---------- */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          <Vignette
            f="OUVERT"
            libelle="Devis ouverts"
            valeur={String(s.ouverts)}
            sous={`en rédaction${s.enRetard ? ` · ${s.enRetard} en retard` : ""}${s.sansDate ? ` · ${s.sansDate} sans date` : ""}`}
            accent={s.enRetard > 0}
          />
          <Vignette
            f="ENVOYE"
            libelle="Envoyés"
            valeur={String(s.envoyes)}
            sous={`en attente de réponse · ${valeur(s.valeurEnvoyes)}${s.intentions ? ` · + ${pluriel(s.intentions, "intention")}` : ""}`}
          />
          <Vignette
            f="A_RELANCER"
            libelle="À relancer"
            valeur={String(s.aRelancer)}
            sous={`envoyés depuis plus de ${DELAI_RELANCE} jours, sans relance depuis ${DELAI_RELANCE} jours`}
            accent={s.aRelancer > 0}
          />
          <Vignette f="REMPORTE" libelle="Remportés" valeur={String(s.remportes)} sous={`exercice ${exercice}-${exercice + 1} · ${valeur(s.valeurRemportes)}`} />
          <Vignette
            f="PERDU"
            libelle="Perdus"
            valeur={String(s.perdus)}
            sous={`exercice ${exercice}-${exercice + 1} · ${valeur(s.valeurPerdus)}${s.fermes ? ` · + ${s.fermes} fermés sans devis` : ""}`}
          />
          <div style={{ flex: "1 1 0", minWidth: 165, display: "flex" }}>
            <Tuile
              libelle="Taux de transformation"
              valeur={taux(s.remportes, s.perdus)}
              sous={`${s.remportes}/${s.remportes + s.perdus} en nombre · ${taux(s.valeurRemportes, s.valeurPerdus)} en ${montantsVisibles ? "montant" : "heures"} (fermés sans devis exclus)`}
            />
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, color: C.gris, marginBottom: 18 }}>
          Remportés, perdus et taux : devis ouverts sur l’exercice
          <select value={exercice} onChange={(e) => setExercice(Number(e.target.value))} aria-label="Exercice" style={{ ...page.entrees, width: "auto", minHeight: 34, fontWeight: 700 }}>
            {[0, 1, 2].map((k) => (
              <option key={k} value={exerciceCourant - k}>
                {exerciceCourant - k}-{exerciceCourant - k + 1}
                {k === 0 ? " (en cours)" : ""}
              </option>
            ))}
          </select>
          · ouverts, envoyés et à relancer : la situation du jour, tous exercices confondus.
        </div>

        {erreurRelances && <Message genre="erreur">{erreurRelances}</Message>}

        <section style={{ ...page.carte, padding: 16 }}>
          {/* ---------- filtres ---------- */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
            {(
              [
                ["EN_COURS", "En cours"],
                ["OUVERT", "Ouverts"],
                ["ENVOYE", "Envoyés"],
                ["A_RELANCER", "À relancer"],
                ["INTENTION", "Intentions"],
                ["REMPORTE", "Remportés"],
                ["PERDU", "Perdus"],
                ["TOUS", "Tous"],
              ] as [Filtre, string][]
            ).map(([f, lib]) => (
              <button key={f} type="button" aria-pressed={filtre === f && !q} onClick={() => choisir(f)} style={boutonFiltre(filtre === f && !q)}>
                {lib}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="search"
              aria-label="Rechercher un devis"
              placeholder="Rechercher : n° de devis (DBE2715 ou 2715), client, désignation…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              style={{ ...page.entrees, maxWidth: 380, minHeight: 40 }}
            />
            <select value={filtreRedacteur} onChange={(e) => setFiltreRedacteur(e.target.value)} aria-label="Rédacteur" style={{ ...selectFiltre, borderColor: filtreRedacteur ? C.rouge : undefined }}>
              <option value="">Tous les rédacteurs</option>
              {choixRedacteurs.map(([k, nom]) => (
                <option key={k} value={k}>
                  {nom}
                </option>
              ))}
            </select>
            <select value={filtreClient} onChange={(e) => setFiltreClient(e.target.value)} aria-label="Client" style={{ ...selectFiltre, borderColor: filtreClient ? C.rouge : undefined }}>
              <option value="">Tous les clients</option>
              {choixClients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {filtresActifs && (
              <button
                type="button"
                onClick={() => {
                  setFiltre("EN_COURS");
                  setRecherche("");
                  setFiltreRedacteur("");
                  setFiltreClient("");
                  setTri(null);
                }}
                style={{ ...page.btnSecondaire, minHeight: 38 }}
              >
                Réinitialiser
              </button>
            )}
            <button type="button" onClick={exporter} disabled={liste.length === 0} style={{ ...page.btnSecondaire, minHeight: 38, marginLeft: "auto" }}>
              Exporter en Excel
            </button>
          </div>

          <h2 style={{ margin: "8px 0", fontSize: 18 }}>
            {q ? "Résultats de la recherche, tous statuts et tous exercices" : titreListe[filtre]} <span style={{ color: C.gris, fontWeight: 600 }}>({liste.length})</span>
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12.5, color: C.gris, margin: "-2px 0 8px" }}>
            {Object.entries(SURLIGNE).map(([st, style]) => (
              <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <i style={{ display: "inline-block", width: 14, height: 12, borderRadius: 3, background: style.background, border: "1px solid #d5d9de" }} /> {st}
              </span>
            ))}
          </div>

          {liste.length === 0 ? (
            <p style={{ color: C.gris, padding: "8px 4px" }}>{tous.length === 0 ? "Aucun devis dans la copie du Suivi d’affaire BE." : "Aucun devis ne correspond à ces filtres."}</p>
          ) : (
            <table className="devis-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 14.5 }}>
              <thead className="devis-entete">
                <tr>
                  <EnTeteTri col="numero" libelle="N°" />
                  <EnTeteTri col="client" libelle="Client" />
                  <th style={thC}>Désignation</th>
                  <EnTeteTri col="redacteur" libelle="Rédacteur" />
                  <EnTeteTri col="ouverture" libelle="Ouvert le" />
                  <EnTeteTri col="envoi" libelle="Envoyé le" />
                  <EnTeteTri col="montant" libelle={montantsVisibles ? "Montant" : "Heures"} num />
                  <th style={thC}>Où en est-il</th>
                  <th style={thC}>Relance</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((d) => {
                  const o = ouEnEst(d);
                  const der = d.relances[0];
                  const ouvert = historiques.has(d.numero);
                  const relancable = d.categorie === "ENVOYE" || d.categorie === "INTENTION";
                  const styleNumero: CSSProperties = { fontWeight: 800, fontSize: 15, color: C.rougeFonce, whiteSpace: "nowrap", ...(d.statut ? SURLIGNE[d.statut] ?? {} : {}) };
                  return (
                    <Fragment key={d.numero}>
                      <tr className="ligne-devis">
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {d.dbeId ? (
                            <Link href={`/pilotage/affaire/${d.dbeId}`} title={d.statut ?? undefined} style={styleNumero}>
                              DBE{d.numero}
                            </Link>
                          ) : (
                            <span title={d.statut ?? undefined} style={styleNumero}>
                              DBE{d.numero}
                            </span>
                          )}
                          {d.avenantDe && (
                            <div style={petit}>
                              avenant de{" "}
                              <Link href={`/affaires/bilan?affaire=${d.avenantDe}`} style={{ fontWeight: 700, color: C.rougeFonce }} title="Ouvrir le bilan de l’affaire mère">
                                {d.avenantDe}
                              </Link>
                            </div>
                          )}
                          {d.commande && (
                            <div style={petit}>
                              →{" "}
                              <Link
                                href={`/affaires/bilan?affaire=CBE${d.ligne.base_affaire ?? ""}&commande=${d.commande.replace(/^CBE/i, "")}`}
                                style={{ fontWeight: 700, color: C.rougeFonce }}
                                title="Ouvrir le bilan de l’affaire"
                              >
                                {d.commande}
                              </Link>
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, maxWidth: 170, color: "#4b5057" }}>{d.client ?? gris("—")}</td>
                        <td style={{ ...td, minWidth: 160, maxWidth: 280, lineHeight: 1.35, fontWeight: 600 }}>{d.ligne.designation ?? gris("—")}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <strong>{d.redNom}</strong>
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {formatDate(d.ouverture)}
                          {d.categorie === "OUVERT" && d.joursOuvert !== null && <div style={petit}>depuis {pluriel(d.joursOuvert, "jour")}</div>}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {d.envoi ? formatDate(d.envoi) : gris("—")}
                          {d.joursEnvoye !== null && (
                            <div style={{ ...petit, ...(d.aRelancer ? { color: C.rougeTexte, fontWeight: 700 } : {}) }}>
                              {d.envoi ? `il y a ${pluriel(d.joursEnvoye, "jour")}` : `ouvert il y a ${pluriel(d.joursEnvoye, "jour")}`}
                            </div>
                          )}
                        </td>
                        <td style={tdN}>{montantsVisibles ? (d.montant ? euros(d.montant) : gris("—")) : d.heures ? formatHeures(d.heures) : gris("—")}</td>
                        <td style={{ ...td, minWidth: 150 }}>
                          <Pastille genre={o.genre}>{o.texte}</Pastille>
                          {o.detail && <div style={{ ...petit, marginTop: 4 }}>{o.detail}</div>}
                        </td>
                        <td style={{ ...td, minWidth: 150 }}>
                          {der && (
                            <button
                              type="button"
                              onClick={() => basculerHistorique(d.numero)}
                              aria-expanded={ouvert}
                              title="Voir les relances de ce devis"
                              style={{ all: "unset", cursor: "pointer", display: "block", fontSize: 13 }}
                            >
                              <span style={{ color: C.gris }}>{ouvert ? "▾" : "▸"}</span> {formatDate(der.relance_le)}
                              {d.relances.length > 1 && <span style={{ color: C.gris }}> ({d.relances.length} relances)</span>}
                              {der.commentaire && <div style={{ ...petit, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{der.commentaire}</div>}
                            </button>
                          )}
                          {relancable && moi?.peutModifier && edRelance?.numero !== d.numero && !erreurRelances && (
                            <button
                              type="button"
                              onClick={() => {
                                setErreurRelance("");
                                setEdRelance({ numero: d.numero, date: aujourdhui, commentaire: "" });
                              }}
                              style={{ all: "unset", cursor: "pointer", display: "block", fontSize: 12.5, fontWeight: 700, color: C.rougeFonce, marginTop: der ? 4 : 0 }}
                            >
                              ✓ Relance faite…
                            </button>
                          )}
                          {!der && !relancable && gris("—")}
                        </td>
                      </tr>

                      {/* formulaire « relance faite », sur une ligne à part */}
                      {edRelance?.numero === d.numero && (
                        <tr>
                          <td colSpan={nbColonnes} style={{ ...page.td, background: "#f3f7ff", padding: "10px 16px 12px 24px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
                              <strong style={{ alignSelf: "center", color: "#243b66" }}>Relance de DBE{d.numero} :</strong>
                              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>
                                Relancé le
                                <input
                                  type="date"
                                  value={edRelance.date}
                                  max={aujourdhui}
                                  onChange={(e) => setEdRelance({ ...edRelance, date: e.target.value })}
                                  style={{ ...page.entrees, minHeight: 38, width: 170 }}
                                />
                              </label>
                              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris, flex: "1 1 260px" }}>
                                Commentaire (facultatif)
                                <input
                                  type="text"
                                  value={edRelance.commentaire}
                                  maxLength={500}
                                  placeholder="ex. appel à M. X, réponse attendue fin du mois"
                                  onChange={(e) => setEdRelance({ ...edRelance, commentaire: e.target.value })}
                                  style={{ ...page.entrees, minHeight: 38 }}
                                />
                              </label>
                              <button type="button" onClick={() => void enregistrer()} disabled={enregRelance} style={{ ...page.btnPrimaire, minHeight: 38 }}>
                                {enregRelance ? "Enregistrement…" : "Enregistrer"}
                              </button>
                              <button type="button" onClick={() => setEdRelance(null)} style={{ ...page.btnSecondaire, minHeight: 38 }}>
                                Annuler
                              </button>
                            </div>
                            <div style={{ ...petit, marginTop: 6 }}>
                              Le devis sort de « À relancer » pendant {DELAI_RELANCE} jours ; il y revient s’il n’a toujours pas de réponse.
                            </div>
                            {erreurRelance && (
                              <div role="alert" style={{ color: "#b3261e", fontWeight: 700, marginTop: 8 }}>
                                {erreurRelance}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {/* historique des relances */}
                      {ouvert && d.relances.length > 0 && (
                        <tr>
                          <td colSpan={nbColonnes} style={{ ...page.td, background: "#fafbfc", padding: "8px 16px 12px 24px" }}>
                            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris, marginBottom: 4 }}>Relances de DBE{d.numero}</div>
                            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                              {d.relances.map((r) => {
                                const peutSupprimer = Boolean(moi?.peutModifier && (moi.estAdmin || (r.saisi_par && r.saisi_par === moi.id)));
                                return (
                                  <li key={r.id} style={{ fontSize: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                                    <strong>{formatDate(r.relance_le)}</strong>
                                    <span style={{ color: C.gris }}>par {r.saisi_par ? nomCollab(collabs.get(r.saisi_par)) : "—"}</span>
                                    {r.commentaire && <span>— {r.commentaire}</span>}
                                    {peutSupprimer && (
                                      <button type="button" onClick={() => void supprimer(r)} style={{ all: "unset", cursor: "pointer", fontSize: 12, color: C.rougeTexte, fontWeight: 700 }}>
                                        supprimer
                                      </button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          <details style={{ marginTop: 14, fontSize: 13, color: "#3b4046" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment la liste est-elle construite ?</summary>
            <ul style={{ lineHeight: 1.6 }}>
              <li>
                Un devis = un n° DBE du Suivi d’affaire BE (synchronisé{derniereSynchro ? ` le ${formatDate(derniereSynchro)}` : ""}). Son statut est celui du
                classeur : « Devis ouvert » = ouvert, « Devis envoyé » = envoyé, « Commande reçue », « Livrée » ou « Commande annulée » = remporté, « Devis perdu » =
                perdu (ou « fermé sans devis » s’il n’a ni montant ni heures chiffrées).
              </li>
              <li>
                Un devis d’<strong>avenant</strong> est un devis comme un autre (même statuts, mêmes règles, mêmes relances) ; il porte seulement la mention
                « avenant de CBE… », l’affaire mère.
              </li>
              <li>
                Rédacteur et date de rendu d’un devis ouvert : ceux du DBE au Pilotage (« ✏️ affecter » dans le Suivi des affaires), à défaut ceux du classeur.
              </li>
              <li>
                <strong>À relancer</strong> : devis envoyé, ni remporté ni perdu, envoyé il y a plus de {DELAI_RELANCE} jours et sans relance notée depuis{" "}
                {DELAI_RELANCE} jours. « Relance faite » le sort de la liste pour {DELAI_RELANCE} jours. Une intention de commande n’est jamais « à relancer », mais on peut y
                noter une relance.
              </li>
              <li>
                Remportés, perdus et taux de transformation portent sur les devis <strong>ouverts</strong> pendant l’exercice choisi (comme l’onglet Statistiques) ; le
                taux = remportés ÷ (remportés + perdus), sans les fermés sans devis.
              </li>
            </ul>
          </details>
        </section>
      </>
    );

  return (
    <div>
      <style>{`
        .devis-table tr.ligne-devis > td { vertical-align: middle; border-bottom: 1px solid #e3e6ea; }
        .devis-table tr.ligne-devis:hover > td { background: #f6f8fb; }
        .devis-entete th { position: sticky; top: var(--hauteur-nav, 49px); z-index: 5; background: #f4f5f7; box-shadow: inset 0 -2px 0 #d5d9de; }
      `}</style>
      {erreur && <Message genre="erreur">{erreur}</Message>}
      {chargement && !erreur && <Message genre="info">Chargement des devis…</Message>}
      {!chargement && !erreur && !montantsVisibles && tous.length > 0 && (
        <Message genre="info">Les montants ne sont pas visibles avec votre profil : les devis sont donnés en heures chiffrées.</Message>
      )}
      {contenu}
    </div>
  );
}
