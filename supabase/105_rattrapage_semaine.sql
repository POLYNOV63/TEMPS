-- =====================================================================
-- 105 - MA SEMAINE : HEURES RATTRAPÉES DANS LA SEMAINE (RATTRAPAGE_SEMAINE, 19/11/2026)
--
-- Un jour où il manque des heures (on part plus tôt) peut être coché
-- « Rattrapé dans la semaine » : ses heures manquantes sont prises sur les
-- heures faites en plus les autres jours de la même semaine, sans débiter
-- le compteur de récupération et sans heures sup pour ces heures-là.
-- La case est gardée jour par jour. Relançable sans risque.
-- =====================================================================

alter table public.feuilles_heures_jours add column if not exists rattrapage boolean not null default false;

select count(*) filter (where rattrapage) as jours_rattrapes, count(*) as jours from public.feuilles_heures_jours;
