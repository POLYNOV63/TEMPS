import { redirect } from "next/navigation";

/* REGLAGES_NOTES_FRAIS : l'ancienne page « Paramètres des notes de frais » (barème kilométrique, destinataires)
   est désormais un bloc replié en bas du Suivi des notes de frais */
export default function AncienneAdresse() {
  redirect("/admin/suivi-notes-frais#reglages");
}
