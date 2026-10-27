import math

import numpy as np
import pytest

from irrbb.courbes import CourbeDecalee, CourbeZero, bootstrap_swaps, convertir_taux


def test_facteur_actualisation_courbe_plate_egal_exponentielle(courbe_plate):
    t = np.array([0.5, 1, 7.3])
    assert np.allclose(courbe_plate.facteur_actualisation(t), np.exp(-0.03 * t), rtol=0, atol=1e-15)


def test_conversion_capitalisation_aller_retour_et_valeur_connue():
    # 5 % annuel = ln(1,05) en continu, quelle que soit la maturité
    assert convertir_taux(0.05, 3.0, "annuelle", "continue") == pytest.approx(math.log(1.05), abs=1e-15)
    r = convertir_taux(convertir_taux(0.04, 0.5, "simple", "annuelle"), 0.5, "annuelle", "simple")
    assert r == pytest.approx(0.04, abs=1e-14)


def test_courbe_saisie_en_annuel_donne_le_meme_df():
    c = CourbeZero([1, 10], [0.02, 0.03], capitalisation="annuelle")
    assert c.facteur_actualisation(10.0) == pytest.approx(1.03**-10, rel=1e-14)


def test_forward_coherent_avec_les_facteurs(marche_pente):
    c = marche_pente.actualisation
    f = c.forward(2.0, 3.0)
    assert (1 + f) * c.facteur_actualisation(3.0) == pytest.approx(c.facteur_actualisation(2.0), rel=1e-14)


def test_forward_instantane_integre_redonne_le_df(marche_pente):
    c = marche_pente.actualisation
    u = np.linspace(0, 7, 7001)
    f = c.forward_instantane(u)
    integrale = np.sum((f[1:] + f[:-1]) / 2 * np.diff(u))
    assert math.exp(-integrale) == pytest.approx(float(c.facteur_actualisation(7.0)), rel=1e-6)


def test_bootstrap_reprice_les_swaps_par():
    par = [0.020, 0.023, 0.025, 0.027, 0.028]
    c = bootstrap_swaps([1, 2, 3, 4, 5], par)
    for n, s in enumerate(par, start=1):
        df = c.facteur_actualisation(np.arange(1, n + 1, dtype=float))
        # jambe fixe + nominal final = 1 pour un swap par
        assert s * df.sum() + df[-1] == pytest.approx(1.0, abs=1e-14)


def test_bootstrap_refuse_des_maturites_non_consecutives():
    with pytest.raises(ValueError):
        bootstrap_swaps([1, 2, 5], [0.02, 0.02, 0.02])
    with pytest.raises(ValueError):
        bootstrap_swaps([1.9, 2.2], [0.02, 0.02])


def test_plancher_retient_le_taux_observe_s_il_est_plus_bas():
    base = CourbeZero([1, 10], [-0.02, 0.01])
    choquee = CourbeDecalee(base, lambda t: np.full_like(t, -0.02), lambda t: np.full_like(t, -0.015))
    assert choquee.taux_zero(1.0) == pytest.approx(-0.02)  # observé −2 % < plancher −1,5 %
    assert choquee.taux_zero(10.0) == pytest.approx(-0.01)  # 1 % − 2 % = −1 % > plancher


def test_courbe_refuse_des_maturites_non_croissantes():
    with pytest.raises(ValueError):
        CourbeZero([2, 1], [0.01, 0.02])
    with pytest.raises(ValueError):
        CourbeZero([1, float("nan")], [0.01, 0.02])
