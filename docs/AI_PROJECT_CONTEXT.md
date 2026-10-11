# POLYNOV-TEMPS - Contexte du projet

Application interne de POLYNOV (bureau d'études) : feuilles de temps hebdomadaires,
imputations par affaire / activité, espace RH (congés, RTT, récupération) et bilans.
Interface en français.

## Stack technique

- Next.js (App Router, TypeScript), composants client, styles en ligne
  (Tailwind sur quelques pages seulement). Charte : rouge `#c00000`, police Calibri.
- Supabase : Postgres, Auth, RLS. Déploiement Vercel.
- Connexion Microsoft 365 uniquement (provider `azure`). Le callback `/auth/callback`
  rattache le compte Microsoft à la fiche `collaborateurs` par **email** (premier
  login). Un collaborateur désactivé (`actif = false`) ne peut plus se connecter.
- Excel : `xlsx` / `xlsx-js-style` (export hebdomadaire, import de l'historique).

## Rôles et droits

Source unique côté interface : `lib/droits.ts` (fonction `peut(role, droit)`).
La protection réelle est la RLS Supabase (fonctions `rh_est_admin()`,
`polynov_est_exporteur()`, `rh_est_validateur()`, `polynov_mon_collaborateur_id()`).

| Niveau | Rôle (`collaborateurs.role`) | Accès |
|---|---|---|
| 0 | COLLABORATEUR | Ses feuilles (Ma semaine, Mes feuilles), son espace RH, Bilan affaire, Mon bilan |
| 1 | RESPONSABLE | Niveau 0 + Suivi des feuilles et Ma semaine d'un autre collaborateur en consultation, Bilan RH mensuel, Export Excel |
| 2 | ADMIN | Tout : modification de n'importe quelle feuille, collaborateurs, profils horaires, codes, activités, bilans, imports, validation RH, Export IA |

Les validateurs RH sont les administrateurs AMA et PLG (notifications e-mail des demandes).
Le niveau 1 lit toutes les feuilles (policies SELECT via `polynov_est_exporteur()`) mais
n'écrit rien ; les écritures sensibles sont réservées à `rh_est_admin()`.

## Modèle de données (résumé)

- `collaborateurs` : fiche + compte (email = identifiant Microsoft, `auth_user_id`, `role`,
  `actif`, `trigramme`, `profil_horaire_id`, `date_entree`, `date_sortie`,
  `compteur_recuperation`).
- `profils_horaires` (heures théoriques du lundi au vendredi), `historique_profils_horaires`
  (rythme applicable par période), `bases_horaires`, `affectations_bases_horaires`.
- `feuilles_heures` : une feuille par collaborateur et par semaine (`semaine_debut`,
  `statut` BROUILLON / A_TRAITER, `verrouillee`, `total_heures`, `total_theorique`,
  `heures_supplementaires`, `total_re`, `compteur_avant`, `compteur_apres`, et pour la
  clôture mensuelle `cloture_mensuelle`, `heures_supplementaires_a_repartir`,
  `heures_supplementaires_compteur`, `heures_supplementaires_payees`).
  `feuilles_heures_jours` (présence, absence, durées, heures RE, ticket restaurant) et
  `feuilles_heures_imputations` (`type_affaire`, `numero_affaire`, `code`, `activite_id`,
  `description`, `heures`).
- `codes_imputation` (catégories dont ABSENCE et HORS_BILAN), `activites`, `activites_codes` :
  référentiels d'imputation.
- `rh_droits` : droits d'un collaborateur **par exercice** (CP reportés, acquis, ancienneté,
  exceptionnels, RTT acquis, compteur de récupération initial, période CP). Saisis par
  l'ADMIN dans Collaborateurs > Droits RH : c'est la référence des soldes.
- `rh_demandes` : demandes CP / RTT / récupération (statuts EN_ATTENTE, VALIDEE, ENVOYEE_RH,
  REFUSEE), validation par AMA / PLG. Vue `rh_demandes_admin`.
- `historique_imputations`, `historique_presence` : historique importé depuis Excel
  (`source`), lu par les bilans. `v_historique_affaires` : vue par affaire.

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
- **Compteur de récupération** : borné de -30 h à +30 h (validation refusée au-delà).
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
  Pas de demi-journée un vendredi. Jours ouvrés : fériés français exclus.
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

## Organisation du tableau de bord

- **Mon espace (tous)** : Ma semaine, Mes feuilles, Bilan affaire (pour tout le monde), RH.
- **ADMIN et RESPONSABLE** : Pilotage BE (portefeuille, nouvelle affaire, planning des affaires, charge par ressource) et
  Suivi des équipes (feuilles collaborateurs, bilan RH mensuel, export Excel).
- **ADMIN seulement** : suivi rapide et à traiter ; Administration (collaborateurs, rythmes horaires, codes, imputations
  des affaires, activités, validation RH) ; Analyse (analyse de charge, bilan activités, export IA) ; Données (import
  historique).
- « Mon bilan » n'est plus proposé aux collaborateurs (un NI élevé peut stresser) : la page est réservée aux ADMIN en
  attendant une décision.

## Mon bilan (page personnelle, réservée aux ADMIN pour le moment)

- Page `/mon-bilan` : ma répartition du temps (CBE vendus, DBE, CN, Divers de production, NI, Formation FI / FO,
  non expliqué) sur la période choisie (mois, exercice, année, 12 derniers mois), mes affaires, l'évolution mois
  par mois. Seules les données de la personne connectée sont lues.
- Mêmes définitions que Bilans : classement dans `lib/categoriesBilan.ts` (la page Bilans conserve sa propre copie
  de ces règles ; toute évolution des définitions doit être faite aux deux endroits, ou unifiée).
- Ne reprend pas : saisie et compteur (Ma semaine), liste des feuilles (Mes feuilles), congés et RTT (RH).
- Une personne exclue des statistiques (encadrement) voit ses heures sans capacité ni taux.

## Pilotage BE (module en construction)

On pilote les AFFAIRES ; le planning individuel et la charge des ressources en découlent. Exploite les données existantes
sans les copier. Maquettes : canevas « Pilotage BE — maquettes des écrans ».

- **Accès** : réservé aux ADMIN et aux RESPONSABLE (droit `piloterBE`, fonctions SQL `polynov_peut_piloter()` et
  `polynov_peut_voir_pilotage()`). Suppression d'une affaire et gestion des imputations : ADMIN seulement.
- **1. Déclarer une affaire** (`/pilotage/nouvelle`) : on commence par l'**imputation** (BE / PE / PI / Scan / Négoce / IG, liste
  gérée dans Administration > Imputations des affaires), qui décide du reste. Descriptif sans nom de client ; numéro en chiffres.
  - **Prestation (PE, PI : imputation « heures chiffrées non obligatoires »)** : une personne (ou « plus tard »), une date de
    début, puis **date de fin, nombre d'heures ou nombre de jours** ; congés et fériés repoussent la fin ; on peut **affecter
    tout de suite** (déclaration + affectation). L'échéance de l'affaire = fin calculée.
  - **Autres imputations** : heures chiffrées par activité (sans code) + date de livraison souhaitée ; elles apparaissent dans le
    planning (« Besoins » par activité) pour affecter les ressources.
  - **DBE** : date de remise obligatoire, code DT, heures de rédaction facultatives.
  - La notion de priorité a été supprimée des écrans.
- **2. Planning des affaires** (`/pilotage/affaires`) : vue sur 2, 4, 8, 12 ou 26 semaines ; **PE en haut, PI ensuite, le reste dessous** ;
  une ligne par affaire (en cours / en attente), dépliable, avec ses « Besoins » par activité (heures affectées / chiffrées) ; on y
  affecte des personnes en les glissant depuis le panneau « Ressources » (classées par disponibilité) ou avec
  « + Affecter » : date de début + durée en **jours, demi-journées ou heures** (+ % du temps). Un bloc se déplace (glisser)
  et se redimensionne (étirer les bords) ; un clic le modifie (changer la date de début replace les mêmes heures à partir de là). Les heures se calculent (horaire du profil moins
  congés validés et jours fériés ; la fin est repoussée d'autant) et sont comparées au chiffré : alerte, ou bloc limité
  au chiffré si « me contenir » est activé (réglage mémorisé dans le navigateur). Congé / férié dans un bloc : signalés.
- **PE** : la personne est chez le client : **non affectable ailleurs** (grisée dans le panneau, refus au glisser).
  Une PE s'affecte comme les autres mais son bloc n'est pas déplaçable ici. L'affectation peut préciser une activité
  (facultative), avec alerte si l'activité dépasse son chiffré.
- **3. Charge par ressource** (`/pilotage/ressources`) : charge de chaque personne sur 12 semaines avec, en bas du tableau, le
  **taux de charge de l'équipe (hors encadrement)** par semaine = heures affectées ÷ capacité ; détail d'une semaine avec
  déplacement d'heures. (La fonction SQL 13 « affaires par personne » n'est plus utilisée par l'écran.) Le détail précis par activité se fait au bilan,
  avec les feuilles d'heures.
- **Définitions** : Chiffré = heures chiffrées ; Réalisé = heures imputées sur le numéro (feuilles + historique) ;
  Affecté = heures planifiées ; Capacité = horaire du profil - fériés - absences validées (rh_demandes VALIDEE) ;
  Taux de charge = affecté ÷ capacité de l'équipe.
- **Tables** (SQL 08 à 13) : `pilotage_affaires`, `pilotage_charges`, `pilotage_affectations` (+ `_jours`, une ligne par
  jour), `pilotage_echeances_historique` (motif obligatoire), `pilotage_imputations` (colonne `charge_obligatoire`).
- **Code** : `lib/pilotageCalculs.ts`, `lib/pilotagePlanning.ts` (moteur testé : fériés, capacités, répartition,
  blocs, PE chez le client, taux de service), `lib/pilotageDonnees.ts`, `components/pilotage/*`.
- **Ancien planning par ressource** : remplacé (`/pilotage/planning` redirige) ; `AffectationDialog.tsx` n'est plus utilisé.
- **A venir** : détournement d'une PI avec fin décalée ou non, bilans par imputation (% PE / PI / BE par personne),
  « Ma feuille de route ».

## Organisation du tableau de bord

- **Mon espace (tous)** : Ma semaine, Mes feuilles, Bilan affaire (pour tout le monde), RH.
- **ADMIN et RESPONSABLE** : Pilotage BE (portefeuille, nouvelle affaire, planning des affaires, charge par ressource) et
  Suivi des équipes (feuilles collaborateurs, bilan RH mensuel, export Excel).
- **ADMIN seulement** : suivi rapide et à traiter ; Administration (collaborateurs, rythmes horaires, codes, imputations
  des affaires, activités, validation RH) ; Analyse (analyse de charge, bilan activités, export IA) ; Données (import
  historique).
- « Mon bilan » n'est plus proposé aux collaborateurs (un NI élevé peut stresser) : la page est réservée aux ADMIN en
  attendant une décision.

## Mon bilan (page personnelle, réservée aux ADMIN pour le moment)

- Page `/mon-bilan` : ma répartition du temps (CBE vendus, DBE, CN, Divers de production, NI, Formation FI / FO,
  non expliqué) sur la période choisie (mois, exercice, année, 12 derniers mois), mes affaires, l'évolution mois
  par mois. Seules les données de la personne connectée sont lues.
- Mêmes définitions que Bilans : classement dans `lib/categoriesBilan.ts` (la page Bilans conserve sa propre copie
  de ces règles ; toute évolution des définitions doit être faite aux deux endroits, ou unifiée).
- Ne reprend pas : saisie et compteur (Ma semaine), liste des feuilles (Mes feuilles), congés et RTT (RH).
- Une personne exclue des statistiques (encadrement) voit ses heures sans capacité ni taux.

## Pilotage BE (module en construction)

Planning prévisionnel et suivi des DBE (offres) et des CBE (réalisation), exploitant les données existantes sans les
copier. Maquettes validées : canevas « Pilotage BE — maquettes des écrans ».

- **Accès** : réservé aux ADMIN et aux RESPONSABLE, qui voient et modifient (droit `piloterBE`, fonction SQL
  `polynov_peut_piloter()` ; la lecture passe par `polynov_peut_voir_pilotage()`, script 11). Suppression d'une affaire et
  gestion des imputations : ADMIN seulement.
- **Saisie** : les affaires sont déclarées dans l'application (`/pilotage/nouvelle`) : numéro (chiffres seuls, comme dans
  les feuilles d'heures), descriptif sans nom de client, **imputation** (menu BE / PE / PI / Scan / Négoce / IG, liste
  gérée dans Administration > Imputations des affaires), responsable, heures chiffrées par activité (code facultatif).
  L'import depuis le fichier Excel « Suivi d'affaire BE » est mis de côté (voir `docs/futur/`).
- **Règles métier** :
  - un **DBE** se déclare toujours sur le **code DT** ; il a une **date de remise obligatoire** (c'est un jalon dans le
    planning, affiché dans la bande « Échéances ») ; ses heures de rédaction sont facultatives ;
  - une imputation peut être **à charge non chiffrée** (réglage « Heures chiffrées obligatoires » de l'imputation ; PE par
    défaut) : l'affaire se déclare sans heures. Une **prestation (PE)** = une personne affectée au même code, jour après
    jour, **jusqu'à une date, pour un nombre de jours ou pour un nombre d'heures** ; les congés (absences validées RH),
    jours fériés et week-ends ne sont pas travaillés : **la date de fin est repoussée** d'autant (fonctions
    `remplirHeures` / `remplirJours` / `quantiteJusquaDate`). Environ 60 % de l'activité. Les PI suivent le même schéma
    (d'autres affaires peuvent s'ajouter par-dessus : voir la règle de décalage à confirmer) ;
  - les **petites affaires multi-ressources** (environ 40 %) se planifient en heures réparties sur une période ;
  - **événement libre** (salon, déplacement...) : intitulé + code d'imputation (code utilisable en « Divers »), il occupe
    de la capacité et ses heures remontent dans ce code ;
  - le planning **calcule et avertit, il ne bloque jamais** (une affectation au-delà de la capacité est acceptée).
- **Tables** (scripts SQL 08 à 12) : `pilotage_affaires`, `pilotage_charges`, `pilotage_affectations` +
  `pilotage_affectations_jours` (une ligne par jour), `pilotage_echeances_historique` (motif obligatoire),
  `pilotage_imputations` (référentiel, colonne `charge_obligatoire`).
- **Réutilisé sans copie** : activités et codes (Gestion des codes), collaborateurs, profils horaires, absences validées
  (`rh_demandes`, statut VALIDEE, motif jamais exposé), jours fériés (calculés), heures réelles (feuilles d'heures +
  historique importé, via `pilotage_realise()` : « 1530R1 » compte dans l'affaire 1530).
- **Définitions** : Chiffré = heures chiffrées ; Réalisé = heures imputées sur le numéro (+ heures déjà réalisées au
  départ) ; Reste = chiffré - réalisé ; Dépassement = réalisé - chiffré (aussi sur une affaire livrée) ;
  Planifié = heures affectées à partir d'aujourd'hui ; Non affecté = reste - planifié ; Capacité = horaire du profil -
  jours fériés - absences validées ; Disponible = capacité - affecté. L'encadrement n'entre pas dans la capacité de l'équipe.
- **Pages** : portefeuille (`/pilotage`), déclaration (`/pilotage/nouvelle`), fiche (`/pilotage/affaire/[id]` : charge par
  activité, affectations, échéance avec motif, historique), planning visuel (`/pilotage/planning` : frise 2 / 4 / 8
  semaines, jalons, absences, fériés, surcharges), charge par ressource (`/pilotage/ressources` : tableau d'une semaine,
  déplacement d'heures), imputations (`/admin/imputations-pilotage`).
- **Code** : `lib/pilotageCalculs.ts` (budgets, états), `lib/pilotagePlanning.ts` (fériés, capacités, répartition,
  charge par semaine, frise, déplacement), `lib/pilotageDonnees.ts` (chargement), `components/pilotage/*`.
- **A venir** : bilans par imputation (% PE / PI / BE par personne), alertes de planning plus fines, puis
  « Ma feuille de route » (vue du planning filtrée sur la personne).

## Organisation du tableau de bord

- **Mon espace (tous)** : Ma semaine, Mes feuilles, Bilan affaire (pour tout le monde), RH.
- **ADMIN et RESPONSABLE** : Pilotage BE (portefeuille, nouvelle affaire, planning des affaires, charge par ressource) et
  Suivi des équipes (feuilles collaborateurs, bilan RH mensuel, export Excel).
- **ADMIN seulement** : suivi rapide et à traiter ; Administration (collaborateurs, rythmes horaires, codes, imputations
  des affaires, activités, validation RH) ; Analyse (analyse de charge, bilan activités, export IA) ; Données (import
  historique).
- « Mon bilan » n'est plus proposé aux collaborateurs (un NI élevé peut stresser) : la page est réservée aux ADMIN en
  attendant une décision.

## Mon bilan (page personnelle, réservée aux ADMIN pour le moment)

- Page `/mon-bilan` : ma répartition du temps (CBE vendus, DBE, CN, Divers de production, NI, Formation FI / FO,
  non expliqué) sur la période choisie (mois, exercice, année, 12 derniers mois), mes affaires, l'évolution mois
  par mois. Seules les données de la personne connectée sont lues.
- Mêmes définitions que Bilans : classement dans `lib/categoriesBilan.ts` (la page Bilans conserve sa propre copie
  de ces règles ; toute évolution des définitions doit être faite aux deux endroits, ou unifiée).
- Ne reprend pas : saisie et compteur (Ma semaine), liste des feuilles (Mes feuilles), congés et RTT (RH).
- Une personne exclue des statistiques (encadrement) voit ses heures sans capacité ni taux.

## Pilotage BE (module en construction)

Planning prévisionnel et suivi des DBE (offres) et des CBE (réalisation), exploitant les données existantes sans les
copier. Maquettes validées : canevas « Pilotage BE — maquettes des écrans ».

- **Accès** : réservé aux ADMIN et aux RESPONSABLE, qui voient et modifient (droit `piloterBE`, fonction SQL
  `polynov_peut_piloter()` ; la lecture passe par `polynov_peut_voir_pilotage()`, script 11). Les collaborateurs n'y ont
  accès ni par les pages ni par les données. Suppression d'une affaire et gestion des imputations : ADMIN seulement.
- **Saisie** : les affaires sont déclarées dans l'application (`/pilotage/nouvelle`) : numéro (chiffres seuls, comme dans
  les feuilles d'heures), descriptif sans nom de client, **imputation** (menu BE / PE / PI / Scan / Négoce / IG, liste
  gérée dans Administration > Imputations des affaires), responsable, heures chiffrées par activité (code facultatif).
  L'import depuis le fichier Excel « Suivi d'affaire BE » est mis de côté (voir `docs/futur/`).
- **Tables** (scripts SQL 08, 09, 10) : `pilotage_affaires`, `pilotage_charges`, `pilotage_affectations` +
  `pilotage_affectations_jours` (événements libres avec intitulé et code d'imputation), `pilotage_echeances_historique`
  (motif obligatoire), `pilotage_imputations` (référentiel des imputations d'affaire).
- **Réutilisé sans copie** : activités et codes (Gestion des codes), collaborateurs, profils horaires, absences validées
  (`rh_demandes`), heures réelles (feuilles d'heures + historique importé, via `pilotage_realise()` : « 1530R1 » compte
  dans l'affaire 1530).
- **Définitions** : Chiffré = somme des heures chiffrées ; Réalisé = heures imputées sur le numéro (+ heures déjà
  réalisées au départ) ; Reste = chiffré - réalisé ; Dépassement = réalisé - chiffré (aussi sur une affaire livrée).
- **Pages réalisées** : portefeuille (`/pilotage`), déclaration, fiche (`/pilotage/affaire/[id]` : charge par activité,
  échéance avec motif, historique), imputations (`/admin/imputations-pilotage`). Calculs dans `lib/pilotageCalculs.ts`.
- **Règles** : le logiciel calcule et alerte, il ne bloque jamais ; « Disponible » = capacité - affecté ;
  l'encadrement (hors statistiques) n'entre pas dans la capacité de l'équipe.
- **A venir** : affectations, charge par ressource, planning visuel, alertes de planning, bilans par imputation
  (% PE / PI / BE par personne, dans « Mon bilan » et Bilans), puis « Ma feuille de route ».

## Conventions de code

- Chaque page de `app/` est un composant client avec ses styles dans `const styles`.
- En-tête commun : `components/EnTetePage.tsx` (Précédent + Tableau de bord).
- Contrôle d'accès de page : `components/GardeAcces.tsx` + `lib/droits.ts`.
- Les pages importent le client Supabase depuis `@/lib/supabase`.
- Scripts SQL de référence : dossier `sql/` (à exécuter dans l'éditeur SQL Supabase).

## A compléter (règles non déduites du code)

- Transmission à la RH externe et rôle exact du service RH.
- Liste officielle des types d'affaire, des codes d'absence et des activités.
- Règles de paiement des heures supplémentaires.
