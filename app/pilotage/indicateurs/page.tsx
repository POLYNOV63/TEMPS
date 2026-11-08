"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerRealise, chargerTout } from "@/lib/pilotageDonnees";
import { aujourdhuiISO, formatDate, formatHeures } from "@/lib/pilotageCalculs";
import {
  DISCIPLINES,
  carnetParAffaire,
  decalerAnnee,
  dateEmission,
  devisEmis,
  devisEnAttente,
  finDeMois,
  heuresParDiscipline,
  issueDevis,
  lignesEnCarnet,
  parMois,
  parMoisDepuis,
  prisesDeCommande,
  repartir,
  syntheseDevis,
  total,
  type Agregat,
  type Consomme,
  type Discipline,
  type LigneInd,
  type Part,
} from "@/lib/indicateurs";

/* ===============================================================
   PILOTAGE BE - INDICATEURS

   1. Activité commerciale : devis émis, taux de transformation, délai de
      réponse, prise de commande (comparés à la même période un an avant),
      répartitions par client, imputation et activité.
   2. Carnet de commandes : travail vendu pas encore livré, son évolution
      mois par mois, ses répartitions et la liste des affaires.

   Source : la copie du classeur « Suivi d'affaire BE » (synchronisation).
   Montants : visibles des ADMIN et RESPONSABLE seulement (droits SQL).
   Export Excel et impression / PDF pour le directeur opérationnel.
================================================================ */

type Preset = "EXERCICE" | "ANNEE" | "DOUZE_MOIS" | "ANNEE_DERNIERE" | "TRIMESTRE" | "LIBRE";

/* Exercice POLYNOV : du 1er novembre au 31 octobre */
const debutExercice = (jour: string) => {
  const a = Number(jour.slice(0, 4));
  return Number(jour.slice(5, 7)) >= 11 ? `${a}-11-01` : `${a - 1}-11-01`;
};

const NOMS_DISCIPLINES: Record<Discipline, string> = {
  meca: "Méca",
  calcul: "Calcul",
  elec: "Elec",
  pneu: "Pneu",
  scan: "Scan",
  autre: "Autre",
};

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function euros(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function keuros(n: number): string {
  return Math.abs(n) >= 10000 ? `${Math.round(n / 1000).toLocaleString("fr-FR")} k€` : euros(n);
}

function pourcent(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)} %`;
}

function evolution(actuel: number, avant: number): string {
  if (avant <= 0) return actuel > 0 ? "nouveau" : "—";
  const v = Math.round(((actuel - avant) / avant) * 100);
  return `${v > 0 ? "+" : ""}${v} % vs N-1`;
}

function periodeDe(preset: Preset, aujourdhui: string): { debut: string; fin: string } {
  const a = Number(aujourdhui.slice(0, 4));
  const m = Number(aujourdhui.slice(5, 7));
  switch (preset) {
    case "EXERCICE":
      return { debut: debutExercice(aujourdhui), fin: aujourdhui };
    case "ANNEE":
      return { debut: `${a}-01-01`, fin: aujourdhui };
    case "DOUZE_MOIS": {
      const d = new Date(Date.UTC(a, m - 12, 1)).toISOString().slice(0, 10);
      return { debut: d, fin: aujourdhui };
    }
    case "ANNEE_DERNIERE":
      return { debut: `${a - 1}-01-01`, fin: `${a - 1}-12-31` };
    case "TRIMESTRE": {
      const t = Math.floor((m - 1) / 3) * 3 + 1;
      return { debut: `${a}-${String(t).padStart(2, "0")}-01`, fin: aujourdhui };
    }
    default:
      return { debut: `${a}-01-01`, fin: aujourdhui };
  }
}

/* ------------------------------ petits graphiques (sans bibliothèque) ------------------------------ */

function BarresMois({
  donnees,
  format,
  legendeA,
  legendeB,
}: {
  donnees: { label: string; a: number; b?: number }[];
  format: (n: number) => string;
  legendeA: string;
  legendeB?: string;
}) {
  const max = Math.max(1, ...donnees.map((d) => Math.max(d.a, d.b ?? 0)));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170, padding: "0 4px", borderBottom: `1px solid ${C.ligne}` }}>
        {donnees.map((d) => (
          <div key={d.label} style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, height: "100%", minWidth: 0 }}>
            {d.b !== undefined && (
              <div
                title={`${d.label} ${legendeB ?? ""} : ${format(d.b)}`}
                style={{ width: "40%", height: `${(d.b / max) * 100}%`, background: "#c9cdd2", borderRadius: "3px 3px 0 0", minHeight: d.b > 0 ? 2 : 0 }}
              />
            )}
            <div
              title={`${d.label} ${legendeA} : ${format(d.a)}`}
              style={{ width: d.b !== undefined ? "40%" : "60%", height: `${(d.a / max) * 100}%`, background: C.rouge, borderRadius: "3px 3px 0 0", minHeight: d.a > 0 ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "4px 4px 0" }}>
        {donnees.map((d) => (
          <div key={d.label} style={{ flex: 1, textAlign: "center", fontSize: 11, color: C.gris, minWidth: 0, overflow: "hidden" }}>
            {d.label}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#3b4046", marginTop: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: 12, height: 12, background: C.rouge, display: "inline-block" }} /> {legendeA}
        </span>
        {legendeB && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 12, height: 12, background: "#c9cdd2", display: "inline-block" }} /> {legendeB}
          </span>
        )}
      </div>
    </div>
  );
}

function BarresHorizontales({ parts, valeur, format, max = 10 }: { parts: { cle: string; v: number; detail?: string }[]; valeur?: string; format: (n: number) => string; max?: number }) {
  const liste = parts.filter((p) => p.v > 0).slice(0, max);
  const reste = parts.filter((p) => p.v > 0).slice(max);
  const lignes = reste.length > 0 ? [...liste, { cle: `Autres (${reste.length})`, v: reste.reduce((t, p) => t + p.v, 0) }] : liste;
  const plus = Math.max(1, ...lignes.map((p) => p.v));
  const somme = lignes.reduce((t, p) => t + p.v, 0);

  if (lignes.length === 0) return <p style={{ color: C.gris, fontSize: 14, margin: 0 }}>Rien sur cette période.</p>;

  return (
    <div style={{ display: "grid", gap: 6 }} aria-label={valeur}>
      {lignes.map((p) => (
        <div key={p.cle} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 32%) 1fr auto", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.cle}>
            {p.cle}
          </span>
          <span style={{ background: "#f1f2f4", borderRadius: 4, height: 14, position: "relative" }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(p.v / plus) * 100}%`, background: C.rouge, borderRadius: 4 }} />
          </span>
          <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
            {format(p.v)} <span style={{ color: C.gris, fontWeight: 400 }}>{somme > 0 ? `${Math.round((p.v / somme) * 100)} %` : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Carte({ titre, children, style }: { titre: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...page.carte, padding: 16, flex: "1 1 320px", minWidth: 0, breakInside: "avoid", ...style }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{titre}</h3>
      {children}
    </div>
  );
}

/* ------------------------------ page ------------------------------ */

type LigneBrute = {
  id: string;
  cle: string;
  parent_cle: string | null;
  genre: LigneInd["genre"];
  numero_devis: string | null;
  numero_affaire: string | null;
  base_affaire: string | null;
  statut: string | null;
  imputation: string | null;
  designation: string | null;
  client_id: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  date_livraison: string | null;
  delai: string | null;
  date_livraison_estimee: string | null;
  heures_meca: number | string;
  heures_calcul: number | string;
  heures_elec: number | string;
  heures_pneu: number | string;
  heures_scan: number | string;
  heures_autre: number | string;
  heures_total: number | string;
  disparue: boolean;
};

function IndicateursContenu() {
  const aujourdhui = aujourdhuiISO();
  const [preset, setPreset] = useState<Preset>("EXERCICE");
  /* EXERCICE_CHOISI : l'exercice analysé (du 1er novembre au 31 octobre, ou jusqu'à aujourd'hui pour l'exercice en cours) */
  const exerciceCourant = Number(debutExercice(aujourdhui).slice(0, 4));
  const [exerciceChoisi, setExerciceChoisi] = useState(exerciceCourant);
  const bornesExercice = (an: number) => {
    const finEx = `${an + 1}-10-31`;
    return { debut: `${an}-11-01`, fin: finEx < aujourdhui ? finEx : aujourdhui };
  };
  // Top 10 clients : imputation choisie ("" = toutes)
  const [imputationTop, setImputationTop] = useState("");
  // par défaut : l'exercice en cours, pour que tous les indicateurs suivent les mêmes critères que les Finances
  const [debut, setDebut] = useState(() => periodeDe("EXERCICE", aujourdhui).debut);
  const [fin, setFin] = useState(aujourdhui);

  const [lignes, setLignes] = useState<LigneInd[]>([]);
  const [montantsVisibles, setMontantsVisibles] = useState(false);
  const [realiseParAffaire, setRealiseParAffaire] = useState<Map<string, number>>(new Map());
  // réalisé cumulé par affaire et par mois (« AAAA-MM »), pour l'enveloppe des PE / PI à une date donnée
  const [realiseMensuel, setRealiseMensuel] = useState<Map<string, { mois: string; heures: number }[]>>(new Map());
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [voirCarnet, setVoirCarnet] = useState(false);
  /* COUT_DEVIS : heures pointées sur chaque devis (feuilles d'heures et historique), par n° de devis */
  const [heuresDevis, setHeuresDevis] = useState<Map<string, number>>(new Map());
  const [voirDevis, setVoirDevis] = useState(false);

  useEffect(() => {
    let actif = true;

    (async () => {
      try {
        const [brutes, montants, clients, realise, synchro, mensuel] = await Promise.all([
          chargerTout<LigneBrute>((a, b) =>
            supabase
              .from("suivi_lignes")
              .select(
                "id,cle,parent_cle,genre,numero_devis,numero_affaire,base_affaire,statut,imputation,designation,client_id,date_ouverture,date_envoi,date_reception_commande,date_livraison,delai,date_livraison_estimee,heures_meca,heures_calcul,heures_elec,heures_pneu,heures_scan,heures_autre,heures_total,disparue"
              )
              .order("cle")
              .range(a, b)
          ),
          chargerTout<{ ligne_id: string; montant: number | string; montant_echeances: number | string }>((a, b) =>
            supabase.from("suivi_lignes_montants").select("ligne_id,montant,montant_echeances").order("ligne_id").range(a, b)
          ),
          chargerTout<{ id: string; nom_abrege: string }>((a, b) => supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(a, b)),
          chargerRealise().catch(() => []),
          supabase.from("suivi_synchronisations").select("terminee_le").eq("statut", "APPLIQUEE").order("terminee_le", { ascending: false }).limit(1),
          // heures FACTURÉES des PE / PI, commande par commande : relevé + historique importé
          Promise.all([
            chargerTout<{ ligne_id: string; jour: string; heures: number | string | null }>((a, b) =>
              supabase.from("prestation_saisies").select("ligne_id,jour,heures").order("jour").range(a, b)
            ),
            supabase.from("prestation_lignes").select("id,affaire_id"),
            supabase.from("pilotage_affaires").select("id,numero").eq("type", "CBE"),
            chargerTout<{ type: string; numero: string; mois: string; heures: number | string }>((a, b) =>
              supabase.from("prestation_historique").select("type,numero,mois,heures").order("id").range(a, b)
            ),
          ]).catch(() => null),
        ]);

        if (!actif) return;

        const noms = new Map(clients.map((c) => [c.id, c.nom_abrege]));
        const parLigne = new Map(montants.map((m) => [m.ligne_id, Number(m.montant) || 0]));
        const echeances = new Map(montants.map((m) => [m.ligne_id, Number(m.montant_echeances) || 0]));
        const n = (v: number | string) => Number(v) || 0;

        setLignes(
          brutes.map((l) => ({
            id: l.id,
            cle: l.cle,
            genre: l.genre,
            numero_devis: l.numero_devis,
            numero_affaire: l.numero_affaire,
            base_affaire: l.base_affaire,
            statut: l.statut,
            imputation: l.imputation,
            designation: l.designation,
            client: l.client_id ? noms.get(l.client_id) ?? null : null,
            date_ouverture: l.date_ouverture,
            date_envoi: l.date_envoi,
            date_reception_commande: l.date_reception_commande,
            date_livraison: l.date_livraison,
            delai: l.delai,
            date_livraison_estimee: l.date_livraison_estimee,
            heures: {
              meca: n(l.heures_meca),
              calcul: n(l.heures_calcul),
              elec: n(l.heures_elec),
              pneu: n(l.heures_pneu),
              scan: n(l.heures_scan),
              autre: n(l.heures_autre),
            },
            heures_total: n(l.heures_total),
            montant: parLigne.get(l.id) ?? 0,
            disparue: l.disparue,
            parent_cle: l.parent_cle,
            montant_decoupage: (echeances.get(l.id) ?? 0) || (parLigne.get(l.id) ?? 0),
          }))
        );
        setMontantsVisibles(montants.length > 0);

        const rd = new Map<string, number>();
        for (const x of realise) {
          if (x.type_affaire !== "DBE") continue;
          const k = String(x.numero).replace(/^0+/, "");
          rd.set(k, (rd.get(k) ?? 0) + (Number(x.heures) || 0));
        }
        setHeuresDevis(rd);

        const r = new Map<string, number>();
        for (const x of realise) {
          if (x.type_affaire !== "CBE") continue;
          const k = String(x.numero).replace(/^0+/, "");
          r.set(k, (r.get(k) ?? 0) + (Number(x.heures) || 0));
        }
        setRealiseParAffaire(r);

        // heures facturées par commande (« 1604R2 ») et par mois
        const mm = new Map<string, { mois: string; heures: number }[]>();
        const ajouter = (numero: string, mois: string, heures: number) => {
          const k = numero.toUpperCase().replace(/^0+/, "");
          mm.set(k, [...(mm.get(k) ?? []), { mois, heures }]);
        };
        if (mensuel) {
          const [saisies, lp, pa, histo] = mensuel;
          const numeroAffaire = new Map(((pa.data ?? []) as { id: string; numero: string }[]).map((a) => [a.id, a.numero]));
          const numeroLigne = new Map(((lp.data ?? []) as { id: string; affaire_id: string }[]).map((l) => [l.id, numeroAffaire.get(l.affaire_id) ?? ""]));
          for (const s of saisies) {
            const n = numeroLigne.get(s.ligne_id);
            if (n && s.heures !== null) ajouter(n, String(s.jour).slice(0, 7), Number(s.heures) || 0);
          }
          // historique : seulement les mois que le relevé ne couvre pas (pas de double compte)
          const moisReleve = new Set(saisies.map((s) => String(s.jour).slice(0, 7)));
          for (const h of histo) {
            const mois = String(h.mois).slice(0, 7);
            if (!moisReleve.has(mois)) ajouter(String(h.numero), mois, Number(h.heures) || 0);
          }
        }
        setRealiseMensuel(mm);
        setDerniereSynchro(synchro.data?.[0]?.terminee_le ?? null);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger les indicateurs.");
      } finally {
        if (actif) setChargement(false);
      }
    })();

    return () => {
      actif = false;
    };
  }, []);

  function choisir(p: Preset) {
    setPreset(p);
    if (p === "EXERCICE") {
      const per = bornesExercice(exerciceChoisi);
      setDebut(per.debut);
      setFin(per.fin);
      return;
    }
    if (p !== "LIBRE") {
      const per = periodeDe(p, aujourdhui);
      setDebut(per.debut);
      setFin(per.fin);
    }
  }

  /* Heures consommées sur une affaire jusqu'à une date (mois de la date inclus) */
  const consomme: Consomme = useCallback(
    (numeroCommande: string, jour: string) => {
      const mois = jour.slice(0, 7);
      return (realiseMensuel.get(numeroCommande.toUpperCase().replace(/^0+/, "")) ?? []).reduce((t, m) => (m.mois <= mois ? t + m.heures : t), 0);
    },
    [realiseMensuel]
  );

  const periodeValide = Boolean(debut && fin && debut <= fin);
  const debutN1 = periodeValide ? decalerAnnee(debut, -1) : debut;
  const finN1 = periodeValide ? decalerAnnee(fin, -1) : fin;

  const calcul = useMemo(() => {
    if (!periodeValide) return null;

    const emis = devisEmis(lignes, debut, fin);
    const emisN1 = devisEmis(lignes, debutN1, finN1);
    const commandes = prisesDeCommande(lignes, debut, fin);
    const commandesN1 = prisesDeCommande(lignes, debutN1, finN1);
    const enCarnet = lignesEnCarnet(lignes, fin, consomme);
    const enCarnetN1 = lignesEnCarnet(lignes, finN1, consomme);
    const anneeFin = Number(fin.slice(0, 4));

    // carnet à la fin de chacun des 12 derniers mois
    const evolutionCarnet: { label: string; carnet: Agregat }[] = [];
    for (let k = 11; k >= 0; k--) {
      const d = new Date(Date.UTC(anneeFin, Number(fin.slice(5, 7)) - 1 - k, 1));
      const a = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const fm = finDeMois(a, m);
      const jour = fm < fin ? fm : fin;
      evolutionCarnet.push({ label: `${MOIS_COURTS[m - 1]} ${String(a).slice(2)}`, carnet: total(lignesEnCarnet(lignes, jour, consomme)) });
    }

    return {
      emis,
      synthese: syntheseDevis(emis),
      syntheseN1: syntheseDevis(emisN1),
      commandes,
      totalCommandes: total(commandes),
      totalCommandesN1: total(commandesN1),
      attente: devisEnAttente(lignes),
      enCarnet,
      carnet: total(enCarnet),
      carnetN1: total(enCarnetN1),
      affairesCarnet: carnetParAffaire(enCarnet, lignes),
      evolution24: (() => {
        const res: { label: string; devis: Agregat; commandes: Agregat }[] = [];
        const a0 = Number(fin.slice(0, 4));
        const m0 = Number(fin.slice(5, 7));
        for (let k = 23; k >= 0; k--) {
          const d = new Date(Date.UTC(a0, m0 - 1 - k, 1));
          const a = d.getUTCFullYear();
          const m = d.getUTCMonth() + 1;
          const deb = `${a}-${String(m).padStart(2, "0")}-01`;
          const fi = finDeMois(a, m);
          res.push({ label: `${MOIS_COURTS[m - 1]} ${String(a).slice(2)}`, devis: total(devisEmis(lignes, deb, fi)), commandes: total(prisesDeCommande(lignes, deb, fi)) });
        }
        return res;
      })(),
      // graphiques mensuels : sur l'exercice (nov. → oct.) quand « Exercice en cours » est choisi, sinon sur l'année civile
      moisN: preset === "EXERCICE" ? parMoisDepuis(lignes, debutExercice(fin), fin, consomme) : parMois(lignes, anneeFin, fin, consomme),
      moisN1:
        preset === "EXERCICE"
          ? parMoisDepuis(lignes, `${Number(debutExercice(fin).slice(0, 4)) - 1}-11-01`, `${debutExercice(fin).slice(0, 4)}-10-31`, consomme)
          : parMois(lignes, anneeFin - 1, `${anneeFin - 1}-12-31`, consomme),
      evolutionCarnet,
    };
  }, [lignes, debut, fin, debutN1, finN1, periodeValide, consomme, preset]);

  /* COUT_DEVIS : les devis OUVERTS sur la période, ce qu'ils ont coûté en heures (toutes les heures pointées
     dessus, même après la période) et ce qu'ils sont devenus */
  const coutDevis = useMemo(() => {
    if (!periodeValide) return null;
    const numeroDevis = (l: LigneInd) => (l.numero_devis ?? "").replace(/^\D+/, "").match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
    const vus = new Set<string>();
    const devis = lignes
      .filter((l) => !l.disparue && (l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT") && l.date_ouverture && l.date_ouverture >= debut && l.date_ouverture <= fin)
      .filter((l) => {
        const n = numeroDevis(l);
        if (!n || vus.has(n)) return false;
        vus.add(n);
        return true;
      })
      .map((l) => ({ l, numero: numeroDevis(l), heures: heuresDevis.get(numeroDevis(l)) ?? 0, issue: issueDevis(l) }))
      .sort((x, y) => Number(y.numero) - Number(x.numero));
    const somme = (xs: typeof devis) => xs.reduce((t, d) => t + d.heures, 0);
    const gagnes = devis.filter((d) => d.issue === "GAGNE");
    const perdus = devis.filter((d) => d.issue === "PERDU");
    const montantGagne = gagnes.reduce((t, d) => t + d.l.montant, 0);
    return {
      devis,
      heures: somme(devis),
      sansHeure: devis.filter((d) => d.heures < 0.01).length,
      gagnes: { nb: gagnes.length, heures: somme(gagnes) },
      perdus: { nb: perdus.length, heures: somme(perdus) },
      montantGagne,
    };
  }, [lignes, debut, fin, periodeValide, heuresDevis]);

  const valeur = (a: Agregat) => (montantsVisibles ? keuros(a.montant) : formatHeures(a.heures));
  const metrique = (p: Part) => (montantsVisibles ? p.montant : p.heures);
  const formatMetrique = (n: number) => (montantsVisibles ? keuros(n) : formatHeures(n));

  /* ------------------------------ export Excel ------------------------------ */

  function exporter() {
    if (!calcul) return;
    const wb = XLSX.utils.book_new();
    const s = calcul.synthese;
    const sN1 = calcul.syntheseN1;
    const avecMontant = montantsVisibles;

    const synthese: (string | number)[][] = [
      ["Indicateurs BE", `du ${formatDate(debut)} au ${formatDate(fin)}`, `N-1 : du ${formatDate(debutN1)} au ${formatDate(finN1)}`],
      [],
      ["Indicateur", "Période", "N-1"],
      ["Devis émis (nombre)", s.emis.nb, sN1.emis.nb],
      ["Devis émis (heures)", Math.round(s.emis.heures), Math.round(sN1.emis.heures)],
      ...(avecMontant ? [["Devis émis (€)", Math.round(s.emis.montant), Math.round(sN1.emis.montant)]] : []),
      ["Devis gagnés", s.parIssue.GAGNE.nb, sN1.parIssue.GAGNE.nb],
      ["Devis perdus", s.parIssue.PERDU.nb, sN1.parIssue.PERDU.nb],
      ["Devis en attente de réponse", s.parIssue.ATTENTE.nb + s.parIssue.INTENTION.nb, sN1.parIssue.ATTENTE.nb + sN1.parIssue.INTENTION.nb],
      ["Taux de transformation (en nombre de devis)", pourcent(s.tauxNombre), pourcent(sN1.tauxNombre)],
      ["Délai de réponse médian (jours)", s.delaiMedian ?? "—", sN1.delaiMedian ?? "—"],
      ["Prise de commande (nombre)", calcul.totalCommandes.nb, calcul.totalCommandesN1.nb],
      ["Prise de commande (heures)", Math.round(calcul.totalCommandes.heures), Math.round(calcul.totalCommandesN1.heures)],
      ...(avecMontant ? [["Prise de commande (€)", Math.round(calcul.totalCommandes.montant), Math.round(calcul.totalCommandesN1.montant)]] : []),
      [`Carnet de commandes au ${formatDate(fin)} (affaires)`, calcul.affairesCarnet.length, ""],
      ["Carnet de commandes (heures chiffrées)", Math.round(calcul.carnet.heures), Math.round(calcul.carnetN1.heures)],
      ...(avecMontant ? [["Carnet de commandes (€)", Math.round(calcul.carnet.montant), Math.round(calcul.carnetN1.montant)]] : []),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(synthese);
    ws1["!cols"] = [{ wch: 44 }, { wch: 22 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Synthèse");

    const mois = calcul.moisN.map((m, i) => {
      const n1 = calcul.moisN1[i];
      return {
        Mois: m.cle,
        "Devis émis": m.devis.nb,
        "Devis émis N-1": n1?.devis.nb ?? 0,
        "Commandes (h)": Math.round(m.commandes.heures),
        "Commandes N-1 (h)": Math.round(n1?.commandes.heures ?? 0),
        ...(avecMontant
          ? {
              "Commandes (€)": Math.round(m.commandes.montant),
              "Commandes N-1 (€)": Math.round(n1?.commandes.montant ?? 0),
              "Carnet fin de mois (€)": Math.round(m.carnet.montant),
            }
          : {}),
        "Carnet fin de mois (h)": Math.round(m.carnet.heures),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mois), "Par mois");

    const devis = calcul.emis.map((l) => ({
      "N° devis": l.numero_devis,
      "N° commande": l.numero_affaire ?? "",
      Désignation: l.designation ?? "",
      Client: l.client ?? "",
      Imputation: l.imputation ?? "",
      Émis: dateEmission(l),
      Statut: l.statut ?? "",
      Issue: { GAGNE: "Gagné", PERDU: "Perdu", INTENTION: "Intention", ATTENTE: "En attente" }[issueDevis(l)],
      Heures: l.heures_total,
      ...(avecMontant ? { "Montant (€)": l.montant } : {}),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(devis), "Devis émis");

    const cmd = calcul.commandes.map((l) => ({
      "N° commande": l.numero_affaire,
      Désignation: l.designation ?? "",
      Client: l.client ?? "",
      Imputation: l.imputation ?? "",
      Reçue: l.date_reception_commande,
      Heures: l.heures_total,
      ...(avecMontant ? { "Montant (€)": l.montant } : {}),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cmd), "Prises de commande");

    const carnet = calcul.affairesCarnet.map((a) => {
      const realise = realiseParAffaire.get(a.base_affaire) ?? 0;
      return {
        Affaire: a.numero,
        Désignation: a.designation ?? "",
        Client: a.client ?? "",
        Imputation: a.imputation ?? "",
        "Commande reçue": a.date_reception,
        "Heures chiffrées": Math.round(a.heures_commande * 10) / 10,
        "Heures réalisées": Math.round(realise * 10) / 10,
        "Reste à faire (h)": Math.round(resteAffaire(a) * 10) / 10,
        Calcul: a.prestation ? "PE/PI : enveloppe commandée − consommée" : "chiffré − réalisé",
        ...(avecMontant ? { "Montant en carnet (€)": Math.round(a.montant) } : {}),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(carnet), "Carnet de commandes");

    XLSX.writeFile(wb, `Indicateurs_BE_${debut}_${fin}.xlsx`);
  }

  /* ------------------------------ rendu ------------------------------ */

  const bouton = (actif: boolean): CSSProperties => ({
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

  const titreSection: CSSProperties = { margin: "28px 0 12px", fontSize: 22, fontWeight: 800 };
  const rangee: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 };

  /* Reste à produire d'une affaire du carnet : PE / PI = part restante de la période ; autres = chiffré − réalisé */
  const resteAffaire = (a: { prestation: boolean; heures: number; heures_commande: number; base_affaire: string }) =>
    a.prestation ? a.heures : Math.max(0, a.heures_commande - (realiseParAffaire.get(a.base_affaire) ?? 0));

  const s = calcul?.synthese;
  const sN1 = calcul?.syntheseN1;

  const resteCarnet = calcul
    ? calcul.affairesCarnet.reduce((t, a) => t + resteAffaire(a), 0)
    : 0;

  // libellés des séries des graphiques mensuels
  const exN = Number(debutExercice(fin).slice(0, 4));
  const libN = preset === "EXERCICE" ? `exercice ${exN}-${exN + 1}` : fin.slice(0, 4);
  const libN1 = preset === "EXERCICE" ? `exercice ${exN - 1}-${exN}` : String(Number(fin.slice(0, 4)) - 1);

  return (
    <main style={page.fond}>
      <style>{`
        @media print {
          .sans-impression { display: none !important; }
          main { background: #ffffff !important; }
          @page { size: A4 landscape; margin: 12mm; }
        }
      `}</style>

      <div className="sans-impression">
        <EnTetePage section="Indicateurs commerciaux" />
        {/* NAVIGATION_AXES */}<OngletsPilotage actif="indicateurs" />
      </div>

      <div style={{ ...page.contenu, maxWidth: 1300 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <div>
            <h1 style={page.titre}>Indicateurs commerciaux</h1>
            <p style={page.sousTitre}>
              Du {formatDate(debut)} au {formatDate(fin)}, comparé à la même période un an avant. Source : Suivi d’affaire BE
              {derniereSynchro ? `, synchronisé le ${formatDate(derniereSynchro)}` : ""}.
            </p>
          </div>
          <div className="sans-impression" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={exporter} disabled={!calcul} style={page.btnPrimaire}>
              Exporter en Excel
            </button>
            <button type="button" onClick={() => window.print()} style={page.btnSecondaire}>
              Imprimer / PDF
            </button>
          </div>
        </div>

        {/* période */}
        <div className="sans-impression" style={{ ...page.carte, padding: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
          {(
            [
              ["EXERCICE", "Exercice"],
              ["ANNEE", "Année en cours"],
              ["TRIMESTRE", "Trimestre en cours"],
              ["DOUZE_MOIS", "12 derniers mois"],
              ["ANNEE_DERNIERE", "Année dernière"],
            ] as [Preset, string][]
          ).map(([p, libelle]) => (
            <button key={p} type="button" aria-pressed={preset === p} style={bouton(preset === p)} onClick={() => choisir(p)}>
              {libelle}
            </button>
          ))}
          <select
            value={exerciceChoisi}
            onChange={(e) => {
              const an = Number(e.target.value);
              setExerciceChoisi(an);
              setPreset("EXERCICE");
              const per = bornesExercice(an);
              setDebut(per.debut);
              setFin(per.fin);
            }}
            aria-label="Exercice analysé"
            title="Exercice analysé (du 1er novembre au 31 octobre)"
            style={{ ...page.entrees, width: "auto", minHeight: 40, fontWeight: 700, borderColor: preset === "EXERCICE" ? C.rouge : undefined }}
          >
            {[0, 1, 2, 3].map((k) => (
              <option key={k} value={exerciceCourant - k}>
                Exercice {exerciceCourant - k}-{exerciceCourant - k + 1}
                {k === 0 ? " (en cours)" : ""}
              </option>
            ))}
          </select>
          <span style={{ width: 8 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Du
            <input type="date" value={debut} onChange={(e) => { setPreset("LIBRE"); setDebut(e.target.value); }} style={{ ...page.entrees, width: "auto" }} />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            au
            <input type="date" value={fin} onChange={(e) => { setPreset("LIBRE"); setFin(e.target.value); }} style={{ ...page.entrees, width: "auto" }} />
          </label>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {!periodeValide && <Message genre="erreur">La date de début doit précéder la date de fin.</Message>}
        {chargement && <Message genre="info">Chargement des indicateurs…</Message>}
        {!chargement && lignes.length === 0 && !erreur && (
          <Message genre="info">Aucune donnée : lancez d’abord une synchronisation du Suivi d’affaire BE (Paramétrage).</Message>
        )}
        {!chargement && lignes.length > 0 && !montantsVisibles && (
          <Message genre="info">Les montants ne sont pas visibles avec votre profil : les indicateurs sont donnés en heures.</Message>
        )}

        {calcul && s && sN1 && lignes.length > 0 && (
          <>
            {/* ================= ACTIVITÉ COMMERCIALE ================= */}
            <h2 style={titreSection}>1. Activité commerciale</h2>

            <div style={rangee}>
              <Tuile
                libelle="Devis émis"
                valeur={`${s.emis.nb}`}
                sous={`${montantsVisibles ? keuros(s.emis.montant) + " · " : ""}${formatHeures(s.emis.heures)} · ${evolution(s.emis.nb, sN1.emis.nb)}`}
              />
              <Tuile
                libelle="Taux de transformation"
                valeur={pourcent(s.tauxNombre)}
                sous={`${s.parIssue.GAGNE.nb} gagnés, ${s.parIssue.PERDU.nb} perdus · N-1 : ${pourcent(sN1.tauxNombre)}`}
              />
              <Tuile
                libelle="Délai de réponse"
                valeur={s.delaiMedian === null ? "—" : `${s.delaiMedian} j`}
                sous={`médian, de l’ouverture à l’envoi${s.delaiMoyen !== null ? ` · moyen ${Math.round(s.delaiMoyen)} j` : ""}${s.partJourMeme !== null ? ` · ${Math.round(s.partJourMeme * 100)} % envoyés le jour même` : ""}`}
              />
              <Tuile
                libelle="Prise de commande"
                valeur={valeur(calcul.totalCommandes)}
                sous={`${calcul.totalCommandes.nb} commandes et avenants · ${montantsVisibles ? formatHeures(calcul.totalCommandes.heures) + " · " : ""}${evolution(
                  montantsVisibles ? calcul.totalCommandes.montant : calcul.totalCommandes.heures,
                  montantsVisibles ? calcul.totalCommandesN1.montant : calcul.totalCommandesN1.heures
                )}`}
              />
              <Tuile
                libelle="Devis en attente de réponse"
                valeur={`${calcul.attente.attente.nb}`}
                sous={`aujourd’hui, tous devis confondus${montantsVisibles ? ` · ${keuros(calcul.attente.attente.montant)}` : ""}`}
              />
            </div>

            <details style={{ ...page.carte, padding: "10px 14px", marginBottom: 14, fontSize: 14 }}>
              <summary style={{ cursor: "pointer", fontWeight: 800 }}>ⓘ Ce que mesure chaque indicateur</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
                <li>
                  <strong>Prise de commande</strong> : ce que le BE a <em>vendu</em> sur la période. Ce sont les commandes de base et les avenants
                  (R1, R2…) dont la <strong>date de réception de commande</strong> tombe dans la période, au montant de la commande ; les
                  commandes annulées sont exclues, les échéances (ECH) ne comptent pas (elles découpent une commande déjà comptée).
                </li>
                <li>
                  <strong>Devis émis</strong> : devis dont la <strong>date d’envoi</strong> tombe dans la période (montant chiffré du devis).
                </li>
                <li>
                  <strong>Carnet de commandes</strong> : ce qui reste à facturer à la date de fin — forfaits commandés pas encore livrés (moins
                  leurs échéances déjà livrées), PE / PI pour leur part non consommée.
                </li>
                <li>
                  <strong>Exercice en cours</strong> : du 1er novembre au jour même, comme les Finances ; les graphiques mensuels vont alors de
                  novembre à octobre, comparés à l’exercice précédent.
                </li>
              </ul>
            </details>

            <div style={rangee}>
              <Carte titre={`Devis émis par mois — montant chiffré (${libN} et ${libN1})`} style={{ flex: "2 1 520px" }}>
                <BarresMois
                  donnees={calcul.moisN1.map((m1, i) => ({
                    label: MOIS_COURTS[Number(m1.cle.slice(5, 7)) - 1],
                    a: montantsVisibles ? calcul.moisN[i]?.devis.montant ?? 0 : calcul.moisN[i]?.devis.heures ?? 0,
                    b: montantsVisibles ? m1.devis.montant : m1.devis.heures,
                  }))}
                  format={formatMetrique}
                  legendeA={libN}
                  legendeB={libN1}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 6, marginTop: 6, fontSize: 12, textAlign: "center" }}>
                  {calcul.moisN1.map((m1, i) => (
                    <div key={i} title={`Devis émis : ${calcul.moisN[i]?.devis.nb ?? 0} en ${libN}, ${m1.devis.nb} en ${libN1}`}>
                      <strong>{calcul.moisN[i]?.devis.nb ?? "—"}</strong>
                      <div style={{ color: C.gris }}>{m1.devis.nb}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>Sous chaque mois : nombre de devis émis ({libN}, puis {libN1} en gris).</div>
              </Carte>
            </div>

            <div style={rangee}>
              <Carte titre="Évolution des devis émis et du CBE vendu — 24 derniers mois" style={{ flex: "1 1 100%" }}>
                <BarresMois
                  donnees={calcul.evolution24.map((e) => ({
                    label: e.label,
                    a: montantsVisibles ? e.commandes.montant : e.commandes.heures,
                    b: montantsVisibles ? e.devis.montant : e.devis.heures,
                  }))}
                  format={formatMetrique}
                  legendeA="CBE vendu (commandes reçues)"
                  legendeB="Devis émis"
                />
              </Carte>
            </div>

            <div style={rangee}>
              <Carte titre={`Prise de commande par mois (${libN} et ${libN1})`} style={{ flex: "2 1 520px" }}>
                <BarresMois
                  donnees={calcul.moisN1.map((m1, i) => ({
                    label: MOIS_COURTS[Number(m1.cle.slice(5, 7)) - 1],
                    a: montantsVisibles ? calcul.moisN[i]?.commandes.montant ?? 0 : calcul.moisN[i]?.commandes.heures ?? 0,
                    b: montantsVisibles ? m1.commandes.montant : m1.commandes.heures,
                  }))}
                  format={formatMetrique}
                  legendeA={libN}
                  legendeB={libN1}
                />
              </Carte>
              <Carte titre="Issue des devis émis sur la période">
                <BarresHorizontales
                  parts={[
                    { cle: "Gagnés", v: s.parIssue.GAGNE.nb },
                    { cle: "Perdus", v: s.parIssue.PERDU.nb },
                    { cle: "Intention de commande", v: s.parIssue.INTENTION.nb },
                    { cle: "En attente", v: s.parIssue.ATTENTE.nb },
                  ]}
                  format={(n) => `${n}`}
                />
              </Carte>
            </div>

            <div style={rangee}>
              <Carte titre={`Prises de commande par client (${montantsVisibles ? "€" : "heures"})`}>
                <BarresHorizontales parts={repartir(calcul.commandes, (l) => l.client ?? "Client non renseigné").map((p) => ({ cle: p.cle, v: metrique(p) }))} format={formatMetrique} />
              </Carte>
              <Carte titre={`Prises de commande par imputation (${montantsVisibles ? "€" : "heures"})`}>
                <BarresHorizontales parts={repartir(calcul.commandes, (l) => l.imputation ?? "Sans imputation").map((p) => ({ cle: p.cle, v: metrique(p) }))} format={formatMetrique} />
              </Carte>
              <Carte titre="Prises de commande par activité (heures)">
                <BarresHorizontales
                  parts={(() => {
                    const h = heuresParDiscipline(calcul.commandes);
                    return DISCIPLINES.map((d) => ({ cle: NOMS_DISCIPLINES[d], v: h[d] })).sort((a, b) => b.v - a.v);
                  })()}
                  format={formatHeures}
                />
              </Carte>
            </div>

            {/* ---------- Top 10 clients par imputation (prise de commande sur la période) ---------- */}
            {(() => {
              // imputation d'une commande : la sienne, sinon celle de sa commande de base (avenants)
              const impBase = new Map<string, string | null>();
              for (const x of lignes) if (x.genre === "BASE" && x.base_affaire) impBase.set(x.base_affaire, x.imputation);
              const imputationDe = (l: LigneInd): string => {
                if (l.imputation) return l.imputation;
                const b = l.base_affaire ? impBase.get(l.base_affaire) : undefined;
                return b || "Sans imputation";
              };
              const parImputation = repartir(calcul.commandes, imputationDe);
              const choisie = imputationTop && parImputation.some((p) => p.cle === imputationTop) ? imputationTop : "";
              const perimetre = choisie ? calcul.commandes.filter((l) => imputationDe(l) === choisie) : calcul.commandes;
              const top = repartir(perimetre, (l) => l.client ?? "Client non renseigné")
                .sort((x, y) => metrique(y) - metrique(x))
                .slice(0, 10);
              const totalPerimetre = perimetre.reduce((t, l) => t + (montantsVisibles ? l.montant : l.heures_total), 0);
              const boutonImp = (actif: boolean): CSSProperties => ({
                minHeight: 36,
                padding: "0 12px",
                borderRadius: 8,
                border: `1.5px solid ${actif ? C.rouge : "#c9cdd2"}`,
                background: actif ? C.rouge : "#ffffff",
                color: actif ? "#ffffff" : "#3b4046",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              });
              return (
                <div style={rangee}>
                  <Carte titre={`Top 10 clients par imputation — prise de commande (${montantsVisibles ? "€" : "heures"})`} style={{ flex: "1 1 100%" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      <button type="button" aria-pressed={!choisie} style={boutonImp(!choisie)} onClick={() => setImputationTop("")}>
                        Toutes
                      </button>
                      {parImputation.map((p) => (
                        <button key={p.cle} type="button" aria-pressed={choisie === p.cle} style={boutonImp(choisie === p.cle)} onClick={() => setImputationTop(p.cle)}>
                          {p.cle} <span style={{ opacity: 0.75, fontWeight: 600 }}>· {formatMetrique(metrique(p))}</span>
                        </button>
                      ))}
                    </div>
                    {top.length === 0 ? (
                      <p style={{ color: C.gris }}>Aucune prise de commande sur la période.</p>
                    ) : (
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                        <thead>
                          <tr>
                            <th style={{ ...page.th, width: 40 }}>#</th>
                            <th style={page.th}>Client</th>
                            <th style={{ ...page.th, textAlign: "right" }}>Commandes</th>
                            <th style={{ ...page.th, textAlign: "right" }}>Heures</th>
                            {montantsVisibles && <th style={{ ...page.th, textAlign: "right" }}>Montant</th>}
                            <th style={{ ...page.th, textAlign: "right" }}>Part</th>
                            <th style={{ ...page.th, width: "28%" }} aria-hidden="true" />
                          </tr>
                        </thead>
                        <tbody>
                          {top.map((p, i) => {
                            const part = totalPerimetre > 0 ? metrique(p) / totalPerimetre : 0;
                            return (
                              <tr key={p.cle}>
                                <td style={{ ...page.td, fontWeight: 800, color: i < 3 ? C.rougeFonce : C.gris }}>{i + 1}</td>
                                <td style={{ ...page.td, fontWeight: 800 }}>{p.cle}</td>
                                <td style={{ ...page.td, textAlign: "right" }}>{p.nb}</td>
                                <td style={{ ...page.td, textAlign: "right" }}>{formatHeures(p.heures)}</td>
                                {montantsVisibles && <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{keuros(p.montant)}</td>}
                                <td style={{ ...page.td, textAlign: "right" }}>{Math.round(part * 100)} %</td>
                                <td style={page.td}>
                                  <div style={{ height: 10, background: "#eceef1", borderRadius: 5, overflow: "hidden" }}>
                                    <div style={{ width: `${Math.min(100, part * 100)}%`, height: "100%", background: C.rouge }} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <div style={{ fontSize: 12, color: C.gris, marginTop: 6 }}>
                      Commandes de base et avenants reçus sur la période ; un avenant compte dans l’imputation de sa commande s’il n’en a pas. Part : poids
                      du client dans {choisie ? `l’imputation ${choisie}` : "toutes les prises de commande"}.
                    </div>
                  </Carte>
                </div>
              );
            })()}

            {/* DEVIS_FORFAITS : devis émis au forfait (hors PE / PI) face à ce qu'ils rapportent, par imputation */}
            {(() => {
              const impBase = new Map<string, string | null>();
              for (const x of lignes) if (x.genre === "BASE" && x.base_affaire) impBase.set(x.base_affaire, x.imputation);
              const imp = (l: LigneInd): string => {
                if (l.imputation) return l.imputation;
                const b = l.base_affaire ? impBase.get(l.base_affaire) : undefined;
                return b || "Sans imputation";
              };
              const forfait = (l: LigneInd) => imp(l) !== "PE" && imp(l) !== "PI";
              const emisF = calcul.emis.filter(forfait);
              const cmdF = calcul.commandes.filter(forfait);
              const m = (l: LigneInd) => (montantsVisibles ? l.montant : l.heures_total);
              const stats = (emis: LigneInd[], cmd: LigneInd[]) => {
                const de = (issue: string) => emis.filter((l) => issueDevis(l) === issue);
                const g = de("GAGNE");
                const p = de("PERDU");
                const a = [...de("ATTENTE"), ...de("INTENTION")];
                const somme = (xs: LigneInd[]) => xs.reduce((t, l) => t + m(l), 0);
                return {
                  emis: { nb: emis.length, v: somme(emis) },
                  gagnes: { nb: g.length, v: somme(g) },
                  perdus: { nb: p.length, v: somme(p) },
                  attente: { nb: a.length, v: somme(a) },
                  cmd: { nb: cmd.length, v: somme(cmd) },
                };
              };
              const total = stats(emisF, cmdF);
              const imputations = [...new Set([...emisF, ...cmdF].map(imp))].sort((x, y) => x.localeCompare(y, "fr"));
              const taux = (a: number, b: number) => (a + b > 0 ? `${Math.round((a / (a + b)) * 100)} %` : "—");
              const cellule = (x: { nb: number; v: number }) => (
                <>
                  <strong>{x.nb}</strong>
                  <span style={{ color: C.gris }}> · {formatMetrique(x.v)}</span>
                </>
              );
              const thD: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap" };
              const tdD: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap" };
              return (
                <>
                  <h2 style={titreSection}>Devis et commandes au forfait</h2>
                  <p style={{ ...page.sousTitre, marginTop: -6 }}>
                    Hors PE / PI. Les devis <strong>émis</strong> sur la période et ce qu’ils sont devenus, face aux commandes au forfait <strong>reçues</strong> sur la
                    même période ({montantsVisibles ? "montants" : "heures chiffrées"}).
                  </p>
                  <div style={rangee}>
                    <Tuile libelle="Devis émis au forfait" valeur={`${total.emis.nb}`} sous={`${formatMetrique(total.emis.v)} chiffrés`} />
                    <Tuile
                      libelle="Devenus commande"
                      valeur={`${total.gagnes.nb}`}
                      sous={`${formatMetrique(total.gagnes.v)} · taux ${taux(total.gagnes.nb, total.perdus.nb)} en nombre, ${taux(total.gagnes.v, total.perdus.v)} en ${montantsVisibles ? "montant" : "heures"}`}
                    />
                    <Tuile libelle="Encore sans réponse" valeur={`${total.attente.nb}`} sous={`${formatMetrique(total.attente.v)} en attente ou en intention`} />
                    <Tuile libelle="Commandes reçues au forfait" valeur={`${total.cmd.nb}`} sous={`${formatMetrique(total.cmd.v)} · commandes et avenants reçus sur la période`} />
                  </div>
                  <div style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                      <thead>
                        <tr>
                          <th style={page.th}>Imputation</th>
                          <th style={thD}>Devis émis</th>
                          <th style={thD}>Devenus commande</th>
                          <th style={thD}>Perdus</th>
                          <th style={thD}>Sans réponse</th>
                          <th style={thD} title="Gagnés ÷ (gagnés + perdus)">Taux (nb / {montantsVisibles ? "€" : "h"})</th>
                          <th style={thD}>Commandes reçues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...imputations.map((i) => ({ cle: i, s: stats(emisF.filter((l) => imp(l) === i), cmdF.filter((l) => imp(l) === i)) })), { cle: "Total", s: total }].map(({ cle, s: st }) => (
                          <tr key={cle} style={cle === "Total" ? { background: "#f6f7f8" } : undefined}>
                            <td style={{ ...page.td, fontWeight: 800 }}>{cle}</td>
                            <td style={tdD}>{cellule(st.emis)}</td>
                            <td style={{ ...tdD, color: "#1b5e20" }}>{cellule(st.gagnes)}</td>
                            <td style={tdD}>{cellule(st.perdus)}</td>
                            <td style={tdD}>{cellule(st.attente)}</td>
                            <td style={{ ...tdD, fontWeight: 800 }}>
                              {taux(st.gagnes.nb, st.perdus.nb)} / {taux(st.gagnes.v, st.perdus.v)}
                            </td>
                            <td style={{ ...tdD, fontWeight: 800 }}>{cellule(st.cmd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 12, color: C.gris, marginTop: 6 }}>
                      Devis émis : envoyés sur la période (à défaut, ouverts). « Devenus commande » : devis de la période qui portent un n° de commande, au
                      montant de la commande. Commandes reçues : toutes celles reçues sur la période, y compris issues de devis plus anciens ; c’est ce que la
                      période a réellement rapporté.
                    </div>
                  </div>
                </>
              );
            })()}

            {/* DEVIS_ACTIVITE_CLIENT : devis OUVERTS sur la période, par activité et par client ; une offre pluri-activités
                compte UNE fois (dans son activité principale), son montant est réparti au prorata des heures chiffrées */}
            {(() => {
              const numeroDevis = (l: LigneInd) => (l.numero_devis ?? "").replace(/^\D+/, "").match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
              const vus = new Set<string>();
              const offres = lignes
                .filter((l) => !l.disparue && (l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT") && l.date_ouverture && l.date_ouverture >= debut && l.date_ouverture <= fin)
                .filter((l) => {
                  const n = numeroDevis(l);
                  if (!n || vus.has(n)) return false;
                  vus.add(n);
                  return true;
                });
              const val = (l: LigneInd) => (montantsVisibles ? l.montant : l.heures_total);
              type St = { n: number; g: number; p: number; v: number; vg: number; vp: number };
              const vide = (): St => ({ n: 0, g: 0, p: 0, v: 0, vg: 0, vp: 0 });
              const parAct = new Map<Discipline, St>();
              const parClient = new Map<string, St>();
              const total = vide();
              for (const l of offres) {
                const issue = issueDevis(l);
                const tot = DISCIPLINES.reduce((t, d) => t + l.heures[d], 0);
                const principale: Discipline = tot > 0 ? DISCIPLINES.reduce((a, d) => (l.heures[d] > l.heures[a] ? d : a), DISCIPLINES[0]) : "autre";
                for (const d of DISCIPLINES) {
                  const part = tot > 0 ? l.heures[d] / tot : d === "autre" ? 1 : 0;
                  if (part <= 0 && d !== principale) continue;
                  const s = parAct.get(d) ?? vide();
                  if (d === principale) {
                    s.n++;
                    if (issue === "GAGNE") s.g++;
                    if (issue === "PERDU") s.p++;
                  }
                  s.v += val(l) * part;
                  if (issue === "GAGNE") s.vg += val(l) * part;
                  if (issue === "PERDU") s.vp += val(l) * part;
                  parAct.set(d, s);
                }
                const nomClient = l.client ?? "Client non renseigné";
                for (const s of [parClient.get(nomClient) ?? vide(), total]) {
                  s.n++;
                  if (issue === "GAGNE") s.g++;
                  if (issue === "PERDU") s.p++;
                  s.v += val(l);
                  if (issue === "GAGNE") s.vg += val(l);
                  if (issue === "PERDU") s.vp += val(l);
                  if (s !== total) parClient.set(nomClient, s);
                }
              }
              const taux = (g: number, p: number) => (g + p > 0 ? `${Math.round((g / (g + p)) * 100)} %` : "—");
              const thD: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap" };
              const tdD: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap" };
              const ligneTable = (cle: string, s: St, gras = false) => (
                <tr key={cle} style={gras ? { background: "#f6f7f8" } : undefined}>
                  <td style={{ ...page.td, fontWeight: 800 }}>{cle}</td>
                  <td style={{ ...tdD, fontWeight: gras ? 800 : 400 }}>{s.n}</td>
                  <td style={{ ...tdD, color: "#1b5e20", fontWeight: 700 }}>{s.g}</td>
                  <td style={tdD}>{s.p}</td>
                  <td style={{ ...tdD, fontWeight: 800 }}>{taux(s.g, s.p)}</td>
                  <td style={tdD}>{formatMetrique(s.v)}</td>
                  <td style={{ ...tdD, color: "#1b5e20", fontWeight: 700 }}>{formatMetrique(s.vg)}</td>
                  <td style={{ ...tdD, fontWeight: 800 }}>{taux(s.vg, s.vp)}</td>
                </tr>
              );
              const entete = (premiere: string) => (
                <thead>
                  <tr>
                    <th style={page.th}>{premiere}</th>
                    <th style={thD}>Devis ouverts</th>
                    <th style={thD}>Remportés</th>
                    <th style={thD}>Perdus</th>
                    <th style={thD} title="Remportés ÷ (remportés + perdus) : les devis sans réponse ne comptent pas">Taux (nb)</th>
                    <th style={thD}>{montantsVisibles ? "Montant chiffré" : "Heures chiffrées"}</th>
                    <th style={thD}>{montantsVisibles ? "Montant remporté" : "Heures remportées"}</th>
                    <th style={thD}>Taux ({montantsVisibles ? "€" : "h"})</th>
                  </tr>
                </thead>
              );
              const clients = [...parClient.entries()].sort((x, y) => y[1].v - x[1].v);
              return (
                <>
                  <h2 style={titreSection}>Devis par activité et par client</h2>
                  <p style={{ ...page.sousTitre, marginTop: -6 }}>
                    Les devis <strong>ouverts</strong> du {formatDate(debut)} au {formatDate(fin)} (les consultations reçues), et ce qu’ils sont devenus. Une offre
                    qui mêle plusieurs activités (de la mécanique et de l’électricité, par exemple) <strong>compte une seule fois</strong>, dans son activité
                    principale (celle qui a le plus d’heures chiffrées) ; son {montantsVisibles ? "montant" : "chiffrage"} est réparti entre ses activités au prorata
                    des heures. Les totaux ne comptent donc jamais deux fois la même offre.
                  </p>
                  <div style={{ ...page.carte, padding: 16, marginBottom: 14, overflowX: "auto" }}>
                    <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Par activité</h3>
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                      {entete("Activité")}
                      <tbody>
                        {DISCIPLINES.filter((d) => parAct.has(d)).map((d) => ligneTable(NOMS_DISCIPLINES[d], parAct.get(d)!))}
                        {ligneTable("Total", total, true)}
                      </tbody>
                    </table>
                  </div>
                  <details style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                    <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 800 }}>Par client ({clients.length})</summary>
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                        {entete("Client")}
                        <tbody>
                          {clients.map(([c, s]) => ligneTable(c, s))}
                          {ligneTable("Total", total, true)}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              );
            })()}

            {/* CYCLICITE_CONSULTATIONS : devis ouverts mois par mois, sur les trois derniers exercices */}
            {(() => {
              const numeroDevis = (l: LigneInd) => (l.numero_devis ?? "").replace(/^\D+/, "").match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
              const premiers = new Map<string, string>();
              for (const l of lignes) {
                if (l.disparue || !(l.genre === "DEVIS" || l.genre === "BASE" || l.genre === "AVENANT") || !l.date_ouverture) continue;
                const n = numeroDevis(l);
                if (!n) continue;
                const d = l.date_ouverture.slice(0, 10);
                if (!premiers.has(n) || d < (premiers.get(n) ?? "")) premiers.set(n, d);
              }
              const exFin = Number(debutExercice(fin).slice(0, 4));
              const exAujourdhui = Number(debutExercice(aujourdhui).slice(0, 4));
              const idxMois = (d: string) => (Number(d.slice(5, 7)) + 1) % 12; // novembre = 0
              const series = [0, 1, 2].map((k) => {
                const an = exFin - k;
                const m = Array.from({ length: 12 }, () => 0);
                for (const d of premiers.values()) if (d >= `${an}-11-01` && d <= `${an + 1}-10-31`) m[idxMois(d)]++;
                const jusqua = an === exAujourdhui ? idxMois(aujourdhui) : 11;
                return { an, m, jusqua };
              });
              const max = Math.max(5, ...series.flatMap((s) => s.m));
              const L = 900;
              const H = 260;
              const mg = { g: 40, d: 16, h: 14, b: 34 };
              const x = (i: number) => mg.g + (i * (L - mg.g - mg.d)) / 11;
              const y = (v: number) => mg.h + (H - mg.h - mg.b) * (1 - v / max);
              const couleurs = [C.rouge, "#5b6168", "#b9bec5"];
              const libellesMois = Array.from({ length: 12 }, (_, i) => MOIS_COURTS[(i + 10) % 12]);
              return (
                <div style={rangee}>
                  <Carte titre="Consultations reçues mois par mois — trois derniers exercices" style={{ flex: "1 1 100%" }}>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 6 }}>
                      {series.map((s, k) => (
                        <span key={s.an} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <i style={{ width: 18, height: 3, background: couleurs[k], display: "inline-block" }} />
                          {s.an}-{s.an + 1} : <strong>{s.m.slice(0, s.jusqua + 1).reduce((t, v) => t + v, 0)}</strong> devis
                        </span>
                      ))}
                    </div>
                    <svg viewBox={`0 0 ${L} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Nombre de devis ouverts par mois, trois exercices">
                      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                        <g key={p}>
                          <line x1={mg.g} x2={L - mg.d} y1={y(p * max)} y2={y(p * max)} stroke="#e5e7ea" />
                          <text x={mg.g - 6} y={y(p * max) + 4} textAnchor="end" fontSize={11} fill="#777">
                            {Math.round(p * max)}
                          </text>
                        </g>
                      ))}
                      {libellesMois.map((l, i) => (
                        <text key={l} x={x(i)} y={H - 12} textAnchor="middle" fontSize={11} fill="#777">
                          {l}
                        </text>
                      ))}
                      {[...series].reverse().map((s) => {
                        const k = series.indexOf(s);
                        const pts = s.m.slice(0, s.jusqua + 1).map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
                        return (
                          <g key={s.an}>
                            <polyline points={pts} fill="none" stroke={couleurs[k]} strokeWidth={k === 0 ? 3 : 2} strokeLinejoin="round" />
                            {s.m.slice(0, s.jusqua + 1).map((v, i) => (
                              <circle key={i} cx={x(i)} cy={y(v)} r={k === 0 ? 4 : 3} fill={couleurs[k]}>
                                <title>{`${libellesMois[i]} (exercice ${s.an}-${s.an + 1}) : ${v} devis ouverts`}</title>
                              </circle>
                            ))}
                          </g>
                        );
                      })}
                    </svg>
                    <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>
                      Nombre de devis ouverts chaque mois (date d’ouverture dans le Suivi d’affaire), de novembre à octobre. Les courbes superposées font
                      apparaître les mois habituellement chargés ou creux. Exercices terminant par l’exercice choisi en haut de la page.
                    </div>
                  </Carte>
                </div>
              );
            })()}

            {/* ================= COÛT DES DEVIS ================= */}
            {coutDevis && (
              <>
                <h2 style={titreSection}>Coût des devis</h2>
                <p style={{ ...page.sousTitre, marginTop: -6 }}>
                  Les devis <strong>ouverts</strong> du {formatDate(debut)} au {formatDate(fin)}, et toutes les heures pointées dessus (feuilles d’heures, et
                  historique avant le 2 novembre 2026), même après la période.
                </p>
                <div style={rangee}>
                  <Tuile
                    libelle="Devis ouverts"
                    valeur={`${coutDevis.devis.length}`}
                    sous={`${formatHeures(coutDevis.heures)} passées · ${coutDevis.devis.length > 0 ? formatHeures(coutDevis.heures / coutDevis.devis.length) : "—"} en moyenne par devis${coutDevis.sansHeure > 0 ? ` · ${coutDevis.sansHeure} sans heure pointée` : ""}`}
                  />
                  <Tuile
                    libelle="Par devis gagné"
                    valeur={coutDevis.gagnes.nb > 0 ? formatHeures(coutDevis.gagnes.heures / coutDevis.gagnes.nb) : "—"}
                    sous={`${coutDevis.gagnes.nb} gagnés · ${formatHeures(coutDevis.gagnes.heures)} au total`}
                  />
                  <Tuile
                    libelle="Par devis perdu"
                    valeur={coutDevis.perdus.nb > 0 ? formatHeures(coutDevis.perdus.heures / coutDevis.perdus.nb) : "—"}
                    sous={`${coutDevis.perdus.nb} perdus · ${formatHeures(coutDevis.perdus.heures)} au total`}
                  />
                  {montantsVisibles && (
                    <Tuile
                      libelle="Heures de devis pour 1 000 € gagnés"
                      valeur={coutDevis.montantGagne > 0 ? formatHeures((coutDevis.heures / coutDevis.montantGagne) * 1000) : "—"}
                      sous={`toutes les heures de devis de la période, rapportées aux ${keuros(coutDevis.montantGagne)} gagnés`}
                    />
                  )}
                </div>
                <div style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
                  <button
                    type="button"
                    aria-expanded={voirDevis}
                    onClick={() => setVoirDevis((v) => !v)}
                    className="sans-impression"
                    style={{ all: "unset", cursor: "pointer", fontSize: 16, fontWeight: 800, display: "inline-flex", gap: 8, minHeight: 36, alignItems: "center" }}
                  >
                    <span aria-hidden="true">{voirDevis ? "▾" : "▸"}</span> Devis ouverts sur la période ({coutDevis.devis.length})
                  </button>
                  {voirDevis && (
                    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th style={page.th}>Devis</th>
                          <th style={page.th}>Client</th>
                          <th style={page.th}>Désignation</th>
                          <th style={page.th}>Ouvert le</th>
                          <th style={page.th}>Envoyé le</th>
                          <th style={{ ...page.th, textAlign: "right" }}>Heures passées</th>
                          <th style={page.th}>Devenu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coutDevis.devis.map(({ l, numero, heures, issue }) => (
                          <tr key={numero}>
                            <td style={{ ...page.td, fontWeight: 800, whiteSpace: "nowrap" }}>DBE{numero}</td>
                            <td style={page.td}>{l.client ?? "—"}</td>
                            <td style={{ ...page.td, fontSize: 13 }}>{l.designation ?? "—"}</td>
                            <td style={{ ...page.td, whiteSpace: "nowrap" }}>{formatDate(l.date_ouverture)}</td>
                            <td style={{ ...page.td, whiteSpace: "nowrap" }}>{formatDate(l.date_envoi)}</td>
                            <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{heures > 0 ? formatHeures(heures) : "—"}</td>
                            <td style={page.td}>
                              {issue === "GAGNE" ? (
                                <span style={{ fontWeight: 800, color: "#1b5e20" }}>
                                  ✓ {l.numero_affaire ?? "commande"}
                                  {montantsVisibles && l.montant > 0 ? ` · ${keuros(l.montant)}` : ""}
                                </span>
                              ) : (
                                <span style={{ color: issue === "PERDU" ? C.rougeTexte : C.gris }}>
                                  {issue === "PERDU" ? "perdu" : issue === "INTENTION" ? "intention de commande" : l.statut === "Devis ouvert" ? "en cours de rédaction" : "en attente de réponse"}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            {/* ================= CARNET DE COMMANDES ================= */}
            <h2 style={titreSection}>2. Carnet de commandes</h2>
            {/* NOTE_CARNET */}
            <div style={{ ...page.carte, padding: "10px 14px", marginBottom: 14, fontSize: 14, lineHeight: 1.5, borderLeft: `4px solid ${C.rouge}` }}>
              <strong>Le carnet de commandes, c’est le travail déjà vendu mais pas encore livré</strong> : ce que les clients nous ont commandé et qu’il
              reste à produire et à facturer, à la date de fin de la période. Pour un forfait, toute la commande tant qu’elle n’est pas livrée (moins ses
              échéances déjà livrées) ; pour une PE ou une PI, la part de l’enveloppe pas encore consommée. Plus il est rempli, plus le BE a de travail
              assuré devant lui ; son évolution mois par mois montre si les commandes arrivent plus vite (il monte) ou moins vite (il baisse) qu’on ne les
              produit.
            </div>

            <div style={rangee}>
              <Tuile
                libelle={`Carnet au ${formatDate(fin)}`}
                valeur={valeur(calcul.carnet)}
                sous={`${calcul.affairesCarnet.length} affaires · ${evolution(
                  montantsVisibles ? calcul.carnet.montant : calcul.carnet.heures,
                  montantsVisibles ? calcul.carnetN1.montant : calcul.carnetN1.heures
                )}`}
              />
              <Tuile libelle="Heures chiffrées en carnet" valeur={formatHeures(calcul.carnet.heures)} sous={`N-1 : ${formatHeures(calcul.carnetN1.heures)}`} />
              {fin === aujourdhui && (
                <Tuile
                  libelle="Reste à produire"
                  valeur={formatHeures(resteCarnet)}
                  sous="heures chiffrées moins heures déjà imputées dans les feuilles d’heures"
                />
              )}
            </div>

            <div style={rangee}>
              <Carte titre="Carnet de commandes à la fin de chaque mois" style={{ flex: "2 1 520px" }}>
                <BarresMois
                  donnees={calcul.evolutionCarnet.map((m) => ({ label: m.label, a: montantsVisibles ? m.carnet.montant : m.carnet.heures }))}
                  format={formatMetrique}
                  legendeA={montantsVisibles ? "Carnet (€)" : "Carnet (heures)"}
                />
              </Carte>
              <Carte titre="Carnet par activité (heures chiffrées)">
                <BarresHorizontales
                  parts={(() => {
                    const h = heuresParDiscipline(calcul.enCarnet);
                    return DISCIPLINES.map((d) => ({ cle: NOMS_DISCIPLINES[d], v: h[d] })).sort((a, b) => b.v - a.v);
                  })()}
                  format={formatHeures}
                />
              </Carte>
            </div>

            <div style={rangee}>
              <Carte titre={`Carnet par client (${montantsVisibles ? "€" : "heures"})`}>
                <BarresHorizontales parts={repartir(calcul.enCarnet, (l) => l.client ?? "Client non renseigné").map((p) => ({ cle: p.cle, v: metrique(p) }))} format={formatMetrique} />
              </Carte>
              <Carte titre={`Carnet par imputation (${montantsVisibles ? "€" : "heures"})`}>
                <BarresHorizontales parts={repartir(calcul.enCarnet, (l) => l.imputation ?? "Sans imputation").map((p) => ({ cle: p.cle, v: metrique(p) }))} format={formatMetrique} />
              </Carte>
            </div>

            <div style={{ ...page.carte, padding: 16, marginBottom: 14 }}>
              <button
                type="button"
                aria-expanded={voirCarnet}
                onClick={() => setVoirCarnet((v) => !v)}
                className="sans-impression"
                style={{ all: "unset", cursor: "pointer", fontSize: 16, fontWeight: 800, display: "inline-flex", gap: 8, minHeight: 36, alignItems: "center" }}
              >
                <span aria-hidden="true">{voirCarnet ? "▾" : "▸"}</span> Affaires en carnet ({calcul.affairesCarnet.length})
              </button>
              {voirCarnet && (
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={page.th}>Affaire</th>
                      <th style={page.th}>Désignation</th>
                      <th style={page.th}>Client</th>
                      <th style={page.th}>Imput.</th>
                      <th style={page.th}>Reçue le</th>
                      <th style={{ ...page.th, textAlign: "right" }}>Chiffré</th>
                      <th style={{ ...page.th, textAlign: "right" }}>Réalisé</th>
                      <th style={{ ...page.th, textAlign: "right" }}>Reste</th>
                      {montantsVisibles && <th style={{ ...page.th, textAlign: "right" }}>Montant</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.affairesCarnet.map((a) => {
                      const realise = realiseParAffaire.get(a.base_affaire) ?? 0;
                      const reste = a.prestation ? a.heures : a.heures_commande - realise;
                      return (
                        <tr key={a.base_affaire}>
                          <td style={{ ...page.td, whiteSpace: "nowrap", fontWeight: 800 }}>{a.numero}</td>
                          <td style={page.td}>{a.designation ?? "—"}</td>
                          <td style={page.td}>{a.client ?? "—"}</td>
                          <td style={page.td}>{a.imputation ?? "—"}</td>
                          <td style={{ ...page.td, whiteSpace: "nowrap" }}>{formatDate(a.date_reception)}</td>
                          <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>{formatHeures(a.heures_commande)}</td>
                          <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>{formatHeures(realise)}</td>
                          <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap", color: reste < 0 ? C.rougeTexte : undefined, fontWeight: reste < 0 ? 800 : 400 }}>
                            {reste < 0 ? `dépassé de ${formatHeures(-reste)}` : formatHeures(reste)}
                            {a.prestation && <div style={{ fontSize: 11, color: C.gris }}>reste de l’enveloppe</div>}
                          </td>
                          {montantsVisibles && <td style={{ ...page.td, textAlign: "right", whiteSpace: "nowrap" }}>{euros(a.montant)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <details style={{ fontSize: 13, color: "#3b4046", marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, minHeight: 32 }}>Comment sont calculés ces indicateurs ?</summary>
              <ul style={{ lineHeight: 1.6 }}>
                <li><strong>Devis émis</strong> : offres (commande de base, avenant ou devis seul) envoyées sur la période ; à défaut de date d’envoi, la date d’ouverture. Les lots et échéances ne comptent pas.</li>
                <li><strong>Taux de transformation</strong> : devis gagnés (devenus commande) ÷ (gagnés + perdus). Les devis encore sans réponse ne comptent pas.</li>
                <li><strong>Délai de réponse</strong> : jours entre l’ouverture et l’envoi du devis (médiane : la moitié des devis partent plus vite).</li>
                <li><strong>Prise de commande</strong> : commandes de base et avenants reçus sur la période (date de réception de commande), hors annulés.</li>
                <li><strong>Carnet de commandes</strong> : commandes reçues et pas encore livrées à la date de fin, hors annulées.</li>
                <li><strong>PE et PI dans le carnet</strong> : prestations au temps passé. Leur commande et leurs avenants forment une enveloppe d’heures ; elle ne compte au carnet que pour sa part non encore consommée (heures des feuilles d’heures). Une enveloppe entièrement consommée n’est plus au carnet.</li>
                <li><strong>N-1</strong> : la même période, un an plus tôt.</li>
              </ul>
            </details>
          </>
        )}
      </div>
    </main>
  );
}

export default function IndicateursPage() {
  return (
    <GardeAcces droit="indicateurs">
      <IndicateursContenu />
    </GardeAcces>
  );
}
