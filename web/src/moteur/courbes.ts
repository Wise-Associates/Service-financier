/**
 * Courbes de taux et facteurs d'actualisation (PDF p. 10).
 *
 * Convention interne unique : taux zéro en capitalisation continue, temps en années.
 * D(0,t) = exp(−r(t)·t) = exp(−∫₀ᵗ f(0,u) du). Les taux saisis dans une autre convention
 * sont convertis à l'entrée (`convertirTaux`).
 */

import { estCroissantStrict, interp } from "./tableau";

export type Capitalisation = "continue" | "annuelle" | "simple";

/** Convertit un taux zéro d'une capitalisation à une autre pour la maturité t (années), via le facteur d'actualisation. */
export function convertirTaux(taux: number, t: number, de: Capitalisation, vers: Capitalisation): number {
  if (!(t > 0)) throw new Error("convertirTaux : maturités strictement positives requises");
  return tauxDepuisFacteur(facteurDepuisTaux(taux, t, de), t, vers);
}

function facteurDepuisTaux(r: number, t: number, conv: Capitalisation): number {
  switch (conv) {
    case "continue":
      return Math.exp(-r * t);
    case "annuelle":
      if (r <= -1) throw new Error("taux annuel <= -100 % : facteur d'actualisation indéfini");
      return (1 + r) ** -t;
    case "simple":
      if (1 + r * t <= 0) throw new Error("taux simple trop négatif pour la maturité : 1 + r·t <= 0");
      return 1 / (1 + r * t);
  }
}

function tauxDepuisFacteur(df: number, t: number, conv: Capitalisation): number {
  switch (conv) {
    case "continue":
      return -Math.log(df) / t;
    case "annuelle":
      return df ** (-1 / t) - 1;
    case "simple":
      return (1 / df - 1) / t;
  }
}

/** Interface commune : toute courbe fournit un taux zéro continu r(t). */
export abstract class Courbe {
  abstract tauxZero(t: number): number;

  facteurActualisation(t: number): number {
    return Math.exp(-this.tauxZero(t) * t);
  }

  /** Taux forward en capitalisation simple entre t1 et t2 (base de calcul des coupons variables). */
  forward(t1: number, t2: number): number {
    if (!(t2 > t1)) throw new Error("forward : t2 doit être strictement supérieur à t1");
    return (this.facteurActualisation(t1) / this.facteurActualisation(t2) - 1) / (t2 - t1);
  }

  /** f(0,t) = −d ln D(0,t) / dt, par différence centrée (décentrée près de 0). */
  forwardInstantane(t: number, h = 1e-5): number {
    const bas = Math.max(t - h, 0);
    const haut = t + h;
    return -(Math.log(this.facteurActualisation(haut)) - Math.log(this.facteurActualisation(bas))) / (haut - bas);
  }
}

/**
 * Courbe définie par des piliers de taux zéro. Interpolation linéaire des taux zéro continus
 * entre piliers, extrapolation plate au-delà (PDF p. 10).
 */
export class CourbeZero extends Courbe {
  readonly maturites: readonly number[];
  readonly tauxContinus: readonly number[];

  constructor(
    maturites: readonly number[],
    taux: readonly number[],
    capitalisation: Capitalisation = "continue",
    readonly nom = "",
  ) {
    super();
    if (maturites.length === 0 || maturites.length !== taux.length) {
      throw new Error("CourbeZero : maturités et taux de même longueur, non vides");
    }
    if (maturites.some((m) => !(m > 0)) || !estCroissantStrict(maturites)) {
      throw new Error("CourbeZero : maturités strictement positives et croissantes");
    }
    if (taux.some((r) => !Number.isFinite(r))) throw new Error("CourbeZero : taux non finis");
    this.maturites = [...maturites];
    this.tauxContinus = taux.map((r, i) => convertirTaux(r, maturites[i]!, capitalisation, "continue"));
  }

  tauxZero(t: number): number {
    return interp(t, this.maturites, this.tauxContinus);
  }
}

export type FonctionTaux = (t: number) => number;

/**
 * Courbe de base déplacée d'un choc additif Δr(τ), avec plancher optionnel : rₛ(τ) = r₀(τ) + Δrₛ(τ)
 * (PDF p. 10). Si le taux observé est déjà sous le plancher, il sert de plancher (règle EBA).
 */
export class CourbeDecalee extends Courbe {
  constructor(
    readonly base: Courbe,
    readonly choc: FonctionTaux,
    readonly plancher: FonctionTaux | null = null,
  ) {
    super();
  }

  tauxZero(t: number): number {
    const r0 = this.base.tauxZero(t);
    const r = r0 + this.choc(t);
    if (this.plancher === null) return r;
    return Math.max(r, Math.min(this.plancher(t), r0));
  }
}

/**
 * Bootstrapping d'une courbe à partir de taux de swap par à jambe fixe annuelle :
 * D(Tₙ) = (1 − Sₙ · Σᵢ<ₙ D(Tᵢ)) / (1 + Sₙ). Maturités entières consécutives 1, 2, …, N exigées.
 */
export function bootstrapSwaps(maturites: readonly number[], tauxPar: readonly number[]): CourbeZero {
  if (maturites.some((m, i) => m !== i + 1)) {
    throw new Error("bootstrapSwaps : maturités annuelles consécutives 1..N attendues");
  }
  if (tauxPar.length !== maturites.length) throw new Error("bootstrapSwaps : un taux par maturité");
  const facteurs: number[] = [];
  let cumul = 0;
  for (const sn of tauxPar) {
    const df = (1 - sn * cumul) / (1 + sn);
    if (df <= 0) throw new Error("bootstrapSwaps : facteur d'actualisation négatif, données incohérentes");
    facteurs.push(df);
    cumul += df;
  }
  const zero = facteurs.map((df, i) => -Math.log(df) / maturites[i]!);
  return new CourbeZero(maturites, zero, "continue", "bootstrap swaps");
}
