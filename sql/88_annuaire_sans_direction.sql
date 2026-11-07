-- =============================================================
-- 88 : ANNUAIRE DU PLANNING SANS LES ACCÈS DIRECTION
--
-- pilotage_annuaire alimente tout le Pilotage BE (planning des affaires,
-- planning et charge par ressource, disponibilités…). Une fiche Direction
-- (consultation seule) n'est pas une ressource : on l'en retire.
-- Même signature qu'avant : rien d'autre à changer. Relançable sans risque.
-- =============================================================

create or replace function public.pilotage_annuaire()
 returns table(id uuid, trigramme text, prenom text, nom text, inclus_statistiques boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.id, c.trigramme, c.prenom, c.nom, coalesce(c.inclus_statistiques, true)
  from public.collaborateurs c
  where c.actif = true
    and upper(coalesce(c.role, '')) <> 'DIRECTION'
    and public.polynov_peut_lire_planning()
  order by c.trigramme;
$function$;
