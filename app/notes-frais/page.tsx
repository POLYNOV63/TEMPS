"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";
import { MAX_DEPLACEMENTS_EXCEL, remplirNoteExcel } from "./remplirNote";

/* ===============================================================
   MES NOTES DE FRAIS (Mon espace)

   Une note par mois. Le collaborateur la remplit ici (véhicule retenu d'un
   mois sur l'autre, déplacements, déplacement régulier, frais annexes avec
   justificatif), les coûts se calculent en direct avec les règles de la
   note Excel CT-NFP. « Transmettre » l'envoie DIRECTEMENT au service RH
   (sans validation), les administrateurs et lui-même en copie : tout le
   détail dans l'e-mail, la note Excel remplie et les justificatifs en
   pièces jointes. Une note reste modifiable : « Retransmettre » envoie la
   version corrigée (n° 2, 3…), qui remplace la précédente.
================================================================ */

type Bareme = { puissance: string; prix_km: number };
type Dep = { jour: string; depart: string; site: string; km: string };
type Frais = { jour: string; nature: string; commentaire: string; montant: string; justificatif_path: string | null; justificatif_nom: string | null; fichier: File | null };
type Note = {
  id: string | null;
  mois: string;
  vehicule: string;
  puissance: string;
  km_domicile: string;
  reg_depart: string;
  reg_site: string;
  reg_km_jour: string;
  reg_nb_trajets: string;
  statut: "BROUILLON" | "TRANSMISE";
  version: number;
  transmise_le: string | null;
  updated_at: string | null;
};
type Resume = { id: string; mois: string; statut: string; version: number; total: number; transmise_le: string | null; updated_at: string };

const rouge = "#c00000";
const NATURES = ["Péage", "Parking", "Repas", "Hôtel", "Train / avion", "Carburant", "Autre"];
const n = (t: string) => {
  const v = Number(String(t ?? "").replace(",", ".").trim());
  return Number.isFinite(v) ? v : 0;
};
const texte = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
const euros = (v: number) => (Math.round(v * 100) / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const moisLong = (m: string) => {
  const t = new Date(`${m.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const moisCourant = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const depVide = (): Dep => ({ jour: "", depart: "Polynov", site: "", km: "" });
const fraisVide = (): Frais => ({ jour: "", nature: "Péage", commentaire: "", montant: "", justificatif_path: null, justificatif_nom: null, fichier: null });

/* Photo de justificatif : réduite (1600 px, JPEG) pour que l'e-mail reste léger */
async function alleger(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return f;
  }
}

export default function NotesDeFraisPage() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState("");
  const [uid, setUid] = useState("");
  const [moi, setMoi] = useState<{ id: string; prenom: string | null; nom: string | null; trigramme: string | null; role: string | null } | null>(null);
  const [baremes, setBaremes] = useState<Bareme[]>([]);
  const [profil, setProfil] = useState<{ vehicule: string; puissance: string; km_domicile: string }>({ vehicule: "", puissance: "", km_domicile: "" });
  const [notes, setNotes] = useState<Resume[]>([]);
  const [sites, setSites] = useState<Map<string, number>>(new Map());
  const [note, setNote] = useState<Note | null>(null);
  const [deps, setDeps] = useState<Dep[]>([]);
  const [frais, setFrais] = useState<Frais[]>([]);
  const [modifiee, setModifiee] = useState(false);
  const [nouveauMois, setNouveauMois] = useState(moisCourant().slice(0, 7));

  async function charger() {
    setErreur("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setUid(user.id);
    const { data: c, error: ce } = await supabase.from("collaborateurs").select("id,prenom,nom,trigramme,role").eq("auth_user_id", user.id).single();
    if (ce || !c) throw new Error("Collaborateur introuvable.");
    setMoi(c);
    const [b, p, l] = await Promise.all([
      supabase.from("nf_baremes").select("puissance,prix_km").order("ordre"),
      supabase.from("nf_profils").select("vehicule,puissance,km_domicile").eq("collaborateur_id", c.id).maybeSingle(),
      supabase.from("nf_notes").select("id,mois,statut,version,total,transmise_le,updated_at").eq("collaborateur_id", c.id).order("mois", { ascending: false }),
    ]);
    if (b.error) throw b.error;
    if (l.error) throw l.error;
    setBaremes(((b.data ?? []) as { puissance: string; prix_km: number | string }[]).map((x) => ({ puissance: x.puissance, prix_km: Number(x.prix_km) })));
    if (p.data) setProfil({ vehicule: p.data.vehicule ?? "", puissance: p.data.puissance ?? "", km_domicile: texte(p.data.km_domicile) });
    const liste = ((l.data ?? []) as Resume[]).map((x) => ({ ...x, total: Number(x.total) || 0 }));
    setNotes(liste);
    // sites déjà utilisés, avec leurs km : proposés à la saisie
    if (liste.length) {
      const { data: d } = await supabase.from("nf_deplacements").select("site,km").in("note_id", liste.map((x) => x.id));
      const m = new Map<string, number>();
      for (const x of (d ?? []) as { site: string | null; km: number | string | null }[]) if (x.site && Number(x.km) > 0) m.set(x.site.trim(), Number(x.km));
      setSites(m);
    }
  }

  useEffect(() => {
    void charger()
      .catch((e) => setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setChargement(false));
  }, []);

  async function ouvrir(id: string) {
    setErreur("");
    setInfo("");
    const [a, b, c] = await Promise.all([
      supabase.from("nf_notes").select("*").eq("id", id).single(),
      supabase.from("nf_deplacements").select("*").eq("note_id", id).order("ordre"),
      supabase.from("nf_frais").select("*").eq("note_id", id).order("ordre"),
    ]);
    if (a.error || !a.data) return setErreur(a.error?.message ?? "Note introuvable.");
    const x = a.data;
    setNote({
      id: x.id,
      mois: x.mois,
      vehicule: x.vehicule ?? "",
      puissance: x.puissance ?? "",
      km_domicile: texte(x.km_domicile),
      reg_depart: x.reg_depart ?? "Polynov",
      reg_site: x.reg_site ?? "",
      reg_km_jour: texte(x.reg_km_jour),
      reg_nb_trajets: texte(x.reg_nb_trajets),
      statut: x.statut,
      version: Number(x.version) || 0,
      transmise_le: x.transmise_le,
      updated_at: x.updated_at,
    });
    setDeps(((b.data ?? []) as { jour: string | null; depart: string | null; site: string | null; km: number | string | null }[]).map((d) => ({ jour: d.jour ?? "", depart: d.depart ?? "Polynov", site: d.site ?? "", km: texte(d.km) })));
    setFrais(
      ((c.data ?? []) as { jour: string | null; nature: string | null; commentaire: string | null; montant: number | string; justificatif_path: string | null; justificatif_nom: string | null }[]).map((f) => ({
        jour: f.jour ?? "",
        nature: f.nature ?? "Autre",
        commentaire: f.commentaire ?? "",
        montant: texte(f.montant),
        justificatif_path: f.justificatif_path,
        justificatif_nom: f.justificatif_nom,
        fichier: null,
      }))
    );
    setModifiee(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nouvelle() {
    const mois = `${nouveauMois}-01`;
    const existante = notes.find((x) => x.mois.slice(0, 10) === mois);
    if (existante) return void ouvrir(existante.id);
    setNote({ id: null, mois, vehicule: profil.vehicule, puissance: profil.puissance, km_domicile: profil.km_domicile, reg_depart: "Polynov", reg_site: "", reg_km_jour: "", reg_nb_trajets: "", statut: "BROUILLON", version: 0, transmise_le: null, updated_at: null });
    setDeps([depVide()]);
    setFrais([]);
    setModifiee(true);
    setInfo("");
  }

  /* ------------------------------ calculs (règles de la note Excel) ------------------------------ */
  const prix = baremes.find((b) => b.puissance === note?.puissance)?.prix_km ?? 0;
  const kmDom = n(note?.km_domicile ?? "");
  const coutDep = (d: Dep) => (d.depart === "Domicile" ? Math.max(0, (n(d.km) - 2 * kmDom) * prix) : n(d.km) * prix);
  const totaux = useMemo(() => {
    if (!note) return { occ: 0, reg: 0, frais: 0, total: 0 };
    const occ = deps.reduce((t, d) => t + coutDep(d), 0);
    const kj = n(note.reg_km_jour);
    const nt = n(note.reg_nb_trajets);
    const reg = kj > 0 && nt > 0 ? (note.reg_depart === "Domicile" ? Math.max(0, (kj - 2 * kmDom) * nt * prix) : kj * nt * prix) : 0;
    const fr = frais.reduce((t, f) => t + n(f.montant), 0);
    return { occ, reg, frais: fr, total: occ + reg + fr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, deps, frais, prix, kmDom]);

  const changerNote = (patch: Partial<Note>) => {
    setNote((x) => (x ? { ...x, ...patch } : x));
    setModifiee(true);
  };
  const changerDep = (i: number, patch: Partial<Dep>) => {
    setDeps((l) => l.map((d, k) => (k === i ? { ...d, ...patch } : d)));
    setModifiee(true);
  };
  const changerFrais = (i: number, patch: Partial<Frais>) => {
    setFrais((l) => l.map((f, k) => (k === i ? { ...f, ...patch } : f)));
    setModifiee(true);
  };

  /* ------------------------------ enregistrement ------------------------------ */
  async function enregistrer(): Promise<string | null> {
    if (!note || !moi) return null;
    setErreur("");
    const depsValides = deps.filter((d) => d.jour || d.site || n(d.km) > 0);
    if (depsValides.length > MAX_DEPLACEMENTS_EXCEL) {
      setErreur(`La note de frais compte ${MAX_DEPLACEMENTS_EXCEL} déplacements occasionnels au plus : regroupez-en, ou utilisez le déplacement régulier.`);
      return null;
    }
    const champsNote = {
      collaborateur_id: moi.id,
      mois: note.mois,
      vehicule: note.vehicule.trim() || null,
      puissance: note.puissance || null,
      prix_km: prix || null,
      km_domicile: note.km_domicile.trim() ? n(note.km_domicile) : null,
      reg_depart: note.reg_depart || null,
      reg_site: note.reg_site.trim() || null,
      reg_km_jour: note.reg_km_jour.trim() ? n(note.reg_km_jour) : null,
      reg_nb_trajets: note.reg_nb_trajets.trim() ? n(note.reg_nb_trajets) : null,
      total: Math.round(totaux.total * 100) / 100,
      updated_at: new Date().toISOString(),
    };
    let id = note.id;
    if (id) {
      const { error } = await supabase.from("nf_notes").update(champsNote).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("nf_notes").insert(champsNote).select("id").single();
      if (error) throw error;
      id = data.id as string;
    }

    // justificatifs nouvellement choisis : envoyés dans le dossier de l'utilisateur
    const fraisPrets: Frais[] = [];
    for (const f of frais) {
      if (!f.fichier) {
        fraisPrets.push(f);
        continue;
      }
      const fichier = await alleger(f.fichier);
      const chemin = `${uid}/${id}/${crypto.randomUUID()}-${fichier.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("notes-frais").upload(chemin, fichier);
      if (error) throw new Error(`Justificatif « ${f.fichier.name} » : ${error.message}`);
      fraisPrets.push({ ...f, fichier: null, justificatif_path: chemin, justificatif_nom: fichier.name });
    }

    await supabase.from("nf_deplacements").delete().eq("note_id", id);
    if (depsValides.length) {
      const { error } = await supabase.from("nf_deplacements").insert(
        depsValides.map((d, k) => ({ note_id: id, ordre: k, jour: d.jour || null, depart: d.depart || null, site: d.site.trim() || null, km: d.km.trim() ? n(d.km) : null }))
      );
      if (error) throw error;
    }
    await supabase.from("nf_frais").delete().eq("note_id", id);
    const fraisValides = fraisPrets.filter((f) => n(f.montant) > 0 || f.justificatif_path || f.commentaire.trim());
    if (fraisValides.length) {
      const { error } = await supabase.from("nf_frais").insert(
        fraisValides.map((f, k) => ({ note_id: id, ordre: k, jour: f.jour || null, nature: f.nature, commentaire: f.commentaire.trim() || null, montant: n(f.montant), justificatif_path: f.justificatif_path, justificatif_nom: f.justificatif_nom }))
      );
      if (error) throw error;
    }

    // le véhicule et la distance domicile → Polynov sont retenus pour les prochaines notes
    await supabase.from("nf_profils").upsert({ collaborateur_id: moi.id, vehicule: champsNote.vehicule, puissance: champsNote.puissance, km_domicile: champsNote.km_domicile, updated_at: new Date().toISOString() });

    setFrais(fraisValides);
    setDeps(depsValides.length ? depsValides : [depVide()]);
    setNote((x) => (x ? { ...x, id, updated_at: champsNote.updated_at } : x));
    setModifiee(false);
    await charger();
    return id;
  }

  async function sauver() {
    setEnCours("enregistrer");
    setInfo("");
    try {
      if (await enregistrer()) setInfo("Note enregistrée. Elle n’est pas encore transmise.");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setEnCours("");
    }
  }

  async function transmettre() {
    if (!note || !moi) return;
    const sansJustif = frais.filter((f) => n(f.montant) > 0 && !f.justificatif_path && !f.fichier);
    if (sansJustif.length && !window.confirm(`${sansJustif.length} frais annexe(s) sans justificatif : ils ne sont remboursés que sur justificatif de paiement.\n\nTransmettre quand même ?`)) return;
    const retransmission = note.statut === "TRANSMISE";
    if (
      !window.confirm(
        retransmission
          ? `Retransmettre la note de ${moisLong(note.mois)} corrigée (${euros(totaux.total)}) ?\n\nElle part au service RH comme version n° ${note.version + 1} et remplace la précédente. Les administrateurs et vous êtes en copie.`
          : `Transmettre la note de ${moisLong(note.mois)} (${euros(totaux.total)}) au service RH ?\n\nElle part directement, avec la note Excel et les justificatifs. Les administrateurs et vous êtes en copie.`
      )
    )
      return;
    setEnCours("transmettre");
    setErreur("");
    setInfo("");
    try {
      const id = await enregistrer();
      if (!id) return;
      const fichier = await remplirNoteExcel({
        qui: `${(moi.nom ?? "").toUpperCase()} ${moi.prenom ?? ""}`.trim(),
        mois: note.mois,
        vehicule: note.vehicule,
        puissance: note.puissance,
        kmDomicile: note.km_domicile.trim() ? n(note.km_domicile) : null,
        deplacements: deps.filter((d) => d.jour || d.site || n(d.km) > 0).map((d) => ({ jour: d.jour || null, depart: d.depart, site: d.site, km: d.km.trim() ? n(d.km) : null })),
        regDepart: note.reg_depart,
        regSite: note.reg_site,
        regKmJour: note.reg_km_jour.trim() ? n(note.reg_km_jour) : null,
        regNbTrajets: note.reg_nb_trajets.trim() ? n(note.reg_nb_trajets) : null,
        bareme: baremes,
        frais: frais.filter((f) => n(f.montant) > 0).map((f) => ({ jour: f.jour || null, nature: f.nature, commentaire: f.commentaire, montant: n(f.montant) })),
      });
      const chemin = `${uid}/${id}/note-de-frais-v${note.version + 1}.xlsx`;
      const { error: eu } = await supabase.storage.from("notes-frais").upload(chemin, fichier, { upsert: true, contentType: fichier.type });
      if (eu) throw new Error(`Note Excel : ${eu.message}`);
      const { error: ef } = await supabase.from("nf_notes").update({ fichier_path: chemin }).eq("id", id);
      if (ef) throw ef;

      const { data, error } = await supabase.functions.invoke("envoyer-note-frais", { body: { note_id: id } });
      const message = (data as { error?: string } | null)?.error;
      if (error || message) {
        let detail = message ?? "";
        if (!detail && error && "context" in error) detail = await (error as { context: Response }).context.json().then((j: { error?: string }) => j.error ?? "").catch(() => "");
        throw new Error(`La note est enregistrée, mais l’e-mail n’est pas parti : ${detail || error?.message || "erreur inconnue"}`);
      }
      setInfo(retransmission ? `Version corrigée transmise au service RH (n° ${note.version + 1}). Vous êtes en copie.` : "Note transmise au service RH. Les administrateurs et vous êtes en copie.");
      await ouvrir(id);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Transmission impossible.");
    } finally {
      setEnCours("");
    }
  }

  async function supprimerBrouillon() {
    if (!note?.id || note.statut !== "BROUILLON") return;
    if (!window.confirm(`Supprimer le brouillon de ${moisLong(note.mois)} ?`)) return;
    const { error } = await supabase.from("nf_notes").delete().eq("id", note.id);
    if (error) return setErreur(error.message);
    setNote(null);
    setInfo("Brouillon supprimé.");
    await charger();
  }

  /* ------------------------------ affichage ------------------------------ */
  const champ: CSSProperties = { border: "1px solid #c9cdd2", borderRadius: 8, padding: "9px 10px", fontSize: 15, fontFamily: "inherit", background: "#fff", minWidth: 0, boxSizing: "border-box" };
  const etiquette: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 700, color: "#4b5057" };
  const carte: CSSProperties = { background: "#fff", border: "1px solid #e2e5e9", borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: "0 2px 8px rgba(0,0,0,.05)" };
  const titre: CSSProperties = { margin: "0 0 12px", fontSize: 18 };
  const bouton = (principal = false): CSSProperties => ({ border: principal ? 0 : "1px solid #c9cdd2", borderRadius: 8, padding: "10px 16px", background: principal ? rouge : "#fff", color: principal ? "#fff" : "#252525", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" });
  const petit: CSSProperties = { border: "1px dashed #b9bec5", background: "#fff", borderRadius: 8, padding: "8px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: "#4b5057" };
  const croix: CSSProperties = { border: 0, background: "transparent", color: rouge, fontSize: 20, fontWeight: 800, cursor: "pointer", padding: "0 6px" };
  const modifieeDepuis = note?.statut === "TRANSMISE" && (modifiee || (note.updated_at && note.transmise_le && new Date(note.updated_at).getTime() - new Date(note.transmise_le).getTime() > 60000));

  return (
    <main style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "Calibri, Arial, sans-serif", padding: "24px 4vw 60px", color: "#252525" }}>
      {/* NF_COMPACT : contenu resserré et centré ; une colonne sur téléphone */}
      <style>{`@media (max-width: 760px) { .nf-ligne { grid-template-columns: 1fr 1fr !important; } .nf-ligne > * { width: auto !important; } }`}</style>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <EnTetePage forme="encadre" section="Espace collaborateur" titre="Mes notes de frais" description={moi ? `${moi.prenom ?? ""} ${moi.nom ?? ""} · ${moi.trigramme ?? ""}` : ""} />

      {String(moi?.role ?? "").toUpperCase() === "ADMIN" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <a href="/admin/notes-frais" style={{ border: "1px solid #c9cdd2", borderRadius: 8, padding: "8px 14px", background: "#fff", color: "#252525", fontWeight: 800, textDecoration: "none" }}>
            ⚙ Paramètres des notes de frais (destinataires, barème)
          </a>
        </div>
      )}
      {erreur && <div style={{ background: "#fdecec", color: "#a51d1d", padding: 12, borderRadius: 10, marginBottom: 14 }}>{erreur}</div>}
      {info && <div style={{ background: "#e7f6ec", color: "#18713b", padding: 12, borderRadius: 10, marginBottom: 14 }}>{info}</div>}
      {chargement && <div style={carte}>Chargement…</div>}

      {!chargement && (
        <section style={carte}>
          <h2 style={titre}>Mes notes</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: notes.length ? 14 : 0 }}>
            <label style={etiquette}>
              Mois
              <input type="month" value={nouveauMois} onChange={(e) => setNouveauMois(e.target.value)} style={champ} />
            </label>
            <button type="button" style={bouton(true)} onClick={nouvelle}>
              + Nouvelle note
            </button>
          </div>
          {notes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {notes.map((x) => {
                const ouverte = note?.id === x.id;
                const modif = x.statut === "TRANSMISE" && x.transmise_le && new Date(x.updated_at).getTime() - new Date(x.transmise_le).getTime() > 60000;
                return (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => void ouvrir(x.id)}
                    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, textAlign: "left", border: `1.5px solid ${ouverte ? rouge : "#e2e5e9"}`, background: ouverte ? "#fff5f5" : "#fff", borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 15 }}
                  >
                    <strong style={{ minWidth: 150 }}>{moisLong(x.mois)}</strong>
                    <span style={{ fontWeight: 800 }}>{euros(x.total)}</span>
                    {x.statut === "TRANSMISE" ? (
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#18713b", background: "#e7f6ec", borderRadius: 999, padding: "3px 9px" }}>
                        ✓ Transmise{x.version > 1 ? ` (version ${x.version})` : ""} le {new Date(x.transmise_le ?? "").toLocaleDateString("fr-FR")}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#8a6500", background: "#fff3cd", borderRadius: 999, padding: "3px 9px" }}>Brouillon</span>
                    )}
                    {modif && <span style={{ fontSize: 12, fontWeight: 800, color: "#7a3e00" }}>● modifiée depuis : à retransmettre</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {note && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "6px 0 12px" }}>
            <h2 style={{ margin: 0, fontSize: 24 }}>Note de {moisLong(note.mois)}</h2>
            {note.statut === "TRANSMISE" && (
              <span style={{ color: "#18713b", fontWeight: 800, fontSize: 14 }}>
                ✓ Transmise{note.version > 1 ? ` (version ${note.version})` : ""} le {new Date(note.transmise_le ?? "").toLocaleDateString("fr-FR")}
              </span>
            )}
          </div>
          {modifieeDepuis && (
            <div style={{ background: "#fff4e5", border: "1px solid #e9b877", color: "#7a3e00", padding: 12, borderRadius: 10, marginBottom: 14, fontWeight: 700 }}>
              Cette note a été modifiée depuis sa transmission : cliquez sur « Retransmettre la version corrigée » pour envoyer la correction au service RH.
            </div>
          )}

          {/* ---------- véhicule ---------- */}
          <section style={carte}>
            <h3 style={titre}>Véhicule</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <label style={{ ...etiquette, width: 260 }}>
                Véhicule (marque, type)
                <input value={note.vehicule} onChange={(e) => changerNote({ vehicule: e.target.value })} placeholder="ex. Peugeot 308" style={champ} />
              </label>
              <label style={{ ...etiquette, width: 240 }}>
                Puissance fiscale
                <select value={note.puissance} onChange={(e) => changerNote({ puissance: e.target.value })} style={champ}>
                  <option value="">Choisir…</option>
                  {baremes.map((b) => (
                    <option key={b.puissance} value={b.puissance}>
                      {b.puissance} · {b.prix_km.toLocaleString("fr-FR")} € / km
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...etiquette, width: 190 }}>
                Km domicile → Polynov (aller)
                <input value={note.km_domicile} inputMode="decimal" onChange={(e) => changerNote({ km_domicile: e.target.value })} placeholder="ex. 12" style={champ} />
              </label>
            </div>
            <p style={{ fontSize: 13, color: "#6d737a", margin: "10px 0 0" }}>
              Retenu pour vos prochaines notes. Les km se comptent au plus court (Mappy) ; au départ du domicile, ils sont indemnisés au-delà de 2 × la distance domicile → Polynov.
            </p>
          </section>

          {/* ---------- déplacements occasionnels ---------- */}
          <section style={carte}>
            <h3 style={titre}>Déplacements occasionnels</h3>
            <datalist id="nf-sites">
              {[...sites.keys()].sort().map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {deps.map((d, i) => (
              <div key={i} className="nf-ligne" style={{ display: "grid", gridTemplateColumns: "150px 120px minmax(160px,300px) 90px 90px 34px", justifyContent: "start", gap: 8, alignItems: "end", marginBottom: 8 }}>
                <label style={etiquette}>
                  Date
                  <input type="date" value={d.jour} onChange={(e) => changerDep(i, { jour: e.target.value })} style={champ} />
                </label>
                <label style={etiquette}>
                  Départ
                  <select value={d.depart} onChange={(e) => changerDep(i, { depart: e.target.value })} style={champ}>
                    <option>Polynov</option>
                    <option>Domicile</option>
                  </select>
                </label>
                <label style={etiquette}>
                  Site client
                  <input
                    list="nf-sites"
                    value={d.site}
                    onChange={(e) => {
                      const s = e.target.value;
                      const connu = sites.get(s.trim());
                      changerDep(i, { site: s, ...(connu && !d.km ? { km: texte(connu) } : {}) });
                    }}
                    style={champ}
                  />
                </label>
                <label style={etiquette}>
                  Km A/R
                  <input value={d.km} inputMode="decimal" onChange={(e) => changerDep(i, { km: e.target.value })} style={{ ...champ, textAlign: "right" }} />
                </label>
                <div style={{ ...etiquette, color: "#252525" }}>
                  Coût
                  <strong style={{ padding: "9px 0", textAlign: "right" }}>{euros(coutDep(d))}</strong>
                </div>
                <button type="button" title="Retirer ce déplacement" onClick={() => { setDeps((l) => l.filter((_, k) => k !== i)); setModifiee(true); }} style={croix}>
                  ×
                </button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" style={petit} disabled={deps.length >= MAX_DEPLACEMENTS_EXCEL} onClick={() => { setDeps((l) => [...l, depVide()]); setModifiee(true); }}>
                + Ajouter un déplacement {deps.length >= MAX_DEPLACEMENTS_EXCEL ? `(${MAX_DEPLACEMENTS_EXCEL} au plus)` : ""}
              </button>
              <strong>Total : {euros(totaux.occ)}</strong>
            </div>
          </section>

          {/* ---------- déplacement régulier ---------- */}
          <section style={carte}>
            <h3 style={titre}>Déplacement régulier du mois</h3>
            <div className="nf-ligne" style={{ display: "grid", gridTemplateColumns: "120px minmax(160px,300px) 130px 170px", justifyContent: "start", gap: 12 }}>
              <label style={etiquette}>
                Départ
                <select value={note.reg_depart} onChange={(e) => changerNote({ reg_depart: e.target.value })} style={champ}>
                  <option>Polynov</option>
                  <option>Domicile</option>
                </select>
              </label>
              <label style={etiquette}>
                Site client
                <input list="nf-sites" value={note.reg_site} onChange={(e) => changerNote({ reg_site: e.target.value })} style={champ} />
              </label>
              <label style={etiquette}>
                Km A/R par jour
                <input value={note.reg_km_jour} inputMode="decimal" onChange={(e) => changerNote({ reg_km_jour: e.target.value })} style={{ ...champ, textAlign: "right" }} />
              </label>
              <label style={etiquette}>
                Allers-retours dans le mois
                <input value={note.reg_nb_trajets} inputMode="decimal" onChange={(e) => changerNote({ reg_nb_trajets: e.target.value })} style={{ ...champ, textAlign: "right" }} />
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <strong>Coût : {euros(totaux.reg)}</strong>
            </div>
          </section>

          {/* ---------- frais annexes ---------- */}
          <section style={carte}>
            <h3 style={titre}>Frais annexes</h3>
            <p style={{ fontSize: 13, color: "#6d737a", margin: "-6px 0 12px" }}>Uniquement sur justificatif de paiement : joignez la photo du ticket ou la facture (PDF).</p>
            {frais.map((f, i) => (
              <div key={i} className="nf-ligne" style={{ display: "grid", gridTemplateColumns: "150px 130px minmax(150px,260px) 100px minmax(170px,240px) 34px", justifyContent: "start", gap: 8, alignItems: "end", marginBottom: 10 }}>
                <label style={etiquette}>
                  Date
                  <input type="date" value={f.jour} onChange={(e) => changerFrais(i, { jour: e.target.value })} style={champ} />
                </label>
                <label style={etiquette}>
                  Nature
                  <select value={f.nature} onChange={(e) => changerFrais(i, { nature: e.target.value })} style={champ}>
                    {NATURES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label style={etiquette}>
                  Commentaire
                  <input value={f.commentaire} onChange={(e) => changerFrais(i, { commentaire: e.target.value })} placeholder="ex. A75 aller-retour" style={champ} />
                </label>
                <label style={etiquette}>
                  Montant (€)
                  <input value={f.montant} inputMode="decimal" onChange={(e) => changerFrais(i, { montant: e.target.value })} style={{ ...champ, textAlign: "right" }} />
                </label>
                <label style={{ ...etiquette, color: f.fichier || f.justificatif_path ? "#18713b" : n(f.montant) > 0 ? "#a51d1d" : "#4b5057" }}>
                  {f.fichier ? `📎 ${f.fichier.name}` : f.justificatif_nom ? `📎 ${f.justificatif_nom}` : "Justificatif"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const x = e.target.files?.[0];
                      if (x) changerFrais(i, { fichier: x });
                      e.target.value = "";
                    }}
                    style={{ ...champ, padding: 6, fontSize: 13 }}
                  />
                </label>
                <button type="button" title="Retirer ce frais" onClick={() => { setFrais((l) => l.filter((_, k) => k !== i)); setModifiee(true); }} style={croix}>
                  ×
                </button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" style={petit} onClick={() => { setFrais((l) => [...l, fraisVide()]); setModifiee(true); }}>
                + Ajouter un frais
              </button>
              <strong>Total : {euros(totaux.frais)}</strong>
            </div>
          </section>

          {/* ---------- total et envoi ---------- */}
          <section style={{ ...carte, borderLeft: `5px solid ${rouge}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, color: "#6d737a" }}>Montant total dû</div>
                <div style={{ fontSize: 30, fontWeight: 800 }}>{euros(totaux.total)}</div>
                {!note.puissance && <div style={{ fontSize: 13, color: "#a51d1d", fontWeight: 700 }}>Choisissez la puissance fiscale : sans elle, les km ne sont pas comptés.</div>}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {note.id && note.statut === "BROUILLON" && (
                  <button type="button" style={{ ...bouton(), color: rouge, borderColor: "#e1bcbc" }} disabled={!!enCours} onClick={() => void supprimerBrouillon()}>
                    Supprimer le brouillon
                  </button>
                )}
                <button type="button" style={bouton()} disabled={!!enCours} onClick={() => void sauver()}>
                  {enCours === "enregistrer" ? "Enregistrement…" : "💾 Enregistrer"}
                </button>
                <button type="button" style={{ ...bouton(true), opacity: enCours ? 0.6 : 1 }} disabled={!!enCours} onClick={() => void transmettre()}>
                  {enCours === "transmettre" ? "Envoi…" : note.statut === "TRANSMISE" ? "📤 Retransmettre la version corrigée" : "📤 Transmettre au service RH"}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#6d737a", margin: "12px 0 0" }}>
              La note part directement au service RH, avec tout le détail dans l’e-mail, la note Excel remplie et vos justificatifs. Les administrateurs et vous êtes en copie. En cas
              d’erreur, corrigez-la ici et retransmettez-la : la version corrigée remplace la précédente.
            </p>
          </section>
        </>
      )}
      </div>
    </main>
  );
}
