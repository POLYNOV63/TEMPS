-- =====================================================================
-- 96 - FEUILLE SIMPLIFIÉE (FEUILLE_SIMPLIFIEE)
--
-- Relançable sans risque.
--
-- Pour les personnes qui ne pointent jamais sur une affaire ni un devis
-- (ex. l'assistante administrative) : leur feuille de la semaine ne
-- demande que la présence, les absences et les tickets restaurant.
-- Se coche dans la fiche collaborateur (Paramétrage › Collaborateurs).
-- Leurs feuilles sont enregistrées avec 0 h saisie pour 0 h attendue :
-- la validation (valider_feuille_heures) les accepte telles quelles.
-- =====================================================================

alter table public.collaborateurs add column if not exists saisie_simplifiee boolean not null default false;

comment on column public.collaborateurs.saisie_simplifiee is
  'Feuille simplifiée : présence, absences et tickets restaurant seulement, sans imputation d''heures sur les affaires.';

-- Contrôle
select count(*) filter (where saisie_simplifiee) as feuilles_simplifiees from public.collaborateurs;
