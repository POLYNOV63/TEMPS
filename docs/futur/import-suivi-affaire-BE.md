# Import du « Suivi d'affaire BE » (mis de côté)

Décision : dans un premier temps, les affaires sont ressaisies dans les pages du Pilotage BE. L'import depuis
Excel (ou depuis un fichier INDEX Power Query) viendra peut-être plus tard. Le code de lecture est conservé dans
`pilotageImport.ts.txt` (renommer en `.ts` et le placer dans `lib/` pour l'utiliser). Il a été testé sur une copie
épurée du fichier : 353 lignes, 281 DBE, 176 CBE de base, avec contrôle que seules les colonnes autorisées sont lues.

## Structure du fichier (un seul onglet, en-têtes en ligne 1)
- Une ligne = un couple devis (DBE) / affaire (CBE). Un DBE peut avoir plusieurs lignes.
- Colonnes utiles (repérées par leur TITRE) : N° Devis, N°Affaire, Désignation, Statut, Imputation, Rédacteur devis,
  Heures méca / calcul / élec / pneu / scan / Autre, Total heures, Date ouverture devis, Date envoi devis,
  Date reception commande, Date de livraison estimée, Date de livraison.
- Jamais lues : client, société, adresse, contacts, montants, commentaires, numéros comptables, options.

## Règles de regroupement
- CBE1530, CBE1530R1, CBE1530R2 (R = avenants / révisions) et CBE1544LOT1 : une seule affaire, numéro de base ;
  leurs heures s'additionnent, sauf avenant perdu ou annulé.
- CBE1535ECH1 (échéances de paiement) : ignoré.
- Imputation (nature) : BE, PI, PE, Scan, Négoce, IG (inter-groupe) ; toujours renseignée.
- Statuts : Devis ouvert -> en cours ; Devis envoyé / Intention de commande -> en attente ;
  Commande reçue -> en cours ; Livrée -> livrée ; Devis perdu / Commande annulée -> abandonnée.
- Les heures peuvent être du texte avec virgule (« 37,5 ») ; les dates mêlent vraies dates et texte jj/mm/aaaa.

## Pistes
- Un fichier INDEX (Power Query) ne contenant que ces colonnes, actualisé à l'ouverture, pourrait servir de source
  (mêmes titres de colonnes : le code de lecture fonctionne tel quel).
- Une correspondance « activité Excel -> activité POLYNOV » (Méca, Calcul, Élec, Pneu, Scan, Autre) à enregistrer.
