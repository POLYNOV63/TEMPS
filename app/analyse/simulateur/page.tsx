"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import ConsoleRentabilite from "@/components/simulateur/ConsoleRentabilite";
import s from "@/components/simulateur/ConsoleRentabilite.module.css";
import { chargerMoi, type Moi } from "@/lib/pilotageDonnees";
import { AFFAIRES_EXCLUABLES, chargerDonneesRentabilite, type DonneesRentabilite } from "@/lib/rentabilite";
import {
  EXEMPLE,
  chargerEffectifs,
  chargerOccupation,
  chargerParametres,
  chiffresRentabilite,
  construireDepart,
  enregistrerParametres,
  type Parametres,
} from "@/lib/simulateur";

/* ===============================================================
   ANALYSE - SIMULATEUR DE RENTABILITÉ (SIMULATEUR_RENTA, PLG, 17/11/2026)
   Droit « indicateurs » (ADMIN et Direction). Une console de mixage
   (maquette docs/maquettes/console-rentabilite.html) dont les curseurs
   démarrent sur nos chiffres de l'exercice choisi (◀ ▶, novembre → octobre) :
   voir lib/simulateur.ts pour l'origine de chaque chiffre. Les affaires de
   AFFAIRES_EXCLUABLES (CBE 1678 en 2025-2026) sont comptées, avec un bouton
   MUTE pour les sortir. L'ADMIN enregistre salaire chargé, fees, location
   et autres frais comme valeurs de départ (table simulateur_parametres, SQL 101).
================================================================ */

// par défaut : le dernier exercice terminé (en novembre 2026, l'exercice 2025-2026)
function dernierExerciceComplet() {
  const d = new Date();
  const courant = d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
  return courant - 1;
}

type Effectifs = Awaited<ReturnType<typeof chargerEffectifs>>;

function SimulateurContenu() {
  const [exercice, setExercice] = useState(dernierExerciceComplet);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [renta, setRenta] = useState<DonneesRentabilite | null>(null);
  const [effectifs, setEffectifs] = useState<Effectifs | null>(null);
  const [occupation, setOccupation] = useState<{ ex: number; v: { cbe: number; capacite: number } | null } | null>(null);
  const [parametres, setParametres] = useState<{ ex: number; v: Parametres | null } | null>(null);
  const [muets, setMuets] = useState<Set<string>>(new Set()); // « exercice:base » sorties par MUTE
  const [erreur, setErreur] = useState("");

  // une fois : la rentabilité (toutes les affaires), les effectifs, qui je suis
  useEffect(() => {
    let actif = true;
    Promise.all([chargerDonneesRentabilite(), chargerEffectifs(), chargerMoi().catch(() => null)])
      .then(([d, e, m]) => {
        if (!actif) return;
        setRenta(d);
        setEffectifs(e);
        setMoi(m);
      })
      .catch((e) => actif && setErreur(e instanceof Error ? e.message : "Impossible de charger les chiffres."));
    return () => {
      actif = false;
    };
  }, []);

  // par exercice : l'occupation (feuilles d'heures) et les paramètres enregistrés
  useEffect(() => {
    if (!effectifs) return;
    let actif = true;
    setOccupation(null);
    setParametres(null);
    chargerParametres(exercice).then((p) => actif && setParametres({ ex: exercice, v: p }));
    chargerOccupation(
      exercice,
      effectifs.productifs.map((p) => p.id)
    )
      .then((o) => actif && setOccupation({ ex: exercice, v: o }))
      .catch(() => actif && setOccupation({ ex: exercice, v: null }));
    return () => {
      actif = false;
    };
  }, [exercice, effectifs]);

  const excluables = AFFAIRES_EXCLUABLES.filter((x) => x.exercice === exercice);
  const exclues = useMemo(
    () => new Set(AFFAIRES_EXCLUABLES.filter((x) => x.exercice === exercice && muets.has(`${exercice}:${x.base}`)).map((x) => x.base)),
    [exercice, muets]
  );

  const pret = renta && effectifs && occupation?.ex === exercice && parametres?.ex === exercice;
  const depart = useMemo(() => {
    if (!pret || !renta || !effectifs || !occupation || !parametres) return null;
    return construireDepart(exercice, effectifs, occupation.v, chiffresRentabilite(renta, exercice, exclues), parametres.v, renta.couts);
  }, [pret, renta, effectifs, occupation, parametres, exercice, exclues]);
  // pendant un chargement, la console garde les derniers chiffres affichés (pas de retour aux valeurs d’exemple)
  const dernier = useRef<{ depart: NonNullable<typeof depart>; version: string; libelle: string } | null>(null);
  if (depart) {
    const version = `${exercice}|${[...exclues].join(",")}|${parametres?.v?.modifie_le ?? "-"}`;
    if (dernier.current?.version !== version) dernier.current = { depart, version, libelle: `réf. : nos chiffres ${exercice}-${exercice + 1}${exclues.size ? " (mute)" : ""}` };
  }

  const entete = (
    <div className={s.exercice}>
      <span className={s.lbl}>Exercice</span>
      <button type="button" className={s.btn} onClick={() => setExercice((x) => x - 1)} aria-label="Exercice précédent">
        ◀
      </button>
      <strong>
        {exercice}-{exercice + 1}
      </strong>
      <button type="button" className={s.btn} onClick={() => setExercice((x) => x + 1)} aria-label="Exercice suivant">
        ▶
      </button>
      {/* MUTE : sortir une affaire hors norme des chiffres de départ (CBE 1678 en 2025-2026) */}
      {excluables.map((x) => {
        const cle = `${exercice}:${x.base}`;
        const muet = muets.has(cle);
        return (
          <button
            key={cle}
            type="button"
            className={`${s.btn} ${muet ? s.mute : ""}`}
            aria-pressed={muet}
            title={muet ? `CBE ${x.base} sortie des chiffres de départ : cliquer pour la remettre` : `Sortir la CBE ${x.base} des chiffres de départ (efficience, taux de vente, négoce)`}
            onClick={() =>
              setMuets((m) => {
                const n = new Set(m);
                if (n.has(cle)) n.delete(cle);
                else n.add(cle);
                return n;
              })
            }
          >
            {muet ? "🔇" : "🔈"} Mute CBE {x.base}
          </button>
        );
      })}
    </div>
  );

  const message = erreur ? (
    <div className={`${s.message} ${s.erreur}`}>{erreur}</div>
  ) : !depart ? (
    <div className={s.message}>Lecture de nos chiffres de l’exercice {exercice}-{exercice + 1} (affaires, feuilles d’heures)… les curseurs vont s’y placer.</div>
  ) : exclues.size > 0 ? (
    <div className={s.message}>MUTE : la CBE {[...exclues].join(", CBE ")} est sortie des chiffres de départ (efficience, taux de vente, négoce).</div>
  ) : null;

  return (
    <ConsoleRentabilite
      depart={dernier.current?.depart ?? { valeurs: EXEMPLE, sources: {} as never, coutStructure: null, parametres: null }}
      versionDepart={dernier.current?.version ?? "exemple"}
      libelleDepart={dernier.current?.libelle ?? "réf. : valeurs d’exemple"}
      entete={entete}
      message={message}
      estAdmin={Boolean(moi?.estAdmin)}
      onEnregistrer={async (v) => {
        const err = await enregistrerParametres(exercice, v, moi?.id ?? null);
        if (!err) setParametres({ ex: exercice, v: await chargerParametres(exercice) });
        return err;
      }}
    />
  );
}

export default function PageSimulateur() {
  return (
    <GardeAcces droit="indicateurs">
      <main style={{ minHeight: "100vh", background: "#17191c" }}>
        <EnTetePage section="Analyse" />
        <OngletsPilotage actif="simulateur" />
        <SimulateurContenu />
      </main>
    </GardeAcces>
  );
}
