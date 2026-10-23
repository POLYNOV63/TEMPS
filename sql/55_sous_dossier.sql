/* ================================================================
   55_sous_dossier.sql  -  Feuilles d'heures : sous-dossier de l'affaire
   (texte libre, facultatif) sur chaque ligne d'imputation.
   Peut être relancé sans risque.
   ================================================================ */

alter table public.feuilles_heures_imputations
  add column if not exists sous_dossier text;

comment on column public.feuilles_heures_imputations.sous_dossier is
  'Sous-dossier de l''affaire précisé par le collaborateur (texte libre, facultatif)';
