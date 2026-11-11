import { redirect } from "next/navigation";

/* SUIVI_DEVIS : les Indicateurs commerciaux sont devenus l'onglet Statistiques du Suivi des devis.
   L'ancienne adresse y redirige, pour ne casser aucun lien ni favori.
   Repères des anciennes mises à jour : INDICATEURS_V2 ACTIVITES_NEGOCE NEGOCE_INTERGROUPE DEVIS_FERMES DETAIL_AUTRE NAVIGATION_AXES */
export default function AnciensIndicateursPage() {
  redirect("/pilotage/devis?onglet=statistiques");
}
