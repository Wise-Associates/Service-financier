"""Flux, ΔEVE et ΔNII contre des formules fermées indépendantes du moteur."""

import math

import numpy as np
import pytest

from irrbb.mesures import calculer_delta_eve, calculer_delta_nii, valeur_actualisee
from irrbb.positions import Instrument
from irrbb.scenarios import CHOCS_BALE

R = 0.03  # courbe plate continue des fixtures


def obligation(**kw):
    defauts = dict(identifiant="o", categorie="titre", devise="EUR", sens=1, encours=100.0, taux=0.04, maturite=5.0)
    defauts.update(kw)
    return Instrument(**defauts)


def test_obligation_in_fine_formule_fermee(marche_plat):
    pv = valeur_actualisee(obligation(), marche_plat, marche_plat, True)
    attendu = sum(4 * math.exp(-R * t) for t in range(1, 6)) + 100 * math.exp(-R * 5)
    assert pv == pytest.approx(attendu, rel=1e-13)


def test_taux_variable_vaut_le_pair_a_la_date_de_refixation(marche_pente):
    # Identité classique : sans marge, actualisé sur sa courbe de projection, un FRN vaut le pair.
    proj = marche_pente.projection["EURIBOR3M"]
    m = type(marche_pente)("EUR", proj, {"EURIBOR3M": proj})
    frn = obligation(taux=float(proj.forward(0, 0.25)), frequence=4, index="EURIBOR3M", maturite=7.0)
    assert valeur_actualisee(frn, m, m, True) == pytest.approx(100.0, rel=1e-12)


def test_annuite_constante_formule_fermee(marche_plat):
    p = obligation(categorie="pret", taux=0.036, maturite=20.0, frequence=12, amortissement="annuite")
    f = p.flux(marche_plat)
    i, n = 0.036 / 12, 240
    annuite = 100 * i / (1 - (1 + i) ** -n)
    assert np.allclose(f.total, annuite, rtol=1e-11)
    assert f.principal.sum() == pytest.approx(100.0, rel=1e-13)


def test_amortissement_lineaire_conserve_le_principal(marche_plat):
    f = obligation(amortissement="lineaire", frequence=2).flux(marche_plat)
    assert np.allclose(f.principal, 10.0)
    assert f.interets[0] == pytest.approx(100 * 0.04 / 2)


def test_delta_eve_zero_coupon_formule_fermee(marche_plat):
    zc = obligation(taux=0.0)
    r = calculer_delta_eve([zc], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True)
    assert r.delta("hausse_parallele") == pytest.approx(100 * (math.exp(-0.05 * 5) - math.exp(-0.03 * 5)), rel=1e-12)
    assert r.delta("baisse_parallele") == pytest.approx(100 * (math.exp(-0.01 * 5) - math.exp(-0.03 * 5)), rel=1e-12)
    assert r.perte_maximale() == ("hausse_parallele", pytest.approx(-r.delta("hausse_parallele")))


def test_un_passif_gagne_quand_les_taux_montent(marche_plat):
    depot = obligation(identifiant="dat", categorie="depot_terme", sens=-1, taux=0.02, maturite=2.0)
    r = calculer_delta_eve([depot], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True)
    assert r.total() < 0
    assert r.delta("hausse_parallele") > 0


def test_exclusion_de_la_marge_identique_en_base_et_en_choc(marche_plat):
    avec_marge = obligation(taux=0.05, marge=0.01)
    sans = obligation(taux=0.04)
    assert valeur_actualisee(avec_marge, marche_plat, marche_plat, False) == pytest.approx(
        valeur_actualisee(sans, marche_plat, marche_plat, True), rel=1e-14
    )


def test_decomposition_par_devise_somme_au_total(marche_plat):
    pos = [obligation(identifiant="a"), obligation(identifiant="b", devise="USD", maturite=3.0)]
    marches = {"EUR": marche_plat, "USD": type(marche_plat)("USD", marche_plat.actualisation)}
    r = calculer_delta_eve(pos, marches, CHOCS_BALE, inclure_marge=True)
    dec = r.decomposition("pentification", "devise")
    assert set(dec) == {"EUR", "USD"}
    assert sum(dec.values()) == pytest.approx(r.delta("pentification"), rel=1e-12)


def test_refuse_doublon_et_devise_sans_courbe(marche_plat):
    with pytest.raises(ValueError, match="double"):
        calculer_delta_eve([obligation(), obligation()], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True)
    with pytest.raises(ValueError, match="devise"):
        calculer_delta_eve([obligation(devise="JPY")], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True)


def test_instrument_refuse_un_sens_invalide():
    with pytest.raises(ValueError):
        obligation(sens=0)


def test_nii_taux_fixe_renouvele_a_mi_horizon(marche_plat):
    # 100 à 4 % pendant 6 mois, puis renouvelé 1 an au taux par forward : e^r − 1 sur courbe plate continue
    p = obligation(taux=0.04, maturite=0.5, duree_renouvellement=1.0)
    r = calculer_delta_nii([p], {"EUR": marche_plat}, CHOCS_BALE)
    assert r.total() == pytest.approx(100 * 0.04 * 0.5 + 100 * (math.exp(R) - 1) * 0.5, rel=1e-12)
    assert r.delta("hausse_parallele") == pytest.approx(50 * (math.exp(0.05) - math.exp(R)), rel=1e-12)


def test_nii_taux_variable_reprice_aux_forwards(marche_plat):
    p = obligation(taux=0.025, maturite=2.0, frequence=4, index="EURIBOR3M", marge=0.005)
    r = calculer_delta_nii([p], {"EUR": marche_plat}, CHOCS_BALE)

    def fwd(r_):
        return (math.exp(r_ * 0.25) - 1) / 0.25

    base = 100 * 0.25 * (0.025 + 3 * (fwd(R) + 0.005))
    assert r.total() == pytest.approx(base, rel=1e-12)
    assert r.delta("hausse_parallele") == pytest.approx(100 * 0.75 * (fwd(0.05) - fwd(R)), rel=1e-12)
