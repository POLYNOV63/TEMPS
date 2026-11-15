import { redirect } from "next/navigation";

/* FIN_DE_MOIS : l'ancienne page « Export Excel » est désormais un bloc de la page Bilan RH mensuel */
export default function AncienneAdresse() {
  redirect("/admin/bilan-rh#export");
}
