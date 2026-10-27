import math

import numpy as np
import pytest

from irrbb.scenarios import CHOCS_BALE, SCENARIOS_EVE, choc, decaler_marche, marche_scenario, plancher_eba

EUR = CHOCS_BALE["EUR"]


def test_formes_des_chocs_aux_limites():
    t0, tinf = np.array([0.0]), np.array([1e6])
    assert choc("hausse_taux_courts", EUR, t0)[0] == pytest.approx(0.025)
    assert choc("hausse_taux_courts", EUR, tinf)[0] == pytest.approx(0.0)
    assert choc("pentification", EUR, t0)[0] == pytest.approx(-0.65 * 0.025)
    assert choc("pentification", EUR, tinf)[0] == pytest.approx(0.9 * 0.01)
    assert choc("aplatissement", EUR, t0)[0] == pytest.approx(0.8 * 0.025)
    assert choc("aplatissement", EUR, tinf)[0] == pytest.approx(-0.6 * 0.01)


def test_choc_court_a_quatre_ans_valeur_fermee():
    assert choc("hausse_taux_courts", EUR, np.array([4.0]))[0] == pytest.approx(0.025 * math.exp(-1))


def test_six_scenarios_eve_et_scenario_inconnu():
    assert len(SCENARIOS_EVE) == 6
    with pytest.raises(ValueError):
        choc("inconnu", EUR, np.array([1.0]))


def test_plancher_eba():
    assert plancher_eba(np.array([0.0]))[0] == pytest.approx(-0.015)
    assert plancher_eba(np.array([10.0]))[0] == pytest.approx(-0.012)
    assert plancher_eba(np.array([60.0]))[0] == 0.0


def test_marche_scenario_deplace_aussi_les_courbes_de_projection(marche_pente):
    m = marche_scenario(marche_pente, "hausse_parallele", EUR)
    ecart = m.projection["EURIBOR3M"].taux_zero(2.0) - marche_pente.projection["EURIBOR3M"].taux_zero(2.0)
    assert ecart == pytest.approx(0.02)


def test_choc_de_base_ne_bouge_que_l_index_vise(marche_pente):
    m = decaler_marche(marche_pente, lambda t: np.full_like(t, 0.001), index="EURIBOR3M")
    assert m.actualisation is marche_pente.actualisation
    assert m.projection["EURIBOR3M"].taux_zero(1.0) == pytest.approx(
        marche_pente.projection["EURIBOR3M"].taux_zero(1.0) + 0.001
    )
