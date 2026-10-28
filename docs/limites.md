# Limitations connues et restrictions d'usage

Ce registre suit la démarche du package `bank-model-validation` (2.7.0) : une limitation est écrite,
avec son atténuation, plutôt que cachée derrière un test vert. Les tests vérifient les formules sur
des cas synthétiques. Ils ne qualifient pas le moteur pour un usage réglementaire : il faut encore une
seconde implémentation indépendante et un rejeu sur des arrêtés déjà validés par l'établissement.

| # | Limitation | Effet | Atténuation / restriction |
|---|---|---|---|
| 1 | Paramètres réglementaires (tailles de chocs BCBS d368, plancher RTS UE 2024/856, seuils SOT, pondération des gains à 50 %) saisis sans rapprochement avec le texte officiel | Écart possible avec le texte applicable | **Restriction** : à revérifier sur les textes en vigueur avant tout usage prudentiel ; ce sont des paramètres, pas des constantes |
| 2 | Temps en fractions d'année, sans calendrier ni base de jours (ACT/360, 30/360…) | Écarts de quelques pb sur les coupons et l'actualisation | Brancher une couche « dates » qui convertit l'échéancier contractuel avant d'appeler le moteur |
| 3 | Première période de coupon supposée complète | Coupon couru mal estimé entre deux dates | Fournir l'échéancier exact quand la date de dernière révision est connue |
| 4 | ΔNII : les événements entre deux nœuds de la grille prennent effet au nœud suivant | Erreur d'au plus un pas (un mois par défaut) | Grille plus fine (`pasParAn`) ou dates alignées sur les fins de mois |
| 5 | ΔNII : les tranches renouvelées sont in fine, de durée `dureeRenouvellement` (par défaut la maturité résiduelle) | Hypothèse de bilan constant simplifiée | Renseigner la durée d'origine ; la vue de gestion dynamique (PDF p. 12) n'est pas implémentée |
| 6 | Interpolation linéaire des taux zéro, extrapolation plate | Forwards en dents de scie entre piliers | Sous-classer `Courbe` pour une autre méthode ; documenter le choix (PDF p. 10) |
| 7 | Remboursement anticipé : CPR fixé à l'arrêté pour toute la vie du prêt | Pas de dépendance au chemin des taux | Restriction : pas pour des prêts à options complexes ; modèle de survie complet à calibrer |
| 8 | Caps et floors à volatilité constante, options dépendantes du chemin non couvertes | Smile ignoré | Surface de volatilité à brancher ; arbre ou Monte Carlo pour les options exotiques (hors périmètre) |
| 9 | Approche standardisée : flux comportementaux du modèle interne | Écart avec les tables prescrites | Paramétrer les modèles avec les plafonds prescrits, ou fournir les flux standardisés |
| 10 | Hors-bilan : simple facteur de conversion sur l'encours | Tirage dans le temps non modélisé | Fournir un échéancier de tirage comme instrument dédié |
| 11 | Une seule courbe d'actualisation par devise | Pas de CSA multi-devises | Suffisant pour l'IRRBB (pas de valorisation des collatéraux) |
| 12 | Approbation (C09) et archivage (C10) : seul le journal est fourni | Le workflow lui-même n'est pas outillé | À intégrer dans l'outil de workflow de l'établissement |
| 13 | Interface web (`web/`) : outil local sans authentification, sur le seul bilan fictif de la démonstration | Pas de saisie de portefeuille réel ni d'usage partagé | **Restriction** : scripts liés à 127.0.0.1 ; tout déploiement exige un nouvel ADR (authentification, journalisation, hébergement) |
| 14 | Un seul moteur (TypeScript) depuis le retrait du moteur Python (ADR 0005) ; la référence `web/src/demo/reference-python.json` est figée | Plus de seconde implémentation pour recouper une formule modifiée ; la référence figée ne couvre que la banque fictive et quelques cas unitaires | Chaque formule reste testée contre une référence indépendante écrite dans le test ; une modification qui déplace la référence figée doit justifier l'écart dans le commit ; **restriction** : la seconde implémentation exigée pour un usage réglementaire (en tête de ce registre) reste à faire |
