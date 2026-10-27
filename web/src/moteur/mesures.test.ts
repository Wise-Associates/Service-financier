/** Flux, ΔEVE et ΔNII contre des formules fermées indépendantes du moteur. */

import { describe, expect, it } from "vitest";

import { R, marchePente, marchePlat, procheRel } from "./fixtures-tests";
import { calculerDeltaEve, calculerDeltaNii, valeurActualisee } from "./mesures";
import { type CaracteristiquesInstrument, Instrument, totalFlux } from "./positions";
import { CHOCS_BALE, MarcheDevise } from "./scenarios";

function obligation(c: Partial<CaracteristiquesInstrument> = {}): Instrument {
  return new Instrument({
    identifiant: "o",
    categorie: "titre",
    devise: "EUR",
    sens: 1,
    encours: 100,
    taux: 0.04,
    maturite: 5,
    ...c,
  });
}

describe("flux et mesures", () => {
  it("obligation in fine : formule fermée", () => {
    const m = marchePlat();
    const pv = valeurActualisee(obligation(), m, m, true);
    let attendu = 100 * Math.exp(-R * 5);
    for (let t = 1; t <= 5; t++) attendu += 4 * Math.exp(-R * t);
    expect(procheRel(pv, attendu, 1e-13)).toBe(true);
  });

  it("un taux variable vaut le pair à sa date de refixation", () => {
    // Identité : sans marge, actualisé sur sa courbe de projection, un FRN vaut le pair.
    const proj = marchePente().projection["EURIBOR3M"]!;
    const m = new MarcheDevise("EUR", proj, { EURIBOR3M: proj });
    const frn = obligation({ taux: proj.forward(0, 0.25), frequence: 4, index: "EURIBOR3M", maturite: 7 });
    expect(procheRel(valeurActualisee(frn, m, m, true), 100, 1e-12)).toBe(true);
  });

  it("annuité constante : formule fermée", () => {
    const p = obligation({ categorie: "pret", taux: 0.036, maturite: 20, frequence: 12, amortissement: "annuite" });
    const f = p.flux(marchePlat());
    const i = 0.036 / 12;
    const annuite = (100 * i) / (1 - (1 + i) ** -240);
    for (const v of totalFlux(f)) expect(procheRel(v, annuite, 1e-11)).toBe(true);
    expect(procheRel(f.principal.reduce((a, b) => a + b, 0), 100, 1e-13)).toBe(true);
  });

  it("amortissement linéaire : principal conservé", () => {
    const f = obligation({ amortissement: "lineaire", frequence: 2 }).flux(marchePlat());
    for (const p of f.principal) expect(p).toBeCloseTo(10, 12);
    expect(f.interets[0]).toBeCloseTo((100 * 0.04) / 2, 14);
  });

  it("ΔEVE d'un zéro coupon : formule fermée", () => {
    const zc = obligation({ taux: 0 });
    const r = calculerDeltaEve([zc], { EUR: marchePlat() }, CHOCS_BALE, { inclureMarge: true });
    expect(procheRel(r.delta("hausse_parallele"), 100 * (Math.exp(-0.05 * 5) - Math.exp(-0.03 * 5)), 1e-12)).toBe(true);
    expect(procheRel(r.delta("baisse_parallele"), 100 * (Math.exp(-0.01 * 5) - Math.exp(-0.03 * 5)), 1e-12)).toBe(true);
    const pire = r.perteMaximale();
    expect(pire.scenario).toBe("hausse_parallele");
    expect(pire.perte).toBeCloseTo(-r.delta("hausse_parallele"), 12);
  });

  it("un passif gagne quand les taux montent", () => {
    const depot = obligation({ identifiant: "dat", categorie: "depot_terme", sens: -1, taux: 0.02, maturite: 2 });
    const r = calculerDeltaEve([depot], { EUR: marchePlat() }, CHOCS_BALE, { inclureMarge: true });
    expect(r.total()).toBeLessThan(0);
    expect(r.delta("hausse_parallele")).toBeGreaterThan(0);
  });

  it("exclusion de la marge identique en base et en choc", () => {
    const m = marchePlat();
    const avec = valeurActualisee(obligation({ taux: 0.05, marge: 0.01 }), m, m, false);
    const sans = valeurActualisee(obligation({ taux: 0.04 }), m, m, true);
    expect(procheRel(avec, sans, 1e-14)).toBe(true);
  });

  it("la décomposition par devise somme au total", () => {
    const m = marchePlat();
    const pos = [obligation({ identifiant: "a" }), obligation({ identifiant: "b", devise: "USD", maturite: 3 })];
    const r = calculerDeltaEve(pos, { EUR: m, USD: new MarcheDevise("USD", m.actualisation) }, CHOCS_BALE, {
      inclureMarge: true,
    });
    const dec = r.decomposition("pentification", "devise");
    expect(Object.keys(dec).sort()).toEqual(["EUR", "USD"]);
    expect(procheRel(dec["EUR"]! + dec["USD"]!, r.delta("pentification"), 1e-12)).toBe(true);
  });

  it("refuse un doublon et une devise sans courbe", () => {
    const m = { EUR: marchePlat() };
    expect(() => calculerDeltaEve([obligation(), obligation()], m, CHOCS_BALE, { inclureMarge: true })).toThrow(/double/);
    expect(() => calculerDeltaEve([obligation({ devise: "JPY" })], m, CHOCS_BALE, { inclureMarge: true })).toThrow(
      /devise/,
    );
  });

  it("refuse un sens invalide", () => {
    expect(() => obligation({ sens: 0 as 1 })).toThrow();
  });

  it("ΔNII : taux fixe renouvelé à mi-horizon", () => {
    // 100 à 4 % pendant 6 mois, puis renouvelé 1 an au taux par forward : e^r − 1 sur courbe plate continue
    const p = obligation({ taux: 0.04, maturite: 0.5, dureeRenouvellement: 1 });
    const r = calculerDeltaNii([p], { EUR: marchePlat() }, CHOCS_BALE);
    expect(procheRel(r.total(), 100 * 0.04 * 0.5 + 100 * (Math.exp(R) - 1) * 0.5, 1e-12)).toBe(true);
    expect(procheRel(r.delta("hausse_parallele"), 50 * (Math.exp(0.05) - Math.exp(R)), 1e-12)).toBe(true);
  });

  it("ΔNII : un taux variable reprice aux forwards", () => {
    const p = obligation({ taux: 0.025, maturite: 2, frequence: 4, index: "EURIBOR3M", marge: 0.005 });
    const r = calculerDeltaNii([p], { EUR: marchePlat() }, CHOCS_BALE);
    const fwd = (r_: number): number => (Math.exp(r_ * 0.25) - 1) / 0.25;
    expect(procheRel(r.total(), 100 * 0.25 * (0.025 + 3 * (fwd(R) + 0.005)), 1e-12)).toBe(true);
    expect(procheRel(r.delta("hausse_parallele"), 100 * 0.75 * (fwd(0.05) - fwd(R)), 1e-12)).toBe(true);
  });
});
