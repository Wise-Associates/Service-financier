import { describe, expect, it } from "vitest";

import { CourbeDecalee, CourbeZero, bootstrapSwaps, convertirTaux } from "./courbes";
import { courbePlate, marchePente, procheRel } from "./fixtures-tests";

describe("courbes", () => {
  it("facteur d'actualisation d'une courbe plate = exponentielle", () => {
    for (const t of [0.5, 1, 7.3]) expect(Math.abs(courbePlate().facteurActualisation(t) - Math.exp(-0.03 * t))).toBeLessThan(1e-15);
  });

  it("conversion de capitalisation : valeur connue et aller-retour", () => {
    // 5 % annuel = ln(1,05) en continu, quelle que soit la maturité
    expect(convertirTaux(0.05, 3, "annuelle", "continue")).toBeCloseTo(Math.log(1.05), 15);
    const r = convertirTaux(convertirTaux(0.04, 0.5, "simple", "annuelle"), 0.5, "annuelle", "simple");
    expect(r).toBeCloseTo(0.04, 14);
  });

  it("courbe saisie en annuel : même facteur d'actualisation", () => {
    const c = new CourbeZero([1, 10], [0.02, 0.03], "annuelle");
    expect(procheRel(c.facteurActualisation(10), 1.03 ** -10, 1e-14)).toBe(true);
  });

  it("forward cohérent avec les facteurs", () => {
    const c = marchePente().actualisation;
    const f = c.forward(2, 3);
    expect(procheRel((1 + f) * c.facteurActualisation(3), c.facteurActualisation(2), 1e-14)).toBe(true);
  });

  it("forward instantané intégré redonne le facteur d'actualisation", () => {
    const c = marchePente().actualisation;
    const n = 7001;
    const u = Array.from({ length: n }, (_, i) => (7 * i) / (n - 1));
    const f = u.map((t) => c.forwardInstantane(t));
    let integrale = 0;
    for (let i = 1; i < n; i++) integrale += ((f[i]! + f[i - 1]!) / 2) * (u[i]! - u[i - 1]!);
    expect(procheRel(Math.exp(-integrale), c.facteurActualisation(7), 1e-6)).toBe(true);
  });

  it("bootstrap : reprice les swaps par", () => {
    const par = [0.02, 0.023, 0.025, 0.027, 0.028];
    const c = bootstrapSwaps([1, 2, 3, 4, 5], par);
    par.forEach((s, i) => {
      const df = Array.from({ length: i + 1 }, (_, k) => c.facteurActualisation(k + 1));
      // jambe fixe + nominal final = 1 pour un swap par
      expect(s * df.reduce((a, b) => a + b, 0) + df[i]!).toBeCloseTo(1, 14);
    });
  });

  it("bootstrap : refuse des maturités non consécutives", () => {
    expect(() => bootstrapSwaps([1, 2, 5], [0.02, 0.02, 0.02])).toThrow();
  });

  it("plancher : le taux observé sert de plancher s'il est plus bas", () => {
    const base = new CourbeZero([1, 10], [-0.02, 0.01]);
    const choquee = new CourbeDecalee(base, () => -0.02, () => -0.015);
    expect(choquee.tauxZero(1)).toBeCloseTo(-0.02, 15); // observé −2 % < plancher −1,5 %
    expect(choquee.tauxZero(10)).toBeCloseTo(-0.01, 15); // 1 % − 2 % = −1 % > plancher
  });

  it("refuse des maturités non croissantes", () => {
    expect(() => new CourbeZero([2, 1], [0.01, 0.02])).toThrow();
  });
});
