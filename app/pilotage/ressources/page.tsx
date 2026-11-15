import { redirect } from "next/navigation";

/* RESSOURCES_FUSION : l'ancienne page « Charge par ressource » est désormais un bloc de la page Ressources */
export default function AncienneAdresse() {
  redirect("/pilotage/planning-ressources#charge");
}
