-- =====================================================================
-- 94 - NOTIFICATIONS DES RELANCES DANS LA CLOCHE (NOTIF_RELANCES)
--
-- À lancer APRÈS le 93. Relançable sans risque.
--
-- La cloche du tableau de bord signale, pour chacun (tous rôles sauf
-- Direction) :
--   - AFFECTEE : une relance qu'un autre lui a confiée (pas encore faite,
--     devis toujours « Devis envoyé ») ;
--   - FAITE    : une relance qu'il a confiée à quelqu'un d'autre et qui
--     vient d'être faite (30 derniers jours), avec la réponse du client.
-- Chaque notification disparaît une fois vue (table suivi_devis_relances_vues,
-- retenue sur tous les postes). Si la relance est confiée à une autre
-- personne, celle-ci est notifiée à son tour.
-- =====================================================================

-- qui a confié la relance, et quand (pour savoir qui notifier)
alter table public.suivi_devis_relances add column if not exists affectee_le timestamptz;
alter table public.suivi_devis_relances add column if not exists affectee_par uuid references public.collaborateurs(id) on delete set null;

update public.suivi_devis_relances
   set affectee_le = cree_le, affectee_par = saisi_par
 where affectee_le is null and responsable_id is not null and prevue_le is not null;

-- notifications déjà vues, par personne
create table if not exists public.suivi_devis_relances_vues (
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  relance_id uuid not null references public.suivi_devis_relances(id) on delete cascade,
  evenement text not null check (evenement in ('AFFECTEE', 'FAITE')),
  vue_le timestamptz not null default now(),
  primary key (collaborateur_id, relance_id, evenement)
);

alter table public.suivi_devis_relances_vues enable row level security;
drop policy if exists polynov_relances_vues_select on public.suivi_devis_relances_vues;
create policy polynov_relances_vues_select on public.suivi_devis_relances_vues
  for select to authenticated using (collaborateur_id = public.polynov_mon_collaborateur_id());
revoke all on table public.suivi_devis_relances_vues from anon;
revoke insert, update, delete on table public.suivi_devis_relances_vues from authenticated;
grant select on table public.suivi_devis_relances_vues to authenticated;

-- ---------------------------------------------------------------------
-- Prévoir une relance (même fonction que le 92) : retient qui l'a confiée ;
-- confiée à une autre personne : elle est notifiée à son tour
-- ---------------------------------------------------------------------
create or replace function public.suivi_devis_prevoir_relance(
  p_numero text,
  p_responsable uuid,
  p_date date,
  p_commentaire text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_numero text;
  v_id uuid;
  v_ancien uuid;
  v_moi uuid := public.polynov_mon_collaborateur_id();
begin
  if not public.polynov_peut_piloter() then
    raise exception 'Seuls les responsables et les administrateurs peuvent prévoir une relance.';
  end if;

  v_numero := ltrim(regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g'), '0');
  if v_numero = '' then
    raise exception 'N° de devis manquant ou mal formé.';
  end if;
  if p_date is null then
    raise exception 'Indiquez la date de la relance.';
  end if;
  if p_responsable is null
     or not exists (select 1 from public.collaborateurs c where c.id = p_responsable and coalesce(c.actif, true)) then
    raise exception 'Choisissez la personne qui fera la relance.';
  end if;

  select r.id, r.responsable_id into v_id, v_ancien
    from public.suivi_devis_relances r
   where r.numero_devis = v_numero and r.relance_le is null;

  if v_id is not null then
    update public.suivi_devis_relances r
       set prevue_le = p_date,
           responsable_id = p_responsable,
           commentaire = nullif(btrim(coalesce(p_commentaire, '')), ''),
           affectee_le = case when v_ancien is distinct from p_responsable then now() else coalesce(r.affectee_le, r.cree_le) end,
           affectee_par = case when v_ancien is distinct from p_responsable then v_moi else coalesce(r.affectee_par, r.saisi_par) end
     where r.id = v_id;
    if v_ancien is distinct from p_responsable then
      delete from public.suivi_devis_relances_vues v where v.relance_id = v_id and v.evenement = 'AFFECTEE';
    end if;
  else
    insert into public.suivi_devis_relances (numero_devis, prevue_le, responsable_id, commentaire, saisi_par, affectee_le, affectee_par)
    values (v_numero, p_date, p_responsable, nullif(btrim(coalesce(p_commentaire, '')), ''), v_moi, now(), v_moi)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Mes notifications de relances (non vues)
-- ---------------------------------------------------------------------
create or replace function public.mes_notifications_relances()
returns table(
  relance_id uuid,
  evenement text,
  numero_devis text,
  quand timestamptz,
  jour date,
  par text,
  reponse text,
  commentaire text,
  designation text,
  client text
)
language plpgsql
stable
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_moi uuid := public.polynov_mon_collaborateur_id();
begin
  if v_moi is null then
    return;
  end if;

  return query
  with devis as (
    select distinct on (sl.base_devis) sl.base_devis, sl.designation, sl.client_id, sl.statut
      from public.suivi_lignes sl
     where not sl.disparue and sl.genre in ('DEVIS', 'BASE', 'AVENANT') and sl.base_devis is not null
     order by sl.base_devis, case sl.genre when 'BASE' then 0 when 'AVENANT' then 1 else 2 end
  ),
  n as (
    -- une relance qu'un autre m'a confiée
    select r.id as rid, 'AFFECTEE'::text as evt, r.numero_devis as num, coalesce(r.affectee_le, r.cree_le) as quand, r.prevue_le as jour,
           coalesce(r.affectee_par, r.saisi_par) as qui, null::text as reponse, r.commentaire as commentaire
      from public.suivi_devis_relances r
     where r.relance_le is null
       and r.responsable_id = v_moi
       and coalesce(r.affectee_par, r.saisi_par) is distinct from v_moi
    union all
    -- une relance que j'ai confiée, faite par quelqu'un d'autre
    select r.id, 'FAITE'::text, r.numero_devis, r.relance_le::timestamptz, r.relance_le,
           r.faite_par, r.reponse, r.commentaire
      from public.suivi_devis_relances r
     where r.relance_le is not null
       and r.relance_le >= current_date - 30
       and coalesce(r.affectee_par, r.saisi_par) = v_moi
       and r.faite_par is distinct from v_moi
  )
  select n.rid, n.evt, n.num, n.quand, n.jour,
         (select coalesce(nullif(c.trigramme, ''), btrim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, ''))) from public.collaborateurs c where c.id = n.qui),
         n.reponse, n.commentaire, d.designation::text, cl.nom_abrege::text
    from n
    left join devis d on d.base_devis = n.num
    left join public.suivi_clients cl on cl.id = d.client_id
   where not exists (select 1 from public.suivi_devis_relances_vues v where v.collaborateur_id = v_moi and v.relance_id = n.rid and v.evenement = n.evt)
     and (n.evt = 'FAITE' or coalesce(d.statut, 'Devis envoyé') = 'Devis envoyé')
   order by n.quand desc
   limit 50;
end;
$$;

-- ---------------------------------------------------------------------
-- Marquer une notification vue, ou toutes
-- ---------------------------------------------------------------------
create or replace function public.marquer_notification_relance_vue(p_relance_id uuid, p_evenement text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_moi uuid := public.polynov_mon_collaborateur_id();
begin
  if v_moi is null or p_evenement not in ('AFFECTEE', 'FAITE') then
    return;
  end if;
  insert into public.suivi_devis_relances_vues (collaborateur_id, relance_id, evenement)
  values (v_moi, p_relance_id, p_evenement)
  on conflict do nothing;
end;
$$;

create or replace function public.marquer_notifications_relances_vues()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_moi uuid := public.polynov_mon_collaborateur_id();
begin
  if v_moi is null then
    return;
  end if;
  insert into public.suivi_devis_relances_vues (collaborateur_id, relance_id, evenement)
  select v_moi, n.relance_id, n.evenement from public.mes_notifications_relances() n
  on conflict do nothing;
end;
$$;

revoke all on function public.suivi_devis_prevoir_relance(text, uuid, date, text) from public, anon;
revoke all on function public.mes_notifications_relances() from public, anon;
revoke all on function public.marquer_notification_relance_vue(uuid, text) from public, anon;
revoke all on function public.marquer_notifications_relances_vues() from public, anon;
grant execute on function public.suivi_devis_prevoir_relance(text, uuid, date, text) to authenticated;
grant execute on function public.mes_notifications_relances() to authenticated;
grant execute on function public.marquer_notification_relance_vue(uuid, text) to authenticated;
grant execute on function public.marquer_notifications_relances_vues() to authenticated;

-- Contrôle : relances prévues avec la personne qui les a confiées
select count(*) filter (where relance_le is null) as relances_prevues,
       count(*) filter (where relance_le is null and affectee_par is not null) as dont_confiees_connues
from public.suivi_devis_relances;
