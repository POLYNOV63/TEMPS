-- =====================================================================
-- 75 · Activité des commandes PE / PI, version 3
-- Une date de réception de commande ANTÉRIEURE à la date d'ouverture de
-- la ligne est une erreur de saisie (souvent jour et mois inversés) : elle
-- est ignorée. La commande, sans date connue ni heure saisie, est alors
-- traitée comme nouvelle (jamais classée « sans activité »).
-- =====================================================================

create or replace function public.pepi_activite_commandes()
returns table (affaire_id uuid, numero text, derniere_saisie date, date_commande date)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.numero::text,
    (select max(s.jour)::date
       from prestation_lignes l
       join prestation_saisies s on s.ligne_id = l.id
      where l.affaire_id = a.id and coalesce(s.heures, 0) > 0),
    (select max(case when sl.date_ouverture is null or sl.date_reception_commande >= sl.date_ouverture
                     then sl.date_reception_commande end)::date
       from suivi_lignes sl
      where sl.genre in ('BASE', 'AVENANT')
        and upper(regexp_replace(coalesce(sl.numero_affaire, ''), '^\s*CBE\s*[-:]?\s*', '', 'i')) = upper(btrim(a.numero)))
  from pilotage_affaires a
  where a.imputation in ('PE', 'PI')
    and auth.uid() is not null;
$$;

revoke all on function public.pepi_activite_commandes() from public;
grant execute on function public.pepi_activite_commandes() to authenticated;

-- Contrôle : les dates de réception antérieures à l'ouverture, dans tout le classeur
select numero_affaire, genre, statut, date_ouverture, date_reception_commande
from public.suivi_lignes
where date_reception_commande is not null
  and date_ouverture is not null
  and date_reception_commande < date_ouverture
  and not coalesce(disparue, false)
order by numero_affaire;
