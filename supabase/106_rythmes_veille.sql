-- =====================================================================
-- 106 - RYTHMES HORAIRES : la veille du nouveau rythme (19/11/2026)
--
-- Quand on changeait le rythme d'un collaborateur (fiche collaborateur),
-- l'ancien rythme était clôturé DEUX jours avant le nouveau au lieu d'un
-- (calcul de date en heure locale) : un rythme au 18/11 fermait l'ancien
-- au 16/11, et le 17/11 restait sans rythme. Le calcul est corrigé dans
-- l'application ; ce script répare les périodes déjà enregistrées :
-- une période qui se termine exactement deux jours avant la suivante
-- est prolongée jusqu'à la veille. Les autres ne sont pas touchées.
-- Relançable sans risque.
-- =====================================================================

with suivantes as (
  select
    h.id,
    h.date_fin,
    lead(h.date_debut) over (partition by h.collaborateur_id order by h.date_debut) as debut_suivant
  from public.historique_profils_horaires h
)
update public.historique_profils_horaires h
   set date_fin = s.debut_suivant - 1
  from suivantes s
 where s.id = h.id
   and s.debut_suivant is not null
   and s.date_fin = s.debut_suivant - 2
returning h.collaborateur_id, h.date_debut, h.date_fin as nouvelle_date_fin;
