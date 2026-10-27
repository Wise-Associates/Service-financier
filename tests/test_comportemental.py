import math

import numpy as np
import pytest

from irrbb.comportemental import (
    DepotNonEcheance,
    PretRemboursementAnticipe,
    cpr_logistique,
    ecoulement_exponentiel,
    estimer_transmission,
    smm_depuis_cpr,
    stabilite_transmission,
    survie,
)
from irrbb.mesures import calculer_delta_eve, calculer_delta_nii
from irrbb.positions import Instrument
from irrbb.scenarios import CHOCS_BALE, marche_scenario


def test_smm_et_survie_redonnent_le_cpr_annuel():
    smm = float(smm_depuis_cpr(0.12))
    assert smm == pytest.approx(1 - 0.88 ** (1 / 12))
    assert survie(np.full(12, smm))[-1] == pytest.approx(0.88, rel=1e-14)


def test_survie_refuse_un_taux_hors_bornes():
    with pytest.raises(ValueError):
        survie([0.1, 1.2])


def test_cpr_logistique_bornes_et_centre():
    assert cpr_logistique(0.0, 0.02, 0.30, 200.0) == pytest.approx(0.16)
    assert cpr_logistique(1.0, 0.02, 0.30, 200.0) == pytest.approx(0.30)
    assert cpr_logistique(-1.0, 0.02, 0.30, 200.0) == pytest.approx(0.02)


def test_estimation_retrouve_les_betas_simules():
    rng = np.random.default_rng(42)
    x = rng.normal(0, 0.002, 600)
    y = np.empty_like(x)
    y[0] = 0.0
    y[1:] = 0.0001 + 0.30 * x[1:] + 0.20 * x[:-1] + rng.normal(0, 0.0001, 599)
    res = estimer_transmission(y, x, nb_retards=1)
    assert res.betas == pytest.approx([0.30, 0.20], abs=0.01)
    assert res.beta_cumule == pytest.approx(0.50, abs=0.01)
    assert res.r2 > 0.9
    assert all(b == pytest.approx(0.5, abs=0.02) for b in stabilite_transmission(y, x, 1, 3))


def test_estimation_refuse_un_historique_trop_court():
    with pytest.raises(ValueError):
        estimer_transmission([0.0, 0.1, 0.2], [0.0, 0.1, 0.2], nb_retards=2)


def test_ecoulement_exponentiel_conserve_l_encours():
    dates, principal = ecoulement_exponentiel(100.0, 3.0, 5.0)
    assert principal.sum() == pytest.approx(100.0, rel=1e-14)
    assert 100 - principal[:12].sum() == pytest.approx(100 * math.exp(-1 / 3), rel=1e-12)
    assert dates[-1] == 5.0


def depot(**kw):
    d = dict(
        identifiant="dav",
        devise="EUR",
        encours=100.0,
        part_stable=0.7,
        taux_servi=0.005,
        beta=0.4,
        duree_vie_stable=4.0,
    )
    d.update(kw)
    return DepotNonEcheance(**d)


def test_depot_conserve_l_encours_et_est_un_passif(marche_plat):
    f = depot().flux(marche_plat, marche_plat)
    assert f.principal.sum() == pytest.approx(-100.0, rel=1e-13)
    assert f.principal[0] == pytest.approx(-30.0)


def test_depot_nii_transmet_beta_fois_le_choc(marche_plat):
    r = calculer_delta_nii([depot()], {"EUR": marche_plat}, CHOCS_BALE)
    pas = 1 / 12
    dfwd = ((math.exp(0.05 * pas) - 1) - (math.exp(0.03 * pas) - 1)) / pas
    assert r.delta("hausse_parallele") == pytest.approx(-100 * 0.4 * dfwd, rel=1e-10)
    # baisse : 0,5 % − 0,4 × ~2 % < 0 → plancher 0 %, le coût des dépôts tombe à zéro
    assert r.delta("baisse_parallele") == pytest.approx(100 * 0.005, rel=1e-12)


def test_depot_beta_nul_flux_independants_du_scenario(marche_plat):
    d = depot(beta=0.0)
    choque = marche_scenario(marche_plat, "hausse_parallele", CHOCS_BALE["EUR"])
    assert np.allclose(d.flux(choque, marche_plat).total, d.flux(marche_plat, marche_plat).total)


def pret(**kw):
    d = dict(
        identifiant="immo",
        devise="EUR",
        encours=100.0,
        taux=0.035,
        maturite=15.0,
        marge=0.008,
        cpr_min=0.03,
        cpr_max=0.25,
        pente=400.0,
    )
    d.update(kw)
    return PretRemboursementAnticipe(**d)


def test_pret_sans_remboursement_anticipe_egal_annuite_constante(marche_plat):
    # Seconde méthode : sans option, le prêt doit retrouver l'instrument à annuité constante.
    p = pret(cpr_min=0.0, cpr_max=0.0)
    ref = Instrument("ref", "pret", "EUR", 1, 100.0, 0.035, 15.0, 12, "annuite")
    assert np.allclose(p.flux(marche_plat).total, ref.flux(marche_plat).total, rtol=1e-11)


def test_pret_rembourse_plus_vite_quand_les_taux_baissent(marche_plat):
    p = pret()
    baisse = marche_scenario(marche_plat, "baisse_parallele", CHOCS_BALE["EUR"])
    hausse = marche_scenario(marche_plat, "hausse_parallele", CHOCS_BALE["EUR"])
    assert p.cpr(baisse) > p.cpr(marche_plat) > p.cpr(hausse)
    for m in (baisse, hausse):
        assert p.flux(m).principal.sum() == pytest.approx(100.0, rel=1e-12)
    # l'option vendue au client réduit le gain EVE en baisse de taux
    sans_option = pret(identifiant="x", cpr_min=0.08, cpr_max=0.08)
    r = calculer_delta_eve([p, sans_option], {"EUR": marche_plat}, CHOCS_BALE, inclure_marge=True)
    dec = r.decomposition("baisse_parallele", "position")
    assert dec["immo"] < dec["x"]


def test_estimation_refuse_des_regresseurs_colineaires():
    # Marché constant : la constante et le β sont confondus, la transmission n'est pas identifiable.
    with pytest.raises(ValueError, match="colinéaires"):
        estimer_transmission(np.linspace(0, 0.01, 24), np.full(24, 0.001), nb_retards=0)


def test_stabilite_exige_au_moins_une_sous_periode():
    with pytest.raises(ValueError):
        stabilite_transmission(np.zeros(30), np.linspace(0, 1, 30), 0, 0)


def test_positions_comportementales_refusent_un_encours_non_fini():
    with pytest.raises(ValueError):
        depot(encours=float("nan"))
    with pytest.raises(ValueError):
        pret(encours=float("nan"))
