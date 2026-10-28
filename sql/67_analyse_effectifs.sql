/* ================================================================
   67_analyse_effectifs.sql  -  Analyse des effectifs

   1. PRÉDOMINANCES : chaque collaborateur a une ou plusieurs activités
      dominantes (Elec, Calcul + Scan…), choisies dans sa fiche
      (Collaborateurs). La liste vient de la table des activités : une
      activité créée dans « Gestion des activités » est aussitôt proposée.
   2. analyse_effectifs_collaborateurs() : l'équipe active (hors Direction)
      avec ses prédominances.
   3. analyse_effectifs(debut, fin) : heures pointées sur la période, par
      collaborateur × activité × méthode de vente (PE, PI, IG, BE, Devis,
      Hors affaire). Feuilles d'heures + historique importé, sans double
      compte (même règle que le Bilan affaire).
   Réservé à l'administration et à la Direction.
   Peut être relancé sans risque.
   ================================================================ */

create table if not exists public.collaborateurs_predominances (
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  activite_id uuid not null references public.activites(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (collaborateur_id, activite_id)
);

alter table public.collaborateurs_predominances enable row level security;

drop policy if exists predominances_lecture on public.collaborateurs_predominances;
create policy predominances_lecture on public.collaborateurs_predominances
  for select to authenticated using (public.polynov_peut_voir_pilotage());

drop policy if exists predominances_gestion on public.collaborateurs_predominances;
create policy predominances_gestion on public.collaborateurs_predominances
  for all to authenticated using (public.rh_est_admin()) with check (public.rh_est_admin());

/* Accès : administration et Direction */
create or replace function public.polynov_voit_effectifs()
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.collaborateurs c
    where c.auth_user_id = auth.uid()
      and coalesce(c.actif, true)
      and upper(coalesce(c.role, '')) in ('ADMIN', 'DIRECTION')
  );
$$;

create or replace function public.analyse_effectifs_collaborateurs()
returns table (id uuid, prenom text, nom text, trigramme text, inclus_statistiques boolean, predominances uuid[])
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.polynov_voit_effectifs() then
    raise exception 'Réservé à l''administration et à la Direction.';
  end if;
  return query
    select c.id, c.prenom::text, c.nom::text, c.trigramme::text, coalesce(c.inclus_statistiques, true),
           coalesce(array_agg(p.activite_id) filter (where p.activite_id is not null), '{}')
    from public.collaborateurs c
    left join public.collaborateurs_predominances p on p.collaborateur_id = c.id
    where coalesce(c.actif, true)
      and upper(coalesce(c.role, '')) <> 'DIRECTION'
    group by c.id, c.prenom, c.nom, c.trigramme, c.inclus_statistiques
    order by c.nom, c.prenom;
end;
$$;

create or replace function public.analyse_effectifs(p_debut date, p_fin date)
returns table (collaborateur_id uuid, activite_id uuid, methode text, heures numeric)
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.polynov_voit_effectifs() then
    raise exception 'Réservé à l''administration et à la Direction.';
  end if;
  return query
  with codes_activite as (
    select distinct on (ac.code) ac.code as code_ref, ac.activite_id as activite_ref
    from public.activites_codes ac
    join public.activites a on a.id = ac.activite_id
    order by ac.code, a.ordre_affichage, a.id
  ),
  /* méthode de vente de chaque commande : l'imputation de la commande de base au Pilotage */
  methodes as (
    select distinct on (n) n, imp
    from (
      select ltrim(substring(pa.numero from '^[0-9]+'), '0') as n,
             upper(coalesce(pa.imputation, '')) as imp,
             (pa.numero ~ '^[0-9]+$') as est_base
      from public.pilotage_affaires pa
      where pa.type = 'CBE'
    ) x
    where coalesce(n, '') <> ''
    order by n, est_base desc
  ),
  lignes as (
    select f.collaborateur_id,
           coalesce(i.activite_id, ca.activite_ref) as activite_id,
           upper(btrim(i.type_affaire)) as t,
           ltrim(substring(regexp_replace(btrim(coalesce(i.numero_affaire, '')), '^(CBE|DBE|CAS)\s*[-:]?\s*', '', 'i') from '^[0-9]+'), '0') as n,
           i.heures
    from public.feuilles_heures_imputations i
    join public.feuilles_heures_jours j on j.id = i.jour_id
    join public.feuilles_heures f on f.id = j.feuille_id
    left join codes_activite ca on ca.code_ref = i.code
    where j.date_jour between p_debut and p_fin
    union all
    select hi.collaborateur_id,
           ca.activite_ref,
           case when m.g is null then 'DIVERS' when (m.g)[1] = 'DBE' then 'DBE' else 'CBE' end,
           ltrim((m.g)[2], '0'),
           hi.heures
    from public.historique_imputations hi
    cross join lateral (select regexp_match(upper(coalesce(hi.affaire_code, '')), '^\s*(CBE|CAS|DBE)\s*[-:]?\s*([0-9]+)') as g) m
    left join codes_activite ca on ca.code_ref = hi.code_imputation
    where to_date(hi.annee::text || '-' || lpad(hi.semaine::text, 2, '0'), 'IYYY-IW') between p_debut - 6 and p_fin
      and not exists (
        select 1 from public.feuilles_heures f
        where f.collaborateur_id = hi.collaborateur_id
          and extract(isoyear from coalesce(f.semaine_debut, f.date_debut_semaine))::int = hi.annee
          and extract(week from coalesce(f.semaine_debut, f.date_debut_semaine))::int = hi.semaine
      )
  )
  select l.collaborateur_id,
         l.activite_id,
         case
           when l.t = 'DBE' then 'DEVIS'
           when l.t = 'CBE' then case
             when m.imp in ('PE', 'PI', 'IG') then m.imp
             else 'BE'
           end
           else 'HORS_AFFAIRE'
         end as methode,
         sum(coalesce(l.heures, 0))::numeric
  from lignes l
  left join methodes m on m.n = l.n and l.t = 'CBE'
  where coalesce(l.heures, 0) <> 0
  group by 1, 2, 3;
end;
$$;

grant execute on function public.polynov_voit_effectifs() to authenticated;
grant execute on function public.analyse_effectifs_collaborateurs() to authenticated;
grant execute on function public.analyse_effectifs(date, date) to authenticated;
