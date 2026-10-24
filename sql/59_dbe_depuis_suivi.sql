/* ================================================================
   59_dbe_depuis_suivi.sql  -  Les DBE viennent du Suivi d'affaire BE.

   À chaque synchronisation du classeur :
   - un devis « Devis ouvert » crée (s'il n'existe pas) son DBE dans le
     Pilotage, en cours, au planning :
       · responsable = le RÉDACTEUR du devis (colonne « Rédacteur devis ») ;
       · début = date d'ouverture du devis ;
       · date de remise = colonne « Délai » si elle est remplie, sinon
         ouverture + 10 jours ouvrés ;
   - un devis envoyé (ou devenu commande) passe le DBE en « Livrée »
     (= devis remis), à la date d'envoi ; un devis perdu jamais envoyé
     passe en « Abandonnée ».
   Le responsable et la date de remise ne sont jamais écrasés ensuite :
   ce que vous changez dans l'application est gardé.
   Les devis déjà envoyés ou perdus ne créent PAS de DBE (pas d'historique).
   Peut être relancé sans risque.
   ================================================================ */

begin;

create or replace function public.zz_pilotage_dbe_suivi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  elsif v_statut = 'EN_COURS' then
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
$$;

drop trigger if exists zz_pilotage_dbe_suivi on public.suivi_lignes;
create trigger zz_pilotage_dbe_suivi
  after insert or update on public.suivi_lignes
  for each row execute function public.zz_pilotage_dbe_suivi();

-- les devis ouverts déjà présents dans la copie du classeur : créés tout de suite
update public.suivi_lignes set statut = statut
 where genre = 'DEVIS' and statut = 'Devis ouvert' and not disparue;

commit;

/* VERIFICATION - à lancer seule : les DBE créés, avec leur rédacteur et leur date de remise
   select a.numero, a.designation, c.trigramme as redacteur, a.date_debut, a.echeance as remise, a.statut
   from public.pilotage_affaires a left join public.collaborateurs c on c.id = a.responsable_id
   where a.type = 'DBE' order by a.echeance;
*/
