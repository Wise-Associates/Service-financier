import math

import numpy as np
import pytest

from irrbb.comportemental import DepotNonEcheance
from irrbb.mesures import valeur_actualisee
from irrbb.positions import Instrument
from irrbb.scenarios import decaler_marche
from irrbb.sensibilites import (
    approximation_taylor,
    delta_pv_risque_base,
    gamma,
    gaps_repricing,
    krd,
    pv01,
)


def zc(maturite=5.0, **kw):
    return Instrument(kw.pop("identifiant", "zc"), "titre", "EUR", kw.pop("sens", 1), 100.0, 0.0, maturite, **kw)


def test_pv01_zero_coupon_formule_fermee(marche_plat):
    # [PV(−1 pb) − PV(+1 pb)] / 2 = 100·e^(−rT)·sinh(T·1 pb)
    attendu = 100 * math.exp(-0.03 * 5) * math.sinh(5 * 1e-4)
    assert pv01([zc()], marche_plat, inclure_marge=True) == pytest.approx(attendu, rel=1e-9)


def test_pv01_positif_pour_une_obligation_detenue(marche_pente):
    o = Instrument("o", "titre", "EUR", 1, 100.0, 0.03, 10.0)
    assert pv01([o], marche_pente, inclure_marge=True) > 0


def portefeuille():
    return [
        Instrument("o10", "titre", "EUR", 1, 100.0, 0.03, 10.0),
        Instrument("frn", "pret", "EUR", 1, 80.0, 0.024, 6.0, 4, "lineaire", "EURIBOR3M", 0.01),
        Instrument("dat", "depot_terme", "EUR", -1, 60.0, 0.021, 2.0),
        DepotNonEcheance("dav", "EUR", 50.0, 0.6, 0.004, 0.3, 4.0),
    ]


def test_somme_des_krd_egale_la_sensibilite_parallele(marche_pente):
    k = krd(portefeuille(), marche_pente, [0.25, 1, 2, 5, 10, 20], inclure_marge=True)
    total = pv01(portefeuille(), marche_pente, inclure_marge=True)
    assert sum(k.values()) * 1e-4 == pytest.approx(total, rel=1e-6)


def test_taylor_avec_convexite_approche_la_revalorisation_complete(marche_pente):
    pos = [Instrument("o", "titre", "EUR", 1, 100.0, 0.03, 15.0)]
    piliers = [1, 2, 5, 10, 15, 20]
    k = krd(pos, marche_pente, piliers, inclure_marge=True)
    g = gamma(pos, marche_pente, inclure_marge=True)
    choque = decaler_marche(marche_pente, lambda t: np.full_like(t, 0.02))
    base = valeur_actualisee(pos[0], marche_pente, marche_pente, True)
    exact = valeur_actualisee(pos[0], choque, marche_pente, True) - base
    chocs = {m: 0.02 for m in piliers}
    avec = approximation_taylor(k, g, chocs, 0.02)
    sans = approximation_taylor(k, 0.0, chocs, 0.02)
    # 15 ans, +200 pb : l'erreur passe d'environ 14 % (linéaire) à 1,5 % (ordre 3 restant)
    assert abs(avec - exact) < 0.15 * abs(sans - exact)
    assert avec == pytest.approx(exact, rel=0.02)


def test_gaps_somment_aux_encours_signes(marche_pente):
    g = gaps_repricing(portefeuille(), marche_pente)
    assert g.cumules[-1] == pytest.approx(100 + 80 - 60 - 50, rel=1e-12)
    # ]1 mois ; 3 mois] : le prêt variable reprice en totalité à 3 mois, moins l'écoulement
    # de la part stable du dépôt aux mois 2 et 3 ; la part volatile (−20) est au jour le jour.
    assert g.gaps[0] == pytest.approx(-20.0 - _stable_mois(1, 1), rel=1e-12)
    assert g.gaps[1] == pytest.approx(80.0 - _stable_mois(2, 3), rel=1e-12)
    assert len(g.libelles()) == g.gaps.size


def _stable_mois(debut, fin):
    """Écoulement de la part stable du dépôt entre les mois `debut` et `fin` (inclus)."""
    return 30 * (math.exp(-(debut - 1) / 12 / 4) - math.exp(-fin / 12 / 4))


def test_risque_de_base_ne_touche_que_l_index(marche_pente):
    frn = Instrument("frn", "pret", "EUR", 1, 100.0, 0.024, 5.0, 4, "in_fine", "EURIBOR3M")
    fixe = Instrument("fixe", "titre", "EUR", 1, 100.0, 0.03, 5.0)
    assert delta_pv_risque_base([fixe], marche_pente, "EURIBOR3M", 0.001, inclure_marge=True) == 0.0
    d = delta_pv_risque_base([frn], marche_pente, "EURIBOR3M", 0.001, inclure_marge=True)
    # Référence écrite à la main : P'(t) = P(t)·e^(−0,001·t), coupons = forwards simples
    t = np.arange(0.25, 5.01, 0.25)
    P = marche_pente.projection["EURIBOR3M"].facteur_actualisation(t)
    P_choc = P * np.exp(-0.001 * t)
    dfwd = ((P_choc[:-1] / P_choc[1:]) - (P[:-1] / P[1:])) / 0.25
    df = marche_pente.actualisation.facteur_actualisation(t[1:])
    assert d == pytest.approx(float(np.sum(100 * 0.25 * dfwd * df)), rel=1e-12)
