"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   « ✓ FAITE » : NOTER UNE RELANCE DE DEVIS COMME FAITE (RELANCE_FAITE_FDR)

   Dans la feuille de route (tableau de bord et page « Ma feuille de
   route ») : la personne désignée note sa relance faite, avec la date et
   un commentaire facultatif. La relance prévue est close, le devis sort
   de « À relancer » pour 30 jours (fonction suivi_devis_noter_relance,
   SQL 92 : la personne désignée y a droit).
================================================================ */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* relanceId : la relance prévue que l'on clôt (RELANCES_HISTORIQUE) ; si elle a déjà été notée faite
   ailleurs, la fonction le dit au lieu de créer un doublon */
export default function RelanceFaite({ numero, relanceId, onFait }: { numero: string; relanceId?: string; onFait: () => void }) {
  const aujourdhui = iso(new Date());
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState(aujourdhui);
  const [reponse, setReponse] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  const champ = { minHeight: 32, border: "1px solid #c9cdd2", borderRadius: 6, padding: "0 8px", fontFamily: "inherit", fontSize: 13 } as const;

  async function valider() {
    if (!date || date > aujourdhui) {
      setErreur("Date de relance invalide (pas dans le futur).");
      return;
    }
    setEnvoi(true);
    setErreur("");
    const { error } = await supabase.rpc("suivi_devis_noter_relance", { p_numero: numero, p_date: date, p_reponse: reponse.trim() || null, p_relance_id: relanceId ?? null });
    setEnvoi(false);
    if (error) {
      setErreur(error.message);
      return;
    }
    setOuvert(false);
    onFait();
  }

  if (!ouvert)
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        title="Noter que le client a été relancé"
        style={{ border: "1.5px solid #1b5e20", background: "#f2faf3", color: "#1b5e20", borderRadius: 999, padding: "2px 10px", fontWeight: 800, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        ✓ faite
      </button>
    );

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6, width: "100%", marginTop: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#5b6168", display: "inline-flex", alignItems: "center", gap: 4 }}>
        relancé le
        <input type="date" value={date} max={aujourdhui} onChange={(e) => setDate(e.target.value)} style={champ} />
      </label>
      <input
        type="text"
        value={reponse}
        maxLength={1000}
        placeholder="réponse du client (facultatif)"
        onChange={(e) => setReponse(e.target.value)}
        style={{ ...champ, flex: "1 1 180px", minWidth: 140 }}
      />
      <button
        type="button"
        onClick={() => void valider()}
        disabled={envoi}
        style={{ border: "none", background: "#1b5e20", color: "#ffffff", borderRadius: 6, minHeight: 32, padding: "0 12px", fontWeight: 800, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
      >
        {envoi ? "…" : "Enregistrer"}
      </button>
      <button
        type="button"
        onClick={() => setOuvert(false)}
        style={{ border: "1px solid #c9cdd2", background: "#ffffff", borderRadius: 6, minHeight: 32, padding: "0 10px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
      >
        Annuler
      </button>
      {erreur && (
        <span role="alert" style={{ color: "#b3261e", fontWeight: 700, fontSize: 12.5, width: "100%" }}>
          {erreur}
        </span>
      )}
    </span>
  );
}
