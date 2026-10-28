# irrbb-formules

Formules mathématiques du moteur IRRBB (risque de taux d'intérêt du portefeuille bancaire) décrit dans
le document de cadrage Wise Associates *Contrôles du reporting IRRBB — architecture, calculs, contrôles
et production réglementaire* (v3, 23/10/2026), et interface web qui les applique à une banque fictive.

Le projet couvre l'ordre de mise en œuvre recommandé par le PDF (p. 15) : courbes et cash-flows,
ΔEVE et chocs, ΔNII, dépôts et options comportementales, approche standardisée et SOT, sensibilités,
contrôles et journal des anomalies.

Toutes les données du dépôt (tests, démonstration) sont **fictives**.

## Démarrage

Prérequis : Node.js 22.12 ou plus récent (Windows, macOS ou Linux). Tout se passe dans `web/`.

```bash
cd web
npm ci
npm run dev        # http://127.0.0.1:3000 ; production : npm run build puis npm start
```

## Commandes (dans `web/`)

| Action | Commande |
|---|---|
| Interface (banque fictive) | `npm run dev` puis ouvrir <http://127.0.0.1:3000> |
| Tests | `npm test` |
| Lint | `npm run lint` |
| Typage strict | `npm run typecheck` |
| Build de production | `npm run build` |

La CI GitHub Actions (`.github/workflows/ci.yml`) exécute ces commandes sous Linux et Windows, avec
`npm audit`.

## Organisation

| Dossier | Contenu |
|---|---|
| `web/src/moteur` | Le moteur de calcul : formules pures, sans I/O, chacune testée dans le `*.test.ts` voisin |
| `web/src/demo` | La banque fictive (`banqueFictive.ts`), la lecture des paramètres saisis et leur présentation |
| `web/src/app` | Les pages et composants Next.js |
| `docs/` | Carte des formules, limitations connues, décisions (ADR) |

| Module du moteur | Contenu | PDF |
|---|---|---|
| `courbes` | Courbe zéro, facteurs d'actualisation, forwards, conversion de capitalisation, bootstrapping, courbe choquée avec plancher | p. 10 |
| `scenarios` | Six chocs de Bâle, tailles par devise, plancher post-choc, marché par devise (actualisation + projection par index), choc d'un seul index | p. 10, 14 |
| `positions` | `Instrument` (prêts, dépôts à terme, titres, jambes de dérivés, hors-bilan), génération des flux, intérêts à bilan constant | p. 4, 9 |
| `mesures` | ΔEVE et ΔNII par scénario, perte maximale, décomposition par devise, produit ou position | p. 11, 12 |
| `comportemental` | Dépôts sans échéance (part stable, écoulement, bêta, plancher), estimation de la transmission, survie, CPR/SMM, prêt avec remboursement anticipé | p. 13 |
| `sensibilites` | PV01, KRD, convexité, approximation de Taylor, gaps de repricing, risque de base | p. 14 |
| `options` | Black, Bachelier, caps et floors | p. 14 |
| `standardise` | 19 tranches de Bâle, ΔEVE standardisé, agrégation des devises, test des valeurs aberrantes | p. 15 |
| `controles` | Contrôles C01 à C09, sévérités, journal minimum, approbation à quatre yeux, empreinte de reproductibilité | p. 3–8 |
| `tableau`, `cles` | Outils numériques (interpolation, loi normale, moindres carrés) et accès sûrs aux clés | — |

La correspondance formule → fonction → test est dans [`docs/formules.md`](docs/formules.md).

## Interface web

La page relance le calcul de la banque fictive avec vos paramètres (fonds propres Tier 1, seuils SOT
ΔEVE et ΔNII, pondération des gains, marges commerciales) et affiche ΔEVE et ΔNII par choc et par
devise, le ΔEVE standardisé, le test des valeurs aberrantes et le statut des contrôles C01 à C09 avec
le journal. Le calcul tourne côté serveur (Server Component), sans API ni server action
(ADR [0004](docs/adr/0004-interface-nextjs-moteur-typescript.md)).

## Déploiement (Vercel)

Le déploiement passe par l'intégration Git de Vercel (ADR [0006](docs/adr/0006-deploiement-vercel.md)) :
importer le dépôt dans Vercel avec **`web` comme dossier racine** (Root Directory) ; le préréglage
Next.js et les commandes par défaut suffisent, aucune variable d'environnement n'est nécessaire.
Chaque push publie ensuite une préversion. L'accès se règle dans Settings → Deployment Protection.

## Exemple minimal

```ts
import { CourbeZero } from "@/moteur/courbes";
import { calculerDeltaEve } from "@/moteur/mesures";
import { Instrument } from "@/moteur/positions";
import { CHOCS_BALE, MarcheDevise } from "@/moteur/scenarios";

const courbe = new CourbeZero([1, 5, 10], [0.022, 0.026, 0.03]);
const marches = { EUR: new MarcheDevise("EUR", courbe) };
const pret = new Instrument({
  identifiant: "P1",
  categorie: "pret",
  devise: "EUR",
  sens: 1,
  encours: 100,
  taux: 0.035,
  maturite: 10,
  frequence: 12,
  amortissement: "annuite",
});
const eve = calculerDeltaEve([pret], marches, CHOCS_BALE, { inclureMarge: false });
console.log(eve.delta("hausse_parallele"), eve.perteMaximale());
```

## Conventions à connaître

- Temps en années depuis l'arrêté, taux en décimal (0,02 = 200 pb).
- Flux signés : actif positif, passif négatif. **Δ = scénario − base : un Δ négatif est une perte**
  (ADR [0002](docs/adr/0002-conventions-de-signe-et-marges.md)).
- `inclureMarge` est obligatoire pour ΔEVE : le traitement des marges commerciales doit être choisi
  explicitement.
- Les paramètres réglementaires (chocs, plancher, seuils SOT) sont des **paramètres à confirmer** sur les
  textes en vigueur pour l'établissement.

## Ce que le projet ne fait pas encore

Voir [`docs/limites.md`](docs/limites.md) : calendriers et bases de jours, vue NII dynamique, options
dépendantes du chemin, mapping vers les gabarits EBA et workflow d'approbation. Le moteur n'est pas
qualifié pour un usage réglementaire : une seconde implémentation indépendante et un rejeu sur des
arrêtés validés restent nécessaires.

## Décisions

- [0001 — Python, numpy seul, fonctions pures](docs/adr/0001-python-numpy-fonctions-pures.md) (remplacé par 0005)
- [0002 — Convention de signe unique et choix explicite des marges](docs/adr/0002-conventions-de-signe-et-marges.md)
- [0003 — Interface web locale, sans nouvelle dépendance](docs/adr/0003-interface-web-locale-sans-dependance.md) (remplacé par 0004)
- [0004 — Interface Next.js et portage du moteur en TypeScript](docs/adr/0004-interface-nextjs-moteur-typescript.md)
- [0005 — Retrait du moteur Python, le moteur TypeScript devient la référence](docs/adr/0005-retrait-du-moteur-python.md)
- [0006 — Déploiement de l'interface sur Vercel](docs/adr/0006-deploiement-vercel.md)
