-- =====================================================================
-- 101 · Simulateur de rentabilité : paramètres de départ par exercice
-- Ce que la base ne contient pas ailleurs : salaire chargé moyen, management fees,
-- location et autres frais fixes. Une ligne par exercice (année de novembre).
-- Lecture : ADMIN et Direction (droit « indicateurs », en suivant les réglages de Droits d'accès).
-- Écriture : ADMIN seulement.
-- Relançable sans risque.
-- =====================================================================

create table if not exists public.simulateur_parametres (
  exercice integer primary key,                 -- 2025 = exercice 2025-2026
  salaire_charge_k numeric(10, 2) not null,     -- salaire chargé moyen par personne, k€ / an
  fees_pct numeric(6, 2) not null,              -- management fees, % du CA total
  location_k numeric(10, 2) not null,           -- location (loyer et charges), k€ / an
  autres_frais_k numeric(10, 2) not null,       -- autres frais fixes, k€ / an
  modifie_le timestamptz not null default now(),
  modifie_par uuid references public.collaborateurs (id) on delete set null
);

-- Qui peut lire : ADMIN toujours ; sinon le réglage de Droits d'accès pour « indicateurs »,
-- à défaut le réglage d'origine (Direction oui, les autres non).
create or replace function public.simulateur_peut_lire()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_reglage boolean;
begin
  select upper(coalesce(c.role, '')) into v_role
  from public.collaborateurs c
  where c.auth_user_id = auth.uid() and coalesce(c.actif, true)
  limit 1;
  if v_role is null then return false; end if;
  if v_role = 'ADMIN' then return true; end if;
  select r.autorise into v_reglage
  from public.polynov_droits_roles r
  where r.cle = 'droit:indicateurs' and upper(r.role) = v_role
  limit 1;
  if v_reglage is not null then return v_reglage; end if;
  return v_role = 'DIRECTION';
end;
$$;
revoke all on function public.simulateur_peut_lire() from public, anon;
grant execute on function public.simulateur_peut_lire() to authenticated;

alter table public.simulateur_parametres enable row level security;
revoke all on table public.simulateur_parametres from anon;
grant select, insert, update, delete on table public.simulateur_parametres to authenticated;

drop policy if exists simulateur_parametres_lire on public.simulateur_parametres;
create policy simulateur_parametres_lire on public.simulateur_parametres
  for select to authenticated using (public.simulateur_peut_lire());

drop policy if exists simulateur_parametres_admin on public.simulateur_parametres;
create policy simulateur_parametres_admin on public.simulateur_parametres
  for all to authenticated using (public.rh_est_admin()) with check (public.rh_est_admin());

-- Contrôle : la table existe et est vide au départ (les valeurs se saisissent dans la page).
select count(*) as exercices_parametres from public.simulateur_parametres;
