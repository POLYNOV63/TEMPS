-- =====================================================================
-- 95 - BILAN RH MENSUEL : « ENVOYÉ AUX RH » (BILAN_RH_RAPPEL)
--
-- Relançable sans risque.
--
-- Retient, mois par mois, que le bilan RH a été envoyé aux services RH
-- (qui, quand). Sert au rappel de fin de mois (page Feuilles d'heures,
-- cloche du tableau de bord) : il s'arrête une fois le bilan marqué
-- « envoyé ». Lecture et écriture : ADMIN et RESPONSABLE.
-- =====================================================================

create table if not exists public.rh_bilans_envoyes (
  mois date primary key check (extract(day from mois) = 1),
  envoye_le timestamptz not null default now(),
  envoye_par uuid references public.collaborateurs(id) on delete set null
);

alter table public.rh_bilans_envoyes enable row level security;
drop policy if exists polynov_rh_bilans_envoyes_select on public.rh_bilans_envoyes;
create policy polynov_rh_bilans_envoyes_select on public.rh_bilans_envoyes
  for select to authenticated using (public.polynov_peut_piloter());
revoke all on table public.rh_bilans_envoyes from anon;
revoke insert, update, delete on table public.rh_bilans_envoyes from authenticated;
grant select on table public.rh_bilans_envoyes to authenticated;

-- Marquer (ou démarquer) le bilan d'un mois comme envoyé
create or replace function public.rh_marquer_bilan_envoye(p_mois date, p_envoye boolean default true)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_mois date := date_trunc('month', p_mois)::date;
begin
  if not public.polynov_peut_piloter() then
    raise exception 'Seuls les responsables et les administrateurs peuvent marquer le bilan RH comme envoyé.';
  end if;
  if p_envoye then
    insert into public.rh_bilans_envoyes (mois, envoye_le, envoye_par)
    values (v_mois, now(), public.polynov_mon_collaborateur_id())
    on conflict (mois) do update set envoye_le = excluded.envoye_le, envoye_par = excluded.envoye_par;
  else
    delete from public.rh_bilans_envoyes where mois = v_mois;
  end if;
end;
$$;

revoke all on function public.rh_marquer_bilan_envoye(date, boolean) from public, anon;
grant execute on function public.rh_marquer_bilan_envoye(date, boolean) to authenticated;

-- Contrôle
select count(*) as bilans_marques_envoyes from public.rh_bilans_envoyes;
