-- =====================================================================
-- 92 - SUIVI DES DEVIS : RELANCES PRÉVUES (RELANCES_PLANIFIEES)
--
-- À lancer APRÈS le 91. Relançable sans risque.
--
-- Une relance se PRÉVOIT (qui relance, et quand) puis se NOTE comme faite :
--   - relance prévue : prevue_le + responsable_id remplis, relance_le vide
--   - relance faite  : relance_le rempli (le jour où elle a été faite)
-- Une seule relance prévue à la fois par devis.
-- Les relances prévues apparaissent dans la feuille de route de la
-- personne désignée (fonction ma_feuille_de_route_relances).
-- =====================================================================

alter table public.suivi_devis_relances add column if not exists prevue_le date;
alter table public.suivi_devis_relances add column if not exists responsable_id uuid references public.collaborateurs(id) on delete set null;
alter table public.suivi_devis_relances alter column relance_le drop not null;

alter table public.suivi_devis_relances drop constraint if exists suivi_devis_relances_prevue_ou_faite;
alter table public.suivi_devis_relances add constraint suivi_devis_relances_prevue_ou_faite
  check (relance_le is not null or (prevue_le is not null and responsable_id is not null));

-- une seule relance prévue (pas encore faite) par devis
create unique index if not exists suivi_devis_relances_une_prevue
  on public.suivi_devis_relances (numero_devis) where relance_le is null;

create index if not exists suivi_devis_relances_responsable_idx
  on public.suivi_devis_relances (responsable_id) where relance_le is null;

-- ---------------------------------------------------------------------
-- Prévoir (ou modifier) la relance d'un devis : qui, quand
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

  update public.suivi_devis_relances r
     set prevue_le = p_date,
         responsable_id = p_responsable,
         commentaire = nullif(btrim(coalesce(p_commentaire, '')), '')
   where r.numero_devis = v_numero and r.relance_le is null
  returning r.id into v_id;

  if v_id is null then
    insert into public.suivi_devis_relances (numero_devis, prevue_le, responsable_id, commentaire, saisi_par)
    values (v_numero, p_date, p_responsable, nullif(btrim(coalesce(p_commentaire, '')), ''), public.polynov_mon_collaborateur_id())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Noter une relance faite : clôt la relance prévue s'il y en a une,
-- sinon enregistre une relance faite (par la personne connectée)
-- ---------------------------------------------------------------------
create or replace function public.suivi_devis_noter_relance(
  p_numero text,
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
  v_moi uuid := public.polynov_mon_collaborateur_id();
begin
  -- la personne désignée peut aussi noter sa relance comme faite (depuis sa feuille de route, plus tard)
  v_numero := ltrim(regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g'), '0');
  if v_numero = '' then
    raise exception 'N° de devis manquant ou mal formé.';
  end if;

  if not public.polynov_peut_piloter()
     and not exists (select 1 from public.suivi_devis_relances r
                     where r.numero_devis = v_numero and r.relance_le is null and r.responsable_id = v_moi) then
    raise exception 'Seuls les responsables, les administrateurs, ou la personne désignée peuvent noter cette relance.';
  end if;

  if p_date is null then
    raise exception 'Indiquez la date de la relance.';
  end if;
  if p_date > current_date then
    raise exception 'La date de relance ne peut pas être dans le futur.';
  end if;

  update public.suivi_devis_relances r
     set relance_le = p_date,
         commentaire = coalesce(nullif(btrim(coalesce(p_commentaire, '')), ''), r.commentaire)
   where r.numero_devis = v_numero and r.relance_le is null
  returning r.id into v_id;

  if v_id is null then
    insert into public.suivi_devis_relances (numero_devis, relance_le, responsable_id, commentaire, saisi_par)
    values (v_numero, p_date, v_moi, nullif(btrim(coalesce(p_commentaire, '')), ''), v_moi)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Feuille de route : les relances prévues pour une personne
-- (devis encore « Devis envoyé » seulement)
-- ---------------------------------------------------------------------
create or replace function public.ma_feuille_de_route_relances(p_collaborateur_id uuid)
returns table(id uuid, numero_devis text, prevue_le date, commentaire text, designation text, client text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_moi uuid := public.polynov_mon_collaborateur_id();
  v_cible uuid;
begin
  v_cible := coalesce(p_collaborateur_id, v_moi);
  if v_cible is distinct from v_moi
     and not (public.rh_est_admin() or public.polynov_peut_voir_pilotage()) then
    v_cible := v_moi;
  end if;

  return query
    select r.id, r.numero_devis, r.prevue_le, r.commentaire, l.designation::text, cl.nom_abrege::text
    from public.suivi_devis_relances r
    join lateral (
      select sl.designation, sl.client_id, sl.statut
      from public.suivi_lignes sl
      where sl.base_devis = r.numero_devis and not sl.disparue and sl.genre in ('DEVIS', 'BASE', 'AVENANT')
      order by case sl.genre when 'BASE' then 0 when 'AVENANT' then 1 else 2 end
      limit 1
    ) l on true
    left join public.suivi_clients cl on cl.id = l.client_id
    where r.relance_le is null
      and r.responsable_id = v_cible
      and l.statut = 'Devis envoyé'
    order by r.prevue_le, r.numero_devis;
end;
$$;

revoke all on function public.suivi_devis_prevoir_relance(text, uuid, date, text) from public, anon;
revoke all on function public.suivi_devis_noter_relance(text, date, text) from public, anon;
revoke all on function public.ma_feuille_de_route_relances(uuid) from public, anon;
grant execute on function public.suivi_devis_prevoir_relance(text, uuid, date, text) to authenticated;
grant execute on function public.suivi_devis_noter_relance(text, date, text) to authenticated;
grant execute on function public.ma_feuille_de_route_relances(uuid) to authenticated;

-- Contrôle : relances prévues et faites
select count(*) filter (where relance_le is null) as relances_prevues,
       count(*) filter (where relance_le is not null) as relances_faites
from public.suivi_devis_relances;
