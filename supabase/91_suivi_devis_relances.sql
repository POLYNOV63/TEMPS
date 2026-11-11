-- =====================================================================
-- 91 - SUIVI DES DEVIS : RELANCES DES DEVIS ENVOYÉS (SUIVI_DEVIS)
--
-- Une ligne par relance notée dans l'application (page Suivi des devis).
-- L'historique est gardé : seule la plus récente compte pour savoir si
-- le devis est « à relancer » (envoyé ou relancé il y a plus de 30 jours).
--
-- La relance est rattachée au N° DE DEVIS (2715 pour DBE2715), pas à la
-- ligne du classeur : une synchronisation Excel ne la fait pas perdre.
--
-- Droits :
--   lecture             : ADMIN, RESPONSABLE, DIRECTION (polynov_peut_voir_pilotage)
--   noter une relance   : ADMIN, RESPONSABLE (polynov_peut_piloter)
--   supprimer           : son auteur, ou un ADMIN
-- Les écritures passent uniquement par les deux fonctions ci-dessous.
--
-- Relançable sans risque.
-- =====================================================================

create table if not exists public.suivi_devis_relances (
  id uuid primary key default gen_random_uuid(),
  numero_devis text not null check (numero_devis ~ '^[1-9][0-9]*$'),
  relance_le date not null,
  commentaire text check (commentaire is null or char_length(commentaire) <= 500),
  saisi_par uuid references public.collaborateurs(id) on delete set null,
  cree_le timestamptz not null default now()
);

create index if not exists suivi_devis_relances_numero_idx
  on public.suivi_devis_relances (numero_devis, relance_le desc);

alter table public.suivi_devis_relances enable row level security;

drop policy if exists polynov_suivi_devis_relances_select on public.suivi_devis_relances;
create policy polynov_suivi_devis_relances_select
  on public.suivi_devis_relances
  for select
  to authenticated
  using (public.polynov_peut_voir_pilotage());

-- aucune écriture directe : uniquement par les fonctions
revoke all on table public.suivi_devis_relances from anon;
revoke insert, update, delete on table public.suivi_devis_relances from authenticated;
grant select on table public.suivi_devis_relances to authenticated;

-- ---------------------------------------------------------------------
-- Noter une relance
-- ---------------------------------------------------------------------
create or replace function public.suivi_devis_noter_relance(
  p_numero text,
  p_date date,
  p_commentaire text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_numero text;
  v_id uuid;
begin
  if not public.polynov_peut_piloter() then
    raise exception 'Seuls les responsables et les administrateurs peuvent noter une relance.';
  end if;

  -- « DBE02715 », « 2715 » -> « 2715 »
  v_numero := ltrim(regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g'), '0');
  if v_numero = '' then
    raise exception 'N° de devis manquant ou mal formé.';
  end if;

  if p_date is null then
    raise exception 'Indiquez la date de la relance.';
  end if;
  if p_date > current_date then
    raise exception 'La date de relance ne peut pas être dans le futur.';
  end if;

  insert into public.suivi_devis_relances (numero_devis, relance_le, commentaire, saisi_par)
  values (v_numero, p_date, nullif(btrim(coalesce(p_commentaire, '')), ''), public.polynov_mon_collaborateur_id())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Supprimer une relance notée par erreur (son auteur, ou un ADMIN)
-- ---------------------------------------------------------------------
create or replace function public.suivi_devis_supprimer_relance(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_auteur uuid;
begin
  if not public.polynov_peut_piloter() then
    raise exception 'Seuls les responsables et les administrateurs peuvent supprimer une relance.';
  end if;

  select r.saisi_par into v_auteur from public.suivi_devis_relances r where r.id = p_id;
  if not found then
    raise exception 'Relance introuvable (déjà supprimée ?).';
  end if;

  if not (public.rh_est_admin() or v_auteur is not distinct from public.polynov_mon_collaborateur_id()) then
    raise exception 'Seul l''auteur de la relance, ou un administrateur, peut la supprimer.';
  end if;

  delete from public.suivi_devis_relances where id = p_id;
end;
$$;

revoke all on function public.suivi_devis_noter_relance(text, date, text) from public, anon;
revoke all on function public.suivi_devis_supprimer_relance(uuid) from public, anon;
grant execute on function public.suivi_devis_noter_relance(text, date, text) to authenticated;
grant execute on function public.suivi_devis_supprimer_relance(uuid) to authenticated;

-- Contrôle : affiche le nombre de relances enregistrées (0 au premier lancement)
select 'suivi_devis_relances' as table_prete, count(*) as relances from public.suivi_devis_relances;
