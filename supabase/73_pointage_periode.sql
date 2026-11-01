-- =====================================================================
-- 73 · Pointé sur une période, par affaire, personne et activité
-- Pour la page « Pointé / chiffré » : ce qui a été pointé entre deux dates.
--  - feuilles d'heures : au jour près ;
--  - historique importé (à la semaine), pour les semaines sans feuille :
--    au prorata des jours ouvrés de la semaine compris dans la période ;
--    l'activité est celle rattachée au code dans Gestion des activités.
-- Ouvert à tout utilisateur connecté (comme la page).
-- =====================================================================

create or replace function public.pointage_periode(p_debut date, p_fin date)
returns table (type_affaire text, numero text, collaborateur_id uuid, activite_id uuid, heures numeric)
language sql
stable
security definer
set search_path = public
as $$
  with feuilles as (
    select
      upper(btrim(i.type_affaire)) as type_affaire,
      ltrim(substring(regexp_replace(btrim(coalesce(i.numero_affaire, '')), '^(CBE|DBE|CAS)\s*[-:]?\s*', '', 'i') from '^[0-9]+'), '0') as numero,
      f.collaborateur_id,
      i.activite_id,
      i.heures::numeric as heures
    from feuilles_heures_imputations i
    join feuilles_heures_jours j on j.id = i.jour_id
    join feuilles_heures f on f.id = j.feuille_id
    where j.date_jour between p_debut and p_fin
      and upper(btrim(i.type_affaire)) in ('CBE', 'DBE')
      and coalesce(i.heures, 0) > 0
  ),
  semaines as (
    select hi.*, to_date(hi.annee::text || '-' || lpad(hi.semaine::text, 2, '0'), 'IYYY-IW') as lundi,
           regexp_match(upper(coalesce(hi.affaire_code, '')), '^\s*(CBE|CAS|DBE)\s*[-:]?\s*([0-9]+)') as g
    from historique_imputations hi
    where coalesce(hi.heures, 0) > 0
  ),
  histo as (
    select
      case when (s.g)[1] = 'DBE' then 'DBE' else 'CBE' end as type_affaire,
      ltrim((s.g)[2], '0') as numero,
      s.collaborateur_id,
      (select ac.activite_id from activites_codes ac where upper(ac.code) = upper(s.code_imputation) limit 1) as activite_id,
      (s.heures * (
        select count(*) from generate_series(s.lundi, s.lundi + 4, interval '1 day') d where d::date between p_debut and p_fin
      ) / 5.0)::numeric as heures
    from semaines s
    where s.g is not null
      and s.lundi + 4 >= p_debut
      and s.lundi <= p_fin
      and not exists (
        select 1 from feuilles_heures f
        where f.collaborateur_id = s.collaborateur_id
          and coalesce(f.semaine_debut, f.date_debut_semaine) = s.lundi
      )
  )
  select u.type_affaire, u.numero, u.collaborateur_id, u.activite_id, sum(u.heures)
  from (select * from feuilles union all select * from histo) u
  where auth.uid() is not null and u.numero is not null and u.numero <> '' and u.heures > 0
  group by 1, 2, 3, 4;
$$;

revoke all on function public.pointage_periode(date, date) from public;
grant execute on function public.pointage_periode(date, date) to authenticated;

-- Contrôle : heures pointées en octobre 2026, CBE et DBE
select type_affaire, count(distinct numero) as affaires, round(sum(heures), 1) as heures
from public.pointage_periode('2026-10-01', '2026-10-31')
group by 1 order by 1;
