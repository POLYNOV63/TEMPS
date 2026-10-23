/* ================================================================
   56_direction_invisible.sql  -  Un accès Direction n'est qu'un ACCÈS :
   la fiche n'apparaît nulle part (feuilles, statistiques, planning,
   charge, listes de personnes, Suivi RH…).

   - La base masque les fiches DIRECTION à toutes les lectures, sauf la
     fiche de la personne elle-même (pour qu'elle puisse se connecter).
   - La page Collaborateurs (section « Accès Direction ») les lit et les
     modifie par deux fonctions réservées aux administrateurs.
   La connexion Microsoft (rattachement du compte) n'est pas concernée.
   Peut être relancé sans risque.
   ================================================================ */

-- 1. masquer les fiches Direction (règle « restrictive » : s'ajoute aux règles existantes)
drop policy if exists polynov_collaborateurs_sans_direction on public.collaborateurs;
create policy polynov_collaborateurs_sans_direction on public.collaborateurs
  as restrictive
  for select
  to authenticated
  using (
    upper(coalesce(role, '')) <> 'DIRECTION'
    or id = public.polynov_mon_collaborateur_id()
  );

-- 2. liste des accès Direction (administrateurs seulement)
create or replace function public.polynov_acces_direction()
returns setof public.collaborateurs
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rh_est_admin() then
    raise exception 'Accès administrateur requis.';
  end if;

  return query
    select * from public.collaborateurs
    where upper(coalesce(role, '')) = 'DIRECTION'
    order by nom, prenom;
end;
$$;

-- 3. modifier, couper, rétablir ou supprimer un accès Direction (administrateurs seulement)
create or replace function public.polynov_gerer_direction(
  p_id uuid,
  p_action text,
  p_prenom text default null,
  p_nom text default null,
  p_trigramme text default null,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rh_est_admin() then
    raise exception 'Accès administrateur requis.';
  end if;

  if not exists (
    select 1 from public.collaborateurs
    where id = p_id and upper(coalesce(role, '')) = 'DIRECTION'
  ) then
    raise exception 'Accès Direction introuvable.';
  end if;

  case upper(p_action)
    when 'MODIFIER' then
      update public.collaborateurs
      set prenom = coalesce(nullif(trim(p_prenom), ''), prenom),
          nom = coalesce(nullif(trim(p_nom), ''), nom),
          trigramme = coalesce(nullif(upper(trim(p_trigramme)), ''), trigramme),
          role = coalesce(nullif(upper(trim(p_role)), ''), role),
          inclus_statistiques = case when upper(coalesce(nullif(trim(p_role), ''), role)) = 'DIRECTION' then false else inclus_statistiques end,
          updated_at = now()
      where id = p_id;
    when 'COUPER' then
      update public.collaborateurs set actif = false, updated_at = now() where id = p_id;
    when 'RETABLIR' then
      update public.collaborateurs set actif = true, updated_at = now() where id = p_id;
    when 'SUPPRIMER' then
      delete from public.collaborateurs where id = p_id;
    else
      raise exception 'Action inconnue : %', p_action;
  end case;
end;
$$;

revoke all on function public.polynov_acces_direction() from public, anon;
revoke all on function public.polynov_gerer_direction(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.polynov_acces_direction() to authenticated;
grant execute on function public.polynov_gerer_direction(uuid, text, text, text, text, text) to authenticated;

/* VERIFICATION - à lancer seule : les fiches Direction existantes (l'éditeur SQL voit tout)
   select prenom, nom, email, actif from public.collaborateurs where upper(coalesce(role, '')) = 'DIRECTION';
*/
