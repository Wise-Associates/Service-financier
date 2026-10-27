"""Démonstration de bout en bout sur un bilan FICTIF (montants en millions d'euros/dollars).

Enchaîne les étapes du PDF : import et contrôles C01–C02, calcul (courbes, chocs, ΔEVE,
ΔNII, comportemental, options), contrôles de calcul (C04, C05, C07, C08), approche
standardisée et SOT, sensibilités, puis écrit le rapport et le journal dans `sortie/`.

Usage : python exemples/demo_banque_fictive.py [dossier_de_sortie]

`executer` fait tout le calcul sans écrire sur disque : `reference_web.py` l'appelle pour
produire la référence de parité du moteur TypeScript de l'interface (`web/`).
"""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from irrbb import __version__
from irrbb.comportemental import DepotNonEcheance, PretRemboursementAnticipe
from irrbb.controles import (
    Contexte,
    EntreeJournal,
    Hypothese,
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
    controle_signe,
    controle_variation,
    empreinte,
    encours_signe,
)
from irrbb.courbes import CourbeZero, bootstrap_swaps
from irrbb.mesures import ResultatMesure, calculer_delta_eve, calculer_delta_nii
from irrbb.options import CapFloor
from irrbb.positions import Instrument, Position
from irrbb.scenarios import CHOCS_BALE, MarcheDevise
from irrbb.sensibilites import Gaps, delta_pv_risque_base, gaps_repricing, krd, pv01
from irrbb.standardise import (
    ResultatSOT,
    ResultatStandardise,
    calculer_delta_eve_standardise,
    controle_valeurs_aberrantes,
)

DATE_ARRETE = date(2026, 9, 30)
# Horodatage figé du journal pour que deux exécutions de la démonstration donnent le même fichier.
HORODATAGE_DEMO = datetime(2026, 10, 27, 9, 0)


@dataclass(frozen=True)
class Parametres:
    """Paramètres de la démonstration que l'utilisateur peut faire varier.

    Fonds propres fictifs. Seuils SOT (15 % du Tier 1 pour ΔEVE, 5 % pour ΔNII) et pondération des
    gains à 50 % : RTS UE 2024/856 et BCBS d368, à confirmer (PDF p. 15). Le PDF impose de choisir
    explicitement le traitement des marges commerciales (p. 11).
    """

    fonds_propres_t1: float = 1_200.0
    inclure_marge: bool = False
    seuil_sot_eve: float = 0.15
    seuil_sot_nii: float = 0.05
    poids_gains: float = 0.5


def marches() -> dict[str, MarcheDevise]:
    eur_ois = bootstrap_swaps(range(1, 31), [0.0215 + 0.0011 * min(n, 10) - 0.00002 * n * n for n in range(1, 31)])
    eur_3m = CourbeZero([0.25, 1, 5, 10, 30], [0.0230, 0.0236, 0.0262, 0.0291, 0.0300])
    usd = CourbeZero([0.25, 1, 2, 5, 10, 30], [0.0410, 0.0395, 0.0378, 0.0372, 0.0389, 0.0405])
    return {
        "EUR": MarcheDevise("EUR", eur_ois, {"EURIBOR3M": eur_3m}),
        "USD": MarcheDevise("USD", usd, {"SOFR": usd}),
    }


def portefeuille() -> list[Position]:
    return [
        PretRemboursementAnticipe("IMMO-01", "EUR", 4_000.0, 0.0325, 18.0, 0.0090, 0.03, 0.22, 350.0),
        Instrument("PRO-VAR-01", "pret_entreprise", "EUR", 1, 1_800.0, 0.0335, 5.0, 4, "lineaire", "EURIBOR3M", 0.0110),
        Instrument(
            "PRO-FIX-01",
            "pret_entreprise",
            "EUR",
            1,
            900.0,
            0.0390,
            7.0,
            12,
            "annuite",
            marge=0.0120,
            duree_renouvellement=7.0,
        ),
        Instrument("TIT-OAT-01", "titre", "EUR", 1, 1_500.0, 0.0275, 9.0),
        Instrument("TIT-UST-01", "titre", "USD", 1, 600.0, 0.0400, 4.0, 2),
        Instrument(
            "DAT-01", "depot_terme", "EUR", -1, 1_400.0, 0.0240, 1.5, 1, marge=-0.0020, duree_renouvellement=1.0
        ),
        DepotNonEcheance("DAV-PART", "EUR", 3_500.0, 0.75, 0.0025, 0.35, 4.5),
        DepotNonEcheance("DAV-USD", "USD", 450.0, 0.60, 0.0150, 0.50, 3.0, index="SOFR"),
        Instrument("EMTN-01", "emission", "EUR", -1, 2_200.0, 0.0300, 6.0),
        # Swap emprunteur de taux fixe : jambe fixe payée, jambe variable reçue.
        Instrument("SWP-01-FIXE", "derive", "EUR", -1, 2_500.0, 0.0270, 8.0),
        Instrument("SWP-01-VAR", "derive", "EUR", 1, 2_500.0, 0.0231, 8.0, 4, "in_fine", "EURIBOR3M"),
        CapFloor("CAP-VENDU-01", "EUR", -1, 500.0, 0.0350, 5.0, 4, 0.0080, "bachelier", 1, "EURIBOR3M"),
        Instrument("HB-ENG-01", "hors_bilan", "EUR", 1, 600.0, 0.0360, 3.0, 4, facteur_conversion=0.4),
    ]


def import_source() -> list[dict[str, object]]:
    """Extraction source fictive telle qu'elle arriverait des systèmes ALM et comptables."""
    lignes: list[dict[str, object]] = []
    for p in portefeuille():
        if isinstance(p, CapFloor):
            lignes.append(
                {
                    "identifiant": p.identifiant,
                    "categorie": p.categorie,
                    "devise": p.devise,
                    "encours": p.notionnel,
                    "maturite": p.maturite,
                    "taux": p.strike,
                }
            )
            continue
        if isinstance(p, DepotNonEcheance):
            taux, maturite = p.taux_servi, p.maturite_max
        else:
            assert isinstance(p, (Instrument, PretRemboursementAnticipe))
            taux, maturite = p.taux, p.maturite
        encours = p.encours
        lignes.append(
            {
                "identifiant": p.identifiant,
                "categorie": p.categorie,
                "devise": p.devise,
                "encours": encours,
                "maturite": maturite,
                "taux": taux,
            }
        )
    return lignes


@dataclass(frozen=True)
class Sensibilites:
    pv01_eur: float
    pv01_usd: float
    krd_eur: dict[float, float]
    base_euribor: float


@dataclass(frozen=True)
class Resultats:
    eve: ResultatMesure
    nii: ResultatMesure
    std: ResultatStandardise
    sot_eve: ResultatSOT
    sot_nii: ResultatSOT
    sens: Sensibilites
    gaps: Gaps
    journal: list[EntreeJournal]
    versions: dict[str, object]
    trace: str


@dataclass(frozen=True)
class CalculBloque:
    """Une anomalie bloquante à l'import a arrêté la chaîne avant le calcul (PDF p. 7)."""

    journal: list[EntreeJournal]


def fmt(x: float) -> str:
    return f"{x:,.1f}".replace(",", " ")


def executer(params: Parametres, maintenant: datetime) -> Resultats | CalculBloque:
    """Enchaîne import, contrôles, calculs et sensibilités sur le bilan fictif, sans écrire sur disque."""
    ctx = Contexte(DATE_ARRETE.isoformat(), maintenant, "equipe.production")
    journal: list[EntreeJournal] = []
    m = marches()
    pos = portefeuille()
    source = import_source()
    categories = {str(e["categorie"]) for e in source}

    # 1. Import : C01 complétude, qualité, doublons ; C02 périmètre
    journal += controle_completude(source, {c: ["devise", "encours", "maturite", "taux"] for c in categories}, ctx)
    journal += controle_qualite(source, list(m), ctx)
    journal += controle_doublons([str(e["identifiant"]) for e in source], ctx)
    journal += controle_perimetre([str(e["identifiant"]) for e in source], [p.identifiant for p in pos], ctx)
    if bloquants(journal):
        return CalculBloque(journal)

    # 2. Calcul
    eve = calculer_delta_eve(pos, m, CHOCS_BALE, inclure_marge=params.inclure_marge)
    nii = calculer_delta_nii(pos, m, CHOCS_BALE)
    std = calculer_delta_eve_standardise(
        pos, m, CHOCS_BALE, inclure_marge=params.inclure_marge, poids_gains=params.poids_gains
    )
    sot_eve = controle_valeurs_aberrantes(
        {s: std.delta_agrege(s) for s in std.delta_par_scenario_devise},
        params.fonds_propres_t1,
        params.seuil_sot_eve,
        "ΔEVE standardisé",
    )
    sot_nii = controle_valeurs_aberrantes(
        {s: nii.delta(s) for s in nii.scenarios}, params.fonds_propres_t1, params.seuil_sot_nii, "ΔNII"
    )

    # 3. Contrôles de calcul : C04 rapprochement, C05 conservation, C06 hypothèses, C07 variation, C08 signes
    totaux_source: dict[str, float] = {}
    totaux_calcul: dict[str, float] = {}
    for p in pos:
        attendu = encours_signe(p)
        if attendu is None:
            continue
        ligne = next(e for e in source if e["identifiant"] == p.identifiant)
        brut = ligne["encours"]
        assert isinstance(brut, float)  # garanti par C01-ENCOURS, qui bloque sinon
        signe = 1.0 if attendu > 0 else -1.0
        facteur = getattr(p, "facteur_conversion", 1.0)
        totaux_source[p.devise] = totaux_source.get(p.devise, 0.0) + signe * brut * facteur
        totaux_calcul[p.devise] = totaux_calcul.get(p.devise, 0.0) + attendu
    journal += controle_rapprochement(totaux_source, totaux_calcul, ctx, tolerance_abs=0.5)
    journal += controle_conservation_flux(pos, m, ctx)
    journal += controle_hypotheses(
        [
            Hypothese("Écoulement et bêta des dépôts à vue", "2026.2", date(2026, 12, 31), "comite.alm"),
            Hypothese("Courbe de CPR des prêts immobiliers", "2026.1", date(2026, 12, 31), "comite.alm"),
        ],
        DATE_ARRETE,
        ctx,
    )
    pire, perte = eve.perte_maximale()
    precedent = -perte * 0.8  # arrêté précédent fictif
    journal += controle_variation("ΔEVE perte maximale", -perte, precedent, ctx, 0.10, 5.0)
    for s in eve.scenarios:
        journal += controle_signe(f"ΔEVE {s}", eve.delta(s), "libre", ctx)
        total_devises = sum(eve.decomposition(s, "devise").values())
        journal += controle_coherence(f"ΔEVE {s} = Σ devises", eve.delta(s), total_devises, ctx, 1e-6)

    # Revue de second niveau : la variation majeure est expliquée et acceptée par un tiers
    journal = [
        approuver(
            e,
            "controle.second.niveau",
            "Variation expliquée : arrêté précédent fictif de démonstration",
            ctx.maintenant,
        )
        if e.id_regle == "C07-VARIATION" and e.severite == "Majeure"
        else e
        for e in journal
    ]

    # 4. Sensibilités et explication
    eur = m["EUR"]
    sens = Sensibilites(
        pv01(pos, eur, inclure_marge=params.inclure_marge),
        pv01(pos, m["USD"], inclure_marge=params.inclure_marge),
        krd(pos, eur, [0.25, 1, 2, 5, 10, 20], inclure_marge=params.inclure_marge),
        delta_pv_risque_base(pos, eur, "EURIBOR3M", 0.0010, inclure_marge=params.inclure_marge),
    )
    gaps = gaps_repricing(pos, eur)

    versions = {
        "moteur": __version__,
        "inclure_marge": params.inclure_marge,
        "chocs": "BCBS d368 (paramètres)",
        "plancher": "RTS UE 2024/856 (paramètres)",
        "arrete": DATE_ARRETE.isoformat(),
    }
    parametres = {
        "fonds_propres_t1": params.fonds_propres_t1,
        "seuil_sot_eve": params.seuil_sot_eve,
        "seuil_sot_nii": params.seuil_sot_nii,
        "poids_gains": params.poids_gains,
    }
    # Les paramètres font partie de l'empreinte C03 : un autre seuil ou Tier 1 est un autre calcul.
    trace = empreinte({"source": source, "versions": versions, "parametres": parametres})
    return Resultats(eve, nii, std, sot_eve, sot_nii, sens, gaps, journal, versions, trace)


def main(sortie: Path) -> int:
    sortie.mkdir(parents=True, exist_ok=True)
    r = executer(Parametres(), HORODATAGE_DEMO)
    ecrire_journal(r.journal, sortie)
    if isinstance(r, CalculBloque):
        print("Calcul bloqué par une anomalie d'import ; voir le journal.")
        return 1
    ecrire_rapport(sortie, r)
    pire, perte = r.eve.perte_maximale()
    print(f"Rapport : {sortie / 'rapport_irrbb.md'}")
    print(f"Pire scénario ΔEVE : {pire} ({fmt(-perte)}) ; SOT ΔEVE {r.sot_eve.ratio:.1%} du Tier 1")
    return 0 if not bloquants(r.journal) else 1


def ecrire_journal(journal: list[EntreeJournal], sortie: Path) -> None:
    with open(sortie / "journal_controles.csv", "w", newline="", encoding="utf-8") as f:
        lignes = [e.en_ligne() for e in journal]
        w = csv.DictWriter(f, fieldnames=list(lignes[0]), delimiter=";")
        w.writeheader()
        w.writerows(lignes)


def ecrire_rapport(sortie: Path, res: Resultats) -> None:
    eve, nii, std, sot_eve, sot_nii = res.eve, res.nii, res.std, res.sot_eve, res.sot_nii
    sens, gaps, journal, versions, trace = res.sens, res.gaps, res.journal, res.versions, res.trace
    lignes: list[str] = [
        "# Rapport IRRBB — banque fictive",
        "",
        f"Arrêté {versions['arrete']} · moteur {versions['moteur']} · empreinte des entrées `{trace[:16]}`",
        "",
        "Données entièrement fictives. Montants en millions de la devise.",
        "",
        "## ΔEVE (revalorisation complète, marges commerciales "
        + ("incluses" if versions["inclure_marge"] else "exclues")
        + ")",
        "",
        "| Scénario | EUR | USD | Total |",
        "|---|---:|---:|---:|",
    ]
    for s in eve.scenarios:
        d = eve.decomposition(s, "devise")
        lignes.append(f"| {s} | {fmt(d.get('EUR', 0))} | {fmt(d.get('USD', 0))} | {fmt(eve.delta(s))} |")
    pire, perte = eve.perte_maximale()
    lignes += [
        "",
        f"EVE de base : {fmt(eve.total())}. Perte maximale : {fmt(perte)} ({pire}).",
        "",
        "## ΔNII 12 mois à bilan constant",
        "",
        "| Scénario | EUR | USD | Total |",
        "|---|---:|---:|---:|",
    ]
    for s in nii.scenarios:
        d = nii.decomposition(s, "devise")
        lignes.append(f"| {s} | {fmt(d.get('EUR', 0))} | {fmt(d.get('USD', 0))} | {fmt(nii.delta(s))} |")
    lignes += [
        "",
        f"NII de base : {fmt(nii.total())}.",
        "",
        "### ΔNII hausse parallèle par produit",
        "",
        "| Catégorie | ΔNII |",
        "|---|---:|",
    ]
    for k, v in sorted(nii.decomposition("hausse_parallele", "categorie").items()):
        lignes.append(f"| {k} | {fmt(v)} |")
    lignes += [
        "",
        "## Approche standardisée et test des valeurs aberrantes",
        "",
        "| Scénario | ΔEVE agrégé (gains à 50 %) |",
        "|---|---:|",
    ]
    for s in std.delta_par_scenario_devise:
        lignes.append(f"| {s} | {fmt(std.delta_agrege(s))} |")
    for r in (sot_eve, sot_nii):
        etat = "DÉPASSEMENT" if r.depassement else "sous le seuil"
        lignes.append(
            f"\n{r.indicateur} : perte {fmt(r.perte)} ({r.scenario}) = {r.ratio:.2%} du Tier 1 "
            f"({fmt(r.fonds_propres_t1)}), seuil {r.seuil:.0%} : **{etat}**."
        )
    lignes += [
        "",
        "## Sensibilités",
        "",
        f"PV01 EUR : {sens.pv01_eur:.3f} · PV01 USD : {sens.pv01_usd:.3f} · "
        f"choc de base +10 pb sur l'EURIBOR 3M seul : {sens.base_euribor:+.2f}",
        "",
        "| Pilier KRD EUR | KRD × 1 pb |",
        "|---|---:|",
    ]
    for pilier, valeur in sens.krd_eur.items():
        lignes.append(f"| {pilier:g} an(s) | {valeur * 1e-4:.3f} |")
    lignes += ["", "## Gaps de repricing EUR", "", "| Tranche | Gap | Cumulé |", "|---|---:|---:|"]
    for lib, g, c in zip(gaps.libelles(), gaps.gaps, gaps.cumules, strict=True):
        lignes.append(f"| {lib} | {fmt(g)} | {fmt(c)} |")
    nb: dict[str, int] = {}
    for e in journal:
        cle = f"{e.severite} ({e.statut.lower()})"
        nb[cle] = nb.get(cle, 0) + 1
    lignes += [
        "",
        "## Contrôles",
        "",
        ", ".join(f"{k} : {v}" for k, v in sorted(nb.items())),
        f"\nAnomalies bloquant la remise : {len(bloquants(journal))}. Détail : `journal_controles.csv`.",
        "",
    ]
    (sortie / "rapport_irrbb.md").write_text("\n".join(lignes), encoding="utf-8")


if __name__ == "__main__":
    dossier = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "sortie"
    sys.exit(main(dossier))
