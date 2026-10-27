import { describe, expect, it } from "vitest";

import { marchePente } from "./fixtures-tests";
import { CHOCS_BALE, SCENARIOS_EVE, choc, decalerMarche, marcheScenario, plancherEba } from "./scenarios";

const EUR = CHOCS_BALE["EUR"]!;

describe("scénarios", () => {
  it("formes des chocs aux limites", () => {
    expect(choc("hausse_taux_courts", EUR, 0)).toBeCloseTo(0.025, 15);
    expect(choc("hausse_taux_courts", EUR, 1e6)).toBeCloseTo(0, 15);
    expect(choc("pentification", EUR, 0)).toBeCloseTo(-0.65 * 0.025, 15);
    expect(choc("pentification", EUR, 1e6)).toBeCloseTo(0.9 * 0.01, 15);
    expect(choc("aplatissement", EUR, 0)).toBeCloseTo(0.8 * 0.025, 15);
    expect(choc("aplatissement", EUR, 1e6)).toBeCloseTo(-0.6 * 0.01, 15);
  });

  it("choc court à quatre ans : valeur fermée", () => {
    expect(choc("hausse_taux_courts", EUR, 4)).toBeCloseTo(0.025 * Math.exp(-1), 15);
  });

  it("six scénarios EVE et scénario inconnu refusé", () => {
    expect(SCENARIOS_EVE).toHaveLength(6);
    expect(() => choc("inconnu", EUR, 1)).toThrow();
  });

  it("plancher EBA", () => {
    expect(plancherEba(0)).toBeCloseTo(-0.015, 15);
    expect(plancherEba(10)).toBeCloseTo(-0.012, 15);
    expect(plancherEba(60)).toBe(0);
  });

  it("le scénario déplace aussi les courbes de projection", () => {
    const base = marchePente();
    const m = marcheScenario(base, "hausse_parallele", EUR);
    const ecart = m.projection["EURIBOR3M"]!.tauxZero(2) - base.projection["EURIBOR3M"]!.tauxZero(2);
    expect(ecart).toBeCloseTo(0.02, 15);
  });

  it("le choc de base ne bouge que l'index visé", () => {
    const base = marchePente();
    const m = decalerMarche(base, () => 0.001, null, "EURIBOR3M");
    expect(m.actualisation).toBe(base.actualisation);
    expect(m.projection["EURIBOR3M"]!.tauxZero(1)).toBeCloseTo(base.projection["EURIBOR3M"]!.tauxZero(1) + 0.001, 15);
  });
});
