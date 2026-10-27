import math

import numpy as np
import pytest

from irrbb.mesures import valeur_actualisee
from irrbb.options import CapFloor, bachelier, black76


def _esperance_numerique(payoff):
    """Seconde méthode : intégration du payoff contre la densité normale (trapèzes, z ∈ [−12 ; 12])."""
    z = np.linspace(-12, 12, 200_001)
    densite = np.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
    y = payoff(z) * densite
    return float(np.sum((y[1:] + y[:-1]) / 2 * np.diff(z)))


@pytest.mark.parametrize("cp", [1, -1])
def test_black_contre_integration_numerique(cp):
    F, K, T, s, df = 0.07, 0.08, 1.0, 0.20, 0.92
    attendu = df * _esperance_numerique(
        lambda z: np.maximum(cp * (F * np.exp(s * math.sqrt(T) * z - 0.5 * s * s * T) - K), 0)
    )
    assert black76(F, K, T, s, df, cp) == pytest.approx(attendu, rel=1e-8)


@pytest.mark.parametrize("cp", [1, -1])
def test_bachelier_contre_integration_numerique(cp):
    F, K, T, s = -0.002, 0.001, 3.0, 0.007
    attendu = _esperance_numerique(lambda z: np.maximum(cp * (F + s * math.sqrt(T) * z - K), 0))
    assert bachelier(F, K, T, s, 1.0, cp) == pytest.approx(attendu, rel=1e-8)


@pytest.mark.parametrize("formule,vol", [(black76, 0.25), (bachelier, 0.008)])
def test_parite_call_put(formule, vol):
    F, K, T, df = 0.031, 0.027, 2.5, 0.93
    assert formule(F, K, T, vol, df, 1) - formule(F, K, T, vol, df, -1) == pytest.approx(df * (F - K), abs=1e-15)


def test_bachelier_a_la_monnaie_formule_fermee():
    assert bachelier(0.01, 0.01, 4.0, 0.006) == pytest.approx(0.006 * 2 / math.sqrt(2 * math.pi), rel=1e-14)


def test_bachelier_accepte_les_taux_negatifs_black_non():
    assert bachelier(-0.005, -0.002, 1.0, 0.005, cp=-1) > 0
    with pytest.raises(ValueError):
        black76(-0.005, 0.01, 1.0, 0.2)


def test_black_et_bachelier_concordent_a_petite_volatilite():
    F, T, s = 0.03, 1.0, 0.05
    assert black76(F, F, T, s) == pytest.approx(bachelier(F, F, T, F * s), rel=1e-3)


def test_cap_moins_floor_egale_le_swap(marche_plat):
    args = dict(
        devise="EUR", sens=1, notionnel=100.0, strike=0.025, maturite=5.0, frequence=4, vol=0.007, index="EURIBOR3M"
    )
    cap = CapFloor("cap", cp=1, **args)
    floor = CapFloor("floor", cp=-1, **args)
    c = marche_plat.actualisation
    swap = sum(
        100 * 0.25 * float(c.facteur_actualisation(b)) * (float(c.forward(b - 0.25, b)) - 0.025)
        for b in [0.25 * k for k in range(2, 21)]
    )
    assert cap.prix(marche_plat) - floor.prix(marche_plat) == pytest.approx(swap, rel=1e-12)


def test_flux_equivalents_redonnent_le_prix_et_le_signe(marche_plat):
    vendu = CapFloor("cap", "EUR", -1, 100.0, 0.035, 5.0, 4, 0.2, modele="black", index="EURIBOR3M")
    assert vendu.prix(marche_plat) < 0
    assert valeur_actualisee(vendu, marche_plat, marche_plat, True) == pytest.approx(vendu.prix(marche_plat), rel=1e-13)
