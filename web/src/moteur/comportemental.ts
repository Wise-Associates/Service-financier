/**
 * Modèles comportementaux et options clients (PDF p. 13).
 *
 * Dépôts sans échéance : Δr_dépôt,t = α + Σⱼ βⱼ Δr_marché,t−ⱼ + εₜ ; Σβ = transmission cumulée.
 * Remboursement anticipé : S(t) = Πᵤ₌₁ᵗ (1 − hᵤ), hᵤ taux conditionnel mensuel (SMM).
 *
 * Les paramètres (part stable, durée de vie, β, courbe de CPR) sont des hypothèses calibrées
 * par segment, datées et versionnées hors de ce module : ici, seules les formules.
 */

import { EPS, type Flux, type Position, datesRegulieres, interetsBilanConstant, tauxParForward } from "./positions";
import type { MarcheDevise } from "./scenarios";
import { espaceLineaire, indiceInsertion, moindresCarres, somme } from "./tableau";

const JOUR = 1 / 365;

/** Taux mensuel conditionnel équivalent à un taux annuel : SMM = 1 − (1 − CPR)^(1/12). */
export function smmDepuisCpr(cpr: number): number {
  if (!(cpr >= 0 && cpr <= 1)) throw new Error("CPR dans [0 ; 1]");
  return 1 - (1 - cpr) ** (1 / 12);
}

/** S(t) = Π (1 − hᵤ) : part des contrats encore vivants après chaque période. */
export function survie(tauxConditionnels: readonly number[]): number[] {
  if (tauxConditionnels.some((h) => !(h >= 0 && h <= 1))) throw new Error("taux conditionnels dans [0 ; 1]");
  const res: number[] = [];
  let s = 1;
  for (const h of tauxConditionnels) {
    s *= 1 - h;
    res.push(s);
  }
  return res;
}

/**
 * CPR en fonction de l'incitation au refinancement (taux client − taux de marché proposé) :
 * courbe en S bornée par [cprMin ; cprMax], forme usuelle d'un modèle logit calibré par segment.
 */
export function cprLogistique(incitation: number, cprMin: number, cprMax: number, pente: number, centre = 0): number {
  if (!(cprMin >= 0 && cprMin <= cprMax && cprMax <= 1)) throw new Error("0 <= cprMin <= cprMax <= 1 requis");
  return cprMin + (cprMax - cprMin) / (1 + Math.exp(-pente * (incitation - centre)));
}

export interface ResultatTransmission {
  readonly alpha: number;
  readonly betas: readonly number[];
  readonly betaCumule: number;
  readonly r2: number;
  readonly ecartTypeResidus: number;
  readonly nbObservations: number;
}

/** Moindres carrés de Δr_dépôt,t sur Δr_marché,t … Δr_marché,t−L (L = nbRetards). */
export function estimerTransmission(
  deltaTauxServi: readonly number[],
  deltaTauxMarche: readonly number[],
  nbRetards: number,
): ResultatTransmission {
  if (deltaTauxServi.length !== deltaTauxMarche.length) throw new Error("séries de même longueur attendues");
  if (!(Number.isInteger(nbRetards) && nbRetards >= 0)) throw new Error("nbRetards entier >= 0");
  const total = deltaTauxServi.length;
  const n = total - nbRetards;
  if (n < nbRetards + 3) throw new Error("historique trop court pour le nombre de retards");
  if ([...deltaTauxServi, ...deltaTauxMarche].some((v) => !Number.isFinite(v))) {
    throw new Error("valeurs manquantes ou non finies dans les séries");
  }
  const y = deltaTauxServi.slice(nbRetards);
  const X = y.map((_, i) => {
    const t = i + nbRetards;
    return [1, ...Array.from({ length: nbRetards + 1 }, (_, j) => deltaTauxMarche[t - j]!)];
  });
  const coef = moindresCarres(X, y);
  const residus = y.map((v, i) => v - X[i]!.reduce((s, x, k) => s + x * coef[k]!, 0));
  const moyenne = somme(y) / n;
  const sct = somme(y.map((v) => (v - moyenne) ** 2));
  const scr = somme(residus.map((r) => r * r));
  const betas = coef.slice(1);
  return Object.freeze({
    alpha: coef[0]!,
    betas,
    betaCumule: somme(betas),
    r2: sct > 0 ? 1 - scr / sct : Number.NaN,
    ecartTypeResidus: Math.sqrt(scr / (n - coef.length)),
    nbObservations: n,
  });
}

/** β cumulé estimé séparément sur des sous-périodes consécutives (test de stabilité). */
export function stabiliteTransmission(
  deltaTauxServi: readonly number[],
  deltaTauxMarche: readonly number[],
  nbRetards: number,
  nbSousPeriodes = 2,
): number[] {
  if (!(Number.isInteger(nbSousPeriodes) && nbSousPeriodes >= 1)) throw new Error("nbSousPeriodes entier >= 1");
  // Troncature vers zéro, comme `astype(int)` sur numpy.linspace.
  const bornes = espaceLineaire(0, deltaTauxServi.length, nbSousPeriodes + 1).map(Math.trunc);
  return bornes.slice(0, -1).map((a, k) => {
    const b = bornes[k + 1]!;
    return estimerTransmission(deltaTauxServi.slice(a, b), deltaTauxMarche.slice(a, b), nbRetards).betaCumule;
  });
}

/** Échéancier d'amortissement B(t) = B₀·e^(−t/d), tronqué à `maturiteMax` (solde restant à cette date). */
export function ecoulementExponentiel(
  encours: number,
  dureeVieMoyenne: number,
  maturiteMax: number,
  pas = 1 / 12,
): { dates: number[]; principal: number[] } {
  if (!(dureeVieMoyenne > 0 && maturiteMax > 0 && pas > 0)) {
    throw new Error("durée de vie, maturité maximale et pas strictement positifs");
  }
  const n = Math.ceil(maturiteMax / pas - 1e-9);
  const dates = Array.from({ length: n }, (_, k) => Math.min((k + 1) * pas, maturiteMax));
  const soldes = [0, ...dates].map((t) => encours * Math.exp(-t / dureeVieMoyenne));
  const principal = dates.map((_, k) => soldes[k]! - soldes[k + 1]!);
  principal[n - 1] = principal[n - 1]! + soldes[n]!;
  return { dates, principal };
}

export interface CaracteristiquesDepot {
  identifiant: string;
  devise: string;
  encours: number;
  partStable: number;
  tauxServi: number;
  beta: number;
  dureeVieStable: number;
  maturiteMax?: number;
  plancherTauxServi?: number;
  index?: string | null;
  pas?: number;
  categorie?: string;
}

/**
 * Dépôts à vue : part volatile remboursée au jour le jour, part stable écoulée exponentiellement.
 * Taux servi sous scénario : max(plancher, taux₀ + β·(fwdₛ(t) − fwd₀(t))), fwd sur l'index de
 * référence. Passif : flux signés négativement.
 */
export class DepotNonEcheance implements Position {
  readonly identifiant: string;
  readonly devise: string;
  readonly encours: number;
  readonly partStable: number;
  readonly tauxServi: number;
  readonly beta: number;
  readonly dureeVieStable: number;
  readonly maturiteMax: number;
  readonly plancherTauxServi: number;
  readonly index: string | null;
  readonly pas: number;
  readonly categorie: string;

  constructor(c: CaracteristiquesDepot) {
    this.identifiant = c.identifiant;
    this.devise = c.devise;
    this.encours = c.encours;
    this.partStable = c.partStable;
    this.tauxServi = c.tauxServi;
    this.beta = c.beta;
    this.dureeVieStable = c.dureeVieStable;
    this.maturiteMax = c.maturiteMax ?? 5;
    this.plancherTauxServi = c.plancherTauxServi ?? 0;
    this.index = c.index ?? null;
    this.pas = c.pas ?? 1 / 12;
    this.categorie = c.categorie ?? "depot_non_echeance";
    const id = this.identifiant;
    if (!(this.partStable >= 0 && this.partStable <= 1)) throw new Error(`${id} : part stable dans [0 ; 1]`);
    if (!(this.beta >= 0 && this.beta <= 1)) throw new Error(`${id} : β dans [0 ; 1]`);
    if (!(this.encours > 0 && Number.isFinite(this.encours))) throw new Error(`${id} : encours strictement positif`);
    if (this.tauxServi < this.plancherTauxServi) throw new Error(`${id} : taux servi sous son plancher`);
    Object.freeze(this);
  }

  tauxServiScenario(t: number, marche: MarcheDevise, marcheBase: MarcheDevise): number {
    const fwdS = marche.courbeIndex(this.index).forward(t, t + this.pas);
    const fwd0 = marcheBase.courbeIndex(this.index).forward(t, t + this.pas);
    return Math.max(this.plancherTauxServi, this.tauxServi + this.beta * (fwdS - fwd0));
  }

  private echeancier(): { dates: number[]; principal: number[] } {
    const volatile = this.encours * (1 - this.partStable);
    const stable = ecoulementExponentiel(this.encours * this.partStable, this.dureeVieStable, this.maturiteMax, this.pas);
    return { dates: [JOUR, ...stable.dates], principal: [volatile, ...stable.principal] };
  }

  flux(marche: MarcheDevise, marcheBase: MarcheDevise): Flux {
    const { dates, principal } = this.echeancier();
    const stable = this.encours * this.partStable;
    const interets: number[] = [principal[0]! * this.tauxServiScenario(0, marche, marcheBase) * JOUR];
    let rembourse = 0;
    for (let k = 1; k < dates.length; k++) {
      const debut = k === 1 ? 0 : dates[k - 1]!;
      const solde = stable - rembourse;
      interets.push(solde * this.tauxServiScenario(debut, marche, marcheBase) * (dates[k]! - debut));
      rembourse += principal[k]!;
    }
    return { dates, interets: interets.map((v) => -v), principal: principal.map((p) => -p) };
  }

  interets(marche: MarcheDevise, marcheBase: MarcheDevise, grille: readonly number[]): number[] {
    return grille
      .slice(0, -1)
      .map((t, j) => -this.encours * this.tauxServiScenario(t, marche, marcheBase) * (grille[j + 1]! - t));
  }

  echeancierRepricing(): { dates: number[]; montants: number[] } {
    const { dates, principal } = this.echeancier();
    return { dates, montants: principal.map((p) => -p) };
  }
}

export interface CaracteristiquesPret {
  identifiant: string;
  devise: string;
  encours: number;
  taux: number;
  maturite: number;
  marge: number;
  cprMin: number;
  cprMax: number;
  pente: number;
  centre?: number;
  categorie?: string;
}

/**
 * Prêt à taux fixe amortissable mensuellement, avec remboursements anticipés dépendant du scénario.
 * Incitation = taux client − (taux par de marché sur la durée résiduelle + marge). Le CPR est fixé
 * à l'arrêté pour toute la vie du prêt (simplification documentée).
 */
export class PretRemboursementAnticipe implements Position {
  readonly identifiant: string;
  readonly devise: string;
  readonly encours: number;
  readonly taux: number;
  readonly maturite: number;
  readonly marge: number;
  readonly cprMin: number;
  readonly cprMax: number;
  readonly pente: number;
  readonly centre: number;
  readonly categorie: string;

  constructor(c: CaracteristiquesPret) {
    this.identifiant = c.identifiant;
    this.devise = c.devise;
    this.encours = c.encours;
    this.taux = c.taux;
    this.maturite = c.maturite;
    this.marge = c.marge;
    this.cprMin = c.cprMin;
    this.cprMax = c.cprMax;
    this.pente = c.pente;
    this.centre = c.centre ?? 0;
    this.categorie = c.categorie ?? "pret_immobilier";
    if (!(this.encours > 0 && this.maturite > 0 && Number.isFinite(this.encours + this.maturite))) {
      throw new Error(`${this.identifiant} : encours et maturité strictement positifs`);
    }
    Object.freeze(this);
  }

  cpr(marche: MarcheDevise): number {
    const refi = tauxParForward(marche.actualisation, 0, this.maturite, 12) + this.marge;
    return cprLogistique(this.taux - refi, this.cprMin, this.cprMax, this.pente, this.centre);
  }

  /** Dates mensuelles, solde avant paiement, principal total (contractuel + anticipé). */
  echeancier(marche: MarcheDevise): { dates: number[]; soldes: number[]; principal: number[] } {
    const dates = datesRegulieres(this.maturite, 12);
    const n = dates.length;
    const smm = smmDepuisCpr(this.cpr(marche));
    const i = this.taux / 12;
    const soldes: number[] = [];
    const principal: number[] = [];
    let b = this.encours;
    for (let k = 0; k < n; k++) {
      soldes.push(b);
      const restant = n - k;
      const annuite = Math.abs(i) < 1e-12 ? b / restant : (b * i) / (1 - (1 + i) ** -restant);
      const contractuel = annuite - b * i;
      const anticipe = k < n - 1 ? smm * (b - contractuel) : 0;
      principal.push(contractuel + anticipe);
      b -= principal[k]!;
    }
    principal[n - 1] = principal[n - 1]! + b;
    return { dates, soldes, principal };
  }

  flux(marche: MarcheDevise, _marcheBase?: MarcheDevise, inclureMarge = true): Flux {
    const { dates, soldes, principal } = this.echeancier(marche);
    const taux = this.taux - (inclureMarge ? 0 : this.marge);
    return { dates, interets: soldes.map((s) => (s * taux) / 12), principal };
  }

  interets(marche: MarcheDevise, _marcheBase: MarcheDevise | undefined, grille: readonly number[]): number[] {
    const { dates, soldes, principal } = this.echeancier(marche);
    const solde = (t: number): number => soldes[indiceInsertion(dates, t + EPS, "droite")] ?? 0;
    return interetsBilanConstant(
      grille,
      solde,
      () => this.taux,
      dates.map((d, k) => [d, principal[k]!] as const),
      (t) => tauxParForward(marche.actualisation, t, this.maturite, 12) + this.marge,
      this.maturite,
    );
  }

  echeancierRepricing(marcheBase: MarcheDevise): { dates: number[]; montants: number[] } {
    const { dates, principal } = this.echeancier(marcheBase);
    return { dates, montants: principal };
  }
}
