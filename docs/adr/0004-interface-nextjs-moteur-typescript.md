# 0004 — Interface Next.js et portage du moteur en TypeScript

Date : 2026-10-27 · Statut : accepté, modifié par [0005](0005-retrait-du-moteur-python.md) (parité) · Remplace [0003](0003-interface-web-locale-sans-dependance.md)

## Contexte

L'interface de l'ADR 0003 (Python, bibliothèque standard) a été jugée trop éloignée des autres
produits Wise Associates, construits en Next.js. Le demandeur a choisi une interface Next.js dont
le calcul tourne **en TypeScript**, plutôt qu'un appel à un service Python, pour n'avoir qu'un
processus à lancer et à déployer.

## Décision

- Application Next.js (App Router) dans `web/`. Le moteur Python (`src/irrbb`) reste la
  **référence** : formules documentées, tests contre des références indépendantes, démonstration.
- `web/src/moteur` est un portage module par module de `src/irrbb` (mêmes noms de formules en
  camelCase, mêmes docstrings, mêmes pages du PDF). Les tests Python à référence indépendante sont
  portés à l'identique dans `web/src/moteur/*.test.ts`.
- **Parité contrôlée** : `exemples/reference_web.py` écrit les résultats du moteur Python sur la
  banque fictive (deux jeux de paramètres) et sur des cas unitaires que la démonstration n'emprunte
  pas (capitalisations annuelle et simple, variable amorti indexé, cap Black, floor Bachelier, taux
  négatifs sous plancher, renouvellement de durée nulle, transmission des dépôts) dans
  `web/src/demo/reference-python.json` ;
  `web/src/demo/parite.test.ts` exige le même résultat du moteur TypeScript à 1e-9 près en relatif
  (écart constaté : ~5e-13) ; `tests/test_reference_web.py` échoue si la référence n'est plus à jour.
- Calcul côté serveur uniquement (Server Component), sans server action ni API : la page lit les
  paramètres d'URL, les valide avec zod, appelle le moteur et rend du HTML. Formulaire en GET.
- Sécurité : CSP stricte avec nonce par requête (`web/src/proxy.ts`), `nosniff`, `no-referrer`,
  `X-Frame-Options: DENY` ; serveur lié à 127.0.0.1 par les scripts `dev` et `start`.
- Dépendances (versions exactes, `web/package.json`) : next, react, react-dom, zod à l'exécution ;
  typescript, eslint, eslint-config-next, vitest, vite, @types/* en développement. Règle : version
  publiée depuis au moins deux semaines, sauf correctif de sécurité (Next.js 16.4.3 et Vitest
  4.1.12 corrigent des avis publiés sur 16.4.0 et 4.1.11). `npm audit` : 0 vulnérabilité.
- `web/.npmrc` active `legacy-peer-deps` : npm 10 plante en résolvant les pairs optionnels de vite ;
  les pairs nécessaires sont déclarés explicitement.

## Conséquences

- **Deux moteurs à maintenir.** Toute modification de formule se fait dans `src/irrbb` et dans
  `web/src/moteur`, puis `python exemples/reference_web.py` régénère la référence. La CI vérifie
  les deux côtés.
- L'empreinte C03 du moteur TypeScript n'est pas comparable à celle du moteur Python (écriture
  JSON des nombres différente) ; elle reste reproductible d'un calcul TypeScript à l'autre.
- Le texte du journal peut différer à la marge (« 1200 » au lieu de « 1200.0 », « true » au lieu
  de « True », arrondi des écarts à 2 décimales) ; règles, sévérités et statuts sont identiques et testés.
- Les objets indexés par des clés de l'appelant (devise, index, catégorie) sont lus sans remonter la
  chaîne de prototypes (`moteur/cles.ts`) et les résultats par position sont des `Map`, pour garder
  la sémantique des dict Python (ordre d'insertion, aucune clé réservée).
- Toujours un outil de poste de travail sur données fictives : pas d'authentification. Un
  déploiement (Vercel ou autre) exige un nouvel ADR (authentification, journalisation, données) :
  voir [0006](0006-deploiement-vercel.md).
