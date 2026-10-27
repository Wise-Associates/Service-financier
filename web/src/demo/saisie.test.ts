import { describe, expect, it } from "vitest";

import { PARAMETRES_DEFAUT } from "./banqueFictive";
import { lireSaisie } from "./saisie";

describe("saisie des paramètres", () => {
  it("valeurs par défaut à la première visite", () => {
    const s = lireSaisie({});
    expect(s.erreurs).toEqual([]);
    expect(s.parametres).toEqual(PARAMETRES_DEFAUT);
    expect(s.affichage).toEqual({ fondsPropresT1: "1200", seuilSotEve: "15", seuilSotNii: "5", poidsGains: "50" });
  });

  it("saisie à la française et pourcentages", () => {
    const s = lireSaisie({
      fondsPropresT1: "1 500,5",
      seuilSotEve: "12,5",
      seuilSotNii: "4",
      poidsGains: "0",
      inclureMarge: "oui",
      calculer: "1",
    });
    expect(s.erreurs).toEqual([]);
    expect(s.parametres.fondsPropresT1).toBeCloseTo(1500.5, 12);
    expect(s.parametres.seuilSotEve).toBeCloseTo(0.125, 15);
    expect(s.parametres.seuilSotNii).toBeCloseTo(0.04, 15);
    expect(s.parametres.poidsGains).toBe(0);
    expect(s.parametres.inclureMarge).toBe(true);
  });

  it("case décochée au recalcul", () => {
    expect(lireSaisie({ calculer: "1" }).parametres.inclureMarge).toBe(false);
  });

  it.each(["abc", "NaN", "Infinity", "-5", "0", "1e12", "1e3", "0x10", "12,5,3"])(
    "fonds propres invalides refusés : %s",
    (v) => {
      const s = lireSaisie({ fondsPropresT1: v });
      expect(s.erreurs).toHaveLength(1);
      expect(s.erreurs[0]).toMatch(/^Fonds propres Tier 1/);
      expect(s.parametres).toEqual(PARAMETRES_DEFAUT);
      expect(s.affichage.fondsPropresT1).toBe(v);
    },
  );

  it.each(["seuilSotEve", "seuilSotNii", "poidsGains"])("pourcentage au-delà de 100 refusé : %s", (champ) => {
    expect(lireSaisie({ [champ]: "150" }).erreurs).toHaveLength(1);
  });

  it("saisie trop longue refusée et tronquée à l'affichage", () => {
    const s = lireSaisie({ fondsPropresT1: "1".repeat(500) });
    expect(s.erreurs).toHaveLength(1);
    expect(s.affichage.fondsPropresT1).toHaveLength(32);
  });

  it("paramètre répété : seule la première valeur compte", () => {
    expect(lireSaisie({ seuilSotEve: ["20", "abc"] }).parametres.seuilSotEve).toBeCloseTo(0.2, 15);
  });
});
