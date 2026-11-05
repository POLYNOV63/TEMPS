-- =====================================================================
-- 82 · Période des congés payés : 1er juin → 31 mai
-- Remplace l'ancienne valeur par défaut (1er avril → 31 mai, 14 mois) par la
-- période d'acquisition légale : du 1er juin de l'année de l'exercice au
-- 31 mai de l'année suivante. Ne touche que les dates par défaut (ou vides).
-- =====================================================================

update public.rh_droits
   set cp_periode_debut = make_date(exercice, 6, 1),
       cp_periode_fin   = make_date(exercice + 1, 5, 31)
 where cp_periode_debut is null
    or cp_periode_debut = make_date(exercice, 4, 1);
