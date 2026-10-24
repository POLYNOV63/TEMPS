/* ================================================================
   62_message_delai.sql  -  Les messages de la base parlent de « délai »
   et non plus d'« échéance » : « Utilisez « Modifier le délai » : un
   motif est obligatoire. »
   Peut être relancé sans risque.
   ================================================================ */

do $$
declare
  r record;
  v text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc like '%Modifier l''''échéance%'
  loop
    v := pg_get_functiondef(r.oid);
    v := replace(v, 'Modifier l''''échéance', 'Modifier le délai');
    execute v;
  end loop;
end $$;
