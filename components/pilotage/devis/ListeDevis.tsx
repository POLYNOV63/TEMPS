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
   SUIVI DES DEVIS - ONGLET GESTION (SUIVI_DEVIS, RELANCES_PLANIFIEES)

   Pour manager les devis :
     - OUVERTS (en rédaction) : qui rédige, pour quand (« ✏️ affecter »,
       repris du Suivi des affaires : le devis est au planning et dans la
       feuille de route du rédacteur) ;
     - ENVOYÉS : en attente de réponse ;
     - À RELANCER : qui relance, et quand (« 📅 prévoir » : la relance va
       dans la feuille de route de la personne), puis « ✓ faite ».
   Les intentions de commande n'apparaissent pas ici (Suivi des affaires).
   Règles de calcul : lib/suiviDevis.ts.
================================================================ */

/* même code couleur que le Suivi des affaires (STATUT_SURLIGNE) */
const SURLIGNE: Record<string, { background: string; borderRadius: number; padding: string }> = {
  "Livrée": { background: "#c8ecc9", borderRadius: 3, padding: "0 3px" },
  "Devis envoyé": { background: "#d6e6fb", borderRadius: 3, padding: "0 3px" },
};

type Filtre = "OUVERT" | "ENVOYE" | "A_RELANCER";
type ColonneTri = "numero" | "client" | "redacteur" | "ouverture" | "envoi" | "montant";
type Edition = { numero: string; mode: "AFFECTER" | "PREVOIR" | "FAITE"; resp: string; date: string; commentaire: string };
type Dbe = { id: string; responsable_id: string | null; echeance: string | null };

type Ligne = Devis & {
  client: string | null;
  redId: string | null;
  redKey: string; // « id:… » ou « nom:… », pour le filtre
  redNom: string;
  rendu: string | null; // date de rendu prévue d'un devis ouvert
  dbe: Dbe | null; // le DBE au Pilotage (planning, feuille de route), s'il existe
  joursOuvert: number | null;
  joursEnvoye: number | null;
  retard: number | null; // jours de retard sur la date de rendu (devis ouvert)
  exercice: number | null; // exercice d'ouverture
};

const normaliser = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const keuros = (n: number) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n));
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const taux = (g: number, p: number) => (g + p > 0 ? `${Math.round((g / (g + p)) * 100)} %` : "—");
const RANG_RELANCE = { EN_RETARD: 0, A_PLANIFIER: 1, PREVUE: 2, AUCUNE: 3 } as const;

export default function ListeDevis() {
  const aujourdhui = aujourdhuiISO();
  const exerciceCourant = debutExercice(aujourdhui);

  const [lignesSuivi, setLignesSuivi] = useState<LigneSuiviDevis[]>([]);
  const [montants, setMontants] = useState<Map<string, number>>(new Map());
  const [montantsVisibles, setMontantsVisibles] = useState(false);
  const [clients, setClients] = useState<Map<string, string>>(new Map());
  const [dbes, setDbes] = useState<Map<string, Dbe>>(new Map());
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [relances, setRelances] = useState<Relance[]>([]);
  const [erreurRelances, setErreurRelances] = useState("");
  const [moi, setMoi] = useState<Moi | null>(null);
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [exercice, setExercice] = useState(exerciceCourant);
  const [filtre, setFiltre] = useState<Filtre>("OUVERT");
  const [recherche, setRecherche] = useState("");
  const [filtreRedacteur, setFiltreRedacteur] = useState("");
  const [filtreClient, setFiltreClient] = useState("");
  const [tri, setTri] = useState<{ col: ColonneTri; sens: 1 | -1 } | null>(null);

  const [ed, setEd] = useState<Edition | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurEd, setErreurEd] = useState("");
  const [historiques, setHistoriques] = useState<Set<string>>(new Set());

  const chargerRelances = useCallback(async () => {
    const { data, error } = await supabase
      .from("suivi_devis_relances")
      .select("id,numero_devis,prevue_le,responsable_id,relance_le,commentaire,saisi_par,cree_le,faite_par,reponse")
      .order("cree_le", { ascending: false })
      .limit(10000);
    if (error) {
      setErreurRelances(
        /does not exist|schema cache|column/i.test(error.message)
          ? "Les relances ne sont pas encore installées : lancez dans Supabase les scripts supabase/91, 92 et 93 (suivi_devis_relances…), dans cet ordre."
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
        const d = new Map<string, Dbe>();
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
  // les personnes que l'on peut désigner (pas celles qui ont quitté l'entreprise)
  const choixPersonnes = useMemo(
    () => annuaire.filter((c) => !c.date_sortie || c.date_sortie >= aujourdhui).sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), "fr")),
    [annuaire, aujourdhui]
  );
  const libellePersonne = (c: Collab) => `${nomCollab(c)} — ${`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}`;

  /* tous les devis (hors intentions de commande), avec ce qu'il faut pour l'affichage */
  const tous: Ligne[] = useMemo(() => {
    return construireDevis(lignesSuivi, montants, relances, aujourdhui)
      .filter((d) => d.categorie !== "INTENTION")
      .map((d) => {
        const dbe = dbes.get(d.numero) ?? null;
        const redId = dbe?.responsable_id ?? d.ligne.redacteur_id;
        const redNom = redId && collabs.has(redId) ? nomCollab(collabs.get(redId)) : d.ligne.redacteur?.trim() || "—";
        const rendu = (dbe?.echeance ?? d.ligne.delai)?.slice(0, 10) ?? null;
        const depuisEnvoi = d.envoi ?? d.ouverture;
        return {
          ...d,
          client: d.ligne.client_id ? clients.get(d.ligne.client_id) ?? null : null,
          redId: redId ?? null,
          redKey: redId ? `id:${redId}` : d.ligne.redacteur ? `nom:${d.ligne.redacteur.trim()}` : "",
          redNom,
          rendu,
          dbe,
          joursOuvert: d.ouverture ? joursEntre(d.ouverture, aujourdhui) : null,
          joursEnvoye: d.categorie === "ENVOYE" && depuisEnvoi ? joursEntre(depuisEnvoi, aujourdhui) : null,
          retard: d.categorie === "OUVERT" && rendu ? joursEntre(rendu, aujourdhui) : null,
          exercice: d.ouverture ? debutExercice(d.ouverture) : null,
        };
      });
  }, [lignesSuivi, montants, relances, dbes, collabs, clients, aujourdhui]);

  /* ---------------------------- vignettes ---------------------------- */
  const s = useMemo(() => {
    const de = (c: CategorieDevis, exo = false) => tous.filter((d) => d.categorie === c && (!exo || d.exercice === exercice));
    const somme = (l: Ligne[]) => l.reduce((t, d) => t + (montantsVisibles ? d.montant : d.heures), 0);
    const ouverts = de("OUVERT");
    const envoyes = de("ENVOYE");
    const aRelancer = envoyes.filter((d) => d.aRelancer);
    const remportes = de("REMPORTE", true);
    const perdus = de("PERDU", true);
    const annules = de("ANNULE", true);
    return {
      ouverts: ouverts.length,
      vOuverts: somme(ouverts),
      enRetard: ouverts.filter((d) => (d.retard ?? 0) > 0).length,
      sansDate: ouverts.filter((d) => !d.rendu).length,
      envoyes: envoyes.length,
      vEnvoyes: somme(envoyes),
      aRelancer: aRelancer.length,
      vARelancer: somme(aRelancer),
      aPrevoir: aRelancer.filter((d) => d.etatRelance === "A_PLANIFIER").length,
      relancesEnRetard: aRelancer.filter((d) => d.etatRelance === "EN_RETARD").length,
      remportes: remportes.length,
      vRemportes: somme(remportes),
      perdus: perdus.length,
      vPerdus: somme(perdus),
      annules: annules.length,
      vAnnules: somme(annules),
    };
  }, [tous, exercice, montantsVisibles]);

  const valeur = (n: number) => (montantsVisibles ? keuros(n) : formatHeures(n));

  /* ---------------------------- liste filtrée ---------------------------- */
  const q = normaliser(recherche.trim());
  const liste = useMemo(() => {
    const garde = tous.filter((d) => {
      if (q) {
        const texte = normaliser(`dbe${d.numero} ${d.numero} ${d.client ?? ""} ${d.ligne.designation ?? ""} ${d.commande ?? ""} ${d.avenantDe ?? ""}`);
        if (!texte.includes(q)) return false;
      } else if (filtre === "A_RELANCER") {
        if (!d.aRelancer) return false;
      } else if (d.categorie !== filtre) return false;
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
      if (x.categorie !== y.categorie) return x.categorie.localeCompare(y.categorie);
      if (x.categorie === "OUVERT") {
        const rx = (x.retard ?? 0) > 0 ? 0 : 1;
        const ry = (y.retard ?? 0) > 0 ? 0 : 1;
        return rx - ry || (x.rendu ?? "9999").localeCompare(y.rendu ?? "9999");
      }
      if (x.categorie === "ENVOYE") {
        const r = RANG_RELANCE[x.etatRelance] - RANG_RELANCE[y.etatRelance];
        if (r) return r;
        if (x.prevue && y.prevue) return (x.prevue.prevue_le ?? "").localeCompare(y.prevue.prevue_le ?? "");
        return (x.envoi ?? x.ouverture ?? "").localeCompare(y.envoi ?? y.ouverture ?? "");
      }
      return (y.ouverture ?? "").localeCompare(x.ouverture ?? "") || Number(y.numero) - Number(x.numero);
    };
    return garde.sort(comparer);
  }, [tous, q, filtre, filtreRedacteur, filtreClient, tri, montantsVisibles]);

  const choixRedacteurs = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of tous) if (d.redKey && (d.categorie === "OUVERT" || d.categorie === "ENVOYE")) m.set(d.redKey, d.redNom);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [tous]);
  const choixClients = useMemo(
    () => [...new Set(tous.filter((d) => d.categorie === "OUVERT" || d.categorie === "ENVOYE").map((d) => d.client).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "fr")),
    [tous]
  );

  /* ---------------------------- actions ---------------------------- */
  function ouvrir(d: Ligne, mode: Edition["mode"]) {
    setErreurEd("");
    if (mode === "AFFECTER") setEd({ numero: d.numero, mode, resp: d.dbe?.responsable_id ?? moi?.id ?? "", date: d.dbe?.echeance ?? "", commentaire: "" });
    else if (mode === "PREVOIR") {
      const proposee = d.prevue?.prevue_le ?? (d.prochaineRelance && d.prochaineRelance > aujourdhui ? d.prochaineRelance : aujourdhui);
      setEd({ numero: d.numero, mode, resp: d.prevue?.responsable_id ?? d.redId ?? moi?.id ?? "", date: proposee, commentaire: d.prevue?.commentaire ?? "" });
    } else setEd({ numero: d.numero, mode, resp: "", date: aujourdhui, commentaire: "" });
  }

  async function enregistrer(d: Ligne) {
    if (!ed) return;
    if (!ed.date) return setErreurEd(ed.mode === "AFFECTER" ? "Indiquez la date cible de rendu du devis." : "Indiquez la date de la relance.");
    if ((ed.mode === "AFFECTER" || ed.mode === "PREVOIR") && !ed.resp) return setErreurEd("Choisissez une personne.");
    if (ed.mode === "FAITE" && ed.date > aujourdhui) return setErreurEd("La date de relance ne peut pas être dans le futur.");
    setEnregistrement(true);
    setErreurEd("");
    let message = "";
    if (ed.mode === "AFFECTER" && d.dbe) {
      // AFFECTER_DBE (repris du Suivi des affaires) : le rédacteur, puis la date par la fonction des délais (historisée)
      const dbe = d.dbe;
      let { error } = await supabase.from("pilotage_affaires").update({ responsable_id: ed.resp }).eq("id", dbe.id);
      if (!error && dbe.echeance !== ed.date) {
        ({ error } = await supabase.rpc("pilotage_changer_echeance", {
          p_affaire_id: dbe.id,
          p_nouvelle_date: ed.date,
          p_motif: "Date de rendu du devis fixée depuis le Suivi des devis",
        }));
      }
      if (error) message = `Affectation du devis impossible : ${error.message}`;
      else {
        const fait = { ...dbe, responsable_id: ed.resp, echeance: ed.date };
        setDbes((m) => new Map(m).set(d.numero, fait));
      }
    } else if (ed.mode === "PREVOIR") {
      const { error } = await supabase.rpc("suivi_devis_prevoir_relance", {
        p_numero: d.numero,
        p_responsable: ed.resp,
        p_date: ed.date,
        p_commentaire: ed.commentaire.trim() || null,
      });
      if (error) message = `Relance non prévue : ${error.message}`;
    } else if (ed.mode === "FAITE") {
      // RELANCES_HISTORIQUE : on clôt la relance prévue précise (déjà faite ailleurs : la fonction le dit)
      const { error } = await supabase.rpc("suivi_devis_noter_relance", {
        p_numero: d.numero,
        p_date: ed.date,
        p_reponse: ed.commentaire.trim() || null,
        p_relance_id: d.prevue?.id ?? null,
      });
      if (error) message = `Relance non enregistrée : ${error.message}`;
    }
    setEnregistrement(false);
    if (message) return setErreurEd(message);
    setEd(null);
    if (ed.mode !== "AFFECTER") await chargerRelances();
  }

  async function supprimer(r: Relance) {
    const texte = r.relance_le ? `la relance faite le ${formatDate(r.relance_le)}` : `la relance prévue le ${formatDate(r.prevue_le)}`;
    if (!window.confirm(`Supprimer ${texte} (DBE${r.numero_devis}) ?`)) return;
    const { error } = await supabase.rpc("suivi_devis_supprimer_relance", { p_id: r.id });
    if (error) {
      window.alert(`Suppression impossible : ${error.message}`);
      return;
    }
    await chargerRelances();
  }

  const peutSupprimer = (r: Relance) => Boolean(moi?.peutModifier && (moi.estAdmin || (r.saisi_par && r.saisi_par === moi.id)));

  function basculerHistorique(numero: string) {
    setHistoriques((h) => {
      const n = new Set(h);
      if (n.has(numero)) n.delete(numero);
      else n.add(numero);
      return n;
    });
  }

  /* ---------------------------- affichage ---------------------------- */
  const nomDe = (id: string | null) => (id ? nomCollab(collabs.get(id)) : "—");

  function ouEnEst(d: Ligne): { genre: Genre; texte: string; detail?: string } {
    switch (d.categorie) {
      case "OUVERT":
        if (!d.rendu) return { genre: "warn", texte: "Sans date de rendu" };
        if ((d.retard ?? 0) > 0) return { genre: "crit", texte: `En retard de ${d.retard} j`, detail: `à rendre le ${formatDate(d.rendu)}` };
        if (d.retard === 0) return { genre: "warn", texte: "À rendre aujourd’hui" };
        return { genre: "ok", texte: `À rendre dans ${-(d.retard ?? 0)} j`, detail: `le ${formatDate(d.rendu)}` };
      case "ENVOYE": {
        const der = d.faites[0];
        const derTexte = der ? `dernière relance le ${formatDate(der.relance_le)}` : "jamais relancé";
        switch (d.etatRelance) {
          case "EN_RETARD":
            return { genre: "crit", texte: "Relance en retard", detail: `prévue le ${formatDate(d.prevue?.prevue_le)} (${nomDe(d.prevue?.responsable_id ?? null)})` };
          case "A_PLANIFIER":
            return { genre: "crit", texte: "Relance à prévoir", detail: derTexte };
          case "PREVUE":
            return { genre: "warn", texte: "Relance prévue", detail: `le ${formatDate(d.prevue?.prevue_le)} (${nomDe(d.prevue?.responsable_id ?? null)})` };
          default:
            return { genre: "info", texte: "Sans réponse", detail: d.prochaineRelance ? `à relancer à partir du ${formatDate(d.prochaineRelance)}${der ? ` · ${derTexte}` : ""}` : undefined };
        }
      }
      case "REMPORTE":
        return { genre: "ok", texte: "Remporté", detail: d.statut ?? undefined };
      case "PERDU":
        return { genre: "info", texte: "Perdu" };
      case "ANNULE":
        return { genre: "info", texte: "Annulé", detail: "perdu sans avoir été envoyé" };
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
            "Avenant de": d.avenantDe ?? "",
            "Statut (classeur)": d.statut ?? "",
            "Où en est-il": `${o.texte}${o.detail ? ` (${o.detail})` : ""}`,
            Client: d.client ?? "",
            Désignation: d.ligne.designation ?? "",
            Rédacteur: d.redNom,
            "Ouvert le": d.ouverture ?? "",
            "À rendre le": d.categorie === "OUVERT" ? d.rendu ?? "" : "",
            "Envoyé le": d.envoi ?? "",
            "Jours depuis l'envoi": d.joursEnvoye ?? "",
            "Relance prévue le": d.prevue?.prevue_le ?? "",
            "Relance par": d.prevue ? nomDe(d.prevue.responsable_id) : "",
            "Consigne de la relance prévue": d.prevue?.commentaire ?? "",
            "Dernière relance faite": d.faites[0]?.relance_le ?? "",
            "Faite par": d.faites[0] ? nomDe(d.faites[0].faite_par ?? d.faites[0].responsable_id ?? null) : "",
            "Réponse du client": d.faites[0]?.reponse ?? "",
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
  const lien: CSSProperties = { all: "unset", cursor: "pointer", display: "block", fontSize: 12.5, fontWeight: 700, color: C.rougeFonce, marginTop: 4 };
  const etiquette: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris };

  const boutonFiltre = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#c9cdd2"}`,
    minHeight: 40,
    padding: "0 14px",
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
    setEd(null);
  }

  function Vignette({ f, libelle, valeur: v, sous, accent }: { f?: Filtre; libelle: string; valeur: string; sous: string; accent?: boolean }) {
    if (!f)
      return (
        <div style={{ flex: "1 1 0", minWidth: 160, display: "flex" }}>
          <Tuile libelle={libelle} valeur={v} sous={sous} accent={accent} />
        </div>
      );
    const actif = filtre === f && !q;
    return (
      <button
        type="button"
        onClick={() => choisir(f)}
        aria-pressed={actif}
        title="Afficher ces devis dans la liste"
        style={{ all: "unset", cursor: "pointer", flex: "1 1 0", minWidth: 160, display: "flex", borderRadius: 12, boxShadow: actif ? `0 0 0 2px ${C.rouge}` : undefined }}
      >
        <Tuile libelle={libelle} valeur={v} sous={sous} accent={accent} />
      </button>
    );
  }

  function EnTeteTri({ col, libelle, num }: { col: ColonneTri; libelle: string; num?: boolean }) {
    const actif = tri?.col === col;
    const sensDefaut = col === "montant" ? -1 : 1;
    return (
      <th style={num ? thN : thC} aria-sort={actif ? (tri?.sens === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          title="Trier (un troisième clic revient au tri par défaut)"
          onClick={() => setTri((t) => (!t || t.col !== col ? { col, sens: sensDefaut } : t.sens === sensDefaut ? { col, sens: sensDefaut === 1 ? -1 : 1 } : null))}
          style={{ all: "unset", cursor: "pointer", whiteSpace: "nowrap", color: actif ? C.rougeFonce : "inherit" }}
        >
          {libelle} {actif ? (tri?.sens === 1 ? "↑" : "↓") : <span style={{ opacity: 0.35 }}>↕</span>}
        </button>
      </th>
    );
  }

  const titreListe: Record<Filtre, string> = {
    OUVERT: "Devis ouverts : à rédiger",
    ENVOYE: "Devis envoyés : en attente de réponse",
    A_RELANCER: "Devis à relancer",
  };
  const aideListe: Record<Filtre, string> = {
    OUVERT: "Qui rédige, et pour quand : « ✏️ affecter » met le devis au planning et dans la feuille de route du rédacteur.",
    ENVOYE: `Tous les devis envoyés sans réponse. Ils passent « à relancer » ${DELAI_RELANCE} jours après l’envoi (ou après la dernière relance).`,
    A_RELANCER: "Qui relance, et quand : « 📅 prévoir » met la relance dans la feuille de route de la personne ; « ✓ faite » une fois le client relancé.",
  };

  const filtresActifs = recherche !== "" || filtreRedacteur !== "" || filtreClient !== "" || tri !== null;
  const nbColonnes = 9;
  const ex = `${exercice}-${exercice + 1}`;

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
            sous={`${valeur(s.vOuverts)} · en rédaction${s.enRetard ? ` · ${s.enRetard} en retard` : ""}${s.sansDate ? ` · ${s.sansDate} sans date` : ""}`}
            accent={s.enRetard > 0}
          />
          <Vignette f="ENVOYE" libelle="Envoyés" valeur={String(s.envoyes)} sous={`${valeur(s.vEnvoyes)} · en attente de réponse`} />
          <Vignette
            f="A_RELANCER"
            libelle="À relancer"
            valeur={String(s.aRelancer)}
            sous={`${valeur(s.vARelancer)}${s.aPrevoir ? ` · ${s.aPrevoir} à prévoir` : ""}${s.relancesEnRetard ? ` · ${s.relancesEnRetard} en retard` : ""}`}
            accent={s.aPrevoir + s.relancesEnRetard > 0}
          />
          <Vignette libelle="Remportés" valeur={String(s.remportes)} sous={`${valeur(s.vRemportes)} · exercice ${ex}`} />
          <Vignette libelle="Perdus" valeur={String(s.perdus)} sous={`${valeur(s.vPerdus)} · exercice ${ex}`} />
          <Vignette libelle="Annulés" valeur={String(s.annules)} sous={`${valeur(s.vAnnules)} · jamais envoyés · exercice ${ex}`} />
          <Vignette
            libelle="Taux de transformation"
            valeur={taux(s.remportes, s.perdus)}
            sous={`${s.remportes}/${s.remportes + s.perdus} en nombre · ${taux(s.vRemportes, s.vPerdus)} en ${montantsVisibles ? "montant" : "heures"}`}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, color: C.gris, marginBottom: 18 }}>
          Remportés, perdus, annulés et taux : devis ouverts sur l’exercice
          <select value={exercice} onChange={(e) => setExercice(Number(e.target.value))} aria-label="Exercice" style={{ ...page.entrees, width: "auto", minHeight: 34, fontWeight: 700 }}>
            {[0, 1, 2].map((k) => (
              <option key={k} value={exerciceCourant - k}>
                {exerciceCourant - k}-{exerciceCourant - k + 1}
                {k === 0 ? " (en cours)" : ""}
              </option>
            ))}
          </select>
          · ouverts, envoyés et à relancer : la situation du jour, tous exercices confondus. Le détail est dans l’onglet Statistiques.
        </div>

        {erreurRelances && <Message genre="erreur">{erreurRelances}</Message>}

        <section style={{ ...page.carte, padding: 16 }}>
          {/* ---------- filtres ---------- */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
            {(
              [
                ["OUVERT", `Ouverts (${s.ouverts})`],
                ["ENVOYE", `Envoyés (${s.envoyes})`],
                ["A_RELANCER", `À relancer (${s.aRelancer})`],
              ] as [Filtre, string][]
            ).map(([f, lib]) => (
              <button key={f} type="button" aria-pressed={filtre === f && !q} onClick={() => choisir(f)} style={boutonFiltre(filtre === f && !q)}>
                {lib}
              </button>
            ))}
            <span style={{ width: 8 }} />
            <input
              type="search"
              aria-label="Rechercher un devis"
              placeholder="Rechercher : n° de devis (DBE2715 ou 2715), client, CBE…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              style={{ ...page.entrees, maxWidth: 340, minHeight: 40 }}
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

          <h2 style={{ margin: "8px 0 2px", fontSize: 18 }}>
            {q ? "Résultats de la recherche, tous statuts et tous exercices" : titreListe[filtre]} <span style={{ color: C.gris, fontWeight: 600 }}>({liste.length})</span>
          </h2>
          {!q && <p style={{ margin: "0 0 8px", fontSize: 13, color: C.gris }}>{aideListe[filtre]}</p>}

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
                  <th style={thC}>Gestion</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((d) => {
                  const o = ouEnEst(d);
                  const ouvert = historiques.has(d.numero);
                  const styleNumero: CSSProperties = { fontWeight: 800, fontSize: 15, color: C.rougeFonce, whiteSpace: "nowrap", ...(d.statut ? SURLIGNE[d.statut] ?? {} : {}) };
                  const edIci = ed?.numero === d.numero ? ed : null;
                  const peutGerer = Boolean(moi?.peutModifier);
                  return (
                    <Fragment key={d.numero}>
                      <tr className="ligne-devis">
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {d.dbe ? (
                            <Link href={`/pilotage/affaire/${d.dbe.id}`} title={d.statut ?? undefined} style={styleNumero}>
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
                            <div style={{ ...petit, ...(d.etatRelance === "A_PLANIFIER" || d.etatRelance === "EN_RETARD" ? { color: C.rougeTexte, fontWeight: 700 } : {}) }}>
                              {d.envoi ? `il y a ${pluriel(d.joursEnvoye, "jour")}` : `ouvert il y a ${pluriel(d.joursEnvoye, "jour")}`}
                            </div>
                          )}
                        </td>
                        <td style={tdN}>{montantsVisibles ? (d.montant ? euros(d.montant) : gris("—")) : d.heures ? formatHeures(d.heures) : gris("—")}</td>
                        <td style={{ ...td, minWidth: 160 }}>
                          <Pastille genre={o.genre}>{o.texte}</Pastille>
                          {o.detail && <div style={{ ...petit, marginTop: 4 }}>{o.detail}</div>}
                          {d.prevue?.commentaire && <div style={{ ...petit, maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>« {d.prevue.commentaire} »</div>}
                        </td>
                        <td style={{ ...td, minWidth: 150 }}>
                          {/* devis ouvert : rédacteur et date de rendu */}
                          {d.categorie === "OUVERT" &&
                            peutGerer &&
                            !edIci &&
                            (d.dbe ? (
                              <button type="button" onClick={() => ouvrir(d, "AFFECTER")} title="Choisir le rédacteur du devis et sa date cible de rendu" style={{ ...lien, marginTop: 0 }}>
                                ✏️ affecter
                              </button>
                            ) : (
                              <span style={petit} title="Le Pilotage ne crée pas de DBE pour ce devis (avenant, ou devis ouvert avant le 01/11/2024)">
                                pas au planning
                              </span>
                            ))}
                          {/* devis envoyé : relances */}
                          {/* RELANCES_HISTORIQUE : qui est désigné pour la relance, et quand */}
                          {d.categorie === "ENVOYE" && d.prevue && (
                            <div
                              title={`Relance prévue par ${nomDe(d.prevue.saisi_par)}${d.prevue.commentaire ? ` · consigne : ${d.prevue.commentaire}` : ""}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                marginBottom: 4,
                                padding: "2px 10px",
                                borderRadius: 999,
                                fontSize: 13,
                                fontWeight: 800,
                                whiteSpace: "nowrap",
                                background: d.etatRelance === "EN_RETARD" ? "#fdecec" : "#e3eefb",
                                color: d.etatRelance === "EN_RETARD" ? "#b3261e" : "#1f4e8c",
                              }}
                            >
                              📞 {nomDe(d.prevue.responsable_id)} · le {formatDate(d.prevue.prevue_le)}
                            </div>
                          )}
                          {d.categorie === "ENVOYE" && peutGerer && !erreurRelances && !edIci && (
                            <>
                              <button type="button" onClick={() => ouvrir(d, "PREVOIR")} style={{ ...lien, marginTop: 0 }}>
                                {d.prevue ? "📅 modifier la relance" : "📅 prévoir une relance"}
                              </button>
                              <button type="button" onClick={() => ouvrir(d, "FAITE")} style={lien}>
                                ✓ relance faite…
                              </button>
                            </>
                          )}
                          {(d.faites.length > 0 || d.prevue) && (
                            <button
                              type="button"
                              onClick={() => basculerHistorique(d.numero)}
                              aria-expanded={ouvert}
                              title="Voir l’historique des relances de ce devis"
                              style={{ all: "unset", cursor: "pointer", display: "block", fontSize: 12, color: C.gris, marginTop: 6 }}
                            >
                              {ouvert ? "▾" : "▸"} historique{d.faites.length > 0 ? ` · ${pluriel(d.faites.length, "relance")} faite${d.faites.length > 1 ? "s" : ""}` : ""}
                            </button>
                          )}
                          {d.categorie !== "OUVERT" && d.categorie !== "ENVOYE" && d.faites.length === 0 && gris("—")}
                        </td>
                      </tr>

                      {/* formulaire, sur une ligne à part */}
                      {edIci && (
                        <tr>
                          <td colSpan={nbColonnes} style={{ ...page.td, background: edIci.mode === "AFFECTER" ? "#fff6fa" : "#f3f7ff", padding: "10px 16px 12px 24px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
                              <strong style={{ alignSelf: "center", color: edIci.mode === "AFFECTER" ? "#a3245a" : "#243b66" }}>
                                {edIci.mode === "AFFECTER" ? "Rédaction" : edIci.mode === "PREVOIR" ? "Relance prévue" : "Relance faite"} · DBE{d.numero} :
                              </strong>
                              {edIci.mode !== "FAITE" && (
                                <label style={etiquette}>
                                  {edIci.mode === "AFFECTER" ? "Rédacteur" : "Qui relance"}
                                  <select value={edIci.resp} onChange={(e) => setEd({ ...edIci, resp: e.target.value })} style={{ ...page.entrees, minHeight: 38, width: 240 }}>
                                    <option value="">— choisir —</option>
                                    {choixPersonnes.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {libellePersonne(c)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <label style={etiquette}>
                                {edIci.mode === "AFFECTER" ? "À rendre le" : edIci.mode === "PREVOIR" ? "Le" : "Relancé le"}
                                <input
                                  type="date"
                                  value={edIci.date}
                                  max={edIci.mode === "FAITE" ? aujourdhui : undefined}
                                  onChange={(e) => setEd({ ...edIci, date: e.target.value })}
                                  style={{ ...page.entrees, minHeight: 38, width: 170 }}
                                />
                              </label>
                              {edIci.mode !== "AFFECTER" && (
                                <label style={{ ...etiquette, flex: "1 1 260px" }}>
                                  {edIci.mode === "PREVOIR" ? "Consigne (facultatif)" : "Réponse du client (facultatif)"}
                                  <input
                                    type="text"
                                    value={edIci.commentaire}
                                    maxLength={edIci.mode === "PREVOIR" ? 500 : 1000}
                                    placeholder={edIci.mode === "PREVOIR" ? "ex. appeler M. X, demander la décision du comité" : "ex. budget validé en janvier, rappeler le 15/01"}
                                    onChange={(e) => setEd({ ...edIci, commentaire: e.target.value })}
                                    style={{ ...page.entrees, minHeight: 38 }}
                                  />
                                </label>
                              )}
                              <button type="button" onClick={() => void enregistrer(d)} disabled={enregistrement} style={{ ...page.btnPrimaire, minHeight: 38 }}>
                                {enregistrement ? "Enregistrement…" : "Enregistrer"}
                              </button>
                              <button type="button" onClick={() => setEd(null)} style={{ ...page.btnSecondaire, minHeight: 38 }}>
                                Annuler
                              </button>
                              {edIci.mode === "PREVOIR" && d.prevue && peutSupprimer(d.prevue) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const r = d.prevue;
                                    setEd(null);
                                    if (r) void supprimer(r);
                                  }}
                                  style={{ ...page.btnSecondaire, minHeight: 38 }}
                                >
                                  Supprimer la relance prévue
                                </button>
                              )}
                            </div>
                            <div style={{ ...petit, marginTop: 6 }}>
                              {edIci.mode === "AFFECTER"
                                ? "Le devis est au planning et dans la feuille de route du rédacteur jusqu’à son envoi. Un changement de date est gardé dans l’historique des délais."
                                : edIci.mode === "PREVOIR"
                                  ? "La relance apparaît dans la feuille de route de la personne choisie, jusqu’à ce qu’elle soit notée « faite »."
                                  : `La relance prévue (s’il y en a une) est close. Le devis sort de « À relancer » pendant ${DELAI_RELANCE} jours ; il y revient s’il n’a toujours pas de réponse.`}
                            </div>
                            {erreurEd && (
                              <div role="alert" style={{ color: "#b3261e", fontWeight: 700, marginTop: 8 }}>
                                {erreurEd}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {/* RELANCES_HISTORIQUE : toutes les relances du devis, prévues et faites, la plus récente d'abord */}
                      {ouvert && (d.faites.length > 0 || d.prevue) && (
                        <tr>
                          <td colSpan={nbColonnes} style={{ ...page.td, background: "#fafbfc", padding: "8px 16px 12px 24px" }}>
                            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris, marginBottom: 6 }}>Historique des relances · DBE{d.numero}</div>
                            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                              {(d.prevue ? [d.prevue, ...d.faites] : d.faites).map((r) => {
                                const faite = Boolean(r.relance_le);
                                return (
                                  <li key={r.id} style={{ fontSize: 14, borderLeft: `3px solid ${faite ? "#1b5e20" : "#1f4e8c"}`, paddingLeft: 10 }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                                      {faite ? (
                                        <strong style={{ color: "#1b5e20" }}>
                                          ✓ Relancé le {formatDate(r.relance_le)} par {nomDe(r.faite_par ?? r.responsable_id ?? r.saisi_par)}
                                        </strong>
                                      ) : (
                                        <strong style={{ color: r.prevue_le && r.prevue_le < aujourdhui ? "#b3261e" : "#1f4e8c" }}>
                                          📅 À faire le {formatDate(r.prevue_le)} par {nomDe(r.responsable_id)}
                                          {r.prevue_le && r.prevue_le < aujourdhui ? " · en retard" : ""}
                                        </strong>
                                      )}
                                      {r.prevue_le && (
                                        <span style={{ color: C.gris, fontSize: 12.5 }}>
                                          {faite ? `prévue le ${formatDate(r.prevue_le)} pour ${nomDe(r.responsable_id)}, ` : ""}demandée par {nomDe(r.saisi_par)} le {formatDate(r.cree_le.slice(0, 10))}
                                        </span>
                                      )}
                                      {peutSupprimer(r) && (
                                        <button type="button" onClick={() => void supprimer(r)} style={{ all: "unset", cursor: "pointer", fontSize: 12, color: C.rougeTexte, fontWeight: 700 }}>
                                          supprimer
                                        </button>
                                      )}
                                    </div>
                                    {r.commentaire && (
                                      <div style={{ fontSize: 13, color: "#3b4046" }}>
                                        <span style={{ color: C.gris }}>{r.prevue_le ? "Consigne" : "Note"} :</span> {r.commentaire}
                                      </div>
                                    )}
                                    {r.reponse && (
                                      <div style={{ fontSize: 13.5, color: "#1f2328", fontWeight: 600 }}>
                                        <span style={{ color: C.gris, fontWeight: 400 }}>Réponse du client :</span> {r.reponse}
                                      </div>
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
            <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment la page est-elle construite ?</summary>
            <ul style={{ lineHeight: 1.6 }}>
              <li>
                Un devis = un n° DBE du Suivi d’affaire BE (synchronisé{derniereSynchro ? ` le ${formatDate(derniereSynchro)}` : ""}), avec le statut du classeur.
                Un devis d’<strong>avenant</strong> est un devis comme un autre ; il porte la mention « avenant de CBE… ». Les intentions de commande sont suivies
                dans le Suivi des affaires.
              </li>
              <li>
                <strong>Ouverts</strong> : « Devis ouvert », à rédiger. Rédacteur et date de rendu : ceux du DBE au Pilotage, à défaut ceux du classeur.
              </li>
              <li>
                <strong>Envoyés</strong> : « Devis envoyé », en attente de réponse. <strong>À relancer</strong> : ceux qui ont une relance prévue, et ceux envoyés
                (ou relancés) il y a plus de {DELAI_RELANCE} jours sans relance prévue. Une relance notée « faite » les sort de la liste pour {DELAI_RELANCE} jours.
              </li>
              <li>
                <strong>Remportés</strong> : « Commande reçue », « Livrée » ou « Commande annulée ». <strong>Perdus</strong> : « Devis perdu » après envoi.{" "}
                <strong>Annulés</strong> : « Devis perdu » sans date d’envoi, hors taux de transformation. Ces trois chiffres portent sur les devis ouverts pendant
                l’exercice choisi, comme l’onglet Statistiques. La recherche retrouve aussi ces devis.
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
