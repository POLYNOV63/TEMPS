# Espace POLYNOV (ex POLYNOV-TEMPS) - Contexte du projet

Application interne de POLYNOV (bureau d'études) : feuilles de temps hebdomadaires, imputations par affaire / activité,
espace RH (congés, RTT, récupération, notes de frais), pilotage des affaires du BE (suivi, devis, planning, ressources,
fiche affaire), prestations PE / PI, facturation, finances et analyses. Interface en français.
Mis à jour le 15/11/2026 (sessions 11 et 12 : fiche affaire, page Ressources, analyses, regroupement des pages).

## Qui travaille dessus, et comment

- **PLG** (responsable technique, administrateur Office 365, double casquette technique et chiffre d'affaires) pilote le
  projet. **Il ne code pas** : explications pas à pas, niveau débutant, en français, sans jargon.
- **Travail direct dans le projet (VS Code / Claude Code)** : l'IA modifie les fichiers elle-même, lance `npm run build`
  (TypeScript strict : c'est ce qui bloque Vercel) et corrige jusqu'à ce que ça passe, puis `git add` / `git commit`.
  **Puis `git push` (= mise en ligne par Vercel) systématiquement, sans redemander** (décision de PLG du 15/11/2026) ;
  jamais de push si le build échoue. Deux PC (`C:\Users\plgaufier\TEMPS` et
  `C:\Users\zoul\Documents\POLYNOV\polynov-temps`) : toujours `git pull` avant de commencer.
- **Ancienne méthode, si l'IA n'a pas accès au projet** : un ZIP au nom du sujet, avec seulement les fichiers modifiés,
  décompressé à la racine ; pour un fichier qui a pu bouger chez PLG, un script `outils/maj-xxx.mjs` relançable, « tout
  ou rien » (affiche OK / Déjà fait / ÉCHEC) ; commandes git en UN seul bloc PowerShell.
- **Maquette d'abord** : avant toute grosse refonte d'écran, une maquette HTML à valider par PLG.
- **Moins de pages** : PLG préfère de vraies fusions de pages (blocs les uns sous les autres) aux menus à onglets ; une
  ancienne adresse fusionnée devient une page de redirection (`redirect(...)`), souvent vers une ancre (`#bloc`).
- **SQL** : scripts numérotés `supabase/NN_objet.sql`, lancés à la main dans Supabase › SQL Editor, relançables sans risque
  (`create or replace`, `if not exists`). **Installés : 1 à 100.** Toujours dire l'ordre : SQL avant le code qui en dépend.
- **Fonctions Edge** : code complet, collé dans Supabase › Edge Functions › Code, puis Deploy.
- **Export IA** (`/admin/Export-IA`, `lib/exportIA.ts`, route `app/api/Export-IA`) : produit ce contexte (léger ≈ 230 Ko,
  complet ≈ 1 Mo). Ce fichier `docs/AI_PROJECT_CONTEXT.md` en est la partie « règles métier » : le tenir à jour.

## Stack technique

- Next.js 16 (App Router, TypeScript, Turbopack), composants client, styles en ligne. Charte : rouge `#c00000`,
  police Calibri. Composants communs : `components/EnTetePage.tsx`, `components/GardeAcces.tsx`,
  `components/pilotage/ui.tsx` (C, page, Message, Pastille, Tuile, Modal, BadgeType), `lib/excelPolynov.ts` (exceljs),
  `xlsx-js-style` (export hebdomadaire des heures).
- Supabase (plan gratuit, **aucune sauvegarde automatique**) : Postgres, Auth, RLS, Edge Functions, pg_cron + pg_net.
  Déploiement Vercel (https://temps-rho.vercel.app).
- Connexion Microsoft 365 uniquement (provider `azure`), rattachement à `collaborateurs` par e-mail au premier login.

## Règles techniques à respecter partout

- **Limite de 1 000 lignes** : Supabase coupe chaque réponse à 1 000 lignes. Toute lecture potentiellement longue
  (feuilles, jours, imputations, réalisé, suivi) se fait **par paquets** (`.range(a, a + 999)` en boucle, ou `chargerTout`
  de `lib/pilotageDonnees.ts`). Un filtre `.in("id", liste)` se fait **par paquets de 150 identifiants** (URL trop longue).
- **Délais** : le **délai estimé** (`suivi_lignes.date_livraison_estimee`) fait foi ; le délai client (`delai`) est pour
  mémoire. Vocabulaire : « délai », pas « échéance ». Une date ne s'écrit jamais en direct dans
  `pilotage_affaires.echeance` : toujours `pilotage_changer_echeance(p_affaire_id, p_nouvelle_date, p_motif, p_commentaire)`.
- **Pointé / planifié** : le jour même est déjà dans le pointé ; le **planifié « à venir » commence demain** (`jour > aujourd'hui`)
  pour ne pas compter deux fois la journée en cours.
- **Coût du temps = coût horaire de structure** (`indicateurs_couts.cout_horaire`, par exercice = année de novembre, saisi
  dans Rentabilité), le même pour tout le monde.
- **Exercice** : du 1er novembre au 31 octobre ; il porte l'année de novembre.
- **Capacité** : 35 h par semaine pour tout le monde dans les analyses ; quelqu'un à 37,5 h produit plus, c'est normal
  (les % peuvent dépasser 100 %).
- **Couleurs des activités, communes à toutes les pages** : Méca `#c00000`, Elec `#34506b`, Calcul `#6b58a8`,
  Scan `#e08a1e`, Négoce `#8d6e63` ; absences `#1f9d8b`. Niveaux N1 `#c8e6c9`, N2 `#66bb6a`, N3 `#2e7d32`.
- **PE / PI** : unité (jour ou heure) et base horaire viennent du relevé (`prestation_lignes`) ; une PE / PI se reconnaît à
  l'imputation de sa commande de base (toute la famille suit).

## Rôles et droits

Source côté interface : `lib/droits.ts` (`peut(role, droit)`, `pageAutorisee`, `pageReglee`, liste `PAGES`) ; réglages
modifiables par l'ADMIN dans `/admin/droits` (table `polynov_droits_roles`, SQL 97, `lib/droitsRoles.ts`). Une page doit
figurer dans `PAGES` pour être réglable. Protection réelle : RLS et fonctions SQL (`rh_est_admin()`,
`polynov_est_exporteur()`, `polynov_peut_piloter()`, `polynov_peut_voir_pilotage()`, `polynov_mon_collaborateur_id()`).

| Rôle | Qui | Accès |
|---|---|---|
| COLLABORATEUR | l'équipe | Mon espace (Ma semaine, Mes feuilles, Mon bilan, RH, notes de frais, feuille de route, Guide) ; Planning des affaires, Ressources (planning seul, sans %) et Fiche affaire en lecture, sans montants |
| RESPONSABLE | FVI, MMO | + Pilotage BE (affecter, suivi des affaires et devis, feuilles de route), relevé PE / PI, feuilles des collaborateurs, Bilan RH mensuel et export des heures |
| ADMIN | PLG, AMA | Tout ; validation RH réservée à PLG et AMA |
| DIRECTION | Président, adjoint | Lecture : Finances, Facturation, Rentabilité, Fiabilité, Suivi des devis (statistiques), Planning, Ressources (avec charge, disponibilités et composition), Fiche affaire. Pas le Suivi des affaires. Fiche DIRECTION invisible partout (SQL 56) |

Droits utiles (réglages d'origine, modifiables dans Droits d'accès) : `voirPlanning` (tous) ; `piloterBE`,
`relevePrestations`, `bilanRH`, `exporterExcel`, `suiviDevis` (à partir de RESPONSABLE) ; `chargeRessources`, `indicateurs`
(ADMIN + DIRECTION) ; `montantsAffaires`, `administration` (ADMIN).

## Navigation

- **Bandeau du Pilotage** (`components/pilotage/OngletsPilotage.tsx`), dans l'ordre du travail : Suivi des affaires,
  Suivi des devis, Planning des affaires, Relevé PE / PI, **Ressources** | Facturation, Finances, Rentabilité, Fiche
  affaire | Feuilles de route | Analyse de capacité, Analyse par client, Fiabilité du chiffrage. Chaque onglet n'apparaît
  qu'aux rôles qui ont son droit.
- **Bandeau RH** (`components/OngletsSection.tsx`) : Feuilles d'heures, Validation RH, Absences et compteurs, Notes de
  frais, Bilan RH mensuel.
- **Tableau de bord** (`app/dashboard/page.tsx`) : « Mon espace », puis **4 tuiles de domaine** sur une ligne, chacune
  avec ses sous-liens (filtrés par `pageAutorisee`) : **Pilotage** (Suivi des affaires, devis, Planning des affaires,
  Ressources, Relevé PE / PI, Fiche affaire), **RH** (Feuilles, Validation RH, Absences et compteurs, Récupérations, Notes
  de frais, Bilan RH et export ; badges « feuilles à relancer » / « demandes à valider »), **Finance** (Finances,
  Facturation du mois, Rentabilité), **Analyses** (ADMIN : Capacité, Fiabilité du chiffrage, Par client). Plus de tuile
  Exports. La Direction voit aussi les graphiques de disponibilités (`lib/disponibilitesActivites.ts`,
  `components/analyse/GraphiquesDisponibilites.tsx`) et la vignette de facturation.
- **Anciennes adresses redirigées** : `/pilotage/ressources` → Ressources `#charge` ; `/analyse/charge-activites` →
  Ressources `#disponibilites` ; `/analyse/effectifs` → Ressources `#composition` ; `/admin/export-excel` → Bilan RH
  `#export` ; `/analyse/pointage` → Suivi des affaires ; `/pilotage/indicateurs` → Suivi des devis (onglet Statistiques) ;
  `/admin/bilan-activites` → Analyse de capacité ; `/pilotage/planning` → Planning des affaires ; `/pilotage/affaire/[id]`
  → Fiche affaire.

## Feuille de temps (Ma semaine)

- Une feuille = une semaine. Lundi à vendredi affichés ; le week-end est masqué et n'est enregistré que s'il est renseigné.
- **Rythme** : horaires du jour = profil horaire en vigueur à la date de la semaine (`historique_profils_horaires`), à défaut
  le profil du collaborateur, à défaut 7,5 / 7,5 / 7,5 / 7,5 / 5 h.
- **Jours fériés** français calculés par la date (non saisissables) ; code technique FE (hors bilan). Aucune imputation un
  jour férié.
- **Absences** (codes `codes_imputation`, catégories ABSENCE / HORS_BILAN) : RE (récupération, en heures, débitées du
  compteur), RT (RTT : journée ou ½ journée), CP (journée ou ½ journée), VM / AI / AA (absences partielles en heures). Les
  autres absences sont des journées complètes : présence ABSENT, ticket décoché, aucune imputation.
- **Imputations** : type CBE, DBE ou Divers. CBE / DBE : activité obligatoire, numéro d'affaire sur 4 chiffres, code,
  heures (description et sous-dossier facultatifs). CBE : codes selon l'activité (`activites_codes`, `autorise_affaire`).
  DBE : code DT. Divers : code Divers (`autorise_divers`), sans activité ni numéro.
- **Heures** : objectif du jour = rythme - absences. Manquantes et supplémentaires calculées jour par jour. Base normale
  35 h ; pour un profil à 37,5 h l'écart avec 35 h compte en heures sup.
- **Enregistrement** : brouillon (BROUILLON) avec sauvegarde automatique ; validation définitive (A_TRAITER, fonction
  `valider_feuille_heures`) seulement si chaque journée est complète. L'ADMIN peut corriger une feuille envoyée et la
  verrouiller (`verrouillee`).
- **Clôture mensuelle** : la répartition des heures sup cumulées (compteur / payées) est demandée sur la semaine qui contient
  le vendredi de clôture du mois (dernier jour du mois : lundi à jeudi → vendredi suivant ; vendredi → ce jour ; week-end →
  vendredi précédent). Le cumul part de la semaine suivant la clôture précédente, feuilles A_TRAITER seulement.
- **Tickets restaurant** : cochés par défaut les jours travaillés ; décochés pour une absence complète, une invitation client
  ou un paiement par la carte bancaire POLYNOV.
- **Saisie en grille** (`lib/grilleSemaine.ts`, `app/ma-semaine/GrilleSemaine.tsx`) : une affaire par ligne, un jour par
  colonne ; activité, code et heures dans chaque case ; alertes de données manquantes seulement à l'enregistrement ou à la
  validation ; ligne des jours et cartes « Objectif » fixes en haut. Saisie simplifiée possible par collaborateur
  (`collaborateurs.saisie_simplifiee`, `SemaineSimplifiee.tsx`).
- **Aides** : copier-coller d'imputations, de journées et d'absences ; affaires récentes ; reprise de la semaine
  précédente ; application des congés validés. **Téléphone** (< 760 px) : un jour à la fois.

## Compteur de récupération

- **Chaîne de feuille en feuille** : compteur avant = compteur après de la dernière feuille A_TRAITER précédente ; compteur
  après = avant - RE prises + part des heures sup mise au compteur **à la clôture mensuelle seulement**. Pas de plafond haut
  (avertissement au-delà de +30 h).
- **Point de départ** : `rh_droits.compteur_recuperation_initial` de l'exercice (première feuille seulement), à défaut
  `collaborateurs.compteur_recuperation`.
- **Ajustement forcé** (`rh_regulariser_compteur`, motif obligatoire, tracé dans `rh_compteur_regularisations`) : depuis
  Absences et compteurs (`/admin/suivi-rh`). La page `/admin/compteurs` (« Récupérations ») existe encore ; doublon probable
  d'Absences et compteurs, à examiner avant de la supprimer.

## RH

- **Absences et compteurs** (`/admin/suivi-rh`, ADMIN) : page unique des droits RH par exercice : CP (sur la période
  d'acquisition 1er juin → 31 mai, réglable), RTT, compteur (initial, RE+, RE−, ajustements, actuel), HS payées ;
  historique daté par personne ; saisie des droits, ajustement du compteur, CP exceptionnels ; saisie globale des soldes
  donnés par le service RH (le solde saisi devient le solde d'aujourd'hui).
- **Soldes CP / RTT** = droits `rh_droits` - demandes validées ou transmises - demandes en attente.
- Types de demande : CP, RTT, RE (0,5 à 7,5 h), CP exceptionnel avec ou sans justificatif. Pas de demi-journée un vendredi ;
  une demi-journée fait entre 3 h et 4,5 h.
- **Mon espace RH** (`/RH`) : forfait jours = a des RTT → ni compteur, ni heures sup, ni récupération.
- **Validation RH** (`/admin/Valid_RH`, PLG et AMA) : sert à valider les **demandes d'absence** (ce n'est pas un doublon des
  feuilles) ; le premier qui valide clôt ; décision transmise par mail aux services du siège. À la validation d'un congé,
  fenêtre « Le congé dans le planning » (`components/rh/ImpactCongePlanning.tsx`) : décaler, retirer ou ne rien toucher.
- **Bilan RH mensuel** (`/admin/bilan-rh`, droit `bilanRH`) : par collaborateur et par cycle mensuel (de la clôture
  précédente à la clôture du mois) : TR, télétravail, HS (total, compteur, payées), compteur fin, absences à justifier, état
  des feuilles ; export Excel du bilan ; « bilan envoyé » (`rh_bilans_envoyes`, rappel). **En bas de la même page** (ancre
  `#export`, droit `exporterExcel`) : le **récapitulatif d'heures d'une semaine** (`components/rh/ExportHebdoExcel.tsx`,
  gabarit `public/Recuperation heures pour export.xlsx`), ex-page Export Excel.
- **Notes de frais** (SQL 84 et 85) : `/notes-frais` (collaborateur), `/admin/notes-frais` (paramètres),
  `/admin/suivi-notes-frais` (suivi). « Transmettre » envoie directement au service RH (`nf_parametres.email_rh`) avec le
  gabarit `public/gabarits/note-de-frais.xlsx` rempli et les justificatifs ; fonction Edge `envoyer-note-frais`.
- **Collaborateurs** : fiche, activités principales et d'appoint (`collaborateurs_predominances`), niveau N1 / N2 / N3
  (`collaborateurs_niveaux`, SQL 86 ; jamais affiché nominativement hors ADMIN), « inclus dans les statistiques »
  (`inclus_statistiques` : l'encadrement AMA, PLG en est exclu), dates d'entrée et de sortie.

## Suivi d'affaire BE (classeur Excel) : il fait foi

- Classeur sur le serveur de l'entreprise. Lecture par `lib/suiviAffaires.ts` et la fonction Edge
  `synchroniser-suivi-affaires`, depuis `/admin/synchro-suivi-affaires` (encore lancée à la main). Tables `suivi_lignes`,
  `suivi_lignes_montants`, `suivi_clients` (nom abrégé), `suivi_synchronisations`, `suivi_correspondance_activites`,
  `suivi_exclusions`. Colonnes de montants par activité : `montant_meca`, `montant_calcul`, `montant_elec_pneu`,
  `montant_scan`, `montant_negoce`, `montant_achats`… ; heures chiffrées par discipline (la colonne « Heures autre » est
  devenue « Heures négoce »).
- Numérotation : DBExxxx = devis ; CBExxxx = commande, `R1`, `R2` = avenants, `ECH` / `LOT` = découpages du montant
  (acomptes, livraison, solde), jamais additionnés. ARC Louxor = n° de l'ERP du siège.
- `suivi_maj_pilotage` crée / met à jour `pilotage_affaires` : **une ligne par commande** (base et chaque avenant) ;
  Commande reçue → EN_COURS, Intention de commande → EN_ATTENTE, Livrée → LIVREE. Un « Devis ouvert » crée son DBE (SQL 59).
- **Regroupement de clients** (SQL 100, table `client_regroupements(nom, groupe)`) : MICHELIN URG / LAD / COM → MICHELIN,
  IMERYS (RIOM ES MTGNE) → IMERYS ; les noms identiques se regroupent d'eux-mêmes. S'applique aux affaires à venir aussi.

## Pilotage BE

- **Suivi des affaires** (`/pilotage`) : une ligne par commande ; alertes et dépassements sur les affaires actives ;
  « Délai dépassé » ; période, activité, export (reprend l'ancienne Analyse du chiffré).
- **Suivi des devis** (`/pilotage/devis`) : liste (ADMIN, RESPONSABLE ; relances) et onglet Statistiques (ex-Indicateurs
  commerciaux : transformation, prise de commande, top clients, délai de réponse).
- **Planning des affaires** (`/pilotage/affaires`) : toute commande EN_COURS / EN_ATTENTE ; groupes Affaires, PI, PE ; tri
  par numéro, avenants sous leur base. Barre d'affaire = pointé (foncé) + planifié (clair) sur le chiffré.
  - **Dates de la barre d'un forfait** : de la réception de commande (ou de la date de création pour une intention) au
    **délai estimé** ; **drapeau rouge = délai estimé, drapeau bleu = délai client** (lus dans `suivi_lignes`).
  - **Navigation** dans la case en haut à gauche de la grille ; la frise des mois remplace l'ancienne ligne « Affaires ».
  - **Reste à planifier** : compté à partir de demain, arrondi au centième (plus de quart d'heure).
  - **Affecter** (`components/pilotage/AffecterDialog.tsx`) : quantité pré-remplie au centième ; % du temps calculé sur la
    **capacité réelle** de la personne ; une semaine en surcharge liste les **affaires en cause**.
  - **« Heures sur une période »** (`AffectationDialog.tsx`, `remplirHeures` de `lib/pilotagePlanning.ts`) : des
    **journées pleines** à la base horaire de la personne, la dernière avec le reste (ex. 25 h = 7,5 + 7,5 + 7,5 + 2,5) ;
    message si ça ne tient pas dans la période. Heures arrondies au centième (`arrondi2`).
  - Un clic sur une PE / PI ouvre le **relevé filtré sur l'affaire**.
- **Relevé PE / PI** (`/pilotage/prestations`, ADMIN et RESPONSABLE) : il fait foi ; tables `prestation_lignes`,
  `prestation_mois` (valide = mois clôturé = facturé, `montant_fige`), `prestation_saisies`, `prestation_historique`.
  Alimente le planning (`prestation_synchroniser_planning`, SQL 83). Case « CP » = absent non facturé ; case « 7A » =
  absent mais FACTURÉ. Import du classeur « Suivi des prestations » : `/admin/import-prestations`.
- **Ressources** (`/pilotage/planning-ressources`) : une seule page, de haut en bas :
  1. **Planning par personne** (tous, droit `voirPlanning`) : barres des affaires, absences, fériés, réalisé des semaines
     passées ; aucun pourcentage. Un clic sur une barre ouvre l'affaire au planning.
  2. Pour le droit `chargeRessources` : **Charge de l'équipe** (`components/ressources/ChargeEquipe.tsx`, ancre `#charge`) :
     bandeau de la semaine (affecté / capacité, charge, disponible par niveau, surcharges), détail par personne avec
     **« Déplacer… »** des heures vers une autre semaine, répartition CBE / DBE / Divers par activité sur 12 semaines ;
     **Disponibilités par activité** (`DisponibilitesActivites.tsx`, `#disponibilites`) : Méca, Elec, Calcul, composition
     (personnes et niveaux) puis graphiques capacité / occupé / disponible, récapitulatif replié.
  3. Pour le droit `indicateurs` : **Composition de l'équipe** (`CompositionEquipe.tsx`, `#composition`, repliée ; ex-
     Cartographie) : activités, niveaux, relève, polyvalence, PE / PI / BE, fiches à compléter.
  La semaine analysée des blocs du bas se choisit par ◀ ▶ dans « Charge de l'équipe ». Le passé se lit dans l'Analyse de
  capacité.
- **Ma feuille de route** (`/ma-feuille-de-route`, SQL 60 et 61) : ce que le planning prévoit pour la personne, devis à
  rédiger ; responsables et ADMIN choisissent un collègue.

## Fiche affaire (`/affaires/bilan?affaire=CBE1604`)

Trois vocations : information administrative, information de production, information financière ; elle sert aussi de
bilan d'affaire et de suivi de dérive.

- **En-tête** (« bilan et dérive ») : n°, titre, client, imputation et rédacteur (trigramme) sur une ligne ; boutons
  📅 Planning et 📋 Relevé ; pastille verte « Livrée » ; **barres de dérive** par activité et au total (fait, prévu, cible)
  pour un forfait, ou barres **Relevé / Pointé** en jours pour une PE / PI ; tableau des **commandes repliable** (PE / PI :
  Commandé / Au relevé / Prévu / Face au commandé, « ✓ soldé » seulement si livrée ; forfait : Chiffré). Intention de
  commande en jaune.
- **Onglet Production** (par défaut, **aucun euro**) : affaires et heures, par activité, par personne, par mois, par code,
  par sous-dossier, planifié à venir.
- **Onglet Financier** (`?vue=financier`, droit `montantsAffaires`, CBE seulement ;
  `components/BilanFinancierAffaire.tsx`) : grande tuile **Marge projetée à la fin** (€ et %), qui devient « Marge
  réelle » quand tout est livré ; tuiles Commandé, **Facturé à ce jour** (« on fait la banque » : engagé pas encore facturé,
  ou facturé d'avance), Déjà engagé, Encore à engager, Achats. PE / PI : facturation mois par mois, une colonne par
  commande (« CBE1715 (53 j) »), état, pointé, écart pointé / relevé (mois en cours coupé en fait / prévu). Forfait :
  rythme de facturation avec « Commande → facture » (jours de la réception à la facture). Tableau « Taux de vente et marge
  projetée, par activité » + Négoce, temps hors activités, non ventilé ; son total = la grande tuile.
- `components/HistoriquePEPI.tsx` exporte `chargerCommandesPEPI(base)` (commandes de la famille, mois FACTURE /
  A_FACTURER / PREVU, heures, montants).

## Facturation, finances et analyses

- **Facturation du mois** (`/analyse/facturation`, `lib/facturationMois.ts`) : contrôle et envoi au service compta ;
  forfaits livrés et prévus du mois, PE / PI du relevé ; Total facturable / Facturé / Reste à facturer ; export Excel.
- **Finances** (`/analyse/finances`, `lib/finances.ts`, `components/finances/TrameCA.tsx`) : CA de l'exercice mois par mois,
  réalisé + attendu = atterrissage face au prévisionnel ; la coche « Afficher les % du CA » déplie les **activités** avec leur
  part du CA. Montants cliquables (`DetailMontant.tsx`).
- **Rentabilité** (`/analyse/rentabilite`) : forfaits **toutes commandes livrées** dans l'exercice et mois PE / PI facturés ;
  taux vendu, taux obtenu, coût (heures × coût de structure), marge, par activité et affaire par affaire. Saisie du coût
  horaire de structure (ADMIN).
- **Fiabilité du chiffrage** (`/analyse/fiabilite-chiffrage`) : chiffré face au pointé des forfaits ; PE / PI exclues
  d'après l'imputation de la commande de base ; colonnes triables, colonne Client.
- **Analyse par client** (`/analyse/clients`, ADMIN, SQL 100 `analyse_heures_clients(p_debut, p_fin)` security definer,
  contrôle `rh_est_admin()`) : par exercice et par client regroupé : devis, transformation, commandes reçues, CA facturé,
  heures, marge ; détail d'un client : heures par activité, répartition **PE / PI / BE / Négoce / Scan** en heures et en CA,
  temps de devis à part, liste de ses affaires.
- **Analyse de capacité** (`/admin/bilans`, ADMIN ; `components/analyse/BilanActivites.tsx`) : le passé. Taux d'occupation
  et heures improductives ; capacité à **35 h** (`total_theorique × 35 / horaire du profil`) ; **« CBE produit »** (produit,
  pas forcément vendu) ; DBE ; Divers de production ; CN (commercial) compté dans le travaillé et mesuré à part ; NI = sans
  charge ; CP et EC sortis de l'analyse. Onglets Collaborateurs (avec la part des **absences**, turquoise) et Par activité ;
  lecture complète, paginée.

## Import historique (classeur « Récupération heures »)

- Un onglet par semaine (Sxx-aaaa), de S44-2024 à la dernière semaine renseignée ; blocs CODES AFFAIRES / CODES
  ADMINISTRATIFS (`historique_imputations.groupe_code`). La catégorie du code dans Gestion des codes fait foi.
- L'import Excel est prioritaire : la page propose de supprimer les feuilles du nouveau système des semaines importées
  (`purger_feuilles_semaines_importees`, archive `archive_feuilles_purgees`).

## E-mails, tâches planifiées, sauvegarde

- Microsoft Graph via la boîte partagée et l'application Entra « POLYNOV Mailer » (secrets `M365_TENANT_ID`,
  `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, **à renouveler avant le 14/10/2028**, `M365_EXPEDITEUR`). Fonctions Edge :
  `notifier-demande-rh`, `notifier-reponse-rh`, `envoyer-demande-rh`, `rappel-feuilles`, `envoyer-note-frais`.
- **Rappel du vendredi** (SQL 57) : pg_cron `rappel-feuilles-vendredi` → `rappel-feuilles`.
- `/admin/sauvegarde` : toutes les tables dans un ZIP (CSV + JSON). **À faire** : sauvegarde automatique nocturne sur le
  serveur.

## À venir / en suspens

- Agent serveur : synchronisation du Suivi d'affaire toutes les 5 min et sauvegarde nocturne.
- Regroupements de pages encore possibles : Récupérations (`/admin/compteurs`) dans Absences et compteurs ; onglets
  Collaborateurs et Par activité de l'Analyse de capacité ; doublon onglet « Feuilles de route » / feuille de route du
  tableau de bord. Rentabilité et Analyse par client restent séparées (questions différentes).
- Heures de négoce : la synchro du Suivi est peut-être à adapter (« Heures autre » devenue « Heures négoce ») ; colonnes
  « Unité de vente » / « Base horaire » du Suivi ; éventuelle colonne « Date d'intention ».
- Téléphone sur toutes les pages ; règles non écrites (paiement des heures sup, liste officielle des codes d'absence).
- Renouveler le secret de l'application Entra « POLYNOV Mailer » avant le 14/10/2028.
