# 0005 — Retrait du moteur Python, le moteur TypeScript devient la référence

Date : 2026-10-28 · Statut : accepté · Remplace [0001](0001-python-numpy-fonctions-pures.md) ;
modifie [0004](0004-interface-nextjs-moteur-typescript.md) sur la parité

## Contexte

Depuis l'ADR 0004, l'interface Next.js calcule avec son propre moteur TypeScript (`web/src/moteur`).
Le moteur Python (`src/irrbb`) n'était plus appelé par l'interface : il ne servait qu'à vérifier le
portage, au prix de deux moteurs à maintenir pour chaque formule. Le demandeur a choisi de ne garder
qu'une seule pile technique.

## Décision

- Suppression de `src/irrbb`, `tests/`, `exemples/` (démonstration en ligne de commande et
  génération de la référence), `pyproject.toml`, `requirements*.txt` et du job Python de la CI.
- `web/src/moteur` devient le seul moteur. Les règles de l'ADR 0001 restent valables, transposées :
  fonctions pures ou objets figés, documentation en français citant la page du PDF, aucun état
  global ni I/O, horodatage injecté, chaque formule testée contre une référence écrite dans le test
  (formule fermée, seconde méthode, identité), jamais contre le moteur lui-même.
- Avant le retrait, chaque test Python a été vérifié présent dans `web/src/moteur/*.test.ts` ; les
  trois assertions qui manquaient (maturités non entières du bootstrap, maturité NaN, encours non
  fini) ont été portées, et la dernière a révélé un écart corrigé : le moteur TypeScript acceptait
  un encours infini.
- `web/src/demo/reference-python.json`, produit par le moteur Python avant son retrait (commit
  a531f7b), est **figé** : `parite.test.ts` reste en place comme test de non-régression à 1e-9 en
  relatif. Une modification volontaire de formule qui déplace ces valeurs met à jour les valeurs
  concernées et justifie l'écart dans le commit.
- Le job de CI restant garde le nom `verifier` (Linux et Windows, Node 22).

## Conséquences

- Une seule formule à modifier, un seul langage, une seule commande de vérification.
- Plus de seconde implémentation pour recouper une formule modifiée : la référence figée ne couvre
  que la banque fictive et les cas unitaires qu'elle contient (`docs/limites.md`, n° 14).
- Le rapport Markdown et le journal CSV produits par la démonstration Python disparaissent ;
  l'interface affiche les mêmes résultats et le journal des contrôles.
- Le code Python reste consultable dans l'historique git (commit a531f7b et antérieurs).
