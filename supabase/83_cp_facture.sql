-- =====================================================================
-- 83 · « CP facturé quand même » : une case du relevé PE / PI qui porte
-- à la fois un code (CP…) et des heures est FACTURÉE (relevé, export,
-- clôture) mais N'EST PAS reportée au planning : la personne y reste
-- absente. Seule différence avec la version précédente de la fonction :
-- « and code is null » dans la lecture des heures du relevé.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.prestation_synchroniser_planning(p_ligne_id uuid, p_mois date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  l      record;
  a      record;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin   date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_aff  uuid;
  v_min  date;
  v_max  date;
  v_nb   integer;
begin
  if not public.rh_est_admin() then
    raise exception 'Action réservée aux responsables et aux administrateurs.';
  end if;

  select * into l from public.prestation_lignes where id = p_ligne_id;
  if not found then
    raise exception 'Ligne de prestation introuvable.';
  end if;

  select m.affectation_id into v_aff
  from public.prestation_mois m
  where m.ligne_id = p_ligne_id and m.mois = v_debut;

  if v_aff is not null and not exists (select 1 from public.pilotage_affectations f where f.id = v_aff) then
    v_aff := null;
  end if;

  -- Le relevé fait foi : on retire, sur ce mois, les autres affectations de la personne sur l'affaire
  delete from public.pilotage_affectations_jours j
  using public.pilotage_affectations f
  where j.affectation_id = f.id
    and f.affaire_id = l.affaire_id
    and f.collaborateur_id = l.collaborateur_id
    and f.id is distinct from v_aff
    and j.jour between v_debut and v_fin;

  for a in
    select f.id
    from public.pilotage_affectations f
    where f.affaire_id = l.affaire_id
      and f.collaborateur_id = l.collaborateur_id
      and f.id is distinct from v_aff
      and f.date_debut <= v_fin and f.date_fin >= v_debut
  loop
    select min(j.jour), max(j.jour), count(*) into v_min, v_max, v_nb
    from public.pilotage_affectations_jours j
    where j.affectation_id = a.id;

    if v_nb = 0 then
      delete from public.pilotage_affectations where id = a.id;
    else
      update public.pilotage_affectations set date_debut = v_min, date_fin = v_max where id = a.id;
    end if;
  end loop;

  -- Heures du relevé ce mois-ci (CP_FACTURE : une case avec un code n'est pas du travail)
  select min(s.jour), max(s.jour), count(*) into v_min, v_max, v_nb
  from public.prestation_saisies s
  where s.ligne_id = p_ligne_id
    and s.jour between v_debut and v_fin
    and coalesce(s.heures, 0) > 0
    and s.code is null;

  if v_nb > 0 then
    v_min := greatest(v_debut, date_trunc('week', v_min)::date);
    v_max := least(v_fin, (date_trunc('week', v_max) + interval '4 days')::date);
  end if;

  if v_nb = 0 then
    if v_aff is not null then
      delete from public.pilotage_affectations where id = v_aff;
    end if;
    v_aff := null;
  else
    if v_aff is null then
      insert into public.pilotage_affectations (affaire_id, activite_id, collaborateur_id, date_debut, date_fin, commentaire, created_by)
      values (l.affaire_id, l.activite_id, l.collaborateur_id, v_min, v_max, 'Relevé Prestations PE / PI', public.polynov_mon_collaborateur_id())
      returning id into v_aff;
    else
      update public.pilotage_affectations
      set activite_id = l.activite_id, date_debut = v_min, date_fin = v_max
      where id = v_aff;

      delete from public.pilotage_affectations_jours where affectation_id = v_aff;
    end if;

    insert into public.pilotage_affectations_jours (affectation_id, jour, heures)
    with s as (
      select x.jour, x.heures
      from public.prestation_saisies x
      where x.ligne_id = p_ligne_id
        and x.jour between v_debut and v_fin
        and coalesce(x.heures, 0) > 0
        and x.code is null
    ),
    semaines as (
      select date_trunc('week', s.jour)::date as lundi, sum(s.heures) as total, max(s.heures) as maxi
      from s
      group by 1
    ),
    ouvres as (
      select d::date as jour, date_trunc('week', d)::date as lundi
      from generate_series(v_debut, v_fin, interval '1 day') d
      where extract(isodow from d) between 1 and 5
    ),
    nb as (
      select o.lundi, count(*) as n from ouvres o group by o.lundi
    )
    select v_aff, r.jour, r.heures
    from (
      select s.jour, s.heures
      from s
      join semaines w on w.lundi = date_trunc('week', s.jour)::date
      where w.maxi <= 12
      union all
      select o.jour, least(round(w.total / nb.n, 2), 12)
      from semaines w
      join nb on nb.lundi = w.lundi
      join ouvres o on o.lundi = w.lundi
      where w.maxi > 12
    ) r
    where r.heures > 0;

    update public.pilotage_affectations f
    set date_debut = j.d1, date_fin = j.d2
    from (
      select min(jour) as d1, max(jour) as d2
      from public.pilotage_affectations_jours
      where affectation_id = v_aff
    ) j
    where f.id = v_aff;
  end if;

  if v_aff is not null then
    update public.pilotage_affaires set au_planning = true where id = l.affaire_id and not au_planning;
  end if;

  insert into public.prestation_mois (ligne_id, mois, affectation_id, reporte)
  values (
    p_ligne_id, v_debut, v_aff,
    coalesce((select a2.statut = 'EN_ATTENTE' from public.pilotage_affaires a2 where a2.id = l.affaire_id), false)
  )
  on conflict (ligne_id, mois) do update set affectation_id = excluded.affectation_id;

  update public.pilotage_affaires set echeance = echeance where id = l.affaire_id;

  return v_aff;
end;
$function$;
