-- =====================================================================
-- 102 · Simulateur de rentabilité : plafonds marché des deux taux de vente
-- (taux Calcul et taux « autres »). Au-delà du plafond, la console écrête le CA (voyant CLIP).
-- À lancer APRÈS le 101. Relançable sans risque. Les droits (RLS) du 101 s'appliquent.
-- =====================================================================

alter table public.simulateur_parametres add column if not exists plafond_taux_calcul numeric(8, 2);  -- €/h
alter table public.simulateur_parametres add column if not exists plafond_taux_autres numeric(8, 2);  -- €/h

-- Contrôle : les deux colonnes existent
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'simulateur_parametres' and column_name like 'plafond_taux_%'
order by column_name;
