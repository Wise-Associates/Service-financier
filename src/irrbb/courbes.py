"""Courbes de taux et facteurs d'actualisation (PDF p. 10).

Convention interne unique : taux zéro en capitalisation continue, temps en années.
D(0,t) = exp(-r(t)·t) = exp(-∫₀ᵗ f(0,u) du). Les taux saisis dans une autre convention
sont convertis à l'entrée (`convertir_taux`), ce qui garde la capitalisation paramétrable
sans la propager dans les calculs.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray

Capitalisation = Literal["continue", "annuelle", "simple"]
Tableau = NDArray[np.float64]


def convertir_taux(taux: ArrayLike, t: ArrayLike, de: Capitalisation, vers: Capitalisation) -> Tableau:
    """Convertit un taux zéro d'une capitalisation à une autre pour la maturité t (années).

    Passe par le facteur d'actualisation, seul objet invariant entre conventions.
    """
    r = np.asarray(taux, dtype=float)
    tt = np.asarray(t, dtype=float)
    if np.any(tt <= 0):
        raise ValueError("convertir_taux : maturités strictement positives requises")
    df = _df_depuis_taux(r, tt, de)
    return _taux_depuis_df(df, tt, vers)


def _df_depuis_taux(r: Tableau, t: Tableau, conv: Capitalisation) -> Tableau:
    if conv == "continue":
        return np.asarray(np.exp(-r * t), dtype=float)
    if conv == "annuelle":
        if np.any(r <= -1):
            raise ValueError("taux annuel <= -100 % : facteur d'actualisation indéfini")
        return np.asarray((1 + r) ** (-t), dtype=float)
    if conv == "simple":
        if np.any(1 + r * t <= 0):
            raise ValueError("taux simple trop négatif pour la maturité : 1 + r·t <= 0")
        return np.asarray(1 / (1 + r * t), dtype=float)
    raise ValueError(f"capitalisation inconnue : {conv}")


def _taux_depuis_df(df: Tableau, t: Tableau, conv: Capitalisation) -> Tableau:
    if conv == "continue":
        return np.asarray(-np.log(df) / t, dtype=float)
    if conv == "annuelle":
        return np.asarray(df ** (-1 / t) - 1, dtype=float)
    if conv == "simple":
        return (1 / df - 1) / t
    raise ValueError(f"capitalisation inconnue : {conv}")


class Courbe:
    """Interface commune : toute courbe fournit un taux zéro continu r(t)."""

    def taux_zero(self, t: ArrayLike) -> Tableau:
        raise NotImplementedError

    def facteur_actualisation(self, t: ArrayLike) -> Tableau:
        tt = np.asarray(t, dtype=float)
        return np.asarray(np.exp(-self.taux_zero(tt) * tt), dtype=float)

    def forward(self, t1: ArrayLike, t2: ArrayLike) -> Tableau:
        """Taux forward en capitalisation simple entre t1 et t2 (base de calcul des coupons variables)."""
        a = np.asarray(t1, dtype=float)
        b = np.asarray(t2, dtype=float)
        if np.any(b <= a):
            raise ValueError("forward : t2 doit être strictement supérieur à t1")
        return np.asarray((self.facteur_actualisation(a) / self.facteur_actualisation(b) - 1) / (b - a), dtype=float)

    def forward_instantane(self, t: ArrayLike, h: float = 1e-5) -> Tableau:
        """f(0,t) = -d ln D(0,t) / dt, par différence centrée (décentrée près de 0)."""
        tt = np.asarray(t, dtype=float)
        bas = np.maximum(tt - h, 0.0)
        haut = tt + h
        ln_bas = np.log(self.facteur_actualisation(bas))
        ln_haut = np.log(self.facteur_actualisation(haut))
        return -(ln_haut - ln_bas) / (haut - bas)


class CourbeZero(Courbe):
    """Courbe définie par des piliers de taux zéro.

    Interpolation linéaire des taux zéro continus entre piliers, extrapolation plate
    au-delà : choix simple, documenté et reproductible (PDF p. 10). Une autre méthode
    se branche en sous-classant `Courbe`.
    """

    def __init__(
        self,
        maturites: ArrayLike,
        taux: ArrayLike,
        capitalisation: Capitalisation = "continue",
        nom: str = "",
    ) -> None:
        m = np.asarray(maturites, dtype=float)
        r = np.asarray(taux, dtype=float)
        if m.ndim != 1 or m.shape != r.shape or m.size == 0:
            raise ValueError("CourbeZero : maturités et taux de même longueur, non vides")
        if np.any(m <= 0) or np.any(np.diff(m) <= 0):
            raise ValueError("CourbeZero : maturités strictement positives et croissantes")
        if not np.all(np.isfinite(r)):
            raise ValueError("CourbeZero : taux non finis")
        self.maturites = m
        self.taux_continus = convertir_taux(r, m, capitalisation, "continue")
        self.nom = nom

    def taux_zero(self, t: ArrayLike) -> Tableau:
        tt = np.asarray(t, dtype=float)
        return np.asarray(np.interp(tt, self.maturites, self.taux_continus), dtype=float)


class CourbeDecalee(Courbe):
    """Courbe de base déplacée d'un choc additif Δr(τ), avec plancher optionnel.

    rₛ(τ) = r₀(τ) + Δrₛ(τ) (PDF p. 10). Le plancher s'applique après choc ; si le taux
    observé est déjà sous le plancher, le taux observé sert de plancher (règle EBA :
    un choc ne doit pas remonter un taux négatif observé).
    """

    def __init__(
        self,
        base: Courbe,
        choc: Callable[[Tableau], Tableau],
        plancher: Callable[[Tableau], Tableau] | None = None,
    ) -> None:
        self.base = base
        self.choc = choc
        self.plancher = plancher

    def taux_zero(self, t: ArrayLike) -> Tableau:
        tt = np.asarray(t, dtype=float)
        r0 = self.base.taux_zero(tt)
        r = r0 + self.choc(tt)
        if self.plancher is None:
            return r
        borne = np.minimum(self.plancher(tt), r0)
        return np.maximum(r, borne)


def bootstrap_swaps(maturites: Sequence[int], taux_par: Sequence[float]) -> CourbeZero:
    """Bootstrapping d'une courbe à partir de taux de swap par à jambe fixe annuelle.

    D(Tₙ) = (1 − Sₙ · Σᵢ<ₙ D(Tᵢ)) / (1 + Sₙ). Exige des maturités entières consécutives
    1, 2, …, N : interpoler les taux par manquants est un choix de marché que l'appelant
    doit faire et documenter, pas le moteur.
    """
    m = [int(x) for x in maturites]
    if m != list(range(1, len(m) + 1)):
        raise ValueError("bootstrap_swaps : maturités annuelles consécutives 1..N attendues")
    s = np.asarray(taux_par, dtype=float)
    if s.shape != (len(m),):
        raise ValueError("bootstrap_swaps : un taux par maturité")
    dfs: list[float] = []
    for sn in s:
        df = (1 - sn * sum(dfs)) / (1 + sn)
        if df <= 0:
            raise ValueError("bootstrap_swaps : facteur d'actualisation négatif, données incohérentes")
        dfs.append(df)
    t = np.asarray(m, dtype=float)
    zero = -np.log(np.asarray(dfs)) / t
    return CourbeZero(t, zero, "continue", nom="bootstrap swaps")
