"""Valeurs de référence du moteur Python pour le moteur TypeScript de l'interface (`web/`).

Le moteur TypeScript est un portage : `web/src/demo/parite.test.ts` compare ses résultats sur la
banque fictive à ce fichier, et `tests/test_reference_web.py` vérifie que ce fichier correspond
toujours au moteur Python. Toute modification d'une formule doit donc être faite dans les deux
moteurs, puis ce fichier régénéré.

Usage : python exemples/reference_web.py   (réécrit web/src/demo/reference-python.json)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from demo_banque_fictive import HORODATAGE_DEMO, CalculBloque, Parametres, executer

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


def construire() -> dict[str, object]:
    return {nom: reference(p) for nom, p in JEUX.items()}


def main() -> int:
    texte = json.dumps(construire(), ensure_ascii=False, indent=1, default=float)
    FICHIER.write_text(texte + "\n", encoding="utf-8")
    print(f"Référence écrite : {FICHIER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
