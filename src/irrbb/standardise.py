"""Approche standardisée et test des valeurs aberrantes (PDF p. 15).

Voie prudentielle distincte du modèle interne : les flux sont affectés aux 19 tranches de
repricing de Bâle (BCBS d368, tableau 2) et actualisés au point milieu de la tranche avec
des taux zéro continus, DF = exp(−R·t_milieu).

Traitements retenus (paramètres à aligner sur les règles prescrites en vigueur) :
- taux fixe : flux contractuels ; taux variable : coupon en cours et nominal à la prochaine
  révision ;
- dépôts sans échéance et remboursements anticipés : flux du modèle comportemental,
  régénérés sous chaque scénario ; leurs paramètres doivent respecter les plafonds prescrits ;
- options automatiques : revalorisation complète sous chaque scénario.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

import numpy as np

from .courbes import Tableau
from .options import CapFloor
from .positions import Flux, Instrument, Position
from .scenarios import (
    SCENARIOS_EVE,
    MarcheDevise,
    ParametresChoc,
    marche_scenario,
    plancher_eba,
)

BORNES_BALE: Tableau = np.array(
    [0.0, 1 / 360, 1 / 12, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, np.inf]
)
MILIEUX_BALE: Tableau = np.array(
    [0.0028, 0.0417, 0.1667, 0.375, 0.625, 0.875, 1.25, 1.75, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 12.5, 17.5, 25.0]
)


def repartir_flux(dates: Tableau, montants: Tableau) -> Tableau:
    """Somme des flux par tranche de Bâle ; une date t tombe dans la tranche ]a ; b]."""
    d = np.asarray(dates, dtype=float)
    if np.any(d <= 0):
        raise ValueError("flux échus (t <= 0) à exclure avant la répartition")
    idx = np.searchsorted(BORNES_BALE, d, side="left") - 1
    res = np.zeros(MILIEUX_BALE.size)
    np.add.at(res, idx, np.asarray(montants, dtype=float))
    return res


def _flux_standardises(p: Position, marche_s: MarcheDevise, marche_0: MarcheDevise, inclure_marge: bool) -> Flux:
    if isinstance(p, Instrument):
        f = p.flux(marche_0, marche_0, inclure_marge)
        if p.index is None:
            return f
        # Taux variable : le nominal reprice en totalité à la prochaine révision.
        return Flux(f.dates[:1], f.interets[:1], np.array([p.sens * p.nominal]))
    return p.flux(marche_s, marche_0, inclure_marge)


def agreger_devises(delta_par_devise: dict[str, float], poids_gains: float) -> float:
    """Somme des ΔEVE par devise, les gains pondérés par `poids_gains`.

    0,5 correspond à l'agrégation du RTS UE (gains comptés à 50 %), 0 à la seule prise en
    compte des pertes ; le paramètre doit suivre le texte applicable.
    """
    if not 0 <= poids_gains <= 1:
        raise ValueError("poids_gains dans [0 ; 1]")
    return float(sum(min(v, 0.0) + poids_gains * max(v, 0.0) for v in delta_par_devise.values()))


@dataclass(frozen=True)
class ResultatStandardise:
    delta_par_scenario_devise: dict[str, dict[str, float]]
    poids_gains: float

    def delta_agrege(self, scenario: str) -> float:
        return agreger_devises(self.delta_par_scenario_devise[scenario], self.poids_gains)

    def mesure_risque(self) -> tuple[str, float]:
        """Scénario le plus défavorable et perte agrégée (>= 0)."""
        pertes = {s: -self.delta_agrege(s) for s in self.delta_par_scenario_devise}
        pire = max(pertes, key=lambda s: pertes[s])
        return pire, max(0.0, pertes[pire])


def calculer_delta_eve_standardise(
    positions: Sequence[Position],
    marches: dict[str, MarcheDevise],
    parametres_choc: dict[str, ParametresChoc],
    *,
    inclure_marge: bool,
    poids_gains: float,
    scenarios: Iterable[str] = SCENARIOS_EVE,
    plancher: Callable[[Tableau], Tableau] | None = plancher_eba,
) -> ResultatStandardise:
    res: dict[str, dict[str, float]] = {}
    for s in scenarios:
        par_devise: dict[str, float] = {}
        for d, m0 in marches.items():
            pos = [p for p in positions if p.devise == d]
            if not pos:
                continue
            if d not in parametres_choc:
                raise ValueError(f"paramètres de choc absents pour {d}")
            ms = marche_scenario(m0, s, parametres_choc[d], plancher)
            df0 = m0.actualisation.facteur_actualisation(MILIEUX_BALE)
            dfs = ms.actualisation.facteur_actualisation(MILIEUX_BALE)
            delta = 0.0
            for p in pos:
                if isinstance(p, CapFloor):
                    delta += p.prix(ms) - p.prix(m0)
                    continue
                f0 = _flux_standardises(p, m0, m0, inclure_marge)
                fs = _flux_standardises(p, ms, m0, inclure_marge)
                v0, vs = (f.dates > 0 for f in (f0, fs))
                delta += float(repartir_flux(fs.dates[vs], fs.total[vs]) @ dfs)
                delta -= float(repartir_flux(f0.dates[v0], f0.total[v0]) @ df0)
            par_devise[d] = delta
        res[s] = par_devise
    return ResultatStandardise(res, poids_gains)


@dataclass(frozen=True)
class ResultatSOT:
    indicateur: str
    scenario: str
    perte: float
    fonds_propres_t1: float
    ratio: float
    seuil: float

    @property
    def depassement(self) -> bool:
        return self.ratio > self.seuil


def controle_valeurs_aberrantes(
    delta_par_scenario: dict[str, float], fonds_propres_t1: float, seuil: float, indicateur: str
) -> ResultatSOT:
    """Perte maximale (−Δ) rapportée aux fonds propres Tier 1.

    Seuils usuels : 15 % pour ΔEVE (cadre Bâle) ; le RTS UE ajoute un test ΔNII (5 %). Les
    seuils et scénarios applicables sont des paramètres à confirmer sur les RTS en vigueur.
    """
    if fonds_propres_t1 <= 0:
        raise ValueError("fonds propres Tier 1 strictement positifs")
    if not delta_par_scenario:
        raise ValueError("aucun scénario fourni")
    pire = min(delta_par_scenario, key=lambda s: delta_par_scenario[s])
    perte = max(0.0, -delta_par_scenario[pire])
    return ResultatSOT(indicateur, pire, perte, fonds_propres_t1, perte / fonds_propres_t1, seuil)
