"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   RÉGLAGES DES NOTES DE FRAIS (administrateurs) - REGLAGES_NOTES_FRAIS
   Bloc replié en bas de la page « Suivi des notes de frais » (ancre
   #reglages) ; ex-page /admin/notes-frais, qui y redirige.
   - destinataires de l'e-mail : le service RH (gardés en base, table
     nf_parametres) ; les administrateurs et le collaborateur sont toujours
     en copie ;
   - barème kilométrique : le prix au km de chaque puissance fiscale.
     Un nouveau prix vaut pour les notes enregistrées ensuite ; une note
     déjà transmise garde le prix de sa transmission (jusqu'à ce qu'elle
     soit modifiée et retransmise).
   À n'afficher qu'à un ADMIN (la page qui l'accueille le vérifie).
================================================================ */

type Bareme = { puissance: string; prix_km: string };
const rouge = "#c00000";
const emailValide = (a: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a);

export default function ReglagesNotesFrais() {
  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [emails, setEmails] = useState("");
  const [emailsInitiaux, setEmailsInitiaux] = useState("");
  const [baremes, setBaremes] = useState<Bareme[]>([]);
  const [baremesInitiaux, setBaremesInitiaux] = useState("");
  const [enCours, setEnCours] = useState(false);

  // arrivée par l'ancienne adresse ou un lien « #reglages » : le bloc s'ouvre et vient à l'écran
  useEffect(() => {
    if (window.location.hash === "#reglages") {
      setOuvert(true);
      window.setTimeout(() => document.getElementById("reglages")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    }
  }, []);

  useEffect(() => {
    void (async () => {
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
    })()
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

  const carte: CSSProperties = { background: "#fff", border: "1px solid #e2e5e9", borderRadius: 14, padding: 20, marginBottom: 16, boxShadow: "0 2px 8px rgba(0,0,0,.05)" };
  const sousCarte: CSSProperties = { border: "1px solid #e2e5e9", borderRadius: 10, padding: 16, marginTop: 14, maxWidth: 760 };
  const champ: CSSProperties = { border: "1px solid #c9cdd2", borderRadius: 8, padding: "10px 11px", fontSize: 15, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  const bouton = (actif: boolean): CSSProperties => ({ border: 0, borderRadius: 8, padding: "10px 18px", background: actif ? rouge : "#c9cdd2", color: "#fff", fontWeight: 800, cursor: actif ? "pointer" : "default", fontFamily: "inherit", fontSize: 14 });
  const emailsModifies = emails.trim() !== emailsInitiaux.trim();
  const baremeModifie = JSON.stringify(baremes) !== baremesInitiaux;

  return (
    <details id="reglages" open={ouvert} onToggle={(e) => setOuvert(e.currentTarget.open)} style={{ ...carte, scrollMarginTop: 16 }}>
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 18 }}>⚙ Réglages : barème kilométrique et destinataires</summary>

      {chargement && <p style={{ margin: "12px 0 0" }}>Chargement…</p>}
      {erreur && <div style={{ background: "#fdecec", color: "#a51d1d", padding: 12, borderRadius: 10, marginTop: 12, maxWidth: 760 }}>{erreur}</div>}
      {info && <div style={{ background: "#e7f6ec", color: "#18713b", padding: 12, borderRadius: 10, marginTop: 12, maxWidth: 760 }}>{info}</div>}

      {!chargement && (
        <>
          <section style={sousCarte}>
            <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>Barème kilométrique</h3>
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
                        aria-label={`Prix au km, ${b.puissance}`}
                        onChange={(e) => setBaremes((l) => l.map((x, k) => (k === i ? { ...x, prix_km: e.target.value } : x)))}
                        style={{ ...champ, width: 120, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              {baremeModifie && (
                <button type="button" onClick={() => setBaremes(JSON.parse(baremesInitiaux) as Bareme[])} style={{ ...bouton(true), background: "#fff", color: "#252525", border: "1px solid #c9cdd2" }}>
                  Annuler
                </button>
              )}
              <button type="button" disabled={!baremeModifie || enCours} onClick={() => void enregistrerBareme()} style={bouton(baremeModifie && !enCours)}>
                Enregistrer le barème
              </button>
            </div>
          </section>

          <section style={sousCarte}>
            <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>Destinataires (service RH)</h3>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#6d737a" }}>
              Une ou plusieurs adresses, séparées par une virgule. Les administrateurs et le collaborateur sont toujours en copie.
            </p>
            <input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              aria-label="Adresses du service RH"
              placeholder="ex. a.loyer@sibim.fr, e.lavin@sibim.fr"
              style={{ ...champ, borderColor: invalides.length ? "#e5a3a3" : "#c9cdd2" }}
            />
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
        </>
      )}
    </details>
  );
}
