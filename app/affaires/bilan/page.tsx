"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { BadgeType, C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";

/* ===============================================================
   BILAN AFFAIRE

   Pour une affaire (CBE ou DBE) :
   - CHIFFRÉ : heures du Suivi d'affaire BE (Excel), commande de base +
     avenants retenus, réparties par activité (correspondance Méca → …).
     À défaut de ligne Excel : les besoins saisis dans le Pilotage BE.
   - RÉALISÉ : feuilles d'heures saisies dans l'application + historique
     importé (fonction SQL bilan_affaire_imputations, sans double compte).
   - Comparaison par activité, ligne par ligne (base, avenants, lots,
     échéances), par personne et mois par mois.

   Le détail nominatif n'est donné qu'aux ADMIN / RESPONSABLE (chacun voit
   ses propres heures). Aucun montant sur cette page.
================================================================ */

type TypeAffaire = "CBE" | "DBE";

type Imputation = {
  source: "FEUILLE" | "HISTORIQUE";
  annee: number;
  semaine: number;
  jour: string | null;
  collaborateur_id: string | null;
  trigramme: string | null;
  numero_complet: string;
  code: string;
  activite_id: string | null;
  heures: number;
};

type LigneExcel = {
  cle: string;
  genre: "DEVIS" | "BASE" | "AVENANT" | "LOT" | "ECHEANCE";
  numero_affaire: string | null;
  numero_devis: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_id: string | null;
  redacteur: string | null;
  date_ouverture: string | null;
  date_reception_commande: string | null;
  delai: string | null;
  date_livraison_estimee: string | null;
  date_livraison: string | null;
  heures_meca: number;
  heures_calcul: number;
  heures_elec: number;
  heures_pneu: number;
  heures_scan: number;
  heures_autre: number;
  heures_total: number;
  disparue: boolean;
};

type AffairePilotage = {
  id: string;
  statut: string;
  echeance: string | null;
  responsable_id: string;
  au_planning: boolean | null;
};

const COLONNES_EXCEL: { colonne: string; champ: keyof LigneExcel }[] = [
  { colonne: "Méca", champ: "heures_meca" },
  { colonne: "Calcul", champ: "heures_calcul" },
  { colonne: "Elec", champ: "heures_elec" },
  { colonne: "Pneu", champ: "heures_pneu" },
  { colonne: "Scan", champ: "heures_scan" },
  { colonne: "Autre", champ: "heures_autre" },
];

const INACTIFS = ["Devis perdu", "Commande annulée"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const SANS_ACTIVITE = "__sans__";

/* Lundi de la semaine ISO (année ISO, n° de semaine) */
function lundiIso(annee: number, semaine: number): string {
  const simple = new Date(Date.UTC(annee, 0, 4));
  const jour = simple.getUTCDay() || 7;
  simple.setUTCDate(simple.getUTCDate() - jour + 1 + (semaine - 1) * 7);
  return simple.toISOString().slice(0, 10);
}

/* Suffixe d'une imputation : « R2 », « LOT1 », « ECH1 », « R1ECH2 »… ou "" pour la commande de base */
function suffixe(numeroComplet: string): string {
  const m = numeroComplet.replace(/\s/g, "").match(/^(?:CBE|DBE|CAS)?[-:]?\d+(.*)$/i);
  return (m?.[1] ?? "").toUpperCase();
}

function lireAffaireDansUrl(): { type: TypeAffaire; numero: string } | null {
  const brut = new URLSearchParams(window.location.search).get("affaire");
  if (!brut) return null;
  const m = brut.toUpperCase().replace(/\s/g, "").match(/^(CBE|DBE)?(\d+)/);
  if (!m) return null;
  return { type: (m[1] as TypeAffaire) || "CBE", numero: m[2] };
}

function Barre({ part, depasse }: { part: number; depasse: boolean }) {
  return (
    <span style={{ display: "inline-block", width: 120, height: 10, background: "#eef0f3", borderRadius: 5, position: "relative", verticalAlign: "middle" }}>
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.min(100, Math.max(0, part * 100))}%`,
          background: depasse ? "#b3261e" : part >= 0.85 ? "#c76500" : "#2e7d32",
          borderRadius: 5,
        }}
      />
    </span>
  );
}

function BilanContenu() {
  const [type, setType] = useState<TypeAffaire>("CBE");
  const [saisie, setSaisie] = useState("");
  const [affaire, setAffaire] = useState<{ type: TypeAffaire; numero: string } | null>(null);

  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState("");
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [lignesExcel, setLignesExcel] = useState<LigneExcel[]>([]);
  const [client, setClient] = useState<string | null>(null);
  const [pilotage, setPilotage] = useState<AffairePilotage | null>(null);
  const [chiffrePilotage, setChiffrePilotage] = useState<{ activite_id: string; heures: number }[]>([]);
  const [activites, setActivites] = useState<Map<string, { nom: string; ordre: number }>>(new Map());
  const [correspondance, setCorrespondance] = useState<Map<string, string>>(new Map());
  const [noms, setNoms] = useState<Map<string, string>>(new Map());
  const [suggestions, setSuggestions] = useState<{ cle: string; libelle: string }[]>([]);
  const [voirDetail, setVoirDetail] = useState(false);
  const [filtrePersonne, setFiltrePersonne] = useState("");

  /* Référentiels + liste des affaires pour la saisie assistée */
  useEffect(() => {
    (async () => {
      const [act, cor, sug, col] = await Promise.all([
        supabase.from("activites").select("id,nom,ordre_affichage"),
        supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
        supabase.from("suivi_lignes").select("numero_affaire,designation").eq("genre", "BASE").order("numero_affaire", { ascending: false }).limit(1000),
        supabase.from("collaborateurs").select("id,prenom,nom"),
      ]);
      setActivites(
        new Map(((act.data ?? []) as { id: string; nom: string; ordre_affichage: number }[]).map((a) => [a.id, { nom: a.nom, ordre: a.ordre_affichage }]))
      );
      setCorrespondance(
        new Map(
          ((cor.data ?? []) as { colonne_excel: string; activite_id: string | null }[])
            .filter((c) => c.activite_id)
            .map((c) => [c.colonne_excel, c.activite_id as string])
        )
      );
      setSuggestions(
        ((sug.data ?? []) as { numero_affaire: string | null; designation: string | null }[])
          .filter((s) => s.numero_affaire)
          .map((s) => ({ cle: s.numero_affaire as string, libelle: s.designation ?? "" }))
      );
      setNoms(
        new Map(((col.data ?? []) as { id: string; prenom: string | null; nom: string | null }[]).map((c) => [c.id, `${c.prenom ?? ""} ${c.nom ?? ""}`.trim()]))
      );
    })();

    const depuisUrl = lireAffaireDansUrl();
    if (depuisUrl) {
      setType(depuisUrl.type);
      setSaisie(depuisUrl.numero);
      setAffaire(depuisUrl);
    }
  }, []);

  /* Chargement d'une affaire */
  const charger = useCallback(async (cible: { type: TypeAffaire; numero: string }) => {
    setChargement(true);
    setErreur("");
    setFiltrePersonne("");

    try {
      const num = cible.numero.replace(/^0+/, "");

      const [imp, excel, pil] = await Promise.all([
        supabase.rpc("bilan_affaire_imputations", { p_type: cible.type, p_numero: num }),
        supabase
          .from("suivi_lignes")
          .select(
            "cle,genre,numero_affaire,numero_devis,statut,imputation,designation,client_id,redacteur,date_ouverture,date_reception_commande,delai,date_livraison_estimee,date_livraison,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre,heures_total,disparue"
          )
          .eq(cible.type === "CBE" ? "base_affaire" : "base_devis", num),
        supabase.from("pilotage_affaires").select("id,statut,echeance,responsable_id,au_planning,numero").eq("type", cible.type),
      ]);

      if (imp.error) throw new Error(imp.error.message);

      setImputations(
        ((imp.data ?? []) as Imputation[]).map((r) => ({ ...r, heures: Number(r.heures) || 0 }))
      );

      const lignes = ((excel.data ?? []) as LigneExcel[])
        .filter((l) => (cible.type === "CBE" ? true : l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT"))
        .map((l) => ({
          ...l,
          heures_meca: Number(l.heures_meca) || 0,
          heures_calcul: Number(l.heures_calcul) || 0,
          heures_elec: Number(l.heures_elec) || 0,
          heures_pneu: Number(l.heures_pneu) || 0,
          heures_scan: Number(l.heures_scan) || 0,
          heures_autre: Number(l.heures_autre) || 0,
          heures_total: Number(l.heures_total) || 0,
        }));
      const ordre = { BASE: 0, DEVIS: 0, AVENANT: 1, LOT: 2, ECHEANCE: 3 } as const;
      lignes.sort((a, b) => ordre[a.genre] - ordre[b.genre] || a.cle.localeCompare(b.cle, "fr", { numeric: true }));
      setLignesExcel(lignes);

      // Client (nom abrégé)
      const base = lignes.find((l) => l.genre === "BASE") ?? lignes[0];
      if (base?.client_id) {
        const { data } = await supabase.from("suivi_clients").select("nom_abrege").eq("id", base.client_id).maybeSingle();
        setClient((data as { nom_abrege: string } | null)?.nom_abrege ?? null);
      } else {
        setClient(null);
      }

      // Affaire du Pilotage (visible des ADMIN / RESPONSABLE seulement)
      const p = ((pil.data ?? []) as (AffairePilotage & { numero: string })[]).find((a) => a.numero.replace(/^0+/, "") === num) ?? null;
      setPilotage(p);

      if (p) {
        const { data } = await supabase.from("pilotage_charges").select("activite_id,heures").eq("affaire_id", p.id);
        setChiffrePilotage(((data ?? []) as { activite_id: string; heures: number }[]).map((c) => ({ ...c, heures: Number(c.heures) || 0 })));
      } else {
        setChiffrePilotage([]);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Impossible de charger le bilan.");
      setImputations([]);
      setLignesExcel([]);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (affaire) void charger(affaire);
  }, [affaire, charger]);

  function rechercher(e: FormEvent) {
    e.preventDefault();
    const m = saisie.toUpperCase().replace(/\s/g, "").match(/^(CBE|DBE)?(\d+)/);
    if (!m) {
      setErreur("Saisissez un numéro d’affaire, par exemple 1533 ou CBE1533.");
      return;
    }
    const cible = { type: ((m[1] as TypeAffaire) || type) as TypeAffaire, numero: m[2] };
    setType(cible.type);
    setAffaire(cible);
    window.history.replaceState(null, "", `?affaire=${cible.type}${cible.numero}`);
  }

  /* ------------------------------ calculs ------------------------------ */

  const nomActivite = useCallback(
    (id: string) => (id === SANS_ACTIVITE ? "Sans activité (code non rattaché)" : activites.get(id)?.nom ?? "Activité"),
    [activites]
  );

  const comptees = useMemo(
    () => lignesExcel.filter((l) => !l.disparue && (l.genre === "BASE" || l.genre === "AVENANT") && !INACTIFS.includes(l.statut ?? "")),
    [lignesExcel]
  );

  const bilan = useMemo(() => {
    // Chiffré par activité : Excel en priorité, sinon les besoins du Pilotage
    const chiffre = new Map<string, number>();
    let chiffreNonRattache = 0;
    const sourceChiffre: "EXCEL" | "PILOTAGE" | "AUCUN" = comptees.length > 0 ? "EXCEL" : chiffrePilotage.length > 0 ? "PILOTAGE" : "AUCUN";

    if (sourceChiffre === "EXCEL") {
      for (const l of comptees) {
        for (const { colonne, champ } of COLONNES_EXCEL) {
          const h = Number(l[champ]) || 0;
          if (h === 0) continue;
          const act = correspondance.get(colonne);
          if (act) chiffre.set(act, (chiffre.get(act) ?? 0) + h);
          else chiffreNonRattache += h;
        }
        // heures sans ventilation par discipline
        const detail = COLONNES_EXCEL.reduce((t, { champ }) => t + (Number(l[champ]) || 0), 0);
        if (l.heures_total > detail + 0.01) chiffreNonRattache += l.heures_total - detail;
      }
    } else if (sourceChiffre === "PILOTAGE") {
      for (const c of chiffrePilotage) chiffre.set(c.activite_id, (chiffre.get(c.activite_id) ?? 0) + c.heures);
    }

    // Réalisé par activité
    const realise = new Map<string, number>();
    for (const i of imputations) {
      const k = i.activite_id ?? SANS_ACTIVITE;
      realise.set(k, (realise.get(k) ?? 0) + i.heures);
    }

    const ids = new Set([...chiffre.keys(), ...realise.keys()]);
    const parActivite = [...ids]
      .map((id) => ({ id, nom: nomActivite(id), ordre: activites.get(id)?.ordre ?? 999, chiffre: chiffre.get(id) ?? 0, realise: realise.get(id) ?? 0 }))
      .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, "fr"));

    const totalChiffre = [...chiffre.values()].reduce((t, v) => t + v, 0) + chiffreNonRattache;
    const totalRealise = imputations.reduce((t, i) => t + i.heures, 0);

    // Codes non rattachés à une activité
    const codesSans = [...new Set(imputations.filter((i) => !i.activite_id).map((i) => i.code))].sort();

    // Par personne
    const parPersonne = new Map<string, { nom: string; heures: number; premiere: string; derniere: string; parActivite: Map<string, number> }>();
    for (const i of imputations) {
      const cle = i.collaborateur_id ?? "__autres__";
      const date = i.jour ?? lundiIso(i.annee, i.semaine);
      const p = parPersonne.get(cle) ?? {
        nom: i.collaborateur_id ? i.trigramme ?? noms.get(i.collaborateur_id) ?? "?" : "Autres collaborateurs",
        heures: 0,
        premiere: date,
        derniere: date,
        parActivite: new Map(),
      };
      p.heures += i.heures;
      if (date < p.premiere) p.premiere = date;
      if (date > p.derniere) p.derniere = date;
      const a = i.activite_id ?? SANS_ACTIVITE;
      p.parActivite.set(a, (p.parActivite.get(a) ?? 0) + i.heures);
      parPersonne.set(cle, p);
    }

    // Par mois
    const parMois = new Map<string, number>();
    for (const i of imputations) {
      const date = i.jour ?? lundiIso(i.annee, i.semaine);
      const m = date.slice(0, 7);
      parMois.set(m, (parMois.get(m) ?? 0) + i.heures);
    }
    const mois = [...parMois.entries()].sort(([a], [b]) => a.localeCompare(b));
    let cumul = 0;
    const evolution = mois.map(([m, h]) => {
      cumul += h;
      return { mois: m, heures: h, cumul };
    });

    // Réalisé imputé directement sur une ligne (base = sans suffixe, R1, LOT1…)
    const parSuffixe = new Map<string, number>();
    for (const i of imputations) {
      const s = suffixe(i.numero_complet);
      parSuffixe.set(s, (parSuffixe.get(s) ?? 0) + i.heures);
    }

    return {
      sourceChiffre,
      parActivite,
      chiffreNonRattache,
      totalChiffre,
      totalRealise,
      codesSans,
      parPersonne: [...parPersonne.entries()].map(([cle, p]) => ({ cle, ...p })).sort((a, b) => b.heures - a.heures),
      evolution,
      parSuffixe,
      sources: {
        feuilles: imputations.filter((i) => i.source === "FEUILLE").reduce((t, i) => t + i.heures, 0),
        historique: imputations.filter((i) => i.source === "HISTORIQUE").reduce((t, i) => t + i.heures, 0),
      },
    };
  }, [comptees, chiffrePilotage, correspondance, imputations, activites, nomActivite, noms]);

  const detail = useMemo(() => {
    // Détail semaine par semaine, regroupé par personne / semaine / code
    const m = new Map<string, { semaine: string; personne: string; cle: string; numero: string; code: string; activite: string; heures: number; source: string }>();
    for (const i of imputations) {
      const personne = i.collaborateur_id ? i.trigramme ?? "?" : "Autres";
      if (filtrePersonne && (i.collaborateur_id ?? "__autres__") !== filtrePersonne) continue;
      const lundi = i.jour ? i.jour : lundiIso(i.annee, i.semaine);
      const semaine = `${i.annee}-S${String(i.semaine).padStart(2, "0")}`;
      const k = `${semaine}|${personne}|${i.numero_complet}|${i.code}`;
      const e = m.get(k) ?? {
        semaine,
        personne,
        cle: lundi,
        numero: i.numero_complet,
        code: i.code,
        activite: nomActivite(i.activite_id ?? SANS_ACTIVITE),
        heures: 0,
        source: i.source === "FEUILLE" ? "Feuille" : "Historique",
      };
      e.heures += i.heures;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.semaine.localeCompare(a.semaine) || a.personne.localeCompare(b.personne));
  }, [imputations, filtrePersonne, nomActivite]);

  /* ------------------------------ rendu ------------------------------ */

  const base = lignesExcel.find((l) => l.genre === "BASE") ?? lignesExcel[0] ?? null;
  const ecart = bilan.totalChiffre - bilan.totalRealise;
  const part = bilan.totalChiffre > 0 ? bilan.totalRealise / bilan.totalChiffre : 0;
  const echeance = (() => {
    const dates = comptees.map((l) => l.delai ?? l.date_livraison_estimee).filter((d): d is string => Boolean(d)).sort();
    return pilotage?.echeance ?? dates[dates.length - 1] ?? null;
  })();
  const livree = comptees.length > 0 && comptees.every((l) => l.statut === "Livrée");
  const dateLivraison = livree ? comptees.map((l) => l.date_livraison).filter(Boolean).sort().slice(-1)[0] ?? null : null;
  const maxMois = Math.max(1, ...bilan.evolution.map((m) => m.heures));

  const th: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "10px 8px" };
  const thN: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { ...page.td, padding: "9px 8px" };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  const libelleGenre = (l: LigneExcel) =>
    l.genre === "BASE" ? "Commande" : l.genre === "AVENANT" ? "Avenant" : l.genre === "LOT" ? "Lot (découpage)" : l.genre === "ECHEANCE" ? "Échéance (découpage)" : "Devis";

  return (
    <main style={page.fond}>
      <EnTetePage section="Bilan affaire" />

      <div style={{ ...page.contenu, maxWidth: 1200 }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={page.titre}>Bilan affaire</h1>
          <p style={page.sousTitre}>
            Heures chiffrées (Suivi d’affaire BE, commande et avenants) comparées aux heures réalisées (feuilles d’heures et
            historique), par activité, par ligne de commande, par personne et mois par mois.
          </p>
        </div>

        <form onSubmit={rechercher} style={{ ...page.carte, padding: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
          {(["CBE", "DBE"] as TypeAffaire[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              style={{
                minHeight: 44,
                padding: "0 16px",
                borderRadius: 8,
                border: `1.5px solid ${type === t ? C.rouge : "#c9cdd2"}`,
                background: type === t ? C.rouge : "#ffffff",
                color: type === t ? "#ffffff" : "#3b4046",
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t}
            </button>
          ))}
          <input
            list="bilan-affaires"
            aria-label="Numéro d’affaire"
            placeholder="N° d’affaire, ex. 1533"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            style={{ ...page.entrees, maxWidth: 260 }}
          />
          <datalist id="bilan-affaires">
            {suggestions.map((s) => (
              <option key={s.cle} value={s.cle}>
                {s.libelle}
              </option>
            ))}
          </datalist>
          <button type="submit" style={page.btnPrimaire} disabled={chargement}>
            {chargement ? "Chargement…" : "Afficher le bilan"}
          </button>
        </form>

        {erreur && <Message genre="erreur">{erreur}</Message>}

        {affaire && !chargement && !erreur && (
          <>
            {/* ---------- en-tête de l'affaire ---------- */}
            <section style={{ ...page.carte, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <BadgeType type={affaire.type} />
                <span style={{ fontSize: 24, fontWeight: 800, color: C.rougeFonce }}>{affaire.numero}</span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{base?.designation ?? ""}</span>
                {livree ? <Pastille genre="info">Livrée{dateLivraison ? ` le ${formatDate(dateLivraison)}` : ""}</Pastille> : base?.statut ? <Pastille genre="info">{base.statut}</Pastille> : null}
                {pilotage && (
                  <Link href={`/pilotage/affaire/${pilotage.id}`} style={{ marginLeft: "auto", fontWeight: 700, color: C.rougeFonce }}>
                    Fiche dans le Pilotage →
                  </Link>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", marginTop: 10, fontSize: 14, color: "#3b4046" }}>
                {client && <span>Client : <strong>{client}</strong></span>}
                {base?.imputation && <span>Imputation : <strong>{base.imputation}</strong></span>}
                {pilotage?.responsable_id && <span>Responsable : <strong>{noms.get(pilotage.responsable_id) ?? "—"}</strong></span>}
                {base?.redacteur && <span>Devis rédigé par : <strong>{base.redacteur}</strong></span>}
                {base?.date_reception_commande && <span>Commande reçue le <strong>{formatDate(base.date_reception_commande)}</strong></span>}
                {echeance && <span>Échéance : <strong>{formatDate(echeance)}</strong></span>}
              </div>
            </section>

            {lignesExcel.length === 0 && bilan.sourceChiffre === "AUCUN" && (
              <Message genre="info">
                Cette affaire n’est pas dans le Suivi d’affaire BE (antérieure au 01/11/2024, ou numéro inconnu) : pas d’heures
                chiffrées, seul le réalisé est affiché.
              </Message>
            )}
            {bilan.sourceChiffre === "PILOTAGE" && <Message genre="info">Chiffré tiré des besoins saisis dans le Pilotage BE (pas de ligne dans le Suivi d’affaire).</Message>}
            {affaire.type === "DBE" && (
              <Message genre="info">Un DBE n’a pas d’heures chiffrées à produire : on mesure ici le temps passé à préparer le devis.</Message>
            )}

            {/* ---------- tuiles ---------- */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
              <Tuile
                libelle="Chiffré"
                valeur={bilan.totalChiffre > 0 ? formatHeures(bilan.totalChiffre) : "—"}
                sous={bilan.sourceChiffre === "EXCEL" ? `${comptees.length} ligne${comptees.length > 1 ? "s" : ""} (commande + avenants retenus)` : bilan.sourceChiffre === "PILOTAGE" ? "besoins du Pilotage" : "aucun chiffré"}
              />
              <Tuile
                libelle="Réalisé"
                valeur={formatHeures(bilan.totalRealise)}
                sous={`${formatHeures(bilan.sources.feuilles)} saisies · ${formatHeures(bilan.sources.historique)} historique`}
              />
              <Tuile
                libelle={ecart >= 0 ? "Reste" : "Dépassement"}
                valeur={bilan.totalChiffre > 0 ? formatHeures(Math.abs(ecart)) : "—"}
                sous={bilan.totalChiffre > 0 ? `${Math.round(part * 100)} % du chiffré consommé` : ""}
                accent={ecart < 0 && bilan.totalChiffre > 0}
              />
              <Tuile libelle="Personnes" valeur={String(bilan.parPersonne.filter((p) => p.cle !== "__autres__").length || bilan.parPersonne.length)} sous="ont imputé sur l’affaire" />
            </div>

            {/* ---------- par activité ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Par activité</h2>
              {bilan.parActivite.length === 0 && bilan.chiffreNonRattache === 0 ? (
                <p style={{ color: C.gris, margin: 0 }}>Aucune heure chiffrée ni réalisée.</p>
              ) : (
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={th}>Activité</th>
                      <th style={thN}>Chiffré</th>
                      <th style={thN}>Réalisé</th>
                      <th style={thN}>Écart</th>
                      <th style={th}>Consommé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bilan.parActivite.map((a) => {
                      const e = a.chiffre - a.realise;
                      const p = a.chiffre > 0 ? a.realise / a.chiffre : 0;
                      return (
                        <tr key={a.id}>
                          <td style={td}>
                            <strong>{a.nom}</strong>
                          </td>
                          <td style={tdN}>{a.chiffre > 0 ? formatHeures(a.chiffre) : "—"}</td>
                          <td style={tdN}>{a.realise > 0 ? formatHeures(a.realise) : "—"}</td>
                          <td style={{ ...tdN, color: e < -0.01 ? C.rougeTexte : undefined, fontWeight: e < -0.01 ? 800 : 400 }}>
                            {a.chiffre > 0 ? (e < 0 ? `+${formatHeures(-e)} dépassé` : `${formatHeures(e)} restant`) : a.realise > 0 ? "non chiffré" : "—"}
                          </td>
                          <td style={td}>
                            {a.chiffre > 0 ? (
                              <>
                                <Barre part={p} depasse={e < -0.01} /> <span style={{ fontSize: 12, color: C.gris }}>{Math.round(p * 100)} %</span>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {bilan.chiffreNonRattache > 0.01 && (
                      <tr>
                        <td style={td}>
                          <strong>Chiffré non rattaché</strong>
                          <div style={{ fontSize: 12, color: C.gris }}>colonne Excel sans activité (ex. « Autre ») ou heures non ventilées</div>
                        </td>
                        <td style={tdN}>{formatHeures(bilan.chiffreNonRattache)}</td>
                        <td style={tdN}>—</td>
                        <td style={tdN}>—</td>
                        <td style={td} />
                      </tr>
                    )}
                    <tr>
                      <td style={{ ...td, fontWeight: 800 }}>Total</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{bilan.totalChiffre > 0 ? formatHeures(bilan.totalChiffre) : "—"}</td>
                      <td style={{ ...tdN, fontWeight: 800 }}>{formatHeures(bilan.totalRealise)}</td>
                      <td style={{ ...tdN, fontWeight: 800, color: ecart < -0.01 && bilan.totalChiffre > 0 ? C.rougeTexte : undefined }}>
                        {bilan.totalChiffre > 0 ? (ecart < 0 ? `+${formatHeures(-ecart)} dépassé` : `${formatHeures(ecart)} restant`) : "—"}
                      </td>
                      <td style={td}>{bilan.totalChiffre > 0 && <Barre part={part} depasse={ecart < -0.01} />}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {bilan.codesSans.length > 0 && (
                <p style={{ fontSize: 13, color: C.orangeTexte, margin: "10px 0 0" }}>
                  Codes saisis sans activité : <strong>{bilan.codesSans.join(", ")}</strong>. Rattachez-les à une activité dans « Gestion des
                  activités » pour qu’ils se comparent au chiffré.
                </p>
              )}
            </section>

            {/* ---------- commande, avenants, découpages ---------- */}
            {lignesExcel.length > 0 && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
                <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Commande, avenants et découpages</h2>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={th}>N°</th>
                      <th style={th}>Nature</th>
                      <th style={th}>Statut</th>
                      <th style={th}>Commande</th>
                      <th style={th}>Délai</th>
                      <th style={thN}>Chiffré</th>
                      <th style={thN}>Imputé sur ce n°</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesExcel.map((l) => {
                      const compte = comptees.includes(l);
                      const s = l.numero_affaire ? suffixe(l.numero_affaire) : "";
                      const impute = l.genre === "DEVIS" ? 0 : bilan.parSuffixe.get(s) ?? 0;
                      return (
                        <tr key={l.cle} style={{ opacity: l.disparue ? 0.5 : 1 }}>
                          <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>{l.numero_affaire ?? l.numero_devis ?? l.cle}</td>
                          <td style={td}>{libelleGenre(l)}</td>
                          <td style={td}>
                            {l.statut ?? "—"}
                            {!compte && (l.genre === "BASE" || l.genre === "AVENANT") && <div style={{ fontSize: 12, color: C.gris }}>non retenu dans le chiffré</div>}
                            {l.disparue && <div style={{ fontSize: 12, color: C.gris }}>retirée du classeur</div>}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(l.date_reception_commande)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(l.delai ?? l.date_livraison_estimee)}</td>
                          <td style={tdN}>{l.genre === "LOT" || l.genre === "ECHEANCE" ? "découpage" : formatHeures(l.heures_total)}</td>
                          <td style={tdN}>{impute > 0 ? formatHeures(impute) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={{ fontSize: 12, color: C.gris, margin: "10px 0 0" }}>
                  « Imputé sur ce n° » : heures saisies avec ce numéro exact (CBE{affaire.numero}R2…). La plupart des heures sont
                  saisies sur le numéro de base : elles sont toutes comptées dans le réalisé de l’affaire.
                </p>
              </section>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
              {/* ---------- par personne ---------- */}
              <section style={{ ...page.carte, padding: 16, flex: "1 1 420px", minWidth: 0 }}>
                <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Par personne</h2>
                {bilan.parPersonne.length === 0 ? (
                  <p style={{ color: C.gris, margin: 0 }}>Aucune heure réalisée.</p>
                ) : (
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={th}>Personne</th>
                        <th style={thN}>Heures</th>
                        <th style={th}>Activités</th>
                        <th style={th}>Période</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bilan.parPersonne.map((p) => (
                        <tr key={p.cle}>
                          <td style={{ ...td, fontWeight: 800 }}>{p.nom}</td>
                          <td style={tdN}>{formatHeures(p.heures)}</td>
                          <td style={{ ...td, fontSize: 12.5 }}>
                            {[...p.parActivite.entries()]
                              .sort((a, b) => b[1] - a[1])
                              .map(([a, h]) => `${nomActivite(a).replace(" (code non rattaché)", "")} ${formatHeures(h)}`)
                              .join(" · ")}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12.5 }}>
                            {formatDate(p.premiere)} → {formatDate(p.derniere)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* ---------- mois par mois ---------- */}
              <section style={{ ...page.carte, padding: 16, flex: "1 1 420px", minWidth: 0 }}>
                <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Mois par mois</h2>
                {bilan.evolution.length === 0 ? (
                  <p style={{ color: C.gris, margin: 0 }}>Aucune heure réalisée.</p>
                ) : (
                  <div style={{ display: "grid", gap: 5 }}>
                    {bilan.evolution.map((m) => (
                      <div key={m.mois} style={{ display: "grid", gridTemplateColumns: "72px 1fr 64px 120px", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <span>{`${MOIS[Number(m.mois.slice(5, 7)) - 1]} ${m.mois.slice(2, 4)}`}</span>
                        <span style={{ background: "#f1f2f4", height: 12, borderRadius: 4, position: "relative" }}>
                          <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(m.heures / maxMois) * 100}%`, background: C.rouge, borderRadius: 4 }} />
                        </span>
                        <strong style={{ textAlign: "right" }}>{formatHeures(m.heures)}</strong>
                        <span style={{ color: m.cumul > bilan.totalChiffre && bilan.totalChiffre > 0 ? C.rougeTexte : C.gris, fontSize: 12 }}>
                          cumul {formatHeures(m.cumul)}
                          {bilan.totalChiffre > 0 ? ` (${Math.round((m.cumul / bilan.totalChiffre) * 100)} %)` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* ---------- détail ---------- */}
            <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  aria-expanded={voirDetail}
                  onClick={() => setVoirDetail((v) => !v)}
                  style={{ all: "unset", cursor: "pointer", fontSize: 18, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40 }}
                >
                  <span aria-hidden="true">{voirDetail ? "▾" : "▸"}</span> Détail semaine par semaine
                </button>
                {voirDetail && bilan.parPersonne.length > 1 && (
                  <select aria-label="Filtrer par personne" value={filtrePersonne} onChange={(e) => setFiltrePersonne(e.target.value)} style={{ ...page.entrees, width: "auto" }}>
                    <option value="">Toutes les personnes</option>
                    {bilan.parPersonne.map((p) => (
                      <option key={p.cle} value={p.cle}>
                        {p.nom}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {voirDetail && (
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={th}>Semaine</th>
                      <th style={th}>Personne</th>
                      <th style={th}>N° saisi</th>
                      <th style={th}>Code</th>
                      <th style={th}>Activité</th>
                      <th style={thN}>Heures</th>
                      <th style={th}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.map((d, k) => (
                      <tr key={k}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {d.semaine} <span style={{ color: C.gris, fontSize: 12 }}>· {formatDate(d.cle)}</span>
                        </td>
                        <td style={{ ...td, fontWeight: 700 }}>{d.personne}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{d.numero}</td>
                        <td style={td}>{d.code}</td>
                        <td style={td}>{d.activite}</td>
                        <td style={tdN}>{formatHeures(d.heures)}</td>
                        <td style={{ ...td, color: C.gris }}>{d.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function BilanAffairePage() {
  return (
    <GardeAcces droit={null}>
      <BilanContenu />
    </GardeAcces>
  );
}
