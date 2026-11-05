-- =====================================================================
-- 85 · Notes de frais : paramètres réglés par les ADMINISTRATEURS
-- - destinataires de l'e-mail (service RH), gardés en base ;
-- - barème kilométrique (prix au km de chaque puissance fiscale).
-- Seuls les administrateurs (rôle ADMIN) peuvent les modifier ; tout le
-- monde peut les lire (la page de saisie s'en sert).
-- =====================================================================

create or replace function public.nf_est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.collaborateurs c
    where c.auth_user_id = auth.uid() and upper(coalesce(c.role, '')) = 'ADMIN' and coalesce(c.actif, true)
  );
$$;

create table if not exists public.nf_parametres (
  cle text primary key,
  valeur text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.nf_parametres (cle, valeur) values ('email_rh', 'a.loyer@sibim.fr, e.lavin@sibim.fr')
on conflict (cle) do nothing;

alter table public.nf_parametres enable row level security;
drop policy if exists nf_parametres_lire on public.nf_parametres;
create policy nf_parametres_lire on public.nf_parametres for select to authenticated using (true);
drop policy if exists nf_parametres_admin on public.nf_parametres;
create policy nf_parametres_admin on public.nf_parametres for all to authenticated using (public.nf_est_admin()) with check (public.nf_est_admin());

-- barème : modifiable par les administrateurs seulement
drop policy if exists nf_baremes_admin on public.nf_baremes;
create policy nf_baremes_admin on public.nf_baremes for all to authenticated using (public.nf_est_admin()) with check (public.nf_est_admin());
