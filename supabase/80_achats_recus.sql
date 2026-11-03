-- =====================================================================
-- 80 · Achats reçus ou montés d'une affaire (montant saisi à la main)
-- Pour l'en-cours du négoce : seuls les achats reçus ou montés comptent.
-- Saisi par un responsable ou l'administration, sur la commande de base ;
-- daté et signé.
-- =====================================================================

alter table public.pilotage_affaires
  add column if not exists achats_recus numeric,
  add column if not exists achats_recus_le date,
  add column if not exists achats_recus_par uuid references public.collaborateurs(id);

create or replace function public.pilotage_maj_achats_recus(p_affaire_id uuid, p_montant numeric)
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
    raise exception 'Seuls les responsables et l''administration peuvent saisir les achats reçus.';
  end if;
  if p_montant is not null and p_montant < 0 then
    raise exception 'Le montant des achats reçus ne peut pas être négatif.';
  end if;
  update pilotage_affaires
     set achats_recus = p_montant,
         achats_recus_le = case when p_montant is null then null else current_date end,
         achats_recus_par = case when p_montant is null then null else v_moi end
   where id = p_affaire_id;
end;
$$;

revoke all on function public.pilotage_maj_achats_recus(uuid, numeric) from public;
grant execute on function public.pilotage_maj_achats_recus(uuid, numeric) to authenticated;
