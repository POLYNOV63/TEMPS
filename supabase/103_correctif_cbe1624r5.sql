-- =====================================================================
-- 103 - CORRECTIF PONCTUEL : la commande CBE1624R5 au relevé PE (18/11/2026)
--
-- La R5 manquait au Suivi d'affaire BE : à l'import du Suivi des
-- prestations, ses mois (mars à juin 2026, 413 h, 22 302 €) sont partis
-- dans l'historique, à part. La R5 est maintenant au Suivi d'affaire ;
-- ce script fait ce que ferait le ré-import de ces 4 mois, pour elle seule :
--   1. la ligne du relevé de la R5 (même personne, unité, taux, base et
--      activité que la R4) ;
--   2. ses mois, VALIDÉS, heures et montant repris de l'historique ;
--   3. ces lignes retirées de l'historique (pas de double compte).
-- Les autres commandes ne sont pas touchées. Relançable sans risque :
-- s'il n'y a plus rien dans l'historique, il ne fait rien.
-- =====================================================================

do $$
declare
  v_r5 uuid;
  v_ligne_r4 public.prestation_lignes%rowtype;
  v_ligne uuid;
  v_nb integer;
begin
  select id into v_r5 from public.pilotage_affaires where type = 'CBE' and numero = '1624R5';
  if v_r5 is null then
    raise exception 'La commande 1624R5 n''existe pas encore au Pilotage : synchronisez le Suivi d''affaire puis relancez ce script.';
  end if;

  select count(*) into v_nb from public.prestation_historique where numero = '1624R5' and upper(type) = 'CBE' and upper(categorie) = 'PE';
  if v_nb = 0 then
    raise notice 'Rien à faire : plus de ligne 1624R5 dans l''historique.';
    return;
  end if;

  -- 1. la ligne du relevé, sur le modèle de la R4
  select l.* into v_ligne_r4
    from public.prestation_lignes l
    join public.pilotage_affaires a on a.id = l.affaire_id
   where a.type = 'CBE' and a.numero = '1624R4'
   limit 1;
  if v_ligne_r4.id is null then
    raise exception 'Ligne du relevé de la 1624R4 introuvable (modèle pour la R5).';
  end if;

  insert into public.prestation_lignes (affaire_id, collaborateur_id, unite, taux, base_horaire, activite_id, intergroupe, actif)
  values (v_r5, v_ligne_r4.collaborateur_id, v_ligne_r4.unite, v_ligne_r4.taux, v_ligne_r4.base_horaire, v_ligne_r4.activite_id, v_ligne_r4.intergroupe, true)
  on conflict (affaire_id, collaborateur_id) do update set actif = true
  returning id into v_ligne;

  -- 2. ses mois, validés, depuis l'historique
  insert into public.prestation_mois (ligne_id, mois, hs_refacturer, montant_import, reporte, report_sortant, valide, valide_le, heures_fige, montant_fige)
  select v_ligne, h.mois, 0, sum(h.montant), false, null, true, now(), round(sum(h.heures)::numeric, 2), round(sum(h.montant)::numeric, 2)
    from public.prestation_historique h
   where h.numero = '1624R5' and upper(h.type) = 'CBE' and upper(h.categorie) = 'PE'
   group by h.mois
  on conflict (ligne_id, mois) do update
    set valide = true, valide_le = now(), heures_fige = excluded.heures_fige, montant_fige = excluded.montant_fige, montant_import = excluded.montant_import;

  -- 3. plus dans l'historique
  delete from public.prestation_historique where numero = '1624R5' and upper(type) = 'CBE' and upper(categorie) = 'PE';

  raise notice 'CBE1624R5 : % ligne(s) d''historique passées au relevé.', v_nb;
end $$;

-- contrôle : les mois de la R5 au relevé
select a.numero, m.mois, m.valide, m.heures_fige, m.montant_fige
  from public.prestation_mois m
  join public.prestation_lignes l on l.id = m.ligne_id
  join public.pilotage_affaires a on a.id = l.affaire_id
 where a.type = 'CBE' and a.numero = '1624R5'
 order by m.mois;
