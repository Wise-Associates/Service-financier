"""Interface web locale de la démonstration sur la banque FICTIVE.

Permet à un utilisateur non développeur de lancer le calcul de `demo_banque_fictive.py` avec ses
propres paramètres (fonds propres T1, seuils SOT, marges, pondération des gains) et de lire ΔEVE,
ΔNII, le test des valeurs aberrantes et le statut des contrôles C01 à C09.

Choix techniques (ADR 0003) : bibliothèque standard uniquement (`http.server`), pages HTML rendues
côté serveur, aucun JavaScript. Le serveur n'écoute que sur 127.0.0.1 : c'est un outil de poste de
travail, pas un service à exposer. Aucune formule ici : tout le calcul vient de `irrbb` via `executer`.

Usage : python exemples/interface_web.py [--port 8000]   puis ouvrir http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import math
import sys
import traceback
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from demo_banque_fictive import CalculBloque, Parametres, Resultats, executer

from irrbb.controles import EntreeJournal, Severite, Statut, bloquants
from irrbb.mesures import ResultatMesure

HOTE = "127.0.0.1"
FEUILLE_DE_STYLE = Path(__file__).with_name("interface_web.css")

LIBELLES_SCENARIOS = {
    "hausse_parallele": "Hausse parallèle",
    "baisse_parallele": "Baisse parallèle",
    "pentification": "Pentification",
    "aplatissement": "Aplatissement",
    "hausse_taux_courts": "Hausse des taux courts",
    "baisse_taux_courts": "Baisse des taux courts",
}

# Libellés du PDF de cadrage (p. 3 à 8).
LIBELLES_CONTROLES = {
    "C01": "Complétude, qualité et doublons des données source",
    "C02": "Périmètre : toute position source est calculée",
    "C03": "Reproductibilité (empreinte des entrées)",
    "C04": "Rapprochement des encours avec les sources",
    "C05": "Conservation des flux",
    "C06": "Hypothèses comportementales en vigueur",
    "C07": "Variation par rapport à l'arrêté précédent",
    "C08": "Signes et cohérence des agrégats",
    "C09": "Approbation à quatre yeux",
}

ORDRE_SEVERITE = [Severite.BLOQUANTE, Severite.MAJEURE, Severite.AVERTISSEMENT, Severite.INFORMATION]

ENTETES_SECURITE = {
    # Aucun script, aucune ressource externe : la page ne charge que sa feuille de style.
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; "
        "base-uri 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


@dataclass(frozen=True)
class Champ:
    """Champ numérique du formulaire, saisi en unité « métier » (pourcentages en %)."""

    nom: str
    libelle: str
    aide: str
    minimum: float
    maximum: float
    echelle: float  # valeur du paramètre = saisie × échelle


CHAMPS = (
    Champ("fonds_propres_t1", "Fonds propres Tier 1 (M€)", "Montant fictif de la démonstration.", 1.0, 1e9, 1.0),
    Champ(
        "seuil_sot_eve",
        "Seuil SOT ΔEVE (% du Tier 1)",
        "15 % selon le RTS UE 2024/856, à confirmer.",
        0.1,
        100.0,
        0.01,
    ),
    Champ(
        "seuil_sot_nii",
        "Seuil SOT ΔNII (% du Tier 1)",
        "5 % selon le RTS UE 2024/856, à confirmer.",
        0.1,
        100.0,
        0.01,
    ),
    Champ(
        "poids_gains",
        "Pondération des gains entre devises (%)",
        "50 % selon BCBS d368, à confirmer.",
        0.0,
        100.0,
        0.01,
    ),
)


def lire_parametres(requete: Mapping[str, Sequence[str]]) -> tuple[Parametres, list[str]]:
    """Valide la saisie ; renvoie les paramètres retenus et les erreurs à afficher.

    Un champ absent prend la valeur par défaut. Un champ invalide est refusé (pas de calcul) : on ne
    corrige jamais une saisie en silence.
    """
    defaut = Parametres()
    valeurs: dict[str, float] = {}
    erreurs: list[str] = []
    for c in CHAMPS:
        brut = requete.get(c.nom, [""])[0].strip().replace(" ", "").replace(" ", "").replace(",", ".")
        if brut == "":
            valeurs[c.nom] = getattr(defaut, c.nom)
            continue
        try:
            saisie = float(brut)
        except ValueError:
            erreurs.append(f"{c.libelle} : « {brut} » n'est pas un nombre.")
            continue
        if not math.isfinite(saisie) or not c.minimum <= saisie <= c.maximum:
            erreurs.append(f"{c.libelle} : saisissez une valeur entre {borne(c.minimum)} et {borne(c.maximum)}.")
            continue
        valeurs[c.nom] = saisie * c.echelle
    if erreurs:
        return defaut, erreurs
    # Une case à cocher décochée n'est pas envoyée : on distingue « formulaire soumis » de « première visite ».
    soumis = "calculer" in requete
    inclure_marge = requete.get("inclure_marge", [""])[0] == "oui" if soumis else defaut.inclure_marge
    return Parametres(inclure_marge=inclure_marge, **valeurs), []


def nombre(x: float, decimales: int = 1) -> str:
    """Format français : espace fine insécable pour les milliers, virgule décimale."""
    return f"{x:,.{decimales}f}".replace(",", " ").replace(".", ",")


def borne(x: float) -> str:
    return nombre(x, 0 if x.is_integer() else 1)


def pourcentage(x: float, decimales: int = 1) -> str:
    return f"{nombre(x * 100, decimales)} %"


def montant(x: float) -> str:
    classe = "perte" if x < 0 else "gain" if x > 0 else ""
    signe = "+" if x > 0 else "−" if x < 0 else ""
    return f'<span class="{classe}">{signe}{nombre(abs(x))}</span>'


def barre(x: float, echelle: float) -> str:
    """Barre divergente autour de zéro : à gauche une perte, à droite un gain."""
    if echelle <= 0:
        return ""
    largeur = 50 * min(abs(x) / echelle, 1.0)
    debut = 50 - largeur if x < 0 else 50
    classe = "barre-perte" if x < 0 else "barre-gain"
    return (
        '<svg class="barre" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">'
        f'<rect class="{classe}" x="{debut:.2f}" y="1" width="{largeur:.2f}" height="8"/>'
        '<line class="axe" x1="50" y1="0" x2="50" y2="10"/></svg>'
    )


def tableau_mesure(titre: str, intro: str, deltas: dict[str, dict[str, float]], devises: list[str]) -> str:
    """Tableau scénario × devise ; `deltas[scénario]` contient les devises et la clé « Total »."""
    echelle = max((abs(d["Total"]) for d in deltas.values()), default=0.0)
    entetes = "".join(f'<th scope="col" class="num">{d}</th>' for d in devises)
    lignes = []
    for s, d in deltas.items():
        cellules = "".join(f'<td class="num">{montant(d.get(dev, 0.0))}</td>' for dev in devises)
        lignes.append(
            f'<tr><th scope="row">{escape(LIBELLES_SCENARIOS.get(s, s))}</th>{cellules}'
            f'<td class="num total">{montant(d["Total"])}</td>'
            f'<td class="col-barre">{barre(d["Total"], echelle)}</td></tr>'
        )
    return (
        f'<section><h2>{titre}</h2><p class="intro">{intro}</p>'
        '<div class="defilement"><table><thead><tr><th scope="col">Scénario</th>'
        f'{entetes}<th scope="col" class="num">Total</th><th scope="col"><span class="sr">Graphique</span></th>'
        f"</tr></thead><tbody>{''.join(lignes)}</tbody></table></div></section>"
    )


def statut_controles(journal: Sequence[EntreeJournal], trace: str) -> list[tuple[str, str, str, str]]:
    """(code, libellé, statut, classe CSS) pour C01 à C09, à partir du journal."""
    par_code: dict[str, list[EntreeJournal]] = {}
    for e in journal:
        par_code.setdefault(e.id_regle[:3], []).append(e)
    lignes = []
    for code, libelle in LIBELLES_CONTROLES.items():
        entrees = par_code.get(code, [])
        anomalies = [e for e in entrees if e.severite is not Severite.INFORMATION]
        if code == "C03":
            statut, classe = f"Empreinte {trace[:16]}", "info"
        elif code == "C09":
            acceptees = [e for e in journal if e.statut is Statut.ACCEPTEE]
            if acceptees:
                qui = ", ".join(sorted({e.approbateur for e in acceptees}))
                statut, classe = f"{len(acceptees)} anomalie(s) acceptée(s) par {qui}", "ok"
            else:
                statut, classe = "Aucune anomalie à approuver", "ok"
        elif not entrees:
            statut, classe = "Non exécuté dans cette démonstration", "info"
        elif not anomalies:
            statut, classe = "Conforme", "ok"
        else:
            pire = min(anomalies, key=lambda e: ORDRE_SEVERITE.index(e.severite))
            ouvertes = [e for e in anomalies if e.statut is Statut.OUVERTE]
            etat = f"{len(ouvertes)} ouverte(s)" if ouvertes else "acceptée(s)"
            statut = f"{pire.severite.value} : {len(anomalies)} anomalie(s), {etat}"
            classe = "ko" if ouvertes or pire.severite is Severite.BLOQUANTE else "attention"
        lignes.append((code, libelle, statut, classe))
    return lignes


def section_controles(journal: Sequence[EntreeJournal], trace: str) -> str:
    lignes = "".join(
        f'<tr><th scope="row">{code}</th><td>{escape(lib)}</td>'
        f'<td><span class="pastille {classe}">{escape(statut)}</span></td></tr>'
        for code, lib, statut, classe in statut_controles(journal, trace)
    )
    detail = "".join(
        f"<tr><td>{escape(e.id_regle)}</td><td>{escape(e.objet)}</td><td>{escape(e.valeur_attendue)}</td>"
        f"<td>{escape(e.valeur_observee)}</td><td>{escape(e.severite.value)}</td><td>{escape(e.statut.value)}</td>"
        f"<td>{escape(e.justification)}</td></tr>"
        for e in journal
    )
    return (
        '<section><h2>Contrôles</h2><div class="defilement"><table><thead><tr><th scope="col">Code</th>'
        '<th scope="col">Contrôle</th><th scope="col">Statut</th></tr></thead>'
        f"<tbody>{lignes}</tbody></table></div>"
        f"<details><summary>Voir le journal complet ({len(journal)} entrées)</summary>"
        '<div class="defilement"><table class="journal"><thead><tr><th scope="col">Règle</th>'
        '<th scope="col">Objet</th><th scope="col">Attendu</th><th scope="col">Observé</th>'
        '<th scope="col">Sévérité</th><th scope="col">Statut</th><th scope="col">Justification</th></tr></thead>'
        f"<tbody>{detail}</tbody></table></div></details></section>"
    )


def section_synthese(r: Resultats) -> str:
    pire, perte = r.eve.perte_maximale()
    nb_bloquants = len(bloquants(r.journal))
    cartes = [
        (
            "Perte ΔEVE maximale",
            nombre(perte) + " M",
            escape(LIBELLES_SCENARIOS.get(pire, pire)),
            "",
        )
    ]
    for sot in (r.sot_eve, r.sot_nii):
        etat = "Dépassement du seuil" if sot.depassement else "Sous le seuil"
        cartes.append(
            (
                f"SOT {sot.indicateur}",
                pourcentage(sot.ratio),
                f"{etat} de {pourcentage(sot.seuil, 0)} · {escape(LIBELLES_SCENARIOS.get(sot.scenario, sot.scenario))}",
                "ko" if sot.depassement else "ok",
            )
        )
    cartes.append(
        (
            "Anomalies bloquantes",
            str(nb_bloquants),
            "La remise peut être préparée" if nb_bloquants == 0 else "La remise est bloquée",
            "ok" if nb_bloquants == 0 else "ko",
        )
    )
    html = "".join(
        f'<div class="carte {classe}"><p class="carte-titre">{escape(t)}</p>'
        f'<p class="carte-valeur">{v}</p><p class="carte-detail">{d}</p></div>'
        for t, v, d, classe in cartes
    )
    return f'<section aria-label="Synthèse"><div class="cartes">{html}</div></section>'


def section_resultats(r: Resultats) -> str:
    devises = sorted({d for s in r.eve.scenarios for d in r.eve.decomposition(s, "devise")})

    def par_devise(m: ResultatMesure) -> dict[str, dict[str, float]]:
        return {s: {**m.decomposition(s, "devise"), "Total": m.delta(s)} for s in m.scenarios}

    marges = "incluses" if r.versions["inclure_marge"] else "exclues"
    std = {
        s: {**r.std.delta_par_scenario_devise[s], "Total": r.std.delta_agrege(s)}
        for s in r.std.delta_par_scenario_devise
    }
    return (
        section_synthese(r)
        + tableau_mesure(
            "ΔEVE par choc",
            f"Revalorisation complète, marges commerciales {marges}. Δ = scénario − base : un Δ négatif est "
            f"une perte. EVE de base : {nombre(r.eve.total())} M.",
            par_devise(r.eve),
            devises,
        )
        + tableau_mesure(
            "ΔNII à 12 mois, bilan constant",
            f"NII de base : {nombre(r.nii.total())} M.",
            par_devise(r.nii),
            devises,
        )
        + tableau_mesure(
            "ΔEVE standardisé (test des valeurs aberrantes)",
            "Le total agrège les devises en pondérant les gains (voir le paramètre ci-dessus).",
            std,
            devises,
        )
        + section_controles(r.journal, r.trace)
    )


def section_formulaire(p: Parametres, saisie: Mapping[str, Sequence[str]]) -> str:
    """Réaffiche la saisie telle quelle (même refusée) pour que l'utilisateur la corrige ; sinon `p`."""
    valeurs = {c.nom: f"{getattr(p, c.nom) / c.echelle:g}".replace(".", ",") for c in CHAMPS}
    valeurs.update({c.nom: saisie[c.nom][0] for c in CHAMPS if c.nom in saisie})
    champs = "".join(
        f'<div class="champ"><label for="{c.nom}">{escape(c.libelle)}</label>'
        f'<input id="{c.nom}" name="{c.nom}" type="text" inputmode="decimal" '
        f'value="{escape(valeurs[c.nom])}" aria-describedby="{c.nom}-aide" required>'
        f'<p class="aide" id="{c.nom}-aide">{escape(c.aide)}</p></div>'
        for c in CHAMPS
    )
    marge = saisie.get("inclure_marge", [""])[0] == "oui" if "calculer" in saisie else p.inclure_marge
    coche = " checked" if marge else ""
    return (
        '<section><h2>Paramètres</h2><form method="get" action="/" class="formulaire">'
        f'<div class="champs">{champs}</div>'
        f'<div class="case"><input id="inclure_marge" name="inclure_marge" type="checkbox" value="oui"{coche}>'
        '<label for="inclure_marge">Inclure les marges commerciales dans ΔEVE</label></div>'
        '<div class="actions"><button type="submit" name="calculer" value="1">Recalculer</button>'
        '<a href="/">Revenir aux valeurs par défaut</a></div></form></section>'
    )


def page(
    p: Parametres,
    resultat: Resultats | CalculBloque | None,
    erreurs: Sequence[str],
    saisie: Mapping[str, Sequence[str]],
) -> str:
    """Page complète. `resultat` vaut None quand la saisie ou le calcul est refusé."""
    if erreurs:
        items = "".join(f"<li>{escape(e)}</li>" for e in erreurs)
        corps = (
            '<div class="alerte" role="alert"><p><strong>Le calcul n\'a pas été lancé.</strong> '
            f"Vérifiez les points suivants :</p><ul>{items}</ul></div>"
        )
    elif isinstance(resultat, CalculBloque):
        corps = (
            '<div class="alerte" role="alert"><p><strong>Le calcul est bloqué par une anomalie '
            "d'import.</strong> Consultez le journal ci-dessous.</p></div>" + section_controles(resultat.journal, "")
        )
    elif resultat is not None:
        corps = section_resultats(resultat)
    else:
        corps = ""
    entete_details = ""
    if isinstance(resultat, Resultats):
        v = resultat.versions
        entete_details = (
            f'<p class="meta">Arrêté {escape(str(v["arrete"]))} · moteur {escape(str(v["moteur"]))} · '
            "montants en millions de la devise</p>"
        )
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulation IRRBB</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="bandeau"><div class="conteneur">
<p class="badge">Données fictives</p>
<h1>Simulation IRRBB : banque fictive</h1>
{entete_details}
</div></header>
<main class="conteneur">
{section_formulaire(p, saisie)}
{corps}
</main>
<footer class="conteneur pied">
<p>Outil de démonstration. Les paramètres réglementaires sont à confirmer sur les textes en vigueur ;
les limites connues du moteur sont listées dans <code>docs/limites.md</code>.
Ne pas utiliser pour une remise réglementaire.</p>
</footer>
</body>
</html>
"""


class Gestionnaire(BaseHTTPRequestHandler):
    server_version = "irrbb-interface"
    sys_version = ""

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path == "/style.css":
            self._repondre(200, "text/css; charset=utf-8", FEUILLE_DE_STYLE.read_bytes())
            return
        if url.path != "/":
            self._repondre(404, "text/plain; charset=utf-8", b"Page introuvable.")
            return
        saisie = parse_qs(url.query)
        params, erreurs = lire_parametres(saisie)
        if erreurs:
            self._repondre(400, "text/html; charset=utf-8", page(params, None, erreurs, saisie).encode())
            return
        try:
            resultat = executer(params, datetime.now())
        except Exception as exc:
            # Le moteur refuse certaines combinaisons (ValueError) : on l'affiche et on garde la trace
            # complète dans la console pour le diagnostic.
            traceback.print_exc()
            message = f"Le moteur a refusé le calcul : {exc}"
            self._repondre(500, "text/html; charset=utf-8", page(params, None, [message], saisie).encode())
            return
        self._repondre(200, "text/html; charset=utf-8", page(params, resultat, [], saisie).encode())

    def _repondre(self, statut: int, type_contenu: str, corps: bytes) -> None:
        self.send_response(statut)
        self.send_header("Content-Type", type_contenu)
        self.send_header("Content-Length", str(len(corps)))
        for nom, valeur in ENTETES_SECURITE.items():
            self.send_header(nom, valeur)
        self.end_headers()
        self.wfile.write(corps)


def main() -> int:
    parser = argparse.ArgumentParser(description="Interface web locale de la démonstration IRRBB (données fictives).")
    parser.add_argument("--port", type=int, default=8000, help="port d'écoute sur 127.0.0.1 (8000 par défaut)")
    args = parser.parse_args()
    serveur = ThreadingHTTPServer((HOTE, args.port), Gestionnaire)
    print(f"Interface disponible sur http://{HOTE}:{args.port} (Ctrl+C pour arrêter)")
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt de l'interface.")
    finally:
        serveur.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
