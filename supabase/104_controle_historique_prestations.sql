-- =====================================================================
-- 104 - CONTRÔLE (lecture seule) : l'historique des prestations à rattacher
--
-- L'historique (prestation_historique) garde les lignes du Suivi des
-- prestations que l'import n'a pas pu rattacher au relevé : commande
-- absente du Suivi d'affaire, personne inconnue… Leur CA compte dans
-- Finances et la Rentabilité, mais la fiche affaire ne les voit pas
-- (cas de la CBE1624R5, corrigé par le script 103).
--
-- Cette requête liste ces lignes, commande par commande, et dit :
--   - COMMANDE CONNUE    : la commande existe maintenant au Pilotage ;
--                          à rattacher (ré-import des mois, ou script
--                          sur le modèle du 103) ;
--   - DÉJÀ AU RELEVÉ     : la commande a aussi ce mois au relevé validé
--                          (risque de double compte : à vérifier) ;
--   - COMMANDE INCONNUE  : toujours absente du Suivi d'affaire.
-- Ne modifie rien.
-- =====================================================================

with histo as (
  select
    upper(h.type) as type,
    upper(regexp_replace(h.numero, '\s', '', 'g')) as numero,
    upper(coalesce(h.categorie, '')) as categorie,
    to_char(h.mois, 'YYYY-MM') as mois,
    h.personne,
    h.client,
    coalesce(h.heures, 0) as heures,
    coalesce(h.montant, 0) as montant
  from public.prestation_historique h
),
affaires as (
  select id, upper(type) as type, upper(regexp_replace(numero, '\s', '', 'g')) as numero, statut, imputation
  from public.pilotage_affaires
),
releve as (
  select distinct l.affaire_id, to_char(m.mois, 'YYYY-MM') as mois
  from public.prestation_mois m
  join public.prestation_lignes l on l.id = m.ligne_id
  where m.valide
)
select
  h.type || h.numero as commande,
  h.categorie,
  string_agg(distinct h.client, ', ') as client,
  string_agg(distinct coalesce(h.personne, '?'), ', ') as personnes,
  min(h.mois) as du,
  max(h.mois) as au,
  count(distinct h.mois) as nb_mois,
  round(sum(h.heures)::numeric, 1) as heures,
  round(sum(h.montant)::numeric, 0) as montant,
  case
    when a.id is null then 'COMMANDE INCONNUE'
    when bool_or(r.affaire_id is not null) then 'DÉJÀ AU RELEVÉ (à vérifier)'
    else 'COMMANDE CONNUE : à rattacher'
  end as etat,
  a.statut as statut_pilotage
from histo h
left join affaires a
  on a.type = h.type
 and regexp_replace(a.numero, '^0+', '') = regexp_replace(h.numero, '^0+', '')
left join releve r
  on r.affaire_id = a.id and r.mois = h.mois
group by h.type, h.numero, h.categorie, a.id, a.statut
order by
  case when a.id is null then 2 when bool_or(r.affaire_id is not null) then 0 else 1 end,
  max(h.mois) desc,
  h.numero;
