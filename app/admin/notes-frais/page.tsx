"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import EnTetePage from "@/components/EnTetePage";

/* ===============================================================
   PARAMÈTRES DES NOTES DE FRAIS (administrateurs)
   - destinataires de l'e-mail : le service RH (gardés en base, table
     nf_parametres) ; les administrateurs et le collaborateur sont toujours
     en copie ;
   - barème kilométrique : le prix au km de chaque puissance fiscale.
     Un nouveau prix vaut pour les notes enregistrées ensuite ; une note
     déjà transmise garde le prix de sa transmission (jusqu'à ce qu'elle
     soit modifiée et retransmise).
================================================================ */

type Bareme = { puissance: string; prix_km: string };
const rouge = "#c00000";
const emailValide = (a: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);

export default function ParametresNotesFrais() {
  const [chargement, setChargement] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [emails, setEmails] = useState("");
  const [emailsInitiaux, setEmailsInitiaux] = useState("");
  const [baremes, setBaremes] = useState<Bareme[]>([]);
  const [baremesInitiaux, setBaremesInitiaux] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function charger() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const { data: c } = await supabase.from("collaborateurs").select("role").eq("auth_user_id", user.id).single();
    const estAdmin = String(c?.role ?? "").toUpperCase() === "ADMIN";
    setAdmin(estAdmin);
    if (!estAdmin) return;
    const [p, b] = await Promise.all([
      supabase.from("nf_parametres").select("valeur").eq("cle", "email_rh").maybeSingle(),
      supabase.from("nf_baremes").select("puissance,prix_km").order("ordre"),
    ]);
    if (p.error) throw p.error;
    if (b.error) throw b.error;
    const e = p.data?.valeur ?? "";
    setEmails(e);
    setEmailsInitiaux(e);
    const l = ((b.data ?? []) as { puissance: string; prix_km: number | string }[]).map((x) => ({ puissance: x.puissance, prix_km: String(x.prix_km).replace(".", ",") }));
    setBaremes(l);
    setBaremesInitiaux(JSON.stringify(l));
  }

  useEffect(() => {
    void charger()
      .catch((e) => setErreur(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => setChargement(false));
  }, []);

  const adresses = [...new Set(emails.split(/[;,\s]+/).map((a) => a.trim()).filter(Boolean))];
  const invalides = adresses.filter((a) => !emailValide(a));

  async function enregistrerEmails() {
    setErreur("");
    setInfo("");
    if (adresses.length === 0) return setErreur("Indiquez au moins une adresse.");
    if (invalides.length) return setErreur(`Adresse(s) invalide(s) : ${invalides.join(", ")}`);
    setEnCours(true);
    const valeur = adresses.join(", ");
    const { error } = await supabase.from("nf_parametres").upsert({ cle: "email_rh", valeur, updated_at: new Date().toISOString() });
    setEnCours(false);
    if (error) return setErreur(error.message);
    setEmails(valeur);
    setEmailsInitiaux(valeur);
    setInfo("Destinataires enregistrés : les prochaines notes de frais partiront à ces adresses.");
  }

  async function enregistrerBareme() {
    setErreur("");
    setInfo("");
    const lignes = baremes.map((b) => ({ puissance: b.puissance, prix_km: Number(b.prix_km.replace(",", ".")) }));
    const fausse = lignes.find((l) => !Number.isFinite(l.prix_km) || l.prix_km <= 0 || l.prix_km > 5);
    if (fausse) return setErreur(`Prix au km invalide pour « ${fausse.puissance} » (ex. 0,665).`);
    setEnCours(true);
    for (const l of lignes) {
      const { error } = await supabase.from("nf_baremes").update({ prix_km: l.prix_km }).eq("puissance", l.puissance);
      if (error) {
        setEnCours(false);
        return setErreur(error.message);
      }
    }
    setEnCours(false);
    setBaremesInitiaux(JSON.stringify(baremes));
    setInfo("Barème enregistré : il s’applique aux notes enregistrées à partir de maintenant.");
  }

  const carte: CSSProperties = { background: "#fff", border: "1px solid #e2e5e9", borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: "0 2px 8px rgba(0,0,0,.05)", maxWidth: 760 };
  const champ: CSSProperties = { border: "1px solid #c9cdd2", borderRadius: 8, padding: "10px 11px", fontSize: 15, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const bouton = (actif: boolean): CSSProperties => ({ border: 0, borderRadius: 8, padding: "10px 18px", background: actif ? rouge : "#c9cdd2", color: "#fff", fontWeight: 800, cursor: actif ? "pointer" : "default", fontFamily: "inherit", fontSize: 14 });
  const emailsModifies = emails.trim() !== emailsInitiaux.trim();
  const baremeModifie = JSON.stringify(baremes) !== baremesInitiaux;

  return (
    <main style={{ minHeight: "100vh", background: "#f5f6f8", fontFamily: "Calibri, Arial, sans-serif", padding: "24px 4vw 60px", color: "#252525" }}>
      <EnTetePage forme="encadre" section="Administration RH" titre="Paramètres des notes de frais" description="Destinataires de l’e-mail et barème kilométrique" />

      {chargement && <div style={carte}>Chargement…</div>}
      {/* SUIVI_NOTES_FRAIS */}
      {admin && (
        <div style={{ maxWidth: 760, display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <a href="/admin/suivi-notes-frais" style={{ border: "1px solid #c9cdd2", borderRadius: 8, padding: "8px 14px", background: "#fff", color: "#252525", fontWeight: 800, textDecoration: "none" }}>
            🧾 Suivi des notes de frais →
          </a>
        </div>
      )}
      {!chargement && !admin && <div style={carte}>Cette page est réservée aux administrateurs.</div>}
      {erreur && <div style={{ background: "#fdecec", color: "#a51d1d", padding: 12, borderRadius: 10, marginBottom: 14, maxWidth: 760 }}>{erreur}</div>}
      {info && <div style={{ background: "#e7f6ec", color: "#18713b", padding: 12, borderRadius: 10, marginBottom: 14, maxWidth: 760 }}>{info}</div>}

      {!chargement && admin && (
        <>
          <section style={carte}>
            <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Destinataires (service RH)</h2>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#6d737a" }}>
              Une ou plusieurs adresses, séparées par une virgule. Les administrateurs et le collaborateur sont toujours en copie.
            </p>
            <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ex. a.loyer@sibim.fr, e.lavin@sibim.fr" style={{ ...champ, borderColor: invalides.length ? "#e5a3a3" : "#c9cdd2" }} />
            {invalides.length > 0 && <div style={{ color: "#a51d1d", fontSize: 13, marginTop: 6 }}>Adresse(s) invalide(s) : {invalides.join(", ")}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              {emailsModifies && (
                <button type="button" onClick={() => setEmails(emailsInitiaux)} style={{ ...bouton(true), background: "#fff", color: "#252525", border: "1px solid #c9cdd2" }}>
                  Annuler
                </button>
              )}
              <button type="button" disabled={!emailsModifies || enCours} onClick={() => void enregistrerEmails()} style={bouton(emailsModifies && !enCours)}>
                Enregistrer les destinataires
              </button>
            </div>
          </section>

          <section style={carte}>
            <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Barème kilométrique</h2>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#6d737a" }}>
              Prix au km selon la puissance fiscale. Un nouveau prix vaut pour les notes enregistrées ensuite ; il est aussi recopié dans la note Excel jointe à l’e-mail.
            </p>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 15 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #ddd" }}>Puissance fiscale</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "2px solid #ddd" }}>Prix au km (€)</th>
                </tr>
              </thead>
              <tbody>
                {baremes.map((b, i) => (
                  <tr key={b.puissance}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>{b.puissance}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #eee", textAlign: "right" }}>
                      <input
                        value={b.prix_km}
                        inputMode="decimal"
                        onChange={(e) => setBaremes((l) => l.map((x, k) => (k === i ? { ...x, prix_km: e.target.value } : x)))}
                        style={{ ...champ, width: 120, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" disabled={!baremeModifie || enCours} onClick={() => void enregistrerBareme()} style={bouton(baremeModifie && !enCours)}>
                Enregistrer le barème
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
