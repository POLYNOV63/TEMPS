/* ================================================================
   69_dbe_historique.sql  -  Synchronisation élargie aux devis ouverts
   depuis le 01/11/2023.

   Avant d'élargir la synchronisation, on empêche la création d'un DBE au
   Pilotage pour un vieux devis resté « Devis ouvert » dans le classeur
   (ouvert avant le 01/11/2024) : ce serait de l'historique, pas un devis
   à rédiger. Un DBE déjà au Pilotage continue d'être mis à jour.
   Peut être relancé sans risque.
   ================================================================ */

create or replace function public.zz_pilotage_dbe_suivi()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_statut text;
  v_resp uuid;
  v_debut date;
  v_remise date;
begin
  if new.base_devis is null or new.genre not in ('DEVIS', 'BASE') or coalesce(new.disparue, false) then
    return new;
  end if;

  v_statut := case
    when new.genre = 'DEVIS' and new.statut = 'Devis ouvert' then 'EN_COURS'
    when new.statut = 'Devis perdu' and new.date_envoi is null then 'ABANDONNEE'
    else 'LIVREE'  -- devis envoyé, perdu après envoi, ou devenu commande : le devis a été remis
  end;

  if exists (select 1 from public.pilotage_affaires where type = 'DBE' and numero = new.base_devis) then
    update public.pilotage_affaires
       set statut = v_statut,
           designation = coalesce(new.designation, designation),
           date_livraison = case when v_statut = 'LIVREE' then coalesce(new.date_envoi, date_livraison, current_date) else null end
     where type = 'DBE' and numero = new.base_devis
       and (statut is distinct from v_statut or designation is distinct from coalesce(new.designation, designation));
  -- DBE_HISTORIQUE : pas de nouveau DBE pour un devis ouvert avant le 01/11/2024 (historique)
  elsif v_statut = 'EN_COURS' and coalesce(new.date_ouverture, current_date) >= date '2024-11-01' then
    v_resp := coalesce(
      new.redacteur_id,
      (select c.id from public.collaborateurs c where upper(coalesce(c.role, '')) = 'ADMIN' and c.actif order by c.nom limit 1)
    );
    v_debut := coalesce(new.date_ouverture, current_date);
    v_remise := coalesce(
      new.delai,
      (select d::date from generate_series(v_debut + 1, v_debut + 30, interval '1 day') d
        where extract(isodow from d) < 6 order by d offset 9 limit 1)
    );
    if v_resp is not null then
      insert into public.pilotage_affaires (type, numero, designation, responsable_id, statut, echeance, echeance_initiale, date_debut, au_planning)
      values ('DBE', new.base_devis, coalesce(new.designation, 'Devis ' || coalesce(new.numero_devis, new.base_devis)), v_resp, 'EN_COURS', v_remise, v_remise, v_debut, true)
      on conflict (type, numero) do nothing;
    end if;
  end if;

  return new;
end;
$function$;
