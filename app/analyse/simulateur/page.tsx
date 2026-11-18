"use client";

import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import SimulateurContenu from "@/components/simulateur/SimulateurContenu";

/* ===============================================================
   ANALYSE - SIMULATEUR DE RENTABILITÉ (SIMULATEUR_RENTA, PLG, 17/11/2026)
   Droit « indicateurs » (ADMIN et Direction). Une console de mixage
   (maquette docs/maquettes/console-rentabilite.html) dont les curseurs
   démarrent sur nos chiffres de l'exercice choisi (◀ ▶, novembre → octobre) :
   voir lib/simulateur.ts pour l'origine de chaque chiffre. Les affaires de
   AFFAIRES_EXCLUABLES (CBE 1678 en 2025-2026) sont comptées, avec un bouton
   MUTE pour les sortir. L'ADMIN enregistre salaire chargé, fees, location
   et autres frais comme valeurs de départ (table simulateur_parametres, SQL 101).
   Le chargement est dans components/simulateur/SimulateurContenu.tsx,
   partagé avec l'onglet Cuve (/analyse/simulateur-cuve).
================================================================ */

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
