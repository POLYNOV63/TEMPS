import { redirect } from "next/navigation";

/* CAPACITE_ACTIVITES : le Bilan activités est devenu l'onglet « Par activité » de l'Analyse de capacité */
export default function BilanActivitesPage() {
  redirect("/admin/bilans");
}
