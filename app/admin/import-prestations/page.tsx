"use client";

import { useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";
import { lireSuiviPrestations, type LigneHisto, type ResultatHisto } from "@/lib/importSuiviPrestations";

/* ===============================================================
   IMPORT DU SUIVI DES PRESTATIONS (Excel) DANS LE RELEVÉ PE / PI

   Le classeur FAIT FOI. Chaque onglet de mois remplit le relevé :
   - une ligne du relevé par commande (n° CBE, avenant compris) × personne
     (trigramme), avec unité (bloc journalier / horaire), taux, base
     horaire, activité, repère intergroupe (bloc IG) ;
   - les heures jour par jour (ou CP, ML…), les heures sup à refacturer et
     le montant facturé (Méca + Calcul + Elec) ;
   - MOIS PASSÉS : importés VALIDÉS (montant figé = celui du classeur) ;
   - mois en cours et futurs : non validés, réimportables à volonté ;
   - un mois déjà validé dans l'application n'est jamais écrasé ;
   - une ligne dont la commande (ex. ancienne désignation CAS) ou la
     personne est inconnue va dans l'historique à part : son CA compte
     quand même dans les Finances.
   Ensuite, le planning des PE / PI se met à jour.
================================================================ */

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const libMois = (m: string) => `${NOMS_MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

type Contexte = {
  affaires: Map<string, string>; // « 1604R2 » -> id
  personnes: Map<string, string>; // trigramme -> id
  activites: Map<string, string>; // « MECA » / « CALCUL » / « ELEC » -> id d'activité
  lignes: Map<string, string>; // « affaire|collab » -> id ligne du relevé
  valides: Set<string>; // « ligne|AAAA-MM » déjà validés dans l'application
};

type Groupe = {
  cle: string; // affaire|collab|mois
  mois: string;
  affaireId: string;
  collabId: string;
  source: LigneHisto[];
};

/* Réseau capricieux (wifi, mise en veille, coupure brève) : on réessaie un appel jusqu'à 4 fois
   (après 1 s, 3 s puis 8 s) avant d'abandonner. Une vraie erreur de la base n'est pas réessayée. */
const estCoupure = (m?: string) => /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(m ?? "");

async function reessayer<T extends { error: { message: string } | null }>(appel: () => PromiseLike<T>): Promise<T> {
  const attentes = [1000, 3000, 8000];
  for (let i = 0; ; i++) {
    try {
      const r = await appel();
      if (!r.error || !estCoupure(r.error.message) || i >= attentes.length) return r;
    } catch (e) {
      if (!estCoupure(e instanceof Error ? e.message : String(e)) || i >= attentes.length) throw e;
    }
    await new Promise((ok) => setTimeout(ok, attentes[i]));
  }
}

function ImportContenu() {
  const [nomFichier, setNomFichier] = useState("");
  const [resultat, setResultat] = useState<ResultatHisto | null>(null);
  const [contexte, setContexte] = useState<Contexte | null>(null);
  const [moisChoisis, setMoisChoisis] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [progression, setProgression] = useState("");

  const moisCourant = new Date().toISOString().slice(0, 7);

  async function chargerContexte(): Promise<Contexte> {
    const [af, co, corr, pl, pm] = await Promise.all([
      chargerTout<{ id: string; numero: string }>((a, b) => supabase.from("pilotage_affaires").select("id,numero").eq("type", "CBE").order("id").range(a, b)),
      chargerTout<{ id: string; trigramme: string | null }>((a, b) => supabase.from("collaborateurs").select("id,trigramme").order("id").range(a, b)),
      supabase.from("suivi_correspondance_activites").select("colonne_excel,activite_id"),
      chargerTout<{ id: string; affaire_id: string; collaborateur_id: string }>((a, b) => supabase.from("prestation_lignes").select("id,affaire_id,collaborateur_id").order("id").range(a, b)),
      chargerTout<{ ligne_id: string; mois: string }>((a, b) => supabase.from("prestation_mois").select("ligne_id,mois").eq("valide", true).order("ligne_id").range(a, b)),
    ]);
    const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return {
      affaires: new Map(af.map((a) => [a.numero.toUpperCase().replace(/^0+/, ""), a.id])),
      personnes: new Map(co.filter((c) => c.trigramme).map((c) => [String(c.trigramme).toUpperCase(), c.id])),
      activites: new Map(((corr.data ?? []) as { colonne_excel: string; activite_id: string | null }[]).filter((c) => c.activite_id).map((c) => [norm(c.colonne_excel), c.activite_id as string])),
      lignes: new Map(pl.map((l) => [`${l.affaire_id}|${l.collaborateur_id}`, l.id])),
      valides: new Set(pm.map((m) => `${m.ligne_id}|${String(m.mois).slice(0, 7)}`)),
    };
  }

  async function lire(fichier: File) {
    setErreur("");
    setInfo("");
    setResultat(null);
    setNomFichier(fichier.name);
    try {
      const wb = XLSX.read(await fichier.arrayBuffer(), { type: "array" });
      const feuilles: Record<string, unknown[][]> = {};
      for (const nom of wb.SheetNames) feuilles[nom] = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null }) as unknown[][];
      const r = lireSuiviPrestations(feuilles);
      setContexte(await chargerContexte());
      setResultat(r);
      setMoisChoisis(new Set(r.mois));
    } catch (e) {
      setErreur(e instanceof Error ? `Lecture impossible : ${e.message}` : "Lecture impossible.");
    }
  }

  /* Ligne du classeur -> commande et personne de l'application */
  const rattacher = (l: LigneHisto, c: Contexte) => {
    const numero = l.type === "CBE" ? l.numero.toUpperCase().replace(/^0+/, "") : "";
    return { affaireId: numero ? c.affaires.get(numero) ?? null : null, collabId: l.personne ? c.personnes.get(l.personne.toUpperCase()) ?? null : null };
  };

  const apercu =
    resultat && contexte
      ? resultat.mois.map((m) => {
          const ls = resultat.lignes.filter((l) => l.mois === m);
          let rattachees = 0;
          let verrouillees = 0;
          const inconnues: string[] = [];
          for (const l of ls) {
            const r = rattacher(l, contexte);
            if (r.affaireId && r.collabId) {
              rattachees++;
              const ligneId = contexte.lignes.get(`${r.affaireId}|${r.collabId}`);
              if (ligneId && contexte.valides.has(`${ligneId}|${m.slice(0, 7)}`)) verrouillees++;
            } else inconnues.push(`${l.type}${l.numero}${!r.collabId ? ` / ${l.personne ?? "?"}` : ""}`);
          }
          return {
            mois: m,
            nb: ls.length,
            rattachees,
            verrouillees,
            inconnues,
            total: ls.reduce((t, l) => t + l.montant, 0),
            passe: m.slice(0, 7) < moisCourant,
            ecartJours: ls.filter((l) => Math.abs(l.jours.reduce<number>((t, x) => t + (typeof x === "number" ? x : 0), 0) - l.heures) > 0.01).length,
          };
        })
      : [];

  async function importer() {
    if (!resultat || !contexte) return;
    const mois = [...moisChoisis].sort();
    if (!window.confirm(`Importer ${mois.length} mois dans le relevé ?\nLes mois passés seront validés (figés). Les mois déjà validés dans l'application ne sont pas touchés.`)) return;

    setErreur("");
    setInfo("");
    const c = await chargerContexte();
    const bilan = { lignes: 0, mois: 0, historique: 0, verrouilles: 0 };
    const aSynchroniser: { ligneId: string; mois: string }[] = [];

    try {
      for (const m of mois) {
        setProgression(`Import de ${libMois(m)}…`);
        const ls = resultat.lignes.filter((l) => l.mois === m);

        // lignes inconnues (ancienne désignation CAS, personne inconnue) : historique à part
        const inconnues = ls.filter((l) => {
          const r = rattacher(l, c);
          return !r.affaireId || !r.collabId;
        });
        const { error: eh } = await reessayer(() => supabase.from("prestation_historique").delete().eq("mois", m));
        if (eh) throw new Error(eh.message);
        if (inconnues.length) {
          const { error } = await reessayer(() => supabase.from("prestation_historique").insert(inconnues.map(({ jours: _j, ...h }) => h)));
          if (error) throw new Error(error.message);
          bilan.historique += inconnues.length;
        }

        // lignes rattachées, regroupées par commande × personne
        const groupes = new Map<string, Groupe>();
        for (const l of ls) {
          const r = rattacher(l, c);
          if (!r.affaireId || !r.collabId) continue;
          const cle = `${r.affaireId}|${r.collabId}`;
          const g = groupes.get(cle) ?? { cle, mois: m, affaireId: r.affaireId, collabId: r.collabId, source: [] };
          g.source.push(l);
          groupes.set(cle, g);
        }

        for (const g of groupes.values()) {
          const premiere = g.source[0];
          const activite = premiere.activite ? c.activites.get(premiere.activite.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()) ?? null : null;

          // ligne du relevé (créée si besoin), paramètres repris du classeur
          let ligneId = c.lignes.get(g.cle);
          const parametres = {
            unite: premiere.unite,
            taux: premiere.unite === "JOUR" ? premiere.taux_jour : premiere.taux_horaire,
            base_horaire: premiere.base_horaire && premiere.base_horaire > 0 && premiere.base_horaire <= 12 ? premiere.base_horaire : 7,
            intergroupe: premiere.categorie === "IG",
            actif: true,
            ...(activite ? { activite_id: activite } : {}),
          };
          if (ligneId && c.valides.has(`${ligneId}|${m.slice(0, 7)}`)) {
            bilan.verrouilles++;
            continue; // mois validé dans l'application : intouchable
          }
          if (!ligneId) {
            const { data, error } = await reessayer(() => supabase
              .from("prestation_lignes")
              .upsert({ affaire_id: g.affaireId, collaborateur_id: g.collabId, ...parametres }, { onConflict: "affaire_id,collaborateur_id" })
              .select("id")
              .single());
            if (error || !data) throw new Error(error?.message ?? "Ligne du relevé impossible à créer.");
            ligneId = data.id as string;
            c.lignes.set(g.cle, ligneId);
          } else {
            const { error } = await reessayer(() => supabase.from("prestation_lignes").update(parametres).eq("id", ligneId));
            if (error) throw new Error(error.message);
          }

          // heures jour par jour (plusieurs lignes du classeur pour la même personne : additionnées)
          const nbJours = premiere.jours.length;
          const parJour: { heures: number | null; code: string | null }[] = Array.from({ length: nbJours }, () => ({ heures: null, code: null }));
          for (const l of g.source)
            l.jours.forEach((v, j) => {
              if (typeof v === "number") parJour[j].heures = (parJour[j].heures ?? 0) + v;
              else if (typeof v === "string" && parJour[j].heures === null) parJour[j].code = v;
            });
          const finMois = `${m.slice(0, 7)}-${String(nbJours).padStart(2, "0")}`;
          const { error: ed } = await reessayer(() => supabase.from("prestation_saisies").delete().eq("ligne_id", ligneId).gte("jour", m).lte("jour", finMois));
          if (ed) throw new Error(ed.message);
          const saisies = parJour
            .map((v, j) => ({ ligne_id: ligneId as string, jour: `${m.slice(0, 7)}-${String(j + 1).padStart(2, "0")}`, heures: v.heures, code: v.heures === null ? v.code : null }))
            .filter((s) => s.heures !== null || s.code !== null);
          if (saisies.length) {
            const { error } = await reessayer(() => supabase.from("prestation_saisies").insert(saisies));
            if (error) throw new Error(error.message);
          }

          // le mois : heures sup, montant du classeur ; validé s'il est passé
          const heures = g.source.reduce((t, l) => t + l.heures, 0);
          const montant = Math.round(g.source.reduce((t, l) => t + l.montant, 0) * 100) / 100;
          const passe = m.slice(0, 7) < moisCourant;
          const { error: em } = await reessayer(() => supabase.from("prestation_mois").upsert(
            {
              ligne_id: ligneId,
              mois: m,
              hs_refacturer: g.source.reduce((t, l) => t + (l.hs_heures || 0), 0),
              montant_import: montant,
              reporte: false,
              report_sortant: null,
              valide: passe,
              valide_le: passe ? new Date().toISOString() : null,
              heures_fige: passe ? Math.round(heures * 100) / 100 : null,
              montant_fige: passe ? montant : null,
            },
            { onConflict: "ligne_id,mois" }
          ));
          if (em) throw new Error(em.message);

          aSynchroniser.push({ ligneId, mois: m });
          bilan.lignes++;
        }
        bilan.mois++;
      }

      // le planning des PE / PI suit le relevé
      let k = 0;
      for (const s of aSynchroniser) {
        k++;
        if (k % 10 === 0) setProgression(`Mise à jour du planning… ${k} / ${aSynchroniser.length}`);
        const { error } = await reessayer(() => supabase.rpc("prestation_synchroniser_planning", { p_ligne_id: s.ligneId, p_mois: s.mois }));
        if (error) throw new Error(`Planning : ${error.message}`);
      }

      setInfo(
        `Import terminé : ${bilan.mois} mois, ${bilan.lignes} lignes dans le relevé` +
          (bilan.historique ? `, ${bilan.historique} lignes non rattachées gardées dans l’historique (leur CA compte dans les Finances)` : "") +
          (bilan.verrouilles ? `, ${bilan.verrouilles} lignes ignorées car leur mois est déjà validé dans l’application` : "") +
          "."
      );
      setContexte(await chargerContexte());
    } catch (e) {
      const m = e instanceof Error ? e.message : "Import impossible.";
      setErreur(
        estCoupure(m)
          ? "La connexion a été coupée pendant l’import. Relancez-le : les mois déjà importés et validés sont ignorés, l’import reprend où il s’était arrêté."
          : m
      );
    } finally {
      setProgression("");
    }
  }

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />
      <div style={{ ...page.contenu, maxWidth: 1100 }}>
        <h1 style={page.titre}>Import du Suivi des prestations</h1>
        <p style={page.sousTitre}>
          Le classeur fait foi : ses onglets de mois remplissent le relevé PE / PI. Les mois passés arrivent validés (figés) ; le mois en cours et
          les mois futurs restent modifiables et se réimportent à volonté. Un mois validé dans l’application n’est jamais écrasé.
        </p>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && (
          <Message genre="ok">
            {info} <Link href="/pilotage/prestations" style={{ fontWeight: 800, color: C.rougeFonce }}>Ouvrir le relevé</Link>
          </Message>
        )}
        {progression && <Message genre="info">{progression}</Message>}

        <section style={{ ...page.carte, padding: 16, marginBottom: 16 }}>
          <label style={{ fontWeight: 700 }}>
            Classeur Suivi des prestations (.xlsm ou .xlsx)
            <input type="file" accept=".xlsm,.xlsx" onChange={(e) => e.target.files?.[0] && void lire(e.target.files[0])} style={{ display: "block", marginTop: 8 }} />
          </label>
          {nomFichier && <p style={{ margin: "8px 0 0", fontSize: 13, color: C.gris }}>{nomFichier}</p>}
        </section>

        {resultat && contexte && (
          <section style={{ ...page.carte, padding: 16, marginBottom: 16, overflowX: "auto" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 17 }}>
              Aperçu : {resultat.lignes.length} lignes sur {resultat.mois.length} mois
            </h2>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: C.gris }}>
              « Rattachées » : commande et personne trouvées dans l’application, elles vont dans le relevé. Les autres (ancienne désignation CAS,
              trigramme inconnu…) sont gardées dans l’historique à part : leur CA compte quand même.
            </p>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  {["", "Mois", "Statut", "Lignes", "Rattachées", "Non rattachées", "Montant", "Contrôle"].map((t, i) => (
                    <th key={t || i} style={{ ...page.th, textAlign: i < 3 ? "left" : "right" }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apercu.map((m) => (
                  <tr key={m.mois}>
                    <td style={page.td}>
                      <input
                        type="checkbox"
                        checked={moisChoisis.has(m.mois)}
                        aria-label={`Importer ${libMois(m.mois)}`}
                        onChange={(e) =>
                          setMoisChoisis((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(m.mois);
                            else n.delete(m.mois);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td style={{ ...page.td, fontWeight: 700 }}>{libMois(m.mois)}</td>
                    <td style={{ ...page.td, fontSize: 13 }}>{m.passe ? "sera validé 🔒" : "prévu (modifiable)"}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>{m.nb}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>
                      {m.rattachees}
                      {m.verrouillees > 0 && <div style={{ fontSize: 11, color: C.gris }}>dont {m.verrouillees} déjà validées : ignorées</div>}
                    </td>
                    <td style={{ ...page.td, textAlign: "right", color: m.inconnues.length ? "#7a3e00" : C.gris }} title={m.inconnues.join(", ")}>
                      {m.inconnues.length || "—"}
                    </td>
                    <td style={{ ...page.td, textAlign: "right", fontWeight: 800 }}>{euros(m.total)}</td>
                    <td style={{ ...page.td, textAlign: "right", fontSize: 12, color: m.ecartJours ? "#7a3e00" : C.gris }}>
                      {m.ecartJours ? `${m.ecartJours} ligne(s) : jours ≠ total` : "✓"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: C.gris, margin: "8px 0 0" }}>
              Survolez « Non rattachées » pour voir les numéros concernés. « jours ≠ total » : la somme des jours de la ligne ne fait pas le total
              d’heures du classeur ; le montant importé reste celui du classeur.
            </p>
            <button type="button" style={{ ...page.btnPrimaire, marginTop: 12 }} disabled={progression !== "" || moisChoisis.size === 0} onClick={() => void importer()}>
              {progression ? "Import…" : `Importer ${moisChoisis.size} mois dans le relevé`}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

export default function ImportPrestationsPage() {
  return (
    <GardeAcces droit="administration">
      <ImportContenu />
    </GardeAcces>
  );
}
