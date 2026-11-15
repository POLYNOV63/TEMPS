import { redirect } from "next/navigation";

/* RESSOURCES_FUSION : l'ancienne page « Cartographie de l’équipe » est désormais un bloc de la page Ressources */
export default function AncienneAdresse() {
  redirect("/pilotage/planning-ressources#composition");
}
