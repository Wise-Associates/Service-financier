"""Interface web de démonstration : validation de la saisie, rendu sûr et réponses HTTP.

Les formules sont testées ailleurs ; ici on vérifie que l'interface transmet fidèlement les paramètres
au moteur, refuse une saisie invalide sans calculer et n'injecte jamais la saisie brute dans la page.
"""

import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from datetime import datetime
from http.server import ThreadingHTTPServer

import pytest
from demo_banque_fictive import Parametres, Resultats, executer
from interface_web import Gestionnaire, lire_parametres, page

MAINTENANT = datetime(2026, 10, 27, 9, 0)


def test_valeurs_par_defaut_a_la_premiere_visite():
    params, erreurs = lire_parametres({})
    assert erreurs == []
    assert params == Parametres()


def test_saisie_francaise_et_pourcentages():
    params, erreurs = lire_parametres(
        {
            "fonds_propres_t1": ["1 500,5"],
            "seuil_sot_eve": ["12,5"],
            "seuil_sot_nii": ["4"],
            "poids_gains": ["0"],
            "inclure_marge": ["oui"],
            "calculer": ["1"],
        }
    )
    assert erreurs == []
    assert params.fonds_propres_t1 == pytest.approx(1500.5)
    assert params.seuil_sot_eve == pytest.approx(0.125)
    assert params.seuil_sot_nii == pytest.approx(0.04)
    assert params.poids_gains == 0.0
    assert params.inclure_marge is True


def test_case_decochee_au_recalcul():
    # Un navigateur n'envoie pas une case décochée : seul « calculer » indique que le formulaire a été soumis.
    params, _ = lire_parametres({"calculer": ["1"]})
    assert params.inclure_marge is False


@pytest.mark.parametrize("valeur", ["abc", "nan", "inf", "-5", "0", "1e12"])
def test_fonds_propres_invalides_refuses(valeur):
    _, erreurs = lire_parametres({"fonds_propres_t1": [valeur]})
    assert len(erreurs) == 1
    assert erreurs[0].startswith("Fonds propres Tier 1")


@pytest.mark.parametrize("champ", ["seuil_sot_eve", "seuil_sot_nii", "poids_gains"])
def test_pourcentage_au_dela_de_100_refuse(champ):
    _, erreurs = lire_parametres({champ: ["150"]})
    assert len(erreurs) == 1


def test_sot_suit_les_fonds_propres_saisis():
    # Identité : ratio SOT = perte / Tier 1 ; doubler le Tier 1 divise le ratio par deux sans changer la perte.
    base = executer(Parametres(), MAINTENANT)
    double = executer(Parametres(fonds_propres_t1=2_400.0), MAINTENANT)
    assert isinstance(base, Resultats) and isinstance(double, Resultats)
    assert double.sot_eve.perte == pytest.approx(base.sot_eve.perte)
    assert double.sot_eve.ratio == pytest.approx(base.sot_eve.ratio / 2)
    assert double.sot_eve.ratio == pytest.approx(base.sot_eve.perte / 2_400.0)


def test_seuils_saisis_transmis_au_moteur():
    r = executer(Parametres(seuil_sot_eve=0.30, seuil_sot_nii=0.10), MAINTENANT)
    assert isinstance(r, Resultats)
    assert r.sot_eve.seuil == 0.30 and r.sot_nii.seuil == 0.10
    assert r.sot_eve.depassement == (r.sot_eve.ratio > 0.30)


def test_saisie_refusee_reaffichee_echappee():
    saisie = {"fonds_propres_t1": ['"><script>alert(1)</script>'], "calculer": ["1"]}
    params, erreurs = lire_parametres(saisie)
    html = page(params, None, erreurs, saisie)
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "Le calcul n'a pas été lancé" in html


@pytest.fixture(scope="module")
def adresse() -> Iterator[str]:
    serveur = ThreadingHTTPServer(("127.0.0.1", 0), Gestionnaire)
    fil = threading.Thread(target=serveur.serve_forever, daemon=True)
    fil.start()
    yield f"http://127.0.0.1:{serveur.server_address[1]}"
    serveur.shutdown()
    serveur.server_close()


def _get(url: str) -> tuple[int, dict[str, str], str]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def test_page_principale(adresse):
    statut, entetes, html = _get(adresse + "/")
    assert statut == 200
    assert "script-src" not in entetes["Content-Security-Policy"]
    assert "default-src 'none'" in entetes["Content-Security-Policy"]
    assert "ΔEVE par choc" in html and "C09" in html and "Données fictives" in html


def test_saisie_invalide_400(adresse):
    statut, _, html = _get(adresse + "/?seuil_sot_eve=abc&calculer=1")
    assert statut == 400
    assert "ΔEVE par choc" not in html


def test_feuille_de_style_et_404(adresse):
    assert _get(adresse + "/style.css")[0] == 200
    assert _get(adresse + "/../pyproject.toml")[0] == 404
