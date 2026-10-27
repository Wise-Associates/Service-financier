import { describe, expect, it } from "vitest";

import { DepotNonEcheance } from "./comportemental";
import { marchePente, marchePlat, procheRel } from "./fixtures-tests";
import { valeurActualisee } from "./mesures";
import { Instrument, type Position } from "./positions";
import { decalerMarche } from "./scenarios";
import { approximationTaylor, deltaPvRisqueBase, gamma, gapsRepricing, krd, pv01 } from "./sensibilites";

function zc(maturite = 5): Instrument {
  return new Instrument({ identifiant: "zc", categorie: "titre", devise: "EUR", sens: 1, encours: 100, taux: 0, maturite });
}

function titre(maturite: number): Instrument {
  return new Instrument({ identifiant: "o", categorie: "titre", devise: "EUR", sens: 1, encours: 100, taux: 0.03, maturite });
}

function portefeuille(): Position[] {
  return [
    new Instrument({ identifiant: "o10", categorie: "titre", devise: "EUR", sens: 1, encours: 100, taux: 0.03, maturite: 10 }),
    new Instrument({
      identifiant: "frn",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 80,
      taux: 0.024,
      maturite: 6,
      frequence: 4,
      amortissement: "lineaire",
      index: "EURIBOR3M",
      marge: 0.01,
    }),
    new Instrument({ identifiant: "dat", categorie: "depot_terme", devise: "EUR", sens: -1, encours: 60, taux: 0.021, maturite: 2 }),
    new DepotNonEcheance({
      identifiant: "dav",
      devise: "EUR",
      encours: 50,
      partStable: 0.6,
      tauxServi: 0.004,
      beta: 0.3,
      dureeVieStable: 4,
    }),
  ];
}

/** Écoulement de la part stable du dépôt entre les mois `debut` et `fin` (inclus). */
function stableMois(debut: number, fin: number): number {
  return 30 * (Math.exp(-(debut - 1) / 12 / 4) - Math.exp(-fin / 12 / 4));
}

describe("sensibilités", () => {
  it("PV01 d'un zéro coupon : formule fermée", () => {
    // [PV(−1 pb) − PV(+1 pb)] / 2 = 100·e^(−rT)·sinh(T·1 pb)
    const attendu = 100 * Math.exp(-0.03 * 5) * Math.sinh(5 * 1e-4);
    expect(procheRel(pv01([zc()], marchePlat(), { inclureMarge: true }), attendu, 1e-9)).toBe(true);
  });

  it("PV01 positif pour une obligation détenue", () => {
    expect(pv01([titre(10)], marchePente(), { inclureMarge: true })).toBeGreaterThan(0);
  });

  it("la somme des KRD égale la sensibilité parallèle", () => {
    const k = krd(portefeuille(), marchePente(), [0.25, 1, 2, 5, 10, 20], { inclureMarge: true });
    const total = pv01(portefeuille(), marchePente(), { inclureMarge: true });
    expect(procheRel(k.reduce((s, x) => s + x.valeur, 0) * 1e-4, total, 1e-6)).toBe(true);
  });

  it("Taylor avec convexité approche la revalorisation complète", () => {
    const m = marchePente();
    const pos = [titre(15)];
    const piliers = [1, 2, 5, 10, 15, 20];
    const k = krd(pos, m, piliers, { inclureMarge: true });
    const g = gamma(pos, m, { inclureMarge: true });
    const choque = decalerMarche(m, () => 0.02);
    const exact = valeurActualisee(pos[0]!, choque, m, true) - valeurActualisee(pos[0]!, m, m, true);
    const chocs = new Map(piliers.map((p) => [p, 0.02]));
    const avec = approximationTaylor(k, g, chocs, 0.02);
    const sans = approximationTaylor(k, 0, chocs, 0.02);
    // 15 ans, +200 pb : l'erreur passe d'environ 14 % (linéaire) à 1,5 % (ordre 3 restant)
    expect(Math.abs(avec - exact)).toBeLessThan(0.15 * Math.abs(sans - exact));
    expect(procheRel(avec, exact, 0.02)).toBe(true);
  });

  it("les gaps somment aux encours signés", () => {
    const g = gapsRepricing(portefeuille(), marchePente());
    expect(procheRel(g.cumules.at(-1)!, 100 + 80 - 60 - 50, 1e-12)).toBe(true);
    // ]0 ; 1 mois] : part volatile (−20) au jour le jour et écoulement du premier mois ;
    // ]1 ; 3 mois] : le prêt variable reprice en totalité, moins l'écoulement des mois 2 et 3.
    expect(procheRel(g.gaps[0]!, -20 - stableMois(1, 1), 1e-12)).toBe(true);
    expect(procheRel(g.gaps[1]!, 80 - stableMois(2, 3), 1e-12)).toBe(true);
    expect(g.libelles()).toHaveLength(g.gaps.length);
    expect(g.libelles()[0]).toBe("]0a ; 1m]");
  });

  it("le risque de base ne touche que l'index", () => {
    const m = marchePente();
    const frn = new Instrument({
      identifiant: "frn",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 100,
      taux: 0.024,
      maturite: 5,
      frequence: 4,
      index: "EURIBOR3M",
    });
    expect(deltaPvRisqueBase([titre(5)], m, "EURIBOR3M", 0.001, { inclureMarge: true })).toBe(0);
    const d = deltaPvRisqueBase([frn], m, "EURIBOR3M", 0.001, { inclureMarge: true });
    // Référence écrite à la main : P'(t) = P(t)·e^(−0,001·t), coupons = forwards simples
    const proj = m.projection["EURIBOR3M"]!;
    let attendu = 0;
    for (let k = 1; k < 20; k++) {
      const [a, b] = [0.25 * k, 0.25 * (k + 1)];
      const [Pa, Pb] = [proj.facteurActualisation(a), proj.facteurActualisation(b)];
      const dfwd = ((Pa * Math.exp(-0.001 * a)) / (Pb * Math.exp(-0.001 * b)) - Pa / Pb) / 0.25;
      attendu += 100 * 0.25 * dfwd * m.actualisation.facteurActualisation(b);
    }
    expect(procheRel(d, attendu, 1e-12)).toBe(true);
  });
});
