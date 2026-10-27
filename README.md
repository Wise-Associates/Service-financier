# irrbb-formules

Formules mathématiques du moteur IRRBB (risque de taux d'intérêt du portefeuille bancaire) décrit dans
le document de cadrage Wise Associates *Contrôles du reporting IRRBB — architecture, calculs, contrôles
et production réglementaire* (v3, 23/10/2026).

Le projet couvre l'ordre de mise en œuvre recommandé par le PDF (p. 15) : courbes et cash-flows,
ΔEVE et chocs, ΔNII, dépôts et options comportementales, approche standardisée et SOT, sensibilités,
contrôles et journal des anomalies.

Toutes les données du dépôt (tests, démonstration) sont **fictives**.

## Démarrage

Prérequis : Python 3.11 ou plus récent (Windows, macOS ou Linux).

```bash
python -m venv .venv
# Windows : .venv\Scripts\activate    macOS / Linux : source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pip install -e .
```

## Commandes

| Action | Commande |
|---|---|
| Tests | `python -m pytest` |
| Lint et format | `python -m ruff check .` puis `python -m ruff format --check .` |
| Typage strict | `python -m mypy` |
| Démonstration sur une banque fictive | `python exemples/demo_banque_fictive.py` (écrit `sortie/rapport_irrbb.md` et `sortie/journal_controles.csv`) |

La CI GitHub Actions (`.github/workflows/ci.yml`) exécute ces commandes sous Linux et Windows.

## Modules

| Module | Contenu | PDF |
|---|---|---|
| `irrbb.courbes` | Courbe zéro, facteurs d'actualisation, forwards, conversion de capitalisation, bootstrapping, courbe choquée avec plancher | p. 10 |
| `irrbb.scenarios` | Six chocs de Bâle, tailles par devise, plancher post-choc, marché par devise (actualisation + projection par index), choc d'un seul index | p. 10, 14 |
| `irrbb.positions` | `Instrument` (prêts, dépôts à terme, titres, jambes de dérivés, hors-bilan), génération des flux, intérêts à bilan constant | p. 4, 9 |
| `irrbb.mesures` | ΔEVE et ΔNII par scénario, perte maximale, décomposition par devise, produit ou position | p. 11, 12 |
| `irrbb.comportemental` | Dépôts sans échéance (part stable, écoulement, bêta, plancher), estimation de la transmission, survie, CPR/SMM, prêt avec remboursement anticipé | p. 13 |
| `irrbb.sensibilites` | PV01, KRD, convexité, approximation de Taylor, gaps de repricing, risque de base | p. 14 |
| `irrbb.options` | Black, Bachelier, caps et floors | p. 14 |
| `irrbb.standardise` | 19 tranches de Bâle, ΔEVE standardisé, agrégation des devises, test des valeurs aberrantes | p. 15 |
| `irrbb.controles` | Contrôles C01 à C09, sévérités, journal minimum, approbation à quatre yeux, empreinte de reproductibilité | p. 3–8 |

La correspondance formule → fonction → test est dans [`docs/formules.md`](docs/formules.md).

## Exemple minimal

```python
from irrbb.courbes import CourbeZero
from irrbb.mesures import calculer_delta_eve
from irrbb.positions import Instrument
from irrbb.scenarios import CHOCS_BALE, MarcheDevise

courbe = CourbeZero([1, 5, 10], [0.022, 0.026, 0.030])
marche = {"EUR": MarcheDevise("EUR", courbe)}
pret = Instrument(
    "P1", "pret", "EUR", sens=1, encours=100.0, taux=0.035, maturite=10.0, frequence=12, amortissement="annuite"
)
eve = calculer_delta_eve([pret], marche, CHOCS_BALE, inclure_marge=False)
print(eve.delta("hausse_parallele"), eve.perte_maximale())
```

## Conventions à connaître

- Temps en années depuis l'arrêté, taux en décimal (0,02 = 200 pb).
- Flux signés : actif positif, passif négatif. **Δ = scénario − base : un Δ négatif est une perte**
  (ADR [0002](docs/adr/0002-conventions-de-signe-et-marges.md)).
- `inclure_marge` est obligatoire pour ΔEVE : le traitement des marges commerciales doit être choisi
  explicitement.
- Les paramètres réglementaires (chocs, plancher, seuils SOT) sont des **paramètres à confirmer** sur les
  textes en vigueur pour l'établissement.

## Ce que le projet ne fait pas encore

Voir [`docs/limites.md`](docs/limites.md) : calendriers et bases de jours, vue NII dynamique, options
dépendantes du chemin, mapping vers les gabarits EBA et workflow d'approbation. Le moteur n'est pas
qualifié pour un usage réglementaire : une seconde implémentation indépendante et un rejeu sur des
arrêtés validés restent nécessaires.

## Décisions

- [0001 — Python, numpy seul, fonctions pures](docs/adr/0001-python-numpy-fonctions-pures.md)
- [0002 — Convention de signe unique et choix explicite des marges](docs/adr/0002-conventions-de-signe-et-marges.md)
