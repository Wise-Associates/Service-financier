# 0002 — Convention de signe unique et choix explicite des marges

Date : 2026-10-27 · Statut : accepté

## Contexte

Le PDF (p. 11) demande une convention de signe unique dans les calculs et les restitutions, et un choix
explicite d'inclure ou non les marges commerciales, identique entre base et choc. Il rappelle aussi
(p. 6) qu'un montant négatif n'est pas automatiquement une erreur.

## Décision

- Les flux sont signés par position : **actif positif, passif négatif**. EVE et NII se lisent donc
  directement comme actif − passif.
- **Δ = scénario − base** : un Δ négatif est une perte. La perte maximale publiée est
  maxₛ(valeur₀ − valeurₛ) ; le test SOT rapporte cette perte au Tier 1.
- `inclure_marge` est un argument **obligatoire, sans valeur par défaut**, de `calculer_delta_eve` et de
  l'approche standardisée. Le même flag sert au scénario de base et aux chocs.
- Le contrôle de signe d'une rubrique (`controle_signe`) suit la convention de la rubrique
  (`positif`, `negatif`, `libre`) et pas une règle générale.

## Conséquences

- Les restitutions qui exigent la convention inverse (perte positive) font la conversion au moment du
  mapping réglementaire, pas dans le moteur.
- Oublier de choisir le traitement des marges provoque une erreur immédiate, pas un résultat silencieux.
