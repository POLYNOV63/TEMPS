import { redirect } from "next/navigation";

/* RESSOURCES_FUSION : l'ancienne page « Disponibilités par activité » est désormais dans l’Analyse de capacité, onglet « Disponibilités à venir » (CAPACITE_DISPOS) */
export default function AncienneAdresse() {
  redirect("/admin/bilans#disponibilites");
}
