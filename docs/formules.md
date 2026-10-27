# Carte des formules

Chaque formule du document de cadrage *Contrôles du reporting IRRBB* (v3, 23/10/2026) est reliée
à la fonction qui la calcule et au test qui la vérifie. La colonne « Vérification » dit contre quoi
le test compare : une formule fermée écrite dans le test, une seconde méthode indépendante ou une
identité financière. Le moteur n'est jamais vérifié avec son propre code.

| Page | Formule | Fonction | Vérification (test) |
|---|---|---|---|
| 10 | D(0,t) = exp(−∫₀ᵗ f(0,u)du) | `courbes.Courbe.facteur_actualisation`, `forward_instantane` | Intégration numérique du forward instantané (`test_forward_instantane_integre_redonne_le_df`) |
| 10 | Capitalisation paramétrable | `courbes.convertir_taux` | Valeur fermée ln(1,05), aller-retour (`test_conversion_capitalisation_…`) |
| 10 | Bootstrapping | `courbes.bootstrap_swaps` | Repricing des swaps par à 1e-14 (`test_bootstrap_reprice_les_swaps_par`) |
| 10 | rₛ,c(τ) = r₀,c(τ) + Δrₛ,c(τ), plancher post-choc | `scenarios.choc`, `plancher_eba`, `courbes.CourbeDecalee` | Limites τ = 0 et τ → ∞ des six chocs, valeur en τ = x (`test_scenarios.py`) |
| 9 | CFᵢ,ₛ = CFᵢ(rₛ, contrat, comportement) | `positions.Instrument.flux` | Annuité constante fermée ; identité « un FRN vaut le pair » (`test_positions_mesures.py`) |
| 11 | EVEₛ = Σₖ Dₛ(0,tₖ)·CFₖ,ₛ ; ΔEVEₛ = EVEₛ − EVE₀ | `mesures.calculer_delta_eve` | ΔEVE d'un zéro-coupon en formule fermée (`test_delta_eve_zero_coupon_formule_fermee`) |
| 11 | maxₛ(EVE₀ − EVEₛ) | `ResultatMesure.perte_maximale` | Idem |
| 11 | Marges commerciales incluses ou exclues | paramètre obligatoire `inclure_marge` | `test_exclusion_de_la_marge_identique_en_base_et_en_choc` |
| 12 | NIIₛ = Σₜ (intérêts actifs − intérêts passifs) ; ΔNIIₛ | `mesures.calculer_delta_nii`, `positions.interets_bilan_constant` | NII fermé d'un taux fixe renouvelé et d'un taux variable (`test_nii_…`) |
| 12 | Décomposition par devise, produit, position | `ResultatMesure.decomposition` | La somme des composantes égale le total (`test_decomposition_par_devise_somme_au_total`) |
| 13 | Δr_dépôt,t = α + Σⱼ βⱼ Δr_marché,t−ⱼ + εₜ | `comportemental.estimer_transmission`, `stabilite_transmission` | Retrouve β = (0,30 ; 0,20) simulés (`test_estimation_retrouve_les_betas_simules`) |
| 13 | Part stable / volatile, décroissance | `comportemental.DepotNonEcheance`, `ecoulement_exponentiel` | Solde à 1 an = e^(−1/d) ; ΔNII = −β·Δfwd·encours ; plancher (`test_depot_…`) |
| 13 | S(t) = Πᵤ (1 − hᵤ) | `comportemental.survie`, `smm_depuis_cpr` | 12 mois de SMM redonnent 1 − CPR (`test_smm_et_survie_…`) |
| 13 | Remboursement anticipé selon l'incitation | `comportemental.PretRemboursementAnticipe`, `cpr_logistique` | Sans option, identique à l'annuité constante (seconde méthode) |
| 14 | PV01 ≈ [PV(r−1pb) − PV(r+1pb)]/2 | `sensibilites.pv01` | 100·e^(−rT)·sinh(T·1 pb) (`test_pv01_zero_coupon_formule_fermee`) |
| 14 | ΔPV ≈ −Σₘ KRDₘΔrₘ + ½Γ(Δr)² | `sensibilites.krd`, `gamma`, `approximation_taylor` | Σ KRD = sensibilité parallèle ; Taylor contre revalorisation complète |
| 14 | Gaps de repricing | `sensibilites.gaps_repricing` | Somme = encours signés ; tranches calculées à la main |
| 14 | Risque de base | `sensibilites.delta_pv_risque_base`, `scenarios.decaler_marche(index=…)` | Référence écrite à la main sur les facteurs choqués |
| 14 | Black, Bachelier, caps et floors | `options.black76`, `bachelier`, `CapFloor` | Intégration numérique du payoff ; parité cap − floor = swap |
| 15 | Approche standardisée (19 tranches) | `standardise.calculer_delta_eve_standardise` | Flux au point milieu = revalorisation complète |
| 15 | SOT : 15 % du Tier 1 (ΔEVE), 5 % (ΔNII) | `standardise.controle_valeurs_aberrantes` | `test_sot_seuil_de_15_pourcent` |
| 3–8 | Contrôles C01 à C09, journal minimum | `controles` | `test_controles.py` |

## Conventions

- Temps en années depuis l'arrêté ; taux en décimal (0,02 = 200 pb) ; taux zéro internes en
  capitalisation continue.
- Flux signés : actif positif, passif négatif. Un Δ négatif est une perte.
- Coupons fixés en début de période et versés en fin de période. La première période est supposée
  complète (coupon en cours fixé avant l'arrêté).
- KRD en devise par unité de taux : multiplier par 1e-4 pour lire une sensibilité à 1 pb.
