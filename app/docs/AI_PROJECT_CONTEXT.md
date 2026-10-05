# POLYNOV — CONTEXTE PROJET IA

## 1. Objet

POLYNOV-TEMPS est l'application interne POLYNOV de gestion des temps et activités.
Elle remplace progressivement les feuilles d'heures Excel historiques.

## 2. Stack

- Next.js / React / TypeScript
- Supabase (authentification + PostgreSQL)
- Vercel

## 3. Architecture métier

Les éléments principaux sont :

- `collaborateurs` : identité, rôle, rythme, profil horaire, dates d'entrée/sortie, compteur de récupération.
- `feuilles_heures` : une feuille hebdomadaire par collaborateur.
- `feuilles_heures_jours` : les journées d'une feuille.
- `feuilles_heures_imputations` : les ventilations d'heures d'une journée.
- `profils_horaires` / `bases_horaires` / `affectations_bases_horaires` : référentiel des rythmes horaires.
- `codes_imputation` : source de vérité pour les codes métier et leurs contextes d'utilisation.
- `historique_imputations` / `historique_presence` / `historique_profils_horaires` : historique importé de l'ancien système.
- `rh_droits` / `rh_demandes` / `demandes_absence` : gestion RH.

## 4. Feuille hebdomadaire

Une feuille couvre 7 jours.

Le flux normal est :

1. saisie / modification ;
2. enregistrement du brouillon ;
3. validation finale ;
4. verrouillage éventuel par un administrateur.

Les imputations sont rattachées aux journées, elles-mêmes rattachées à la feuille.

Lors d'une réécriture complète d'une feuille existante, les anciennes imputations et journées doivent être remplacées proprement avant réinsertion.

Lors d'une suppression administrative, la suppression doit porter sur les imputations, puis les journées, puis la feuille. La suppression actuelle est centralisée dans la RPC PostgreSQL `supprimer_feuille_heures`.

## 5. Horaires

Rythme POLYNOV 35 h :

- lundi 7,5 h
- mardi 7,5 h
- mercredi 7,5 h
- jeudi 7,5 h
- vendredi 5 h

Rythme client 37,5 h :

- lundi 8 h
- mardi 8 h
- mercredi 8 h
- jeudi 8 h
- vendredi 5,5 h

Autre rythme 37,5 h : 7,5 h x 5 lorsque le profil le prévoit.

Les cadres au forfait ne doivent pas être ramenés artificiellement à une capacité productive standard dans les analyses qui les excluent de ce calcul.

## 6. Présence / absences

Les états de présence utilisés dans les feuilles sont notamment :

- `PRESENTIEL`
- `TELETRAVAIL`
- `ABSENT`

Codes métier importants actuellement utilisés :

- `CP` : congés payés
- `RT` : RTT / récupération selon le contexte défini dans l'application
- `RE` : récupération / heures de récupération
- `FE` : hors-bilan / jour férié, non sélectionnable comme imputation utilisateur normale
- `VM`, `AI`, `AA` : absences nécessitant une gestion horaire spécifique
- `NI` : non imputable, code administratif / Divers et non absence journalière

La classification exacte d'un code doit venir de `codes_imputation` et de ses attributs, pas d'une nouvelle règle codée en dur.

## 7. Affaires et codes

Les types d'imputation métier principaux sont :

- `CBE`
- `DBE`
- `Divers`

La table `codes_imputation` est la source de vérité pour savoir dans quels contextes un code est autorisé, s'il est vendable, actif, historique uniquement, et son ordre d'affichage.

Ne pas recréer une deuxième liste de codes en dur dans une page lorsque le comportement peut être piloté par `codes_imputation`.

## 8. Heures supplémentaires / compteur

Les heures supplémentaires peuvent être traitées selon le mode défini dans la feuille :

- `PAYE`
- `COMPTEUR`

Le compteur de récupération est conservé dans le suivi des feuilles et doit être recalculé avec prudence lors d'une validation ou d'une modification d'une semaine antérieure.

## 9. Export Excel

L'export hebdomadaire doit rester compatible avec l'ancien fichier Excel POLYNOV.

Structure historique importante :

- colonne A : nom + prénom
- colonne B : trigramme
- colonnes de ventilation affaires / administratif
- colonnes journalières de statut

Les couleurs, regroupements et règles de placement des codes sont volontairement liés au modèle Excel historique.

## 10. Principes de modification du projet

Avant toute modification :

- vérifier la structure actuelle de Supabase ;
- conserver les noms existants de tables et colonnes ;
- privilégier le code existant plutôt qu'une réécriture inutile ;
- ne pas supprimer une logique métier simplement parce qu'elle paraît redondante ;
- vérifier les dépendances entre `feuilles_heures`, `feuilles_heures_jours` et `feuilles_heures_imputations` ;
- utiliser `codes_imputation` comme référentiel des codes lorsque cela s'applique ;
- signaler explicitement toute information manquante au lieu d'inventer.

## 11. Sécurité

Les secrets `.env` ne doivent jamais être exportés dans le contexte IA.

Les fonctions sensibles PostgreSQL doivent vérifier les droits côté base lorsque l'opération est critique.

L'export IA lui-même est réservé aux administrateurs actifs.
