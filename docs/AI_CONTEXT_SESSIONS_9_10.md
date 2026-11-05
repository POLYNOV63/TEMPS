<!-- SESSIONS_9_10 : début (section remplacée à chaque mise à jour par outils/maj-contexte-ia.mjs) -->
## Mises à jour des sessions 9 et 10 (novembre 2026)

### Méthode de travail (à garder)
- PLG n'est pas développeur : explications pas à pas, commandes PowerShell prêtes à copier.
- Livrables : un ZIP par sujet, décompressé à la racine ; un script `outils/maj-xxx.mjs` + `maj-xxx.json`
  (paires cherche / remplace exactes, un MARQUEUR par fichier pour ne pas appliquer deux fois) ; puis
  `npm run build`, `git add -A`, `git commit`, `git push` (Vercel déploie).
- SQL numérotés dans `supabase/NN_xxx.sql`, exécutés à la main dans Supabase › SQL Editor. Installés : **1 à 85**.
- Fonctions Edge : code complet livré, collé dans Supabase › Edge Functions › Code, puis Deploy.
- Toute lecture du réalisé se fait par paquets de 1 000 lignes (pagination Supabase).

### Droits et navigation
- Relevé PE / PI : RESPONSABLE (FVI, MMO) au niveau 1. Planning par ressource (sans pourcentages) et bilan
  d'affaire ouverts à tous. Le n° d'affaire au planning mène au bilan.

### Planning des affaires (`app/pilotage/affaires/page.tsx`)
- Familles (commande + avenants) sous un en-tête bleu ; « + planifier X h » par activité ; « reste à planifier »
  cliquable ; 👤 responsable d'affaire ; intention de commande = n° surligné en jaune.
- Congé validé : jours hachurés gris écrits « Absent » (« Férié » pour un férié). Alerte rouge en haut
  (CONFLITS_CONGES) : affectations de FORFAIT qui tombent sur un congé validé, sur la période affichée.
- Planning par ressource : chaque jour de congé validé = case grise « Absent » (verticale) derrière les barres.

### Relevé PE / PI (`app/pilotage/prestations/page.tsx`)
- Le relevé fait foi ; il alimente le planning par `prestation_synchroniser_planning` (SQL 83).
- Case « CP » (code seul) = absent, non facturé.
- Case **« 7A »** (aussi « 7 Abs. », « 7 CP ») = code ABS + heures : **absent mais FACTURÉ** (demande du client).
  Compté dans le mois, le montant, l'export, la clôture et le consommé de la commande ; **jamais reporté au
  planning** (la fonction SQL ignore les cases qui portent un code). L'export met les heures, pas le code.

### Bilan d'affaire (`app/affaires/bilan/page.tsx`)
- « Commande et avenants » : pointé réparti sur la famille (commande, puis avenants dans l'ordre), planifié,
  reste à planifier. Tableau **Par code** (EM, MP, DT…) : libellé, activité, heures, part du réalisé, personnes.

### En-cours et finances (rappel des décisions de la session 9)
- En-cours à une date : seules les commandes REÇUES à cette date ; intentions hors en-cours (listées pour mémoire) ;
  ECH1 = acompte, non déduite du travail fait ; négoce et achats totalisés sur toute la famille ; PE / PI : tout le
  travail fait jusqu'à la date et pas encore facturé. Avancement estimé (SQL 79) et achats reçus (SQL 80) saisis
  par ADMIN et RESPONSABLE.

### RH
- **Suivi RH** (`/admin/suivi-rh`) : saisie globale des soldes donnés par le service RH (le solde saisi devient le
  solde d'aujourd'hui) ; droits négatifs permis (SQL 81, borne -100) ; tableaux triés par nom de famille.
- **Période CP** = période d'acquisition du 1er juin au 31 mai (SQL 82) ; purement informative.
- **Mon espace RH** (`/RH`) : **forfait jours = a des RTT** (rtt_acquis ≠ 0 ou RTT posés) → ni compteur de
  récupération, ni heures sup, ni demande de récupération ; les autres n'ont pas de RTT. Tuiles sur une rangée.
  Compteur = `compteur_apres` de la dernière feuille **validée** (statut A_TRAITER), sinon
  `compteur_recuperation_initial` de l'exercice. Ma semaine recalcule `compteur_avant` à chaque enregistrement.
- **Validation RH** (`/admin/Valid_RH`) : un bouton « Traiter → » (en attente) / « Ouvrir » ; suppression
  définitive en bas de la fenêtre, en tapant SUPPRIMER (préférer « Annuler la demande »).
- **Congé validé → planning** (`components/rh/ImpactCongePlanning.tsx`) : à la validation (hors RE), ou par
  « 📅 Planning » sur un congé validé : Décaler à la fin / Retirer seulement / Ne rien toucher. Forfaits : heures
  retirées des jours de congé et replacées après la fin (`pilotage_enregistrer_affectation`). Relevé : cases du
  congé → « CP », heures replacées après le dernier jour rempli. Un mois clôturé n'est jamais touché ; une case
  « absent facturé » est ignorée.
- **E-mails** : `notifier-demande-rh` contient un bouton vers `/admin/Valid_RH?demande=<id>` (secret `APP_URL`
  facultatif, défaut https://temps-rho.vercel.app) ; `envoyer-demande-rh` écrit les **dates de prise en toutes
  lettres** (du … au … inclus, demi-journée signalée), le type en clair, les dates dans l'objet.

### Notes de frais (SQL 84 et 85)
- Page `/notes-frais` (Mon espace RH › « 🧾 Mes notes de frais ») ; paramètres `/admin/notes-frais` (ADMIN).
- Tables : `nf_baremes`, `nf_profils` (véhicule, puissance, km domicile → Polynov retenus), `nf_notes` (une par
  personne et par mois, statut BROUILLON / TRANSMISE, version), `nf_deplacements`, `nf_frais`, `nf_parametres`
  (`email_rh`) ; stockage `notes-frais` (dossier = auth.uid()) ; `nf_est_admin()` = rôle ADMIN.
- Calcul (note Excel CT-NFP) : déplacement au départ du domicile = max(0, km A/R − 2 × km domicile → Polynov)
  × prix au km ; départ Polynov = km A/R × prix ; régulier = km A/R par jour × nombre d'A/R × prix (même retrait
  au départ du domicile) ; frais annexes sur justificatif ; total.
- **Pas de validation** : « Transmettre » envoie directement au service RH (`nf_parametres.email_rh`, modifiable
  par ADMIN), ADMIN et collaborateur en copie. L'e-mail contient TOUT le détail ; pièces jointes : le gabarit
  `public/gabarits/note-de-frais.xlsx` rempli (prix du barème recopiés dans l'onglet Prix-Km) et les justificatifs
  (photos réduites ; ~3 Mo au plus par envoi). 8 déplacements occasionnels au plus (gabarit) ; frais annexes
  regroupés sur la ligne unique du gabarit (détail complet dans l'e-mail).
- Une note reste modifiable ; « Retransmettre » envoie la version n + 1, qui remplace la précédente.
- Fonction Edge `envoyer-note-frais`. Barème kilométrique modifiable par ADMIN (5 puissances fixes).

### En suspens
- Vérifier que la fenêtre « Le congé dans le planning » s'ouvre bien à la validation (premier essai : rien ;
  déploiement pas encore en ligne ?).
- Tester la note de frais de bout en bout (adresse de test dans les paramètres, puis remettre le service RH).
- À décider : plafonds par nature de frais, correction d'une note par un ADMIN ; congés EN ATTENTE dans l'alerte
  de la fenêtre d'affectation.
- Suivi d'affaire BE (montants à 0 sur devis perdus) ; prévisions PE / PI (planification longue sans commande).
- Vérifier que FVI / MMO voient bien le relevé PE / PI (droits en base).
- Renouveler le secret de l'application Entra « POLYNOV Mailer » avant le 14/10/2028.
<!-- SESSIONS_9_10 : fin -->
