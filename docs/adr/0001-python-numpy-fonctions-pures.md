# 0001 — Python, numpy seul, fonctions pures

Date : 2026-10-27 · Statut : accepté

## Contexte

Le moteur doit pouvoir être recalculé et expliqué à partir des flux, courbes et hypothèses retenus
(PDF p. 5 et 8). Le package de méthode `bank-model-validation` est écrit en Python (numpy et scipy).
Les équipes ALM et de validation lisent surtout du Python.

## Décision

- Python ≥ 3.11, une seule dépendance d'exécution : **numpy**, en version figée dans
  `requirements.txt`. scipy n'est pas nécessaire : la loi normale passe par `math.erf` et les moindres
  carrés par `numpy.linalg.lstsq`.
- Les formules sont des fonctions pures ou des dataclasses figées, sans état global, sans accès disque
  ni réseau. L'horodatage des contrôles est injecté (`Contexte.maintenant`).
- Chaque formule est testée contre une référence écrite dans le test (formule fermée, seconde méthode,
  identité), jamais contre le moteur lui-même.

## Conséquences

- Le calcul est reproductible à l'identique avec la même version de numpy (C03).
- Une seconde implémentation par une autre équipe reste nécessaire pour un usage réglementaire
  (voir `docs/limites.md`).
