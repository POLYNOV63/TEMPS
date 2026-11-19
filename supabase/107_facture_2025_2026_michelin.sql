-- =====================================================================
-- 107 - CONTRÔLE RAPIDE (lecture seule) : facturé sur l'exercice 2025-2026
--
-- 1. PE / PI : mois CLÔTURÉS (validés) du relevé, de novembre 2025 à
--    octobre 2026, montant figé ; plus les mois de l'historique du Suivi
--    des prestations (lignes non rattachées au relevé), à part.
--    Tous clients, avec la part MICHELIN (hors MICHELIN URG).
-- 2. Forfaits MICHELIN (hors MICHELIN URG) livrés sur l'exercice, comme
--    la page Finances : une échéance / un lot pour son montant à sa
--    livraison ; une commande ou un avenant pour son montant moins ses
--    échéances / lots déjà livrés. Une famille suivie au relevé PE / PI
--    n'y est pas reprise.
-- Client d'une affaire = celui de sa commande de base au Suivi d'affaire.
-- Ne modifie rien.
-- =====================================================================

with
params as (select date '2025-11-01' as debut, date '2026-10-31' as fin),

-- le client de chaque famille (n° de base sans zéros)
client_base as (
  select regexp_replace(l.base_affaire, '^0+', '') as base, c.nom_abrege as client
  from public.suivi_lignes l
  left join public.suivi_clients c on c.id = l.client_id
  where l.genre = 'BASE' and l.base_affaire is not null
),
est_michelin as (
  select base, client,
         (upper(coalesce(client, '')) like '%MICHELIN%' and upper(coalesce(client, '')) not like '%URG%') as michelin
  from client_base
),

-- 1a. relevé PE / PI : mois validés de l'exercice
releve as (
  select a.imputation as categorie,
         regexp_replace(substring(a.numero from '^\d+'), '^0+', '') as base,
         m.montant_fige as montant
  from public.prestation_mois m
  join public.prestation_lignes pl on pl.id = m.ligne_id
  join public.pilotage_affaires a on a.id = pl.affaire_id
  cross join params p
  where m.valide and m.mois between p.debut and p.fin and a.imputation in ('PE', 'PI')
),

-- 1b. historique du Suivi des prestations (lignes non rattachées), mois de l'exercice
historique as (
  select upper(h.categorie) as categorie, h.client, h.montant
  from public.prestation_historique h
  cross join params p
  where h.mois between p.debut and p.fin and upper(coalesce(h.categorie, '')) in ('PE', 'PI', 'IG')
),

-- 2. forfaits : lignes livrées de l'exercice (montants du Suivi d'affaire)
lignes as (
  select l.id, l.cle, l.parent_cle, l.genre, l.statut, l.imputation, l.date_livraison, l.disparue,
         regexp_replace(l.base_affaire, '^0+', '') as base,
         coalesce(mt.montant, 0) as montant,
         coalesce(mt.montant_echeances, 0) as montant_echeances
  from public.suivi_lignes l
  left join public.suivi_lignes_montants mt on mt.ligne_id = l.id
  where l.base_affaire is not null
),
familles_releve as (select distinct base from releve),
forfaits as (
  select l.base,
         case
           when l.genre in ('ECHEANCE', 'LOT') then case when l.montant_echeances <> 0 then l.montant_echeances else l.montant end
           else greatest(0, l.montant - coalesce((
             select sum(case when e.montant_echeances <> 0 then e.montant_echeances else e.montant end)
             from lignes e
             where e.parent_cle = l.cle and e.genre in ('ECHEANCE', 'LOT') and e.statut = 'Livrée' and not coalesce(e.disparue, false)
           ), 0))
         end as montant
  from lignes l
  cross join params p
  left join lignes b on b.base = l.base and b.genre = 'BASE'
  where l.statut = 'Livrée'
    and not coalesce(l.disparue, false)
    and l.date_livraison between p.debut and p.fin
    and l.genre in ('BASE', 'AVENANT', 'ECHEANCE', 'LOT')
    and coalesce(l.imputation, '') not in ('PE', 'PI')
    and coalesce(b.imputation, '') not in ('PE', 'PI')
    and l.base not in (select base from familles_releve)
)

select '1. PE / PI au relevé (mois clôturés)' as poste, r.categorie as detail,
       round(sum(r.montant)::numeric, 0) as tous_clients,
       round(sum(r.montant) filter (where coalesce(e.michelin, false))::numeric, 0) as michelin_hors_urg
from releve r left join est_michelin e on e.base = r.base
group by r.categorie

union all
select '1b. PE / PI / IG de l''historique (non rattachés)', h.categorie,
       round(sum(h.montant)::numeric, 0),
       round(sum(h.montant) filter (where upper(coalesce(h.client, '')) like '%MICHELIN%' and upper(coalesce(h.client, '')) not like '%URG%')::numeric, 0)
from historique h
group by h.categorie

union all
select '2. Forfaits livrés', 'MICHELIN hors URG',
       null,
       round(sum(f.montant)::numeric, 0)
from forfaits f join est_michelin e on e.base = f.base and e.michelin

order by 1, 2;
