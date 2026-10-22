/* ================================================================
   54_regularisation_sans_plafond.sql  -  L'ajustement du compteur de
   récupération (rh_regulariser_compteur) refusait de dépasser +30 h.
   Comme les feuilles et les droits RH : seule la limite basse de -30 h
   reste. Peut être relancé sans risque.
   ================================================================ */

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.rh_regulariser_compteur(uuid, numeric, text)'::regprocedure) into v_def;
  if position('v_apres > 30' in v_def) = 0 then
    raise notice 'Déjà à jour.';
    return;
  end if;
  v_def := replace(v_def, 'if v_apres < -30 or v_apres > 30 then', 'if v_apres < -30 then');
  v_def := replace(v_def, 'il doit rester entre -30 h et +30 h.', 'il ne peut pas descendre sous -30 h.');
  execute v_def;
end $$;

/* VERIFICATION - à lancer seule : doit répondre « No rows returned »
   select p.proname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~* 'compteur'
     and pg_get_functiondef(p.oid) ~ '(>|<=?)\s*30\b';
*/
