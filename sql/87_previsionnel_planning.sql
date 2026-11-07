-- =============================================================
-- 87 : PRÉVISIONNEL DANS LE PLANNING (PREVISIONNEL_PLANNING)
--
-- Une affectation hors affaire peut être marquée « prévisionnelle » :
-- charge probable mais pas encore confirmée (prolongation de PE sans
-- commande, affaire attendue…). Elle compte dans la charge, mais le
-- planning et les disponibilités la montrent à part.
-- Relançable sans risque. À passer AVANT de mettre en ligne le code.
-- =============================================================

alter table public.pilotage_affectations
  add column if not exists previsionnel boolean not null default false;

comment on column public.pilotage_affectations.previsionnel is
  'Charge probable, non confirmée (bloc « Prévisionnel » du planning des affaires)';
