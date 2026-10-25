/* ================================================================
   64_reste_commande_pepi.sql  -  PE / PI : la commande initiale et le
   reste sur la commande, tels que le classeur « Suivi des prestations »
   les calcule (colonnes « Jours/heures en commande initiale » et
   « Jours/heures restant sur la commande »), dans l'unité de la ligne
   (jours ou heures). Le classeur fait foi ; l'application s'en sert pour
   la Facturation et contrôle son propre calcul.
   Peut être relancé sans risque.
   ================================================================ */

alter table public.prestation_mois add column if not exists commande_import numeric;
alter table public.prestation_mois add column if not exists reste_import numeric;

-- les lignes non rattachées gardent aussi ces deux valeurs (l'import y copie toute la ligne du classeur)
alter table public.prestation_historique add column if not exists commande_initiale numeric;
alter table public.prestation_historique add column if not exists reste_commande numeric;
