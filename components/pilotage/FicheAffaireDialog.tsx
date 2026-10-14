"use client";

import { useState } from "react";
import { C, Message, Modal, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { aISO, estWeekend, ajouterJours, finTheoriquePrestation } from "@/lib/pilotagePlanning";
import { formatDate, num, traduireErreur, type Affaire } from "@/lib/pilotageCalculs";

/* ===============================================================
   PILOTAGE BE - FICHE D'UNE PRESTATION (PE / PI)

   Clic sur la barre pointillée de l'affaire : ses bornes (début et fin
   théoriques), indépendantes des barres de ses ressources, et la quantité
   vendue. La case « comprend déjà les congés et jours fériés » dit si la
   quantité les inclut (la fin ne bouge pas) ou si elle les exclut (ils
   repoussent la fin).
================================================================ */

type Props = {
  onClose: () => void;
  onSaved: (message: string) => void;
  affaire: Affaire;
  /* bornes actuellement affichées (repli quand l'affaire n'a pas encore de début) */
  bornes: { debut: string | null; fin: string | null };
};

function prochainJourOuvre(depuis: string): string {
  let j = depuis;
  while (estWeekend(j)) j = ajouterJours(j, 1);
  return j;
}

export default function FicheAffaireDialog({ onClose, onSaved, affaire, bornes }: Props) {
  const [debut, setDebut] = useState(affaire.date_debut ?? bornes.debut ?? prochainJourOuvre(aISO(new Date())));
  const [fin, setFin] = useState(affaire.echeance ?? bornes.fin ?? "");
  const [quantite, setQuantite] = useState(affaire.prestation_quantite !== null && affaire.prestation_quantite !== undefined ? String(affaire.prestation_quantite).replace(".", ",") : "");
  const [unite, setUnite] = useState<"JOURS" | "HEURES">(affaire.prestation_unite ?? "JOURS");
  const [comprend, setComprend] = useState(Boolean(affaire.prestation_comprend_conges));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  const q = num(quantite.replace(",", "."));
  const finCalculee = q > 0 && debut ? finTheoriquePrestation({ debut, quantite: q, unite, comprendConges: comprend }) : null;

  async function enregistrer() {
    setErreur("");

    if (!debut || !fin) return setErreur("Indiquez le début et la fin de la prestation.");
    if (fin < debut) return setErreur("La fin ne peut pas précéder le début.");

    setEnCours(true);

    const { error } = await supabase.rpc("pilotage_modifier_prestation", {
      p_affaire_id: affaire.id,
      p_date_debut: debut,
      p_date_fin: fin,
      p_quantite: q > 0 ? q : null,
      p_unite: q > 0 ? unite : null,
      p_comprend_conges: comprend,
    });

    setEnCours(false);

    if (error) return setErreur(traduireErreur(error.message));

    onSaved("Prestation modifiée.");
  }

  return (
    <Modal titre={`Prestation ${affaire.imputation ?? ""} ${affaire.numero}`} onClose={onClose} largeur={640}>
      {erreur && <Message genre="erreur">{erreur}</Message>}

      <p style={{ margin: "0 0 14px", color: C.gris, fontSize: 14 }}>
        {affaire.designation}. Ces dates bornent la prestation : elles ne déplacent pas les barres de ses ressources, qui se règlent chacune sur leur propre barre.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="fa-d" style={page.etiquette}>Début</label>
            <input id="fa-d" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={page.entrees} />
          </div>
          <div style={{ flex: "1 1 170px" }}>
            <label htmlFor="fa-f" style={page.etiquette}>Fin</label>
            <input id="fa-f" type="date" value={fin} onChange={(e) => setFin(e.target.value)} style={page.entrees} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label htmlFor="fa-q" style={page.etiquette}>Quantité vendue</label>
            <input id="fa-q" type="text" inputMode="decimal" value={quantite} onChange={(e) => setQuantite(e.target.value)} style={{ ...page.entrees, textAlign: "right" }} />
            <div style={page.aide}>Facultative.</div>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label htmlFor="fa-u" style={page.etiquette}>Unité</label>
            <select id="fa-u" value={unite} onChange={(e) => setUnite(e.target.value as "JOURS" | "HEURES")} style={page.entrees}>
              <option value="JOURS">jours</option>
              <option value="HEURES">heures</option>
            </select>
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 44, padding: "10px 12px", border: "1.5px solid #6f8fb3", background: "#f3f8fd", borderRadius: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={comprend} onChange={(e) => setComprend(e.target.checked)} style={{ width: 22, height: 22, margin: "2px 0 0", flex: "none" }} />
          <span>
            <strong>Cette durée comprend déjà les congés et jours fériés</strong>
            <span style={{ display: "block", fontSize: 13, color: "#3b4046", marginTop: 2 }}>
              {comprend
                ? "Cochée : ils sont comptés dans la durée, la fin ne bouge pas."
                : "Décochée : ils ne sont pas travaillés, la fin est repoussée d’autant."}
            </span>
          </span>
        </label>

        {finCalculee && (
          <div role="status" style={{ background: "#e3eefb", color: "#0b3a6e", border: "1px solid #9bbbe3", borderRadius: 12, padding: "10px 14px", fontSize: 14 }}>
            Avec {quantite} {unite === "JOURS" ? "jour(s)" : "heure(s)"} à partir du {formatDate(debut)}, la fin théorique est le <strong>{formatDate(finCalculee)}</strong>
            {" "}(jours fériés pris en compte, congés des personnes non pris en compte).
            <div style={{ marginTop: 8 }}>
              <button type="button" style={page.btnSecondaire} onClick={() => setFin(finCalculee)}>
                Utiliser cette fin
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" style={page.btnSecondaire} onClick={onClose}>Annuler</button>
          <button type="button" style={{ ...page.btnPrimaire, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={enregistrer}>
            {enCours ? "Enregistrement…" : "Appliquer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
