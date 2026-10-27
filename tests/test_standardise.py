import math

import numpy as np
import pytest

from irrbb.mesures import calculer_delta_eve
from irrbb.positions import Instrument
from irrbb.scenarios import CHOCS_BALE, SCENARIOS_EVE
from irrbb.standardise import (
    MILIEUX_BALE,
    agreger_devises,
    calculer_delta_eve_standardise,
    controle_valeurs_aberrantes,
    repartir_flux,
)


def test_dix_neuf_tranches_et_affectation_aux_bornes():
    assert MILIEUX_BALE.size == 19
    r = repartir_flux(np.array([1 / 365, 1.0, 1.0000001, 30.0]), np.array([1.0, 2.0, 4.0, 8.0]))
    assert r[0] == 1.0 and r[5] == 2.0 and r[6] == 4.0 and r[18] == 8.0


def test_flux_au_point_milieu_egal_revalorisation_complete(marche_plat):
    zc = Instrument("zc", "titre", "EUR", 1, 100.0, 0.0, 4.5)
    std = calculer_delta_eve_standardise([zc], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True, poids_gains=0.5)
    complet = calculer_delta_eve([zc], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True)
    for s in SCENARIOS_EVE:
        assert std.delta_par_scenario_devise[s]["EUR"] == pytest.approx(complet.delta(s), rel=1e-12)


def test_taux_variable_reprice_a_la_prochaine_revision(marche_plat):
    frn = Instrument("frn", "pret", "EUR", 1, 100.0, 0.03, 10.0, 4, "in_fine", "EURIBOR3M")
    std = calculer_delta_eve_standardise([frn], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True, poids_gains=0.5)
    # 100,75 versés à 3 mois : tranche ]1 ; 3 mois], actualisés à son milieu 0,1667 an
    attendu = 100.75 * (math.exp(-0.05 * 0.1667) - math.exp(-0.03 * 0.1667))
    assert std.delta_par_scenario_devise["hausse_parallele"]["EUR"] == pytest.approx(attendu, rel=1e-12)


def test_agregation_des_devises_pondere_les_gains():
    assert agreger_devises({"EUR": -10.0, "USD": 4.0}, 0.5) == pytest.approx(-8.0)
    assert agreger_devises({"EUR": -10.0, "USD": 4.0}, 0.0) == pytest.approx(-10.0)
    with pytest.raises(ValueError):
        agreger_devises({"EUR": 1.0}, 1.5)


def test_mesure_de_risque_jamais_negative(marche_plat):
    depot = Instrument("dat", "depot_terme", "EUR", -1, 100.0, 0.0, 5.0)
    std = calculer_delta_eve_standardise([depot], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True, poids_gains=0.5)
    scenario, perte = std.mesure_risque()
    assert scenario == "baisse_parallele" and perte > 0


def test_sot_seuil_de_15_pourcent():
    res = controle_valeurs_aberrantes({"hausse_parallele": -20.0, "baisse_parallele": 5.0}, 100.0, 0.15, "ΔEVE")
    assert res.scenario == "hausse_parallele" and res.ratio == pytest.approx(0.20) and res.depassement
    gains = controle_valeurs_aberrantes({"a": 1.0, "b": 2.0}, 100.0, 0.15, "ΔEVE")
    assert gains.perte == 0.0 and not gains.depassement
    with pytest.raises(ValueError):
        controle_valeurs_aberrantes({"a": -1.0}, 0.0, 0.15, "ΔEVE")
