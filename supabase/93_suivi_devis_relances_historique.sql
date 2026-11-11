-- =====================================================================
-- 93 - SUIVI DES DEVIS : HISTORIQUE DES RELANCES (RELANCES_HISTORIQUE)
--
-- À lancer APRÈS le 92. Relançable sans risque.
--
-- Chaque relance garde son histoire complète :
--   - prévue : le (prevue_le), pour qui (responsable_id), par qui
--     (saisi_par), avec une consigne (commentaire) ;
--   - faite  : le (relance_le), par qui (faite_par, NOUVEAU), avec la
--     réponse du client (reponse, NOUVEAU).
--
-- « Relance faite » vise désormais UNE relance précise (p_relance_id) :
-- si elle a déjà été notée faite ailleurs (Suivi des devis ou feuille de
-- route), la seconde tentative est refusée avec la date et l'auteur, au
-- lieu de créer un doublon. C'est le premier qui la note qui l'emporte.
-- =====================================================================

alter table public.suivi_devis_relances add column if not exists reponse text;
alter table public.suivi_devis_relances add column if not exists faite_par uuid references public.collaborateurs(id) on delete set null;

alter table public.suivi_devis_relances drop constraint if exists suivi_devis_relances_reponse_longueur;
alter table public.suivi_devis_relances add constraint suivi_devis_relances_reponse_longueur
  check (reponse is null or char_length(reponse) <= 1000);

-- reprise : pour les relances déjà faites, l'auteur est la personne désignée, à défaut celle qui l'a saisie
update public.suivi_devis_relances
   set faite_par = coalesce(responsable_id, saisi_par)
 where relance_le is not null and faite_par is null;

-- ---------------------------------------------------------------------
-- Noter une relance faite (remplace la version du 92 : nouveaux paramètres)
-- ---------------------------------------------------------------------
drop function if exists public.suivi_devis_noter_relance(text, date, text);

create or replace function public.suivi_devis_noter_relance(
  p_numero text,
  p_date date,
  p_reponse text default null,
  p_relance_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_numero text;
  v_moi uuid := public.polynov_mon_collaborateur_id();
  v_r public.suivi_devis_relances%rowtype;
  v_auteur text;
  v_id uuid;
begin
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

  -- la relance visée : celle donnée, sinon la relance prévue du devis (s'il y en a une)
  if p_relance_id is not null then
    select * into v_r from public.suivi_devis_relances r where r.id = p_relance_id;
    if not found then
      raise exception 'Cette relance n''existe plus (supprimée ?). Actualisez la page.';
    end if;
  else
    select * into v_r from public.suivi_devis_relances r where r.numero_devis = v_numero and r.relance_le is null;
  end if;

  -- déjà notée faite (ailleurs, ou par quelqu'un d'autre) : on le dit, sans doublon
  if v_r.id is not null and v_r.relance_le is not null then
    select coalesce(nullif(c.trigramme, ''), btrim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')))
      into v_auteur from public.collaborateurs c where c.id = v_r.faite_par;
    raise exception 'Cette relance a déjà été notée faite le %. Actualisez la page.',
      to_char(v_r.relance_le, 'DD/MM/YYYY') || coalesce(' par ' || v_auteur, '');
  end if;

  -- droits : responsables et administrateurs, ou la personne désignée pour cette relance
  if not public.polynov_peut_piloter() and not (v_r.id is not null and v_r.responsable_id = v_moi) then
    raise exception 'Seuls les responsables, les administrateurs, ou la personne désignée peuvent noter cette relance.';
  end if;

  if v_r.id is not null then
    update public.suivi_devis_relances r
       set relance_le = p_date,
           faite_par = v_moi,
           reponse = nullif(btrim(coalesce(p_reponse, '')), '')
     where r.id = v_r.id and r.relance_le is null
    returning r.id into v_id;
    if v_id is null then
      raise exception 'Cette relance vient d''être notée faite par quelqu''un d''autre. Actualisez la page.';
    end if;
  else
    -- relance faite sans avoir été prévue
    insert into public.suivi_devis_relances (numero_devis, relance_le, responsable_id, faite_par, reponse, saisi_par)
    values (v_numero, p_date, v_moi, v_moi, nullif(btrim(coalesce(p_reponse, '')), ''), v_moi)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.suivi_devis_noter_relance(text, date, text, uuid) from public, anon;
grant execute on function public.suivi_devis_noter_relance(text, date, text, uuid) to authenticated;

-- Contrôle
select count(*) filter (where relance_le is null) as relances_prevues,
       count(*) filter (where relance_le is not null) as relances_faites,
       count(*) filter (where reponse is not null) as avec_reponse
from public.suivi_devis_relances;
