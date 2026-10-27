"""Le fichier de référence du moteur TypeScript (`web/`) correspond au moteur Python actuel.

Si ce test échoue après une modification de formule : reporter la modification dans
`web/src/moteur`, puis régénérer la référence avec `python exemples/reference_web.py`.
"""

import json

import pytest
from reference_web import FICHIER, construire


def _aplatir(objet, prefixe=""):
    if isinstance(objet, dict):
        for k, v in objet.items():
            yield from _aplatir(v, f"{prefixe}/{k}")
    elif isinstance(objet, (list, tuple)):
        for i, v in enumerate(objet):
            yield from _aplatir(v, f"{prefixe}/{i}")
    else:
        yield prefixe, objet


def test_reference_web_a_jour():
    enregistre = dict(_aplatir(json.loads(FICHIER.read_text(encoding="utf-8"))))
    recalcule = dict(_aplatir(json.loads(json.dumps(construire(), default=float))))
    assert enregistre.keys() == recalcule.keys()
    for cle, v in recalcule.items():
        if isinstance(v, float):
            assert enregistre[cle] == pytest.approx(v, rel=1e-12, abs=1e-12), cle
        else:
            assert enregistre[cle] == v, cle
