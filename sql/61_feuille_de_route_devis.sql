/* ================================================================
   61_feuille_de_route_devis.sql  -  Feuille de route : les DEVIS à
   rédiger (DBE en cours dont la personne est responsable), avec leur
   date de rendu. Un DBE quitte la liste quand le devis est envoyé
   (le Suivi d'affaire le passe en « Livrée », SQL 59).
   Peut être relancé sans risque.
   ================================================================ */

create or replace function public.ma_feuille_de_route_devis(p_collaborateur_id uuid)
returns table (affaire_id uuid, numero text, designation text, date_debut date, echeance date)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_moi uuid := public.polynov_mon_collaborateur_id();
  v_cible uuid;
begin
  v_cible := coalesce(p_collaborateur_id, v_moi);
  if v_cible is distinct from v_moi
     and not (public.rh_est_admin() or public.polynov_peut_voir_pilotage()) then
    v_cible := v_moi;
  end if;

  return query
    select a.id, a.numero::text, a.designation::text, a.date_debut, a.echeance
    from public.pilotage_affaires a
    where a.type = 'DBE'
      and a.statut = 'EN_COURS'
      and a.responsable_id = v_cible
    order by a.echeance nulls last, a.numero;
end;
$$;

revoke all on function public.ma_feuille_de_route_devis(uuid) from public, anon;
grant execute on function public.ma_feuille_de_route_devis(uuid) to authenticated;
