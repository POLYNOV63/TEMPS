/* ================================================================
   57_rappel_vendredi.sql  -  Rappel automatique du vendredi :
   chaque vendredi à 13 h (heure de Paris en hiver, 14 h en été), la
   fonction « rappel-feuilles » envoie un e-mail à chaque collaborateur
   actif dont la feuille de la semaine n'est pas encore validée.
   Jamais à la Direction, ni aux personnes en congé toute la semaine.

   AVANT DE LANCER : remplacez les 3 valeurs entre chevrons < > :
     <PROJET>      l'identifiant du projet Supabase (dans l'adresse :
                   https://<PROJET>.supabase.co)
     <CLE_ANON>    la clé « anon » / « publishable » (Settings > API)
     <SECRET>      le même mot de passe que le secret RAPPEL_SECRET
                   de la fonction (Edge Functions > Secrets)
   Peut être relancé sans risque (il remplace la planification).
   ================================================================ */

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- remplace une éventuelle planification précédente
select cron.unschedule(jobid) from cron.job where jobname = 'rappel-feuilles-vendredi';

-- chaque vendredi à 12:00 UTC (13 h à Paris l'hiver, 14 h l'été)
select cron.schedule(
  'rappel-feuilles-vendredi',
  '0 12 * * 5',
  $$
  select net.http_post(
    url := 'https://<PROJET>.supabase.co/functions/v1/rappel-feuilles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <CLE_ANON>',
      'x-rappel-secret', '<SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

/* ---------------------------------------------------------------
   ESSAI SANS DÉRANGER PERSONNE (à lancer seul, valeurs remplacées) :
   un seul e-mail d'exemple, à votre adresse, avec la liste de ceux
   qui seraient relancés aujourd'hui.

   select net.http_post(
     url := 'https://<PROJET>.supabase.co/functions/v1/rappel-feuilles',
     headers := jsonb_build_object('Content-Type', 'application/json',
                                   'Authorization', 'Bearer <CLE_ANON>',
                                   'x-rappel-secret', '<SECRET>'),
     body := '{"test": "plgaufier@polynov.fr"}'::jsonb
   );

   Réponse de la fonction (quelques secondes après) :
   select status_code, content from net._http_response order by created desc limit 1;

   Voir la planification :            select jobname, schedule, active from cron.job;
   Historique des envois du vendredi : select start_time, status, return_message
                                       from cron.job_run_details order by start_time desc limit 5;
   Arrêter le rappel :                 select cron.unschedule('rappel-feuilles-vendredi');
--------------------------------------------------------------- */
