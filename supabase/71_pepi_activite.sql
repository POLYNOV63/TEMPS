-- =====================================================================
-- 71 · Activité des commandes PE / PI (commandes ouvertes « dormantes »)
-- Pour chaque PE / PI : la date de la dernière heure saisie au relevé et la
-- date de réception de la commande (Suivi d'affaire BE). L'application en
-- déduit les commandes sans activité depuis 3 mois (relevé, portefeuille,
-- Charge & pointage). Ne renvoie que des dates : ouverte à tout utilisateur
-- connecté (Direction et responsables compris).
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
    (select min(sl.date_reception_commande)::date
       from suivi_lignes sl
      where sl.genre in ('BASE', 'AVENANT')
        and upper(regexp_replace(coalesce(sl.numero_affaire, ''), '^CBE', '', 'i')) = upper(a.numero))
  from pilotage_affaires a
  where a.imputation in ('PE', 'PI')
    and auth.uid() is not null;
$$;

revoke all on function public.pepi_activite_commandes() from public;
grant execute on function public.pepi_activite_commandes() to authenticated;

-- Contrôle : les PE / PI en cours et leur dernière activité
select a.numero, a.statut, x.derniere_saisie, x.date_commande
from public.pepi_activite_commandes() x
join public.pilotage_affaires a on a.id = x.affaire_id
where a.statut = 'EN_COURS'
order by greatest(coalesce(x.derniere_saisie, '1900-01-01'), coalesce(x.date_commande, '1900-01-01'));
