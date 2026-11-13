-- =====================================================================
-- 99 - PERSONNES INACTIVES : GARDER LEUR PASSÉ VISIBLE (INACTIFS_VISIBLES)
--
-- Relançable sans risque.
--
-- La liste des personnes du Pilotage (pilotage_annuaire) peut maintenant
-- renvoyer aussi les fiches désactivées, avec une colonne « actif ».
--   pilotage_annuaire()                 : les personnes actives (comme avant)
--   pilotage_annuaire(p_inactifs => true) : toutes, actives et inactives
-- Les pages s'en servent pour garder le nom et les affectations passées
-- d'une personne désactivée (relevé PE / PI, plannings), sans la proposer
-- dans les listes de choix.
-- =====================================================================

drop function if exists public.pilotage_annuaire();
drop function if exists public.pilotage_annuaire(boolean);

create function public.pilotage_annuaire(p_inactifs boolean default false)
returns table(id uuid, trigramme text, prenom text, nom text, inclus_statistiques boolean, date_sortie date, actif boolean)
language sql
stable
security definer
set search_path to ''
as $$
  select c.id, c.trigramme, c.prenom, c.nom, coalesce(c.inclus_statistiques, true), c.date_sortie, coalesce(c.actif, false)
  from public.collaborateurs c
  where (c.actif = true or p_inactifs)
    and upper(coalesce(c.role, '')) <> 'DIRECTION'
    and public.polynov_peut_lire_planning()
  order by c.trigramme;
$$;

revoke all on function public.pilotage_annuaire(boolean) from public, anon;
grant execute on function public.pilotage_annuaire(boolean) to authenticated;

-- Contrôle : actives seules, puis toutes
select (select count(*) from public.pilotage_annuaire()) as actives,
       (select count(*) from public.pilotage_annuaire(true)) as toutes;
