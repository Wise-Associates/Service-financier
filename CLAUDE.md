# irrbb-formules — règles du projet

Bibliothèque Python de formules IRRBB. Lire `README.md`, `docs/formules.md` et `docs/limites.md` avant
de modifier le code.

## Règles

- Une formule = une fonction pure (ou une dataclass figée) avec docstring en français qui cite la page
  du PDF de cadrage. Pas d'état global, pas d'I/O dans `src/`.
- Toute nouvelle formule arrive avec un test qui la compare à une référence **indépendante du moteur** :
  formule fermée écrite dans le test, seconde méthode, identité financière. Ajouter la ligne
  correspondante dans `docs/formules.md`.
- Convention de signe : actif +, passif −, Δ = scénario − base (perte négative). Ne pas la changer
  sans nouvel ADR.
- Paramètres réglementaires (chocs, planchers, seuils) : paramètres d'appel, jamais en dur dans les
  calculs ; toute valeur par défaut cite sa source et la mention « à confirmer ».
- Toute limitation connue va dans `docs/limites.md` avec son atténuation.
- Données fictives uniquement dans les tests et les exemples.
- Seule dépendance d'exécution : numpy (version figée). Pas de nouvelle dépendance sans ADR.
- L'interface web (`exemples/interface_web.py`) n'a aucune formule : elle appelle
  `demo_banque_fictive.executer`. Bibliothèque standard seulement, pas de JavaScript (ADR 0003).

## Vérifications avant de livrer

```bash
python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest
python exemples/demo_banque_fictive.py
```
