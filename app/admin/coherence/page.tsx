"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import EnTetePage from "@/components/EnTetePage";
import GardeAcces from "@/components/GardeAcces";
import { C, Message, Pastille, page } from "@/components/pilotage/ui";
import { supabase } from "@/lib/supabase";
import { formatDate, formatHeures } from "@/lib/pilotageCalculs";

/* ===============================================================
   ADMINISTRATION - COHÉRENCE DU PARAMÉTRAGE

   Liste ce qui empêche les données de bien se relier (codes sans
   activité, collaborateurs sans rythme, numéros d'affaire inconnus…),
   avec un lien pour corriger chaque point. Ne modifie rien.
   Source : fonction SQL controles_coherence() (script 26).
================================================================ */

type Resultat = {
  codes_sans_activite: { code: string; libelle: string }[];
  activites_sans_code: { code: string; nom: string }[];
  collab_sans_rythme: { id: string; trigramme: string | null; nom: string }[];
  numeros_inconnus: { type: string; numero: string; heures: number; personnes: string | null; derniere: string }[];
  correspondance: { colonne: string; probleme: string }[];
  redacteurs_inconnus: { nom: string; lignes: number }[];
  responsables_inactifs: { id: string; type: string; numero: string; designation: string; responsable: string }[];
  affectations_inactifs: { trigramme: string; heures: number; jusquau: string }[];
  derniere_synchro: string | null;
};

function Controle({
  titre,
  pourquoi,
  nombre,
  gravite,
  corriger,
  children,
}: {
  titre: string;
  pourquoi: string;
  nombre: number;
  gravite: "crit" | "warn";
  corriger?: { libelle: string; href: string };
  children?: ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const ok = nombre === 0;

  return (
    <section style={{ ...page.carte, padding: 16, marginBottom: 12, borderLeft: `5px solid ${ok ? "#2e7d32" : gravite === "crit" ? "#b3261e" : "#c76500"}` }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <Pastille genre={ok ? "ok" : gravite}>{ok ? "✓ OK" : `${nombre} à corriger`}</Pastille>
        <h2 style={{ margin: 0, fontSize: 17 }}>{titre}</h2>
        <span style={{ flex: 1 }} />
        {!ok && children && (
          <button
            type="button"
            aria-expanded={ouvert}
            onClick={() => setOuvert((v) => !v)}
            style={{ ...page.btnSecondaire, minHeight: 36, fontSize: 14 }}
          >
            {ouvert ? "Masquer" : "Voir la liste"}
          </button>
        )}
        {!ok && corriger && (
          <Link href={corriger.href} style={{ fontWeight: 800, color: C.rougeFonce, whiteSpace: "nowrap" }}>
            {corriger.libelle} →
          </Link>
        )}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: C.gris }}>{pourquoi}</p>
      {!ok && ouvert && <div style={{ marginTop: 10 }}>{children}</div>}
    </section>
  );
}

const liste = { margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 } as const;

function CoherenceContenu() {
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur("");
    const { data, error } = await supabase.rpc("controles_coherence");
    if (error) setErreur(error.message);
    else setResultat(data as Resultat);
    setChargement(false);
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const r = resultat;
  const joursDepuisSynchro = r?.derniere_synchro ? Math.floor((Date.now() - new Date(r.derniere_synchro).getTime()) / 86400000) : null;
  const synchroEnRetard = joursDepuisSynchro === null || joursDepuisSynchro > 14;

  const total = r
    ? r.codes_sans_activite.length +
      r.activites_sans_code.length +
      r.collab_sans_rythme.length +
      r.numeros_inconnus.length +
      r.correspondance.length +
      r.redacteurs_inconnus.length +
      r.responsables_inactifs.length +
      r.affectations_inactifs.length +
      (synchroEnRetard ? 1 : 0)
    : 0;

  return (
    <main style={page.fond}>
      <EnTetePage section="Administration" />

      <div style={{ ...page.contenu, maxWidth: 1100 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <div>
            <h1 style={page.titre}>Cohérence du paramétrage</h1>
            <p style={page.sousTitre}>
              Ce qui empêche les heures, le chiffré et le planning de bien se relier. Chaque point a un lien pour le corriger ;
              cette page ne modifie rien.
            </p>
          </div>
          <button type="button" onClick={() => void charger()} disabled={chargement} style={page.btnSecondaire}>
            {chargement ? "Vérification…" : "↻ Relancer les contrôles"}
          </button>
        </div>

        {erreur && <Message genre="erreur">{erreur}</Message>}

        {r && !chargement && (
          <>
            <Message genre={total === 0 ? "ok" : "info"}>
              {total === 0 ? "Tout est cohérent ✓" : `${total} point${total > 1 ? "s" : ""} à regarder.`}
            </Message>

            <h2 style={{ fontSize: 18, margin: "20px 0 10px" }}>Saisie des heures</h2>

            <Controle
              titre="Numéros d’affaire inconnus dans les feuilles"
              pourquoi="Heures saisies (12 derniers mois) sur un numéro qui n’existe ni dans le Pilotage, ni dans le Suivi d’affaire, ni dans l’historique : faute de frappe probable, ces heures ne comptent sur aucune affaire."
              nombre={r.numeros_inconnus.length}
              gravite="crit"
              corriger={{ libelle: "Feuilles collaborateurs", href: "/admin/feuilles" }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={page.th}>N° saisi</th>
                    <th style={{ ...page.th, textAlign: "right" }}>Heures</th>
                    <th style={page.th}>Saisi par</th>
                    <th style={page.th}>Dernière saisie</th>
                  </tr>
                </thead>
                <tbody>
                  {r.numeros_inconnus.map((n) => (
                    <tr key={`${n.type}${n.numero}`}>
                      <td style={{ ...page.td, fontWeight: 800 }}>
                        {n.type} {n.numero}
                      </td>
                      <td style={{ ...page.td, textAlign: "right" }}>{formatHeures(Number(n.heures) || 0)}</td>
                      <td style={page.td}>{n.personnes ?? "—"}</td>
                      <td style={page.td}>{formatDate(n.derniere)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: 12, color: C.gris, margin: "8px 0 0" }}>
                Corrigez le numéro dans la feuille de la personne (Feuilles collaborateurs), ou déclarez l’affaire si elle est nouvelle.
              </p>
            </Controle>

            <Controle
              titre="Codes autorisés sur affaire, rattachés à aucune activité"
              pourquoi="Ces codes ne peuvent pas être choisis dans « Ma semaine » pour un CBE, et leurs heures historiques arrivent en « sans activité » dans les bilans."
              nombre={r.codes_sans_activite.length}
              gravite="warn"
              corriger={{ libelle: "Gestion des activités", href: "/admin/Gestion-activites" }}
            >
              <ul style={liste}>
                {r.codes_sans_activite.map((c) => (
                  <li key={c.code}>
                    <strong>{c.code}</strong> — {c.libelle}
                  </li>
                ))}
              </ul>
            </Controle>

            <Controle
              titre="Activités sans aucun code"
              pourquoi="Rien ne peut être saisi sur ces activités : leur réalisé restera toujours à 0."
              nombre={r.activites_sans_code.length}
              gravite="warn"
              corriger={{ libelle: "Gestion des activités", href: "/admin/Gestion-activites" }}
            >
              <ul style={liste}>
                {r.activites_sans_code.map((a) => (
                  <li key={a.code}>
                    <strong>{a.nom}</strong> ({a.code})
                  </li>
                ))}
              </ul>
            </Controle>

            <h2 style={{ fontSize: 18, margin: "20px 0 10px" }}>Collaborateurs et planning</h2>

            <Controle
              titre="Collaborateurs actifs sans rythme horaire"
              pourquoi="Leur capacité vaut 0 : ils paraissent toujours « pleins » au planning et leur feuille utilise un horaire par défaut."
              nombre={r.collab_sans_rythme.length}
              gravite="crit"
              corriger={{ libelle: "Collaborateurs", href: "/admin/collaborateurs" }}
            >
              <ul style={liste}>
                {r.collab_sans_rythme.map((c) => (
                  <li key={c.id}>
                    <strong>{c.trigramme ?? "—"}</strong> {c.nom}
                  </li>
                ))}
              </ul>
            </Controle>

            <Controle
              titre="Affaires actives dont le responsable est inactif"
              pourquoi="Personne ne pilote ces affaires : changez le responsable depuis leur fiche."
              nombre={r.responsables_inactifs.length}
              gravite="warn"
            >
              <ul style={liste}>
                {r.responsables_inactifs.map((a) => (
                  <li key={a.id}>
                    <Link href={`/pilotage/affaire/${a.id}`} style={{ fontWeight: 800, color: C.rougeFonce }}>
                      {a.type} {a.numero}
                    </Link>{" "}
                    {a.designation} — responsable : {a.responsable}
                  </li>
                ))}
              </ul>
            </Controle>

            <Controle
              titre="Affectations à venir de collaborateurs inactifs"
              pourquoi="Ces heures restent comptées comme planifiées alors que la personne n’est plus là : réaffectez-les ou supprimez-les dans le planning."
              nombre={r.affectations_inactifs.length}
              gravite="warn"
              corriger={{ libelle: "Planning des affaires", href: "/pilotage/affaires" }}
            >
              <ul style={liste}>
                {r.affectations_inactifs.map((a) => (
                  <li key={a.trigramme}>
                    <strong>{a.trigramme}</strong> : {formatHeures(Number(a.heures) || 0)} jusqu’au {formatDate(a.jusquau)}
                  </li>
                ))}
              </ul>
            </Controle>

            <h2 style={{ fontSize: 18, margin: "20px 0 10px" }}>Suivi d’affaire BE (Excel)</h2>

            <Controle
              titre="Synchronisation du classeur"
              pourquoi={
                joursDepuisSynchro === null
                  ? "Aucune synchronisation n’a encore été appliquée : portefeuille, chiffré et indicateurs sont vides."
                  : `Dernière synchronisation le ${formatDate(r.derniere_synchro)} (il y a ${joursDepuisSynchro} jour${joursDepuisSynchro > 1 ? "s" : ""}). Au-delà de 14 jours, le chiffré et les indicateurs ne sont plus à jour.`
              }
              nombre={synchroEnRetard ? 1 : 0}
              gravite="warn"
              corriger={{ libelle: "Synchroniser", href: "/admin/synchro-suivi-affaires" }}
            />

            <Controle
              titre="Colonnes Excel sans activité"
              pourquoi="Les heures chiffrées de ces colonnes ne deviennent les besoins d’aucune activité dans le Pilotage."
              nombre={r.correspondance.length}
              gravite="warn"
              corriger={{ libelle: "Correspondance des activités", href: "/admin/synchro-suivi-affaires" }}
            >
              <ul style={liste}>
                {r.correspondance.map((c) => (
                  <li key={c.colonne}>
                    <strong>{c.colonne}</strong> : {c.probleme}
                  </li>
                ))}
              </ul>
            </Controle>

            <Controle
              titre="Rédacteurs du classeur non reconnus"
              pourquoi="Noms du classeur (« Rédacteur devis », « Livré par ») qui ne correspondent à aucun collaborateur : la nouvelle affaire prend alors un responsable par défaut. Vérifiez l’orthographe « Prénom NOM » dans Excel ou dans la fiche collaborateur."
              nombre={r.redacteurs_inconnus.length}
              gravite="warn"
              corriger={{ libelle: "Collaborateurs", href: "/admin/collaborateurs" }}
            >
              <ul style={liste}>
                {r.redacteurs_inconnus.map((n) => (
                  <li key={n.nom}>
                    <strong>{n.nom}</strong> ({n.lignes} ligne{n.lignes > 1 ? "s" : ""})
                  </li>
                ))}
              </ul>
            </Controle>
          </>
        )}
      </div>
    </main>
  );
}

export default function CoherencePage() {
  return (
    <GardeAcces droit="administration">
      <CoherenceContenu />
    </GardeAcces>
  );
}
