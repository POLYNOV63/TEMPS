"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerActivites, chargerAffectationsAffaire, chargerAnnuaire, chargerMoi, type Moi } from "@/lib/pilotageDonnees";
import { formatDate, formatHeures, libelleStatut, nomCollab, num, traduireErreur, type Affaire, type Collab } from "@/lib/pilotageCalculs";
import type { Affectation, JourRow } from "@/lib/pilotagePlanning";

/* ===============================================================
   BILAN AFFAIRE - PANNEAU « PILOTAGE » (ancienne fiche affaire)

   La fiche du Pilotage et le Bilan affaire ne font plus qu'une page.
   Ce panneau reprend ce que la fiche avait en propre, commande par
   commande (base et avenants) :
   - responsable (à changer) ;
   - délai initial et actuel, à modifier avec un motif (historisé) ;
   - historique des délais ;
   - affectations au planning ;
   - suppression (administration).
   Visible des responsables, de l'administration et de la Direction
   (lecture) ; invisible pour les autres (la base ne leur renvoie rien).
================================================================ */

type Historique = {
  id: string;
  ancienne_date: string | null;
  nouvelle_date: string | null;
  motif: string;
  commentaire: string | null;
  modifie_par: string | null;
  modifie_le: string;
};

const MOTIFS = ["Ressource indisponible", "Demande du client", "Retard fournisseur", "Changement de périmètre", "Replanification interne", "Date de rendu du devis"];

export default function PanneauPilotageAffaire({ type, base }: { type: "CBE" | "DBE"; base: string }) {
  const [commandes, setCommandes] = useState<Affaire[]>([]);
  const [choisie, setChoisie] = useState<string>("");
  const [moi, setMoi] = useState<Moi | null>(null);
  const [annuaire, setAnnuaire] = useState<Collab[]>([]);
  const [activites, setActivites] = useState<Map<string, string>>(new Map());
  const [historique, setHistorique] = useState<Historique[]>([]);
  const [affectations, setAffectations] = useState<{ affectation: Affectation; heures: number }[]>([]);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [edition, setEdition] = useState<"" | "responsable" | "delai">("");
  const [fResp, setFResp] = useState("");
  const [fDate, setFDate] = useState("");
  const [fMotif, setFMotif] = useState("");
  const [fCommentaire, setFCommentaire] = useState("");
  const [voirAffectations, setVoirAffectations] = useState(false);
  const [voirHistorique, setVoirHistorique] = useState(false);

  /* la famille de commandes (1604, 1604R1, 1604R2…) dans le Pilotage */
  const chargerCommandes = useCallback(async () => {
    const num0 = base.replace(/^0+/, "");
    const { data, error } = await supabase.from("pilotage_affaires").select("*").eq("type", type).ilike("numero", `%${num0}%`);
    if (error) return;
    const famille = ((data ?? []) as Affaire[])
      .filter((a) => new RegExp(`^0*${num0}(R\\d+)?$`, "i").test(a.numero))
      .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));
    setCommandes(famille);
    setChoisie((c) => {
      if (c && famille.some((a) => a.id === c)) return c;
      const demandee = new URLSearchParams(window.location.search).get("commande");
      return (famille.find((a) => a.numero.toUpperCase() === (demandee ?? "").toUpperCase()) ?? famille.find((a) => /^\d+$/.test(a.numero)) ?? famille[0])?.id ?? "";
    });
  }, [type, base]);

  useEffect(() => {
    void chargerCommandes();
    chargerMoi().then(setMoi).catch(() => setMoi(null));
    chargerAnnuaire().then(setAnnuaire).catch(() => setAnnuaire([]));
    chargerActivites()
      .then((r) => setActivites(new Map(r.activites.map((a) => [a.id, a.nom]))))
      .catch(() => undefined);
  }, [chargerCommandes]);

  /* historique et affectations de la commande choisie */
  useEffect(() => {
    if (!choisie) return;
    let actif = true;
    Promise.all([
      supabase
        .from("pilotage_echeances_historique")
        .select("id,ancienne_date,nouvelle_date,motif,commentaire,modifie_par,modifie_le")
        .eq("affaire_id", choisie)
        .order("modifie_le", { ascending: false }),
      chargerAffectationsAffaire(choisie),
    ])
      .then(([h, a]) => {
        if (!actif) return;
        setHistorique((h.data ?? []) as Historique[]);
        const jours = a.jours as JourRow[];
        setAffectations(
          (a.affectations as Affectation[])
            .map((x) => ({ affectation: x, heures: jours.filter((j) => j.affectation_id === x.id).reduce((t, j) => t + num(j.heures), 0) }))
            .sort((x, y) => x.affectation.date_debut.localeCompare(y.affectation.date_debut))
        );
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [choisie]);

  const affaire = useMemo(() => commandes.find((a) => a.id === choisie), [commandes, choisie]);
  const collabs = useMemo(() => new Map(annuaire.map((c) => [c.id, c])), [annuaire]);
  const peutModifier = Boolean(moi?.peutModifier);

  if (commandes.length === 0 || !affaire) return null;

  async function enregistrerResponsable() {
    if (!affaire) return;
    setEnCours(true);
    setErreur("");
    const { error } = await supabase.from("pilotage_affaires").update({ responsable_id: fResp }).eq("id", affaire.id);
    setEnCours(false);
    if (error) return setErreur(traduireErreur(error.message));
    setEdition("");
    setInfo("Responsable changé.");
    await chargerCommandes();
  }

  async function enregistrerDelai() {
    if (!affaire) return;
    if (!fDate) return setErreur("Indiquez la nouvelle date.");
    if (!fMotif.trim()) return setErreur("Le motif est obligatoire : il est conservé dans l’historique.");
    setEnCours(true);
    setErreur("");
    const { error } = await supabase.rpc("pilotage_changer_echeance", {
      p_affaire_id: affaire.id,
      p_nouvelle_date: fDate,
      p_motif: fMotif.trim(),
      p_commentaire: fCommentaire.trim() || null,
    });
    setEnCours(false);
    if (error) return setErreur(traduireErreur(error.message));
    setEdition("");
    setInfo(affaire.type === "DBE" ? "Date de rendu modifiée et historisée." : "Délai modifié et historisé.");
    await chargerCommandes();
    const h = await supabase
      .from("pilotage_echeances_historique")
      .select("id,ancienne_date,nouvelle_date,motif,commentaire,modifie_par,modifie_le")
      .eq("affaire_id", affaire.id)
      .order("modifie_le", { ascending: false });
    setHistorique((h.data ?? []) as Historique[]);
  }

  async function supprimer() {
    if (!affaire) return;
    if (
      !window.confirm(
        `Supprimer ${affaire.type} ${affaire.numero} du Pilotage, avec ses affectations et son historique ?\nLes heures des feuilles d’heures ne sont pas touchées. Une affaire du Suivi d’affaire réapparaîtra à la prochaine synchronisation.`
      )
    )
      return;
    const { error } = await supabase.from("pilotage_affaires").delete().eq("id", affaire.id);
    if (error) return setErreur(traduireErreur(error.message));
    setInfo(`${affaire.type} ${affaire.numero} supprimée du Pilotage.`);
    setChoisie("");
    await chargerCommandes();
  }

  const dbe = affaire.type === "DBE";
  const etiquette: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: C.gris };
  const valeur: CSSProperties = { fontSize: 19, fontWeight: 700, marginTop: 2 };
  const lien: CSSProperties = { all: "unset", cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.rougeFonce, display: "block", marginTop: 4 };

  return (
    <section style={{ ...page.carte, padding: 16, marginBottom: 16, borderLeft: `5px solid ${C.rouge}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Pilotage</h2>
        {commandes.length > 1 &&
          commandes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setChoisie(c.id);
                setEdition("");
                setErreur("");
                setInfo("");
              }}
              aria-pressed={c.id === choisie}
              style={{
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: `1.5px solid ${c.id === choisie ? C.rouge : "#c9cdd2"}`,
                background: c.id === choisie ? C.rouge : "#ffffff",
                color: c.id === choisie ? "#ffffff" : "#3b4046",
                fontWeight: 800,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {c.numero}
              <span style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{libelleStatut(c.statut).toLowerCase()}</span>
            </button>
          ))}
        <span style={{ flex: 1 }} />
        <Link href={`/pilotage/affaires?ouvrir=${affaire.id}`} style={{ fontWeight: 700, color: C.rougeFonce }}>
          Voir au planning →
        </Link>
      </div>

      {erreur && <Message genre="erreur">{erreur}</Message>}
      {info && <Message genre="ok">{info}</Message>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px 40px", alignItems: "flex-start" }}>
        <div>
          <div style={etiquette}>{dbe ? "Rédacteur" : "Responsable"}</div>
          {edition === "responsable" ? (
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <select value={fResp} onChange={(e) => setFResp(e.target.value)} style={{ ...page.entrees, width: 230, minHeight: 38 }}>
                {[...annuaire]
                  .sort((x, y) => nomCollab(x).localeCompare(nomCollab(y), "fr"))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {nomCollab(c)} — {`${c.prenom ?? ""} ${c.nom ?? ""}`.trim()}
                    </option>
                  ))}
              </select>
              <button type="button" disabled={enCours} onClick={() => void enregistrerResponsable()} style={{ ...page.btnPrimaire, minHeight: 38 }}>
                OK
              </button>
              <button type="button" onClick={() => setEdition("")} style={{ ...page.btnSecondaire, minHeight: 38 }}>
                ✕
              </button>
            </div>
          ) : (
            <>
              <div style={valeur}>{nomCollab(collabs.get(affaire.responsable_id))}</div>
              {peutModifier && (
                <button
                  type="button"
                  style={lien}
                  onClick={() => {
                    setFResp(affaire.responsable_id);
                    setEdition("responsable");
                    setErreur("");
                  }}
                >
                  ✏️ changer
                </button>
              )}
            </>
          )}
        </div>

        <div>
          <div style={etiquette}>{dbe ? "Rendu initial" : "Délai initial"}</div>
          <div style={valeur}>{formatDate(affaire.echeance_initiale)}</div>
        </div>

        <div>
          <div style={etiquette}>{dbe ? "Rendu actuel" : "Délai actuel"}</div>
          <div style={{ ...valeur, color: affaire.echeance && affaire.statut !== "LIVREE" && affaire.echeance < new Date().toISOString().slice(0, 10) ? "#b3261e" : undefined }}>
            {formatDate(affaire.echeance)}
          </div>
          {historique[0] && (
            <div style={{ fontSize: 12, color: C.gris }}>
              changé le {formatDate(historique[0].modifie_le)} — {historique[0].motif}
            </div>
          )}
          {peutModifier && edition !== "delai" && (
            <button
              type="button"
              style={lien}
              onClick={() => {
                setFDate(affaire.echeance ?? "");
                setFMotif("");
                setFCommentaire("");
                setEdition("delai");
                setErreur("");
              }}
            >
              ✏️ {affaire.echeance ? (dbe ? "modifier la date de rendu" : "modifier le délai") : dbe ? "définir la date de rendu" : "définir le délai"}
            </button>
          )}
        </div>

        <div>
          <div style={etiquette}>Statut</div>
          <div style={valeur}>{libelleStatut(affaire.statut)}</div>
          {affaire.date_livraison && <div style={{ fontSize: 12, color: C.gris }}>le {formatDate(affaire.date_livraison)}</div>}
        </div>
      </div>

      {edition === "delai" && (
        <div style={{ marginTop: 12, padding: 12, background: "#fff6fa", borderRadius: 10, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris }}>
            Nouvelle date
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} style={{ ...page.entrees, width: 170, minHeight: 38 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris, flex: "1 1 220px" }}>
            Motif (obligatoire, gardé dans l’historique)
            <input list="motifs-delai" value={fMotif} onChange={(e) => setFMotif(e.target.value)} style={{ ...page.entrees, minHeight: 38 }} />
            <datalist id="motifs-delai">
              {MOTIFS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, fontWeight: 700, color: C.gris, flex: "1 1 200px" }}>
            Commentaire
            <input value={fCommentaire} onChange={(e) => setFCommentaire(e.target.value)} style={{ ...page.entrees, minHeight: 38 }} />
          </label>
          <button type="button" disabled={enCours} onClick={() => void enregistrerDelai()} style={{ ...page.btnPrimaire, minHeight: 38 }}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" onClick={() => setEdition("")} style={{ ...page.btnSecondaire, minHeight: 38 }}>
            Annuler
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 14 }}>
        <button type="button" onClick={() => setVoirAffectations((v) => !v)} style={{ all: "unset", cursor: "pointer", fontWeight: 800 }}>
          {voirAffectations ? "▾" : "▸"} Affectations au planning ({affectations.length})
        </button>
        <button type="button" onClick={() => setVoirHistorique((v) => !v)} style={{ all: "unset", cursor: "pointer", fontWeight: 800 }}>
          {voirHistorique ? "▾" : "▸"} Historique des {dbe ? "dates de rendu" : "délais"} ({historique.length})
        </button>
        {moi?.estAdmin && (
          <button type="button" onClick={() => void supprimer()} style={{ all: "unset", cursor: "pointer", marginLeft: "auto", fontSize: 13, color: C.gris, textDecoration: "underline" }}>
            Supprimer du Pilotage
          </button>
        )}
      </div>

      {voirAffectations && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          {affectations.length === 0 ? (
            <p style={{ margin: 0, color: C.gris }}>Aucune affectation au planning.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={page.th}>Ressource</th>
                  <th style={page.th}>Activité</th>
                  <th style={page.th}>Du</th>
                  <th style={page.th}>Au</th>
                  <th style={{ ...page.th, textAlign: "right" }}>Heures</th>
                </tr>
              </thead>
              <tbody>
                {affectations.map(({ affectation, heures }) => (
                  <tr key={affectation.id}>
                    <td style={{ ...page.td, fontWeight: 800 }}>{nomCollab(collabs.get(affectation.collaborateur_id))}</td>
                    <td style={page.td}>
                      {affectation.activite_id ? activites.get(affectation.activite_id) ?? "—" : "—"}
                      {affectation.code ? ` · ${affectation.code}` : ""}
                    </td>
                    <td style={page.td}>{formatDate(affectation.date_debut)}</td>
                    <td style={page.td}>{formatDate(affectation.date_fin)}</td>
                    <td style={{ ...page.td, textAlign: "right" }}>{formatHeures(heures)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {voirHistorique && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          {historique.length === 0 ? (
            <p style={{ margin: 0, color: C.gris }}>Aucun changement de date.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={page.th}>Changé le</th>
                  <th style={page.th}>Ancienne date</th>
                  <th style={page.th}>Nouvelle date</th>
                  <th style={page.th}>Motif</th>
                  <th style={page.th}>Par</th>
                </tr>
              </thead>
              <tbody>
                {historique.map((h) => (
                  <tr key={h.id}>
                    <td style={page.td}>{formatDate(h.modifie_le)}</td>
                    <td style={page.td}>{formatDate(h.ancienne_date)}</td>
                    <td style={{ ...page.td, fontWeight: 800 }}>{formatDate(h.nouvelle_date)}</td>
                    <td style={page.td}>
                      {h.motif}
                      {h.commentaire && <div style={{ fontSize: 12, color: C.gris }}>{h.commentaire}</div>}
                    </td>
                    <td style={page.td}>{nomCollab(h.modifie_par ? collabs.get(h.modifie_par) : undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
