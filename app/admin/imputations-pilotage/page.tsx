"use client";

import { useCallback, useEffect, useState } from "react";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import type { Imputation } from "@/lib/pilotageCalculs";

/* ===============================================================
   ADMINISTRATION - IMPUTATIONS DES AFFAIRES (Pilotage BE)

   Liste des imputations proposées lors de la déclaration d'une
   affaire (BE, PE, PI, Scan, Négoce, IG...). Comme Gestion des codes,
   l'administrateur peut en ajouter, les renommer, les ordonner et les
   désactiver. Une imputation déjà utilisée ne se supprime pas : on la
   désactive (elle reste visible sur les affaires existantes).
================================================================ */

type Ligne = Imputation & { nouvelle?: boolean; modifiee?: boolean; usages: number };

function normaliserCode(valeur: string) {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "")
    .slice(0, 12);
}

function ImputationsContenu() {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState("");

  const [nCode, setNCode] = useState("");
  const [nLibelle, setNLibelle] = useState("");
  const [nOrdre, setNOrdre] = useState("100");
  const [nCharge, setNCharge] = useState(true);

  const charger = useCallback(async () => {
    setErreur("");

    const [imp, aff] = await Promise.all([
      supabase
        .from("pilotage_imputations")
        .select("code,libelle,actif,ordre_affichage,charge_obligatoire")
        .order("ordre_affichage", { ascending: true })
        .order("code", { ascending: true }),
      supabase.from("pilotage_affaires").select("imputation"),
    ]);

    if (imp.error || aff.error) {
      setErreur((imp.error ?? aff.error)!.message);
      setChargement(false);
      return;
    }

    const usages = new Map<string, number>();

    for (const a of (aff.data ?? []) as { imputation: string | null }[]) {
      if (a.imputation) usages.set(a.imputation, (usages.get(a.imputation) ?? 0) + 1);
    }

    setLignes(
      ((imp.data ?? []) as Imputation[]).map((i) => ({ ...i, usages: usages.get(i.code) ?? 0 }))
    );
    setChargement(false);
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  function modifier(code: string, champs: Partial<Ligne>) {
    setLignes((l) => l.map((x) => (x.code === code ? { ...x, ...champs, modifiee: true } : x)));
  }

  async function enregistrer(l: Ligne) {
    setErreur("");
    setInfo("");

    if (!l.libelle.trim()) {
      setErreur("Le libellé est obligatoire.");
      return;
    }

    setEnCours(l.code);

    const { error } = await supabase
      .from("pilotage_imputations")
      .update({
        libelle: l.libelle.trim(),
        actif: l.actif,
        charge_obligatoire: l.charge_obligatoire,
        ordre_affichage: Number.isFinite(Number(l.ordre_affichage)) ? Number(l.ordre_affichage) : 100,
      })
      .eq("code", l.code);

    setEnCours("");

    if (error) {
      setErreur(error.message);
      return;
    }

    setInfo(`Imputation ${l.code} enregistrée.`);
    await charger();
  }

  async function ajouter() {
    setErreur("");
    setInfo("");

    const code = normaliserCode(nCode);

    if (!code) {
      setErreur("Le code est obligatoire (lettres et chiffres, 12 caractères au plus).");
      return;
    }

    if (!nLibelle.trim()) {
      setErreur("Le libellé est obligatoire.");
      return;
    }

    setEnCours("__nouvelle__");

    const { error } = await supabase.from("pilotage_imputations").insert({
      code,
      libelle: nLibelle.trim(),
      ordre_affichage: Number.isFinite(Number(nOrdre)) ? Number(nOrdre) : 100,
      charge_obligatoire: nCharge,
      actif: true,
    });

    setEnCours("");

    if (error) {
      setErreur(/duplicate key/i.test(error.message) ? `Le code ${code} existe déjà.` : error.message);
      return;
    }

    setNCode("");
    setNLibelle("");
    setNOrdre("100");
    setNCharge(true);
    setInfo(`Imputation ${code} ajoutée.`);
    await charger();
  }

  async function supprimer(l: Ligne) {
    setErreur("");
    setInfo("");

    if (l.usages > 0) {
      setErreur(`${l.code} est utilisée par ${l.usages} affaire(s) : désactivez-la plutôt que de la supprimer.`);
      return;
    }

    if (!window.confirm(`Supprimer l’imputation ${l.code} ?`)) return;

    setEnCours(l.code);

    const { error } = await supabase.from("pilotage_imputations").delete().eq("code", l.code);

    setEnCours("");

    if (error) {
      setErreur(error.message);
      return;
    }

    setInfo(`Imputation ${l.code} supprimée.`);
    await charger();
  }

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />

      <div style={page.contenu}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={page.titre}>Imputations des affaires</h1>
          <p style={page.sousTitre}>
            Les choix proposés dans le menu « Imputation » lors de la déclaration d’une affaire du Pilotage BE
            (BE, PE, PI, Scan, Négoce, IG…).
          </p>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}
        {chargement && <Message genre="info">Chargement…</Message>}

        {!chargement && (
          <>
            <section style={{ ...page.carte, padding: 16 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={page.th}>Code</th>
                      <th style={page.th}>Libellé</th>
                      <th style={{ ...page.th, width: 90 }}>Ordre</th>
                      <th style={{ ...page.th, width: 90 }}>Active</th>
                      <th style={{ ...page.th, width: 170 }}>Heures chiffrées obligatoires</th>
                      <th style={{ ...page.th, width: 110 }}>Utilisée</th>
                      <th style={page.th} />
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => (
                      <tr key={l.code} style={{ opacity: l.actif ? 1 : 0.6 }}>
                        <td style={page.td}>
                          <strong style={{ fontSize: 16 }}>{l.code}</strong>
                        </td>
                        <td style={page.td}>
                          <input
                            aria-label={`Libellé de ${l.code}`}
                            type="text"
                            value={l.libelle}
                            onChange={(e) => modifier(l.code, { libelle: e.target.value })}
                            style={page.entrees}
                          />
                        </td>
                        <td style={page.td}>
                          <input
                            aria-label={`Ordre de ${l.code}`}
                            type="number"
                            value={l.ordre_affichage}
                            onChange={(e) => modifier(l.code, { ordre_affichage: Number(e.target.value) })}
                            style={{ ...page.entrees, textAlign: "right" }}
                          />
                        </td>
                        <td style={page.td}>
                          <input
                            aria-label={`${l.code} active`}
                            type="checkbox"
                            checked={l.actif}
                            onChange={(e) => modifier(l.code, { actif: e.target.checked })}
                            style={{ width: 22, height: 22 }}
                          />
                        </td>
                        <td style={page.td}>
                          <input
                            aria-label={`${l.code} : heures chiffrées obligatoires`}
                            type="checkbox"
                            checked={l.charge_obligatoire !== false}
                            onChange={(e) => modifier(l.code, { charge_obligatoire: e.target.checked })}
                            style={{ width: 22, height: 22 }}
                          />
                        </td>
                        <td style={page.td}>{l.usages} affaire(s)</td>
                        <td style={{ ...page.td, whiteSpace: "nowrap", textAlign: "right" }}>
                          <button
                            type="button"
                            disabled={!l.modifiee || enCours === l.code}
                            onClick={() => enregistrer(l)}
                            style={{ ...page.btnPrimaire, opacity: l.modifiee ? 1 : 0.4, marginRight: 8 }}
                          >
                            Enregistrer
                          </button>
                          <button
                            type="button"
                            aria-label={`Supprimer ${l.code}`}
                            onClick={() => supprimer(l)}
                            style={{ ...page.btnSecondaire, borderColor: "#b9bec5", color: "#3b4046" }}
                          >
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ margin: "12px 4px 0", fontSize: 13, color: C.gris }}>
                Une imputation utilisée par des affaires ne peut pas être supprimée : désactivez-la, elle ne sera
                plus proposée pour les nouvelles affaires. Décochez « Heures chiffrées obligatoires » pour les
                prestations planifiées par une personne et une date de fin (par exemple PE) : l’affaire se déclare sans
                heures par activité.
              </p>
            </section>

            <section style={{ ...page.carte, marginTop: 20 }}>
              <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Nouvelle imputation</h2>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "0 1 160px" }}>
                  <label htmlFor="n-code" style={page.etiquette}>Code</label>
                  <input
                    id="n-code"
                    type="text"
                    value={nCode}
                    onChange={(e) => setNCode(normaliserCode(e.target.value))}
                    placeholder="ex. SAV"
                    style={page.entrees}
                  />
                  <div style={page.aide}>Majuscules, 12 caractères au plus.</div>
                </div>
                <div style={{ flex: "2 1 280px" }}>
                  <label htmlFor="n-lib" style={page.etiquette}>Libellé</label>
                  <input
                    id="n-lib"
                    type="text"
                    value={nLibelle}
                    onChange={(e) => setNLibelle(e.target.value)}
                    placeholder="ex. SAV — service après-vente"
                    style={page.entrees}
                  />
                </div>
                <div style={{ flex: "0 1 110px" }}>
                  <label htmlFor="n-ord" style={page.etiquette}>Ordre</label>
                  <input
                    id="n-ord"
                    type="number"
                    value={nOrdre}
                    onChange={(e) => setNOrdre(e.target.value)}
                    style={{ ...page.entrees, textAlign: "right" }}
                  />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontWeight: 600 }}>
                  <input type="checkbox" checked={nCharge} onChange={(e) => setNCharge(e.target.checked)} style={{ width: 22, height: 22 }} />
                  Heures chiffrées obligatoires
                </label>
                <button
                  type="button"
                  style={{ ...page.btnPrimaire, opacity: enCours === "__nouvelle__" ? 0.6 : 1 }}
                  disabled={enCours === "__nouvelle__"}
                  onClick={ajouter}
                >
                  + Ajouter
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function ImputationsPilotagePage() {
  return (
    <GardeAcces droit="administration">
      <ImputationsContenu />
    </GardeAcces>
  );
}
