/* ================================================================
   68_competences_appoint.sql  -  Analyse des effectifs : deux niveaux
   - PRINCIPALE : la prédominance, l'activité principale de la personne
     (une, parfois deux) : c'est elle qui compte dans la composition ;
   - COMPETENCE : ce qu'elle sait AUSSI faire, en appoint (le Scan pour
     certains) : affichée à part, elle ne pèse pas dans la composition.
   Les prédominances déjà saisies restent « principales ».
   Peut être relancé sans risque.
   ================================================================ */

alter table public.collaborateurs_predominances add column if not exists niveau text not null default 'PRINCIPALE';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'collaborateurs_predominances_niveau_chk') then
    alter table public.collaborateurs_predominances
      add constraint collaborateurs_predominances_niveau_chk check (niveau in ('PRINCIPALE', 'COMPETENCE'));
  end if;
end $$;

drop function if exists public.analyse_effectifs_collaborateurs();

create function public.analyse_effectifs_collaborateurs()
returns table (id uuid, prenom text, nom text, trigramme text, inclus_statistiques boolean, predominances uuid[], competences uuid[])
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.polynov_voit_effectifs() then
    raise exception 'Réservé à l''administration et à la Direction.';
  end if;
  return query
    select c.id, c.prenom::text, c.nom::text, c.trigramme::text, coalesce(c.inclus_statistiques, true),
           coalesce(array_agg(p.activite_id) filter (where p.activite_id is not null and p.niveau = 'PRINCIPALE'), '{}'),
           coalesce(array_agg(p.activite_id) filter (where p.activite_id is not null and p.niveau = 'COMPETENCE'), '{}')
    from public.collaborateurs c
    left join public.collaborateurs_predominances p on p.collaborateur_id = c.id
    where coalesce(c.actif, true)
      and upper(coalesce(c.role, '')) <> 'DIRECTION'
    group by c.id, c.prenom, c.nom, c.trigramme, c.inclus_statistiques
    order by c.nom, c.prenom;
end;
$$;

grant execute on function public.analyse_effectifs_collaborateurs() to authenticated;
