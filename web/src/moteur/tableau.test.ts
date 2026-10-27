import { describe, expect, it } from "vitest";

import { arrondiBancaire, erf, indiceInsertion, interp, moindresCarres } from "./tableau";

describe("outils numériques", () => {
  it("interp : linéaire entre piliers, plate au-delà", () => {
    expect(interp(1.5, [1, 2], [10, 20])).toBe(15);
    expect(interp(0, [1, 2], [10, 20])).toBe(10);
    expect(interp(3, [1, 2], [10, 20])).toBe(20);
  });

  it("indiceInsertion : côtés gauche et droit comme numpy.searchsorted", () => {
    expect(indiceInsertion([1, 2, 2, 3], 2, "gauche")).toBe(1);
    expect(indiceInsertion([1, 2, 2, 3], 2, "droite")).toBe(3);
  });

  it("arrondi bancaire comme round en Python", () => {
    expect([0.5, 1.5, 2.5, -0.5, 2.4, 2.6].map(arrondiBancaire)).toEqual([0, 2, 2, -0, 2, 3]);
  });

  it("erf : valeurs tabulées (Abramowitz et Stegun)", () => {
    expect(erf(0)).toBe(0);
    expect(erf(0.5)).toBeCloseTo(0.5204998778130465, 15);
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 15);
    expect(erf(2.4)).toBeCloseTo(0.9993114861033549, 14);
    expect(erf(3)).toBeCloseTo(0.9999779095030014, 15);
    expect(erf(-1)).toBeCloseTo(-0.8427007929497149, 15);
  });

  it("moindres carrés : régression exacte retrouvée", () => {
    const X = [0, 1, 2, 3, 4].map((x) => [1, x]);
    const y = [0, 1, 2, 3, 4].map((x) => 2 + 3 * x);
    const [a, b] = moindresCarres(X, y);
    expect(a).toBeCloseTo(2, 12);
    expect(b).toBeCloseTo(3, 12);
  });
});
