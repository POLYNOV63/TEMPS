-- =====================================================================
-- 90 - CONTRATS CADRES DES PRESTATIONS PE / PI (STAFFAGE_CONTRATS)
--
-- Un contrat cadre s'applique aux PE / PI d'un client dont le nom
-- CONTIENT le mot indiqué (MICHELIN, quel que soit le préfixe ou le
-- suffixe). Il donne :
--   - une base hebdomadaire (37,5 h) ;
--   - le rythme journalier du lundi au vendredi, pour les PE et pour les
--     PI (PE : 7,5 / 7,5 / 7,5 / 7,5 / 7,5 ; PI : 8 / 8 / 8 / 8 / 5,5) ;
--   - des tarifs nommés (Etude, Mise en plan, Faisabilité, AMO, Calcul),
--     chacun en € par heure, par jour ou par semaine de la base.
-- Lecture : tout utilisateur connecté. Modification : ADMIN et RESPONSABLE.
-- Relançable sans risque.
-- =====================================================================

create table if not exists public.prestation_contrats (
  id uuid primary key default gen_random_uuid(),
  client_motif text not null,
  libelle text not null default 'Contrat cadre',
  base_hebdo numeric not null default 37.5,
  rythme_pe numeric[] not null default '{7.5,7.5,7.5,7.5,7.5}',
  rythme_pi numeric[] not null default '{8,8,8,8,5.5}',
  tarifs jsonb not null default '[]'::jsonb,
  actif boolean not null default true,
  modifie_le timestamptz not null default now()
);

alter table public.prestation_contrats enable row level security;

drop policy if exists prestation_contrats_lecture on public.prestation_contrats;
create policy prestation_contrats_lecture on public.prestation_contrats
  for select to authenticated using (true);

drop policy if exists prestation_contrats_ecriture on public.prestation_contrats;
create policy prestation_contrats_ecriture on public.prestation_contrats
  for all to authenticated
  using (exists (select 1 from public.collaborateurs c where c.auth_user_id = auth.uid() and upper(c.role) in ('ADMIN', 'RESPONSABLE')))
  with check (exists (select 1 from public.collaborateurs c where c.auth_user_id = auth.uid() and upper(c.role) in ('ADMIN', 'RESPONSABLE')));

-- le contrat MICHELIN, tarifs à saisir dans le relevé (bouton « Contrats cadres »)
insert into public.prestation_contrats (client_motif, libelle, tarifs)
select 'MICHELIN', 'Contrat cadre MICHELIN',
  '[{"nom":"Etude","montant":null,"unite":"SEMAINE"},{"nom":"Mise en plan","montant":null,"unite":"SEMAINE"},{"nom":"Faisabilité","montant":null,"unite":"SEMAINE"},{"nom":"AMO","montant":null,"unite":"SEMAINE"},{"nom":"Calcul","montant":null,"unite":"SEMAINE"}]'::jsonb
where not exists (select 1 from public.prestation_contrats where upper(client_motif) = 'MICHELIN');

select client_motif, libelle, base_hebdo, rythme_pe, rythme_pi, jsonb_array_length(tarifs) as nb_tarifs from public.prestation_contrats;
