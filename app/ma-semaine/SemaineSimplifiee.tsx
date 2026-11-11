"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { peut } from "@/lib/droits";
import EnTetePage from "@/components/EnTetePage";

/* ===============================================================
   MA SEMAINE - FEUILLE SIMPLIFIÉE (FEUILLE_SIMPLIFIEE, SQL 96)

   Pour qui ne pointe jamais sur une affaire ni un devis : chaque jour,
   la présence (présentiel, télétravail), l'absence éventuelle (CP, RTT,
   RE, maladie…) et le ticket restaurant. Aucune heure à imputer.

   Mêmes règles que la feuille complète pour les absences : jour férié
   automatique, RE en heures (débitées du compteur), CP / RTT à la
   journée ou à la demi-journée (3 h à 4,5 h), absences en heures (VM,
   AI, AA). « Enregistrer le brouillon », puis « Envoyer aux RH ».
   La feuille est enregistrée avec 0 h saisie pour 0 h attendue : la
   fonction de validation l'accepte, les pages RH la comptent envoyée.
================================================================ */

type Presence = "PRESENTIEL" | "TELETRAVAIL" | "ABSENT";
type Duree = "JOURNEE" | "DEMI_JOURNEE";
type CodeAbs = { code: string; libelle: string; categorie: string };
type Jour = {
  date: string;
  nom: string;
  ferie: boolean;
  theo: number;
  presence: Presence;
  absence: string;
  dureeRTT: Duree;
  dureeCP: Duree;
  heuresRE: string;
  heuresAbsence: string;
  ticket: boolean;
};
type Collab = { id: string; trigramme: string | null; prenom: string | null; nom: string | null; profil_horaire_id: string | null; compteur_recuperation: number | null };

const CODE_RE = "RE";
const CODE_RT = "RT";
const CODE_CP = "CP";
const EN_HEURES = new Set(["VM", "AI", "AA"]);

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusJours = (jour: string, n: number) => {
  const [a, m, j] = jour.split("-").map(Number);
  return iso(new Date(a, m - 1, j + n));
};
const lundiDe = (jour: string) => {
  const [a, m, j] = jour.split("-").map(Number);
  const d = new Date(a, m - 1, j);
  const js = d.getDay();
  d.setDate(d.getDate() + (js === 0 ? -6 : 1 - js));
  return iso(d);
};
const num = (v: string) => {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};
const fmt = (v: number) => (Math.round(v * 100) / 100).toLocaleString("fr-FR");
const normCode = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
const exercice = (jour: string) => (Number(jour.slice(5, 7)) >= 11 ? Number(jour.slice(0, 4)) : Number(jour.slice(0, 4)) - 1);

function semaineISO(jour: string) {
  const d = new Date(`${jour}T00:00:00`);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const s1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - s1.getTime()) / 86400000 - 3 + ((s1.getDay() + 6) % 7)) / 7);
}

function feries(annee: number) {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  const paques = new Date(annee, mois - 1, jour);
  const p = (n: number) => iso(new Date(paques.getFullYear(), paques.getMonth(), paques.getDate() + n));
  return new Set([`${annee}-01-01`, p(1), `${annee}-05-01`, `${annee}-05-08`, p(39), p(50), `${annee}-07-14`, `${annee}-08-15`, `${annee}-11-01`, `${annee}-11-11`, `${annee}-12-25`]);
}

const NOMS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

function semaineVide(lundi: string, horaires: number[]): Jour[] {
  const fe = feries(Number(lundi.slice(0, 4)));
  const fe2 = feries(Number(plusJours(lundi, 4).slice(0, 4)));
  return NOMS.map((nom, k) => {
    const date = plusJours(lundi, k);
    const ferie = fe.has(date) || fe2.has(date);
    return { date, nom, ferie, theo: horaires[k] ?? 0, presence: ferie ? "ABSENT" : "PRESENTIEL", absence: "", dureeRTT: "JOURNEE", dureeCP: "JOURNEE", heuresRE: "", heuresAbsence: "", ticket: !ferie };
  });
}

export default function SemaineSimplifiee() {
  const params = useSearchParams();
  const collabUrl = params.get("collaborateur");
  const [lundi, setLundi] = useState(() => lundiDe(params.get("semaine") ?? iso(new Date())));
  const [collab, setCollab] = useState<Collab | null>(null);
  const [mode, setMode] = useState<"MOI" | "ADMIN" | "CONSULTATION">("MOI");
  const [codes, setCodes] = useState<CodeAbs[]>([]);
  const [horaires, setHoraires] = useState<number[]>([7.5, 7.5, 7.5, 7.5, 5]);
  const [jours, setJours] = useState<Jour[]>([]);
  const [statut, setStatut] = useState<"NOUVELLE" | "BROUILLON" | "A_TRAITER">("NOUVELLE");
  const [verrouillee, setVerrouillee] = useState(false);
  const [compteurAvant, setCompteurAvant] = useState(0);
  const [modifiee, setModifiee] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; ok: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [conges, setConges] = useState<{ type_demande: string; date_debut: string; date_fin: string; heures_re: number | null }[]>([]);

  const lectureSeule = mode === "CONSULTATION" || (mode === "MOI" && (statut === "A_TRAITER" || verrouillee));

  /* qui, ses droits, les codes d'absence */
  useEffect(() => {
    let actif = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }
      const { data: moi } = await supabase.from("collaborateurs").select("id,role").eq("auth_user_id", user.id).maybeSingle();
      const role = String(moi?.role ?? "");
      let m: "MOI" | "ADMIN" | "CONSULTATION" = "MOI";
      if (collabUrl && collabUrl !== moi?.id) {
        if (role.trim().toUpperCase() === "ADMIN") m = "ADMIN";
        else if (peut(role, "voirFeuillesEquipe")) m = "CONSULTATION";
        else {
          setMessage({ texte: "Vous n’avez pas accès à la feuille d’un autre collaborateur.", ok: false });
          setChargement(false);
          return;
        }
      }
      const req = supabase.from("collaborateurs").select("id,trigramme,prenom,nom,profil_horaire_id,compteur_recuperation");
      const { data: c } = collabUrl ? await req.eq("id", collabUrl).maybeSingle() : await req.eq("auth_user_id", user.id).maybeSingle();
      const { data: cd } = await supabase.from("codes_imputation").select("code,libelle,categorie").eq("actif", true).eq("historique_uniquement", false).order("ordre_affichage", { ascending: true, nullsFirst: false });
      if (!actif) return;
      setMode(m);
      setCollab((c ?? null) as Collab | null);
      setCodes(((cd ?? []) as CodeAbs[]).filter((x) => (x.categorie === "ABSENCE" || x.categorie === "HORS_BILAN") && normCode(x.code) !== "FE"));
    })();
    return () => {
      actif = false;
    };
  }, [collabUrl]);

  const absenceTotale = useCallback(
    (j: Pick<Jour, "absence" | "dureeRTT" | "dureeCP">) => {
      const a = normCode(j.absence);
      if (!a || a === CODE_RE || EN_HEURES.has(a)) return false;
      if (a === CODE_RT) return j.dureeRTT === "JOURNEE";
      if (a === CODE_CP) return j.dureeCP === "JOURNEE";
      const cfg = codes.find((x) => normCode(x.code) === a);
      return cfg?.categorie === "ABSENCE" || cfg?.categorie === "HORS_BILAN";
    },
    [codes]
  );

  /* compteur avant la semaine : la dernière feuille envoyée, sinon le compteur initial de l'exercice */
  const compteurAvantSemaine = useCallback(
    async (c: Collab, semaine: string) => {
      const { data: prec } = await supabase
        .from("feuilles_heures")
        .select("compteur_apres")
        .eq("collaborateur_id", c.id)
        .eq("statut", "A_TRAITER")
        .lt("semaine_debut", semaine)
        .order("semaine_debut", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prec?.compteur_apres !== null && prec?.compteur_apres !== undefined) return Number(prec.compteur_apres) || 0;
      const { data: d } = await supabase.from("rh_droits").select("compteur_recuperation_initial").eq("collaborateur_id", c.id).eq("exercice", exercice(semaine)).maybeSingle();
      return d?.compteur_recuperation_initial !== null && d?.compteur_recuperation_initial !== undefined ? Number(d.compteur_recuperation_initial) || 0 : Number(c.compteur_recuperation ?? 0) || 0;
    },
    []
  );

  /* la semaine : rythme, feuille existante, congés validés */
  useEffect(() => {
    if (!collab) return;
    let actif = true;
    setChargement(true);
    setMessage(null);
    void (async () => {
      try {
        let profilId = collab.profil_horaire_id;
        const { data: hist } = await supabase
          .from("historique_profils_horaires")
          .select("profil_horaire_id")
          .eq("collaborateur_id", collab.id)
          .lte("date_debut", lundi)
          .or(`date_fin.is.null,date_fin.gte.${lundi}`)
          .order("date_debut", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (hist?.profil_horaire_id) profilId = hist.profil_horaire_id;
        let h = [7.5, 7.5, 7.5, 7.5, 5];
        if (profilId) {
          const { data: p } = await supabase.from("profils_horaires").select("lundi,mardi,mercredi,jeudi,vendredi").eq("id", profilId).maybeSingle();
          if (p) h = [p.lundi, p.mardi, p.mercredi, p.jeudi, p.vendredi].map((x) => Number(x) || 0);
        }
        const base = semaineVide(lundi, h);
        const { data: f } = await supabase.from("feuilles_heures").select("id,statut,verrouillee,compteur_avant").eq("collaborateur_id", collab.id).eq("semaine_debut", lundi).maybeSingle();
        let st: "NOUVELLE" | "BROUILLON" | "A_TRAITER" = "NOUVELLE";
        let avant: number;
        if (f) {
          st = f.statut === "A_TRAITER" ? "A_TRAITER" : "BROUILLON";
          avant = Number(f.compteur_avant ?? 0) || 0;
          const { data: js } = await supabase.from("feuilles_heures_jours").select("*").eq("feuille_id", f.id);
          for (const j of base) {
            const x = ((js ?? []) as Record<string, unknown>[]).find((y) => y.date_jour === j.date);
            if (!x) continue;
            const abs = normCode(x.absence);
            j.absence = abs === "FE" ? "" : abs === "RTT" ? CODE_RT : abs;
            j.presence = j.ferie ? "ABSENT" : ((x.presence as Presence) ?? "PRESENTIEL");
            j.dureeRTT = (x.duree_rtt as Duree) ?? "JOURNEE";
            j.dureeCP = (x.duree_cp as Duree) ?? "JOURNEE";
            j.heuresRE = Number(x.heures_re) ? String(x.heures_re).replace(".", ",") : "";
            j.heuresAbsence = Number(x.heures_absence) ? String(x.heures_absence).replace(".", ",") : "";
            j.ticket = Boolean(x.ticket_restaurant);
          }
        } else avant = await compteurAvantSemaine(collab, lundi);
        const { data: dem } = await supabase
          .from("rh_demandes")
          .select("type_demande,date_debut,date_fin,heures_re")
          .eq("collaborateur_id", collab.id)
          .in("statut", ["VALIDEE", "ENVOYEE_RH"])
          .lte("date_debut", plusJours(lundi, 4))
          .gte("date_fin", lundi);
        if (!actif) return;
        setHoraires(h);
        setJours(base);
        setStatut(st);
        setVerrouillee(Boolean(f?.verrouillee));
        setCompteurAvant(avant);
        setConges((dem ?? []) as typeof conges);
        setModifiee(false);
      } catch (e) {
        if (actif) setMessage({ texte: e instanceof Error ? e.message : "Chargement impossible.", ok: false });
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [collab, lundi, compteurAvantSemaine]);

  useEffect(() => {
    const avertir = (e: BeforeUnloadEvent) => {
      if (modifiee && !lectureSeule) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [modifiee, lectureSeule]);

  function changer(date: string, patch: Partial<Jour>) {
    if (lectureSeule) return;
    setJours((liste) =>
      liste.map((j) => {
        if (j.date !== date) return j;
        const n = { ...j, ...patch };
        // la présence et le ticket suivent l'absence
        if ("absence" in patch || "dureeRTT" in patch || "dureeCP" in patch || "heuresRE" in patch) {
          const totale = absenceTotale(n);
          const reEntiere = normCode(n.absence) === CODE_RE && n.theo > 0 && num(n.heuresRE) >= n.theo - 0.01;
          if (totale || reEntiere) {
            n.presence = "ABSENT";
            n.ticket = false;
          } else if (n.presence === "ABSENT") {
            n.presence = "PRESENTIEL";
            n.ticket = true;
          }
          if ("absence" in patch) {
            if (normCode(n.absence) !== CODE_RE) n.heuresRE = "";
            if (!(EN_HEURES.has(normCode(n.absence)) || normCode(n.absence) === CODE_CP || normCode(n.absence) === CODE_RT)) n.heuresAbsence = "";
            if (normCode(n.absence) !== CODE_CP) n.dureeCP = "JOURNEE";
            if (normCode(n.absence) !== CODE_RT) n.dureeRTT = "JOURNEE";
          }
        }
        return n;
      })
    );
    setModifiee(true);
    setMessage(null);
  }

  /* congés validés dans l'espace RH, pas encore reportés sur la feuille */
  const propositions = useMemo(() => {
    const p: { date: string; patch: Partial<Jour> }[] = [];
    for (const d of conges) {
      const t = d.type_demande;
      if (t === "RE") {
        const j = jours.find((x) => x.date === d.date_debut);
        if (j && !j.ferie && !j.absence && Number(d.heures_re) > 0) p.push({ date: j.date, patch: { absence: CODE_RE, heuresRE: String(d.heures_re).replace(".", ",") } });
        continue;
      }
      if (t !== "CP" && t !== "RTT") continue;
      for (const j of jours)
        if (!j.ferie && !j.absence && j.date >= d.date_debut && j.date <= d.date_fin) p.push({ date: j.date, patch: { absence: t === "RTT" ? CODE_RT : CODE_CP } });
    }
    return p;
  }, [conges, jours]);

  const totalRE = jours.reduce((t, j) => t + (normCode(j.absence) === CODE_RE ? num(j.heuresRE) : 0), 0);
  const tickets = jours.filter((j) => j.ticket).length;

  function controler(): string | null {
    for (const j of jours) {
      const a = normCode(j.absence);
      const libelle = `${j.nom} ${j.date.slice(8)}/${j.date.slice(5, 7)}`;
      if (a === CODE_RE) {
        if (num(j.heuresRE) <= 0) return `${libelle} : indiquez les heures de récupération (RE).`;
        if (num(j.heuresRE) > j.theo + 0.01) return `${libelle} : la récupération ne peut pas dépasser ${fmt(j.theo)} h.`;
      }
      if ((a === CODE_CP && j.dureeCP === "DEMI_JOURNEE") || (a === CODE_RT && j.dureeRTT === "DEMI_JOURNEE")) {
        const h = num(j.heuresAbsence);
        if (h < 3 || h > 4.5) return `${libelle} : une demi-journée compte entre 3 h et 4,5 h (en général 3,5 h ou 4 h).`;
      }
      if (EN_HEURES.has(a)) {
        if (num(j.heuresAbsence) <= 0) return `${libelle} : indiquez les heures d’absence (${a}).`;
        if (num(j.heuresAbsence) > j.theo + 0.01) return `${libelle} : l’absence ne peut pas dépasser ${fmt(j.theo)} h.`;
      }
    }
    return null;
  }

  async function enregistrer(envoi: boolean) {
    if (!collab || lectureSeule) return;
    const pb = controler();
    if (pb) return setMessage({ texte: pb, ok: false });
    setEnCours(true);
    setMessage(null);
    try {
      const avant = await compteurAvantSemaine(collab, lundi);
      const { data: ex, error: ee } = await supabase
        .from("feuilles_heures")
        .select("id,statut,mode_heures_supplementaires,compteur_regularisation")
        .eq("collaborateur_id", collab.id)
        .eq("semaine_debut", lundi)
        .maybeSingle();
      if (ee) throw ee;
      if (ex?.statut === "A_TRAITER" && mode !== "ADMIN") throw new Error("Cette semaine est déjà envoyée aux RH : elle n’est plus modifiable.");
      const statutFinal = ex?.statut === "A_TRAITER" ? "A_TRAITER" : "BROUILLON";
      const regul = Number(ex?.compteur_regularisation ?? 0) || 0;
      const compte = envoi || statutFinal === "A_TRAITER";
      const apres = (compte ? avant - totalRE : avant) + regul;
      if (compte && apres < -30) throw new Error(`Le compteur de récupération atteindrait ${fmt(apres)} h : la limite basse est de −30 h.`);

      const donnees = {
        statut: statutFinal,
        total_heures: 0,
        total_theorique: 0,
        heures_supplementaires: 0,
        mode_heures_supplementaires: ex?.mode_heures_supplementaires ?? "PAYE",
        total_re: totalRE,
        compteur_avant: avant,
        compteur_apres: apres,
        cloture_mensuelle: false,
        heures_supplementaires_a_repartir: 0,
        heures_supplementaires_compteur: 0,
        heures_supplementaires_payees: 0,
        updated_at: new Date().toISOString(),
      };

      let feuilleId: string;
      if (ex) {
        feuilleId = ex.id;
        const { data: anciens } = await supabase.from("feuilles_heures_jours").select("id").eq("feuille_id", feuilleId);
        const ids = (anciens ?? []).map((x) => x.id as string);
        if (ids.length) {
          const { error: e1 } = await supabase.from("feuilles_heures_imputations").delete().in("jour_id", ids);
          if (e1) throw e1;
        }
        const { error: e2 } = await supabase.from("feuilles_heures_jours").delete().eq("feuille_id", feuilleId);
        if (e2) throw e2;
        const { error: e3 } = await supabase.from("feuilles_heures").update(donnees).eq("id", feuilleId);
        if (e3) throw e3;
      } else {
        const { data: nv, error: e4 } = await supabase
          .from("feuilles_heures")
          .insert({ collaborateur_id: collab.id, semaine_debut: lundi, date_debut_semaine: lundi, ...donnees, verrouillee: false, verrouillee_le: null, verrouillee_par: null })
          .select("id")
          .single();
        if (e4 || !nv) throw e4 ?? new Error("La feuille n’a pas pu être créée.");
        feuilleId = nv.id as string;
      }

      const { error: e5 } = await supabase.from("feuilles_heures_jours").insert(
        jours.map((j) => ({
          feuille_id: feuilleId,
          date_jour: j.date,
          heures_theoriques: j.theo,
          presence: j.presence,
          absence: j.ferie ? "FE" : normCode(j.absence),
          duree_rtt: j.dureeRTT,
          heures_re: normCode(j.absence) === CODE_RE ? num(j.heuresRE) : 0,
          heures_absence: num(j.heuresAbsence),
          duree_cp: j.dureeCP,
          ticket_restaurant: j.ticket,
          total_heures: 0,
        }))
      );
      if (e5) throw e5;

      if (envoi && statutFinal === "BROUILLON") {
        const { error: e6 } = await supabase.rpc("valider_feuille_heures", { p_feuille_id: feuilleId });
        if (e6) throw e6;
      }

      // une semaine envoyée : les compteurs des semaines envoyées suivantes sont recalculés
      if (compte) {
        const { data: suivantes, error: e7 } = await supabase
          .from("feuilles_heures")
          .select("id,heures_supplementaires,mode_heures_supplementaires,total_re,cloture_mensuelle,heures_supplementaires_compteur,compteur_regularisation")
          .eq("collaborateur_id", collab.id)
          .eq("statut", "A_TRAITER")
          .gt("semaine_debut", lundi)
          .order("semaine_debut", { ascending: true });
        if (e7) throw e7;
        let courant = apres;
        for (const s of suivantes ?? []) {
          const hs = s.cloture_mensuelle
            ? Number(s.heures_supplementaires_compteur ?? 0)
            : Number(s.heures_supplementaires_compteur ?? (s.mode_heures_supplementaires === "COMPTEUR" ? s.heures_supplementaires : 0));
          const ap = courant + hs - Number(s.total_re ?? 0) + Number(s.compteur_regularisation ?? 0);
          const { error: e8 } = await supabase.from("feuilles_heures").update({ compteur_avant: courant, compteur_apres: ap, updated_at: new Date().toISOString() }).eq("id", s.id);
          if (e8) throw e8;
          courant = ap;
        }
      }

      setStatut(envoi || statutFinal === "A_TRAITER" ? "A_TRAITER" : "BROUILLON");
      setCompteurAvant(avant);
      setModifiee(false);
      setMessage({
        texte: envoi ? "Semaine envoyée aux RH." : statutFinal === "A_TRAITER" ? "Correction enregistrée : la semaine reste envoyée aux RH." : "Brouillon enregistré.",
        ok: true,
      });
    } catch (e) {
      const err = e as { message?: string };
      setMessage({ texte: `Enregistrement impossible : ${err?.message ?? "erreur inconnue"}`, ok: false });
    } finally {
      setEnCours(false);
      setConfirmation(false);
    }
  }

  function changerSemaine(n: number) {
    if (modifiee && !lectureSeule && !window.confirm("Des modifications ne sont pas enregistrées. Changer de semaine quand même ?")) return;
    setLundi((l) => plusJours(l, 7 * n));
  }

  const champ: CSSProperties = { minHeight: 42, border: "1.5px solid #b9bec5", borderRadius: 8, padding: "0 8px", fontSize: 15, fontFamily: "inherit", background: "#ffffff", boxSizing: "border-box" };
  const COULEURS: Record<Presence, { fond: string; bord: string; texte: string }> = {
    PRESENTIEL: { fond: "#cdeedb", bord: "#00b050", texte: "#0b4a25" },
    TELETRAVAIL: { fond: "#fff6a8", bord: "#d4c400", texte: "#4d4400" },
    ABSENT: { fond: "#ffd9bf", bord: "#ff6600", texte: "#6b2a00" },
  };
  const dateCourte = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
  const etat = statut === "A_TRAITER" ? "✓ Envoyée aux RH" : modifiee ? "● Modifications non enregistrées" : statut === "BROUILLON" ? "✓ Brouillon enregistré" : "○ Semaine non enregistrée";

  return (
    <main style={{ minHeight: "100vh", background: "#f4f4f4", fontFamily: "Calibri, Arial, sans-serif", color: "#222" }}>
      <EnTetePage section="Ma semaine">
        {collab && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
            <span style={{ background: "rgba(255,255,255,.18)", border: "1px solid rgba(255,255,255,.32)", borderRadius: 7, padding: "3px 8px", fontSize: 12 }}>{collab.trigramme}</span>
            {collab.prenom} {collab.nom}
          </span>
        )}
      </EnTetePage>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "18px 14px 60px" }}>
        {/* la semaine */}
        <div style={{ display: "grid", gridTemplateColumns: "48px minmax(0,1fr) 48px", alignItems: "center", gap: 8, background: "#ffffff", border: "1px solid #e3e3e3", borderRadius: 11, padding: "8px 10px", marginBottom: 12 }}>
          <button type="button" onClick={() => changerSemaine(-1)} aria-label="Semaine précédente" style={{ ...champ, color: "#c00000", fontWeight: 800 }}>
            ◀
          </button>
          <div style={{ textAlign: "center", lineHeight: 1.25 }}>
            <strong style={{ color: "#c00000", fontSize: 22 }}>S{String(semaineISO(lundi)).padStart(2, "0")}</strong>{" "}
            <span style={{ fontWeight: 700 }}>
              du {dateCourte(lundi)} au {dateCourte(plusJours(lundi, 4))}
            </span>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: statut === "A_TRAITER" ? "#138113" : modifiee ? "#a05a00" : "#777" }}>{etat}</div>
          </div>
          <button type="button" onClick={() => changerSemaine(1)} aria-label="Semaine suivante" style={{ ...champ, color: "#c00000", fontWeight: 800 }}>
            ▶
          </button>
        </div>

        <div style={{ fontSize: 13.5, color: "#555", background: "#ffffff", border: "1px solid #e3e3e3", borderRadius: 10, padding: "10px 14px", marginBottom: 12, lineHeight: 1.45 }}>
          <strong>Feuille simplifiée</strong> : indiquez seulement, pour chaque jour, où vous travaillez, vos absences et vos tickets restaurant. Aucune heure à saisir.
          <span style={{ display: "block", marginTop: 4 }}>
            Tickets cette semaine : <strong>{tickets}</strong> · Compteur de récupération : <strong>{fmt(compteurAvant - totalRE)} h</strong>
            {totalRE > 0 && <span style={{ color: "#777" }}> (dont −{fmt(totalRE)} h de RE cette semaine)</span>}
          </span>
        </div>

        {mode === "CONSULTATION" && <div style={{ background: "#edf8ef", border: "1px solid #b9dfbf", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#176b22" }}>👁 Feuille affichée en consultation.</div>}
        {mode === "MOI" && statut === "A_TRAITER" && (
          <div style={{ background: "#edf8ef", border: "1px solid #b9dfbf", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#176b22" }}>✓ Cette semaine est envoyée aux RH : elle n’est plus modifiable.</div>
        )}

        {!lectureSeule && propositions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: "#f3f7ff", border: "1px solid #c9d6ea", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <span style={{ flex: 1, fontSize: 14 }}>
              Congés validés cette semaine : <strong>{propositions.map((p) => `${jours.find((j) => j.date === p.date)?.nom.slice(0, 3)} ${dateCourte(p.date)}`).join(", ")}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                for (const p of propositions) changer(p.date, p.patch);
              }}
              style={{ ...champ, background: "#1f4e99", color: "#ffffff", border: "none", fontWeight: 800 }}
            >
              Les reporter sur la feuille
            </button>
          </div>
        )}

        {chargement ? (
          <div style={{ background: "#ffffff", borderRadius: 10, padding: 20, color: "#666" }}>Chargement de la semaine…</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {jours.map((j) => {
              const a = normCode(j.absence);
              const totale = absenceTotale(j);
              const c = COULEURS[j.presence];
              return (
                <div key={j.date} style={{ background: j.ferie ? "#eeeeee" : "#ffffff", border: "1px solid #e3e3e3", borderLeft: `5px solid ${c.bord}`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 130 }}>
                      <strong style={{ fontSize: 17 }}>{j.nom}</strong> <span style={{ color: "#777" }}>{dateCourte(j.date)}</span>
                      <div style={{ fontSize: 12, color: "#777" }}>{j.ferie ? "Férié" : `${fmt(j.theo)} h prévues`}</div>
                    </div>
                    {j.ferie ? (
                      <span style={{ fontWeight: 700, color: "#666" }}>Jour férié : rien à saisir</span>
                    ) : (
                      <>
                        <select
                          aria-label={`Présence du ${j.nom}`}
                          value={j.presence}
                          disabled={lectureSeule || totale || j.presence === "ABSENT"}
                          onChange={(e) => changer(j.date, { presence: e.target.value as Presence })}
                          style={{ ...champ, background: c.fond, color: c.texte, borderColor: c.bord, fontWeight: 800, width: 160 }}
                        >
                          {j.presence === "ABSENT" ? (
                            <option value="ABSENT">✕ Absent</option>
                          ) : (
                            <>
                              <option value="PRESENTIEL">● Présentiel</option>
                              <option value="TELETRAVAIL">⌂ Télétravail</option>
                            </>
                          )}
                        </select>
                        <select aria-label={`Absence du ${j.nom}`} value={a} disabled={lectureSeule} onChange={(e) => changer(j.date, { absence: e.target.value })} style={{ ...champ, flex: "1 1 200px", fontWeight: 700 }}>
                          <option value="">Pas d’absence</option>
                          {codes.map((x) => (
                            <option key={x.code} value={normCode(x.code)}>
                              {x.code} — {x.libelle}
                            </option>
                          ))}
                        </select>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 42, fontWeight: 700, opacity: j.presence === "ABSENT" ? 0.5 : 1 }}>
                          <input type="checkbox" checked={j.ticket} disabled={lectureSeule || j.presence === "ABSENT"} onChange={(e) => changer(j.date, { ticket: e.target.checked })} style={{ width: 22, height: 22 }} />
                          Ticket restaurant
                        </label>
                      </>
                    )}
                  </div>

                  {/* précisions de l'absence */}
                  {!j.ferie && (a === CODE_RE || a === CODE_CP || a === CODE_RT || EN_HEURES.has(a)) && (
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8, padding: "8px 10px", background: "#fff8e7", border: "1px solid #ead7a0", borderRadius: 8, fontSize: 14 }}>
                      {a === CODE_RE && (
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                          Récupération
                          <input value={j.heuresRE} disabled={lectureSeule} inputMode="decimal" placeholder="ex. 2" onChange={(e) => changer(j.date, { heuresRE: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...champ, width: 90 }} />
                          h, débitées du compteur
                        </label>
                      )}
                      {(a === CODE_CP || a === CODE_RT) && (
                        <>
                          <select
                            aria-label="Durée"
                            value={a === CODE_CP ? j.dureeCP : j.dureeRTT}
                            disabled={lectureSeule}
                            onChange={(e) => changer(j.date, a === CODE_CP ? { dureeCP: e.target.value as Duree } : { dureeRTT: e.target.value as Duree })}
                            style={{ ...champ, width: 150 }}
                          >
                            <option value="JOURNEE">Journée</option>
                            <option value="DEMI_JOURNEE">1/2 journée</option>
                          </select>
                          {(a === CODE_CP ? j.dureeCP : j.dureeRTT) === "DEMI_JOURNEE" && (
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                              Heures de {a === CODE_CP ? "CP" : "RTT"}
                              <input value={j.heuresAbsence} disabled={lectureSeule} inputMode="decimal" placeholder="ex. 4" onChange={(e) => changer(j.date, { heuresAbsence: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...champ, width: 90 }} />
                              <span style={{ fontWeight: 400, color: "#777" }}>entre 3 h et 4,5 h</span>
                            </label>
                          )}
                        </>
                      )}
                      {EN_HEURES.has(a) && (
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                          Heures d’absence
                          <input value={j.heuresAbsence} disabled={lectureSeule} inputMode="decimal" placeholder="ex. 2" onChange={(e) => changer(j.date, { heuresAbsence: e.target.value.replace(/[^0-9.,]/g, "") })} style={{ ...champ, width: 90 }} />
                        </label>
                      )}
                    </div>
                  )}
                  {!j.ferie && a && a !== CODE_RE && mode === "MOI" && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "#6d5200" }}>⚠ Pensez à justifier cette absence par vos outils RH habituels.</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {message && (
          <div role="status" style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: message.ok ? "#edf8ef" : "#fff4f4", border: `1px solid ${message.ok ? "#b9dfbf" : "#e6b5b5"}`, color: message.ok ? "#176b22" : "#8d0000", fontWeight: 700 }}>
            {message.texte}
          </div>
        )}

        {!lectureSeule && !chargement && (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button type="button" disabled={enCours} onClick={() => void enregistrer(false)} style={{ ...champ, minHeight: 46, padding: "0 18px", fontWeight: 800 }}>
              {enCours ? "Enregistrement…" : mode === "ADMIN" ? "💾 Enregistrer la correction" : "💾 Enregistrer le brouillon"}
            </button>
            {statut !== "A_TRAITER" && (
              <button type="button" disabled={enCours} onClick={() => setConfirmation(true)} style={{ ...champ, minHeight: 46, padding: "0 20px", background: "#138113", borderColor: "#138113", color: "#ffffff", fontWeight: 800 }}>
                📤 Envoyer aux RH
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, color: "#777" }}>Rythme pris en compte : {horaires.map((h) => fmt(h)).join(" / ")} h, du lundi au vendredi.</div>
      </div>

      {confirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 100 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, maxWidth: 460, width: "100%" }}>
            <div style={{ fontSize: 21, fontWeight: 800, color: "#8d0000", marginBottom: 8 }}>Envoyer la semaine aux RH ?</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "#444", marginBottom: 16 }}>
              Après l’envoi, la semaine n’est plus modifiable. Tickets : <strong>{tickets}</strong>
              {totalRE > 0 ? (
                <>
                  {" "}
                  · récupération : <strong>{fmt(totalRE)} h</strong>
                </>
              ) : null}
              .
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setConfirmation(false)} style={{ ...champ, padding: "0 16px", fontWeight: 700 }}>
                Annuler
              </button>
              <button type="button" disabled={enCours} onClick={() => void enregistrer(true)} style={{ ...champ, padding: "0 18px", background: "#c00000", borderColor: "#c00000", color: "#ffffff", fontWeight: 800 }}>
                📤 Envoyer aux RH
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
