-- =====================================================================
-- 100 - ANALYSE PAR CLIENT (ANALYSE_CLIENTS)
--
-- Relançable sans risque.
--
-- 1) client_regroupements : les noms de clients à compter ensemble.
--    Les noms identiques (MICHELIN et MICHELIN, LIMAGRAIN SCA…) se
--    regroupent tout seuls ; cette table ne sert qu'aux noms différents.
--    Pour en ajouter un plus tard :
--      insert into public.client_regroupements (nom, groupe)
--      values ('NOM DANS LE SUIVI', 'NOM DU GROUPE') on conflict (nom) do update set groupe = excluded.groupe;
--
-- 2) analyse_heures_clients(début, fin) : les heures pointées entre deux
--    dates, par affaire (CBE ou DBE) et par activité, feuilles d'heures et
--    historique (même règle que le réalisé du Pilotage). ADMIN seulement.
-- =====================================================================

create table if not exists public.client_regroupements (
  nom text primary key,
  groupe text not null
);

alter table public.client_regroupements enable row level security;

drop policy if exists client_regroupements_lecture on public.client_regroupements;
create policy client_regroupements_lecture on public.client_regroupements
  for select to authenticated using (true);

insert into public.client_regroupements (nom, groupe) values
  ('MICHELIN URG', 'MICHELIN'),
  ('MICHELIN LAD', 'MICHELIN'),
  ('MICHELIN COM', 'MICHELIN'),
  ('IMERYS (RIOM ES MTGNE)', 'IMERYS')
on conflict (nom) do update set groupe = excluded.groupe;

create or replace function public.analyse_heures_clients(p_debut date, p_fin date)
returns table (type_affaire text, numero text, activite_id uuid, heures numeric)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.rh_est_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;

  return query
  with codes_activite as (
    select distinct on (ac.code)
           ac.code as code_ref,
           ac.activite_id as activite_ref
    from public.activites_codes ac
    join public.activites a on a.id = ac.activite_id
    order by ac.code, a.ordre_affichage, a.id
  ),
  nouveau as (
    select
      upper(btrim(i.type_affaire)) as t,
      ltrim(substring(regexp_replace(btrim(coalesce(i.numero_affaire, '')), '^(CBE|DBE|CAS)\s*[-:]?\s*', '', 'i') from '^[0-9]+'), '0') as n,
      coalesce(i.activite_id, ca.activite_ref) as a,
      i.heures as h
    from public.feuilles_heures_imputations i
    join public.feuilles_heures_jours j on j.id = i.jour_id
    left join codes_activite ca on ca.code_ref = i.code
    where upper(btrim(i.type_affaire)) in ('CBE', 'DBE')
      and j.date_jour between p_debut and p_fin
  ),
  histo as (
    select
      case when (m.g)[1] = 'DBE' then 'DBE' else 'CBE' end as t,
      ltrim((m.g)[2], '0') as n,
      ca.activite_ref as a,
      hi.heures as h
    from public.historique_imputations hi
    cross join lateral (
      select regexp_match(upper(coalesce(hi.affaire_code, '')), '^\s*(CBE|CAS|DBE)\s*[-:]?\s*([0-9]+)') as g
    ) m
    left join codes_activite ca on ca.code_ref = hi.code_imputation
    where m.g is not null
      and to_date(hi.annee::text || '-' || lpad(hi.semaine::text, 2, '0') || '-1', 'IYYY-IW-ID') between p_debut and p_fin
      and not exists (
        select 1
        from public.feuilles_heures f
        where f.collaborateur_id = hi.collaborateur_id
          and extract(isoyear from coalesce(f.semaine_debut, f.date_debut_semaine))::int = hi.annee
          and extract(week from coalesce(f.semaine_debut, f.date_debut_semaine))::int = hi.semaine
      )
  )
  select u.t, u.n, u.a, sum(u.h)::numeric
  from (select t, n, a, h from nouveau union all select t, n, a, h from histo) u
  where coalesce(u.n, '') <> ''
  group by u.t, u.n, u.a;
end;
$$;

revoke all on function public.analyse_heures_clients(date, date) from public, anon;
grant execute on function public.analyse_heures_clients(date, date) to authenticated;

-- Contrôle : les regroupements, et les heures de l'exercice en cours
select * from public.client_regroupements order by groupe, nom;
