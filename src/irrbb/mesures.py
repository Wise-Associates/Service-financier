"""ΔEVE et ΔNII par scénario (PDF p. 11 et 12).

EVEₛ = Σₖ Dₛ(0,tₖ) · CFₖ,ₛ          ΔEVEₛ = EVEₛ − EVE₀
NIIₛ = Σₜ (intérêts actifsₜ,ₛ − intérêts passifsₜ,ₛ)          ΔNIIₛ = NIIₛ − NII₀

Convention de signe unique : un Δ négatif est une perte ; la perte maximale publiée est
maxₛ(valeur₀ − valeurₛ). Les flux étant signés par position (actif +, passif −), les sommes
se lisent directement comme actif − passif.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from .courbes import Tableau
from .positions import Position
from .scenarios import (
    SCENARIOS_EVE,
    SCENARIOS_NII,
    MarcheDevise,
    ParametresChoc,
    marche_scenario,
    plancher_eba,
)

Axe = Literal["devise", "categorie", "position"]


@dataclass(frozen=True)
class ResultatMesure:
    """Valeurs par position, en base et par scénario, avec agrégations et écarts."""

    mesure: str
    base: dict[str, float]
    scenarios: dict[str, dict[str, float]]
    devise_de: dict[str, str]
    categorie_de: dict[str, str]

    def _cle(self, identifiant: str, axe: Axe) -> str:
        if axe == "devise":
            return self.devise_de[identifiant]
        if axe == "categorie":
            return self.categorie_de[identifiant]
        return identifiant

    def _filtre(self, valeurs: dict[str, float], devise: str | None) -> float:
        return float(sum(v for k, v in valeurs.items() if devise is None or self.devise_de[k] == devise))

    def total(self, scenario: str = "base", devise: str | None = None) -> float:
        valeurs = self.base if scenario == "base" else self.scenarios[scenario]
        return self._filtre(valeurs, devise)

    def delta(self, scenario: str, devise: str | None = None) -> float:
        return self.total(scenario, devise) - self.total("base", devise)

    def decomposition(self, scenario: str, axe: Axe = "devise") -> dict[str, float]:
        """Δ du scénario décomposé par devise, catégorie de produit ou position (PDF p. 12)."""
        res: dict[str, float] = {}
        for ident, v in self.scenarios[scenario].items():
            cle = self._cle(ident, axe)
            res[cle] = res.get(cle, 0.0) + v - self.base[ident]
        return res

    def perte_maximale(self, devise: str | None = None) -> tuple[str, float]:
        """Scénario le plus défavorable et maxₛ(valeur₀ − valeurₛ)."""
        pertes = {s: -self.delta(s, devise) for s in self.scenarios}
        pire = max(pertes, key=lambda s: pertes[s])
        return pire, pertes[pire]


def _verifier_positions(positions: Sequence[Position], marches: dict[str, MarcheDevise]) -> None:
    vus: set[str] = set()
    for p in positions:
        if p.identifiant in vus:
            raise ValueError(f"identifiant en double : {p.identifiant} (double comptage)")
        vus.add(p.identifiant)
        if p.devise not in marches:
            raise ValueError(f"{p.identifiant} : aucune courbe pour la devise {p.devise}")


def _par_scenario(
    positions: Sequence[Position],
    marches: dict[str, MarcheDevise],
    parametres_choc: dict[str, ParametresChoc],
    scenarios: Iterable[str],
    plancher: Callable[[Tableau], Tableau] | None,
    evaluer: Callable[[Position, MarcheDevise, MarcheDevise], float],
    mesure: str,
) -> ResultatMesure:
    _verifier_positions(positions, marches)
    manquants = {p.devise for p in positions} - set(parametres_choc)
    if manquants:
        raise ValueError(f"paramètres de choc absents pour : {sorted(manquants)}")
    base = {p.identifiant: evaluer(p, marches[p.devise], marches[p.devise]) for p in positions}
    res: dict[str, dict[str, float]] = {}
    for s in scenarios:
        choques = {
            d: marche_scenario(m, s, parametres_choc[d], plancher) for d, m in marches.items() if d in parametres_choc
        }
        res[s] = {p.identifiant: evaluer(p, choques[p.devise], marches[p.devise]) for p in positions}
    return ResultatMesure(
        mesure,
        base,
        res,
        {p.identifiant: p.devise for p in positions},
        {p.identifiant: p.categorie for p in positions},
    )


def valeur_actualisee(
    position: Position, marche: MarcheDevise, marche_base: MarcheDevise, inclure_marge: bool
) -> float:
    """Σₖ D(0,tₖ)·CFₖ des flux de la position (flux échus à t <= 0 exclus)."""
    f = position.flux(marche, marche_base, inclure_marge)
    vivants = f.dates > 0
    df = marche.actualisation.facteur_actualisation(f.dates[vivants])
    return float(np.sum(df * f.total[vivants]))


def calculer_delta_eve(
    positions: Sequence[Position],
    marches: dict[str, MarcheDevise],
    parametres_choc: dict[str, ParametresChoc],
    *,
    inclure_marge: bool,
    scenarios: Iterable[str] = SCENARIOS_EVE,
    plancher: Callable[[Tableau], Tableau] | None = plancher_eba,
) -> ResultatMesure:
    """EVE par position en base et sous chaque scénario.

    `inclure_marge` est obligatoire : le PDF (p. 11) exige un choix explicite, appliqué
    identiquement en base et en choc. Pour les publications Bâle : bilan en extinction
    (aucune production nouvelle n'est générée ici) et fonds propres exclus des positions.
    """
    return _par_scenario(
        positions,
        marches,
        parametres_choc,
        scenarios,
        plancher,
        lambda p, m, mb: valeur_actualisee(p, m, mb, inclure_marge),
        "EVE",
    )


def grille_mensuelle(horizon: float = 1.0, pas_par_an: int = 12) -> Tableau:
    n = round(horizon * pas_par_an)
    if n < 1:
        raise ValueError("horizon trop court pour la grille")
    return np.linspace(0.0, horizon, n + 1)


def calculer_delta_nii(
    positions: Sequence[Position],
    marches: dict[str, MarcheDevise],
    parametres_choc: dict[str, ParametresChoc],
    *,
    scenarios: Iterable[str] = SCENARIOS_NII,
    horizon: float = 1.0,
    pas_par_an: int = 12,
    plancher: Callable[[Tableau], Tableau] | None = plancher_eba,
) -> ResultatMesure:
    """NII à bilan constant sur l'horizon (12 mois par défaut), même périmètre en base et en choc."""
    grille = grille_mensuelle(horizon, pas_par_an)
    return _par_scenario(
        positions,
        marches,
        parametres_choc,
        scenarios,
        plancher,
        lambda p, m, mb: float(np.sum(p.interets(m, mb, grille))),
        "NII",
    )
