"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";

/* ===============================================================
   BILAN AFFAIRE - LE NÉGOCE (vendu et acheté)

   Pour une affaire CBE (commande de base + avenants), d'après le Suivi
   d'affaire BE : le montant VENDU en négoce, le montant ACHETÉ, et la
   marge. Le bloc ne s'affiche que s'il y a du négoce ou des achats.

   Les montants sont protégés : seuls l'administration, les responsables
   et la Direction les voient. Pour un collaborateur, la base ne renvoie
   aucun montant et ce bloc ne s'affiche pas.
================================================================ */

type Ligne = { id: string; cle: string; genre: string; parent_cle: string | null; numero_affaire: string | null; statut: string | null; disparue: boolean; base_devis: string | null; client_id: string | null };
type Montant = {
  ligne_id: string;
  montant: number;
  montant_echeances: number;
  montant_meca: number;
  montant_calcul: number;
  montant_elec_pneu: number;
  montant_scan: number;
  montant_autre: number;
  montant_achats: number;
  montant_negoce: number;
};
type Commande = { numero: string; statut: string; vendu: number; etudes: number; negoce: number; achats: number };

const n = (v: unknown) => Number(v) || 0;
const euros = (v: number) => v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const INACTIF = /perdu|annul/i;

export default function BilanFinancierAffaire({ type, numero }: { type: string; numero: string }) {
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [heures, setHeures] = useState(0);
  // « autorise » : la personne a le droit de voir les montants ; « message » : rien trouvé, et pourquoi
  const [autorise, setAutorise] = useState(false);
  const [message, setMessage] = useState("");
  const [entete, setEntete] = useState<{ devis: string | null; client: string | null }>({ devis: null, client: null });

  useEffect(() => {
    let actif = true;
    setCommandes(null);
    setMessage("");
    const base = numero.match(/^\d+/)?.[0]?.replace(/^0+/, "") ?? "";
    if (type !== "CBE" || !base) return;

    (async () => {
      // seuls l'administration, les responsables et la Direction voient les montants
      const { data: droit, error: ed } = await supabase.rpc("polynov_peut_voir_pilotage");
      if (!actif || (!ed && droit !== true)) return;
      // fonction de droits indisponible : on n'affiche que si des montants sont lisibles
      if (!ed) setAutorise(true);

      const { data: lignes, error: el } = await supabase
        .from("suivi_lignes")
        .select("id,cle,genre,parent_cle,numero_affaire,statut,disparue,base_devis,client_id")
        .eq("base_affaire", base);
      if (el) return actif && setMessage(`Lecture du Suivi d'affaire impossible : ${el.message}`);
      const toutes = (lignes ?? []) as Ligne[];
      const ls = toutes.filter((l) => !l.disparue && !INACTIF.test(l.statut ?? ""));
      if (ls.length === 0) return actif && setMessage(`CBE${base} n'est pas (ou plus) dans le Suivi d'affaire BE : pas de montant à afficher.`);

      // n° de devis et client : ceux de la commande de base
      const baseLigne = ls.find((l) => l.genre === "BASE") ?? ls[0];
      let client: string | null = null;
      if (baseLigne.client_id) {
        const { data: c } = await supabase.from("suivi_clients").select("nom_abrege").eq("id", baseLigne.client_id).maybeSingle();
        client = (c as { nom_abrege: string } | null)?.nom_abrege ?? null;
      }
      if (actif) setEntete({ devis: baseLigne.base_devis, client });

      const { data: mts, error: em } = await supabase.from("suivi_lignes_montants").select("*").in("ligne_id", ls.map((l) => l.id));
      if (em) return actif && setMessage(`Lecture des montants impossible : ${em.message}`);
      const montants = new Map(((mts ?? []) as Montant[]).map((m) => [m.ligne_id, m]));
      if (montants.size > 0 && actif) setAutorise(true);
      if (montants.size === 0) return actif && setMessage(`Aucun montant pour CBE${base} dans le Suivi d'affaire BE (synchronisation à refaire ?).`);

      // les échéances / lots portent parfois la ventilation à la place de leur commande
      const decoupages = new Map<string, { etudes: number; negoce: number; achats: number }>();
      for (const l of ls) {
        if ((l.genre !== "ECHEANCE" && l.genre !== "LOT") || !l.parent_cle) continue;
        const m = montants.get(l.id);
        if (!m) continue;
        const d = decoupages.get(l.parent_cle) ?? { etudes: 0, negoce: 0, achats: 0 };
        d.etudes += n(m.montant_meca) + n(m.montant_calcul) + n(m.montant_elec_pneu) + n(m.montant_scan) + n(m.montant_autre);
        d.negoce += n(m.montant_negoce);
        d.achats += n(m.montant_achats);
        decoupages.set(l.parent_cle, d);
      }

      const res: Commande[] = ls
        .filter((l) => l.genre === "BASE" || l.genre === "AVENANT")
        .map((l) => {
          const m = montants.get(l.id);
          const d = decoupages.get(l.cle);
          const etudes = m ? n(m.montant_meca) + n(m.montant_calcul) + n(m.montant_elec_pneu) + n(m.montant_scan) + n(m.montant_autre) : 0;
          return {
            numero: l.numero_affaire ?? l.cle,
            statut: l.statut ?? "",
            vendu: n(m?.montant),
            etudes: etudes || d?.etudes || 0,
            negoce: n(m?.montant_negoce) || d?.negoce || 0,
            achats: n(m?.montant_achats) || d?.achats || 0,
          };
        })
        .sort((x, y) => x.numero.localeCompare(y.numero, "fr", { numeric: true }));

      if (!actif) return;
      setCommandes(res);
    })().catch(() => undefined);

    return () => {
      actif = false;
    };
  }, [type, numero]);

  if (!autorise) return null;
  if (!commandes || commandes.length === 0) return null;

  const vendu = commandes.reduce((t, c) => t + c.negoce, 0);
  const achete = commandes.reduce((t, c) => t + c.achats, 0);
  if (vendu <= 0 && achete <= 0) return null; // pas de négoce sur cette affaire

  return (
    <section
      aria-label="Négoce de l'affaire"
      style={{ background: "#ffffff", border: "1px solid #e3e6ea", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 28px", fontSize: 15 }}
    >
      <strong style={{ fontSize: 17 }}>Négoce</strong>
      <span>
        Vendu : <strong>{euros(vendu)}</strong>
      </span>
      <span>
        Acheté : <strong style={{ color: "#7a3e00" }}>{euros(achete)}</strong>
      </span>
      <span>
        Marge : <strong style={{ color: vendu - achete < 0 ? "#b3261e" : "#1b5e20" }}>{euros(vendu - achete)}</strong>
        {vendu > 0 && <span style={{ color: "#5b6168", fontSize: 13 }}> ({Math.round(((vendu - achete) / vendu) * 100)} %)</span>}
      </span>
      <span style={{ color: "#5b6168", fontSize: 12 }}>d’après le Suivi d’affaire BE, commande et avenants</span>
    </section>
  );
}
