# irrbb-formules — règles du projet

Moteur de formules IRRBB en TypeScript (`web/src/moteur`) et interface Next.js (`web/`). Lire
`README.md`, `docs/formules.md` et `docs/limites.md` avant de modifier le code.

## Règles

- Une formule = une fonction pure (ou un objet figé) avec documentation en français qui cite la page
  du PDF de cadrage. Pas d'état global, pas d'I/O dans `web/src/moteur`.
- Toute nouvelle formule arrive avec un test qui la compare à une référence **indépendante du moteur** :
  formule fermée écrite dans le test, seconde méthode, identité financière. Ajouter la ligne
  correspondante dans `docs/formules.md`.
- `web/src/demo/reference-python.json` est la référence figée de l'ancien moteur Python (ADR 0005) :
  ne pas la régénérer à partir du moteur TypeScript. Une modification volontaire de formule qui la
  déplace met à jour les valeurs concernées et justifie l'écart dans le message de commit.
- Convention de signe : actif +, passif −, Δ = scénario − base (perte négative). Ne pas la changer
  sans nouvel ADR.
- Paramètres réglementaires (chocs, planchers, seuils) : paramètres d'appel, jamais en dur dans les
  calculs ; toute valeur par défaut cite sa source et la mention « à confirmer ».
- Toute limitation connue va dans `docs/limites.md` avec son atténuation.
- Données fictives uniquement dans les tests et les exemples.
- Dépendances npm en versions exactes ; ajout seulement avec mise à jour de l'ADR 0004.

## Vérifications avant de livrer

```bash
cd web && npm run lint && npm run typecheck && npm test && npm run build
```
