"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { chargerAffaires, chargerCapacitesAbsences, chargerImputations, chargerPlanifie, type AffaireP } from "@/lib/pilotageDonnees";
import { construireCapacites, estFerie, type Affectation } from "@/lib/pilotagePlanning";

/* ===============================================================
   CONGÉ VALIDÉ : SON EFFET SUR LE PLANNING

   S'ouvre à la validation d'un congé (Validation RH). Liste ce que la
   personne avait de prévu sur ces jours :
   - au planning des affaires (forfaits) : ses affectations ;
   - au relevé PE / PI : ses heures saisies.
   Trois choix :
   - Décaler à la fin : les heures de ces jours sont retirées et replacées
     après la fin de l'affectation (ou après le dernier jour rempli du
     relevé), en sautant week-ends, fériés et autres congés ; au relevé,
     les jours du congé passent en « CP » ;
   - Retirer seulement : mêmes retraits (et « CP » au relevé), sans
     replacer les heures ;
   - Ne rien toucher.
   Un mois de relevé déjà clôturé n'est jamais modifié.
================================================================ */

type Props = { collaborateurId: string; nom: string; debut: string; fin: string; onFermer: () => void };

type ImpactForfait = { affectation: Affectation; jours: { jour: string; heures: number }[]; surConge: number; libelle: string };
type ImpactReleve = { ligneId: string; base: number; numero: string; jours: { jour: string; heures: number }[]; surConge: number; bloque: boolean };

const lendemain = (j: string) => {
  const d = new Date(`${j}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const weekend = (j: string) => {
  const n = new Date(`${j}T00:00:00Z`).getUTCDay();
  return n === 0 || n === 6;
};
const fr = (j: string) => new Date(`${j}T00:00:00`).toLocaleDateString("fr-FR");
const h = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("fr-FR")} h`;

export default function ImpactCongePlanning({ collaborateurId, nom, debut, fin, onFermer }: Props) {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [fait, setFait] = useState<string[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [forfaits, setForfaits] = useState<ImpactForfait[]>([]);
  const [releve, setReleve] = useState<ImpactReleve[]>([]);

  // jours ouvrés du congé
  const joursConge = useMemo(() => {
    const l: string[] = [];
    for (let j = debut; j <= fin; j = lendemain(j)) if (!weekend(j) && !estFerie(j)) l.push(j);
    return l;
  }, [debut, fin]);

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [af, im, pl] = await Promise.all([chargerAffaires({ horsPlanning: true }), chargerImputations(), chargerPlanifie(debut)]);
        const prestation = (a: AffaireP) => {
          const i = im.find((x) => x.code === a.imputation);
          return i ? i.charge_obligatoire === false : a.imputation === "PE" || a.imputation === "PI";
        };
        const parId = new Map(af.map((a) => [a.id, a]));
        const conge = new Set(joursConge);

        // planning des affaires : les forfaits (les PE / PI suivent le relevé)
        const f: ImpactForfait[] = [];
        for (const a of pl.affectations) {
          if (a.collaborateur_id !== collaborateurId || !a.affaire_id) continue;
          const affaire = parId.get(a.affaire_id);
          if (!affaire || prestation(affaire)) continue;
          const js = pl.jours
            .filter((j) => j.affectation_id === a.id)
            .map((j) => ({ jour: j.jour, heures: Number(j.heures) || 0 }))
            .filter((j) => j.heures > 0)
            .sort((x, y) => x.jour.localeCompare(y.jour));
          const sur = js.filter((j) => conge.has(j.jour)).reduce((t, j) => t + j.heures, 0);
          if (sur > 0.001) f.push({ affectation: a, jours: js, surConge: sur, libelle: `${affaire.type} ${affaire.numero}` });
        }

        // relevé PE / PI
        const r: ImpactReleve[] = [];
        const { data: lg } = await supabase.from("prestation_lignes").select("id,affaire_id,base_horaire").eq("collaborateur_id", collaborateurId);
        const lignes = (lg ?? []) as { id: string; affaire_id: string; base_horaire: number | string | null }[];
        if (lignes.length > 0) {
          const ids = lignes.map((l) => l.id);
          const moisConcernes = [...new Set(joursConge.map((j) => `${j.slice(0, 7)}-01`))];
          const [{ data: sa }, { data: pm }] = await Promise.all([
            supabase.from("prestation_saisies").select("ligne_id,jour,heures,code").in("ligne_id", ids).gte("jour", debut).lte("jour", fin),
            supabase.from("prestation_mois").select("ligne_id,mois,valide").in("ligne_id", ids).in("mois", moisConcernes),
          ]);
          const valides = new Set(((pm ?? []) as { ligne_id: string; valide: boolean | null }[]).filter((x) => x.valide).map((x) => x.ligne_id));
          for (const l of lignes) {
            const js = ((sa ?? []) as { ligne_id: string; jour: string; heures: number | string | null; code: string | null }[])
              .filter((s) => s.ligne_id === l.id && conge.has(s.jour) && (Number(s.heures) || 0) > 0 && !s.code)
              .map((s) => ({ jour: s.jour, heures: Number(s.heures) || 0 }));
            if (js.length === 0) continue;
            const a = parId.get(l.affaire_id);
            r.push({
              ligneId: l.id,
              base: Number(l.base_horaire) || 7,
              numero: a ? `${a.imputation ?? ""} ${a.numero}`.trim() : "PE / PI",
              jours: js,
              surConge: js.reduce((t, j) => t + j.heures, 0),
              bloque: valides.has(l.id),
            });
          }
        }
        if (!actif) return;
        setForfaits(f);
        setReleve(r);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Lecture du planning impossible.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [collaborateurId, debut, fin, joursConge]);

  async function appliquer(decaler: boolean) {
    setEnCours(true);
    setErreur("");
    const messages: string[] = [];
    try {
      const conge = new Set(joursConge);
      const horizon = (() => {
        const d = new Date(`${fin}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 220);
        return d.toISOString().slice(0, 10);
      })();
      const { caps, absences } = await chargerCapacitesAbsences(debut, horizon);
      const cap = construireCapacites(caps, absences).get(collaborateurId);
      // jour où l'on peut replacer des heures : ouvré, pas férié, pas en congé
      const libre = (j: string) => !weekend(j) && !estFerie(j) && !conge.has(j) && (cap?.get(j)?.net ?? 1) > 0;

      /* ---------- planning des affaires ---------- */
      for (const f of forfaits) {
        const garde = f.jours.filter((j) => !conge.has(j.jour));
        const ajout: { jour: string; heures: number }[] = [];
        if (decaler) {
          const parJour = Math.max(0.5, ...f.jours.map((j) => j.heures));
          const pris = new Set(garde.map((x) => x.jour));
          let reste = f.surConge;
          let j = f.jours[f.jours.length - 1].jour;
          for (let k = 0; reste > 0.001 && k < 400; k++) {
            j = lendemain(j);
            if (!libre(j) || pris.has(j)) continue;
            const x = Math.min(reste, parJour);
            ajout.push({ jour: j, heures: Math.round(x * 100) / 100 });
            reste -= x;
          }
        }
        const nouveaux = [...garde, ...ajout].sort((x, y) => x.jour.localeCompare(y.jour));
        const a = f.affectation;
        if (nouveaux.length === 0) {
          const { error } = await supabase.from("pilotage_affectations").delete().eq("id", a.id);
          if (error) throw new Error(`${f.libelle} : ${error.message}`);
          messages.push(`${f.libelle} : affectation retirée (elle tombait entièrement pendant le congé)`);
          continue;
        }
        const { error } = await supabase.rpc("pilotage_enregistrer_affectation", {
          p_id: a.id,
          p_affaire_id: a.affaire_id,
          p_activite_id: a.activite_id,
          p_code: a.code,
          p_libelle: a.libelle,
          p_collaborateur_id: a.collaborateur_id,
          p_date_debut: nouveaux[0].jour,
          p_date_fin: nouveaux[nouveaux.length - 1].jour,
          p_commentaire: a.commentaire,
          p_jours: nouveaux,
          p_groupe_id: a.groupe_id,
        });
        if (error) throw new Error(`${f.libelle} : ${error.message}`);
        messages.push(
          decaler && ajout.length > 0
            ? `${f.libelle} : ${h(f.surConge)} décalées, fin le ${fr(ajout[ajout.length - 1].jour)}`
            : `${f.libelle} : ${h(f.surConge)} retirées`
        );
      }

      /* ---------- relevé PE / PI ---------- */
      for (const r of releve) {
        if (r.bloque) {
          messages.push(`${r.numero} : mois du relevé déjà clôturé, rien changé`);
          continue;
        }
        const { error: e1 } = await supabase
          .from("prestation_saisies")
          .upsert(r.jours.map((j) => ({ ligne_id: r.ligneId, jour: j.jour, heures: null, code: "CP" })), { onConflict: "ligne_id,jour" });
        if (e1) throw new Error(`${r.numero} : ${e1.message}`);
        const mois = new Set(r.jours.map((j) => `${j.jour.slice(0, 7)}-01`));
        if (decaler) {
          const { data: tout } = await supabase.from("prestation_saisies").select("jour,heures").eq("ligne_id", r.ligneId).gte("jour", debut);
          const lu = (tout ?? []) as { jour: string; heures: number | string | null }[];
          const occupes = new Set(lu.map((x) => x.jour));
          const dernier = lu.filter((x) => (Number(x.heures) || 0) > 0).map((x) => x.jour).sort().slice(-1)[0] ?? fin;
          let j = dernier > fin ? dernier : fin;
          let reste = r.surConge;
          const ajout: { ligne_id: string; jour: string; heures: number; code: null }[] = [];
          for (let k = 0; reste > 0.001 && k < 400; k++) {
            j = lendemain(j);
            if (!libre(j) || occupes.has(j)) continue;
            const x = Math.min(reste, r.base);
            ajout.push({ ligne_id: r.ligneId, jour: j, heures: Math.round(x * 100) / 100, code: null });
            reste -= x;
          }
          if (ajout.length > 0) {
            const { error: e2 } = await supabase.from("prestation_saisies").insert(ajout);
            if (e2) throw new Error(`${r.numero} : ${e2.message}`);
            for (const x of ajout) mois.add(`${x.jour.slice(0, 7)}-01`);
            messages.push(`${r.numero} : CP posés, ${h(r.surConge)} décalées, fin le ${fr(ajout[ajout.length - 1].jour)}`);
          }
        } else {
          messages.push(`${r.numero} : CP posés, ${h(r.surConge)} retirées`);
        }
        for (const m of mois) {
          const { error: e3 } = await supabase.rpc("prestation_synchroniser_planning", { p_ligne_id: r.ligneId, p_mois: m });
          if (e3) messages.push(`${r.numero} : planning de ${m.slice(0, 7)} non mis à jour (${e3.message})`);
        }
      }
      setFait(messages.length ? messages : ["Rien à changer."]);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Mise à jour du planning impossible.");
    } finally {
      setEnCours(false);
    }
  }

  const rien = !chargement && forfaits.length === 0 && releve.length === 0;
  const bouton = (principal: boolean): CSSProperties => ({
    border: principal ? 0 : "1px solid #ccc",
    borderRadius: 8,
    padding: "11px 16px",
    background: principal ? "#c00000" : "#ffffff",
    color: principal ? "#ffffff" : "#333333",
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    opacity: enCours ? 0.6 : 1,
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Le congé dans le planning" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 40 }}>
      <div style={{ background: "#ffffff", borderRadius: 16, width: "min(640px,100%)", maxHeight: "90vh", overflow: "auto", padding: 22, fontFamily: "Calibri, Arial, sans-serif" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: "#8a9097" }}>PLANNING</div>
        <h2 style={{ margin: "2px 0 4px" }}>Le congé de {nom}</h2>
        <div style={{ color: "#6d737a", marginBottom: 14 }}>
          {debut === fin ? `le ${fr(debut)}` : `du ${fr(debut)} au ${fr(fin)}`} · {joursConge.length} jour{joursConge.length > 1 ? "s" : ""} ouvré{joursConge.length > 1 ? "s" : ""}
        </div>

        {erreur && <div style={{ background: "#fdecec", color: "#a51d1d", padding: 12, borderRadius: 10, marginBottom: 12 }}>{erreur}</div>}
        {chargement && <div style={{ color: "#6d737a" }}>Lecture du planning…</div>}

        {fait ? (
          <>
            <div style={{ background: "#e7f6ec", color: "#18713b", padding: 12, borderRadius: 10, lineHeight: 1.5 }}>
              <strong>Planning mis à jour :</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {fait.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={bouton(true)} onClick={onFermer}>Fermer</button>
            </div>
          </>
        ) : rien ? (
          <>
            <div style={{ background: "#f8f8f8", padding: 12, borderRadius: 10, lineHeight: 1.5 }}>
              Rien n’était prévu pour {nom} sur ces jours, ni au planning des affaires, ni au relevé PE / PI. Le congé apparaît dans le planning par
              ressource, et une alerte s’affichera si quelqu’un essaie de l’affecter sur ces dates.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={bouton(true)} onClick={onFermer}>Fermer</button>
            </div>
          </>
        ) : !chargement ? (
          <>
            <div style={{ lineHeight: 1.5, marginBottom: 6 }}>Ce qui était prévu pour {nom} sur ces jours :</div>
            <ul style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 1.6 }}>
              {forfaits.map((f) => (
                <li key={f.affectation.id}>
                  <strong>{f.libelle}</strong> · planning des affaires · {h(f.surConge)} sur ces jours
                </li>
              ))}
              {releve.map((r) => (
                <li key={r.ligneId}>
                  <strong>{r.numero}</strong> · relevé PE / PI · {h(r.surConge)} sur ces jours
                  {r.bloque && <span style={{ color: "#a51d1d" }}> (mois déjà clôturé : ne sera pas modifié)</span>}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: 13, color: "#6d737a", lineHeight: 1.5, marginBottom: 14 }}>
              <strong>Décaler à la fin</strong> retire ces heures des jours de congé et les replace après la fin (week-ends, fériés et autres congés sautés) ; au relevé, les jours
              du congé passent en « CP ». <strong>Retirer seulement</strong> fait les mêmes retraits, sans replacer les heures.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" style={bouton(false)} disabled={enCours} onClick={onFermer}>Ne rien toucher</button>
              <button type="button" style={bouton(false)} disabled={enCours} onClick={() => void appliquer(false)}>Retirer seulement</button>
              <button type="button" style={bouton(true)} disabled={enCours} onClick={() => void appliquer(true)}>
                {enCours ? "Mise à jour…" : "Décaler à la fin"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
