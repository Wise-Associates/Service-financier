import { describe, expect, it } from "vitest";

import {
  type CaracteristiquesDepot,
  type CaracteristiquesPret,
  DepotNonEcheance,
  PretRemboursementAnticipe,
  cprLogistique,
  ecoulementExponentiel,
  estimerTransmission,
  smmDepuisCpr,
  stabiliteTransmission,
  survie,
} from "./comportemental";
import { marchePlat, procheRel } from "./fixtures-tests";
import { calculerDeltaEve, calculerDeltaNii } from "./mesures";
import { Instrument, totalFlux } from "./positions";
import { CHOCS_BALE, marcheScenario } from "./scenarios";

const somme = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0);

/** Générateur pseudo-aléatoire déterministe (mulberry32) et loi normale par Box-Muller. */
function generateurNormal(graine: number): (ecartType: number) => number {
  let etat = graine >>> 0;
  const uniforme = (): number => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (ecartType) => ecartType * Math.sqrt(-2 * Math.log(1 - uniforme())) * Math.cos(2 * Math.PI * uniforme());
}

describe("comportemental", () => {
  it("SMM et survie redonnent le CPR annuel", () => {
    const smm = smmDepuisCpr(0.12);
    expect(smm).toBeCloseTo(1 - 0.88 ** (1 / 12), 15);
    expect(procheRel(survie(new Array<number>(12).fill(smm))[11]!, 0.88, 1e-14)).toBe(true);
  });

  it("survie refuse un taux hors bornes", () => {
    expect(() => survie([0.1, 1.2])).toThrow();
  });

  it("CPR logistique : bornes et centre", () => {
    expect(cprLogistique(0, 0.02, 0.3, 200)).toBeCloseTo(0.16, 14);
    expect(cprLogistique(1, 0.02, 0.3, 200)).toBeCloseTo(0.3, 14);
    expect(cprLogistique(-1, 0.02, 0.3, 200)).toBeCloseTo(0.02, 14);
  });

  it("l'estimation retrouve les β simulés", () => {
    const bruit = generateurNormal(42);
    const x = Array.from({ length: 600 }, () => bruit(0.002));
    const y = x.map((v, t) => (t === 0 ? 0 : 0.0001 + 0.3 * v + 0.2 * x[t - 1]! + bruit(0.0001)));
    const res = estimerTransmission(y, x, 1);
    expect(Math.abs(res.betas[0]! - 0.3)).toBeLessThan(0.01);
    expect(Math.abs(res.betas[1]! - 0.2)).toBeLessThan(0.01);
    expect(Math.abs(res.betaCumule - 0.5)).toBeLessThan(0.01);
    expect(res.r2).toBeGreaterThan(0.9);
    for (const b of stabiliteTransmission(y, x, 1, 3)) expect(Math.abs(b - 0.5)).toBeLessThan(0.02);
  });

  it("refuse un historique trop court", () => {
    expect(() => estimerTransmission([0, 0.1, 0.2], [0, 0.1, 0.2], 2)).toThrow();
  });

  it("l'écoulement exponentiel conserve l'encours", () => {
    const { dates, principal } = ecoulementExponentiel(100, 3, 5);
    expect(procheRel(somme(principal), 100, 1e-14)).toBe(true);
    expect(procheRel(100 - somme(principal.slice(0, 12)), 100 * Math.exp(-1 / 3), 1e-12)).toBe(true);
    expect(dates.at(-1)).toBe(5);
  });

  const depot = (c: Partial<CaracteristiquesDepot> = {}): DepotNonEcheance =>
    new DepotNonEcheance({
      identifiant: "dav",
      devise: "EUR",
      encours: 100,
      partStable: 0.7,
      tauxServi: 0.005,
      beta: 0.4,
      dureeVieStable: 4,
      ...c,
    });

  it("dépôt : encours conservé, passif", () => {
    const m = marchePlat();
    const f = depot().flux(m, m);
    expect(procheRel(somme(f.principal), -100, 1e-13)).toBe(true);
    expect(f.principal[0]).toBeCloseTo(-30, 12);
  });

  it("dépôt : ΔNII transmet β fois le choc, plancher en baisse", () => {
    const r = calculerDeltaNii([depot()], { EUR: marchePlat() }, CHOCS_BALE);
    const pas = 1 / 12;
    const dfwd = (Math.exp(0.05 * pas) - 1 - (Math.exp(0.03 * pas) - 1)) / pas;
    expect(procheRel(r.delta("hausse_parallele"), -100 * 0.4 * dfwd, 1e-10)).toBe(true);
    // baisse : 0,5 % − 0,4 × ~2 % < 0 → plancher 0 %, le coût des dépôts tombe à zéro
    expect(procheRel(r.delta("baisse_parallele"), 100 * 0.005, 1e-12)).toBe(true);
  });

  it("dépôt à β nul : flux indépendants du scénario", () => {
    const m = marchePlat();
    const d = depot({ beta: 0 });
    const choque = marcheScenario(m, "hausse_parallele", CHOCS_BALE["EUR"]!);
    const a = totalFlux(d.flux(choque, m));
    const b = totalFlux(d.flux(m, m));
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 15));
  });

  const pret = (c: Partial<CaracteristiquesPret> = {}): PretRemboursementAnticipe =>
    new PretRemboursementAnticipe({
      identifiant: "immo",
      devise: "EUR",
      encours: 100,
      taux: 0.035,
      maturite: 15,
      marge: 0.008,
      cprMin: 0.03,
      cprMax: 0.25,
      pente: 400,
      ...c,
    });

  it("prêt sans remboursement anticipé = annuité constante (seconde méthode)", () => {
    const m = marchePlat();
    const p = pret({ cprMin: 0, cprMax: 0 });
    const ref = new Instrument({
      identifiant: "ref",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 100,
      taux: 0.035,
      maturite: 15,
      frequence: 12,
      amortissement: "annuite",
    });
    const a = totalFlux(p.flux(m));
    const b = totalFlux(ref.flux(m));
    a.forEach((v, i) => expect(procheRel(v, b[i]!, 1e-11)).toBe(true));
  });

  it("le prêt rembourse plus vite quand les taux baissent", () => {
    const m = marchePlat();
    const p = pret();
    const baisse = marcheScenario(m, "baisse_parallele", CHOCS_BALE["EUR"]!);
    const hausse = marcheScenario(m, "hausse_parallele", CHOCS_BALE["EUR"]!);
    expect(p.cpr(baisse)).toBeGreaterThan(p.cpr(m));
    expect(p.cpr(m)).toBeGreaterThan(p.cpr(hausse));
    for (const x of [baisse, hausse]) expect(procheRel(somme(p.flux(x).principal), 100, 1e-12)).toBe(true);
    // l'option vendue au client réduit le gain EVE en baisse de taux
    const sansOption = pret({ identifiant: "x", cprMin: 0.08, cprMax: 0.08 });
    const r = calculerDeltaEve([p, sansOption], { EUR: m }, CHOCS_BALE, { inclureMarge: true });
    const dec = r.decomposition("baisse_parallele", "position");
    expect(dec.get("immo")!).toBeLessThan(dec.get("x")!);
  });

  it("régresseurs colinéaires refusés", () => {
    const y = Array.from({ length: 24 }, (_, i) => i / 2300);
    expect(() => estimerTransmission(y, new Array<number>(24).fill(0.001), 0)).toThrow(/colinéaires/);
    const x = Array.from({ length: 40 }, (_, i) => 0.002 * Math.cos(0.7 * i));
    expect(() => estimerTransmission(x, x, 2)).toThrow(/colinéaires/);
  });

  it("au moins une sous-période pour le test de stabilité", () => {
    expect(() => stabiliteTransmission(new Array<number>(30).fill(0), new Array<number>(30).fill(0), 0, 0)).toThrow();
  });

  it("dépôt et prêt refusent un encours non fini", () => {
    for (const encours of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => depot({ encours })).toThrow(/encours/);
      expect(() => pret({ encours })).toThrow(/encours/);
    }
  });
});
