/* ================================================================
   65_fiche_commande_pepi.sql  -  PE / PI : réglages de vente portés par
   la COMMANDE (fiche commande du relevé des prestations).

   - releve_unite : vendue au jour ou à l'heure ;
   - releve_base_horaire : base d'une journée vendue (7 ou 7,5 h), qui
     convertit le « Total heures » du Suivi d'affaire en jours.
   Le montant et le total d'heures restent ceux du Suivi d'affaire (Excel
   fait foi) ; le taux de la commande = montant ÷ quantité.

   Reprise : les commandes déjà au relevé prennent l'unité et la base de
   leurs lignes (celles mises par l'import du Suivi des prestations).
   Peut être relancé sans risque.
   ================================================================ */

alter table public.pilotage_affaires add column if not exists releve_unite text;
alter table public.pilotage_affaires add column if not exists releve_base_horaire numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pilotage_affaires_releve_unite_chk') then
    alter table public.pilotage_affaires
      add constraint pilotage_affaires_releve_unite_chk check (releve_unite is null or releve_unite in ('JOUR', 'HEURE'));
  end if;
end $$;

update public.pilotage_affaires a
set releve_unite = l.unite,
    releve_base_horaire = l.base_horaire
from (
  select distinct on (affaire_id) affaire_id, unite, base_horaire
  from public.prestation_lignes
  order by affaire_id, id
) l
where l.affaire_id = a.id
  and a.releve_unite is null;

-- Contrôle : commandes reprises
select a.numero, a.releve_unite, a.releve_base_horaire
from public.pilotage_affaires a
where a.releve_unite is not null
order by a.numero;
