import { redirect } from "next/navigation";

/* SUIVI_OUVERT : l'Analyse du chiffré est reprise par le Suivi des affaires (période, activité, export).
   Repères des anciennes mises à jour : NEGOCE_A_PART_CHIFFRE NEGOCE_ROBUSTE SCAN_A_PART TEMPS_PASSE_INFO MONTANT_HORS_COMPARAISON */
export default function AnalyseChiffrePage() {
  redirect("/pilotage");
}
