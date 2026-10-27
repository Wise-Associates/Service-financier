import { describe, expect, it } from "vitest";

import { marchePlat, procheRel } from "./fixtures-tests";
import { calculerDeltaEve } from "./mesures";
import { Instrument } from "./positions";
import { CHOCS_BALE, SCENARIOS_EVE } from "./scenarios";
import {
  MILIEUX_BALE,
  agregerDevises,
  calculerDeltaEveStandardise,
  controleValeursAberrantes,
  repartirFlux,
} from "./standardise";

describe("approche standardisée", () => {
  it("19 tranches et affectation aux bornes", () => {
    expect(MILIEUX_BALE).toHaveLength(19);
    const r = repartirFlux([1 / 365, 1, 1.0000001, 30], [1, 2, 4, 8]);
    expect([r[0], r[5], r[6], r[18]]).toEqual([1, 2, 4, 8]);
  });

  it("flux au point milieu = revalorisation complète", () => {
    const m = { EUR: marchePlat() };
    const zc = new Instrument({ identifiant: "zc", categorie: "titre", devise: "EUR", sens: 1, encours: 100, taux: 0, maturite: 4.5 });
    const std = calculerDeltaEveStandardise([zc], m, CHOCS_BALE, { inclureMarge: true, poidsGains: 0.5 });
    const complet = calculerDeltaEve([zc], m, CHOCS_BALE, { inclureMarge: true });
    for (const s of SCENARIOS_EVE) {
      expect(procheRel(std.deltaParScenarioDevise[s]!["EUR"]!, complet.delta(s), 1e-12)).toBe(true);
    }
  });

  it("taux variable : reprice à la prochaine révision", () => {
    const frn = new Instrument({
      identifiant: "frn",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 100,
      taux: 0.03,
      maturite: 10,
      frequence: 4,
      index: "EURIBOR3M",
    });
    const std = calculerDeltaEveStandardise([frn], { EUR: marchePlat() }, CHOCS_BALE, { inclureMarge: true, poidsGains: 0.5 });
    // 100,75 versés à 3 mois : tranche ]1 ; 3 mois], actualisés à son milieu 0,1667 an
    const attendu = 100.75 * (Math.exp(-0.05 * 0.1667) - Math.exp(-0.03 * 0.1667));
    expect(procheRel(std.deltaParScenarioDevise["hausse_parallele"]!["EUR"]!, attendu, 1e-12)).toBe(true);
  });

  it("l'agrégation des devises pondère les gains", () => {
    expect(agregerDevises({ EUR: -10, USD: 4 }, 0.5)).toBeCloseTo(-8, 14);
    expect(agregerDevises({ EUR: -10, USD: 4 }, 0)).toBeCloseTo(-10, 14);
    expect(() => agregerDevises({ EUR: 1 }, 1.5)).toThrow();
  });

  it("la mesure de risque n'est jamais négative", () => {
    const depot = new Instrument({ identifiant: "dat", categorie: "depot_terme", devise: "EUR", sens: -1, encours: 100, taux: 0, maturite: 5 });
    const std = calculerDeltaEveStandardise([depot], { EUR: marchePlat() }, CHOCS_BALE, { inclureMarge: true, poidsGains: 0.5 });
    const { scenario, perte } = std.mesureRisque();
    expect(scenario).toBe("baisse_parallele");
    expect(perte).toBeGreaterThan(0);
  });

  it("SOT : seuil de 15 %", () => {
    const res = controleValeursAberrantes({ hausse_parallele: -20, baisse_parallele: 5 }, 100, 0.15, "ΔEVE");
    expect(res.scenario).toBe("hausse_parallele");
    expect(res.ratio).toBeCloseTo(0.2, 15);
    expect(res.depassement).toBe(true);
    const gains = controleValeursAberrantes({ a: 1, b: 2 }, 100, 0.15, "ΔEVE");
    expect(gains.perte).toBe(0);
    expect(gains.depassement).toBe(false);
    expect(() => controleValeursAberrantes({ a: -1 }, 0, 0.15, "ΔEVE")).toThrow();
  });
});
