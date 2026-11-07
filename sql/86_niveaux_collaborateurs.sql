-- =============================================================
-- 86 : NIVEAU DES COLLABORATEURS (NIVEAUX_COLLAB)
--
-- Un niveau par personne, saisi dans sa fiche (Paramétrage › Collaborateurs) :
--   1 = exécute sous supervision
--   2 = autonome sur une affaire courante
--   3 = expert ou référent (conçoit, pilote, valide)
-- Sert à la page « Disponibilités par activité », qui n'en montre que des
-- TOTAUX (jamais le niveau d'une personne).
--
-- Droits : l'ADMIN lit et modifie ; la Direction lit (pour les totaux) ;
-- responsables et collaborateurs n'y ont pas accès.
-- Relançable sans risque.
-- =============================================================

create table if not exists public.collaborateurs_niveaux (
  collaborateur_id uuid primary key references public.collaborateurs(id) on delete cascade,
  niveau smallint not null check (niveau between 1 and 3),
  maj_le timestamptz not null default now()
);

alter table public.collaborateurs_niveaux enable row level security;

drop policy if exists niveaux_gestion on public.collaborateurs_niveaux;
create policy niveaux_gestion on public.collaborateurs_niveaux
  for all to authenticated
  using (public.rh_est_admin())
  with check (public.rh_est_admin());

drop policy if exists niveaux_lecture_direction on public.collaborateurs_niveaux;
create policy niveaux_lecture_direction on public.collaborateurs_niveaux
  for select to authenticated
  using (public.polynov_est_direction());

grant select, insert, update, delete on public.collaborateurs_niveaux to authenticated;
