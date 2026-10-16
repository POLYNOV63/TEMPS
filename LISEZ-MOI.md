# Profils horaires : créer ses rythmes à volonté

Un seul fichier à installer. Il corrige les deux pages qui créent des profils horaires :
« Profils horaires » et « Collaborateurs » (création d'un rythme personnalisé).

## 1. Installer
Copie `scripts/patch-profils-horaires.mjs` dans le dossier `scripts` de ton projet, puis, à la racine du projet (PowerShell) :

    node scripts/patch-profils-horaires.mjs

Le message attendu : « Profils horaires : la vraie cause des erreurs s'affiche… (deux pages modifiées) ».
Le script est « tout ou rien » et fait une sauvegarde `page.tsx.bak-profils` de chaque page.

## 2. Vérifier
    npx tsc --noEmit
    npm run dev

Puis Ctrl + F5 dans le navigateur.

## 3. Essayer
Page Profils horaires > « + Nouveau profil » > NRA, 7,75 / 7,75 / 4 / 7,75 / 7,75 > « Créer le profil ».
Tu peux maintenant saisir des quarts d'heure (7,75 = 7 h 45) avec les flèches du clavier.

- **Si ça marche** : c'est réglé. Le profil apparaît dans la liste et dans « Changer le rythme ».
- **Si ça échoue encore** : le cadre rouge indique maintenant la cause exacte, par exemple
  « Une règle de la base refuse ces valeurs : … ». Copie-moi ce texte en entier.

## Pour aller plus loin (facultatif)
Si tu veux voir comment la table est définie, exécute ceci dans Supabase (SQL Editor) et envoie-moi le résultat :

    select jsonb_pretty(jsonb_build_object(
      'colonnes', (select jsonb_agg(jsonb_build_object('col',column_name,'type',data_type,'precision',numeric_precision,'echelle',numeric_scale,'defaut',column_default,'obligatoire',is_nullable,'calculee',is_generated) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='profils_horaires'),
      'regles', (select jsonb_agg(jsonb_build_object('nom',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where conrelid='public.profils_horaires'::regclass),
      'declencheurs', (select jsonb_agg(jsonb_build_object('nom',tgname,'definition',pg_get_triggerdef(oid))) from pg_trigger where tgrelid='public.profils_horaires'::regclass and not tgisinternal)
    )) as diagnostic;
