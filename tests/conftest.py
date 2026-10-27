"""Fixtures communes : marchés fictifs, aucune donnée réelle."""

import pytest

from irrbb.courbes import CourbeZero
from irrbb.scenarios import MarcheDevise


@pytest.fixture
def courbe_plate():
    return CourbeZero([1.0], [0.03])


@pytest.fixture
def marche_plat(courbe_plate):
    return MarcheDevise("EUR", courbe_plate, {"EURIBOR3M": courbe_plate})


@pytest.fixture
def marche_pente():
    c = CourbeZero([0.25, 1, 2, 5, 10, 20, 30], [0.020, 0.022, 0.024, 0.027, 0.030, 0.032, 0.031])
    return MarcheDevise("EUR", c, {"EURIBOR3M": CourbeZero([0.25, 30], [0.022, 0.033])})
