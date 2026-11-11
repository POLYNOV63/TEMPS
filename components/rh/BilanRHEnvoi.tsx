"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { periodeRH, periodesAutour, rappelBilanRH, type PeriodeRH } from "@/lib/clotureMensuelle";

/* ===============================================================
   BILAN RH MENSUEL : RAPPEL ET « ENVOYÉ AUX RH » (BILAN_RH_RAPPEL)

   - CarteBilanRH : en tête de la page Feuilles d'heures. Le bilan du
     mois, sa clôture, et le rappel de fin de mois (dès le lundi de la
     semaine de clôture, puis tant que le bilan n'est pas marqué envoyé).
   - BoutonBilanEnvoye : dans la page Bilan RH mensuel, à côté de
     l'export : « ✓ Marquer comme envoyé aux RH ».
   Données : rh_bilans_envoyes (SQL 95).
================================================================ */

type Envoi = { mois: string; envoye_le: string; envoye_par: string | null; par?: string | null };

const dateFR = (d: string) => new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString("fr-FR");

function useEnvois() {
  const [envois, setEnvois] = useState<Map<string, Envoi> | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const recharger = useCallback(async () => {
    const { data, error } = await supabase.from("rh_bilans_envoyes").select("mois,envoye_le,envoye_par").order("mois", { ascending: false }).limit(24);
    if (error) {
      setIndisponible(true);
      setEnvois(new Map());
      return;
    }
    const lignes = (data ?? []) as Envoi[];
    const ids = [...new Set(lignes.map((l) => l.envoye_par).filter((x): x is string => Boolean(x)))];
    const noms = new Map<string, string>();
    if (ids.length) {
      const { data: c } = await supabase.from("collaborateurs").select("id,trigramme,prenom").in("id", ids);
      for (const x of (c ?? []) as { id: string; trigramme: string | null; prenom: string | null }[]) noms.set(x.id, x.trigramme || x.prenom || "");
    }
    setEnvois(new Map(lignes.map((l) => [String(l.mois).slice(0, 7), { ...l, par: l.envoye_par ? noms.get(l.envoye_par) ?? null : null }])));
  }, []);
  useEffect(() => {
    void recharger();
  }, [recharger]);
  return { envois, indisponible, recharger };
}

async function marquer(p: PeriodeRH, envoye: boolean) {
  return supabase.rpc("rh_marquer_bilan_envoye", { p_mois: `${p.cle}-01`, p_envoye: envoye });
}

export default function CarteBilanRH() {
  const router = useRouter();
  const { envois, indisponible, recharger } = useEnvois();
  const [erreur, setErreur] = useState("");
  if (!envois) return null;

  const { courante, precedente } = periodesAutour();
  const rappel = rappelBilanRH(new Set(envois.keys()));
  const cible = rappel?.periode ?? courante;
  const envoiCible = envois.get(cible.cle);
  const envoiPrec = envois.get(precedente.cle);

  const basculer = async (p: PeriodeRH, envoye: boolean) => {
    setErreur("");
    const { error } = await marquer(p, envoye);
    if (error) return setErreur(error.message);
    await recharger();
  };

  const fond = rappel ? (rappel.enRetard ? "#fdecec" : "#fff7e6") : "#ffffff";
  const bord = rappel ? (rappel.enRetard ? "#b3261e" : "#d99a00") : "#c00000";

  return (
    <section style={{ background: fond, border: "1px solid #e3e3e3", borderLeft: `5px solid ${bord}`, borderRadius: 11, padding: "14px 18px", marginBottom: 20, boxShadow: "0 2px 7px rgba(0,0,0,0.045)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <div style={{ flex: "1 1 360px" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {rappel ? (rappel.enRetard ? "🔔 Bilan RH à envoyer : " : "🔔 Semaine de clôture : ") : "📊 Bilan RH mensuel : "}
            <span style={{ textTransform: "capitalize" }}>{cible.libelle}</span>
          </div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 3, lineHeight: 1.45 }}>
            {rappel
              ? rappel.enRetard
                ? `Le mois est clôturé depuis le vendredi ${dateFR(cible.dateCloture)} : exportez le bilan et envoyez-le aux services RH, puis marquez-le « envoyé ».`
                : `Clôture le vendredi ${dateFR(cible.dateCloture)}. Vérifiez que toutes les feuilles sont envoyées, puis exportez le bilan et envoyez-le aux services RH.`
              : envoiCible
                ? `Envoyé aux RH le ${dateFR(envoiCible.envoye_le)}${envoiCible.par ? ` par ${envoiCible.par}` : ""}.`
                : `Clôture le vendredi ${dateFR(cible.dateCloture)} : le rappel apparaîtra le lundi de la semaine de clôture.`}
            {!rappel && envoiPrec && cible.cle !== precedente.cle && (
              <span style={{ display: "block", color: "#138113" }}>
                ✓ <span style={{ textTransform: "capitalize" }}>{precedente.libelle}</span> envoyé le {dateFR(envoiPrec.envoye_le)}
                {envoiPrec.par ? ` par ${envoiPrec.par}` : ""}.
              </span>
            )}
          </div>
          {indisponible && <div style={{ fontSize: 12, color: "#8a5a00", marginTop: 4 }}>Le suivi « envoyé aux RH » n’est pas encore installé : lancez le script supabase/95_bilan_rh_envoye.sql.</div>}
          {erreur && <div style={{ fontSize: 13, color: "#b3261e", fontWeight: 700, marginTop: 4 }}>{erreur}</div>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={() => router.push(`/admin/bilan-rh?mois=${cible.cle}`)}
            style={{ minHeight: 42, padding: "0 16px", borderRadius: 9, border: "1.5px solid #c00000", background: "#c00000", color: "#ffffff", fontWeight: 800, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}
          >
            📊 Bilan RH de {cible.libelle.split(" ")[0]} →
          </button>
          {!indisponible &&
            (envoiCible ? (
              <button
                type="button"
                onClick={() => void basculer(cible, false)}
                title="Le bilan n’a finalement pas été envoyé"
                style={{ minHeight: 42, padding: "0 14px", borderRadius: 9, border: "1.5px solid #cfcfcf", background: "#ffffff", color: "#555", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
              >
                Annuler « envoyé »
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void basculer(cible, true)}
                style={{ minHeight: 42, padding: "0 14px", borderRadius: 9, border: "1.5px solid #138113", background: "#f2faf3", color: "#138113", fontWeight: 800, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}
              >
                ✓ Marquer comme envoyé aux RH
              </button>
            ))}
        </div>
      </div>
    </section>
  );
}

/* Dans la page Bilan RH mensuel, à côté de l'export */
export function BoutonBilanEnvoye({ annee, moisZeroBase }: { annee: number; moisZeroBase: number }) {
  const { envois, indisponible, recharger } = useEnvois();
  const [erreur, setErreur] = useState("");
  if (!envois || indisponible) return null;
  const p = periodeRH(annee, moisZeroBase);
  const e = envois.get(p.cle);
  const basculer = async (envoye: boolean) => {
    setErreur("");
    const { error } = await marquer(p, envoye);
    if (error) return setErreur(error.message);
    await recharger();
  };
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
      {e ? (
        <button
          type="button"
          onClick={() => void basculer(false)}
          title="Cliquer pour annuler"
          style={{ border: "1.5px solid #cfe8d4", background: "#edf8ef", color: "#137a2a", borderRadius: 9, padding: "10px 14px", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}
        >
          ✓ Envoyé aux RH le {dateFR(e.envoye_le)}
          {e.par ? ` (${e.par})` : ""}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void basculer(true)}
          style={{ border: "1.5px solid #138113", background: "#ffffff", color: "#138113", borderRadius: 9, padding: "10px 14px", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}
        >
          ✓ Marquer comme envoyé aux RH
        </button>
      )}
      {erreur && <span style={{ color: "#b3261e", fontSize: 12, fontWeight: 700 }}>{erreur}</span>}
    </span>
  );
}
