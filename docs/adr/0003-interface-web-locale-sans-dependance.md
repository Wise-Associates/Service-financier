# 0003 — Interface web locale, sans nouvelle dépendance

Date : 2026-10-27 · Statut : remplacé par [0004](0004-interface-nextjs-moteur-typescript.md)

## Contexte

Jusqu'ici, seul un développeur pouvait lancer la démonstration et lire le rapport Markdown. Les
équipes ALM, contrôle et validation ont besoin de faire varier quelques paramètres (fonds propres
Tier 1, seuils SOT, marges commerciales, pondération des gains) et de lire immédiatement ΔEVE et
ΔNII par choc, le test des valeurs aberrantes et le statut des contrôles C01 à C09.

L'ADR 0001 limite les dépendances d'exécution à numpy.

## Décision

- Interface dans `exemples/interface_web.py`, à côté de la démonstration : le module `src/irrbb`
  reste sans I/O ni état.
- Bibliothèque standard uniquement : `http.server` pour le serveur, HTML rendu côté serveur,
  une feuille de style locale (`exemples/interface_web.css`), **aucun JavaScript**. Pas de
  framework (Streamlit, Flask, FastAPI…) : ils ajouteraient des dizaines de dépendances transitives
  à figer et à surveiller pour quatre champs et quelques tableaux.
- Le calcul passe par `demo_banque_fictive.executer`, partagé avec la démonstration en ligne de
  commande : l'interface ne contient aucune formule.
- Le serveur écoute uniquement sur `127.0.0.1`. Formulaire en GET (le calcul ne modifie rien,
  l'URL peut être partagée sur le poste). Saisie validée et bornée, refusée sans calcul si elle est
  invalide ; toute valeur réaffichée est échappée. En-têtes : CSP sans script ni ressource externe,
  `nosniff`, `no-referrer`.

## Conséquences

- Aucune nouvelle dépendance ; la CI existante couvre l'interface (`tests/test_interface_web.py`).
- Outil de poste de travail : pas d'authentification, pas de multi-utilisateur, pas de saisie de
  portefeuille. Le servir sur un réseau demanderait un nouvel ADR (authentification, journalisation,
  hébergement).
- Seules les données fictives de la démonstration sont chargées.
