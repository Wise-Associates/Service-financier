/**
 * ΔEVE et ΔNII par scénario (PDF p. 11 et 12).
 *
 * EVEₛ = Σₖ Dₛ(0,tₖ) · CFₖ,ₛ          ΔEVEₛ = EVEₛ − EVE₀
 * NIIₛ = Σₜ (intérêts actifsₜ,ₛ − intérêts passifsₜ,ₛ)          ΔNIIₛ = NIIₛ − NII₀
 *
 * Convention de signe unique : un Δ négatif est une perte ; la perte maximale publiée est
 * maxₛ(valeur₀ − valeurₛ). Les flux étant signés par position (actif +, passif −), les sommes
 * se lisent directement comme actif − passif.
 */

import type { FonctionTaux } from "./courbes";
import { type Position, totalFlux } from "./positions";
import {
  type MarcheDevise,
  type ParametresChoc,
  SCENARIOS_EVE,
  SCENARIOS_NII,
  marcheScenario,
  plancherEba,
} from "./scenarios";
import { arrondiBancaire, espaceLineaire, somme } from "./tableau";

export type Axe = "devise" | "categorie" | "position";
export type Marches = Readonly<Record<string, MarcheDevise>>;
export type ParametresChocs = Readonly<Record<string, ParametresChoc>>;

/** Valeurs par position, en base et par scénario, avec agrégations et écarts. */
export class ResultatMesure {
  constructor(
    readonly mesure: string,
    readonly base: Readonly<Record<string, number>>,
    readonly scenarios: Readonly<Record<string, Readonly<Record<string, number>>>>,
    readonly deviseDe: Readonly<Record<string, string>>,
    readonly categorieDe: Readonly<Record<string, string>>,
  ) {}

  get listeScenarios(): string[] {
    return Object.keys(this.scenarios);
  }

  private cle(identifiant: string, axe: Axe): string {
    if (axe === "devise") return this.deviseDe[identifiant]!;
    if (axe === "categorie") return this.categorieDe[identifiant]!;
    return identifiant;
  }

  private valeurs(scenario: string): Readonly<Record<string, number>> {
    const v = scenario === "base" ? this.base : this.scenarios[scenario];
    if (v === undefined) throw new Error(`scénario non calculé : ${scenario}`);
    return v;
  }

  total(scenario = "base", devise: string | null = null): number {
    let s = 0;
    for (const [k, v] of Object.entries(this.valeurs(scenario))) {
      if (devise === null || this.deviseDe[k] === devise) s += v;
    }
    return s;
  }

  delta(scenario: string, devise: string | null = null): number {
    return this.total(scenario, devise) - this.total("base", devise);
  }

  /** Δ du scénario décomposé par devise, catégorie de produit ou position (PDF p. 12). */
  decomposition(scenario: string, axe: Axe = "devise"): Record<string, number> {
    const res: Record<string, number> = {};
    for (const [ident, v] of Object.entries(this.valeurs(scenario))) {
      const cle = this.cle(ident, axe);
      res[cle] = (res[cle] ?? 0) + v - this.base[ident]!;
    }
    return res;
  }

  /** Scénario le plus défavorable et maxₛ(valeur₀ − valeurₛ). */
  perteMaximale(devise: string | null = null): { scenario: string; perte: number } {
    let pire: { scenario: string; perte: number } | null = null;
    for (const s of this.listeScenarios) {
      const perte = -this.delta(s, devise);
      if (pire === null || perte > pire.perte) pire = { scenario: s, perte };
    }
    if (pire === null) throw new Error("aucun scénario calculé");
    return pire;
  }
}

function verifierPositions(positions: readonly Position[], marches: Marches): void {
  const vus = new Set<string>();
  for (const p of positions) {
    if (vus.has(p.identifiant)) throw new Error(`identifiant en double : ${p.identifiant} (double comptage)`);
    vus.add(p.identifiant);
    if (!(p.devise in marches)) throw new Error(`${p.identifiant} : aucune courbe pour la devise ${p.devise}`);
  }
}

type Evaluation = (p: Position, marche: MarcheDevise, marcheBase: MarcheDevise) => number;

function parScenario(
  positions: readonly Position[],
  marches: Marches,
  parametresChoc: ParametresChocs,
  scenarios: readonly string[],
  plancher: FonctionTaux | null,
  evaluer: Evaluation,
  mesure: string,
): ResultatMesure {
  verifierPositions(positions, marches);
  const manquants = [...new Set(positions.map((p) => p.devise))].filter((d) => !(d in parametresChoc)).sort();
  if (manquants.length > 0) throw new Error(`paramètres de choc absents pour : ${manquants.join(", ")}`);
  const base: Record<string, number> = {};
  for (const p of positions) base[p.identifiant] = evaluer(p, marches[p.devise]!, marches[p.devise]!);
  const res: Record<string, Record<string, number>> = {};
  for (const s of scenarios) {
    const choques: Record<string, MarcheDevise> = {};
    for (const [d, m] of Object.entries(marches)) {
      const pc = parametresChoc[d];
      if (pc !== undefined) choques[d] = marcheScenario(m, s, pc, plancher);
    }
    const valeurs: Record<string, number> = {};
    for (const p of positions) valeurs[p.identifiant] = evaluer(p, choques[p.devise]!, marches[p.devise]!);
    res[s] = valeurs;
  }
  return new ResultatMesure(
    mesure,
    base,
    res,
    Object.fromEntries(positions.map((p) => [p.identifiant, p.devise])),
    Object.fromEntries(positions.map((p) => [p.identifiant, p.categorie])),
  );
}

/** Σₖ D(0,tₖ)·CFₖ des flux de la position (flux échus à t <= 0 exclus). */
export function valeurActualisee(
  position: Position,
  marche: MarcheDevise,
  marcheBase: MarcheDevise,
  inclureMarge: boolean,
): number {
  const f = position.flux(marche, marcheBase, inclureMarge);
  const total = totalFlux(f);
  let s = 0;
  f.dates.forEach((t, k) => {
    if (t > 0) s += marche.actualisation.facteurActualisation(t) * total[k]!;
  });
  return s;
}

export interface OptionsEve {
  inclureMarge: boolean;
  scenarios?: readonly string[];
  plancher?: FonctionTaux | null;
}

/**
 * EVE par position en base et sous chaque scénario. `inclureMarge` est obligatoire : le PDF (p. 11)
 * exige un choix explicite, appliqué identiquement en base et en choc. Bilan en extinction.
 */
export function calculerDeltaEve(
  positions: readonly Position[],
  marches: Marches,
  parametresChoc: ParametresChocs,
  options: OptionsEve,
): ResultatMesure {
  return parScenario(
    positions,
    marches,
    parametresChoc,
    options.scenarios ?? SCENARIOS_EVE,
    options.plancher === undefined ? plancherEba : options.plancher,
    (p, m, mb) => valeurActualisee(p, m, mb, options.inclureMarge),
    "EVE",
  );
}

export function grilleMensuelle(horizon = 1, pasParAn = 12): number[] {
  const n = arrondiBancaire(horizon * pasParAn);
  if (n < 1) throw new Error("horizon trop court pour la grille");
  return espaceLineaire(0, horizon, n + 1);
}

export interface OptionsNii {
  scenarios?: readonly string[];
  horizon?: number;
  pasParAn?: number;
  plancher?: FonctionTaux | null;
}

/** NII à bilan constant sur l'horizon (12 mois par défaut), même périmètre en base et en choc. */
export function calculerDeltaNii(
  positions: readonly Position[],
  marches: Marches,
  parametresChoc: ParametresChocs,
  options: OptionsNii = {},
): ResultatMesure {
  const grille = grilleMensuelle(options.horizon ?? 1, options.pasParAn ?? 12);
  return parScenario(
    positions,
    marches,
    parametresChoc,
    options.scenarios ?? SCENARIOS_NII,
    options.plancher === undefined ? plancherEba : options.plancher,
    (p, m, mb) => somme(p.interets(m, mb, grille)),
    "NII",
  );
}
