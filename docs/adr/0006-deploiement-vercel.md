# 0006 — Déploiement de l'interface sur Vercel

Date : 2026-10-28 · Statut : accepté

## Contexte

L'ADR 0004 et le registre des limites (n° 13) réservaient l'interface au poste de travail et
exigeaient un ADR avant tout déploiement (authentification, journalisation, hébergement). Le
demandeur souhaite la publier sur Vercel, comme les autres produits Wise Associates.

## Décision

- **Hébergement** : intégration Git de Vercel sur ce dépôt, dossier racine du projet Vercel `web`
  (préréglage Next.js, commandes par défaut : `npm ci` puis `next build`). Chaque push publie une
  préversion ; la branche de production est choisie dans les réglages du projet Vercel.
- **Ce qui est publié** : la seule banque fictive. Aucune variable d'environnement, aucun secret,
  aucune donnée réelle ni personnelle ; l'utilisateur ne saisit que des paramètres (fonds propres,
  seuils, pondération, marges), validés par zod. Le calcul prend quelques dizaines de millisecondes
  par requête, sans état ni écriture.
- **Accès** : pas d'authentification applicative. L'accès se règle dans le projet Vercel
  (Settings → Deployment Protection, Vercel Authentication) : selon le niveau choisi, le domaine de
  production peut rester public. Un accès public est admissible tant que l'application ne publie que
  des données fictives.
- **Journalisation** : journaux d'exécution de Vercel. Le seul message applicatif est l'erreur du
  moteur quand un calcul est refusé (`console.error` dans `page.tsx`), sans donnée personnelle.
- **Sécurité** : en-têtes et CSP à nonce inchangés (`next.config.ts`, `src/proxy.ts`) ; HTTPS et HSTS
  fournis par Vercel. Les scripts locaux `dev` et `start` restent liés à 127.0.0.1.

## Conséquences

- Le dépôt ne contient aucune configuration propre à Vercel : le dossier racine `web` se règle une
  fois, à l'import du projet dans Vercel.
- **Restriction** : toute saisie de portefeuille réel, tout import de fichier ou toute donnée
  d'établissement exige un nouvel ADR (authentification applicative, cloisonnement, conservation).
