import { redirect } from "next/navigation";

/* RESSOURCES_FUSION : l'ancienne page « Cartographie de l’équipe » est désormais dans l’Analyse de capacité, onglet « Disponibilités à venir » (CAPACITE_DISPOS) */
export default function AncienneAdresse() {
  redirect("/admin/bilans#composition");
}
