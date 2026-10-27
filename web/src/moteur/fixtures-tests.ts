/** Marchés fictifs communs aux tests du moteur (aucune donnée réelle). */

import { CourbeZero } from "./courbes";
import { MarcheDevise } from "./scenarios";

export const R = 0.03;

export function courbePlate(): CourbeZero {
  return new CourbeZero([1], [R]);
}

export function marchePlat(): MarcheDevise {
  const c = courbePlate();
  return new MarcheDevise("EUR", c, { EURIBOR3M: c });
}

export function marchePente(): MarcheDevise {
  const c = new CourbeZero([0.25, 1, 2, 5, 10, 20, 30], [0.02, 0.022, 0.024, 0.027, 0.03, 0.032, 0.031]);
  return new MarcheDevise("EUR", c, { EURIBOR3M: new CourbeZero([0.25, 30], [0.022, 0.033]) });
}

/** Égalité relative, comme `pytest.approx(attendu, rel=…)`. */
export function procheRel(obtenu: number, attendu: number, rel: number): boolean {
  return Math.abs(obtenu - attendu) <= rel * Math.abs(attendu);
}
