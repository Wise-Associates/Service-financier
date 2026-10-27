"""Contrôles C01 à C10 et journal des anomalies (PDF p. 3, 4, 7 et 8).

Chaque contrôle produit au moins une entrée de journal : une anomalie avec sa sévérité, ou
une entrée « Information » quand il est passé (preuve pour la piste d'audit). L'horodatage
est injecté par l'appelant (`Contexte.maintenant`) pour garder des contrôles reproductibles.

Sévérités (PDF p. 7) :
- Bloquante : bloque le calcul ou la remise jusqu'à correction, ne s'approuve pas ;
- Majeure : justification documentée et approbation d'un tiers ;
- Avertissement : commentaire, propriétaire, échéance ;
- Information : journalisée.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime
from enum import StrEnum

from .comportemental import DepotNonEcheance, PretRemboursementAnticipe
from .options import CapFloor
from .positions import Instrument, Position
from .scenarios import MarcheDevise


class Severite(StrEnum):
    BLOQUANTE = "Bloquante"
    MAJEURE = "Majeure"
    AVERTISSEMENT = "Avertissement"
    INFORMATION = "Information"


class Statut(StrEnum):
    OUVERTE = "Ouverte"
    ACCEPTEE = "Acceptée"
    JOURNALISEE = "Journalisée"


@dataclass(frozen=True)
class Contexte:
    periode: str
    maintenant: datetime
    responsable: str


@dataclass(frozen=True)
class EntreeJournal:
    """Journal minimum du PDF p. 7."""

    id_regle: str
    objet: str
    periode: str
    valeur_attendue: str
    valeur_observee: str
    severite: Severite
    statut: Statut
    horodatage: datetime
    responsable: str
    justification: str = ""
    approbateur: str = ""

    def en_ligne(self) -> dict[str, str]:
        d = asdict(self)
        d["horodatage"] = self.horodatage.isoformat()
        return {k: str(v) for k, v in d.items()}


def _entree(
    ctx: Contexte, regle: str, objet: str, attendu: object, observe: object, severite: Severite, justification: str = ""
) -> EntreeJournal:
    statut = Statut.JOURNALISEE if severite is Severite.INFORMATION else Statut.OUVERTE
    return EntreeJournal(
        regle,
        objet,
        ctx.periode,
        str(attendu),
        str(observe),
        severite,
        statut,
        ctx.maintenant,
        ctx.responsable,
        justification,
    )


def _conforme(ctx: Contexte, regle: str, objet: str, detail: str) -> list[EntreeJournal]:
    return [_entree(ctx, regle, objet, detail, detail, Severite.INFORMATION, "contrôle passé")]


def _vide(v: object) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, float) and math.isnan(v))


def controle_completude(
    enregistrements: Sequence[Mapping[str, object]],
    champs_par_categorie: Mapping[str, Sequence[str]],
    ctx: Contexte,
) -> list[EntreeJournal]:
    """C01 : champs minimaux présents selon la catégorie d'instrument (PDF p. 4)."""
    res: list[EntreeJournal] = []
    for i, e in enumerate(enregistrements):
        ident = str(e.get("identifiant", f"ligne {i + 1}"))
        cat = e.get("categorie")
        if not isinstance(cat, str) or cat not in champs_par_categorie:
            res.append(_entree(ctx, "C01-CATEGORIE", ident, "catégorie connue", cat, Severite.BLOQUANTE))
            continue
        manquants = [c for c in champs_par_categorie[cat] if _vide(e.get(c))]
        if manquants:
            res.append(
                _entree(
                    ctx,
                    "C01-COMPLETUDE",
                    ident,
                    "champs renseignés",
                    "manquants : " + ", ".join(manquants),
                    Severite.BLOQUANTE,
                )
            )
    return res or _conforme(ctx, "C01-COMPLETUDE", "portefeuille", f"{len(enregistrements)} lignes complètes")


def controle_qualite(
    enregistrements: Sequence[Mapping[str, object]],
    devises_autorisees: Sequence[str],
    ctx: Contexte,
    bornes_taux: tuple[float, float] = (-0.05, 0.30),
) -> list[EntreeJournal]:
    """C01 : formats, devises, encours, maturités et taux aberrants."""
    res: list[EntreeJournal] = []
    for i, e in enumerate(enregistrements):
        ident = str(e.get("identifiant", f"ligne {i + 1}"))
        devise = e.get("devise")
        if devise not in devises_autorisees:
            res.append(_entree(ctx, "C01-DEVISE", ident, list(devises_autorisees), devise, Severite.BLOQUANTE))
        for champ in ("encours", "maturite"):
            v = e.get(champ)
            if not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
                res.append(_entree(ctx, f"C01-{champ.upper()}", ident, "> 0", v, Severite.BLOQUANTE))
        taux = e.get("taux")
        if taux is not None:
            if not isinstance(taux, (int, float)) or not math.isfinite(taux):
                res.append(_entree(ctx, "C01-TAUX", ident, "nombre", taux, Severite.BLOQUANTE))
            elif not bornes_taux[0] <= taux <= bornes_taux[1]:
                res.append(_entree(ctx, "C01-TAUX-ABERRANT", ident, f"dans {bornes_taux}", taux, Severite.MAJEURE))
    return res or _conforme(ctx, "C01-QUALITE", "portefeuille", "formats et valeurs conformes")


def controle_doublons(identifiants: Sequence[str], ctx: Contexte) -> list[EntreeJournal]:
    """C01 : un identifiant présent deux fois serait compté deux fois."""
    vus: dict[str, int] = {}
    for ident in identifiants:
        vus[ident] = vus.get(ident, 0) + 1
    res = [_entree(ctx, "C01-DOUBLON", k, 1, n, Severite.BLOQUANTE) for k, n in vus.items() if n > 1]
    return res or _conforme(ctx, "C01-DOUBLON", "portefeuille", "aucun doublon")


def controle_perimetre(ids_source: Sequence[str], ids_calcul: Sequence[str], ctx: Contexte) -> list[EntreeJournal]:
    """C02 : toute position source est calculée, et rien d'autre."""
    src, calc = set(ids_source), set(ids_calcul)
    res = [
        _entree(ctx, "C02-ABSENT", i, "présent dans le calcul", "absent", Severite.BLOQUANTE)
        for i in sorted(src - calc)
    ]
    res += [
        _entree(ctx, "C02-HORS-SOURCE", i, "présent dans la source", "absent", Severite.BLOQUANTE)
        for i in sorted(calc - src)
    ]
    return res or _conforme(ctx, "C02-PERIMETRE", "portefeuille", f"{len(src)} positions")


def empreinte(objet: object) -> str:
    """C03 : empreinte SHA-256 d'un objet JSON canonique (données, paramètres, version de règles)."""
    texte = json.dumps(objet, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(texte.encode("utf-8")).hexdigest()


def controle_reproductibilite(objet: str, attendue: str, recalculee: str, ctx: Contexte) -> list[EntreeJournal]:
    """C03 : le calcul rejoué à partir de l'arrêté et des versions donne la même empreinte."""
    if attendue != recalculee:
        return [_entree(ctx, "C03-REPRODUCTIBILITE", objet, attendue, recalculee, Severite.BLOQUANTE)]
    return _conforme(ctx, "C03-REPRODUCTIBILITE", objet, attendue[:12])


def controle_rapprochement(
    totaux_source: Mapping[str, float],
    totaux_calcul: Mapping[str, float],
    ctx: Contexte,
    tolerance_abs: float,
    tolerance_rel: float = 0.0,
) -> list[EntreeJournal]:
    """C04 : encours du calcul rapprochés des systèmes sources (par devise, produit…)."""
    res: list[EntreeJournal] = []
    for cle in sorted(set(totaux_source) | set(totaux_calcul)):
        s, c = totaux_source.get(cle), totaux_calcul.get(cle)
        if s is None or c is None:
            res.append(_entree(ctx, "C04-RAPPROCHEMENT", cle, s, c, Severite.BLOQUANTE))
            continue
        ecart = abs(c - s)
        tol = max(tolerance_abs, tolerance_rel * abs(s))
        if ecart > tol:
            res.append(_entree(ctx, "C04-RAPPROCHEMENT", cle, s, c, Severite.BLOQUANTE))
        elif ecart > 1e-9:
            res.append(
                _entree(
                    ctx,
                    "C04-RAPPROCHEMENT",
                    cle,
                    s,
                    c,
                    Severite.AVERTISSEMENT,
                    f"écart {ecart:.2f} dans la tolérance {tol:.2f}",
                )
            )
    return res or _conforme(ctx, "C04-RAPPROCHEMENT", "totaux", "écart nul")


def encours_signe(p: Position) -> float | None:
    """Encours attendu (signé) d'une position ; None si la notion ne s'applique pas (option)."""
    if isinstance(p, Instrument):
        return p.sens * p.nominal
    if isinstance(p, DepotNonEcheance):
        return -p.encours
    if isinstance(p, PretRemboursementAnticipe):
        return p.encours
    if isinstance(p, CapFloor):
        return None
    raise TypeError(f"type de position non pris en charge : {type(p).__name__}")


def controle_conservation_flux(
    positions: Sequence[Position], marches: Mapping[str, MarcheDevise], ctx: Contexte, tolerance_rel: float = 1e-9
) -> list[EntreeJournal]:
    """C05 : la somme du principal projeté égale l'encours (ni perte ni double comptage)."""
    res: list[EntreeJournal] = []
    for p in positions:
        attendu = encours_signe(p)
        if attendu is None:
            continue
        m = marches[p.devise]
        observe = float(p.flux(m, m, True).principal.sum())
        if abs(observe - attendu) > tolerance_rel * abs(attendu):
            res.append(_entree(ctx, "C05-CONSERVATION", p.identifiant, attendu, observe, Severite.BLOQUANTE))
    return res or _conforme(ctx, "C05-CONSERVATION", "flux", "principal = encours")


@dataclass(frozen=True)
class Hypothese:
    nom: str
    version: str
    valide_jusqu_au: date
    approbateur: str


def controle_hypotheses(hypotheses: Sequence[Hypothese], date_arrete: date, ctx: Contexte) -> list[EntreeJournal]:
    """C06 : hypothèses comportementales datées, versionnées, approuvées et en vigueur."""
    res: list[EntreeJournal] = []
    for h in hypotheses:
        objet = f"{h.nom} v{h.version}"
        if not h.approbateur.strip():
            res.append(_entree(ctx, "C06-APPROBATION", objet, "approbateur renseigné", "aucun", Severite.MAJEURE))
        if h.valide_jusqu_au < date_arrete:
            res.append(_entree(ctx, "C06-VALIDITE", objet, f">= {date_arrete}", h.valide_jusqu_au, Severite.MAJEURE))
    return res or _conforme(ctx, "C06-HYPOTHESES", "modèles", f"{len(hypotheses)} hypothèses en vigueur")


def controle_variation(
    indicateur: str,
    valeur: float,
    valeur_precedente: float,
    ctx: Contexte,
    seuil_relatif: float,
    seuil_absolu: float,
    explication: str = "",
) -> list[EntreeJournal]:
    """C07 : variation par rapport à l'arrêté précédent ; significative et non expliquée = Majeure."""
    ecart = valeur - valeur_precedente
    significatif = abs(ecart) > seuil_absolu and abs(ecart) > seuil_relatif * abs(valeur_precedente)
    if not significatif:
        return _conforme(ctx, "C07-VARIATION", indicateur, f"variation {ecart:+.2f}")
    if explication.strip():
        return [_entree(ctx, "C07-VARIATION", indicateur, valeur_precedente, valeur, Severite.INFORMATION, explication)]
    return [_entree(ctx, "C07-VARIATION", indicateur, valeur_precedente, valeur, Severite.MAJEURE)]


def controle_signe(rubrique: str, valeur: float, convention: str, ctx: Contexte) -> list[EntreeJournal]:
    """C08 : règle de signe de la rubrique ; un négatif n'est une erreur que si la rubrique l'interdit."""
    if convention not in ("positif", "negatif", "libre"):
        raise ValueError("convention : positif, negatif ou libre")
    viole = (convention == "positif" and valeur < 0) or (convention == "negatif" and valeur > 0)
    if viole:
        return [_entree(ctx, "C08-SIGNE", rubrique, convention, valeur, Severite.BLOQUANTE)]
    return _conforme(ctx, "C08-SIGNE", rubrique, convention)


def controle_coherence(
    nom: str, valeur_a: float, valeur_b: float, ctx: Contexte, tolerance: float
) -> list[EntreeJournal]:
    """C08 : cohérence entre agrégats ou entre états (total = somme des devises, etc.)."""
    if abs(valeur_a - valeur_b) > tolerance:
        return [_entree(ctx, "C08-COHERENCE", nom, valeur_a, valeur_b, Severite.BLOQUANTE)]
    return _conforme(ctx, "C08-COHERENCE", nom, f"écart <= {tolerance}")


def approuver(entree: EntreeJournal, approbateur: str, justification: str, maintenant: datetime) -> EntreeJournal:
    """C09 : accepte une anomalie non bloquante, par une personne autre que le responsable."""
    if entree.severite is Severite.BLOQUANTE:
        raise ValueError("une anomalie bloquante se corrige, elle ne s'approuve pas")
    if not justification.strip():
        raise ValueError("justification documentée obligatoire")
    if not approbateur.strip() or approbateur == entree.responsable:
        raise ValueError("l'approbateur doit être renseigné et distinct du responsable (quatre yeux)")
    return replace(
        entree, statut=Statut.ACCEPTEE, approbateur=approbateur, justification=justification, horodatage=maintenant
    )


def bloquants(journal: Sequence[EntreeJournal]) -> list[EntreeJournal]:
    """Anomalies qui empêchent la remise : bloquantes, ou majeures non acceptées."""
    return [e for e in journal if e.statut is Statut.OUVERTE and e.severite in (Severite.BLOQUANTE, Severite.MAJEURE)]
