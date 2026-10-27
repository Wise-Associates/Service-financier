import { describe, expect, it } from "vitest";

import { marchePlat, procheRel } from "./fixtures-tests";
import { valeurActualisee } from "./mesures";
import { CapFloor, type CaracteristiquesCapFloor, bachelier, black76 } from "./options";

/** Seconde méthode : intégration du payoff contre la densité normale (trapèzes, z ∈ [−12 ; 12]). */
function esperanceNumerique(payoff: (z: number) => number): number {
  const n = 200_001;
  let s = 0;
  let precedent = 0;
  for (let i = 0; i < n; i++) {
    const z = -12 + (24 * i) / (n - 1);
    const y = payoff(z) * (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI));
    if (i > 0) s += ((y + precedent) / 2) * (24 / (n - 1));
    precedent = y;
  }
  return s;
}

describe("options", () => {
  it.each([1, -1])("Black contre intégration numérique (cp=%i)", (cp) => {
    const [F, K, T, s, df] = [0.07, 0.08, 1, 0.2, 0.92];
    const attendu =
      df * esperanceNumerique((z) => Math.max(cp * (F * Math.exp(s * Math.sqrt(T) * z - 0.5 * s * s * T) - K), 0));
    expect(procheRel(black76(F, K, T, s, df, cp), attendu, 1e-8)).toBe(true);
  });

  it.each([1, -1])("Bachelier contre intégration numérique (cp=%i)", (cp) => {
    const [F, K, T, s] = [-0.002, 0.001, 3, 0.007];
    const attendu = esperanceNumerique((z) => Math.max(cp * (F + s * Math.sqrt(T) * z - K), 0));
    expect(procheRel(bachelier(F, K, T, s, 1, cp), attendu, 1e-8)).toBe(true);
  });

  it.each([
    ["black76", black76, 0.25],
    ["bachelier", bachelier, 0.008],
  ] as const)("parité call − put (%s)", (_, formule, vol) => {
    const [F, K, T, df] = [0.031, 0.027, 2.5, 0.93];
    expect(Math.abs(formule(F, K, T, vol, df, 1) - formule(F, K, T, vol, df, -1) - df * (F - K))).toBeLessThan(1e-15);
  });

  it("Bachelier à la monnaie : formule fermée", () => {
    expect(procheRel(bachelier(0.01, 0.01, 4, 0.006), (0.006 * 2) / Math.sqrt(2 * Math.PI), 1e-14)).toBe(true);
  });

  it("Bachelier accepte les taux négatifs, Black non", () => {
    expect(bachelier(-0.005, -0.002, 1, 0.005, 1, -1)).toBeGreaterThan(0);
    expect(() => black76(-0.005, 0.01, 1, 0.2)).toThrow();
  });

  it("Black et Bachelier concordent à petite volatilité", () => {
    const [F, T, s] = [0.03, 1, 0.05];
    expect(procheRel(black76(F, F, T, s), bachelier(F, F, T, F * s), 1e-3)).toBe(true);
  });

  it("cap − floor = swap", () => {
    const m = marchePlat();
    const args: Omit<CaracteristiquesCapFloor, "identifiant" | "cp"> = {
      devise: "EUR",
      sens: 1,
      notionnel: 100,
      strike: 0.025,
      maturite: 5,
      frequence: 4,
      vol: 0.007,
      index: "EURIBOR3M",
    };
    const cap = new CapFloor({ identifiant: "cap", cp: 1, ...args });
    const floor = new CapFloor({ identifiant: "floor", cp: -1, ...args });
    const c = m.actualisation;
    let swap = 0;
    for (let k = 2; k <= 20; k++) {
      const b = 0.25 * k;
      swap += 100 * 0.25 * c.facteurActualisation(b) * (c.forward(b - 0.25, b) - 0.025);
    }
    expect(procheRel(cap.prix(m) - floor.prix(m), swap, 1e-12)).toBe(true);
  });

  it("les flux équivalents redonnent le prix et le signe", () => {
    const m = marchePlat();
    const vendu = new CapFloor({
      identifiant: "cap",
      devise: "EUR",
      sens: -1,
      notionnel: 100,
      strike: 0.035,
      maturite: 5,
      frequence: 4,
      vol: 0.2,
      modele: "black",
      index: "EURIBOR3M",
    });
    expect(vendu.prix(m)).toBeLessThan(0);
    expect(procheRel(valeurActualisee(vendu, m, m, true), vendu.prix(m), 1e-13)).toBe(true);
  });
});
