/**
 * Approche standardisée et test des valeurs aberrantes (PDF p. 15).
 *
 * Voie prudentielle distincte du modèle interne : les flux sont affectés aux 19 tranches de
 * repricing de Bâle (BCBS d368, tableau 2) et actualisés au point milieu de la tranche avec
 * des taux zéro continus, DF = exp(−R·t_milieu).
 *
 * Traitements retenus (paramètres à aligner sur les règles prescrites en vigueur) :
 * - taux fixe : flux contractuels ; taux variable : coupon en cours et nominal à la prochaine révision ;
 * - dépôts sans échéance et remboursements anticipés : flux du modèle comportemental, régénérés
 *   sous chaque scénario ; leurs paramètres doivent respecter les plafonds prescrits ;
 * - options automatiques : revalorisation complète sous chaque scénario.
 */

import type { FonctionTaux } from "./courbes";
import type { Marches, ParametresChocs } from "./mesures";
import { CapFloor } from "./options";
import { type Flux, Instrument, type Position, totalFlux } from "./positions";
import { type MarcheDevise, SCENARIOS_EVE, marcheScenario, plancherEba } from "./scenarios";
import { indiceInsertion, produitScalaire } from "./tableau";

export const BORNES_BALE: readonly number[] = [
  0, 1 / 360, 1 / 12, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, Infinity,
];
export const MILIEUX_BALE: readonly number[] = [
  0.0028, 0.0417, 0.1667, 0.375, 0.625, 0.875, 1.25, 1.75, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 12.5, 17.5, 25.0,
];

/** Somme des flux par tranche de Bâle ; une date t tombe dans la tranche ]a ; b]. */
export function repartirFlux(dates: readonly number[], montants: readonly number[]): number[] {
  if (dates.some((d) => !(d > 0))) throw new Error("flux échus (t <= 0) à exclure avant la répartition");
  const res = new Array<number>(MILIEUX_BALE.length).fill(0);
  dates.forEach((d, k) => {
    const i = indiceInsertion(BORNES_BALE, d, "gauche") - 1;
    res[i] = res[i]! + montants[k]!;
  });
  return res;
}

function fluxStandardises(p: Position, marcheS: MarcheDevise, marche0: MarcheDevise, inclureMarge: boolean): Flux {
  if (p instanceof Instrument) {
    const f = p.flux(marche0, marche0, inclureMarge);
    if (p.index === null) return f;
    // Taux variable : le nominal reprice en totalité à la prochaine révision.
    return { dates: f.dates.slice(0, 1), interets: f.interets.slice(0, 1), principal: [p.sens * p.nominal] };
  }
  return p.flux(marcheS, marche0, inclureMarge);
}

/**
 * Somme des ΔEVE par devise, les gains pondérés par `poidsGains`. 0,5 correspond à l'agrégation du
 * RTS UE (gains comptés à 50 %), 0 à la seule prise en compte des pertes ; à confirmer sur le texte.
 */
export function agregerDevises(deltaParDevise: Readonly<Record<string, number>>, poidsGains: number): number {
  if (!(poidsGains >= 0 && poidsGains <= 1)) throw new Error("poidsGains dans [0 ; 1]");
  let s = 0;
  for (const v of Object.values(deltaParDevise)) s += Math.min(v, 0) + poidsGains * Math.max(v, 0);
  return s;
}

export class ResultatStandardise {
  constructor(
    readonly deltaParScenarioDevise: Readonly<Record<string, Readonly<Record<string, number>>>>,
    readonly poidsGains: number,
  ) {}

  deltaAgrege(scenario: string): number {
    const d = this.deltaParScenarioDevise[scenario];
    if (d === undefined) throw new Error(`scénario non calculé : ${scenario}`);
    return agregerDevises(d, this.poidsGains);
  }

  /** Scénario le plus défavorable et perte agrégée (>= 0). */
  mesureRisque(): { scenario: string; perte: number } {
    let pire: { scenario: string; perte: number } | null = null;
    for (const s of Object.keys(this.deltaParScenarioDevise)) {
      const perte = -this.deltaAgrege(s);
      if (pire === null || perte > pire.perte) pire = { scenario: s, perte };
    }
    if (pire === null) throw new Error("aucun scénario calculé");
    return { scenario: pire.scenario, perte: Math.max(0, pire.perte) };
  }
}

function valeurTranches(f: Flux, facteurs: readonly number[]): number {
  const total = totalFlux(f);
  const vivants = f.dates.map((d, k) => [d, total[k]!] as const).filter(([d]) => d > 0);
  return produitScalaire(
    repartirFlux(
      vivants.map(([d]) => d),
      vivants.map(([, v]) => v),
    ),
    facteurs,
  );
}

export function calculerDeltaEveStandardise(
  positions: readonly Position[],
  marches: Marches,
  parametresChoc: ParametresChocs,
  options: {
    inclureMarge: boolean;
    poidsGains: number;
    scenarios?: readonly string[];
    plancher?: FonctionTaux | null;
  },
): ResultatStandardise {
  const plancher = options.plancher === undefined ? plancherEba : options.plancher;
  const res: Record<string, Record<string, number>> = {};
  for (const s of options.scenarios ?? SCENARIOS_EVE) {
    const parDevise: Record<string, number> = {};
    for (const [d, m0] of Object.entries(marches)) {
      const pos = positions.filter((p) => p.devise === d);
      if (pos.length === 0) continue;
      const pc = parametresChoc[d];
      if (pc === undefined) throw new Error(`paramètres de choc absents pour ${d}`);
      const ms = marcheScenario(m0, s, pc, plancher);
      const df0 = MILIEUX_BALE.map((t) => m0.actualisation.facteurActualisation(t));
      const dfs = MILIEUX_BALE.map((t) => ms.actualisation.facteurActualisation(t));
      let delta = 0;
      for (const p of pos) {
        if (p instanceof CapFloor) {
          delta += p.prix(ms) - p.prix(m0);
          continue;
        }
        delta += valeurTranches(fluxStandardises(p, ms, m0, options.inclureMarge), dfs);
        delta -= valeurTranches(fluxStandardises(p, m0, m0, options.inclureMarge), df0);
      }
      parDevise[d] = delta;
    }
    res[s] = parDevise;
  }
  return new ResultatStandardise(res, options.poidsGains);
}

export interface ResultatSot {
  readonly indicateur: string;
  readonly scenario: string;
  readonly perte: number;
  readonly fondsPropresT1: number;
  readonly ratio: number;
  readonly seuil: number;
  readonly depassement: boolean;
}

/**
 * Perte maximale (−Δ) rapportée aux fonds propres Tier 1. Seuils usuels : 15 % pour ΔEVE (cadre
 * Bâle) ; le RTS UE ajoute un test ΔNII (5 %). Seuils et scénarios à confirmer sur les RTS en vigueur.
 */
export function controleValeursAberrantes(
  deltaParScenario: Readonly<Record<string, number>>,
  fondsPropresT1: number,
  seuil: number,
  indicateur: string,
): ResultatSot {
  if (!(fondsPropresT1 > 0)) throw new Error("fonds propres Tier 1 strictement positifs");
  const scenarios = Object.keys(deltaParScenario);
  if (scenarios.length === 0) throw new Error("aucun scénario fourni");
  let pire = scenarios[0]!;
  for (const s of scenarios) if (deltaParScenario[s]! < deltaParScenario[pire]!) pire = s;
  const perte = Math.max(0, -deltaParScenario[pire]!);
  const ratio = perte / fondsPropresT1;
  return Object.freeze({ indicateur, scenario: pire, perte, fondsPropresT1, ratio, seuil, depassement: ratio > seuil });
}
