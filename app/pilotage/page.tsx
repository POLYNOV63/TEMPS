"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import { BadgeType, C, Message, Pastille, Tuile, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import {
  chargerAffaires,
  chargerAnnuaire,
  chargerCharges,
  chargerImputations,
  chargerMoi,
  chargerPlanifie,
  chargerRealise,
  chargerTout,
  type AffaireP,
  type Moi,
} from "@/lib/pilotageDonnees";
import {
  aujourdhuiISO,
  chargesParAffaire,
  cleAffaire,
  etatAffaire,
  formatDate,
  formatHeures,
  indexParAffaire,
  nomCollab,
  planifieParAffaire,
  toleranceAffectation,
  totauxAffaire,
  type Collab,
  type Genre,
  type Imputation,
  type PlanningAffaire,
  type Realise,
  type Totaux,
} from "@/lib/pilotageCalculs";
import { chargerDormantes, libelleDormance, type Dormance } from "@/lib/dormantes";

/* ===============================================================
   PILOTAGE BE - PORTEFEUILLE DES AFFAIRES

   Tout le monde voit cette page ; seuls les responsables et les
   administrateurs peuvent déclarer ou modifier une affaire.

   Toute commande en cours ou en intention est au planning d'office (plus
   de bouton « Planifier »), et les affaires viennent toutes du Suivi
   d'affaire BE (plus de « Nouvelle affaire »).

   Une ligne par COMMANDE (base ou avenant). Le réalisé d'une famille
   (base + avenants) est affiché sur la commande de base, avec le reste
   de toute la famille ; ses avenants indiquent « dans 1604 ».
================================================================ */

type DetailActivite = { id: string; nom: string; ordre: number; chiffre: number; realise: number };

type Ligne = {
  affaire: AffaireP;
  client: string | null;
  activites: DetailActivite[];
  totaux: Totaux;
  planning: { planifie: number; fin: string | null; nb: number };
  etat: { genre: Genre; texte: string };
  /* Famille d'une affaire (base + avenants, ex. 1604, 1604R1, 1604R2) : les feuilles d'heures
     sont pointées sur la base, donc le réalisé est celui de toute la famille. Il est porté
     par une seule ligne (la base, sinon la première commande de la famille). */
  famille?: { numeros: string[]; chiffre: number; detail?: { numero: string; chiffre: number }[] };
  dansFamille?: string; // numéro de la ligne qui porte le réalisé de la famille
  aAffecter: number; // heures de CETTE commande restant à mettre au planning
};

type FiltreStatut = "ACTIVES" | "EN_COURS" | "EN_ATTENTE";
type FiltrePlanning = "TOUS" | "AU" | "HORS";
type ColonneTri = "numero" | "designation" | "client" | "imputation" | "resp" | "echeance" | "chiffre" | "realise" | "reste";
// TYPE_FORFAIT_PEPI : forfaits (CBE hors PE / PI), PE / PI, devis
type FiltreType = "FORFAIT" | "PEPI" | "DBE";

function normaliser(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* MONTANT_HORS_COMPARAISON : activités vendues au montant (scan, négoce) */
const estActiviteMontant = (nom?: string) => /^(negoce|scan)/.test((nom ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim());

function PortefeuilleContenu() {
  const [affaires, setAffaires] = useState<AffaireP[]>([]);
  const [erreurPlanning, setErreurPlanning] = useState("");
  const [charges, setCharges] = useState<Awaited<ReturnType<typeof chargerCharges>>>([]);
  const [realise, setRealise] = useState<Realise[]>([]);
  const [planifies, setPlanifies] = useState<Map<string, { planifie: number; fin: string | null; nb: number }>>(new Map());
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [imputations, setImputations] = useState<Imputation[]>([]);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  // CBE_PAR_DEFAUT : le portefeuille s'ouvre sur les commandes
  const [filtreType, setFiltreType] = useState<FiltreType>("FORFAIT");
  const [filtreStatut, setFiltreStatut] = useState<FiltreStatut>("ACTIVES");
  const [filtrePlanning, setFiltrePlanning] = useState<FiltrePlanning>("TOUS");
  const [depassementSeul, setDepassementSeul] = useState(false);
  const [filtreImputation, setFiltreImputation] = useState("");
  const [filtreClient, setFiltreClient] = useState("");
  const [filtreResp, setFiltreResp] = useState("");
  const [tri, setTri] = useState<{ col: ColonneTri; sens: 1 | -1 }>({ col: "echeance", sens: 1 });
  const [inactivesOuvertes, setInactivesOuvertes] = useState(false);
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [nomsActivites, setNomsActivites] = useState<Map<string, { nom: string; ordre: number }>>(new Map());
  // n° de devis (DBE) de chaque commande, d'après le Suivi d'affaire BE
  const [devisParCbe, setDevisParCbe] = useState<Map<string, string>>(new Map());
  const [clientsParAffaire, setClientsParAffaire] = useState<{ cbe: Map<string, string>; dbe: Map<string, string> }>({
    cbe: new Map(),
    dbe: new Map(),
  });
  const [recherche, setRecherche] = useState("");
  const [toutesAlertes, setToutesAlertes] = useState(false);
  // DORMANTES_PORTEFEUILLE : PE / PI en cours sans activité depuis 3 mois
  const [dormantes, setDormantes] = useState<Map<string, Dormance>>(new Map());
  const [dormantesSeules, setDormantesSeules] = useState(false);
  useEffect(() => {
    if (affaires.length === 0) return;
    void chargerDormantes(affaires).then(setDormantes);
  }, [affaires]);

  // AFFECTER_DBE : rédacteur et date cible de rendu d'un devis, depuis le portefeuille
  const [edDbe, setEdDbe] = useState<{ id: string; resp: string; date: string } | null>(null);
  const [enregDbe, setEnregDbe] = useState(false);

  async function enregistrerDbe() {
    if (!edDbe) return;
    if (!edDbe.date) {
      setErreurPlanning("Indiquez la date cible de rendu du devis.");
      return;
    }
    setEnregDbe(true);
    setErreurPlanning("");
    // DELAI_PAR_FONCTION : le rédacteur d'abord ; la date passe par la fonction des délais,
    // qui garde l'historique (motif obligatoire, rempli automatiquement)
    let { error } = await supabase.from("pilotage_affaires").update({ responsable_id: edDbe.resp }).eq("id", edDbe.id);
    if (!error) {
      const avant = affaires.find((a) => a.id === edDbe.id)?.echeance ?? null;
      if (avant !== edDbe.date) {
        ({ error } = await supabase.rpc("pilotage_changer_echeance", {
          p_affaire_id: edDbe.id,
          p_nouvelle_date: edDbe.date,
          p_motif: "Date de rendu du devis fixée depuis le portefeuille",
        }));
      }
    }
    setEnregDbe(false);
    if (error) {
      setErreurPlanning(`Affectation du devis impossible : ${error.message}`);
      return;
    }
    const fait = edDbe;
    setAffaires((liste) => liste.map((a) => (a.id === fait.id ? { ...a, responsable_id: fait.resp, echeance: fait.date } : a)));
    setEdDbe(null);
  }

  useEffect(() => {
    let actif = true;

    async function charger() {
      try {
        const [a, c, r, an, im, m, pl] = await Promise.all([
          chargerAffaires({ horsPlanning: true }),
          chargerCharges(),
          chargerRealise(),
          chargerAnnuaire(),
          chargerImputations(),
          chargerMoi(),
          chargerPlanifie(aujourdhuiISO()),
        ]);

        if (!actif) return;

        setAffaires(a);
        setCharges(c);
        setRealise(r);
        setAnnuaire(an);
        setImputations(im);
        setMoi(m);
        setPlanifies(planifieParAffaire(pl.affectations, pl.jours, aujourdhuiISO()));

        const act = await supabase.from("activites").select("id,nom,ordre_affichage");
        if (actif && !act.error) {
          setNomsActivites(
            new Map(((act.data ?? []) as { id: string; nom: string; ordre_affichage: number }[]).map((x) => [x.id, { nom: x.nom, ordre: x.ordre_affichage }]))
          );
        }

        // Client (nom abrégé) : vient du Suivi d'affaire BE. Absent si la synchro n'a jamais tourné.
        try {
          const [sl, sc] = await Promise.all([
            chargerTout<{ base_affaire: string | null; base_devis: string | null; genre: string; client_id: string }>((de, a) =>
              supabase.from("suivi_lignes").select("base_affaire,base_devis,genre,client_id").order("cle").range(de, a)
            ),
            chargerTout<{ id: string; nom_abrege: string }>((de, a) =>
              supabase.from("suivi_clients").select("id,nom_abrege").order("id").range(de, a)
            ),
          ]);
          if (!actif) return;
          const noms = new Map(sc.map((c) => [c.id, c.nom_abrege]));
          const cbe = new Map<string, string>();
          const dbe = new Map<string, string>();
          const devis = new Map<string, string>();
          for (const l of sl) {
            if (l.base_affaire && l.base_devis && (l.genre === "BASE" || !devis.has(l.base_affaire))) devis.set(l.base_affaire.replace(/^0+/, ""), l.base_devis);
            const nom = noms.get(l.client_id);
            if (!nom) continue;
            if (l.base_affaire && (l.genre === "BASE" || !cbe.has(l.base_affaire.replace(/^0+/, "")))) cbe.set(l.base_affaire.replace(/^0+/, ""), nom);
            if (l.base_devis && !dbe.has(l.base_devis)) dbe.set(l.base_devis, nom);
          }
          setClientsParAffaire({ cbe, dbe });
          setDevisParCbe(devis);
        } catch {
          /* pas de copie du classeur : la colonne Client reste vide */
        }
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Impossible de charger le portefeuille.");
      } finally {
        if (actif) setChargement(false);
      }
    }

    charger();

    return () => {
      actif = false;
    };
  }, []);

  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);
  const libellesImputation = useMemo(
    () => new Map(imputations.map((i) => [i.code, i.code])),
    [imputations]
  );

  const lignes: Ligne[] = useMemo(() => {
    const parAffaireCharges = chargesParAffaire(charges);
    const parAffaireRealise = indexParAffaire(realise);
    const aujourdhui = aujourdhuiISO();

    const brut: Ligne[] = affaires.map((affaire) => {
      // MONTANT_HORS_COMPARAISON : scan / négoce pointés sans chiffré correspondant : hors comparaison au chiffré
      const actChiffrees = new Set((parAffaireCharges.get(affaire.id) ?? []).filter((c) => (Number(c.heures) || 0) > 0).map((c) => c.activite_id));
      const totaux = totauxAffaire(
        parAffaireCharges.get(affaire.id) ?? [],
        (parAffaireRealise.get(cleAffaire(affaire.type, affaire.numero)) ?? []).filter(
          (r) => !(r.activite_id && !actChiffrees.has(r.activite_id) && estActiviteMontant(nomsActivites.get(r.activite_id)?.nom))
        )
      );

      const p = planifies.get(affaire.id) ?? { planifie: 0, fin: null, nb: 0 };
      const imputation = imputations.find((i) => i.code === affaire.imputation);
      const planning: PlanningAffaire = {
        ...p,
        chargeObligatoire: imputation ? imputation.charge_obligatoire !== false : true,
        planningActif: planifies.size > 0,
      };

      // Chiffré et réalisé par activité
      const detail = new Map<string, DetailActivite>();
      const ligneActivite = (id: string) => {
        if (!detail.has(id)) {
          const a = nomsActivites.get(id);
          detail.set(id, { id, nom: a?.nom ?? "Activité", ordre: a?.ordre ?? 999, chiffre: 0, realise: 0 });
        }
        return detail.get(id)!;
      };
      for (const c of parAffaireCharges.get(affaire.id) ?? []) {
        const d = ligneActivite(c.activite_id);
        d.chiffre += Number(c.heures) || 0;
        d.realise += Number(c.realise_initial) || 0;
      }
      for (const r of parAffaireRealise.get(cleAffaire(affaire.type, affaire.numero)) ?? []) {
        ligneActivite(r.activite_id ?? "?").realise += Number(r.heures) || 0;
      }
      const activites = [...detail.values()]
        .map((d) => (d.id === "?" ? { ...d, nom: "Sans activité" } : d))
        .sort((x, y) => x.ordre - y.ordre);

      // un avenant (1750R2) prend le client de sa commande de base (1750)
      const num = (affaire.numero.match(/^\d+/)?.[0] ?? affaire.numero).replace(/^0+/, "");
      const client = (affaire.type === "CBE" ? clientsParAffaire.cbe.get(num) : clientsParAffaire.dbe.get(num)) ?? null;

      return {
        affaire,
        client,
        activites,
        totaux,
        planning: p,
        etat: etatAffaire(affaire, totaux, aujourdhui, planning),
        aAffecter: totaux.reste - p.planifie,
      } as Ligne;
    });

    // ---------- Familles base + avenants (CBE1604, CBE1604R1…)
    const parBase = new Map<string, Ligne[]>();
    for (const l of brut) {
      if (l.affaire.type !== "CBE") continue;
      const base = l.affaire.numero.match(/^\d+/)?.[0];
      if (!base) continue;
      parBase.set(base, [...(parBase.get(base) ?? []), l]);
    }
    for (const [base, membres] of parBase) {
      const aDesAvenants = membres.some((m) => m.affaire.numero !== base);
      if (!aDesAvenants) continue;
      membres.sort((x, y) => x.affaire.numero.localeCompare(y.affaire.numero, "fr", { numeric: true }));
      // porteur du réalisé : la base si elle est encore active, sinon la première commande active
      // (une base livrée part dans les inactives alors que ses avenants continuent)
      const inactive = (a: AffaireP) => a.statut === "LIVREE" || a.statut === "ABANDONNEE";
      const actives = membres.filter((m) => !inactive(m.affaire));
      const laBase = membres.find((m) => m.affaire.numero === base);
      const porteur = laBase && !inactive(laBase.affaire) ? laBase : actives[0] ?? laBase ?? membres[0];
      const actFamille = new Set(membres.flatMap((m) => (parAffaireCharges.get(m.affaire.id) ?? []).filter((c) => (Number(c.heures) || 0) > 0).map((c) => c.activite_id)));
      const realiseFamille = totauxAffaire(
        [],
        (parAffaireRealise.get(cleAffaire("CBE", base)) ?? []).filter((r) => !(r.activite_id && !actFamille.has(r.activite_id) && estActiviteMontant(nomsActivites.get(r.activite_id)?.nom)))
      ).realise
        + membres.reduce((t, m) => t + (parAffaireCharges.get(m.affaire.id) ?? []).reduce((u, c) => u + (Number(c.realise_initial) || 0), 0), 0);
      const chiffreFamille = membres.filter((m) => m.affaire.statut !== "ABANDONNEE").reduce((t, m) => t + m.totaux.chiffre, 0);
      for (const m of membres) {
        // à mettre au planning : les heures de chaque commande, moins ce qui y est déjà affecté
        m.aAffecter = m.totaux.chiffre - m.planning.planifie;
        if (m === porteur) {
          m.totaux = {
            ...m.totaux,
            realise: realiseFamille,
            reste: Math.max(0, chiffreFamille - realiseFamille),
            depassement: chiffreFamille > 0 ? Math.max(0, realiseFamille - chiffreFamille) : 0,
            pourcent: chiffreFamille > 0 ? (realiseFamille / chiffreFamille) * 100 : null,
          };
          // FAMILLE_FLUIDE : le détail par activité porte sur toute la famille (le pointé est sur la base),
          // et « à affecter » = reste de la famille − ce qui est déjà planifié sur ses commandes
          const fusion = new Map<string, DetailActivite>();
          for (const x of membres) {
            if (x.affaire.statut === "ABANDONNEE") continue;
            for (const d of x.activites) {
              const f = fusion.get(d.id) ?? { ...d, chiffre: 0, realise: 0 };
              f.chiffre += d.chiffre;
              f.realise += d.realise;
              fusion.set(d.id, f);
            }
          }
          m.activites = [...fusion.values()].sort((a, b) => a.ordre - b.ordre);
          m.aAffecter = Math.max(0, m.totaux.reste - membres.reduce((t, x) => t + x.planning.planifie, 0));
          // FAMILLE_CHIFFRE : le chiffré de chaque commande de la famille, pour l'afficher
          m.famille = {
            numeros: membres.map((x) => x.affaire.numero),
            chiffre: chiffreFamille,
            detail: membres.filter((x) => x.affaire.statut !== "ABANDONNEE").map((x) => ({ numero: x.affaire.numero, chiffre: x.totaux.chiffre })),
          };
        } else {
          m.totaux = { ...m.totaux, realise: 0, reste: m.totaux.chiffre, depassement: 0, pourcent: null };
          m.dansFamille = porteur.affaire.numero;
        }
      }
    }
    return brut;
  }, [affaires, charges, realise, planifies, imputations, clientsParAffaire, nomsActivites]);

  const planningActif = planifies.size > 0;

  const estInactive = (a: AffaireP) => a.statut === "LIVREE" || a.statut === "ABANDONNEE";

  // Filtres communs aux deux tableaux (actives et inactives)
  const filtrees = useMemo(() => {
    const q = normaliser(recherche.trim());

    return lignes.filter(({ affaire, totaux, client, famille }) => {
      const prestation = affaire.imputation === "PE" || affaire.imputation === "PI";
      // pendant une recherche, tous types réunis (comme tous statuts)
      if (!q && (filtreType === "DBE" ? affaire.type !== "DBE" : affaire.type !== "CBE" || (filtreType === "PEPI") !== prestation)) return false;
      // RECHERCHE_DEVIS : on retrouve une commande par son n° de devis d'origine (DBE2835 ou 2835)
      const devisNum = affaire.type === "CBE" ? devisParCbe.get((affaire.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "")) : undefined;
      if (q && !normaliser(`${affaire.numero} ${famille?.numeros.join(" ") ?? ""} ${devisNum ? `dbe${devisNum} ${devisNum}` : ""} ${affaire.designation} ${client ?? ""}`).includes(q)) return false;
      if (filtreImputation && (affaire.imputation ?? "") !== filtreImputation) return false;
      if (filtreClient && (client ?? "") !== filtreClient) return false;
      if (filtreResp && affaire.responsable_id !== filtreResp) return false;
      if (depassementSeul && !(totaux.depassement > 0)) return false;
      return true;
    });
  }, [lignes, filtreType, recherche, filtreImputation, filtreClient, filtreResp, filtrePlanning, depassementSeul, dormantesSeules, dormantes, devisParCbe]);

  const trier = useCallback(
    (liste: Ligne[]) => {
      const valeur = (l: Ligne): string | number => {
        switch (tri.col) {
          case "numero": return Number(l.affaire.numero) || 0;
          case "designation": return normaliser(l.affaire.designation);
          case "client": return normaliser(l.client ?? "~");
          case "imputation": return l.affaire.imputation ?? "~";
          case "resp": return normaliser(nomCollab(collabs.get(l.affaire.responsable_id)));
          case "echeance": return l.affaire.echeance ?? "9999-12-31";
          case "chiffre": return l.totaux.chiffre;
          // PORTEFEUILLE_V2 : tri sur le % du chiffré consommé
          case "realise": {
            const ch = l.famille ? l.famille.chiffre : l.totaux.chiffre;
            return l.dansFamille ? -2 : ch > 0 ? l.totaux.realise / ch : -1;
          }
          case "reste": return l.totaux.reste;
        }
      };
      return [...liste].sort((x, y) => {
        const vx = valeur(x);
        const vy = valeur(y);
        const c = typeof vx === "number" && typeof vy === "number" ? vx - vy : String(vx).localeCompare(String(vy), "fr");
        return c * tri.sens || Number(y.affaire.numero) - Number(x.affaire.numero);
      });
    },
    [tri, collabs]
  );

  const actives = useMemo(
    () =>
      trier(
        // FAMILLE_UNE_LIGNE : une seule ligne par famille (celle qui porte le réalisé) ; les dormantes vont à part
        filtrees.filter(({ affaire, dansFamille }) => {
          if (dansFamille) return false;
          // pendant une recherche : livrées, abandonnées et sans activité comprises, dans ce seul tableau
          if (recherche.trim()) return true;
          if (dormantes.has(affaire.id)) return false;
          if (estInactive(affaire)) return false;
          if (filtreStatut === "EN_COURS") return affaire.statut === "EN_COURS";
          if (filtreStatut === "EN_ATTENTE") return affaire.statut === "EN_ATTENTE";
          return true;
        })
      ),
    [filtrees, filtreStatut, trier, dormantes, recherche]
  );

  const inactives = useMemo(() => trier(recherche.trim() ? [] : filtrees.filter(({ affaire, dansFamille }) => !dansFamille && estInactive(affaire))), [filtrees, trier, recherche]);
  const dormantesListe = useMemo(
    () => trier(recherche.trim() ? [] : filtrees.filter(({ affaire, dansFamille }) => !dansFamille && !estInactive(affaire) && dormantes.has(affaire.id))),
    [filtrees, trier, dormantes, recherche]
  );

  // Listes des menus de filtre (seulement les valeurs présentes)
  const choixClients = useMemo(
    () => [...new Set(lignes.map((l) => l.client).filter((c): c is string => Boolean(c)))].sort((x, y) => x.localeCompare(y, "fr")),
    [lignes]
  );
  const choixImputations = useMemo(
    () => [...new Set(lignes.map((l) => l.affaire.imputation).filter((c): c is string => Boolean(c)))].sort(),
    [lignes]
  );
  const choixResp = useMemo(() => {
    const ids = [...new Set(lignes.map((l) => l.affaire.responsable_id))];
    return ids
      .map((id) => ({ id, nom: nomCollab(collabs.get(id)) }))
      .sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
  }, [lignes, collabs]);

  const filtresActifs =
    filtreType !== "FORFAIT" || recherche !== "" || filtreImputation !== "" || filtreClient !== "" || filtreResp !== "" ||
    filtrePlanning !== "TOUS" || depassementSeul || filtreStatut !== "ACTIVES";

  function reinitialiserFiltres() {
    setFiltreType("FORFAIT");
    setRecherche("");
    setFiltreImputation("");
    setFiltreClient("");
    setFiltreResp("");
    setFiltrePlanning("TOUS");
    setDepassementSeul(false);
    setFiltreStatut("ACTIVES");
  }

  function changerTri(col: ColonneTri) {
    setTri((t) => (t.col === col ? { col, sens: t.sens === 1 ? -1 : 1 } : { col, sens: 1 }));
  }

  // TUILES_PORTEFEUILLE : des chiffres concrets, commandes et devis séparés
  const synthese = useMemo(() => {
    const aujourdhuiS = aujourdhuiISO();
    const prest = (a: AffaireP) => a.imputation === "PE" || a.imputation === "PI";
    const cbeEnCours = lignes.filter((l) => l.affaire.type === "CBE" && l.affaire.statut === "EN_COURS");
    const forfaits = cbeEnCours.filter((l) => !prest(l.affaire));
    const devis = lignes.filter((l) => l.affaire.type === "DBE" && l.affaire.statut === "EN_COURS");
    const intentions = lignes.filter((l) => l.affaire.type === "CBE" && l.affaire.statut === "EN_ATTENTE");
    // forfaits : chiffré et pointé des familles (le réalisé est porté par une seule ligne de la famille)
    const chiffre = forfaits.reduce((t, l) => t + (l.famille ? l.famille.chiffre : l.dansFamille ? 0 : l.totaux.chiffre), 0);
    const realise = forfaits.reduce((t, l) => t + (l.dansFamille ? 0 : l.totaux.realise), 0);
    const reste = forfaits.reduce((t, l) => t + (l.dansFamille ? 0 : l.totaux.reste), 0);
    const actives = lignes.filter((l) => l.affaire.statut === "EN_COURS" || l.affaire.statut === "EN_ATTENTE");
    const depasses = actives.filter((l) => l.totaux.depassement > 0);
    return {
      commandes: cbeEnCours.length,
      forfaits: forfaits.length,
      prestations: cbeEnCours.length - forfaits.length,
      devis: devis.length,
      devisRetard: devis.filter((l) => l.affaire.echeance && l.affaire.echeance < aujourdhuiS).length,
      intentions: intentions.length,
      reste,
      chiffre,
      realise,
      depassements: depasses.length,
      heuresDepassees: depasses.reduce((t, l) => t + l.totaux.depassement, 0),
      actives: actives.filter((l) => !l.dansFamille).length,
    };
  }, [lignes]);

  const alertes = useMemo(() => {
    // Une affaire hors planning n'est pas encore pilotée : pas d'alerte de planning pour elle.
    // seulement les affaires actives : une affaire livrée ou abandonnée n'alerte plus
    const actives = lignes.filter((l) => l.affaire.statut === "EN_COURS" || l.affaire.statut === "EN_ATTENTE");

    return {
      critiques: actives.filter((l) => l.etat.genre === "crit"),
      surveiller: actives.filter((l) => l.etat.genre === "warn"),
    };
  }, [lignes]);

  function LigneAlerte({ l }: { l: Ligne }) {
    return (
      <li style={{ fontSize: 14, lineHeight: 1.4 }}>
        <Link href={`/pilotage/affaire/${l.affaire.id}`} style={{ fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>
          {l.affaire.type} {l.affaire.numero}
        </Link>{" "}
        <span style={{ color: C.gris }}>— {l.etat.texte}</span>
      </li>
    );
  }

  const LIMITE_ALERTES = 6;

  function BlocAlertes({ titre, genre, liste, vide }: { titre: string; genre: Genre; liste: Ligne[]; vide: string }) {
    const montrees = toutesAlertes ? liste : liste.slice(0, LIMITE_ALERTES);
    return (
      <div style={{ flex: "1 1 360px", minWidth: 0 }}>
        <Pastille genre={genre}>
          {titre} · {liste.length}
        </Pastille>
        {liste.length === 0 ? (
          <p style={{ margin: "8px 0 0", fontSize: 14, color: C.gris }}>{vide}</p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: "8px 0 0",
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "6px 20px",
            }}
          >
            {montrees.map((l) => (
              <LigneAlerte key={l.affaire.id} l={l} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const alertesMasquees =
    Math.max(0, alertes.critiques.length - LIMITE_ALERTES) + Math.max(0, alertes.surveiller.length - LIMITE_ALERTES);



  // Tableau compact : chiffres et dates sur une seule ligne
  // PORTEFEUILLE_AERE : plus d'espace entre les colonnes
  const thNum: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap", padding: "12px 14px" };
  const tdNum: CSSProperties = { ...page.td, textAlign: "right", whiteSpace: "nowrap", padding: "12px 14px" };
  const thCourt: CSSProperties = { ...page.th, whiteSpace: "nowrap", padding: "12px 14px" };
  const tdCourt: CSSProperties = { ...page.td, whiteSpace: "nowrap", padding: "12px 14px" };

  const bouton = (actif: boolean): CSSProperties => ({
    background: actif ? C.rouge : "#ffffff",
    color: actif ? "#ffffff" : "#3b4046",
    border: `1.5px solid ${actif ? C.rouge : "#c9cdd2"}`,
    minHeight: 44,
    padding: "0 16px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "inherit",
    borderRadius: 8,
    cursor: "pointer",
  });

  const statutsFiltres: { valeur: FiltreStatut; libelle: string }[] = [
    { valeur: "ACTIVES", libelle: "Toutes les actives" },
    { valeur: "EN_COURS", libelle: "En cours" },
    { valeur: "EN_ATTENTE", libelle: "En attente" },
  ];

  const selectFiltre: CSSProperties = { ...page.entrees, width: "auto", minWidth: 150, maxWidth: 240 };

  function EnTeteTri({ col, libelle, num, centre }: { col: ColonneTri; libelle: string; num?: boolean; centre?: boolean }) {
    const actif = tri.col === col;
    return (
      <th style={centre ? { ...thNum, textAlign: "center" } : num ? thNum : thCourt} aria-sort={actif ? (tri.sens === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => changerTri(col)}
          title="Trier"
          style={{
            all: "unset",
            cursor: "pointer",
            color: actif ? C.rougeFonce : "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {libelle} {actif ? (tri.sens === 1 ? "↑" : "↓") : <span style={{ opacity: 0.35 }}>↕</span>}
        </button>
      </th>
    );
  }

  function basculerDetail(id: string) {
    setOuvertes((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const gris = (t: string) => <span style={{ color: C.gris }}>{t}</span>;
  const petit: CSSProperties = { fontSize: 12, color: C.gris, marginTop: 2 };

  function rendreTableau(liste: Ligne[]) {
    const nbColonnes = 8;
    return (
      <table className="portefeuille-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 15 }}>
        <thead className="portefeuille-entete">
          <tr>
            <EnTeteTri col="numero" libelle="N°" />
            <EnTeteTri col="designation" libelle="Descriptif" />
            <EnTeteTri col="client" libelle="Client" />
            <EnTeteTri col="resp" libelle="Resp." />
            <EnTeteTri col="echeance" libelle="Délai" />
            <EnTeteTri col="realise" libelle="Réalisé / Chiffré" centre />
            <th style={thNum} title="Reste à faire non encore affecté dans le planning">À affecter</th>
            <th style={thCourt}>État / planning</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((l) => {
            const { affaire, totaux, etat, planning, client } = l;
            const ouverte = ouvertes.has(affaire.id);
            const aAffecter = l.aAffecter;
            return (
              <Fragment key={affaire.id}>
                {/* INTENTION_SURLIGNEE : seul le n° d'une intention de commande est surligné, comme au relevé PE / PI */}
                <tr className="ligne-affaire">
                  <td style={tdCourt}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        aria-expanded={ouverte}
                        aria-label={`Détail par activité de ${affaire.type} ${affaire.numero}`}
                        onClick={() => basculerDetail(affaire.id)}
                        style={{ all: "unset", cursor: "pointer", width: 18, textAlign: "center", color: C.gris }}
                      >
                        {ouverte ? "▾" : "▸"}
                      </button>
                      <BadgeType type={affaire.type} />
                      <Link href={`/pilotage/affaire/${affaire.id}`} title={(affaire.statut === "EN_ATTENTE" || lignes.some((x) => x.dansFamille === affaire.numero && x.affaire.statut === "EN_ATTENTE")) ? (affaire.statut === "EN_ATTENTE" ? "Intention de commande : pas encore commandée" : "La famille contient une intention de commande (voir le détail ▸)") : undefined} style={{ fontWeight: 800, fontSize: 15, color: C.rougeFonce, ...((affaire.statut === "EN_ATTENTE" || lignes.some((x) => x.dansFamille === affaire.numero && x.affaire.statut === "EN_ATTENTE")) ? { background: "#ffe58a", borderRadius: 3, padding: "0 3px" } : {}) /* INTENTION_FAMILLE */ }}>
                        {affaire.numero}
                      </Link>
                      {/* VERS_PLANNING : ouvre l'affaire au planning, dépliée, sur ses affectations */}
                      {!estInactive(affaire) && (
                        <Link
                          href={`/pilotage/affaires?ouvrir=${affaire.id}`}
                          title="Voir cette affaire et ses affectations dans le planning"
                          aria-label={`Voir ${affaire.type} ${affaire.numero} dans le planning`}
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 5, color: C.gris, textDecoration: "none" }}
                        >
                          {/* PLANNING_SOBRE : petite icône de calendrier, grise */}
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="5" width="18" height="16" rx="2" />
                            <path d="M3 10h18M8 3v4M16 3v4" />
                          </svg>
                        </Link>
                      )}
                      {affaire.type === "CBE" && devisParCbe.get((affaire.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, "")) && (
                        <span title="Devis d'origine (Suivi d'affaire BE)" style={{ fontSize: 12, fontWeight: 700, color: C.gris }}>
                          DBE{devisParCbe.get((affaire.numero.match(/^\d+/)?.[0] ?? "").replace(/^0+/, ""))}
                        </span>
                      )}
                    </span>
                    <div style={{ ...petit, paddingLeft: 24 }}>
                      {affaire.imputation ? libellesImputation.get(affaire.imputation) ?? affaire.imputation : "—"}
                      {l.famille && (
                        <button
                          type="button"
                          onClick={() => basculerDetail(affaire.id)}
                          title={`Famille : ${l.famille.numeros.join(", ")}. Cliquer pour voir chaque commande.`}
                          style={{ all: "unset", cursor: "pointer", marginLeft: 6, padding: "0 6px", borderRadius: 999, border: "1px solid #9fb6cf", color: "#34506b", fontWeight: 800, fontSize: 11 }}
                        >
                          ⧉ {l.famille.numeros.length} commandes
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ ...page.td, padding: "12px 14px", minWidth: 150, maxWidth: 240, lineHeight: 1.35, fontWeight: 600 /* COLONNES_AJUSTEES */ }}>{affaire.designation}</td>
                  <td style={{ ...page.td, padding: "12px 14px", maxWidth: 170, color: "#4b5057", fontSize: 14 }}>{client ?? gris("—")}</td>
                  <td style={tdCourt}>
                    <strong>{nomCollab(collabs.get(affaire.responsable_id))}</strong>
                    {affaire.type === "DBE" && !estInactive(affaire) && edDbe?.id !== affaire.id && (
                      <button
                        type="button"
                        title="Choisir le rédacteur du devis et sa date cible de rendu"
                        onClick={() => setEdDbe({ id: affaire.id, resp: affaire.responsable_id, date: affaire.echeance ?? "" })}
                        style={{ all: "unset", cursor: "pointer", display: "block", fontSize: 12, fontWeight: 700, color: C.rougeFonce, marginTop: 2 }}
                      >
                        ✏️ affecter
                      </button>
                    )}
                  </td>
                  <td style={tdCourt}>
                    {formatDate(affaire.statut === "LIVREE" && affaire.date_livraison ? affaire.date_livraison : affaire.echeance)}
                    <div style={petit}>
                      {affaire.statut === "LIVREE" && affaire.date_livraison
                        ? "Livrée"
                        : affaire.echeance
                          ? affaire.type === "DBE"
                            ? "Remise"
                            : ""
                          : ""}
                    </div>
                  </td>
                  {/* PORTEFEUILLE_V2 : réalisé / chiffré, en une colonne, avec la barre */}
                  <td style={{ ...tdNum, minWidth: 190, textAlign: "center" }}>
                    {l.dansFamille ? (
                      <span title="Les heures sont pointées sur la commande de base : le réalisé de toute la famille y est affiché">
                        {gris(`dans ${l.dansFamille}`)}
                        <div style={petit}>chiffré {totaux.chiffre > 0 ? formatHeures(totaux.chiffre) : "—"}</div>
                      </span>
                    ) : (
                      (() => {
                        const ch = l.famille ? l.famille.chiffre : totaux.chiffre;
                        if (ch <= 0) return totaux.realise > 0 ? <span>{formatHeures(totaux.realise)} {gris("/ —")}</span> : gris("—");
                        const r = totaux.realise / ch;
                        const couleur = r > 1.0001 ? "#c62828" : r > 0.9 ? "#e08a00" : "#2e7d32";
                        const detail = l.famille ? (l.famille.detail ?? []).map((d) => `${d.numero} : ${formatHeures(d.chiffre)}`).join("\n") : "";
                        return (
                          <div title={`Réalisé ${formatHeures(totaux.realise)} sur ${formatHeures(ch)} chiffrées (${Math.round(r * 100)} %) · reste ${formatHeures(totaux.reste)}${detail ? `\n${detail}` : ""}`}>
                            <div>
                              <strong>{formatHeures(totaux.realise)}</strong> <span style={{ color: C.gris }}>/ {formatHeures(ch)}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <span style={{ flex: 1, height: 8, background: "#eceef1", borderRadius: 4, overflow: "hidden", display: "inline-block" }}>
                                <span style={{ display: "block", width: `${Math.min(100, r * 100)}%`, height: "100%", background: couleur }} />
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 800, minWidth: 36, textAlign: "right", color: r > 1.0001 ? C.rougeTexte : C.gris }}>{Math.round(r * 100)} %</span>
                            </div>
                            {l.famille && <div style={petit}>famille · {l.famille.numeros.length} commandes</div>}
                          </div>
                        );
                      })()
                    )}
                  </td>
                  <td style={tdNum}>
                    {!planningActif || totaux.chiffre <= 0 || estInactive(affaire) ? (
                      gris("—")
                    ) : aAffecter > toleranceAffectation(l.famille ? l.famille.chiffre : totaux.chiffre) ? (
                      <strong style={{ color: C.orangeTexte }}>{formatHeures(aAffecter)}</strong>
                    ) : (
                      <span title="Dans la tolérance (6 h au plus, 10 % du chiffré au plus) : pas d’alerte">{gris(aAffecter > 0.01 ? formatHeures(aAffecter) : "0 h")}</span>
                    )}
                    {planning.planifie > 0 && <div style={petit}>{formatHeures(planning.planifie)} planifiées</div>}
                  </td>
                  <td style={{ ...tdCourt, whiteSpace: "normal" }}>
                    <Pastille genre={etat.genre}>{etat.texte}</Pastille>
                    {dormantes.has(affaire.id) && (
                      <div style={{ ...petit, whiteSpace: "normal", marginTop: 4 }} title="Commande ouverte : aucune heure saisie au relevé depuis 3 mois">
                        💤 {libelleDormance(dormantes.get(affaire.id)!)}
                      </div>
                    )}
                  </td>
                </tr>
                {/* AFFECTER_DBE_V2 : le formulaire s'ouvre sur une ligne à part, sous le devis */}
                {edDbe?.id === affaire.id && (
                  <tr>
                    <td colSpan={nbColonnes} style={{ ...page.td, background: "#fff6fa", padding: "10px 16px 12px 40px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
                        <strong style={{ alignSelf: "center", color: "#a3245a" }}>DBE {affaire.numero} :</strong>
                        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>
                          Rédacteur
                          <select
                            value={edDbe.resp}
                            onChange={(e) => setEdDbe({ ...edDbe, resp: e.target.value })}
                            style={{ ...page.entrees, minHeight: 38, width: 240 }}
                          >
                            {[...annuaire]
                              .sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), "fr"))
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>
                          À rendre le
                          <input
                            type="date"
                            value={edDbe.date}
                            onChange={(e) => setEdDbe({ ...edDbe, date: e.target.value })}
                            style={{ ...page.entrees, minHeight: 38, width: 170 }}
                          />
                        </label>
                        <button type="button" onClick={() => void enregistrerDbe()} disabled={enregDbe} style={{ ...page.btnPrimaire, minHeight: 38 }}>
                          {enregDbe ? "Enregistrement…" : "Enregistrer"}
                        </button>
                        <button type="button" onClick={() => setEdDbe(null)} style={{ ...page.btnSecondaire, minHeight: 38 }}>
                          Annuler
                        </button>
                      </div>
                      {/* ERREUR_DBE_VISIBLE */}
                      {erreurPlanning && <div role="alert" style={{ color: "#b3261e", fontWeight: 700, marginTop: 8 }}>{erreurPlanning}</div>}
                    </td>
                  </tr>
                )}
                {ouverte && (
                  <tr>
                    <td colSpan={nbColonnes} style={{ ...page.td, background: "#fafbfc", padding: "10px 16px 14px 40px" }}>
                      {/* FAMILLE_DETAIL : chaque commande de la famille (base, avenants) */}
                      {l.famille &&
                        (() => {
                          const base = affaire.numero.match(/^\d+/)?.[0] ?? "";
                          const membres = lignes
                            .filter((x) => x.affaire.type === "CBE" && (x.affaire.numero.match(/^\d+/)?.[0] ?? "") === base)
                            .sort((x, y) => x.affaire.numero.localeCompare(y.affaire.numero, "fr", { numeric: true }));
                          const libStatut = (s: string) => (s === "EN_COURS" ? "En cours" : s === "EN_ATTENTE" ? "Intention" : s === "LIVREE" ? "Livrée" : "Abandonnée");
                          return (
                            <table style={{ borderCollapse: "collapse", fontSize: 14, marginBottom: 14 }}>
                              <caption style={{ textAlign: "left", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris, padding: "0 0 4px 8px" }}>
                                Les commandes de la famille
                              </caption>
                              <thead>
                                <tr>
                                  <th style={{ ...thCourt, background: "transparent" }}>Commande</th>
                                  <th style={{ ...thCourt, background: "transparent" }}>Statut</th>
                                  <th style={{ ...thCourt, background: "transparent" }}>Délai</th>
                                  <th style={{ ...thNum, background: "transparent" }}>Chiffré</th>
                                </tr>
                              </thead>
                              <tbody>
                                {membres.map((m) => (
                                  <tr key={m.affaire.id}>
                                    <td style={{ ...tdCourt, padding: "6px 8px" }}>
                                      <Link href={`/pilotage/affaire/${m.affaire.id}`} style={{ fontWeight: 800, color: C.rougeFonce, ...(m.affaire.statut === "EN_ATTENTE" ? { background: "#ffe58a", borderRadius: 3, padding: "0 3px" } : {}) }}>
                                        {m.affaire.numero}
                                      </Link>
                                    </td>
                                    <td style={{ ...tdCourt, padding: "6px 8px" }}>{libStatut(m.affaire.statut)}</td>
                                    <td style={{ ...tdCourt, padding: "6px 8px" }}>
                                      {formatDate(m.affaire.statut === "LIVREE" && m.affaire.date_livraison ? m.affaire.date_livraison : m.affaire.echeance)}
                                    </td>
                                    <td style={{ ...tdNum, padding: "6px 8px" }}>{m.totaux.chiffre > 0 ? formatHeures(m.totaux.chiffre) : gris("—")}</td>
                                  </tr>
                                ))}
                                <tr>
                                  <td colSpan={3} style={{ ...tdCourt, padding: "6px 8px", fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>
                                    Total de la famille · réalisé {formatHeures(totaux.realise)}
                                  </td>
                                  <td style={{ ...tdNum, padding: "6px 8px", fontWeight: 800, borderTop: `2px solid ${C.ligne}` }}>{formatHeures(l.famille.chiffre)}</td>
                                </tr>
                              </tbody>
                            </table>
                          );
                        })()}
                      {l.activites.length === 0 ? (
                        <span style={{ color: C.gris }}>
                          Aucune heure chiffrée par activité
                          {affaire.prestation_quantite ? ` (prestation : ${affaire.prestation_quantite} ${affaire.prestation_unite === "JOURS" ? "jours" : "h"} vendus)` : ""}.
                        </span>
                      ) : (
                        <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
                          {l.famille && (
                            <caption style={{ textAlign: "left", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris, padding: "0 0 4px 8px" }}>
                              Par activité, toute la famille
                            </caption>
                          )}
                          <thead>
                            <tr>
                              <th style={{ ...thCourt, background: "transparent" }}>Activité</th>
                              <th style={{ ...thNum, background: "transparent" }}>Chiffré</th>
                              <th style={{ ...thNum, background: "transparent" }}>Réalisé</th>
                              <th style={{ ...thNum, background: "transparent" }}>Reste</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.activites.map((d) => {
                              const reste = d.chiffre - d.realise;
                              return (
                                <tr key={d.id}>
                                  <td style={{ ...tdCourt, padding: "6px 8px" }}>{d.nom}</td>
                                  <td style={{ ...tdNum, padding: "6px 8px" }}>{d.chiffre > 0 ? formatHeures(d.chiffre) : gris("—")}</td>
                                  <td style={{ ...tdNum, padding: "6px 8px" }}>{d.realise > 0 ? formatHeures(d.realise) : gris("—")}</td>
                                  <td style={{ ...tdNum, padding: "6px 8px" }}>
                                    {d.chiffre <= 0 ? (
                                      gris("—")
                                    ) : reste < -0.01 ? (
                                      <strong style={{ color: C.rougeTexte }}>+{formatHeures(-reste)} dépassé</strong>
                                    ) : (
                                      formatHeures(reste)
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <main style={page.fond}>
      <EnTetePage section="Pilotage BE" />
      <OngletsPilotage actif="portefeuille" />
      {/* l'en-tête du tableau reste visible, juste sous les onglets (49 px) */}
      <style>{`
        .portefeuille-table tr.ligne-affaire > td {
          padding-top: 14px !important;
          padding-bottom: 14px !important;
          vertical-align: middle;
          border-bottom: 1px solid #e3e6ea;
        }
        .portefeuille-table tr.ligne-affaire:hover > td {
          background: #f6f8fb;
        }
        .portefeuille-entete th {
          position: sticky;
          top: 49px;
          z-index: 5;
          background: #f4f5f7;
          box-shadow: inset 0 -2px 0 #d5d9de;
        }
      `}</style>

      <div style={{ ...page.contenu, maxWidth: 1500 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={page.titre}>Portefeuille des affaires</h1>
            <p style={page.sousTitre}>
              Affaires DBE et CBE : chiffré, réalisé et dépassements. Réservé aux responsables et aux administrateurs.
            </p>
          </div>

        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {chargement && !erreur && <Message genre="info">Chargement du portefeuille…</Message>}

        {!chargement && !erreur && (
          <>
            {/* TUILES_DYNAMIQUES : les vignettes suivent le bouton Forfait / PE-PI / DBE, sur une seule ligne */}
            {(() => {
              const aujourdhuiS = aujourdhuiISO();
              const prest = (a: AffaireP) => a.imputation === "PE" || a.imputation === "PI";
              const tuiles: { libelle: string; valeur: string; sous: string; accent?: boolean }[] = [];
              if (filtreType === "FORFAIT") {
                const f = lignes.filter((l) => l.affaire.type === "CBE" && !prest(l.affaire));
                const enCours = f.filter((l) => l.affaire.statut === "EN_COURS");
                const familles = enCours.filter((l) => !l.dansFamille);
                const intentions = f.filter((l) => l.affaire.statut === "EN_ATTENTE");
                const chiffre = familles.reduce((t, l) => t + (l.famille ? l.famille.chiffre : l.totaux.chiffre), 0);
                const pointe = familles.reduce((t, l) => t + l.totaux.realise, 0);
                const reste = familles.reduce((t, l) => t + l.totaux.reste, 0);
                const dep = f.filter((l) => (l.affaire.statut === "EN_COURS" || l.affaire.statut === "EN_ATTENTE") && !l.dansFamille && l.totaux.depassement > 0);
                tuiles.push(
                  { libelle: "Forfaits en cours", valeur: String(enCours.length), sous: `commandes et avenants · ${familles.length} famille${familles.length > 1 ? "s" : ""}` },
                  { libelle: "Intentions de commande", valeur: String(intentions.length), sous: "pas encore commandées : travail à risque, à relancer", accent: intentions.length > 0 },
                  {
                    libelle: "Reste à faire",
                    valeur: formatHeures(reste),
                    sous: chiffre > 0 ? `${Math.round((reste / chiffre) * 100)} % du chiffré · ${formatHeures(pointe)} pointées sur ${formatHeures(chiffre)}` : "chiffré − pointé",
                  },
                  {
                    libelle: "Dépassements",
                    valeur: String(dep.length),
                    sous: dep.length > 0 ? `${formatHeures(dep.reduce((t, l) => t + l.totaux.depassement, 0))} au-delà du chiffré` : "aucun forfait au-delà du chiffré",
                    accent: dep.length > 0,
                  }
                );
              } else if (filtreType === "PEPI") {
                const p = lignes.filter((l) => l.affaire.type === "CBE" && prest(l.affaire));
                const enCours = p.filter((l) => l.affaire.statut === "EN_COURS");
                const attente = p.filter((l) => l.affaire.statut === "EN_ATTENTE");
                const dorm = p.filter((l) => !estInactive(l.affaire) && dormantes.has(l.affaire.id));
                tuiles.push(
                  {
                    libelle: "PE / PI en cours",
                    valeur: String(enCours.length),
                    sous: `${enCours.filter((l) => l.affaire.imputation === "PE").length} PE · ${enCours.filter((l) => l.affaire.imputation === "PI").length} PI (commandes et avenants)`,
                  },
                  { libelle: "En attente de commande", valeur: String(attente.length), sous: "intention, ou enveloppe épuisée : commande à obtenir", accent: attente.length > 0 },
                  { libelle: "Sans activité depuis 3 mois", valeur: String(dorm.length), sous: "commandes ouvertes sans heure au relevé : à relancer", accent: dorm.length > 0 }
                );
              } else {
                const d = lignes.filter((l) => l.affaire.type === "DBE" && l.affaire.statut === "EN_COURS");
                const retard = d.filter((l) => l.affaire.echeance && l.affaire.echeance < aujourdhuiS);
                const sansDate = d.filter((l) => !l.affaire.echeance);
                tuiles.push(
                  { libelle: "Devis à rendre", valeur: String(d.length), sous: "devis en cours de rédaction" },
                  { libelle: "En retard", valeur: String(retard.length), sous: retard.length > 0 ? "date de rendu dépassée" : "aucun devis en retard", accent: retard.length > 0 },
                  { libelle: "Sans date de rendu", valeur: String(sansDate.length), sous: "à affecter (✏️ dans la liste)", accent: sansDate.length > 0 },
                  { libelle: "Heures passées", valeur: formatHeures(d.reduce((t, l) => t + l.totaux.realise, 0)), sous: "sur les devis en cours" }
                );
              }
              return (
                <div style={{ display: "flex", flexWrap: "nowrap", gap: 14, marginBottom: 20, overflowX: "auto" }}>
                  {tuiles.map((t) => (
                    <div key={t.libelle} style={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
                      <Tuile libelle={t.libelle} valeur={t.valeur} sous={t.sous} accent={t.accent} />
                    </div>
                  ))}
                </div>
              );
            })()}

            {(alertes.critiques.length > 0 || alertes.surveiller.length > 0) && (
              <section style={{ ...page.carte, padding: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Alertes</h2>
                  <span style={{ fontSize: 13, color: C.gris }}>Le logiciel calcule et alerte. Le responsable décide.</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                  <BlocAlertes titre="Critique" genre="crit" liste={alertes.critiques} vide="Aucune alerte critique." />
                  <BlocAlertes titre="À surveiller" genre="warn" liste={alertes.surveiller} vide="Rien à signaler." />
                </div>
                {(alertesMasquees > 0 || toutesAlertes) && (
                  <button
                    type="button"
                    onClick={() => setToutesAlertes((v) => !v)}
                    style={{ ...page.btnSecondaire, minHeight: 36, marginTop: 12, fontSize: 14 }}
                  >
                    {toutesAlertes ? "Réduire" : `Voir les ${alertesMasquees} autres alertes`}
                  </button>
                )}
              </section>
            )}

            <section style={{ ...page.carte, padding: 16 }}>
              {/* ---------- Filtres ---------- */}
              {/* FILTRES_SIMPLES : forfait / PE-PI / devis, et la recherche ; toujours toutes les affaires actives */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
                {(
                  [
                    ["FORFAIT", "Forfait"],
                    ["PEPI", "PE / PI"],
                    ["DBE", "DBE"],
                  ] as [FiltreType, string][]
                ).map(([t, libelle]) => (
                  <button key={t} type="button" aria-pressed={filtreType === t} style={bouton(filtreType === t)} onClick={() => setFiltreType(t)}>
                    {libelle}
                  </button>
                ))}
                <span style={{ width: 8 }} />
                <input
                  type="search"
                  aria-label="Rechercher une affaire"
                  placeholder="Rechercher : n° de commande ou de devis (DBE), descriptif, client…"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  style={{ ...page.entrees, maxWidth: 380, minHeight: 44 }}
                />
                {recherche && (
                  <button type="button" onClick={() => setRecherche("")} style={{ ...page.btnSecondaire, minHeight: 40, fontSize: 14 }}>
                    Effacer la recherche
                  </button>
                )}
              </div>

              {erreurPlanning && <Message genre="erreur">{erreurPlanning}</Message>}

              {/* ---------- Affaires actives ---------- */}
              <h2 style={{ margin: "8px 0", fontSize: 18 }}>
                {recherche.trim() ? "Résultats de la recherche, tous statuts" : "Affaires actives"} <span style={{ color: C.gris, fontWeight: 600 }}>({actives.length})</span>
              </h2>
              {actives.length === 0 ? (
                <p style={{ color: C.gris, padding: "8px 4px" }}>
                  {affaires.length === 0 ? "Aucune affaire pour le moment." : "Aucune affaire active ne correspond à ces filtres."}
                </p>
              ) : (
                rendreTableau(actives)
              )}

              {/* DORMANTES_RUBRIQUE : PE / PI ouvertes sans activité, regroupées et repliées */}
              {dormantesListe.length > 0 && (
                <div style={{ marginTop: 20, borderTop: `1px solid ${C.ligne}`, paddingTop: 12 }}>
                  <button
                    type="button"
                    aria-expanded={dormantesSeules}
                    onClick={() => setDormantesSeules((v) => !v)}
                    style={{ all: "unset", cursor: "pointer", fontSize: 18, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, flexWrap: "wrap" }}
                  >
                    <span aria-hidden="true">{dormantesSeules ? "▾" : "▸"}</span>
                    💤 Commandes ouvertes sans activité <span style={{ color: C.gris, fontWeight: 600 }}>({dormantesListe.length})</span>
                    <span style={{ fontSize: 13, fontWeight: 400, color: C.gris }}>PE / PI sans heure saisie depuis 3 mois : des clients à relancer</span>
                  </button>
                  {dormantesSeules && <div style={{ marginTop: 8 }}>{rendreTableau(dormantesListe)}</div>}
                </div>
              )}

              {/* ---------- Affaires inactives (livrées, abandonnées) ---------- */}
              <div style={{ marginTop: 20, borderTop: `1px solid ${C.ligne}`, paddingTop: 12 }}>
                <button
                  type="button"
                  aria-expanded={inactivesOuvertes}
                  onClick={() => setInactivesOuvertes((v) => !v)}
                  style={{ all: "unset", cursor: "pointer", fontSize: 18, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40 }}
                >
                  <span aria-hidden="true">{inactivesOuvertes ? "▾" : "▸"}</span>
                  Affaires inactives <span style={{ color: C.gris, fontWeight: 600 }}>({inactives.length})</span>
                  <span style={{ fontSize: 13, fontWeight: 400, color: C.gris }}>livrées ou abandonnées</span>
                </button>
                {inactivesOuvertes &&
                  (inactives.length === 0 ? (
                    <p style={{ color: C.gris, padding: "8px 4px" }}>Aucune affaire inactive ne correspond à ces filtres.</p>
                  ) : (
                    <div style={{ marginTop: 8 }}>{rendreTableau(inactives)}</div>
                  ))}
              </div>

              <p style={{ margin: "12px 4px 0", fontSize: 13, color: C.gris }}>
                Chiffré : heures prévues par activité. Réalisé : heures imputées dans les feuilles d’heures sur le numéro de
                l’affaire. Cliquez sur un titre de colonne pour trier, sur ▸ pour le détail par activité. Une affaire inactive peut être remise au planning (reprise
                chez le client) : elle reste dans les inactives tant que son statut est « Livrée ».
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function PortefeuillePage() {
  return (
    <GardeAcces droit="piloterBE">
      <PortefeuilleContenu />
    </GardeAcces>
  );
}
