"""Options automatiques : caps et floors (PDF p. 14).

Black (log-normal) et Bachelier (normal) pour les options simples ; les options dépendantes
du chemin demandent un arbre ou un Monte Carlo calibré et sont hors du périmètre de ce module.

Pour entrer dans ΔEVE = Σ D·CF, chaque caplet est représenté par son flux équivalent certain
(prix du caplet / D(t_paiement)) à sa date de paiement : la somme actualisée redonne le prix.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np

from .courbes import Tableau
from .positions import Flux
from .scenarios import MarcheDevise

Modele = Literal["black", "bachelier"]


def _n(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _densite(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def black76(F: float, K: float, T: float, vol: float, df: float = 1.0, cp: int = 1) -> float:
    """Prix Black d'un call (cp=1) ou put (cp=−1) sur forward F, non actualisé si df=1."""
    if cp not in (1, -1):
        raise ValueError("cp = 1 (call) ou −1 (put)")
    if F <= 0 or K <= 0:
        raise ValueError("Black : forward et strike strictement positifs (utiliser Bachelier sinon)")
    if T <= 0 or vol <= 0:
        return df * max(cp * (F - K), 0.0)
    s = vol * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * s * s) / s
    d2 = d1 - s
    return df * cp * (F * _n(cp * d1) - K * _n(cp * d2))


def bachelier(F: float, K: float, T: float, vol_normale: float, df: float = 1.0, cp: int = 1) -> float:
    """Prix Bachelier (vol normale, en unités de taux) : valable pour des taux négatifs."""
    if cp not in (1, -1):
        raise ValueError("cp = 1 (call) ou −1 (put)")
    if T <= 0 or vol_normale <= 0:
        return df * max(cp * (F - K), 0.0)
    s = vol_normale * math.sqrt(T)
    d = (F - K) / s
    return df * (cp * (F - K) * _n(cp * d) + s * _densite(d))


@dataclass(frozen=True)
class CapFloor:
    """Cap (cp=1) ou floor (cp=−1) sur un index, caplets sur [tₖ₋₁ ; tₖ], fixés en tₖ₋₁.

    sens = +1 option achetée, −1 option vendue. Le premier caplet, déjà fixé à l'arrêté,
    est exclu (il ne porte plus de risque de taux). Volatilité constante par simplicité :
    une surface se branche en remplaçant `vol`.
    """

    identifiant: str
    devise: str
    sens: int
    notionnel: float
    strike: float
    maturite: float
    frequence: int
    vol: float
    modele: Modele = "bachelier"
    cp: int = 1
    index: str | None = None
    categorie: str = "option_automatique"

    def dates(self) -> Tableau:
        n = math.ceil(self.maturite * self.frequence - 1e-9)
        return self.maturite - np.arange(n - 1, -1, -1) / self.frequence

    def prix_caplets(self, marche: MarcheDevise) -> tuple[Tableau, Tableau]:
        """Dates de paiement et prix (actualisés, non signés) des caplets non encore fixés."""
        dates = self.dates()
        debuts, fins = dates[:-1], dates[1:]
        proj = marche.courbe_index(self.index)
        df = marche.actualisation.facteur_actualisation(fins)
        prix = np.empty(fins.size)
        for k, (a, b) in enumerate(zip(debuts, fins, strict=True)):
            F = float(proj.forward(a, b))
            delta = b - a
            if self.modele == "black":
                p = black76(F, self.strike, a, self.vol, 1.0, self.cp)
            else:
                p = bachelier(F, self.strike, a, self.vol, 1.0, self.cp)
            prix[k] = self.notionnel * delta * float(df[k]) * p
        return fins, prix

    def prix(self, marche: MarcheDevise) -> float:
        return self.sens * float(np.sum(self.prix_caplets(marche)[1]))

    def flux(self, marche: MarcheDevise, marche_base: MarcheDevise | None = None, inclure_marge: bool = True) -> Flux:
        fins, prix = self.prix_caplets(marche)
        equivalent = prix / marche.actualisation.facteur_actualisation(fins)
        return Flux(fins, self.sens * equivalent, np.zeros_like(fins))

    def interets(self, marche: MarcheDevise, marche_base: MarcheDevise | None, grille: Tableau) -> Tableau:
        """Paiements attendus (équivalents certains) des caplets payés dans chaque période de la grille."""
        g = np.asarray(grille, dtype=float)
        f = self.flux(marche)
        res = np.zeros(g.size - 1)
        for d, v in zip(f.dates, f.interets, strict=True):
            j = int(np.searchsorted(g, d, side="left")) - 1
            if 0 <= j < res.size:
                res[j] += v
        return res

    def echeancier_repricing(self, marche_base: MarcheDevise | None = None) -> tuple[Tableau, Tableau]:
        """Une option n'a pas de nominal qui reprice : elle n'entre pas dans les gaps."""
        return np.empty(0), np.empty(0)
