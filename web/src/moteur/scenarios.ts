/**
 * Scénarios de choc de taux (PDF p. 10 et 15) et marché par devise.
 *
 * Les six chocs EVE suivent la forme du cadre de Bâle (BCBS d368, 2016, annexe 2) :
 *   court(τ) = R_court · e^(−τ/x)          long(τ) = R_long · (1 − e^(−τ/x))      x = 4 ans
 *   pentification  = −0,65·|court| + 0,9·|long|
 *   aplatissement  = +0,8·|court| − 0,6·|long|
 *
 * Les tailles de chocs par devise et le plancher post-choc sont des PARAMÈTRES : les valeurs
 * fournies reprennent BCBS d368 et le RTS UE 2024/856 et doivent être revérifiées sur le
 * texte en vigueur pour l'établissement avant tout usage réglementaire.
 */

import { propre } from "./cles";
import { type Courbe, CourbeDecalee, type FonctionTaux } from "./courbes";

export const SCENARIOS_EVE = [
  "hausse_parallele",
  "baisse_parallele",
  "pentification",
  "aplatissement",
  "hausse_taux_courts",
  "baisse_taux_courts",
] as const;
export const SCENARIOS_NII = ["hausse_parallele", "baisse_parallele"] as const;

export type Scenario = (typeof SCENARIOS_EVE)[number] | "base";

/** Tailles de chocs (en décimal : 0,02 = 200 pb) et constante de décroissance x. */
export interface ParametresChoc {
  readonly parallele: number;
  readonly court: number;
  readonly long: number;
  readonly x: number;
}

function parametres(parallele: number, court: number, long: number, x = 4): ParametresChoc {
  return Object.freeze({ parallele, court, long, x });
}

/** BCBS d368 (2016), annexe 2. À confirmer selon le périmètre réglementaire de l'établissement. */
export const CHOCS_BALE: Readonly<Record<string, ParametresChoc>> = Object.freeze({
  EUR: parametres(0.02, 0.025, 0.01),
  USD: parametres(0.02, 0.03, 0.015),
  GBP: parametres(0.025, 0.03, 0.015),
  CHF: parametres(0.01, 0.015, 0.01),
  JPY: parametres(0.01, 0.01, 0.01),
});

/** Δr(τ) du scénario pour la maturité t (années). */
export function choc(scenario: string, p: ParametresChoc, t: number): number {
  const court = p.court * Math.exp(-t / p.x);
  const long = p.long * (1 - Math.exp(-t / p.x));
  switch (scenario) {
    case "hausse_parallele":
      return p.parallele;
    case "baisse_parallele":
      return -p.parallele;
    case "pentification":
      return -0.65 * Math.abs(court) + 0.9 * Math.abs(long);
    case "aplatissement":
      return 0.8 * Math.abs(court) - 0.6 * Math.abs(long);
    case "hausse_taux_courts":
      return court;
    case "baisse_taux_courts":
      return -court;
    case "base":
      return 0;
    default:
      throw new Error(`scénario inconnu : ${scenario}`);
  }
}

/**
 * Plancher post-choc dépendant de la maturité : −150 pb à 0 an, +3 pb par an, 0 % à 50 ans.
 * Forme du RTS UE 2024/856 (SOT) ; à confirmer sur le texte en vigueur.
 */
export function plancherEba(t: number): number {
  return Math.min(-0.015 + 0.0003 * t, 0);
}

/**
 * Courbes d'une devise : une courbe d'actualisation et une courbe de projection par index.
 * Un index absent de `projection` est projeté sur la courbe d'actualisation : le risque de base
 * n'est alors pas représenté, ce qui doit être un choix explicite (PDF p. 10 et 14).
 */
export class MarcheDevise {
  constructor(
    readonly devise: string,
    readonly actualisation: Courbe,
    readonly projection: Readonly<Record<string, Courbe>> = {},
  ) {}

  courbeIndex(index: string | null): Courbe {
    if (index === null) return this.actualisation;
    return propre(this.projection, index) ?? this.actualisation;
  }
}

/**
 * Applique le même déplacement à toutes les courbes de la devise, ou à un seul index (choc
 * différentiel du risque de base, PDF p. 14). Chaque courbe est déplacée, ce qui conserve les bases.
 */
export function decalerMarche(
  marche: MarcheDevise,
  delta: FonctionTaux,
  plancher: FonctionTaux | null = null,
  index: string | null = null,
): MarcheDevise {
  if (index !== null) {
    const courbe = propre(marche.projection, index);
    if (courbe === undefined) throw new Error(`index ${index} absent du marché ${marche.devise}`);
    return new MarcheDevise(marche.devise, marche.actualisation, {
      ...marche.projection,
      [index]: new CourbeDecalee(courbe, delta, plancher),
    });
  }
  const projection: Record<string, Courbe> = {};
  for (const [k, c] of Object.entries(marche.projection)) projection[k] = new CourbeDecalee(c, delta, plancher);
  return new MarcheDevise(marche.devise, new CourbeDecalee(marche.actualisation, delta, plancher), projection);
}

/** Marché de la devise sous un scénario réglementaire (plancher post-choc inclus). */
export function marcheScenario(
  marche: MarcheDevise,
  scenario: string,
  p: ParametresChoc,
  plancher: FonctionTaux | null = plancherEba,
): MarcheDevise {
  if (scenario === "base") return marche;
  return decalerMarche(marche, (t) => choc(scenario, p, t), plancher);
}
