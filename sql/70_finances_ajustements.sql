/* ================================================================
   70_finances_ajustements.sql  -  Finances : ajustements manuels du CA
   Un montant ajouté (ou retiré, s'il est négatif) au réalisé d'un mois,
   avec son motif, quand un écart avec la comptabilité reste inexpliqué.
   Il apparaît dans Finances sous l'imputation « Ajustement », visible dans
   le détail du mois.
   Peut être relancé sans risque (les deux ajustements ne sont pas doublés).
   ================================================================ */

create table if not exists public.finances_ajustements (
  id uuid primary key default gen_random_uuid(),
  mois date not null,
  montant numeric not null,
  motif text not null,
  created_at timestamptz not null default now()
);

alter table public.finances_ajustements enable row level security;

drop policy if exists finances_ajustements_lecture on public.finances_ajustements;
create policy finances_ajustements_lecture on public.finances_ajustements
  for select to authenticated using (
    public.rh_est_admin()
    or exists (
      select 1 from public.collaborateurs c
      where c.auth_user_id = auth.uid() and upper(coalesce(c.role, '')) = 'DIRECTION' and coalesce(c.actif, true)
    )
  );

drop policy if exists finances_ajustements_gestion on public.finances_ajustements;
create policy finances_ajustements_gestion on public.finances_ajustements
  for all to authenticated using (public.rh_est_admin()) with check (public.rh_est_admin());

-- Exercice 2024-2025 : écarts avec la comptabilité, d'origine non identifiée
insert into public.finances_ajustements (mois, montant, motif)
select v.mois, v.montant, v.motif
from (values
  (date '2024-11-01', 5000::numeric, 'Écart avec la comptabilité (origine non identifiée)'),
  (date '2025-01-01', 4000::numeric, 'Écart avec la comptabilité (origine non identifiée)')
) as v(mois, montant, motif)
where not exists (select 1 from public.finances_ajustements a where a.mois = v.mois and a.motif = v.motif);

select mois, montant, motif from public.finances_ajustements order by mois;
