"use client";

import EnTetePage from "@/components/EnTetePage";
import OngletsPilotage from "@/components/pilotage/OngletsPilotage";
import GardeAcces from "@/components/GardeAcces";
import SimulateurContenu from "@/components/simulateur/SimulateurContenu";

/* ===============================================================
   ANALYSE - SIMULATEUR : LA CUVE (SIMULATEUR_CUVE, PLG, 18/11/2026)
   Droit « indicateurs ». Le même simulateur que la console
   (/analyse/simulateur), vu comme une cuve : robinets, fuites, vannes
   graduées, niveau d'eau = résultat. Onglet à part, la console reste.
================================================================ */

export default function PageSimulateurCuve() {
  return (
    <GardeAcces droit="indicateurs">
      <main style={{ minHeight: "100vh", background: "#17191c" }}>
        <EnTetePage section="Analyse" />
        <OngletsPilotage actif="simulateur-cuve" />
        <SimulateurContenu vue="cuve" />
      </main>
    </GardeAcces>
  );
}
