-- =====================================================================
-- 98 - RELEVÉ PE / PI OUVERT SELON LES DROITS D'ACCÈS (RELEVE_DROITS)
--
-- À lancer APRÈS le 97. Relançable sans risque.
--
-- Jusqu'ici, la base réservait le relevé PE / PI aux administrateurs
-- (lignes, mois, saisies, recopie au planning) : un responsable à qui
-- l'on ouvrait la page la voyait VIDE, tout « à staffer ».
-- Désormais, la base suit la fonction « Relevé PE / PI » de la page
-- Paramétrage › Droits d'accès :
--   - ADMIN : toujours ;
--   - autre rôle : la case de ce rôle si elle a été modifiée, sinon le
--     réglage d'origine (RESPONSABLE oui, COLLABORATEUR non) ;
--   - DIRECTION : lecture seule, comme avant (sauf si on lui coche la
--     fonction : elle pourra alors aussi saisir).
-- =====================================================================

create or replace function public.polynov_peut_releve()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select case
             when upper(coalesce(c.role, '')) = 'ADMIN' then true
             else coalesce(
               (select r.autorise from public.polynov_droits_roles r
                 where r.cle = 'droit:relevePrestations' and r.role = upper(coalesce(c.role, ''))),
               upper(coalesce(c.role, '')) = 'RESPONSABLE')
           end
      from public.collaborateurs c
     where c.auth_user_id = auth.uid() and coalesce(c.actif, true)
     limit 1), false);
$$;

revoke all on function public.polynov_peut_releve() from public, anon;
grant execute on function public.polynov_peut_releve() to authenticated;

-- Les tables du relevé : lecture et écriture pour qui a la fonction
drop policy if exists prestation_lignes_lecture on public.prestation_lignes;
create policy prestation_lignes_lecture on public.prestation_lignes for select to authenticated
  using (public.rh_est_admin() or public.polynov_peut_releve());
drop policy if exists prestation_lignes_ecriture on public.prestation_lignes;
create policy prestation_lignes_ecriture on public.prestation_lignes for all to authenticated
  using (public.rh_est_admin() or public.polynov_peut_releve())
  with check (public.rh_est_admin() or public.polynov_peut_releve());

drop policy if exists prestation_mois_lecture on public.prestation_mois;
create policy prestation_mois_lecture on public.prestation_mois for select to authenticated
  using (public.rh_est_admin() or public.polynov_peut_releve());
drop policy if exists prestation_mois_ecriture on public.prestation_mois;
create policy prestation_mois_ecriture on public.prestation_mois for all to authenticated
  using (public.rh_est_admin() or public.polynov_peut_releve())
  with check (public.rh_est_admin() or public.polynov_peut_releve());

drop policy if exists prestation_saisies_lecture on public.prestation_saisies;
create policy prestation_saisies_lecture on public.prestation_saisies for select to authenticated
  using (public.rh_est_admin() or public.polynov_peut_releve());
drop policy if exists prestation_saisies_ecriture on public.prestation_saisies;
create policy prestation_saisies_ecriture on public.prestation_saisies for all to authenticated
  using (public.rh_est_admin() or public.polynov_peut_releve())
  with check (public.rh_est_admin() or public.polynov_peut_releve());

-- Les fonctions du relevé (recopie au planning, heures des feuilles, montants prévus,
-- contrôle des affectations PE / PI) : même règle. Leur texte est repris tel quel,
-- seul le contrôle « administrateur » est élargi.
do $$
declare
  f record;
  def text;
  n int := 0;
begin
  for f in
    select p.oid
      from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public'
       and p.proname in ('prestation_synchroniser_planning', 'prestation_realise_jours', 'prestation_montants_prevus', 'pilotage_affectation_prestation_controle')
  loop
    def := pg_get_functiondef(f.oid);
    if position('polynov_peut_releve' in def) = 0 and position('public.rh_est_admin()' in def) > 0 then
      def := replace(def, 'public.rh_est_admin()', '(public.rh_est_admin() or public.polynov_peut_releve())');
      execute def;
      n := n + 1;
    end if;
  end loop;
  raise notice '% fonction(s) du relevé ouvertes selon les droits', n;
end $$;

-- Contrôle : vous (ADMIN) devez voir « true »
select public.polynov_peut_releve() as moi_releve,
       (select count(*) from pg_proc where proname in ('prestation_synchroniser_planning', 'prestation_realise_jours', 'prestation_montants_prevus', 'pilotage_affectation_prestation_controle')
          and position('polynov_peut_releve' in pg_get_functiondef(oid)) > 0) as fonctions_ouvertes;
