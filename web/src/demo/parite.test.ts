/**
 * Non-régression contre les résultats figés de l'ancien moteur Python (ADR 0005).
 *
 * `reference-python.json` a été produit par le moteur Python (numpy) dont ce moteur est le portage,
 * avant son retrait (dernière version : commit a531f7b). Il n'est plus régénéré. Écart toléré :
 * 1e-9 en relatif (ordre des sommes, exp/log de la plateforme), bien en dessous de la précision
 * affichée (0,1 M). Une modification volontaire de formule qui déplace ces valeurs met à jour les
 * valeurs concernées et justifie l'écart dans le commit.
 */

import { describe, expect, it } from "vitest";

import { estimerTransmission } from "@/moteur/comportemental";
import { CourbeZero } from "@/moteur/courbes";
import { calculerDeltaEve, calculerDeltaNii } from "@/moteur/mesures";
import { CapFloor } from "@/moteur/options";
import { Instrument, type Position } from "@/moteur/positions";
import { CHOCS_BALE, MarcheDevise } from "@/moteur/scenarios";

import { type Resultats, executer } from "./banqueFictive";
import reference from "./reference-python.json";

const TOLERANCE_REL = 1e-9;

function proche(obtenu: number, attendu: number, chemin: string): void {
  const ecart = Math.abs(obtenu - attendu);
  const tol = TOLERANCE_REL * Math.max(1, Math.abs(attendu));
  if (!(ecart <= tol)) throw new Error(`${chemin} : obtenu ${obtenu}, attendu ${attendu} (écart ${ecart})`);
}

function comparerDict(
  obtenu: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
  attendu: Readonly<Record<string, number>>,
  chemin: string,
): void {
  const o = obtenu instanceof Map ? obtenu : new Map(Object.entries(obtenu));
  // Même ordre que la référence (ordre d'insertion), pas seulement mêmes clés.
  expect([...o.keys()], chemin).toEqual(Object.keys(attendu));
  for (const [k, v] of Object.entries(attendu)) proche(o.get(k)!, v, `${chemin}/${k}`);
}

describe.each(Object.entries(reference.demo))("référence figée du moteur Python (%s)", (_, ref) => {
  const r = executer(ref.parametres, "2026-10-27T09:00:00") as Resultats;

  it("le calcul n'est pas bloqué", () => {
    expect(r.statut).toBe("calcule");
  });

  it("EVE par position, en base et sous les six chocs", () => {
    comparerDict(r.eve.base, ref.eve.base, "eve/base");
    expect(r.eve.listeScenarios).toEqual(Object.keys(ref.eve.scenarios));
    for (const [s, v] of Object.entries(ref.eve.scenarios)) comparerDict(r.eve.scenarios.get(s)!, v, `eve/${s}`);
  });

  it("NII par position, en base et sous les deux chocs parallèles", () => {
    comparerDict(r.nii.base, ref.nii.base, "nii/base");
    for (const [s, v] of Object.entries(ref.nii.scenarios)) comparerDict(r.nii.scenarios.get(s)!, v, `nii/${s}`);
  });

  it("ΔEVE standardisé par scénario et par devise", () => {
    for (const [s, v] of Object.entries(ref.standardise)) {
      comparerDict(r.std.deltaParScenarioDevise[s]!, v, `std/${s}`);
    }
  });

  it("test des valeurs aberrantes", () => {
    for (const [cle, sot] of [
      ["eve", r.sotEve],
      ["nii", r.sotNii],
    ] as const) {
      const attendu = ref.sot[cle];
      expect(sot.scenario).toBe(attendu.scenario);
      expect(sot.depassement).toBe(attendu.depassement);
      proche(sot.perte, attendu.perte, `sot/${cle}/perte`);
      proche(sot.ratio, attendu.ratio, `sot/${cle}/ratio`);
    }
  });

  it("sensibilités et gaps", () => {
    proche(r.sens.pv01Eur, ref.sensibilites.pv01Eur, "pv01Eur");
    proche(r.sens.pv01Usd, ref.sensibilites.pv01Usd, "pv01Usd");
    proche(r.sens.baseEuribor, ref.sensibilites.baseEuribor, "baseEuribor");
    expect(r.sens.krdEur.map((k) => k.pilier)).toEqual(ref.sensibilites.krdEur.map(([p]) => p));
    r.sens.krdEur.forEach((k, i) => proche(k.valeur, ref.sensibilites.krdEur[i]![1]!, `krd/${k.pilier}`));
    r.gaps.gaps.forEach((g, i) => proche(g, ref.gaps[i]!, `gaps/${i}`));
  });

  it("mêmes contrôles, sévérités et statuts", () => {
    const obtenus = [...new Set(r.journal.map((e) => JSON.stringify([e.idRegle, e.severite, e.statut])))].sort();
    expect(obtenus).toEqual(ref.controles.map((c) => JSON.stringify(c)).sort());
  });
});

/** Chemins que la banque fictive n'emprunte pas : mêmes entrées que `cas_unitaires` dans reference_web.py. */
describe("référence figée du moteur Python (cas unitaires)", () => {
  const ref = reference.unitaires;
  const annuelle = new CourbeZero([1, 5, 10], [0.02, 0.025, 0.03], "annuelle");
  const simple = new CourbeZero([0.5, 2], [0.03, 0.032], "simple");
  const pente = new CourbeZero([0.25, 1, 5, 10, 30], [0.021, 0.023, 0.027, 0.03, 0.031]);
  const marche = new MarcheDevise("EUR", pente, { EURIBOR3M: new CourbeZero([0.25, 30], [0.022, 0.033]) });
  const negatif = new MarcheDevise("EUR", new CourbeZero([1, 10], [-0.008, 0.004]));
  const positions: Position[] = [
    new Instrument({
      identifiant: "VAR-LIN",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 100,
      taux: 0.026,
      maturite: 6,
      frequence: 4,
      amortissement: "lineaire",
      index: "EURIBOR3M",
      marge: 0.004,
    }),
    new Instrument({
      identifiant: "FIXE-0",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 100,
      taux: 0.031,
      maturite: 2.5,
      frequence: 2,
      amortissement: "annuite",
      dureeRenouvellement: 0,
    }),
    new CapFloor({
      identifiant: "CAP-BLACK",
      devise: "EUR",
      sens: 1,
      notionnel: 100,
      strike: 0.028,
      maturite: 5,
      frequence: 4,
      vol: 0.22,
      modele: "black",
      cp: 1,
      index: "EURIBOR3M",
    }),
    new CapFloor({
      identifiant: "FLOOR-BACH",
      devise: "EUR",
      sens: -1,
      notionnel: 100,
      strike: 0.02,
      maturite: 5,
      frequence: 4,
      vol: 0.007,
      modele: "bachelier",
      cp: -1,
      index: "EURIBOR3M",
    }),
  ];

  it("capitalisations annuelle et simple", () => {
    [0.5, 3, 12].forEach((t, i) => proche(annuelle.facteurActualisation(t), ref.dfAnnuelle[i]!, `annuelle/${t}`));
    [0.25, 1, 3].forEach((t, i) => proche(simple.facteurActualisation(t), ref.dfSimple[i]!, `simple/${t}`));
  });

  it("ΔEVE : variable amorti avec index, annuité, cap Black, floor Bachelier", () => {
    const eve = calculerDeltaEve(positions, { EUR: marche }, CHOCS_BALE, { inclureMarge: false });
    for (const [s, v] of Object.entries(ref.eve)) comparerDict(eve.decomposition(s, "position"), v, `eve/${s}`);
  });

  it("ΔNII : variable amorti avec index, renouvellement de durée nulle", () => {
    const nii = calculerDeltaNii(positions.slice(0, 2), { EUR: marche }, CHOCS_BALE);
    for (const [s, v] of Object.entries(ref.nii)) comparerDict(nii.decomposition(s, "position"), v, `nii/${s}`);
  });

  it("plancher post-choc sur des taux négatifs", () => {
    const zc = new Instrument({ identifiant: "ZC", categorie: "titre", devise: "EUR", sens: 1, encours: 100, taux: 0, maturite: 3 });
    const eve = calculerDeltaEve([zc], { EUR: negatif }, CHOCS_BALE, { inclureMarge: true });
    for (const [s, v] of Object.entries(ref.eveTauxNegatifs)) proche(eve.delta(s), v, `negatif/${s}`);
  });

  it("estimation de la transmission des dépôts", () => {
    const x = Array.from({ length: 48 }, (_, i) => 0.002 * Math.sin(0.37 * i) + 0.001 * Math.cos(1.3 * i));
    const y = x.map((v, i) => 0.0001 + 0.3 * v + 0.15 * x[(i + 47) % 48]! + 0.00005 * Math.sin(2.1 * i));
    const t = estimerTransmission(y.slice(1), x.slice(1), 1);
    [t.alpha, ...t.betas, t.r2].forEach((v, i) => proche(v, ref.transmission[i]!, `transmission/${i}`));
  });
});
