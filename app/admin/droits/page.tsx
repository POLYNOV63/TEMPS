"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { DESCRIPTIONS_DROITS, DROITS, PAGES, peutParDefaut, type Droit, type PageApp, type Role } from "@/lib/droits";
import { chargerDroitsRoles } from "@/lib/droitsRoles";

/* ===============================================================
   PARAMÉTRAGE - DROITS D'ACCÈS (DROITS_ROLES, SQL 97)

   Un tableau à cocher : rôle par rôle, ce que chacun peut faire
   (FONCTIONS) et quelles pages il peut ouvrir (PAGES).
   - Une fonction ouvre ce qui en dépend : les pages qui la demandent,
     des onglets, des colonnes (ex. « Suivi des affaires avec les
     montants »), des actions.
   - Une page se règle aussi seule : la fermer à un rôle, ou l'ouvrir
     alors que sa fonction ne l'est pas.
   - L'administrateur a toujours tout (colonne verrouillée) ; le tableau
     de bord est toujours ouvert.
   Seuls les réglages modifiés sont enregistrés (repérés « modifié »).
   « Rétablir les réglages d'origine » efface tout.
   Rappel : la base de données garde ses propres contrôles (qui peut
   enregistrer quoi) ; ces réglages décident de ce que l'application
   montre à chacun.
================================================================ */

const COLONNES: { role: Role; libelle: string }[] = [
  { role: "COLLABORATEUR", libelle: "Collaborateur" },
  { role: "RESPONSABLE", libelle: "Responsable" },
  { role: "DIRECTION", libelle: "Direction" },
  { role: "ADMIN", libelle: "Administrateur" },
];
const GROUPES = ["Mon espace", "Pilotage", "Analyse", "RH", "Exports", "Paramétrage"];

function DroitsContenu() {
  const [reglages, setReglages] = useState<Map<string, boolean> | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");

  const charger = useCallback(async () => {
    const { data, error } = await supabase.from("polynov_droits_roles").select("cle,role,autorise");
    if (error) {
      setIndisponible(true);
      setReglages(new Map());
      return;
    }
    setIndisponible(false);
    setReglages(new Map(((data ?? []) as { cle: string; role: string; autorise: boolean }[]).map((x) => [`${x.cle}|${x.role}`, Boolean(x.autorise)])));
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  /* valeurs effectives, d'après les réglages affichés */
  const droitEffectif = useCallback(
    (role: Role, d: Droit) => (role === "ADMIN" ? true : reglages?.get(`droit:${d}|${role}`) ?? peutParDefaut(role, d)),
    [reglages]
  );
  const pageDefaut = useCallback((role: Role, p: PageApp) => (p.droit === null ? true : droitEffectif(role, p.droit)), [droitEffectif]);
  const pageEffective = useCallback(
    (role: Role, p: PageApp) => (role === "ADMIN" || p.href === "/dashboard" ? true : reglages?.get(`page:${p.href}|${role}`) ?? pageDefaut(role, p)),
    [reglages, pageDefaut]
  );

  async function regler(cle: string, role: Role, valeur: boolean, parDefaut: boolean) {
    setErreur("");
    setInfo("");
    setEnCours(`${cle}|${role}`);
    // revenir à la valeur d'origine efface le réglage
    const { error } = await supabase.rpc("polynov_regler_droit", { p_cle: cle, p_role: role, p_autorise: valeur === parDefaut ? null : valeur });
    setEnCours(null);
    if (error) return setErreur(error.message);
    await charger();
    await chargerDroitsRoles(true);
  }

  async function retablir() {
    if (!window.confirm("Rétablir tous les réglages d’origine ? Toutes les modifications faites ici seront effacées.")) return;
    const { error } = await supabase.rpc("polynov_retablir_droits");
    if (error) return setErreur(error.message);
    await charger();
    await chargerDroitsRoles(true);
    setInfo("Réglages d’origine rétablis.");
  }

  const q = recherche.trim().toLowerCase();
  const droitsListe = useMemo(() => (Object.keys(DROITS) as Droit[]).filter((d) => !q || `${DESCRIPTIONS_DROITS[d].libelle} ${DESCRIPTIONS_DROITS[d].aide}`.toLowerCase().includes(q)), [q]);
  const pagesListe = useMemo(() => PAGES.filter((p) => !q || `${p.libelle} ${p.href}`.toLowerCase().includes(q)), [q]);
  const nbModifies = reglages ? reglages.size : 0;

  const th: CSSProperties = { ...page.th, padding: "8px 10px", fontSize: 13, textAlign: "center", whiteSpace: "nowrap", position: "sticky", top: "var(--hauteur-nav, 0px)", background: "#f4f5f7", zIndex: 2 };
  const td: CSSProperties = { ...page.td, padding: "7px 10px", fontSize: 14, verticalAlign: "middle" };

  const caseRole = (cle: string, role: Role, valeur: boolean, parDefaut: boolean, verrou?: string) => {
    const modifie = reglages?.has(`${cle}|${role}`) ?? false;
    const occupe = enCours === `${cle}|${role}`;
    return (
      <td key={role} style={{ ...td, textAlign: "center", background: modifie ? "#fff7e0" : undefined }}>
        {verrou ? (
          <span title={verrou} style={{ fontSize: 16, color: C.gris }}>
            ☑ 🔒
          </span>
        ) : (
          <label title={modifie ? `Modifié (à l’origine : ${parDefaut ? "oui" : "non"})` : "Réglage d’origine"} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={valeur}
              disabled={occupe || indisponible}
              onChange={(e) => void regler(cle, role, e.target.checked, parDefaut)}
              style={{ width: 20, height: 20, cursor: "pointer" }}
            />
            {modifie && <span style={{ fontSize: 10, fontWeight: 800, color: "#8a6500" }}>modifié</span>}
          </label>
        )}
      </td>
    );
  };

  const enTete = (titre: string) => (
    <thead>
      <tr>
        <th style={{ ...th, textAlign: "left" }}>{titre}</th>
        {COLONNES.map((c) => (
          <th key={c.role} style={th}>
            {c.libelle}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <main style={page.fond}>
      <EnTetePage section="Paramétrage" />
      <div style={{ ...page.contenu, maxWidth: 1100 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <h1 style={page.titre}>Droits d’accès</h1>
            <p style={page.sousTitre}>Ce que chaque rôle peut faire, et les pages qu’il peut ouvrir. Une case cochée = autorisé. Les changements s’appliquent tout de suite.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher une page, une fonction…" aria-label="Rechercher" style={{ ...page.entrees, width: 260, minHeight: 40 }} />
            <button type="button" onClick={() => void retablir()} disabled={nbModifies === 0 || indisponible} style={page.btnSecondaire} title="Effacer toutes les modifications">
              Rétablir les réglages d’origine{nbModifies > 0 ? ` (${nbModifies})` : ""}
            </button>
          </div>
        </div>

        {indisponible && <Message genre="erreur">Le réglage des droits n’est pas encore installé : lancez le script supabase/97_droits_roles.sql. En attendant, les réglages d’origine s’appliquent.</Message>}
        {erreur && <Message genre="erreur">{erreur}</Message>}
        {info && <Message genre="ok">{info}</Message>}

        <Message genre="info">
          <strong>Fonctions</strong> : ce qu’un rôle peut faire ; elles ouvrent aussi les pages qui en dépendent (colonne « ouvre »). <strong>Pages</strong> : ouvrir ou fermer une page précise à un rôle, quelle
          que soit sa fonction. Sur fond jaune : réglage modifié. L’administrateur a toujours tout. Pour vérifier, utilisez « Voir comme » sur le tableau de bord. La base de données garde ses propres
          contrôles : ouvrir une page ne permet pas d’enregistrer ce que la base refuse à ce rôle.
        </Message>

        {!reglages ? (
          <Message genre="info">Chargement…</Message>
        ) : (
          <>
            <section style={{ ...page.carte, padding: 14, marginBottom: 16, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Fonctions</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                {enTete("Fonction")}
                <tbody>
                  {GROUPES.map((g) => {
                    const liste = droitsListe.filter((d) => DESCRIPTIONS_DROITS[d].groupe === g);
                    if (liste.length === 0) return null;
                    return (
                      <Fragment key={g}>
                        <tr>
                          <td colSpan={5} style={{ ...td, background: "#eef0f3", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>
                            {g}
                          </td>
                        </tr>
                        {liste.map((d) => {
                          const pagesDe = PAGES.filter((p) => p.droit === d).map((p) => p.libelle);
                          return (
                            <tr key={d}>
                              <td style={td}>
                                <strong>{DESCRIPTIONS_DROITS[d].libelle}</strong>
                                <div style={{ fontSize: 12, color: C.gris }}>{DESCRIPTIONS_DROITS[d].aide}</div>
                                {pagesDe.length > 0 && <div style={{ fontSize: 11.5, color: "#34506b" }}>ouvre : {pagesDe.join(", ")}</div>}
                              </td>
                              {COLONNES.map((c) =>
                                caseRole(`droit:${d}`, c.role, droitEffectif(c.role, d), c.role === "ADMIN" ? true : peutParDefaut(c.role, d), c.role === "ADMIN" ? "L’administrateur a toujours tout" : undefined)
                              )}
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section style={{ ...page.carte, padding: 14, overflowX: "auto" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Pages</h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                {enTete("Page")}
                <tbody>
                  {GROUPES.map((g) => {
                    const liste = pagesListe.filter((p) => p.groupe === g);
                    if (liste.length === 0) return null;
                    return (
                      <Fragment key={g}>
                        <tr>
                          <td colSpan={5} style={{ ...td, background: "#eef0f3", fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>
                            {g}
                          </td>
                        </tr>
                        {liste.map((p) => (
                          <tr key={p.href}>
                            <td style={td}>
                              <strong>{p.libelle}</strong>
                              <div style={{ fontSize: 12, color: C.gris }}>
                                {p.href}
                                {p.droit ? ` · d’origine : fonction « ${DESCRIPTIONS_DROITS[p.droit].libelle} »` : " · d’origine : toute personne connectée"}
                              </div>
                            </td>
                            {COLONNES.map((c) =>
                              caseRole(
                                `page:${p.href}`,
                                c.role,
                                pageEffective(c.role, p),
                                c.role === "ADMIN" ? true : pageDefaut(c.role, p),
                                c.role === "ADMIN" ? "L’administrateur a toujours tout" : p.href === "/dashboard" ? "Le tableau de bord est toujours ouvert" : undefined
                              )
                            )}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function DroitsPage() {
  return (
    <GardeAcces droit="administration">
      <DroitsContenu />
    </GardeAcces>
  );
}
