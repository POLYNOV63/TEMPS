/* ================================================================
   63_bilan_sous_dossiers.sql  -  Bilan affaire : heures par SOUS-DOSSIER
   (champ libre saisi dans les feuilles d'heures, SQL 55).
   Totaux par sous-dossier, sans nom de personne (seulement le nombre de
   personnes) : visible de tous ceux qui ouvrent le Bilan affaire.
   Peut être relancé sans risque.
   ================================================================ */

create or replace function public.bilan_affaire_sous_dossiers(p_type text, p_numero text)
returns table (sous_dossier text, heures numeric, personnes integer, premier_jour date, dernier_jour date)
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(nullif(btrim(i.sous_dossier), ''), '(non précisé)') as sous_dossier,
         sum(coalesce(i.heures, 0))::numeric as heures,
         count(distinct f.collaborateur_id)::integer as personnes,
         min(j.date_jour) as premier_jour,
         max(j.date_jour) as dernier_jour
  from public.feuilles_heures_imputations i
  join public.feuilles_heures_jours j on j.id = i.jour_id
  join public.feuilles_heures f on f.id = j.feuille_id
  where upper(i.type_affaire) = upper(p_type)
    and ltrim(regexp_replace(coalesce(i.numero_affaire, ''), '\D.*$', ''), '0') = ltrim(p_numero, '0')
    and coalesce(i.heures, 0) > 0
    and auth.uid() is not null
  group by 1
  order by 2 desc;
$$;

revoke all on function public.bilan_affaire_sous_dossiers(text, text) from public, anon;
grant execute on function public.bilan_affaire_sous_dossiers(text, text) to authenticated;
