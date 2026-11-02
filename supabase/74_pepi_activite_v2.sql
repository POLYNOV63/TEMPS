-- =====================================================================
-- 74 · Activité des commandes PE / PI, version 2
-- Correction : la date de réception de commande est retrouvée même quand
-- le n° du classeur est écrit avec un espace (« CBE 1771R2 ») ; à défaut,
-- on prend la date d'ouverture du devis de la ligne.
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
    (select max(coalesce(sl.date_reception_commande, sl.date_ouverture))::date
       from suivi_lignes sl
      where sl.genre in ('BASE', 'AVENANT')
        and upper(regexp_replace(coalesce(sl.numero_affaire, ''), '^\s*CBE\s*[-:]?\s*', '', 'i')) = upper(btrim(a.numero)))
  from pilotage_affaires a
  where a.imputation in ('PE', 'PI')
    and auth.uid() is not null;
$$;

revoke all on function public.pepi_activite_commandes() from public;
grant execute on function public.pepi_activite_commandes() to authenticated;

-- Contrôle : les PE / PI en cours dont on ne connaît ni la commande ni l'activité
select a.numero, x.derniere_saisie, x.date_commande
from public.pepi_activite_commandes() x
join public.pilotage_affaires a on a.id = x.affaire_id
where a.statut = 'EN_COURS' and x.date_commande is null
order by a.numero;
