-- =====================================================================
-- 108 · Stagiaires : une fiche collaborateur pour le planning seulement
-- Un stagiaire apparaît au planning (Planning des affaires, Ressources) comme
-- tout collaborateur actif, mais n'a ni compte, ni feuilles d'heures, ni relance,
-- ni droits RH, et reste hors statistiques et hors capacité de l'équipe
-- (inclus_statistiques = false). Son e-mail est facultatif.
-- Relançable sans risque.
-- =====================================================================

alter table public.collaborateurs add column if not exists stagiaire boolean not null default false;

-- un stagiaire n'a pas forcément d'adresse (pas de compte Microsoft) ; sans effet si c'est déjà permis
alter table public.collaborateurs alter column email drop not null;

-- Contrôle : la colonne existe, et combien de stagiaires
select count(*) filter (where stagiaire) as stagiaires, count(*) as collaborateurs from public.collaborateurs;
