"""Valeurs de référence du moteur Python pour le moteur TypeScript de l'interface (`web/`).

Le moteur TypeScript est un portage : `web/src/demo/parite.test.ts` compare ses résultats sur la
banque fictive à ce fichier, et `tests/test_reference_web.py` vérifie que ce fichier correspond
toujours au moteur Python. Toute modification d'une formule doit donc être faite dans les deux
moteurs, puis ce fichier régénéré.

Usage : python exemples/reference_web.py   (réécrit web/src/demo/reference-python.json)
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from demo_banque_fictive import HORODATAGE_DEMO, CalculBloque, Parametres, executer

from irrbb.comportemental import estimer_transmission
from irrbb.courbes import CourbeZero
from irrbb.mesures import calculer_delta_eve, calculer_delta_nii
from irrbb.options import CapFloor
from irrbb.positions import Instrument, Position
from irrbb.scenarios import CHOCS_BALE, MarcheDevise

FICHIER = Path(__file__).resolve().parent.parent / "web" / "src" / "demo" / "reference-python.json"

# Deux jeux de paramètres : les valeurs par défaut et un jeu qui active les autres branches
# (marges incluses, gains ignorés, seuils différents).
JEUX = {
    "defaut": Parametres(),
    "variante": Parametres(
        fonds_propres_t1=2_000.0, inclure_marge=True, seuil_sot_eve=0.10, seuil_sot_nii=0.02, poids_gains=0.0
    ),
}


def reference(params: Parametres) -> dict[str, object]:
    r = executer(params, HORODATAGE_DEMO)
    if isinstance(r, CalculBloque):
        raise RuntimeError("la démonstration est bloquée : référence impossible")
    return {
        "parametres": {
            "fondsPropresT1": params.fonds_propres_t1,
            "inclureMarge": params.inclure_marge,
            "seuilSotEve": params.seuil_sot_eve,
            "seuilSotNii": params.seuil_sot_nii,
            "poidsGains": params.poids_gains,
        },
        "eve": {"base": r.eve.base, "scenarios": r.eve.scenarios},
        "nii": {"base": r.nii.base, "scenarios": r.nii.scenarios},
        "standardise": r.std.delta_par_scenario_devise,
        "sot": {
            cle: {"scenario": s.scenario, "perte": s.perte, "ratio": s.ratio, "depassement": s.depassement}
            for cle, s in (("eve", r.sot_eve), ("nii", r.sot_nii))
        },
        "sensibilites": {
            "pv01Eur": r.sens.pv01_eur,
            "pv01Usd": r.sens.pv01_usd,
            "krdEur": [[p, v] for p, v in r.sens.krd_eur.items()],
            "baseEuribor": r.sens.base_euribor,
        },
        "gaps": list(r.gaps.gaps),
        "controles": sorted({(e.id_regle, e.severite.value, e.statut.value) for e in r.journal}),
    }


def cas_unitaires() -> dict[str, object]:
    """Chemins que la banque fictive n'emprunte pas. Les mêmes entrées sont écrites dans
    `web/src/demo/parite.test.ts` : les modifier des deux côtés."""
    annuelle = CourbeZero([1, 5, 10], [0.02, 0.025, 0.03], "annuelle")
    simple = CourbeZero([0.5, 2], [0.03, 0.032], "simple")
    pente = CourbeZero([0.25, 1, 5, 10, 30], [0.021, 0.023, 0.027, 0.03, 0.031])
    marche = MarcheDevise("EUR", pente, {"EURIBOR3M": CourbeZero([0.25, 30], [0.022, 0.033])})
    negatif = MarcheDevise("EUR", CourbeZero([1, 10], [-0.008, 0.004]))
    positions: list[Position] = [
        Instrument("VAR-LIN", "pret", "EUR", 1, 100.0, 0.026, 6.0, 4, "lineaire", "EURIBOR3M", 0.004),
        Instrument("FIXE-0", "pret", "EUR", 1, 100.0, 0.031, 2.5, 2, "annuite", duree_renouvellement=0.0),
        CapFloor("CAP-BLACK", "EUR", 1, 100.0, 0.028, 5.0, 4, 0.22, "black", 1, "EURIBOR3M"),
        CapFloor("FLOOR-BACH", "EUR", -1, 100.0, 0.02, 5.0, 4, 0.007, "bachelier", -1, "EURIBOR3M"),
    ]
    eve = calculer_delta_eve(positions, {"EUR": marche}, CHOCS_BALE, inclure_marge=False)
    nii = calculer_delta_nii(positions[:2], {"EUR": marche}, CHOCS_BALE)
    zc = Instrument("ZC", "titre", "EUR", 1, 100.0, 0.0, 3.0)
    eve_negatif = calculer_delta_eve([zc], {"EUR": negatif}, CHOCS_BALE, inclure_marge=True)
    x = [0.002 * math.sin(0.37 * i) + 0.001 * math.cos(1.3 * i) for i in range(48)]
    y = [0.0001 + 0.3 * x[i] + 0.15 * x[i - 1] + 0.00005 * math.sin(2.1 * i) for i in range(48)]
    transmission = estimer_transmission(y[1:], x[1:], 1)
    return {
        "dfAnnuelle": [float(annuelle.facteur_actualisation(t)) for t in (0.5, 3.0, 12.0)],
        "dfSimple": [float(simple.facteur_actualisation(t)) for t in (0.25, 1.0, 3.0)],
        "eve": {s: eve.decomposition(s, "position") for s in eve.scenarios},
        "nii": {s: nii.decomposition(s, "position") for s in nii.scenarios},
        "eveTauxNegatifs": {s: eve_negatif.delta(s) for s in eve_negatif.scenarios},
        "transmission": [transmission.alpha, *transmission.betas.tolist(), transmission.r2],
    }


def construire() -> dict[str, object]:
    return {"demo": {nom: reference(p) for nom, p in JEUX.items()}, "unitaires": cas_unitaires()}


def main() -> int:
    texte = json.dumps(construire(), ensure_ascii=False, indent=1, default=float)
    FICHIER.write_text(texte + "\n", encoding="utf-8")
    print(f"Référence écrite : {FICHIER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
