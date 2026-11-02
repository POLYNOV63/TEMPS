"use client";

import { useEffect, useState } from "react";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { chargerTout } from "@/lib/pilotageDonnees";

/* ===============================================================
   DATES IMPOSSIBLES DANS LE SUIVI D'AFFAIRE BE

   Repère, dans la copie du classeur, les dates qui ne peuvent pas être
   justes (souvent jour et mois inversés à la saisie) :
   - commande reçue AVANT l'ouverture de la ligne ;
   - devis envoyé AVANT son ouverture ;
   - livraison AVANT la réception de la commande.
   Propose la date « jour et mois inversés » quand elle devient cohérente.
   Affiché sur la page Synchronisation, recalculé après chaque synchro.
================================================================ */

type Ligne = {
  cle: string;
  numero_devis: string | null;
  numero_affaire: string | null;
  genre: string;
  statut: string | null;
  date_ouverture: string | null;
  date_envoi: string | null;
  date_reception_commande: string | null;
  date_livraison: string | null;
  disparue: boolean;
};

type Probleme = { numero: string; statut: string; texte: string };

const fr = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR");

/* La même date avec le jour et le mois inversés (11/02 -> 02/11), si elle existe */
function inversee(d: string): string | null {
  const [a, m, j] = d.slice(0, 10).split("-").map(Number);
  if (j > 12 || j === m) return null;
  const x = new Date(Date.UTC(a, j - 1, m));
  if (x.getUTCMonth() !== j - 1) return null;
  return x.toISOString().slice(0, 10);
}

function verifier(l: Ligne): Probleme[] {
  const numero = l.numero_affaire || l.numero_devis || l.cle;
  const res: Probleme[] = [];
  const ajouter = (texte: string) => res.push({ numero, statut: l.statut ?? "", texte });
  const suggestion = (d: string, apres: string | null) => {
    const inv = inversee(d);
    return inv && (!apres || inv >= apres.slice(0, 10)) ? ` Jour et mois inversés ? Peut-être le ${fr(inv)}.` : "";
  };
  if (l.date_reception_commande && l.date_ouverture && l.date_reception_commande.slice(0, 10) < l.date_ouverture.slice(0, 10))
    ajouter(`Commande reçue le ${fr(l.date_reception_commande)}, avant l’ouverture du ${fr(l.date_ouverture)}.${suggestion(l.date_reception_commande, l.date_ouverture)}`);
  if (l.date_envoi && l.date_ouverture && l.date_envoi.slice(0, 10) < l.date_ouverture.slice(0, 10))
    ajouter(`Devis envoyé le ${fr(l.date_envoi)}, avant son ouverture le ${fr(l.date_ouverture)}.${suggestion(l.date_envoi, l.date_ouverture)}`);
  if (l.date_livraison && l.date_reception_commande && l.date_livraison.slice(0, 10) < l.date_reception_commande.slice(0, 10))
    ajouter(`Livrée le ${fr(l.date_livraison)}, avant la réception de la commande le ${fr(l.date_reception_commande)}.${suggestion(l.date_livraison, l.date_reception_commande)}`);
  return res;
}

export default function DatesIncoherentes({ actualisation }: { actualisation: string }) {
  const [problemes, setProblemes] = useState<Probleme[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;
    chargerTout<Ligne>((a, b) =>
      supabase
        .from("suivi_lignes")
        .select("cle,numero_devis,numero_affaire,genre,statut,date_ouverture,date_envoi,date_reception_commande,date_livraison,disparue")
        .order("cle")
        .range(a, b)
    )
      .then((lignes) => {
        if (!actif) return;
        setProblemes(
          lignes
            .filter((l) => !l.disparue)
            .flatMap(verifier)
            .sort((x, y) => y.numero.localeCompare(x.numero, "fr", { numeric: true }))
        );
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Vérification des dates impossible."));
    return () => {
      actif = false;
    };
  }, [actualisation]);

  return (
    <section style={{ ...page.carte, padding: 16, marginTop: 20 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>Dates impossibles dans le classeur</h2>
      <p style={{ margin: "0 0 12px", color: C.gris }}>
        Des dates qui ne peuvent pas être justes, le plus souvent le jour et le mois inversés à la saisie (11/02 au lieu de 02/11). Elles faussent les
        indicateurs, la facturation et le classement des commandes : à corriger dans le Suivi d’affaire BE.
      </p>
      {erreur && <Message genre="erreur">{erreur}</Message>}
      {problemes === null && !erreur && <p style={{ color: C.gris, margin: 0 }}>Vérification…</p>}
      {problemes && problemes.length === 0 && <p style={{ color: "#1b5e20", fontWeight: 700, margin: 0 }}>✓ Aucune date impossible.</p>}
      {problemes && problemes.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...page.th, width: 130 }}>N°</th>
                <th style={{ ...page.th, width: 150 }}>Statut</th>
                <th style={page.th}>Problème ({problemes.length})</th>
              </tr>
            </thead>
            <tbody>
              {problemes.map((p, i) => (
                <tr key={`${p.numero}-${i}`}>
                  <td style={{ ...page.td, fontWeight: 800, whiteSpace: "nowrap" }}>{p.numero}</td>
                  <td style={page.td}>{p.statut}</td>
                  <td style={page.td}>{p.texte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
