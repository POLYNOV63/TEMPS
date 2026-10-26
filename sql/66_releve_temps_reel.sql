/* ================================================================
   66_releve_temps_reel.sql  -  Relevé PE / PI en temps réel : l'écran
   est prévenu quand un collègue enregistre une case ou clôture un mois
   (bandeau « ↻ Actualiser »), comme le Planning des affaires.
   Peut être relancé sans risque.
   ================================================================ */
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prestation_saisies') then
    alter publication supabase_realtime add table public.prestation_saisies;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prestation_mois') then
    alter publication supabase_realtime add table public.prestation_mois;
  end if;
end $$;

select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'prestation%';
