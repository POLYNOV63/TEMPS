import { redirect } from "next/navigation";

/* ===============================================================
   « Nouvelle affaire » n'existe plus : toutes les affaires viennent du
   Suivi d'affaire BE (synchronisation). Une ancienne adresse ou un ancien
   lien renvoie vers le portefeuille.
================================================================ */

export default function NouvelleAffaire() {
  redirect("/pilotage");
}
