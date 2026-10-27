"""Scénarios de choc de taux (PDF p. 10 et 15) et marché par devise.

Les six chocs EVE suivent la forme du cadre de Bâle (BCBS d368, 2016, annexe 2) :
  court(τ) = R_court · e^(−τ/x)          long(τ) = R_long · (1 − e^(−τ/x))      x = 4 ans
  pentification  = −0,65·|court| + 0,9·|long|
  aplatissement  = +0,8·|court| − 0,6·|long|

Les tailles de chocs par devise et le plancher post-choc sont des PARAMÈTRES : les valeurs
fournies reprennent BCBS d368 et le RTS UE 2024/856 et doivent être revérifiées sur le
texte en vigueur pour l'établissement avant tout usage réglementaire.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from .courbes import Courbe, CourbeDecalee, Tableau

SCENARIOS_EVE: tuple[str, ...] = (
    "hausse_parallele",
    "baisse_parallele",
    "pentification",
    "aplatissement",
    "hausse_taux_courts",
    "baisse_taux_courts",
)
SCENARIOS_NII: tuple[str, ...] = ("hausse_parallele", "baisse_parallele")


@dataclass(frozen=True)
class ParametresChoc:
    """Tailles de chocs (en décimal : 0,02 = 200 pb) et constante de décroissance x."""

    parallele: float
    court: float
    long: float
    x: float = 4.0


# BCBS d368 (2016), annexe 2. À confirmer selon le périmètre réglementaire de l'établissement.
CHOCS_BALE: dict[str, ParametresChoc] = {
    "EUR": ParametresChoc(0.0200, 0.0250, 0.0100),
    "USD": ParametresChoc(0.0200, 0.0300, 0.0150),
    "GBP": ParametresChoc(0.0250, 0.0300, 0.0150),
    "CHF": ParametresChoc(0.0100, 0.0150, 0.0100),
    "JPY": ParametresChoc(0.0100, 0.0100, 0.0100),
}


def choc(scenario: str, p: ParametresChoc, t: Tableau) -> Tableau:
    """Δr(τ) du scénario pour les maturités t (années)."""
    tt = np.asarray(t, dtype=float)
    court = p.court * np.exp(-tt / p.x)
    long = p.long * (1 - np.exp(-tt / p.x))
    formes: dict[str, Callable[[], Tableau]] = {
        "hausse_parallele": lambda: np.full_like(tt, p.parallele),
        "baisse_parallele": lambda: np.full_like(tt, -p.parallele),
        "pentification": lambda: -0.65 * np.abs(court) + 0.9 * np.abs(long),
        "aplatissement": lambda: 0.8 * np.abs(court) - 0.6 * np.abs(long),
        "hausse_taux_courts": lambda: court,
        "baisse_taux_courts": lambda: -court,
        "base": lambda: np.zeros_like(tt),
    }
    if scenario not in formes:
        raise ValueError(f"scénario inconnu : {scenario}")
    return formes[scenario]()


def plancher_eba(t: Tableau) -> Tableau:
    """Plancher post-choc dépendant de la maturité : −150 pb à 0 an, +3 pb par an, 0 % à 50 ans.

    Forme du RTS UE 2024/856 (SOT) ; à confirmer sur le texte en vigueur.
    """
    tt = np.asarray(t, dtype=float)
    return np.minimum(-0.015 + 0.0003 * tt, 0.0)


@dataclass
class MarcheDevise:
    """Courbes d'une devise : une courbe d'actualisation et une courbe de projection par index.

    Un index absent de `projection` est projeté sur la courbe d'actualisation : le risque de base
    n'est alors pas représenté, ce qui doit être un choix explicite (PDF p. 10 et 14).
    """

    devise: str
    actualisation: Courbe
    projection: dict[str, Courbe] = field(default_factory=dict)

    def courbe_index(self, index: str | None) -> Courbe:
        if index is None:
            return self.actualisation
        return self.projection.get(index, self.actualisation)


def decaler_marche(
    marche: MarcheDevise,
    delta: Callable[[Tableau], Tableau],
    plancher: Callable[[Tableau], Tableau] | None = None,
    index: str | None = None,
) -> MarcheDevise:
    """Applique le même déplacement à toutes les courbes de la devise, ou à un seul index.

    Avec `index`, seule la courbe de projection de cet index bouge : c'est le choc
    différentiel du risque de base (PDF p. 14). Le choc ne remplace pas les courbes par
    index : il déplace chacune d'elles, ce qui conserve les bases entre index.
    """
    if index is not None:
        if index not in marche.projection:
            raise ValueError(f"index {index} absent du marché {marche.devise}")
        projection = dict(marche.projection)
        projection[index] = CourbeDecalee(marche.projection[index], delta, plancher)
        return MarcheDevise(marche.devise, marche.actualisation, projection)
    return MarcheDevise(
        marche.devise,
        CourbeDecalee(marche.actualisation, delta, plancher),
        {k: CourbeDecalee(c, delta, plancher) for k, c in marche.projection.items()},
    )


def marche_scenario(
    marche: MarcheDevise,
    scenario: str,
    parametres: ParametresChoc,
    plancher: Callable[[Tableau], Tableau] | None = plancher_eba,
) -> MarcheDevise:
    """Marché de la devise sous un scénario réglementaire (plancher post-choc inclus)."""
    if scenario == "base":
        return marche
    return decaler_marche(marche, lambda t: choc(scenario, parametres, t), plancher)
