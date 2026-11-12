-- =====================================================================
-- 97 - DROITS D'ACCÈS PAR RÔLE (DROITS_ROLES)
--
-- Relançable sans risque.
--
-- La page Paramétrage › Droits d'accès règle, rôle par rôle, l'accès à
-- chaque page et à chaque fonction de l'application. Cette table ne
-- garde que les réglages MODIFIÉS : sans ligne, c'est le réglage
-- d'origine (écrit dans lib/droits.ts) qui s'applique. « Rétablir les
-- réglages d'origine » vide la table.
--   cle  : « page:/pilotage » (une page) ou « droit:montantsAffaires »
--          (une fonction) ;
--   role : COLLABORATEUR, RESPONSABLE ou DIRECTION (l'ADMIN a toujours tout).
-- Lecture : toute personne connectée (pour afficher menus et pages).
-- Écriture : ADMIN, par les fonctions ci-dessous.
-- Rappel : les fonctions SQL et les règles RLS gardent leurs propres
-- contrôles ; ces réglages décident de ce que l'application affiche.
-- =====================================================================

create table if not exists public.polynov_droits_roles (
  cle text not null check (cle ~ '^(page|droit):'),
  role text not null check (role in ('COLLABORATEUR', 'RESPONSABLE', 'DIRECTION')),
  autorise boolean not null,
  modifie_le timestamptz not null default now(),
  modifie_par uuid references public.collaborateurs(id) on delete set null,
  primary key (cle, role)
);

alter table public.polynov_droits_roles enable row level security;
drop policy if exists polynov_droits_roles_select on public.polynov_droits_roles;
create policy polynov_droits_roles_select on public.polynov_droits_roles for select to authenticated using (true);
revoke all on table public.polynov_droits_roles from anon;
revoke insert, update, delete on table public.polynov_droits_roles from authenticated;
grant select on table public.polynov_droits_roles to authenticated;

create or replace function public.polynov_est_admin_droits()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.collaborateurs c
     where c.id = public.polynov_mon_collaborateur_id() and upper(coalesce(c.role, '')) = 'ADMIN'
  );
$$;

-- Régler un accès ; p_autorise null = revenir au réglage d'origine
create or replace function public.polynov_regler_droit(p_cle text, p_role text, p_autorise boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.polynov_est_admin_droits() then
    raise exception 'Seuls les administrateurs peuvent régler les droits d’accès.';
  end if;
  if p_role not in ('COLLABORATEUR', 'RESPONSABLE', 'DIRECTION') then
    raise exception 'Rôle inconnu : %', p_role;
  end if;
  if p_autorise is null then
    delete from public.polynov_droits_roles where cle = p_cle and role = p_role;
  else
    insert into public.polynov_droits_roles (cle, role, autorise, modifie_le, modifie_par)
    values (p_cle, p_role, p_autorise, now(), public.polynov_mon_collaborateur_id())
    on conflict (cle, role) do update set autorise = excluded.autorise, modifie_le = excluded.modifie_le, modifie_par = excluded.modifie_par;
  end if;
end;
$$;

-- Rétablir tous les réglages d'origine
create or replace function public.polynov_retablir_droits()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.polynov_est_admin_droits() then
    raise exception 'Seuls les administrateurs peuvent régler les droits d’accès.';
  end if;
  delete from public.polynov_droits_roles where true;
end;
$$;

revoke all on function public.polynov_est_admin_droits() from public, anon;
revoke all on function public.polynov_regler_droit(text, text, boolean) from public, anon;
revoke all on function public.polynov_retablir_droits() from public, anon;
grant execute on function public.polynov_est_admin_droits() to authenticated;
grant execute on function public.polynov_regler_droit(text, text, boolean) to authenticated;
grant execute on function public.polynov_retablir_droits() to authenticated;

-- Contrôle
select count(*) as reglages_modifies from public.polynov_droits_roles;
