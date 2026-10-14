-- =====================================================================
-- POLYNOV-TEMPS - Script 17 : ajustement FORCE du compteur de récupération
--
-- Prérequis : script 03 (fonction rh_est_admin) déjà exécuté.
-- Script ENTIER dans une transaction, relançable sans risque.
--
-- Principe
--   Le compteur se construit de feuille en feuille : compteur après =
--   compteur avant - récupérations prises + part des heures sup affectée au
--   compteur à la clôture mensuelle. Le « compteur initial » des Droits RH
--   n'ouvre que la toute première feuille.
--   Pour corriger ou accorder des heures « de force », un administrateur
--   enregistre un AJUSTEMENT daté, motivé et tracé :
--     * il s'ajoute à la dernière feuille validée de la personne (le point de
--       départ des semaines suivantes change) ;
--     * s'il n'existe encore aucune feuille validée, il modifie le compteur
--       initial des Droits RH de l'exercice en cours ;
--     * les brouillons postérieurs sont décalés du même montant ;
--     * le compteur doit rester entre -30 h et +30 h.
--   L'ajustement est mémorisé sur la feuille (colonne compteur_regularisation)
--   pour ne pas être perdu si une feuille antérieure est revalidée.
--
-- Contenu
--   * colonne  feuilles_heures.compteur_regularisation
--   * table    rh_compteur_regularisations (historique, lecture ADMIN)
--   * fonction rh_regulariser_compteur(collaborateur, heures, motif)
-- =====================================================================

begin;

alter table public.feuilles_heures
  add column if not exists compteur_regularisation numeric not null default 0;

comment on column public.feuilles_heures.compteur_regularisation is
  'Total des ajustements forcés du compteur de récupération portés par cette feuille (heures, signées).';

create table if not exists public.rh_compteur_regularisations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  collaborateur_id uuid not null references public.collaborateurs(id) on delete cascade,
  feuille_id       uuid,
  heures           numeric not null,
  compteur_avant   numeric not null,
  compteur_apres   numeric not null,
  motif            text not null,
  created_by       uuid
);

create index if not exists rh_compteur_regularisations_collab_idx
  on public.rh_compteur_regularisations (collaborateur_id, created_at desc);

alter table public.rh_compteur_regularisations enable row level security;

drop policy if exists rh_compteur_regularisations_lecture_admin on public.rh_compteur_regularisations;
create policy rh_compteur_regularisations_lecture_admin
  on public.rh_compteur_regularisations
  for select
  to authenticated
  using (public.rh_est_admin());

revoke all on public.rh_compteur_regularisations from anon, authenticated;
grant select on public.rh_compteur_regularisations to authenticated;

comment on table public.rh_compteur_regularisations is
  'Historique des ajustements forcés du compteur de récupération (écriture uniquement par rh_regulariser_compteur).';

create or replace function public.rh_regulariser_compteur(
  p_collaborateur_id uuid,
  p_heures numeric,
  p_motif text
)
returns table (avant_h numeric, apres_h numeric, semaine_ajustee date)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_motif     text := btrim(coalesce(p_motif, ''));
  v_ancre     record;
  v_avant     numeric;
  v_apres     numeric;
  v_exercice  integer;
  v_createur  uuid;
  v_semaine   date;
  v_feuille   uuid;
begin
  if not public.rh_est_admin() then
    raise exception 'Action réservée aux administrateurs.';
  end if;

  if p_heures is null or p_heures = 0 then
    raise exception 'Indiquez un nombre d''heures différent de 0.';
  end if;

  if char_length(v_motif) < 3 then
    raise exception 'Le motif est obligatoire.';
  end if;

  if not exists (select 1 from public.collaborateurs c where c.id = p_collaborateur_id) then
    raise exception 'Collaborateur introuvable.';
  end if;

  select c.id into v_createur
  from public.collaborateurs c
  where c.auth_user_id = auth.uid();

  select f.id, f.semaine_debut, f.compteur_apres
    into v_ancre
  from public.feuilles_heures f
  where f.collaborateur_id = p_collaborateur_id
    and f.statut = 'A_TRAITER'
  order by f.semaine_debut desc
  limit 1
  for update;

  if found and v_ancre.compteur_apres is not null then
    -- Cas général : on ajuste la dernière feuille validée
    v_avant := v_ancre.compteur_apres;
    v_apres := v_avant + p_heures;

    if v_apres < -30 or v_apres > 30 then
      raise exception 'Le compteur serait de % h : il doit rester entre -30 h et +30 h.', round(v_apres, 2);
    end if;

    update public.feuilles_heures
    set compteur_apres = v_apres,
        compteur_regularisation = coalesce(compteur_regularisation, 0) + p_heures
    where id = v_ancre.id;

    v_semaine := v_ancre.semaine_debut;
    v_feuille := v_ancre.id;

    -- Les brouillons postérieurs repartent du nouveau compteur
    update public.feuilles_heures
    set compteur_avant = coalesce(compteur_avant, 0) + p_heures,
        compteur_apres = coalesce(compteur_apres, 0) + p_heures
    where collaborateur_id = p_collaborateur_id
      and statut is distinct from 'A_TRAITER'
      and semaine_debut > v_ancre.semaine_debut;
  else
    -- Aucune feuille validée : on ajuste le compteur initial de l'exercice en cours
    v_exercice := case
      when extract(month from current_date) >= 11 then extract(year from current_date)::integer
      else extract(year from current_date)::integer - 1
    end;

    select coalesce(d.compteur_recuperation_initial, 0)
      into v_avant
    from public.rh_droits d
    where d.collaborateur_id = p_collaborateur_id
      and d.exercice::text = v_exercice::text
    for update;

    if not found then
      raise exception 'Cette personne n''a encore aucune feuille validée ni Droits RH pour l''exercice % : renseignez d''abord ses Droits RH (page Collaborateurs).', v_exercice;
    end if;

    v_apres := v_avant + p_heures;

    if v_apres < -30 or v_apres > 30 then
      raise exception 'Le compteur serait de % h : il doit rester entre -30 h et +30 h.', round(v_apres, 2);
    end if;

    update public.rh_droits
    set compteur_recuperation_initial = v_apres
    where collaborateur_id = p_collaborateur_id
      and exercice::text = v_exercice::text;

    update public.feuilles_heures
    set compteur_avant = coalesce(compteur_avant, 0) + p_heures,
        compteur_apres = coalesce(compteur_apres, 0) + p_heures
    where collaborateur_id = p_collaborateur_id
      and statut is distinct from 'A_TRAITER';
  end if;

  insert into public.rh_compteur_regularisations
    (collaborateur_id, feuille_id, heures, compteur_avant, compteur_apres, motif, created_by)
  values
    (p_collaborateur_id, v_feuille, p_heures, v_avant, v_apres, v_motif, v_createur);

  return query select v_avant, v_apres, v_semaine;
end;
$function$;

revoke all on function public.rh_regulariser_compteur(uuid, numeric, text) from public, anon;
grant execute on function public.rh_regulariser_compteur(uuid, numeric, text) to authenticated;

commit;

-- Contrôle : la colonne, la table et la fonction doivent exister
select 'colonne feuilles_heures.compteur_regularisation' as element,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'feuilles_heures'
                 and column_name = 'compteur_regularisation') as present
union all
select 'table rh_compteur_regularisations',
       to_regclass('public.rh_compteur_regularisations') is not null
union all
select 'fonction rh_regulariser_compteur',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'rh_regulariser_compteur');
