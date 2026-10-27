from datetime import date, datetime

import pytest

from irrbb.controles import (
    Contexte,
    Hypothese,
    Severite,
    Statut,
    approuver,
    bloquants,
    controle_coherence,
    controle_completude,
    controle_conservation_flux,
    controle_doublons,
    controle_hypotheses,
    controle_perimetre,
    controle_qualite,
    controle_rapprochement,
    controle_reproductibilite,
    controle_signe,
    controle_variation,
    empreinte,
)
from irrbb.positions import Instrument

CTX = Contexte("2026-09-30", datetime(2026, 10, 27, 9, 0), "equipe.production")
CHAMPS = {"pret": ["encours", "devise", "taux", "maturite"]}


def severites(journal):
    return [e.severite for e in journal]


def test_completude_signale_champ_manquant_et_categorie_inconnue():
    j = controle_completude(
        [
            {"identifiant": "P1", "categorie": "pret", "encours": 10.0, "devise": "EUR", "taux": None, "maturite": 2.0},
            {"identifiant": "X1", "categorie": "inconnue"},
        ],
        CHAMPS,
        CTX,
    )
    assert [e.id_regle for e in j] == ["C01-COMPLETUDE", "C01-CATEGORIE"]
    assert "taux" in j[0].valeur_observee and severites(j) == [Severite.BLOQUANTE] * 2


def test_controle_passe_laisse_une_trace_information():
    j = controle_completude(
        [{"identifiant": "P1", "categorie": "pret", "encours": 1.0, "devise": "EUR", "taux": 0.01, "maturite": 1.0}],
        CHAMPS,
        CTX,
    )
    assert severites(j) == [Severite.INFORMATION] and j[0].statut is Statut.JOURNALISEE
    assert j[0].horodatage == CTX.maintenant


def test_qualite_devise_encours_et_taux_aberrant():
    j = controle_qualite(
        [{"identifiant": "P1", "devise": "XXX", "encours": -5.0, "maturite": 1.0, "taux": 0.45}], ["EUR"], CTX
    )
    assert {e.id_regle: e.severite for e in j} == {
        "C01-DEVISE": Severite.BLOQUANTE,
        "C01-ENCOURS": Severite.BLOQUANTE,
        "C01-TAUX-ABERRANT": Severite.MAJEURE,
    }


def test_doublons_et_perimetre():
    assert severites(controle_doublons(["A", "B", "A"], CTX)) == [Severite.BLOQUANTE]
    j = controle_perimetre(["A", "B"], ["B", "C"], CTX)
    assert [(e.id_regle, e.objet) for e in j] == [("C02-ABSENT", "A"), ("C02-HORS-SOURCE", "C")]


def test_rapprochement_trois_niveaux():
    j = controle_rapprochement(
        {"EUR": 1000.0, "USD": 500.0, "GBP": 10.0}, {"EUR": 1000.0, "USD": 500.4, "GBP": 12.0}, CTX, tolerance_abs=1.0
    )
    assert {e.objet: e.severite for e in j} == {"USD": Severite.AVERTISSEMENT, "GBP": Severite.BLOQUANTE}


def test_conservation_des_flux(marche_plat):
    p = Instrument("P1", "pret", "EUR", 1, 100.0, 0.03, 10.0, 12, "annuite")
    assert severites(controle_conservation_flux([p], {"EUR": marche_plat}, CTX)) == [Severite.INFORMATION]


def test_empreinte_stable_et_reproductibilite():
    a = empreinte({"b": 1, "a": [1.5, "x"]})
    assert a == empreinte({"a": [1.5, "x"], "b": 1})
    assert severites(controle_reproductibilite("ΔEVE", a, empreinte({"a": 1}), CTX)) == [Severite.BLOQUANTE]


def test_hypotheses_non_approuvees_ou_perimees():
    j = controle_hypotheses([Hypothese("bêta DAV", "3", date(2026, 6, 30), "")], date(2026, 9, 30), CTX)
    assert [e.id_regle for e in j] == ["C06-APPROBATION", "C06-VALIDITE"]


def test_variation_non_expliquee_est_majeure_expliquee_est_journalisee():
    assert severites(controle_variation("ΔEVE", -30.0, -10.0, CTX, 0.10, 1.0)) == [Severite.MAJEURE]
    j = controle_variation("ΔEVE", -30.0, -10.0, CTX, 0.10, 1.0, explication="couverture échue")
    assert severites(j) == [Severite.INFORMATION] and j[0].justification == "couverture échue"


def test_signe_suit_la_convention_de_la_rubrique():
    assert severites(controle_signe("ΔEVE", -5.0, "libre", CTX)) == [Severite.INFORMATION]
    assert severites(controle_signe("Encours", -5.0, "positif", CTX)) == [Severite.BLOQUANTE]
    assert severites(controle_coherence("total", 10.0, 10.5, CTX, 0.1)) == [Severite.BLOQUANTE]


def test_approbation_quatre_yeux_et_bloquante_non_approuvable():
    majeure = controle_variation("ΔNII", -30.0, -10.0, CTX, 0.10, 1.0)[0]
    with pytest.raises(ValueError):
        approuver(majeure, CTX.responsable, "ok", CTX.maintenant)
    with pytest.raises(ValueError):
        approuver(majeure, "controle.n2", "  ", CTX.maintenant)
    acceptee = approuver(majeure, "controle.n2", "hausse des dépôts expliquée", CTX.maintenant)
    assert acceptee.statut is Statut.ACCEPTEE and bloquants([acceptee]) == []
    bloquante = controle_doublons(["A", "A"], CTX)[0]
    with pytest.raises(ValueError):
        approuver(bloquante, "controle.n2", "urgent", CTX.maintenant)
    assert bloquants([bloquante]) == [bloquante]
    assert set(bloquante.en_ligne()) >= {
        "id_regle",
        "objet",
        "periode",
        "valeur_attendue",
        "valeur_observee",
        "severite",
        "justification",
        "responsable",
        "horodatage",
        "approbateur",
        "statut",
    }
