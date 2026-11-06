"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";

/* ===============================================================
   SUIVI DES NOTES DE FRAIS (administrateurs)

   Toutes les notes de l'exercice (novembre → octobre) : combien, à qui,
   pour quoi. Chiffres, total par personne, par mois et par nature de
   frais ; la liste des notes, avec leur détail, la note Excel et les
   justificatifs. Un ADMIN peut supprimer définitivement une note (même
   transmise), en tapant SUPPRIMER.
   Les montants comptés sont ceux des notes TRANSMISES (les brouillons
   sont listés à part).
================================================================ */

type Note = {
  id: string;
  collaborateur_id: string;
  mois: string;
  statut: string;
  version: number;
  total: number;
  prix_km: number;
  km_domicile: number;
  reg_depart: string | null;
  reg_km_jour: number;
  reg_nb_trajets: number;
  transmise_le: string | null;
  fichier_path: string | null;
};
type Dep = { note_id: string; jour: string | null; depart: string | null; site: string | null; km: number; aller_retour: boolean | null };
type Frais = { note_id: string; jour: string | null; nature: string | null; commentaire: string | null; montant: number; justificatif_path: string | null; justificatif_nom: string | null };
type Collab = { id: string; prenom: string | null; nom: string | null; trigramme: string | null };

const rouge = "#c00000";
const MOIS = ["nov.", "déc.", "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct."];
const euros = (v: number) => (Math.round(v * 100) / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const nbr = (v: number) => Math.round(v).toLocaleString("fr-FR");
const moisLong = (m: string) => {
  const t = new Date(`${m.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const exerciceDe = (d: Date) => (d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1);
const num = (v: unknown) => Number(v) || 0;

export default function SuiviNotesFrais() {
  const [exercice, setExercice] = useState(exerciceDe(new Date()));
  const [chargement, setChargement] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [deps, setDeps] = useState<Dep[]>([]);
  const [frais, setFrais] = useState<Frais[]>([]);
  const [collabs, setCollabs] = useState<Map<string, Collab>>(new Map());
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [personne, setPersonne] = useState("");
  const [recharge, setRecharge] = useState(0);

  const debut = `${exercice}-11-01`;
  const fin = `${exercice + 1}-10-01`;

  useEffect(() => {
    let actif = true;
    setChargement(true);
    setErreur("");
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          window.location.href = "/login";
          return;
        }
        const { data: moi } = await supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).single();
        const estAdmin = String(moi?.role ?? "").toUpperCase() === "ADMIN";
        if (!actif) return;
        setAdmin(estAdmin);
        if (!estAdmin) return;
        const [n, c] = await Promise.all([
          supabase.from("nf_notes").select("id,collaborateur_id,mois,statut,version,total,prix_km,km_domicile,reg_depart,reg_km_jour,reg_nb_trajets,transmise_le,fichier_path").gte("mois", debut).lte("mois", fin).order("mois", { ascending: false }),
          supabase.from("collaborateurs").select("id,prenom,nom,trigramme"),
        ]);
        if (n.error) throw n.error;
        const liste = ((n.data ?? []) as Record<string, unknown>[]).map((x) => ({
          ...(x as unknown as Note),
          version: num(x.version),
          total: num(x.total),
          prix_km: num(x.prix_km),
          km_domicile: num(x.km_domicile),
          reg_km_jour: num(x.reg_km_jour),
          reg_nb_trajets: num(x.reg_nb_trajets),
        }));
        const ids = liste.map((x) => x.id);
        const [d, f] = ids.length
          ? await Promise.all([
              supabase.from("nf_deplacements").select("note_id,jour,depart,site,km,aller_retour").in("note_id", ids).order("ordre"),
              supabase.from("nf_frais").select("note_id,jour,nature,commentaire,montant,justificatif_path,justificatif_nom").in("note_id", ids).order("ordre"),
            ])
          : [{ data: [] }, { data: [] }];
        if (!actif) return;
        setNotes(liste);
        setDeps(((d.data ?? []) as Record<string, unknown>[]).map((x) => ({ ...(x as unknown as Dep), km: num(x.km) })));
        setFrais(((f.data ?? []) as Record<string, unknown>[]).map((x) => ({ ...(x as unknown as Frais), montant: num(x.montant) })));
        setCollabs(new Map(((c.data ?? []) as Collab[]).map((x) => [x.id, x])));
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "Chargement impossible.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [exercice, recharge, debut, fin]);

  const nom = (id: string) => {
    const c = collabs.get(id);
    return c ? `${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || c.trigramme || "?" : "?";
  };

  /* détail chiffré d'une note : km et coût des déplacements, frais annexes */
  const detail = (n: Note) => {
    const ds = deps.filter((d) => d.note_id === n.id);
    const fs = frais.filter((f) => f.note_id === n.id);
    let km = 0;
    let coutKm = 0;
    for (const d of ds) {
      const f = d.aller_retour === false ? 1 : 2;
      const k = Math.max(0, d.km * f - (d.depart === "Domicile" ? f * n.km_domicile : 0));
      km += k;
      coutKm += k * n.prix_km;
    }
    if (n.reg_km_jour > 0 && n.reg_nb_trajets > 0) {
      const k = (n.reg_depart === "Domicile" ? Math.max(0, n.reg_km_jour - 2 * n.km_domicile) : n.reg_km_jour) * n.reg_nb_trajets;
      km += k;
      coutKm += k * n.prix_km;
    }
    return { ds, fs, km, coutKm, frais: fs.reduce((t, f) => t + f.montant, 0) };
  };

  const transmises = useMemo(() => notes.filter((n) => n.statut === "TRANSMISE" && (!personne || n.collaborateur_id === personne)), [notes, personne]);
  const brouillons = notes.filter((n) => n.statut !== "TRANSMISE" && (!personne || n.collaborateur_id === personne));

  const stats = useMemo(() => {
    let total = 0;
    let km = 0;
    let coutKm = 0;
    let annexes = 0;
    const parPersonne = new Map<string, { notes: number; km: number; coutKm: number; frais: number; total: number }>();
    const parMois = new Array(12).fill(0) as number[];
    const parNature = new Map<string, number>();
    for (const n of transmises) {
      const d = detail(n);
      total += n.total;
      km += d.km;
      coutKm += d.coutKm;
      annexes += d.frais;
      const p = parPersonne.get(n.collaborateur_id) ?? { notes: 0, km: 0, coutKm: 0, frais: 0, total: 0 };
      p.notes += 1;
      p.km += d.km;
      p.coutKm += d.coutKm;
      p.frais += d.frais;
      p.total += n.total;
      parPersonne.set(n.collaborateur_id, p);
      const m = new Date(`${n.mois.slice(0, 10)}T00:00:00`).getMonth();
      parMois[(m + 2) % 12] += n.total;
      for (const f of d.fs) parNature.set(f.nature || "Autre", (parNature.get(f.nature || "Autre") ?? 0) + f.montant);
    }
    return { total, km, coutKm, annexes, parPersonne, parMois, parNature };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transmises, deps, frais]);

  async function ouvrirFichier(chemin: string | null) {
    if (!chemin) return;
    const { data, error } = await supabase.storage.from("notes-frais").createSignedUrl(chemin, 300);
    if (error || !data) return setErreur(`Fichier introuvable : ${error?.message ?? ""}`);
    window.open(data.signedUrl, "_blank");
  }

  async function supprimer(n: Note) {
    const saisie = window.prompt(
      `Suppression DÉFINITIVE de la note de ${nom(n.collaborateur_id)} (${moisLong(n.mois)}, ${euros(n.total)})${n.statut === "TRANSMISE" ? ", déjà transmise au service RH" : ""}.\n\nElle disparaît de l’application et des statistiques. L’e-mail déjà envoyé, lui, reste chez ses destinataires.\n\nPour confirmer, tapez SUPPRIMER :`,
      ""
    );
    if ((saisie ?? "").trim().toUpperCase() !== "SUPPRIMER") return;
    setErreur("");
    const { error } = await supabase.from("nf_notes").delete().eq("id", n.id);
    if (error) return setErreur(error.message);
    setInfo(`Note de ${nom(n.collaborateur_id)} (${moisLong(n.mois)}) supprimée.`);
    setOuverte(null);
    setRecharge((x) => x + 1);
  }

  const carte: CSSProperties = { background: "#fff", border: "1px solid #e2e5e9", borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: "0 2px 8px rgba(0,0,0,.05)" };
  const th: CSSProperties = { textAlign: "left", padding: "7px 8px", borderBottom: "2px solid #dde0e4", fontSize: 13, background: "#f6f7f8", whiteSpace: "nowrap" };
  const thN: CSSProperties = { ...th, textAlign: "right" };
  const td: CSSProperties = { padding: "7px 8px", borderBottom: "1px solid #eef0f2", fontSize: 14 };
  const tdN: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const tuile = (titre: string, valeur: string, aide: string) => (
    <div style={{ ...carte, marginBottom: 0, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#6d737a", textTransform: "uppercase", letterSpacing: ".4px" }}>{titre}</div>
      <div style={{ fontSize: 26, fontWeight: 800, margin: "4px 0" }}>{valeur}</div>
      <div style={{ fontSize: 12, color: "#6d737a" }}>{aide}</div>
    </div>
  );
  const maxMois = Math.max(1, ...stats.parMois);
  const personnesListe = [...new Set(notes.map((n) => n.collaborateur_id))].sort((a, b) => nom(a).localeCompare(nom(b)));

  const ligneNote = (n: Note) => {
    const d = detail(n);
    const ouv = ouverte === n.id;
    return (
      <Fragment key={n.id}>
        <tr style={{ cursor: "pointer", background: ouv ? "#fff7f7" : undefined }} onClick={() => setOuverte(ouv ? null : n.id)}>
          <td style={{ ...td, fontWeight: 800 }}>{nom(n.collaborateur_id)}</td>
          <td style={td}>{moisLong(n.mois)}</td>
          <td style={tdN}>{nbr(d.km)} km</td>
          <td style={tdN}>{euros(d.frais)}</td>
          <td style={{ ...tdN, fontWeight: 800 }}>{euros(n.total)}</td>
          <td style={td}>
            {n.statut === "TRANSMISE" ? (
              <span style={{ color: "#18713b", fontWeight: 700 }}>
                ✓ {n.version > 1 ? `v${n.version}, ` : ""}le {new Date(n.transmise_le ?? "").toLocaleDateString("fr-FR")}
              </span>
            ) : (
              <span style={{ color: "#8a6500", fontWeight: 700 }}>Brouillon</span>
            )}
          </td>
          <td style={{ ...td, textAlign: "right" }}>{ouv ? "▴" : "▾"}</td>
        </tr>
        {ouv && (
          <tr>
            <td colSpan={7} style={{ ...td, background: "#fafbfc", padding: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {n.fichier_path && (
                  <button type="button" onClick={() => void ouvrirFichier(n.fichier_path)} style={{ border: "1px solid #c9cdd2", background: "#fff", borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    📊 Note Excel
                  </button>
                )}
                {d.fs
                  .filter((f) => f.justificatif_path)
                  .map((f, i) => (
                    <button key={i} type="button" onClick={() => void ouvrirFichier(f.justificatif_path)} style={{ border: "1px solid #c9cdd2", background: "#fff", borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      📎 {f.nature} {euros(f.montant)}
                    </button>
                  ))}
                <span style={{ flex: 1 }} />
                <button type="button" onClick={() => void supprimer(n)} style={{ border: 0, background: "transparent", color: "#a51d1d", textDecoration: "underline", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  Supprimer définitivement…
                </button>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                {d.ds.length > 0 && (
                  <div>
                    <strong>Déplacements :</strong>{" "}
                    {d.ds.map((x) => `${x.jour ? new Date(`${x.jour}T00:00:00`).toLocaleDateString("fr-FR") : "?"} ${x.site ?? ""} (${nbr(x.km)} km ${x.aller_retour === false ? "aller" : "A/R"}, départ ${x.depart})`).join(" · ")}
                  </div>
                )}
                {n.reg_km_jour > 0 && n.reg_nb_trajets > 0 && (
                  <div>
                    <strong>Régulier :</strong> {nbr(n.reg_km_jour)} km × {n.reg_nb_trajets} A/R, départ {n.reg_depart}
                  </div>
                )}
                {d.fs.length > 0 && (
                  <div>
                    <strong>Frais :</strong> {d.fs.map((f) => `${f.nature} ${euros(f.montant)}${f.commentaire ? ` (${f.commentaire})` : ""}${f.justificatif_path ? "" : " ⚠ sans justificatif"}`).join(" · ")}
                  </div>
                )}
                <div style={{ color: "#6d737a" }}>
                  Prix au km : {n.prix_km.toLocaleString("fr-FR")} € · km domicile → Polynov : {nbr(n.km_domicile)} · indemnités km : {euros(d.coutKm)}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "Calibri, Arial, sans-serif", padding: "24px 4vw 60px", color: "#252525" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <EnTetePage forme="encadre" section="Administration RH" titre="Notes de frais" description="Combien, à qui, pour quoi : toutes les notes de l’exercice" />

        {!chargement && !admin && <div style={carte}>Cette page est réservée aux administrateurs.</div>}
        {erreur && <div style={{ background: "#fdecec", color: "#a51d1d", padding: 12, borderRadius: 10, marginBottom: 14 }}>{erreur}</div>}
        {info && <div style={{ background: "#e7f6ec", color: "#18713b", padding: 12, borderRadius: 10, marginBottom: 14 }}>{info}</div>}

        {admin && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <button type="button" onClick={() => setExercice((x) => x - 1)} style={{ border: `1px solid ${rouge}`, background: "#fff", color: rouge, borderRadius: 8, padding: "8px 14px", fontWeight: 800, cursor: "pointer" }}>
                ◀
              </button>
              <strong style={{ fontSize: 18 }}>
                Exercice {exercice}-{exercice + 1}
              </strong>
              <button type="button" onClick={() => setExercice((x) => x + 1)} style={{ border: `1px solid ${rouge}`, background: "#fff", color: rouge, borderRadius: 8, padding: "8px 14px", fontWeight: 800, cursor: "pointer" }}>
                ▶
              </button>
              <select value={personne} onChange={(e) => setPersonne(e.target.value)} style={{ border: "1px solid #c9cdd2", borderRadius: 8, padding: "8px 10px", fontSize: 14, fontFamily: "inherit" }}>
                <option value="">Toute l’équipe</option>
                {personnesListe.map((id) => (
                  <option key={id} value={id}>
                    {nom(id)}
                  </option>
                ))}
              </select>
              <span style={{ flex: 1 }} />
              <a href="/admin/notes-frais" style={{ border: "1px solid #c9cdd2", borderRadius: 8, padding: "8px 14px", background: "#fff", color: "#252525", fontWeight: 800, textDecoration: "none" }}>
                ⚙ Destinataires et barème
              </a>
            </div>

            {chargement ? (
              <div style={carte}>Chargement…</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 16 }}>
                  {tuile("Total transmis", euros(stats.total), `${transmises.length} note${transmises.length > 1 ? "s" : ""} sur l’exercice`)}
                  {tuile("Indemnités km", euros(stats.coutKm), `${nbr(stats.km)} km indemnisés`)}
                  {tuile("Frais annexes", euros(stats.annexes), "péages, parkings, repas…")}
                  {tuile("Personnes", String(stats.parPersonne.size), "ont déclaré des frais")}
                </div>

                <section style={carte}>
                  <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Par mois</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 6, alignItems: "end", height: 150 }}>
                    {stats.parMois.map((v, i) => (
                      <div key={i} title={`${MOIS[i]} : ${euros(v)}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>{v > 0 ? nbr(v) : ""}</div>
                        <div style={{ width: "70%", height: `${(v / maxMois) * 110}px`, minHeight: v > 0 ? 3 : 0, background: rouge, borderRadius: "4px 4px 0 0" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 6, marginTop: 4 }}>
                    {MOIS.map((m) => (
                      <div key={m} style={{ textAlign: "center", fontSize: 12, color: "#6d737a" }}>
                        {m}
                      </div>
                    ))}
                  </div>
                </section>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}>
                  <section style={carte}>
                    <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Par personne</h2>
                    {stats.parPersonne.size === 0 ? (
                      <div style={{ color: "#6d737a" }}>Aucune note transmise.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={th}>Personne</th>
                            <th style={thN}>Notes</th>
                            <th style={thN}>Km</th>
                            <th style={thN}>Frais</th>
                            <th style={thN}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...stats.parPersonne.entries()]
                            .sort((a, b) => b[1].total - a[1].total)
                            .map(([id, p]) => (
                              <tr key={id} style={{ cursor: "pointer" }} onClick={() => setPersonne(personne === id ? "" : id)} title="Filtrer sur cette personne">
                                <td style={{ ...td, fontWeight: 800 }}>{nom(id)}</td>
                                <td style={tdN}>{p.notes}</td>
                                <td style={tdN}>{nbr(p.km)}</td>
                                <td style={tdN}>{euros(p.frais)}</td>
                                <td style={{ ...tdN, fontWeight: 800 }}>{euros(p.total)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                  <section style={carte}>
                    <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Frais annexes par nature</h2>
                    {stats.parNature.size === 0 ? (
                      <div style={{ color: "#6d737a" }}>Aucun frais annexe.</div>
                    ) : (
                      [...stats.parNature.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <span style={{ width: 110, fontWeight: 700 }}>{k}</span>
                            <div style={{ flex: 1, background: "#f1f2f4", borderRadius: 4, height: 14 }}>
                              <div style={{ width: `${(v / Math.max(1, stats.annexes)) * 100}%`, background: "#1f4e99", height: 14, borderRadius: 4 }} />
                            </div>
                            <strong style={{ width: 90, textAlign: "right" }}>{euros(v)}</strong>
                          </div>
                        ))
                    )}
                  </section>
                </div>

                <section style={carte}>
                  <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Notes transmises</h2>
                  {transmises.length === 0 ? (
                    <div style={{ color: "#6d737a" }}>Aucune note transmise sur cet exercice.</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={th}>Personne</th>
                            <th style={th}>Mois</th>
                            <th style={thN}>Km</th>
                            <th style={thN}>Frais</th>
                            <th style={thN}>Total</th>
                            <th style={th}>Transmise</th>
                            <th style={th} />
                          </tr>
                        </thead>
                        <tbody>{transmises.map(ligneNote)}</tbody>
                      </table>
                    </div>
                  )}
                </section>

                {brouillons.length > 0 && (
                  <section style={carte}>
                    <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Brouillons (pas encore transmis)</h2>
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "#6d737a" }}>Ils ne comptent pas dans les chiffres.</p>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <tbody>{brouillons.map(ligneNote)}</tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
