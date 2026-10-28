/**
 * Représentation des positions et génération des flux (PDF p. 4 et 9).
 *
 * CFᵢ,ₛ = CFᵢ(rₛ, paramètres contractuels, paramètres comportementaux).
 *
 * Conventions :
 * - temps en années depuis la date d'arrêté ; montants dans la devise de la position ;
 * - sens = +1 pour un actif, −1 pour un passif : les flux sont signés, si bien qu'EVE = Σ D·CF
 *   se lit directement comme valeur actif − passif ;
 * - coupons fixés en début de période, versés en fin de période ;
 * - la première période est supposée complète (coupon en cours fixé avant l'arrêté).
 */

import type { Courbe } from "./courbes";
import type { MarcheDevise } from "./scenarios";
import { arrondiBancaire, indiceInsertion, somme } from "./tableau";

export type Amortissement = "in_fine" | "lineaire" | "annuite";
export const EPS = 1e-9;

/** Flux signés d'une position : intérêts et principal par date de paiement. */
export interface Flux {
  readonly dates: readonly number[];
  readonly interets: readonly number[];
  readonly principal: readonly number[];
}

export function totalFlux(f: Flux): number[] {
  return f.interets.map((v, i) => v + f.principal[i]!);
}

/** Contrat minimal pour qu'une position entre dans les calculs EVE, NII et gaps. */
export interface Position {
  readonly identifiant: string;
  readonly categorie: string;
  readonly devise: string;
  /** Flux signés sous le marché du scénario. */
  flux(marche: MarcheDevise, marcheBase: MarcheDevise, inclureMarge: boolean): Flux;
  /** Intérêts signés de chaque période de la grille, à bilan constant. */
  interets(marche: MarcheDevise, marcheBase: MarcheDevise, grille: readonly number[]): number[];
  /** Dates de prochain repricing et montants signés qui repricent à ces dates. */
  echeancierRepricing(marcheBase: MarcheDevise): { dates: number[]; montants: number[] };
}

/** Dates de paiement d'un échéancier régulier se terminant à `maturite`. */
export function datesRegulieres(maturite: number, frequence: number): number[] {
  const n = Math.ceil(maturite * frequence - EPS);
  return Array.from({ length: n }, (_, k) => maturite - (n - 1 - k) / frequence);
}

/** Taux fixe par d'un contrat démarrant en `debut` pour `duree` ans (base du renouvellement). */
export function tauxParForward(courbe: Courbe, debut: number, duree: number, frequence: number): number {
  const n = Math.max(1, arrondiBancaire(duree * frequence));
  const df = Array.from({ length: n }, (_, k) => courbe.facteurActualisation(debut + (k + 1) / frequence));
  const annuite = somme(df) / frequence;
  return (courbe.facteurActualisation(debut) - df[n - 1]!) / annuite;
}

interface Tranche {
  montant: number;
  taux: number;
  prochaineRevision: number;
}

/**
 * Intérêts (non signés) par période de grille, à bilan constant (PDF p. 12).
 *
 * Chaque montant qui arrive à échéance est remplacé par une tranche de caractéristiques
 * comparables, au taux de renouvellement du scénario à sa date de remplacement, puis révisée
 * tous les `periodeRenouvellement` ans. L'état est lu au début de chaque période de la grille.
 */
export function interetsBilanConstant(
  grille: readonly number[],
  solde: (t: number) => number,
  tauxContractuel: (t: number) => number,
  remboursements: readonly (readonly [number, number])[],
  tauxRenouvellement: (t: number) => number,
  periodeRenouvellement: number,
): number[] {
  if (grille.length < 2 || grille.some((g, i) => i > 0 && !(g > grille[i - 1]!))) {
    throw new Error("grille : au moins deux nœuds strictement croissants");
  }
  if (!(periodeRenouvellement > 0)) throw new Error("periodeRenouvellement strictement positive");
  // Tri stable par date puis montant, comme `sorted` sur des tuples en Python.
  const restants = [...remboursements].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tranches: Tranche[] = [];
  const resultat: number[] = [];
  let suivant = 0;
  for (let j = 0; j < grille.length - 1; j++) {
    const t = grille[j]!;
    const dt = grille[j + 1]! - t;
    while (suivant < restants.length && restants[suivant]![0] <= t + EPS) {
      const [date, montant] = restants[suivant]!;
      suivant++;
      if (montant > 0) {
        tranches.push({ montant, taux: tauxRenouvellement(date), prochaineRevision: date + periodeRenouvellement });
      }
    }
    for (const tr of tranches) {
      while (tr.prochaineRevision <= t + EPS) {
        tr.taux = tauxRenouvellement(tr.prochaineRevision);
        tr.prochaineRevision += periodeRenouvellement;
      }
    }
    let renouvele = 0;
    for (const tr of tranches) renouvele += tr.montant * tr.taux;
    resultat.push((solde(t) * tauxContractuel(t) + renouvele) * dt);
  }
  return resultat;
}

export interface CaracteristiquesInstrument {
  identifiant: string;
  categorie: string;
  devise: string;
  sens: 1 | -1;
  encours: number;
  taux: number;
  maturite: number;
  frequence?: number;
  amortissement?: Amortissement;
  index?: string | null;
  marge?: number;
  facteurConversion?: number;
  dureeRenouvellement?: number | null;
}

/**
 * Prêt, dépôt à terme, titre, jambe de dérivé ou engagement hors bilan.
 *
 * taux : taux client en vigueur (pour un taux variable, dernier fixing marge comprise).
 * index : null pour un taux fixe ; sinon nom de l'index de la courbe de projection.
 * marge : marge commerciale (fixe) ou spread sur index (variable). Exclue des flux si
 *         `inclureMarge` est faux, de façon identique en base et en choc (PDF p. 11).
 * facteurConversion : part de l'encours retenue (tirage attendu d'un hors-bilan).
 * dureeRenouvellement : durée des tranches de remplacement en ΔNII ; par défaut la maturité
 *         résiduelle (approximation à remplacer par la durée d'origine si connue).
 */
export class Instrument implements Position {
  readonly identifiant: string;
  readonly categorie: string;
  readonly devise: string;
  readonly sens: 1 | -1;
  readonly encours: number;
  readonly taux: number;
  readonly maturite: number;
  readonly frequence: number;
  readonly amortissement: Amortissement;
  readonly index: string | null;
  readonly marge: number;
  readonly facteurConversion: number;
  readonly dureeRenouvellement: number | null;

  constructor(c: CaracteristiquesInstrument) {
    this.identifiant = c.identifiant;
    this.categorie = c.categorie;
    this.devise = c.devise;
    this.sens = c.sens;
    this.encours = c.encours;
    this.taux = c.taux;
    this.maturite = c.maturite;
    this.frequence = c.frequence ?? 1;
    this.amortissement = c.amortissement ?? "in_fine";
    this.index = c.index ?? null;
    this.marge = c.marge ?? 0;
    this.facteurConversion = c.facteurConversion ?? 1;
    this.dureeRenouvellement = c.dureeRenouvellement ?? null;
    const id = this.identifiant;
    if (this.sens !== 1 && this.sens !== -1) throw new Error(`${id} : sens = +1 (actif) ou −1 (passif)`);
    if (!(this.encours > 0 && Number.isFinite(this.encours))) {
      throw new Error(`${id} : encours strictement positif et fini`);
    }
    if (!(this.maturite > 0 && Number.isFinite(this.maturite))) throw new Error(`${id} : maturité strictement positive`);
    if (!(Number.isInteger(this.frequence) && this.frequence >= 1)) throw new Error(`${id} : fréquence entière >= 1`);
    if (this.index !== null && this.amortissement === "annuite") {
      throw new Error(`${id} : annuité constante non définie pour un taux variable`);
    }
    if (!(this.facteurConversion > 0 && this.facteurConversion <= 1)) {
      throw new Error(`${id} : facteur de conversion dans ]0 ; 1]`);
    }
    Object.freeze(this);
  }

  get nominal(): number {
    return this.encours * this.facteurConversion;
  }

  datesPaiement(): number[] {
    return datesRegulieres(this.maturite, this.frequence);
  }

  /** Solde avant chaque paiement et principal versé (non signés). */
  soldesEtPrincipal(): { soldes: number[]; principal: number[] } {
    const n = this.datesPaiement().length;
    const N = this.nominal;
    let principal: number[];
    if (this.amortissement === "in_fine") {
      principal = new Array<number>(n).fill(0);
      principal[n - 1] = N;
    } else if (this.amortissement === "lineaire") {
      principal = new Array<number>(n).fill(N / n);
    } else {
      const i = this.taux / this.frequence;
      const annuite = Math.abs(i) < 1e-12 ? N / n : (N * i) / (1 - (1 + i) ** -n);
      const soldes: number[] = [];
      principal = [];
      let s = N;
      for (let k = 0; k < n; k++) {
        soldes.push(s);
        principal.push(annuite - s * i);
        s -= principal[k]!;
      }
      // Résidu d'arrondi flottant : le solde final doit être nul.
      principal[n - 1] = principal[n - 1]! + s;
      return { soldes, principal };
    }
    const soldes: number[] = [];
    let verse = 0;
    for (let k = 0; k < n; k++) {
      soldes.push(N - verse);
      verse += principal[k]!;
    }
    return { soldes, principal };
  }

  tauxPeriodes(marche: MarcheDevise, inclureMarge: boolean): number[] {
    const dates = this.datesPaiement();
    const retrait = inclureMarge ? 0 : this.marge;
    const taux = new Array<number>(dates.length).fill(this.taux - retrait);
    if (this.index !== null && dates.length > 1) {
      const courbe = marche.courbeIndex(this.index);
      for (let k = 1; k < dates.length; k++) {
        taux[k] = courbe.forward(dates[k - 1]!, dates[k]!) + this.marge - retrait;
      }
    }
    return taux;
  }

  flux(marche: MarcheDevise, _marcheBase?: MarcheDevise, inclureMarge = true): Flux {
    const dates = this.datesPaiement();
    const { soldes, principal } = this.soldesEtPrincipal();
    const taux = this.tauxPeriodes(marche, inclureMarge);
    return {
      dates,
      interets: soldes.map((s, k) => (this.sens * (s * taux[k]!)) / this.frequence),
      principal: principal.map((p) => this.sens * p),
    };
  }

  interets(marche: MarcheDevise, _marcheBase: MarcheDevise | undefined, grille: readonly number[]): number[] {
    const dates = this.datesPaiement();
    const { soldes, principal } = this.soldesEtPrincipal();
    const taux = this.tauxPeriodes(marche, true);
    const courbe = marche.courbeIndex(this.index);
    const periode = (t: number): number => indiceInsertion(dates, t + EPS, "droite");
    const solde = (t: number): number => soldes[periode(t)] ?? 0;
    const tauxContractuel = (t: number): number => taux[periode(t)] ?? 0;

    let renouvellement: (t: number) => number;
    let periodeRenouvellement: number;
    if (this.index === null) {
      // Une durée nulle retombe aussi sur la maturité.
      const duree = this.dureeRenouvellement || this.maturite;
      renouvellement = (t) => tauxParForward(courbe, t, duree, this.frequence) + this.marge;
      periodeRenouvellement = duree;
    } else {
      const pas = 1 / this.frequence;
      renouvellement = (t) => courbe.forward(t, t + pas) + this.marge;
      periodeRenouvellement = pas;
    }
    const bruts = interetsBilanConstant(
      grille,
      solde,
      tauxContractuel,
      dates.map((d, k) => [d, principal[k]!] as const),
      renouvellement,
      periodeRenouvellement,
    );
    return bruts.map((v) => this.sens * v);
  }

  echeancierRepricing(): { dates: number[]; montants: number[] } {
    const dates = this.datesPaiement();
    const { soldes, principal } = this.soldesEtPrincipal();
    if (this.index === null) return { dates, montants: principal.map((p) => this.sens * p) };
    // Un taux variable reprice en totalité à sa prochaine date de révision.
    return { dates: [dates[0]!], montants: [this.sens * soldes[0]!] };
  }
}
