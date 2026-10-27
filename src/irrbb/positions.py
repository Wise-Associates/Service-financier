"""Représentation des positions et génération des flux (PDF p. 4 et 9).

CFᵢ,ₛ = CFᵢ(rₛ, paramètres contractuels, paramètres comportementaux).

Conventions :
- temps en années depuis la date d'arrêté ; montants dans la devise de la position ;
- sens = +1 pour un actif, −1 pour un passif : les flux sont signés (un dépôt donne des
  flux négatifs), si bien qu'EVE = Σ D·CF se lit directement comme valeur actif − passif ;
- coupons fixés en début de période (reset in advance), versés en fin de période ;
- la première période est supposée complète : le coupon en cours a été fixé à la dernière
  date de révision, avant l'arrêté.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

from .courbes import Courbe, Tableau
from .scenarios import MarcheDevise

Amortissement = Literal["in_fine", "lineaire", "annuite"]
_EPS = 1e-9


@dataclass(frozen=True)
class Flux:
    """Flux signés d'une position : intérêts et principal par date de paiement."""

    dates: Tableau
    interets: Tableau
    principal: Tableau

    @property
    def total(self) -> Tableau:
        return self.interets + self.principal


class Position(Protocol):
    """Contrat minimal pour qu'une position entre dans les calculs EVE, NII et gaps."""

    @property
    def identifiant(self) -> str: ...

    @property
    def categorie(self) -> str: ...

    @property
    def devise(self) -> str: ...

    def flux(self, marche: MarcheDevise, marche_base: MarcheDevise, inclure_marge: bool) -> Flux:
        """Flux signés sous le marché du scénario."""
        ...

    def interets(self, marche: MarcheDevise, marche_base: MarcheDevise, grille: Tableau) -> Tableau:
        """Intérêts signés de chaque période de la grille, à bilan constant."""
        ...

    def echeancier_repricing(self, marche_base: MarcheDevise) -> tuple[Tableau, Tableau]:
        """Dates de prochain repricing et montants signés qui repricent à ces dates."""
        ...


def taux_par_forward(courbe: Courbe, debut: float, duree: float, frequence: int) -> float:
    """Taux fixe par d'un contrat démarrant en `debut` pour `duree` ans (base du renouvellement)."""
    n = max(1, round(duree * frequence))
    dates = debut + np.arange(1, n + 1) / frequence
    df = courbe.facteur_actualisation(dates)
    annuite = float(np.sum(df)) / frequence
    return float((courbe.facteur_actualisation(debut) - df[-1]) / annuite)


@dataclass
class _Tranche:
    montant: float
    taux: float
    prochaine_revision: float


def interets_bilan_constant(
    grille: Tableau,
    solde: Callable[[float], float],
    taux_contractuel: Callable[[float], float],
    remboursements: list[tuple[float, float]],
    taux_renouvellement: Callable[[float], float],
    periode_renouvellement: float,
) -> Tableau:
    """Intérêts (non signés) par période de grille, à bilan constant (PDF p. 12).

    Chaque montant qui arrive à échéance est remplacé par une tranche de caractéristiques
    comparables, au taux de renouvellement du scénario à sa date de remplacement, puis
    révisée tous les `periode_renouvellement` ans. L'état est lu au début de chaque période
    de la grille : un événement entre deux nœuds prend effet au nœud suivant, d'où une grille
    mensuelle par défaut.
    """
    g = np.asarray(grille, dtype=float)
    if g.ndim != 1 or g.size < 2 or np.any(np.diff(g) <= 0):
        raise ValueError("grille : au moins deux nœuds strictement croissants")
    if periode_renouvellement <= 0:
        raise ValueError("periode_renouvellement strictement positive")
    restants = sorted(remboursements)
    tranches: list[_Tranche] = []
    resultat = np.zeros(g.size - 1)
    for j in range(g.size - 1):
        t, dt = g[j], g[j + 1] - g[j]
        while restants and restants[0][0] <= t + _EPS:
            date, montant = restants.pop(0)
            if montant > 0:
                tranches.append(_Tranche(montant, taux_renouvellement(date), date + periode_renouvellement))
        for tr in tranches:
            while tr.prochaine_revision <= t + _EPS:
                tr.taux = taux_renouvellement(tr.prochaine_revision)
                tr.prochaine_revision += periode_renouvellement
        renouvele = sum(tr.montant * tr.taux for tr in tranches)
        resultat[j] = (solde(t) * taux_contractuel(t) + renouvele) * dt
    return resultat


@dataclass(frozen=True)
class Instrument:
    """Prêt, dépôt à terme, titre, jambe de dérivé ou engagement hors bilan.

    taux : taux client en vigueur (pour un taux variable, dernier fixing marge comprise).
    index : None pour un taux fixe ; sinon nom de l'index de la courbe de projection.
    marge : marge commerciale (fixe) ou spread sur index (variable). Exclue des flux si
            `inclure_marge=False`, de façon identique en base et en choc (PDF p. 11).
    facteur_conversion : part de l'encours retenue (tirage attendu d'un hors-bilan).
    duree_renouvellement : durée des tranches de remplacement en ΔNII ; par défaut la
            maturité résiduelle (approximation à remplacer par la durée d'origine si connue).
    Une jambe de swap se modélise comme un instrument avec échange de notionnel à
    l'échéance : les notionnels des deux jambes se compensent.
    """

    identifiant: str
    categorie: str
    devise: str
    sens: int
    encours: float
    taux: float
    maturite: float
    frequence: int = 1
    amortissement: Amortissement = "in_fine"
    index: str | None = None
    marge: float = 0.0
    facteur_conversion: float = 1.0
    duree_renouvellement: float | None = None

    def __post_init__(self) -> None:
        if self.sens not in (1, -1):
            raise ValueError(f"{self.identifiant} : sens = +1 (actif) ou −1 (passif)")
        if not (self.encours > 0 and math.isfinite(self.encours)):
            raise ValueError(f"{self.identifiant} : encours strictement positif et fini")
        if not (self.maturite > 0 and math.isfinite(self.maturite)):
            raise ValueError(f"{self.identifiant} : maturité strictement positive")
        if self.frequence < 1:
            raise ValueError(f"{self.identifiant} : fréquence >= 1")
        if self.index is not None and self.amortissement == "annuite":
            raise ValueError(f"{self.identifiant} : annuité constante non définie pour un taux variable")
        if not 0 < self.facteur_conversion <= 1:
            raise ValueError(f"{self.identifiant} : facteur de conversion dans ]0 ; 1]")

    @property
    def nominal(self) -> float:
        return self.encours * self.facteur_conversion

    def dates_paiement(self) -> Tableau:
        n = math.ceil(self.maturite * self.frequence - _EPS)
        return self.maturite - np.arange(n - 1, -1, -1) / self.frequence

    def _soldes_et_principal(self) -> tuple[Tableau, Tableau]:
        """Solde avant chaque paiement et principal versé (non signés)."""
        n = self.dates_paiement().size
        N = self.nominal
        if self.amortissement == "in_fine":
            principal = np.zeros(n)
            principal[-1] = N
        elif self.amortissement == "lineaire":
            principal = np.full(n, N / n)
        else:
            i = self.taux / self.frequence
            annuite = N / n if abs(i) < 1e-12 else N * i / (1 - (1 + i) ** (-n))
            soldes = np.empty(n)
            principal = np.empty(n)
            s = N
            for k in range(n):
                soldes[k] = s
                principal[k] = annuite - s * i
                s -= principal[k]
            principal[-1] += s  # résidu d'arrondi flottant : le solde final doit être nul
            return soldes, principal
        soldes = N - np.concatenate(([0.0], np.cumsum(principal)[:-1]))
        return soldes, principal

    def _taux_periodes(self, marche: MarcheDevise, inclure_marge: bool) -> Tableau:
        dates = self.dates_paiement()
        retrait = 0.0 if inclure_marge else self.marge
        taux = np.full(dates.size, self.taux - retrait)
        if self.index is not None and dates.size > 1:
            courbe = marche.courbe_index(self.index)
            fwd = courbe.forward(dates[:-1], dates[1:])
            taux[1:] = fwd + self.marge - retrait
        return taux

    def flux(self, marche: MarcheDevise, marche_base: MarcheDevise | None = None, inclure_marge: bool = True) -> Flux:
        dates = self.dates_paiement()
        soldes, principal = self._soldes_et_principal()
        interets = soldes * self._taux_periodes(marche, inclure_marge) / self.frequence
        return Flux(dates, self.sens * interets, self.sens * principal)

    def interets(self, marche: MarcheDevise, marche_base: MarcheDevise | None, grille: Tableau) -> Tableau:
        dates = self.dates_paiement()
        soldes, principal = self._soldes_et_principal()
        taux = self._taux_periodes(marche, inclure_marge=True)
        courbe = marche.courbe_index(self.index)

        def periode(t: float) -> int:
            return int(np.searchsorted(dates, t + _EPS, side="right"))

        def solde(t: float) -> float:
            k = periode(t)
            return float(soldes[k]) if k < dates.size else 0.0

        def taux_contractuel(t: float) -> float:
            k = periode(t)
            return float(taux[k]) if k < dates.size else 0.0

        if self.index is None:
            duree = self.duree_renouvellement or self.maturite

            def renouvellement(t: float) -> float:
                return taux_par_forward(courbe, t, duree, self.frequence) + self.marge

            periode_renouv = duree
        else:
            pas = 1 / self.frequence

            def renouvellement(t: float) -> float:
                return float(courbe.forward(t, t + pas)) + self.marge

            periode_renouv = pas

        bruts = interets_bilan_constant(
            grille,
            solde,
            taux_contractuel,
            list(zip(dates.tolist(), principal.tolist(), strict=True)),
            renouvellement,
            periode_renouv,
        )
        return self.sens * bruts

    def echeancier_repricing(self, marche_base: MarcheDevise | None = None) -> tuple[Tableau, Tableau]:
        dates = self.dates_paiement()
        soldes, principal = self._soldes_et_principal()
        if self.index is None:
            return dates, self.sens * principal
        # Un taux variable reprice en totalité à sa prochaine date de révision.
        return dates[:1], np.array([self.sens * soldes[0]])
