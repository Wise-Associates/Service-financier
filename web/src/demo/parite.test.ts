/**
 * Parité avec le moteur Python de référence sur la banque fictive.
 *
 * `reference-python.json` est produit par `python exemples/reference_web.py` ; un test Python
 * vérifie qu'il reste à jour. Écart toléré : 1e-9 en relatif (ordre des sommes, exp/log de la
 * plateforme), bien en dessous de la précision affichée (0,1 M).
 */

import { describe, expect, it } from "vitest";

import { type Resultats, executer } from "./banqueFictive";
import reference from "./reference-python.json";

const TOLERANCE_REL = 1e-9;

function proche(obtenu: number, attendu: number, chemin: string): void {
  const ecart = Math.abs(obtenu - attendu);
  const tol = TOLERANCE_REL * Math.max(1, Math.abs(attendu));
  if (!(ecart <= tol)) throw new Error(`${chemin} : obtenu ${obtenu}, attendu ${attendu} (écart ${ecart})`);
}

function comparerDict(
  obtenu: Readonly<Record<string, number>>,
  attendu: Readonly<Record<string, number>>,
  chemin: string,
): void {
  expect(Object.keys(obtenu).sort(), chemin).toEqual(Object.keys(attendu).sort());
  for (const [k, v] of Object.entries(attendu)) proche(obtenu[k]!, v, `${chemin}/${k}`);
}

describe.each(Object.entries(reference))("parité avec le moteur Python (%s)", (_, ref) => {
  const r = executer(ref.parametres, "2026-10-27T09:00:00") as Resultats;

  it("le calcul n'est pas bloqué", () => {
    expect(r.statut).toBe("calcule");
  });

  it("EVE par position, en base et sous les six chocs", () => {
    comparerDict(r.eve.base, ref.eve.base, "eve/base");
    expect(r.eve.listeScenarios).toEqual(Object.keys(ref.eve.scenarios));
    for (const [s, v] of Object.entries(ref.eve.scenarios)) comparerDict(r.eve.scenarios[s]!, v, `eve/${s}`);
  });

  it("NII par position, en base et sous les deux chocs parallèles", () => {
    comparerDict(r.nii.base, ref.nii.base, "nii/base");
    for (const [s, v] of Object.entries(ref.nii.scenarios)) comparerDict(r.nii.scenarios[s]!, v, `nii/${s}`);
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
