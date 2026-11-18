"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import { C, page } from "@/components/pilotage/ui";
import {
  calculer,
  chargerRappelFrais,
  chargerReferences,
  kmParJour,
  normaliserCompetence,
  tarifJour,
  type Competence,
  type Contrat,
  type Globaux,
  type RappelFrais,
  type References,
} from "@/lib/simulationPE";

/* ===============================================================
   ANALYSE - SIMULATION PE (SIMULATION_PE, PLG, 18/11/2026)
   Les taux de vente journaliers des PE, par compétence, défraiement
   kilométrique compris, face au coût d'une journée et à la marge ; en
   dessous, le rappel de ce que les notes de frais ont remboursé.
   Voir lib/simulationPE.ts. La simulation est gardée dans ce navigateur
   (rien n'est écrit en base).
================================================================ */

/* PE_DEFAUTS (PLG, 18/11/2026) : journée de 7 h, barème 7 CV, marge visée 6 %. La clé v2 repart de ces valeurs ;
   les compétences d'une simulation v1 sont reprises (normaliserCompetence). */
const CLE_STOCKAGE = "polynov.simulationPE.v2";
const CLE_ANCIENNE = "polynov.simulationPE.v1";
const HEURES_JOUR_DEFAUT = 7;
const MARGE_DEFAUT = 6;
const estBareme7CV = (puissance: string) => /(^|\D)7(\D|$)/.test(puissance);
const COMPETENCES_DEFAUT = ["Etude", "Mise en plan", "Faisabilité", "AMO", "Calcul"];

const euros = (v: number, d = 0) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d })} €`;
const nb = (v: number, d = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const lire = (s: string) => {
  const x = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

function moisISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type Etat = { contratId: string | null; globaux: Globaux; competences: Competence[] };

function Champ({ valeur, onChange, largeur = 90, suffixe }: { valeur: number; onChange: (v: number) => void; largeur?: number; suffixe?: string }) {
  const [texte, setTexte] = useState(String(valeur).replace(".", ","));
  // la valeur change d'ailleurs (repartir du contrat, km des notes) : le texte suit
  const [precedente, setPrecedente] = useState(valeur);
  if (precedente !== valeur) {
    setPrecedente(valeur);
    if (lire(texte) !== valeur) setTexte(String(Math.round(valeur * 100) / 100).replace(".", ","));
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        value={texte}
        inputMode="decimal"
        onChange={(e) => {
          setTexte(e.target.value);
          onChange(lire(e.target.value));
        }}
        style={{ width: largeur, minHeight: 34, border: "1.5px solid #b9bec5", borderRadius: 6, padding: "0 8px", textAlign: "right", fontFamily: "inherit", fontSize: 15, boxSizing: "border-box" }}
      />
      {suffixe && <span style={{ fontSize: 12, color: C.gris, whiteSpace: "nowrap" }}>{suffixe}</span>}
    </span>
  );
}

const selectStyle: CSSProperties = { minHeight: 34, border: "1.5px solid #b9bec5", borderRadius: 6, padding: "0 6px", fontFamily: "inherit", fontSize: 13, background: "#ffffff" };

function SimulationPEContenu() {
  const [refs, setRefs] = useState<References | null>(null);
  const [rappel, setRappel] = useState<RappelFrais | null>(null);
  const [erreur, setErreur] = useState("");
  const [etat, setEtat] = useState<Etat | null>(null);

  // 12 derniers mois complets
  const periode = useMemo(() => {
    const d = new Date();
    const fin = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const debut = new Date(d.getFullYear(), d.getMonth() - 12, 1);
    return { debut: moisISO(debut), fin: moisISO(fin) };
  }, []);

  useEffect(() => {
    let actif = true;
    Promise.all([chargerReferences(periode.debut), chargerRappelFrais(periode.debut, periode.fin)])
      .then(([r, f]) => {
        if (!actif) return;
        setRefs(r);
        setRappel(f);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      actif = false;
    };
  }, [periode]);

  /* l'état de départ : la simulation gardée dans ce navigateur, sinon le contrat cadre */
  const globauxDefaut = (r: References, f: RappelFrais | null): Globaux => {
    const b7 = r.baremes.find((b) => estBareme7CV(b.puissance));
    return {
      heuresJour: HEURES_JOUR_DEFAUT,
      coutHoraire: Math.round((r.coutHoraire ?? 0) * 100) / 100,
      prixKm: b7 ? b7.prixKm : Math.round((f?.prixKmMoyen ?? r.prixKmBareme ?? 0) * 1000) / 1000,
      bareme: b7 ? b7.puissance : f?.prixKmMoyen != null ? "NOTES" : null,
      margeCible: MARGE_DEFAUT,
    };
  };
  const depuisContrat = (k: Contrat | null, r: References, f: RappelFrais | null): Etat => {
    const hj = HEURES_JOUR_DEFAUT;
    const tarifs = k?.tarifs.length ? k.tarifs : COMPETENCES_DEFAUT.map((nom) => ({ nom, montant: null, unite: "JOUR" as const }));
    return {
      contratId: k?.id ?? null,
      globaux: globauxDefaut(r, f),
      competences: tarifs.map((t) => ({
        nom: t.nom,
        // PE_UNITES : un tarif à l'heure reste à l'heure ; à la journée ou à la semaine, il est ramené à la journée
        unite: t.unite === "HEURE" ? ("HEURE" as const) : ("JOUR" as const),
        taux: t.unite === "HEURE" ? (t.montant ?? 0) : k ? Math.round(tarifJour(t, k, hj) * 100) / 100 : 0,
        jours: 0,
        km: Math.round((f?.kmParJourReg ?? 0) / 2), // les notes donnent des km aller-retour par jour
        trajet: "AR" as const,
        defraiFacture: 0,
      })),
    };
  };
  useEffect(() => {
    if (!refs || etat) return;
    let garde: Etat | null = null;
    try {
      const s = window.localStorage.getItem(CLE_STOCKAGE);
      if (s) garde = JSON.parse(s) as Etat;
      else {
        // PE_DEFAUTS : une simulation de l'ancienne version garde ses compétences, avec les nouveaux paramètres communs
        const v1 = window.localStorage.getItem(CLE_ANCIENNE);
        if (v1) {
          const a = JSON.parse(v1) as Etat;
          if (Array.isArray(a.competences)) garde = { ...a, globaux: globauxDefaut(refs, rappel) };
        }
      }
    } catch {
      garde = null;
    }
    const k = refs.contrats.find((x) => x.id === garde?.contratId) ?? refs.contrats.find((x) => /michelin/i.test(x.client_motif)) ?? refs.contrats[0] ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEtat(
      garde && Array.isArray(garde.competences) && garde.globaux
        ? { ...garde, globaux: { ...garde.globaux, bareme: garde.globaux.bareme ?? null }, competences: garde.competences.map(normaliserCompetence) }
        : depuisContrat(k, refs, rappel)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, rappel]);
  useEffect(() => {
    if (!etat) return;
    try {
      window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat));
    } catch {
      /* stockage indisponible : la simulation reste valable jusqu'à la fermeture */
    }
  }, [etat]);

  if (erreur) return <p style={{ ...page.carte, padding: 16, color: C.rougeTexte }}>Chargement impossible : {erreur}</p>;
  if (!refs || !etat) return <p style={{ ...page.carte, padding: 16, color: C.gris }}>Chargement…</p>;

  const g = etat.globaux;
  const contrat = refs.contrats.find((x) => x.id === etat.contratId) ?? null;
  const majG = (p: Partial<Globaux>) => setEtat({ ...etat, globaux: { ...g, ...p } });
  const majC = (i: number, p: Partial<Competence>) => setEtat({ ...etat, competences: etat.competences.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const lignes = etat.competences.map((c) => ({ c, r: calculer(c, g) }));
  const tot = lignes.reduce(
    (t, { c, r }) => ({ jours: t.jours + c.jours, caAn: t.caAn + r.caAn, margeAn: t.margeAn + r.margeAn, defraiAn: t.defraiAn + r.defraiAn }),
    { jours: 0, caAn: 0, margeAn: 0, defraiAn: 0 }
  );
  const coutJourTemps = g.heuresJour * g.coutHoraire;
  const tauxReelJour = refs.peFacture ? (refs.peFacture.montant / refs.peFacture.heures) * g.heuresJour : null;

  const th: CSSProperties = { ...page.th, textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5 };
  const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${C.ligne}`, textAlign: "right", whiteSpace: "nowrap", fontSize: 14 };
  const couleurMarge = (pct: number | null) => (pct === null ? C.gris : pct < 0 ? "#b3261e" : pct * 100 < g.margeCible ? "#8a4b00" : "#1b5e20");
  const btn: CSSProperties = { ...page.btnSecondaire, minHeight: 34, fontSize: 13 };
  // un taux à la journée affiché dans l'unité de la ligne (PE_UNITES)
  const dansUnite = (c: Competence, parJour: number) =>
    c.unite === "HEURE" && g.heuresJour > 0 ? `${euros(parJour / g.heuresJour, 2)} / h` : euros(parJour);

  return (
    <div style={{ ...page.contenu, maxWidth: 1400 }}>
      <h1 style={page.titre}>Simulation PE</h1>
      <p style={page.sousTitre}>
        Taux de vente journaliers par compétence, défraiement kilométrique compris, face au coût d’une journée. La simulation est gardée dans ce navigateur ; rien n’est modifié dans le contrat cadre.
      </p>

      {/* paramètres communs */}
      <section style={{ ...page.carte, padding: 16, marginTop: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gris, textTransform: "uppercase" }}>Heures d’une journée</span>
            <Champ valeur={g.heuresJour} onChange={(v) => majG({ heuresJour: v })} suffixe="h" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gris, textTransform: "uppercase" }}>Coût horaire de structure</span>
            <Champ valeur={g.coutHoraire} onChange={(v) => majG({ coutHoraire: v })} suffixe="€ / h" />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gris, textTransform: "uppercase" }}>Prix du km remboursé</span>
            {/* PE_UNITES : un tarif du barème des notes de frais, la moyenne des notes, ou une valeur libre */}
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={g.bareme ?? "LIBRE"}
                aria-label="Prix du km : tarif du barème"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "LIBRE") return majG({ bareme: null });
                  if (v === "NOTES") return majG({ bareme: "NOTES", prixKm: Math.round((rappel?.prixKmMoyen ?? g.prixKm) * 1000) / 1000 });
                  const b = refs.baremes.find((x) => x.puissance === v);
                  if (b) majG({ bareme: b.puissance, prixKm: b.prixKm });
                }}
                style={selectStyle}
              >
                {refs.baremes.map((b) => (
                  <option key={b.puissance} value={b.puissance}>
                    Barème {b.puissance} : {nb(b.prixKm, 3)} €/km
                  </option>
                ))}
                {rappel?.prixKmMoyen != null && <option value="NOTES">Moyenne des notes : {nb(rappel.prixKmMoyen, 3)} €/km</option>}
                <option value="LIBRE">Autre valeur…</option>
              </select>
              {g.bareme === null ? (
                <Champ valeur={g.prixKm} onChange={(v) => majG({ prixKm: v })} largeur={80} suffixe="€ / km" />
              ) : (
                <span style={{ fontSize: 13, color: C.gris }}>{nb(g.prixKm, 3)} € / km</span>
              )}
            </span>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.gris, textTransform: "uppercase" }}>Marge visée</span>
            <Champ valeur={g.margeCible} onChange={(v) => majG({ margeCible: v })} largeur={70} suffixe="%" />
          </label>
          <div style={{ fontSize: 13, color: C.gris, flex: "1 1 260px" }}>
            Une journée coûte <strong style={{ color: C.encre }}>{euros(coutJourTemps)}</strong> de temps ({nb(g.heuresJour, 2)} h × {euros(g.coutHoraire, 2)}), plus ses km.
            {refs.coutHoraire !== null && <> Coût de structure de la Rentabilité : {euros(refs.coutHoraire, 2)} / h.</>}
            {rappel?.prixKmMoyen != null && <> Prix moyen du km des notes : {nb(rappel.prixKmMoyen, 3)} €.</>}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button type="button" style={btn} onClick={() => setEtat({ ...etat, competences: [...etat.competences, { nom: "Nouvelle compétence", taux: 0, unite: "JOUR", jours: 0, km: 0, trajet: "AR", defraiFacture: 0 }] })}>
            + Ajouter une compétence
          </button>
        </div>
      </section>

      {/* le tableau des compétences */}
      <section style={{ ...page.carte, padding: 16, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>Par compétence</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
          Saisissez le taux (à la journée ou à l’heure), les km d’un trajet en précisant aller ou aller-retour (un aller-retour compte double, comme dans la note de frais) et, si vous le facturez, le défraiement par jour. Les jours vendus par an donnent la marge annuelle.
          {contrat && <> Départ : {contrat.libelle}.</>}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Compétence</th>
                <th style={th}>Taux de vente</th>
                <th style={th} title="Km d'un trajet, aller ou aller-retour (un aller-retour compte double)">Km / jour</th>
                <th style={th} title="Défraiement facturé au client, par jour">Défraiement facturé</th>
                <th style={th}>Vendu / jour</th>
                <th style={th} title="Temps + km remboursés">Coût / jour</th>
                <th style={th}>Marge / jour</th>
                <th style={th} title="Le taux en dessous duquel la journée coûte plus qu'elle ne rapporte : coût de la journée (temps + km remboursés) − défraiement facturé. Au plancher, la marge est nulle.">Taux plancher</th>
                <th style={th} title="Taux jour qui tient la marge visée">Taux pour {nb(g.margeCible)} %</th>
                <th style={th}>Jours / an</th>
                <th style={th}>Marge / an</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {lignes.map(({ c, r }, i) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: "left" }}>
                    <input
                      value={c.nom}
                      onChange={(e) => majC(i, { nom: e.target.value })}
                      style={{ width: 150, minHeight: 34, border: "1.5px solid #b9bec5", borderRadius: 6, padding: "0 8px", fontFamily: "inherit", fontSize: 15, fontWeight: 700 }}
                    />
                  </td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <Champ valeur={c.taux} onChange={(v) => majC(i, { taux: v })} largeur={80} />
                      <select
                        value={c.unite}
                        aria-label={`Unité du taux, ${c.nom}`}
                        onChange={(e) => {
                          // PE_UNITES : changer d'unité convertit le taux (même valeur à la journée)
                          const u = e.target.value === "HEURE" ? "HEURE" : "JOUR";
                          if (u === c.unite) return;
                          const t = u === "HEURE" ? c.taux / (g.heuresJour || 1) : c.taux * g.heuresJour;
                          majC(i, { unite: u, taux: Math.round(t * 100) / 100 });
                        }}
                        style={selectStyle}
                      >
                        <option value="JOUR">€ / jour</option>
                        <option value="HEURE">€ / h</option>
                      </select>
                    </span>
                    <div style={{ fontSize: 11, color: C.gris }}>
                      {c.unite === "HEURE" ? `= ${euros(r.tauxJour, 2)} la journée de ${nb(g.heuresJour, 2)} h` : g.heuresJour > 0 ? `= ${euros(r.tauxJour / g.heuresJour, 2)} / h` : ""}
                    </div>
                  </td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <Champ valeur={c.km} onChange={(v) => majC(i, { km: v })} largeur={64} suffixe="km" />
                      <select value={c.trajet} aria-label={`Trajet, ${c.nom}`} onChange={(e) => majC(i, { trajet: e.target.value === "ALLER" ? "ALLER" : "AR" })} style={selectStyle}>
                        <option value="AR">aller-retour</option>
                        <option value="ALLER">aller</option>
                      </select>
                    </span>
                    <div style={{ fontSize: 11, color: C.gris }}>
                      {nb(kmParJour(c))} km indemnisés · {euros(r.coutKm, 2)}
                    </div>
                  </td>
                  <td style={td}>
                    <Champ valeur={c.defraiFacture} onChange={(v) => majC(i, { defraiFacture: v })} largeur={70} suffixe="€" />
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{euros(r.ca)}</td>
                  <td style={td}>{euros(r.cout)}</td>
                  <td style={{ ...td, fontWeight: 800, color: couleurMarge(r.pct) }}>
                    {r.marge >= 0 ? "+ " : "− "}
                    {euros(Math.abs(r.marge))}
                    {r.pct !== null && <div style={{ fontSize: 12 }}>{Math.round(r.pct * 100)} %</div>}
                  </td>
                  <td style={{ ...td, color: C.gris }}>{dansUnite(c, Math.max(0, r.plancher))}</td>
                  <td style={{ ...td, fontWeight: 700, color: r.tauxJour + 0.5 < r.conseille ? "#8a4b00" : "#1b5e20" }}>{dansUnite(c, Math.max(0, r.conseille))}</td>
                  <td style={td}>
                    <Champ valeur={c.jours} onChange={(v) => majC(i, { jours: v })} largeur={70} />
                  </td>
                  <td style={{ ...td, fontWeight: 800, color: couleurMarge(r.pct) }}>{c.jours > 0 ? `${r.margeAn >= 0 ? "+ " : "− "}${euros(Math.abs(r.margeAn))}` : "—"}</td>
                  <td style={td}>
                    <button
                      type="button"
                      title="Retirer cette compétence"
                      onClick={() => setEtat({ ...etat, competences: etat.competences.filter((_, j) => j !== i) })}
                      style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: C.gris }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, textAlign: "left", fontWeight: 800, borderTop: "2px solid #d5d9de" }} colSpan={9}>
                  Total sur un an
                  {tot.jours > 0 && (
                    <span style={{ fontWeight: 400, color: C.gris }}>
                      {" "}
                      · vendu {euros(tot.caAn)} · km remboursés {euros(tot.defraiAn)}
                    </span>
                  )}
                </td>
                <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{nb(tot.jours)}</td>
                <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de", color: tot.margeAn < 0 ? "#b3261e" : "#1b5e20" }}>
                  {tot.jours > 0 ? `${tot.margeAn >= 0 ? "+ " : "− "}${euros(Math.abs(tot.margeAn))}` : "—"}
                  {tot.caAn > 0.5 && <div style={{ fontSize: 12 }}>{Math.round((tot.margeAn / tot.caAn) * 100)} %</div>}
                </td>
                <td style={{ ...td, borderTop: "2px solid #d5d9de" }} />
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: C.gris, margin: "8px 0 0" }}>
          Vendu / jour = taux à la journée (un taux horaire × heures d’une journée) + défraiement facturé. Coût / jour = heures × coût horaire de structure + km indemnisés (un aller-retour compte double) × prix du km. <strong>Taux plancher</strong> = le taux en dessous duquel on perd de l’argent : il paie tout juste la journée (heures × coût
          horaire de structure + km remboursés), moins ce que le défraiement facturé rembourse déjà ; vendu au plancher, la marge est nulle. Taux pour la
          marge visée = coût ÷ (1 − marge) − défraiement facturé. Marge en <span style={{ color: "#1b5e20", fontWeight: 700 }}>vert</span> si elle atteint la marge visée,{" "}
          <span style={{ color: "#8a4b00", fontWeight: 700 }}>orange</span> en dessous, <span style={{ color: "#b3261e", fontWeight: 700 }}>rouge</span> si la journée perd de l’argent.
          {tauxReelJour !== null && (
            <>
              {" "}
              Pour comparer : sur les 12 derniers mois, les PE ont été facturées en moyenne <strong>{euros(tauxReelJour)}</strong> la journée de {nb(g.heuresJour, 2)} h (relevé validé, heures sup comprises).
            </>
          )}
        </p>
      </section>

      {/* rappel des notes de frais */}
      <section style={{ ...page.carte, padding: 16, marginTop: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>Défraiements des notes de frais</h2>
        {!rappel || rappel.lignes.length === 0 ? (
          <p style={{ margin: 0, color: C.gris }}>
            Aucune note de frais transmise entre {rappel ? rappel.debut.slice(0, 7) : periode.debut.slice(0, 7)} et {periode.fin.slice(0, 7)}
            {rappel && rappel.brouillons > 0 ? ` (${rappel.brouillons} en brouillon, non comptées)` : ""}. Seuls les administrateurs voient les notes de tout le monde.
          </p>
        ) : (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
              Notes transmises de {rappel.debut.slice(0, 7)} à {rappel.fin.slice(0, 7)} (12 mois){rappel.brouillons > 0 ? `, ${rappel.brouillons} brouillon(s) non compté(s)` : ""}. Km indemnisés selon la
              note : un A/R compte double, le trajet domicile → Polynov est déduit au départ du domicile.
              {rappel.kmParJourReg !== null && rappel.euroParJourReg !== null && (
                <>
                  {" "}
                  Trajets réguliers : <strong style={{ color: C.encre }}>{nb(rappel.kmParJourReg)} km</strong> et <strong style={{ color: C.encre }}>{euros(rappel.euroParJourReg, 2)}</strong> par jour en moyenne.
                </>
              )}
            </p>
            {rappel.kmParJourReg !== null && (
              <button
                type="button"
                style={{ ...btn, marginBottom: 12 }}
                onClick={() => setEtat({ ...etat, competences: etat.competences.map((c) => ({ ...c, km: Math.round((rappel.kmParJourReg ?? 0) / 2), trajet: "AR" as const })) })}
              >
                Mettre {nb(rappel.kmParJourReg)} km / jour (aller-retour de {nb((rappel.kmParJourReg ?? 0) / 2)} km) sur toutes les compétences
              </button>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: 16 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Collaborateur</th>
                      <th style={th}>Jours réguliers</th>
                      <th style={th}>Km</th>
                      <th style={th}>Km remboursés</th>
                      <th style={th}>Autres frais</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rappel.lignes.map((l) => (
                      <tr key={l.collaborateurId}>
                        <td style={{ ...td, textAlign: "left" }}>{l.nom}</td>
                        <td style={td}>{l.joursReg > 0 ? nb(l.joursReg) : "—"}</td>
                        <td style={td}>{nb(l.kmReg + l.kmPonct)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{euros(l.euroReg + l.euroPonct)}</td>
                        <td style={{ ...td, color: C.gris }}>{l.autres > 0.5 ? euros(l.autres) : "—"}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...td, textAlign: "left", fontWeight: 800, borderTop: "2px solid #d5d9de" }}>Total</td>
                      <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{nb(rappel.lignes.reduce((t, l) => t + l.joursReg, 0))}</td>
                      <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{nb(rappel.lignes.reduce((t, l) => t + l.kmReg + l.kmPonct, 0))}</td>
                      <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{euros(rappel.lignes.reduce((t, l) => t + l.euroReg + l.euroPonct, 0))}</td>
                      <td style={{ ...td, fontWeight: 800, borderTop: "2px solid #d5d9de" }}>{euros(rappel.lignes.reduce((t, l) => t + l.autres, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Site</th>
                      <th style={th} title="Jours de trajet régulier + déplacements ponctuels">Jours / trajets</th>
                      <th style={th}>Km</th>
                      <th style={th}>Remboursé</th>
                      <th style={th}>Par jour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rappel.sites.map((s) => (
                      <tr key={s.site}>
                        <td style={{ ...td, textAlign: "left" }}>{s.site}</td>
                        <td style={td}>{nb(s.jours)}</td>
                        <td style={td}>{nb(s.km)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{euros(s.euros)}</td>
                        <td style={td}>
                          {s.jours > 0 ? (
                            <>
                              {euros(s.euros / s.jours, 2)}
                              <div style={{ fontSize: 11, color: C.gris }}>{nb(s.km / s.jours)} km</div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function PageSimulationPE() {
  return (
    <GardeAcces droit="indicateurs">
      <main style={page.fond}>
        <EnTetePage section="Analyse" />
        <OngletsPilotage actif="simulation-pe" />
        <SimulationPEContenu />
      </main>
    </GardeAcces>
  );
}
