/**
 * Sensibilités, gaps de repricing et risque de base (PDF p. 14).
 *
 * PV01 ≈ [PV(r − 1 pb) − PV(r + 1 pb)] / 2      (positif pour une obligation détenue)
 * ΔPV ≈ −Σₘ KRDₘ·Δrₘ + ½·Γ·(Δr)²
 *
 * Ici KRDₘ = −∂PV/∂rₘ en devise par unité de taux (1 = 10 000 pb) et Γ = ∂²PV/∂r² pour un
 * déplacement parallèle. Ces approximations expliquent les variations ; les mesures
 * réglementaires restent calculées par revalorisation complète (module `mesures`).
 */

import type { FonctionTaux } from "./courbes";
import { valeurActualisee } from "./mesures";
import type { Position } from "./positions";
import { type MarcheDevise, decalerMarche } from "./scenarios";
import { arrondiBancaire, estCroissantStrict, indiceInsertion, interp, sommesCumulees } from "./tableau";

function pv(
  positions: readonly Position[],
  marche: MarcheDevise,
  inclureMarge: boolean,
  delta: FonctionTaux | null = null,
  index: string | null = null,
): number {
  const choque = delta === null ? marche : decalerMarche(marche, delta, null, index);
  let s = 0;
  for (const p of positions) {
    if (p.devise === marche.devise) s += valeurActualisee(p, choque, marche, inclureMarge);
  }
  return s;
}

/** Sensibilité parallèle à 1 pb de toutes les courbes de la devise, sans plancher. */
export function pv01(
  positions: readonly Position[],
  marche: MarcheDevise,
  options: { inclureMarge: boolean; pb?: number },
): number {
  const pb = options.pb ?? 1e-4;
  const bas = pv(positions, marche, options.inclureMarge, () => -pb);
  const haut = pv(positions, marche, options.inclureMarge, () => pb);
  return (bas - haut) / 2;
}

export interface Krd {
  readonly pilier: number;
  readonly valeur: number;
}

/**
 * Key rate durations par chocs triangulaires sur les piliers. Les triangles somment à 1 en toute
 * maturité : la somme des KRD égale la sensibilité parallèle, ce qui sert de contrôle de cohérence.
 */
export function krd(
  positions: readonly Position[],
  marche: MarcheDevise,
  piliers: readonly number[],
  options: { inclureMarge: boolean; pb?: number },
): Krd[] {
  if (piliers.length < 1 || !estCroissantStrict(piliers)) throw new Error("piliers strictement croissants");
  const pb = options.pb ?? 1e-4;
  return piliers.map((pilier, m) => {
    const unite = piliers.map((_, k) => (k === m ? 1 : 0));
    const forme = (t: number): number => interp(t, piliers, unite);
    const bas = pv(positions, marche, options.inclureMarge, (t) => -pb * forme(t));
    const haut = pv(positions, marche, options.inclureMarge, (t) => pb * forme(t));
    return { pilier, valeur: (bas - haut) / (2 * pb) };
  });
}

/** Convexité parallèle Γ = [PV(+h) + PV(−h) − 2·PV(0)] / h². */
export function gamma(
  positions: readonly Position[],
  marche: MarcheDevise,
  options: { inclureMarge: boolean; h?: number },
): number {
  const h = options.h ?? 1e-3;
  const base = pv(positions, marche, options.inclureMarge);
  const haut = pv(positions, marche, options.inclureMarge, () => h);
  const bas = pv(positions, marche, options.inclureMarge, () => -h);
  return (haut + bas - 2 * base) / h ** 2;
}

/** ΔPV ≈ −Σ KRDₘ·Δrₘ + ½·Γ·Δr², Δr = `chocMoyen` pour le terme de convexité. */
export function approximationTaylor(
  krds: readonly Krd[],
  gammaParallele: number,
  chocsPiliers: ReadonlyMap<number, number>,
  chocMoyen: number,
): number {
  const connus = new Set(krds.map((k) => k.pilier));
  const inconnus = [...chocsPiliers.keys()].filter((m) => !connus.has(m)).sort((a, b) => a - b);
  if (inconnus.length > 0) throw new Error(`piliers de choc sans KRD : ${inconnus.join(", ")}`);
  let lineaire = 0;
  for (const k of krds) lineaire -= k.valeur * (chocsPiliers.get(k.pilier) ?? 0);
  return lineaire + 0.5 * gammaParallele * chocMoyen ** 2;
}

/** ΔPV d'un choc appliqué à la seule courbe de projection de `index` (choc différentiel de base). */
export function deltaPvRisqueBase(
  positions: readonly Position[],
  marche: MarcheDevise,
  index: string,
  chocBase: number,
  options: { inclureMarge: boolean },
): number {
  const base = pv(positions, marche, options.inclureMarge);
  return pv(positions, marche, options.inclureMarge, () => chocBase, index) - base;
}

export class Gaps {
  constructor(
    readonly bornes: readonly number[],
    readonly gaps: readonly number[],
  ) {}

  get cumules(): number[] {
    return sommesCumulees(this.gaps);
  }

  libelles(): string[] {
    const fmt = (x: number): string => {
      if (!Number.isFinite(x)) return "∞";
      return x > 0 && x < 1 ? `${arrondiBancaire(x * 12)}m` : `${x}a`;
    };
    return this.gaps.map((_, k) => `]${fmt(this.bornes[k]!)} ; ${fmt(this.bornes[k + 1]!)}]`);
  }
}

export const BORNES_GAPS: readonly number[] = [0, 1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, Infinity];

/** Encours signés affectés à la tranche de leur prochaine date de repricing (actif − passif). */
export function gapsRepricing(
  positions: readonly Position[],
  marcheBase: MarcheDevise,
  bornes: readonly number[] = BORNES_GAPS,
): Gaps {
  if (bornes.length < 2 || !estCroissantStrict(bornes)) throw new Error("bornes strictement croissantes");
  const gaps = new Array<number>(bornes.length - 1).fill(0);
  for (const p of positions) {
    if (p.devise !== marcheBase.devise) continue;
    const { dates, montants } = p.echeancierRepricing(marcheBase);
    dates.forEach((d, k) => {
      const i = indiceInsertion(bornes, d, "gauche") - 1;
      if (i < 0 || i >= gaps.length) {
        throw new Error(`${p.identifiant} : date de repricing hors des bornes des tranches`);
      }
      gaps[i] = gaps[i]! + montants[k]!;
    });
  }
  return new Gaps(bornes, gaps);
}
