-- =============================================================
-- 89 : L'ANNUAIRE DU PLANNING DONNE LA DATE DE SORTIE
--
-- pilotage_annuaire renvoie en plus collaborateurs.date_sortie : le
-- planning grise une ressource sortie, et les fenêtres d'affectation ne
-- la proposent plus une fois la date passée. (Les accès Direction restent
-- exclus, comme au SQL 88.) Le type de retour change : la fonction est
-- supprimée puis recréée. Relançable sans risque.
-- =============================================================

drop function if exists public.pilotage_annuaire();

create function public.pilotage_annuaire()
 returns table(id uuid, trigramme text, prenom text, nom text, inclus_statistiques boolean, date_sortie date)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.id, c.trigramme, c.prenom, c.nom, coalesce(c.inclus_statistiques, true), c.date_sortie
  from public.collaborateurs c
  where c.actif = true
    and upper(coalesce(c.role, '')) <> 'DIRECTION'
    and public.polynov_peut_lire_planning()
  order by c.trigramme;
$function$;

grant execute on function public.pilotage_annuaire() to authenticated;
