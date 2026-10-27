"""Sensibilités, gaps de repricing et risque de base (PDF p. 14).

PV01 ≈ [PV(r − 1 pb) − PV(r + 1 pb)] / 2      (positif pour une obligation détenue)
ΔPV ≈ −Σₘ KRDₘ·Δrₘ + ½·Γ·(Δr)²

Ici KRDₘ = −∂PV/∂rₘ en devise par unité de taux (1 = 10 000 pb) et Γ = ∂²PV/∂r² pour un
déplacement parallèle. Ces approximations expliquent les variations ; les mesures
réglementaires restent calculées par revalorisation complète (module `mesures`).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from .courbes import Tableau
from .mesures import valeur_actualisee
from .positions import Position
from .scenarios import MarcheDevise, decaler_marche


def _pv(
    positions: Sequence[Position],
    marche: MarcheDevise,
    devise: str,
    inclure_marge: bool,
    delta: Callable[[Tableau], Tableau] | None = None,
    index: str | None = None,
) -> float:
    choque = marche if delta is None else decaler_marche(marche, delta, None, index)
    return sum(valeur_actualisee(p, choque, marche, inclure_marge) for p in positions if p.devise == devise)


def pv01(positions: Sequence[Position], marche: MarcheDevise, *, inclure_marge: bool, pb: float = 1e-4) -> float:
    """Sensibilité parallèle à 1 pb de toutes les courbes de la devise, sans plancher."""
    d = marche.devise
    bas = _pv(positions, marche, d, inclure_marge, lambda t: np.full_like(t, -pb))
    haut = _pv(positions, marche, d, inclure_marge, lambda t: np.full_like(t, pb))
    return (bas - haut) / 2


def _triangle(piliers: Tableau, m: int) -> Callable[[Tableau], Tableau]:
    unite = np.zeros(piliers.size)
    unite[m] = 1.0
    return lambda t: np.interp(np.asarray(t, dtype=float), piliers, unite)


def krd(
    positions: Sequence[Position],
    marche: MarcheDevise,
    piliers: Sequence[float],
    *,
    inclure_marge: bool,
    pb: float = 1e-4,
) -> dict[float, float]:
    """Key rate durations par chocs triangulaires sur les piliers.

    Les triangles somment à 1 en toute maturité (extrapolation plate aux extrémités) : la somme
    des KRD égale la sensibilité parallèle, ce qui sert de contrôle de cohérence.
    """
    p = np.asarray(piliers, dtype=float)
    if p.ndim != 1 or p.size < 1 or np.any(np.diff(p) <= 0):
        raise ValueError("piliers strictement croissants")
    d = marche.devise
    res: dict[float, float] = {}
    for m in range(p.size):
        forme = _triangle(p, m)

        def bas_m(t: Tableau, f: Callable[[Tableau], Tableau] = forme) -> Tableau:
            return -pb * f(t)

        def haut_m(t: Tableau, f: Callable[[Tableau], Tableau] = forme) -> Tableau:
            return pb * f(t)

        bas = _pv(positions, marche, d, inclure_marge, bas_m)
        haut = _pv(positions, marche, d, inclure_marge, haut_m)
        res[float(p[m])] = (bas - haut) / (2 * pb)
    return res


def gamma(positions: Sequence[Position], marche: MarcheDevise, *, inclure_marge: bool, h: float = 1e-3) -> float:
    """Convexité parallèle Γ = [PV(+h) + PV(−h) − 2·PV(0)] / h²."""
    d = marche.devise
    base = _pv(positions, marche, d, inclure_marge)
    haut = _pv(positions, marche, d, inclure_marge, lambda t: np.full_like(t, h))
    bas = _pv(positions, marche, d, inclure_marge, lambda t: np.full_like(t, -h))
    return (haut + bas - 2 * base) / h**2


def approximation_taylor(
    krds: dict[float, float], gamma_parallele: float, chocs_piliers: dict[float, float], choc_moyen: float
) -> float:
    """ΔPV ≈ −Σ KRDₘ·Δrₘ + ½·Γ·Δr², Δr = `choc_moyen` pour le terme de convexité."""
    inconnus = set(chocs_piliers) - set(krds)
    if inconnus:
        raise ValueError(f"piliers de choc sans KRD : {sorted(inconnus)}")
    lineaire = -sum(krds[m] * chocs_piliers.get(m, 0.0) for m in krds)
    return lineaire + 0.5 * gamma_parallele * choc_moyen**2


def delta_pv_risque_base(
    positions: Sequence[Position], marche: MarcheDevise, index: str, choc: float, *, inclure_marge: bool
) -> float:
    """ΔPV d'un choc appliqué à la seule courbe de projection de `index` (choc différentiel de base)."""
    d = marche.devise
    base = _pv(positions, marche, d, inclure_marge)
    return _pv(positions, marche, d, inclure_marge, lambda t: np.full_like(t, choc), index) - base


@dataclass(frozen=True)
class Gaps:
    bornes: Tableau
    gaps: Tableau

    @property
    def cumules(self) -> Tableau:
        return np.cumsum(self.gaps)

    def libelles(self) -> list[str]:
        def fmt(x: float) -> str:
            if np.isinf(x):
                return "∞"
            return f"{round(x * 12)}m" if 0 < x < 1 else f"{x:g}a"

        return [f"]{fmt(a)} ; {fmt(b)}]" for a, b in zip(self.bornes[:-1], self.bornes[1:], strict=True)]


BORNES_GAPS: tuple[float, ...] = (0, 1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, float("inf"))


def gaps_repricing(
    positions: Sequence[Position], marche_base: MarcheDevise, bornes: Sequence[float] = BORNES_GAPS
) -> Gaps:
    """Encours signés affectés à la tranche de leur prochaine date de repricing (actif − passif)."""
    b = np.asarray(bornes, dtype=float)
    if b.ndim != 1 or b.size < 2 or np.any(np.diff(b) <= 0):
        raise ValueError("bornes strictement croissantes")
    gaps = np.zeros(b.size - 1)
    for p in positions:
        if p.devise != marche_base.devise:
            continue
        dates, montants = p.echeancier_repricing(marche_base)
        if dates.size == 0:
            continue
        idx = np.searchsorted(b, dates, side="left") - 1
        if np.any(idx < 0) or np.any(idx >= gaps.size):
            raise ValueError(f"{p.identifiant} : date de repricing hors des bornes des tranches")
        np.add.at(gaps, idx, montants)
    return Gaps(b, gaps)
