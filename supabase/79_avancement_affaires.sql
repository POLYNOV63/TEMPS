-- =====================================================================
-- 79 · Avancement estimé des affaires au forfait (% accompli)
-- Saisi par un responsable ou l'administration, sur la commande de base de
-- la famille ; daté et signé. L'export des en-cours le prend s'il existe,
-- sinon l'avancement aux heures (pointé ÷ chiffré).
-- =====================================================================

alter table public.pilotage_affaires
  add column if not exists avancement_pct numeric,
  add column if not exists avancement_le date,
  add column if not exists avancement_par uuid references public.collaborateurs(id);

create or replace function public.pilotage_maj_avancement(p_affaire_id uuid, p_pct numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moi uuid;
  v_role text;
begin
  select id, upper(coalesce(role, '')) into v_moi, v_role from collaborateurs where auth_user_id = auth.uid();
  if v_role is null or v_role not in ('ADMIN', 'RESPONSABLE') then
    raise exception 'Seuls les responsables et l''administration peuvent saisir l''avancement d''une affaire.';
  end if;
  if p_pct is not null and (p_pct < 0 or p_pct > 100) then
    raise exception 'L''avancement se donne entre 0 et 100 %%.';
  end if;
  update pilotage_affaires
     set avancement_pct = p_pct,
         avancement_le = case when p_pct is null then null else current_date end,
         avancement_par = case when p_pct is null then null else v_moi end
   where id = p_affaire_id;
end;
$$;

revoke all on function public.pilotage_maj_avancement(uuid, numeric) from public;
grant execute on function public.pilotage_maj_avancement(uuid, numeric) to authenticated;
