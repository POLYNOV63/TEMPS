# Espace POLYNOV (ex POLYNOV-TEMPS) - Contexte du projet

Application interne de POLYNOV (bureau d'études) : feuilles de temps hebdomadaires, imputations par affaire / activité,
espace RH (congés, RTT, récupération), pilotage des affaires du BE (planning, portefeuille, devis), prestations PE / PI,
facturation, finances et bilans. Interface en français. Mis à jour le 25/10/2026.

## Qui travaille dessus, et comment

- **PLG** (responsable technique, administrateur Office 365, double casquette technique et chiffre d'affaires) pilote le
  projet. **Il ne code pas** : explications pas à pas, niveau débutant, une commande PowerShell à la fois.
- **Livraison des modifications** : un zip à décompresser à la racine du projet (`C:\Users\plgaufier\TEMPS` ou
  `C:\Users\zoul\Documents\POLYNOV\polynov-temps`, deux PC : toujours `git pull` avant). Quand un fichier existe déjà chez
  lui et risque d'avoir bougé, préférer un **script `outils/maj-xxx.mjs`** (lancé par `node outils/maj-xxx.mjs`) qui
  remplace des passages exacts : il vérifie tout avant d'écrire (« tout ou rien »), affiche une ligne ✓ par changement,
  pose un marqueur pour être relancé sans risque, et dit « copiez ce message à Claude » en cas d'échec. Les retours à la
  ligne Windows (CRLF) sont normalisés. Ne plus créer de `.bak` (ignorés par `.gitignore`, ménage fait).
- **SQL** : scripts numérotés `sql/NN_objet.sql`, lancés à la main dans Supabase > SQL Editor, relançables sans risque
  (`create or replace`, `if not exists`). Dernier numéro utilisé : **63**. Toujours dire l'ordre : SQL avant le code
  qui en dépend.
- **Mise en ligne** : `npm run build` (doit passer : TypeScript strict, c'est ce qui bloque Vercel), puis
  `git add -A`, `git commit -m "…"`, `git push` ; Vercel déploie la branche main. Dépendance à installer une fois par
  PC : `npm install exceljs`.
- **Export IA** (`/admin/Export-IA`) : produit ce contexte. Mode complet ≈ 1,1 Mo : les grosses pages n'y sont que
  résumées ; demander à PLG le fichier exact avant de le modifier.

## Stack technique

- Next.js 16 (App Router, TypeScript, Turbopack), composants client, styles en ligne. Charte : rouge `#c00000`,
  police Calibri. Composants communs : `components/EnTetePage.tsx`, `components/GardeAcces.tsx`,
  `components/pilotage/ui.tsx` (C, page, Message, Pastille, Tuile, Modal, BadgeType), `lib/excelPolynov.ts` (export
  Excel aux couleurs POLYNOV, exceljs).
- Supabase (plan gratuit, **aucune sauvegarde automatique**) : Postgres, Auth, RLS, Edge Functions, pg_cron + pg_net.
  Déploiement Vercel.
- Connexion Microsoft 365 uniquement (provider `azure`), rattachement à `collaborateurs` par e-mail au premier login.

## Rôles et droits

Source côté interface : `lib/droits.ts` (`peut(role, droit)`). Protection réelle : RLS et fonctions SQL
(`rh_est_admin()`, `polynov_est_exporteur()`, `polynov_peut_piloter()`, `polynov_peut_voir_pilotage()`,
`polynov_mon_collaborateur_id()`).

| Rôle | Qui | Accès |
|---|---|---|
| COLLABORATEUR | l'équipe | Ma semaine, Mes feuilles, Ma feuille de route, RH, Guide, planning et Bilan affaire en lecture |
| RESPONSABLE | FVI, MMO | + Pilotage BE (planning des forfaits, portefeuille, DBE, feuilles de route), Feuilles collaborateurs, Bilan RH mensuel, Export Excel ; partie « responsables » du Guide |
| ADMIN | PLG, AMA | Tout ; validation RH réservée à PLG et AMA ; relevé PE / PI, Finances, Facturation, Paramétrage |
| DIRECTION | Président, adjoint | Lecture : Finances, Facturation, Indicateurs, Charge, planning. Fiche DIRECTION invisible partout (SQL 56), gérée dans « Accès Direction » de Collaborateurs |

## Feuille de temps (Ma semaine)

- Une feuille = une semaine. Lundi à vendredi affichés ; le week-end est masqué et n'est
  enregistré que s'il est renseigné.
- **Rythme** : horaires du jour = profil horaire en vigueur à la date de la semaine
  (`historique_profils_horaires`), à défaut le profil du collaborateur, à défaut
  7,5 / 7,5 / 7,5 / 7,5 / 5 h.
- **Jours fériés** français calculés par la date (non saisissables) ; enregistrés avec le
  code technique FE pour le hors-bilan. Aucune imputation possible un jour férié.
- **Absences** (codes `codes_imputation`, catégories ABSENCE / HORS_BILAN) :
  RE (récupération, en heures, débitées du compteur), RT (RTT : journée ou ½ journée avec
  les heures réellement posées), CP (journée ou ½ journée avec les heures posées), VM / AI /
  AA (absences partielles en heures). Les autres absences sont des journées complètes :
  présence ABSENT, ticket décoché, aucune imputation.
- **Imputations** : type CBE, DBE ou Divers. CBE / DBE : activité obligatoire, numéro
  d'affaire sur 4 chiffres, code, heures (description facultative). CBE : les codes proposés
  dépendent de l'activité (`activites_codes`, `autorise_affaire`). DBE : code DT. Divers :
  code Divers (`autorise_divers`), sans activité ni numéro.
- **Heures** : objectif du jour = rythme - absences. Manquantes et supplémentaires sont
  calculées jour par jour (une heure en plus un jour ne compense pas une heure manquante).
  Base normale : 35 h ; pour un profil à 37,5 h l'écart avec 35 h compte en heures sup.
- **Enregistrement** : brouillon (BROUILLON) avec sauvegarde automatique après 1,2 s sans
  saisie ; validation finale définitive (A_TRAITER, fonction SQL `valider_feuille_heures`),
  possible seulement si chaque journée est complète. L'ADMIN peut corriger une feuille
  envoyée sans la rendre au collaborateur ; il peut aussi verrouiller (`verrouillee`).
- **Clôture mensuelle** : la répartition des heures sup cumulées (compteur / payées) est
  demandée uniquement sur la semaine qui contient le vendredi de clôture du mois (dernier
  jour du mois : lundi à jeudi -> vendredi suivant ; vendredi -> ce jour ; week-end ->
  vendredi précédent). Le cumul part de la semaine suivant la clôture précédente et ne
  compte que les feuilles A_TRAITER.
- **Compteur de récupération** : plus de plafond haut (SQL 53 et 54) ; au-delà de +30 h, simple avertissement.
  `compteur_avant` = `compteur_apres` de la dernière feuille A_TRAITER précédente, sinon
  `rh_droits.compteur_recuperation_initial` de l'exercice, sinon
  `collaborateurs.compteur_recuperation`. À la validation, les feuilles A_TRAITER suivantes
  sont recalculées en chaîne.
- **Tickets restaurant** : cochés par défaut les jours travaillés ; décochés pour une journée
  d'absence complète ; à décocher en cas d'invitation client ou de paiement par la carte
  bancaire POLYNOV.
- **Copier-coller de blocs** : une imputation ou toute une journée se copie dans un
  presse-papiers, puis se colle sur un jour ou sur plusieurs jours choisis ; une absence
  (CP, RTT, RE...) se copie et se colle de la même façon ; une ligne peut être dupliquée.
  La copie reste possible sur une feuille verrouillée ou validée.
- **Assistant de saisie** : bandeau collant en haut de la feuille (état de chaque jour, accès
  direct, premier jour incomplet) ; « Affaires récentes » (affaires des 10 dernières semaines)
  à l'ajout d'une ligne ; bouton « +X » (solde) qui complète une journée ; reprise des affaires
  de la semaine précédente (sans les heures) ; application, sur demande, des CP / RTT /
  récupérations déjà validés dans l'espace RH (journées entières uniquement) ; code choisi
  automatiquement quand il n'y en a qu'un ; nouvelle ligne qui reprend le type et l'activité de la
  précédente ; aide repliée par défaut.
- **Saisie sur téléphone** (écran de moins de 760 px) : un seul jour affiché à la fois (choix par le bandeau ou par
  ◀ ▶), mise en page sur une colonne, champs agrandis, barre fixe en bas (jour précédent / suivant, Enregistrer,
  Valider). Aucun changement sur ordinateur. Composants : `SaisieMobile.tsx`, `AssistantSaisie.tsx`.

## Autres règles connues

- **Exercice RH** : du 1er novembre au 31 octobre ; l'exercice porte l'année de novembre.
- **Soldes CP / RTT** = droits `rh_droits` de l'exercice - demandes validées ou transmises
  - demandes en attente (demandes de l'exercice uniquement).
- Types de demande : CP, RTT, RE (0,5 à 7,5 h), CP exceptionnel avec ou sans justificatif.
  Pas de demi-journée un vendredi. Une demi-journée de CP ou de RTT fait entre 3 h et 4,5 h (alerte dès la saisie). Jours ouvrés : fériés français exclus.
- **Bilan activités** : seules les heures CBE / DBE rattachées à une activité sont réparties ;
  capacité légale de référence de 35 h par semaine et par feuille.
- **Collaborateurs** : désactiver conserve l'historique et bloque la connexion ; supprimer
  n'est possible que si aucune donnée n'existe (fonction SQL `supprimer_collaborateur`).
  Un nouveau collaborateur reçoit un profil horaire et un historique de rythme (à partir du
  lundi de sa semaine d'entrée) ; son espace est actif dès sa première connexion Microsoft.

## Import historique (classeur Excel « Récupération heures »)

- Un onglet par semaine (Sxx-aaaa). Import de S44-2024 (semaine du 1er novembre 2024) à la
  dernière semaine renseignée ; les onglets vides en fin de classeur sont ignorés et les semaines
  absentes sont signalées.
- Disposition relue onglet par onglet : bloc « CODES AFFAIRES » (production), bloc « CODES
  ADMINISTRATIFS », puis les 7 jours. Le bloc de chaque code est conservé
  (`historique_imputations.groupe_code` = AFFAIRES ou ADMIN).
- Par collaborateur : lignes CBE n° / DBE n° / Divers, ventilées par code.
- **Divers de production** = ligne Divers portant un code de catégorie PRODUCTION. La catégorie du
  code dans Gestion des codes fait foi : NI, CN (commercial), Formation (FI interne, FO externe),
  absences, production (ex. HA = achats lors d'une affaire de négoce, même s'il figure dans le bloc
  administratif du classeur). Pour un code inconnu de Gestion des codes sur une ligne Divers, le bloc
  du classeur décide (affaires = production, administratif = « Autres »).
- **NI** = temps non imputable : la personne n'a pas de charge. **EC** = alternant à l'école
  (importé, catégorie ABSENCE).
- **L'import Excel est prioritaire** (décision de l'administrateur) : à la fin d'un import, la page propose de
  supprimer les feuilles saisies avec le nouveau système pour les semaines présentes dans l'import (aperçu par
  semaine, confirmation, puis fonction SQL `purger_feuilles_semaines_importees`, script 15). Les feuilles supprimées
  sont archivées dans `archive_feuilles_purgees`. Ne touche ni aux demandes de congés, ni aux droits RH, ni aux heures
  supplémentaires. Sans cette suppression, une feuille du nouveau système (même vide) masque l'Excel pour la personne
  et la semaine concernées dans les Bilans.

## Ma semaine : saisie en grille

- **Principe** : une AFFAIRE par ligne, un JOUR par colonne. Dans chaque case : une ou plusieurs imputations, chacune avec son
  ACTIVITÉ, son CODE (liste filtrée par l'activité) et ses HEURES, comme sur la feuille classique. Le modèle de données ne
  change pas : une imputation = une ligne (type, n°, activité, code, heures) rattachée à un jour ; la grille regroupe par
  affaire pour l'affichage (`lib/grilleSemaine.ts`). Plusieurs codes le même jour = « + ligne ».
- **Lisibilité** : une case vide au repos n'affiche qu'un petit champ d'heures (l'activité et le code, pré-remplis, sont masqués
  et apparaissent quand on clique dans la case) ; seules les cases déjà imputées montrent activité, code et heures. Les lignes
  remplies sont allégées (menu d'activité compact, séparateurs pointillés).
- **Gain de temps** : une nouvelle ligne reprend l'activité de la ligne précédente sur la même affaire (et, pour une affaire
  ajoutée depuis la semaine précédente, l'activité qu'elle avait) ; le code est choisi d'office quand l'activité n'en autorise
  qu'un (DBE : activité rattachée à DT + code DT). Une case vide est pré-remplie : l'imputation n'est créée que lorsqu'on saisit.
- **Activité** : obligatoire en CBE et DBE (comparaison réalisé / chiffré par activité) ; Divers : codes Divers, sans activité ni
  numéro.
- **Alertes de données manquantes** (mêmes règles que la validation de la feuille) : elles ne s'affichent PAS pendant la
  saisie. Elles apparaissent quand on tente d'enregistrer (bouton Enregistrer) ou de valider la semaine — compteur
  `verificationDemandee`, incrémenté par `enregistrerBrouillon` et `demanderValidationFinale` —, et seulement s'il y a quelque
  chose à corriger : encadré « À compléter avant d'enregistrer » (affaire, message, jours), menus d'activité / de code et cases
  d'heures entourés en rouge, numéro d'affaire à 4 chiffres signalé sur l'en-tête. Elles disparaissent d'elles-mêmes quand tout
  est corrigé et ne reviennent pas à chaque nouvelle saisie ; l'enregistrement automatique n'en déclenche pas. Le code reste
  grisé tant que l'activité n'est pas choisie.
- **Cartes « Objectif »** par jour, collées en haut, vertes quand l'objectif est atteint ou dépassé, orange sinon (« Manque
  x h », sans bouton de complément), grisées pour un jour férié ou une absence sur la journée. Présence en menu déroulant avec le
  code couleur de l'export Excel : Présentiel vert, Télétravail jaune, Absent orange. Absence en menu par jour, détail empilé
  dessous (RE, RTT, CP, VM/AI/AA).
- **Ligne des jours fixe** : la ligne des jours et les cartes « Objectif » restent collées en haut de l'écran quand on fait
  défiler (`position: sticky`), avec un rappel « S42 · 12/10 → 16/10 » dans sa première case. Dans une fenêtre étroite (moins de
  1164 px, ou 1504 px avec le week-end affiché) la grille défile dans son cadre, dans les deux sens, pour que la ligne reste fixe.
- **Ligne d'affaire** : description modifiable directement, croix pour retirer l'affaire (confirmation s'il y a des heures),
  croix par ligne d'imputation ; le « + » de la colonne Affaire propose d'abord les affaires de la semaine précédente.
- **Téléphone (< 760 px)** : un jour à la fois (barre du bas de la page), mêmes lignes en pleine largeur.
- **Fichiers** : `lib/grilleSemaine.ts` (logique pure testée), `app/ma-semaine/GrilleSemaine.tsx` (composant, sans accès aux
  données), `app/ma-semaine/grille-demo/page.tsx` (essai avec fausses données, `/ma-semaine/grille-demo`).
## Compteur de récupération

- **Chaîne de feuille en feuille** : le compteur avant d'une feuille = compteur après de la dernière feuille validée précédente
  (statut `A_TRAITER`) ; compteur après = compteur avant - heures de récupération (RE) prises + part des heures supplémentaires
  affectée au compteur **à la clôture mensuelle seulement**. Les heures supplémentaires de la période s'accumulent sans toucher le
  compteur jusqu'à la décision de fin de mois (compteur ou heures payées). Pas de plafond haut (avertissement au-delà de +30 h).
- **Point de départ** : « Compteur récupération initial » des Droits RH (page Suivi RH, par exercice, l'exercice commence en
  novembre), utilisé **uniquement** pour la première feuille d'une personne ; à défaut l'ancienne valeur de la fiche collaborateur.
  Modifier ce champ après coup ne change donc rien aux feuilles déjà créées.
- **Affichage** : l'espace RH montre le compteur après de la dernière feuille (un brouillon reprend le compteur de départ).
- **Ajustement forcé** (script SQL 17, page Suivi RH `/admin/suivi-rh`, ADMIN ; l'ancienne `/admin/compteurs` existe encore) : un administrateur ajoute ou retire des heures avec un
  **motif obligatoire** ; l'ajustement s'ajoute à la dernière feuille validée (colonne `feuilles_heures.compteur_regularisation`),
  décale les brouillons postérieurs, ou modifie le compteur initial des Droits RH s'il n'existe aucune feuille validée. Tracé dans
  `rh_compteur_regularisations` (date, avant, après, motif, auteur). Fonction `rh_regulariser_compteur`.
- **Protection du recalcul** : `scripts/patch-compteur-regularisation.mjs` fait conserver cet ajustement par « Ma semaine » quand la
  feuille est corrigée par un administrateur ou quand les feuilles suivantes sont recalculées.

## Statistiques de productivité (Bilans)

- **Capacité nette** (même base pour l'historique et le nouveau système) : 35 h moins fériés,
  congés, récupérations et absences. Les taux (CBE, DBE, CN, Divers de production, NI...) sont
  calculés sur cette capacité.
- **La capacité est de 35 h pour tout le monde** (l'historique comme le nouveau système). Les heures en plus (collègues en PE à
  37,5 h, heures supplémentaires) sont du travail réellement imputé sur des affaires : on les mesure, sans correction. Les
  pourcentages peuvent donc dépasser 100 % au total, et c'est normal (décision de l'administrateur : pas de tuile de
  réconciliation).
- **CP et EC sortis de l'analyse** : déduits de la capacité mais jamais comptés dans « Divers d'absences »,
  quelle que soit leur catégorie dans Gestion des codes (`CODES_EXCLUS_ANALYSE`, aussi dans Mon bilan).
- **Encadrement** : les collaborateurs décochés « Inclus dans les statistiques de productivité »
  (colonne `collaborateurs.inclus_statistiques` : AMA, PLG) ne comptent ni dans la capacité ni dans les
  taux ; leur bloc d'affichage a été retiré de la page Bilans.
- Le détail par code indique les heures, le nombre de personnes et le nombre de semaines (ex. ML).


## Tableau de bord (`app/dashboard/page.tsx`)

- **ADMIN** : bandeau « Mon espace » (Ma semaine avec son état, Ma feuille de route, Mes feuilles, Mes demandes RH,
  Guide), puis **Bureau d'études** (Planning des affaires, Portefeuille, Relevé PE / PI, Bilan affaire), **Analyses**
  (Finances, Indicateurs commerciaux, Charge & pointage), **RH** (Validation RH, Suivi RH, Feuilles collaborateurs),
  **Exports** (Facturation du mois, Bilan RH mensuel, Export récapitulatif d'heures), **Paramétrage** replié.
- Vignette **Feuilles collaborateurs** : semaine EN COURS, compteurs transmises / à valider / incomplètes / non saisies,
  noms à relancer. **Cloche** : demandes RH en attente ; chaque ligne ouvre la demande (`/admin/Valid_RH?demande=<id>`).
- RESPONSABLE / COLLABORATEUR : Mon espace (avec Ma feuille de route, Guide), Pilotage BE pour les responsables.
  DIRECTION : blocs de consultation. Affichage téléphone (CSS `@media`), aussi pour Validation RH et Mes feuilles.

## Suivi d'affaire BE (classeur Excel) : il fait foi

- Classeur stratégique sur le serveur de l'entreprise (pas de connexion directe à Internet). Lecture par
  `lib/suiviAffaires.ts` (colonnes autorisées seulement : jamais de commentaires ni de données client hors nom abrégé et
  n° client) et la fonction Edge `synchroniser-suivi-affaires`, depuis `/admin/synchro-suivi-affaires`. Tables
  `suivi_lignes`, `suivi_lignes_montants`, `suivi_clients`, `suivi_synchronisations`, `suivi_correspondance_activites`,
  `suivi_exclusions` (DBE2618 ignoré pour toujours). Périmètre : devis ouverts depuis le 01/11/2024.
- Numérotation : DBExxxx = devis ; CBExxxx = commande, `R1`, `R2` = avenants, `ECH` / `LOT` = découpages du montant
  (acomptes, livraison, solde), jamais additionnés. ARC Louxor = n° de l'ERP du siège, propre à chaque ligne.
- `suivi_maj_pilotage` crée / met à jour `pilotage_affaires` : **une ligne par commande** (base et chaque avenant),
  Commande reçue → EN_COURS, Intention de commande → EN_ATTENTE, Livrée → LIVREE ; chiffré par activité depuis les heures
  par discipline (correspondance des activités) ; repère `suivi_maj_le` (« XLS »). Statut, délai, chiffré et
  désignation se modifient dans Excel ; dans l'application : le responsable, les affectations (et le délai par
  `pilotage_changer_echeance`, avec motif).
- **DBE** (SQL 59, trigger `zz_pilotage_dbe_suivi` sur `suivi_lignes`) : un « Devis ouvert » crée son DBE au Pilotage
  (responsable = rédacteur, début = ouverture, remise = colonne Délai sinon ouverture + 10 jours ouvrés) ; devis envoyé
  ou devenu commande → LIVREE ; perdu sans envoi → ABANDONNEE. Responsable et date de remise jamais écrasés ensuite.
  Pas de DBE créé pour l'historique (envoyés / perdus).
- La synchronisation est encore lancée à la main : **à faire, un agent sur le serveur** (toutes les 5 min).

## Pilotage BE

- **Onglets** (`components/pilotage/OngletsPilotage.tsx`) : Portefeuille, Planning des affaires, Charge par ressource
  (ADMIN), Planning par ressource (consultation), Prestations PE / PI (ADMIN), Feuilles de route (responsables).
- **Planning des affaires** (`/pilotage/affaires`) : toute commande EN_COURS / EN_ATTENTE au planning d'office ; groupes
  Affaires (CBE puis DBE), PI, PE ; **tri par numéro croissant**, avenant sous sa base. PE / PI : seulement les avenants
  s'il y en a. Barre de l'affaire = pointé (foncé) + planifié (clair) sur le chiffré ; colonne « reste à planifier ». On
  affecte par double-clic, glisser une personne, « + Affecter » ; une barre se glisse, s'étire, Suppr la supprime.
  ⚑ livraison souhaitée, 📌 rendu d'un devis. « 👁 Voir une personne » : focus et charge jour par jour. Hors affaire
  (salons, formations). Dépassement du chiffré toujours permis. Livrées rangées en bas. Mois au-dessus des semaines.
- **PE / PI** : le relevé des prestations fait foi ; les barres des ressources en viennent
  (`prestation_synchroniser_planning`), non glissables au planning.
- **Portefeuille** (`/pilotage`) : une ligne par commande, réalisé de la famille porté par la base ; alertes et tuile
  Dépassements sur les affaires ACTIVES seulement (une livrée n'alerte plus) ; colonne « Délai » (« Délai dépassé ») ;
  en-tête du tableau fixe. DBE : « ✏️ affecter » (rédacteur + date cible de rendu, via `pilotage_changer_echeance`, motif
  automatique), formulaire sur une ligne à part.
- **Règle des délais** : une date ne s'écrit jamais en direct dans `pilotage_affaires.echeance` (trigger : motif
  obligatoire) ; toujours `pilotage_changer_echeance(p_affaire_id, p_nouvelle_date, p_motif, p_commentaire)` qui historise
  dans `pilotage_echeances_historique`. Vocabulaire voulu : **« délai »**, pas « échéance ».
- **Une page par affaire = Bilan affaire** (`/affaires/bilan?affaire=CBE1604&commande=1604R2`) : chiffré / pointé par
  activité, par personne, par mois, négoce (vendu / acheté, ADMIN-RESPONSABLE-DIRECTION), n° DBE, bilan financier, **par
  sous-dossier** (SQL 63), et panneau **Pilotage** (`components/pilotage/PanneauPilotageAffaire.tsx` : responsable,
  délai et historique, affectations, suppression ADMIN ; une pastille par commande de la famille). L'ancienne fiche
  `/pilotage/affaire/[id]` redirige vers ce bilan.
- **Ma feuille de route** (`/ma-feuille-de-route`, SQL 60 `ma_feuille_de_route`, SQL 61 `ma_feuille_de_route_devis`) :
  ce que le planning prévoit pour la personne, semaine par semaine (affaires × jours, congés, total), devis à rédiger
  jusqu'à l'envoi ; 4 semaines / 2 mois / 3 mois ; responsables et ADMIN choisissent un collègue.
- **Charge & pointage** : deux onglets (`components/analyse/OngletsCharge.tsx`) : Par affaire (`/analyse/pointage`,
  pointé face au chiffré) et Par collaborateur (`/admin/bilans`, capacité et taux ; histogramme par mois par défaut).

## Prestations PE / PI (temps passé)

- Relevé mensuel `/pilotage/prestations` (ADMIN) : tables `prestation_lignes` (affaire, personne, unité JOUR / HEURE,
  taux, base horaire), `prestation_mois` (valide = mois clôturé = facturé, `montant_fige`, `montant_import`, report,
  heures sup à refacturer), `prestation_saisies` (heures par jour), `prestation_historique`.
- **Le classeur « Suivi des prestations » (Excel) fait foi** : import `/admin/import-prestations` (par défaut mois en cours
  et suivants ; case « Tout importer » pour les mois passés, qui arrivent validés). Ligne CAS = ancienne désignation.
- Montant d'un mois : figé si clôturé, sinon montant importé du classeur, sinon (heures − report + HS × 125 %) × taux.
  Facturable si l'affaire du Pilotage est EN_COURS ou LIVREE (une intention n'est pas facturable).

## Facturation et finances

- **Facturation du mois** (`/analyse/facturation`, calcul partagé `lib/facturationMois.ts`) : un tableau trié par client
  (N° DBE, ARC Louxor de chaque ligne, statut). Forfaits **livrés** dans le mois (montant − découpages) et **prévus**
  (commande reçue / intention, date de livraison estimée dans le mois ; dépassée → mois en cours) ; PE / PI du relevé.
  Trois chiffres : **Total facturable**, **Facturé** (forfaits livrés + PE / PI clôturées), **Reste à facturer**. Couleurs :
  vert livrée, bleu prévue, jaune à corriger (non facturable, ARC Louxor manquant). Export Excel.
- **Finances** (`/analyse/finances`, `lib/finances.ts`, ADMIN et DIRECTION) : CA de l'exercice mois par mois, réalisé
  (livraisons, échéances, relevé validé, historique) + attendu (forfait à sa date de livraison estimée, dépassée → mois en
  cours, sans date → « à dater » ; PE / PI par `prestation_montants_prevus`, SQL 58 : le classeur fait foi) =
  atterrissage, face au prévisionnel (`finances_previsionnel`) ; coût de structure `indicateurs_couts`. Montants
  cliquables (`components/finances/DetailMontant.tsx`) ; un clic sur l'Atterrissage = **rapprochement avec la
  Facturation** affaire par affaire (écarts attendus : PE / PI non facturables, lignes non rattachées).
- **Indicateurs commerciaux** (`/pilotage/indicateurs`, `lib/indicateurs.ts`) : devis, transformation, prise de
  commande, top clients, carnet ; délai de réponse médian **sans les avenants**, avec la part envoyée le jour même ; devis
  perdus comptés en nombre seulement.

## RH

- **Suivi RH** (`/admin/suivi-rh`) : page unique (CP, RTT, compteurs, historique, droits de l'exercice, ajustement du
  compteur, CP exceptionnels). Collaborateurs = la fiche seulement.
- **Validation RH** (`/admin/Valid_RH`, PLG et AMA) : le premier qui valide clôt ; décision transmise par mail aux
  services du siège (adresses modifiables), collaborateur et PLG / AMA en copie.
- Fin de mois (responsables) : **Bilan RH mensuel** et **export Excel** des feuilles envoyés aux **services du siège**.

## E-mails et tâches planifiées

- Microsoft Graph via la boîte partagée et l'application Entra « POLYNOV Mailer » (secrets `M365_TENANT_ID`,
  `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, **à renouveler avant le 14/10/2028**, `M365_EXPEDITEUR`). Fonctions Edge :
  `notifier-demande-rh`, `notifier-reponse-rh`, `envoyer-demande-rh`, `rappel-feuilles`.
- **Rappel du vendredi** (SQL 57) : pg_cron `rappel-feuilles-vendredi`, `0 9 * * 5` (10 h l'hiver, 11 h l'été) appelle
  `rappel-feuilles` (en-tête `x-rappel-secret` = secret `RAPPEL_SECRET` ; `APP_URL` facultatif) : un mail personnalisé à
  chaque actif hors DIRECTION dont la semaine n'est pas validée (sauf congé toute la semaine). Corps `{"test": "<adresse>"}`
  = un seul mail d'essai ; `{"tous": true}` = à tous.

## Sauvegarde

- `/admin/sauvegarde` : toutes les tables (liste lue par `polynov_tables_sauvegarde`, 38 tables au 25/10/2026) dans un
  ZIP (CSV + JSON). Ne contient pas les justificatifs RH (stockage), le code des fonctions, pg_cron ni les secrets.
- **À faire** : sauvegarde automatique nocturne sur le serveur (même agent que la synchronisation).

## Guide

- `/guide` : guide du collaborateur dans l'application (connexion, Ma semaine, feuille de route, RH, planning) ; partie
  « Pour les responsables » (rendez-vous de la semaine et du mois, fonctionnement, devis pas à pas) visible des rôles
  RESPONSABLE et ADMIN. Texte en dur dans la page.

## À venir

- Agent serveur : synchronisation du Suivi d'affaire toutes les 5 min et sauvegarde nocturne.
- Téléphone niveau 3 (toutes les pages) ; rendre le planning par ressource modifiable si l'essai convainc.
- Vérifier l'adresse exacte de l'application et la connexion dans le Guide.
- Règles non écrites : paiement des heures supplémentaires, liste officielle des codes d'absence.
