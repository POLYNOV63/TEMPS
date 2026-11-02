-- =====================================================================
-- 77 · Relevé PE / PI : activité des lignes qui n'en ont pas
-- Une ligne du relevé sans activité tombe dans « Sans activité » au total
-- du mois (et au planning). On lui donne l'activité PRINCIPALE de la
-- personne (fiche Collaborateurs). Les lignes qui ont déjà une activité ne
-- changent pas.
-- =====================================================================

-- Avant : les lignes concernées
select a.numero, c.trigramme, act.nom as activite_proposee
from prestation_lignes l
join pilotage_affaires a on a.id = l.affaire_id
join collaborateurs c on c.id = l.collaborateur_id
left join collaborateurs_predominances p on p.collaborateur_id = l.collaborateur_id and p.niveau = 'PRINCIPALE'
left join activites act on act.id = p.activite_id
where l.activite_id is null and l.actif
order by a.numero;

-- La correction
update prestation_lignes l
set activite_id = p.activite_id
from collaborateurs_predominances p
where l.activite_id is null
  and p.collaborateur_id = l.collaborateur_id
  and p.niveau = 'PRINCIPALE';
