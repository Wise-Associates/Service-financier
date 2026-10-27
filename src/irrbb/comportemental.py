"""Modèles comportementaux et options clients (PDF p. 13).

Dépôts sans échéance : Δr_dépôt,t = α + Σⱼ βⱼ Δr_marché,t−ⱼ + εₜ ; Σβ = transmission cumulée.
Remboursement anticipé : S(t) = Πᵤ₌₁ᵗ (1 − hᵤ), hᵤ taux conditionnel mensuel (SMM).

Les paramètres (part stable, durée de vie, β, courbe de CPR) sont des hypothèses calibrées
par segment, datées et versionnées hors de ce module : ici, seules les formules.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from .courbes import Tableau
from .positions import Flux, interets_bilan_constant, taux_par_forward
from .scenarios import MarcheDevise

_JOUR = 1 / 365


def smm_depuis_cpr(cpr: ArrayLike) -> Tableau:
    """Taux mensuel conditionnel équivalent à un taux annuel : SMM = 1 − (1 − CPR)^(1/12)."""
    c = np.asarray(cpr, dtype=float)
    if np.any((c < 0) | (c > 1)):
        raise ValueError("CPR dans [0 ; 1]")
    return 1 - (1 - c) ** (1 / 12)


def survie(taux_conditionnels: ArrayLike) -> Tableau:
    """S(t) = Π (1 − hᵤ) : part des contrats encore vivants après chaque période."""
    h = np.asarray(taux_conditionnels, dtype=float)
    if np.any((h < 0) | (h > 1)):
        raise ValueError("taux conditionnels dans [0 ; 1]")
    return np.cumprod(1 - h)


def cpr_logistique(incitation: float, cpr_min: float, cpr_max: float, pente: float, centre: float = 0.0) -> float:
    """CPR en fonction de l'incitation au refinancement (taux client − taux de marché proposé).

    Courbe en S bornée par [cpr_min ; cpr_max] : forme usuelle d'un modèle logit calibré
    sur l'historique ; les quatre paramètres viennent de la calibration par segment.
    """
    if not 0 <= cpr_min <= cpr_max <= 1:
        raise ValueError("0 <= cpr_min <= cpr_max <= 1 requis")
    return cpr_min + (cpr_max - cpr_min) / (1 + math.exp(-pente * (incitation - centre)))


@dataclass(frozen=True)
class ResultatTransmission:
    alpha: float
    betas: Tableau
    r2: float
    ecart_type_residus: float
    nb_observations: int

    @property
    def beta_cumule(self) -> float:
        return float(np.sum(self.betas))


def estimer_transmission(
    delta_taux_servi: ArrayLike, delta_taux_marche: ArrayLike, nb_retards: int
) -> ResultatTransmission:
    """Moindres carrés de Δr_dépôt,t sur Δr_marché,t … Δr_marché,t−L (L = nb_retards)."""
    y_tot = np.asarray(delta_taux_servi, dtype=float)
    x_tot = np.asarray(delta_taux_marche, dtype=float)
    if y_tot.shape != x_tot.shape or y_tot.ndim != 1:
        raise ValueError("séries de même longueur attendues")
    if nb_retards < 0:
        raise ValueError("nb_retards >= 0")
    n = y_tot.size - nb_retards
    if n < nb_retards + 3:
        raise ValueError("historique trop court pour le nombre de retards")
    if not (np.all(np.isfinite(y_tot)) and np.all(np.isfinite(x_tot))):
        raise ValueError("valeurs manquantes ou non finies dans les séries")
    y = y_tot[nb_retards:]
    colonnes = [np.ones(n)] + [x_tot[nb_retards - j : y_tot.size - j] for j in range(nb_retards + 1)]
    X = np.column_stack(colonnes)
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    residus = y - X @ coef
    sct = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - float(np.sum(residus**2)) / sct if sct > 0 else float("nan")
    ddl = n - X.shape[1]
    return ResultatTransmission(float(coef[0]), coef[1:], r2, float(np.sqrt(np.sum(residus**2) / ddl)), n)


def stabilite_transmission(
    delta_taux_servi: ArrayLike, delta_taux_marche: ArrayLike, nb_retards: int, nb_sous_periodes: int = 2
) -> list[float]:
    """β cumulé estimé séparément sur des sous-périodes consécutives (test de stabilité)."""
    y = np.asarray(delta_taux_servi, dtype=float)
    x = np.asarray(delta_taux_marche, dtype=float)
    bornes = np.linspace(0, y.size, nb_sous_periodes + 1).astype(int)
    return [
        estimer_transmission(y[a:b], x[a:b], nb_retards).beta_cumule
        for a, b in zip(bornes[:-1], bornes[1:], strict=True)
    ]


def ecoulement_exponentiel(
    encours: float, duree_vie_moyenne: float, maturite_max: float, pas: float = 1 / 12
) -> tuple[Tableau, Tableau]:
    """Échéancier d'amortissement B(t) = B₀·e^(−t/d), tronqué à `maturite_max` (solde restant à cette date)."""
    if duree_vie_moyenne <= 0 or maturite_max <= 0 or pas <= 0:
        raise ValueError("durée de vie, maturité maximale et pas strictement positifs")
    n = math.ceil(maturite_max / pas - 1e-9)
    dates = np.minimum(np.arange(1, n + 1) * pas, maturite_max)
    soldes = encours * np.exp(-np.concatenate(([0.0], dates)) / duree_vie_moyenne)
    principal = soldes[:-1] - soldes[1:]
    principal[-1] += soldes[-1]
    return dates, principal


@dataclass(frozen=True)
class DepotNonEcheance:
    """Dépôts à vue : part volatile remboursée au jour le jour, part stable écoulée exponentiellement.

    Taux servi sous scénario : max(plancher, taux₀ + β·(fwdₛ(t) − fwd₀(t))), fwd sur l'index
    de référence. Passif : flux signés négativement.
    """

    identifiant: str
    devise: str
    encours: float
    part_stable: float
    taux_servi: float
    beta: float
    duree_vie_stable: float
    maturite_max: float = 5.0
    plancher_taux_servi: float = 0.0
    index: str | None = None
    pas: float = 1 / 12
    categorie: str = "depot_non_echeance"

    def __post_init__(self) -> None:
        if not 0 <= self.part_stable <= 1:
            raise ValueError(f"{self.identifiant} : part stable dans [0 ; 1]")
        if not 0 <= self.beta <= 1:
            raise ValueError(f"{self.identifiant} : β dans [0 ; 1]")
        if self.encours <= 0:
            raise ValueError(f"{self.identifiant} : encours strictement positif")
        if self.taux_servi < self.plancher_taux_servi:
            raise ValueError(f"{self.identifiant} : taux servi sous son plancher")

    def taux_servi_scenario(self, t: ArrayLike, marche: MarcheDevise, marche_base: MarcheDevise) -> Tableau:
        tt = np.asarray(t, dtype=float)
        fwd_s = marche.courbe_index(self.index).forward(tt, tt + self.pas)
        fwd_0 = marche_base.courbe_index(self.index).forward(tt, tt + self.pas)
        return np.maximum(self.plancher_taux_servi, self.taux_servi + self.beta * (fwd_s - fwd_0))

    def _echeancier(self) -> tuple[Tableau, Tableau]:
        volatile = self.encours * (1 - self.part_stable)
        dates_s, principal_s = ecoulement_exponentiel(
            self.encours * self.part_stable, self.duree_vie_stable, self.maturite_max, self.pas
        )
        return np.concatenate(([_JOUR], dates_s)), np.concatenate(([volatile], principal_s))

    def flux(self, marche: MarcheDevise, marche_base: MarcheDevise, inclure_marge: bool = True) -> Flux:
        dates, principal = self._echeancier()
        stable = self.encours * self.part_stable
        debuts_s = np.concatenate(([0.0], dates[1:-1]))
        soldes_s = stable - np.concatenate(([0.0], np.cumsum(principal[1:])[:-1]))
        interets_s = soldes_s * self.taux_servi_scenario(debuts_s, marche, marche_base) * (dates[1:] - debuts_s)
        interet_v = principal[0] * self.taux_servi_scenario(0.0, marche, marche_base) * _JOUR
        interets = np.concatenate(([float(interet_v)], interets_s))
        return Flux(dates, -interets, -principal)

    def interets(self, marche: MarcheDevise, marche_base: MarcheDevise, grille: Tableau) -> Tableau:
        g = np.asarray(grille, dtype=float)
        taux = self.taux_servi_scenario(g[:-1], marche, marche_base)
        return -self.encours * taux * np.diff(g)

    def echeancier_repricing(self, marche_base: MarcheDevise | None = None) -> tuple[Tableau, Tableau]:
        dates, principal = self._echeancier()
        return dates, -principal


@dataclass(frozen=True)
class PretRemboursementAnticipe:
    """Prêt à taux fixe amortissable mensuellement, avec remboursements anticipés dépendant du scénario.

    Incitation = taux client − (taux par de marché sur la durée résiduelle + marge) : sous un
    choc à la baisse, l'incitation monte, le CPR aussi, et les flux se raccourcissent.
    Le CPR est fixé à l'arrêté pour toute la vie du prêt (simplification documentée).
    """

    identifiant: str
    devise: str
    encours: float
    taux: float
    maturite: float
    marge: float
    cpr_min: float
    cpr_max: float
    pente: float
    centre: float = 0.0
    categorie: str = "pret_immobilier"

    def __post_init__(self) -> None:
        if self.encours <= 0 or self.maturite <= 0:
            raise ValueError(f"{self.identifiant} : encours et maturité strictement positifs")

    def cpr(self, marche: MarcheDevise) -> float:
        refi = taux_par_forward(marche.actualisation, 0.0, self.maturite, 12) + self.marge
        return cpr_logistique(self.taux - refi, self.cpr_min, self.cpr_max, self.pente, self.centre)

    def _echeancier(self, marche: MarcheDevise) -> tuple[Tableau, Tableau, Tableau]:
        """Dates mensuelles, solde avant paiement, principal total (contractuel + anticipé)."""
        n = math.ceil(self.maturite * 12 - 1e-9)
        dates = self.maturite - np.arange(n - 1, -1, -1) / 12
        smm = float(smm_depuis_cpr(self.cpr(marche)))
        i = self.taux / 12
        soldes = np.empty(n)
        principal = np.empty(n)
        b = self.encours
        for k in range(n):
            soldes[k] = b
            restant = n - k
            annuite = b / restant if abs(i) < 1e-12 else b * i / (1 - (1 + i) ** (-restant))
            contractuel = annuite - b * i
            anticipe = smm * (b - contractuel) if k < n - 1 else 0.0
            principal[k] = contractuel + anticipe
            b -= principal[k]
        principal[-1] += b
        return dates, soldes, principal

    def flux(self, marche: MarcheDevise, marche_base: MarcheDevise | None = None, inclure_marge: bool = True) -> Flux:
        dates, soldes, principal = self._echeancier(marche)
        taux = self.taux - (0.0 if inclure_marge else self.marge)
        return Flux(dates, soldes * taux / 12, principal)

    def interets(self, marche: MarcheDevise, marche_base: MarcheDevise | None, grille: Tableau) -> Tableau:
        dates, soldes, principal = self._echeancier(marche)

        def solde(t: float) -> float:
            k = int(np.searchsorted(dates, t + 1e-9, side="right"))
            return float(soldes[k]) if k < dates.size else 0.0

        return interets_bilan_constant(
            grille,
            solde,
            lambda t: self.taux,
            list(zip(dates.tolist(), principal.tolist(), strict=True)),
            lambda t: taux_par_forward(marche.actualisation, t, self.maturite, 12) + self.marge,
            self.maturite,
        )

    def echeancier_repricing(self, marche_base: MarcheDevise) -> tuple[Tableau, Tableau]:
        dates, _, principal = self._echeancier(marche_base)
        return dates, principal
