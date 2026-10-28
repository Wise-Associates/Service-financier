# Carte des formules

Chaque formule du document de cadrage *Contrôles du reporting IRRBB* (v3, 23/10/2026) est reliée
à la fonction qui la calcule et au test qui la vérifie. La colonne « Vérification » dit contre quoi
le test compare : une formule fermée écrite dans le test, une seconde méthode indépendante ou une
identité financière. Le moteur n'est jamais vérifié avec son propre code.

| Page | Formule | Fonction (`web/src/moteur`) | Vérification (test `*.test.ts` du module) |
|---|---|---|---|
| 10 | D(0,t) = exp(−∫₀ᵗ f(0,u)du) | `courbes` : `Courbe.facteurActualisation`, `forwardInstantane` | Intégration numérique du forward instantané (« forward instantané intégré redonne le facteur d'actualisation ») |
| 10 | Capitalisation paramétrable | `courbes` : `convertirTaux` | Valeur fermée ln(1,05), aller-retour (« conversion de capitalisation… ») |
| 10 | Bootstrapping | `courbes` : `bootstrapSwaps` | Repricing des swaps par à 1e-14 (« bootstrap : reprice les swaps par ») |
| 10 | rₛ,c(τ) = r₀,c(τ) + Δrₛ,c(τ), plancher post-choc | `scenarios` : `choc`, `plancherEba` ; `courbes` : `CourbeDecalee` | Limites τ = 0 et τ → ∞ des six chocs, valeur en τ = x (`scenarios.test.ts`) |
| 9 | CFᵢ,ₛ = CFᵢ(rₛ, contrat, comportement) | `positions` : `Instrument.flux` | Annuité constante fermée ; identité « un FRN vaut le pair » (`mesures.test.ts`) |
| 11 | EVEₛ = Σₖ Dₛ(0,tₖ)·CFₖ,ₛ ; ΔEVEₛ = EVEₛ − EVE₀ | `mesures` : `calculerDeltaEve` | ΔEVE d'un zéro coupon en formule fermée (« ΔEVE d'un zéro coupon : formule fermée ») |
| 11 | maxₛ(EVE₀ − EVEₛ) | `mesures` : `ResultatMesure.perteMaximale` | Idem |
| 11 | Marges commerciales incluses ou exclues | option obligatoire `inclureMarge` | « exclusion de la marge identique en base et en choc » |
| 12 | NIIₛ = Σₜ (intérêts actifs − intérêts passifs) ; ΔNIIₛ | `mesures` : `calculerDeltaNii` ; `positions` : `interetsBilanConstant` | NII fermé d'un taux fixe renouvelé et d'un taux variable (« ΔNII : … ») |
| 12 | Décomposition par devise, produit, position | `mesures` : `ResultatMesure.decomposition` | La somme des composantes égale le total (« la décomposition par devise somme au total ») |
| 13 | Δr_dépôt,t = α + Σⱼ βⱼ Δr_marché,t−ⱼ + εₜ | `comportemental` : `estimerTransmission`, `stabiliteTransmission` | Retrouve β = (0,30 ; 0,20) simulés (« l'estimation retrouve les β simulés ») |
| 13 | Part stable / volatile, décroissance | `comportemental` : `DepotNonEcheance`, `ecoulementExponentiel` | Solde à 1 an = e^(−1/d) ; ΔNII = −β·Δfwd·encours ; plancher (« dépôt : … ») |
| 13 | S(t) = Πᵤ (1 − hᵤ) | `comportemental` : `survie`, `smmDepuisCpr` | 12 mois de SMM redonnent 1 − CPR (« SMM et survie redonnent le CPR annuel ») |
| 13 | Remboursement anticipé selon l'incitation | `comportemental` : `PretRemboursementAnticipe`, `cprLogistique` | Sans option, identique à l'annuité constante (seconde méthode) |
| 14 | PV01 ≈ [PV(r−1pb) − PV(r+1pb)]/2 | `sensibilites` : `pv01` | 100·e^(−rT)·sinh(T·1 pb) (« PV01 d'un zéro coupon : formule fermée ») |
| 14 | ΔPV ≈ −Σₘ KRDₘΔrₘ + ½Γ(Δr)² | `sensibilites` : `krd`, `gamma`, `approximationTaylor` | Σ KRD = sensibilité parallèle ; Taylor contre revalorisation complète |
| 14 | Gaps de repricing | `sensibilites` : `gapsRepricing` | Somme = encours signés ; tranches calculées à la main |
| 14 | Risque de base | `sensibilites` : `deltaPvRisqueBase` ; `scenarios` : `decalerMarche` (avec index) | Référence écrite à la main sur les facteurs choqués |
| 14 | Black, Bachelier, caps et floors | `options` : `black76`, `bachelier`, `CapFloor` | Intégration numérique du payoff ; parité cap − floor = swap |
| 15 | Approche standardisée (19 tranches) | `standardise` : `calculerDeltaEveStandardise` | Flux au point milieu = revalorisation complète |
| 15 | SOT : 15 % du Tier 1 (ΔEVE), 5 % (ΔNII) | `standardise` : `controleValeursAberrantes` | « SOT : seuil de 15 % » |
| 3–8 | Contrôles C01 à C09, journal minimum | `controles` | `controles.test.ts` |

En plus de ces tests unitaires, `web/src/demo/parite.test.ts` compare le moteur aux résultats figés de
l'ancien moteur Python (banque fictive et cas unitaires, 1e-9 en relatif ; ADR 0005).

## Conventions

- Temps en années depuis l'arrêté ; taux en décimal (0,02 = 200 pb) ; taux zéro internes en
  capitalisation continue.
- Flux signés : actif positif, passif négatif. Un Δ négatif est une perte.
- Coupons fixés en début de période et versés en fin de période. La première période est supposée
  complète (coupon en cours fixé avant l'arrêté).
- KRD en devise par unité de taux : multiplier par 1e-4 pour lire une sensibilité à 1 pb.
