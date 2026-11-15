import { redirect } from "next/navigation";

/* RECUPERATIONS : l'ancienne page « Compteurs de récupération » faisait doublon avec Absences et compteurs
   (même ajustement du compteur, même historique) ; son adresse y mène désormais */
export default function AncienneAdresse() {
  redirect("/admin/suivi-rh");
}
