-- =====================================================================
-- 72 · Réalisé jour par jour, pour le planning par ressource
-- Ce qui a été pointé, par personne et par jour :
--  - feuilles d'heures (détail au jour) : CBE, DBE et Divers ;
--  - historique importé (à la semaine) pour les semaines sans feuille :
--    réparti sur les 5 jours ouvrés, absences (CP, RTT…) exclues.
-- Ouvert à tout utilisateur connecté (le planning est commun).
-- =====================================================================

create or replace function public.planning_realise(p_debut date, p_fin date)
returns table (collaborateur_id uuid, jour date, type_affaire text, numero text, libelle text, heures numeric)
language sql
stable
security definer
set search_path = public
as $$
  with feuilles as (
    select
      f.collaborateur_id,
      j.date_jour as jour,
      case when upper(btrim(i.type_affaire)) in ('CBE', 'DBE') then upper(btrim(i.type_affaire)) else 'DIVERS' end as type_affaire,
      case when upper(btrim(i.type_affaire)) in ('CBE', 'DBE')
           then ltrim(substring(regexp_replace(btrim(coalesce(i.numero_affaire, '')), '^(CBE|DBE|CAS)\s*[-:]?\s*', '', 'i') from '^[0-9]+'), '0')
      end as numero,
      case when upper(btrim(i.type_affaire)) in ('CBE', 'DBE') then null
           else coalesce(nullif(btrim(i.description), ''), i.code)
      end as libelle,
      i.heures::numeric as heures
    from feuilles_heures_imputations i
    join feuilles_heures_jours j on j.id = i.jour_id
    join feuilles_heures f on f.id = j.feuille_id
    where j.date_jour between p_debut and p_fin
      and coalesce(i.heures, 0) > 0
  ),
  semaines as (
    select hi.*, to_date(hi.annee::text || '-' || lpad(hi.semaine::text, 2, '0'), 'IYYY-IW') as lundi
    from historique_imputations hi
    where coalesce(hi.heures, 0) > 0
  ),
  histo as (
    select
      s.collaborateur_id,
      d::date as jour,
      case when m.g is null then 'DIVERS' when (m.g)[1] = 'DBE' then 'DBE' else 'CBE' end as type_affaire,
      case when m.g is null then null else ltrim((m.g)[2], '0') end as numero,
      case when m.g is null then coalesce(ci.libelle, s.code_imputation) end as libelle,
      (s.heures / 5.0)::numeric as heures
    from semaines s
    cross join lateral (
      select regexp_match(upper(coalesce(s.affaire_code, '')), '^\s*(CBE|CAS|DBE)\s*[-:]?\s*([0-9]+)') as g
    ) m
    left join codes_imputation ci on upper(ci.code) = upper(s.code_imputation)
    cross join lateral generate_series(s.lundi, s.lundi + 4, interval '1 day') d
    where s.lundi + 4 >= p_debut
      and s.lundi <= p_fin
      and coalesce(ci.categorie, '') not in ('ABSENCE', 'HORS_BILAN')
      and not exists (
        select 1 from feuilles_heures f
        where f.collaborateur_id = s.collaborateur_id
          and coalesce(f.semaine_debut, f.date_debut_semaine) = s.lundi
      )
  )
  select u.collaborateur_id, u.jour, u.type_affaire, u.numero, u.libelle, sum(u.heures)
  from (
    select * from feuilles
    union all
    select * from histo where jour between p_debut and p_fin
  ) u
  where auth.uid() is not null
  group by 1, 2, 3, 4, 5;
$$;

revoke all on function public.planning_realise(date, date) from public;
grant execute on function public.planning_realise(date, date) to authenticated;

-- Contrôle : le réalisé de la semaine dernière, par personne
select c.trigramme, round(sum(r.heures), 1) as heures
from public.planning_realise(current_date - 7 - extract(isodow from current_date)::int + 1, current_date - extract(isodow from current_date)::int) r
join public.collaborateurs c on c.id = r.collaborateur_id
group by 1 order by 1;
